# ZotQuery 公开发布前审计与修补状态

状态：**3.0.13 候选源码已修补下列四项，但尚未经过 Zotero 10 实机安装与迁移验收，不建议作为已验收正式版公开发布**。原始审阅对象为 3.0.9；修补位于独立候选源码，未修改正式安装。`node tests/regression-final.mjs` 包含新反例并通过；未运行破坏性迁移或索引重建。

3.0.12 起将扩展 ID 改为 `zotquery@poesein.github.io`，并隔离偏好、chrome 资源及 PDF/Note/Research 数据库。它不会原位升级旧 ID 的 3.0.11 候选包，也不会自动复制旧数据；旧版仍需通过 Zotero 插件管理器识别和处理，实机并装与迁移尚待验证。

3.0.13 允许推理客户端连接 loopback 与私有 IPv4 局域网端点；公网主机、内嵌凭据与 HTTP 重定向仍被拒绝。服务模型 ID 现包含端点 origin，避免不同主机上同名模型共享向量缓存。已从 Zotero 所在机器直接验证局域网 `/v1/models` 与 1024 维 BGE-M3 `/v1/embeddings`；插件内实机查询仍待验收。

## 已在候选源码修补，仍需实机验证

1. **零候选门禁。** `finalize()` 明确阻断 `reviewUnits===0`，最终许可还须满足 `sessionLedger().synthesisAllowed`；离线测试覆盖零结果 STANDARD 会话。
2. **DIRECT 值与引文。** 写入时要求原始 PDF 引文含有边界完整的字面值，且位置已被审查为 `reviewed`、`supportsQuestion=yes`；既有 DIRECT 记录在台账中重新核验，不满足者不能关闭 EXACT 槽或通过 Gate。换算、映射、概括值须作为 INFERRED 另行记录，不能伪装成 DIRECT。字面出现仍不等于语义蕴含，否定、单位和同源编号仍需人工确认。
3. **冲突裁决来源。** 必须指定冲突组中被选的 DIRECT FactRecord、不同的已读 PDF 位置、真实且包含所选值的裁决引文，以及具体理由。裁决保存 position/quote；台账再次核验来源，旧式无来源裁决继续阻断。此流程建立来源约束和人工裁决轨迹，不声称自动判断哪个来源正确。
4. **本地接口认证。** 统一 MCP 与 `/zotquery/*` REST 均要求独立 Bearer 令牌，另外检查 Host/Origin 为 loopback。令牌在首次启动生成，保存在本地 Zotero 用户偏好中，可在设置页手动复制；不进入 XPI、日志或健康响应。无令牌/远程 Host/Origin 的离线反例已覆盖。旧 MCP 客户端必须配置请求头；令牌不能防御能够读取本机 Zotero profile 的恶意进程，也不能代替端口不外露原则。

## 重要边界与后续验证

5. `FULL_TEXT_CANDIDATES` 只检查已索引 chunk 是否被分页；`items.was_truncated`、`pages_indexed/pages_total` 已存储但未参与该门禁，因而不等同“原 PDF 全文读完”。应对截断、未提取页和 OCR 缺失单独标注/阻断全面性声明。
6. 相邻词法命中会聚合为一个 review unit，非代表位置变为 navigation。当前 Gate 覆盖的是 hard-query 聚合单元，不是逐个原始命中；对要求逐段穷尽的问题需检查所有 raw positions 或提供严格模式。
7. Survey 提升完成仅检查 `promotionComplete`；`missingWorks` 与 `failedWorks` 被记录，却不阻断该条件。应定义核心 Note 失败是否必须阻断，至少在最终报告显著暴露。
8. 设置页标题仍写 3.0.7，和 3.0.9 manifest 不一致。新候选包已改为中性标题，但仍须 Zotero 10 实机检查中英文布局与保存/重启行为。
9. 已加入 ZotQuery 根目录 MIT LICENSE、依据上游 MIT 声明与 SPDX 标准正文重建的 ZotSeek 许可证说明，以及模型/运行时的 Apache-2.0 与 MIT 文本；打包 Nomic ONNX 与官方文件的 SHA256 相同。但上游 `v1.21.2` 仓库没有原始 LICENSE 文件，完整著作权人名单仍须核实；打包 WASM/压缩运行时资产的具体来源版本尚未逐一匹配，也没有可复现的正式构建流水线。源自 ZotSeek 的兼容 ID/偏好/数据库名应在迁移前保持，不能机械删除。
10. 未完成当前 XPI 的 Zotero 10 安装、`extensions.json` 版本/路径、带 Bearer 令牌的实时 `/health` 和 MCP、模型查询、PDF/Note 索引与旧数据迁移的联合验收。离线测试、XPI 文件存在或缓存覆盖率都不能替代这些检查。

## 已核对的积极设计

- 显式硬 Query Contract 不会再让裸问题表面词额外形成隐式 AND；Unicode 标识符按字符与顺序区分。
- `sessionLedger()` 对常规非空会话要求门禁位置已列出、上下文已读、已审查、要求的检索分支完成、精确槽关闭、无未解决直接事实冲突。
- `finalize()` 现在同时检查 `ledger.synthesisAllowed`；`researchResult()` 与 Output Profile 也再次检查 Gate。离线零候选回归已覆盖，实机迁移仍待验收。
- PDF 页链接只在附件唯一且页码有效时生成；Note 保留行号/短引追溯。PDF/Note 共用活动模型，但查询服务可用性须独立检查。

## 隐私清理候选包范围

候选包从受控白名单生成，只包含运行所需源码、通用配置、必要文档和离线测试；不拷贝 Zotero 用户 profile、SQLite、日志、密钥、旧 XPI 或历史存档。保留不含研究主题的 `strawberry-vnext` 格式兼容 Profile，其他笔记由 `generic` 兜底；自动笔记同步默认关闭、默认范围为 My Library。候选包仍含历史兼容命名；这不是个人研究方向。发布者仍须人工审核二进制模型来源与授权。
