# Agent Viewer

**One window for every AI coding agent session — local and remote.**

Browse, search and follow the session transcripts of all your AI coding agents, across every machine you SSH into. No cloud, no uploads: everything is read from the agents' own storage, on the machines where it lives.

[![CI](https://github.com/Atituiset/agent-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/Atituiset/agent-viewer/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Atituiset/agent-viewer)](https://github.com/Atituiset/agent-viewer/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why

AI coding agents accumulate sessions in `~/.claude`, `~/.codex`, sqlite databases and assorted JSONL files — spread across your laptop, dev servers and WSL instances. When you want to check *"what did the agent actually do?"*, you're stuck reading raw JSONL. Agent Viewer turns all of it into:

- **A unified session browser** — sessions from every detected agent on every configured machine, newest first, with title, project, model, token and cost metadata.
- **A conversation view** — messages, thinking blocks and tool calls rendered as readable chat with syntax-highlighted markdown.
- **A swimlane view** — the session as an interaction sequence diagram, including sub-agents in their own lanes.
- **Live mode** — watch a session update in real time while the agent is still working.
- **English & Chinese UI** — auto-detected from the system language, toggleable in the nav bar.

## Supported agents

| Agent | Storage | Format |
|---|---|---|
| Claude Code | `~/.claude/projects` | JSONL |
| Codex | `~/.codex/sessions` | JSONL |
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite |
| Gemini CLI | `~/.gemini/antigravity-cli` | JSONL |
| DeepSeek | `~/.deepseek/sessions` | JSON |
| Hermes | `~/.hermes/sessions` | JSONL |
| Kimi Code | `~/.kimi-code/sessions` | JSONL |

Adding a new agent is two steps: write `src/lib/<tool>.ts` (list/read), then add one entry to the registry (`src/lib/registry.ts`).

## Machines

- **Local** — works out of the box.
- **SSH** — add any Linux machine (host, user, SSH key or password). Detection, listing and streaming all happen over SSH; session data is read on demand, never synced or copied to a central store.
- **WSL** — on Windows, WSL instances are treated as first-class filesystems.

Passwords are encrypted with the OS keychain (Electron `safeStorage`); SSH host keys are verified trust-on-first-use (TOFU).

## Download

Prebuilt installers are on the [Releases](https://github.com/Atituiset/agent-viewer/releases/latest) page:

| Platform | Artifacts |
|---|---|
| Windows | `Agent Viewer Setup x.y.z.exe` (NSIS) |
| macOS | `.dmg` / `.zip` |
| Linux | `.AppImage` / `.deb` |

> Windows/macOS builds are currently unsigned, so SmartScreen/Gatekeeper will warn on first launch. Signed & notarized builds are on the roadmap.

## Development

```bash
npm install
npm run rebuild        # build better-sqlite3 against Electron's ABI
npm run dev            # terminal 1: Next.js dev server
npm run electron:dev   # terminal 2: Electron shell
```

Useful scripts:

```bash
npm test               # vitest (parsers, file sources, registry)
npm run lint
npm run smoke          # main-process smoke test (native module + boot)
npm run dist           # build installers with electron-builder
```

## Privacy

Agent Viewer is a read-only viewer. It never modifies agent session files, never sends data anywhere, and has no telemetry. The only files it writes are its own config (`~/.config/agent-viewer/`) and temporary files for remote SQLite reads, which are deleted after use.

## Contributing

Issues and pull requests are welcome. Bug reports are most useful when they include (a redacted excerpt of) the session file that fails to parse.

## License

[MIT](LICENSE)
