import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listCodexSessions, readCodexSession } from "./codex";

const L1 = JSON.stringify({ type: "message", payload: { role: "user", content: "hi" }, timestamp: "2026-01-01T00:00:00Z" });
const L2 = JSON.stringify({ type: "message", payload: { role: "assistant", content: "yo" }, timestamp: "2026-01-01T00:00:01Z" });

describe("codex parser", () => {
  it("walks nested dirs for .jsonl and groups by project cwd from session_meta", async () => {
    const META = JSON.stringify({
      timestamp: "2026-01-01T00:00:00Z",
      type: "session_meta",
      payload: { id: "abc", cwd: "/home/u/Projects/foo" },
    });
    const src = new FakeFileSource().add(".codex/sessions/2026/01/rollout-abc.jsonl", [META, L1, L2].join("\n") + "\n");
    const sessions = await listCodexSessions(src);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("rollout-abc");
    expect(sessions[0].project).toBe("/home/u/Projects/foo");
  });

  it("leaves project undefined when no session_meta", async () => {
    const src = new FakeFileSource().add(".codex/sessions/rollout-x.jsonl", [L1, L2].join("\n") + "\n");
    const sessions = await listCodexSessions(src);
    expect(sessions[0].project).toBeUndefined();
  });

  it("extracts cwd even when the meta line is truncated mid-JSON", async () => {
    // 真实 rollout 首行内嵌 base_instructions，readHead 截断后 JSON 不闭合
    const truncatedMeta =
      '{"timestamp":"2026-01-01T00:00:00Z","type":"session_meta","payload":{"id":"t1","cwd":"/home/u/Projects/bar","originator":"codex_vscode","base_instructions":{"text":"You are Codex' +
      "x".repeat(5000);
    const src = new FakeFileSource().add(".codex/sessions/rollout-t1.jsonl", truncatedMeta + "\n" + L1 + "\n");
    const sessions = await listCodexSessions(src);
    expect(sessions[0].project).toBe("/home/u/Projects/bar");
  });

  it("reads user + assistant", async () => {
    const src = new FakeFileSource().add(".codex/sessions/rollout-abc.jsonl", [L1, L2].join("\n") + "\n");
    const msgs = await readCodexSession(src, "rollout-abc");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
