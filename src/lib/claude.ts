import { parseClaudeCodeTranscript } from "agent-session-format";
import type { DirEntry, FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ClaudeMessage, ConversationMessage, ToolSession } from "./types";
import { nirToConversation } from "./nir-map";

const ROOT = ".claude/projects";

/** detect 卡片用的轻量计数：readDir 数各 project 目录下的 .jsonl 文件名，不 stat/不读文件。
 *  旧口径是 listSessions().length——SSH 下等于为卡片上的数字把所有文件 stat+readHead+lineCount 拉一遍。 */
export async function countClaudeSessions(source: FileSource): Promise<number> {
  if (!(await source.exists(ROOT))) return 0;
  let entries: DirEntry[];
  try {
    entries = await source.readDir(ROOT);
  } catch {
    return 0;
  }
  // project 目录间并行。
  const counts = await Promise.all(
    entries
      .filter((e) => e.isDirectory)
      .map((e) => source.readDir(join(ROOT, e.name)).catch(() => [] as DirEntry[]))
  );
  return counts.reduce((n, files) => n + files.filter((f) => f.name.endsWith(".jsonl")).length, 0);
}

export async function listClaudeSessionsAll(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const entries = await source.readDir(ROOT);

  // 全并行：项目目录间并行、目录内文件间并行、单文件的 stat/head/lineCount 也同时发起。
  // SSH 场景下旧实现是 3×RTT×文件数串行，这里是几批并发。
  const perDir = await Promise.all(
    entries
      .filter((e) => e.isDirectory)
      .map(async (entry): Promise<ToolSession[]> => {
        const dirRel = join(ROOT, entry.name);
        const projectName = entry.name.replace(/^-/, "").replace(/-/g, "/").replace(/^home\/[^/]+\//, "~/");
        let files;
        try {
          files = await source.readDir(dirRel);
        } catch {
          return []; // 单个 project 目录不可读不该归零整个工具
        }
        const sessions = await Promise.all(
          files
            .filter((f) => f.name.endsWith(".jsonl"))
            .map(async (f): Promise<ToolSession | null> => {
              const fileRel = join(dirRel, f.name);
              try {
                const [stat, head, messageCount] = await Promise.all([
                  source.stat(fileRel),
                  // 只读前 8KB 取标题；行数走流式 lineCount——都不整文件拉回。
                  source.readHead(fileRel, 8192),
                  source.lineCount(fileRel),
                ]);
                return {
                  id: f.name.replace(".jsonl", ""),
                  title: extractClaudeTitle(head),
                  createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
                  messageCount,
                  project: projectName,
                  projectPath: entry.name,
                };
              } catch {
                return null;
              }
            })
        );
        return sessions.filter((s): s is ToolSession => !!s);
      })
  );

  return perDir
    .flat()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function extractClaudeTitle(content: string): string {
  try {
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const obj: ClaudeMessage = JSON.parse(line);
      if (obj.type === "ai-title") return (obj.aiTitle as string) || "Untitled";
    }
  } catch {}
  return "Untitled";
}

/** 注意参数顺序：(source, projectPath, sessionId) —— projectPath 在 sessionId 前，与其他解析器不同。 */
export async function readClaudeSession(
  source: FileSource,
  projectPath: string,
  sessionId: string
): Promise<ConversationMessage[]> {
  const fileRel = join(ROOT, projectPath, `${sessionId}.jsonl`);
  if (!(await source.exists(fileRel))) return [];

  const messages = parseClaudeTranscript(await source.readFile(fileRel), fileRel);

  // Task 工具 spawn 的 subagent 转录在 <sessionId>/subagents/agent-<id>.jsonl，
  // 行格式与主文件相同；agentId 从文件名取，显示名从同名 .meta.json 取。
  const subagentsDir = join(ROOT, projectPath, sessionId, "subagents");
  if (await source.exists(subagentsDir)) {
    let entries: DirEntry[];
    try {
      entries = await source.readDir(subagentsDir);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const match = /^agent-(.+)\.jsonl$/.exec(entry.name);
      if (!match) continue;
      const agentId = match[1];
      try {
        const agentLabel = await readAgentLabel(source, join(subagentsDir, `agent-${agentId}.meta.json`), agentId);
        // subagent 转录的每一行都带 isSidechain:true，而上游解析器会跳过
        // sidechain 行（那是针对主文件内联 sidechain 的规则）——独立文件场景下
        // 先把标记抹掉再解析。
        const sub = parseClaudeTranscript(
          stripSidechainFlag(await source.readFile(join(subagentsDir, entry.name))),
          join(subagentsDir, entry.name)
        );
        for (const msg of sub) {
          msg.agent = agentId;
          msg.agentLabel = agentLabel;
        }
        messages.push(...sub);
      } catch {} // 单个 subagent 文件坏了不影响主会话
    }
    messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  return messages;
}

/** 逐行把 "isSidechain":true 改为 false（仅对合法 JSON 行动手，坏行原样保留）。 */
function stripSidechainFlag(text: string): string {
  if (!text.includes('"isSidechain":true')) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes('"isSidechain":true')) return line;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        obj.isSidechain = false;
        return JSON.stringify(obj);
      } catch {
        return line;
      }
    })
    .join("\n");
}

async function readAgentLabel(source: FileSource, metaRel: string, agentId: string): Promise<string> {
  try {
    const meta = JSON.parse(await source.readFile(metaRel)) as { agentType?: unknown; description?: unknown };
    const type = typeof meta.agentType === "string" ? meta.agentType : "";
    const desc = typeof meta.description === "string" ? meta.description : "";
    if (type && desc) return `${type} · ${desc}`;
    if (type) return type;
  } catch {}
  return `agent-${agentId}`;
}

/** 解析单个 jsonl 转录文件（主会话与 subagent 转录格式一致）：包解析出 NIR，再映射成视图模型。 */
export function parseClaudeTranscript(content: string, filePath?: string): ConversationMessage[] {
  const nir = parseClaudeCodeTranscript(content, { source: "claude", filePath });
  if (!nir) return [];
  return nirToConversation(nir, "claude");
}
