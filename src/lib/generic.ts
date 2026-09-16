import { detectKind, parseDetectedTranscript } from "agent-session-format";
import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolSession } from "./types";
import { nirToConversation } from "./nir-map";

// 格式分类与转录解析已上移到 agent-session-format（detectKind / parseDetectedTranscript），
// 这里只保留 app 侧的关注点：目录扫描、会话 id 编解码、列表项采集。
export { detectKind };
export type { GenericKind } from "agent-session-format";
import type { GenericKind } from "agent-session-format";

/** 按检测到的风格解析转录文本（包解析出 NIR，再映射成视图模型）。 */
export function parseGenericTranscript(kind: GenericKind, content: string, sessionId = "generic"): ConversationMessage[] {
  const nir = parseDetectedTranscript(kind, content, { source: "generic", id: sessionId });
  if (!nir) return [];
  return nirToConversation(nir, "generic");
}

/** 发现结果的编码：id = generic:<kind>:<rootRel>，rootRel 里的 / 转义防止拆 id 时歧义。 */
export function encodeGenericId(kind: GenericKind, rootRel: string): string {
  return `generic:${kind}:${encodeURIComponent(rootRel)}`;
}

export function decodeGenericId(id: string): { kind: GenericKind; rootRel: string } | null {
  const m = /^generic:(claude-style|codex-style|chat-style|session-style):(.+)$/.exec(id);
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
export async function listGenericSessions(source: FileSource, rootRel: string, kind?: GenericKind): Promise<ToolSession[]> {
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
              .map((f) => pushSession(source, rootRel, join(rootRel, e.name, f.name), kind))
          );
        })()
      );
    } else if (/\.(jsonl|json)$/i.test(e.name)) {
      jobs.push(Promise.all([pushSession(source, rootRel, join(rootRel, e.name), kind)]));
    }
  }
  const sessions = (await Promise.all(jobs)).flat().filter((s): s is ToolSession => !!s);
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function pushSession(
  source: FileSource,
  rootRel: string,
  relPath: string,
  kind?: GenericKind
): Promise<ToolSession | null> {
  try {
    const isSession = kind === "session-style";
    // session 形是单文件 JSON：lineCount 数的是缩进行没有意义，跳过 lineCount
    // （metadata.message_count 可用）；jsonl 形才需要流式行数。
    const [stat, head, messageCount] = await Promise.all([
      source.stat(relPath),
      source.readHead(relPath, isSession ? 16 * 1024 : 4096),
      isSession ? Promise.resolve(0) : source.lineCount(relPath),
    ]);
    return {
      id: sessionFileId(rootRel, relPath),
      title: titleFromHead(head) || sessionFileId(rootRel, relPath),
      createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
      messageCount: isSession ? headMessageCount(head) : messageCount,
    };
  } catch {
    return null; // 单个文件坏/不可读：跳过，不让整个 agent 的列表失败。
  }
}

/** session 形（pretty JSON）从采样头里取 metadata.message_count。 */
function headMessageCount(head: string): number {
  const m = /"message_count"\s*:\s*(\d+)/.exec(head);
  return m ? Number(m[1]) : 0;
}

/** 从采样头里抠一行可读文本当标题。jsonl 形逐行试；session 形（整文件截断片段）
 *  先整段 parse，失败再按正则从片段里抠 metadata.title / 首条 user 文本。 */
function titleFromHead(head: string): string | null {
  const fromJsonl = titleFromJsonlHead(head);
  if (fromJsonl) return fromJsonl;
  return titleFromSessionHead(head);
}

function titleFromJsonlHead(head: string): string | null {
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

/** session 形标题：完整小文件直接 parse；截断片段用正则抠。 */
function titleFromSessionHead(head: string): string | null {
  const clean = (s: string): string | null => {
    const oneLine = s.replace(/\s+/g, " ").trim();
    if (!oneLine) return null;
    return oneLine.length > 80 ? oneLine.slice(0, 80) + "…" : oneLine;
  };
  const m = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head);
  if (m) {
    try {
      const title = JSON.parse(`"${m[1]}"`) as string;
      const c = clean(title);
      if (c) return c;
    } catch {}
  }
  // 首条 user 文本（content 数组里的第一个 text 块）。
  const um = /"role"\s*:\s*"user"[\s\S]{0,400}?"text"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head);
  if (um) {
    try {
      const text = JSON.parse(`"${um[1]}"`) as string;
      const c = clean(text);
      if (c) return c;
    } catch {}
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
      return parseGenericTranscript(kind, await source.readFile(candidate), sessionId);
    } catch {
      return [];
    }
  }
  return [];
}
