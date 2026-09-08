import fs from "fs";
import os from "os";
import path from "path";
import type { FileSource, DirEntry, FileStat } from "./types";
import { resolvePath, TRANSCRIPT_PRUNE_DIRS, isTranscriptFileName, extractTranscriptRoot } from "./util";

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

/**
 * 文件驱动的发现（不依赖目录名）：DFS $HOME（+ .config/.local/share）下
 * 点目录领地，深度 ≤4，剪掉缓存/构建目录，收集 *.jsonl/*.json + mtime。
 * 结果按 mtime 降序（活跃度高的排前面，采样验证按序先试）。
 */
export function scanHomeForTranscripts(
  home: string,
  maxFiles = 2000,
  maxDirs = 20000
): Array<{ rel: string; mtime: number }> {
  const out: Array<{ rel: string; mtime: number }> = [];
  const roots = [
    { abs: home, prefix: "", dot: true },
    { abs: path.posix.join(home, ".config"), prefix: ".config", dot: false },
    { abs: path.posix.join(home, ".local", "share"), prefix: ".local/share", dot: false },
    { abs: path.posix.join(home, ".local", "state"), prefix: ".local/state", dot: false },
  ];
  let filesHit = 0;
  let dirsSeen = 0;

  const walk = (abs: string, rel: string, depth: number): void => {
    if (filesHit >= maxFiles || dirsSeen >= maxDirs) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    dirsSeen++;
    for (const e of entries) {
      if (filesHit >= maxFiles) return;
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth >= 4) continue; // 深度上限（owner + ≤2 层容器 + 文件）
        if (TRANSCRIPT_PRUNE_DIRS.has(e.name)) continue;
        // 点目录领地之外（如 ~/Projects）不递归——agent 数据约定在 dotfile 下。
        if (rel === "" && !e.name.startsWith(".")) continue;
        if (rel === ".config" || rel === ".local/share" || rel === ".local/state") {
          if (e.name.startsWith(".") || TRANSCRIPT_PRUNE_DIRS.has(e.name)) continue;
        }
        walk(childAbs, childRel, depth + 1);
      } else if (e.isFile() && isTranscriptFileName(e.name)) {
        // 只收点目录领地内的（.config/<x>/…、.<x>/…；$HOME 根下的散文件不算）
        if (!extractTranscriptRoot(childRel)) continue;
        try {
          const st = fs.statSync(childAbs);
          out.push({ rel: childRel, mtime: st.mtimeMs });
          filesHit++;
        } catch {}
      }
    }
  };

  for (const r of roots) {
    if (filesHit >= maxFiles) break;
    walk(r.abs, r.prefix, r.prefix ? 1 : 0);
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
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

  async existsBatch(paths: string[]): Promise<boolean[]> {
    return Promise.all(paths.map((p) => this.exists(p)));
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

  scanTranscriptFiles(): Promise<Array<{ rel: string; mtime: number }>> {
    return Promise.resolve(scanHomeForTranscripts(this.home));
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
