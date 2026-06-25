import { join } from "../../electron/fs-source/util";
import { openDbFromBuffer } from "../../electron/sqlite";
import type { FileSource } from "../../electron/fs-source/types";
import type { OpenCodePart, ConversationMessage, ToolCall, ToolSession } from "./types";

const DB_REL = ".local/share/opencode/opencode.db";

async function withDb<T>(source: FileSource, fn: (db: import("better-sqlite3").Database) => T): Promise<T> {
  const buf = await source.readFileBuffer(DB_REL);
  const { db, cleanup } = openDbFromBuffer(buf);
  try {
    return fn(db);
  } finally {
    cleanup();
  }
}

export async function listOpenCodeSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(DB_REL))) return [];
  return withDb(source, (db) => {
    const rows = db.prepare(`SELECT id, title, directory, model, cost, tokens_input, tokens_output, time_created FROM session ORDER BY time_created DESC`).all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      title: (r.title as string) || "Untitled",
      directory: (r.directory as string) || "",
      model: (() => { try { return JSON.parse(r.model as string).id; } catch { return r.model as string; } })(),
      cost: (r.cost as number) || 0,
      tokensInput: (r.tokens_input as number) || 0,
      tokensOutput: (r.tokens_output as number) || 0,
      createdAt: new Date(r.time_created as number).toISOString(),
      messageCount: 0,
    }));
  });
}

export async function readOpenCodeSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (!(await source.exists(DB_REL))) return [];
  return withDb(source, (db) => {
    const messages = db.prepare(`SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created`).all(sessionId) as { id: string; data: string; time_created: number }[];
    const result: ConversationMessage[] = [];
    for (const msg of messages) {
      const msgData = JSON.parse(msg.data) as { role: string };
      const parts = db.prepare(`SELECT id, data FROM part WHERE message_id = ? ORDER BY time_created`).all(msg.id) as { id: string; data: string }[];
      const parsedParts: OpenCodePart[] = parts.map((p) => JSON.parse(p.data) as OpenCodePart);
      const role = msgData.role;
      let content = "";
      const toolCalls: ToolCall[] = [];
      for (const part of parsedParts) {
        if (part.type === "text" && part.text) content += part.text + "\n";
        else if (part.type === "tool") toolCalls.push({ name: part.tool || "unknown", input: part.state?.input || {}, output: part.state?.output, status: part.state?.status });
      }
      if (content || toolCalls.length) {
        result.push({ id: msg.id, role: role as "user" | "assistant" | "system", content: content.trimEnd(), timestamp: new Date(msg.time_created).toISOString(), toolCalls: toolCalls.length ? toolCalls : undefined, source: "opencode" });
      }
    }
    return result;
  });
}
