import { describe, it, expect } from "vitest";
import { makeMsg, makeNirSession, type NirMessage } from "agent-session-format";
import { nirToConversation } from "./nir-map";

// Built through asf's own makeMsg rather than a hand-written literal: that is the
// constructor that derives toolTarget, so a fixture typed as NirMessage stays
// correct as the schema gains fields. Writing the literal by hand meant this file
// broke on 0.8.0's toolTarget — the type error was the schema doing its job.
function msg(partial: Partial<NirMessage> & { role: NirMessage["role"] }): NirMessage {
  return makeMsg(partial);
}

function sessionOf(messages: NirMessage[]) {
  return makeNirSession({
    id: "s",
    source: "test",
    sourceVersion: null,
    projectPath: null,
    startedAt: null,
    endedAt: null,
    messages,
  });
}

describe("nirToConversation（NIR → 视图模型映射）", () => {
  it("merges adjacent same-role events into one bubble", () => {
    const out = nirToConversation(
      sessionOf([
        msg({ role: "user", content: "q" }),
        msg({ role: "assistant", thinking: "hmm" }),
        msg({ role: "assistant", toolName: "Read", toolInput: { p: "a" }, toolCallId: "c1" }),
        msg({ role: "assistant", content: "done" }),
      ]),
      "test"
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ role: "assistant", content: "done", thinking: "hmm" });
    expect(out[1].toolCalls?.[0]).toMatchObject({ id: "c1", name: "Read", input: { p: "a" } });
  });

  it("pairs tool results by toolCallId, not by position", () => {
    const out = nirToConversation(
      sessionOf([
        msg({ role: "assistant", toolName: "A", toolCallId: "call-a" }),
        msg({ role: "assistant", toolName: "B", toolCallId: "call-b" }),
        msg({ role: "tool", content: "result of B", toolCallId: "call-b" }),
        msg({ role: "tool", content: "result of A", toolCallId: "call-a" }),
      ]),
      "test"
    );
    expect(out).toHaveLength(1);
    expect(out[0].toolCalls?.[0]).toMatchObject({ name: "A", output: "result of A" });
    expect(out[0].toolCalls?.[1]).toMatchObject({ name: "B", output: "result of B" });
  });

  it("keeps an unpaired tool result as a standalone tool bubble", () => {
    const out = nirToConversation(
      sessionOf([
        msg({ role: "assistant", content: "a" }),
        msg({ role: "tool", content: "orphan output", toolCallId: "nope" }),
      ]),
      "test"
    );
    expect(out.map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect(out[1].content).toBe("orphan output");
  });

  it("breaks bubbles on role or lane change and carries agent labels", () => {
    const out = nirToConversation(
      sessionOf([
        msg({ role: "user", content: "main question" }),
        msg({ role: "user", content: "sub question", agent: "agent-0", agentLabel: "explore · agent-0" }),
        msg({ role: "assistant", content: "sub answer", agent: "agent-0", agentLabel: "explore · agent-0" }),
      ]),
      "test"
    );
    expect(out.map((m) => [m.role, m.agent ?? "main"])).toEqual([
      ["user", "main"],
      ["user", "agent-0"],
      ["assistant", "agent-0"],
    ]);
    expect(out[1].agentLabel).toBe("explore · agent-0");
    expect(out[0].agent).toBeUndefined();
  });

  it("normalizes non-object toolInput and falls back to a timestamp", () => {
    const out = nirToConversation(
      sessionOf([msg({ role: "assistant", toolName: "apply_patch", toolInput: { raw: "***" }, timestamp: null })]),
      "test"
    );
    expect(out[0].toolCalls?.[0].input).toEqual({ raw: "***" });
    expect(out[0].timestamp).toBeTruthy();
  });

  it("carries the NIR message model onto the bubble", () => {
    const out = nirToConversation(
      sessionOf([
        msg({ role: "user", content: "q", model: "claude-sonnet-4-5" }),
        msg({ role: "assistant", content: "a", model: "claude-sonnet-4-5" }),
      ]),
      "test"
    );
    expect(out[0].model).toBe("claude-sonnet-4-5");
    expect(out[1].model).toBe("claude-sonnet-4-5");
  });

  it("seals the bubble on model change even when role and lane match", () => {
    const out = nirToConversation(
      sessionOf([
        msg({ role: "assistant", content: "from sonnet", model: "claude-sonnet-4-5" }),
        msg({ role: "assistant", content: "from opus", model: "claude-opus-4-1" }),
      ]),
      "test"
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ content: "from sonnet", model: "claude-sonnet-4-5" });
    expect(out[1]).toMatchObject({ content: "from opus", model: "claude-opus-4-1" });
  });

  it("still merges adjacent messages when model is null on both sides", () => {
    const out = nirToConversation(
      sessionOf([
        msg({ role: "assistant", thinking: "hmm" }),
        msg({ role: "assistant", content: "done" }),
      ]),
      "test"
    );
    expect(out).toHaveLength(1);
    expect(out[0].model).toBeNull();
  });
});

/**
 * 结局透传（NIR 0.5+ 的 toolResult）。
 *
 * 这些用例守护的是一个静默 bug：映射层此前只读 m.content，把 toolResult 整个丢掉，
 * 于是「失败的调用」和「成功的长输出」在 UI 上完全一样。徽章从来没显示过——UI 比对的是
 * "completed"，而 NIR 一直发 "success"，加上 status 当时是自由 string，类型系统也拦不住。
 */
describe("nirToConversation：工具结局透传", () => {
  function pair(verdict?: Partial<NonNullable<NirMessage["toolResult"]>>) {
    return nirToConversation(
      sessionOf([
        msg({ role: "assistant", toolName: "Bash", toolInput: { command: "pytest" }, toolCallId: "c1" }),
        msg({
          role: "tool",
          content: "some output",
          toolCallId: "c1",
          toolResult: verdict
            ? ({
                status: "error",
                method: "source_status",
                errorText: "1 failed",
                detail: {},
                ...verdict,
              } as NonNullable<NirMessage["toolResult"]>)
            : undefined,
        }),
      ]),
      "test"
    );
  }

  it("carries status, method and errorText onto the paired call", () => {
    const tc = pair({ status: "error" })[0].toolCalls?.[0];
    expect(tc).toMatchObject({
      name: "Bash",
      output: "some output",
      status: "error",
      verdictMethod: "source_status",
      errorText: "1 failed",
    });
  });

  it("leaves status ABSENT when the source reported nothing", () => {
    // The distinction that matters: "no verdict" is NOT "success". Defaulting this
    // field would invent a success rate out of thin air. Absence is the honest
    // representation, so the key is genuinely not there.
    const tc = pair()[0].toolCalls?.[0];
    expect(tc?.output).toBe("some output");
    expect(tc?.status).toBeUndefined();
    expect("status" in tc!).toBe(false);
  });

  it("keeps cancelled distinct from error", () => {
    // A command cut off without reporting failure is not a failed command.
    const tc = pair({ status: "cancelled", errorText: null })[0].toolCalls?.[0];
    expect(tc?.status).toBe("cancelled");
  });

  it("marks derived verdicts so a guess is never read as a report", () => {
    const tc = pair({ method: "derived" })[0].toolCalls?.[0];
    expect(tc?.verdictMethod).toBe("derived");
  });

  it("pairs the verdict to the right call when results arrive out of order", () => {
    const out = nirToConversation(
      sessionOf([
        msg({ role: "assistant", toolName: "A", toolCallId: "call-a" }),
        msg({ role: "assistant", toolName: "B", toolCallId: "call-b" }),
        msg({
          role: "tool",
          content: "B failed",
          toolCallId: "call-b",
          toolResult: {
            status: "error",
            method: "source_status",
            errorText: "boom",
            detail: {},
          } as NonNullable<NirMessage["toolResult"]>,
        }),
        msg({ role: "tool", content: "A fine", toolCallId: "call-a" }),
      ]),
      "test"
    );
    expect(out[0].toolCalls?.[0]).toMatchObject({ name: "A", output: "A fine" });
    expect(out[0].toolCalls?.[0]?.status).toBeUndefined();
    expect(out[0].toolCalls?.[1]).toMatchObject({ name: "B", status: "error", errorText: "boom" });
  });
});
