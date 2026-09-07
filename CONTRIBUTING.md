# Contributing

Thanks for your interest in contributing! This is a small, focused codebase and
contributions are welcome — bug reports, parser fixes, new agent support, UI polish,
and docs.

## Development setup

```bash
npm install
npm run rebuild        # build better-sqlite3 for Electron's ABI
npm run dev            # terminal 1: Next.js dev server (http://localhost:3000)
npm run electron:dev   # terminal 2: Electron shell (needs terminal 1 running)
```

## Before opening a PR

```bash
npm test               # vitest — parser/fs-source/registry unit tests
npm run lint           # eslint
npm run build          # Next.js static export must build
npm run smoke          # Electron main-process smoke test
```

## Adding support for a new agent

The parser registry makes this a two-step change:

1. Create `src/lib/<tool>.ts` exporting:
   - `listSessions(source: FileSource): Promise<ToolSession[]>`
   - `readSession(source: FileSource, sessionId: string): Promise<ConversationMessage[]>`
2. Add one entry to `TOOLS` in `src/lib/registry.ts`.

All file I/O goes through the `FileSource` abstraction (`electron/fs-source/`), so your
parser automatically works for local, SSH and WSL machines — never `require("fs")`
directly in a parser. Add tests with `FakeFileSource` (see any of the existing
`*.test.ts` files for the pattern).

Parser ground rules:

- **Be fault tolerant per record.** One corrupt line/row must not fail the whole
  session — skip it (or use the shared helpers like the parsers do).
- **Pair tool results** via `src/lib/tool-pairing.ts`, don't hand-roll another loop.
- Listing must stay cheap: use `readHead`/`lineCount`, never read whole transcript
  files in `listSessions`.

## Style

- TypeScript strict; no `any`, no `ts-ignore`. Commentary in Chinese or English is
  fine (the codebase mixes both).
- **All UI copy goes through `src/components/i18n.ts`** — add your string to both
  the `en` and `zh` dictionaries, never hardcode text in components. The
  `i18n.test.ts` placeholder-parity check will catch mismatches.
- Component tests use @testing-library with jsdom; test files in
  `src/components/*.test.tsx` start with `// @vitest-environment jsdom`.
- Conventional commits (`feat(parser): …`, `fix(ssh): …`).
- Keep diffs minimal and focused; unrelated refactors go in separate PRs.

## Reporting bugs

Open an issue with: agent tool + version, machine type (local/SSH/WSL), and if
possible a **redacted** excerpt of the session file that fails to parse. Please don't
paste raw transcripts — they may contain secrets or private code.

### An agent is not detected

Heuristic discovery works in two layers:

1. **File-driven (primary)**: the machine is scanned for `*.jsonl` / `*.json`
   transcript files under home dot-directories (`~/.<x>/…`, `.config`, 
   `.local/share`), and the enclosing directory becomes a session root — 
   **the container directory's name doesn't matter** (`sessions`, `chats`,
   `runs`, flat files at the root, anything). Candidates are validated by
   sampling: a root is only shown if its files parse as a recognizable
   transcript shape.
2. **Directory-name-driven (fallback)**: directories named
   `sessions`/`projects`/`history` are also probed directly.

If your agent still doesn't show up, work through this checklist — the most
common causes are at the top:

| # | Check | How | Symptom |
|---|-------|-----|---------|
| 1 | **Wrong login user** | The machine entry in Agent Viewer must log in as the *same user* that runs the agent CLI (its sessions live under that user's `$HOME`). | Agent runs as `root`, you log in as someone else → nothing found |
| 2 | **Connection failure** | A red error banner on the tools page means SSH/auth failed — fix that first. | "Connection Failed" + error text |
| 3 | **Storage outside home dot-dirs** | Agent data under `/opt`, `/var`, or a non-dot directory is not scanned. | Empty tool list, no error |
| 4 | **File format** | Run the diagnostic below — transcripts must be `.jsonl`/`.json` in a recognizable shape. | Empty tool list, no error |

Then run this diagnostic **on the target machine** (SSH into it, as the user
from check #1). Set `DIR` to the agent's directory — `$HOME/.<agent>` if it
runs under your user, or an absolute path like `/root/.codeagent` if it runs
as another user:

```bash
DIR="$HOME/.codeagent"   # ← 换成你的 agent 目录；root 跑的用 /root/.codeagent
echo "== contents =="; ls -la "$DIR" 2>/dev/null
echo "== jsonl/json files =="; find "$DIR" -maxdepth 4 -type f \( -name '*.jsonl' -o -name '*.json' \) 2>/dev/null | head -15
echo "== sample =="; find "$DIR" -maxdepth 4 -type f \( -name '*.jsonl' -o -name '*.json' \) 2>/dev/null | head -1 | xargs -r -I{} sh -c 'echo "== {}"; head -c 600 "{}"'
```

Include the output (redact anything sensitive) in your issue — it answers both
questions needed to add support: **where** the sessions are stored and **what
format** the transcripts use. Recognized transcript shapes are Claude-style
(`{"type":"user","message":…}`), Codex-style (`{"type":"response_item",…}`),
and plain chat dumps (`{"role":"user","content":…}`).
