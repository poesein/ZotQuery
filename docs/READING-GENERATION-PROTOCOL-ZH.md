# 🍓精读笔记 vNext：深度生成与完成门槛

`content/profiles/notes/strawberry-vnext.json` 继续负责**已有笔记的解析**。独立的 `content/profiles/generation/strawberry-vnext-depth.json` 定义**新笔记的生成协议**。`readingProfileId=strawberry-vnext` 仍是 managed note 的幂等命名空间；提交时另传 `generationProfileId=strawberry-vnext-depth`。

## 逐篇流程

1. 用 `zotquery_reading_batch_status` 分页找到待处理文献；用 `zotquery_reading_generation_profile` 读取当前生成协议。先判断 `original_research`、`review` 或 `design_note`，不要把设计说明归为实验论文。
2. 原始研究逐段读取同一 PDF 附件的已索引全文。保存每次返回的 `offset`、正文长度和 `nextOffset`，直到终页 `nextOffset=null`；同时检查原始 PDF 图版和图注。当前 `fullTextRead` 是客户端提交的分页记录，服务端检查连续性和终页，但无法独立证明模型理解了每段内容。
3. 原始研究需展开：核心科学问题/可检验假设、实验体系与可比性、至少两个关键 Evidence Units、所有核心 Figure（需要时逐 panel）、necessity/sufficiency/rescue/orthogonal validation、阴性结果/冲突/异质性、Methods 可复用参数、局限/替代解释、原创研究谱系、课题关系和可实验化的假设。每个 Figure 明确设计、结果、定量（未报告也要说明）、作者解释、证据判断、能证明与不能证明；每个字段应写入笔记正文，而非只填写 QC 表。
4. 综述分支展开综述定位、机制框架、证据距离、至少两项有定位的原创研究、知识边界和课题价值。设计说明分支展开目标、约束、依据、验证计划、风险/失败判据及课题价值。区分实验支持、作者陈述、作者解释、综合推断和个人判断。
5. 每篇完成后先调用只读 `zotquery_depth_qc_preview`，提交目标 `library`、`parentItemKey`、`readingProfileId`、`generationProfileId`、最终 `html` 和 `generation`。预检运行与写入相同的正文及父条目 PDF 检查，但不创建笔记、不加标签，也不记录失败。根据 `SCHEMA_REQUIRED:generation.…`、`SCHEMA_UNKNOWN:generation.…` 和其他 QC 原因修正审计信息；通过后再用同一份 HTML 与 generation 调用 `zotquery_upsert_child_note`。正式写入时会重新检查；只有 `DEPTH_QC_PASS` 才在一个事务中写入/更新托管笔记并加 `✅精读完成`。`tagOnSuccess=false` 可先保存通过 QC 的笔记，后续 `zotquery_set_item_tag` 仍会复核对应内容的通过记录。

## `generation` 记录

`articleType` 必须是 `original_research`、`review`、`design_note` 之一。原始研究另需：

精确的 MCP 字段、类型和嵌套结构定义在 `content/profiles/generation/strawberry-vnext-depth.schema.json`；`zotquery_reading_generation_profile` 也返回同一份 `submissionSchema`。`generation` 不是自由格式对象。正文和审计记录须使用相同的关键表述：QC 会核对 Evidence Unit 的 `claim`、每图七项字段以及因果检验的 `explanation` 是否出现在最终 HTML 中。

- `fullTextRead: {attachmentKey,totalCharacters,chunks:[{offset,length,nextOffset},...]}`：从 0 连续到全文长度，末块 `nextOffset:null`。只记录同一个 PDF 附件。
- `evidenceUnits:[{claim,sourceLocator,role},...]`：至少两个，`claim` 须出现在最终正文；定位应指向原文。
- `coreFigureIds` 与 `figures` 一一对应。每图填写 `id,sourceLocator,design,result,quantitation,authorInterpretation,evidenceJudgment,canProve,cannotProve`；字段叙述须出现在正文。需要逐 panel 时填写 `expectedPanelIds` 和对应 `panels:[{id,design,result},...]`。
- `causalTests` 包含 `necessity,sufficiency,rescue,orthogonalValidation`，每项用 `status`（`tested`、`not_tested`、`not_applicable`）及 `explanation` 说明；已测试项另附 `sourceLocator`。不得用未做实验冒充阴性结果。

综述另需 `originalStudies:[{citation,contribution,sourceLocator},...]`，至少两项。设计说明另需 `designBasis` 和 `validationCriterion`。每个分支的必要章节标题和软篇幅阈值见 Generation Profile JSON。若某项在原文中不存在，应明确写“未报告/未测试”及其证据边界；不要补造数值或实验。

## Depth QC 与状态

QC 检查章节是否存在且有实质正文、原始研究是否有连续全文分页记录、Evidence Units、逐图字段和因果检验判定。可见字符低于分支软阈值只产生 `SOFT_LENGTH_BELOW` 警报，不单独阻止写回；复杂 CNS 机制论文没有硬长度上限。QC 是结构与完整性门槛，不等于科学事实真伪的自动审查。

失败时 `zotquery_upsert_child_note` 返回 `DEPTH_QC_FAIL` 与具体 `reasons`，不创建/改写托管笔记，也不加完成标签。状态页显示 `depth_qc_failed` 和报告。通过后返回 `DEPTH_QC_PASS`，记录与笔记内容哈希绑定。旧版已存在的托管笔记和标签不会被重写；缺少本次 QC 记录时显示 `legacy_unverified`，补加标签也会被拒绝。
