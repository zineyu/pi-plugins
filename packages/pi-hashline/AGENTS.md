# AGENTS.md

> pi-hashline — a pi extension that provides line-anchored file edits via file snapshot tags (xxHash32), replacing traditional `str_replace` and the old `§»«≔` hashline syntax.

## Entry point

- `src/hashline.ts` — loaded by pi via `jiti` at runtime.

## Key behaviors

- **Decorates `read` results**: text files are rewritten with a `[PATH#HASH]` snapshot header and `LINE:` line prefixes.
- **Registers `hashline_edit`**: accepts patch text starting with `[PATH#HASH]`, followed by `replace`, `insert`, or `delete` operations.
- **Suppresses native `edit` tool**: on `session_start`, the native `edit` tool is removed from active tools so only `hashline_edit` is available.
- **Recovers from drift**: when the current file does not match the expected snapshot, the extension attempts a three-way merge from a recent in-memory version stored in `SnapshotStore`.

## Snapshot tag

- Snapshot tags are 4-character uppercase hexadecimal hashes, e.g. `A1B2`.
- They are computed from the entire LF-normalized file content using an embedded pure-JavaScript xxHash32 implementation.
- Tags are computed when `read` output is decorated and updated after each successful `hashline_edit`.

## Patch syntax

- Header: `[PATH#HASH]`.
- Operations:
  - `replace N..M:` / `replace N:`
  - `insert before N:` / `insert after N:` / `insert head:` / `insert tail:`
  - `delete N` / `delete N..M`
- Payload lines start with `+`; a single `+` inserts an empty line.
- `replace` and `insert` require at least one payload line.
- `delete` must not have payload lines.
- Only one file section per patch is allowed.

## Safety

- Before applying edits, the file snapshot is validated against the patch header.
- On mismatch, `attemptRecovery` tries to merge the edit from a historical snapshot using `diff`.
- If recovery fails, a `HashlineError` with code `stale_snapshot` is thrown and the file is NOT modified.
- Edits are wrapped with `withFileMutationQueue` to serialize concurrent writes to the same file.

## References

- `README.md` — user-facing install and usage guide
- `src/hashline.ts` — extension implementation
- `src/prompt.md` — model-visible syntax reference
