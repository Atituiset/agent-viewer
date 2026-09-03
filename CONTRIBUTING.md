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
  fine (the codebase mixes both), but error strings and UI copy are English.
- Conventional commits (`feat(parser): …`, `fix(ssh): …`).
- Keep diffs minimal and focused; unrelated refactors go in separate PRs.

## Reporting bugs

Open an issue with: agent tool + version, machine type (local/SSH/WSL), and if
possible a **redacted** excerpt of the session file that fails to parse. Please don't
paste raw transcripts — they may contain secrets or private code.
