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
  });
});
