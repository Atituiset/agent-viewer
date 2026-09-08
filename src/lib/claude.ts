import type { DirEntry, FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ClaudeMessage, ContentBlock, ConversationMessage, ToolCall, ToolSession } from "./types";
import { pairToolOutputInMessages } from "./tool-pairing";

const ROOT = ".claude/projects";

/** detect 卡片用的轻量计数：readDir 数各 project 目录下的 .jsonl 文件名，不 stat/不读文件。
 *  旧口径是 listSessions().length——SSH 下等于为卡片上的数字把所有文件 stat+readHead+lineCount 拉一遍。 */
export async function countClaudeSessions(source: FileSource): Promise<number> {
  if (!(await source.exists(ROOT))) return 0;
  let entries: DirEntry[];
  try {
    entries = await source.readDir(ROOT);
  } catch {
    return 0;
  }
  // project 目录间并行。
  const counts = await Promise.all(
    entries
      .filter((e) => e.isDirectory)
      .map((e) => source.readDir(join(ROOT, e.name)).catch(() => [] as DirEntry[]))
  );
  return counts.reduce((n, files) => n + files.filter((f) => f.name.endsWith(".jsonl")).length, 0);
}

export async function listClaudeSessionsAll(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const entries = await source.readDir(ROOT);

  // 全并行：项目目录间并行、目录内文件间并行、单文件的 stat/head/lineCount 也同时发起。
  // SSH 场景下旧实现是 3×RTT×文件数串行，这里是几批并发。
  const perDir = await Promise.all(
    entries
      .filter((e) => e.isDirectory)
      .map(async (entry): Promise<ToolSession[]> => {
        const dirRel = join(ROOT, entry.name);
        const projectName = entry.name.replace(/^-/, "").replace(/-/g, "/").replace(/^home\/[^/]+\//, "~/");
        let files;
        try {
          files = await source.readDir(dirRel);
        } catch {
          return []; // 单个 project 目录不可读不该归零整个工具
        }
        const sessions = await Promise.all(
          files
            .filter((f) => f.name.endsWith(".jsonl"))
            .map(async (f): Promise<ToolSession | null> => {
              const fileRel = join(dirRel, f.name);
              try {
                const [stat, head, messageCount] = await Promise.all([
                  source.stat(fileRel),
                  // 只读前 8KB 取标题；行数走流式 lineCount——都不整文件拉回。
                  source.readHead(fileRel, 8192),
                  source.lineCount(fileRel),
                ]);
                return {
                  id: f.name.replace(".jsonl", ""),
                  title: extractClaudeTitle(head),
                  createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
                  messageCount,
                  project: projectName,
                  projectPath: entry.name,
                };
              } catch {
                return null;
              }
            })
        );
        return sessions.filter((s): s is ToolSession => !!s);
      })
  );

  return perDir
    .flat()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function extractClaudeTitle(content: string): string {
  try {
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const obj: ClaudeMessage = JSON.parse(line);
      if (obj.type === "ai-title") return (obj.aiTitle as string) || "Untitled";
    }
  } catch {}
  return "Untitled";
}

/** 注意参数顺序：(source, projectPath, sessionId) —— projectPath 在 sessionId 前，与其他解析器不同。 */
export async function readClaudeSession(
  source: FileSource,
  projectPath: string,
  sessionId: string
): Promise<ConversationMessage[]> {
  const fileRel = join(ROOT, projectPath, `${sessionId}.jsonl`);
  if (!(await source.exists(fileRel))) return [];

  const messages = parseClaudeTranscript(await source.readFile(fileRel));

  // Task 工具 spawn 的 subagent 转录在 <sessionId>/subagents/agent-<id>.jsonl，
  // 行格式与主文件相同；agentId 从文件名取，显示名从同名 .meta.json 取。
  const subagentsDir = join(ROOT, projectPath, sessionId, "subagents");
  if (await source.exists(subagentsDir)) {
    let entries: DirEntry[];
    try {
      entries = await source.readDir(subagentsDir);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const match = /^agent-(.+)\.jsonl$/.exec(entry.name);
      if (!match) continue;
      const agentId = match[1];
      try {
        const agentLabel = await readAgentLabel(source, join(subagentsDir, `agent-${agentId}.meta.json`), agentId);
        const sub = parseClaudeTranscript(await source.readFile(join(subagentsDir, entry.name)));
        for (const msg of sub) {
          msg.agent = agentId;
          msg.agentLabel = agentLabel;
        }
        messages.push(...sub);
      } catch {} // 单个 subagent 文件坏了不影响主会话
    }
    messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  return messages;
}

async function readAgentLabel(source: FileSource, metaRel: string, agentId: string): Promise<string> {
  try {
    const meta = JSON.parse(await source.readFile(metaRel)) as { agentType?: unknown; description?: unknown };
    const type = typeof meta.agentType === "string" ? meta.agentType : "";
    const desc = typeof meta.description === "string" ? meta.description : "";
    if (type && desc) return `${type} · ${desc}`;
    if (type) return type;
  } catch {}
  return `agent-${agentId}`;
}

/** 解析单个 jsonl 转录文件（主会话与 subagent 转录格式一致），并配对 tool_result。
 *  纯函数：供 claude 本体与启发式发现的未知 agent（claude 形转录）共用。 */
export function parseClaudeTranscript(content: string): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  const toolResults: Array<{ toolUseId: string; output: string }> = [];
  const lines = content.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj: ClaudeMessage = JSON.parse(line);
      if (obj.type === "user" && obj.message) {
        const msg = obj.message as { role?: string; content?: string | ContentBlock[] | ContentBlock };
        const { text, toolResults: results } = extractUserContent(msg.content);
        if (results) toolResults.push(...results);
        messages.push({
          id: obj.uuid || `user-${messages.length}`,
          role: "user",
          content: text,
          timestamp: obj.timestamp || new Date().toISOString(),
          source: "claude",
        });
      } else if (obj.type === "assistant" && obj.message) {
        const msg = obj.message as { role?: string; content?: string | ContentBlock[] | ContentBlock };
        const { text, thinking, toolCalls } = extractAssistantContent(msg.content);
        messages.push({
          id: obj.uuid || `assistant-${messages.length}`,
          role: "assistant",
          content: text,
          timestamp: obj.timestamp || new Date().toISOString(),
          thinking,
          toolCalls,
          source: "claude",
        });
      }
    } catch {}
  }

  // 把 tool_result 按 tool_use_id 配回之前的 tool_use，输出内联显示（统一 helper，见 tool-pairing.ts）。
  for (const r of toolResults) pairToolOutputInMessages(messages, r.output, r.toolUseId);

  return messages;
}

function asContentBlocks(content: string | ContentBlock[] | ContentBlock | undefined): ContentBlock[] {
  if (!content) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content;
  return [content];
}

function extractTextFromContent(content: string | ContentBlock[] | ContentBlock | undefined): string {
  return asContentBlocks(content)
    .filter((b) => b.type === "text")
    .map((b) => b.text || "")
    .join("\n")
    .trim();
}

function extractUserContent(
  content: string | ContentBlock[] | ContentBlock | undefined
): { text: string; toolResults?: Array<{ toolUseId: string; output: string }> } {
  const blocks = asContentBlocks(content);
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text || "")
    .join("\n")
    .trim();

  const toolResults = blocks
    .filter((b) => b.type === "tool_result")
    .map((b) => ({
      toolUseId: b.tool_use_id || "",
      output: typeof b.content === "string" ? b.content : extractTextFromContent(b.content),
    }))
    .filter((r) => r.toolUseId);

  return { text, toolResults: toolResults.length > 0 ? toolResults : undefined };
}

function extractAssistantContent(
  content: string | ContentBlock[] | ContentBlock | undefined
): { text: string; thinking?: string; toolCalls?: ToolCall[] } {
  const blocks = asContentBlocks(content);
  let text = "";
  let thinking: string | undefined;
  const toolCalls: ToolCall[] = [];

  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      text += block.text + "\n";
    } else if (block.type === "thinking" && block.thinking) {
      thinking = (thinking || "") + block.thinking + "\n";
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name || "unknown",
        input: (block.input as Record<string, unknown>) || {},
      });
    }
  }

  return {
    text: text.trim(),
    thinking: thinking?.trim(),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
