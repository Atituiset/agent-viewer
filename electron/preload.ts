import { contextBridge, ipcRenderer } from "electron";
import type { MachineConfig, DetectedTool, ToolSession, ConversationMessage } from "../src/lib/types";

const api = {
  machines: {
    list: (): Promise<{ data?: MachineConfig[]; error?: string }> => ipcRenderer.invoke("machines:list"),
    add: (cfg: Omit<MachineConfig, "id" | "status">) => ipcRenderer.invoke("machines:add", cfg),
    remove: (id: string) => ipcRenderer.invoke("machines:remove", id),
  },
  tools: {
    detect: (machineId: string): Promise<{ data?: DetectedTool[]; error?: string }> =>
      ipcRenderer.invoke("tools:detect", machineId),
  },
  sessions: {
    list: (machineId: string, toolId: string): Promise<{ data?: ToolSession[]; error?: string }> =>
      ipcRenderer.invoke("sessions:list", machineId, toolId),
    read: (
      machineId: string,
      toolId: string,
      sessionId: string,
      projectPath?: string
    ): Promise<{ data?: ConversationMessage[]; error?: string }> =>
      ipcRenderer.invoke("sessions:read", machineId, toolId, sessionId, projectPath),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type AgentViewerApi = typeof api;
