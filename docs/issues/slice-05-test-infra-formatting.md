# Slice 5: 测试基础设施与格式化检查

## Parent

PRD: pi-hashline v2 — 基于快照标签的 Hashline 编辑工具 (`docs/PRD-hashline-v2.md`)

## What to build

建立 pi-hashline 的测试运行和格式化检查基础设施，使前四个 slice 的代码能够被持续验证。不引入新功能，只补齐工程能力。

需要做的内容：

- 添加测试运行脚本和最小测试框架。仓库当前无测试基础设施，选择轻量方案（如 Node.js 内置 test runner 或 vitest）。
- 为 Slice 1–4 编写的集成测试提供统一入口，并确保在 CI/本地可运行。
- 确保 `pnpm format` 和 `pnpm format:check` 覆盖新文件。
- 添加类型检查脚本（如果当前没有），保证 TypeScript 无编译错误。
- 在 `package.json` 中暴露 `test`、`test:watch`、`typecheck` 等脚本。

## Acceptance criteria

- [ ] 新增 `test` 脚本，运行全部集成测试并返回非零退出码表示失败。
- [ ] 新增 `typecheck` 脚本，TypeScript 类型检查通过。
- [ ] `pnpm format` 和 `pnpm format:check` 覆盖所有新增 `.ts` 和 `.md` 文件。
- [ ] 至少有一个示例测试可以独立运行并验证 `InMemoryFilesystem` + `hashline_edit` replace 路径。
- [ ] 文档说明如何在本地运行测试和格式化检查。

## Blocked by

- Slice 1: 实现 `[PATH#HASH]` 语法和单文件 replace 编辑（soft，可与 Slice 1 并行开始基础设施搭建）
