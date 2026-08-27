import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";

const ROOT = ".codex/sessions";

async function walk(source: FileSource, dir: string, acc: { rel: string; name: string }[]) {
  let entries;
  try {
    entries = await source.readDir(dir);
  } catch {
    return; // 单层目录不可读只跳过该子树，不让整个工具归零
  }
  for (const entry of entries) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory) await walk(source, rel, acc);
    else if (entry.name.endsWith(".jsonl")) acc.push({ rel, name: entry.name });
  }
}

export async function listCodexSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const files: { rel: string; name: string }[] = [];
  await walk(source, ROOT, files);

  const sessions: ToolSession[] = [];
  for (const f of files) {
    try {
      const stat = await source.stat(f.rel);
      const messageCount = await source.lineCount(f.rel);
      // session_meta（首行）里带 cwd，用于按项目分组；读不到不影响列出。
      let project: string | undefined;
      try {
        project = extractCodexCwd(await source.readHead(f.rel, 4096));
      } catch {}
      sessions.push({
        id: f.name.replace(".jsonl", ""),
        title: f.name.replace(/^rollout-/, "").replace(/\.jsonl$/, "").replace(/-/g, " ").slice(0, 80),
        createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
        messageCount,
        project,
      });
    } catch {}
  }
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 从文件头取 session_meta 的 cwd（只看首行）。 */
function extractCodexCwd(head: string): string | undefined {
  const firstLine = head.split("\n").find((l) => l.trim());
  if (!firstLine) return undefined;
  try {
    const obj = JSON.parse(firstLine);
    const cwd = obj?.payload?.cwd ?? obj?.cwd;
    if (typeof cwd === "string" && cwd) return cwd;
  } catch {
    // meta 行内嵌 base_instructions，动辄几十 KB，readHead 截断后 JSON 不完整；
    // cwd 位于 payload 前部，用正则从未闭合的片段里抠出来。
    const m = firstLine.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1];
      }
    }
  }
  return undefined;
}

export async function readCodexSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (!(await source.exists(ROOT))) return [];
  const files: { rel: string; name: string }[] = [];
  await walk(source, ROOT, files);
  const hit = files.find(
    (f) => f.name === `${sessionId}.jsonl` || (sessionId && f.name.endsWith(".jsonl") && f.name.includes(sessionId))
  );
  if (!hit) return [];

  const messages: ConversationMessage[] = [];
  // 与 kimi 同一口径：assistant 侧按事件流累积，遇到下一条 user 消息或文件结束时 flush。
  let bufText = "";
  let bufThinking = "";
  let bufToolCalls: ToolCall[] = [];
  let bufTs = "";

  const flush = () => {
    if (!bufText.trim() && !bufThinking.trim() && !bufToolCalls.length) return;
    messages.push({
      id: `cx-asst-${messages.length}`,
      role: "assistant",
      content: bufText.trim(),
      timestamp: bufTs || new Date().toISOString(),
      thinking: bufThinking.trim() || undefined,
      toolCalls: bufToolCalls.length ? bufToolCalls : undefined,
      source: "codex",
    });
    bufText = "";
    bufThinking = "";
    bufToolCalls = [];
    bufTs = "";
  };

  // function_call_output / custom_tool_call_output 按 call_id 配回对应 toolCall；
  // 先找当前缓冲，再找已 flush 的消息（从后往前），防止跨 flush 边界漏配。
  const pairOutput = (callId: unknown, output: unknown) => {
    if (typeof callId !== "string" || !callId) return;
    const out = typeof output === "string" ? output : JSON.stringify(output ?? "");
    for (let i = bufToolCalls.length - 1; i >= 0; i--) {
      if (bufToolCalls[i].id === callId && !bufToolCalls[i].output) {
        bufToolCalls[i].output = out;
        return;
      }
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const tcs = messages[i].toolCalls;
      if (!tcs) continue;
      const match = tcs.find((tc) => tc.id === callId && !tc.output);
      if (match) {
        match.output = out;
        return;
      }
    }
  };

  const lines = (await source.readFile(hit.rel)).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      const obj = JSON.parse(lines[i]);
      const payload = obj.payload && typeof obj.payload === "object" ? obj.payload : obj;
      const ts = obj.timestamp ? new Date(obj.timestamp as string).toISOString() : new Date().toISOString();

      // 真实 rollout 格式：{"type":"response_item","payload":{...}}
      if (obj.type === "response_item") {
        if (payload.type === "message") {
          if (payload.role === "developer") continue; // developer 注入的指令不进对话
          const text = extractBlockText(payload.content);
          if (payload.role === "user") {
            // 真实文件首条 user 是 <environment_context> 包裹的环境信息，整条跳过
            if (/^<environment_context>[\s\S]*<\/environment_context>$/.test(text.trim())) continue;
            flush();
            messages.push({ id: `cx-${i}`, role: "user", content: text, timestamp: ts, source: "codex" });
          } else if (payload.role === "assistant") {
            if (!bufTs) bufTs = ts;
            if (text) bufText += text + "\n";
          }
        } else if (payload.type === "function_call") {
          if (!bufTs) bufTs = ts;
          bufToolCalls.push({
            id: typeof payload.call_id === "string" ? payload.call_id : undefined,
            name: typeof payload.name === "string" ? payload.name : "unknown",
            input: parseToolArguments(payload.arguments),
          });
        } else if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
          pairOutput(payload.call_id, payload.output);
        } else if (payload.type === "custom_tool_call") {
          if (!bufTs) bufTs = ts;
          const name = typeof payload.name === "string" ? payload.name : "unknown";
          const raw = typeof payload.input === "string" ? payload.input : JSON.stringify(payload.input ?? "");
          bufToolCalls.push({
            id: typeof payload.call_id === "string" ? payload.call_id : undefined,
            name,
            input: name === "apply_patch" ? { patch: raw } : { input: raw },
          });
        } else if (payload.type === "reasoning") {
          // encrypted_content 无法解密；取 summary，空时退回明文的 reasoning_text 内容块。
          const summary = extractBlockText(payload.summary) || extractBlockText(payload.content);
          if (summary) {
            if (!bufTs) bufTs = ts;
            bufThinking += summary + "\n";
          }
        }
        continue;
      }

      // 旧扁平格式：{type:"message", payload:{role, content:"..."}} 或 {payload:{role, content}}
      const type = obj.type || payload.type || "";
      const role = payload.role || type;
      const text = payload.content || payload.text || payload.message || "";
      if (role === "user" || type === "input" || (type === "message" && payload.role === "user")) {
        flush();
        messages.push({ id: `cx-${i}`, role: "user", content: typeof text === "string" ? text : JSON.stringify(text), timestamp: ts, source: "codex" });
      } else if (role === "assistant" || type === "output" || (type === "message" && payload.role === "assistant")) {
        flush();
        messages.push({ id: `cx-${i}`, role: "assistant", content: typeof text === "string" ? text : JSON.stringify(text), timestamp: ts, source: "codex" });
      }
    } catch {}
  }
  flush();
  return messages;
}

/** content 是 [{type:"input_text"|"output_text"|"summary_text", text}] 块列表，拼出纯文本。 */
function extractBlockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
    .filter(Boolean)
    .join("\n");
}

/** function_call 的 arguments 是 JSON 字符串；解析失败就原样包进 { arguments }。 */
function parseToolArguments(args: unknown): Record<string, unknown> {
  if (typeof args !== "string") return (args as Record<string, unknown>) || {};
  try {
    const parsed = JSON.parse(args);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  return { arguments: args };
}
