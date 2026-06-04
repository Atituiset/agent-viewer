import path from "path";
import os from "os";
import Database from "better-sqlite3";
import fs from "fs";
import type { OpenCodeSession, OpenCodePart, ConversationMessage, ToolCall, ToolSession } from "./types";

function getOpenCodeDbPath(): string {
  return path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
}

function openDb(): Database.Database {
  const dbPath = getOpenCodeDbPath();
  const tmpPath = path.join("/tmp", `opencode_viewer_${Date.now()}.db`);

  if (!fs.existsSync(dbPath)) throw new Error("OpenCode database not found");

  fs.copyFileSync(dbPath, tmpPath);

  const db = new Database(tmpPath, { readonly: true });
  db.pragma("journal_mode = WAL");
  db.pragma("wal_checkpoint(TRUNCATE)");
  return db;
}

export function listOpenCodeSessions(): ToolSession[] {
  const db = openDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, project_id, title, directory, model, cost,
                tokens_input, tokens_output, tokens_reasoning,
                time_created, time_updated, agent
         FROM session ORDER BY time_created DESC`
      )
      .all() as Record<string, unknown>[];

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
  } finally {
    db.close();
  }
}

export function readOpenCodeSession(sessionId: string): ConversationMessage[] {
  const db = openDb();
  try {
    const messages = db
      .prepare(
        `SELECT id, session_id, data, time_created
         FROM message WHERE session_id = ? ORDER BY time_created`
      )
      .all(sessionId) as { id: string; session_id: string; data: string; time_created: number }[];

    const result: ConversationMessage[] = [];

    for (const msg of messages) {
      const msgData = JSON.parse(msg.data) as { role: string; [k: string]: unknown };
      const parts = db
        .prepare(`SELECT id, data FROM part WHERE message_id = ? ORDER BY time_created`)
        .all(msg.id) as { id: string; data: string }[];

      const parsedParts: OpenCodePart[] = parts.map((p) => JSON.parse(p.data) as OpenCodePart);

      const role = msgData.role as string;
      let content = "";
      let thinking: string | undefined;
      const toolCalls: ToolCall[] = [];

      for (const part of parsedParts) {
        if (part.type === "text" && part.text) {
          content += part.text + "\n";
        } else if (part.type === "tool") {
          toolCalls.push({
            name: part.tool || "unknown",
            input: part.state?.input || {},
            output: part.state?.output,
            status: part.state?.status,
          });
        }
      }

      if (content || toolCalls.length > 0) {
        result.push({
          id: msg.id,
          role: role as "user" | "assistant" | "system",
          content: content.trimEnd(),
          timestamp: new Date(msg.time_created).toISOString(),
          thinking,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          source: "opencode",
        });
      }
    }

    return result;
  } finally {
    db.close();
  }
}

export function getOpenCodeSessionMeta(sessionId: string): OpenCodeSession | null {
  const db = openDb();
  try {
    const row = db
      .prepare(
        `SELECT id, project_id, title, directory, model, cost,
                tokens_input, tokens_output, tokens_reasoning,
                time_created, time_updated, agent
         FROM session WHERE id = ?`
      )
      .get(sessionId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: (row.title as string) || "Untitled",
      directory: (row.directory as string) || "",
      model: row.model as string,
      cost: (row.cost as number) || 0,
      tokensInput: (row.tokens_input as number) || 0,
      tokensOutput: (row.tokens_output as number) || 0,
      tokensReasoning: (row.tokens_reasoning as number) || 0,
      timeCreated: row.time_created as number,
      timeUpdated: row.time_updated as number,
      agent: (row.agent as string) || null,
    };
  } finally {
    db.close();
  }
}
