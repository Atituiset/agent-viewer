"use client";

import { useState } from "react";
import type { ToolCall } from "@/lib/types";
import { useT } from "@/components/i18n";

interface Props {
  tool: ToolCall;
}

export default function ToolCallBlock({ tool }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const statusColor = tool.status === "completed"
    ? "text-green-500"
    : tool.status === "error"
    ? "text-red-500"
    : "text-yellow-500";

  return (
    <div className="tool-call mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <details open={expanded} onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}>
        <summary className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-zinc-800/50 cursor-pointer">
          <span className="text-amber-400 font-mono text-sm">⚙</span>
          <span className="font-mono text-zinc-300 text-[13px]">{tool.name}</span>
          {tool.status && <span className={`ml-auto text-[10px] ${statusColor}`}>{tool.status}</span>}
        </summary>

        {tool.input && Object.keys(tool.input).length > 0 && (
          <div className="border-t border-zinc-800 px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">{t("tool.input")}</div>
            <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all font-mono max-h-48 overflow-y-auto scrollbar-thin">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>
        )}

        {tool.output && (
          <div className="border-t border-zinc-800 px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">{t("tool.output")}</div>
            <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all font-mono max-h-96 overflow-y-auto scrollbar-thin">
              {tool.output.length > 8000 ? tool.output.slice(0, 8000) + "\n" + t("tool.truncated") : tool.output}
            </pre>
          </div>
        )}
      </details>
    </div>
  );
}
