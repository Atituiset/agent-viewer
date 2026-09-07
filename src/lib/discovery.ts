import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import { detectKind, encodeGenericId, type GenericKind } from "./generic";
import { TOOLS } from "./registry";
import type { DetectedTool } from "./types";

/**
 * 启发式 agent 自发现。
 *
 * 已知 7 家 agent 走 registry 的固定 detectPaths；这里的任务是接住「不在名单里、
 * 但遵循市面共识存储布局」的 agent（企业内部 CLI、新出的 agent 等）：
 *   ~/.<agent>/sessions|projects|history 下的 *.jsonl / *.json 转录。
 *
 * 流程：scanAgentStorage 给出候选目录 → 排除已知 agent 领地与已知噪声 →
 * 逐候选采样验证（能被三种通用解析器之一定义才收录）→ 生成动态 tool 条目。
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
  // rootRel 形如 ".<agent>/sessions" 或 ".config/<x>/history" 或 ".local/share/<x>/sessions"
  const parts = rootRel.split("/");
  const agentBase = parts[0]; // ".<agent>" / ".config" / ".local"
  if (agentBase === ".config" || agentBase === ".local") {
    const owner = parts[1] ?? "";
    // owner 不带点也可疑（.local/share/opencode 这类通常带点或不带——宽松处理，靠采样验证兜底）
    return NOISE_DIR_BASES.has(owner.replace(/^\./, ""));
  }
  return NOISE_DIR_BASES.has(agentBase.replace(/^\./, "").split(".")[0]);
}

/** 目录名 → 展示名：.code-agent → Code Agent。 */
export function displayNameOf(dirBase: string): string {
  const cleaned = dirBase.replace(/^\./, "").replace(/[-_.]/g, " ").trim();
  if (!cleaned) return "Unknown Agent";
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** 主入口：在该 source 上做启发式发现（每个 source 只做一次，调用方缓存）。 */
export async function discoverAgents(source: FileSource): Promise<DiscoveredAgent[]> {
  if (typeof source.scanAgentStorage !== "function") return [];
  let candidates: string[];
  try {
    candidates = await source.scanAgentStorage();
  } catch {
    return [];
  }

  const known = knownTerritories();
  const out: DiscoveredAgent[] = [];
  for (const rootRel of candidates) {
    // 归一化：确保是 ~/.<x>/... 形式且不落在已知 agent 领地
    if (!rootRel.startsWith(".")) continue;
    if (known.has(rootRel.slice(0, rootRel.lastIndexOf("/")))) continue;
    if (isNoise(rootRel)) continue;

    // 采样验证：找一个 jsonl/json 文件，读头部判定格式；三种都不认识 → 放弃。
    const kind = await sampleKind(source, rootRel);
    if (!kind) continue;
    out.push({
      id: encodeGenericId(kind, rootRel),
      name: displayNameOf(rootRel.split("/")[rootRel.startsWith(".config") || rootRel.startsWith(".local") ? 1 : 0]),
      kind,
      rootRel,
    });
  }
  return out;
}

/** 在候选目录里找一个 jsonl/json 采样判定风格。 */
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
