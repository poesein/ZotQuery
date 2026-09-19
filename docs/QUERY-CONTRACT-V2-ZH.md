# Query Contract v2 与 Coverage Gate v2

## 目标

Research Engine 核心完全领域无关：不内置任何基因、药物、motif 或结构域预设。领域知识只能通过显式 `aliasGroups/mustGroups/shouldGroups/evidenceTypeHints` 输入。

核心不变量：**有意义的用户表面词不能静默消失**。每个解析出的词必须进入 MUST、SHOULD、MUST_NOT 或审计说明；`droppedTerms` 应为空。

字符身份不变量：字符顺序属于标识符身份。`mβ7` 与 `βm7` 不会合并；如果调用方把同字符换序词放入同一 alias group，planner 直接拒绝。NFKC 只用于比较，不能证明科学同义。系统保留既有希腊字母/英文名称转写，但不自动生成 `α→a` 之类 PDF ASCII 退化别名。

## 查询语法

- `"短语"`：MUST。FTS 层按 token phrase 解释。
- `+词` / `+"短语"`：MUST。
- `-词` / `-"短语"`：MUST_NOT。
- `{A|B|C}`：一个 MUST alias group；组内 OR。
- 多个 MUST group：组间 AND。

例如：

```text
{entity-A|alias-A} {feature-B|alias-B} -review
```

等价于：

```text
(entity-A OR alias-A)
AND
(feature-B OR alias-B)
NOT review
```

MCP 推荐使用结构化参数而不是手工拼字符串：

```json
{
  "question": "feature-B definition",
  "aliasGroups": [
    {"id":"entity","aliases":["entity-A","alias-A"]},
    {"id":"feature","aliases":["feature-B","alias-B"]}
  ]
}
```

`aliasGroups` 缺省角色为 MUST；如只想用于排序/扩展，显式设 `"role":"SHOULD"`。

旧 `aliases:[...]` 仍可用，但只作为兼容的 SHOULD synonym registry，不会再替代原问题中的实体。

## 自动规划

没有显式 MUST 时，planner 会：

1. 保留所有有意义表面词；
2. 识别化合物/突变/残基/DOI/字母数字标识符等 protected identifiers；
3. 对候选锚点做 FTS cardinality preflight；
4. 选择最具区分度的锚点作为 MUST；
5. 若命中仍高于 `maxRawPositions`，最多继续提升 4 个 SHOULD group 为 MUST；
6. 若仍过宽，`evidence_sweep` 在建 session 前返回 `blockedBeforeSweep=true`，除非显式 `allowLargeSweep=true`。

`evidence_plan` 是无副作用预检工具，推荐先调用。

## Coverage Gate v2

默认 `readingPolicy=QUERY_EXHAUSTIVE`。

Coverage universe 不再等于“所有召回器碰到的位置”，而是：

```text
满足 hard Query Contract 的全部 lexical positions
→ 同一文献相邻重复 chunk 聚类
→ 每个 cluster 选一个 review unit
→ 100% list + context + review
```

semantic、LNE note、以及 cluster 内重复位置保留在 session 中用于导航和审计，但默认 `coverage_required=0`，不扩大 gate。

`evidence_positions`：

- `scope=coverage`（默认）：只返回 gate-required review units。
- `scope=navigation`：semantic / LNE / duplicate hits。
- `scope=all`：完整审计视图。

同父条目验证 `evidence_verify_note` 找到的 PDF passage 会被提升为 `coverage_required=1`。

## 阅读策略

- `QUERY_EXHAUSTIVE`：默认；严格覆盖 hard query 的 evidence clusters。
- `FULL_TEXT_CANDIDATES`：在 QUERY_EXHAUSTIVE 基础上，还要求完整分页所有 coverage candidate PDFs。
- `ALL_POSITIONS`：扩展审计策略；所有 lexical/semantic/LNE/duplicate positions 都进 gate，不建议日常使用。

## semantic / LNE 完整性

`includeSemantic=true`、`includeLNE=true` 只是补充导航；默认不会阻断 gate。

只有显式：

```json
{"requireSemantic":true,"requireLNE":true}
```

才把相应检索完整性纳入 finalize blocker。

## Evidence ontology

默认 evidence hints 是通用排序提示，不是事实判定：

- `DOSE_RESPONSE`
- `BINDING_OR_KINETIC_RESULT`
- `BINDING_RESULT`
- `QUANTITATIVE_MEASUREMENT`
- `SEQUENCE_OR_RESIDUE_DEFINITION`
- `STRUCTURE_OBSERVATION`
- `CONSTRUCT_DEFINITION`
- `REGION_MAPPING`
- `EXPERIMENT_RESULT`
- `AUTHOR_INTERPRETATION`
- `METHOD`
- `BACKGROUND_OR_OTHER`

最终 `evidenceScope` 仍由模型阅读上下文后记录。

## Domain preset

3.0.1 不接受内置 domain preset；请把所需同义词写成显式 `aliasGroups`。Survey 的 `quick/balanced/exhaustive/audit` 只控制检索广度，不携带任何领域词表。
