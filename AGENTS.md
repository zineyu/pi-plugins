# AGENTS.md

> pi-hashline — 一个 pi 扩展，通过 FNV-1a 内容哈希实现行锚定文件编辑（hashline edit），替代传统的 `str_replace`。

## Build & Test

- 无构建步骤（扩展由 pi 通过 jiti 在运行时加载）
- 无测试框架（当前为单一扩展文件）

## Code Style

- 代码注释使用英文
- Formatter: Prettier（配置见 `.prettierrc`）
  - 使用 Tabs、双引号、全尾随逗号、printWidth 100

## pi 扩展开发约定

- 扩展入口文件由 pi 通过 `jiti` 加载，无需编译
- 类型在运行时从 `@earendil-works/pi-coding-agent` 解析
- 若类型声明暂不完整，可在文件顶部使用 `// @ts-nocheck`
- `package.json` 的 `pi.extensions` 字段指向扩展目录（如 `./extensions`）
- 包名建议以 `pi-` 为前缀

## Security & Safety

- 扩展通过 `hashline_edit` 工具直接读写用户文件系统，操作前由锚点哈希校验确保文件未被并发修改
- 无密钥或敏感数据管理需求

## References

- `README.md` — 项目简介与使用说明
- `extensions/hashline.ts` — 扩展主实现
