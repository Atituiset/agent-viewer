"use client";

import { useState } from "react";
import type { ConversationMessage } from "@/lib/types";
import MarkdownContent from "./MarkdownContent";
import ToolCallBlock from "./ToolCallBlock";

interface Props {
  message: ConversationMessage;
}

const SOURCE_STYLES: Record<string, { color: string; label: string }> = {
  "claude-code": { color: "text-orange-400", label: "Claude" },
  opencode: { color: "text-emerald-400", label: "OpenCode" },
  deepseek: { color: "text-violet-400", label: "DeepSeek" },
  codex: { color: "text-green-400", label: "Codex" },
  claude: { color: "text-orange-400", label: "Claude" },
  kimi: { color: "text-yellow-400", label: "Kimi" },
  "kimi-code": { color: "text-yellow-400", label: "Kimi" },
  hermes: { color: "text-zinc-300", label: "Hermes" },
  gemini: { color: "text-cyan-400", label: "Gemini" },
};

export default function MessageBubble({ message }: Props) {
  const [showThinking, setShowThinking] = useState(false);
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const style = SOURCE_STYLES[message.source] || { color: "text-zinc-400", label: message.source };

  return (
    <div className={`${isUser ? "ml-auto max-w-[88%]" : "mr-auto max-w-full"}`}>
      <div
        className={`rounded-xl px-5 py-3.5 ${
          isUser
            ? "bg-[var(--user-bg)] border border-blue-800/30"
            : isSystem
            ? "bg-yellow-900/10 border border-yellow-900/20"
            : "bg-[var(--assistant-bg)] border border-[var(--sidebar-border)]"
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${
            isUser ? "text-blue-400" : isSystem ? "text-yellow-500" : style.color
          }`}>
            {isUser ? "User" : isSystem ? "System" : style.label}
          </span>
          {message.agentLabel && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-300 border border-indigo-800/40">
              {message.agentLabel}
            </span>
          )}
          <span className="text-[10px] text-zinc-600">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>

        {message.thinking && (
          <div className="mb-3">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <span className={`transition-transform ${showThinking ? "rotate-90" : ""}`}>▶</span>
              Thinking ({message.thinking.length.toLocaleString()} chars)
            </button>
            {showThinking && (
              <div className="thinking-block mt-1.5 text-xs text-zinc-400 whitespace-pre-wrap max-h-80 overflow-y-auto scrollbar-thin">
                {message.thinking}
              </div>
            )}
          </div>
        )}

        {message.content && <MarkdownContent content={message.content} />}

        {message.toolCalls?.map((tool, i) => (
          <ToolCallBlock key={`${tool.name}-${i}`} tool={tool} />
        ))}
      </div>
    </div>
  );
}
