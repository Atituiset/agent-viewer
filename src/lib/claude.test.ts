import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listClaudeSessionsAll, readClaudeSession } from "./claude";

const USER = JSON.stringify({ type: "user", message: { role: "user", content: "hello" }, uuid: "u1", timestamp: "2026-01-01T00:00:00Z" });
const ASST = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] }, uuid: "a1", timestamp: "2026-01-01T00:00:01Z" });
const TITLE = JSON.stringify({ type: "ai-title", aiTitle: "My Session" });

const THINKING = JSON.stringify({
  type: "assistant",
  message: { role: "assistant", content: { type: "thinking", thinking: "Let me check..." } },
  uuid: "a2",
  timestamp: "2026-01-01T00:00:02Z",
});

const TOOL_USE = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: { type: "tool_use", id: "toolu_01", name: "Read", input: { file_path: "src/auth.ts" } },
  },
  uuid: "a3",
  timestamp: "2026-01-01T00:00:03Z",
});

const TOOL_RESULT = JSON.stringify({
  type: "user",
  message: {
    role: "user",
    content: { type: "tool_result", tool_use_id: "toolu_01", content: "export const auth = ..." },
  },
  uuid: "u2",
  timestamp: "2026-01-01T00:00:04Z",
});

const FINAL_TEXT = JSON.stringify({
  type: "assistant",
  message: { role: "assistant", content: { type: "text", text: "Done." } },
  uuid: "a4",
  timestamp: "2026-01-01T00:00:05Z",
});

describe("claude parser", () => {
  it("lists sessions under .claude/projects/<project>", async () => {
    const src = new FakeFileSource().add(
      ".claude/projects/-home-user-proj/s1.jsonl",
      [TITLE, USER, ASST].join("\n") + "\n"
    );
    const sessions = await listClaudeSessionsAll(src);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("s1");
    expect(sessions[0].title).toBe("My Session");
    expect(sessions[0].messageCount).toBe(3);
    expect(sessions[0].projectPath).toBe("-home-user-proj");
  });

  it("reads user + assistant messages", async () => {
    const src = new FakeFileSource().add(
      ".claude/projects/-home-user-proj/s1.jsonl",
      [USER, ASST].join("\n") + "\n"
    );
    const msgs = await readClaudeSession(src, "-home-user-proj", "s1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].content).toBe("hi");
  });

  it("handles single-block assistant content and pairs tool results", async () => {
    const src = new FakeFileSource().add(
      ".claude/projects/-home-user-proj/s1.jsonl",
      [USER, THINKING, TOOL_USE, TOOL_RESULT, FINAL_TEXT].join("\n") + "\n"
    );
    const msgs = await readClaudeSession(src, "-home-user-proj", "s1");

    expect(msgs).toHaveLength(5);
    expect(msgs[1].thinking).toBe("Let me check...");
    expect(msgs[2].toolCalls).toHaveLength(1);
    expect(msgs[2].toolCalls?.[0].name).toBe("Read");
    expect(msgs[2].toolCalls?.[0].id).toBe("toolu_01");
    expect(msgs[2].toolCalls?.[0].output).toBe("export const auth = ...");
    expect(msgs[4].content).toBe("Done.");
  });

  it("returns empty when root missing", async () => {
    expect(await listClaudeSessionsAll(new FakeFileSource())).toEqual([]);
  });

  it("skips an unreadable project dir instead of zeroing the whole tool", async () => {
    class FlakySource extends FakeFileSource {
      async readDir(p: string) {
        if (p.includes("broken")) throw new Error("EPERM");
        return super.readDir(p);
      }
    }
    const src = new FlakySource()
      .add(".claude/projects/-home-user-broken/s0.jsonl", [USER].join("\n") + "\n")
      .add(".claude/projects/-home-user-good/s1.jsonl", [TITLE, USER, ASST].join("\n") + "\n");
    const sessions = await listClaudeSessionsAll(src);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("s1");
  });
});
