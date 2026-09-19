# ZotQuery 全量研究输出模板 vNext

> 适用系统：ZotQuery 3.0.11 及其 Query Contract v2、Coverage Gate v2、ZotQuery Core / Search / Evidence / Survey / MCP / Agent。  
> 报告类型：全库候选审计、原文证据核验、结构或序列精确事实、机制比较及争议研究。  
> 此文件是报告写作模板，不是系统已完成任何一次检索、阅读或实验的声明。

## 使用边界

报告中的“全量”只指本次声明的文库、索引时间、查询合同和阅读策略所形成的覆盖宇宙。候选召回、分段筛查、上下文阅读、全文分页及深读必须分别计数。`zotquery_research_render` 可以生成持久化台账，但不会自动写出未经审阅的机制综合；本模板中未由系统持久化的分析、数字与结论必须人工核对并标记为补写。

Coverage Gate 未就绪时，标题、摘要和结论均标为“阶段性”；不得填写确定答案。精确事实需要对应类型的 DIRECT FactRecord、原文 quote 和稳定 locator。PDF 的 `chunkIndex` 是插件内部定位号，不等于 Zotero 阅读器的页码；Note 的 canonical 行号不是 Zotero 原生段落锚点。

## 回链约定

| 证据对象 | 可点击链接 | 精度与条件 |
|---|---|---|
| 父文献 | `[父条目](zotero://select/library/items/ITEMKEY)`；群组库使用 `groups/GROUPID` | 只选中父条目，不指向证据文段 |
| PDF 页 | `[PDF p.N](zotero://open-pdf/library/items/ATTACHMENTKEY?page=N)` | 必须使用 PDF 附件 key 和 PDF 物理页码；单 PDF 附件可自动生成；多附件时不得猜测 |
| PDF 标注 | `...&annotation=ANNOTATIONKEY` | 仅在确实存在且已核验该标注时使用；插件不会为搜索命中自动创建标注 |
| Zotero Note | `[笔记](zotero://select/library/items/NOTEKEY)` | 选中笔记；旁列 `NOTEKEY:L起-L止`、原文短引和 canonical hash，供 `zotquery_trace` 精确复核；当前 Zotero `select` 不支持跳到指定行 |

如果报告只拿到父条目 key，或者 PDF 有多个附件、缺页码，保留父条目链接与 `workKey + chunkIndex + quote`，标记“页级回链待核验”；不要把父条目链接标作“直达 PDF 文段”。网页/PMC/数据库原文使用其稳定 URL、段落/图表号。可点击回链是导航，逐字 quote 和定位字段是可复核性的核心。

---

## 1. 报告封面与状态

```markdown
# <研究对象>：<问题>（ZotQuery 全量研究报告 / 阶段性报告）

- 报告日期：<YYYY-MM-DD>
- 用户原问题：<逐字保留>
- ZotQuery 版本：<health.version>；报告 profile：exhaustive-vnext
- Research session：<sessionId>
- Query Contract：<version>；Coverage Gate：<version>
- questionMode：STANDARD / EXACT
- readingPolicy：QUERY_EXHAUSTIVE / ALL_POSITIONS / FULL_TEXT_CANDIDATES
- 范围：<我的文库/群组、索引时间、未索引来源>
- 最终状态：ready_for_synthesis / blocked / in_progress
- synthesisAllowed：true / false
- blockers：<逐项保留，不得省略>
```

## 2. 可交付摘要

当且仅当 `zotquery_evidence_finalize` 返回就绪、且 `zotquery_research_result.coverageGate.synthesisAllowed=true`：

> **答案**：<1–3 句，只覆盖已闭合槽位；每句标注 Fact ID 与来源链接。>

否则：

> **阶段性结果，不能定稿**：已经核验 <...>；仍有 <未列出候选/未读上下文/未审阅位置/未闭合槽/直接事实冲突/缺原文>。以下仅呈现已完成台账，不作确定综合。

| 最小结论或待核查命题 | 事实状态 | Fact ID | 原文定位与回链 | 外推限制 |
|---|---|---|---|---|
| <...> | DIRECT / INFERRED / SECONDARY / 未闭合 | <...> | <PDF 页或 Note 行号> | <物种、isoform、构建体、条件> |

## 3. Query Contract 与标识符身份

| Group ID | MUST / SHOULD / MUST_NOT | 原始词面 | 调用方明确 aliases | 组内 / 组间关系 | 原始命中 |
|---|---|---|---|---|---:|
| <...> | MUST | <保留 Unicode、字符顺序> | <...> | 组内 OR，MUST 组间 AND | <positions / papers> |

```text
hardExpression: <实际查询>
maxRawPositions: <...>
rawMatches / papers: <...>
requiresRefinement: <true/false>
autoPromotedGroups: <...>
surfaceAudit: <原始词面去向>
droppedTerms: []
identityPolicy.warnings: <换序或易混词警报>
```

词面差异表：

| 标识符 A | 标识符 B | 关系 | 判断依据 | 查询处理 |
|---|---|---|---|---|
| <标识符 A> | <换序或易混形式 B> | 相同 / 不同 / 待证 | <原文命名、权威记录> | <分组/警报> |

字符顺序、希腊字母与 ASCII 写法不能静默互换；`mb7` 只有调用方显式提供时才进入 aliases。语义相似只参与候选导航，不建立同一实体。若问题含多个独立实体，核查每个是否保留为独立 MUST；变更合同需记录轮次和原因。

## 4. 语料健康与阅读漏斗

| 指标 | 本次值 | 来源 / 边界 |
|---|---:|---|
| PDF indexedPapers / totalPapers | <... / ...> | `zotquery_research_health.search` |
| PDF chunks / FTS chunks / location coverage | <... / ... / ...%> | `health.fts` |
| PDF 模型 / Note 模型 | <... / ...> | `embeddingContract.sameModel` |
| 查询服务 queryReady | <true/false> | 缓存覆盖率不等于实时查询可用 |
| 已索引 Notes / segments / 唯一向量 | <... / ... / ...> | `health.lne`；注明笔记索引范围 |
| 未索引、截断、OCR 或缺 PDF | <逐项> | 不得写作“无遗漏” |

| 阶段 | 独立数量 | 完整性 / 分页状态 |
|---|---:|---|
| lexical 原始 positions | <...> | <是否触及上限> |
| gate-required review units | <...> | <listed / total；nextOffset> |
| semantic / Note 导航位置 | <... / ...> | <阈值、截断> |
| 去重后候选论文 | <...> | <同一研究谱系的合并依据> |
| 分段筛查论文 | <...> | <只读 snippet 不能写成全文> |
| 上下文阅读论文 | <...> | <contextRead / total> |
| 全文分页论文 | <...> | <document.nextOffset=null 的篇数> |
| 深读论文 | <... 或“未记录”> | 仅在实际读方法、结果、图表、限制后填写 |
| DIRECT / INFERRED / SECONDARY Facts | <... / ... / ...> | <槽位闭合情况> |

固定表述：本次召回 `<N>` 篇，筛查 `<N>` 篇，打开证据上下文 `<N>` 篇，完成全文分页 `<N>` 篇，机制级深读 `<N 或未记录>` 篇。五项不得相互替代。

## 5. Coverage Gate 与 Evidence Slots

| 门禁项目 | 完成 / 总计 | 阻断说明 |
|---|---:|---|
| coverage positions 已全部分页列出 | <... / ...> | <...> |
| gate-required context 已读 | <... / ...> | <...> |
| review units 已决策 | <... / ...> | <unreviewed / needs_context / conflicting> |
| FULL_TEXT_CANDIDATES 文档分页 | <... / ... 或不适用> | <...> |
| Survey Note→同父 PDF promotion | <完成/未完成/不适用> | <...> |
| EXACT 所需 DIRECT slots | <... / ...> | <...> |
| 直接事实冲突 | <0 / N> | <...> |

| Slot ID | valueType | 必答字段 / 编号体系 | DIRECT Fact ID | 状态 | 未闭合原因 |
|---|---|---|---|---|---|
| <...> | sequence / residue_range / homology_mapping / ... | <...> | <...> | closed / open | <...> |

`CLOSED` 至少要求：实体与体系明确、值及编号体系明确、同类型 DIRECT FactRecord、原文 quote 包含校验、PDF/PMC 等原始来源稳定 locator、无未解决冲突。Note 或综述可提供线索，但不会自动填补原始来源记录。

## 6. 候选审阅与谱系

| positionId / workKey | 候选与回链 | 命中组 | context | reviewStatus | 证据角色 | 纳入 / 排除理由 |
|---|---|---|---|---|---|---|
| <...> | <父条目 / 可用 PDF 页> | <...> | 已读/未读 | reviewed/excluded/conflicting/unresolved/needs_context | <...> | <...> |

所有 gate-required 候选都要有终态。semantic 与 Note 发现的额外候选单列导航区；经同父 PDF 核验并纳入 coverage 的，记录其升级时间和新 `positionId`。预印本、正式版、补充材料、重复笔记及更正记录按同一研究谱系审计，不重复计数。

## 7. 证据单元与回链

```markdown
### EU-<编号>｜<可证伪的最小主张>
- 关联 Slot / Fact：<slotId> / <factId>
- 实体：<物种 / isoform / 构建体 / 编号体系>
- 实验：<体系、扰动、对照、参数、n、误差>
- 原文短引："<逐字原文；不能用笔记改写冒充>"
- 定位：<workKey；PDF chunkIndex；PDF 物理页；Figure/Table/paragraph>
- 回链：[PDF p.N](zotero://open-pdf/library/items/ATTACHMENTKEY?page=N)；[父条目](zotero://select/library/items/ITEMKEY)
- Note 线索（若有）：[笔记](zotero://select/library/items/NOTEKEY)；`NOTEKEY:Lx-Ly`；<quote>；<canonicalHash>
- 支持：<原文直接支持的最窄命题>
- 限制：<原文没有证明的部分；作者说明与报告推断分开>
```

若只有 PDF 页级链接，应直说“打开所在页”；除非有已核验 Zotero annotation，否则不能写“点击直达并高亮文段”。若 Note 已修改，重新用 `zotquery_trace` 核对 `sourceHash` / `canonicalHash` 与行号，旧行号不得视为稳定锚点。

## 8. 类型化硬事实专表

| Fact ID | 实体与编号体系 | valueType | 值 / 单位 | 原文 quote | locator 与回链 | DIRECT? | 冲突 |
|---|---|---|---|---|---|---|---|
| <...> | <...> | <...> | <...> | <...> | <...> | 是/否 | <...> |

结构边界、删除构建体、HDX peptide、突变位点、功能 motif、序列、同源映射与数值测量不得因数字相近而合并为同一种事实。序列须标明来源记录、版本、物种、isoform、起止位置及逐位核对结果；没有来源记录时填“未闭合”，不从近邻 isoform 推断。

## 9. 主体综合（门禁通过后填写）

### 定义与实体身份

<明确名称、同义、同源、构建体和编号体系。>

### 结构与动力学

<结构解析、HDX、NMR、模拟分别陈述；每一机制箭头对应 Fact ID。>

### 生化、细胞与体内层

<扰动—对照—结果—边界；保留实验条件与跨体系外推限制。>

### Claim–Evidence 矩阵

| Claim ID | 最小主张 | 支持 Fact IDs | 反证 / 限制 | 独立研究数 | 强度及理由 |
|---|---|---|---|---:|---|
| <...> | <...> | <...> | <...> | <...> | <直接性、重复、方法正交性> |

### 冲突、负结果与空白

| 类型 | 冲突或未闭合问题 | 来源与定位 | 状态 | 可执行下一步 |
|---|---|---|---|---|
| direct-fact / mechanism / negative / gap | <...> | <...> | resolved / unresolved | <...> |

## 10. 文献清单

| 论文 / 研究谱系 | 年份 | 角色 | 读到的层级 | 回链 | 覆盖 Slots |
|---|---:|---|---|---|---|
| <...> | <...> | 直接原始 / 旁证 / 综述 / 排除 | snippet / context / full-text / deep-read | <父条目及已核验页级链接> | <...> |

排除文献单列，说明排除阶段与原因；综述引用的原始研究未核对前不得算独立直接证据。

## 11. 可复现日志

```text
zotquery_research_health       <模型、索引、queryReady>
zotquery_evidence_plan         <MUST/SHOULD、rawMatches、droppedTerms>
zotquery_evidence_research_start 或 zotquery_evidence_sweep  <sessionId、策略>
zotquery_evidence_positions    <每页 offset/limit/nextOffset，直到 null>
zotquery_evidence_context      <已读数/失败数>
zotquery_evidence_document     <每篇分页，若策略要求>
zotquery_evidence_review       <各状态计数>
zotquery_evidence_promote_notes / zotquery_evidence_verify_note <同父 PDF 证据升级>
zotquery_evidence_fact         <DIRECT/INFERRED/SECONDARY>
zotquery_evidence_finalize     <synthesisAllowed、blockers>
zotquery_research_result       <分页总量；nextOffset>
zotquery_research_render       <profileId=exhaustive-vnext；阶段性/就绪>
zotquery_trace                <笔记行号、quoteCheck、sourceHash>
```

| 时间 | 操作 | 失败 / 截断 / 校正 | 影响范围 | 修复与重跑 |
|---|---|---|---|---|
| <...> | <...> | <...> | <...> | <...> |

记录 PDF 缺失、OCR 字符错误、FTS 未命中、semantic 服务不可用、Note 行号漂移、页码与文献印刷页码不同、多 PDF 附件歧义、原文 quote 校验失败和直接事实冲突。报告中未能解决的限制必须留在最终状态。

## 12. 机器可读附录

```json
{
  "reportVersion": "zotquery-result-v1",
  "sessionId": "<sessionId>",
  "queryContract": {"version": "query-contract-v2", "mustGroups": [], "shouldGroups": [], "surfaceAudit": [], "droppedTerms": []},
  "funnel": {"retrievedPapers": null, "screenedPapers": null, "contextReadPapers": null, "fullTextPagedPapers": null, "deepReadPapers": null},
  "coverageGate": {"synthesisAllowed": false, "blockers": []},
  "evidenceSlots": [],
  "candidateDecisions": [],
  "facts": [],
  "references": [],
  "pagination": {"totalDecisions": 0, "nextOffset": null}
}
```

机器附录直接取自持久化会话并保留分页边界；人工补写字段标记 `manual`。报告模板、插件 XPI、索引模型和研究会话版本/时间戳分别记录，不把模板版本当作检索版本。

## 交付前检查

- [ ] 当前运行版的 health、PDF/Note 索引、同模型与实时查询状态已核实。
- [ ] 两个及以上不同标识符均按身份进入 Query Contract；`droppedTerms=[]`，无静默 ASCII 退化。
- [ ] 全部 gate-required 页已列出、读上下文并审阅；任何 `nextOffset` 未尽时报告仍为阶段性。
- [ ] 候选、筛查、上下文、全文分页、深读独立计数；未知值为“未记录”，不填 0。
- [ ] EXACT 槽位由同类型 DIRECT 原始记录闭合；冲突和跨类型区间问题已处理。
- [ ] 每条核心结论有 Fact ID、逐字 quote、稳定 locator 及可用回链；父条目链接未冒充文段链接。
- [ ] PDF 页级链接使用附件 key，不使用父条目 key；多附件时未猜测。
- [ ] Note 只给出可支持的 item 选择链接、canonical 行号和原文短引，未声称原生逐行跳转。
- [ ] `synthesisAllowed=false` 时标题与摘要均标为阶段性，未输出确定答案。
