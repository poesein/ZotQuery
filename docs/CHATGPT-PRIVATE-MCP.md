# ZotQuery 私有 ChatGPT MCP 连接（3.1.25）

网页 ChatGPT 通过私有 Secure MCP Tunnel 按需调用本机 ZotQuery。隧道不公开 Zotero 的监听端口，也不会预先上传整座文库；**每次实际调用返回的文献、笔记、PDF 正文或图片会发送给 ChatGPT**。

## 工具范围

ChatGPT 个人版连接建议使用 `ZOTQUERY_CHATGPT_SURFACE=compact-read`：直接声明完整文库浏览、研究历史、证据文本、图片、精读批次状态和受控笔记写回。额外的原生只读操作可通过 `zotquery_native_read_catalog` 分页发现，再由 `zotquery_native_read_call` 调用；研究证据台账写入工具在这个模式下不会声明，也会在本地转发前被拒绝。创建／更新子笔记、设置完成标签、登记批次失败明确标记为非只读。客户端是否显示及逐次确认这些动作，必须在连接刷新后实测，不能仅凭工具标注保证。

支持写入工具的其他 MCP 客户端可不设置上述环境变量，继续使用完整的直接工具清单。`readOnlyHint` 仅是提示，不能替代客户端权限审批。

- 7 个全库只读工具：列群组文库、列分类、检索／分页浏览条目、分页浏览指定分类的顶层文献、读取条目、列子笔记／附件、分段读取附件已索引的全文。个人文库和指定群组文库均可按需浏览，未进入 ZotQuery 研究历史的条目也能找到。
- 原有 13 个会话只读工具：研究历史、台账、事实、证据位置／上下文、历史答案、会话关联 PDF 及页图。图像工具默认开启，仍受 ZotQuery 设置中的图片开关约束。
- ZotQuery 原生 MCP 的明确白名单工具：包含全局检索、LNE 笔记检索、研究计划、执行、证据审查、事实记录、门禁和看图。改变研究状态的工具明确标记为非只读；仅当用户要求执行对应研究操作时调用。工具元数据的提示**不是**权限保证，服务端仍校验参数和本机 Bearer。
- `zotquery_get_selected_items` 只读当前 Zotero 主窗口选中条目。`zotquery_create_child_note` 保留一次性创建接口。`zotquery_reading_generation_profile` 返回独立深度生成协议及精确的 `submissionSchema`。`zotquery_depth_qc_preview` 用与正式写入相同的检查只读预检，不写笔记、标签或失败记录。`zotquery_upsert_child_note` 按文献库、父条目和 `readingProfileId` 写入或更新 ZotQuery 管理的同一篇子笔记；其 `generation` 参数显式声明完整 schema，提交的 `generationProfileId` 和 `generation` 记录必须先通过 Depth QC。不覆盖同名但非本插件管理、或写入后被人工修改的笔记。保存事务内核对真实父子关系，再把 `✅精读完成` 加在父文献上；也可传 `tagOnSuccess=false` 暂不标记。`zotquery_set_item_tag` 仅对已有受管理笔记且对应内容通过 Depth QC 的父文献补加该标签。
- `zotquery_reading_batch_status` 每次返回分类中按稳定 key 排序的 1–10 篇顶层文献，区分 `pending`、`missing_pdf`、`failed`、`depth_qc_failed`、`completed`、`externally_tagged`、`written_unmarked`、`legacy_unverified`、`managed_note_conflict`；同时返回生成分支、Depth QC 状态和原因。`zotquery_reading_batch_record_failure` 记录单篇失败原因与次数；重试成功即清除失败记录。旧笔记和外部标签不会被误认成已通过本次 QC。
- 3 个只读配置预览工具：模拟笔记配置安装、检查笔记配置选择、模拟输出配置安装。真正的 `note_profile_install`、`note_profile_select`、`output_profile_install` **不向 ChatGPT 开放**；其它配置列表、校验和草稿工具可读。

原生 `evidence_positions`、`evidence_context`、`evidence_document` 会登记覆盖状态；不希望改变台账时，应选用 `list_positions`、`read_context`、`read_document_chunks` 的只读版本。PDF／笔记检索命中是导航，不自动证明结论；精确事实仍须回读原始 PDF 并遵守证据门禁。`readingProfileId` 仅用于确定幂等的笔记身份；既有 Note Profile 用于解析笔记。独立 Generation Profile 定义精读生成和 QC 要求，详见[深度生成协议](READING-GENERATION-PROTOCOL-ZH.md)。

## 可恢复的逐篇精读

先用 `zotquery_library_list_collections` 找到目标分类的稳定 key，再用 `zotquery_library_get_collection_items` 分页导航；用 `zotquery_reading_batch_status` 每页查询不超过 10 篇的 PDF、子笔记与失败状态。每次选择 3–10 篇 `pending` 或可重试的 `failed` / `depth_qc_failed` 文献，按三分支逐篇阅读；原始研究全文分页读到 `nextOffset=null`，逐图核对。先调用 `zotquery_depth_qc_preview` 并依据精确字段路径修正元数据；`DEPTH_QC_PASS` 后再调用 `zotquery_upsert_child_note`，它仍会重新运行同一门槛。PDF 缺失或读取失败时用 `zotquery_reading_batch_record_failure` 记原因。再次运行从状态页继续，分类分页到 `nextOffset=null` 才能称完整覆盖。`managed_note_conflict`、`externally_tagged`、`legacy_unverified` 必须核对，不得自动强行修复。

这里没有一个代替模型思考的“整批精读”工具，也不会把数百篇 PDF 塞进同一次调用。写入前应核对每篇原文、模板、最终笔记及目标条目。

## 本机准备与连接

1. 安装 ZotQuery 3.1.25，重启 Zotero，确认研究台与本机 API 可用。
2. 安装 Node.js 20 或更高版本，将发布包中的 `chatgpt-mcp-stdio.mjs`、`strawberry-vnext-depth.schema.json` 和 `tool-contracts.json` 一起放在固定本机位置。
3. 仅通过进程环境变量传递 `ZOTQUERY_MCP_TOKEN`；不要把令牌写入项目、命令行参数、截图或 GitHub。个人版 ChatGPT 同时设置 `ZOTQUERY_CHATGPT_SURFACE=compact-read`。图像默认开启；需要隐藏图像工具时设置 `ZOTQUERY_CHATGPT_ALLOW_IMAGES=0` 并重启适配器。
4. 用 OpenAI Secure MCP Tunnel 连接适配器。在 ChatGPT 开发者模式中刷新该 MCP 连接的工具元数据，并在**新对话**中测试。工具清单变化不会自动更新旧连接的快照。

官方连接说明：https://developers.openai.com/plugins/deploy/connect-chatgpt
官方私有隧道说明：https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

## 数据与安全边界

- 全库浏览工具已移入 Zotero 原生 MCP，底层仍只读取 Zotero Desktop 的 `/api/` 接口；ChatGPT tunnel 从原生 MCP 获取字段定义并转发。子笔记和标签写入走本机 Bearer 保护的 ZotQuery 原生 MCP，不使用 Connector 写入，不开放删除文献或批量导出整个文库的操作。全文按字符分段返回。
- 完整模式的研究写入工具只操作 ZotQuery 的研究会话、证据和调查状态，不能更改原始 PDF。它们可能形成错误的人工核验记录，应在模型操作后复核来源、理由及证据门禁。紧凑模式不暴露这些研究写入工具，但允许受控子笔记和父文献完成标签写回。ChatGPT 是否弹出逐次确认取决于客户端；不能把它当作唯一防线。写回前应由用户确认目标文献、笔记标题及精读正文。
- 本地 ZotQuery MCP 保留 Bearer、Host/Origin 校验；适配器只转发白名单原生工具并验证输入类型、范围及参数体积。未来新增原生工具不会自动授权给 ChatGPT。
- 单次文本响应保护上限为 64 MiB，单次图像编码响应为 96 MiB；实际 Tunnel 或 ChatGPT 的上限可能更小。超出会明确报错，应减小分页或上下文级别，不会默默截断。
- Zotero 或 Tunnel 关闭后无法读取。自动重连不等于运行凭据自动续期；凭据应在到期前安全轮换。
