# ZotQuery 本地 MCP 令牌（3.0.12 候选版）

本版所有 `/zotquery/*` HTTP 接口（包括 `/health` 和 MCP 初始化）都需要 `Authorization: Bearer <token>`。无令牌返回 HTTP 401。旧客户端若只配置 URL，升级后将暂时无法连接；这不是 Research Engine 故障。

首次启动时插件在本机 Zotero 用户偏好中生成随机令牌。打开 ZotQuery 设置页，点击“复制 MCP 令牌”，然后在支持自定义 HTTP 请求头的 MCP 客户端中设置：

```text
URL: http://127.0.0.1:23119/zotquery/mcp
Header name: Authorization
Header value: Bearer <粘贴复制的令牌>
```

不要把真实令牌放进公开的 GitHub 配置、截图、日志或 bug 报告。客户端不支持自定义请求头时，不应通过关闭认证或把端口公开来绕过；需使用能够保密并注入请求头的本地适配层。令牌当前保存在 Zotero 用户偏好中，因此无法抵御已能读取该 profile 的本地进程。怀疑泄露时，在设置页点击“更换 MCP 令牌”；旧令牌立即失效，所有客户端都须更新。

在 PowerShell 中只做健康检查时，可先从设置页复制令牌，再在同一交互会话里执行（不会把令牌字面量写入命令）：

```powershell
$zotQueryToken = Get-Clipboard
Invoke-RestMethod -Uri 'http://127.0.0.1:23119/zotquery/health' -Headers @{ Authorization = "Bearer $zotQueryToken" }
Remove-Variable zotQueryToken
```

HTTP Bearer 令牌只是本机调用门槛，不负责判断 FactRecord 是否科学正确，也不能替代操作系统的 profile 权限和 loopback 绑定。不要在局域网或公网转发 Zotero 本地端口。
