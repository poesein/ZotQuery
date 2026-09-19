# ZotQuery 3.0.11 候选版配置文件

## Note Profile

候选分发版内置 `generic`（所有其他笔记的兜底配置）与 `strawberry-vnext`（“精读笔记”格式兼容配置），位于 `content/profiles/notes/`，结构见同目录的 `profile.schema.json`。兼容配置只包含标题匹配、证据标签角色、章节词与 bar/pin 配对去重规则，不包含具体研究对象、研究方向、路径或密钥。自动识别先尝试特定配置，未匹配时退回通用配置；也可导入其他模板的自定义配置。标签保留原文 `rawTag`，再映射到 `canonicalRole`；未知标签不会自动成为直接证据。Note 本身不能代替原始 PDF/PMC 事实证据。

通过 `zotquery_note_profile_draft` 提供 Markdown 模板，只会抽取标题和标签，不会自行推断证据角色。编辑草稿中的 `selector.patterns` 与每个 `evidenceTags.*.role`，用 `zotquery_note_profile_validate` 检查，再明确确认调用 `zotquery_note_profile_install`。用户文件保存在 Zotero 数据目录 `zotquery/profiles/notes/`，不覆盖内置文件。固定配置需调用 `zotquery_note_profile_select` 并确认。候选版默认关闭笔记自动同步、仅限我的文库；用户可自主开启并选择全部笔记或字面量匹配。已有 Zotero 用户偏好可能覆盖这些默认值，安装包不会替用户重置。更改范围可能移除不再匹配的 Note 索引记录，不会删除 Zotero 原始笔记或 PDF 索引。

## Output Profile

内置 `compact`、`standard`、`exact`、`exhaustive-vnext`，结构见 `content/profiles/outputs/profile.schema.json`。`zotquery_research_result` 返回持久会话的规范结果，五级研究漏斗分别计数；未跟踪的“深读篇数”保持 `null`，不冒充已经深读。`zotquery_research_render` 再按配置渲染 Markdown。自定义配置经 `zotquery_output_profile_validate` 与 `zotquery_output_profile_install` 导入至 Zotero 数据目录 `zotquery/profiles/outputs/`。

所有输出配置必须保留状态、Query Contract、研究漏斗、Coverage Gate、Evidence Slots、候选审计、结构化事实、冲突、空白与来源。配置只改变展示，不会修改 Evidence Gate、事实来源规则或会话状态。即使选择精简格式，未 `ready_for_synthesis` 的会话仍只能输出阶段性结果。

3.0.9 的内置 `exhaustive-vnext` 使用 `layout: "structured-vnext"`，只将 ResearchResult 中实际持久化的字段填入 vNext 结构：状态、Query Contract、语料边界、阅读漏斗、Coverage Gate、候选审阅分页、FactRecord、冲突、来源及机器附录。缺失值标“未记录”，未通过门禁时只输出阶段性台账；机制综合留给人工核验。此前 3.0.8 的 `templateMarkdown` 空白附录不再渲染，Markdown 原文保留为人工写作指南。可导入配置见 `docs/ZotQuery-全量研究输出-vNext.json`；在设置页粘贴全文、校验、确认导入并选为默认格式。若此前已导入同 ID 的旧 JSON，启动时会在内存中迁移为结构化渲染，不覆盖 Zotero 数据目录里的用户文件。
