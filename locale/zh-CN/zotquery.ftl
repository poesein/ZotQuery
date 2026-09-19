# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Context menu items

zotquery-menu-findSimilar = 查找相似文献
zotquery-menu-openZotQuery = 打开 ZotQuery...
zotquery-menu-indexSelected = 为 ZotQuery 索引选中项
zotquery-menu-indexCollection = 索引当前合集
zotquery-menu-updateLibrary = 更新文献库索引
zotquery-menu-removeFromIndex = 从 ZotQuery 索引中移除
zotquery-menu-findRelated = 查找相关文献

## Toolbar

zotquery-toolbar-openZotQuery = 打开 ZotQuery
zotquery-toolbar-findSimilar = 查找相似文献

## Preference pane

zotquery-pref-title = ZotQuery
zotquery-pref-indexStatistics = 索引统计
zotquery-pref-papersIndexed = 已索引文献
zotquery-pref-totalChunks = 总分块数
zotquery-pref-storageUsed = 存储占用
zotquery-pref-model = 模型：
zotquery-pref-avg = 平均：
zotquery-pref-chunksPerPaper = 分块/文献
zotquery-pref-lastIndexed = 上次索引：
zotquery-pref-refreshStats =
    .label = 刷新统计
zotquery-pref-compactDatabase =
    .label = 压缩数据库
zotquery-pref-autoCompact =
    .label = Zotero 空闲时自动压缩
zotquery-pref-autoCompactDesc = 需要 Zotero 10 或更高版本。仅在有足够可回收空间且没有索引任务进行时运行。
zotquery-pref-indexModeMismatch = 索引模式不匹配
zotquery-pref-indexModeMismatchDesc = 您的索引是使用{ $indexedMode }模式构建的，但当前设置为{ $currentMode }。
zotquery-pref-indexModeMismatchAction = 点击下方"重建索引"以应用新的索引模式设置。
zotquery-pref-indexingMode = 索引模式
zotquery-pref-abstractOnly = 仅摘要
zotquery-pref-abstractOnlyMenu =
    .label = 仅摘要（更快）
zotquery-pref-abstractSpeed = 快速 • 每篇文献约1个分块
zotquery-pref-abstractDesc = 索引标题和摘要。适合按主题查找文献。
zotquery-pref-fullPaper = 全文
zotquery-pref-fullPaperMenu =
    .label = 全文（更彻底）
zotquery-pref-fullSpeed = 彻底 • 每页1-2个分块
zotquery-pref-fullDesc = 索引完整PDF内容及页码。可查找特定段落。
zotquery-pref-mcpServer = AI 智能体访问
zotquery-pref-mcpServerLabel =
    .label = 允许 AI 智能体搜索您的文献库（本地 MCP 服务器）
zotquery-pref-mcpServerDesc = 让 Claude Code 等 MCP 客户端对您的文献库进行只读语义搜索。所有数据均保留在本机（仅限 localhost）。
zotquery-pref-mcpServerUrl = 连接方式：
zotquery-pref-mcpServerWarning = Zotero 的本地 HTTP 服务器已禁用。请在“设置 → 高级”中启用“允许本机上的其他应用程序与 Zotero 通信”。
zotquery-pref-autoIndexing = 自动索引
zotquery-pref-autoIndexLabel =
    .label = 自动索引新条目
zotquery-pref-autoIndexDesc = 添加到所选文献库的新文献将在后台自动索引。
zotquery-pref-delayLabel = 索引前延迟：
zotquery-pref-seconds = 秒
zotquery-pref-delayDesc = 添加最后一个条目后等待这么长时间再开始自动索引。
zotquery-pref-indexScope = 索引范围
zotquery-pref-indexScopeUser =
 .label = 我的文献库
zotquery-pref-indexScopeAll =
 .label = 所有文献库
zotquery-pref-indexScopeDesc = 选择更新索引或自动索引时包含哪些文献库。
zotquery-pref-searchSettings = 搜索设置
zotquery-pref-resultsToShow = 显示结果数
zotquery-pref-resultsToShowDesc = 显示多少个匹配结果（5-100）
zotquery-pref-minSimilarity = 最低相似度
zotquery-pref-minSimilarityDesc = % — 过滤低质量匹配（0-100）
zotquery-pref-advancedSettings = 高级设置
zotquery-pref-maxTokens = 每分块最大令牌数
zotquery-pref-maxTokensDesc = 分块大小上限（200-8000）
zotquery-pref-maxChunks = 每篇文献最大分块数
zotquery-pref-maxChunksDesc = 长文档限制（1-200）
zotquery-pref-excludeBooks =
    .label = 排除书籍
zotquery-pref-excludeBooksDesc = 书籍缺乏论文结构且太长，不适合索引。
zotquery-pref-excludeTag = 排除标签
zotquery-pref-excludeTagDesc = 带有此标签的条目将在索引时被跳过。留空以禁用。
zotquery-pref-actions = 操作
zotquery-pref-updateIndex =
    .label = 更新索引
zotquery-pref-recommended = ✓ 推荐
zotquery-pref-updateIndexDesc = 索引所选文献库中所有未索引的条目。可从上次中断处安全恢复。
zotquery-pref-rebuildIndex =
    .label = 重建索引
zotquery-pref-rebuildIndexDesc = 清除并使用当前设置重新索引所有条目。更改索引模式后使用。
zotquery-pref-clearIndex =
    .label = 清除索引
zotquery-pref-destructive = ⚠ 有破坏性
zotquery-pref-clearIndexDesc = 从数据库中删除所有嵌入向量。之后需要重新索引。
zotquery-pref-about = 关于
zotquery-pref-githubRepo =
    .value = GitHub 仓库
zotquery-pref-modelLine = 模型：{ $model }
zotquery-pref-avgLine = 平均：{ $avg } 分块/文献
zotquery-pref-lastIndexedLine = 上次索引：{ $date }
zotquery-pref-compacted = 数据库已压缩
zotquery-pref-compactionFailed = 压缩失败
zotquery-pref-healthHeader = 数据库健康
zotquery-pref-healthOrphans = 未解析的嵌入：{ $count }
zotquery-pref-healthOrphansDesc = 这些嵌入对应的项目无法与当前 Zotero 库匹配。清理可释放空间，但操作不可撤销。
zotquery-pref-healthPurgeOrphans =
    .label = 清理孤立项
zotquery-pref-healthPurgeConfirmTitle = 清理未解析的嵌入
zotquery-pref-healthPurgeConfirmMsg = 这将永久删除在当前 Zotero 库中找不到的项目嵌入。是否继续？
zotquery-pref-healthPurgeDoneTitle = 孤立项已清理
zotquery-pref-healthPurgeDoneMsg = 已移除 { $count } 个未解析的条目。
zotquery-pref-healthPurgeFailedTitle = 清理失败

## Search dialog

zotquery-search-search =
    .value = 搜索：
zotquery-search-placeholder =
    .placeholder = 输入搜索查询（输入时自动搜索）...
zotquery-search-addQuery =
    .label = +
    .tooltiptext = 添加查询以进行AND/OR组合
zotquery-search-searchBtn =
    .label = 搜索
zotquery-search-and =
    .label = AND
zotquery-search-or =
    .label = OR
zotquery-search-using =
    .value = 使用
zotquery-search-minimum =
    .label = 最小值
zotquery-search-product =
    .label = 乘积
zotquery-search-average =
    .label = 平均值
zotquery-search-andDesc =
    .value = — 结果必须匹配两个查询
zotquery-search-query2 =
    .value = 查询 2：
zotquery-search-query3 =
    .value = 查询 3：
zotquery-search-query4 =
    .value = 查询 4：
zotquery-search-enterQuery = 输入查询 { $n }...
zotquery-search-removeQuery =
    .label = ✕
    .tooltiptext = 删除此查询
zotquery-search-mode =
    .value = 模式：
zotquery-search-modeHybrid =
    .label = 🔗 混合（推荐）
zotquery-search-modeSemantic =
    .label = 🧠 仅语义
zotquery-search-modeKeyword =
    .label = 🔤 仅关键词
zotquery-search-modeDesc =
    .value = 匹配类型：🔗 两种搜索 · 🧠 AI匹配 · 🔤 关键词匹配
zotquery-search-results =
    .value = 结果：
zotquery-search-bySection = 按章节
zotquery-search-byLocation = 按位置（精确页码和段落）
zotquery-search-settings =
    .label = ⚙ 设置
    .tooltiptext = 打开 ZotQuery 设置
zotquery-search-openSelected =
    .label = 打开选中项
zotquery-search-close =
    .label = 关闭
zotquery-search-initializing = 正在初始化搜索...
zotquery-search-hybrid = 混合
zotquery-search-semantic = 语义
zotquery-search-keyword = 关键词
zotquery-search-loadingModel = 正在加载AI模型（首次可能需要稍等）...
zotquery-search-finding = { $mode }搜索：正在查找...
zotquery-search-findingMulti = { $mode }搜索（{ $op }）：正在查找...
zotquery-search-noItemsFound = 未找到条目
zotquery-search-showInLibrary = 在文献库中显示
zotquery-search-showItemsInLibrary = 在文献库中显示 { $count } 个条目
zotquery-search-addToCollection = 添加到合集
zotquery-search-noCollections = 无合集
zotquery-search-moreCollections = ... 及其他 { $count } 个
zotquery-search-foundItems = 找到 { $count } 个条目
zotquery-search-foundItemsFromMatches = 找到 { $count } 个条目（来自 { $matches } 个匹配）
zotquery-search-foundItemsQuery = 找到 { $count } 个条目（{ $query }）
zotquery-search-searching = 搜索中...
zotquery-search-searchLabel = 搜索
zotquery-search-searchingMoment = 即将搜索...
zotquery-search-failed = 搜索失败：{ $error }
zotquery-search-noItemsMatchingAll = 未找到匹配所有查询的条目
zotquery-search-matchBoth = — 结果必须匹配两个查询
zotquery-search-matchAll = — 结果必须匹配所有查询
zotquery-search-matchAny = — 结果可匹配任一查询

## Results table columns

zotquery-column-match = 匹配
zotquery-column-title = 标题
zotquery-column-authors = 作者
zotquery-column-year = 年份
zotquery-column-location = 位置
zotquery-column-section = 章节

## Source labels

zotquery-source-abstract = 摘要
zotquery-source-fulltext = 全文
zotquery-source-title = 标题
zotquery-source-methods = 方法
zotquery-source-results = 结果
zotquery-source-content = 内容
zotquery-search-hybrid-menuitem =
    .label = 🔗 混合（推荐）
zotquery-search-semantic-menuitem =
    .label = 🧠 仅语义
zotquery-search-keyword-menuitem =
    .label = 🔤 仅关键词

## Similar documents dialog

zotquery-similar-title =
    .title = 查找相似文献
zotquery-similar-similarTo = 相似于：{ " " }
zotquery-similar-loading = 加载中...
zotquery-similar-openSelected =
    .label = 打开选中项
zotquery-similar-close =
    .label = 关闭
zotquery-similar-initFailed = 初始化失败：{ $error }
zotquery-similar-noSource = 未选择源文献
zotquery-similar-finding = 正在查找相似文献...
zotquery-similar-loadingModel = 正在加载AI模型...
zotquery-similar-searching = 搜索中...
zotquery-similar-noResults = 未找到相似文献
zotquery-similar-found = 找到 { $count } 篇相似文献
zotquery-similar-searchFailed = 搜索失败：{ $error }

## Indexing progress

zotquery-indexing-title = ZotQuery 索引
zotquery-indexing-clearTitle = 正在清除 ZotQuery 索引
zotquery-indexing-clearConfirmTitle = 清除 ZotQuery 索引
zotquery-indexing-clearConfirmMsg = 这将删除所有存储的嵌入向量。您需要重新索引文献库。

    继续？
zotquery-indexing-initStorage = 正在初始化存储...
zotquery-indexing-deletingAll = 正在删除所有嵌入向量...
zotquery-indexing-clearedSuccess = 索引已成功清除！
zotquery-indexing-clearedMsg = 索引已成功清除。

    您现在可以重新索引文献库。
zotquery-indexing-rebuildTitle = 重建 ZotQuery 索引
zotquery-indexing-rebuildConfirmTitle = 重建 ZotQuery 索引
zotquery-indexing-rebuildConfirmMsg = 这将删除所有存储的嵌入向量并使用当前设置重建索引。

    根据文献库大小，这可能需要几分钟。

    继续？
zotquery-indexing-rebuildingTitle = 正在重建 ZotQuery 索引
zotquery-indexing-clearingExisting = 正在清除现有索引...
zotquery-indexing-existingCleared = ✓ 现有索引已清除
zotquery-indexing-loading = 加载中...
zotquery-indexing-alreadyInProgress = 索引已在进行中...
zotquery-indexing-selectItems = 请选择要索引的条目。
zotquery-indexing-selectCollection = 请先选择一个合集。

    （在左侧边栏中点击一个合集）
zotquery-indexing-emptyCollection = 合集"{ $name }"没有可索引的条目。
zotquery-indexing-emptyCollections = 选定的 { $count } 个合集没有可索引的条目。
zotquery-indexing-updateTitle = ZotQuery - 更新文献库索引
zotquery-indexing-updateConfirmMsg = 这将为{ $scope }中未索引的条目建立语义搜索索引。
zotquery-indexing-scopeUser = 您的个人文献库
zotquery-indexing-scopeAll = 您的所有文献库（个人 + 群组）

# 启动时检测到先前中断的索引任务时显示的恢复提示。
zotquery-resume-title = ZotQuery - 恢复索引
zotquery-resume-message = 上一次索引被中断。{ $scope }中仍有 { $count } 个条目待处理。现在恢复？
zotquery-resume-scopeLibrary = 您的所有文献库
zotquery-resume-scopeUserLibrary = 您的个人文献库
zotquery-resume-scopeCollection = "{ $name }" 收藏夹
zotquery-resume-scopeCollections = 选定的 { $count } 个合集

    已索引的条目将被跳过。

    根据新条目数量，这可能需要几分钟。

    继续？
zotquery-indexing-noItemsSelected = 未选择条目
zotquery-indexing-removedItems = 已从索引中移除 { $count } 个条目
zotquery-indexing-notInIndex = 选中的条目不在索引中
zotquery-indexing-removeFailed = 从索引中移除失败
zotquery-indexing-mode = 索引模式：{ $mode }
zotquery-indexing-checking = 正在检查已索引的条目...
zotquery-indexing-skippedExcluded = ✓ 跳过 { $count } 个已排除条目（标签）
zotquery-indexing-skippedIndexed = ✓ 跳过 { $count } 个已索引条目
zotquery-indexing-allIndexed = 所有条目已索引！
zotquery-indexing-allInIndex = ✓ { $count } 个条目已在索引中
zotquery-indexing-nothingToIndex = 无需索引 — 所有条目均已是最新！
zotquery-indexing-loadingModel = 正在加载AI模型（Transformers.js）...
zotquery-indexing-modelLoaded = ✓ AI模型已加载
zotquery-indexing-batchExtracting = 批次 { $current }/{ $total }：正在提取文本...
zotquery-indexing-batchEmbedding = 批次 { $current }/{ $total }：正在生成嵌入向量...
zotquery-indexing-batchEmbeddingChunks = 批次 { $current }/{ $total }：嵌入分块
zotquery-indexing-chunksFailed = ⚠ { $count } 个分块已跳过：{ $items }
zotquery-indexing-batchSaving = 批次 { $current }/{ $total }：正在保存检查点...
zotquery-indexing-checkpoint = ✓ 检查点 { $current }/{ $total }：{ $items } 个条目，{ $chunks } 个分块已保存
zotquery-indexing-complete = 索引完成！
zotquery-indexing-completeMode = ✓ 模式：{ $mode }
zotquery-indexing-completePrevious = ✓ 先前已索引：{ $count } 个条目
zotquery-indexing-completeNew = ✓ 新索引：{ $count } 个条目
zotquery-indexing-completeChunks = ✓ 总分块数：{ $count }
zotquery-indexing-completeAvg = ✓ 平均分块/条目：{ $avg }
zotquery-indexing-completeDuration = ✓ 时长：{ $duration }
zotquery-indexing-completeNoContent = ⚠ 无内容：{ $count } 个条目
zotquery-indexing-completeTruncated = ⚠ 部分内容：{ $count } 个条目达到每篇最大分块数限制。请提高限制或切换至摘要模式以索引完整文本。
zotquery-indexing-completeSuccess = 索引已成功完成！
zotquery-indexing-cancelled = 索引已取消
zotquery-indexing-failed = 索引失败：{ $error }
zotquery-indexing-progressTitle = ZotQuery
zotquery-indexing-progressItem = 正在索引：{ $title }
zotquery-indexing-progressLoadingModel = 正在加载模型...
zotquery-indexing-allExcluded = 所有条目均已按标签排除
zotquery-indexing-extracting = 正在提取...
zotquery-indexing-noContent = ✗ 未找到内容
zotquery-indexing-embedding = 嵌入 { $current }/{ $total }...
zotquery-indexing-saving = 正在保存...
zotquery-indexing-chunksIndexed = ✓ { $count } 个分块已索引
zotquery-indexing-chunksIndexedWithFailed = ✓ { $count } 个分块已索引（{ $failed } 个失败）

## Export to Collection (issue #28)

# Keys referenced via data-l10n-id on XUL elements use the .attr = value form
# so Fluent sets the named attribute instead of wiping the element's children.
# Keys consumed via formatValueSync / getString() from JS stay as plain key = text.

zotquery-export-saveAsCollection =
    .label = Save Results as Collection
zotquery-export-addToCollectionNew =
    .label = New collection...
zotquery-export-dialogTitle =
    .title = Save Results as Collection
zotquery-export-nameLabel =
    .value = Collection name:
zotquery-export-libraryLabel =
    .value = Library:
zotquery-export-ok =
    .label = Save
zotquery-export-cancel =
    .label = Cancel
zotquery-export-itemcountSimple = { $count } items → { $destination }
zotquery-export-itemcountFiltered = { $kept } of { $total } items → { $destination } ({ $reasons })
zotquery-export-reasonOtherLibrary = { $count } in other libraries
zotquery-export-reasonDeleted = { $count } deleted
zotquery-export-itemcountEmpty = No items to add.
zotquery-export-statusExported = Added { $count } items to "{ $name }".
zotquery-export-statusExportedSkipped = Added { $count } items to "{ $name }", { $skipped } skipped.
zotquery-export-statusFailed = Failed to save results as collection.
