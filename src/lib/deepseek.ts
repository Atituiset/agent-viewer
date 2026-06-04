import fs from "fs";
import path from "path";
import os from "os";
import type { DeepSeekSession, ConversationMessage, ToolCall, ToolSession } from "./types";

function getDeepSeekRoot(): string {
  return path.join(os.homedir(), ".deepseek", "sessions");
}

export function listDeepSeekSessions(): ToolSession[] {
  const root = getDeepSeekRoot();
  if (!fs.existsSync(root)) return [];

  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const filePath = path.join(root, f);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const meta = data.metadata || {};
        return {
          id: meta.id || f.replace(".json", ""),
          title: meta.title || "Untitled",
          model: meta.model || "deepseek",
          directory: meta.workspace || "",
          createdAt: meta.created_at || new Date().toISOString(),
          messageCount: meta.message_count || (data.messages || []).length,
        };
      } catch {
        return {
          id: f.replace(".json", ""),
          title: "Untitled",
          model: "deepseek",
          createdAt: new Date().toISOString(),
          messageCount: 0,
        };
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readDeepSeekSession(sessionId: string): ConversationMessage[] {
  const root = getDeepSeekRoot();
  const filePath = path.join(root, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) {
    const match = fs.readdirSync(root).find((f) => f.startsWith(sessionId) && f.endsWith(".json"));
    if (!match) return [];
  }

  const actualPath = fs.existsSync(filePath) ? filePath : path.join(root, `${sessionId}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(actualPath, "utf-8"));
    const messages = data.messages || [];
    const result: ConversationMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role as string;
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

      if (role === "user" || role === "assistant") {
        result.push({
          id: `ds-${i}`,
          role: role as "user" | "assistant",
          content,
          timestamp: data.metadata?.created_at || new Date().toISOString(),
          source: "deepseek",
        });
      } else if (role === "tool" || msg.tool_calls) {
        const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc: { function: { name: string; arguments: string } }) => ({
          name: tc.function?.name || "unknown",
          input: (() => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return {}; } })(),
        }));
        const last = result[result.length - 1];
        if (last && last.role === "assistant") {
          last.toolCalls = [...(last.toolCalls || []), ...toolCalls];
        } else {
          result.push({
            id: `ds-tool-${i}`,
            role: "assistant",
            content: "",
            timestamp: data.metadata?.created_at || new Date().toISOString(),
            toolCalls,
            source: "deepseek",
          });
        }
      }
    }

    return result;
  } catch {
    return [];
  }
}
