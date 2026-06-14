# Slice 2: 扩展语法支持 insert、delete 和文件边界操作

## Parent

PRD: pi-hashline v2 — 基于快照标签的 Hashline 编辑工具 (`docs/PRD-hashline-v2.md`)

## What to build

在 Slice 1 已实现的 replace 基础上，扩展 `Executor` 和 `apply`，支持 `insert before/after N:`、`insert head:`、`insert tail:`、`delete N` 和 `delete N..M:`。明确 payload 规则：`delete` 不允许有 body，`insert` 和 `replace` 必须有 body，payload 行以 `+` 开头（`+` 单独一行表示空行）。

需要打通的层：

- `Tokenizer` 识别新增操作头关键字。
- `Executor` 把 insert/delete 操作头转换为对应 `Edit[]`（含 bof/eof cursor）。
- `apply` 支持在同一条目标行上组合多个 insert/delete 编辑（按 patch 顺序）。
- `hashline_edit` 工具接受并执行上述操作。

## Acceptance criteria

- [ ] `insert after N:` 在指定行后插入 payload。
- [ ] `insert before N:` 在指定行前插入 payload。
- [ ] `insert head:` 在文件开头插入 payload。
- [ ] `insert tail:` 在文件末尾插入 payload。
- [ ] `delete N` 删除单行。
- [ ] `delete N..M` 删除连续范围。
- [ ] `delete` 带 body、`replace`/`insert` 无 body 时报错。
- [ ] 新增集成测试覆盖上述所有操作。

## Blocked by

- Slice 1: 实现 `[PATH#HASH]` 语法和单文件 replace 编辑
