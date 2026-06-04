import fs from "fs";
import path from "path";
import os from "os";
import type { ClaudeMessage, ContentBlock, ConversationMessage, ToolCall, ToolSession } from "./types";

function getClaudeRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export function listClaudeSessionsAll(): ToolSession[] {
  const root = getClaudeRoot();
  if (!fs.existsSync(root)) return [];

  const result: ToolSession[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const projectName = entry.name.replace(/^-/, "").replace(/-/g, "/").replace(/^home\/[^/]+\//, "~/");

    const jsonlFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    for (const f of jsonlFiles) {
      const filePath = path.join(dir, f);
      try {
        const stat = fs.statSync(filePath);
        const id = f.replace(".jsonl", "");
        const title = extractClaudeTitle(filePath);
        const msgCount = countClaudeMessages(filePath);
        result.push({
          id,
          title,
          createdAt: stat.birthtime.toISOString(),
          messageCount: msgCount,
          project: projectName,
          projectPath: entry.name,
        });
      } catch {}
    }
  }

  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function extractClaudeTitle(filePath: string): string {
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const obj: ClaudeMessage = JSON.parse(line);
      if (obj.type === "ai-title") return (obj.aiTitle as string) || "Untitled";
    }
  } catch {}
  return "Untitled";
}

function countClaudeMessages(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

export function readClaudeSession(projectPath: string, sessionId: string): ConversationMessage[] {
  const filePath = path.join(getClaudeRoot(), projectPath, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];

  const messages: ConversationMessage[] = [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj: ClaudeMessage = JSON.parse(line);
      if (obj.type === "user" && obj.message) {
        const msg = obj.message as { role?: string; content?: string | ContentBlock[] };
        const text = extractTextFromContent(msg.content);
        messages.push({
          id: obj.uuid || `user-${messages.length}`,
          role: "user",
          content: text,
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
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text || "")
    .join("\n");
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
    if (block.type === "text" && block.text) {
      text += block.text + "\n";
    } else if (block.type === "thinking" && block.thinking) {
      thinking = (thinking || "") + block.thinking + "\n";
    } else if (block.type === "tool_use") {
      toolCalls.push({
        name: block.name || "unknown",
        input: (block.input as Record<string, unknown>) || {},
      });
    }
  }

  return { text: text.trimEnd(), thinking: thinking?.trimEnd(), toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}
