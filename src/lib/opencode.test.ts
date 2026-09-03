import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { LocalFileSource } from "../../electron/fs-source/local";
import { listOpenCodeSessions, readOpenCodeSession } from "./opencode";

function makeDb(): Buffer {
  const p = path.join(os.tmpdir(), `av_src_${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(p);
  db.exec(`CREATE TABLE session(id TEXT, project_id TEXT, title TEXT, directory TEXT, model TEXT, cost INTEGER, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, time_created INTEGER, time_updated INTEGER, agent TEXT);
           CREATE TABLE message(id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
           CREATE TABLE part(id TEXT, message_id TEXT, data TEXT, time_created INTEGER);`);
  db.prepare("INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("s1", "p", "T", "/d", '"deepseek-v3"', 0, 10, 20, 0, 1735689600000, 0, null);
  db.prepare("INSERT INTO message VALUES (?,?,?,?)").run("m1", "s1", JSON.stringify({ role: "user" }), 1735689600000);
  db.prepare("INSERT INTO part VALUES (?,?,?,?)").run("pt1", "m1", JSON.stringify({ id: "pt1", type: "text", text: "hi" }), 1735689600000);
  db.prepare("INSERT INTO part VALUES (?,?,?,?)").run("pt2", "m1", JSON.stringify({ id: "pt2", type: "reasoning", text: "想了一下" }), 1735689600001);
  db.close();
  const buf = fs.readFileSync(p);
  fs.unlinkSync(p);
  return buf;
}

describe("opencode parser", () => {
  it("lists and reads from a sqlite db via FileSource buffer", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "av-home-"));
    fs.mkdirSync(path.join(home, ".local/share/opencode"), { recursive: true });
    fs.writeFileSync(path.join(home, ".local/share/opencode/opencode.db"), makeDb());
    const src = new LocalFileSource(home);
    const sessions = await listOpenCodeSessions(src);
    expect(sessions[0].id).toBe("s1");
    const msgs = await readOpenCodeSession(src, "s1");
    expect(msgs[0].content).toBe("hi");
    expect(msgs[0].thinking).toBe("想了一下");
  });

  it("skips corrupt rows instead of failing the whole session", async () => {
    const p = path.join(os.tmpdir(), `av_src_${Math.random().toString(36).slice(2)}.db`);
    const db = new Database(p);
    db.exec(`CREATE TABLE session(id TEXT, project_id TEXT, title TEXT, directory TEXT, model TEXT, cost INTEGER, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, time_created INTEGER, time_updated INTEGER, agent TEXT);
             CREATE TABLE message(id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
             CREATE TABLE part(id TEXT, message_id TEXT, data TEXT, time_created INTEGER);`);
    db.prepare("INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("s1", "p", "T", "/d", null, 0, 0, 0, 0, "not-a-number", 0, null);
    db.prepare("INSERT INTO message VALUES (?,?,?,?)").run("m1", "s1", "{corrupt json", 1735689600000); // 坏行
    db.prepare("INSERT INTO message VALUES (?,?,?,?)").run("m2", "s1", JSON.stringify({ role: "assistant" }), 1735689600001);
    db.prepare("INSERT INTO part VALUES (?,?,?,?)").run("pt-bad", "m2", "{also corrupt", 1735689600001); // 坏 part 跳过即可
    db.prepare("INSERT INTO part VALUES (?,?,?,?)").run("pt2", "m2", JSON.stringify({ id: "pt2", type: "text", text: "ok" }), 1735689600002);
    db.close();
    const buf = fs.readFileSync(p);
    fs.unlinkSync(p);

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "av-home-"));
    fs.mkdirSync(path.join(home, ".local/share/opencode"), { recursive: true });
    fs.writeFileSync(path.join(home, ".local/share/opencode/opencode.db"), buf);
    const src = new LocalFileSource(home);

    // session 行的 time_created 是字符串也不能让列表崩（toIso 兜底）
    const sessions = await listOpenCodeSessions(src);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].createdAt).toBe(new Date(0).toISOString());

    const msgs = await readOpenCodeSession(src, "s1");
    expect(msgs).toHaveLength(1); // m1 被跳过，m2 存活
    expect(msgs[0].content).toBe("ok");
  });
});
