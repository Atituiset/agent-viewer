"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ConversationMessage } from "@/lib/types";
import MarkdownContent from "./MarkdownContent";
import ToolCallBlock from "./ToolCallBlock";

interface Props {
  messages: ConversationMessage[];
  compact?: boolean;
}

interface LaneDef {
  id: string;
  label: string;
  width: number;
}

const THINK_CLAMP = 240;
const CONTENT_CLAMP = 400;

/** user 消息（无 agent 归属）进 User 泳道，其余主进程消息进 Main，subagent 消息进各自泳道。 */
function laneOf(m: ConversationMessage): string {
  if (m.agent) return m.agent;
  return m.role === "user" ? "user" : "main";
}

/**
 * 交互时序视图：所有消息按时间排在共享纵轴上，各自落在所属泳道；
 * 相邻消息之间画箭头，跨泳道的交互（用户提问、Task 派生 subagent、
 * subagent 返回结果）在图上自然呈现为跨列箭头。
 */
export default function SwimlaneView({ messages, compact }: Props) {
  const sorted = useMemo(
    () => [...messages].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [messages]
  );

  const lanes = useMemo<LaneDef[]>(() => {
    const present = new Set(sorted.map(laneOf));
    const labels = new Map<string, string>();
    for (const m of sorted) {
      if (m.agent && m.agentLabel && !labels.has(m.agent)) labels.set(m.agent, m.agentLabel);
    }
    const order = ["user", "main", ...Array.from(present).filter((i) => i !== "user" && i !== "main").sort()];
    return order
      .filter((id) => present.has(id))
      .map((id) => ({
        id,
        label: labels.get(id) || (id === "user" ? "User" : id === "main" ? "Main" : id),
        width: id === "user" ? 200 : id === "main" ? 440 : 380,
      }));
  }, [sorted]);

  const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l.id, i])), [lanes]);

  // ---- 箭头测量：渲染后量每个节点的位置，画相邻节点的贝塞尔连线 ----
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<number, HTMLElement>());
  const [arrows, setArrows] = useState<{ key: number; d: string }[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  const relayout = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wrect = wrap.getBoundingClientRect();
    const pts: { x: number; top: number; bottom: number }[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const el = nodeRefs.current.get(i);
      if (!el) return; // 节点未齐，下轮再画
      const r = el.getBoundingClientRect();
      pts.push({ x: r.left - wrect.left + r.width / 2, top: r.top - wrect.top, bottom: r.bottom - wrect.top });
    }
    setSvgSize({ w: wrap.scrollWidth, h: wrap.scrollHeight });
    const out: { key: number; d: string }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const mid = (a.bottom + b.top) / 2;
      out.push({ key: i, d: `M ${a.x} ${a.bottom} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${b.top}` });
    }
    setArrows(out);
  }, [sorted]);

  useLayoutEffect(() => {
    relayout();
  }, [relayout, lanes, compact]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(relayout);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [relayout]);

  return (
    <div className="flex-1 overflow-auto scrollbar-thin px-6 py-6">
      <div ref={wrapRef} className="relative min-w-max mx-auto">
        <svg
          className="absolute inset-0 pointer-events-none z-0"
          width={svgSize.w}
          height={svgSize.h}
        >
          <defs>
            <marker id="lane-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#71717a" />
            </marker>
          </defs>
          {arrows.map((a) => (
            <path key={a.key} d={a.d} fill="none" stroke="#71717a" strokeWidth={1.5} markerEnd="url(#lane-arrow)" />
          ))}
        </svg>

        <div
          className="relative z-10 grid"
          style={{
            gridTemplateColumns: lanes.map((l) => `${l.width}px`).join(" "),
            columnGap: "32px",
            rowGap: "36px",
          }}
        >
          {lanes.map((l, i) => (
            <div
              key={l.id}
              style={{ gridColumn: i + 1, gridRow: 1 }}
              className="sticky top-0 z-20 px-3 py-2 rounded-lg bg-zinc-900/95 border border-[var(--sidebar-border)] text-xs font-medium text-zinc-300 text-center truncate"
              title={l.label}
            >
              {l.label}
            </div>
          ))}

          {/* 泳道中轴虚线 */}
          {lanes.map((l, i) => (
            <div
              key={`spine-${l.id}`}
              style={{ gridColumn: i + 1, gridRow: `2 / ${sorted.length + 2}` }}
              className="justify-self-center w-0 border-l border-dashed border-zinc-800"
            />
          ))}

          {sorted.map((m, i) => (
            <div
              key={m.id || i}
              ref={(el) => {
                if (el) nodeRefs.current.set(i, el);
                else nodeRefs.current.delete(i);
              }}
              style={{ gridColumn: (laneIndex.get(laneOf(m)) ?? 0) + 1, gridRow: i + 2 }}
            >
              <LaneNode msg={m} compact={compact} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ROLE_STYLE: Record<string, { label: string; ring: string }> = {
  user: { label: "User", ring: "border-blue-800/40" },
  assistant: { label: "Assistant", ring: "border-[var(--sidebar-border)]" },
  system: { label: "System", ring: "border-yellow-900/30" },
  tool: { label: "Tool", ring: "border-amber-900/30" },
};

function LaneNode({ msg, compact }: { msg: ConversationMessage; compact?: boolean }) {
  const [xContent, setXContent] = useState(false);
  const [xThink, setXThink] = useState(false);
  const style = ROLE_STYLE[msg.role] || ROLE_STYLE.assistant;
  const clampContent = compact && !xContent && msg.content.length > CONTENT_CLAMP;
  const clampThink = compact && !xThink && (msg.thinking?.length || 0) > THINK_CLAMP;

  return (
    <div className={`rounded-xl border bg-zinc-900/70 px-4 py-3 ${style.ring}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{style.label}</span>
        {msg.agentLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-300 border border-indigo-800/40 truncate">
            {msg.agentLabel}
          </span>
        )}
        <span className="text-[10px] text-zinc-600 ml-auto flex-shrink-0">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>

      {msg.thinking && (
        <div className="mb-2 rounded-lg bg-indigo-950/30 border border-indigo-900/30 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-indigo-400 mb-1">Thinking</div>
          <div className="text-xs text-indigo-200/70 whitespace-pre-wrap">
            {clampThink ? msg.thinking!.slice(0, THINK_CLAMP) + "…" : msg.thinking}
          </div>
          {compact && msg.thinking.length > THINK_CLAMP && (
            <button onClick={() => setXThink(!xThink)} className="text-[11px] text-indigo-400 hover:text-indigo-300 mt-1">
              {xThink ? "▴ 收起" : `▾ 展开（${msg.thinking.length.toLocaleString()} 字符）`}
            </button>
          )}
        </div>
      )}

      {msg.content && (
        <div className="text-sm">
          {clampContent ? (
            <div>
              <div className="whitespace-pre-wrap text-zinc-300 text-[13px]">
                {msg.content.slice(0, CONTENT_CLAMP)}…
              </div>
              <button onClick={() => setXContent(true)} className="text-[11px] text-blue-400 hover:text-blue-300 mt-1">
                ▾ 展开全文（{msg.content.length.toLocaleString()} 字符）
              </button>
            </div>
          ) : (
            <div>
              <MarkdownContent content={msg.content} />
              {compact && msg.content.length > CONTENT_CLAMP && (
                <button onClick={() => setXContent(false)} className="text-[11px] text-zinc-500 hover:text-zinc-300 mt-1">
                  ▴ 收起
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {msg.toolCalls && msg.toolCalls.length > 0 && (
        compact ? (
          <div className="mt-2 text-[11px] font-mono text-amber-400/90">
            ⚙ {msg.toolCalls.map((t) => t.name).join(", ")}
          </div>
        ) : (
          msg.toolCalls.map((tool, i) => <ToolCallBlock key={`${tool.name}-${i}`} tool={tool} />)
        )
      )}
    </div>
  );
}
