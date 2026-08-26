import { ipcMain } from "electron";
import { loadMachines, addMachine, removeMachine } from "../src/lib/machines";
import { detectTools, getTool, TOOLS } from "../src/lib/detect";
import { join } from "../electron/fs-source/util";
import type { DetectedTool, MachineConfig } from "../src/lib/types";
import { getSources, disposeSource } from "./source-manager";

function ok<T>(v: T) {
  return { data: v };
}
function err(e: unknown) {
  return { error: String(e) };
}

function machineById(id: string): MachineConfig {
  const m = loadMachines().find((x) => x.id === id);
  if (!m) throw new Error("machine not found: " + id);
  return m;
}

/**
 * 会话文件的轻量指纹（mtime+size），LIVE 轮询先比对它，变了才重读全文。
 * 返回 null 表示无法定位文件（如 sqlite 存储的 opencode）——调用方回退为直接刷新。
 */
async function sessionStamp(
  src: FileSourceLike,
  toolId: string,
  sessionId: string,
  projectPath?: string
): Promise<string | null> {
  let fileRel: string | null = null;
  switch (toolId) {
    case "claude-code":
      if (projectPath) fileRel = join(".claude/projects", projectPath, `${sessionId}.jsonl`);
      break;
    case "codex": {
      // codex 文件在日期子目录里：walk 找到目标。
      const found = await findCodexFile(src, sessionId);
      fileRel = found;
      break;
    }
    case "deepseek":
      fileRel = join(".deepseek/sessions", `${sessionId}.json`);
      if (!(await src.exists(fileRel))) {
        const match = (await src.readDir(".deepseek/sessions")).find(
          (f) => f.name.startsWith(sessionId) && f.name.endsWith(".json")
        );
        fileRel = match ? join(".deepseek/sessions", match.name) : null;
      }
      break;
    case "gemini":
      fileRel = join(".gemini/antigravity-cli", "brain", sessionId, ".system_generated", "logs", "transcript.jsonl");
      break;
    default:
      return null; // opencode(sqlite)、hermes(dump 轮转)：回退直接刷新
  }
  if (!fileRel || !(await src.exists(fileRel))) return null;
  try {
    const st = await src.stat(fileRel);
    return `${st.mtime.getTime()}`;
  } catch {
    return null;
  }
}

async function findCodexFile(src: FileSourceLike, sessionId: string): Promise<string | null> {
  const walk = async (dir: string): Promise<string | null> => {
    for (const e of await src.readDir(dir)) {
      const rel = join(dir, e.name);
      if (e.isDirectory) {
        const hit = await walk(rel);
        if (hit) return hit;
      } else if (e.name === `${sessionId}.jsonl` || e.name.includes(sessionId)) {
        return rel;
      }
    }
    return null;
  };
  return walk(".codex/sessions");
}

type FileSourceLike = import("./fs-source/types").FileSource;

/** 逐 source 运行 detectTools 后按 tool.id 合并：detected 取或，sessionCount 求和。 */
async function detectAcross(sources: FileSourceLike[]) {
  const perSource = await Promise.all(sources.map((s) => detectTools(s).catch(() => [])));
  const merged = new Map<string, DetectedTool>();
  for (const tools of perSource) {
    for (const t of tools) {
      const prev = merged.get(t.id);
      if (prev) prev.sessionCount += t.sessionCount;
      else merged.set(t.id, { ...t });
    }
  }
  return Array.from(merged.values());
}

/** 定位包含目标 session 文件的 source；定位不到返回 null（由调用方回退）。 */
async function locateSource(
  sources: FileSourceLike[],
  toolId: string,
  sessionId: string,
  projectPath?: string
): Promise<FileSourceLike | null> {
  for (const src of sources) {
    try {
      if ((await sessionStamp(src, toolId, sessionId, projectPath)) !== null) return src;
    } catch {}
  }
  return null;
}

export function registerIpc() {
  ipcMain.handle("machines:list", () => ok(loadMachines()));
  ipcMain.handle("machines:add", (_e, cfg) => {
    try {
      if (
        !cfg ||
        typeof cfg.host !== "string" ||
        typeof cfg.user !== "string" ||
        typeof cfg.port !== "number"
      ) {
        return err(new Error("invalid machine config"));
      }
      return ok(addMachine(cfg));
    } catch (e) {
      return err(e);
    }
  });
  ipcMain.handle("machines:remove", async (_e, id) => {
    try {
      removeMachine(id);
      await disposeSource(id);
      return ok({ ok: true });
    } catch (e) {
      return err(e);
    }
  });

  ipcMain.handle("tools:meta", () =>
    ok(TOOLS.map((t) => ({ id: t.id, name: t.name, requiresProjectPath: !!t.requiresProjectPath })))
  );

  ipcMain.handle("tools:detect", async (_e, machineId) => {
    try {
      return ok(await detectAcross(await getSources(machineById(machineId))));
    } catch (e) {
      return err(e);
    }
  });

  ipcMain.handle("sessions:list", async (_e, machineId, toolId) => {
    try {
      const sources = await getSources(machineById(machineId));
      const tool = getTool(toolId);
      const lists = await Promise.all(sources.map((s) => tool.listSessions(s).catch(() => [])));
      const seen = new Set<string>();
      const merged = [];
      for (const s of lists.flat()) {
        const key = `${s.id}${s.projectPath ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(s);
      }
      merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return ok(merged);
    } catch (e) {
      return err(e);
    }
  });

  ipcMain.handle("sessions:stamp", async (_e, machineId, toolId, sessionId, projectPath) => {
    try {
      const sources = await getSources(machineById(machineId));
      for (const src of sources) {
        const stamp = await sessionStamp(src, toolId, sessionId, projectPath);
        if (stamp !== null) return ok(stamp);
      }
      return ok(null);
    } catch (e) {
      return err(e);
    }
  });

  ipcMain.handle("sessions:read", async (_e, machineId, toolId, sessionId, projectPath) => {
    try {
      const sources = await getSources(machineById(machineId));
      const tool = getTool(toolId);
      // 先按文件指纹定位到具体的 source；定位不到（opencode sqlite / hermes）逐 source 尝试。
      const located = await locateSource(sources, toolId, sessionId, projectPath);
      if (located) return ok(await tool.readSession(located, sessionId, projectPath));
      for (const src of sources) {
        const msgs = await tool.readSession(src, sessionId, projectPath).catch(() => []);
        if (msgs.length) return ok(msgs);
      }
      return ok([]);
    } catch (e) {
      return err(e);
    }
  });
}
