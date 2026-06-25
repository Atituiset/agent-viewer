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

    for (const f of await source.readDir(dirRel)) {
      if (!f.name.endsWith(".jsonl")) continue;
      const fileRel = join(dirRel, f.name);
      try {
        const stat = await source.stat(fileRel);
        const content = await source.readFile(fileRel);
        result.push({
          id: f.name.replace(".jsonl", ""),
          title: extractClaudeTitle(content),
          createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
          messageCount: countClaudeMessages(content),
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

function countClaudeMessages(content: string): number {
  return content.split("\n").filter((l) => l.trim()).length;
}

export async function readClaudeSession(
  source: FileSource,
  projectPath: string,
  sessionId: string
): Promise<ConversationMessage[]> {
  const fileRel = join(ROOT, projectPath, `${sessionId}.jsonl`);
  if (!(await source.exists(fileRel))) return [];

  const messages: ConversationMessage[] = [];
  const lines = (await source.readFile(fileRel)).split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj: ClaudeMessage = JSON.parse(line);
      if (obj.type === "user" && obj.message) {
        const msg = obj.message as { role?: string; content?: string | ContentBlock[] };
        messages.push({
          id: obj.uuid || `user-${messages.length}`,
          role: "user",
          content: extractTextFromContent(msg.content),
          timestamp: obj.timestamp || new Date().toISOString(),
          source: "claude",
        });
      } else if (obj.type === "assistant" && obj.message) {
        const msg = obj.message as { role?: string; content?: string | ContentBlock[] };
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

  return messages;
}

function extractTextFromContent(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
}

function extractAssistantContent(
  content: string | ContentBlock[] | undefined
): { text: string; thinking?: string; toolCalls?: ToolCall[] } {
  if (!content) return { text: "" };
  if (typeof content === "string") return { text: content };
  let text = "";
  let thinking: string | undefined;
  const toolCalls: ToolCall[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) text += block.text + "\n";
    else if (block.type === "thinking" && block.thinking) thinking = (thinking || "") + block.thinking + "\n";
    else if (block.type === "tool_use")
      toolCalls.push({ name: block.name || "unknown", input: (block.input as Record<string, unknown>) || {} });
  }
  return { text: text.trimEnd(), thinking: thinking?.trimEnd(), toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}
