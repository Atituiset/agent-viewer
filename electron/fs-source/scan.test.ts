import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { LocalFileSource, scanHomeForAgentStorage, scanHomeForTranscripts } from "./local";

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "av-scan-"));
}

describe("scanHomeForAgentStorage（启发式发现·本地）", () => {
  it("找到 ~/.<agent>/sessions|projects|history", () => {
    const home = tmpHome();
    for (const dir of [".codeagent/sessions", ".foo-agent/projects", ".bar/history"]) {
      fs.mkdirSync(path.join(home, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(home, ".codeagent/sessions/a.jsonl"), "{}");
    const rels = scanHomeForAgentStorage(home);
    expect(rels).toContain(".codeagent/sessions");
    expect(rels).toContain(".foo-agent/projects");
    expect(rels).toContain(".bar/history");
  });

  it("扫 .config 与 .local/share 下的布局", () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, ".config/newagent/sessions"), { recursive: true });
    fs.mkdirSync(path.join(home, ".local/share/xagent/history"), { recursive: true });
    const rels = scanHomeForAgentStorage(home);
    expect(rels).toContain(".config/newagent/sessions");
    expect(rels).toContain(".local/share/xagent/history");
  });

  it("无 agent 目录的 home 返回空数组不抛异常", () => {
    expect(scanHomeForAgentStorage(tmpHome())).toEqual([]);
  });

  it("LocalFileSource.scanAgentStorage 返回相对路径", async () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, ".codeagent/sessions"), { recursive: true });
    const src = new LocalFileSource(home);
    expect(await src.scanAgentStorage()).toEqual([".codeagent/sessions"]);
  });
});

describe("scanHomeForTranscripts（文件驱动发现·本地）", () => {
  it("容器目录叫任意名字（chats）与平铺布局都能找到转录文件", () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, ".codeagent/chats"), { recursive: true });
    fs.mkdirSync(path.join(home, ".flatagent"), { recursive: true });
    fs.writeFileSync(path.join(home, ".codeagent/chats/a.jsonl"), "{}");
    fs.writeFileSync(path.join(home, ".flatagent/b.jsonl"), "{}");
    const rels = scanHomeForTranscripts(home).map((f) => f.rel);
    expect(rels).toContain(".codeagent/chats/a.jsonl");
    expect(rels).toContain(".flatagent/b.jsonl");
  });

  it("剪枝缓存/构建目录，不进 ~/Projects 等非点目录领地", () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, ".bigagent/node_modules"), { recursive: true });
    fs.mkdirSync(path.join(home, ".bigagent/sessions"), { recursive: true });
    fs.mkdirSync(path.join(home, "Projects/foo"), { recursive: true });
    fs.writeFileSync(path.join(home, ".bigagent/node_modules/x.jsonl"), "{}");
    fs.writeFileSync(path.join(home, ".bigagent/sessions/real.jsonl"), "{}");
    fs.writeFileSync(path.join(home, "Projects/foo/nope.jsonl"), "{}");
    const rels = scanHomeForTranscripts(home).map((f) => f.rel);
    expect(rels).toContain(".bigagent/sessions/real.jsonl");
    expect(rels.some((r) => r.includes("node_modules"))).toBe(false);
    expect(rels.some((r) => r.startsWith("Projects/"))).toBe(false);
  });

  it("按 mtime 降序（活跃的排前）", () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, ".a/sessions"), { recursive: true });
    fs.mkdirSync(path.join(home, ".b/sessions"), { recursive: true });
    const old = path.join(home, ".a/sessions/old.jsonl");
    const fresh = path.join(home, ".b/sessions/fresh.jsonl");
    fs.writeFileSync(old, "{}");
    fs.writeFileSync(fresh, "{}");
    const then = new Date(Date.now() - 86400_000);
    fs.utimesSync(old, then, then);
    const rels = scanHomeForTranscripts(home).map((f) => f.rel);
    expect(rels[0]).toBe(".b/sessions/fresh.jsonl");
  });
});
