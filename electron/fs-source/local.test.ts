import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { LocalFileSource } from "./local";
import { FakeFileSource } from "./fake";

describe("FakeFileSource", () => {
  it("reads files relative to home and lists dirs", async () => {
    const src = new FakeFileSource().add(".claude/projects/proj-a/s1.jsonl", '{"type":"user"}\n');
    expect(await src.exists(".claude/projects")).toBe(true);
    const dirs = await src.readDir(".claude/projects");
    expect(dirs.find((d) => d.name === "proj-a")?.isDirectory).toBe(true);
    const files = await src.readDir(".claude/projects/proj-a");
    expect(files.map((f) => f.name)).toContain("s1.jsonl");
    expect(await src.readFile(".claude/projects/proj-a/s1.jsonl")).toContain('"type":"user"');
  });
});

describe("LocalFileSource", () => {
  it("reads a real temp file via home-relative path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "av-"));
    const file = path.join(dir, "x.txt");
    fs.writeFileSync(file, "hello");
    const src = new LocalFileSource(dir); // 用临时目录当 home
    expect(await src.exists("x.txt")).toBe(true);
    expect(await src.readFile("x.txt")).toBe("hello");
  });
});
