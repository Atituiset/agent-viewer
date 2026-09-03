import { withSqliteDb, type DbLike } from "../../electron/sqlite";
import type { FileSource } from "../../electron/fs-source/types";
import type { OpenCodePart, ConversationMessage, ToolCall, ToolSession } from "./types";

const DB_REL = ".local/share/opencode/opencode.db";

async function withDb<T>(source: FileSource, fn: (db: DbLike) => T | Promise<T>): Promise<T> {
  return withSqliteDb(source, DB_REL, fn);
}

/** 非法/缺失时间戳兜底：NaN 会让 toISOString 抛 RangeError，一行脏数据不该炸掉整个会话。 */
function toIso(ts: unknown): string {
  const d = new Date(typeof ts === "number" ? ts : 0);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/** 单行 JSON 容错：解析失败返回 null，调用方跳过该条记录。 */
function tryParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function listOpenCodeSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(DB_REL))) return [];
  return withDb(source, async (db) => {
    const rows = (await db.prepare(`SELECT id, title, directory, model, cost, tokens_input, tokens_output, time_created FROM session ORDER BY time_created DESC`).all()) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      title: (r.title as string) || "Untitled",
      directory: (r.directory as string) || "",
      model: (() => { try { return JSON.parse(r.model as string).id; } catch { return r.model as string; } })(),
      cost: (r.cost as number) || 0,
      tokensInput: (r.tokens_input as number) || 0,
      tokensOutput: (r.tokens_output as number) || 0,
      createdAt: toIso(r.time_created),
      messageCount: 0,
    }));
  });
}

export async function readOpenCodeSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (!(await source.exists(DB_REL))) return [];
  return withDb(source, async (db) => {
    const messages = (await db.prepare(`SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created`).all(sessionId)) as { id: string; data: string; time_created: number }[];
    const result: ConversationMessage[] = [];
    let skipped = 0;
    for (const msg of messages) {
      // 逐条容错：一条坏记录（脏 JSON / 非法时间戳）跳过，不再让整个会话读取失败——
      // 之前任何 JSON.parse 异常都会冒进 withSqliteDb 的回退分支，把整库当「不可用」处理。
      const msgData = tryParse<{ role?: string }>(msg.data);
      if (!msgData) { skipped++; continue; }
      const parts = (await db.prepare(`SELECT id, data FROM part WHERE message_id = ? ORDER BY time_created`).all(msg.id)) as { id: string; data: string }[];
      const parsedParts: OpenCodePart[] = [];
      for (const p of parts) {
        const part = tryParse<OpenCodePart>(p.data);
        if (part) parsedParts.push(part); else skipped++;
      }
      const role = msgData.role;
      let content = "";
      let thinking = "";
      const toolCalls: ToolCall[] = [];
      for (const part of parsedParts) {
        if (part.type === "text" && part.text) content += part.text + "\n";
        else if (part.type === "reasoning" && part.text) thinking += part.text + "\n";
        else if (part.type === "tool") toolCalls.push({ name: part.tool || "unknown", input: part.state?.input || {}, output: part.state?.output, status: part.state?.status });
      }
      if (content || toolCalls.length || thinking) {
        result.push({ id: msg.id, role: role as "user" | "assistant" | "system", content: content.trimEnd(), timestamp: toIso(msg.time_created), thinking: thinking.trimEnd() || undefined, toolCalls: toolCalls.length ? toolCalls : undefined, source: "opencode" });
      }
    }
    if (skipped) console.error(`[opencode] skipped ${skipped} corrupt record(s) in session ${sessionId}`);
    return result;
  });
}
