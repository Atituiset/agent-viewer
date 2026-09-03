"use client";

import { useState } from "react";
import type { ConversationMessage } from "@/lib/types";
import { useT } from "@/components/i18n";
import MarkdownContent from "./MarkdownContent";
import ToolCallBlock from "./ToolCallBlock";

interface Props {
  message: ConversationMessage;
  /** 摘要模式：长文折叠、工具调用合并为一行、thinking 隐藏。 */
  compact?: boolean;
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

const CLAMP_CHARS = 600;

export default function MessageBubble({ message, compact }: Props) {
  const t = useT();
  const [showThinking, setShowThinking] = useState(false);
  const [expandContent, setExpandContent] = useState(false);
  const [expandTools, setExpandTools] = useState(false);
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const style = SOURCE_STYLES[message.source] || { color: "text-zinc-400", label: message.source };
  const isLong = message.content.length > CLAMP_CHARS;

  const summarizeTools = (toolCalls: NonNullable<ConversationMessage["toolCalls"]>): string => {
    const counts = new Map<string, number>();
    for (const tc of toolCalls) counts.set(tc.name, (counts.get(tc.name) || 0) + 1);
    const parts = Array.from(counts.entries()).map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
    return t("msg.toolCallsSummary", { n: toolCalls.length, tools: parts.join(", ") });
  };

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
            {isUser ? t("role.user") : isSystem ? t("role.system") : style.label}
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

        {!compact && message.thinking && (
          <div className="mb-3">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <span className={`transition-transform ${showThinking ? "rotate-90" : ""}`}>▶</span>
              {t("msg.thinking", { n: message.thinking.length.toLocaleString() })}
            </button>
            {showThinking && (
              <div className="thinking-block mt-1.5 text-xs text-zinc-400 whitespace-pre-wrap max-h-80 overflow-y-auto scrollbar-thin">
                {message.thinking}
              </div>
            )}
          </div>
        )}

        {message.content && (
          compact && isLong && !expandContent ? (
            <div>
              <div className="max-h-36 overflow-hidden">
                <MarkdownContent content={message.content} />
              </div>
              <button
                onClick={() => setExpandContent(true)}
                className="text-[11px] text-blue-400 hover:text-blue-300 mt-1"
              >
                {t("msg.expandContent", { n: message.content.length.toLocaleString() })}
              </button>
            </div>
          ) : (
            <div>
              <MarkdownContent content={message.content} />
              {compact && isLong && (
                <button
                  onClick={() => setExpandContent(false)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 mt-1"
                >
                  {t("msg.collapse")}
                </button>
              )}
            </div>
          )
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          compact && !expandTools ? (
            <button
              onClick={() => setExpandTools(true)}
              className="mt-2 text-[11px] font-mono text-amber-400/90 hover:text-amber-300"
            >
              ⚙ {summarizeTools(message.toolCalls)} ▾
            </button>
          ) : (
            <div>
              {message.toolCalls.map((tool, i) => (
                <ToolCallBlock key={`${tool.name}-${i}`} tool={tool} />
              ))}
              {compact && (
                <button
                  onClick={() => setExpandTools(false)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 mt-1"
                >
                  {t("msg.collapseTools")}
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
