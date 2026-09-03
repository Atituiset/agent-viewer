import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";
import { pairToolOutputInMessages } from "./tool-pairing";

interface GeminiToolCall { name?: string; args?: Record<string, unknown> }
const ROOT = ".gemini/antigravity-cli";

export async function listGeminiSessions(source: FileSource): Promise<ToolSession[]> {
  const historyPath = join(ROOT, "history.jsonl");
  if (!(await source.exists(historyPath))) return [];
  const sessions = new Map<string, ToolSession>();
  try {
    for (const line of (await source.readFile(historyPath)).split("\n").filter(Boolean)) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const id = entry.conversationId as string;
        if (!id) continue;
        const title = cleanTitle((entry.display as string) || "Untitled");
        const createdAt = new Date(entry.timestamp as number).toISOString();
        const directory = (entry.workspace as string) || "";
        const existing = sessions.get(id);
        if (!existing) sessions.set(id, { id, title, createdAt, messageCount: 1, directory });
        else {
          existing.messageCount += 1;
          if (createdAt < existing.createdAt) { existing.createdAt = createdAt; if (title !== "Untitled") existing.title = title; }
        }
      } catch {}
    }
  } catch {}
  return Array.from(sessions.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readGeminiSession(source: FileSource, conversationId: string): Promise<ConversationMessage[]> {
  const transcriptPath = join(ROOT, "brain", conversationId, ".system_generated", "logs", "transcript.jsonl");
  if (!(await source.exists(transcriptPath))) return [];
  const result: ConversationMessage[] = [];
  let index = 0;
  try {
    for (const line of (await source.readFile(transcriptPath)).split("\n").filter(Boolean)) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const s = entry.source as string;
        const type = entry.type as string;
        const content = normalizeGeminiContent(entry.content);
        const timestamp = entry.created_at ? new Date(entry.created_at as string).toISOString() : new Date().toISOString();
        const id = `gemini-${index++}`;
        if (s === "USER_EXPLICIT" && type === "USER_INPUT") {
          const cleaned = extractUserRequest(content);
          if (cleaned) result.push({ id, role: "user", content: cleaned, timestamp, source: "gemini" });
        } else if (s === "MODEL" && type === "PLANNER_RESPONSE") {
          const toolCalls: ToolCall[] = ((entry.tool_calls as GeminiToolCall[]) || []).map((tc) => ({ name: tc.name || "unknown", input: tc.args || {} }));
          if (content || toolCalls.length) result.push({ id, role: "assistant", content, timestamp, toolCalls: toolCalls.length ? toolCalls : undefined, source: "gemini" });
        } else if (s === "MODEL" && ["LIST_DIRECTORY", "VIEW_FILE", "CODE_ACTION", "RUN_COMMAND"].includes(type)) {
          // 工具结果配回最近未配对的 toolCall；配不到才独立成泡。
          if (content && !pairToolOutputInMessages(result, content)) {
            result.push({ id, role: "tool", content, timestamp, source: "gemini" });
          }
        }
      } catch {}
    }
  } catch {}
  return result;
}

function normalizeGeminiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : JSON.stringify(c))).join("\n");
  return content ? JSON.stringify(content) : "";
}
function extractUserRequest(content: string): string {
  if (!content) return "";
  const m = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  return m ? m[1].trim() : content.trim();
}
function cleanTitle(text: string, maxLength = 80): string {
  if (!text || text === "Untitled") return "Untitled";
  const firstLine = text.split("\n").find((l) => l.trim()) || "";
  const cleaned = firstLine.replace(/\s+/g, " ").replace(/<[^>]+>/g, " ").trim();
  if (!cleaned) return "Untitled";
  return cleaned.length <= maxLength ? cleaned : cleaned.slice(0, maxLength).trimEnd() + "…";
}
