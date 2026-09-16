import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listGeminiSessions, readGeminiSession } from "./gemini";

const HISTORY = [
  JSON.stringify({ conversationId: "c1", display: "first prompt", timestamp: 1735689600000, workspace: "/p" }),
].join("\n");

const TRANSCRIPT = [
  JSON.stringify({ source: "USER_EXPLICIT", type: "USER_INPUT", content: "<USER_REQUEST>hi</USER_REQUEST>", created_at: "2026-01-01T00:00:00Z" }),
  JSON.stringify({ source: "MODEL", type: "PLANNER_RESPONSE", content: "yo", created_at: "2026-01-01T00:00:01Z" }),
].join("\n");

describe("gemini parser", () => {
  it("lists from history.jsonl and reads transcript", async () => {
    const src = new FakeFileSource()
      .add(".gemini/antigravity-cli/history.jsonl", HISTORY)
      .add(".gemini/antigravity-cli/brain/c1/.system_generated/logs/transcript.jsonl", TRANSCRIPT);
    const sessions = await listGeminiSessions(src);
    expect(sessions[0].id).toBe("c1");
    const msgs = await readGeminiSession(src, "c1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("maps planner tool_calls and action rows into toolCalls on the assistant bubble", async () => {
    const transcript = [
      JSON.stringify({ source: "USER_EXPLICIT", type: "USER_INPUT", content: "<USER_REQUEST>hi</USER_REQUEST>", created_at: "2026-01-01T00:00:00Z" }),
      JSON.stringify({ source: "MODEL", type: "PLANNER_RESPONSE", content: "let me look", tool_calls: [{ name: "view_file", args: { path: "a.ts" } }], created_at: "2026-01-01T00:00:01Z" }),
      JSON.stringify({ source: "MODEL", type: "VIEW_FILE", content: "file body", created_at: "2026-01-01T00:00:02Z" }),
    ].join("\n");
    const src = new FakeFileSource()
      .add(".gemini/antigravity-cli/history.jsonl", HISTORY)
      .add(".gemini/antigravity-cli/brain/c1/.system_generated/logs/transcript.jsonl", transcript);
    const msgs = await readGeminiSession(src, "c1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    // 包解析器把 VIEW_FILE 等动作行建模为独立的合成工具调用（read/list/edit/bash），
    // 其 content 不再作为输出配回 planner 的 tool_call——与旧实现是有意的行为差异。
    expect(msgs[1].toolCalls?.map((tc) => tc.name)).toEqual(["view_file", "read"]);
    expect(msgs[1].toolCalls?.[1].input).toEqual({});
  });
});
