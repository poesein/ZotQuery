# ZotQuery 3.0.14 安装与验收

此包已在一个 Zotero 10 profile 上通过安装版本、既有索引、实时模型与认证 MCP 检查；跨两个在线模型服务的切换及全新 profile 迁移仍未验收。建议先在已备份的 profile 中试用，详见[发布审计](RELEASE-AUDIT-ZH.md)。

1. 备份 Zotero 数据目录，并正常退出 Zotero。
2. 通过 Zotero 插件管理器安装 `ZotQuery-3.0.14.xpi`，不要直接覆盖已安装的 XPI 文件。此版沿用 3.0.12/3.0.13 的独立扩展 ID，可原位升级该分支；但不会自动升级使用旧 ID 的 3.0.11 候选包，也不会自动迁移旧 ID 索引或设置。先备份 profile；需要移除旧版本时通过插件管理器操作，勿删除原有数据库。若安装失败，保留完整错误文字或截图。
3. 启动后在设置页复制 MCP 令牌，给客户端添加 `Authorization: Bearer <令牌>`，再核对插件管理器版本、带认证的 `/zotquery/health` 版本及 43 个 `zotquery_*` MCP 工具。旧版无请求头的客户端会收到 401。
4. 检查 `embeddingContract.sameModel=true`，并分别查看 `lne.semantic.coveragePercent` 与 `lne.semantic.queryReady`。如果后者为 false，先检查当前 embedding 服务；不能仅凭缓存 100% 判定语义检索正常。
5. 调用 `zotquery_evidence_plan` 测试裸问题 `x42α mβ7的氨基酸序列和位置`：两者必须各为独立 MUST。`mβ7` 与 `βm7` 不得并入同一 alias group。
6. 调用 `zotquery_note_profile_list` 核对内置 `generic` 与不含研究主题的 `strawberry-vnext`；后者只匹配旧“精读笔记”格式，其他笔记走通用配置。使用 `zotquery_research_result` 和 `zotquery_research_render` 验证阶段性输出；没有完成 Coverage Gate 的会话不得输出确定答案。
7. 在设置页确认“笔记索引”可保存文库/笔记范围与自动跟踪设置，“笔记模板与研究输出”可列出内置配置；中英文随 Zotero 语言切换。Research Engine 启动失败时应显示具体错误。
8. 若要切换向量服务地址，先确保新端点可从 Zotero 所在机器访问。仅 Ollama 摘要、维度、预处理和固定探针全部核对相符时才能沿用旧索引；核对失败或服务离线时应保留旧索引，不要用“覆盖率 0”推断索引被删除。切换后再次检查 PDF/Note 覆盖和 `queryReady`。详见[端点兼容规则](MODEL-ENDPOINT-COMPATIBILITY.md)。

EXACT 研究会话缺少原始 PDF 的 DIRECT FactRecord 时应保持 `blocked`。
