import type { FileSource } from "../../electron/fs-source/types";
import type { ConversationMessage, DetectedTool, ToolSession } from "./types";
import { listClaudeSessionsAll, readClaudeSession } from "./claude";
import { listCodexSessions, readCodexSession } from "./codex";
import { listOpenCodeSessions, readOpenCodeSession } from "./opencode";
import { listGeminiSessions, readGeminiSession } from "./gemini";
import { listDeepSeekSessions, readDeepSeekSession } from "./deepseek";
import { listHermesSessions, readHermesSession } from "./hermes";

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
];

export function getTool(toolId: string): ToolEntry {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) throw new Error("unknown tool: " + toolId);
  return tool;
}

/** 检测所有已安装的工具并统计会话数（全并行）。 */
export async function detectTools(source: FileSource): Promise<DetectedTool[]> {
  const out = await Promise.all(
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
        } catch {}
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
  return out.filter((t) => t.detected);
}
