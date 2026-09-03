# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- i18n: all UI strings centralized in `src/components/i18n.ts` with English and
  Chinese dictionaries; language toggle in the nav bar (persisted).
- Component test infrastructure (@testing-library + jsdom) with tests for
  MachineCards, AddMachineModal and MessageBubble.

### Changed

- Swimlane view is virtualized: node positions are computed from lane geometry
  and the virtualizer instead of measuring every node with
  `getBoundingClientRect`; large sessions no longer mount the whole graph.
- Accessibility: cards are keyboard-focusable buttons, the add-machine dialog
  is a proper `role="dialog"` (Esc closes, focus trap on open, labelled
  fields, radios use `role="radio"`).

### Fixed

- SSH command failures (non-zero exit, e.g. `test -e` misses during detection)
  no longer trigger a pointless reconnect-and-retry round trip.
- LIVE polling no longer fires overlapping refreshes on slow SSH connections
  (a slow response could previously overwrite newer data).
- `machines.ts` config directory is overridable via `AGENT_VIEWER_CONFIG_DIR`
  for testing; machine add/remove/persistence now has unit tests.

## [0.3.0] - 2026-09-03

### Security

- Blocked whole-window navigation from transcript content: links in (untrusted)
  sessions now open in the system browser instead of taking over the window.
- SSH connections now verify the host key trust-on-first-use (TOFU); a changed
  host key refuses the connection instead of silently accepting possible MITM.
- Plaintext SSH passwords are no longer sent to the renderer process over IPC.

### Added

- MIT license, real README, CONTRIBUTING, SECURITY policy, changelog.
- Dependabot and CodeQL setup.

### Fixed

- OpenCode: one corrupt sqlite row no longer fails the whole session
  (per-record tolerance), and no longer triggers a pointless full-database
  copy over SSH — the sqlite fallback now only engages on transport/open
  failures, not on data errors.
- Hermes: session listing no longer reads every dump file twice (N+1) and
  lists sessions in parallel.
- Adding/removing a machine now shows errors instead of silently failing;
  the session list is cleared when loading fails (no stale rows next to the
  error banner).
- Tool-result pairing is now one shared, tested implementation across all six
  parsers instead of six subtly divergent copies.

### Performance

- The conversation view is virtualized: sessions with tens of thousands of
  messages now render only the visible rows instead of mounting everything.

## [0.2.3] - 2026-09-01

- Swimlane tool-call detail rows, categorized.

## [0.2.2] - 2026-09-01

- Swimlane becomes an interaction sequence diagram: arrows and visible thinking.

## [0.2.1] - 2026-08-27

- Compact-by-default density with 摘要/详细 toggle.

## [0.2.0] - 2026-08-27

- Complete thinking/tool-call coverage across parsers; subagent lanes;
  waterfall/swimlane dual view.

## [0.1.9] - 2026-08-27

- Kimi Code CLI support.

## [0.1.8] - 2026-08-27

- Codex sessions grouped by project (cwd from session_meta).

## [0.1.7] - 2026-08-27

- SSH: sqlite queries run on the remote via python3 instead of copying the db.

## [0.1.6] - 2026-08-26

- SQLite: open local dbs directly; query WSL dbs via wsl.exe python3;
  new hermes state.db layout.

## [0.1.5] - 2026-08-26

- WSL distro enumeration via wsl.exe; auto-discover machines from
  ~/.ssh/config; cross-platform CI smoke tests.

## [0.1.3] - 2026-08-26

- Release pipeline fixes (full build chain, per-platform icons, asset tracking).

## [0.1.2] - 2026-06-26

- Claude: parse single-block content and tool_result outputs.

## [0.1.1] - 2026-06-26

- Electron installer polish; SSH via exec instead of SFTP; hardening fixes.

## [0.1.0] - 2026-06-04

- Initial release: multi-agent session viewer (Claude Code, Codex, OpenCode,
  Gemini, DeepSeek, Hermes), local + SSH machines.
