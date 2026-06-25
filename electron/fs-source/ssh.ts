import { Client } from "ssh2";
import type { FileSource, DirEntry, FileStat } from "./types";
import { resolvePath } from "./util";

export interface SshOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

/**
 * SSH FileSource 走 `exec`（远程 shell 命令），而非 SFTP 子系统。
 * SFTP 子系统在很多 sshd 上是可选/被关掉的（缺它会让检测静默失败）；
 * exec 是 SSH 核心功能，几乎一定可用，更稳。
 * 假设远程是 GNU coreutils 环境（stat -c / find -printf / base64 -w0），
 * 本查看器的目标机器（Linux）都满足。
 *
 * 数据流：只把「命令输出」传回本地——目录列举、文件内容按需读取进内存；
 * 不把会话文件落盘。OpenCode 的 sqlite 是唯一例外（见 readFileBuffer）。
 */
export class SshFileSource implements FileSource {
  readonly kind = "ssh" as const;
  readonly home = "";
  private client = new Client();
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

  /** 建立连接并解析远程 $HOME。并发调用共享同一次初始化。 */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await this.ready;
      const home = await this.exec('printf %s "$HOME"');
      if (!home) {
        throw new Error(`Could not determine $HOME on ${this.opts.host} (shell exec disabled?)`);
      }
      (this as { home: string }).home = home;
    })();
    return this.initPromise;
  }

  /** 单引号转义路径，安全地拼进 shell 命令。 */
  private sh(p: string): string {
    return "'" + String(p).replace(/'/g, "'\\''") + "'";
  }

  private abs(p: string): string {
    return resolvePath(this, p);
  }

  /** 运行一条远程命令，返回 stdout；非 0 退出码则 reject。 */
  private exec(cmd: string): Promise<string> {
    if (this.disposed) return Promise.reject(new Error("SshFileSource disposed"));
    return new Promise((res, rej) => {
      let out = "";
      let err = "";
      this.client.exec(cmd, (e, stream) => {
        if (e) return rej(e);
        stream.on("data", (d: Buffer) => (out += d.toString()));
        stream.stderr.on("data", (d: Buffer) => (err += d.toString()));
        stream.on("close", (code: number | null) => {
          if (code === 0) res(out);
          else
            rej(
              new Error(
                `remote command failed (exit ${code}): ${cmd.slice(0, 80)}${
                  err ? " :: " + err.trim().slice(0, 200) : ""
                }`
              )
            );
        });
      });
    });
  }

  async exists(p: string): Promise<boolean> {
    try {
      await this.exec(`test -e ${this.sh(this.abs(p))}`);
      return true;
    } catch {
      return false;
    }
  }

  async readDir(p: string): Promise<DirEntry[]> {
    // GNU find：%y=类型(f/d/l...)，%f=basename。-mindepth 1 跳过目录自身。
    let out: string;
    try {
      out = await this.exec(`find ${this.sh(this.abs(p))} -mindepth 1 -maxdepth 1 -printf '%y\t%f\\n'`);
    } catch {
      return []; // 目录不存在或不可读
    }
    const entries: DirEntry[] = [];
    for (const line of out.split("\n")) {
      if (!line) continue;
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const type = line.slice(0, tab);
      const name = line.slice(tab + 1);
      if (!name) continue;
      entries.push({ name, isDirectory: type === "d" });
    }
    return entries;
  }

  async readFile(p: string): Promise<string> {
    return this.exec(`cat ${this.sh(this.abs(p))}`);
  }

  async readFileBuffer(p: string): Promise<Buffer> {
    // OpenCode sqlite：base64 -w0 无换行整段输出，本地解码后写临时文件用 better-sqlite3 打开。
    // 这是唯一会落本地（临时）的数据；openDbFromBuffer 用完即删。
    const b64 = await this.exec(`base64 -w0 ${this.sh(this.abs(p))}`);
    return Buffer.from(b64.trim(), "base64");
  }

  async stat(p: string): Promise<FileStat> {
    // %W=birth(epoch,未知为0)，%Y=mtime(epoch)
    const out = await this.exec(`stat -c '%W %Y' ${this.sh(this.abs(p))}`);
    const parts = out.trim().split(/\s+/).map((n) => Number(n));
    const mtime = new Date((parts[1] ?? 0) * 1000);
    const birthtime = parts[0] && parts[0] > 0 ? new Date(parts[0] * 1000) : undefined;
    return { mtime, birthtime };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    try {
      this.client.end();
    } catch {}
  }
}
