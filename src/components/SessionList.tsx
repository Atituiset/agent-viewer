"use client";

import { useState } from "react";
import type { ToolSession, DetectedTool } from "@/lib/types";

interface Props {
  sessions: ToolSession[];
  tool: DetectedTool;
  onSelect: (session: ToolSession) => void;
  error?: string | null;
}

function timeAgo(ts: string | number): string {
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function SessionList({ sessions, tool, onSelect, error }: Props) {
  const [search, setSearch] = useState("");

  const filtered = search
    ? sessions.filter((s) => {
        const q = search.toLowerCase();
        return (
          (s.title || "").toLowerCase().includes(q) ||
          (s.project || "").toLowerCase().includes(q) ||
          (s.directory || "").toLowerCase().includes(q) ||
          (s.model || "").toLowerCase().includes(q)
        );
      })
    : sessions;

  const grouped = filtered.reduce<Record<string, ToolSession[]>>((acc, s) => {
    const key = s.project || s.directory || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
            style={{ backgroundColor: tool.color + "18" }}
          >
            {tool.icon}
          </span>
          <h1 className="text-2xl font-bold text-zinc-100">{tool.name} Sessions</h1>
        </div>
        <p className="text-sm text-zinc-500 mb-6">
          {filtered.length} session{filtered.length !== 1 ? "s" : ""} found
          {search && filtered.length !== sessions.length && ` (filtered from ${sessions.length})`}
        </p>

        {error && (
          <div className="mb-6 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            <span className="font-medium">Failed to list sessions:</span> {error}
          </div>
        )}

        <div className="relative mb-6">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, project, model..."
            className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg pl-10 pr-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 text-xs"
            >
              Clear
            </button>
          )}
        </div>

        {Object.entries(grouped).map(([group, groupSessions]) => (
          <div key={group} className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-3 px-1">
              {group.replace(/^\/home\/[^/]+/, "~")}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {groupSessions.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg border border-[var(--sidebar-border)] bg-zinc-900/40 hover:bg-zinc-900/80 hover:border-zinc-600 transition-all cursor-pointer p-4"
                  onClick={() => onSelect(s)}
                >
                  <div className="text-sm font-medium text-zinc-200 truncate leading-snug">
                    {s.title || "Untitled"}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-zinc-600">
                    <span>{timeAgo(s.createdAt)}</span>
                    <span>·</span>
                    <span>{s.messageCount} msgs</span>
                    {s.model && (
                      <>
                        <span>·</span>
                        <span className="truncate">{s.model}</span>
                      </>
                    )}
                    {s.cost != null && s.cost > 0 && (
                      <>
                        <span>·</span>
                        <span>${s.cost.toFixed(4)}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center text-zinc-600 py-20">
            <div className="text-4xl mb-3">📭</div>
            <p>{search ? "No sessions match your search." : "No sessions found for this tool."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
