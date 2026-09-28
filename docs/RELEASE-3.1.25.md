# ZotQuery 3.1.25

此版本在 3.1.24 的精读批处理基础上新增独立的 `strawberry-vnext-depth` Generation Profile。既有 `content/profiles/notes/strawberry-vnext.json` 继续负责笔记解析，未改动。

- 原始研究、综述和设计说明采用独立生成分支。原始研究要求 PDF 全文分页记录到 `nextOffset=null`，并覆盖关键 Evidence Units、核心 Figure、必要 panel、因果检验判定与证据边界。
- `zotquery_upsert_child_note` 先执行 Depth QC；失败返回 `DEPTH_QC_FAIL` 和原因，不写托管笔记，也不加 `✅精读完成`。通过后在同一事务保存笔记及完成标签。
- 批次状态显示 Generation Profile、Depth QC 结果及旧版未核验记录。已有用户笔记不会被自动重写。
- 篇幅低于软阈值只报警，复杂机制论文无硬长度上限。QC 检查结构和提交的阅读记录，不独立验证科学判断。

本次发布还合并了 [Depth QC 接口修复](DEPTH-QC-HOTFIX.md)、[图片会话与普通标签修复](VISUAL-TAG-HOTFIX.md)、[工具契约规整](TOOL-CONTRACT-ARCHITECTURE.md)和[端到端审计修复](AUDIT-FIXES-3.1.25.md)。

验证：148 项自动测试、回归测试、隐私扫描和包完整性检查通过；既有 Zotero 配置中完成了输出配置、语义覆盖率、长问题笔记比较、PDF 页面预览及 MCP 只读实测。尚未对真实条目执行写入型接口验收。
