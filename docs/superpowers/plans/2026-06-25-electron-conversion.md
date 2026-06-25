# Electron 桌面化改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 agent-viewer 从 Next.js Web 应用改造成可分发的 Electron 桌面应用（Windows NSIS + Linux AppImage），并把目前未实现的 SSH 远程浏览真正做出来。

**Architecture:** 方案 B —— Next `output: export` 产出纯静态前端，由 Electron 主进程加载；所有后端读取逻辑搬进主进程并通过 `FileSource` 抽象统一「本机 fs」与「远程 SSH/SFTP」两条路径；渲染进程通过 preload 暴露的 `window.api` 调用，替换原有 `fetch("/api/...")`。

**Tech Stack:** Next.js 16（静态导出）、Electron、electron-builder、ssh2（SSH/SFTP）、better-sqlite3（原生模块，@electron/rebuild）、vitest（单测）。

**Spec:** `docs/superpowers/specs/2026-06-25-electron-conversion-design.md`

**Branch:** `feat/electron-desktop`

---

## 文件结构（改动总览）

**新建：**
- `electron/fs-source/types.ts` — `FileSource` 接口与共享类型
- `electron/fs-source/util.ts` — 路径解析等工具
- `electron/fs-source/local.ts` — `LocalFileSource`（包 fs/promises）
- `electron/fs-source/fake.ts` — `FakeFileSource`（内存，测试用）
- `electron/fs-source/ssh.ts` — `SshFileSource`（ssh2 + SFTP）
- `electron/sqlite.ts` — 打开本地/已下载的 sqlite 临时文件
- `electron/source-manager.ts` — 按 machineId 解析并缓存 FileSource（本机/SSH）
- `electron/ipc.ts` — 注册 IPC handler
- `electron/preload.ts` — contextBridge 暴露 `window.api`
- `electron/main.ts` — app 生命周期、创建窗口、加载静态前端
- `electron/api.d.ts` — `window.api` 的渲染端类型
- `tsconfig.electron.json` — 主进程 TS 编译配置（CJS → `dist-electron/`）
- `vitest.config.ts` — 测试配置

**修改：**
- `src/lib/claude.ts`、`codex.ts`、`deepseek.ts`、`gemini.ts`、`hermes.ts`、`opencode.ts` — 改为接收 `FileSource`、全异步
- `src/lib/detect.ts` — 改为接收 `FileSource`，移除 `agy`
- `src/app/page.tsx` — `fetch` → `window.api`，会话调用带上 `machineId`
- `next.config.ts` — 加 `output: 'export'`
- `package.json` — 加 electron / ssh2 / vitest 等依赖、构建脚本、electron-builder 配置
- `src/app/layout.tsx`（如需调整静态导出）

**删除：** `src/app/api/**`（17 个路由文件）——全部能力迁入主进程 IPC。

**保留不动：** `src/lib/types.ts`（共享类型，渲染端与主进程都用）、`src/lib/machines.ts`（本地配置读写，由主进程使用）、所有 `src/components/**`（渲染逻辑不变）。

---

## Phase 1 — FileSource 抽象与测试基础

### Task 1.1: `FileSource` 接口与路径工具

**Files:**
- Create: `electron/fs-source/types.ts`
- Create: `electron/fs-source/util.ts`

- [ ] **Step 1: 写 `electron/fs-source/types.ts`**

```ts
export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface FileStat {
  mtime: Date;
  birthtime?: Date;
}

/**
 * 统一的「在某台机器上读文件」抽象。
 * 解析器（claude/codex/...）只依赖此接口，本机与远程共用同一份代码。
 * 路径约定：相对路径相对 home；绝对路径原样。
 */
export interface FileSource {
  readonly kind: "local" | "ssh";
  readonly home: string;
  exists(p: string): Promise<boolean>;
  readDir(p: string): Promise<DirEntry[]>;
  readFile(p: string): Promise<string>;
  readFileBuffer(p: string): Promise<Buffer>;
  stat(p: string): Promise<FileStat>;
  dispose?(): Promise<void>;
}
```

- [ ] **Step 2: 写 `electron/fs-source/util.ts`**

```ts
import path from "path";
import type { FileSource } from "./types";

/** 把相对 home 的路径解析为绝对路径（posix 风格，Node fs 在 Win 上也接受正斜杠）。 */
export function resolvePath(source: FileSource, p: string): string {
  if (path.posix.isAbsolute(p)) return p;
  return path.posix.join(source.home, p);
}

/** 拼接多段（全部 posix）。 */
export function join(...segs: string[]): string {
  return path.posix.join(...segs);
}
```

- [ ] **Step 3: Commit**

```bash
git add electron/fs-source/types.ts electron/fs-source/util.ts
git commit -m "feat(electron): add FileSource interface and path util"
```

---

### Task 1.2: `LocalFileSource` + 失败测试先行

**Files:**
- Create: `electron/fs-source/local.ts`
- Create: `electron/fs-source/fake.ts`
- Create: `electron/fs-source/local.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: 写 `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["electron/**/*.test.ts", "src/lib/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": "/src" },
  },
});
```

- [ ] **Step 2: 写 `FakeFileSource`（`electron/fs-source/fake.ts`）—— 内存虚拟 FS，所有解析器测试都靠它**

```ts
import path from "path";
import type { FileSource, DirEntry, FileStat } from "./types";

export class FakeFileSource implements FileSource {
  readonly kind = "local" as const;
  readonly home: string;
  private files = new Map<string, Buffer>();

  constructor(home = "/home/test") {
    this.home = home;
  }

  add(p: string, content: string | Buffer): this {
    this.files.set(this.resolve(p), Buffer.isBuffer(content) ? content : Buffer.from(content));
    return this;
  }

  private resolve(p: string): string {
    return path.posix.isAbsolute(p) ? p : path.posix.join(this.home, p);
  }

  async exists(p: string): Promise<boolean> {
    return this.files.has(this.resolve(p));
  }

  async readDir(p: string): Promise<DirEntry[]> {
    const dir = this.resolve(p);
    const dirPrefix = dir.endsWith("/") ? dir : dir + "/";
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(dirPrefix)) {
        const rel = key.slice(dirPrefix.length);
        if (rel.length === 0) continue;
        names.add(rel.split("/")[0]);
      }
    }
    return Array.from(names).map((name) => ({
      name,
      isDirectory: !this.files.has(dirPrefix + name),
    }));
  }

  async readFile(p: string): Promise<string> {
    const b = this.files.get(this.resolve(p));
    if (!b) throw new Error("not found: " + p);
    return b.toString("utf-8");
  }

  async readFileBuffer(p: string): Promise<Buffer> {
    const b = this.files.get(this.resolve(p));
    if (!b) throw new Error("not found: " + p);
    return b;
  }

  async stat(p: string): Promise<FileStat> {
    if (!this.files.has(this.resolve(p))) throw new Error("not found: " + p);
    const t = new Date(0);
    return { mtime: t, birthtime: t };
  }
}
```

- [ ] **Step 3: 写失败测试 `electron/fs-source/local.test.ts`**

```ts
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
```

- [ ] **Step 4: 运行测试，确认失败（LocalFileSource 未实现）**

Run: `npx vitest run electron/fs-source/local.test.ts`
Expected: FAIL（`Cannot find module './local'`）

- [ ] **Step 5: 写 `LocalFileSource`（`electron/fs-source/local.ts`）**

```ts
import fs from "fs";
import os from "os";
import type { FileSource, DirEntry, FileStat } from "./types";
import { resolvePath } from "./util";

export class LocalFileSource implements FileSource {
  readonly kind = "local" as const;
  readonly home: string;

  constructor(home?: string) {
    this.home = home ?? os.homedir();
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(resolvePath(this, p));
      return true;
    } catch {
      return false;
    }
  }

  async readDir(p: string): Promise<DirEntry[]> {
    const ents = await fs.promises.readdir(resolvePath(this, p), { withFileTypes: true });
    return ents.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  }

  async readFile(p: string): Promise<string> {
    return fs.promises.readFile(resolvePath(this, p), "utf-8");
  }

  async readFileBuffer(p: string): Promise<Buffer> {
    return fs.promises.readFile(resolvePath(this, p));
  }

  async stat(p: string): Promise<FileStat> {
    const s = await fs.promises.stat(resolvePath(this, p));
    return { mtime: s.mtime, birthtime: s.birthtime };
  }
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `npx vitest run electron/fs-source/local.test.ts`
Expected: PASS（4 个测试全过）

- [ ] **Step 7: 安装 vitest 依赖并提交**

```bash
npm i -D vitest @electron/rebuild
git add electron/fs-source/local.ts electron/fs-source/fake.ts electron/fs-source/local.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat(electron): add LocalFileSource + FakeFileSource with tests"
```

---

## Phase 2 — 解析器改造为 source 注入 + 异步

> 改造约定（适用于本阶段所有解析器）：
> 1. 函数加 `source: FileSource` 首参，全部改 `async`，内部 `fs.*Sync` → `await source.*`。
> 2. 路径用相对家目录的常量（如 `.claude/projects`），通过 `join()` 拼接；不再用 `os.homedir()`。
> 3. `fs.readFileSync` 改为一次 `await source.readFile` 后在内存里复用（避免多次往返，SSH 友好）。
> 4. `fs.statSync(p).birthtime` → `(await source.stat(p)).birthtime ?? stat.mtime`。
> 5. `fs.readdirSync(dir,{withFileTypes})` → `await source.readDir(dir)`，用 `entry.isDirectory`。
> 6. import 从 `./types` 改为相对引用 `FileSource`：`import type { FileSource } from "../../electron/fs-source/types"`（注意 `src/lib/*.ts` 到 `electron/` 的相对路径）。

### Task 2.1: claude 解析器改造（参考实现）+ 测试

**Files:**
- Modify: `src/lib/claude.ts`
- Create: `src/lib/claude.test.ts`

- [ ] **Step 1: 写失败测试 `src/lib/claude.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listClaudeSessionsAll, readClaudeSession } from "./claude";

const USER = JSON.stringify({ type: "user", message: { role: "user", content: "hello" }, uuid: "u1", timestamp: "2026-01-01T00:00:00Z" });
const ASST = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] }, uuid: "a1", timestamp: "2026-01-01T00:00:01Z" });
const TITLE = JSON.stringify({ type: "ai-title", aiTitle: "My Session" });

describe("claude parser", () => {
  it("lists sessions under .claude/projects/<project>", async () => {
    const src = new FakeFileSource().add(
      ".claude/projects/-home-user-proj/s1.jsonl",
      [TITLE, USER, ASST].join("\n") + "\n"
    );
    const sessions = await listClaudeSessionsAll(src);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("s1");
    expect(sessions[0].title).toBe("My Session");
    expect(sessions[0].messageCount).toBe(3);
    expect(sessions[0].projectPath).toBe("-home-user-proj");
  });

  it("reads user + assistant messages", async () => {
    const src = new FakeFileSource().add(
      ".claude/projects/-home-user-proj/s1.jsonl",
      [USER, ASST].join("\n") + "\n"
    );
    const msgs = await readClaudeSession(src, "-home-user-proj", "s1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].content).toBe("hi");
  });

  it("returns empty when root missing", async () => {
    expect(await listClaudeSessionsAll(new FakeFileSource())).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/lib/claude.test.ts`
Expected: FAIL（`listClaudeSessionsAll` 仍是同步签名 / 用了 fs）

- [ ] **Step 3: 重写 `src/lib/claude.ts`**

```ts
import path from "path";
import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ClaudeMessage, ContentBlock, ConversationMessage, ToolCall, ToolSession } from "./types";

const ROOT = ".claude/projects";

export async function listClaudeSessionsAll(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const result: ToolSession[] = [];
  const entries = await source.readDir(ROOT);

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const dirRel = join(ROOT, entry.name);
    const projectName = entry.name.replace(/^-/, "").replace(/-/g, "/").replace(/^home\/[^/]+\//, "~/");

    for (const f of await source.readDir(dirRel)) {
      if (!f.name.endsWith(".jsonl")) continue;
      const fileRel = join(dirRel, f.name);
      try {
        const stat = await source.stat(fileRel);
        const content = await source.readFile(fileRel);
        result.push({
          id: f.name.replace(".jsonl", ""),
          title: extractClaudeTitle(content),
          createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
          messageCount: countClaudeMessages(content),
          project: projectName,
          projectPath: entry.name,
        });
      } catch {}
    }
  }

  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function extractClaudeTitle(content: string): string {
  try {
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const obj: ClaudeMessage = JSON.parse(line);
      if (obj.type === "ai-title") return (obj.aiTitle as string) || "Untitled";
    }
  } catch {}
  return "Untitled";
}

function countClaudeMessages(content: string): number {
  return content.split("\n").filter((l) => l.trim()).length;
}

export async function readClaudeSession(
  source: FileSource,
  projectPath: string,
  sessionId: string
): Promise<ConversationMessage[]> {
  const fileRel = join(ROOT, projectPath, `${sessionId}.jsonl`);
  if (!(await source.exists(fileRel))) return [];

  const messages: ConversationMessage[] = [];
  const lines = (await source.readFile(fileRel)).split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj: ClaudeMessage = JSON.parse(line);
      if (obj.type === "user" && obj.message) {
        const msg = obj.message as { role?: string; content?: string | ContentBlock[] };
        messages.push({
          id: obj.uuid || `user-${messages.length}`,
          role: "user",
          content: extractTextFromContent(msg.content),
          timestamp: obj.timestamp || new Date().toISOString(),
          source: "claude",
        });
      } else if (obj.type === "assistant" && obj.message) {
        const msg = obj.message as { role?: string; content?: string | ContentBlock[] };
        const { text, thinking, toolCalls } = extractAssistantContent(msg.content);
        messages.push({
          id: obj.uuid || `assistant-${messages.length}`,
          role: "assistant",
          content: text,
          timestamp: obj.timestamp || new Date().toISOString(),
          thinking,
          toolCalls,
          source: "claude",
        });
      }
    } catch {}
  }

  return messages;
}

function extractTextFromContent(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
}

function extractAssistantContent(
  content: string | ContentBlock[] | undefined
): { text: string; thinking?: string; toolCalls?: ToolCall[] } {
  if (!content) return { text: "" };
  if (typeof content === "string") return { text: content };
  let text = "";
  let thinking: string | undefined;
  const toolCalls: ToolCall[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) text += block.text + "\n";
    else if (block.type === "thinking" && block.thinking) thinking = (thinking || "") + block.thinking + "\n";
    else if (block.type === "tool_use")
      toolCalls.push({ name: block.name || "unknown", input: (block.input as Record<string, unknown>) || {} });
  }
  return { text: text.trimEnd(), thinking: thinking?.trimEnd(), toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/lib/claude.test.ts`
Expected: PASS（3 个测试）

- [ ] **Step 5: Commit**

```bash
git add src/lib/claude.ts src/lib/claude.test.ts
git commit -m "refactor(claude): inject FileSource, make async"
```

---

### Task 2.2: codex 解析器改造 + 测试

**Files:**
- Modify: `src/lib/codex.ts`（原 `listCodexSessions()` / `readCodexSession(sessionId)` 同步 + 递归 walk + `fs.statSync().birthtime`）
- Create: `src/lib/codex.test.ts`

- [ ] **Step 1: 写测试 `src/lib/codex.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listCodexSessions, readCodexSession } from "./codex";

const L1 = JSON.stringify({ type: "message", payload: { role: "user", content: "hi" }, timestamp: "2026-01-01T00:00:00Z" });
const L2 = JSON.stringify({ type: "message", payload: { role: "assistant", content: "yo" }, timestamp: "2026-01-01T00:00:01Z" });

describe("codex parser", () => {
  it("walks nested dirs for .jsonl", async () => {
    const src = new FakeFileSource().add(".codex/sessions/2026/01/rollout-abc.jsonl", [L1, L2].join("\n") + "\n");
    const sessions = await listCodexSessions(src);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("rollout-abc");
  });

  it("reads user + assistant", async () => {
    const src = new FakeFileSource().add(".codex/sessions/rollout-abc.jsonl", [L1, L2].join("\n") + "\n");
    const msgs = await readCodexSession(src, "rollout-abc");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
```

- [ ] **Step 2: 运行，确认失败** — Run: `npx vitest run src/lib/codex.test.ts` → FAIL

- [ ] **Step 3: 重写 `src/lib/codex.ts`**

关键变化：`walk` 改为递归 `await source.readDir`；`birthtime` → `stat.birthtime ?? stat.mtime`；签名加 `source` 首参且全异步。

```ts
import path from "path";
import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolSession } from "./types";

const ROOT = ".codex/sessions";

async function walk(source: FileSource, dir: string, acc: { rel: string; name: string }[]) {
  for (const entry of await source.readDir(dir)) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory) await walk(source, rel, acc);
    else if (entry.name.endsWith(".jsonl")) acc.push({ rel, name: entry.name });
  }
}

export async function listCodexSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const files: { rel: string; name: string }[] = [];
  await walk(source, ROOT, files);

  const sessions: ToolSession[] = [];
  for (const f of files) {
    try {
      const content = await source.readFile(f.rel);
      const messageCount = content.split("\n").filter((l) => l.trim()).length;
      const stat = await source.stat(f.rel);
      sessions.push({
        id: f.name.replace(".jsonl", ""),
        title: f.name.replace(/^rollout-/, "").replace(/\.jsonl$/, "").replace(/-/g, " ").slice(0, 80),
        createdAt: (stat.birthtime ?? stat.mtime).toISOString(),
        messageCount,
      });
    } catch {}
  }
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readCodexSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (!(await source.exists(ROOT))) return [];
  const files: { rel: string; name: string }[] = [];
  await walk(source, ROOT, files);
  const hit = files.find(
    (f) => f.name === `${sessionId}.jsonl` || (sessionId && f.name.endsWith(".jsonl") && f.name.includes(sessionId))
  );
  if (!hit) return [];

  const messages: ConversationMessage[] = [];
  const lines = (await source.readFile(hit.rel)).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      const obj = JSON.parse(lines[i]);
      const payload = obj.payload || obj;
      const type = obj.type || payload.type || "";
      const role = payload.role || type;
      const text = payload.content || payload.text || payload.message || "";
      const ts = obj.timestamp ? new Date(obj.timestamp as string).toISOString() : new Date().toISOString();
      if (role === "user" || type === "input" || (type === "message" && payload.role === "user")) {
        messages.push({ id: `cx-${i}`, role: "user", content: typeof text === "string" ? text : JSON.stringify(text), timestamp: ts, source: "codex" });
      } else if (role === "assistant" || type === "output" || (type === "message" && payload.role === "assistant")) {
        messages.push({ id: `cx-${i}`, role: "assistant", content: typeof text === "string" ? text : JSON.stringify(text), timestamp: ts, source: "codex" });
      }
    } catch {}
  }
  return messages;
}
```

- [ ] **Step 4: 运行，确认通过** — Run: `npx vitest run src/lib/codex.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/lib/codex.ts src/lib/codex.test.ts
git commit -m "refactor(codex): inject FileSource, make async"
```

---

### Task 2.3: deepseek 解析器改造 + 测试

**Files:**
- Modify: `src/lib/deepseek.ts`（`listDeepSeekSessions()` / `readDeepSeekSession(sessionId)` 读 `~/.deepseek/sessions/*.json`）
- Create: `src/lib/deepseek.test.ts`

- [ ] **Step 1: 写测试 `src/lib/deepseek.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listDeepSeekSessions, readDeepSeekSession } from "./deepseek";

const FILE = JSON.stringify({
  metadata: { id: "s1", title: "T", model: "deepseek", workspace: "/p", created_at: "2026-01-01T00:00:00Z", message_count: 2 },
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "yo" },
  ],
});

describe("deepseek parser", () => {
  it("lists and reads", async () => {
    const src = new FakeFileSource().add(".deepseek/sessions/s1.json", FILE);
    const sessions = await listDeepSeekSessions(src);
    expect(sessions[0].id).toBe("s1");
    const msgs = await readDeepSeekSession(src, "s1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
```

- [ ] **Step 2: 运行确认失败** — `npx vitest run src/lib/deepseek.test.ts` → FAIL
- [ ] **Step 3: 重写 `src/lib/deepseek.ts`** —— `fs.readdirSync(root)` → `await source.readDir(ROOT)`；`fs.readFileSync` → `await source.readFile`；签名加 `source` 且异步。

```ts
import path from "path";
import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";

const ROOT = ".deepseek/sessions";

export async function listDeepSeekSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const out: ToolSession[] = [];
  for (const f of await source.readDir(ROOT)) {
    if (!f.name.endsWith(".json")) continue;
    const fileRel = join(ROOT, f.name);
    try {
      const data = JSON.parse(await source.readFile(fileRel));
      const meta = data.metadata || {};
      out.push({
        id: meta.id || f.name.replace(".json", ""),
        title: meta.title || "Untitled",
        model: meta.model || "deepseek",
        directory: meta.workspace || "",
        createdAt: meta.created_at || new Date().toISOString(),
        messageCount: meta.message_count || (data.messages || []).length,
      });
    } catch {
      out.push({ id: f.name.replace(".json", ""), title: "Untitled", model: "deepseek", createdAt: new Date().toISOString(), messageCount: 0 });
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readDeepSeekSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (!(await source.exists(ROOT))) return [];
  let fileRel = join(ROOT, `${sessionId}.json`);
  if (!(await source.exists(fileRel))) {
    const match = (await source.readDir(ROOT)).find((f) => f.name.startsWith(sessionId) && f.name.endsWith(".json"));
    if (!match) return [];
    fileRel = join(ROOT, match.name);
  }
  try {
    const data = JSON.parse(await source.readFile(fileRel));
    const messages = data.messages || [];
    const result: ConversationMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role as string;
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      const ts = data.metadata?.created_at || new Date().toISOString();
      if (role === "user" || role === "assistant") {
        result.push({ id: `ds-${i}`, role, content, timestamp: ts, source: "deepseek" });
      } else if (role === "tool" || msg.tool_calls) {
        const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc: { function: { name: string; arguments: string } }) => ({
          name: tc.function?.name || "unknown",
          input: (() => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return {}; } })(),
        }));
        const last = result[result.length - 1];
        if (last && last.role === "assistant") last.toolCalls = [...(last.toolCalls || []), ...toolCalls];
        else result.push({ id: `ds-tool-${i}`, role: "assistant", content: "", timestamp: ts, toolCalls, source: "deepseek" });
      }
    }
    return result;
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: Commit** — `git add src/lib/deepseek.ts src/lib/deepseek.test.ts && git commit -m "refactor(deepseek): inject FileSource, make async"`

---

### Task 2.4: gemini 解析器改造 + 测试

**Files:**
- Modify: `src/lib/gemini.ts`（读 `~/.gemini/antigravity-cli/history.jsonl` 与 `brain/<id>/.system_generated/logs/transcript.jsonl`）
- Create: `src/lib/gemini.test.ts`

- [ ] **Step 1: 写测试 `src/lib/gemini.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { FakeFileSource } from "../../electron/fs-source/fake";
import { listGeminiSessions, readGeminiSession } from "./gemini";

const HISTORY = [
  JSON.stringify({ conversationId: "c1", display: "first prompt", timestamp: 1735689600000, workspace: "/p" }),
].join("\n");

const TRANSCRIPT = [
  JSON.stringify({ source: "USER_EXPLICIT", type: "USER_INPUT", content: "<USER_REQUEST>hi</USER_REQUEST>", created_at: "2026-01-01T00:00:00Z" }),
  JSON.stringify({ source: "MODEL", type: "PLANNER_RESPONSE", content: "yo", created_at: "2026-01-01T00:00:01Z" }),
].join("\n");

describe("gemini parser", () => {
  it("lists from history.jsonl and reads transcript", async () => {
    const src = new FakeFileSource()
      .add(".gemini/antigravity-cli/history.jsonl", HISTORY)
      .add(".gemini/antigravity-cli/brain/c1/.system_generated/logs/transcript.jsonl", TRANSCRIPT);
    const sessions = await listGeminiSessions(src);
    expect(sessions[0].id).toBe("c1");
    const msgs = await readGeminiSession(src, "c1");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL
- [ ] **Step 3: 重写 `src/lib/gemini.ts`** —— 保留所有纯函数（`normalizeGeminiContent`/`extractUserRequest`/`cleanTitle`）原样；只把两个入口函数 `listGeminiSessions`/`readGeminiSession` 改为接收 `source` 且异步，路径用常量。

```ts
import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";

interface GeminiToolCall { name?: string; args?: Record<string, unknown> }
const ROOT = ".gemini/antigravity-cli";

export async function listGeminiSessions(source: FileSource): Promise<ToolSession[]> {
  const historyPath = join(ROOT, "history.jsonl");
  if (!(await source.exists(historyPath))) return [];
  const sessions = new Map<string, ToolSession>();
  try {
    for (const line of (await source.readFile(historyPath)).split("\n").filter(Boolean)) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const id = entry.conversationId as string;
        if (!id) continue;
        const title = cleanTitle((entry.display as string) || "Untitled");
        const createdAt = new Date(entry.timestamp as number).toISOString();
        const directory = (entry.workspace as string) || "";
        const existing = sessions.get(id);
        if (!existing) sessions.set(id, { id, title, createdAt, messageCount: 1, directory });
        else {
          existing.messageCount += 1;
          if (createdAt < existing.createdAt) { existing.createdAt = createdAt; if (title !== "Untitled") existing.title = title; }
        }
      } catch {}
    }
  } catch {}
  return Array.from(sessions.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readGeminiSession(source: FileSource, conversationId: string): Promise<ConversationMessage[]> {
  const transcriptPath = join(ROOT, "brain", conversationId, ".system_generated", "logs", "transcript.jsonl");
  if (!(await source.exists(transcriptPath))) return [];
  const result: ConversationMessage[] = [];
  let index = 0;
  try {
    for (const line of (await source.readFile(transcriptPath)).split("\n").filter(Boolean)) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const s = entry.source as string;
        const type = entry.type as string;
        const content = normalizeGeminiContent(entry.content);
        const timestamp = entry.created_at ? new Date(entry.created_at as string).toISOString() : new Date().toISOString();
        const id = `gemini-${index++}`;
        if (s === "USER_EXPLICIT" && type === "USER_INPUT") {
          const cleaned = extractUserRequest(content);
          if (cleaned) result.push({ id, role: "user", content: cleaned, timestamp, source: "gemini" });
        } else if (s === "MODEL" && type === "PLANNER_RESPONSE") {
          const toolCalls: ToolCall[] = ((entry.tool_calls as GeminiToolCall[]) || []).map((tc) => ({ name: tc.name || "unknown", input: tc.args || {} }));
          if (content || toolCalls.length) result.push({ id, role: "assistant", content, timestamp, toolCalls: toolCalls.length ? toolCalls : undefined, source: "gemini" });
        } else if (s === "MODEL" && ["LIST_DIRECTORY", "VIEW_FILE", "CODE_ACTION", "RUN_COMMAND"].includes(type)) {
          if (content) result.push({ id, role: "tool", content, timestamp, source: "gemini" });
        }
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
function extractUserRequest(content: string): string {
  if (!content) return "";
  const m = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  return m ? m[1].trim() : content.trim();
}
function cleanTitle(text: string, maxLength = 80): string {
  if (!text || text === "Untitled") return "Untitled";
  const firstLine = text.split("\n").find((l) => l.trim()) || "";
  const cleaned = firstLine.replace(/\s+/g, " ").replace(/<[^>]+>/g, " ").trim();
  if (!cleaned) return "Untitled";
  return cleaned.length <= maxLength ? cleaned : cleaned.slice(0, maxLength).trimEnd() + "…";
}
```

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: Commit** — `git add src/lib/gemini.ts src/lib/gemini.test.ts && git commit -m "refactor(gemini): inject FileSource, make async"`

---

### Task 2.5: hermes 解析器改造 + 测试

**Files:**
- Modify: `src/lib/hermes.ts`（读 `~/.hermes/sessions/sessions.json` + `request_dump_<id>_*.json`；内部 `listHermesSessions` 依赖 `readHermesSession`/`countHermesMessages`/`findLatestHermesDump`，全部要透传 `source`）
- Create: `src/lib/hermes.test.ts`

- [ ] **Step 1: 写测试 `src/lib/hermes.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行确认失败** → FAIL
- [ ] **Step 3: 重写 `src/lib/hermes.ts`** —— 所有函数加 `source` 首参并异步；`findLatestHermesDump` 用 `await source.readDir(ROOT)` 过滤排序后 `join(ROOT, files[last])`。

```ts
import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { ConversationMessage, ToolCall, ToolSession } from "./types";

interface HermesSessionEntry { session_id?: string; display_name?: string; created_at?: string; origin?: { chat_id?: string } }
interface HermesMessage { role?: string; content?: unknown; tool_calls?: HermesToolCall[] }
interface HermesToolCall { function?: { name?: string; arguments?: string }; name?: string; args?: Record<string, unknown> }
const ROOT = ".hermes/sessions";

export async function listHermesSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(ROOT))) return [];
  const sessionsPath = join(ROOT, "sessions.json");
  if (!(await source.exists(sessionsPath))) return [];
  try {
    const data = JSON.parse(await source.readFile(sessionsPath)) as Record<string, unknown>;
    const out: ToolSession[] = [];
    for (const entry of Object.values(data)) {
      const e = entry as HermesSessionEntry;
      const id = e.session_id || "";
      if (!id) continue;
      const fallbackTitle = (await extractHermesTitle(source, id)) || `Hermes ${id}`;
      out.push({
        id,
        title: e.display_name || fallbackTitle,
        createdAt: e.created_at || new Date().toISOString(),
        messageCount: await countHermesMessages(source, id),
        directory: e.origin?.chat_id || "",
      });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

async function extractHermesTitle(source: FileSource, sessionId: string): Promise<string | null> {
  const messages = await readHermesSession(source, sessionId);
  const firstUser = messages.find((m) => m.role === "user");
  return firstUser ? cleanTitle(firstUser.content) : null;
}

async function countHermesMessages(source: FileSource, sessionId: string): Promise<number> {
  const latest = await findLatestHermesDump(source, sessionId);
  if (!latest) return 0;
  try {
    const data = JSON.parse(await source.readFile(latest)) as Record<string, unknown>;
    const body = ((data.request as Record<string, unknown>)?.body as Record<string, unknown>) || {};
    return ((body.messages as HermesMessage[]) || []).length;
  } catch {
    return 0;
  }
}

export async function readHermesSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  const latest = await findLatestHermesDump(source, sessionId);
  if (!latest) return [];
  try {
    const data = JSON.parse(await source.readFile(latest)) as Record<string, unknown>;
    const body = ((data.request as Record<string, unknown>)?.body as Record<string, unknown>) || {};
    const messages = (body.messages as HermesMessage[]) || [];
    const result: ConversationMessage[] = [];
    const timestamp = (data.timestamp as string) || new Date().toISOString();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role || "";
      const content = normalizeHermesContent(msg.content);
      if (role === "system") result.push({ id: `hermes-${i}`, role: "system", content, timestamp, source: "hermes" });
      else if (role === "user") result.push({ id: `hermes-${i}`, role: "user", content, timestamp, source: "hermes" });
      else if (role === "assistant") {
        const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc) => ({
          name: tc.function?.name || tc.name || "unknown",
          input: (() => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return tc.args || {}; } })(),
        }));
        result.push({ id: `hermes-${i}`, role: "assistant", content, timestamp, toolCalls: toolCalls.length ? toolCalls : undefined, source: "hermes" });
      } else if (role === "tool") result.push({ id: `hermes-${i}`, role: "tool", content, timestamp, source: "hermes" });
    }
    return result;
  } catch {
    return [];
  }
}

async function findLatestHermesDump(source: FileSource, sessionId: string): Promise<string | null> {
  if (!(await source.exists(ROOT))) return null;
  const files = (await source.readDir(ROOT))
    .map((f) => f.name)
    .filter((n) => n.startsWith(`request_dump_${sessionId}_`) && n.endsWith(".json"))
    .sort();
  return files.length ? join(ROOT, files[files.length - 1]) : null;
}

function normalizeHermesContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => { if (typeof p === "string") return p; if (p && typeof p === "object") return (p as { text?: string }).text || JSON.stringify(p); return ""; }).join("\n");
  return content ? JSON.stringify(content) : "";
}
function cleanTitle(text: string, maxLength = 80): string {
  if (!text) return "";
  const firstLine = text.split("\n").find((l) => l.trim()) || "";
  const cleaned = firstLine.replace(/\s+/g, " ").replace(/<[^>]+>/g, " ").trim();
  return cleaned.length <= maxLength ? cleaned : cleaned.slice(0, maxLength).trimEnd() + "…";
}
```

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: Commit** — `git add src/lib/hermes.ts src/lib/hermes.test.ts && git commit -m "refactor(hermes): inject FileSource, make async"`

---

### Task 2.6: opencode 解析器改造（sqlite）+ sqlite 辅助

**Files:**
- Create: `electron/sqlite.ts`（打开本地 db 路径，只读）
- Modify: `src/lib/opencode.ts`（通过 `source.readFileBuffer` 拿到 db 字节 → 写临时文件 → 用 `electron/sqlite.ts` 打开）
- Create: `src/lib/opencode.test.ts`

- [ ] **Step 1: 写 `electron/sqlite.ts`**

```ts
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

/** 把 db 字节写入临时文件并以只读方式打开，返回 {db, cleanup}。调用方负责 cleanup()。 */
export function openDbFromBuffer(buf: Buffer): { db: Database.Database; cleanup: () => void } {
  const tmpPath = path.join(os.tmpdir(), `av_opencode_${process.pid}_${Math.random().toString(36).slice(2)}.db`);
  fs.writeFileSync(tmpPath, buf);
  const db = new Database(tmpPath, { readonly: true });
  db.pragma("journal_mode = WAL");
  db.pragma("wal_checkpoint(TRUNCATE)");
  const cleanup = () => { try { db.close(); } catch {} try { fs.unlinkSync(tmpPath); } catch {} };
  return { db, cleanup };
}
```

- [ ] **Step 2: 写测试 `src/lib/opencode.test.ts`**（构造一个真实 sqlite 库）

```ts
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
```

- [ ] **Step 3: 运行确认失败** → FAIL
- [ ] **Step 4: 重写 `src/lib/opencode.ts`**

```ts
import { join } from "../../electron/fs-source/util";
import { openDbFromBuffer } from "../../electron/sqlite";
import type { FileSource } from "../../electron/fs-source/types";
import type { OpenCodePart, ConversationMessage, ToolCall, ToolSession } from "./types";

const DB_REL = ".local/share/opencode/opencode.db";

async function withDb<T>(source: FileSource, fn: (db: import("better-sqlite3").Database) => T): Promise<T> {
  const buf = await source.readFileBuffer(DB_REL);
  const { db, cleanup } = openDbFromBuffer(buf);
  try {
    return fn(db);
  } finally {
    cleanup();
  }
}

export async function listOpenCodeSessions(source: FileSource): Promise<ToolSession[]> {
  if (!(await source.exists(DB_REL))) return [];
  return withDb(source, (db) => {
    const rows = db.prepare(`SELECT id, title, directory, model, cost, tokens_input, tokens_output, time_created FROM session ORDER BY time_created DESC`).all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      title: (r.title as string) || "Untitled",
      directory: (r.directory as string) || "",
      model: (() => { try { return JSON.parse(r.model as string).id; } catch { return r.model as string; } })(),
      cost: (r.cost as number) || 0,
      tokensInput: (r.tokens_input as number) || 0,
      tokensOutput: (r.tokens_output as number) || 0,
      createdAt: new Date(r.time_created as number).toISOString(),
      messageCount: 0,
    }));
  });
}

export async function readOpenCodeSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]> {
  if (!(await source.exists(DB_REL))) return [];
  return withDb(source, (db) => {
    const messages = db.prepare(`SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created`).all(sessionId) as { id: string; data: string; time_created: number }[];
    const result: ConversationMessage[] = [];
    for (const msg of messages) {
      const msgData = JSON.parse(msg.data) as { role: string };
      const parts = db.prepare(`SELECT id, data FROM part WHERE message_id = ? ORDER BY time_created`).all(msg.id) as { id: string; data: string }[];
      const parsedParts: OpenCodePart[] = parts.map((p) => JSON.parse(p.data) as OpenCodePart);
      const role = msgData.role;
      let content = "";
      const toolCalls: ToolCall[] = [];
      for (const part of parsedParts) {
        if (part.type === "text" && part.text) content += part.text + "\n";
        else if (part.type === "tool") toolCalls.push({ name: part.tool || "unknown", input: part.state?.input || {}, output: part.state?.output, status: part.state?.status });
      }
      if (content || toolCalls.length) {
        result.push({ id: msg.id, role: role as "user" | "assistant" | "system", content: content.trimEnd(), timestamp: new Date(msg.time_created).toISOString(), toolCalls: toolCalls.length ? toolCalls : undefined, source: "opencode" });
      }
    }
    return result;
  });
}
```

- [ ] **Step 5: 运行确认通过** → PASS
- [ ] **Step 6: Commit**

```bash
git add electron/sqlite.ts src/lib/opencode.ts src/lib/opencode.test.ts
git commit -m "refactor(opencode): read sqlite via FileSource buffer + helper"
```

---

### Task 2.7: detect 改造 + 移除 agy

**Files:**
- Modify: `src/lib/detect.ts`

- [ ] **Step 1: 重写 `src/lib/detect.ts`** —— `detectTools(source)`；从 `TOOL_DEFINITIONS` 删除 `agy`；计数逻辑用 `source`。

```ts
import path from "path";
import type { FileSource } from "../../electron/fs-source/types";
import { join } from "../../electron/fs-source/util";
import type { DetectedTool } from "./types";

const TOOL_DEFINITIONS = [
  { id: "claude-code", name: "Claude Code", icon: "🟠", color: "#f97316", description: "Anthropic Claude Code CLI sessions", detectPaths: [".claude/projects"] },
  { id: "opencode", name: "OpenCode", icon: "🔵", color: "#3b82f6", description: "OpenCode CLI sessions", detectPaths: [".local/share/opencode/opencode.db"] },
  { id: "deepseek", name: "DeepSeek", icon: "🟣", color: "#8b5cf6", description: "DeepSeek CLI sessions", detectPaths: [".deepseek/sessions"] },
  { id: "codex", name: "Codex", icon: "🟢", color: "#22c55e", description: "OpenAI Codex CLI sessions", detectPaths: [".codex/sessions"] },
  { id: "gemini", name: "Gemini CLI", icon: "🔷", color: "#06b6d4", description: "Google Gemini CLI conversations", detectPaths: [".gemini/antigravity-cli"] },
  { id: "hermes", name: "Hermes", icon: "⚪", color: "#a1a1aa", description: "Hermes agent sessions", detectPaths: [".hermes/sessions"] },
];

export async function detectTools(source: FileSource): Promise<DetectedTool[]> {
  const out: DetectedTool[] = [];
  for (const def of TOOL_DEFINITIONS) {
    const detected = await Promise.any(def.detectPaths.map((p) => source.exists(p).then((ok) => { if (!ok) throw new Error("no"); return p; }))).then(() => true).catch(() => false);
    let sessionCount = 0;
    if (detected) {
      try { sessionCount = await countSessions(source, def.id); } catch {}
    }
    out.push({ id: def.id, name: def.name, icon: def.icon, color: def.color, description: def.description, sessionCount, detected });
  }
  return out.filter((t) => t.detected);
}

async function countSessions(source: FileSource, toolId: string): Promise<number> {
  switch (toolId) {
    case "claude-code": {
      if (!(await source.exists(".claude/projects"))) return 0;
      let count = 0;
      for (const dir of await source.readDir(".claude/projects")) {
        if (!dir.isDirectory) continue;
        const files = await source.readDir(join(".claude/projects", dir.name));
        count += files.filter((f) => f.name.endsWith(".jsonl")).length;
      }
      return count;
    }
    case "opencode": return (await source.exists(".local/share/opencode/opencode.db")) ? 1 : 0;
    case "deepseek": return (await source.exists(".deepseek/sessions")) ? (await source.readDir(".deepseek/sessions")).filter((f) => f.name.endsWith(".json")).length : 0;
    case "codex": {
      if (!(await source.exists(".codex/sessions"))) return 0;
      let count = 0;
      async function walk(d: string) { for (const e of await source.readDir(d)) { if (e.isDirectory) await walk(join(d, e.name)); else if (e.name.endsWith(".jsonl")) count++; } }
      await walk(".codex/sessions");
      return count;
    }
    case "gemini": return (await source.exists(".gemini/antigravity-cli/history.jsonl")) ? 1 : 0;
    case "hermes": return (await source.exists(".hermes/sessions/sessions.json")) ? 1 : 0;
    default: return 0;
  }
}

export function getMachineName(): string { return ""; }   // 仅占位，主进程用 os.hostname()
```

> 注：`getMachineName`/`getMachineId` 原用于本机；主进程层会直接用 `os.hostname()`。保留空壳避免破坏潜在引用，主进程不依赖它。

- [ ] **Step 2: 全量测试** — Run: `npx vitest run` → 全部 PASS
- [ ] **Step 3: Commit** — `git add src/lib/detect.ts && git commit -m "refactor(detect): inject FileSource, drop agy"`

---

## Phase 3 — Electron 主进程与 IPC

### Task 3.1: source-manager（machineId → FileSource 缓存）

**Files:**
- Create: `electron/source-manager.ts`

- [ ] **Step 1: 写 `electron/source-manager.ts`**

```ts
import os from "os";
import type { MachineConfig } from "../src/lib/types";
import { LocalFileSource } from "./fs-source/local";
import { SshFileSource } from "./fs-source/ssh";
import type { FileSource } from "./fs-source/types";

const cache = new Map<string, FileSource>();

/** 根据 machine 配置解析并缓存 FileSource。local → LocalFileSource；ssh → SshFileSource（连接按 id 缓存）。 */
export async function getSource(machine: MachineConfig): Promise<FileSource> {
  const cached = cache.get(machine.id);
  if (cached) return cached;

  let source: FileSource;
  if (machine.type === "local" || machine.host === "localhost") {
    source = new LocalFileSource();
  } else {
    source = new SshFileSource({
      host: machine.host,
      port: machine.port,
      username: machine.user,
      password: machine.password,
      privateKey: machine.sshKey,
    });
    await source.init(); // 解析远程 $HOME、建立 SFTP
  }
  cache.set(machine.id, source);
  return source;
}

export async function disposeSource(machineId: string): Promise<void> {
  const s = cache.get(machineId);
  if (s) { try { await s.dispose?.(); } catch {} cache.delete(machineId); }
}

export async function disposeAll(): Promise<void> {
  for (const id of Array.from(cache.keys())) await disposeSource(id);
}

export function localMachine(): MachineConfig {
  return {
    id: `local-${os.hostname()}`,
    name: os.hostname(),
    host: "localhost",
    user: os.userInfo().username,
    port: 22,
    type: "local",
    authMethod: "sshKey",
    status: "online",
  };
}
```

- [ ] **Step 2: Commit** — `git add electron/source-manager.ts && git commit -m "feat(electron): source-manager resolves+caches FileSource per machine"`

> 说明：本任务引用 `./fs-source/ssh` 的 `SshFileSource`，该文件在 Task 4.1 创建。如按阶段顺序执行，先完成 Task 4.1 再回头编译此文件；或两者同批提交。任务编号为叙述顺序，不强制串行编译。

---

### Task 3.2: IPC handler

**Files:**
- Create: `electron/ipc.ts`

- [ ] **Step 1: 写 `electron/ipc.ts`** —— 把 17 个路由收敛为 6 个 IPC 方法。所有 handler `try/catch` 返回 `{error}`。

```ts
import { ipcMain } from "electron";
import { loadMachines, addMachine, removeMachine } from "../src/lib/machines";
import { detectTools } from "../src/lib/detect";
import { listClaudeSessionsAll, readClaudeSession } from "../src/lib/claude";
import { listCodexSessions, readCodexSession } from "../src/lib/codex";
import { listOpenCodeSessions, readOpenCodeSession } from "../src/lib/opencode";
import { listGeminiSessions, readGeminiSession } from "../src/lib/gemini";
import { listDeepSeekSessions, readDeepSeekSession } from "../src/lib/deepseek";
import { listHermesSessions, readHermesSession } from "../src/lib/hermes";
import type { ConversationMessage, MachineConfig, ToolSession } from "../src/lib/types";
import { getSource, disposeSource } from "./source-manager";

function ok<T>(v: T) { return { data: v }; }
function err(e: unknown) { return { error: String(e) }; }

function machineById(id: string): MachineConfig {
  const m = loadMachines().find((x) => x.id === id);
  if (!m) throw new Error("machine not found: " + id);
  return m;
}

export function registerIpc() {
  ipcMain.handle("machines:list", () => ok(loadMachines()));
  ipcMain.handle("machines:add", (_e, cfg) => { try { return ok(addMachine(cfg)); } catch (e) { return err(e); } });
  ipcMain.handle("machines:remove", async (_e, id) => { try { removeMachine(id); await disposeSource(id); return ok({ ok: true }); } catch (e) { return err(e); } });

  ipcMain.handle("tools:detect", async (_e, machineId) => { try { return ok(await detectTools(await getSource(machineById(machineId)))); } catch (e) { return err(e); } });

  ipcMain.handle("sessions:list", async (_e, machineId, toolId) => {
    try {
      const src = await getSource(machineById(machineId));
      const sessions: ToolSession[] = await listByTool(src, toolId);
      return ok(sessions);
    } catch (e) { return err(e); }
  });

  ipcMain.handle("sessions:read", async (_e, machineId, toolId, sessionId, projectPath) => {
    try {
      const src = await getSource(machineById(machineId));
      const messages: ConversationMessage[] = await readByTool(src, toolId, sessionId, projectPath);
      return ok(messages);
    } catch (e) { return err(e); }
  });
}

async function listByTool(src: Parameters<typeof listClaudeSessionsAll>[0], toolId: string): Promise<ToolSession[]> {
  switch (toolId) {
    case "claude-code": return listClaudeSessionsAll(src);
    case "codex": return listCodexSessions(src);
    case "opencode": return listOpenCodeSessions(src);
    case "gemini": return listGeminiSessions(src);
    case "deepseek": return listDeepSeekSessions(src);
    case "hermes": return listHermesSessions(src);
    default: throw new Error("unknown tool: " + toolId);
  }
}

async function readByTool(src: Parameters<typeof readClaudeSession>[0], toolId: string, sessionId: string, projectPath?: string): Promise<ConversationMessage[]> {
  switch (toolId) {
    case "claude-code": return readClaudeSession(src, projectPath || "", sessionId);
    case "codex": return readCodexSession(src, sessionId);
    case "opencode": return readOpenCodeSession(src, sessionId);
    case "gemini": return readGeminiSession(src, sessionId);
    case "deepseek": return readDeepSeekSession(src, sessionId);
    case "hermes": return readHermesSession(src, sessionId);
    default: throw new Error("unknown tool: " + toolId);
  }
}
```

- [ ] **Step 2: Commit** — `git add electron/ipc.ts && git commit -m "feat(electron): IPC handlers (machines/tools/sessions)"`

---

### Task 3.3: preload + 渲染端类型

**Files:**
- Create: `electron/preload.ts`
- Create: `electron/api.d.ts`

- [ ] **Step 1: 写 `electron/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { MachineConfig, DetectedTool, ToolSession, ConversationMessage } from "../src/lib/types";

const api = {
  machines: {
    list: (): Promise<{ data?: MachineConfig[]; error?: string }> => ipcRenderer.invoke("machines:list"),
    add: (cfg: Omit<MachineConfig, "id" | "status">) => ipcRenderer.invoke("machines:add", cfg),
    remove: (id: string) => ipcRenderer.invoke("machines:remove", id),
  },
  tools: {
    detect: (machineId: string): Promise<{ data?: DetectedTool[]; error?: string }> => ipcRenderer.invoke("tools:detect", machineId),
  },
  sessions: {
    list: (machineId: string, toolId: string): Promise<{ data?: ToolSession[]; error?: string }> => ipcRenderer.invoke("sessions:list", machineId, toolId),
    read: (machineId: string, toolId: string, sessionId: string, projectPath?: string): Promise<{ data?: ConversationMessage[]; error?: string }> => ipcRenderer.invoke("sessions:read", machineId, toolId, sessionId, projectPath),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type AgentViewerApi = typeof api;
```

- [ ] **Step 2: 写 `electron/api.d.ts`**（让渲染端 `window.api` 有类型）

```ts
import type { AgentViewerApi } from "./preload";
declare global {
  interface Window {
    api: AgentViewerApi;
  }
}
export {};
```

- [ ] **Step 3: Commit** — `git add electron/preload.ts electron/api.d.ts && git commit -m "feat(electron): preload bridge + window.api types"`

---

### Task 3.4: main.ts + electron tsconfig + 启动脚本

**Files:**
- Create: `electron/main.ts`
- Create: `tsconfig.electron.json`
- Modify: `package.json`（main 字段 + scripts + 依赖）

- [ ] **Step 1: 写 `tsconfig.electron.json`**（编译 `electron/` + `src/lib/` 的主进程代码为 CJS 到 `dist-electron/`）

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2020"],
    "outDir": "dist-electron",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["electron/**/*.ts", "src/lib/**/*.ts"]
}
```

- [ ] **Step 2: 写 `electron/main.ts`**

```ts
import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { registerIpc } from "./ipc";
import { disposeAll } from "./source-manager";
import { ensureDefaultMachine } from "./bootstrap";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 需要 ipcRenderer；contextIsolation 已开
    },
  });

  // 生产：加载 Next 静态导出；开发：加载 Next dev server
  if (process.env.AGENT_VIEWER_DEV === "1") {
    win.loadURL("http://localhost:3000");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../out/index.html"));
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  ensureDefaultMachine();
  registerIpc();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", async () => { await disposeAll(); });
```

- [ ] **Step 3: 写 `electron/bootstrap.ts`**（确保 machines.json 含本机默认项，复用 `getDefaultMachines`）

```ts
import { loadMachines, saveMachines, getDefaultMachines } from "../src/lib/machines";

export function ensureDefaultMachine() {
  const machines = loadMachines();
  const hasLocal = machines.some((m) => m.type === "local" || m.host === "localhost");
  if (!hasLocal) {
    saveMachines([...machines, ...getDefaultMachines()]);
  }
}
```

- [ ] **Step 4: 修改 `package.json`** —— 加 `main`、依赖、脚本。最终 `package.json` 关键字段：

```jsonc
{
  "name": "agent-viewer",
  "version": "0.1.0",
  "private": true,
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "build:electron": "tsc -p tsconfig.electron.json",
    "rebuild": "electron-rebuild -f -w better-sqlite3",
    "electron:dev": "AGENT_VIEWER_DEV=1 npm run build:electron && electron .",
    "dist": "npm run build && npm run build:electron && electron-builder"
  },
  "dependencies": {
    "better-sqlite3": "^12.10.0",
    "next": "16.2.6",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "react-markdown": "^10.1.0",
    "rehype-highlight": "^7.0.2",
    "remark-gfm": "^4.0.1",
    "electron": "^36.0.0",
    "ssh2": "^1.16.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/ssh2": "^1.15.0",
    "electron-builder": "^26.0.0",
    "@electron/rebuild": "^4.0.0",
    "eslint": "^9",
    "eslint-config-next": "16.2.6",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^3.0.0"
  },
  "build": {
    "appId": "com.agentviewer.app",
    "productName": "Agent Viewer",
    "files": ["out/**/*", "dist-electron/**/*", "node_modules/**/*", "package.json"],
    "directories": { "output": "release" },
    "asarUnpack": ["**/better-sqlite3/**", "**/*.node"],
    "win": { "target": ["nsis"] },
    "linux": { "target": ["AppImage", "deb"], "category": "Utility" }
  }
}
```

- [ ] **Step 5: 安装新依赖**

Run: `npm install`
Expected: 安装 electron、ssh2、electron-builder、@electron/rebuild、vitest 及其类型。

- [ ] **Step 6: 编译主进程，确认无类型错误**

Run: `npm run build:electron`
Expected: `dist-electron/` 生成，无报错。（此时代码引用了 Task 4.1 的 `SshFileSource`，若未完成需先做 Task 4.1。）

- [ ] **Step 7: Commit**

```bash
git add electron/main.ts electron/bootstrap.ts tsconfig.electron.json package.json package-lock.json
git commit -m "feat(electron): main process, tsconfig, build scripts, packaging config"
```

---

## Phase 4 — SSH 远程 FileSource

### Task 4.1: `SshFileSource`

**Files:**
- Create: `electron/fs-source/ssh.ts`

- [ ] **Step 1: 写 `electron/fs-source/ssh.ts`**

```ts
import { Client } from "ssh2";
import type { FileSource, DirEntry, FileStat } from "./types";
import { resolvePath, join } from "./util";

export interface SshOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export class SshFileSource implements FileSource {
  readonly kind = "ssh" as const;
  readonly home = ""; // init() 后填充
  private client = new Client();
  private sftp: Awaited<ReturnType<Client["sftp"]>> | null = null;
  private ready: Promise<void>;

  constructor(private opts: SshOptions) {
    this.ready = new Promise((resolve, reject) => {
      this.client
        .on("ready", () => resolve())
        .on("error", reject)
        .connect({
          host: opts.host,
          port: opts.port,
          username: opts.username,
          password: opts.password,
          privateKey: opts.privateKey ? Buffer.from(opts.privateKey) : undefined,
          readyTimeout: 15000,
        });
    });
  }

  /** 建立连接、解析远程 $HOME、缓存 sftp。 */
  async init(): Promise<void> {
    await this.ready;
    this.sftp = await new Promise((res, rej) => this.client.sftp((e, s) => (e ? rej(e) : res(s))));
    (this as { home: string }).home = await this.execHome();
  }

  private execHome(): Promise<string> {
    return new Promise((res, rej) => {
      let out = "";
      this.client.exec("echo $HOME", (e, stream) => {
        if (e) return rej(e);
        stream.on("data", (d: Buffer) => (out += d.toString()));
        stream.on("close", () => res(out.trim() || `/home/${this.opts.username}`));
        stream.stderr.on("data", () => {});
      });
    });
  }

  private async getSftp() {
    if (!this.sftp) await this.init();
    return this.sftp!;
  }

  async exists(p: string): Promise<boolean> {
    const sftp = await this.getSftp();
    return new Promise((res) => sftp.stat(resolvePath(this, p), (e) => res(!e)));
  }

  async readDir(p: string): Promise<DirEntry[]> {
    const sftp = await this.getSftp();
    return new Promise((res, rej) => {
      sftp.readdir(resolvePath(this, p), (e, list) => {
        if (e) return rej(e);
        res(list.map((item) => {
          const mode = item.attrs.mode || 0;
          const isDir = (mode & 0o170000) === 0o040000; // S_IFDIR
          return { name: item.filename, isDirectory: isDir };
        }));
      });
    });
  }

  async readFile(p: string): Promise<string> {
    const sftp = await this.getSftp();
    return new Promise((res, rej) => {
      let buf = "";
      const stream = sftp.createReadStream(resolvePath(this, p), { encoding: "utf-8" });
      stream.on("data", (d: string) => (buf += d));
      stream.on("end", () => res(buf));
      stream.on("error", rej);
    });
  }

  async readFileBuffer(p: string): Promise<Buffer> {
    const sftp = await this.getSftp();
    return new Promise((res, rej) => {
      const chunks: Buffer[] = [];
      const stream = sftp.createReadStream(resolvePath(this, p));
      stream.on("data", (d: Buffer) => chunks.push(d));
      stream.on("end", () => res(Buffer.concat(chunks)));
      stream.on("error", rej);
    });
  }

  async stat(p: string): Promise<FileStat> {
    const sftp = await this.getSftp();
    return new Promise((res, rej) => {
      sftp.stat(resolvePath(this, p), (e, st) => {
        if (e) return rej(e);
        res({ mtime: new Date((st.mtime ?? 0) * 1000) }); // SFTP 无 birthtime
      });
    });
  }

  async dispose(): Promise<void> {
    try { this.client.end(); } catch {}
  }
}
```

> 注：`join` 导入未在本文件用到时可删除；保留以防扩展。`readyTimeout`、S_IFDIR 判定按 ssh2 的 attrs 约定。

- [ ] **Step 2: 编译确认** — Run: `npm run build:electron` → 无报错
- [ ] **Step 3: Commit** — `git add electron/fs-source/ssh.ts && git commit -m "feat(electron): SshFileSource over ssh2/sftp"`

---

## Phase 5 — 渲染端迁移：fetch → window.api

### Task 5.1: page.tsx 改用 window.api，会话调用带 machineId

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 替换 `src/app/page.tsx` 的数据获取** —— 在文件顶部 import 之后添加 `/// <reference path="../../electron/api.d.ts" />`（或确保 tsconfig 包含该 d.ts）。然后逐处替换：

  - 顶部加载 machines（原 `fetch("/api/machines")`）：

```ts
useEffect(() => {
  window.api.machines.list().then((r) => { if (r.data) setMachines(r.data); }).catch(() => {});
}, []);
```

  - `loadTools`（原 `fetch("/api/tools?machineId=...")`）：

```ts
const loadTools = useCallback(async (machine: MachineConfig) => {
  setSelectedMachine(machine);
  setLoading(true);
  try {
    const r = await window.api.tools.detect(machine.id);
    setTools(r.data || []);
    setView("tools");
  } catch {}
  setLoading(false);
}, []);
```

  - `loadSessions`（原 `fetch("/api/${tool.id}/sessions")`）—— **新增 machineId 入参**：

```ts
const loadSessions = useCallback(async (tool: DetectedTool) => {
  if (!selectedMachine) return;
  setSelectedTool(tool);
  setLoading(true);
  try {
    const r = await window.api.sessions.list(selectedMachine.id, tool.id);
    setSessions(r.data || []);
    setView("sessions");
  } catch {}
  setLoading(false);
}, [selectedMachine]);
```

  - `loadSession` / `refreshSession`（原 `fetch("/api/${toolId}/session?id=...&projectPath=...")`）：

```ts
const loadSession = useCallback(async (session: ToolSession) => {
  if (!selectedTool || !selectedMachine) return;
  setSelectedSession(session);
  setLoading(true);
  setMessages([]);
  try {
    const r = await window.api.sessions.read(
      selectedMachine.id,
      selectedTool.id,
      session.id,
      selectedTool.id === "claude-code" ? session.projectPath : undefined
    );
    setMessages(r.data || []);
    setView("conversation");
  } catch (e) {
    console.error("Failed to load session:", e);
  }
  setLoading(false);
}, [selectedTool, selectedMachine]);

const refreshSession = useCallback(async () => {
  if (!selectedSession || !selectedTool || !selectedMachine) return;
  try {
    const r = await window.api.sessions.read(
      selectedMachine.id,
      selectedTool.id,
      selectedSession.id,
      selectedTool.id === "claude-code" ? selectedSession.projectPath : undefined
    );
    setMessages(r.data || []);
  } catch {}
}, [selectedSession, selectedTool, selectedMachine]);
```

  - `handleAddMachine`（原 POST `/api/machines/add`）：

```ts
const handleAddMachine = useCallback(async (m: { name: string; host: string; user: string; port: number; authMethod: "sshKey" | "password"; sshKey?: string; password?: string }) => {
  try {
    const r = await window.api.machines.add(m);
    if (r.data) setMachines((prev) => [...prev, r.data!]);
  } catch {}
  setShowAddMachine(false);
}, []);
```

  - `handleRemoveMachine`（原 POST `/api/machines/remove`）：

```ts
const handleRemoveMachine = useCallback(async (id: string) => {
  try {
    await window.api.machines.remove(id);
    setMachines((prev) => prev.filter((m) => m.id !== id));
  } catch {}
}, []);
```

- [ ] **Step 2: 类型检查** — Run: `npx tsc --noEmit -p tsconfig.json` → 无报错（`window.api` 类型来自 `electron/api.d.ts`，确认 tsconfig `include` 覆盖该文件；若否，在 tsconfig.json `include` 加 `"electron/api.d.ts"`）。

- [ ] **Step 3: Commit** — `git add src/app/page.tsx tsconfig.json && git commit -m "feat(ui): migrate page.tsx from fetch to window.api, pass machineId"`

---

## Phase 6 — 收尾：静态导出 + 删除 API 路由

### Task 6.1: 启用 Next 静态导出并删除 API 路由

**Files:**
- Modify: `next.config.ts`
- Delete: `src/app/api/**`（整目录）

- [ ] **Step 1: 改 `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // better-sqlite3 / ssh2 仅在 electron 主进程使用，不进入前端 bundle
  serverExternalPackages: ["better-sqlite3", "ssh2"],
  images: { unoptimized: true },
};

export default nextConfig;
```

- [ ] **Step 2: 删除 API 路由目录**

Run: `rm -rf src/app/api`
Expected: `src/app/api` 不复存在。

- [ ] **Step 3: 构建前端，确认静态导出成功**

Run: `npm run build`
Expected: 生成 `out/index.html`，无 `/api` 相关错误。如报「页面使用了服务端能力」，检查 page.tsx 是否仍有服务端导入（应无）。

- [ ] **Step 4: Commit**

```bash
git add next.config.ts
git rm -r src/app/api
git commit -m "build: enable static export, remove server API routes"
```

---

## Phase 7 — 集成验证与打包

### Task 7.1: 开发态联调（Electron 加载 Next dev）

- [ ] **Step 1: 重编译主进程 + rebuild 原生模块**

Run: `npm run build:electron && npm run rebuild`
Expected: `dist-electron/` 生成；better-sqlite3 已为 Electron 重编译（输出应显示成功）。

- [ ] **Step 2: 终端 A 起前端 dev** — Run: `npm run dev`（占住 3000 端口）
- [ ] **Step 3: 终端 B 起 Electron** — Run: `npm run electron:dev`
Expected: 窗口打开，加载 `http://localhost:3000`。依次验证：
  - Machines 视图显示本机；点进去看到检测到的工具与会话（功能与原 Web 版等价）。
  - 任选一个会话，能看到消息渲染。
  - LIVE 按钮轮询刷新生效。

- [ ] **Step 4: 如有问题**，用 `superpowers:systematic-debugging` 定位（常见：`window.api is undefined` → preload 路径不对；原生模块报错 → rebuild 未对准 Electron ABI）。

---

### Task 7.2: 生产打包（Linux AppImage + Windows NSIS）

- [ ] **Step 1: 一键打包**

Run: `npm run dist`
Expected: `release/` 下生成 `Agent Viewer-0.1.0.AppImage`、`.deb`、以及 Windows 的 `Agent Viewer Setup 0.1.0.exe`。

- [ ] **Step 2: 验证 Linux 包**

Run: `chmod +x "release/Agent Viewer-0.1.0.AppImage" && "./release/Agent Viewer-0.1.0.AppImage"`
Expected: 应用启动，本机会话正常浏览。

- [ ] **Step 3: 验证 Windows 包（拷到 Windows 机器或用 Wine 冒烟）**

把 `release/Agent Viewer Setup 0.1.0.exe` 拷到 Windows 双击安装 → 启动 → 浏览本机会话。
Expected: 启动正常；若 better-sqlite3 报 `.node` 加载失败，参见下方风险处置。

- [ ] **Step 4: 远程 SSH 手测**（在已能启动后）

点 Add Machine，填一台可 SSH 的 Linux 机器（密码或私钥），连上后浏览该机器的 Claude/Codex/OpenCode 等会话；验证 OpenCode 远程 sqlite 能打开。
Expected: 远程会话列表与内容正常显示；断开后该机器标记离线。

- [ ] **Step 5: 风险处置（仅出问题时）**
  - **Windows 上 better-sqlite3 加载失败**：electron-builder 在 Linux 跨平台出 Win 包时原生模块可能没正确为 win-x64 + Electron ABI 准备。处置：① 在 Windows 机器上 `npm install && npm run rebuild && npm run dist -- --win`；或 ② 用 GitHub Actions 的 `windows-latest` 跑打包。此为本计划最高风险点。
  - **静态导出后页面白屏**：检查 `out/index.html` 是否被正确 `loadFile`；Next 客户端路由 base path。
  - **SSH 连接慢/超时**：`readyTimeout` 已设 15s；必要时调整。

- [ ] **Step 6: Commit 产物配置微调（如有）**

```bash
git add package.json
git commit -m "build: packaging refinements"
```

---

### Task 7.3: 全量回归 + 收尾

- [ ] **Step 1: 全量测试** — Run: `npx vitest run` → 全绿
- [ ] **Step 2: 类型检查** — Run: `npx tsc --noEmit -p tsconfig.json && npm run build:electron` → 无报错
- [ ] **Step 3: lint** — Run: `npm run lint` → 无新增错误（已有的可忽略）
- [ ] **Step 4: 合并前自检** —— 确认：`agy` 已从检测列表移除；`claude`/`claude-code` 已合并为单条 `claude-code`；machines.json 明文密码已知安全项已记录在 spec；README 未改（不在范围）。
- [ ] **Step 5:（可选）合并到 main** —— 用 `superpowers:finishing-a-development-branch` 处理合并/PR。

---

## Self-Review（plan vs spec 覆盖核对）

- **方案 B / 进程模型** → Phase 3（main/preload/ipc）、Task 6.1（静态导出）。✅
- **FileSource 抽象（local/ssh）** → Task 1.1/1.2/4.1。✅
- **17 路由收敛为 6 IPC** → Task 3.2；**合并 claude/claude-code** → Task 3.2（`claude-code` 单条）。✅
- **移除 agy** → Task 2.7。✅
- **远程 SSH 浏览（含 OpenCode sqlite SFTP 下载）** → Task 4.1 + Task 2.6（readFileBuffer）+ Task 3.1（缓存/复用）。✅
- **better-sqlite3 重编译** → Task 1.2（装 @electron/rebuild）、Task 3.4（rebuild 脚本）、Task 7.1/7.2（执行 + Win 风险处置）。✅
- **electron-builder Win NSIS + Linux AppImage** → Task 3.4（build 配置）、Task 7.2（出包）。✅
- **不签名、不自动更新** → build 配置无 signing/updater；spec 非目标已声明。✅
- **单测（FakeFileSource + 解析器）** → Task 1.2、2.1–2.7。✅
- **错误契约 `{error}`** → Task 3.2 handler 全 try/catch。✅
- **machines.json 明文密码** → spec 已记录为已知安全项，本计划不加密。✅

**无占位符**：所有步骤含可执行代码或精确命令。**类型一致**：`FileSource` 方法名（`exists/readDir/readFile/readFileBuffer/stat`）、IPC channel 名（`machines:list` 等）、`window.api` 形状在各任务间一致。**签名一致**：解析器统一为 `(source, ...ids) => Promise<...>`。
