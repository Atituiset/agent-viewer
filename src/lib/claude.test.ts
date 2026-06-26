import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listClaudeSessionsAll, readClaudeSession } from "./claude";

const USER = JSON.stringify({ type: "user", message: { role: "user", content: "hello" }, uuid: "u1", timestamp: "2026-01-01T00:00:00Z" });
const ASST = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] }, uuid: "a1", timestamp: "2026-01-01T00:00:01Z" });
const TITLE = JSON.stringify({ type: "ai-title", aiTitle: "My Session" });

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

  it("returns empty when root missing", async () => {
    expect(await listClaudeSessionsAll(new FakeFileSource())).toEqual([]);
  });
});
