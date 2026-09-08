import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolSession } from "./types";
import { parseClaudeTranscript } from "./claude";
import { parseCodexTranscript } from "./codex";
import { pairToolOutputInMessages } from "./tool-pairing";

/**
 * 未知 agent 的通用会话支持（启发式自发现用）。
 *
 * 市面 CLI agent 的会话存储高度趋同：
 * - 位置：~/.<agent>/sessions|projects|history
 * - 内容：JSONL 转录，两种主流事件风格：
 *   · claude 形 —— {type:"user"|"assistant", message:{...}, timestamp, uuid}
 *   · codex 形  —— {type:"response_item", payload:{...}} rollout 事件流
 *   · chat 形   —— 每行 {role:"user"|"assistant", content:"..."}（最朴素的 dump）
 *
 * 这里按「采样 → 探测格式 → 纯函数解析」组织：list 时采样前几行判定 kind，
 * read 用对应解析器；三种都解析不出来就放弃该 agent（不显示比显示乱码好）。
 */

export type GenericKind = "claude-style" | "codex-style" | "chat-style";

/** 对一段 jsonl 首行采样判定风格；null = 三种都不是。 */
export function detectKind(sample: string): GenericKind | null {
  for (const raw of sample.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // 坏行/首行是空对象都跳过，看下一行
    }
    if (obj.type === "response_item" || (obj.payload && typeof obj.payload === "object")) return "codex-style";
    if ((obj.type === "user" || obj.type === "assistant") && obj.message) return "claude-style";
    if (typeof obj.role === "string" && obj.content !== undefined) return "chat-style";
    return null; // JSON 合法但形状不认识
  }
  return null;
}

/** chat 形解析：每行 {role, content[, timestamp]}，逐行容错，tool 输出按就近配对。 */
export function parseChatTranscript(content: string): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const role = obj.role;
    if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") continue;
    const contentStr =
      typeof obj.content === "string" ? obj.content : obj.content === undefined ? "" : JSON.stringify(obj.content);
    let timestamp: string;
    try {
      const d = new Date(obj.timestamp as string);
      timestamp = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    } catch {
      timestamp = new Date().toISOString();
    }
    if (role === "tool") {
      pairToolOutputInMessages(messages, contentStr);
      continue;
    }
    messages.push({
      id: typeof obj.id === "string" ? obj.id : `gen-${messages.length}`,
      role,
      content: contentStr,
      timestamp,
      source: "generic",
    });
  }
  return messages;
}

export function parseGenericTranscript(kind: GenericKind, content: string): ConversationMessage[] {
  switch (kind) {
    case "claude-style":
      return parseClaudeTranscript(content).map((m) => ({ ...m, source: "generic" }));
    case "codex-style":
      return parseCodexTranscript(content).map((m) => ({ ...m, source: "generic" }));
    case "chat-style":
      return parseChatTranscript(content);
  }
}

/** 发现结果的编码：id = generic:<kind>:<rootRel>，rootRel 里的 / 转义防止拆 id 时歧义。 */
export function encodeGenericId(kind: GenericKind, rootRel: string): string {
  return `generic:${kind}:${encodeURIComponent(rootRel)}`;
}

export function decodeGenericId(id: string): { kind: GenericKind; rootRel: string } | null {
  const m = /^generic:(claude-style|codex-style|chat-style):(.+)$/.exec(id);
  if (!m) return null;
  try {
    return { kind: m[1] as GenericKind, rootRel: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}

/** 会话文件 → 会话 id：相对 root 的路径去扩展名（read 时由 root + id 复原，
 *  嵌套子目录用 / 连接保持唯一；.jsonl/.json 后缀读时补回）。 */
function sessionFileId(rootRel: string, relPath: string): string {
  const under = relPath.startsWith(rootRel + "/") ? relPath.slice(rootRel.length + 1) : relPath;
  return under.replace(/\.(jsonl|json)$/i, "");
}

/**
 * 列出某个发现到的 agent 目录下的会话。
 * 只扫一层子目录 + 根下直接放的 jsonl/json 文件——市面 agent 的 sessions 目录
 * 要么平铺文件，要么一层日期/project 子目录，不做更深递归（SSH 下太贵）。
 * 全并行采集（目录/文件间 + 单文件 stat/head/lineCount 同时发起）。
 */
export async function listGenericSessions(source: FileSource, rootRel: string): Promise<ToolSession[]> {
  let entries;
  try {
    entries = await source.readDir(rootRel);
  } catch {
    return [];
  }
  // 全并行：子目录间/文件间并行，单文件 stat/head/lineCount 同时发起。
  const jobs: Array<Promise<Array<ToolSession | null>>> = [];
  for (const e of entries) {
    if (e.isDirectory) {
      jobs.push(
        (async (): Promise<Array<ToolSession | null>> => {
          let sub;
          try {
            sub = await source.readDir(join(rootRel, e.name));
          } catch {
            return [];
          }
          return Promise.all(
            sub
              .filter((f) => !f.isDirectory && /\.(jsonl|json)$/i.test(f.name))
              .map((f) => pushSession(source, rootRel, join(rootRel, e.name, f.name)))
          );
        })()
      );
    } else if (/\.(jsonl|json)$/i.test(e.name)) {
      jobs.push(Promise.all([pushSession(source, rootRel, join(rootRel, e.name))]));
    }
  }
  const sessions = (await Promise.all(jobs)).flat().filter((s): s is ToolSession => !!s);
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function pushSession(
  source: FileSource,
  rootRel: string,
  relPath: string
): Promise<ToolSession | null> {
  try {
    const [stat, head, messageCount] = await Promise.all([
      source.stat(relPath),
      source.readHead(relPath, 4096),
      source.lineCount(relPath),
    ]);
    return {
      id: sessionFileId(rootRel, relPath),
      title: titleFromHead(head) || sessionFileId(rootRel, relPath),
      createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
      messageCount,
    };
  } catch {
    return null; // 单个文件坏/不可读：跳过，不让整个 agent 的列表失败。
  }
}

/** 从采样头里抠一行可读文本当标题。 */
function titleFromHead(head: string): string | null {
  for (const raw of head.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      // claude 形的 summary 行 / 任意格式的 title 字段 / user 首问
      const candidate =
        (typeof obj.title === "string" && obj.title) ||
        (typeof obj.summary === "string" && obj.summary) ||
        ((obj.type === "user" || obj.role === "user") &&
        typeof (obj.message as { content?: unknown })?.content === "string"
          ? ((obj.message as { content?: string }).content as string)
          : null) ||
        (obj.role === "user" && typeof obj.content === "string" ? obj.content : null);
      if (candidate) {
        const oneLine = candidate.replace(/\s+/g, " ").trim();
        return oneLine.length > 80 ? oneLine.slice(0, 80) + "…" : oneLine;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** 读取某个发现到的会话文件（relPath 即 session id）。 */
export async function readGenericSession(
  source: FileSource,
  kind: GenericKind,
  rootRel: string,
  sessionId: string
): Promise<ConversationMessage[]> {
  // sessionId 是 root 下的相对路径（可能带一层子目录）——防穿越：禁止 .. 与绝对路径。
  if (sessionId.startsWith("/") || sessionId.includes("..")) return [];
  const base = join(rootRel, sessionId);
  const hasExt = /\.(jsonl|json)$/i.test(sessionId);
  const candidates = hasExt ? [base] : [base + ".jsonl", base + ".json"];
  for (const candidate of candidates) {
    if (!(await source.exists(candidate))) continue;
    try {
      return parseGenericTranscript(kind, await source.readFile(candidate));
    } catch {
      return [];
    }
  }
  return [];
}
