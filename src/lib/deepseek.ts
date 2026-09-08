import type { DirEntry, FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";
import { pairToolOutputInMessages } from "./tool-pairing";

const ROOT = ".deepseek/sessions";

/** detect 卡片用的轻量计数：readDir 数 .json 文件名即可（listSessions 得整读每个文件）。 */
export async function countDeepSeekSessions(source: FileSource): Promise<number> {
  if (!(await source.exists(ROOT))) return 0;
  const entries = await source.readDir(ROOT).catch(() => [] as DirEntry[]);
  return entries.filter((f) => f.name.endsWith(".json")).length;
}

export async function listDeepSeekSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const out: Promise<ToolSession>[] = [];
  for (const f of await source.readDir(ROOT)) {
    if (!f.name.endsWith(".json")) continue;
    const fileRel = join(ROOT, f.name);
    // 文件间全并行；单文件坏档降级为占位条目而不是拖垮整个列表。
    out.push(
      (async (): Promise<ToolSession> => {
        try {
          const data = JSON.parse(await source.readFile(fileRel));
          const meta = data.metadata || {};
          return {
            id: meta.id || f.name.replace(".json", ""),
            title: meta.title || "Untitled",
            model: meta.model || "deepseek",
            directory: meta.workspace || "",
            createdAt: meta.created_at || new Date().toISOString(),
            messageCount: meta.message_count || (data.messages || []).length,
          };
        } catch {
          return { id: f.name.replace(".json", ""), title: "Untitled", model: "deepseek", createdAt: new Date().toISOString(), messageCount: 0 };
        }
      })()
    );
  }
  return (await Promise.all(out)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readDeepSeekSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (!(await source.exists(ROOT))) return [];
  let fileRel = join(ROOT, `${sessionId}.json`);
  if (!(await source.exists(fileRel))) {
    const match = (await source.readDir(ROOT)).find((f) => f.name.startsWith(sessionId) && f.name.endsWith(".json"));
    if (!match) return [];
    fileRel = join(ROOT, match.name);
  }
  try {
    const data = JSON.parse(await source.readFile(fileRel));
    const messages = data.messages || [];
    const result: ConversationMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role as string;
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      const ts = data.metadata?.created_at || new Date().toISOString();
      if (role === "user" || role === "assistant") {
        result.push({ id: `ds-${i}`, role, content, timestamp: ts, source: "deepseek" });
        // assistant 消息自带的 tool_calls 挂到刚推入的这条上
        if (role === "assistant" && msg.tool_calls) {
          result[result.length - 1].toolCalls = parseDeepSeekToolCalls(msg.tool_calls);
        }
      } else if (role === "tool") {
        // 工具结果配回最近未配对的 toolCall（deepseek 结果无 id，纯按时间就近）。
        pairToolOutputInMessages(result, content);
      } else if (msg.tool_calls) {
        const toolCalls = parseDeepSeekToolCalls(msg.tool_calls);
        const last = result[result.length - 1];
        if (last && last.role === "assistant") last.toolCalls = [...(last.toolCalls || []), ...toolCalls];
        else result.push({ id: `ds-tool-${i}`, role: "assistant", content: "", timestamp: ts, toolCalls, source: "deepseek" });
      }
    }
    return result;
  } catch {
    return [];
  }
}

function parseDeepSeekToolCalls(raw: unknown): ToolCall[] {
  return ((raw as { function: { name: string; arguments: string } }[]) || []).map((tc) => ({
    name: tc.function?.name || "unknown",
    input: (() => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return {}; } })(),
  }));
}
