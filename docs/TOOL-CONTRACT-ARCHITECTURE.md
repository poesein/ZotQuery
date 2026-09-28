# ZotQuery 工具契约与入口

ZotQuery 3.1.25 的本地 MCP、Zotero HTTP MCP/API 与私有 ChatGPT tunnel 共同使用 `content/profiles/tools/tool-contracts.json` 中的工具分类。Bridge 携带同一文件的副本，并从 Zotero `/zotquery/mcp` 实时取得原生工具的输入 schema，避免字段定义在两个进程中漂移。

## 领域和主键

| 领域 | 用途 | 主要稳定标识 |
| --- | --- | --- |
| 文库 `library` | 浏览条目、集合、附件和普通标签 | `library`、`parentItemKey` 或 `itemKey` |
| 证据 `evidence` | 检索、阅读、审查、事实记录、研究会话 | `sessionId`、`positionId`，必要时附条目与附件 key |
| 精读 `reading` | 生成协议、Depth QC、托管笔记、批处理状态 | `library`、`parentItemKey`、`readingProfileId` |
| 配置 `configuration` | Note/Output Profile 管理 | Profile ID |

文献完整标题只用于导航和展示。标题没有命中索引时，仍可用 `library`、`parentItemKey` 和 `attachmentKey` 定位原文和启动逐图研究会话。

## 状态变更

每个工具标注 `read`、`evidence-write`、`reading-write`、`library-write` 或 `configuration-write`。`read` 工具不改变研究账本或 Zotero 条目。证据审查与 FactRecord 会改变研究账本，但不会自动修改文库。普通任意标签使用 `zotquery_add_item_tag`；`✅精读完成` 由托管精读写回和 Depth QC 的专用门槛控制。

七个文库读取工具已移入 Zotero 原生 MCP：分组、集合、条目搜索、集合条目、单条目、子条目、附件索引全文。这些工具均以本机 Zotero Local API 为数据源，分页结果为导航材料，不自动构成已核验的 PDF 证据。私有 ChatGPT bridge 转发它们，不再另行实现一套搜索和分页。

## 入口

- Zotero 本机 `/zotquery/mcp` 提供全部原生工具；`/zotquery/contracts?includeSchemas=1` 提供契约及原生 schema。两者使用现有 loopback Bearer 验证。
- 本地模型 API 仍通过 ZotQuery 原生研究工具调用同一证据账本和完成门槛。原有 REST 路由保留作兼容入口。
- ChatGPT tunnel 的完整目录转发原生工具；紧凑目录直接展示常用工具，并通过只读目录/调用器访问其余原生读取工具。Bridge 的非原生只读会话工具仍负责有界展示已保存数据。

刷新 ChatGPT 工具时，Zotero 必须正在运行：bridge 需要从原生 MCP 取得当前 schema。如果工具契约不匹配，bridge 拒绝提供可能过时的字段，而不是猜测参数。网页端的写入权限仍由用户现有 ChatGPT 连接授权控制。
