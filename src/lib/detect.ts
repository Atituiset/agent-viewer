import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { DetectedTool } from "./types";

const TOOL_DEFINITIONS = [
  { id: "claude-code", name: "Claude Code", icon: "🟠", color: "#f97316", description: "Anthropic Claude Code CLI sessions", detectPaths: [".claude/projects"] },
  { id: "opencode", name: "OpenCode", icon: "🔵", color: "#3b82f6", description: "OpenCode CLI sessions", detectPaths: [".local/share/opencode/opencode.db"] },
  { id: "deepseek", name: "DeepSeek", icon: "🟣", color: "#8b5cf6", description: "DeepSeek CLI sessions", detectPaths: [".deepseek/sessions"] },
  { id: "codex", name: "Codex", icon: "🟢", color: "#22c55e", description: "OpenAI Codex CLI sessions", detectPaths: [".codex/sessions"] },
  { id: "gemini", name: "Gemini CLI", icon: "🔷", color: "#06b6d4", description: "Google Gemini CLI conversations", detectPaths: [".gemini/antigravity-cli"] },
  { id: "hermes", name: "Hermes", icon: "⚪", color: "#a1a1aa", description: "Hermes agent sessions", detectPaths: [".hermes/sessions"] },
];

export async function detectTools(source: FileSource): Promise<DetectedTool[]> {
  const out: DetectedTool[] = [];
  for (const def of TOOL_DEFINITIONS) {
    const detected = await Promise.any(def.detectPaths.map((p) => source.exists(p).then((ok) => { if (!ok) throw new Error("no"); return p; }))).then(() => true).catch(() => false);
    let sessionCount = 0;
    if (detected) {
      try { sessionCount = await countSessions(source, def.id); } catch {}
    }
    out.push({ id: def.id, name: def.name, icon: def.icon, color: def.color, description: def.description, sessionCount, detected });
  }
  return out.filter((t) => t.detected);
}

async function countSessions(source: FileSource, toolId: string): Promise<number> {
  switch (toolId) {
    case "claude-code": {
      if (!(await source.exists(".claude/projects"))) return 0;
      let count = 0;
      for (const dir of await source.readDir(".claude/projects")) {
        if (!dir.isDirectory) continue;
        const files = await source.readDir(join(".claude/projects", dir.name));
        count += files.filter((f) => f.name.endsWith(".jsonl")).length;
      }
      return count;
    }
    case "opencode": return (await source.exists(".local/share/opencode/opencode.db")) ? 1 : 0;
    case "deepseek": return (await source.exists(".deepseek/sessions")) ? (await source.readDir(".deepseek/sessions")).filter((f) => f.name.endsWith(".json")).length : 0;
    case "codex": {
      if (!(await source.exists(".codex/sessions"))) return 0;
      let count = 0;
      async function walk(d: string) { for (const e of await source.readDir(d)) { if (e.isDirectory) await walk(join(d, e.name)); else if (e.name.endsWith(".jsonl")) count++; } }
      await walk(".codex/sessions");
      return count;
    }
    case "gemini": return (await source.exists(".gemini/antigravity-cli/history.jsonl")) ? 1 : 0;
    case "hermes": return (await source.exists(".hermes/sessions/sessions.json")) ? 1 : 0;
    default: return 0;
  }
}

export function getMachineName(): string { return ""; }
