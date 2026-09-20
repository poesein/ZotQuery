# ZotQuery 3.0.14 架构与证据边界

ZotQuery 是一个运行在 Zotero 10 内的插件。Core、Search、Survey、Evidence、Agent 和 MCP 是插件中的职责模块，不是六个独立进程，也不是六个大模型。它把 PDF 原文与 Zotero 笔记作为两条互补的检索通路，再把候选、审阅、事实和缺口保存为可继续的研究状态。

![ZotQuery 双源检索与证据研究架构图](assets/zotquery-architecture.png)

## 双源索引与共享模型

| 通路 | 输入与索引 | 返回的定位信息 | 证据边界 |
| --- | --- | --- | --- |
| Search（PDF） | Zotero 条目及已提取的 PDF 文本；分块后建立词法和向量索引 | 文献身份、附件、文本块以及可用的物理页和段落位置 | 取决于索引范围、PDF 提取完整性、OCR 和分块；命中不等于全文已读 |
| Core（Note） | Zotero Note HTML 转为规范文本，再按 Note Profile 分段、标记角色并建立词法和向量索引 | Note 条目、章节、规范文本行号、短引及同一父文献 | 笔记角色标签是解析结果，不是对原论文的自动核验 |

两个通路使用同一个活动 embedding 接口。模型只负责把文档和查询编码为检索向量，不撰写研究答案；PDF 和 Note 仍分别保存索引。内置 Nomic/ONNX 路线与配置的兼容 embedding 服务都是检索选项，Qwen 或其他生成模型不是索引的前置条件。可在本机或可信私有 IPv4 局域网部署服务；局域网服务会收到发送给它的文本。

模型身份与服务地址不能简单画等号。3.0.14 只有在旧身份确有索引、新候选尚无 PDF 索引，且维度、预处理、Ollama digest 和固定探针结果均满足核验条件时，才沿用已有向量身份；真正换模不会静默混用。核验失败不删除旧向量。详细规则见[模型端点切换](MODEL-ENDPOINT-COMPATIBILITY.md)。**缓存覆盖与实时查询可用性是两个状态**：旧向量齐全时，离线服务仍可能无法处理新的 dense 查询。

## 从检索范围到研究状态

```text
问题与调用方别名
  → Query Contract（MUST / SHOULD / MUST NOT；核对实际 hardExpression）
  → PDF 和 Note 候选、Survey 多角度调研
  → 返回候选位置、打开上下文、记录审阅
  → FactRecord（值、类型、单位、短引和原始 PDF 位置）
  → 覆盖与冲突门禁
  → 持久化结果和按 Output Profile 呈现
```

**Query Contract** 限定这一次研究要查什么。别名应由调用方明确声明；标识符的字符、顺序和 Unicode 原样保留，不会静默退化为看似相近的 ASCII 写法。覆盖结论相对于契约、已索引语料和指定的审阅策略成立，不声称覆盖互联网全部文献。词项分处不同 PDF 分块、扫描件无 OCR 或索引被截断，都可能影响召回。

**Survey** 保存查询轴、候选论文、筛选和阅读进度，可从多份 Note 归并到同一父文献，并引导回对应 PDF。**Evidence** 将检索命中、上下文访问、审阅决策和 FactRecord 分开记录；命中位置本身不是已核实事实。DIRECT 事实须绑定已审阅的原始 PDF 位置和短引，代码检查值在短引中的字面出现及来源约束；否定语境、实验体系、单位意义和科学解释仍需要人或调用方审阅。存在冲突时，需要独立来源约束的解决记录，不能仅用同一位置重复确认。

**Coverage Gate** 会根据本次契约、位置返回与审阅、事实槽和冲突状态给出阻断项或 `ready_for_synthesis`。这个状态只表示按当前台账可以进入综合，不表示答案已被自动写成或科学判断已由软件证明。更细的调用顺序、分页和策略见[研究协议](RESEARCH-PROTOCOL-ZH.md)与[Query Contract v2](QUERY-CONTRACT-V2-ZH.md)。

## Agent、输出和访问边界

Agent 负责把 PDF Evidence 与 Note Survey 研究步骤串联，并尝试把笔记线索引回同一 Zotero 父文献的 PDF；它不是独立完成全文阅读与答案生成的内置生成式模型。统一 MCP 通过本地 `/zotquery/mcp` 公开 43 个 `zotquery_*` 工具，是供外部客户端访问这些能力的接口，不是结果最后必须流向的“生成模块”。所有 `/zotquery/*` HTTP 路由都要求 Bearer 令牌；不要把本地 API 端口代理开放到局域网或公网。参见[MCP 认证](MCP-AUTH-ZH.md)。

Output Profile（`compact`、`standard`、`exact`、`exhaustive-vnext`）只决定持久化结果如何展示，不改动证据门禁。Note Profile 则决定笔记格式和标签如何解析；内置 `generic` 是通用路线，`strawberry-vnext` 只是精读笔记格式兼容路线，不是某个研究方向预设。见[配置文件说明](PROFILES-3.0-ZH.md)。外部模型取得材料后是否发送到云端、是否遵循审阅流程，由客户端配置与使用者负责。

## 本地存储与回链

| Zotero 数据目录中的插件数据库 | 主要内容 |
| --- | --- |
| `zotquery.sqlite` | PDF／文献分块、索引及模型向量 |
| `zotquery-lne.sqlite` | Note 规范文本、分段、向量和 Survey 状态 |
| `zotquery-research.sqlite` | Evidence 研究会话、位置、审阅、FactRecord 和冲突 |

3.0.14 使用独立扩展 ID `zotquery@poesein.github.io`、`zotquery.*` 偏好及上述数据库名，不与 ZotSeek 共用可写索引；旧扩展 ID 候选版的数据不会在安装时自动迁移。不要为了恢复索引而直接重命名数据库：模型身份、schema 和 Zotero 资料身份还需要核验。卸载插件也不应被当作安全的数据迁移或清理方法。

研究结果回链区分父条目、Note 条目与 PDF 附件。只有附件可无歧义确定且物理页有效时，才生成 PDF 页级链接；有多个可能附件时不猜测。Note 的规范文本行号与短引可供核对，但不是 Zotero 原生的段落跳转锚点。
