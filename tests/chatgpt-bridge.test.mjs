import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import http from "node:http";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(new URL("../content/scripts/research-engine.js", import.meta.url), "utf8");
const generationSchema = JSON.parse(fs.readFileSync(new URL("../content/profiles/generation/strawberry-vnext-depth.schema.json", import.meta.url), "utf8"));
const bridgeGenerationSchema = JSON.parse(fs.readFileSync(new URL("../bridge/strawberry-vnext-depth.schema.json", import.meta.url), "utf8"));
const toolContract = JSON.parse(fs.readFileSync(new URL("../bridge/tool-contracts.json", import.meta.url), "utf8"));

test("native and bridge expose the same exact generation schema", () => {
  assert.deepEqual(bridgeGenerationSchema, generationSchema);
  assert.ok(generationSchema.properties.causalTests.properties.rescue);
  assert.ok(generationSchema.properties.fullTextRead.properties.chunks.items.properties.nextOffset.type.includes("null"));
});

test("previewing positions and saved PDF context does not mutate coverage", async () => {
  const writes = [];
  const saved = { before: 2, chunks: [{ target: true, text: "Original PDF passage" }] };
  const position = {
    position_id: "p1", session_id: "s1", source: "pdf", library_key: "user", item_key: "PARENT01",
    work_key: "user:PARENT01", title: "Paper", page_number: 3, chunk_index: 8,
    coverage_required: 1, source_context_json: JSON.stringify(saved), evidence_hint: null,
  };
  const context = {
    Zotero: { DB: {
      valueQueryAsync: async () => 1,
      queryAsync: async sql => {
        if (/^UPDATE/i.test(sql)) { writes.push(sql); return []; }
        if (sql.includes("SELECT * FROM") && sql.includes("position_id=?")) return [position];
        if (sql.includes("SELECT * FROM")) return [position];
        return [];
      },
    } },
    ensureResearchSchema: async () => {}, RDB: "research", now: () => "time",
    num: (value, fallback) => value == null ? fallback : Number(value),
    jsonObject: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } },
    sourceLinks: async () => ({ pdfPage: "zotero://open-pdf/library/items/PDFKEY01?page=3" }),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("async function positions("), source.indexOf("async function promoteContextChunk(")) +
    "\nthis.listPositions = positions; this.readContext = positionContext;", context);
  const listed = await context.listPositions("s1", { markListed: false });
  assert.equal(listed.results.length, 1);
  const read = await context.readContext("p1", { recordRead: false });
  assert.equal(read.chunks[0].text, "Original PDF passage");
  assert.equal(writes.length, 0);
  await context.listPositions("s1");
  await context.readContext("p1");
  assert.equal(writes.length, 2, "normal research operations still record listing and reading");
});

test("bridge endpoint dispatch is session-scoped and has no write action", async () => {
  let listOptions, contextOptions, checked;
  const state = {
    Zotero: { ZotQueryHistory: { list: async args => ({ args }) }, ZotQueryVision: { list: async () => ({ results: [] }) }, Prefs: { get: () => false } },
    num: (value, fallback) => value == null ? fallback : Number(value),
    sessionLedger: async id => ({ sessionId: id, synthesisAllowed: false }),
    bridgeFacts: async id => ({ sessionId: id }),
    positions: async (_id, options) => { listOptions = options; return { results: [] }; },
    validateSessionScope: async (id, args) => { checked = { id, ...args }; },
    positionContext: async (_id, options) => { contextOptions = options; return { source: "pdf" }; },
  };
  vm.createContext(state);
  vm.runInContext(source.slice(source.indexOf("async function bridgeRead("), source.indexOf("async function nextActions(")) +
    "\nthis.read = bridgeRead;", state);
  assert.equal((await state.read({ action: "sessions" })).args.limit, 20);
  await state.read({ action: "positions", sessionId: "s1" });
  assert.equal(listOptions.markListed, false);
  await state.read({ action: "context", sessionId: "s1", positionId: "p1" });
  assert.equal(checked.id, "s1");
  assert.equal(checked.positionId, "p1");
  assert.equal(contextOptions.recordRead, false);
  await assert.rejects(state.read({ action: "review", sessionId: "s1" }), /Unknown read-only bridge action/);
  await assert.rejects(state.read({ action: "saved_image", sessionId: "s1", visualId: "v1" }), /disabled/);
});

test("answer and PDF reads stay scoped, paginated and free of research writes", async () => {
  const sql = [];
  const state = {
    RDB: "research", DB: "index", activeModel: () => "model", sessionLedger: async id => ({ sessionId: id }),
    num: (value, fallback) => value == null ? fallback : Number(value),
    Zotero: { DB: {
      valueQueryAsync: async statement => { sql.push(statement); return 1; },
      queryAsync: async statement => {
        sql.push(statement);
        if (statement.includes("SELECT run_id,created_at")) return [{ run_id: "run1", answer_chars: 8 }];
        if (statement.includes("SUBSTR(markdown")) return [{ status: "complete", total_chars: 8, answer_text: "Answer 1" }];
        if (statement.includes("GROUP BY work_key")) return [{ work_key: "user:ITEM", title: "Paper", library_key: "user", item_key: "ITEM", evidence_positions: 1 }];
        if (statement.includes("SELECT library_key,item_key,title")) return [{ library_key: "user", item_key: "ITEM", title: "Paper" }];
        if (statement.includes("SELECT chunk_index,chunk_text")) return [{ chunk_index: 2, chunk_text: "Original fact in PDF", page_number: 3 }];
        return [];
      },
    } },
  };
  vm.createContext(state);
  vm.runInContext(source.slice(source.indexOf("async function bridgeAnswers("), source.indexOf("async function bridgeRead(")) +
    "\nthis.answers=bridgeAnswers;this.answer=bridgeAnswerChunk;this.documents=bridgeDocuments;this.chunks=bridgeDocumentChunks;this.search=bridgeSearchDocument;", state);
  assert.equal((await state.answers("s1")).results[0].runId, "run1");
  assert.equal((await state.answer("s1", { runId: "run1" })).text, "Answer 1");
  assert.equal((await state.documents("s1")).results[0].workKey, "user:ITEM");
  assert.equal((await state.chunks("s1", { workKey: "user:ITEM" })).chunks[0].text, "Original fact in PDF");
  assert.equal((await state.search("s1", { workKey: "user:ITEM", query: "fact" })).results[0].pageNumber, 3);
  await assert.rejects(state.answer("s1", { runId: "" }), /valid runId/);
  await assert.rejects(state.search("s1", { workKey: "user:ITEM", query: "" }), /search query/);
  assert.ok(sql.every(statement => /^SELECT /i.test(statement)), "bridge must not record listing, reading or reviews");
  assert.ok(sql.some(statement => statement.includes("session_id=? AND run_id=?")));
  assert.ok(sql.some(statement => statement.includes("session_id=? AND work_key=?")));
});

test("live PDF preview returns image without saving or reviewing evidence", async () => {
  const vision = fs.readFileSync(new URL("../content/scripts/research-vision.js", import.meta.url), "utf8");
  const sql = [];
  const state = {
    requireEnabled: () => {}, normalizedCrop: crop => crop || { x: 0, y: 0, width: 1, height: 1 },
    Zotero: { ZotQueryResearch: { validateSessionScope: async () => {} }, Utilities: { Internal: { md5Async: async () => "pdfhash", md5: () => "imagehash" } } },
    DB: "research", query: async statement => { sql.push(statement); return [{ session_id: "s1", library_key: "user", item_key: "ITEM" }]; },
    attachmentFor: async () => ({ key: "PDFKEY", getFilePathAsync: async () => "C:/paper.pdf" }),
    IOUtils: { stat: async () => ({ size: 100 }), read: async () => new Uint8Array([1]) },
    cachedRender: async () => ({ mimeType: "image/png", data: "cG5n", width: 100, height: 200, pageCount: 5, cacheHit: false }),
  };
  vm.createContext(state);
  vm.runInContext(vision.slice(vision.indexOf("async function previewPage("), vision.indexOf("async function observe(")) + "\nthis.preview=previewPage;", state);
  const result = await state.preview({ sessionId: "s1", positionId: "p1", pageNumber: 3 });
  assert.equal(result.images[0].data, "cG5n");
  assert.equal(result.persisted, false);
  assert.match(result.pdfLink, /PDFKEY\?page=3/);
  assert.ok(sql.every(statement => /^SELECT /i.test(statement)));
});

test("stdio MCP bridge exposes scoped native research, read-only library, and profile previews", async t => {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    if (request.url.startsWith("/api/")) {
      seen.push({ path: request.url, method: request.method });
      response.setHeader("content-type", "application/json");
      response.setHeader("total-results", "1");
      response.end(JSON.stringify(request.url.includes("/fulltext") ? { content: "Original PDF text" } : [{ key: "ABCDEFGH", data: { title: "Paper" } }]));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    seen.push({ path: request.url, auth: request.headers.authorization, data });
    response.setHeader("content-type", "application/json");
    if (request.url === "/zotquery/mcp") {
      const nativeTools = [
        { name: "zotquery_evidence_review", description: "Write review", inputSchema: { type: "object", properties: { positionId: { type: "string" }, reviewStatus: { type: "string" } }, required: ["positionId", "reviewStatus"] } },
        { name: "zotquery_note_profile_list", description: "List profiles", inputSchema: { type: "object", properties: {} } },
        { name: "zotquery_note_profile_validate", description: "Validate note profile", inputSchema: { type: "object", properties: { profile: { type: "object" } }, required: ["profile"] } },
        { name: "zotquery_output_profile_validate", description: "Validate output profile", inputSchema: { type: "object", properties: { profile: { type: "object" } }, required: ["profile"] } },
        { name: "zotquery_note_profile_install", description: "Install profile", inputSchema: { type: "object", properties: { profile: { type: "object" } } } },
        { name: "zotquery_get_selected_items", description: "Current selection", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
        { name: "zotquery_create_child_note", description: "Create Zotero child note", inputSchema: { type: "object", properties: { library: { type: "string" }, parentItemKey: { type: "string", pattern: "^[A-Z0-9]{8}$" }, title: { type: "string" }, html: { type: "string" }, tags:{type:"array",items:{type:"string"}} }, required: ["library", "parentItemKey", "title", "html"] } },
        { name: "zotquery_reading_batch_status", description: "Batch status", inputSchema: { type: "object", properties: { collectionKey: { type: "string" }, readingProfileId: { type: "string" }, limit: { type: "integer", minimum:1, maximum:10 } }, required: ["collectionKey", "readingProfileId"] } },
        { name: "zotquery_reading_generation_profile", description: "Generation profile", inputSchema: { type: "object", properties: { generationProfileId: { type: "string" } } } },
        { name: "zotquery_depth_qc_preview", description: "Depth QC preview", inputSchema: { type: "object", properties: { library: { type: "string" }, parentItemKey: { type: "string" }, readingProfileId: { type: "string" }, generationProfileId: { type: "string" }, generation: generationSchema, html: { type: "string" } }, required: ["library", "parentItemKey", "readingProfileId", "generationProfileId", "generation", "html"] } },
        { name: "zotquery_upsert_child_note", description: "Upsert child note", inputSchema: { type: "object", properties: { library: { type: "string" }, parentItemKey: { type: "string" }, readingProfileId: { type: "string" }, generationProfileId: { type: "string" }, generation: generationSchema, title: { type: "string" }, html: { type: "string" } }, required: ["library", "parentItemKey", "readingProfileId", "generationProfileId", "generation", "title", "html"] } },
        { name: "zotquery_set_item_tag", description: "Tag parent", inputSchema: { type: "object", properties: { library: { type: "string" }, parentItemKey: { type: "string" }, readingProfileId: { type: "string" }, tag: { type: "string" } }, required: ["library", "parentItemKey", "readingProfileId", "tag"] } },
        { name: "zotquery_add_item_tag", description: "Add ordinary tag", inputSchema: { type: "object", properties: { library: { type: "string" }, parentItemKey: { type: "string" }, tag: { type: "string" } }, required: ["library", "parentItemKey", "tag"] } },
        { name: "zotquery_evidence_visual_session_start", description: "Start visual session", inputSchema: { type: "object", properties: { library: { type: "string" }, parentItemKey: { type: "string" }, attachmentKey: { type: "string" } }, required: ["library", "parentItemKey"] } },
        { name: "zotquery_reading_batch_record_failure", description: "Record failure", inputSchema: { type: "object", properties: { collectionKey: { type: "string" }, parentItemKey: { type: "string" }, readingProfileId: { type: "string" }, reason: { type: "string" } }, required: ["collectionKey", "parentItemKey", "readingProfileId", "reason"] } },
        ...["list_groups","list_collections","search_items","get_collection_items","get_item","list_children","read_attachment_fulltext"].map(suffix=>({name:`zotquery_library_${suffix}`,description:`Library ${suffix}`,inputSchema:{type:"object",properties:{library:{type:"string"},collectionKey:{type:"string"},itemKey:{type:"string"},query:{type:"string"},offset:{type:"integer"},limit:{type:"integer"}},required:suffix==="get_collection_items"?["collectionKey"]:["get_item","list_children","read_attachment_fulltext"].includes(suffix)?["itemKey"]:[]}})),
      ];
      const called=data.params?.name;
      const result=called==='zotquery_library_search_items'||called==='zotquery_library_get_collection_items'?{results:[{key:'ABCDEFGH',data:{title:'Paper'}}],nextOffset:null}:called==='zotquery_library_read_attachment_fulltext'?{text:'Original',nextOffset:null}:{called};
      response.end(JSON.stringify({ jsonrpc: "2.0", id: data.id, result: data.method === "tools/list" ? { tools: nativeTools } : { content: [{ type: "text", text: JSON.stringify(result) }] } }));
      return;
    }
    response.end(JSON.stringify(data.action === "sessions" ? { total: 1, nextOffset: null, results: [{ sessionId: "s1", question: "Question" }] }
      : data.action === "page_image" ? { sessionId: "s1", images: [{ mimeType: "image/png", data: "cG5n" }] }
        : { sessionId: "s1", synthesisAllowed: false }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const secret = "a".repeat(72);
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bridge/chatgpt-mcp-stdio.mjs", import.meta.url))], {
    env: { ...process.env, ZOTQUERY_MCP_TOKEN: secret, ZOTQUERY_ZOTERO_PORT: String(server.address().port) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const lines = readline.createInterface({ input: child.stdout });
  const queue = [];
  let resolveLine;
  lines.on("line", line => { if (resolveLine) { const resolve = resolveLine; resolveLine = null; resolve(JSON.parse(line)); } else queue.push(JSON.parse(line)); });
  const receive = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
    resolveLine = resolve;
    setTimeout(() => { if (resolveLine === resolve) { resolveLine = null; reject(new Error("bridge response timeout")); } }, 5000).unref();
  });
  const send = async (id, method, params = {}) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return receive();
  };
  assert.equal((await send(1, "initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.version, "3.1.25");
  const listed = await send(2, "tools/list");
  assert.equal(listed.result.tools.find(tool => tool.name === "zotquery_evidence_review").annotations.readOnlyHint, false);
  assert.ok(!listed.result.tools.some(tool => tool.name === "zotquery_note_profile_install"));
  assert.ok(listed.result.tools.some(tool => tool.name === "zotquery_preview_note_profile_install"));
  assert.ok(listed.result.tools.some(tool => tool.name === "zotquery_library_search_items"));
  assert.ok(listed.result.tools.some(tool => tool.name === "zotquery_read_saved_image"));
  assert.ok(listed.result.tools.some(tool => tool.name === "zotquery_preview_pdf_page"));
  assert.ok(listed.result.tools.some(tool => tool.name === "zotquery_read_answer_chunk"));
  assert.ok(listed.result.tools.some(tool => tool.name === "zotquery_search_document"));
  assert.equal(listed.result.tools.find(tool => tool.name === "zotquery_get_selected_items").annotations.readOnlyHint, true);
  assert.equal(listed.result.tools.find(tool => tool.name === "zotquery_create_child_note").annotations.readOnlyHint, false);
  assert.equal(listed.result.tools.find(tool => tool.name === "zotquery_reading_batch_status").annotations.readOnlyHint, true);
  assert.equal(listed.result.tools.find(tool => tool.name === "zotquery_upsert_child_note").annotations.readOnlyHint, false);
  assert.equal(listed.result.tools.find(tool => tool.name === "zotquery_depth_qc_preview").annotations.readOnlyHint, true);
  const records = await send(3, "tools/call", { name: "zotquery_list_research", arguments: { limit: 5 } });
  assert.equal(JSON.parse(records.result.content[0].text).total, 1);
  assert.ok(seen.some(call => call.path === "/zotquery/bridge-read" && call.auth === `Bearer ${secret}`));
  const review = await send(4, "tools/call", { name: "zotquery_evidence_review", arguments: { positionId: "p1", reviewStatus: "reviewed" } });
  assert.equal(JSON.parse(review.result.content[0].text).called, "zotquery_evidence_review");
  assert.ok(seen.some(call => call.path === "/zotquery/mcp" && call.data.method === "tools/call" && call.data.params.name === "zotquery_evidence_review"));
  const beforeInvalid = seen.length;
  const invalid = await send(5, "tools/call", { name: "zotquery_list_research", arguments: { limit: 5000 } });
  assert.equal(invalid.result.isError, true);
  assert.equal(seen.length, beforeInvalid);
  const badCrop = await send(6, "tools/call", { name: "zotquery_preview_pdf_page", arguments: { sessionId: "s1", positionId: "p1", pageNumber: 1, crop: { x: 0.5, y: 0, width: 0.8, height: 1 } } });
  assert.equal(badCrop.result.isError, true);
  assert.equal(seen.length, beforeInvalid, "invalid crop must never reach Zotero");
  const page = await send(10, "tools/call", { name: "zotquery_preview_pdf_page", arguments: { sessionId: "s1", positionId: "p1", pageNumber: 1 } });
  assert.equal(page.result.content[1].type, "image");
  assert.ok(seen.some(call => call.path === "/zotquery/bridge-read" && call.data.action === "page_image" && call.data.pageNumber === 1));
  const beforeDenied = seen.length;
  const denied = await send(7, "tools/call", { name: "zotquery_note_profile_install", arguments: { profile: {} } });
  assert.equal(denied.result.isError, true);
  assert.equal(seen.length, beforeDenied);
  const library = await send(8, "tools/call", { name: "zotquery_library_search_items", arguments: { library: "user", query: "kinase", limit: 5 } });
  assert.equal(JSON.parse(library.result.content[0].text).results[0].data.title, "Paper");
  assert.ok(seen.some(call => call.path==="/zotquery/mcp" && call.data?.params?.name==="zotquery_library_search_items"));
  const collection = await send(81, "tools/call", { name: "zotquery_library_get_collection_items", arguments: { library: "user", collectionKey: "ABCDEFGH", limit: 3 } });
  assert.equal(JSON.parse(collection.result.content[0].text).results[0].data.title, "Paper");
  assert.ok(seen.some(call => call.path==="/zotquery/mcp" && call.data?.params?.name==="zotquery_library_get_collection_items"));
  const fulltext = await send(9, "tools/call", { name: "zotquery_library_read_attachment_fulltext", arguments: { itemKey: "ABCDEFGH", offset: 0, limit: 8 } });
  assert.equal(JSON.parse(fulltext.result.content[0].text).text, "Original");
  const profilePreview = await send(11, "tools/call", { name: "zotquery_preview_note_profile_install", arguments: { profile: { id: "draft" } } });
  assert.equal(JSON.parse(profilePreview.result.content[0].text).called, "zotquery_note_profile_validate");
  const selectionPreview = await send(12, "tools/call", { name: "zotquery_preview_note_profile_select", arguments: { id: "generic" } });
  assert.equal(JSON.parse(selectionPreview.result.content[0].text).previewOnly, true);
  assert.ok(!seen.some(call => call.data?.params?.name === "zotquery_note_profile_install"));
  assert.ok(!JSON.stringify({ listed, records, review, invalid }).includes(secret));

  const compact = spawn(process.execPath, [fileURLToPath(new URL("../bridge/chatgpt-mcp-stdio.mjs", import.meta.url))], {
    env: { ...process.env, ZOTQUERY_MCP_TOKEN: secret, ZOTQUERY_ZOTERO_PORT: String(server.address().port), ZOTQUERY_CHATGPT_SURFACE: "compact-read" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => compact.kill());
  const compactLines = readline.createInterface({ input: compact.stdout });
  const compactQueue = [];
  let compactResolve;
  compactLines.on("line", line => { if (compactResolve) { const resolve = compactResolve; compactResolve = null; resolve(JSON.parse(line)); } else compactQueue.push(JSON.parse(line)); });
  const compactSend = async (id, method, params = {}) => {
    compact.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return compactQueue.length ? compactQueue.shift() : new Promise((resolve, reject) => {
      compactResolve = resolve;
      setTimeout(() => { if (compactResolve === resolve) { compactResolve = null; reject(new Error("compact bridge response timeout")); } }, 5000).unref();
    });
  };
  const compactList = await compactSend(20, "tools/list");
  assert.ok(compactList.result.tools.some(tool => tool.name === "zotquery_library_search_items"));
  assert.equal(toolContract.tools.zotquery_library_search_items.domain,"library");
  assert.equal(toolContract.tools.zotquery_evidence_visual_session_start.domain,"evidence");
  assert.equal(toolContract.tools.zotquery_set_item_tag.domain,"reading");
  assert.ok(compactList.result.tools.some(tool => tool.name === "zotquery_native_read_catalog"));
  assert.equal(compactList.result.tools.find(tool => tool.name === "zotquery_get_selected_items").annotations.readOnlyHint, true);
  assert.equal(compactList.result.tools.find(tool => tool.name === "zotquery_create_child_note").annotations.readOnlyHint, false);
  assert.equal(compactList.result.tools.find(tool => tool.name === "zotquery_reading_batch_status").annotations.readOnlyHint, true);
  assert.equal(compactList.result.tools.find(tool => tool.name === "zotquery_depth_qc_preview").annotations.readOnlyHint, true);
  assert.deepEqual(compactList.result.tools.find(tool => tool.name === "zotquery_upsert_child_note").inputSchema.properties.generation,generationSchema);
  assert.ok(compactList.result.tools.filter(tool => !tool.annotations.readOnlyHint).every(tool => ["zotquery_create_child_note", "zotquery_upsert_child_note", "zotquery_set_item_tag", "zotquery_add_item_tag", "zotquery_evidence_visual_session_start", "zotquery_reading_batch_record_failure"].includes(tool.name)));
  assert.equal(compactList.result.tools.find(tool => tool.name === "zotquery_add_item_tag").inputSchema.required.includes("tag"), true);
  assert.equal(compactList.result.tools.find(tool => tool.name === "zotquery_evidence_visual_session_start").inputSchema.required.includes("parentItemKey"), true);
  assert.ok(!compactList.result.tools.some(tool => tool.name === "zotquery_evidence_review"));
  const catalog = await compactSend(21, "tools/call", { name: "zotquery_native_read_catalog", arguments: {} });
  assert.ok(JSON.parse(catalog.result.content[0].text).results.some(tool => tool.name === "zotquery_note_profile_list"));
  const nativeRead = await compactSend(22, "tools/call", { name: "zotquery_native_read_call", arguments: { name: "zotquery_note_profile_list", arguments: {} } });
  assert.equal(JSON.parse(nativeRead.result.content[0].text).called, "zotquery_note_profile_list");
  const compactBeforeDenied = seen.length;
  const deniedWrite = await compactSend(23, "tools/call", { name: "zotquery_evidence_review", arguments: { positionId: "p1", reviewStatus: "reviewed" } });
  assert.equal(deniedWrite.result.isError, true);
  assert.equal(seen.length, compactBeforeDenied, "compact read mode must reject writes before forwarding");
  const beforeBadNote=seen.length;
  const badNote=await compactSend(24,"tools/call",{name:"zotquery_create_child_note",arguments:{library:"user",parentItemKey:"BAD",title:"Read",html:"<p>Body</p>"}});
  assert.equal(badNote.result.isError,true);assert.equal(seen.length,beforeBadNote);
  const selected=await compactSend(25,"tools/call",{name:"zotquery_get_selected_items",arguments:{}});
  assert.equal(JSON.parse(selected.result.content[0].text).called,"zotquery_get_selected_items");
  const note=await compactSend(26,"tools/call",{name:"zotquery_create_child_note",arguments:{library:"user",parentItemKey:"ABCDEFGH",title:"Read",html:"<p>Body</p>",tags:["✅精读完成"]}});
  assert.equal(JSON.parse(note.result.content[0].text).called,"zotquery_create_child_note");
  assert.ok(seen.some(call=>call.data?.params?.name==="zotquery_create_child_note"&&call.data.params.arguments.parentItemKey==="ABCDEFGH"));
  const upsert=await compactSend(27,"tools/call",{name:"zotquery_upsert_child_note",arguments:{library:"user",parentItemKey:"ABCDEFGH",readingProfileId:"strawberry-vnext",generationProfileId:"strawberry-vnext-depth",generation:{articleType:"review"},title:"精读笔记",html:"<p>Complete</p>"}});
  assert.equal(JSON.parse(upsert.result.content[0].text).called,"zotquery_upsert_child_note");
  const beforeBadGeneration=seen.length;
  const badGeneration=await compactSend(29,"tools/call",{name:"zotquery_upsert_child_note",arguments:{library:"user",parentItemKey:"ABCDEFGH",readingProfileId:"strawberry-vnext",generationProfileId:"strawberry-vnext-depth",generation:{articleType:"original_research",fullPdfReadTrace:{}},title:"精读笔记",html:"<p>Complete</p>"}});
  assert.equal(badGeneration.result.isError,true);
  assert.match(badGeneration.result.content[0].text,/fullPdfReadTrace/);
  assert.equal(seen.length,beforeBadGeneration,"unknown audit fields never reach Zotero");
  const trace={articleType:"original_research",fullTextRead:{attachmentKey:"PDFITEM1",totalCharacters:1,chunks:[{offset:0,length:1,nextOffset:null}]}};
  const preview=await compactSend(30,"tools/call",{name:"zotquery_depth_qc_preview",arguments:{library:"user",parentItemKey:"ABCDEFGH",readingProfileId:"strawberry-vnext",generationProfileId:"strawberry-vnext-depth",generation:trace,html:"<p>Complete</p>"}});
  assert.equal(JSON.parse(preview.result.content[0].text).called,"zotquery_depth_qc_preview");
  const batch=await compactSend(28,"tools/call",{name:"zotquery_reading_batch_status",arguments:{collectionKey:"ABCDEFGH",readingProfileId:"strawberry-vnext",limit:3}});
  assert.equal(JSON.parse(batch.result.content[0].text).called,"zotquery_reading_batch_status");
});
