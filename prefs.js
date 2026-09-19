// Default preferences for ZotQuery
// Note: Zotero prefs only support string, int, bool - not float
// minSimilarityPercent is stored as integer (30 = 30% = 0.3)

pref("extensions.zotero.zotquery.minSimilarityPercent", 30);
pref("extensions.zotero.zotquery.topK", 20);
pref("extensions.zotero.zotquery.autoIndex", false);
pref("extensions.zotero.zotquery.autoIndexDelay", 10);

// Index scope: "user" (My Library only) or "all" (all libraries including groups)
pref("extensions.zotero.zotquery.indexScope", "user");

// Indexing mode: "abstract" (title+abstract) or "full" (abstract + PDF sections)
pref("extensions.zotero.zotquery.indexingMode", "abstract");

// PDF chunking options. Both PDF and Note vectors use the active shared model.
// PERFORMANCE: Smaller chunks = faster embedding (~O(n²) attention cost)
// - 7000 tokens: ~45 sec/chunk (too slow!)
// - 800 tokens: ~0.3-0.5 sec/chunk (very fast!)
// Paragraph-level chunking creates many small chunks for precise page location
pref("extensions.zotero.zotquery.maxTokens", 800);
pref("extensions.zotero.zotquery.maxChunksPerPaper", 100);

// Has the index-status column been auto-shown once after installation?
// Used to surface the column the first time the user installs this version
// without re-showing it if they later choose to hide it.
pref("extensions.zotero.zotquery.indexStatusColumn.firstShown", false);

// Item type filtering
// Exclude books from search results (books lack paper sections and are too long to index well)
pref("extensions.zotero.zotquery.excludeBooks", true);

// Hybrid search settings
// Combines semantic search with Zotero's keyword search using Reciprocal Rank Fusion
pref("extensions.zotero.zotquery.hybridSearch.enabled", true);
// Search mode: "hybrid", "semantic", or "keyword"
pref("extensions.zotero.zotquery.hybridSearch.mode", "hybrid");
// Semantic weight (0-100): 50 = equal weight, higher = more semantic, lower = more keyword
// Stored as integer percentage since Zotero prefs don't support floats
pref("extensions.zotero.zotquery.hybridSearch.semanticWeightPercent", 50);
// RRF constant k (typical: 60, from original RRF paper)
pref("extensions.zotero.zotquery.hybridSearch.rrfK", 60);
// Auto-adjust weights based on query analysis
pref("extensions.zotero.zotquery.hybridSearch.autoAdjustWeights", true);

// Dev mode: when true, mounts the self-test harness under Zotero.ZotQuery._selfTest
// Used for autonomous verification via MCP. End users should leave this false.
pref("extensions.zotero.zotquery.devMode", false);

// Retained compatibility preference for the upstream auxiliary search server.
// ZotQuery research tools use the unified local /zotquery/mcp endpoint.
pref("extensions.zotero.zotquery.mcpServer.enabled", false);

// Active shared embedding model (short id from the model registry).
// Vectors for another model remain cached and are filled incrementally.
pref("extensions.zotero.zotquery.embeddingModel", "nomic-embed-text-v1.5");

// ZotQuery Core note indexing
pref("extensions.zotero.zotquery.lneNative.enabled", true);
pref("extensions.zotero.zotquery.lneNative.autoSync", false);
pref("extensions.zotero.zotquery.lneNative.libraryScope", "user");
pref("extensions.zotero.zotquery.lneNative.noteScope", "all");
pref("extensions.zotero.zotquery.lneNative.titlePattern", "");
pref("extensions.zotero.zotquery.lneNative.semantic", true);
pref("extensions.zotero.zotquery.lneNative.semanticTopK", 150);
pref("extensions.zotero.zotquery.lneNative.semanticMinSimilarityPercent", 35);
pref("extensions.zotero.zotquery.lneNative.semanticRelativeDropPercent", 12);
pref("extensions.zotero.zotquery.lneNative.semanticWeightPercent", 50);
pref("extensions.zotero.zotquery.lneNative.embeddingBatchSize", 8);
pref("extensions.zotero.zotquery.lneNative.duplicateStyle", "bar");

// Default presentation for zotquery_research_render. This never changes gates.
pref("extensions.zotero.zotquery.outputProfile", "standard");
