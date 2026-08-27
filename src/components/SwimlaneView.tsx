"use client";

import { useMemo } from "react";
import type { ConversationMessage } from "@/lib/types";
import MessageBubble from "./MessageBubble";

interface Props {
  messages: ConversationMessage[];
  compact?: boolean;
}

interface Lane {
  id: string;
  label: string;
  messages: ConversationMessage[];
}

/** 泳道视图：main 一列、每个 subagent 一列，列内按时间顺序。单 lane 会话退化为单列。 */
export default function SwimlaneView({ messages, compact }: Props) {
  const lanes = useMemo<Lane[]>(() => {
    const order: string[] = [];
    const labels = new Map<string, string>();
    const byLane = new Map<string, ConversationMessage[]>();
    for (const m of messages) {
      const lane = m.agent || "main";
      if (!byLane.has(lane)) {
        byLane.set(lane, []);
        order.push(lane);
      }
      if (m.agentLabel && !labels.has(lane)) labels.set(lane, m.agentLabel);
      byLane.get(lane)!.push(m);
    }
    order.sort((a, b) => (a === "main" ? -1 : b === "main" ? 1 : 0));
    return order.map((id) => ({
      id,
      label: labels.get(id) || (id === "main" ? "Main" : id),
      messages: byLane.get(id)!,
    }));
  }, [messages]);

  return (
    <div className="flex-1 overflow-auto scrollbar-thin px-6 py-8">
      <div className="flex gap-4 min-w-max items-start mx-auto">
        {lanes.map((lane) => (
          <div key={lane.id} className="w-[400px] flex-shrink-0">
            <div className="sticky top-0 z-10 mb-4 px-3 py-2 rounded-lg bg-zinc-900/95 border border-[var(--sidebar-border)] flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300 truncate" title={lane.label}>
                {lane.label}
              </span>
              <span className="text-[10px] text-zinc-600 ml-2 flex-shrink-0">{lane.messages.length}</span>
            </div>
            <div className="space-y-5">
              {lane.messages.map((m, i) => (
                <MessageBubble key={m.id || i} message={m} compact={compact} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
