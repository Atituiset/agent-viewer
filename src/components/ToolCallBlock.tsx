"use client";

import { memo, useMemo, useState } from "react";
import type { ToolCall } from "@/lib/types";
import { useT } from "@/components/i18n";

interface Props {
  tool: ToolCall;
}

/** memo：LIVE 轮询重渲染列表时，未变的工具块（含大段 output 的 JSON.stringify）不重算。 */
const ToolCallBlock = memo(function ToolCallBlock({ tool }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const inputJson = useMemo(() => (tool.input && Object.keys(tool.input).length > 0 ? JSON.stringify(tool.input, null, 2) : ""), [tool.input]);

  // 状态取自 NIR 的 toolResult。source 没报告结局时 tool.status 为 undefined，
  // 此时不渲染徽章——「未报告」和「成功」是两件事，补一个默认值等于凭空造成功率。
  // 曾经这里比对的是 "completed"，而 NIR 发的一直是 "success"：徽章永远不显示，
  // 且因为 status 是自由 string，类型系统也拦不住。
  const statusColor =
    tool.status === "success"
      ? "text-green-500"
      : tool.status === "error"
      ? "text-red-500"
      : tool.status === "cancelled"
      ? "text-zinc-500"
      : "text-yellow-500";
  // method=derived 表示结局是从输出文本猜的（最后手段），提示用户这条不够硬。
  const isDerived = tool.verdictMethod === "derived";

  return (
    <div className="tool-call mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <details open={expanded} onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}>
        <summary className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-zinc-800/50 cursor-pointer">
          <span className="text-amber-400 font-mono text-sm">⚙</span>
          <span className="font-mono text-zinc-300 text-[13px]">{tool.name}</span>
          {tool.status && (
            <span
              className={`ml-auto flex items-center gap-1 text-[10px] ${statusColor}`}
              title={
                isDerived
                  ? t("tool.statusDerivedHint")
                  : tool.status === "cancelled"
                  ? t("tool.statusCancelledHint")
                  : undefined
              }
            >
              {isDerived && <span className="text-zinc-600">~</span>}
              {t(`tool.status.${tool.status}`)}
            </span>
          )}
        </summary>

        {inputJson && (
          <div className="border-t border-zinc-800 px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">{t("tool.input")}</div>
            <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all font-mono max-h-48 overflow-y-auto scrollbar-thin">
              {inputJson}
            </pre>
          </div>
        )}

        {/* 源报告的错误原文：比 output 顶部那几行结论更可信，也更短。
            只有 error 才显示——成功的调用没有"错误原文"可言。 */}
        {tool.errorText && (
          <div className="border-t border-zinc-800 px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">
              {t("tool.errorText")}
            </div>
            <pre className="text-xs text-red-400/90 whitespace-pre-wrap break-all font-mono max-h-32 overflow-y-auto scrollbar-thin">
              {tool.errorText.length > 2000
                ? tool.errorText.slice(0, 2000) + "\n" + t("tool.truncated")
                : tool.errorText}
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
});

export default ToolCallBlock;
