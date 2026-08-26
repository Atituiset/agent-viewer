import { describe, it, expect } from "vitest";
import { LocalFileSource } from "../../electron/fs-source/local";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listClaudeSessionsAll, readClaudeSession } from "./claude";
import { listCodexSessions, readCodexSession } from "./codex";
import { listDeepSeekSessions } from "./deepseek";
import { listGeminiSessions } from "./gemini";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

const USER_LINE = line({ type: "user", uuid: "u1", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hello" } });
const ASSIST_LINE = line({
  type: "assistant",
  uuid: "a1",
  timestamp: "2026-01-01T00:00:10Z",
  message: {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "hmm" },
      { type: "tool_use", id: "tu1", name: "Read", input: { path: "/x" } },
      { type: "text", text: "done" },
    ],
  },
});
const TOOL_RESULT_LINE = line({
  type: "user",
  uuid: "u2",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "file body" }] },
});

describe("claude parser edge cases", () => {
  it("skips blank and corrupt lines without throwing", async () => {
    const src = new FakeFileSource().add(
      ".claude/projects/p1/s1.jsonl",
      ["", "{broken json", USER_LINE, "", "not json", ASSIST_LINE, ""].join("\n")
    );
    const msgs = await readClaudeSession(src, "p1", "s1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].thinking).toBe("hmm");
  });

  it("pairs tool_result output with its tool_use", async () => {
    const src = new FakeFileSource().add(
      ".claude/projects/p1/s1.jsonl",
      [USER_LINE, ASSIST_LINE, TOOL_RESULT_LINE].join("\n")
    );
    const msgs = await readClaudeSession(src, "p1", "s1");
    expect(msgs[1].toolCalls?.[0].output).toBe("file body");
  });

  it("lists sessions using only the file head (title within first bytes)", async () => {
    const src = new FakeFileSource()
      .add(".claude/projects/-home-test-proj/a.jsonl", USER_LINE + "\n" + ASSIST_LINE + "\n")
      .add(".claude/projects/-home-test-proj/b.jsonl", "");
    const sessions = await listClaudeSessionsAll(src);
    expect(sessions).toHaveLength(2);
    const a = sessions.find((s) => s.id === "a")!;
    expect(a.project).toBe("~/proj");
    // b.jsonl 为空文件也应列出（0 消息，Untitled），不抛错。
    const b = sessions.find((s) => s.id === "b")!;
    expect(b.messageCount).toBe(0);
    expect(b.title).toBe("Untitled");
  });
});

describe("codex parser edge cases", () => {
  it("walks nested date dirs and skips corrupt lines", async () => {
    const good = [
      line({ type: "message", payload: { role: "user", content: "q" } }),
      "garbage{",
      line({ type: "message", payload: { role: "assistant", content: "a" } }),
    ].join("\n");
    const src = new FakeFileSource().add(".codex/sessions/2026/08/25/rollout-s9.jsonl", good);
    const list = await listCodexSessions(src);
    expect(list[0].id).toBe("rollout-s9");
    expect(list[0].messageCount).toBe(3); // 含 garbage 行
    const msgs = await readCodexSession(src, "rollout-s9");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("returns empty for missing session id", async () => {
    const src = new FakeFileSource().add(".codex/sessions/2026/rollout-x.jsonl", USER_LINE);
    expect(await readCodexSession(src, "nope")).toEqual([]);
  });
});

describe("json parsers tolerate corrupt files", () => {
  it("deepseek: corrupt json yields placeholder session, not throw", async () => {
    const src = new FakeFileSource().add(".deepseek/sessions/bad.json", "{nope");
    const list = await listDeepSeekSessions(src);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Untitled");
  });

  it("gemini: corrupt lines are skipped", async () => {
    const ok = line({ conversationId: "c1", display: "Title", timestamp: 1767225600000, workspace: "/w" });
    const src = new FakeFileSource().add(".gemini/antigravity-cli/history.jsonl", `${ok}\n{bad}\n${ok}`);
    const list = await listGeminiSessions(src);
    expect(list).toHaveLength(1);
    expect(list[0].messageCount).toBe(2);
  });
});

describe("LocalFileSource head/lineCount", () => {
  it("readHead truncates and lineCount counts non-blank lines", async () => {
    if (process.platform === "win32") return; // tmp 路径差异由 CI 的其他用例覆盖
    const os = await import("os");
    const fs = await import("fs");
    const path = await import("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "av-local-"));
    const file = path.join(dir, "f.jsonl");
    fs.writeFileSync(file, "line1\n\nline2\nline3");
    const src = new LocalFileSource(dir);
    const head = await src.readHead("f.jsonl", 5);
    expect(head).toBe("line1");
    expect(await src.lineCount("f.jsonl")).toBe(3);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
