import fs from "fs";
import { execFile } from "child_process";
import { LocalFileSource } from "./local";

// 注意：\\\\wsl$\\ 的共享根在不少机器上不可枚举（readdir 根目录 ENOENT），
// 但 \\\\wsl$\\<distro>\\... 子路径能正常读。所以 distro 名单走 wsl.exe，不走根枚举。
const UNC_PREFIXES = ["\\\\wsl$\\", "\\\\wsl.localhost\\"];

export interface WslHome {
  home: string;
  distro: string;
}

/** wsl.exe --list --quiet 输出 UTF-16LE；个别版本可能是 UTF-8，按内容嗅探。 */
function listDistroNames(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile("wsl.exe", ["--list", "--quiet"], { encoding: "buffer", timeout: 10_000 }, (err, stdout) => {
      if (err || !stdout || stdout.length === 0) return resolve([]);
      const text =
        stdout.length > 1 && stdout[1] === 0 ? stdout.toString("utf16le") : stdout.toString("utf8");
      resolve(
        text
          .replace(/\0/g, "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
    });
  });
}

/**
 * 枚举本机所有 WSL distro 的用户 home（反斜杠 UNC 形式，如 \\wsl$\Ubuntu\home\u）。
 * 仅在 win32 上有意义，其他平台直接返回 []。任何一步失败都返回已收集的部分，绝不抛出。
 */
export async function listWslHomes(): Promise<WslHome[]> {
  if (process.platform !== "win32") return [];

  const homes: WslHome[] = [];
  for (const distro of await listDistroNames()) {
    for (const prefix of UNC_PREFIXES) {
      const homeRoot = `${prefix}${distro}\\home`;
      try {
        const users = await fs.promises.readdir(homeRoot, { withFileTypes: true });
        for (const u of users) {
          if (u.isDirectory()) homes.push({ home: `${homeRoot}\\${u.name}`, distro });
        }
        break; // 这个 distro 的根能读，换下一个 distro
      } catch {}
    }
  }
  return homes;
}

// 在 WSL 内用 python3（stdlib sqlite3）执行查询，rows 以 JSON 输出。
// 参数全部走 argv，无 shell 拼接问题。
const PY_QUERY = [
  "import sqlite3,sys,json",
  'db=sqlite3.connect("file:%s?mode=ro"%sys.argv[1],uri=True)',
  "cur=db.execute(sys.argv[2],json.loads(sys.argv[3]))",
  "cols=[d[0] for d in cur.description]",
  "print(json.dumps([dict(zip(cols,r)) for r in cur.fetchall()]))",
].join(";");

/**
 * WSL home 的 FileSource：文件读写走 UNC（继承 LocalFileSource），
 * sqlite 查询走 wsl.exe + python3 —— SQLite 无法直接打开 9p/UNC 上的 db
 * （字节范围锁不支持，readonly 也报 SQLITE_BUSY），整库拷贝对 GB 级 db 又不可行。
 */
export class WslFileSource extends LocalFileSource {
  constructor(home: string, readonly distro: string) {
    super(home);
  }

  /** home = \\wsl$\<distro>\home\<user> → WSL 内路径 /home/<user>/<rel> */
  wslPath(rel: string): string {
    const parts = this.home.split(/[\\/]+/).filter(Boolean); // ["wsl$", distro, "home", user]
    return "/" + parts.slice(2).join("/") + "/" + rel;
  }

  querySqlite(dbRel: string, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      execFile(
        "wsl.exe",
        ["-d", this.distro, "--", "python3", "-c", PY_QUERY, this.wslPath(dbRel), sql, JSON.stringify(params)],
        { maxBuffer: 512 * 1024 * 1024, timeout: 60_000 },
        (err, stdout, stderr) => {
          if (err) {
            return reject(
              new Error(`wsl sqlite query failed: ${err.message}${stderr ? " :: " + stderr.trim().slice(0, 200) : ""}`)
            );
          }
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }
}
