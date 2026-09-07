import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import { extractTranscriptRoot } from "../../electron/fs-source/util";
import { detectKind, encodeGenericId, type GenericKind } from "./generic";
import { TOOLS } from "./registry";
import type { DetectedTool } from "./types";

/**
 * 启发式 agent 自发现。
 *
 * 已知 7 家 agent 走 registry 的固定 detectPaths；这里的任务是接住「不在名单里」
 * 的 agent（企业内部 CLI、新出的 agent）。两条互补的腿：
 *
 * 1. 文件驱动（主）：scanTranscriptFiles 直接按 *.jsonl/*.json 找转录文件，
 *    反推所在目录为会话根，再采样验证格式。**不依赖容器目录叫什么名字**——
 *    sessions/chats/runs/任意名都行，适合目录命名完全未知的环境。
 * 2. 目录名驱动（补充）：scanAgentStorage 找 sessions/projects/history 三个
 *    约定名，作为文件驱动扫不到时的兜底（两者结果按根目录去重合并）。
 *
 * 扫描/验证全程容错：任何失败都只是「少发现一个」，绝不影响已知 agent 的显示。
 */

export interface DiscoveredAgent {
  /** 动态 tool id：generic:<kind>:<rootRel>，registry 侧无状态解码。 */
  id: string;
  /** 展示名：目录名去点、首字母大写。 */
  name: string;
  kind: GenericKind;
  /** 相对 home 的会话根目录（如 .codeagent/sessions）。 */
  rootRel: string;
}

/** 已知 agent 的领地前缀（发现结果与其重叠时不重复显示）。 */
function knownTerritories(): Set<string> {
  const set = new Set<string>();
  for (const t of TOOLS) {
    for (const p of t.detectPaths) {
      // .claude/projects → .claude；.local/share/opencode/opencode.db → .local/share/opencode
      const parts = p.split("/");
      set.add(parts.slice(0, -1).join("/"));
    }
  }
  return set;
}

/** 明确的噪声/非 agent 目录（.config/git 的 history、.cache 等）。 */
const NOISE_DIR_BASES = new Set([
  "git", "chromium", "google-chrome", "pulse", "dconf", "config", // .config/git 等命中 history 的常见误报
  "cache", "npm", "yarn", "pnpm", "cargo", "rustup", "gradle", "m2", "maven",
  "docker", "terraform", "ansible", "kube", "helm", "vscode", "code-server",
]);

function isNoise(rootRel: string): boolean {
  // rootRel 形如 ".<agent>/sessions"、".<agent>"（平铺）或 ".config/<x>/history"
  const parts = rootRel.split("/");
  const agentBase = parts[0]; // ".<agent>" / ".config" / ".local"
  if (agentBase === ".config" || agentBase === ".local") {
    const owner = parts[1] ?? "";
    return NOISE_DIR_BASES.has(owner.replace(/^\./, ""));
  }
  // 噪声目录即使命中也排除（.npm/sessions 这类）；靠采样验证兜底漏网的。
  return NOISE_DIR_BASES.has(agentBase.replace(/^\./, "").split(".")[0]);
}

/** 目录名 → 展示名：.code-agent/sessions → Code Agent；.codeagent → Codeagent。 */
export function displayNameOf(rootRel: string): string {
  const parts = rootRel.split("/");
  // .config/<x>/… / .local/share/<x>/… 的主体是 <x>；其余取点目录本身。
  const base = parts[0] === ".config" || parts[0] === ".local" ? parts[1] ?? parts[0] : parts[0];
  const cleaned = base.replace(/^\./, "").replace(/[-_.]/g, " ").trim();
  if (!cleaned) return "Unknown Agent";
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** 主入口：在该 source 上做启发式发现（每个 source 只做一次，调用方缓存）。 */
export async function discoverAgents(source: FileSource): Promise<DiscoveredAgent[]> {
  const known = knownTerritories();

  // ---- 腿 1：文件驱动（不依赖目录名）----
  // rootRel → 采样文件 rel（null = 目录名驱动补的，还没采样）
  const rootsFromFiles = new Map<string, string | null>();
  if (typeof source.scanTranscriptFiles === "function") {
    try {
      for (const f of await source.scanTranscriptFiles()) {
        const rootRel = extractTranscriptRoot(f.rel);
        if (!rootRel || isNoise(rootRel)) continue;
        if (known.has(rootRel.split("/").slice(0, -1).join("/"))) continue;
        if (known.has(rootRel)) continue; // $HOME 平铺型根（.codeagent 本身）
        // 聚合：一个根目录多个文件只记一次（首选活跃度最高的——扫描结果已按 mtime 降序）。
        if (!rootsFromFiles.has(rootRel)) rootsFromFiles.set(rootRel, f.rel);
      }
    } catch {}
  }

  // ---- 腿 2：目录名驱动（sessions/projects/history 约定名兜底）----
  if (typeof source.scanAgentStorage === "function") {
    try {
      for (const rootRel of await source.scanAgentStorage()) {
        if (!rootRel.startsWith(".")) continue;
        const parent = rootRel.slice(0, rootRel.lastIndexOf("/"));
        if (known.has(parent) || known.has(rootRel)) continue;
        if (isNoise(rootRel)) continue;
        if (!rootsFromFiles.has(rootRel)) rootsFromFiles.set(rootRel, null); // null = 待采样（腿 1 没覆盖到）
      }
    } catch {}
  }

  // ---- 验证与收录 ----
  const out: DiscoveredAgent[] = [];
  for (const [rootRel, sampleFile] of rootsFromFiles) {
    const kind = sampleFile
      ? await sampleKindOfFile(source, sampleFile)
      : await sampleKind(source, rootRel);
    if (!kind) continue; // 解析不出任何已知格式 → 宁可不显示
    out.push({
      id: encodeGenericId(kind, rootRel),
      name: displayNameOf(rootRel),
      kind,
      rootRel,
    });
  }
  return out;
}

/** 直接读已知转录文件的首几 KB 判定格式（文件驱动路径用，零额外探测）。 */
async function sampleKindOfFile(source: FileSource, rel: string): Promise<GenericKind | null> {
  try {
    return detectKind(await source.readHead(rel, 4096));
  } catch {
    return null;
  }
}

/** 在候选目录里找一个 jsonl/json 采样判定风格（目录名驱动路径用）。 */
async function sampleKind(source: FileSource, rootRel: string): Promise<GenericKind | null> {
  let entries;
  try {
    entries = await source.readDir(rootRel);
  } catch {
    return null;
  }
  // 优先根下直接的文件（最快），再扫一层子目录；找到第一个可判定的就返回。
  for (const e of entries) {
    if (e.isDirectory || !/\.(jsonl|json)$/i.test(e.name)) continue;
    try {
      const kind = detectKind(await source.readHead(join(rootRel, e.name), 4096));
      if (kind) return kind;
    } catch {}
  }
  for (const e of entries) {
    if (!e.isDirectory) continue;
    let sub;
    try {
      sub = await source.readDir(join(rootRel, e.name));
    } catch {
      continue;
    }
    for (const f of sub) {
      if (f.isDirectory || !/\.(jsonl|json)$/i.test(f.name)) continue;
      try {
        const kind = detectKind(await source.readHead(join(rootRel, e.name, f.name), 4096));
        if (kind) return kind;
      } catch {}
    }
  }
  return null;
}

/** 发现条目 → DetectedTool（sessionCount 惰性由调用方补齐）。 */
export function discoveredToToolEntry(d: DiscoveredAgent, sessionCount = 0): DetectedTool {
  return {
    id: d.id,
    name: d.name,
    icon: "✨",
    color: "#a78bfa",
    description: `Discovered agent (${d.kind}) — ${d.rootRel}`,
    sessionCount,
    detected: true,
  };
}
