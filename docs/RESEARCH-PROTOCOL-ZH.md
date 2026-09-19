# ZotQuery 科研协议 v2.2

## 1. 检索命中不是事实

ZotQuery lexical/semantic、Core note 都用于定位候选证据。最终事实必须来自阅读后的上下文；EXACT 数值、残基、序列、构建体范围等，要求先在 `factRequest.slots` 声明事实槽及类型，再由 `zotquery_evidence_fact` 以原始 PDF passage 与稳定 locator 逐槽闭合。

## 2. 先声明 Coverage Universe

推荐先调用 `zotquery_evidence_plan`。Query Contract v2 的硬谓词：

- MUST group 内：OR；
- MUST groups 间：AND；
- MUST_NOT：NOT；
- SHOULD：排序/导航，不扩大严格 coverage universe。

`"phrase"`、`+term`、`-term`、`{alias|alias}` 与结构化 group 参数均可使用。

## 3. “全量”的新定义

`QUERY_EXHAUSTIVE` 的“全量”指：**穷尽所有满足预先声明 hard Query Contract 的 indexed PDF chunks**，然后把同一 work 中相邻重复 chunk 聚成 evidence clusters。每个 cluster 只需审一个 representative，但全部 raw positions 仍保存在 session 中用于审计。

因此 raw retrieval、navigation set 与 gate review units 必须区分。

## 4. 默认流程

```text
zotquery_evidence_plan
→ zotquery_evidence_sweep(readingPolicy=QUERY_EXHAUSTIVE)
→ zotquery_evidence_positions(scope=coverage) 分页到 nextOffset=null
→ zotquery_evidence_context
→ zotquery_evidence_review
→ EXACT: zotquery_evidence_fact
→ zotquery_evidence_finalize
```

需要查看补充召回：

```text
zotquery_evidence_positions(scope=navigation)
```

## 5. Core note

Core 笔记默认是 navigation/synthesis aid，不与原始 PDF passage 等价。笔记 claim 需要原文验证时：

```text
zotquery_evidence_verify_note
```

同父条目中定位到的 PDF passage 会被提升进 coverage universe，随后必须 context + review。

## 6. Semantic

semantic route 是 recall supplement。默认 `includeSemantic=true` 但 `requireSemantic=false`，所以 semantic top-K 截断不会阻止 lexical Query Contract 的严格 finalize。

只有研究协议明确要求 semantic threshold-complete 时才设 `requireSemantic=true`。

## 7. Coverage Gate v2

`synthesisAllowed=true` 要求：

1. hard lexical scan 完成；
2. 所有 `coverage_required=1` review units 已通过 `zotquery_evidence_positions(scope=coverage)` 列出；
3. 所有 review units 已打开 context；
4. 无 unreviewed / needs_context / unresolved / conflicting review units；
5. EXACT 问题的每个 required slot 均由类型匹配的 DIRECT PDF FactRecord 闭合（旧 session 未声明 slots 时兼容“至少一个 DIRECT fact”）；
6. direct FactRecord 数值冲突已显式解决；同一数值被标成不同区间类型时也阻断合成，不能把构建体边界、结构解析范围、二级结构范围等混为一谈；
7. 若是 FULL_TEXT_CANDIDATES，则所有 coverage candidate PDF 全文 chunks 已分页完成；
8. semantic/LNE 只有在显式 require 时才要求 retrieval-complete。

检索分数、semantic similarity、笔记内容都不能代替这些门禁。

## 8. 大查询保护

`zotquery_evidence_plan` 会预估 hard predicate 的 raw positions 与 papers。默认 `maxRawPositions=2500`。AUTO 可通过提升 SHOULD group 为 MUST 自动收紧；仍超限时，`zotquery_evidence_sweep` 不创建 session，而返回 `blockedBeforeSweep=true`。

可通过显式更窄的 MUST/alias groups、排除词来修正；`allowLargeSweep=true` 仅用于明确需要的大规模审计。

## 9. Evidence type

Evidence hint 只用于排序，推荐人工/模型 review 时使用通用 scope：

`DIRECT_FACT` / `EXPERIMENT_RESULT` / `QUANTITATIVE_MEASUREMENT` / `SEQUENCE_DEFINITION` / `STRUCTURE_OBSERVATION` / `CONSTRUCT_DEFINITION` / `REGION_MAPPING` / `BINDING_RESULT` / `METHOD` / `AUTHOR_INTERPRETATION` / `BACKGROUND` / `INFERENCE`。

结构边界、删除构建、HDX region 等仍必须区分，所有判定均应使用通用规则，而非特定研究领域的硬编码。
