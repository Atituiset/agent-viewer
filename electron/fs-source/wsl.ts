import fs from "fs";
import { execFile } from "child_process";

// 注意：\\\\wsl$\\ 的共享根在不少机器上不可枚举（readdir 根目录 ENOENT），
// 但 \\\\wsl$\\<distro>\\... 子路径能正常读。所以 distro 名单走 wsl.exe，不走根枚举。
const UNC_PREFIXES = ["\\\\wsl$\\", "\\\\wsl.localhost\\"];

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
export async function listWslHomes(): Promise<string[]> {
  if (process.platform !== "win32") return [];

  const homes: string[] = [];
  for (const distro of await listDistroNames()) {
    for (const prefix of UNC_PREFIXES) {
      const homeRoot = `${prefix}${distro}\\home`;
      try {
        const users = await fs.promises.readdir(homeRoot, { withFileTypes: true });
        for (const u of users) {
          if (u.isDirectory()) homes.push(`${homeRoot}\\${u.name}`);
        }
        break; // 这个 distro 的根能读，换下一个 distro
      } catch {}
    }
  }
  return homes;
}
