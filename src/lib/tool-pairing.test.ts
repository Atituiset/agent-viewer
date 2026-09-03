import { describe, it, expect } from "vitest";
import { attachToolOutput, pairToolOutputInMessages } from "./tool-pairing";
import type { ConversationMessage, ToolCall } from "./types";

function msg(id: string, toolCalls?: ToolCall[]): ConversationMessage {
  return { id, role: "assistant", content: "", timestamp: "t", toolCalls, source: "test" };
}

describe("attachToolOutput", () => {
  it("按 id 精确配对", () => {
    const calls: ToolCall[] = [
      { id: "a", name: "t", input: {} },
      { id: "b", name: "t", input: {} },
    ];
    expect(attachToolOutput(calls, "out-b", "b")).toBe(true);
    expect(calls[0].output).toBeUndefined();
    expect(calls[1].output).toBe("out-b");
  });

  it("不覆盖已配对过的 call，退给更早的同 id 空位", () => {
    const calls: ToolCall[] = [
      { id: "a", name: "t", input: {} },
      { id: "a", name: "t", input: {}, output: "first" },
    ];
    expect(attachToolOutput(calls, "second", "a")).toBe(true);
    expect(calls[0].output).toBe("second");
    expect(calls[1].output).toBe("first");
  });

  it("callId 给定时跳过带其他 id 的 call，但允许 id 缺失的 call", () => {
    const calls: ToolCall[] = [
      { name: "t", input: {} }, // 无 id：可配
      { id: "x", name: "t", input: {} }, // 其他 id：跳过
    ];
    expect(attachToolOutput(calls, "out", "y")).toBe(true);
    expect(calls[0].output).toBe("out");
    expect(calls[1].output).toBeUndefined();
  });

  it("无 callId 时按时间就近配给最后一个未配对的 call", () => {
    const calls: ToolCall[] = [
      { name: "t", input: {}, output: "done" },
      { name: "t", input: {} },
    ];
    expect(attachToolOutput(calls, "new")).toBe(true);
    expect(calls[1].output).toBe("new");
  });

  it("没有可配的 call 返回 false", () => {
    const calls: ToolCall[] = [{ id: "a", name: "t", input: {}, output: "done" }];
    expect(attachToolOutput(calls, "out", "a")).toBe(false);
    expect(attachToolOutput([], "out")).toBe(false);
  });
});

describe("pairToolOutputInMessages", () => {
  it("从后往前扫，跳过没有 toolCalls 的消息", () => {
    const messages = [
      msg("m1", [{ id: "a", name: "t", input: {} }]),
      msg("m2"), // 无 toolCalls
      msg("m3", []), // 空数组
    ];
    expect(pairToolOutputInMessages(messages, "out", "a")).toBe(true);
    expect(messages[0].toolCalls![0].output).toBe("out");
  });

  it("无处可配返回 false（调用方可决定独立成泡）", () => {
    const messages = [msg("m1"), msg("m2", [{ name: "t", input: {}, output: "done" }])];
    expect(pairToolOutputInMessages(messages, "out")).toBe(false);
  });
});
