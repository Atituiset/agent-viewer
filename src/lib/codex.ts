import { parseCodexRollout } from "agent-session-format";
import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolSession } from "./types";
import { nirToConversation } from "./nir-map";

const ROOT = ".codex/sessions";

/** 并行收集 ROOT 下全部 .jsonl（目录树任意深度）；SSH 下旧串行递归是逐层一个 RTT。 */
async function collectJsonl(source: FileSource, dir: string, acc: { rel: string; name: string }[]): Promise<void> {
  let entries;
  try {
    entries = await source.readDir(dir);
  } catch {
    return; // 单层目录不可读只跳过该子树，不让整个工具归零
  }
  await Promise.all(
    entries.map(async (entry) => {
      const rel = join(dir, entry.name);
      if (entry.isDirectory) await collectJsonl(source, rel, acc);
      else if (entry.name.endsWith(".jsonl")) acc.push({ rel, name: entry.name });
    })
  );
}

/**
 * 按 sessionId 定位 codex 会话文件，结果按 source 缓存。
 * LIVE 轮询每 3s 会经过 stamp + read 两条路径各找一次文件，
 * 不缓存的话每次都是全树串行 walk（SSH 下 N 层 × RTT）。
 * 只缓存「找到」的结果：未命中的 sessionId 不缓存，新会话文件出现后仍能找到。
 */
const codexFileCache = new WeakMap<FileSource, Map<string, string>>();

export async function findCodexSessionFile(source: FileSource, sessionId: string): Promise<string | null> {
  let perSource = codexFileCache.get(source);
  if (!perSource) {
    perSource = new Map();
    codexFileCache.set(source, perSource);
  }
  const cached = perSource.get(sessionId);
  if (cached) return cached;
  if (!(await source.exists(ROOT))) return null;
  const files: { rel: string; name: string }[] = [];
  await collectJsonl(source, ROOT, files);
  const hit = files.find(
    (f) => f.name === `${sessionId}.jsonl` || (sessionId && f.name.endsWith(".jsonl") && f.name.includes(sessionId))
  );
  if (hit) perSource.set(sessionId, hit.rel);
  return hit ? hit.rel : null;
}

/** sessionId（= 文件名去 .jsonl）→ 实际文件名（含 .jsonl）。 */
function sessionIdToFileName(sessionId: string, files: { rel: string; name: string }[]): string {
  const hit = files.find((f) => f.name === `${sessionId}.jsonl`);
  return hit ? hit.name : `${sessionId}.jsonl`;
}

export async function listCodexSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const files: { rel: string; name: string }[] = [];
  await collectJsonl(source, ROOT, files);

  // 全并行采集（SSH 下旧实现每文件 3 个串行 RTT）。
  const sessions = await Promise.all(
    files.map(async (f): Promise<ToolSession | null> => {
      try {
        const [stat, messageCount, head] = await Promise.all([
          source.stat(f.rel),
          source.lineCount(f.rel),
          // session_meta（首行）里带 cwd，用于按项目分组；读不到不影响列出。
          source.readHead(f.rel, 4096).catch(() => ""),
        ]);
        return {
          id: f.name.replace(".jsonl", ""),
          title: f.name.replace(/^rollout-/, "").replace(/\.jsonl$/, "").replace(/-/g, " ").slice(0, 80),
          createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
          messageCount,
          project: extractCodexCwd(head),
        };
      } catch {
        return null;
      }
    })
  );
  // 顺手把 list 已经看到的文件回填缓存：后续 read/stamp 直接命中，不必再全树找。
  const perSource = codexFileCache.get(source);
  if (perSource) for (const s of sessions) if (s) perSource.set(s.id, join(ROOT, sessionIdToFileName(s.id, files)));
  return sessions
    .filter((s): s is ToolSession => !!s)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

/** detect 卡片用的轻量计数：只 readDir 数 .jsonl 文件名，不 stat/不读文件内容。 */
export async function countCodexSessions(source: FileSource): Promise<number> {
  if (!(await source.exists(ROOT))) return 0;
  const countDir = async (dir: string): Promise<number> => {
    let entries;
    try {
      entries = await source.readDir(dir);
    } catch {
      return 0;
    }
    // 子目录间并行递归，文件直接计数。
    const subCounts = await Promise.all(
      entries.map((e) => (e.isDirectory ? countDir(join(dir, e.name)) : Promise.resolve(e.name.endsWith(".jsonl") ? 1 : 0)))
    );
    return subCounts.reduce((a, b) => a + b, 0);
  };
  return countDir(ROOT);
}

export async function readCodexSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  const hit = await findCodexSessionFile(source, sessionId);
  if (!hit) return [];
  return parseCodexTranscript(await source.readFile(hit), sessionId);
}

/** 解析 codex 风格的 jsonl 转录（rollout 事件流）：包解析出 NIR，再映射成视图模型。 */
export function parseCodexTranscript(content: string, sessionId: string): ConversationMessage[] {
  const nir = parseCodexRollout(content, { source: "codex", id: sessionId });
  if (!nir) return [];
  return nirToConversation(nir, "codex");
}
