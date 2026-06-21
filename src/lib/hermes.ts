import fs from "fs";
import path from "path";
import os from "os";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";

interface HermesSessionEntry {
  session_id?: string;
  display_name?: string;
  created_at?: string;
  origin?: { chat_id?: string };
}

interface HermesMessage {
  role?: string;
  content?: unknown;
  tool_calls?: HermesToolCall[];
}

interface HermesToolCall {
  function?: { name?: string; arguments?: string };
  name?: string;
  args?: Record<string, unknown>;
}

function getHermesRoot(): string {
  return path.join(os.homedir(), ".hermes", "sessions");
}

export function listHermesSessions(): ToolSession[] {
  const root = getHermesRoot();
  if (!fs.existsSync(root)) return [];

  const sessionsPath = path.join(root, "sessions.json");
  if (!fs.existsSync(sessionsPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(sessionsPath, "utf-8")) as Record<string, unknown>;
    return Object.values(data)
      .map((entry) => {
        const e = entry as HermesSessionEntry;
        const id = e.session_id || "";
        const fallbackTitle = extractHermesTitle(id) || `Hermes ${id}`;
        return {
          id,
          title: e.display_name || fallbackTitle,
          createdAt: e.created_at || new Date().toISOString(),
          messageCount: countHermesMessages(id),
          directory: e.origin?.chat_id || "",
        };
      })
      .filter((s) => s.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

function extractHermesTitle(sessionId: string): string | null {
  const messages = readHermesSession(sessionId);
  const firstUser = messages.find((m) => m.role === "user");
  return firstUser ? cleanTitle(firstUser.content) : null;
}

function countHermesMessages(sessionId: string): number {
  const latest = findLatestHermesDump(sessionId);
  if (!latest) return 0;

  try {
    const data = JSON.parse(fs.readFileSync(latest, "utf-8")) as Record<string, unknown>;
    const request = (data.request as Record<string, unknown>) || {};
    const body = (request.body as Record<string, unknown>) || {};
    return ((body.messages as HermesMessage[]) || []).length;
  } catch {
    return 0;
  }
}

export function readHermesSession(sessionId: string): ConversationMessage[] {
  const latest = findLatestHermesDump(sessionId);
  if (!latest) return [];

  try {
    const data = JSON.parse(fs.readFileSync(latest, "utf-8")) as Record<string, unknown>;
    const request = (data.request as Record<string, unknown>) || {};
    const body = (request.body as Record<string, unknown>) || {};
    const messages = (body.messages as HermesMessage[]) || [];
    const result: ConversationMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role || "";
      const content = normalizeHermesContent(msg.content);
      const timestamp = (data.timestamp as string) || new Date().toISOString();

      if (role === "system") {
        result.push({ id: `hermes-${i}`, role: "system", content, timestamp, source: "hermes" });
      } else if (role === "user") {
        result.push({ id: `hermes-${i}`, role: "user", content, timestamp, source: "hermes" });
      } else if (role === "assistant") {
        const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc) => ({
          name: tc.function?.name || tc.name || "unknown",
          input: (() => {
            try {
              return JSON.parse(tc.function?.arguments || "{}");
            } catch {
              return tc.args || {};
            }
          })(),
        }));
        result.push({
          id: `hermes-${i}`,
          role: "assistant",
          content,
          timestamp,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          source: "hermes",
        });
      } else if (role === "tool") {
        result.push({ id: `hermes-${i}`, role: "tool", content, timestamp, source: "hermes" });
      }
    }

    return result;
  } catch {
    return [];
  }
}

function findLatestHermesDump(sessionId: string): string | null {
  const root = getHermesRoot();
  if (!fs.existsSync(root)) return null;

  const files = fs
    .readdirSync(root)
    .filter((f) => f.startsWith(`request_dump_${sessionId}_`) && f.endsWith(".json"))
    .sort();

  return files.length > 0 ? path.join(root, files[files.length - 1]) : null;
}

function normalizeHermesContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (part.text) return part.text;
          return JSON.stringify(part);
        }
        return "";
      })
      .join("\n");
  }
  return content ? JSON.stringify(content) : "";
}

function cleanTitle(text: string, maxLength = 80): string {
  if (!text) return "";
  const firstLine = text.split("\n").find((l) => l.trim()) || "";
  const cleaned = firstLine
    .replace(/\s+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).trimEnd() + "…";
}
