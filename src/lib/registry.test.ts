import { describe, it, expect } from "vitest";
import { TOOLS, getTool, detectTools } from "./registry";
import { FakeFileSource } from "../../electron/fs-source/fake";

// 可计 readDir 次数的 source：验证 detect 不再为卡片数字拉每个文件的 stat/head/lineCount。
class CountingSource extends FakeFileSource {
  reads = 0;
  async readDir(p: string) {
    this.reads++;
    return super.readDir(p);
  }
}

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

  it("known tools use readDir-level counting (countSessions wired for file-layout tools)", async () => {
    // claude/codex/deepseek 三个文件布局工具必须实现轻量 countSessions：
    // 否则 SSH 下 detect 卡片数字要付每文件 stat+readHead+lineCount 的 N×3 RTT。
    for (const id of ["claude-code", "codex", "deepseek"]) {
      const tool = getTool(id);
      expect(typeof tool.countSessions).toBe("function");
    }
  });

  it("claude countSessions counts jsonl files under project dirs without reading them", async () => {
    const src = new CountingSource()
      .add(".claude/projects/p1/a.jsonl", "x")
      .add(".claude/projects/p1/b.jsonl", "y")
      .add(".claude/projects/p2/c.jsonl", "z");
    const n = await getTool("claude-code").countSessions!(src);
    expect(n).toBe(3);
  });
});
