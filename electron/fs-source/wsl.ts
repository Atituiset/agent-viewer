import fs from "fs";

/**
 * 枚举本机所有 WSL distro 的用户 home（反斜杠 UNC 形式，如 \\wsl$\Ubuntu\home\u）。
 * 仅在 win32 上有意义，其他平台直接返回 []。任何一步失败都返回已收集的部分，绝不抛出。
 */
export async function listWslHomes(): Promise<string[]> {
  if (process.platform !== "win32") return [];

  for (const root of ["\\\\wsl$\\", "\\\\wsl.localhost\\"]) {
    let distros: fs.Dirent[];
    try {
      distros = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const homes: string[] = [];
    for (const d of distros) {
      if (!d.isDirectory()) continue;
      const homeRoot = `${root}${d.name}\\home`;
      try {
        const users = await fs.promises.readdir(homeRoot, { withFileTypes: true });
        for (const u of users) {
          if (u.isDirectory()) homes.push(`${homeRoot}\\${u.name}`);
        }
      } catch {}
    }
    if (homes.length) return homes;
  }
  return [];
}
