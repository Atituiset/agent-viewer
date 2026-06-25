import { Client } from "ssh2";
import type { FileSource, DirEntry, FileStat } from "./types";
import { resolvePath, join } from "./util";

export interface SshOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export class SshFileSource implements FileSource {
  readonly kind = "ssh" as const;
  readonly home = "";
  private client = new Client();
  private sftp: SftpHandle | null = null;
  private ready: Promise<void>;
  private initPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(private opts: SshOptions) {
    this.ready = new Promise((resolve, reject) => {
      this.client
        .on("ready", () => resolve())
        .on("error", reject)
        .connect({
          host: opts.host,
          port: opts.port,
          username: opts.username,
          password: opts.password,
          privateKey: opts.privateKey ? Buffer.from(opts.privateKey) : undefined,
          readyTimeout: 15000,
        });
    });
  }

  /** 建立连接、解析远程 $HOME、缓存 sftp。并发调用共享同一次初始化。 */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await this.ready;
      this.sftp = await new Promise<SftpHandle>((res, rej) =>
        this.client.sftp((e, s) => (e ? rej(e) : res(s as SftpHandle)))
      );
      const home = await this.execHome();
      (this as { home: string }).home = home;
    })();
    return this.initPromise;
  }

  private execHome(): Promise<string> {
    return new Promise((res, rej) => {
      let out = "";
      this.client.exec("echo $HOME", (e, stream) => {
        if (e) return rej(e);
        stream.on("data", (d: Buffer) => (out += d.toString()));
        stream.on("close", () => {
          const h = out.trim();
          if (!h)
            return rej(
              new Error(`Could not determine $HOME on ${this.opts.host} (shell exec disabled?)`)
            );
          res(h);
        });
        stream.stderr.on("data", () => {});
      });
    });
  }

  private async getSftp(): Promise<SftpHandle> {
    if (this.disposed) throw new Error("SshFileSource disposed");
    if (!this.sftp) await this.init();
    return this.sftp!;
  }

  private statIsDir(sftp: SftpHandle, absPath: string): Promise<boolean> {
    return new Promise((res) =>
      sftp.stat(absPath, (e, st) => res(!e && !!st && (st.mode! & 0o170000) === 0o040000))
    );
  }

  async exists(p: string): Promise<boolean> {
    const sftp = await this.getSftp();
    return new Promise((res) => sftp.stat(resolvePath(this, p), (e) => res(!e)));
  }

  async readDir(p: string): Promise<DirEntry[]> {
    const sftp = await this.getSftp();
    const absDir = resolvePath(this, p);
    return new Promise((res, rej) => {
      sftp.readdir(absDir, async (e, list) => {
        if (e || !list) return rej(e ?? new Error("readdir returned no list"));
        const out: DirEntry[] = [];
        for (const item of list) {
          const mode = item.attrs.mode || 0;
          let isDir = (mode & 0o170000) === 0o040000;
          // 很多 OpenSSH 服务端在 readdir 的 attrs 里不带 mode 位，回退到逐项 stat。
          if (!mode) isDir = await this.statIsDir(sftp, join(absDir, item.filename));
          out.push({ name: item.filename, isDirectory: isDir });
        }
        res(out);
      });
    });
  }

  async readFile(p: string): Promise<string> {
    const sftp = await this.getSftp();
    return new Promise((res, rej) => {
      let buf = "";
      const stream = sftp.createReadStream(resolvePath(this, p), { encoding: "utf-8" as BufferEncoding });
      stream.on("data", (d: string) => (buf += d));
      stream.on("end", () => res(buf));
      stream.on("error", (e) => {
        stream.destroy();
        rej(e);
      });
    });
  }

  async readFileBuffer(p: string): Promise<Buffer> {
    const sftp = await this.getSftp();
    return new Promise((res, rej) => {
      const chunks: Buffer[] = [];
      const stream = sftp.createReadStream(resolvePath(this, p));
      stream.on("data", (d: Buffer) => chunks.push(d));
      stream.on("end", () => res(Buffer.concat(chunks)));
      stream.on("error", (e) => {
        stream.destroy();
        rej(e);
      });
    });
  }

  async stat(p: string): Promise<FileStat> {
    const sftp = await this.getSftp();
    return new Promise((res, rej) => {
      sftp.stat(resolvePath(this, p), (e, st) => {
        if (e || !st) return rej(e ?? new Error("stat returned no stats"));
        res({ mtime: new Date((st.mtime ?? 0) * 1000) }); // SFTP 无 birthtime
      });
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    try {
      this.sftp?.end?.();
    } catch {}
    try {
      this.client.end();
    } catch {}
  }
}

// ssh2 的 SFTP 类型较繁琐，这里用最小结构类型。
interface SftpStats {
  mode?: number;
  mtime?: number;
}
interface SftpListItem {
  filename: string;
  attrs: SftpStats;
}
interface SftpHandle {
  stat(path: string, cb: (err: Error | null, stats?: SftpStats) => void): void;
  readdir(path: string, cb: (err: Error | null, list?: SftpListItem[]) => void): void;
  createReadStream(path: string, opts?: { encoding?: BufferEncoding }): SftpReadStream;
  end?(...args: unknown[]): unknown;
}

interface SftpReadStream {
  on(event: "data", listener: (chunk: string) => void): this;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "close", listener: () => void): this;
  destroy(): void;
}
