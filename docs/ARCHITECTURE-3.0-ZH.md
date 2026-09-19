# ZotQuery 3.0.11 候选版架构

```text
Zotero PDF ── ZotQuery Search ──┐
                               ├── ZotQuery Evidence ── ZotQuery Agent
Zotero Note ── ZotQuery Core ───┤          │                  │
                  │             └── ZotQuery Survey ─────────┘
                  └── shared embedding model       │
                                         ZotQuery MCP (`zotquery_*`)
```

Search 负责 PDF 索引、模型管理和检索；Core 负责 Note canonical snapshot、FTS、向量缓存及 dense/lexical 融合。PDF 与 Note 经同一 Search embedding API 使用相同的 active model。旧模型向量按 `hash + model_id` 保留，但不会形成第二套 Note 模型。Survey 持久化候选、筛选和事实记录；Evidence 负责全库 PDF 检索、原文 locator、Evidence Gate 和 DIRECT FactRecord；Agent 编排 Survey 到同一父文献 PDF 的核验流程。

MCP 通过 `/zotquery/mcp` 公开 43 个 `zotquery_*` 工具。研究结果将父条目、Note item 和可核验的 PDF 附件物理页分级回链：仅有一个 PDF 附件时才能自动形成页级链接；多附件不猜测，Note 行号保留为 canonical 引用而非原生跳转锚点。

索引覆盖与服务就绪是两个状态：已有向量可以达到 100%，但若当前 embedding 服务不可达，新的 dense 查询仍会失败并回退词法检索。健康检查必须报告 `queryReady=false` 与错误原因，不能宣称语义检索可用。

为保持原安装的索引及偏好，扩展 ID、数据库文件名和存量偏好键暂不迁移。它们只作兼容标识；不会再作为用户界面产品名称。卸载不删除这些数据。

候选召回、Note 命中和 Survey inclusion 不等于事实已证实。EXACT 问题只有在所需事实槽由原始 PDF 的 DIRECT FactRecord 与稳定 locator 闭合、且冲突检查通过后，才能进入 `ready_for_synthesis`。
