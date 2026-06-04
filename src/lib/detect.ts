import fs from "fs";
import path from "path";
import os from "os";
import type { DetectedTool } from "./types";

const TOOL_DEFINITIONS = [
  {
    id: "claude-code",
    name: "Claude Code",
    icon: "🟠",
    color: "#f97316",
    description: "Anthropic Claude Code CLI sessions",
    detectPaths: [".claude/projects"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    icon: "🔵",
    color: "#3b82f6",
    description: "OpenCode CLI sessions",
    detectPaths: [".local/share/opencode/opencode.db"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    icon: "🟣",
    color: "#8b5cf6",
    description: "DeepSeek CLI sessions",
    detectPaths: [".deepseek/sessions"],
  },
  {
    id: "codex",
    name: "Codex",
    icon: "🟢",
    color: "#22c55e",
    description: "OpenAI Codex CLI sessions",
    detectPaths: [".codex/sessions"],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    icon: "🔷",
    color: "#06b6d4",
    description: "Google Gemini CLI conversations",
    detectPaths: [".gemini/antigravity-cli/conversations"],
  },
  {
    id: "agy",
    name: "Agy",
    icon: "🟡",
    color: "#eab308",
    description: "Agy agent sessions",
    detectPaths: [".agy/sessions"],
  },
  {
    id: "hermes",
    name: "Hermes",
    icon: "⚪",
    color: "#a1a1aa",
    description: "Hermes agent sessions",
    detectPaths: [".hermes/sessions"],
  },
];

export function detectTools(homeDir?: string): DetectedTool[] {
  const home = homeDir || os.homedir();

  return TOOL_DEFINITIONS.map((def) => {
    const detected = def.detectPaths.some((p) => {
      const fullPath = path.join(home, p);
      return fs.existsSync(fullPath);
    });

    let sessionCount = 0;
    if (detected) {
      try {
        sessionCount = countSessions(home, def.id);
      } catch {}
    }

    return {
      id: def.id,
      name: def.name,
      icon: def.icon,
      color: def.color,
      description: def.description,
      sessionCount,
      detected,
    };
  }).filter((t) => t.detected);
}

function countSessions(home: string, toolId: string): number {
  try {
    switch (toolId) {
      case "claude-code": {
        const root = path.join(home, ".claude", "projects");
        if (!fs.existsSync(root)) return 0;
        let count = 0;
        for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
          if (dir.isDirectory()) {
            const files = fs.readdirSync(path.join(root, dir.name)).filter((f) => f.endsWith(".jsonl"));
            count += files.length;
          }
        }
        return count;
      }
      case "opencode": {
        const dbPath = path.join(home, ".local", "share", "opencode", "opencode.db");
        if (!fs.existsSync(dbPath)) return 0;
        const Database = require("better-sqlite3");
        const tmpPath = path.join("/tmp", `opencode_viewer_cnt_${Date.now()}.db`);
        fs.copyFileSync(dbPath, tmpPath);
        const db = new Database(tmpPath, { readonly: true });
        const row = db.prepare("SELECT count(*) as c FROM session").get() as { c: number };
        db.close();
        try { fs.unlinkSync(tmpPath); } catch {}
        return row.c;
      }
      case "deepseek": {
        const dir = path.join(home, ".deepseek", "sessions");
        if (!fs.existsSync(dir)) return 0;
        return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
      }
      case "codex": {
        const dir = path.join(home, ".codex", "sessions");
        if (!fs.existsSync(dir)) return 0;
        let count = 0;
        function walk(d: string) {
          for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            if (entry.isDirectory()) walk(path.join(d, entry.name));
            else if (entry.name.endsWith(".jsonl")) count++;
          }
        }
        walk(dir);
        return count;
      }
      case "gemini": {
        const dir = path.join(home, ".gemini", "antigravity-cli", "conversations");
        if (!fs.existsSync(dir)) return 0;
        return fs.readdirSync(dir).length;
      }
      case "hermes": {
        const dir = path.join(home, ".hermes", "sessions");
        if (!fs.existsSync(dir)) return 0;
        return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
      }
      default:
        return 0;
    }
  } catch {
    return 0;
  }
}

export function getMachineName(): string {
  return os.hostname();
}

export function getMachineId(): string {
  return `local-${os.hostname()}`;
}
