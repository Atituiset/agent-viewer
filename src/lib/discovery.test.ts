import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { discoverAgents } from "./discovery";
import { detectTools, getTool } from "./registry";
import { encodeGenericId, decodeGenericId, detectKind } from "./generic";
import { listGenericSessions, readGenericSession } from "./generic";

const HOME = "/home/test";

function seedKnownAgent(src: FakeFileSource): void {
  src.add(".claude/projects/proj-1/sess-a.jsonl", JSON.stringify({ type: "user", message: { role: "user", content: "hi" }, timestamp: "2026-09-01T00:00:00Z", uuid: "u1" }));
}

function seedCodeagent(src: FakeFileSource, n = 1): void {
  for (let i = 0; i < n; i++) {
    src.add(
      `.codeagent/sessions/run-${i}.jsonl`,
      [
        JSON.stringify({ type: "user", message: { role: "user", content: "build it" }, timestamp: "2026-09-01T01:00:00Z", uuid: `u-${i}` }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "on it" }] }, timestamp: "2026-09-01T01:01:00Z", uuid: `a-${i}` }),
      ].join("\n")
    );
  }
}

describe("detectKind 采样分类（agent-session-format 的集成冒烟，完整用例在上游包）", () => {
  it("发现流程用到的四种形态都能分类", () => {
    expect(detectKind(JSON.stringify({ type: "assistant", message: { role: "assistant", content: "x" } }))).toBe("claude-style");
    expect(detectKind(JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [] } }))).toBe("codex-style");
    expect(detectKind(JSON.stringify({ role: "user", content: "hello" }))).toBe("chat-style");
    expect(
      detectKind(JSON.stringify({ metadata: { id: "a" }, messages: [{ role: "user", content: "hi" }] }))
    ).toBe("session-style");
    expect(detectKind('{"foo":1}')).toBeNull();
  });
});

describe("generic id 编解码", () => {
  it("rootRel 带 / 与特殊字符也能往返", () => {
    const id = encodeGenericId("claude-style", ".code-agent/sessions/sub dir");
    const back = decodeGenericId(id);
    expect(back).toEqual({ kind: "claude-style", rootRel: ".code-agent/sessions/sub dir" });
  });
  it("非 generic id 返回 null", () => {
    expect(decodeGenericId("claude-code")).toBeNull();
  });
});

describe("discoverAgents 启发式发现", () => {
  it("发现未知 agent 目录并排除已知领地与噪声", async () => {
    const src = new FakeFileSource(HOME);
    seedKnownAgent(src);
    seedCodeagent(src, 2);
    // 噪声：.config/git 命中 history 的情况
    src.add(".config/git/history/some-file.json", "{}");

    const found = await discoverAgents(src);
    const roots = found.map((f) => f.rootRel);
    expect(roots).toContain(".codeagent/sessions");
    expect(roots).not.toContain(".claude/projects"); // 已知领地排除
    expect(roots).not.toContain(".config/git/history"); // 噪声排除
    expect(found.find((f) => f.rootRel === ".codeagent/sessions")?.name).toBe("Codeagent");
  });

  it("文件驱动：容器目录叫任意名字也能发现（chats/runs/平铺）", async () => {
    const src = new FakeFileSource(HOME);
    // 目录叫 chats —— 目录名扫描认不出，但文件驱动能
    src.add(
      ".codeagent/chats/run-0.jsonl",
      [
        JSON.stringify({ type: "user", message: { role: "user", content: "hi" }, timestamp: "2026-09-01T00:00:00Z", uuid: "u" }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: "ok" }, timestamp: "2026-09-01T00:01:00Z", uuid: "a" }),
      ].join("\n")
    );
    // 平铺：根目录直接放 jsonl
    src.add(
      ".flatagent/conv-1.jsonl",
      [JSON.stringify({ role: "user", content: "q" }), JSON.stringify({ role: "assistant", content: "a" })].join("\n")
    );
    const found = await discoverAgents(src);
    const roots = found.map((f) => f.rootRel);
    expect(roots).toContain(".codeagent/chats");
    expect(roots).toContain(".flatagent");
  });

  it("文件驱动发现的平铺根：列出 + 读取全链路", async () => {
    const src = new FakeFileSource(HOME);
    src.add(
      ".flatagent/conv-1.jsonl",
      [JSON.stringify({ role: "user", content: "q" }), JSON.stringify({ role: "assistant", content: "a" })].join("\n")
    );
    const sessions = await listGenericSessions(src, ".flatagent");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("conv-1");
    const msgs = await readGenericSession(src, "chat-style", ".flatagent", "conv-1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("解析不出任何已知格式时不收录", async () => {
    const src = new FakeFileSource(HOME);
    src.add(".weird/sessions/x.jsonl", JSON.stringify({ unrelated: true }));
    const found = await discoverAgents(src);
    expect(found.map((f) => f.rootRel)).not.toContain(".weird/sessions");
  });

  it("codeagent 会话：列出 + 读取（claude 形转录）", async () => {
    const src = new FakeFileSource(HOME);
    seedCodeagent(src, 2);
    const sessions = await listGenericSessions(src, ".codeagent/sessions");
    expect(sessions).toHaveLength(2);
    expect(sessions[0].title.length).toBeGreaterThan(0);

    const msgs = await readGenericSession(src, "claude-style", ".codeagent/sessions", "run-0");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs.every((m) => m.source === "generic")).toBe(true);
  });

  it("codewhale 会话：session 形（单文件 JSON messages）全链路——发现/列出/读取/配对", async () => {
    const src = new FakeFileSource(HOME);
    // 真实 codewhale 布局：sessions/<uuid>.json，单文件对话，messages 为
    // claude 形 content blocks + tool_use/tool_result 配对。
    src.add(
      ".codewhale/sessions/1111.json",
      JSON.stringify({
        schema_version: 1,
        metadata: { id: "1111", title: "调研", created_at: "2026-09-01T00:00:00Z", message_count: 3 },
        messages: [
          { role: "user", content: [{ type: "text", text: "看下 README" }] },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "先读文件" },
              { type: "tool_use", id: "tu1", name: "read_file", input: { path: "README.md" } },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tu1", content: "# hello" }],
          },
          { role: "assistant", content: [{ type: "text", text: "这是项目说明。" }] },
        ],
      })
    );
    const found = await discoverAgents(src);
    const entry = found.find((f) => f.rootRel === ".codewhale/sessions");
    expect(entry?.kind).toBe("session-style");

    const sessions = await listGenericSessions(src, ".codewhale/sessions", "session-style");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("调研");
    expect(sessions[0].messageCount).toBe(3);

    const msgs = await readGenericSession(src, "session-style", ".codewhale/sessions", "1111");
    // NIR→视图模型映射：tool_result 按 toolCallId 配回 tool_use，相邻 assistant 事件
    // （thinking / tool_use / 收尾文本）合并进同一个气泡。
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].thinking).toBe("先读文件");
    expect(msgs[1].toolCalls?.[0]).toMatchObject({ id: "tu1", name: "read_file", input: { path: "README.md" }, output: "# hello" });
    expect(msgs[1].content).toBe("这是项目说明。");
  });

  it("session 形也支持 OpenAI 风格 tool_calls / tool 消息配对", async () => {
    const src = new FakeFileSource(HOME);
    src.add(
      ".openai-ish/sessions/s1.json",
      JSON.stringify({
        metadata: { created_at: "2026-09-01T00:00:00Z" },
        messages: [
          { role: "user", content: "list files" },
          { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "exec", arguments: "{\"cmd\":\"ls\"}" } }] },
          { role: "tool", tool_call_id: "c1", content: "a\nb" },
          { role: "assistant", content: "两个文件" },
        ],
      })
    );
    const found = await discoverAgents(src);
    expect(found.find((f) => f.rootRel === ".openai-ish/sessions")?.kind).toBe("session-style");
    const msgs = await readGenericSession(src, "session-style", ".openai-ish/sessions", "s1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].toolCalls?.[0]).toMatchObject({ id: "c1", name: "exec", input: { cmd: "ls" }, output: "a\nb" });
    expect(msgs[1].content).toBe("两个文件");
  });
});

describe("registry 动态条目", () => {
  it("getTool 解码 generic id 并可用", async () => {
    const src = new FakeFileSource(HOME);
    seedCodeagent(src, 1);
    const id = encodeGenericId("claude-style", ".codeagent/sessions");
    const tool = getTool(id);
    const sessions = await tool.listSessions(src);
    expect(sessions).toHaveLength(1);
    const msgs = await tool.readSession(src, sessions[0].id);
    expect(msgs).toHaveLength(2);
  });

  it("detectTools 融合已知 + 发现", async () => {
    const src = new FakeFileSource(HOME);
    seedKnownAgent(src);
    seedCodeagent(src, 1);
    const tools = await detectTools(src);
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("claude-code");
    expect(ids.some((i) => i.startsWith("generic:"))).toBe(true);
    // 发现到的 codeagent 有正确的会话计数
    const generic = tools.find((t) => t.id.startsWith("generic:"));
    expect(generic?.sessionCount).toBe(1);
  });
});
