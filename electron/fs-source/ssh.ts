import { Client } from "ssh2";
import fs from "fs";
import os from "os";
import path from "path";
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
 * 解析私钥：machine.sshKey 约定存的是「路径」（AddMachineModal 也是这么引导的），
 * 读文件拿内容；读不到则当内联内容兼容。未配置时回退常见默认私钥路径。
 */
export function resolvePrivateKey(raw: string | undefined, home = os.homedir()): Buffer | undefined {
  if (raw) {
    const expanded = raw.startsWith("~/") ? path.join(home, raw.slice(2)) : raw;
    try {
      return fs.readFileSync(expanded);
    } catch {
      return Buffer.from(raw);
    }
  }
  for (const name of ["id_ed25519", "id_rsa", "id_ecdsa"]) {
    try {
      return fs.readFileSync(path.join(home, ".ssh", name));
    } catch {}
  }
  return undefined;
}

const EXEC_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * SSH FileSource 走 `exec`（远程 shell 命令），而非 SFTP 子系统。
 * SFTP 子系统在很多 sshd 上是可选/被关掉的（缺它会让检测静默失败）；
 * exec 是 SSH 核心功能，几乎一定可用，更稳。
 * 假设远程是 GNU coreutils 环境（stat -c / find -printf / base64 -w0），
 * 本查看器的目标机器（Linux）都满足。
 *
 * 数据流：只把「命令输出」传回本地——目录列举、文件内容按需读取进内存；
 * 不把会话文件落盘。OpenCode 的 sqlite 是唯一例外（见 readFileBuffer）。
 *
 * 稳定性：
 * - keepalive 防止 NAT/防火墙掐掉空闲连接（Windows 客户端场景常见）。
 * - 每条 exec 有超时，stream 挂死不再永久 pending。
 * - 连接断开（error/close）后自动重建客户端，下一次调用透明恢复。
 */
export class SshFileSource implements FileSource {
  readonly kind = "ssh" as const;
  readonly home = "";
  private client!: Client;
  private clientReady = false;
  private disposed = false;
  private initPromise: Promise<void> | null = null;

  constructor(private opts: SshOptions) {
    this.client = this.buildClient();
  }

  private buildClient(): Client {
    const client = new Client();
    client
      .on("ready", () => {
        this.clientReady = true;
      })
      .on("error", () => {
        // 连接级错误（含 keepalive 超时）：标记失效，
        // 下一次 exec 时惰性重建。不在这里 reject 用户调用——
        // 由当次调用的超时/错误处理负责。
        this.clientReady = false;
      })
      .on("close", () => {
        // 远端或网络关闭连接后标记失效，触发惰性重连。
        this.clientReady = false;
      });
    client.connect({
      host: this.opts.host,
      port: this.opts.port,
      username: this.opts.username,
      password: this.opts.password,
      privateKey: resolvePrivateKey(this.opts.privateKey),
      // 有 ssh-agent 时让它参与认证（排在 publickey/password 前后由 ssh2 决定），
      // 这样「任何能 ssh 上去的 Linux 机器」零配置即可探测。
      agent: process.env.SSH_AUTH_SOCK || undefined,
      readyTimeout: CONNECT_TIMEOUT_MS,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
    });
    return client;
  }

  private waitForReady(client: Client): Promise<void> {
    return new Promise((resolve, reject) => {
      const onReady = () => { cleanup(); resolve(); };
      const onError = (e: Error) => { cleanup(); reject(e); };
      const cleanup = () => {
        client.off("ready", onReady);
        client.off("error", onError);
      };
      client.on("ready", onReady);
      client.on("error", onError);
    });
  }

  /** 确保有一个 ready 的客户端；必要时重建并等待握手完成。 */
  private async ensureConnected(): Promise<Client> {
    if (this.disposed) throw new Error("SshFileSource disposed");
    if (this.clientReady) return this.client;
    try {
      this.client.end();
    } catch {}
    this.client = this.buildClient();
    await this.waitForReady(this.client);
    this.initPromise = null; // 新连接需要重新解析 $HOME
    return this.client;
  }

  /** 建立连接并解析远程 $HOME。并发调用共享同一次初始化。 */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const home = await this.exec('printf %s "$HOME"');
        if (!home) {
          throw new Error(`Could not determine $HOME on ${this.opts.host} (shell exec disabled?)`);
        }
        (this as { home: string }).home = home;
      })();
    }
    return this.initPromise;
  }

  /** 单引号转义路径，安全地拼进 shell 命令。 */
  private sh(p: string): string {
    return "'" + String(p).replace(/'/g, "'\\''") + "'";
  }

  private abs(p: string): string {
    return resolvePath(this, p);
  }

  /** 运行一条远程命令，返回 stdout；非 0 退出码或超时则 reject。 */
  private async exec(cmd: string): Promise<string> {
    const attempt = (): Promise<string> =>
      new Promise((res, rej) => {
        let out = "";
        let err = "";
        let settled = false;
        const done = (fn: () => void) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            fn();
          }
        };
        const timer = setTimeout(
          () => done(() => rej(new Error(`remote command timed out after ${EXEC_TIMEOUT_MS}ms: ${cmd.slice(0, 80)}`))),
          EXEC_TIMEOUT_MS
        );
        this.client.exec(cmd, (e, stream) => {
          if (e) return done(() => rej(e));
          stream.on("data", (d: Buffer) => (out += d.toString()));
          stream.stderr.on("data", (d: Buffer) => (err += d.toString()));
          stream.on("close", (code: number | null) => {
            done(() => {
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
      });

    try {
      await this.ensureConnected();
      return await attempt();
    } catch {
      // 客户端可能在两次调用之间被对端断开：重建一次再试。
      if (this.disposed) throw new Error("SshFileSource disposed");
      await this.ensureConnected();
      return attempt();
    }
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
      out = await this.exec(`find ${this.sh(this.abs(p))} -mindepth 1 -maxdepth 1 -printf '%y\\t%f\\n'`);
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

  async readHead(p: string, maxBytes: number): Promise<string> {
    return this.exec(`head -c ${Math.floor(maxBytes)} ${this.sh(this.abs(p))}`);
  }

  async lineCount(p: string): Promise<number> {
    const out = await this.exec(`grep -cve '^$' ${this.sh(this.abs(p))} || true`);
    return Number(out.trim()) || 0;
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
