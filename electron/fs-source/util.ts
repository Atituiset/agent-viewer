import path from "path";
import type { FileSource } from "./types";

/** 把相对 home 的路径解析为绝对路径（posix 风格，Node fs 在 Win 上也接受正斜杠）。 */
export function resolvePath(source: FileSource, p: string): string {
  if (path.posix.isAbsolute(p)) return p;
  // posix.join 会把 UNC 开头的 \\ 折叠成 \，破坏 \\wsl$\... 路径，直接拼接。
  if (source.home.startsWith("\\\\")) return `${source.home}/${p}`;
  return path.posix.join(source.home, p);
}

/** 拼接多段（全部 posix）。 */
export function join(...segs: string[]): string {
  return path.posix.join(...segs);
}
