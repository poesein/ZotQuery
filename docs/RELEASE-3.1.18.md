# ZotQuery 3.1.18

增加供网页 ChatGPT 私人使用的只读 MCP 证据连接基础：

- 新增受本机 Bearer 令牌保护的 `/zotquery/bridge-read`。只允许分页列出研究记录、台账、FactRecord、证据位置、上下文、已保存页图元数据，以及按明确授权读取已保存页图。无任意 SQL、URL、文件路径或写操作参数。
- ChatGPT 预览证据不会改变研究会话的 `listed_at`、`context_read_at`、核验状态或 FactRecord；原有研究工具仍照常登记真实读取。
- 附带无额外 npm 依赖的 stdio MCP 适配器。仅从当前进程环境接收 ZotQuery 本机令牌；默认只暴露六个只读工具，页图工具需额外开启。未知工具与超范围分页在转发前拒绝，大响应明确报错而非静默截断。
- 独立连接说明见 `docs/CHATGPT-PRIVATE-MCP.md`。没有把任何个人模板、研究数据库、密钥或 PDF 纳入分发包；README 保持原样。

验证：本机离线回归 119/119 通过；隐私扫描 0 命中；桥接器与模拟本机服务完成 MCP 初始化、工具发现、读取、错误拒绝测试。未安装或配置 OpenAI `tunnel-client`，也未连接用户的 ChatGPT 工作区，因此**不把离线测试称为网页端实测成功**。真实连接需要用户在自己的工作区完成 tunnel 权限、凭据和开发者模式设置。网页端产生的回答暂不自动写回 ZotQuery 历史。
