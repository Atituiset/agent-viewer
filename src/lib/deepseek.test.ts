import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listDeepSeekSessions, readDeepSeekSession } from "./deepseek";

const FILE = JSON.stringify({
  metadata: { id: "s1", title: "T", model: "deepseek", workspace: "/p", created_at: "2026-01-01T00:00:00Z", message_count: 2 },
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "yo" },
  ],
});

describe("deepseek parser", () => {
  it("lists and reads", async () => {
    const src = new FakeFileSource().add(".deepseek/sessions/s1.json", FILE);
    const sessions = await listDeepSeekSessions(src);
    expect(sessions[0].id).toBe("s1");
    const msgs = await readDeepSeekSession(src, "s1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("pairs tool message content back into the toolCall output", async () => {
    const file = JSON.stringify({
      metadata: { id: "s2", title: "T", created_at: "2026-01-01T00:00:00Z" },
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "let me check", tool_calls: [{ function: { name: "read", arguments: '{"p":"a"}' } }] },
        { role: "tool", content: "file body" },
      ],
    });
    const src = new FakeFileSource().add(".deepseek/sessions/s2.json", file);
    const msgs = await readDeepSeekSession(src, "s2");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].toolCalls?.[0].name).toBe("read");
    expect(msgs[1].toolCalls?.[0].output).toBe("file body");
  });
});
