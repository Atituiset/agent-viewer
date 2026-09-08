import path from "path";
import type { FileSource, DirEntry, FileStat } from "./types";
import { extractTranscriptRoot, isTranscriptFileName } from "./util";

const SCAN_DIR_NAMES = ["sessions", "projects", "history"];

export class FakeFileSource implements FileSource {
  readonly kind = "local" as const;
  readonly home: string;
  private files = new Map<string, Buffer>();

  constructor(home = "/home/test") {
    this.home = home;
  }

  add(p: string, content: string | Buffer): this {
    this.files.set(this.resolve(p), Buffer.isBuffer(content) ? content : Buffer.from(content));
    return this;
  }

  private resolve(p: string): string {
    return path.posix.isAbsolute(p) ? p : path.posix.join(this.home, p);
  }

  async exists(p: string): Promise<boolean> {
    const abs = this.resolve(p);
    if (this.files.has(abs)) return true;
    // Implied directory: a path that contains stored files beneath it.
    const prefix = abs.endsWith("/") ? abs : abs + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  /** 与 SSH source 同语义的批量探测（fake 下逐个探，验证调用方逻辑用）。 */
  async existsBatch(paths: string[]): Promise<boolean[]> {
    return Promise.all(paths.map((p) => this.exists(p)));
  }

  async readDir(p: string): Promise<DirEntry[]> {
    const dir = this.resolve(p);
    const dirPrefix = dir.endsWith("/") ? dir : dir + "/";
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(dirPrefix)) {
        const rel = key.slice(dirPrefix.length);
        if (rel.length === 0) continue;
        names.add(rel.split("/")[0]);
      }
    }
    return Array.from(names).map((name) => ({
      name,
      isDirectory: !this.files.has(dirPrefix + name),
    }));
  }

  async readFile(p: string): Promise<string> {
    const b = this.files.get(this.resolve(p));
    if (!b) throw new Error("not found: " + p);
    return b.toString("utf-8");
  }

  async readFileBuffer(p: string): Promise<Buffer> {
    const b = this.files.get(this.resolve(p));
    if (!b) throw new Error("not found: " + p);
    return b;
  }

  async stat(p: string): Promise<FileStat> {
    if (!this.files.has(this.resolve(p))) throw new Error("not found: " + p);
    const t = new Date(0);
    return { mtime: t, birthtime: t };
  }

  async readHead(p: string, maxBytes: number): Promise<string> {
    const b = this.files.get(this.resolve(p));
    if (!b) throw new Error("not found: " + p);
    return b.subarray(0, maxBytes).toString("utf-8");
  }

  async lineCount(p: string): Promise<number> {
    const b = this.files.get(this.resolve(p));
    if (!b) throw new Error("not found: " + p);
    return b.toString("utf-8").split("\n").filter((l) => l.trim()).length;
  }

  /** 测试用：与 LocalFileSource 同语义——home 下（含 .config/.local/share）
   *  任何文件以 ~/<x>/<sessions|projects|history>/ 为前缀即认定该目录存在。 */
  async scanAgentStorage(): Promise<string[]> {
    const out = new Set<string>();
    const prefixes = ["", ".config/", ".local/share/"];
    for (const key of this.files.keys()) {
      const rel = key.startsWith(this.home + "/") ? key.slice(this.home.length + 1) : null;
      if (!rel || !rel.startsWith(".")) continue;
      for (const p of prefixes) {
        if (!rel.startsWith(p)) continue;
        const rest = rel.slice(p.length); // ".<agent>/sessions/..." 或 ".<agent>/<other>/..."
        const parts = rest.split("/");
        if (parts.length >= 2 && SCAN_DIR_NAMES.includes(parts[1])) {
          out.add(p + parts[0] + "/" + parts[1]);
        }
      }
    }
    return Array.from(out);
  }

  /** 文件驱动发现：返回点目录领地内、深度达标的所有 jsonl/json + mtime（fake 用内容长度当确定性占位）。 */
  async scanTranscriptFiles(): Promise<Array<{ rel: string; mtime: number }>> {
    const out: Array<{ rel: string; mtime: number }> = [];
    for (const [key, buf] of this.files) {
      const rel = key.startsWith(this.home + "/") ? key.slice(this.home.length + 1) : null;
      if (!rel) continue;
      if (!extractTranscriptRoot(rel)) continue;
      const name = rel.split("/").pop() ?? "";
      if (!isTranscriptFileName(name)) continue;
      out.push({ rel, mtime: buf.length }); // 用内容长度当 mtime 占位，保持确定性
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  }
}
