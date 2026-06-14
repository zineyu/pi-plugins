# PRD：pi-hashline v2 — 基于快照标签的 Hashline 编辑工具

## Problem Statement

当前 `pi-hashline` 扩展使用符号化语法（`§PATH`、`»`、`«`、`≔`）和每行 FNV 短哈希作为内容校验。实际使用中存在以下问题：

1. **模型学习成本高**：`»`、`«`、`≔` 等 Unicode 操作符对 LLM 不够直观，容易误用或 hallucination。
2. **无文件版本绑定**：每行哈希只校验单条内容，不感知整个文件版本。当文件被外部修改或模型基于旧 read 输出编辑时，只能硬失败并提示重读，无法区分"锚点错了"和"文件漂移了"。
3. **无漂移恢复**：模型 read 之后若用户或其他进程修改了文件，下一次 edit 几乎必然失败，需要重新 read、重新定位、重新编辑，循环代价高。
4. **payload 无明确前缀**：body 行没有统一前缀，模型容易把解释性文字或操作说明误写入文件。
5. **架构不可扩展**：基于正则的单文件解析器难以支持多文件 patch、块级编辑、智能边界修复等未来能力。

## Solution

将 `pi-hashline` 从"轻量符号化编辑扩展"升级为"基于文件快照标签的 line-anchored patch 工具"：

- 采用自然语言风格的 patch 语法：`[PATH#HASH]` 文件头、`replace N..M:`、`insert before/after/head/tail:`、`delete N..M`，payload 以 `+` 开头。
- 引入全文件快照标签（4 字符十六进制 xxHash32），由扩展在 read 时计算并维护在内存 `SnapshotStore` 中。
- 编辑前校验文件快照是否匹配；不匹配时尝试基于历史快照做三路合并恢复。
- read 输出顶部显示 `[PATH#HASH]`，每行显示 `LINE:content`，模型可直接复制使用。
- 解析器拆分为 `Tokenizer` + `Executor`，为后续多文件 patch、块级编辑、智能修复打基础。
- 抽象 `Filesystem`，支持磁盘与内存两种后端，提升可测试性。

## User Stories

1. 作为 pi 用户，我希望 read 文件时看到 `[PATH#HASH]` 和 `LINE:` 行号前缀，这样模型可以直接复制锚点而无需数行。
2. 作为 pi 用户，我希望 `hashline_edit` 使用 `replace/insert/delete` 等自然语言操作，这样模型更少误用符号操作符。
3. 作为 pi 用户，我希望 payload 行以 `+` 开头，这样模型不会把说明文字误写入文件。
4. 作为 pi 用户，我希望编辑文件时如果文件内容未变，编辑能一次性成功。
5. 作为 pi 用户，我希望编辑文件时如果文件被外部轻微修改，工具能尝试自动合并而不是直接失败。
6. 作为 pi 用户，我希望文件被外部显著修改导致无法安全合并时，工具明确提示我重新 read。
7. 作为 pi 用户，我希望连续多次 edit 同一个文件时，第二次 edit 能基于第一次 edit 后的最新快照，而不是过期的旧快照。
8. 作为 pi 用户，我希望 `hashline_edit` 一次只处理一个文件，这样错误定位更清晰。
9. 作为 pi 用户，我希望 edit 工具保留原文件的换行符、BOM 和缩进，不产生无关的格式变更。
10. 作为 pi 扩展开发者，我希望文件系统可抽象，这样可以在内存中快速测试而无需创建临时文件。
11. 作为 pi 扩展开发者，我希望解析器是 Tokenizer + Executor 两层结构，这样新增语法时不需要重写正则。
12. 作为 pi 扩展开发者，我希望快照存储与文件哈希算法是独立模块，这样未来可以替换持久化策略或哈希算法。
13. 作为 pi 模型，我希望错误信息包含结构化的错误码和行号，这样我可以根据错误类型决定重读还是修正 patch。
14. 作为 pi 模型，我希望系统提示中包含清晰的 hashline 语法示例和禁止事项，这样我能稳定输出正确格式。
15. 作为 pi 用户，我希望旧版 `§»«≔` 语法不再被支持，这样文档和模型行为保持一致。

## Implementation Decisions

### 模块划分

本次改造将引入以下 deep module：

- **xxHash32**：内嵌的纯 JavaScript xxHash32 实现，用于生成 4 字符十六进制文件快照标签。零依赖，运行时无关。
- **SnapshotStore**：按 path 维护最近最多 4 个文件版本，全局最多 30 个 path。默认基于内存 Map/LRU，支持按 hash 查询历史版本。
- **Filesystem**：抽象文件读写接口，默认 `NodeFilesystem` 使用 `node:fs/promises`，测试用 `InMemoryFilesystem` 基于 Map。
- **Tokenizer**：逐行分类 patch 文本为 token（header / op-block / payload-literal / blank / raw / envelope marker）。
- **Executor**：状态机把 token 流转换为结构化 `Edit[]`，处理 payload 累积、`+` 前缀识别、裸行前缀剥离、语法错误检查。
- **Apply**：纯函数，把 `Edit[]` 应用到 LF 归一化文本，严格语义，暂不做智能边界修复。
- **Recovery**：当文件快照不匹配时，从历史快照中取出对应版本，把编辑应用到旧版本，再用 `diff` 做三路合并到当前文件。
- **HashlineExtension**：pi 扩展集成层，注册 `hashline_edit` 工具、拦截 `read` 输出、抑制原生 `edit` 工具。

### 语法规范

- 文件段头部：`[PATH#HASH]`，`HASH` 为 4 字符大写十六进制快照标签。
- 操作头：
  - `replace N..M:` 替换连续行
  - `replace N:` 替换单行
  - `delete N..M` 删除连续行
  - `delete N` 删除单行
  - `insert before N:` / `insert after N:` / `insert head:` / `insert tail:`
- payload 行：以 `+` 开头，`+` 单独一行表示空行。
- 首期限制：一个 patch 输入只能包含一个文件段；多个段直接报错。

### 快照标签生成

- read 文件时，扩展内部通过 `Filesystem.readText` 读取完整文件文本。
- 对完整文件文本做 xxHash32，取低 16 位转 4 字符大写十六进制作为标签。
- 当 read 输出被截断（带 offset/limit 或超出默认限制）时，扩展需自行读取完整文件计算快照；未截断时可直接使用 `tool_result` 中的文本。
- 每次成功 edit 后，立即用新文件内容更新 `SnapshotStore` 的 head。

### 校验与恢复流程

1. `hashline_edit` 解析输入得到 `[PATH#HASH]` 和 `Edit[]`。
2. 读取当前文件内容，计算实际快照标签。
3. 若与头部标签一致，直接 apply。
4. 若不一致，尝试从 `SnapshotStore.byHash(path, expectedHash)` 取出历史版本。
5. 若历史版本存在：
   - 对历史版本 apply 编辑，得到"编辑后版本"。
   - 用 `diff` 包生成"历史版本 → 编辑后版本"的 patch。
   - 把 patch 应用到当前文件（fuzzFactor = 0）。
   - 若成功，返回带恢复警告的结果；若失败，抛出 stale-snapshot 错误。
6. 若历史版本不存在，抛出 stale-snapshot 错误，提示重新 read。

### Filesystem 抽象接口

```ts
abstract class Filesystem {
	abstract readText(path: string): Promise<string>;
	abstract writeText(path: string, text: string): Promise<WriteResult>;
	abstract canonicalPath(path: string): string;
	abstract preflightWrite(path: string): Promise<void>;
}
```

`preflightWrite` 用于提前检查目标路径是否可写（如父目录是否存在）。

### read 输出装饰

- 文本文件 read 结果顶部插入一行：`[PATH#HASH]`。
- 后续每行前面加上绝对行号和冒号：`42:content`。
- 保留 pi 原生的截断提示（如 `[Showing lines ...]`），放在内容之后。
- 图片 read 不装饰。

### 错误处理

- 统一 `HashlineError`，附加结构化字段：
  - `code`: `"stale_snapshot" | "invalid_syntax" | "out_of_bounds" | "multiple_sections" | ...`
  - `line`: 出错行号
  - `expectedHash?`: 期望快照
  - `actualHash?`: 实际快照
  - `mismatchedLines?`: 不匹配锚点列表
- 文本错误信息面向模型，清晰说明失败原因和下一步操作。

### 原生 edit 工具

- 扩展在 `session_start` 时继续从 active tools 中移除原生 `edit`。
- 保证 `hashline_edit` 是唯一可用的文件编辑工具。

## Testing Decisions

### 测试层级

首期采用**关键路径集成测试**（AA2），不追求全模块单元测试覆盖。理由是：

- 当前仓库没有测试基础设施，首期建立完整单元测试框架会显著拉长周期。
- 集成测试能快速验证端到端行为，暴露模块间交互问题。
- 模块本身设计为 deep module，未来可以逐步补单元测试。

### 测试场景

1. read 装饰：文本文件 read 后顶部有 `[PATH#HASH]`，每行有 `LINE:` 前缀。
2. 成功替换：基于最近一次 read 的 header 和行号执行 `replace`。
3. 成功插入：`insert before` / `insert after` / `insert head` / `insert tail`。
4. 成功删除：`delete N` / `delete N..M`。
5. 快照不匹配：文件被外部修改后 edit 失败，错误码为 `stale_snapshot`。
6. 快照恢复：文件被外部非冲突修改后 edit 成功，并附带恢复警告。
7. 连续编辑：第一次 edit 成功后，第二次 edit 基于新快照成功。
8. 多 section 报错：输入包含多个 `[PATH#HASH]` 段时直接报错。
9. 语法错误：delete 带 body、replace 无 body、payload 缺少 `+` 前缀等。
10. 格式保留：CRLF、BOM、尾部换行保持不变。

### 测试依赖

- 使用 `InMemoryFilesystem` 作为测试后端，避免磁盘 I/O。
- 使用真实 `SnapshotStore` 和 `Recovery` 实例。
- 不 mock xxHash32，使用真实哈希验证标签一致性。

## Out of Scope

以下特性明确不在本期 PRD 范围内：

1. **多文件 patch**：内部按 section 组织，但首期强制限制为单文件，多 section 报错。
2. **块级编辑**：`replace block N:`、`delete block N:`、`insert after block N:` 不在首期语法中。架构保留扩展位，但 Tokenizer 遇到 `block` 关键字时报 unsupported。
3. **智能边界修复**：不自动修正 payload 重复边界行、遗漏闭合符、insert after 落点滑动等。
4. **快照持久化**：快照仅保存在内存中，进程重启或会话切换后丢失。
5. **配置项**：`maxPaths`、`maxVersionsPerPath`、`maxTotalBytes` 等参数首期固定，不暴露给用户配置。
6. **非致命警告后继续 apply**：任何错误都直接失败，不带警告成功。
7. **与 oh-my-pi hashline 的协议兼容**：语法相似但不保证标签算法或输出格式完全一致。

## Further Notes

- `lru-cache` 依赖会尝试引入以简化 LRU 管理；若 jiti 加载失败，则回退到手动 `Map` 实现。
- `diff` 依赖用于三路合并恢复，是首期唯一新增的运行时依赖（除 `lru-cache` 外）。
- 旧语法 `§PATH`、`»`、`«`、`≔` 不再支持；相关文档和提示词需同步更新。
- 本改造是破坏性变更，版本号建议从 `0.1.0` 升级到 `0.2.0`。
- 实现完成后需更新：`README.md`、`AGENTS.md`、`hashline_edit` 工具的 prompt 字段、新增 `src/prompt.md` 作为模型可见的语法参考。
