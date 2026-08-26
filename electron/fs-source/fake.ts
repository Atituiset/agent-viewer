import path from "path";
import type { FileSource, DirEntry, FileStat } from "./types";

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
}
