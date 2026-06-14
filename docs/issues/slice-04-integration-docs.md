# Slice 4: 集成 pi 扩展层并更新文档

## Parent

PRD: pi-hashline v2 — 基于快照标签的 Hashline 编辑工具 (`docs/PRD-hashline-v2.md`)

## What to build

把前三个 slice 实现的库代码接入 pi 扩展运行时：注册 `hashline_edit` 工具、拦截 `read` 输出、在 `session_start` 时抑制原生 `edit` 工具。统一错误对象为 `HashlineError` 并附加结构化 details。更新所有面向模型和人类的文档。

需要打通的层：

- pi 扩展入口：注册 `hashline_edit`，设置 `promptSnippet` / `promptGuidelines`。
- `tool_result` 拦截：识别 read 结果，装饰文本输出，计算并记录完整文件快照。
- `session_start`：从 active tools 中移除原生 `edit`。
- 新增 `src/prompt.md`，通过 `resources_discover` 贡献给系统提示。
- 更新 `README.md` 和 `AGENTS.md` 反映新语法、快照、恢复行为。

## Acceptance criteria

- [ ] `session_start` 后原生 `edit` 工具不在 active tools 列表中。
- [ ] `hashline_edit` 的 promptGuidelines 包含新语法示例和禁止事项。
- [ ] 新增模型可见的 `src/prompt.md`，覆盖 patch 语法、header 格式、payload 规则。
- [ ] `README.md` 和 `AGENTS.md` 反映新语法和行为。
- [ ] 错误信息包含结构化 details：code、line、expectedHash、actualHash、mismatchedLines。

## Blocked by

- Slice 1: 实现 `[PATH#HASH]` 语法和单文件 replace 编辑
- Slice 3: 实现文件快照校验和 drift 恢复
