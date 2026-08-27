import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listHermesSessions, readHermesSession } from "./hermes";

const SESSIONS = JSON.stringify({ a: { session_id: "s1", display_name: "My", created_at: "2026-01-01T00:00:00Z", origin: { chat_id: "c1" } } });
const DUMP = JSON.stringify({
  timestamp: "2026-01-01T00:00:00Z",
  request: { body: { messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "yo", tool_calls: [] },
  ] } },
});

describe("hermes parser", () => {
  it("lists from sessions.json and reads latest dump", async () => {
    const src = new FakeFileSource()
      .add(".hermes/sessions/sessions.json", SESSIONS)
      .add(".hermes/sessions/request_dump_s1_001.json", DUMP);
    const sessions = await listHermesSessions(src);
    expect(sessions[0].id).toBe("s1");
    const msgs = await readHermesSession(src, "s1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("lists and reads from state.db (new hermes layout)", async () => {
    const src = new FakeFileSource().add(".hermes/state.db", makeStateDb());
    const sessions = await listHermesSessions(src);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("20260602_233910_562888");
    expect(sessions[0].title).toBe("My Session");
    expect(sessions[0].messageCount).toBe(2);
    const msgs = await readHermesSession(src, "20260602_233910_562888");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].thinking).toBe("thinking...");
    expect(msgs[1].toolCalls?.[0].name).toBe("Read");
    // role:"tool" 的消息配回 toolCall.output，不独立成泡
    expect(msgs[1].toolCalls?.[0].id).toBe("call_1");
    expect(msgs[1].toolCalls?.[0].output).toBe("file contents");
  });
});

function makeStateDb(): Buffer {
  const p = path.join(os.tmpdir(), `av_hermes_${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(p);
  db.exec(`CREATE TABLE sessions(id TEXT, title TEXT, display_name TEXT, started_at REAL, message_count INTEGER, cwd TEXT, model TEXT, archived INTEGER, hidden INTEGER);
           CREATE TABLE messages(id INTEGER, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, tool_call_id TEXT, timestamp REAL, reasoning_content TEXT, active INTEGER);`);
  db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)").run("20260602_233910_562888", null, "My Session", 1780414886.4, 2, "/home/u/proj", "glm5", 0, 0);
  db.prepare("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)").run(1, "20260602_233910_562888", "user", "hello", null, null, 1780414888.5, null, 1);
  db.prepare("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)").run(2, "20260602_233910_562888", "assistant", "hi", JSON.stringify([{ id: "call_1", function: { name: "Read", arguments: "{}" } }]), null, 1780414890.5, "thinking...", 1);
  db.prepare("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)").run(3, "20260602_233910_562888", "tool", "file contents", null, "call_1", 1780414891.5, null, 1);
  db.close();
  const buf = fs.readFileSync(p);
  fs.unlinkSync(p);
  return buf;
}
