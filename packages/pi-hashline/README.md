# pi-hashline

Hashline edit tool for [pi](https://pi.dev) — line-anchored file edits via file snapshots, inspired by [oh-my-pi](https://github.com/can1357/oh-my-pi).

## What is Hashline?

When a model reads a file, the result is decorated with a `[PATH#HASH]` snapshot header and `LINE:` prefixes:

```text
[src/main.ts#A1B2]
1:function hello() {
2:  return "world";
3:}
```

The `HASH` is a 4-character uppercase hexadecimal xxHash32 tag of the entire file. The model copies the header and line numbers directly into a `hashline_edit` call.

Operations:

- `replace N..M:` — replace the inclusive line range.
- `replace N:` — replace a single line.
- `insert before N:` / `insert after N:` — insert payload near a line.
- `insert head:` / `insert tail:` — insert at the start or end of the file.
- `delete N` / `delete N..M` — delete a line or range.

Payload lines must start with `+`. A line containing only `+` inserts an empty line.

If the file changed since the last read, the snapshot may still match (no drift) or the tool may attempt a three-way merge from a recent in-memory version. If recovery is not possible, the edit is rejected with a `stale_snapshot` error before the file is modified.

## Install

```bash
pi install git:github.com/zineyu/pi-plugins
```

Or clone the monorepo into your pi extensions directory:

```bash
cd ~/.pi/agent/extensions
git clone https://github.com/zineyu/pi-plugins.git
```

## Usage

Once loaded, the extension does three things:

1. **Decorates `read` output** with `[PATH#HASH]` and `LINE:` prefixes.
2. **Registers a `hashline_edit` tool** that accepts patch text in hashline v2 format.
3. **Suppresses the native `edit` tool** on `session_start`.

Example patch:

```text
[src/main.ts#A1B2]
replace 1..3:
+function hi() {
+  return "universe";
+}
insert tail:
+console.log("done");
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm format:check
```

## Why?

Traditional `str_replace` requires the model to reproduce every character perfectly — including whitespace and indentation. Hashline eliminates that failure mode by giving the model stable, verifiable identifiers for the lines it wants to change, and a file-level snapshot to detect and recover from external drift.
