import fs from "fs";
import os from "os";
import path from "path";
import type { FileSource, DirEntry, FileStat } from "./types";
import { resolvePath } from "./util";

const SCAN_DIR_NAMES = ["sessions", "projects", "history"];
const SCAN_SKIP_PREFIXES = [".git/", "node_modules/", ".cache/"];

/**
 * 启发式 agent 发现：扫描 $HOME（含 .config、.local/share）下的候选会话目录。
 * 市面 CLI agent 的共识布局是 ~/.<agent>/sessions|projects|history。
 * 纯同步 fs + 返回相对 home 的 posix 路径；LocalFileSource/WSL（UNC 走 Node fs）共用。
 */
export function scanHomeForAgentStorage(home: string): string[] {
  const out: string[] = [];
  // rel 前缀：home 本身 = ""（要求 .<agent> 布局），.config / .local/share 下是普通名。
  const roots: Array<{ abs: string; relPrefix: string; requireDot: boolean }> = [
    { abs: home, relPrefix: "", requireDot: true },
    { abs: path.posix.join(home, ".config"), relPrefix: ".config", requireDot: false },
    { abs: path.posix.join(home, ".local", "share"), relPrefix: ".local/share", requireDot: false },
  ];
  for (const { abs, relPrefix, requireDot } of roots) {
    let level1: fs.Dirent[] = [];
    try {
      level1 = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d1 of level1) {
      if (!d1.isDirectory()) continue;
      // $HOME 下只认 .<agent>（约定俗成的 dotfile 布局）；
      // .config/.local/share 下是普通名（newagent、xagent），跳过隐藏目录反而更稳。
      if (requireDot ? !d1.name.startsWith(".") : d1.name.startsWith(".")) continue;
      const base = relPrefix ? `${relPrefix}/${d1.name}` : d1.name;
      for (const name of SCAN_DIR_NAMES) {
        try {
          fs.accessSync(path.join(abs, d1.name, name));
          out.push(`${base}/${name}`);
        } catch {}
      }
    }
  }
  return out.filter((rel) => !SCAN_SKIP_PREFIXES.some((p) => rel.startsWith(p)));
}

export class LocalFileSource implements FileSource {
  readonly kind = "local" as const;
  readonly home: string;

  constructor(home?: string) {
    this.home = home ?? os.homedir();
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(resolvePath(this, p));
      return true;
    } catch {
      return false;
    }
  }

  async readDir(p: string): Promise<DirEntry[]> {
    const ents = await fs.promises.readdir(resolvePath(this, p), { withFileTypes: true });
    return ents.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  }

  async readFile(p: string): Promise<string> {
    return fs.promises.readFile(resolvePath(this, p), "utf-8");
  }

  async readFileBuffer(p: string): Promise<Buffer> {
    return fs.promises.readFile(resolvePath(this, p));
  }

  async stat(p: string): Promise<FileStat> {
    const s = await fs.promises.stat(resolvePath(this, p));
    return { mtime: s.mtime, birthtime: s.birthtime };
  }

  async readHead(p: string, maxBytes: number): Promise<string> {
    const fh = await fs.promises.open(resolvePath(this, p), "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead).toString("utf-8");
    } finally {
      await fh.close();
    }
  }

  localPath(p: string): string {
    return resolvePath(this, p);
  }

  scanAgentStorage(): Promise<string[]> {
    return Promise.resolve(scanHomeForAgentStorage(this.home));
  }

  async lineCount(p: string): Promise<number> {
    // 流式计数，不整文件进内存。
    const rs = fs.createReadStream(resolvePath(this, p), "utf-8");
    return new Promise((resolve, reject) => {
      let count = 0;
      let carry = ""; // 上一个 chunk 末尾未换行的残片
      rs.on("data", (chunk) => {
        const data = carry + chunk;
        const lines = data.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) count++;
        }
      })
        .on("end", () => {
          if (carry.trim()) count++;
          resolve(count);
        })
        .on("error", reject);
    });
  }
}
