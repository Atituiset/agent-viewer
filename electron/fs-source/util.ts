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

// ---- 启发式 agent 发现共享的常量与纯函数 ----

/** 转录扫描时剪枝的目录名（包管理器缓存/构建产物等，体量大且必非会话）。 */
export const TRANSCRIPT_PRUNE_DIRS = new Set([
  ".git", ".cache", ".npm", ".cargo", ".rustup", ".m2", ".gradle",
  ".docker", ".vscode-server", "node_modules", "target", "vendor",
]);

/** 会话转录文件扩展名。 */
export function isTranscriptFileName(name: string): boolean {
  return /\.(jsonl|json)$/i.test(name);
}

/**
 * 从转录文件路径反推「agent 会话根目录」——这是文件驱动的发现：
 * 不依赖容器目录叫 sessions/projects/history，任何名字都行。
 * 规则：必须在点目录下（$HOME/.<x> 或 .config/<x>、.local/share/<x>），总深度 ≤4。
 *   ~/.codeagent/sessions/a.jsonl → .codeagent/sessions
 *   ~/.codeagent/a.jsonl          → .codeagent（平铺）
 *   ~/Projects/foo/a.jsonl        → null（不是点目录领地）
 */
export function extractTranscriptRoot(rel: string): string | null {
  const parts = rel.split("/");
  if (parts.length < 2 || parts.length > 4) return null;
  let owner: string[];
  if (parts[0] === ".config" || parts[0] === ".local") {
    if (!parts[1]) return null;
    owner = [parts[0], parts[1]];
  } else {
    if (!parts[0].startsWith(".")) return null;
    owner = [parts[0]];
  }
  const hasContainer = parts.length >= owner.length + 2; // owner + container + 文件名
  return hasContainer ? [...owner, parts[owner.length]].join("/") : owner.join("/");
}
