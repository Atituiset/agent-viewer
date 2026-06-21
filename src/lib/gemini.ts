import fs from "fs";
import path from "path";
import os from "os";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";

interface GeminiToolCall {
  name?: string;
  args?: Record<string, unknown>;
}

function getGeminiRoot(): string {
  return path.join(os.homedir(), ".gemini", "antigravity-cli");
}

export function listGeminiSessions(): ToolSession[] {
  const root = getGeminiRoot();
  const historyPath = path.join(root, "history.jsonl");
  if (!fs.existsSync(historyPath)) return [];

  const sessions = new Map<string, ToolSession>();

  try {
    const lines = fs.readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const id = entry.conversationId as string;
        if (!id) continue;
        const existing = sessions.get(id);
        const title = cleanTitle((entry.display as string) || "Untitled");
        const createdAt = new Date(entry.timestamp as number).toISOString();
        const directory = (entry.workspace as string) || "";

        if (!existing) {
          sessions.set(id, { id, title, createdAt, messageCount: 1, directory });
        } else {
          existing.messageCount += 1;
          if (createdAt < existing.createdAt) {
            existing.createdAt = createdAt;
            if (title !== "Untitled") existing.title = title;
          }
        }
      } catch {}
    }
  } catch {}

  return Array.from(sessions.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readGeminiSession(conversationId: string): ConversationMessage[] {
  const root = getGeminiRoot();
  const transcriptPath = path.join(
    root,
    "brain",
    conversationId,
    ".system_generated",
    "logs",
    "transcript.jsonl"
  );
  if (!fs.existsSync(transcriptPath)) return [];

  const result: ConversationMessage[] = [];
  let index = 0;

  try {
    const lines = fs.readFileSync(transcriptPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const source = entry.source as string;
        const type = entry.type as string;
        const content = normalizeGeminiContent(entry.content);
        const timestamp = entry.created_at
          ? new Date(entry.created_at as string).toISOString()
          : new Date().toISOString();
        const id = `gemini-${index++}`;

        if (source === "USER_EXPLICIT" && type === "USER_INPUT") {
          const cleaned = extractUserRequest(content);
          if (cleaned) {
            result.push({ id, role: "user", content: cleaned, timestamp, source: "gemini" });
          }
        } else if (source === "MODEL" && type === "PLANNER_RESPONSE") {
          const toolCalls: ToolCall[] = ((entry.tool_calls as GeminiToolCall[]) || []).map((tc) => ({
            name: tc.name || "unknown",
            input: tc.args || {},
          }));
          if (content || toolCalls.length > 0) {
            result.push({
              id,
              role: "assistant",
              content,
              timestamp,
              toolCalls: toolCalls.length ? toolCalls : undefined,
              source: "gemini",
            });
          }
        } else if (
          source === "MODEL" &&
          ["LIST_DIRECTORY", "VIEW_FILE", "CODE_ACTION", "RUN_COMMAND"].includes(type)
        ) {
          if (content) {
            result.push({ id, role: "tool", content, timestamp, source: "gemini" });
          }
        }
        // SYSTEM + CONVERSATION_HISTORY is intentionally skipped.
      } catch {}
    }
  } catch {}

  return result;
}

function normalizeGeminiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === "string" ? c : JSON.stringify(c))).join("\n");
  }
  return content ? JSON.stringify(content) : "";
}

function extractUserRequest(content: string): string {
  if (!content) return "";
  const match = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  return match ? match[1].trim() : content.trim();
}

function cleanTitle(text: string, maxLength = 80): string {
  if (!text || text === "Untitled") return "Untitled";
  const firstLine = text.split("\n").find((l) => l.trim()) || "";
  const cleaned = firstLine
    .replace(/\s+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .trim();
  if (!cleaned) return "Untitled";
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).trimEnd() + "…";
}
