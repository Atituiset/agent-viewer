import { hermesSessionsFromDb, parseHermesDump } from "agent-session-format";
import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import { withSqliteDb } from "../../electron/sqlite";
import type { ConversationMessage, ToolSession } from "./types";
import { nirToConversation } from "./nir-map";

interface HermesSessionEntry { session_id?: string; display_name?: string; created_at?: string; origin?: { chat_id?: string } }
interface HermesMessage { role?: string; content?: unknown }
const ROOT = ".hermes/sessions";
// 新版 hermes 不再写 sessions.json + request dump，会话存 sqlite state.db。
const STATE_DB = ".hermes/state.db";

export async function listHermesSessions(source: FileSource): Promise<ToolSession[]> {
  if (await source.exists(STATE_DB)) return listFromStateDb(source);
  return listFromSessionsJson(source);
}

/** state.db 的列表是轻量元数据查询（不读 messages 表——读消息是 read 的事）。 */
async function listFromStateDb(source: FileSource): Promise<ToolSession[]> {
  try {
    return await withSqliteDb(source, STATE_DB, async (db) => {
      const rows = (await db
        .prepare(
          `SELECT id, title, display_name, started_at, message_count, cwd, model
           FROM sessions WHERE archived = 0 AND hidden = 0 ORDER BY started_at DESC`
        )
        .all()) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r.id as string,
        title: (r.display_name as string) || (r.title as string) || `Hermes ${r.id}`,
        createdAt: r.started_at
          ? new Date((r.started_at as number) * 1000).toISOString()
          : new Date().toISOString(),
        messageCount: (r.message_count as number) ?? 0,
        directory: (r.cwd as string) || "",
        model: (r.model as string) || undefined,
      }));
    });
  } catch {
    return [];
  }
}

async function listFromSessionsJson(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const sessionsPath = join(ROOT, "sessions.json");
  if (!(await source.exists(sessionsPath))) return [];
  try {
    const data = JSON.parse(await source.readFile(sessionsPath)) as Record<string, unknown>;
    const entries = Object.values(data) as HermesSessionEntry[];
    // 每个 dump 文件只读一次（之前 title/messageCount 各读一遍，N+1 双读），
    // 且跨 session 并行——SSH 场景下 elapsed 从串行 2N 个 RTT 降到一批。
    const sessions = await Promise.all(
      entries.map(async (e): Promise<ToolSession | null> => {
        const id = e.session_id || "";
        if (!id) return null;
        const dump = await readHermesDumpInfo(source, id);
        return {
          id,
          title: e.display_name || dump.title || `Hermes ${id}`,
          createdAt: e.created_at || new Date().toISOString(),
          messageCount: dump.messageCount,
          directory: e.origin?.chat_id || "",
        };
      })
    );
    return sessions
      .filter((s): s is ToolSession => !!s)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/** 一次性读出 dump 的展示信息（标题 + 消息数），避免同一文件读两遍。 */
async function readHermesDumpInfo(
  source: FileSource,
  sessionId: string
): Promise<{ title: string | null; messageCount: number }> {
  const latest = await findLatestHermesDump(source, sessionId);
  if (!latest) return { title: null, messageCount: 0 };
  try {
    const data = JSON.parse(await source.readFile(latest)) as Record<string, unknown>;
    const body = ((data.request as Record<string, unknown>)?.body as Record<string, unknown>) || {};
    const messages = ((body.messages as HermesMessage[]) || []);
    const firstUser = messages.find((m) => m.role === "user");
    return {
      title: firstUser ? cleanTitle(normalizeHermesContent(firstUser.content)) : null,
      messageCount: messages.length,
    };
  } catch {
    return { title: null, messageCount: 0 };
  }
}

export async function readHermesSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (await source.exists(STATE_DB)) return readFromStateDb(source, sessionId);
  return readFromDump(source, sessionId);
}

async function readFromStateDb(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  try {
    return await withSqliteDb(source, STATE_DB, async (db) => {
      // 包接口一次性映射全部会话（state.db 体量小）；按 id 取出目标会话。
      const sessions = await hermesSessionsFromDb(db, { source: "hermes" });
      const nir = sessions.find((s) => s.id === sessionId);
      return nir ? nirToConversation(nir, "hermes") : [];
    });
  } catch {
    return [];
  }
}

async function readFromDump(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  const latest = await findLatestHermesDump(source, sessionId);
  if (!latest) return [];
  const nir = parseHermesDump(await source.readFile(latest), { source: "hermes", id: sessionId });
  if (!nir) return [];
  return nirToConversation(nir, "hermes");
}

async function findLatestHermesDump(source: FileSource, sessionId: string): Promise<string | null> {
  if (!(await source.exists(ROOT))) return null;
  const files = (await source.readDir(ROOT))
    .map((f) => f.name)
    .filter((n) => n.startsWith(`request_dump_${sessionId}_`) && n.endsWith(".json"))
    .sort();
  return files.length ? join(ROOT, files[files.length - 1]) : null;
}

function normalizeHermesContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => { if (typeof p === "string") return p; if (p && typeof p === "object") return (p as { text?: string }).text || JSON.stringify(p); return ""; }).join("\n");
  return content ? JSON.stringify(content) : "";
}
function cleanTitle(text: string, maxLength = 80): string {
  if (!text) return "";
  const firstLine = text.split("\n").find((l) => l.trim()) || "";
  const cleaned = firstLine.replace(/\s+/g, " ").replace(/<[^>]+>/g, " ").trim();
  return cleaned.length <= maxLength ? cleaned : cleaned.slice(0, maxLength).trimEnd() + "…";
}
