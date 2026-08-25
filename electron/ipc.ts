import { ipcMain } from "electron";
import { loadMachines, addMachine, removeMachine } from "../src/lib/machines";
import { detectTools, getTool } from "../src/lib/detect";
import type { MachineConfig } from "../src/lib/types";
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
      return ok(await getTool(toolId).listSessions(src));
    } catch (e) {
      return err(e);
    }
  });

  ipcMain.handle("sessions:read", async (_e, machineId, toolId, sessionId, projectPath) => {
    try {
      const src = await getSource(machineById(machineId));
      return ok(await getTool(toolId).readSession(src, sessionId, projectPath));
    } catch (e) {
      return err(e);
    }
  });
}
