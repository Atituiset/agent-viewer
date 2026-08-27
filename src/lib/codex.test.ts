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

  const item = (payload: unknown, timestamp = "2026-01-01T00:00:00Z") =>
    JSON.stringify({ timestamp, type: "response_item", payload });

  it("parses a full response_item session with tool pairing and reasoning", async () => {
    const lines = [
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "list files" }] }, "2026-01-01T00:00:00Z"),
      item({ type: "reasoning", summary: [{ type: "summary_text", text: "need to inspect the dir" }], content: null, encrypted_content: "abc" }, "2026-01-01T00:00:01Z"),
      item({ type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "ls -la" }), call_id: "call_1" }, "2026-01-01T00:00:02Z"),
      item({ type: "function_call_output", call_id: "call_1", output: "total 8\nfile.txt" }, "2026-01-01T00:00:03Z"),
      item({ type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "here are the files" }] }, "2026-01-01T00:00:04Z"),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "thanks" }] }, "2026-01-01T00:00:05Z"),
      item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "you're welcome" }] }, "2026-01-01T00:00:06Z"),
    ];
    const src = new FakeFileSource().add(".codex/sessions/2026/01/01/rollout-real.jsonl", lines.join("\n") + "\n");
    const msgs = await readCodexSession(src, "rollout-real");

    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(msgs[0].content).toBe("list files");
    expect(msgs[0].timestamp).toBe("2026-01-01T00:00:00.000Z");

    const asst = msgs[1];
    expect(asst.content).toBe("here are the files");
    expect(asst.thinking).toBe("need to inspect the dir");
    expect(asst.toolCalls).toHaveLength(1);
    expect(asst.toolCalls![0]).toMatchObject({
      id: "call_1",
      name: "exec_command",
      input: { cmd: "ls -la" },
      output: "total 8\nfile.txt",
    });
    expect(msgs.every((m) => m.source === "codex")).toBe(true);
  });

  it("handles custom_tool_call with raw string input paired by call_id", async () => {
    const lines = [
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "patch it" }] }),
      item({ type: "custom_tool_call", status: "completed", call_id: "call_p", name: "apply_patch", input: "*** Begin Patch\n*** Update File: a.ts\n*** End Patch" }),
      item({ type: "custom_tool_call_output", call_id: "call_p", output: "Success. Updated a.ts" }),
    ];
    const src = new FakeFileSource().add(".codex/sessions/rollout-patch.jsonl", lines.join("\n") + "\n");
    const msgs = await readCodexSession(src, "rollout-patch");

    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    const tc = msgs[1].toolCalls![0];
    expect(tc.name).toBe("apply_patch");
    expect(tc.input).toEqual({ patch: "*** Begin Patch\n*** Update File: a.ts\n*** End Patch" });
    expect(tc.output).toBe("Success. Updated a.ts");
  });

  it("skips developer messages and environment_context-only user messages", async () => {
    const lines = [
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/home/u</cwd>\n</environment_context>" }] }),
      item({ type: "message", role: "developer", content: [{ type: "input_text", text: "system instructions" }] }),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "real question" }] }),
      item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "real answer" }] }),
    ];
    const src = new FakeFileSource().add(".codex/sessions/rollout-skip.jsonl", lines.join("\n") + "\n");
    const msgs = await readCodexSession(src, "rollout-skip");

    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: "user", content: "real question" });
    expect(msgs[1]).toMatchObject({ role: "assistant", content: "real answer" });
  });

  it("survives malformed lines without throwing", async () => {
    const src = new FakeFileSource().add(
      ".codex/sessions/rollout-bad.jsonl",
      ["not json at all", '{"type":"response_item","payload":', L1].join("\n") + "\n"
    );
    const msgs = await readCodexSession(src, "rollout-bad");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("hi");
  });
});
