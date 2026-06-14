# Slice 1: 实现 `[PATH#HASH]` 语法和单文件 replace 编辑

## Parent

PRD: pi-hashline v2 — 基于快照标签的 Hashline 编辑工具 (`docs/PRD-hashline-v2.md`)

## What to build

实现最小可用的新语法编辑流：read 文件后输出顶部显示 `[PATH#HASH]`，每行显示 `LINE:content`；模型可用 `[PATH#HASH]` + `replace N..M:` + `+` payload 调用 `hashline_edit` 修改单个文件。

需要打通的层：

- 内嵌纯 JS xxHash32，用于生成 4 字符十六进制文件快照标签。
- 抽象 `Filesystem`，提供默认 `NodeFilesystem` 和测试用 `InMemoryFilesystem`。
- 内存 `SnapshotStore`，按 path 保留最近最多 4 个版本，全局最多 30 个 path。
- `Tokenizer` 把 patch 文本逐行分类为 header / op / payload / blank / raw token。
- `Executor` 把 token 流转换为结构化 `Edit[]`。
- 严格 `apply`，本期只支持 `replace N..M:` 和 `replace N:`。
- pi 扩展集成：拦截 read 输出装饰为 `[PATH#HASH]` + `LINE:content`；`hashline_edit` 接受新语法输入。

## Acceptance criteria

- [ ] read 文本文件后，输出第一行为 `[PATH#HASH]`，后续每行为 `LINE:content`。
- [ ] 基于该 read 输出执行 `hashline_edit` 的 `replace` 操作，文件按预期修改。
- [ ] 原文件换行符、BOM 和尾部换行保持不变。
- [ ] 多 section 输入直接报错。
- [ ] 使用 `InMemoryFilesystem` 的集成测试通过。

## Blocked by

None - can start immediately
