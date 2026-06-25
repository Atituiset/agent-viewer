import { describe, it, expect } from "vitest";
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
});
