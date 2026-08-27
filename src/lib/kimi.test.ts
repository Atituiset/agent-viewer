import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listKimiSessions, readKimiSession } from "./kimi";

const SESS = "session_11111111-2222-3333-4444-555555555555";
const BASE = `.kimi-code/sessions/wd_proj-a1b2c3d4e5f6/${SESS}`;

const STATE = JSON.stringify({
  id: SESS,
  cwd: "/home/u/Projects/proj",
  title: "看下这个代码仓",
  archived: false,
  createdAt: 1787754354825,
  updatedAt: 1787807446734,
});

const WIRE = [
  JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1787754354863 }),
  JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "你好" }] }, time: 1787754354972 }),
  JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "content.part", part: { type: "think", think: "用户在打招呼" } }, time: 1787754354984 }),
  JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "content.part", part: { type: "text", text: "你好！有什么可以帮你？" } }, time: 1787754355000 }),
  JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "tool.call", toolCallId: "tool_1", name: "Read", args: { path: "README.md" } }, time: 1787754355010 }),
  JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "tool.result", toolCallId: "tool_1", result: { output: "# README" } }, time: 1787754355100 }),
  JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "继续" }] }, time: 1787754356000 }),
  JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "content.part", part: { type: "text", text: "好的。" } }, time: 1787754356100 }),
].join("\n") + "\n";

describe("kimi parser", () => {
  it("lists sessions from state.json with project cwd", async () => {
    const src = new FakeFileSource()
      .add(`${BASE}/state.json`, STATE)
      .add(`${BASE}/agents/main/wire.jsonl`, WIRE);
    const sessions = await listKimiSessions(src);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(SESS);
    expect(sessions[0].title).toBe("看下这个代码仓");
    expect(sessions[0].project).toBe("/home/u/Projects/proj");
    expect(sessions[0].messageCount).toBe(8);
  });

  it("skips archived sessions", async () => {
    const src = new FakeFileSource()
      .add(`${BASE}/state.json`, JSON.stringify({ ...JSON.parse(STATE), archived: true }))
      .add(`${BASE}/agents/main/wire.jsonl`, WIRE);
    expect(await listKimiSessions(src)).toEqual([]);
  });

  it("reads user messages and accumulates assistant loop events", async () => {
    const src = new FakeFileSource()
      .add(`${BASE}/state.json`, STATE)
      .add(`${BASE}/agents/main/wire.jsonl`, WIRE);
    const msgs = await readKimiSession(src, SESS);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(msgs[0].content).toBe("你好");
    expect(msgs[1].content).toBe("你好！有什么可以帮你？");
    expect(msgs[1].thinking).toBe("用户在打招呼");
    expect(msgs[1].toolCalls).toHaveLength(1);
    expect(msgs[1].toolCalls?.[0].name).toBe("Read");
    expect(msgs[1].toolCalls?.[0].input).toEqual({ path: "README.md" });
    expect(msgs[1].toolCalls?.[0].output).toBe("# README");
    expect(msgs[3].content).toBe("好的。");
  });

  it("returns empty when root missing", async () => {
    expect(await listKimiSessions(new FakeFileSource())).toEqual([]);
    expect(await readKimiSession(new FakeFileSource(), SESS)).toEqual([]);
  });
});
