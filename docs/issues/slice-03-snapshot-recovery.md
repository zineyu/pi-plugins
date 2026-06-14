# Slice 3: 实现文件快照校验和 drift 恢复

## Parent

PRD: pi-hashline v2 — 基于快照标签的 Hashline 编辑工具 (`docs/PRD-hashline-v2.md`)

## What to build

在 `hashline_edit` 执行编辑前，先校验输入头部 `[PATH#HASH]` 是否与当前文件内容匹配。若匹配直接 apply；若不匹配，尝试从 `SnapshotStore` 中取出对应历史版本，把编辑应用到历史版本后生成 patch，再用 `diff` 包三路合并到当前文件。

需要打通的层：

- `hashline_edit` 执行流程增加"读取当前文件 → 计算实际快照 → 与头部快照比较"步骤。
- `Recovery` 模块：对历史版本 apply 编辑，用 `Diff.structuredPatch` + `Diff.applyPatch`（fuzzFactor = 0）合并到当前文件。
- edit 成功后，用新文件内容更新 `SnapshotStore` 的 head。
- 错误处理：快照不匹配且无法恢复时，抛出结构化 `stale_snapshot` 错误。

## Acceptance criteria

- [ ] 文件内容未改变时 edit 成功。
- [ ] 文件被外部非冲突修改后，edit 成功并附带恢复警告。
- [ ] 文件被外部冲突修改或历史快照不在内存中时，edit 失败，错误码为 `stale_snapshot`。
- [ ] 连续两次 edit 同一个文件，第二次 edit 基于第一次 edit 后的新快照成功。
- [ ] 新增集成测试覆盖匹配、非冲突恢复、冲突失败、连续编辑四个场景。

## Blocked by

- Slice 1: 实现 `[PATH#HASH]` 语法和单文件 replace 编辑
- Slice 2: 扩展语法支持 insert、delete 和文件边界操作（soft，至少 replace 可用）
