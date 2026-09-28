# ZotQuery 3.1.25 端到端审计修复

这份同版本本机更新针对精读与证据测试报告中可复现的接口、统计和渲染问题。保留现有 Zotero 笔记、标签、研究账本和语义向量缓存。

## 修复

1. **Output Profile 契约**：`output_profile_list` 返回的 `layout: "sections"` 现在能通过 `output_profile_validate`。`compact`、`standard`、`exact`、`exhaustive-vnext` 四个内置配置均可列表、验证和渲染。未知 layout 仍被拒绝。
2. **LNE 语义覆盖率**：覆盖率分子改为当前段落中具有活动模型、正确维度向量的唯一 hash 数量。`semantic.vectors` 继续展示缓存总数；新增 `coveredUniqueSegments` 和 `staleOrInvalidVectors`。历史缓存不被删除。审计时 53,782/53,782 个当前唯一段落有向量，另有 1,146 条历史或维度不匹配缓存，因此覆盖率为 100%，而非 102.13%。
3. **PDF 页面渲染**：复杂页面的高分辨率首轮最多等待约 18 秒，给同一 PDF 的低分辨率回退最多约 40 秒；仍保留 74 秒外层上限和取消后不得并发渲染的保护。诊断中的 `renderMs` 只计成功那一轮，新增 `firstAttemptMs`、`fallbackAttemptMs`。缓存命中时 `renderTotalMs` 为本次检索时间 0，原渲染耗时另列 `sourceRenderTotalMs`。
4. **指定笔记的 `compare`**：整句逐字匹配无结果时，用与 `find` 相同的词面拆分器做笔记内回退。混合字母数字的变体标识符仍是必要条件；结果附行号、匹配词与 `retrievalMode`，仅用于导航，硬事实仍须核对原始 PDF。

ChatGPT bridge 随包更新工具说明，并继续从 Zotero 原生 MCP 获取工具 schema。网页 ChatGPT 需要刷新工具，才能看到更新后的 `compare` 描述。此更新不会自动执行有副作用的 note/tag 或研究账本写入验收。
