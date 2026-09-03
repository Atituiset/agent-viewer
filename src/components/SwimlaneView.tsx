"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ConversationMessage } from "@/lib/types";
import { useT, type MsgKey } from "@/components/i18n";
import MarkdownContent from "./MarkdownContent";
import ToolCallBlock from "./ToolCallBlock";

interface Props {
  messages: ConversationMessage[];
  compact?: boolean;
}

interface LaneDef {
  id: string;
  label: string;
  /** user/main 泳道用 i18n key，渲染时翻译。 */
  labelKey?: MsgKey;
  width: number;
}

const THINK_CLAMP = 240;
const CONTENT_CLAMP = 400;
const COL_GAP = 32;
const ROW_GAP = 36;

/** user 消息（无 agent 归属）进 User 泳道，其余主进程消息进 Main，subagent 消息进各自泳道。 */
function laneOf(m: ConversationMessage): string {
  if (m.agent) return m.agent;
  return m.role === "user" ? "user" : "main";
}

/**
 * 交互时序视图：所有消息按时间排在共享纵轴上，各自落在所属泳道；
 * 相邻消息之间画箭头，跨泳道的交互（用户提问、Task 派生 subagent、
 * subagent 返回结果）在图上自然呈现为跨列箭头。
 *
 * 性能设计：旧实现对每个节点 getBoundingClientRect 测量再画箭头，
 * 全量挂载在大会话下不可用。现在：
 * - x 方向是纯函数——列宽/间距固定，不量 DOM；
 * - y 方向用 virtualizer 的 start + ResizeObserver 实测高度；
 * - 只渲染视口附近的节点，箭头在两者都已知时直接由几何算出。
 */
export default function SwimlaneView({ messages, compact }: Props) {
  const t = useT();
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
        label: labels.get(id) || id,
        labelKey: id === "user" ? ("swimlane.user" as const) : id === "main" ? ("swimlane.main" as const) : undefined,
        width: id === "user" ? 200 : id === "main" ? 440 : 380,
      }));
  }, [sorted]);

  const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l.id, i])), [lanes]);

  // 列几何：x 方向不用量 DOM。cols[i] = 第 i 泳道的 left/center/width。
  const geometry = useMemo(() => {
    let x = 0;
    const cols = lanes.map((l) => {
      const c = { left: x, width: l.width, center: x + l.width / 2 };
      x += l.width + COL_GAP;
      return c;
    });
    return { cols, width: lanes.length ? x - COL_GAP : 0 };
  }, [lanes]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual 未在 React Compiler 兼容清单内的误报（同 ConversationView）
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 180,
    overscan: 8,
    getItemKey: (i) => sorted[i].id || i,
  });
  const items = virtualizer.getVirtualItems();

  // 节点垂直位置（可见窗口内已知）；箭头在相邻两点都已知时才画——
  // 未知的点必在可视范围外，画出来也看不见。
  const arrows = useMemo(() => {
    const pos = new Map<number, { start: number; size: number }>();
    for (const vi of items) pos.set(vi.index, { start: vi.start, size: vi.size });
    const out: { key: number; d: string }[] = [];
    for (const [i, a] of pos) {
      const b = pos.get(i + 1);
      if (!b) continue;
      const colA = geometry.cols[laneIndex.get(laneOf(sorted[i])) ?? 0];
      const colB = geometry.cols[laneIndex.get(laneOf(sorted[i + 1])) ?? 0];
      const yA = a.start + a.size - ROW_GAP; // 节点视觉底部（扣除行距 padding）
      const yB = b.start;
      const mid = (yA + yB) / 2;
      out.push({ key: i, d: `M ${colA.center} ${yA} C ${colA.center} ${mid}, ${colB.center} ${mid}, ${colB.center} ${yB}` });
    }
    return out.sort((p, q) => p.key - q.key);
  }, [items, sorted, laneIndex, geometry]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto scrollbar-thin px-6 py-6">
      <div className="mx-auto" style={{ width: geometry.width }}>
        {/* 泳道表头（sticky） */}
        <div
          className="sticky top-0 z-20 grid"
          style={{ gridTemplateColumns: lanes.map((l) => `${l.width}px`).join(" "), columnGap: COL_GAP }}
        >
          {lanes.map((l) => {
            const label = l.labelKey ? t(l.labelKey) : l.label;
            return (
              <div
                key={l.id}
                className="px-3 py-2 rounded-lg bg-zinc-900/95 border border-[var(--sidebar-border)] text-xs font-medium text-zinc-300 text-center truncate"
                title={label}
              >
                {label}
              </div>
            );
          })}
        </div>

        {/* 虚拟化节点区 */}
        <div className="relative" style={{ height: virtualizer.getTotalSize(), marginTop: 12 }}>
          {/* 泳道中轴虚线 */}
          {geometry.cols.map((c, i) => (
            <div
              key={`spine-${lanes[i].id}`}
              className="absolute top-0 bottom-0 border-l border-dashed border-zinc-800 pointer-events-none"
              style={{ left: c.center }}
            />
          ))}

          <svg
            className="absolute inset-0 pointer-events-none z-0"
            width={geometry.width}
            height="100%"
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

          {items.map((vi) => {
            const m = sorted[vi.index];
            const col = geometry.cols[laneIndex.get(laneOf(m)) ?? 0];
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                className="absolute z-10"
                style={{
                  top: 0,
                  left: col.left,
                  width: col.width,
                  transform: `translateY(${vi.start}px)`,
                  paddingBottom: ROW_GAP,
                }}
              >
                <LaneNode msg={m} compact={compact} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const ROLE_STYLE: Record<string, { labelKey: MsgKey; ring: string }> = {
  user: { labelKey: "role.user", ring: "border-blue-800/40" },
  assistant: { labelKey: "role.assistant", ring: "border-[var(--sidebar-border)]" },
  system: { labelKey: "role.system", ring: "border-yellow-900/30" },
  tool: { labelKey: "role.tool", ring: "border-amber-900/30" },
};

/** 工具调用分类：MCP（mcp__server__tool 前缀）、Skill、内置工具（Bash/Read/...）。 */
function toolKind(name: string): { kind: "mcp" | "skill" | "builtin"; display: string } {
  if (name.startsWith("mcp__")) {
    const [, server, tool] = name.split("__");
    return { kind: "mcp", display: tool ? `${server}/${tool}` : name };
  }
  if (name === "Skill") return { kind: "skill", display: name };
  return { kind: "builtin", display: name };
}

const KIND_STYLE = {
  mcp: "bg-purple-900/40 text-purple-300 border-purple-800/40",
  skill: "bg-blue-900/40 text-blue-300 border-blue-800/40",
  builtin: "bg-amber-900/30 text-amber-300 border-amber-800/30",
} as const;

/** 从 input 里挑最有信息量的参数做一行摘要。 */
function toolArgSummary(input: Record<string, unknown>): string {
  const KEYS = ["cmd", "command", "path", "file_path", "pattern", "query", "description", "prompt", "skill", "url", "name"];
  for (const k of KEYS) {
    const v = input[k];
    if (typeof v === "string" && v) {
      const oneLine = v.replace(/\s+/g, " ").trim();
      return oneLine.length > 80 ? oneLine.slice(0, 80) + "…" : oneLine;
    }
  }
  const json = JSON.stringify(input);
  return json.length > 80 ? json.slice(0, 80) + "…" : json;
}

function ToolCallRows({ toolCalls }: { toolCalls: NonNullable<ConversationMessage["toolCalls"]> }) {
  return (
    <div className="mt-2 space-y-1">
      {toolCalls.map((tc, i) => {
        const { kind, display } = toolKind(tc.name);
        return (
          <div key={`${tc.name}-${i}`} className="flex items-center gap-1.5 text-[11px] font-mono min-w-0">
            <span className={`flex-shrink-0 px-1.5 py-0.5 rounded border ${KIND_STYLE[kind]}`}>
              {kind === "mcp" ? "MCP" : display}
            </span>
            {kind === "mcp" && <span className="flex-shrink-0 text-purple-300/80">{display}</span>}
            {kind === "skill" && tc.input ? (
              <span className="flex-shrink-0 text-blue-300/80">{String((tc.input as Record<string, unknown>).skill ?? "")}</span>
            ) : (
              <span className="text-zinc-500 truncate">{tc.input ? toolArgSummary(tc.input) : ""}</span>
            )}
            <span className={`flex-shrink-0 ml-auto ${tc.output ? "text-green-600" : "text-zinc-700"}`}>
              {tc.output ? "✓" : "…"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LaneNode({ msg, compact }: { msg: ConversationMessage; compact?: boolean }) {
  const t = useT();
  const [xContent, setXContent] = useState(false);
  const [xThink, setXThink] = useState(false);
  const style = ROLE_STYLE[msg.role] || ROLE_STYLE.assistant;
  const clampContent = compact && !xContent && msg.content.length > CONTENT_CLAMP;
  const clampThink = compact && !xThink && (msg.thinking?.length || 0) > THINK_CLAMP;

  return (
    <div className={`rounded-xl border bg-zinc-900/70 px-4 py-3 ${style.ring}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t(style.labelKey)}</span>
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
          <div className="text-[10px] uppercase tracking-wider text-indigo-400 mb-1">{t("msg.thinkingTitle")}</div>
          <div className="text-xs text-indigo-200/70 whitespace-pre-wrap">
            {clampThink ? msg.thinking!.slice(0, THINK_CLAMP) + "…" : msg.thinking}
          </div>
          {compact && msg.thinking.length > THINK_CLAMP && (
            <button onClick={() => setXThink(!xThink)} className="text-[11px] text-indigo-400 hover:text-indigo-300 mt-1">
              {xThink ? t("msg.collapse") : t("msg.expandContent", { n: msg.thinking.length.toLocaleString() })}
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
                {t("msg.expandContent", { n: msg.content.length.toLocaleString() })}
              </button>
            </div>
          ) : (
            <div>
              <MarkdownContent content={msg.content} />
              {compact && msg.content.length > CONTENT_CLAMP && (
                <button onClick={() => setXContent(false)} className="text-[11px] text-zinc-500 hover:text-zinc-300 mt-1">
                  {t("msg.collapse")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {msg.toolCalls && msg.toolCalls.length > 0 && (
        compact ? (
          <ToolCallRows toolCalls={msg.toolCalls} />
        ) : (
          msg.toolCalls.map((tool, i) => <ToolCallBlock key={`${tool.name}-${i}`} tool={tool} />)
        )
      )}
    </div>
  );
}
