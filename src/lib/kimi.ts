import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";

const ROOT = ".kimi-code/sessions";

interface KimiState {
  id?: string;
  cwd?: string;
  /** 旧版 schema 用 workDir 而不是 cwd。 */
  workDir?: string;
  title?: string;
  lastPrompt?: string;
  archived?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Kimi Code 布局：~/.kimi-code/sessions/wd_<项目>_<hash>/session_<uuid>/
 *   state.json                 —— 元数据（cwd/title/createdAt/archived）
 *   agents/main/wire.jsonl     —— 事件流：user 消息是 context.append_message，
 *                                 assistant 输出是 context.append_loop_event
 *                                 （content.part / tool.call / tool.result）
 */
export async function listKimiSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const result: ToolSession[] = [];
  for (const wd of await source.readDir(ROOT)) {
    if (!wd.isDirectory) continue;
    const wdRel = join(ROOT, wd.name);
    let sessionDirs;
    try {
      sessionDirs = await source.readDir(wdRel);
    } catch {
      continue;
    }
    for (const sess of sessionDirs) {
      if (!sess.isDirectory || !sess.name.startsWith("session_")) continue;
      const sessRel = join(wdRel, sess.name);
      try {
        const state = JSON.parse(await source.readFile(join(sessRel, "state.json"))) as KimiState;
        if (state.archived) continue;
        const wireRel = join(sessRel, "agents/main/wire.jsonl");
        // 与 codex 同一口径：jsonl 行数（含事件行），避免为计数解析整个文件。
        const messageCount = (await source.exists(wireRel)) ? await source.lineCount(wireRel) : 0;
        result.push({
          id: state.id || sess.name,
          title: state.title || state.lastPrompt || "Untitled",
          createdAt: new Date(state.createdAt || Date.now()).toISOString(),
          messageCount,
          project: state.cwd || state.workDir || undefined,
        });
      } catch {}
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readKimiSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (!(await source.exists(ROOT))) return [];
  const wireRel = await findWire(source, sessionId);
  if (!wireRel) return [];

  const messages: ConversationMessage[] = [];
  // assistant 输出按事件流累积，遇到下一条 user 消息或文件结束时 flush。
  let bufText = "";
  let bufThinking = "";
  let bufToolCalls: ToolCall[] = [];
  let bufTs = "";

  const ts = (ms: unknown) => (typeof ms === "number" ? new Date(ms).toISOString() : new Date().toISOString());
  const flush = () => {
    if (!bufText.trim() && !bufThinking.trim() && !bufToolCalls.length) return;
    messages.push({
      id: `kimi-asst-${messages.length}`,
      role: "assistant",
      content: bufText.trim(),
      timestamp: bufTs || new Date().toISOString(),
      thinking: bufThinking.trim() || undefined,
      toolCalls: bufToolCalls.length ? bufToolCalls : undefined,
      source: "kimi",
    });
    bufText = "";
    bufThinking = "";
    bufToolCalls = [];
    bufTs = "";
  };

  for (const line of (await source.readFile(wireRel)).split("\n")) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === "context.append_message") {
      const msg = o.message as { role?: string; content?: unknown } | undefined;
      if (msg?.role !== "user") continue;
      flush();
      messages.push({
        id: `kimi-user-${messages.length}`,
        role: "user",
        content: extractText(msg.content),
        timestamp: ts(o.time),
        source: "kimi",
      });
    } else if (o.type === "context.append_loop_event") {
      const e = o.event as Record<string, unknown>;
      if (!bufTs) bufTs = ts(o.time);
      if (e.type === "content.part") {
        const part = e.part as { type?: string; text?: string; think?: string };
        if (part.type === "text" && part.text) bufText += part.text + "\n";
        else if (part.type === "think" && part.think) bufThinking += part.think + "\n";
      } else if (e.type === "tool.call") {
        bufToolCalls.push({
          id: (e.toolCallId as string) || undefined,
          name: (e.name as string) || "unknown",
          input: (e.args as Record<string, unknown>) || {},
        });
      } else if (e.type === "tool.result") {
        const output = extractToolOutput(e.result);
        for (let i = bufToolCalls.length - 1; i >= 0; i--) {
          if (bufToolCalls[i].id === e.toolCallId && !bufToolCalls[i].output) {
            bufToolCalls[i].output = output;
            break;
          }
        }
      }
    }
  }
  flush();
  return messages;
}

async function findWire(source: FileSource, sessionId: string): Promise<string | null> {
  for (const wd of await source.readDir(ROOT)) {
    if (!wd.isDirectory) continue;
    const wireRel = join(ROOT, wd.name, sessionId, "agents/main/wire.jsonl");
    if (await source.exists(wireRel)) return wireRel;
  }
  return null;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? (b as { text?: string }).text || "" : ""))
      .filter(Boolean)
      .join("\n");
  }
  return content ? JSON.stringify(content) : "";
}

function extractToolOutput(result: unknown): string {
  if (result && typeof result === "object") {
    const output = (result as { output?: unknown }).output;
    if (typeof output === "string") return output;
    if (output !== undefined) return JSON.stringify(output);
  }
  return typeof result === "string" ? result : JSON.stringify(result ?? "");
}
