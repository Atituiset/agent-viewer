import { parseSessionJsonDocument } from "agent-session-format";
import type { DirEntry, FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolSession } from "./types";
import { nirToConversation } from "./nir-map";

const ROOT = ".deepseek/sessions";

/** detect 卡片用的轻量计数：readDir 数 .json 文件名即可（listSessions 得整读每个文件）。 */
export async function countDeepSeekSessions(source: FileSource): Promise<number> {
  if (!(await source.exists(ROOT))) return 0;
  const entries = await source.readDir(ROOT).catch(() => [] as DirEntry[]);
  return entries.filter((f) => f.name.endsWith(".json")).length;
}

export async function listDeepSeekSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const out: Promise<ToolSession>[] = [];
  for (const f of await source.readDir(ROOT)) {
    if (!f.name.endsWith(".json")) continue;
    const fileRel = join(ROOT, f.name);
    // 文件间全并行；单文件坏档降级为占位条目而不是拖垮整个列表。
    out.push(
      (async (): Promise<ToolSession> => {
        try {
          const data = JSON.parse(await source.readFile(fileRel));
          const meta = data.metadata || {};
          return {
            id: meta.id || f.name.replace(".json", ""),
            title: meta.title || "Untitled",
            model: meta.model || "deepseek",
            directory: meta.workspace || "",
            createdAt: meta.created_at || new Date().toISOString(),
            messageCount: meta.message_count || (data.messages || []).length,
          };
        } catch {
          return { id: f.name.replace(".json", ""), title: "Untitled", model: "deepseek", createdAt: new Date().toISOString(), messageCount: 0 };
        }
      })()
    );
  }
  return (await Promise.all(out)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readDeepSeekSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (!(await source.exists(ROOT))) return [];
  let fileRel = join(ROOT, `${sessionId}.json`);
  if (!(await source.exists(fileRel))) {
    const match = (await source.readDir(ROOT)).find((f) => f.name.startsWith(sessionId) && f.name.endsWith(".json"));
    if (!match) return [];
    fileRel = join(ROOT, match.name);
  }
  const nir = parseSessionJsonDocument(await source.readFile(fileRel), { source: "deepseek", id: sessionId });
  if (!nir) return [];
  return nirToConversation(nir, "deepseek");
}
