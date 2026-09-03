"use client";

import type { DetectedTool, MachineConfig } from "@/lib/types";
import { useT } from "@/components/i18n";

interface Props {
  tools: DetectedTool[];
  machine: MachineConfig;
  onSelect: (tool: DetectedTool) => void;
  error?: string | null;
}

export default function ToolCards({ tools, machine, onSelect, error }: Props) {
  const t = useT();
  if (tools.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 p-6">
        <div className="text-center max-w-lg w-full">
          <div className="text-5xl mb-4">{error ? "⚠️" : "🔍"}</div>
          <h2 className="text-lg font-medium text-zinc-400">
            {error ? t("tools.error.title") : t("tools.empty.title")}
          </h2>
          <p className="text-sm mt-2">
            {error ? t("tools.error.body", { machine: machine.name }) : t("tools.empty.body")}
          </p>
          {error && (
            <pre className="mt-4 text-left text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {error}
            </pre>
          )}
          {error && machine.type === "ssh" && (
            <p className="text-xs text-zinc-500 mt-3">{t("tools.error.sshHint")}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-100 mb-1">{t("tools.title")}</h1>
        <p className="text-sm text-zinc-500 mb-8">
          {t("tools.detectedOn")} <span className="text-zinc-300">{machine.name}</span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {tools.map((tool) => (
            <div
              key={tool.id}
              role="button"
              tabIndex={0}
              aria-label={`${tool.name} — ${tool.sessionCount} ${t("tools.sessions")}`}
              className="group rounded-xl border border-[var(--sidebar-border)] bg-zinc-900/60 hover:bg-zinc-900/90 transition-all cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              onClick={() => onSelect(tool)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(tool);
                }
              }}
            >
              <div className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="w-11 h-11 rounded-lg flex items-center justify-center text-xl"
                    style={{ backgroundColor: tool.color + "18" }}
                  >
                    {tool.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-zinc-200">{tool.name}</h3>
                    <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{tool.description}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-zinc-600">
                    <span className="text-zinc-300 font-medium">{tool.sessionCount}</span> {t("tools.sessions")}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: tool.color }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
