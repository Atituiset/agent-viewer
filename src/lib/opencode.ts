import { opencodeSessionFromDb } from "agent-session-format";
import { withSqliteDb, type DbLike } from "../../electron/sqlite";
import type { FileSource } from "../../electron/fs-source/types";
import type { ConversationMessage, ToolSession } from "./types";
import { nirToConversation } from "./nir-map";

const DB_REL = ".local/share/opencode/opencode.db";

async function withDb<T>(source: FileSource, fn: (db: DbLike) => T | Promise<T>): Promise<T> {
  return withSqliteDb(source, DB_REL, fn);
}

/** 非法/缺失时间戳兜底：NaN 会让 toISOString 抛 RangeError，一行脏数据不该炸掉整个列表。 */
function toIso(ts: unknown): string {
  const d = new Date(typeof ts === "number" ? ts : 0);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/** 列表是轻量元数据投影（一条 SELECT，不读 message/part 表）——detect 会调它数会话，
 *  整库映射（opencodeSessionsFromDb 逐会话读消息）留给 read，避免 GB 级库拖垮卡片加载。 */
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
    // 单会话查询（v0.2.0 起）：只读目标会话的 message/part 行，
    // 远程桥（SSH/WSL querySqlite）下不再为别的会话付 RTT。
    const nir = await opencodeSessionFromDb(db, sessionId, { source: "opencode" });
    return nir ? nirToConversation(nir, "opencode") : [];
  });
}
