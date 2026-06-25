import path from "path";
import type { FileSource } from "./types";

/** 把相对 home 的路径解析为绝对路径（posix 风格，Node fs 在 Win 上也接受正斜杠）。 */
export function resolvePath(source: FileSource, p: string): string {
  if (path.posix.isAbsolute(p)) return p;
  return path.posix.join(source.home, p);
}

/** 拼接多段（全部 posix）。 */
export function join(...segs: string[]): string {
  return path.posix.join(...segs);
}
