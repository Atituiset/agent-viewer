"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import type { ConversationMessage, ToolSession, DetectedTool } from "@/lib/types";
import MessageBubble from "./MessageBubble";

interface Props {
  messages: ConversationMessage[];
  sessionMeta?: ToolSession | null;
  tool?: DetectedTool | null;
}

export default function ConversationView({ messages, sessionMeta, tool }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevSessionIdRef = useRef<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return messages;
    const q = search.toLowerCase();
    return messages.filter((msg) => {
      if (msg.role.toLowerCase().includes(q)) return true;
      if (msg.content.toLowerCase().includes(q)) return true;
      if (msg.thinking && msg.thinking.toLowerCase().includes(q)) return true;
      if (msg.toolCalls?.some((tc) => tc.name.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [messages, search]);

  const currentSessionId = sessionMeta?.id ?? null;
  useEffect(() => {
    if (currentSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = currentSessionId;
      scrollRef.current?.scrollTo({ top: 0 });
    }
  }, [currentSessionId]);

  return (
    <div className="flex flex-col h-full">
      {sessionMeta && (
        <div className="flex-shrink-0 border-b border-[var(--sidebar-border)] px-6 py-3 bg-zinc-900/30">
          <div className="flex gap-5 text-xs text-zinc-500 flex-wrap">
            {tool && (
              <span className="flex items-center gap-1.5">
                <span style={{ color: tool.color }}>{tool.icon}</span>
                {tool.name}
              </span>
            )}
            {sessionMeta.model && <span>Model: {sessionMeta.model}</span>}
            {sessionMeta.tokensInput != null && <span>Input: {sessionMeta.tokensInput.toLocaleString()}</span>}
            {sessionMeta.tokensOutput != null && <span>Output: {sessionMeta.tokensOutput.toLocaleString()}</span>}
            {sessionMeta.cost != null && sessionMeta.cost > 0 && <span>Cost: ${sessionMeta.cost.toFixed(4)}</span>}
            {sessionMeta.directory && (
              <span className="truncate" title={sessionMeta.directory}>
                Dir: {sessionMeta.directory}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex-shrink-0 px-6 py-2 border-b border-[var(--sidebar-border)] bg-zinc-900/20">
        <div className="max-w-5xl mx-auto relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter messages by content, role, tool..."
            className="w-full bg-zinc-800/40 border border-zinc-700/30 rounded-lg pl-10 pr-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          {search && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <span className="text-[11px] text-zinc-500">{filtered.length}/{messages.length}</span>
              <button
                onClick={() => setSearch("")}
                className="text-zinc-600 hover:text-zinc-400 text-xs"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-6 py-8">
        <div className="max-w-5xl mx-auto space-y-5">
          {filtered.map((msg, i) => (
            <MessageBubble key={msg.id || i} message={msg} />
          ))}
          {filtered.length === 0 && messages.length > 0 && (
            <div className="text-center text-zinc-600 py-16">
              <p>No messages match your filter.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
