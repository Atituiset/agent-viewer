import { describe, it, expect } from "vitest";
import { FakeFileSource } from "./fake";
import { resolvePath } from "./util";
import { listWslHomes } from "./wsl";

describe("resolvePath", () => {
  it("joins posix homes with posix.join", () => {
    const src = new FakeFileSource("/home/test");
    expect(resolvePath(src, ".claude/projects")).toBe("/home/test/.claude/projects");
  });

  it("keeps UNC homes (\\\\wsl$\\...) intact instead of collapsing the leading \\\\", () => {
    const src = new FakeFileSource("\\\\wsl$\\Ubuntu\\home\\u");
    expect(resolvePath(src, ".claude/projects")).toBe("\\\\wsl$\\Ubuntu\\home\\u/.claude/projects");
  });

  it("passes absolute paths through", () => {
    const src = new FakeFileSource("\\\\wsl$\\Ubuntu\\home\\u");
    expect(resolvePath(src, "/etc/hosts")).toBe("/etc/hosts");
  });
});

describe("listWslHomes", () => {
  it("returns [] on non-win32 platforms", async () => {
    if (process.platform === "win32") return;
    expect(await listWslHomes()).toEqual([]);
  });
});
