# ZotQuery 发布审计

## 当前发布：3.1.8

本次发布加入内置 API 研究工作流、单列工作台和默认 Markdown 渲染，具体功能与验收边界见 [3.1.8 Release 说明](RELEASE-3.1.8-ZH.md)。README 保持维护者当前版本不变。

发布前检查源码与压缩包的文件白名单、个人路径/凭据模式、私有模板片段和运行时哈希一致性，移除当前源码中的旧输出模板文档。不复制用户文库、PDF、笔记、数据库、密钥或本地工作记录。历史提交及旧版附件不在普通源码更新中重写；新版本脱敏不等同于历史已抹除。

本次检查为离线回归、语法/XML、静态渲染和包一致性；尚未进行原生 Zotero 安装或真实 API 联机验收。以下内容为旧版历史记录，不能作为 3.1.8 实机验收结论。

## 历史记录：3.0.14

状态：**3.0.14 已作为普通 GitHub Release 发布**。这表示公开分发状态，不表示所有部署环境均已验收。原始四项门禁修补仍在；本机 Zotero 10 已确认管理器版本、实时健康、既有 PDF/Note 索引和带认证 MCP 搜索。尚未做全新 profile、完整旧数据迁移或两个在线推理主机间的端到端切换验收。`node tests/regression-final.mjs` 包含模型地址切换与回退反例并通过；没有为了本次修复执行破坏性索引重建。

2026-09-20 同版本资源刷新只更新包内文档、测试夹具和自动更新清单；`bootstrap.js`、`content/`、`locale/`、`skin/`、`prefs.js`、`manifest.json` 及 `BUILD-INFO.json` 与 `v3.0.14` 标签没有运行时代码差异。Windows CRLF 下的离线测试替换规则已修正，`node tests/regression-final.mjs` 通过。刷新后 XPI SHA256 为 `5fc385299d928f8fba7cf7540fcacc66feb16661545611052573251967d5d35b`。同版本不会触发自动升级；已安装 3.0.14 的用户如需获取刷新后的包，应通过插件管理器手动重装。

3.0.12 起将扩展 ID 改为 `zotquery@poesein.github.io`，并隔离偏好、chrome 资源及 PDF/Note/Research 数据库。它不会原位升级旧 ID 的 3.0.11 候选包，也不会自动复制旧数据；旧版仍需通过 Zotero 插件管理器识别和处理，实机并装与迁移尚待验证。

3.0.13 允许推理客户端连接 loopback 与私有 IPv4 局域网端点；公网主机、内嵌凭据与 HTTP 重定向仍被拒绝。服务模型 ID 加入端点 origin，避免未经核验就让不同主机的同名模型共享向量。已从 Zotero 所在机器直接验证局域网 `/v1/models` 与 1024 维 BGE-M3 `/v1/embeddings`；3.0.14 又通过了插件内实机 MCP 查询。

3.0.14 增加有条件的索引身份沿用：只有 Ollama 摘要、维度、前缀和固定文档/查询探针相符，且目标注册项没有 PDF 索引时，才把新地址接到旧索引 ID；原 PDF/Note 数据行不搬迁、不删除。不可核验或真实换模时仍隔离缓存；连接失败恢复原活动模型。旧本机服务在验收时未启动，因此跨两个在线地址的切换仍属待验项目。[具体规则](MODEL-ENDPOINT-COMPATIBILITY.md)。

## 已修补的门禁

1. **零候选门禁。** `finalize()` 明确阻断 `reviewUnits===0`，最终许可还须满足 `sessionLedger().synthesisAllowed`；离线测试覆盖零结果 STANDARD 会话。
2. **DIRECT 值与引文。** 写入时要求原始 PDF 引文含有边界完整的字面值，且位置已被审查为 `reviewed`、`supportsQuestion=yes`；既有 DIRECT 记录在台账中重新核验，不满足者不能关闭 EXACT 槽或通过 Gate。换算、映射、概括值须作为 INFERRED 另行记录，不能伪装成 DIRECT。字面出现仍不等于语义蕴含，否定、单位和同源编号仍需人工确认。
3. **冲突裁决来源。** 必须指定冲突组中被选的 DIRECT FactRecord、不同的已读 PDF 位置、真实且包含所选值的裁决引文，以及具体理由。裁决保存 position/quote；台账再次核验来源，旧式无来源裁决继续阻断。此流程建立来源约束和人工裁决轨迹，不声称自动判断哪个来源正确。
4. **本地接口认证。** 统一 MCP 与 `/zotquery/*` REST 均要求独立 Bearer 令牌，另外检查 Host/Origin 为 loopback。令牌在首次启动生成，保存在本地 Zotero 用户偏好中，可在设置页手动复制；不进入 XPI、日志或健康响应。无令牌/远程 Host/Origin 的离线反例已覆盖。旧 MCP 客户端必须配置请求头；令牌不能防御能够读取本机 Zotero profile 的恶意进程，也不能代替端口不外露原则。

## 重要边界与后续验证

5. `FULL_TEXT_CANDIDATES` 只检查已索引 chunk 是否被分页；`items.was_truncated`、`pages_indexed/pages_total` 已存储但未参与该门禁，因而不等同“原 PDF 全文读完”。应对截断、未提取页和 OCR 缺失单独标注/阻断全面性声明。
6. 相邻词法命中会聚合为一个 review unit，非代表位置变为 navigation。当前 Gate 覆盖的是 hard-query 聚合单元，不是逐个原始命中；对要求逐段穷尽的问题需检查所有 raw positions 或提供严格模式。
7. Survey 提升完成仅检查 `promotionComplete`；`missingWorks` 与 `failedWorks` 被记录，却不阻断该条件。应定义核心 Note 失败是否必须阻断，至少在最终报告显著暴露。
8. 设置页标题仍写 3.0.7，和 3.0.9 manifest 不一致。发布包已改为中性标题，但仍须 Zotero 10 实机检查中英文布局与保存/重启行为。
9. 已加入 ZotQuery 根目录 MIT LICENSE、依据上游 MIT 声明与 SPDX 标准正文重建的 ZotSeek 许可证说明，以及模型/运行时的 Apache-2.0 与 MIT 文本；打包 Nomic ONNX 与官方文件的 SHA256 相同。但上游 `v1.21.2` 仓库没有原始 LICENSE 文件，完整著作权人名单仍须核实；打包 WASM/压缩运行时资产的具体来源版本尚未逐一匹配，也没有可复现的正式构建流水线。ZotQuery 的独立 ID/偏好/数据库不得重新与 ZotSeek 共用可写状态。
10. 本机 3.0.14 已核对 `extensions.json` 活动版本、带令牌的实时 `/zotquery/health`、MCP 搜索、模型查询与既有 PDF/Note 索引；仍未覆盖全新 profile、旧 ID 数据迁移或两个在线服务之间的地址切换。离线测试、XPI 文件存在或缓存覆盖率都不能替代这些剩余检查。

## 已核对的积极设计

- 显式硬 Query Contract 不会再让裸问题表面词额外形成隐式 AND；Unicode 标识符按字符与顺序区分。
- `sessionLedger()` 对常规非空会话要求门禁位置已列出、上下文已读、已审查、要求的检索分支完成、精确槽关闭、无未解决直接事实冲突。
- `finalize()` 现在同时检查 `ledger.synthesisAllowed`；`researchResult()` 与 Output Profile 也再次检查 Gate。离线零候选回归已覆盖，实机迁移仍待验收。
- PDF 页链接只在附件唯一且页码有效时生成；Note 保留行号/短引追溯。PDF/Note 共用活动模型，但查询服务可用性须独立检查。

## 公开包隐私范围

发布包从受控白名单生成，只包含运行所需源码、通用配置、必要文档和离线测试；不拷贝 Zotero 用户 profile、SQLite、日志、密钥、旧 XPI 或历史存档。保留不含研究主题的 `strawberry-vnext` 格式兼容 Profile，其他笔记由 `generic` 兜底；自动笔记同步默认关闭、默认范围为 My Library。发布包仍含历史兼容命名；这不是个人研究方向。发布者仍须人工审核二进制模型来源与授权。
