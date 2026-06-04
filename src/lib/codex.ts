import fs from "fs";
import path from "path";
import os from "os";
import type { CodexSession, ConversationMessage, ToolSession } from "./types";

function getCodexRoot(): string {
  return path.join(os.homedir(), ".codex", "sessions");
}

export function listCodexSessions(): ToolSession[] {
  const root = getCodexRoot();
  if (!fs.existsSync(root)) return [];

  const sessions: ToolSession[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".jsonl")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split("\n").filter((l) => l.trim());
          const title = entry.name.replace(/^rollout-/, "").replace(/\.jsonl$/, "").replace(/-/g, " ");
          sessions.push({
            id: entry.name.replace(".jsonl", ""),
            title: title.slice(0, 80),
            createdAt: fs.statSync(fullPath).birthtime.toISOString(),
            messageCount: lines.length,
          });
        } catch {}
      }
    }
  }
  walk(root);
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readCodexSession(sessionId: string): ConversationMessage[] {
  const root = getCodexRoot();
  if (!fs.existsSync(root)) return [];

  let filePath = "";
  function find(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) find(fp);
      else if (entry.name === `${sessionId}.jsonl` || (sessionId && entry.name.endsWith(".jsonl") && entry.name.includes(sessionId))) {
        filePath = fp;
      }
    }
  }
  find(root);
  if (!filePath) return [];

  const messages: ConversationMessage[] = [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      const obj = JSON.parse(lines[i]);
      const payload = obj.payload || obj;
      const type = obj.type || payload.type || "";
      const role = payload.role || type;

      if (role === "user" || type === "input" || type === "message" && payload.role === "user") {
        const text = payload.content || payload.text || payload.message || "";
        messages.push({
          id: `cx-${i}`,
          role: "user",
          content: typeof text === "string" ? text : JSON.stringify(text),
          timestamp: obj.timestamp ? new Date(obj.timestamp as string).toISOString() : new Date().toISOString(),
          source: "codex",
        });
      } else if (role === "assistant" || type === "output" || (type === "message" && payload.role === "assistant")) {
        const text = payload.content || payload.text || payload.message || "";
        messages.push({
          id: `cx-${i}`,
          role: "assistant",
          content: typeof text === "string" ? text : JSON.stringify(text),
          timestamp: obj.timestamp ? new Date(obj.timestamp as string).toISOString() : new Date().toISOString(),
          source: "codex",
        });
      }
    } catch {}
  }

  return messages;
}
