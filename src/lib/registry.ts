import type { FileSource } from "../../electron/fs-source/types";
import type { ConversationMessage, DetectedTool, ToolSession } from "./types";
import { listClaudeSessionsAll, readClaudeSession } from "./claude";
import { listCodexSessions, readCodexSession } from "./codex";
import { listOpenCodeSessions, readOpenCodeSession } from "./opencode";
import { listGeminiSessions, readGeminiSession } from "./gemini";
import { listDeepSeekSessions, readDeepSeekSession } from "./deepseek";
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

/** 检测所有已安装的工具并统计会话数（全并行）。
 *  已知 agent 走固定 detectPaths；另做一轮启发式发现，接住不在名单里、
 *  但遵循 ~/.<agent>/sessions|projects|history 布局的 agent（内部 CLI、新 agent）。
 *  两条腿互不干扰：发现失败只影响发现条目。 */
export async function detectTools(source: FileSource): Promise<DetectedTool[]> {
  const known = await Promise.all(
    TOOLS.map(async (tool): Promise<DetectedTool> => {
      const detected = await Promise.any(
        tool.detectPaths.map((p) =>
          source.exists(p).then((ok) => {
            if (!ok) throw new Error("no");
            return p;
          })
        )
      )
        .then(() => true)
        .catch(() => false);
      let sessionCount = 0;
      if (detected) {
        try {
          sessionCount = (await tool.listSessions(source)).length;
        } catch (e) {
          console.error(`[detect] ${tool.id} listSessions failed:`, e);
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
          sessionCount = (await listGenericSessions(source, d.rootRel)).length;
        } catch (e) {
          console.error(`[discover] ${d.rootRel} listSessions failed:`, e);
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
