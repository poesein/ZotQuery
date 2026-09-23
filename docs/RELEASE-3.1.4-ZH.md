# ZotQuery 3.1.4

- 修复选择 `.md` 文件后仍提示“请选择 .md Markdown 模板”：Zotero FilePicker 返回路径字符串，现同时支持字符串与原生 nsIFile 对象。
- 同步修复 Markdown 报告保存的路径读取；取消选择不修改配置或写入文件。
- 输出模板改为可选。未导入时可直接通过 API 调用模型完成研究和 Markdown 输出；导入时才使用自定义模板全文。证据门禁仍然有效。
- 已选择但丢失或不可读的模板会提示重新导入或清除选择；清除后可直接无模板生成。
- 工具栏图标显示尺寸为 16×16 CSS 像素，按钮为 28×28，继续使用 ZotQuery 插件图标；工作台左上角图标保持 40×40。
- 源码和安装包继续排除私人 Markdown 模板，不改动用户原始模板及旧版包。

接口依据：本机 Zotero 的 `chrome/content/zotero/modules/filePicker.mjs` 中 `file` 属性将 nsIFile 转换为 `.path` 字符串；`toolbarbutton.js` 使用 `.toolbarbutton-icon` 子元素。

验证包括文件选择真实入口模拟（字符串、nsIFile、中文路径、取消和覆盖保存）、有/无模板模型代理与证据门禁、已有凭据/工作台/原文链接回归，以及压缩包完整性与模板排除检查。尚未安装到运行中的 Zotero 执行真实 API 请求或界面验收。
