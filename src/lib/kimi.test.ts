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

  it("merges subagent wires tagged by agent and sorted by timestamp", async () => {
    const SUB_WIRE = [
      JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1787754354900 }),
      JSON.stringify({ type: "profile.bind", agentId: "agent-0", modelAlias: "kimi-code/k3", profileName: "explore", thinkingEffort: "high" }),
      JSON.stringify({ type: "context.append_message", agentId: "agent-0", message: { role: "user", content: [{ type: "text", text: "探索一下代码" }] }, time: 1787754355200 }),
      JSON.stringify({ type: "context.append_loop_event", agentId: "agent-0", event: { type: "content.part", part: { type: "text", text: "找到了相关文件。" } }, time: 1787754355300 }),
    ].join("\n") + "\n";
    const src = new FakeFileSource()
      .add(`${BASE}/state.json`, STATE)
      .add(`${BASE}/agents/main/wire.jsonl`, WIRE)
      .add(`${BASE}/agents/agent-0/wire.jsonl`, SUB_WIRE);
    const msgs = await readKimiSession(src, SESS);
    // 按 timestamp 升序合并：agent-0 的 user/assistant 插在 main 第 2 个 user 之前。
    expect(msgs.map((m) => [m.role, m.agent ?? "main"])).toEqual([
      ["user", "main"],
      ["assistant", "main"],
      ["user", "agent-0"],
      ["assistant", "agent-0"],
      ["user", "main"],
      ["assistant", "main"],
    ]);
    expect(msgs.map((m) => m.timestamp)).toEqual([...msgs.map((m) => m.timestamp)].sort());
    const sub = msgs.filter((m) => m.agent === "agent-0");
    expect(sub).toHaveLength(2);
    for (const m of sub) expect(m.agentLabel).toBe("explore · agent-0");
    expect(sub[0].content).toBe("探索一下代码");
    expect(sub[1].content).toBe("找到了相关文件。");
    const mainMsgs = msgs.filter((m) => !m.agent);
    expect(mainMsgs).toHaveLength(4);
    for (const m of mainMsgs) expect(m.agentLabel).toBeUndefined();
  });

  it("skips unreadable subagent wires but keeps main", async () => {
    // agent-0 目录存在但 wire.jsonl 内容无法解析出消息，不影响 main。
    const src = new FakeFileSource()
      .add(`${BASE}/state.json`, STATE)
      .add(`${BASE}/agents/main/wire.jsonl`, WIRE)
      .add(`${BASE}/agents/agent-0/wire.jsonl`, "not json\n{}\n");
    const msgs = await readKimiSession(src, SESS);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("returns empty when root missing", async () => {
    expect(await listKimiSessions(new FakeFileSource())).toEqual([]);
    expect(await readKimiSession(new FakeFileSource(), SESS)).toEqual([]);
  });
});
