import { contextBridge, ipcRenderer } from "electron";
import type { MachineConfig, DetectedTool, ToolSession, ConversationMessage } from "../src/lib/types";

const api = {
  machines: {
    list: (): Promise<{ data?: MachineConfig[]; error?: string }> => ipcRenderer.invoke("machines:list"),
    add: (cfg: Omit<MachineConfig, "id" | "status">): Promise<{ data?: MachineConfig; error?: string }> =>
      ipcRenderer.invoke("machines:add", cfg),
    remove: (id: string) => ipcRenderer.invoke("machines:remove", id),
  },
  tools: {
    detect: (machineId: string): Promise<{ data?: DetectedTool[]; error?: string }> =>
      ipcRenderer.invoke("tools:detect", machineId),
    /** 各工具的元数据（requiresProjectPath 等），UI 不再硬编码 toolId。 */
    meta: (): Promise<{ data?: { id: string; name: string; requiresProjectPath: boolean }[]; error?: string }> =>
      ipcRenderer.invoke("tools:meta"),
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
    /** 会话文件指纹（mtime），LIVE 轮询先比对再决定是否重读；null = 直接刷新。 */
    stamp: (
      machineId: string,
      toolId: string,
      sessionId: string,
      projectPath?: string
    ): Promise<{ data?: string | null; error?: string }> =>
      ipcRenderer.invoke("sessions:stamp", machineId, toolId, sessionId, projectPath),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type AgentViewerApi = typeof api;
