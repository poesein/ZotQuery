# 文献库规整接口

ZotQuery 3.1.26 在原有证据研究接口之外提供文库操作。所有写入都用稳定的 `library` 和八位 Zotero `itemKey` 定位；不依赖当前选中条目或窗口焦点。

| 步骤 | 工具 | 作用 |
| --- | --- | --- |
| 盘点 | `zotquery_library_tag_inventory`、`zotquery_library_item_organization` | 分页读条目、标签和集合；标签计数只覆盖当前页 |
| 预览 | `zotquery_library_organize_preview` | 最多 25 个明确条目；增删任意普通标签、同库集合移动、`rate` 与 `remark` |
| 建集合 | `zotquery_library_collection_preview` | 建立顶层或子集合的预览 |
| 导入 | `zotquery_library_import_item_preview` | 结构化元数据、作者、标签和集合；按 DOI 或完整题名查重 |
| 提交 | `zotquery_library_apply_plan` | 仅接受预览返回的 `planId`，30 分钟内复核旧状态后事务提交；相同 `planId` 重试返回同一回执 |

预览不写 Zotero。条目被他人修改、集合消失、或导入前出现重复文献时，提交报 `STALE_PREVIEW` 并要求重新预览。`✅精读完成` 保留给精读 Depth QC，规整接口拒绝增删该标签。已有笔记和 PDF 不参与集合移动，也不会被修改或删除。

`rating` 的 1–5 写入 Zotero Style 使用的 Extra `rate:`；0 清除这一行。`remark` 写入 Extra `remark:`，空字符串清除这一行；其余 Extra 行保留。若评级配置为标签存储，接口拒绝改评级。导入仅创建元数据条目；PDF、RIS/BibTeX 文件和跨文献库复制暂不由这些接口处理。

建议先按 collection 分页盘点，再针对确定的 itemKey 生成小批预览。分类标签可使用 `# 类型/`、`# 分子/`、`# 突变/`、`# 机制/`、`# 方法/`、`# 药物/`、`# 模型/`、`# 表型/`；这些前缀是使用建议，不强制改写现有标签。
