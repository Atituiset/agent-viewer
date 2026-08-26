import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolSession } from "./types";

const ROOT = ".codex/sessions";

async function walk(source: FileSource, dir: string, acc: { rel: string; name: string }[]) {
  for (const entry of await source.readDir(dir)) {
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
      sessions.push({
        id: f.name.replace(".jsonl", ""),
        title: f.name.replace(/^rollout-/, "").replace(/\.jsonl$/, "").replace(/-/g, " ").slice(0, 80),
        createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
        messageCount,
      });
    } catch {}
  }
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  const lines = (await source.readFile(hit.rel)).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      const obj = JSON.parse(lines[i]);
      const payload = obj.payload || obj;
      const type = obj.type || payload.type || "";
      const role = payload.role || type;
      const text = payload.content || payload.text || payload.message || "";
      const ts = obj.timestamp ? new Date(obj.timestamp as string).toISOString() : new Date().toISOString();
      if (role === "user" || type === "input" || (type === "message" && payload.role === "user")) {
        messages.push({ id: `cx-${i}`, role: "user", content: typeof text === "string" ? text : JSON.stringify(text), timestamp: ts, source: "codex" });
      } else if (role === "assistant" || type === "output" || (type === "message" && payload.role === "assistant")) {
        messages.push({ id: `cx-${i}`, role: "assistant", content: typeof text === "string" ? text : JSON.stringify(text), timestamp: ts, source: "codex" });
      }
    } catch {}
  }
  return messages;
}
