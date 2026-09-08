import type { DirEntry, FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";
import { attachToolOutput } from "./tool-pairing";

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
  // wd_* 目录间全并行，wd 内 session 目录间全并行（SSH 下每层 readDir 都是一个 RTT）。
  const perWd = await Promise.all(
    (await source.readDir(ROOT))
      .filter((wd) => wd.isDirectory)
      .map(async (wd): Promise<ToolSession[]> => {
        const wdRel = join(ROOT, wd.name);
        let sessionDirs;
        try {
          sessionDirs = await source.readDir(wdRel);
        } catch {
          return [];
        }
        const sessions = await Promise.all(
          sessionDirs
            .filter((s) => s.isDirectory && s.name.startsWith("session_"))
            .map(async (sess): Promise<ToolSession | null> => {
              const sessRel = join(wdRel, sess.name);
              try {
                const state = JSON.parse(await source.readFile(join(sessRel, "state.json"))) as KimiState;
                if (state.archived) return null;
                const wireRel = join(sessRel, "agents/main/wire.jsonl");
                // 与 codex 同一口径：jsonl 行数（含事件行），避免为计数解析整个文件。
                const messageCount = (await source.exists(wireRel)) ? await source.lineCount(wireRel) : 0;
                return {
                  id: state.id || sess.name,
                  title: state.title || state.lastPrompt || "Untitled",
                  createdAt: new Date(state.createdAt || Date.now()).toISOString(),
                  messageCount,
                  project: state.cwd || state.workDir || undefined,
                };
              } catch {
                return null;
              }
            })
        );
        return sessions.filter((s): s is ToolSession => !!s);
      })
  );
  return perWd.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readKimiSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (!(await source.exists(ROOT))) return [];
  const sessionRel = await findSessionDir(source, sessionId);
  if (!sessionRel) return [];

  const messages: ConversationMessage[] = [];
  const agentsRel = join(sessionRel, "agents");
  let agentDirs: DirEntry[];
  try {
    agentDirs = await source.readDir(agentsRel);
  } catch {
    agentDirs = [];
  }
  // main 必须解析；其余 agents/<id>/wire.jsonl 为 subagent 泳道，逐个容错解析（目录间并行）。
  const lanes = await Promise.all(
    agentDirs
      .filter((dir) => dir.isDirectory)
      .map(async (dir): Promise<{ agentId: string; lane: ConversationMessage[]; agentLabel?: string } | null> => {
        const agentId = dir.name;
        const wireRel = join(agentsRel, agentId, "wire.jsonl");
        let wire: string;
        try {
          wire = await source.readFile(wireRel);
        } catch {
          return null;
        }
        const lane = parseWire(wire);
        if (agentId === "main") return { agentId, lane };
        const profile = extractProfileName(wire);
        return { agentId, lane, agentLabel: profile ? `${profile} · ${agentId}` : agentId };
      })
  );
  for (const l of lanes) {
    if (!l) continue;
    if (l.agentId === "main") messages.push(...l.lane);
    else {
      for (const m of l.lane) {
        m.agent = l.agentId;
        m.agentLabel = l.agentLabel;
      }
      messages.push(...l.lane);
    }
  }
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return messages;
}

/** 解析单个 wire.jsonl：user 消息 + 按 user turn flush 的 assistant 事件流。 */
function parseWire(wire: string): ConversationMessage[] {
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

  for (const line of wire.split("\n")) {
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
        attachToolOutput(bufToolCalls, extractToolOutput(e.result), (e.toolCallId as string) || undefined);
      }
    }
  }
  flush();
  return messages;
}

/** 从 wire 文件取 profile.bind 事件的 profileName（如 "explore"），无则 null。 */
function extractProfileName(wire: string): string | null {
  for (const line of wire.split("\n")) {
    if (!line.includes('"profile.bind"')) continue;
    try {
      const o = JSON.parse(line) as { type?: string; profileName?: unknown };
      if (o.type === "profile.bind" && typeof o.profileName === "string" && o.profileName) {
        return o.profileName;
      }
    } catch {}
  }
  return null;
}

/** wd_* 目录间并行探测；结果按 source 缓存（LIVE 轮询每 3s 一次 read，不再全盘扫）。 */
const kimiSessionDirCache = new WeakMap<FileSource, Map<string, string>>();

async function findSessionDir(source: FileSource, sessionId: string): Promise<string | null> {
  let perSource = kimiSessionDirCache.get(source);
  if (!perSource) {
    perSource = new Map();
    kimiSessionDirCache.set(source, perSource);
  }
  const cached = perSource.get(sessionId);
  if (cached) return cached;
  const wds = (await source.readDir(ROOT).catch(() => [] as DirEntry[])).filter((d) => d.isDirectory);
  const dirs = await Promise.all(
    wds.map((wd) =>
      source
        .exists(join(ROOT, wd.name, sessionId, "agents/main/wire.jsonl"))
        .then((ok) => (ok ? join(ROOT, wd.name, sessionId) : null))
        .catch(() => null)
    )
  );
  const hit = dirs.find((d): d is string => !!d);
  if (hit) perSource.set(sessionId, hit);
  return hit ?? null;
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
