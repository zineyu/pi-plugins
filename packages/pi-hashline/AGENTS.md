# AGENTS.md

> pi-hashline — a pi extension that provides line-anchored file edits via content hashes (FNV-1a), replacing traditional `str_replace`.

## Entry point

- `src/hashline.ts` — loaded by pi via `jiti` at runtime.

## Key behaviors

- **Decorates `read` results**: text files are rewritten so each line is prefixed with `LINE+HASH|`.
- **Registers `hashline_edit`**: accepts patch text starting with `§PATH`, followed by `»`, `«`, or `≔` operations.
- **Suppresses native `edit` tool**: on `session_start`, the native `edit` tool is removed from active tools so only `hashline_edit` is available.

## Anchor format

- Anchors are `LINE` + 2-character lowercase hash, e.g. `42ab`.
- Hashes are computed from the line content after stripping `\r` and trailing whitespace.
- Line number is not part of the hash; anchors remain stable when content is unchanged.

## Operations

- `»ANCHOR` — insert payload after the anchored line (`EOF` allowed).
- `«ANCHOR` — insert payload before the anchored line (`BOF` allowed).
- `≔START..END` — replace the inclusive range. If no payload follows, the range is deleted.

## Safety

- Before applying edits, every referenced anchor hash is validated against the current file.
- On mismatch, a `HashlineMismatchError` is thrown and the file is NOT modified.
- Edits are wrapped with `withFileMutationQueue` to serialize concurrent writes to the same file.

## References

- `README.md` — user-facing install and usage guide
- `src/hashline.ts` — extension implementation
