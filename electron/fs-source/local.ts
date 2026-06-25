import fs from "fs";
import os from "os";
import type { FileSource, DirEntry, FileStat } from "./types";
import { resolvePath } from "./util";

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
}
