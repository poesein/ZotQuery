# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Context menu items

zotquery-menu-findSimilar = Find Similar Documents
zotquery-menu-openZotQuery = Open ZotQuery...
zotquery-menu-indexSelected = Index Selected for ZotQuery
zotquery-menu-indexCollection = Index Current Collection
zotquery-menu-updateLibrary = Update Library Index
zotquery-menu-removeFromIndex = Remove from ZotQuery Index
zotquery-menu-findRelated = Find Related Documents

## Toolbar

zotquery-toolbar-openZotQuery = Open ZotQuery
zotquery-toolbar-findSimilar = Find Similar Documents

## Preference pane

zotquery-pref-title = ZotQuery
zotquery-pref-indexStatistics = Index Statistics
zotquery-pref-papersIndexed = Papers Indexed
zotquery-pref-totalChunks = Total Chunks
zotquery-pref-storageUsed = Storage Used
zotquery-pref-model = Model:
zotquery-pref-avg = Avg:
zotquery-pref-chunksPerPaper = chunks/paper
zotquery-pref-lastIndexed = Last indexed:
zotquery-pref-refreshStats =
    .label = Refresh Stats
zotquery-pref-compactDatabase =
    .label = Compact Database
zotquery-pref-autoCompact =
    .label = Compact automatically when Zotero is idle
zotquery-pref-autoCompactDesc = Requires Zotero 10 or later. Runs only when there is meaningful space to reclaim and no indexing is in progress.
zotquery-pref-indexModeMismatch = Index Mode Mismatch
zotquery-pref-indexModeMismatchDesc = Your index was built with { $indexedMode } mode, but your current setting is { $currentMode }.
zotquery-pref-indexModeMismatchAction = Click "Rebuild Index" below to apply your new indexing mode setting.
zotquery-pref-indexingMode = Indexing Mode
zotquery-pref-abstractOnly = Abstract only
zotquery-pref-abstractOnlyMenu =
    .label = Abstract only (faster)
zotquery-pref-abstractSpeed = Fast • ~1 chunk per paper
zotquery-pref-abstractDesc = Indexes title + abstract. Good for finding papers by topic.
zotquery-pref-fullPaper = Full paper
zotquery-pref-fullPaperMenu =
    .label = Full paper (more thorough)
zotquery-pref-fullSpeed = Thorough • ~1-2 chunks per page
zotquery-pref-fullDesc = Indexes full PDF content with page numbers. Finds specific passages.
zotquery-pref-mcpServer = AI Agent Access
zotquery-pref-mcpServerLabel =
    .label = Allow AI agents to search your library (local MCP server)
zotquery-pref-mcpServerDesc = Lets MCP clients such as Claude Code run read-only semantic searches over your library. Everything stays on this computer (localhost only).
zotquery-pref-mcpServerUrl = Connect with:
zotquery-pref-mcpServerWarning = Zotero's local HTTP server is disabled. Enable "Allow other applications on this computer to communicate with Zotero" in Settings → Advanced.
zotquery-pref-autoIndexing = Auto-Indexing
zotquery-pref-autoIndexLabel =
    .label = Automatically index new items
zotquery-pref-autoIndexDesc = New papers with PDFs are indexed in the background when added to the selected libraries.
zotquery-pref-delayLabel = Delay before indexing:
zotquery-pref-seconds = seconds
zotquery-pref-delayDesc = Wait this long after the last item is added before starting auto-indexing.
zotquery-pref-indexScope = Index scope
zotquery-pref-indexScopeUser =
 .label = My Library
zotquery-pref-indexScopeAll =
 .label = All libraries
zotquery-pref-indexScopeDesc = Choose which libraries are included when updating or auto-indexing the index.
zotquery-pref-searchSettings = Search Settings
zotquery-pref-resultsToShow = Results to show
zotquery-pref-resultsToShowDesc = How many matches to display (5-100)
zotquery-pref-minSimilarity = Min similarity
zotquery-pref-minSimilarityDesc = % — Filter out low-quality matches (0-100)
zotquery-pref-advancedSettings = Advanced Settings
zotquery-pref-maxTokens = Max tokens per chunk
zotquery-pref-maxTokensDesc = Chunk size ceiling (200-8000)
zotquery-pref-maxChunks = Max chunks per paper
zotquery-pref-maxChunksDesc = Limit for long documents (1-200)
zotquery-pref-excludeBooks =
    .label = Exclude books from indexing
zotquery-pref-excludeBooksDesc = Books lack paper sections and are too long to index well.
zotquery-pref-excludeTag = Exclude tag
zotquery-pref-excludeTagDesc = Items with this tag will be skipped during indexing. Leave empty to disable.
zotquery-pref-actions = Actions
zotquery-pref-updateIndex =
    .label = Update Index
zotquery-pref-recommended = ✓ Recommended
zotquery-pref-updateIndexDesc = Index all unindexed items in the selected libraries. Resumes safely from where you left off.
zotquery-pref-rebuildIndex =
    .label = Rebuild Index
zotquery-pref-rebuildIndexDesc = Clear and re-index all items with current settings. Use after changing indexing mode.
zotquery-pref-clearIndex =
    .label = Clear Index
zotquery-pref-destructive = ⚠ Destructive
zotquery-pref-clearIndexDesc = Remove all embeddings from the database. You will need to re-index afterwards.
zotquery-pref-about = About
zotquery-pref-githubRepo =
    .value = GitHub Repository
zotquery-pref-modelLine = Model: { $model }
zotquery-pref-avgLine = Avg: { $avg } chunks/paper
zotquery-pref-lastIndexedLine = Last indexed: { $date }
zotquery-pref-compacted = Database Compacted
zotquery-pref-compactionFailed = Compaction Failed
zotquery-pref-healthHeader = Database Health
zotquery-pref-healthOrphans = Unresolved embeddings: { $count }
zotquery-pref-healthOrphansDesc = Embeddings whose source items couldn't be matched to your current library. Purging frees space but cannot be undone.
zotquery-pref-healthPurgeOrphans =
    .label = Purge Orphans
zotquery-pref-healthPurgeConfirmTitle = Purge Unresolved Embeddings
zotquery-pref-healthPurgeConfirmMsg = This will permanently delete embeddings for items not found in your current Zotero library. Continue?
zotquery-pref-healthPurgeDoneTitle = Orphans Purged
zotquery-pref-healthPurgeDoneMsg = Removed { $count } unresolved entries.
zotquery-pref-healthPurgeFailedTitle = Purge Failed

## Search dialog

zotquery-search-search =
    .value = Search:
zotquery-search-placeholder =
    .placeholder = Enter your search query (auto-searches as you type)...
zotquery-search-addQuery =
    .label = +
    .tooltiptext = Add another query for AND/OR combination
zotquery-search-searchBtn =
    .label = Search
zotquery-search-and =
    .label = AND
zotquery-search-or =
    .label = OR
zotquery-search-using =
    .value = using
zotquery-search-minimum =
    .label = Minimum
zotquery-search-product =
    .label = Product
zotquery-search-average =
    .label = Average
zotquery-search-andDesc =
    .value = — results must match both queries
zotquery-search-query2 =
    .value = Query 2:
zotquery-search-query3 =
    .value = Query 3:
zotquery-search-query4 =
    .value = Query 4:
zotquery-search-enterQuery = Enter query { $n }...
zotquery-search-removeQuery =
    .label = ✕
    .tooltiptext = Remove this query
zotquery-search-mode =
    .value = Mode:
zotquery-search-modeHybrid =
    .label = 🔗 Hybrid (Recommended)
zotquery-search-modeSemantic =
    .label = 🧠 Semantic Only
zotquery-search-modeKeyword =
    .label = 🔤 Keyword Only
zotquery-search-modeDesc =
    .value = Match type: 🔗 both searches · 🧠 AI match · 🔤 keyword match
zotquery-search-results =
    .value = Results:
zotquery-search-bySection = By Section
zotquery-search-byLocation = By Location (exact page & paragraph)
zotquery-search-settings =
    .label = ⚙ Settings
    .tooltiptext = Open ZotQuery preferences
zotquery-search-openSelected =
    .label = Open Selected
zotquery-search-close =
    .label = Close
zotquery-search-initializing = Initializing search...
zotquery-search-hybrid = Hybrid
zotquery-search-semantic = Semantic
zotquery-search-keyword = Keyword
zotquery-search-loadingModel = Loading AI model (first time may take a moment)...
zotquery-search-finding = { $mode } search: Finding items...
zotquery-search-findingMulti = { $mode } search ({ $op }): Finding items...
zotquery-search-noItemsFound = No items found
zotquery-search-showInLibrary = Show in Library
zotquery-search-showItemsInLibrary = Show { $count } Items in Library
zotquery-search-addToCollection = Add to Collection
zotquery-search-noCollections = No collections
zotquery-search-moreCollections = ... and { $count } more
zotquery-search-foundItems = Found { $count } items
zotquery-search-foundItemsFromMatches = Found { $count } items (from { $matches } matches)
zotquery-search-foundItemsQuery = Found { $count } items ({ $query })
zotquery-search-searching = Searching...
zotquery-search-searchLabel = Search
zotquery-search-searchingMoment = Searching in a moment...
zotquery-search-failed = Search failed: { $error }
zotquery-search-noItemsMatchingAll = No items found matching all queries
zotquery-search-matchBoth = — results must match both queries
zotquery-search-matchAll = — results must match all queries
zotquery-search-matchAny = — results can match any query

## Results table columns

zotquery-column-match = Match
zotquery-column-title = Title
zotquery-column-authors = Authors
zotquery-column-year = Year
zotquery-column-location = Location
zotquery-column-section = Section

## Source labels

zotquery-source-abstract = Abstract
zotquery-source-fulltext = Full Text
zotquery-source-title = Title
zotquery-source-methods = Methods
zotquery-source-results = Results
zotquery-source-content = Content
zotquery-search-hybrid-menuitem =
    .label = 🔗 Hybrid (Recommended)
zotquery-search-semantic-menuitem =
    .label = 🧠 Semantic Only
zotquery-search-keyword-menuitem =
    .label = 🔤 Keyword Only

## Similar documents dialog

zotquery-similar-title =
    .title = Find Similar Documents
zotquery-similar-similarTo = Similar to:{ " " }
zotquery-similar-loading = Loading...
zotquery-similar-openSelected =
    .label = Open Selected
zotquery-similar-close =
    .label = Close
zotquery-similar-initFailed = Failed to initialize: { $error }
zotquery-similar-noSource = No source document selected
zotquery-similar-finding = Finding similar documents...
zotquery-similar-loadingModel = Loading AI model...
zotquery-similar-searching = Searching...
zotquery-similar-noResults = No similar documents found
zotquery-similar-found = Found { $count } similar documents
zotquery-similar-searchFailed = Search failed: { $error }

## Indexing progress

zotquery-indexing-title = ZotQuery Indexing
zotquery-indexing-clearTitle = Clearing ZotQuery Index
zotquery-indexing-clearConfirmTitle = Clear ZotQuery Index
zotquery-indexing-clearConfirmMsg = This will delete all stored embeddings. You will need to re-index your library.

    Continue?
zotquery-indexing-initStorage = Initializing storage...
zotquery-indexing-deletingAll = Deleting all embeddings...
zotquery-indexing-clearedSuccess = Index cleared successfully!
zotquery-indexing-clearedMsg = Index cleared successfully.

    You can now re-index your library.
zotquery-indexing-rebuildTitle = Rebuild ZotQuery Index
zotquery-indexing-rebuildConfirmTitle = Rebuild ZotQuery Index
zotquery-indexing-rebuildConfirmMsg = This will delete all stored embeddings and rebuild the index with your current settings.

    This may take several minutes depending on library size.

    Continue?
zotquery-indexing-rebuildingTitle = Rebuilding ZotQuery Index
zotquery-indexing-clearingExisting = Clearing existing index...
zotquery-indexing-existingCleared = ✓ Existing index cleared
zotquery-indexing-loading = Loading...
zotquery-indexing-alreadyInProgress = Indexing already in progress...
zotquery-indexing-selectItems = Please select items to index.
zotquery-indexing-selectCollection = Please select a collection first.

    (Click on a collection in the left sidebar)
zotquery-indexing-emptyCollection = Collection "{ $name }" has no items to index.
zotquery-indexing-emptyCollections = The { $count } selected collections have no items to index.
zotquery-indexing-updateTitle = ZotQuery - Update Library Index
zotquery-indexing-updateConfirmMsg = This will index all unindexed items in { $scope } for semantic search.
zotquery-indexing-scopeUser = your personal library
zotquery-indexing-scopeAll = all your libraries (personal + groups)

# Auto-resume prompt shown at startup when a previous bulk-index run was interrupted.
zotquery-resume-title = ZotQuery - Resume Indexing
zotquery-resume-message = A previous indexing run was interrupted. { $count } item(s) in { $scope } are still pending. Resume now?
zotquery-resume-scopeLibrary = your libraries
zotquery-resume-scopeUserLibrary = your personal library
zotquery-resume-scopeCollection = the "{ $name }" collection
zotquery-resume-scopeCollections = { $count } selected collections

    Items that are already indexed will be skipped.

    This may take several minutes depending on the number of new items.

    Continue?
zotquery-indexing-noItemsSelected = No items selected
zotquery-indexing-removedItems = Removed { $count } item(s) from index
zotquery-indexing-notInIndex = Selected items were not in the index
zotquery-indexing-removeFailed = Failed to remove from index
zotquery-indexing-mode = Indexing mode: { $mode }
zotquery-indexing-checking = Checking for already-indexed items...
zotquery-indexing-skippedExcluded = ✓ Skipped { $count } excluded items (tag)
zotquery-indexing-skippedIndexed = ✓ Skipped { $count } already-indexed items
zotquery-indexing-allIndexed = All items already indexed!
zotquery-indexing-allInIndex = ✓ { $count } items already in index
zotquery-indexing-nothingToIndex = Nothing to index — all items are up to date!
zotquery-indexing-loadingModel = Loading AI model (Transformers.js)...
zotquery-indexing-modelLoaded = ✓ AI model loaded
zotquery-indexing-batchExtracting = Batch { $current }/{ $total }: Extracting text...
zotquery-indexing-batchEmbedding = Batch { $current }/{ $total }: Generating embeddings...
zotquery-indexing-batchEmbeddingChunks = Batch { $current }/{ $total }: Embedding chunks
zotquery-indexing-chunksFailed = ⚠ { $count } chunks skipped in: { $items }
zotquery-indexing-batchSaving = Batch { $current }/{ $total }: Saving checkpoint...
zotquery-indexing-checkpoint = ✓ Checkpoint { $current }/{ $total }: { $items } items, { $chunks } chunks saved
zotquery-indexing-complete = Indexing Complete!
zotquery-indexing-completeMode = ✓ Mode: { $mode }
zotquery-indexing-completePrevious = ✓ Previously indexed: { $count } items
zotquery-indexing-completeNew = ✓ Newly indexed: { $count } items
zotquery-indexing-completeChunks = ✓ Total chunks: { $count }
zotquery-indexing-completeAvg = ✓ Avg chunks/item: { $avg }
zotquery-indexing-completeDuration = ✓ Duration: { $duration }
zotquery-indexing-completeNoContent = ⚠ No content: { $count } items
zotquery-indexing-completeTruncated = ⚠ Partial content: { $count } item(s) hit the Max Chunks per Paper limit. Raise the limit or switch to Summary mode to index the full text.
zotquery-indexing-completeSuccess = Indexing completed successfully!
zotquery-indexing-cancelled = Indexing cancelled
zotquery-indexing-failed = Indexing failed: { $error }
zotquery-indexing-progressTitle = ZotQuery
zotquery-indexing-progressItem = Indexing: { $title }
zotquery-indexing-progressLoadingModel = Loading model...
zotquery-indexing-allExcluded = All items excluded by tag
zotquery-indexing-extracting = Extracting...
zotquery-indexing-noContent = ✗ No content found
zotquery-indexing-embedding = Embedding { $current }/{ $total }...
zotquery-indexing-saving = Saving...
zotquery-indexing-chunksIndexed = ✓ { $count } chunks indexed
zotquery-indexing-chunksIndexedWithFailed = ✓ { $count } chunks indexed ({ $failed } failed)

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

## Preference group headers

zotquery-prefs-group-status = Status
zotquery-prefs-group-models = Models
zotquery-prefs-group-indexing = Indexing
zotquery-prefs-group-search = Search
zotquery-prefs-group-maintenance = Integrations & Maintenance
zotquery-prefs-exclusions = Exclusions

## Model section headers (fallbacks existed in XHTML only; adds the missing ftl entries)

zotquery-pref-embeddingModelTitle = Embedding Model
zotquery-pref-manageModelsTitle = Manage downloaded models
