import { ipcMain } from "electron";
import { loadMachines, addMachine, removeMachine } from "../src/lib/machines";
import { detectTools } from "../src/lib/detect";
import { listClaudeSessionsAll, readClaudeSession } from "../src/lib/claude";
import { listCodexSessions, readCodexSession } from "../src/lib/codex";
import { listOpenCodeSessions, readOpenCodeSession } from "../src/lib/opencode";
import { listGeminiSessions, readGeminiSession } from "../src/lib/gemini";
import { listDeepSeekSessions, readDeepSeekSession } from "../src/lib/deepseek";
import { listHermesSessions, readHermesSession } from "../src/lib/hermes";
import type { ConversationMessage, MachineConfig, ToolSession } from "../src/lib/types";
import type { FileSource } from "./fs-source/types";
import { getSource, disposeSource } from "./source-manager";

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

export function registerIpc() {
  ipcMain.handle("machines:list", () => ok(loadMachines()));
  ipcMain.handle("machines:add", (_e, cfg) => {
    try {
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

  ipcMain.handle("tools:detect", async (_e, machineId) => {
    try {
      return ok(await detectTools(await getSource(machineById(machineId))));
    } catch (e) {
      return err(e);
    }
  });

  ipcMain.handle("sessions:list", async (_e, machineId, toolId) => {
    try {
      const src = await getSource(machineById(machineId));
      return ok(await listByTool(src, toolId));
    } catch (e) {
      return err(e);
    }
  });

  ipcMain.handle("sessions:read", async (_e, machineId, toolId, sessionId, projectPath) => {
    try {
      const src = await getSource(machineById(machineId));
      return ok(await readByTool(src, toolId, sessionId, projectPath));
    } catch (e) {
      return err(e);
    }
  });
}

async function listByTool(src: FileSource, toolId: string): Promise<ToolSession[]> {
  switch (toolId) {
    case "claude-code":
      return listClaudeSessionsAll(src);
    case "codex":
      return listCodexSessions(src);
    case "opencode":
      return listOpenCodeSessions(src);
    case "gemini":
      return listGeminiSessions(src);
    case "deepseek":
      return listDeepSeekSessions(src);
    case "hermes":
      return listHermesSessions(src);
    default:
      throw new Error("unknown tool: " + toolId);
  }
}

async function readByTool(
  src: FileSource,
  toolId: string,
  sessionId: string,
  projectPath?: string
): Promise<ConversationMessage[]> {
  switch (toolId) {
    case "claude-code":
      return readClaudeSession(src, projectPath || "", sessionId);
    case "codex":
      return readCodexSession(src, sessionId);
    case "opencode":
      return readOpenCodeSession(src, sessionId);
    case "gemini":
      return readGeminiSession(src, sessionId);
    case "deepseek":
      return readDeepSeekSession(src, sessionId);
    case "hermes":
      return readHermesSession(src, sessionId);
    default:
      throw new Error("unknown tool: " + toolId);
  }
}
