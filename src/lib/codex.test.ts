import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listCodexSessions, readCodexSession } from "./codex";

const L1 = JSON.stringify({ type: "message", payload: { role: "user", content: "hi" }, timestamp: "2026-01-01T00:00:00Z" });
const L2 = JSON.stringify({ type: "message", payload: { role: "assistant", content: "yo" }, timestamp: "2026-01-01T00:00:01Z" });

describe("codex parser", () => {
  it("walks nested dirs for .jsonl", async () => {
    const src = new FakeFileSource().add(".codex/sessions/2026/01/rollout-abc.jsonl", [L1, L2].join("\n") + "\n");
    const sessions = await listCodexSessions(src);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("rollout-abc");
  });

  it("reads user + assistant", async () => {
    const src = new FakeFileSource().add(".codex/sessions/rollout-abc.jsonl", [L1, L2].join("\n") + "\n");
    const msgs = await readCodexSession(src, "rollout-abc");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
