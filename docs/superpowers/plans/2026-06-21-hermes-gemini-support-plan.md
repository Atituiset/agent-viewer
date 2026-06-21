# Hermes / Gemini Session Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend routes and parsers so Hermes and Gemini sessions can be listed and rendered in the agent-viewer UI.

**Architecture:** Follow the existing provider pattern: one `src/lib/<provider>.ts` module for parsing local files, plus `sessions` and `session` API routes under `src/app/api/<provider>/`. The frontend already constructs `/api/${tool.id}/sessions` generically.

**Tech Stack:** TypeScript, Node.js `fs`, Next.js App Router API routes, existing `src/lib/types.ts` interfaces.

---

## File Structure

- **Create:**
  - `src/lib/hermes.ts` — parse `~/.hermes/sessions/sessions.json` and `request_dump_*.json`
  - `src/lib/gemini.ts` — parse `~/.gemini/antigravity-cli/history.jsonl` and `brain/<id>/.system_generated/logs/transcript.jsonl`
  - `src/app/api/hermes/sessions/route.ts` — `GET` list endpoint
  - `src/app/api/hermes/session/route.ts` — `GET` detail endpoint
  - `src/app/api/gemini/sessions/route.ts` — `GET` list endpoint
  - `src/app/api/gemini/session/route.ts` — `GET` detail endpoint

- **Unchanged:**
  - `src/lib/detect.ts` already detects both providers.
  - `src/app/page.tsx` already calls `/api/${tool.id}/sessions` generically.

---

## Task 1: Hermes Parser (`src/lib/hermes.ts`)

**Files:**
- Create: `src/lib/hermes.ts`

### Step 1.1: Implement session listing

```ts
import fs from "fs";
import path from "path";
import os from "os";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";

function getHermesRoot(): string {
  return path.join(os.homedir(), ".hermes", "sessions");
}

export function listHermesSessions(): ToolSession[] {
  const root = getHermesRoot();
  if (!fs.existsSync(root)) return [];

  const sessionsPath = path.join(root, "sessions.json");
  if (!fs.existsSync(sessionsPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(sessionsPath, "utf-8")) as Record<string, unknown>;
    return Object.values(data)
      .map((entry: any) => ({
        id: entry.session_id || "",
        title: entry.display_name || `Hermes ${entry.session_id || ""}`,
        createdAt: entry.created_at || new Date().toISOString(),
        messageCount: 0,
        directory: entry.origin?.chat_id || "",
      }))
      .filter((s) => s.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
```

### Step 1.2: Implement session detail

Append to `src/lib/hermes.ts`:

```ts
export function readHermesSession(sessionId: string): ConversationMessage[] {
  const root = getHermesRoot();
  if (!fs.existsSync(root)) return [];

  const files = fs
    .readdirSync(root)
    .filter((f) => f.startsWith(`request_dump_${sessionId}_`) && f.endsWith(".json"))
    .sort();

  if (files.length === 0) return [];

  const latest = path.join(root, files[files.length - 1]);
  try {
    const data = JSON.parse(fs.readFileSync(latest, "utf-8")) as Record<string, unknown>;
    const messages = (data.request as any)?.body?.messages || [];
    const result: ConversationMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role as string;
      const content = normalizeContent(msg.content);
      const timestamp = data.timestamp as string;

      if (role === "system") {
        result.push({ id: `hermes-${i}`, role: "system", content, timestamp, source: "hermes" });
      } else if (role === "user") {
        result.push({ id: `hermes-${i}`, role: "user", content, timestamp, source: "hermes" });
      } else if (role === "assistant") {
        const toolCalls = (msg.tool_calls || []).map((tc: any) => ({
          name: tc.function?.name || tc.name || "unknown",
          input: (() => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return tc.args || {}; } })(),
        }));
        result.push({ id: `hermes-${i}`, role: "assistant", content, timestamp, toolCalls: toolCalls.length ? toolCalls : undefined, source: "hermes" });
      } else if (role === "tool") {
        result.push({ id: `hermes-${i}`, role: "tool", content, timestamp, source: "hermes" });
      }
    }

    return result;
  } catch {
    return [];
  }
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (part.text) return part.text;
          return JSON.stringify(part);
        }
        return "";
      })
      .join("\n");
  }
  return content ? JSON.stringify(content) : "";
}
```

---

## Task 2: Hermes API Routes

### Step 2.1: `src/app/api/hermes/sessions/route.ts`

```ts
import { NextResponse } from "next/server";
import { listHermesSessions } from "@/lib/hermes";

export async function GET() {
  try {
    const sessions = listHermesSessions();
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

### Step 2.2: `src/app/api/hermes/session/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { readHermesSession } from "@/lib/hermes";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    const messages = readHermesSession(id);
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

---

## Task 3: Gemini Parser (`src/lib/gemini.ts`)

**Files:**
- Create: `src/lib/gemini.ts`

### Step 3.1: Implement session listing

```ts
import fs from "fs";
import path from "path";
import os from "os";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";

function getGeminiRoot(): string {
  return path.join(os.homedir(), ".gemini", "antigravity-cli");
}

export function listGeminiSessions(): ToolSession[] {
  const root = getGeminiRoot();
  const historyPath = path.join(root, "history.jsonl");
  if (!fs.existsSync(historyPath)) return [];

  const sessions = new Map<string, ToolSession>();

  try {
    const lines = fs.readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const id = entry.conversationId as string;
        if (!id) continue;
        const existing = sessions.get(id);
        const title = (entry.display as string) || "Untitled";
        const createdAt = new Date(entry.timestamp as number).toISOString();
        const directory = (entry.workspace as string) || "";

        if (!existing) {
          sessions.set(id, { id, title, createdAt, messageCount: 1, directory });
        } else {
          existing.messageCount += 1;
          if (createdAt < existing.createdAt) {
            existing.createdAt = createdAt;
            if (title !== "Untitled") existing.title = title;
          }
        }
      } catch {}
    }
  } catch {}

  return Array.from(sessions.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
```

### Step 3.2: Implement session detail

Append to `src/lib/gemini.ts`:

```ts
export function readGeminiSession(conversationId: string): ConversationMessage[] {
  const root = getGeminiRoot();
  const transcriptPath = path.join(root, "brain", conversationId, ".system_generated", "logs", "transcript.jsonl");
  if (!fs.existsSync(transcriptPath)) return [];

  const result: ConversationMessage[] = [];
  let index = 0;

  try {
    const lines = fs.readFileSync(transcriptPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const source = entry.source as string;
        const type = entry.type as string;
        const content = normalizeGeminiContent(entry.content);
        const timestamp = entry.created_at ? new Date(entry.created_at as string).toISOString() : new Date().toISOString();
        const id = `gemini-${index++}`;

        if (source === "USER_EXPLICIT" && type === "USER_INPUT") {
          if (content) result.push({ id, role: "user", content, timestamp, source: "gemini" });
        } else if (source === "MODEL" && type === "PLANNER_RESPONSE") {
          const toolCalls = (entry.tool_calls as any[] || []).map((tc) => ({
            name: tc.name || "unknown",
            input: tc.args || {},
          }));
          if (content || toolCalls.length > 0) {
            result.push({ id, role: "assistant", content, timestamp, toolCalls: toolCalls.length ? toolCalls : undefined, source: "gemini" });
          }
        } else if (source === "MODEL" && ["LIST_DIRECTORY", "VIEW_FILE", "CODE_ACTION", "RUN_COMMAND"].includes(type)) {
          if (content) result.push({ id, role: "tool", content, timestamp, source: "gemini" });
        }
        // SYSTEM + CONVERSATION_HISTORY is skipped.
      } catch {}
    }
  } catch {}

  return result;
}

function normalizeGeminiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : JSON.stringify(c))).join("\n");
  return content ? JSON.stringify(content) : "";
}
```

---

## Task 4: Gemini API Routes

### Step 4.1: `src/app/api/gemini/sessions/route.ts`

```ts
import { NextResponse } from "next/server";
import { listGeminiSessions } from "@/lib/gemini";

export async function GET() {
  try {
    const sessions = listGeminiSessions();
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

### Step 4.2: `src/app/api/gemini/session/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { readGeminiSession } from "@/lib/gemini";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    const messages = readGeminiSession(id);
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

---

## Task 5: Verify

**Step 5.1: Run type check**

```bash
npm run typecheck
```

Expected: no TypeScript errors.

**Step 5.2: Run existing tests**

```bash
npm test
```

Expected: existing tests pass.

**Step 5.3: Manual spot check (dev server)**

```bash
npm run dev
```

Open the UI, select Hermes and Gemini tools, confirm sessions load and conversation view renders messages.

---

## Spec Coverage Check

- Hermes session listing from `sessions.json` → Task 1.1
- Hermes session detail from `request_dump_*.json` → Task 1.2
- Hermes API routes → Task 2
- Gemini session listing from `history.jsonl` → Task 3.1
- Gemini session detail from `transcript.jsonl` → Task 3.2
- Gemini API routes → Task 4
- Error handling and type consistency → Tasks 1-4

## Placeholder Scan

No TBD/TODO placeholders. All code blocks contain concrete implementation.
