import type { AgentViewerApi } from "./preload";
declare global {
  interface Window {
    api: AgentViewerApi;
  }
}
export {};
