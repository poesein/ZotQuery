# ZotQuery 3.1.23

- 增加 `zotquery_get_selected_items`：只读 Zotero 主窗口当前选中条目，返回文献库、稳定 item key、标题、类型和子项目的父条目 key。
- 增加 `zotquery_create_child_note`：对明确指定的普通文献条目创建 Zotero 子笔记，接受标题、HTML 正文和可选的笔记标签；不覆盖既有笔记，也不改动 PDF。
- 写入前校验目标文献库、父条目、正文和标签；清理不安全 HTML；在保存事务中核对 `itemNotes.parentItemID`，避免误报独立笔记为子笔记。相同内容的重试返回已创建的笔记。
- ChatGPT 紧凑工具面只新增这一项 Zotero 写入，标记为非只读；研究台账写入仍阻断。客户端的逐次确认行为须在连接刷新后实测。

本版本不内置用户的精读模板。模型必须先读取用户提供的模板并完成来源核验，才能提交最终笔记正文。
