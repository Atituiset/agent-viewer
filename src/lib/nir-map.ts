import type { NirMessage, NirSession } from "agent-session-format";
import type { ConversationMessage, ToolCall } from "./types";
import { attachToolOutput, pairToolOutputInMessages } from "./tool-pairing";

/**
 * NIR（agent-session-format 的一事件一消息模型）→ 查看器视图模型。
 *
 * 两个模型的差异：
 * - NIR 把每条 text / thinking / tool_use / tool_result 都拆成独立消息，
 *   工具调用与结果靠 toolCallId 关联；
 * - 查看器的 ConversationMessage 是「一个气泡」：content + thinking + toolCalls[]，
 *   工具结果内联进对应 ToolCall.output（ToolCallBlock/SwimlaneView 都按这个渲染）。
 *
 * 映射规则：
 * - 相邻同 role 同泳道的 NIR 消息合并成一个气泡（text 块用 \n 拼接）；
 * - role:"tool" 的结果按 toolCallId 配回 ToolCall（先当前气泡，再向前找），
 *   配不上才落成一个独立的 tool 气泡（不丢数据）；
 * - NIR 消息 id 不下发，这里按顺序生成稳定 id（React key 用）。
 */
export function nirToConversation(session: NirSession, source: string): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  // 当前可继续合并的气泡：role 或泳道一变就封口。
  let cur: ConversationMessage | null = null;

  const laneOf = (m: NirMessage): string | null => m.agent ?? null;
  const laneProps = (m: NirMessage): Pick<ConversationMessage, "agent" | "agentLabel"> =>
    m.agent ? { agent: m.agent, ...(m.agentLabel ? { agentLabel: m.agentLabel } : {}) } : {};

  const startGroup = (m: NirMessage): ConversationMessage => {
    cur = {
      id: `${source}-${out.length}`,
      role: m.role as ConversationMessage["role"],
      content: "",
      timestamp: m.timestamp ?? new Date().toISOString(),
      source,
      model: m.model ?? null,
      ...laneProps(m),
    };
    out.push(cur);
    return cur;
  };

  // 模型变化与 role/泳道变化同级：封口气泡另起新泡，让切换点落在气泡边界上。
  const mergeable = (m: NirMessage): boolean =>
    !!cur &&
    cur.role === m.role &&
    (cur.agent ?? null) === laneOf(m) &&
    (cur.model ?? null) === (m.model ?? null);

  for (const m of session.messages) {
    if (m.role === "tool") {
      const output = m.content;
      const callId = m.toolCallId ?? undefined;
      const group = cur as ConversationMessage | null;
      const paired =
        (group?.toolCalls ? attachToolOutput(group.toolCalls, output, callId) : false) ||
        pairToolOutputInMessages(out, output, callId);
      if (!paired && output) {
        // 配不上的工具结果独立成泡，并封掉当前组合并（防止后面的内容错序合并）。
        cur = null;
        out.push({
          id: `${source}-${out.length}`,
          role: "tool",
          content: output,
          timestamp: m.timestamp ?? new Date().toISOString(),
          source,
          ...laneProps(m),
        });
      }
      continue;
    }

    if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") continue;

    // 工具调用事件：并入当前 assistant 气泡的 toolCalls。
    if (m.role === "assistant" && m.toolName) {
      const group = mergeable(m) ? cur! : startGroup(m);
      const call: ToolCall = {
        id: m.toolCallId ?? undefined,
        name: m.toolName,
        input: toInputRecord(m.toolInput),
      };
      group.toolCalls = [...(group.toolCalls ?? []), call];
      if (m.content) group.content = joinText(group.content, m.content);
      continue;
    }

    if (!m.content && !m.thinking) continue; // 空气泡不产出
    const group = mergeable(m) ? cur! : startGroup(m);
    if (m.content) group.content = joinText(group.content, m.content);
    if (m.thinking) group.thinking = joinText(group.thinking ?? "", m.thinking);
  }
  return out;
}

function joinText(a: string, b: string): string {
  return a ? a + "\n" + b : b;
}

/** NIR toolInput 是 unknown；视图模型的 ToolCall.input 必须是 Record。 */
function toInputRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  if (input === null || input === undefined) return {};
  return { input };
}
