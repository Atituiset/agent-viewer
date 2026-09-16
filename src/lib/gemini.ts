import { parseAntigravityTranscript } from "agent-session-format";
import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolSession } from "./types";
import { nirToConversation } from "./nir-map";

const ROOT = ".gemini/antigravity-cli";

export async function listGeminiSessions(source: FileSource): Promise<ToolSession[]> {
  const historyPath = join(ROOT, "history.jsonl");
  if (!(await source.exists(historyPath))) return [];
  const sessions = new Map<string, ToolSession>();
  try {
    for (const line of (await source.readFile(historyPath)).split("\n").filter(Boolean)) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const id = entry.conversationId as string;
        if (!id) continue;
        const title = cleanTitle((entry.display as string) || "Untitled");
        const createdAt = new Date(entry.timestamp as number).toISOString();
        const directory = (entry.workspace as string) || "";
        const existing = sessions.get(id);
        if (!existing) sessions.set(id, { id, title, createdAt, messageCount: 1, directory });
        else {
          existing.messageCount += 1;
          if (createdAt < existing.createdAt) { existing.createdAt = createdAt; if (title !== "Untitled") existing.title = title; }
        }
      } catch {}
    }
  } catch {}
  return Array.from(sessions.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readGeminiSession(source: FileSource, conversationId: string): Promise<ConversationMessage[]> {
  const transcriptPath = join(ROOT, "brain", conversationId, ".system_generated", "logs", "transcript.jsonl");
  if (!(await source.exists(transcriptPath))) return [];
  let text: string;
  try {
    text = await source.readFile(transcriptPath);
  } catch {
    return [];
  }
  const nir = parseAntigravityTranscript(text, { source: "gemini", id: conversationId });
  if (!nir) return [];
  return nirToConversation(nir, "gemini");
}

function cleanTitle(text: string, maxLength = 80): string {
  if (!text || text === "Untitled") return "Untitled";
  const firstLine = text.split("\n").find((l) => l.trim()) || "";
  const cleaned = firstLine.replace(/\s+/g, " ").replace(/<[^>]+>/g, " ").trim();
  if (!cleaned) return "Untitled";
  return cleaned.length <= maxLength ? cleaned : cleaned.slice(0, maxLength).trimEnd() + "…";
}
