"use client";

import type { MachineConfig } from "@/lib/types";

interface Props {
  machines: MachineConfig[];
  onSelect: (machine: MachineConfig) => void;
  onRemove: (id: string) => void;
}

export default function MachineCards({ machines, onSelect, onRemove }: Props) {
  if (machines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600">
        <div className="text-center">
          <div className="text-5xl mb-4">🖥️</div>
          <h2 className="text-lg font-medium text-zinc-400">No Machines</h2>
          <p className="text-sm mt-2">Add a machine via SSH or open this app locally.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-100 mb-1">Machines</h1>
        <p className="text-sm text-zinc-500 mb-8">Select a machine to browse its agent sessions.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {machines.map((m) => (
            <div
              key={m.id}
              className="group relative rounded-xl border border-[var(--sidebar-border)] bg-zinc-900/60 hover:bg-zinc-900/90 hover:border-zinc-600 transition-all cursor-pointer overflow-hidden"
              onClick={() => onSelect(m)}
            >
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${
                      m.type === "local" ? "bg-emerald-900/30" : "bg-blue-900/30"
                    }`}>
                      {m.type === "local" ? "🏠" : "🖥️"}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-zinc-200">{m.name}</h3>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {m.type === "local" ? "Local machine" : `${m.user}@${m.host}:${m.port}`}
                      </p>
                    </div>
                  </div>
                  <span className={`w-2.5 h-2.5 rounded-full mt-1.5 ${
                    m.status === "online" ? "bg-green-500" : m.status === "offline" ? "bg-red-500" : "bg-zinc-500"
                  }`} />
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-600">
                  <span className="px-2 py-0.5 rounded bg-zinc-800 uppercase tracking-wider font-medium">
                    {m.type}
                  </span>
                  <span>{m.host}</span>
                </div>
              </div>
              {m.type !== "local" && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(m.id); }}
                  className="absolute top-3 right-3 text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 text-sm"
                  title="Remove machine"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
