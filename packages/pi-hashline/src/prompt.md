# Hashline Edit Syntax

Use `hashline_edit` to modify a single text file with line-anchored edits.

## Header

Every patch must start with exactly one file header:

```text
[PATH#HASH]
```

- `PATH` is the file path shown in the read output.
- `HASH` is the 4-character uppercase hexadecimal snapshot tag shown in the read output.
- Multiple `[PATH#HASH]` sections in one call are not allowed.

## Operations

### Replace

```text
replace N..M:
+new line 1
+new line 2
```

- `replace N:` replaces a single line.
- `replace N..M:` replaces a range of lines (inclusive).
- A replace operation must have at least one payload line.

### Insert

```text
insert before N:
+new line

insert after N:
+new line

insert head:
+new line

insert tail:
+new line
```

- `insert before N:` inserts payload before line `N`.
- `insert after N:` inserts payload after line `N`.
- `insert head:` inserts payload at the start of the file.
- `insert tail:` inserts payload at the end of the file.
- An insert operation must have at least one payload line.

### Delete

```text
delete N
delete N..M
```

- `delete N` removes a single line.
- `delete N..M` removes a range of lines (inclusive).
- A delete operation must not have payload lines.

## Payload rules

- Payload lines start with `+`.
- A line that contains only `+` inserts an empty line.
- The payload for `replace` and `insert` must contain at least one line.
- The payload for `delete` must be empty.

## Read output format

When you read a text file, the output is decorated as:

```text
[PATH#ABCD]
1:first line
2:second line
3:third line
```

Copy the `[PATH#HASH]` header and the line numbers directly into your patch.

## Prohibited

- Do not use the old `§`, `»`, `«`, or `≔` operators; they are no longer supported.
- Do not include explanatory text in the patch body; only headers, operations, and payload lines are allowed.
- Do not include multiple files in one `hashline_edit` call.

## Recovery

If the file has drifted since your last read, the tool may recover the edit automatically. If it cannot recover safely, it returns a `stale_snapshot` error and you must re-read the file.
