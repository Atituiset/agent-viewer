import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ClaudeMessage, ContentBlock, ConversationMessage, ToolCall, ToolSession } from "./types";

const ROOT = ".claude/projects";

export async function listClaudeSessionsAll(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const result: ToolSession[] = [];
  const entries = await source.readDir(ROOT);

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const dirRel = join(ROOT, entry.name);
    const projectName = entry.name.replace(/^-/, "").replace(/-/g, "/").replace(/^home\/[^/]+\//, "~/");

    let files;
    try {
      files = await source.readDir(dirRel);
    } catch {
      continue; // 单个 project 目录不可读不该归零整个工具
    }
    for (const f of files) {
      if (!f.name.endsWith(".jsonl")) continue;
      const fileRel = join(dirRel, f.name);
      try {
        const stat = await source.stat(fileRel);
        // 只读前 8KB 取标题，行数用 lineCount——不把整个 jsonl 拉回来。
        const head = await source.readHead(fileRel, 8192);
        result.push({
          id: f.name.replace(".jsonl", ""),
          title: extractClaudeTitle(head),
          createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
          messageCount: await source.lineCount(fileRel),
          project: projectName,
          projectPath: entry.name,
        });
      } catch {}
    }
  }

  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

  const messages: ConversationMessage[] = [];
  const toolResults: Array<{ toolUseId: string; output: string }> = [];
  const lines = (await source.readFile(fileRel)).split("\n");

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

  // Pair tool_results with the preceding tool_use so outputs show inline.
  if (toolResults.length > 0) {
    for (const result of toolResults) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg.toolCalls) continue;
        const match = msg.toolCalls.find((tc) => tc.id === result.toolUseId);
        if (match) {
          match.output = result.output;
          break;
        }
      }
    }
  }

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
