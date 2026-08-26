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
