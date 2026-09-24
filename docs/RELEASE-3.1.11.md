# ZotQuery 3.1.11

通用模型协议、输出预算和研究历史修复。README 不变；不包含用户模板、报告、研究数据库或 API 密钥。

## 历史打开 / 续跑

- 修复 `DB column 'QueryInterface' not found`。Zotero 返回的是原生数据库行代理，不能像普通对象一样展开；历史列表、会话、运行版本均按查询列显式转换为普通对象。
- 失败、中断、旧版会话和已保存回答继续可读，不需要清空、重建或迁移研究数据库。
- 新运行保存数值化 token 诊断：请求预算、实际预算、输入、输出、思考 token 和错误类别。研究历史的运行版本中可查看；不保存密钥、服务地址、原始错误响应或隐藏思考正文。旧运行未记录的用量仍显示未知。

## 思考强度

- 可选默认、关闭、minimal、low、medium、high、xhigh、max；设置页显示协议映射。
- DeepSeek 官方与兼容网关中的 DeepSeek 模型均识别：minimal → low，medium / xhigh → high，max → max；关闭时不再同时发送启用思考的强度参数。
- 新版 Claude 使用 adaptive thinking + output_config.effort；旧 Claude 使用手动思考预算，始终给正文留空间。
- Gemini 3 使用 thinkingLevel，旧版使用 thinkingBudget；Ollama 的常规思考模型使用开关，gpt-oss 使用命名等级。没有原生细分档位的模型不会因为界面多出选项就获得新能力。
- 模型版本和兼容路由仍可能限制支持的参数；协议测试不等于每个线上模型均已验收。未知兼容模型按兼容协议发送，由服务商明确接受或拒绝。

## 自动输出预算与截断

- 默认保留已有手动设置。启用方法：ZotQuery 设置 → 输出预算模式 →「自动上限 / 自适应」→ 保存。
- 服务商公布单轮输出上限时优先采用；读取目录不发送研究正文、不调用生成。共享上下文容量绝不会被直接当作输出上限，自动模式会用保守字符估计预留输入空间（不是精确 tokenizer 计数）。
- 服务商未公布上限时，从用户设置的起始预算开始；仅在实际用量支持增加预算时进行自适应，每次研究最多增加重试 2 次，客户端安全上限 393216。该安全数值不是任何网关的服务承诺。缺少用量时最多谨慎增加 1 次；明显在请求预算前截断时停止盲目增长。
- 重试会消耗额外 API 用量；max 思考也可能增加耗时和成本。手动模式不自动提高预算。
- 截断的正文不保存为完整回答，截断的工具调用不执行。错误区分输出预算、上下文容量和无法确认的服务商限制，并显示实际返回用量。
- 自动模式遇到明确的上下文容量限制时，每次研究最多从持久化会话恢复一次新对话，要求重新读取原文；不会切断工具协议、删除研究记录，或声称被移出的原文仍在模型上下文中。

## 为什么 65536 仍可能不够

`finish_reason=length` 既可能表示输出达到预算，也可能表示上下文达到容量；兼容网关还可能在更低限额处截断。旧版没有记录用量，因此不能从旧错误判定是哪一种。

2026-09-24 读取 Command Code 公共模型目录时，DeepSeek V4.1 Flash 条目提供了 1000000 的 context_length，但未提供单轮输出上限。GOAT 的套餐用量与模型的单次输出容量不是同一个概念，不能据此把输出设成 1000000 或宣称无限。

对这一路由，可保留 65536 作为自动模式起始预算。需要最高强度时选择 max，而不是 xhigh；若服务商持续提前截断，请提供新版历史中的数值诊断，不要提供密钥。不要为规避截断把未完成内容当成最终答案。

## 验证与边界

离线回归覆盖原生行代理模拟、SQLite 历史读写、失败续跑、强度参数、最大预算元数据、有限重试、上下文恢复、用量展示、工具回传和不执行截断工具。安装包与源码包须进行哈希比对和隐私扫描。

本次未安装或重启 Zotero、未执行付费模型生成、未发布 GitHub；线上实际研究质量和网关是否接受 max 仍需安装后验收。原有版本、个人模板、研究数据库和 README 均保留。

协议参考：

- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Command Code Provider API](https://commandcode.ai/docs/provider)
- [Claude Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Gemini Thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Ollama Thinking](https://docs.ollama.com/capabilities/thinking)
