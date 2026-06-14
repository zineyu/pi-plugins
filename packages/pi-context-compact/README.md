# pi-context-compact

Context compaction trigger tool for [pi](https://pi.dev). It gives the agent a `compact_context` tool so it can conservatively start pi's built-in compaction when the conversation is getting long or when the user asks to compress context.

## Install

```bash
pi install git:github.com/zineyu/pi-plugins
```

This monorepo install loads every extension listed in the root `package.json` `pi.extensions` field.

## Usage

Once loaded, the extension registers:

1. **`compact_context` tool** — starts pi's built-in context compaction with optional focus instructions.
2. **`/compact-context [instructions]` command** — manually starts the same compaction flow.

Example tool intent:

```text
compact_context(customInstructions="Preserve the current goal, key decisions, modified files, blockers, and next steps.")
```

Example command:

```text
/compact-context Preserve the current implementation plan and validation status.
```

## Behavior

- Uses `ctx.compact()`; it does not replace pi's built-in summarization logic.
- Starts compaction asynchronously and returns immediately.
- Uses an in-memory guard so repeated calls while compaction is running do not start concurrent compactions.
- Reports completion or failure through UI notifications when UI is available.
- Returns `terminate: true` from the tool so the agent stops after requesting compaction instead of continuing long-running work on stale context.

## Development

```bash
pnpm install
pnpm format:check
```
