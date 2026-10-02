import type { ConversationMessage, ToolCall, ToolStatus } from "./types";

/**
 * 统一工具结果配对逻辑（此前 claude/codex/kimi/deepseek/hermes/gemini 各实现一遍，
 * 且语义漂移：claude 允许覆盖已配对的 call，其余不覆盖；id 校验口径不一）。
 *
 * 约定（从后往前找，离结果最近的优先）：
 * - 只写「未配对」的 call（output 为空），绝不覆盖；
 * - callId 提供时：只考虑同 id 或 id 缺失的 call（带其他 id 的跳过）；
 *   无 id 体系（如 deepseek/gemini 的工具结果不带 id）传 undefined 即纯按时间就近配对。
 *
 * 结论（status/errorText）与 output 走同一条配对路径：结局只有跟着结果走才对得上，
 * 单独维护一套配对等于把同一件事实现两遍。
 *
 * 返回是否配对成功；失败由调用方决定（如把工具结果独立成一条消息）。
 */

/** 工具结果的结局信息，来自 NIR 的 toolResult（source 未提供时为 undefined）。 */
export interface ToolVerdict {
  status: ToolStatus;
  errorText?: string;
  /** 结局的来源；derived = 从输出文本推断，证据强度较弱。 */
  method: "source_is_error" | "source_status" | "derived";
}

/** 在单个 call 序列内配对。 */
export function attachToolOutput(
  calls: ToolCall[],
  output: string,
  callId?: string,
  verdict?: ToolVerdict
): boolean {
  for (let i = calls.length - 1; i >= 0; i--) {
    const tc = calls[i];
    if (tc.output) continue;
    if (callId && tc.id && tc.id !== callId) continue;
    tc.output = output;
    if (verdict) {
      tc.status = verdict.status;
      tc.verdictMethod = verdict.method;
      if (verdict.errorText) tc.errorText = verdict.errorText;
    }
    return true;
  }
  return false;
}

/** 反向扫过整条消息列表，把输出配进第一条能配上的消息的 toolCalls。 */
export function pairToolOutputInMessages(
  messages: readonly ConversationMessage[],
  output: string,
  callId?: string,
  verdict?: ToolVerdict
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const calls = messages[i].toolCalls;
    if (!calls) continue;
    if (attachToolOutput(calls, output, callId, verdict)) return true;
  }
  return false;
}
