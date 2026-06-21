# Hermes / Gemini Session Support Design

Date: 2026-06-21

## Problem

The agent-viewer frontend detects Hermes and Gemini tools via `src/lib/detect.ts`, but the corresponding Next.js API routes do not exist. As a result, requests to `/api/hermes/sessions` and `/api/gemini/sessions` return 404.

## Goal

Add backend support so that Hermes and Gemini sessions can be listed and rendered in the conversation view, following the same pattern as existing providers (Codex, DeepSeek, OpenCode, Claude Code).

## Data Sources

### Hermes

- Session metadata: `~/.hermes/sessions/sessions.json`
- Conversation history: `~/.hermes/sessions/request_dump_<session_id>_<timestamp>_<hash>.json`
- Each request dump contains the full message history up to that point under `request.body.messages`.

### Gemini (Antigravity CLI)

- Session index: `~/.gemini/antigravity-cli/history.jsonl` (user prompts, timestamps, workspace, `conversationId`)
- Conversation history: `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl`
- `transcript.jsonl` is plaintext JSONL with `source`, `type`, `content`, `tool_calls`, and `created_at` fields.

## Mapping to Common Types

### `ToolSession` (list view)

| Field | Hermes | Gemini |
|-------|--------|--------|
| `id` | `session_id` | `conversationId` |
| `title` | `display_name` or first user prompt | first `display` from history |
| `createdAt` | `created_at` | first `timestamp` (ms → ISO) |
| `messageCount` | messages in latest dump | number of transcript entries |
| `project` / `directory` | `origin.chat_id` | `workspace` |

### `ConversationMessage` (detail view)

**Hermes**
- Maps `request.body.messages` directly.
- Roles: `system`, `user`, `assistant`, `tool`.
- Content may be string or array; normalize to string.

**Gemini**
- `USER_EXPLICIT` + `USER_INPUT` with content → `user`
- `MODEL` + `PLANNER_RESPONSE` with content → `assistant`
- `MODEL` + `PLANNER_RESPONSE` with `tool_calls` → `assistant` with `toolCalls`
- `MODEL` + `LIST_DIRECTORY` / `VIEW_FILE` / `CODE_ACTION` / `RUN_COMMAND` with content → `tool`
- `SYSTEM` + `CONVERSATION_HISTORY` → skip

## API Routes

- `GET /api/hermes/sessions` → `{ sessions: ToolSession[] }`
- `GET /api/hermes/session?id=<session_id>` → `{ messages: ConversationMessage[] }`
- `GET /api/gemini/sessions` → `{ sessions: ToolSession[] }`
- `GET /api/gemini/session?id=<conversationId>` → `{ messages: ConversationMessage[] }`

## Files to Add

- `src/lib/hermes.ts`
- `src/lib/gemini.ts`
- `src/app/api/hermes/sessions/route.ts`
- `src/app/api/hermes/session/route.ts`
- `src/app/api/gemini/sessions/route.ts`
- `src/app/api/gemini/session/route.ts`

## Files Unchanged

- `src/lib/detect.ts` already detects both providers.
- `src/app/page.tsx` already constructs `/api/${tool.id}/sessions` URLs generically.

## Error Handling

- Missing files return empty arrays, not 500.
- Malformed JSON/JSONL lines are skipped individually.
- API routes catch exceptions and return 500 with the error message.

## Future Work

- Support `transcript_full.jsonl` when available for richer Gemini detail.
- Add `agy` support if `.agy/sessions` data format becomes known.
