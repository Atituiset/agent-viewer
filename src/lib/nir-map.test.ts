import { describe, it, expect } from "vitest";
import { makeNirSession, type NirMessage } from "agent-session-format";
import { nirToConversation } from "./nir-map";

function msg(partial: Partial<NirMessage> & { role: NirMessage["role"] }): NirMessage {
  return {
    content: "",
    timestamp: "2026-01-01T00:00:00Z",
    toolName: null,
    toolInput: null,
    toolCallId: null,
    model: null,
    thinking: null,
    agent: null,
    agentLabel: null,
    ...partial,
  };
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
});
