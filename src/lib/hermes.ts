import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import { withSqliteDb } from "../../electron/sqlite";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";
import { pairToolOutputInMessages } from "./tool-pairing";

interface HermesSessionEntry { session_id?: string; display_name?: string; created_at?: string; origin?: { chat_id?: string } }
interface HermesMessage { role?: string; content?: unknown; tool_calls?: HermesToolCall[] }
interface HermesToolCall { id?: string; function?: { name?: string; arguments?: string }; name?: string; args?: Record<string, unknown> }
const ROOT = ".hermes/sessions";
// 新版 hermes 不再写 sessions.json + request dump，会话存 sqlite state.db。
const STATE_DB = ".hermes/state.db";

export async function listHermesSessions(source: FileSource): Promise<ToolSession[]> {
  if (await source.exists(STATE_DB)) return listFromStateDb(source);
  return listFromSessionsJson(source);
}

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
      const rows = (await db
        .prepare(
          `SELECT role, content, tool_calls, tool_call_id, timestamp, reasoning_content
           FROM messages WHERE session_id = ? AND active = 1 ORDER BY timestamp`
        )
        .all(sessionId)) as Record<string, unknown>[];
      const result: ConversationMessage[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const role = (row.role as string) || "";
        if (!["system", "user", "assistant", "tool"].includes(role)) continue;
        const timestamp = row.timestamp
          ? new Date((row.timestamp as number) * 1000).toISOString()
          : new Date().toISOString();
        // 工具结果按 tool_call_id 配回 assistant 的 toolCall，不再独立成泡；
        // 配不到（id 不匹配/已全部配对）才作为 tool 消息落下。
        if (role === "tool") {
          const output = normalizeHermesContent(row.content);
          if (pairToolOutputInMessages(result, output, (row.tool_call_id as string) || undefined)) continue;
        }
        let toolCalls: ToolCall[] | undefined;
        if (typeof row.tool_calls === "string" && row.tool_calls) {
          try {
            const calls = JSON.parse(row.tool_calls) as HermesToolCall[];
            if (Array.isArray(calls) && calls.length) {
              toolCalls = calls.map((tc) => ({
                id: tc.id as string | undefined,
                name: tc.function?.name || tc.name || "unknown",
                input: (() => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return tc.args || {}; } })(),
              }));
            }
          } catch {}
        }
        result.push({
          id: `hermes-${i}`,
          role: role as ConversationMessage["role"],
          content: normalizeHermesContent(row.content),
          timestamp,
          thinking: (row.reasoning_content as string) || undefined,
          toolCalls,
          source: "hermes",
        });
      }
      return result;
    });
  } catch {
    return [];
  }
}

async function readFromDump(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  const latest = await findLatestHermesDump(source, sessionId);
  if (!latest) return [];
  try {
    const data = JSON.parse(await source.readFile(latest)) as Record<string, unknown>;
    const body = ((data.request as Record<string, unknown>)?.body as Record<string, unknown>) || {};
    const messages = (body.messages as HermesMessage[]) || [];
    const result: ConversationMessage[] = [];
    const timestamp = (data.timestamp as string) || new Date().toISOString();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role || "";
      const content = normalizeHermesContent(msg.content);
      if (role === "system") result.push({ id: `hermes-${i}`, role: "system", content, timestamp, source: "hermes" });
      else if (role === "user") result.push({ id: `hermes-${i}`, role: "user", content, timestamp, source: "hermes" });
      else if (role === "assistant") {
        const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc) => ({
          name: tc.function?.name || tc.name || "unknown",
          input: (() => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return tc.args || {}; } })(),
        }));
        result.push({ id: `hermes-${i}`, role: "assistant", content, timestamp, toolCalls: toolCalls.length ? toolCalls : undefined, source: "hermes" });
      } else if (role === "tool") result.push({ id: `hermes-${i}`, role: "tool", content, timestamp, source: "hermes" });
    }
    return result;
  } catch {
    return [];
  }
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
