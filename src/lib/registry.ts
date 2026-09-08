import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, DetectedTool, ToolSession } from "./types";
import { listClaudeSessionsAll, readClaudeSession, countClaudeSessions } from "./claude";
import { listCodexSessions, readCodexSession, countCodexSessions } from "./codex";
import { listOpenCodeSessions, readOpenCodeSession } from "./opencode";
import { listGeminiSessions, readGeminiSession } from "./gemini";
import { listDeepSeekSessions, readDeepSeekSession, countDeepSeekSessions } from "./deepseek";
import { listHermesSessions, readHermesSession } from "./hermes";
import { listKimiSessions, readKimiSession } from "./kimi";
import { decodeGenericId, listGenericSessions, readGenericSession } from "./generic";
import { discoverAgents } from "./discovery";

/**
 * Agent 工具注册表——加一个新 agent 只需：
 * 1. 新建 src/lib/<tool>.ts，导出 listSessions / readSession；
 * 2. 在 TOOLS 里加一个条目。
 * detect / ipc / UI 全部从这里派生，无需再改其他文件。
 */
export interface ToolEntry {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  /** 相对 $HOME 的检测路径；任一存在即视为已安装。 */
  detectPaths: string[];
  /** claude-code 需要 projectPath 才能定位会话文件。 */
  requiresProjectPath?: boolean;
  listSessions: (source: FileSource) => Promise<ToolSession[]>;
  readSession: (
    source: FileSource,
    sessionId: string,
    projectPath?: string
  ) => Promise<ConversationMessage[]>;
  /**
   * detect 阶段的轻量会话计数（工具卡片上的数字）。
   * 缺省回退 listSessions().length——但那会拉全部文件头（SSH 下几百个 RTT）。
   * jsonl/json 平铺布局的工具应实现：readDir 数文件即可。
   */
  countSessions?: (source: FileSource) => Promise<number>;
}

export const TOOLS: ToolEntry[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    icon: "🟠",
    color: "#f97316",
    description: "Anthropic Claude Code CLI sessions",
    detectPaths: [".claude/projects"],
    requiresProjectPath: true,
    listSessions: listClaudeSessionsAll,
    countSessions: countClaudeSessions,
    readSession: (src, sessionId, projectPath) => {
      if (!projectPath) throw new Error("claude-code session requires projectPath");
      return readClaudeSession(src, projectPath, sessionId);
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    icon: "🔵",
    color: "#3b82f6",
    description: "OpenCode CLI sessions",
    detectPaths: [".local/share/opencode/opencode.db"],
    listSessions: listOpenCodeSessions,
    readSession: readOpenCodeSession,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    icon: "🟣",
    color: "#8b5cf6",
    description: "DeepSeek CLI sessions",
    detectPaths: [".deepseek/sessions"],
    listSessions: listDeepSeekSessions,
    countSessions: countDeepSeekSessions,
    readSession: readDeepSeekSession,
  },
  {
    id: "codex",
    name: "Codex",
    icon: "🟢",
    color: "#22c55e",
    description: "OpenAI Codex CLI sessions",
    detectPaths: [".codex/sessions"],
    listSessions: listCodexSessions,
    countSessions: countCodexSessions,
    readSession: readCodexSession,
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    icon: "🔷",
    color: "#06b6d4",
    description: "Google Gemini CLI conversations",
    detectPaths: [".gemini/antigravity-cli"],
    listSessions: listGeminiSessions,
    readSession: readGeminiSession,
  },
  {
    id: "hermes",
    name: "Hermes",
    icon: "⚪",
    color: "#a1a1aa",
    description: "Hermes agent sessions",
    detectPaths: [".hermes/sessions"],
    listSessions: listHermesSessions,
    readSession: readHermesSession,
  },
  {
    id: "kimi-code",
    name: "Kimi Code",
    icon: "🌙",
    color: "#eab308",
    description: "Kimi Code CLI sessions",
    detectPaths: [".kimi-code/sessions"],
    listSessions: listKimiSessions,
    readSession: readKimiSession,
  },
];

export function getTool(toolId: string): ToolEntry {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (tool) return tool;
  // 启发式发现的动态条目：id 编码了格式与根目录，无状态解码出等价 ToolEntry。
  const gen = decodeGenericId(toolId);
  if (gen) {
    const rootRel = gen.rootRel;
    return {
      id: toolId,
      name: toolId,
      icon: "✨",
      color: "#a78bfa",
      description: `Discovered agent — ${rootRel}`,
      detectPaths: [rootRel],
      listSessions: (source) => listGenericSessions(source, rootRel),
      readSession: (source, sessionId) => readGenericSession(source, gen.kind, rootRel, sessionId),
    };
  }
  throw new Error("unknown tool: " + toolId);
}

/** 数一层/两层目录下的 jsonl|json 文件数（轻量计数，detect 卡片用）；子目录 readDir 并行。 */
async function countTranscriptFiles(source: FileSource, root: string): Promise<number> {
  const entries = await source.readDir(root).catch(() => [] as DirEntryLike[]);
  // 文件直接数；子目录并行 readDir 再数一层。
  const subs = await Promise.all(
    entries.map(async (e): Promise<number> => {
      if (!e.isDirectory) return 0;
      const sub = await source.readDir(join(root, e.name)).catch(() => [] as DirEntryLike[]);
      return sub.filter((f) => !f.isDirectory && /\.(jsonl|json)$/i.test(f.name)).length;
    })
  );
  return subs.reduce((n, c) => n + c, 0) + entries.filter((e) => !e.isDirectory && /\.(jsonl|json)$/i.test(e.name)).length;
}

type DirEntryLike = { name: string; isDirectory: boolean };

/** 逐路径探测存在性：source 支持 existsBatch 时一条命令拿回全部结果（SSH 下 N RTT → 1）。 */
async function detectPathsPresent(source: FileSource, paths: string[]): Promise<boolean[]> {
  if (source.existsBatch) {
    try {
      return await source.existsBatch(paths);
    } catch {
      // 批量命令失败：回退逐个探。
    }
  }
  return Promise.all(paths.map((p) => source.exists(p)));
}

/** 检测所有已安装的工具并统计会话数。
 *  已知 agent 走固定 detectPaths；另做一轮启发式发现，接住不在名单里、
 *  但遵循 ~/.<agent>/sessions|projects|history 布局的 agent（内部 CLI、新 agent）。
 *  两条腿互不干扰：发现失败只影响发现条目。
 *  计数走 countSessions（readDir 级），不再为卡片数字拉全部文件。 */
export async function detectTools(source: FileSource): Promise<DetectedTool[]> {
  // 全部 detectPaths 一次性探测（SSH：N 条 test -e 拼一条命令，1 个 RTT）。
  const allPaths = TOOLS.flatMap((t) => t.detectPaths);
  const allPresent = await detectPathsPresent(source, allPaths);
  let pathIdx = 0;
  const known = await Promise.all(
    TOOLS.map(async (tool): Promise<DetectedTool> => {
      const detected = tool.detectPaths.some(() => allPresent[pathIdx++]);
      let sessionCount = 0;
      if (detected) {
        try {
          sessionCount = tool.countSessions
            ? await tool.countSessions(source)
            : (await tool.listSessions(source)).length;
        } catch (e) {
          console.error(`[detect] ${tool.id} count failed:`, e);
        }
      }
      return {
        id: tool.id,
        name: tool.name,
        icon: tool.icon,
        color: tool.color,
        description: tool.description,
        sessionCount,
        detected,
      };
    })
  );

  // 启发式发现：未知 agent（容错——失败就是少几个，不影响已知条目）。
  let discovered: DetectedTool[] = [];
  try {
    const agents = await discoverAgents(source);
    discovered = await Promise.all(
      agents.map(async (d) => {
        let sessionCount = 0;
        try {
          sessionCount = await countTranscriptFiles(source, d.rootRel);
        } catch (e) {
          console.error(`[discover] ${d.rootRel} count failed:`, e);
        }
        return {
          id: d.id,
          name: d.name,
          icon: "✨",
          color: "#a78bfa",
          description: `Discovered agent (${d.kind}) — ${d.rootRel}`,
          sessionCount,
          detected: true,
        };
      })
    );
  } catch (e) {
    console.error("[discover] heuristic discovery failed:", e);
  }

  return [...known.filter((t) => t.detected), ...discovered];
}
