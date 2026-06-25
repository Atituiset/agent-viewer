"use client";

import type { DetectedTool, MachineConfig } from "@/lib/types";

interface Props {
  tools: DetectedTool[];
  machine: MachineConfig;
  onSelect: (tool: DetectedTool) => void;
  error?: string | null;
}

export default function ToolCards({ tools, machine, onSelect, error }: Props) {
  if (tools.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 p-6">
        <div className="text-center max-w-lg w-full">
          <div className="text-5xl mb-4">{error ? "⚠️" : "🔍"}</div>
          <h2 className="text-lg font-medium text-zinc-400">
            {error ? "读取失败 / Connection Failed" : "No Agent Tools Found"}
          </h2>
          <p className="text-sm mt-2">
            {error
              ? `无法从 ${machine.name} 读取工具列表。`
              : "No supported agent tools detected on this machine."}
          </p>
          {error && (
            <pre className="mt-4 text-left text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {error}
            </pre>
          )}
          {error && (
            <p className="text-xs text-zinc-500 mt-3">
              若是 SSH 远程：检查目标机器 sshd 是否在跑（<code className="text-zinc-400">sudo service ssh start</code>）、账号密码/密钥是否正确、网络/防火墙是否可达。
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-100 mb-1">Agent Tools</h1>
        <p className="text-sm text-zinc-500 mb-8">
          Detected on <span className="text-zinc-300">{machine.name}</span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {tools.map((tool) => (
            <div
              key={tool.id}
              className="group rounded-xl border border-[var(--sidebar-border)] bg-zinc-900/60 hover:bg-zinc-900/90 transition-all cursor-pointer overflow-hidden"
              onClick={() => onSelect(tool)}
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
                    <span className="text-zinc-300 font-medium">{tool.sessionCount}</span> sessions
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
