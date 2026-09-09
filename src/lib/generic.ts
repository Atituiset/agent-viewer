import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";
import { parseClaudeTranscript } from "./claude";
import { parseCodexTranscript } from "./codex";
import { pairToolOutputInMessages } from "./tool-pairing";

/**
 * 未知 agent 的通用会话支持（启发式自发现用）。
 *
 * 市面 CLI agent 的会话存储高度趋同：
 * - 位置：~/.<agent>/sessions|projects|history
 * - 内容：JSONL 转录，三种主流事件风格：
 *   · claude 形 —— {type:"user"|"assistant", message:{...}, timestamp, uuid}
 *   · codex 形  —— {type:"response_item", payload:{...}} rollout 事件流
 *   · chat 形   —— 每行 {role:"user"|"assistant", content:"..."}（最朴素的 dump）
 * - 以及「单文件 JSON」风格：
 *   · session 形 —— 整个 .json 是一个对象 {metadata?, messages:[{role, content}]}，
 *     messages 是 OpenAI/Claude 风格的对话数组（codewhale 等用这种）。
 *     文件往往几百 KB 起步，采样 head 截断后 JSON.parse 必失败——不能只看
 *     「整文件能否解析」，要看截断片段的特征。
 *
 * 这里按「采样 → 探测格式 → 纯函数解析」组织：list 时采样前几行判定 kind，
 * read 用对应解析器；全都解析不出来就放弃该 agent（不显示比显示乱码好）。
 */

export type GenericKind = "claude-style" | "codex-style" | "chat-style" | "session-style";

/**
 * 对采样片段判定风格；null = 都不是。
 * 注意 sample 可能是截断的（readHead 只读了几 KB）：jsonl 形逐行判；
 * session 形整文件 JSON 在截断后必然 parse 失败，改用「前缀特征」识别——
 * 首字符 { 且前几 KB 内出现 "messages" 与 "role" 键，即认定 session-style。
 */
export function detectKind(sample: string): GenericKind | null {
  const head = sample.slice(0, 64 * 1024);
  // 先按整段试 session 形（完整小文件或带特征前缀的截断大文件）。
  const session = detectSessionStyle(head);
  if (session) return session;
  for (const raw of head.split("\n")) {
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

/**
 * session 形识别：完整的单文件 JSON 对话（messages: [{role, content}]），
 * 或其截断片段。后者 JSON.parse 必失败，靠键序列特征识别：
 *   {"...": ..., "messages": [...{"role": "...", "content": ...
 * —— "messages" 后跟着对象成员含 "role" 键。特征足够特异，不会误伤
 *   配置文件（config.json 等没有 "messages"+"role" 组合）。
 */
function detectSessionStyle(sample: string): GenericKind | null {
  const trimmed = sample.trimStart();
  if (!trimmed.startsWith("{")) return null;
  try {
    const obj = JSON.parse(sample) as Record<string, unknown>;
    if (isSessionShapedObject(obj)) return "session-style";
    return null;
  } catch {
    // 截断的：看前缀特征。"messages" 出现后，其值内需出现 {"role"
    const messagesIdx = trimmed.indexOf('"messages"');
    if (messagesIdx < 0) return null;
    const after = trimmed.slice(messagesIdx);
    const roleIdx = after.indexOf('"role"');
    if (roleIdx < 0) return null;
    const contentIdx = after.indexOf('"content"');
    if (contentIdx < 0) return null;
    return "session-style";
  }
}

function isSessionShapedObject(obj: Record<string, unknown>): boolean {
  const messages = obj.messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const first = messages[0] as Record<string, unknown> | null;
  return !!first && typeof first === "object" && typeof first.role === "string" && first.content !== undefined;
}

/** session 形解析：单文件 JSON {metadata?, messages:[{role, content[, tool_calls, thinking]}]}。
 *  兼容 claude 形 content blocks（text/thinking/tool_use/tool_result）；时间戳用
 *  metadata.created_at（会话级，缺省 now）。 */
export function parseSessionTranscript(content: string): ConversationMessage[] {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  const meta = (obj.metadata && typeof obj.metadata === "object" ? obj.metadata : {}) as Record<string, unknown>;
  const ts = typeof meta.created_at === "string" ? new Date(meta.created_at).toISOString() : new Date().toISOString();
  const messages = Array.isArray(obj.messages) ? (obj.messages as Record<string, unknown>[]) : [];
  const result: ConversationMessage[] = [];
  let toolUseOutputs: Array<{ id: string; output: string }> = [];
  let fallbackIdx = 0;

  for (const msg of messages) {
    const role = typeof msg.role === "string" ? msg.role : "";
    if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") continue;
    const { text, thinking, toolCalls, toolResults } = extractSessionContent(msg.content);
    if (role === "tool") {
      // 工具结果按 tool_call_id 配回；配不到落成独立 tool 消息。
      const output = text || "";
      let paired = false;
      if (typeof msg.tool_call_id === "string") {
        paired = pairToolOutputInMessages(result, output, msg.tool_call_id);
      } else {
        paired = pairToolOutputInMessages(result, output);
      }
      if (!paired && output) {
        result.push({ id: `sess-tool-${fallbackIdx++}`, role: "tool", content: output, timestamp: ts, source: "generic" });
      }
      continue;
    }
    if (toolResults) toolUseOutputs = toolUseOutputs.concat(toolResults);
    // OpenAI 风格 tool_calls（assistant 消息附带）
    const openaiToolCalls = parseOpenAiToolCalls(msg.tool_calls);
    const allToolCalls = [...(toolCalls || []), ...openaiToolCalls];
    if (text || thinking || allToolCalls.length) {
      result.push({
        id: typeof msg.id === "string" ? msg.id : `sess-${result.length}`,
        role,
        content: text,
        timestamp: ts,
        thinking,
        toolCalls: allToolCalls.length ? allToolCalls : undefined,
        source: "generic",
      });
    }
  }

  for (const r of toolUseOutputs) pairToolOutputInMessages(result, r.output, r.id);
  return result;
}

/** claude 形 content blocks / 纯文本 / OpenAI 数组块 → {text, thinking, toolCalls, toolResults}。 */
function extractSessionContent(content: unknown): {
  text: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ id: string; output: string }>;
} {
  if (typeof content === "string") return { text: content };
  if (!Array.isArray(content)) return { text: content === undefined || content === null ? "" : JSON.stringify(content) };
  let text = "";
  let thinking = "";
  const toolCalls: ToolCall[] = [];
  const toolResults: Array<{ id: string; output: string }> = [];
  for (const block of content as Record<string, unknown>[]) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") text += block.text + "\n";
    else if (block.type === "thinking" && typeof block.thinking === "string") thinking += block.thinking + "\n";
    else if (block.type === "tool_use") {
      toolCalls.push({
        id: typeof block.id === "string" ? block.id : undefined,
        name: typeof block.name === "string" ? block.name : "unknown",
        input: (block.input as Record<string, unknown>) || {},
      });
    } else if (block.type === "tool_result") {
      const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
      const output =
        typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? (block.content as Record<string, unknown>[])
                .filter((b) => b && b.type === "text" && typeof b.text === "string")
                .map((b) => b.text as string)
                .join("\n")
            : "";
      if (id && output) toolResults.push({ id, output });
    }
  }
  return {
    text: text.trim(),
    thinking: thinking.trim() || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    toolResults: toolResults.length ? toolResults : undefined,
  };
}

/** OpenAI 风格 tool_calls：[{id, function:{name, arguments}}]。 */
function parseOpenAiToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const tc of raw as Record<string, unknown>[]) {
    if (!tc || typeof tc !== "object") continue;
    const fn = (tc.function && typeof tc.function === "object" ? tc.function : {}) as Record<string, unknown>;
    const name = typeof fn.name === "string" ? fn.name : "unknown";
    let input: Record<string, unknown> = {};
    if (typeof fn.arguments === "string") {
      try {
        const parsed = JSON.parse(fn.arguments);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
        else input = { arguments: fn.arguments };
      } catch {
        input = { arguments: fn.arguments };
      }
    } else if (fn.arguments && typeof fn.arguments === "object") {
      input = fn.arguments as Record<string, unknown>;
    }
    out.push({ id: typeof tc.id === "string" ? tc.id : undefined, name, input });
  }
  return out;
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
    case "session-style":
      return parseSessionTranscript(content);
  }
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
      return parseGenericTranscript(kind, await source.readFile(candidate));
    } catch {
      return [];
    }
  }
  return [];
}
