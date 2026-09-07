import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { LocalFileSource, scanHomeForAgentStorage } from "./local";

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
