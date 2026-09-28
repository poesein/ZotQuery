# ZotQuery 3.1.25 Depth QC 热修复

此包保持扩展 ID 和 manifest 版本 `3.1.25`，用于更新已安装的 3.1.25 代码与私有 ChatGPT bridge。原有 Zotero 文库、笔记、索引和 ZotQuery 数据库均不迁移或重写。

- `generation` 的精确 JSON schema 现在出现在原生和 bridge 的 `zotquery_upsert_child_note` 工具定义中；`zotquery_reading_generation_profile` 返回同一 schema。错误字段名返回 `SCHEMA_UNKNOWN:generation.…`，遗漏必需字段返回 `SCHEMA_REQUIRED:generation.…`。
- 新增只读 `zotquery_depth_qc_preview`，运行与正式 upsert 相同的正文和父条目 PDF 检查。预检不写笔记、标签或失败记录。`DEPTH_QC_FAIL` 时正式写入仍保持原有阻断行为。
- 原始研究的分页字段是 `fullTextRead:{attachmentKey,totalCharacters,chunks:[{offset,length,nextOffset}]}`，末次 `nextOffset` 必须为 `null`。关键图使用 `coreFigureIds` 与 `figures`；因果检验使用 `causalTests`。完整结构见 `strawberry-vnext-depth.schema.json`。
- 含已安装扩展 XPI、bridge 包和源码包；本次为本地同版本热修复，不能依靠 Zotero 的版本号区别旧 3.1.25 和热修复版。请以包 SHA-256 及原生工具清单为准。
