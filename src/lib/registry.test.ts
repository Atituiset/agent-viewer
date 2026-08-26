import { describe, it, expect } from "vitest";
import { TOOLS, getTool, detectTools } from "./registry";
import { FakeFileSource } from "../../electron/fs-source/fake";

describe("tool registry", () => {
  it("has unique ids with list/read wired for every tool", () => {
    const ids = new Set(TOOLS.map((t) => t.id));
    expect(ids.size).toBe(TOOLS.length);
    expect(ids).toContain("claude-code");
    for (const tool of TOOLS) {
      expect(typeof tool.listSessions).toBe("function");
      expect(typeof tool.readSession).toBe("function");
      expect(tool.detectPaths.length).toBeGreaterThan(0);
    }
  });

  it("getTool throws on unknown id", () => {
    expect(() => getTool("nope")).toThrow("unknown tool: nope");
  });

  it("claude-code requires projectPath, others do not", () => {
    const cc = getTool("claude-code");
    expect(cc.requiresProjectPath).toBe(true);
    for (const t of TOOLS.filter((x) => x.id !== "claude-code")) {
      expect(t.requiresProjectPath ?? false).toBe(false);
    }
  });

  it("detectTools reports only installed tools with session counts", async () => {
    const src = new FakeFileSource().add(
      ".deepseek/sessions/abc.json",
      JSON.stringify({ metadata: { id: "abc", title: "T", created_at: "2026-01-01T00:00:00Z" }, messages: [] })
    );
    const detected = await detectTools(src);
    expect(detected.map((d) => d.id)).toEqual(["deepseek"]);
    expect(detected[0].sessionCount).toBe(1);

    const empty = await detectTools(new FakeFileSource());
    expect(empty).toEqual([]);
  });
});
