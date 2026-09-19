/**
 * ZotQuery Core 3.0.14 — note parsing and shared semantic retrieval.
 *
 * Scope:
 * - Zotero Notes are the source of truth (no exported Markdown directory)
 * - deterministic HTML -> canonical text snapshot
 * - independent zotquery-lne.sqlite attached DB
 * - FTS5 lexical index with explicit CJK 3/4-grams
 * - model-aware shared embeddings via ZotQuery public embedding API
 * - persistent segment-vector cache keyed by text hash + model id
 * - dense search in a dedicated ChromeWorker and lexical+dense fusion
 * - find / trace / hits / read / paper APIs
 * - Zotero.Notifier incremental synchronization
 * - no separate LNE sidecar or service; embeddings use ZotQuery Search
 */
(function (global) {
  "use strict";

  const VERSION = "3.0.14";
  const DB_ALIAS = "zotquerylne";
  const DB_FILE = "zotquery-lne.sqlite";
  const SCHEMA_VERSION = 3;
  const PARSER_VERSION = "native-1.3.0";
  const CANON_VERSION = "native-html-1.0.0";
  const PREF = "zotquery.lneNative.";
  const MAX_FIND_TOP = 2000;
  const MAX_HITS_PER_NOTE = 50;
  const HEADING_RX = /^(#{1,6})\s+(.+?)\s*$/;
  const SEP_RX = /^\s*(?:-{3,}|_{3,}|(?:\*\s*){3,})\s*$/;
  const ASCII_STOP = new Set(["the","and","are","was","were","for","with","that","this","what","which","does","how","why","from","into","has","have","not","can","may","about","there","their","than","then","when","who","all","any","its","it","is","of","in","on","to","a","an","by","or","as","be","do"]);
  const WEAK_CHARS = new Set("什么怎何如为哪些个是否可够之后还有办问题研究结果发现表明知了了解请想要值得这篇文献论报道依据证据解决不足困难学者目前进一步主重和与或及的了吗呢吧我你他它们会就都上下前后里面时候用做对关于通过以及进行一个这种那种即可应该必须要能".split(""));
  const CONNECTORS = new Set("和与及或的在了对为是有把被将从向跟同并且但而以之其此".split(""));
  const DISC_RATIO = 0.40;
  const DENSE_TOPK_DEFAULT = 150;
  const DENSE_REL_DROP_DEFAULT = 0.12;
  const DENSE_MIN_DEFAULT = 0.35;
  const DENSE_BONUS_MAX = 2.4;

  const state = {
    rootURI: null,
    started: false,
    attached: false,
    notifierID: null,
    pending: new Map(),
    timer: null,
    syncing: false,
    lastError: null,
    lastSyncAt: null,
    vectorPending: new Set(),
    vectorTimer: null,
    vectorSyncing: false,
    lastVectorError: null,
    queryProbe: null,
    lastVectorSyncAt: null,
    activeModelId: null,
    hadExistingNotes: null,
    vectorGeneration: 0,
    vectorWorker: null,
    vectorWorkerModelId: null,
    vectorWorkerGeneration: -1,
    vectorWorkerJobs: new Map(),
    vectorJobSeq: 0,
    modelPrefObserver: null,
  };

  const log = (...xs) => Zotero.debug(`[ZotQuery Core] ${xs.join(" ")}`);
  const noteProfiles = () => Zotero.ZotQueryNoteProfiles;
  const now = () => new Date().toISOString();
  const pref = (name, fallback) => {
    try {
      const v = Zotero.Prefs.get(PREF + name, true);
      return v === undefined || v === null || v === "" ? fallback : v;
    } catch (_) {
      return fallback;
    }
  };

  function hash32(text, seed = 0x811c9dc5) {
    let h = seed >>> 0;
    const s = String(text ?? "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }
  function stableHash(text) {
    return `${hash32(text, 0x811c9dc5)}${hash32(text, 0x9e3779b1)}`;
  }
  function escLike(s) { return String(s || "").replace(/[\\%_]/g, "\\$&"); }
  function compactSpace(s) { return String(s || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim(); }
  function normIdentity(s) { return compactSpace(String(s || "").normalize("NFKC")).toLocaleLowerCase("und"); }
  function isWeakGram(g) { return [...String(g || "")].every(ch => WEAK_CHARS.has(ch)); }
  function trimGram(g) {
    const chars = [...String(g || "")];
    let a = 0, b = chars.length;
    while (a < b && CONNECTORS.has(chars[a])) a++;
    while (b > a && CONNECTORS.has(chars[b - 1])) b--;
    return chars.slice(a, b).join("");
  }
  function isExactIdentifier(term) {
    const s = String(term || "");
    return /\p{L}/u.test(s) && /\p{N}/u.test(s);
  }
  function stripMarkup(s) {
    return compactSpace(String(s || "")
      .replace(/\*\*|__/g, "")
      .replace(/`/g, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ""));
  }
  function libraryKeyFromID(libraryID) {
    try {
      const lib = Zotero.Libraries.get(libraryID);
      if (!lib) return null;
      if (lib.libraryType === "user") return "user";
      if (lib.libraryType === "group" && lib.groupID) return `group:${lib.groupID}`;
    } catch (_) {}
    return null;
  }
  function noteUID(libraryKey, noteKey) { return `${libraryKey}:${String(noteKey || "").toUpperCase()}`; }
  function selectURI(libraryKey, key) {
    if (!key) return "";
    if (libraryKey === "user") return `zotero://select/library/items/${key}`;
    const m = String(libraryKey || "").match(/^group:(\d+)$/);
    return m ? `zotero://select/groups/${m[1]}/items/${key}` : "";
  }
  // Zotero 10 query rows are proxies. Do not spread or serialize them directly:
  // meta-property access (for example toJSON) is interpreted as a column lookup.
  function plainRow(row, columns) {
    const out = {};
    for (const column of columns) out[column] = row?.[column];
    return out;
  }

  async function attachDB() {
    if (state.attached) {
      try {
        const rows = await Zotero.DB.queryAsync("PRAGMA database_list");
        if ((rows || []).some(r => r.name === DB_ALIAS)) return;
      } catch (_) {}
      state.attached = false;
    }
    const path = PathUtils.join(Zotero.DataDirectory.dir, DB_FILE);
    const rows = await Zotero.DB.queryAsync("PRAGMA database_list");
    if (!(rows || []).some(r => r.name === DB_ALIAS)) {
      await Zotero.DB.queryAsync(`ATTACH DATABASE ? AS ${DB_ALIAS}`, [path]);
    }
    state.attached = true;
  }

  async function initSchema() {
    await attachDB();
    await Zotero.DB.executeTransaction(async () => {
      await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB_ALIAS}.metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
      await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB_ALIAS}.notes (
        note_uid TEXT PRIMARY KEY,
        library_key TEXT NOT NULL,
        note_key TEXT NOT NULL,
        note_item_id INTEGER,
        parent_library_key TEXT,
        parent_item_key TEXT,
        parent_item_id INTEGER,
        note_title TEXT,
        parent_title TEXT,
        doi TEXT,
        journal TEXT,
        year TEXT,
        authors TEXT,
        note_style TEXT,
        source_version INTEGER,
        source_hash TEXT NOT NULL,
        canonical_hash TEXT NOT NULL,
        canonical_text TEXT NOT NULL,
        chars INTEGER NOT NULL DEFAULT 0,
        line_count INTEGER NOT NULL DEFAULT 0,
        seg_count INTEGER NOT NULL DEFAULT 0,
        tagged_segs INTEGER NOT NULL DEFAULT 0,
        is_stub INTEGER NOT NULL DEFAULT 0,
        eligible INTEGER NOT NULL DEFAULT 1,
        indexed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(library_key, note_key)
      )`);
      await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${DB_ALIAS}.idx_notes_identity ON notes(library_key,note_key)`);
      await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${DB_ALIAS}.idx_notes_parent ON notes(parent_library_key,parent_item_key)`);
      await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${DB_ALIAS}.idx_notes_item_id ON notes(note_item_id)`);
      const noteColumns = new Set((await Zotero.DB.queryAsync(`PRAGMA ${DB_ALIAS}.table_info(notes)`))?.map(r => r.name) || []);
      if (!noteColumns.has("profile_id")) await Zotero.DB.queryAsync(`ALTER TABLE ${DB_ALIAS}.notes ADD COLUMN profile_id TEXT`);
      if (!noteColumns.has("profile_signature")) await Zotero.DB.queryAsync(`ALTER TABLE ${DB_ALIAS}.notes ADD COLUMN profile_signature TEXT`);
      await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB_ALIAS}.segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_uid TEXT NOT NULL,
        ord INTEGER NOT NULL,
        hash TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        section_path TEXT,
        heading TEXT,
        tag TEXT,
        kind TEXT,
        sec_kind TEXT,
        text TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        block_start INTEGER,
        block_end INTEGER,
        chars INTEGER NOT NULL,
        grams TEXT,
        UNIQUE(note_uid, ord)
      )`);
      await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${DB_ALIAS}.idx_segments_note ON segments(note_uid)`);
      const segmentColumns = new Set((await Zotero.DB.queryAsync(`PRAGMA ${DB_ALIAS}.table_info(segments)`))?.map(r => r.name) || []);
      if (!segmentColumns.has("canonical_role")) await Zotero.DB.queryAsync(`ALTER TABLE ${DB_ALIAS}.segments ADD COLUMN canonical_role TEXT NOT NULL DEFAULT 'UNKNOWN'`);
      await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${DB_ALIAS}.idx_segments_hash ON segments(hash)`);
      await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB_ALIAS}.segment_vectors (
        hash TEXT NOT NULL,
        model_id TEXT NOT NULL,
        dim INTEGER NOT NULL,
        embedding TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(hash, model_id)
      )`);
      await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${DB_ALIAS}.idx_segment_vectors_model ON segment_vectors(model_id)`);
      try {
        await Zotero.DB.queryAsync(`CREATE VIRTUAL TABLE IF NOT EXISTS ${DB_ALIAS}.segments_fts USING fts5(
          text, grams, section_path, heading, note_uid UNINDEXED, segment_id UNINDEXED,
          tokenize='unicode61 remove_diacritics 2'
        )`);
      } catch (e) {
        throw new Error(`FTS5 unavailable for LNE Native: ${e?.message || e}`);
      }
      const vals = [
        ["schema_version", String(SCHEMA_VERSION)],
        ["parser_version", PARSER_VERSION],
        ["canonicalizer_version", CANON_VERSION],
        ["product_version", VERSION],
      ];
      for (const [k, v] of vals) {
        await Zotero.DB.queryAsync(`INSERT OR REPLACE INTO ${DB_ALIAS}.metadata(key,value) VALUES(?,?)`, [k, v]);
      }
    });
    if (state.hadExistingNotes === null) state.hadExistingNotes = Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB_ALIAS}.notes`) || 0) > 0;
  }

  function getBtoa() {
    if (typeof btoa === "function") return btoa;
    const win = Zotero.getMainWindow?.();
    if (typeof win?.btoa === "function") return win.btoa.bind(win);
    throw new Error("base64 encoder unavailable");
  }
  function getAtob() {
    if (typeof atob === "function") return atob;
    const win = Zotero.getMainWindow?.();
    if (typeof win?.atob === "function") return win.atob.bind(win);
    throw new Error("base64 decoder unavailable");
  }
  function float32ToBase64(values) {
    const a = values instanceof Float32Array ? values : new Float32Array(values || []);
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    return getBtoa()(bin);
  }
  function base64ToFloat32(text) {
    if (!text) return new Float32Array(0);
    const bin = getAtob()(String(text));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }
  function normalizeVector(values) {
    const v = values instanceof Float32Array ? new Float32Array(values) : new Float32Array(values || []);
    let ss = 0;
    for (let i = 0; i < v.length; i++) ss += v[i] * v[i];
    const n = Math.sqrt(ss);
    if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
  }
  function semanticEnabled() { return pref("semantic", true) !== false; }
  function embeddingAPI() {
    const api = Zotero.ZotQuery?.api;
    return api?.embedText && api?.embedTexts && api?.getEmbeddingModel ? api : null;
  }
  async function activeEmbeddingModel() {
    const api = embeddingAPI();
    if (!api) return null;
    const info = await api.getEmbeddingModel();
    const id = String(info?.activeModelId || info?.id || "");
    if (!id) return null;
    if (state.activeModelId !== id) {
      state.activeModelId = id;
      invalidateVectorWorker();
    }
    return { ...info, id, dimensions: Number(info?.dimensions || 0) };
  }
  function invalidateVectorWorker() {
    state.vectorWorkerGeneration = -1;
    state.vectorWorkerModelId = null;
  }
  function terminateVectorWorker() {
    if (state.vectorWorker) {
      try { state.vectorWorker.terminate(); } catch (_) {}
    }
    for (const [, job] of state.vectorWorkerJobs) job.reject(new Error("LNE vector worker terminated"));
    state.vectorWorkerJobs.clear();
    state.vectorWorker = null;
    state.vectorWorkerModelId = null;
    state.vectorWorkerGeneration = -1;
  }
  function vectorWorkerRequest(type, payload = {}, transfer = []) {
    return new Promise((resolve, reject) => {
      if (!state.vectorWorker) return reject(new Error("LNE vector worker unavailable"));
      const jobId = `lnev-${++state.vectorJobSeq}`;
      state.vectorWorkerJobs.set(jobId, { resolve, reject });
      try { state.vectorWorker.postMessage({ type, jobId, ...payload }, transfer); }
      catch (e) { state.vectorWorkerJobs.delete(jobId); reject(e); }
      setTimeout(() => {
        const job = state.vectorWorkerJobs.get(jobId);
        if (job) { state.vectorWorkerJobs.delete(jobId); job.reject(new Error(`LNE vector worker timeout: ${type}`)); }
      }, 60000);
    });
  }
  function ensureVectorWorkerInstance() {
    if (state.vectorWorker) return state.vectorWorker;
    state.vectorWorker = new ChromeWorker("chrome://zotquery/content/scripts/lne-vector-worker.js");
    state.vectorWorker.onmessage = event => {
      const msg = event.data || {};
      if (!msg.jobId) return;
      const job = state.vectorWorkerJobs.get(msg.jobId);
      if (!job) return;
      state.vectorWorkerJobs.delete(msg.jobId);
      if (msg.type === "error") job.reject(new Error(msg.error || "LNE vector worker error"));
      else job.resolve(msg);
    };
    state.vectorWorker.onerror = event => {
      const err = new Error(event?.message || "LNE vector worker crashed");
      for (const [, job] of state.vectorWorkerJobs) job.reject(err);
      state.vectorWorkerJobs.clear();
      terminateVectorWorker();
      state.lastVectorError = err.message;
    };
    return state.vectorWorker;
  }
  async function ensureVectorWorker(model) {
    ensureVectorWorkerInstance();
    if (state.vectorWorkerModelId === model.id && state.vectorWorkerGeneration === state.vectorGeneration) return;
    const rows = await Zotero.DB.queryAsync(`SELECT hash,dim,embedding FROM ${DB_ALIAS}.segment_vectors WHERE model_id=? ORDER BY hash`, [model.id]);
    let dim = Number(model.dimensions || 0);
    if (!dim && rows?.length) dim = Number(rows[0].dim || 0);
    if (!dim) throw new Error(`Embedding dimension unavailable for ${model.id}`);
    const records = (rows || []).filter(r => Number(r.dim || 0) === dim && r.embedding).map(r => ({ hash: String(r.hash), embedding: String(r.embedding) }));
    await vectorWorkerRequest("loadEncoded", { modelId: model.id, dim, records });
    state.vectorWorkerModelId = model.id;
    state.vectorWorkerGeneration = state.vectorGeneration;
  }
  async function denseTopK(question, options = {}) {
    if (!semanticEnabled() || options.semantic === false) return { used: false, results: [], error: "semantic disabled" };
    const api = embeddingAPI();
    const model = await activeEmbeddingModel();
    if (!api || !model) return { used: false, results: [], error: "shared ZotQuery embedding API unavailable" };
    try {
      const qres = await api.embedText(String(question || ""), { kind: "query" });
      state.queryProbe = { modelId: model.id, at: Date.now(), ready: true, error: null };
      state.lastVectorError = null;
      const q = normalizeVector(qres?.embedding || []);
      if (!q.length) throw new Error("empty query embedding");
      await ensureVectorWorker(model);
      const topK = Math.max(1, Math.min(1000, Number(options.semanticTopK || pref("semanticTopK", DENSE_TOPK_DEFAULT))));
      const response = await vectorWorkerRequest("search", { buffer: q.buffer, topK }, [q.buffer]);
      if (!Number(response.count || 0)) return { used: false, modelId: model.id, results: [], error: "semantic vector index is empty" };
      const all = response.results || [];
      const max = all.length ? Number(all[0].sim || 0) : 0;
      const requestedAbs = options.semanticMinSimilarity === undefined ? Number(pref("semanticMinSimilarityPercent", 35)) / 100 : Number(options.semanticMinSimilarity);
      const requestedRel = options.semanticRelativeDrop === undefined ? Number(pref("semanticRelativeDropPercent", 12)) / 100 : Number(options.semanticRelativeDrop);
      const absFloor = Math.max(0, Math.min(1, Number.isFinite(requestedAbs) ? requestedAbs : DENSE_MIN_DEFAULT));
      const relDrop = Math.max(0, Math.min(0.5, Number.isFinite(requestedRel) ? requestedRel : DENSE_REL_DROP_DEFAULT));
      const floor = Math.max(absFloor || DENSE_MIN_DEFAULT, max - (relDrop || DENSE_REL_DROP_DEFAULT));
      const results = all.filter(x => Number(x.sim) >= floor);
      return { used: true, modelId: model.id, dim: qres?.dimensions || q.length, max, floor, results, processingTimeMs: response.processingTimeMs || 0 };
    } catch (e) {
      state.lastVectorError = e?.message || String(e);
      state.queryProbe = { modelId: model.id, at: Date.now(), ready: false, error: state.lastVectorError };
      return { used: false, results: [], error: state.lastVectorError };
    }
  }
  async function queueMissingVectors({ limit = 1500 } = {}) {
    if (!semanticEnabled()) return { queued: 0, reason: "semantic-disabled" };
    const model = await activeEmbeddingModel();
    if (!model) return { queued: 0, reason: "embedding-api-unavailable" };
    const hashes = await Zotero.DB.columnQueryAsync(`SELECT DISTINCT s.hash
      FROM ${DB_ALIAS}.segments s LEFT JOIN ${DB_ALIAS}.segment_vectors v ON v.hash=s.hash AND v.model_id=?
      WHERE v.hash IS NULL LIMIT ?`, [model.id, Math.max(1, Math.min(10000, Number(limit || 1500)))]) || [];
    for (const h of hashes) state.vectorPending.add(String(h));
    if (hashes.length) scheduleVectorFlush(50);
    return { queued: hashes.length, pending: state.vectorPending.size, modelId: model.id };
  }
  function queueSegmentVectors(segments) {
    if (!semanticEnabled()) return;
    for (const s of segments || []) if (s?.hash) state.vectorPending.add(String(s.hash));
    scheduleVectorFlush(250);
  }
  function scheduleVectorFlush(delay = 100) {
    if (!semanticEnabled()) return;
    if (state.vectorTimer) clearTimeout(state.vectorTimer);
    state.vectorTimer = setTimeout(() => flushVectorQueue().catch(e => {
      state.lastVectorError = e?.message || String(e);
      log(`vector queue failed: ${state.lastVectorError}`);
    }), delay);
  }
  async function flushVectorQueue() {
    if (state.vectorSyncing || !semanticEnabled()) return;
    const api = embeddingAPI();
    const model = await activeEmbeddingModel();
    if (!api || !model) { state.lastVectorError = "shared ZotQuery embedding API unavailable"; return; }
    if (!state.vectorPending.size) await queueMissingVectors({ limit: 750 });
    if (!state.vectorPending.size) return;
    state.vectorSyncing = true;
    let failed = false;
    let batchHashes = [];
    try {
      const batchSize = Math.max(1, Math.min(32, Number(pref("embeddingBatchSize", 8))));
      const hashes = [...state.vectorPending].slice(0, batchSize);
      batchHashes = hashes;
      for (const h of hashes) state.vectorPending.delete(h);
      const ph = hashes.map(() => "?").join(",");
      const existing = new Set((await Zotero.DB.columnQueryAsync(`SELECT hash FROM ${DB_ALIAS}.segment_vectors WHERE model_id=? AND hash IN (${ph})`, [model.id, ...hashes]) || []).map(String));
      const missing = hashes.filter(h => !existing.has(h));
      if (missing.length) {
        const mph = missing.map(() => "?").join(",");
        const rows = await Zotero.DB.queryAsync(`SELECT hash,MIN(text) AS text FROM ${DB_ALIAS}.segments WHERE hash IN (${mph}) GROUP BY hash`, missing);
        const texts = (rows || []).map(r => String(r.text || ""));
        const orderedHashes = (rows || []).map(r => String(r.hash));
        if (texts.length) {
          const result = await api.embedTexts(texts, { kind: "doc" });
          const vectors = result?.embeddings || [];
          if (vectors.length !== orderedHashes.length) throw new Error(`embedding batch mismatch: ${vectors.length}/${orderedHashes.length}`);
          await Zotero.DB.executeTransaction(async () => {
            for (let i = 0; i < orderedHashes.length; i++) {
              const v = normalizeVector(vectors[i]);
              if (!v.length) continue;
              await Zotero.DB.queryAsync(`INSERT OR REPLACE INTO ${DB_ALIAS}.segment_vectors(hash,model_id,dim,embedding,created_at) VALUES(?,?,?,?,?)`,
                [orderedHashes[i], result.modelId || model.id, v.length, float32ToBase64(v), now()]);
            }
          });
          state.vectorGeneration++;
          invalidateVectorWorker();
        }
      }
      state.lastVectorSyncAt = now();
      state.lastVectorError = null;
    } catch (e) {
      failed = true;
      for (const h of batchHashes) state.vectorPending.add(h);
      state.lastVectorError = e?.message || String(e);
      log(`semantic indexing paused after error: ${state.lastVectorError}`);
    } finally {
      state.vectorSyncing = false;
      if (failed) scheduleVectorFlush(60000);
      else if (state.vectorPending.size) scheduleVectorFlush(25);
      else setTimeout(() => queueMissingVectors({ limit: 750 }).catch(() => {}), 750);
    }
  }

  function domParser() {
    const win = Zotero.getMainWindow?.();
    if (win?.DOMParser) return new win.DOMParser();
    if (typeof DOMParser !== "undefined") return new DOMParser();
    throw new Error("DOMParser unavailable in Zotero window");
  }

  function canonicalizeNoteHTML(html) {
    const raw = String(html || "");
    const doc = domParser().parseFromString(`<body>${raw}</body>`, "text/html");
    const body = doc.body || doc.documentElement;
    const lines = [];
    const blocks = [];
    let blockNo = 0;

    const emit = (text, meta = {}) => {
      text = compactSpace(text);
      if (!text || SEP_RX.test(text)) return;
      blockNo += 1;
      const line = lines.length + 1;
      lines.push(text);
      blocks.push({ line, block: blockNo, text, ...meta });
    };
    const walk = node => {
      if (!node) return;
      if (node.nodeType === 3) {
        const text = compactSpace(node.nodeValue || "");
        if (text) emit(text, { type: "text" });
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = String(node.tagName || "").toLowerCase();
      if (["script", "style", "svg", "canvas"].includes(tag)) return;
      if (tag === "br") return;
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        emit(`${"#".repeat(level)} ${compactSpace(node.textContent || "")}`, { type: "heading", level });
        return;
      }
      if (tag === "li") {
        emit(`- ${compactSpace(node.textContent || "")}`, { type: "list" });
        return;
      }
      if (tag === "blockquote") {
        const txt = compactSpace(node.textContent || "");
        if (txt) emit(`> ${txt}`, { type: "quote" });
        return;
      }
      if (tag === "tr") {
        const cells = [...node.querySelectorAll?.(":scope > th, :scope > td") || []].map(x => compactSpace(x.textContent || ""));
        if (cells.length) emit(`| ${cells.join(" | ")} |`, { type: "table" });
        return;
      }
      if (["p", "div", "pre"].includes(tag)) {
        const childBlocks = [...node.children || []].some(c => /^(h[1-6]|p|div|ul|ol|li|table|blockquote|pre)$/i.test(c.tagName || ""));
        if (!childBlocks) {
          const txt = compactSpace(node.textContent || "");
          if (txt) emit(txt, { type: tag === "pre" ? "code" : "para" });
          return;
        }
      }
      for (const child of [...node.childNodes || []]) walk(child);
    };
    for (const child of [...body.childNodes || []]) walk(child);

    // Collapse accidental repeated adjacent lines produced by nested HTML wrappers.
    const deduped = [];
    for (const line of lines) if (!deduped.length || deduped[deduped.length - 1] !== line) deduped.push(line);
    return { text: deduped.join("\n"), lines: deduped, blocks };
  }

  function makeCJKGrams(text) {
    const out = new Set();
    for (const run of String(text || "").match(/[\u3400-\u9fff]+/g) || []) {
      for (const n of [2, 3, 4]) {
        for (let i = 0; i + n <= run.length; i++) out.add(run.slice(i, i + n));
      }
    }
    return [...out].join(" ");
  }

  function parseCanonical(text, profile = noteProfiles()?.get("generic")) {
    if (!profile) throw new Error("Note Profile layer is unavailable");
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const stack = [];
    const segments = [];
    let tag = null;
    let buf = [];
    let start = 0;
    const flush = end => {
      if (!buf.length) return;
      const cleaned = buf.map(stripMarkup).filter(Boolean).join("\n").trim();
      if (cleaned.length >= 12) {
        const sectionPath = stack.filter(x => x.level > 1).map(x => x.head).join(" › ");
        const firstTag = noteProfiles().matchTag(cleaned, profile);
        const heading = stack.length ? stack[stack.length - 1].head : "";
        const row = {
          ord: segments.length,
          text: cleaned,
          sectionPath,
          heading,
          tag: firstTag ? firstTag.rawTag : tag,
          canonicalRole: noteProfiles().roleForTag(firstTag ? firstTag.rawTag : tag, profile),
          kind: buf.every(x => /^\|.*\|$/.test(x.trim())) ? "table" : "para",
          secKind: noteProfiles().sectionKind(sectionPath || heading, profile),
          lineStart: start + 1,
          lineEnd: end + 1,
        };
        row.hash = stableHash(cleaned);
        row.contentHash = stableHash([cleaned, sectionPath, heading, row.tag || "", row.canonicalRole, row.kind, row.secKind].join("\n"));
        row.grams = makeCJKGrams(`${heading} ${sectionPath} ${cleaned}`);
        segments.push(row);
      }
      buf = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const h = HEADING_RX.exec(line);
      if (h) {
        flush(i - 1);
        const level = h[1].length;
        const head = compactSpace(h[2].replace(/\*\*|__/g, ""));
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        stack.push({ level, head });
        // Evidence labels describe the following material and survive ordinary
        // section headings until another explicit label replaces them.  This
        // matches the established LNE v3 parser contract.
        const headingTag = noteProfiles().matchTag(head, profile);
        if (headingTag) tag = headingTag.rawTag;
        continue;
      }
      if (!line.trim() || SEP_RX.test(line)) { flush(i - 1); continue; }
      const tm = noteProfiles().matchTag(line, profile);
      if (tm) tag = tm.rawTag;
      if (!buf.length) start = i;
      buf.push(line);
    }
    flush(lines.length - 1);
    return segments;
  }

  function parentMetadata(note) {
    let parent = null;
    try { parent = note.parentItem || (note.parentItemID ? Zotero.Items.get(note.parentItemID) : null); } catch (_) {}
    if (!parent) return { parent: null, parentLibraryKey: null, parentKey: "", title: "", doi: "", journal: "", year: "", authors: "" };
    const plk = libraryKeyFromID(parent.libraryID);
    let creators = "";
    try {
      creators = (parent.getCreators?.() || []).map(c => c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")).filter(Boolean).join("; ");
    } catch (_) {}
    const field = name => { try { return compactSpace(parent.getField?.(name) || ""); } catch (_) { return ""; } };
    const date = field("date");
    const ym = date.match(/(?:19|20)\d{2}/);
    return {
      parent,
      parentLibraryKey: plk,
      parentKey: String(parent.key || "").toUpperCase(),
      title: field("title") || parent.getDisplayTitle?.() || "",
      doi: field("DOI"),
      journal: field("publicationTitle") || field("journalAbbreviation"),
      year: ym ? ym[0] : "",
      authors: creators,
    };
  }

  function isEligible(canonical, note, profile, explicitProfile) {
    let userScope = false;
    try { userScope = Services.prefs.prefHasUserValue(`extensions.zotero.${PREF}noteScope`); } catch (_) {}
    const scope = userScope ? String(pref("noteScope", "all")) : "all";
    if (explicitProfile && !noteProfiles().matches(profile, note.getNoteTitle?.() || "", canonical.text)) return false;
    if (scope === "all") return true;
    const pattern = String(pref("titlePattern", "") || "");
    let noteTitle = "";
    try { noteTitle = note.getNoteTitle?.() || ""; } catch (_) {}
    const hay = `${noteTitle}\n${canonical.text.slice(0, 3000)}`;
    if (scope === "pattern" || scope === "reading-notes") return !!pattern && hay.includes(pattern);
    return false;
  }

  async function indexNote(note, { force = false } = {}) {
    if (!note || !note.isNote?.()) return { skipped: true, reason: "not-note" };
    const libraryKey = libraryKeyFromID(note.libraryID);
    if (!libraryKey || !note.key) return { skipped: true, reason: "unsupported-library" };
    if (pref("libraryScope", "all") === "user" && libraryKey !== "user") {
      await removeByUID(noteUID(libraryKey, note.key));
      return { skipped: true, reason: "library-out-of-scope" };
    }
    const html = String(note.getNote?.() || "");
    const canonical = canonicalizeNoteHTML(html);
    const explicitProfile = String(pref("activeNoteProfile", "") || "").trim();
    const rawNoteTitle = String(note.getNoteTitle?.() || "");
    const profile = noteProfiles()?.choose(rawNoteTitle, canonical.text, explicitProfile || null);
    if (!profile) throw new Error("Note Profile layer is unavailable");
    const eligible = isEligible(canonical, note, profile, !!explicitProfile);
    const uid = noteUID(libraryKey, note.key);
    if (!eligible) {
      await removeByUID(uid);
      return { skipped: true, reason: "not-eligible" };
    }
    const meta = parentMetadata(note);
    // Parser changes must invalidate otherwise unchanged notes.  Without the
    // parser version here, a tag-inheritance repair would be recorded in
    // metadata but every existing note would still be skipped as unchanged.
    const sourceHash = stableHash(`${CANON_VERSION}\n${PARSER_VERSION}\n${profile.id}\n${profile.signature}\n${html}\n${meta.title}\n${meta.doi}\n${meta.journal}\n${meta.year}\n${meta.authors}`);
    const existing = (await Zotero.DB.queryAsync(`SELECT source_hash FROM ${DB_ALIAS}.notes WHERE note_uid=?`, [uid]))?.[0];
    if (!force && existing?.source_hash === sourceHash) return { skipped: true, reason: "unchanged", noteUID: uid };

    const segments = parseCanonical(canonical.text, profile);
    const ts = now();
    const noteTitle = noteProfiles().titleFromText(canonical.text, profile) || meta.title || rawNoteTitle;
    await Zotero.DB.executeTransaction(async () => {
      const oldIDs = await Zotero.DB.columnQueryAsync(`SELECT id FROM ${DB_ALIAS}.segments WHERE note_uid=?`, [uid]) || [];
      for (const id of oldIDs) await Zotero.DB.queryAsync(`DELETE FROM ${DB_ALIAS}.segments_fts WHERE rowid=?`, [Number(id)]);
      await Zotero.DB.queryAsync(`DELETE FROM ${DB_ALIAS}.segments WHERE note_uid=?`, [uid]);
      await Zotero.DB.queryAsync(`INSERT OR REPLACE INTO ${DB_ALIAS}.notes (
        note_uid,library_key,note_key,note_item_id,parent_library_key,parent_item_key,parent_item_id,
        note_title,parent_title,doi,journal,year,authors,note_style,profile_id,profile_signature,source_version,source_hash,canonical_hash,
        canonical_text,chars,line_count,seg_count,tagged_segs,is_stub,eligible,indexed_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        uid, libraryKey, String(note.key).toUpperCase(), Number(note.id || 0), meta.parentLibraryKey, meta.parentKey || null,
        meta.parent?.id ? Number(meta.parent.id) : null, noteTitle, meta.title, meta.doi, meta.journal, meta.year, meta.authors,
        noteProfiles().duplicateStyle(canonical.text, profile), profile.id, profile.signature, Number(note.version || 0), sourceHash, stableHash(canonical.text), canonical.text,
        canonical.text.length, canonical.lines.length, segments.length, segments.filter(s => !!s.tag).length,
        canonical.text.length < 80 ? 1 : 0, 1, ts, ts
      ]);
      for (const s of segments) {
        await Zotero.DB.queryAsync(`INSERT INTO ${DB_ALIAS}.segments(
          note_uid,ord,hash,content_hash,section_path,heading,tag,canonical_role,kind,sec_kind,text,line_start,line_end,block_start,block_end,chars,grams
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          uid, s.ord, s.hash, s.contentHash, s.sectionPath, s.heading, s.tag, s.canonicalRole, s.kind, s.secKind, s.text,
          s.lineStart, s.lineEnd, s.lineStart, s.lineEnd, s.text.length, s.grams
        ]);
        const id = Number(await Zotero.DB.valueQueryAsync(`SELECT last_insert_rowid()`));
        await Zotero.DB.queryAsync(`INSERT INTO ${DB_ALIAS}.segments_fts(rowid,text,grams,section_path,heading,note_uid,segment_id)
          VALUES(?,?,?,?,?,?,?)`, [id, s.text, s.grams || "", s.sectionPath || "", s.heading || "", uid, id]);
      }
    });
    queueSegmentVectors(segments);
    return { indexed: true, noteUID: uid, segments: segments.length };
  }

  async function removeByUID(uid) {
    if (!uid) return;
    const ids = await Zotero.DB.columnQueryAsync(`SELECT id FROM ${DB_ALIAS}.segments WHERE note_uid=?`, [uid]) || [];
    await Zotero.DB.executeTransaction(async () => {
      for (const id of ids) await Zotero.DB.queryAsync(`DELETE FROM ${DB_ALIAS}.segments_fts WHERE rowid=?`, [Number(id)]);
      await Zotero.DB.queryAsync(`DELETE FROM ${DB_ALIAS}.segments WHERE note_uid=?`, [uid]);
      await Zotero.DB.queryAsync(`DELETE FROM ${DB_ALIAS}.notes WHERE note_uid=?`, [uid]);
    });
  }
  async function removeByItemID(itemID) {
    const rows = await Zotero.DB.queryAsync(`SELECT note_uid FROM ${DB_ALIAS}.notes WHERE note_item_id=?`, [Number(itemID)]);
    for (const r of rows || []) await removeByUID(r.note_uid);
  }

  async function enumerateNotes() {
    const out = [];
    const scope = String(pref("libraryScope", "all"));
    const libs = Zotero.Libraries.getAll().filter(l => l.libraryType === "user" || (scope === "all" && l.libraryType === "group"));
    for (const lib of libs) {
      try {
        const s = new Zotero.Search();
        s.libraryID = lib.libraryID;
        s.addCondition("itemType", "is", "note");
        const ids = await s.search();
        const items = await Zotero.Items.getAsync(ids || []);
        out.push(...(items || []).filter(x => x?.isNote?.()));
      } catch (e) {
        log(`enumerate library ${lib.libraryID} failed: ${e?.message || e}`);
      }
    }
    return out;
  }

  async function reconcile({ force = false } = {}) {
    await initSchema();
    const notes = await enumerateNotes();
    const seen = new Set();
    let indexed = 0, unchanged = 0, skipped = 0, failed = 0;
    for (const note of notes) {
      try {
        const lk = libraryKeyFromID(note.libraryID);
        if (lk && note.key) seen.add(noteUID(lk, note.key));
        const r = await indexNote(note, { force });
        if (r.indexed) indexed++;
        else if (r.reason === "unchanged") unchanged++;
        else skipped++;
      } catch (e) {
        failed++;
        state.lastError = e?.message || String(e);
        Zotero.logError(e);
      }
    }
    const existing = await Zotero.DB.columnQueryAsync(`SELECT note_uid FROM ${DB_ALIAS}.notes`) || [];
    let removed = 0;
    for (const uid of existing) if (!seen.has(uid)) { await removeByUID(uid); removed++; }
    state.lastSyncAt = now();
    if (semanticEnabled()) queueMissingVectors({ limit: 1500 }).catch(e => { state.lastVectorError = e?.message || String(e); });
    return { notesSeen: notes.length, indexed, unchanged, skipped, failed, removed, at: state.lastSyncAt };
  }

  function enqueue(event, ids) {
    for (const id of ids || []) state.pending.set(Number(id), event);
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => flushPending().catch(Zotero.logError), 700);
  }
  async function flushPending() {
    if (state.syncing || !state.pending.size) return;
    state.syncing = true;
    const jobs = [...state.pending.entries()];
    state.pending.clear();
    try {
      for (const [id, event] of jobs) {
        if (event === "delete" || event === "trash") {
          await removeByItemID(id);
          continue;
        }
        const item = Zotero.Items.get(id);
        if (!item) continue;
        if (item.isNote?.()) {
          await indexNote(item);
        } else if (item.isRegularItem?.()) {
          let noteIDs = [];
          try { noteIDs = item.getNotes?.() || []; } catch (_) {}
          for (const nid of noteIDs) {
            const n = Zotero.Items.get(nid);
            if (n?.isNote?.()) await indexNote(n, { force: true });
          }
        }
      }
      state.lastSyncAt = now();
      state.lastError = null;
    } catch (e) {
      state.lastError = e?.message || String(e);
      throw e;
    } finally {
      state.syncing = false;
      if (state.pending.size) setTimeout(() => flushPending().catch(Zotero.logError), 100);
    }
  }

  function registerEmbeddingModelObserver() {
    if (state.modelPrefObserver || typeof Services === "undefined" || !Services.prefs?.addObserver) return;
    state.modelPrefObserver = {
      observe() {
        state.activeModelId = null;
        invalidateVectorWorker();
        setTimeout(() => queueMissingVectors({ limit: 5000 }).catch(e => { state.lastVectorError = e?.message || String(e); }), 250);
      }
    };
    try { Services.prefs.addObserver("extensions.zotero.zotquery.embeddingModel", state.modelPrefObserver); }
    catch (e) { state.modelPrefObserver = null; log(`embedding model observer unavailable: ${e?.message || e}`); }
  }
  function unregisterEmbeddingModelObserver() {
    if (!state.modelPrefObserver || typeof Services === "undefined") return;
    try { Services.prefs.removeObserver("extensions.zotero.zotquery.embeddingModel", state.modelPrefObserver); } catch (_) {}
    state.modelPrefObserver = null;
  }

  function registerNotifier() {
    if (state.notifierID || pref("autoSync", true) === false) return;
    state.notifierID = Zotero.Notifier.registerObserver({
      notify(event, type, ids) {
        if (type !== "item") return;
        if (["add", "modify", "delete", "trash"].includes(event)) enqueue(event, ids);
      }
    }, ["item"], "zotquery-lne-native");
  }

  function parseAdvanced(query) {
    const required = [], excluded = [];
    let rest = String(query || "");
    rest = rest.replace(/(^|\s)([-+])["“”「」]([^"“”「」]{1,80})["“”「」]/g,
      (m, pre, op, phrase) => { (op === "-" ? excluded : required).push(phrase.trim()); return pre; });
    rest = rest.replace(/["“”「」]([^"“”「」]{1,80})["“”「」]/g,
      (m, phrase) => { required.push(phrase.trim()); return " "; });
    rest = rest.replace(/(^|\s)([-+])([^\s"“”「」]{1,60})/g,
      (m, pre, op, term) => { (op === "-" ? excluded : required).push(term.trim()); return pre; });
    const uniq = xs => [...new Set(xs.filter(Boolean))];
    const req = uniq(required);
    const exc = uniq(excluded).filter(e => !req.some(r => r.toLowerCase() === e.toLowerCase()));
    return { required: req, excluded: exc, rest: rest.replace(/\s+/g, " ").trim() };
  }

  function lexicalPlan(query) {
    const q = String(query || "").normalize("NFKC").trim();
    const quoted = [...q.matchAll(/["“”「」]([^"“”「」]{2,})["“”「」]/gu)].map(m => compactSpace(m[1]));
    const unquoted = q.replace(/["“”「」][^"“”「」]+["“”「」]/gu, " ");
    const cjkRuns = unquoted.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/gu) || [];
    const CJK_RX = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
    // Unicode letters are identity-bearing.  Never degrade x42α/mβ7 to
    // x42/12, and never reorder or transliterate their characters.
    const unicodeTerms = (unquoted.toLocaleLowerCase("und").match(/[\p{L}\p{N}][\p{L}\p{N}._+\-\/()]*/gu) || [])
      .filter(t => t.length >= 2 && /\p{L}/u.test(t) && !CJK_RX.test(t) && !ASCII_STOP.has(t));
    const cjkTerms = [], shortTerms = [];
    for (const run of cjkRuns) {
      const chars = [...run];
      if (chars.length < 3) { shortTerms.push(run); continue; }
      if (chars.length >= 4) for (let i = 0; i + 4 <= chars.length; i++) {
        const g = trimGram(chars.slice(i, i + 4).join(""));
        if ([...g].length >= 3 && !isWeakGram(g)) cjkTerms.push(g);
      }
      if (chars.length < 6) for (let i = 0; i + 3 <= chars.length; i++) {
        const g = trimGram(chars.slice(i, i + 3).join(""));
        if ([...g].length >= 3 && !isWeakGram(g)) cjkTerms.push(g);
      }
      const whole = trimGram(run);
      if ([...whole].length >= 3 && [...whole].length <= 10 && !isWeakGram(whole)) cjkTerms.push(whole);
    }
    const cjk4 = cjkTerms.filter(t => [...t].length === 4);
    const cjk3 = cjkTerms.filter(t => [...t].length === 3);
    const cjkWhole = cjkTerms.filter(t => [...t].length > 4);
    const picked = [...new Set([...cjk4, ...cjkWhole])].slice(0, 70);
    for (const t of [...new Set(cjk3)]) { if (picked.length >= 70) break; if (!picked.includes(t)) picked.push(t); }
    const terms = [...new Set([...quoted, ...unicodeTerms, ...picked].map(compactSpace).filter(t => [...t].length >= 2))];
    const hardTerms = [...new Set(terms.filter(isExactIdentifier))];
    return { terms: terms.slice(0, 96), hardTerms, shortTerms: [...new Set(shortTerms)], quoted };
  }
  function lexicalTokens(query) { return lexicalPlan(query).terms; }
  function ftsQuote(term) { return `"${String(term).replace(/"/g, '""')}"`; }
  function buildFTSQuery(query) {
    const plan = lexicalPlan(query);
    const terms = plan.terms;
    if (!terms.length) return { terms: [], expression: "" };
    const expr = terms.map(t => ftsQuote(t)).join(" OR ");
    return { ...plan, expression: expr };
  }

  function zoteroParentForRow(n) { return selectURI(n.parent_library_key, n.parent_item_key); }
  function zoteroNoteForRow(n) { return selectURI(n.library_key, n.note_key); }

  async function find(query, options = {}) {
    await initSchema();
    const top = Math.max(1, Math.min(MAX_FIND_TOP, Number(options.top || 200)));
    const hits = Math.max(1, Math.min(MAX_HITS_PER_NOTE, Number(options.hits || 8)));
    const maxChars = Math.max(100, Math.min(5000, Number(options.maxChars || 1400)));
    const adv = parseAdvanced(query);
    const lexicalBody = adv.rest || query;
    const plan = buildFTSQuery(lexicalBody);
    const rowLimit = Math.min(10000, Math.max(top * hits * 5, 750));
    let rows = [];
    if (plan.expression) {
      rows = await Zotero.DB.queryAsync(`SELECT s.id,s.note_uid,s.hash,s.line_start,s.line_end,s.tag,s.canonical_role,s.heading,s.section_path,s.sec_kind,s.chars,s.text,
        n.parent_library_key,n.parent_item_key,n.note_style,n.profile_id,n.tagged_segs,n.chars AS note_chars,n.parent_title,n.note_title,n.doi,n.is_stub,
        bm25(segments_fts, 1.0, 0.65, 0.35, 0.25) AS bm, 1 AS lexical_hit
        FROM ${DB_ALIAS}.segments_fts f JOIN ${DB_ALIAS}.segments s ON s.id=f.rowid JOIN ${DB_ALIAS}.notes n ON n.note_uid=s.note_uid
        WHERE segments_fts MATCH ? ORDER BY bm ASC LIMIT ?`, [plan.expression, rowLimit]) || [];
    }
    // FTS trigrams cannot represent two-character CJK concepts.  Preserve the
    // v3 literal LIKE fallback so short, specific terms are not silently lost.
    if (plan.shortTerms?.length) {
      const seen = new Set(rows.map(r => Number(r.id)));
      for (const term of plan.shortTerms) {
        const extra = await Zotero.DB.queryAsync(`SELECT s.id,s.note_uid,s.hash,s.line_start,s.line_end,s.tag,s.canonical_role,s.heading,s.section_path,s.sec_kind,s.chars,s.text,
          n.parent_library_key,n.parent_item_key,n.note_style,n.profile_id,n.tagged_segs,n.chars AS note_chars,n.parent_title,n.note_title,n.doi,n.is_stub,
          0 AS bm, 1 AS lexical_hit
          FROM ${DB_ALIAS}.segments s JOIN ${DB_ALIAS}.notes n ON n.note_uid=s.note_uid
          WHERE s.text LIKE ? ESCAPE '\\' LIMIT 600`, [`%${escLike(term)}%`]) || [];
        for (const row of extra) if (!seen.has(Number(row.id))) { seen.add(Number(row.id)); rows.push(row); }
      }
    }

    const dense = await denseTopK(query, { ...options, semantic: options.lexicalOnly ? false : options.semantic });
    const denseMap = new Map((dense.results || []).map(x => [String(x.hash), Number(x.sim)]));
    if (denseMap.size) {
      const have = new Set(rows.map(r => String(r.hash)));
      const missing = [...denseMap.keys()].filter(h => !have.has(h));
      if (missing.length) {
        const ph = missing.map(() => "?").join(",");
        const extra = await Zotero.DB.queryAsync(`SELECT s.id,s.note_uid,s.hash,s.line_start,s.line_end,s.tag,s.canonical_role,s.heading,s.section_path,s.sec_kind,s.chars,s.text,
          n.parent_library_key,n.parent_item_key,n.note_style,n.profile_id,n.tagged_segs,n.chars AS note_chars,n.parent_title,n.note_title,n.doi,n.is_stub,
          0 AS bm, 0 AS lexical_hit
          FROM ${DB_ALIAS}.segments s JOIN ${DB_ALIAS}.notes n ON n.note_uid=s.note_uid WHERE s.hash IN (${ph})`, missing) || [];
        rows.push(...extra);
      }
    }
    rows = rows.map(row => plainRow(row, [
      "id", "note_uid", "hash", "line_start", "line_end", "tag", "canonical_role", "heading", "section_path", "sec_kind", "chars", "text",
      "parent_library_key", "parent_item_key", "note_style", "profile_id", "tagged_segs", "note_chars", "parent_title", "note_title", "doi", "is_stub",
      "bm", "lexical_hit"
    ]));

    // Required/excluded advanced syntax must run after dense recall expansion.
    const req = adv.required.map(x => x.toLowerCase());
    const exc = adv.excluded.map(x => x.toLowerCase());
    if (req.length || exc.length) {
      rows = rows.filter(r => {
        const t = String(r.text || "").toLowerCase();
        return req.every(x => t.includes(x)) && !exc.some(x => t.includes(x));
      });
    }
    if (!rows.length) {
      return { query, mode: dense.used ? "hybrid" : "lexical", queryPlan: { ...plan, advanced: adv }, semantic: dense,
        notes: [], truncation: { returned: 0, top, candidateSegments: 0, truncated: false } };
    }

    const terms = plan.terms.map(normIdentity);
    const hardTerms = (plan.hardTerms || []).map(normIdentity);
    const totalNotes = Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB_ALIAS}.notes`) || 0);
    const termDf = new Map();
    for (const term of new Set([...terms, ...hardTerms])) {
      try {
        const count = Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(DISTINCT s.note_uid)
          FROM ${DB_ALIAS}.segments_fts f JOIN ${DB_ALIAS}.segments s ON s.id=f.rowid
          WHERE segments_fts MATCH ?`, [ftsQuote(term)]) || 0);
        termDf.set(term, count);
      } catch (_) { termDf.set(term, 0); }
    }
    const idf = term => Math.log((totalNotes + 1) / ((termDf.get(term) ?? 0) + 1));
    const isDisc = term => (termDf.get(term) ?? totalNotes) <= totalNotes * DISC_RATIO;
    const isDiscTerm = term => isExactIdentifier(term) || isDisc(term);
    const want = {
      evidence: /依据|证据|证明|实验支持|experiment|evidence|assay|怎么证明|如何证明/i.test(query),
      conclusion: /结论|总结|发现|表明|conclusion|finding|是否说明/i.test(query),
      method: /方法|技术|怎么测|如何测|体系|method|technique|assay/i.test(query),
      conflict: /矛盾|冲突|争议|不一致|相反|conflict|inconsistent|contradict/i.test(query),
    };
    const SEC_W = { conclusion: 0, question: 0, limitation: 0, method: 0, figure: 0, project: 0, body: 0 };
    if (want.conclusion) SEC_W.conclusion = 0.80;
    if (want.method) SEC_W.method = 0.60;
    if (want.conflict) { SEC_W.limitation = 0.70; SEC_W.question = 0.40; }
    if (want.evidence) SEC_W.figure = 0.50;
    const denseSpan = Math.max(1e-6, Number(dense.max || 0) - Number(dense.floor || 0));
    const swRaw = options.semanticWeightPercent === undefined ? Number(pref("semanticWeightPercent", 50)) : Number(options.semanticWeightPercent);
    const semanticWeight = Math.max(0, Math.min(100, Number.isFinite(swRaw) ? swRaw : 50)) / 50;

    const scored = rows.map(r => {
      const textLo = normIdentity(r.text);
      let soft = 0, hardIdf = 0, discHard = 0, anchorIdf = 0, anchorCount = 0;
      const matchTerms = [];
      for (const t of hardTerms) if (textLo.includes(t)) { hardIdf += idf(t); if (isDiscTerm(t)) discHard++; }
      for (const t of terms) if (textLo.includes(t)) {
        soft++;
        if (isDiscTerm(t)) { anchorIdf += idf(t); anchorCount++; }
        if (matchTerms.length < 6) matchTerms.push(t);
      }
      anchorCount += Math.min(2, discHard);
      const bm = Number(r.bm || 0);
      const lexicalBase = Number(r.lexical_hit) ? Math.min(Math.max(-bm, 0), 12) * 0.5 : 0;
      const sim = denseMap.get(String(r.hash)) || 0;
      const denseNorm = sim > 0 && dense.used ? Math.max(0, Math.min(1, (sim - Number(dense.floor || 0)) / denseSpan)) : 0;
      const denseBonus = denseNorm * DENSE_BONUS_MAX * semanticWeight;
      const tagW = noteProfiles().weightForRole(r.canonical_role || "UNKNOWN", noteProfiles().get(r.profile_id) || noteProfiles().get("generic"), want);
      const secW = SEC_W[r.sec_kind || "body"] || 0;
      const lengthPenalty = Math.max(0, (Number(r.chars || 0) - 1200) / 1200) * 0.3;
      const score = lexicalBase + denseBonus + hardIdf * 1.3 + Math.min(anchorIdf, 6) * 0.15
        + Math.min(soft, 12) * 0.04 + tagW + secW + (Number(r.is_stub) ? -2 : 0) - lengthPenalty;
      return { ...r, score, denseSim: sim, denseNorm, soft, hardIdf, discHard, anchorIdf, anchorCount, matchTerms };
    });

    const byNote = new Map();
    for (const r of scored) {
      if (options.evidenceOnly && r.canonical_role !== "OBSERVED_EVIDENCE") continue;
      if (options.hideInference && r.canonical_role === "USER_INFERENCE") continue;
      if (!byNote.has(r.note_uid)) byNote.set(r.note_uid, []);
      byNote.get(r.note_uid).push(r);
    }
    const candidates = [];
    for (const [uid, segs] of byNote) {
      segs.sort((a, b) => b.score - a.score);
      const topSegs = segs.slice(0, Math.max(3, hits));
      const best3 = segs.slice(0, 3);
      const hardIdf = Math.max(0, ...best3.map(x => Number(x.hardIdf || 0)));
      const anchorIdf = Math.max(0, ...best3.map(x => Number(x.anchorIdf || 0)));
      const anchorCount = Math.max(0, ...best3.map(x => Number(x.anchorCount || 0)));
      const discHard = Math.max(0, ...best3.map(x => Number(x.discHard || 0)));
      const bestSoft = best3[0]?.soft || 0;
      const score = best3.reduce((a, x) => a + x.score, 0) / Math.max(1, best3.length)
        + Math.log(1 + segs.length) * 0.35 + hardIdf * 0.4 + Math.min(anchorIdf, 5) * 0.5;
      const n = (await Zotero.DB.queryAsync(`SELECT * FROM ${DB_ALIAS}.notes WHERE note_uid=?`, [uid]))?.[0];
      if (!n) continue;
      if (exc.length && exc.some(x => String(n.parent_title || n.note_title || "").toLowerCase().includes(x))) continue;
      const softNeed = Math.min(4, Math.max(1, Math.ceil(Math.max(1, terms.length) / 2)));
      const tier = (discHard > 0 || anchorCount >= 2) ? "strong"
        : anchorCount >= 1 ? "normal" : (bestSoft >= softNeed ? "weak" : "noise");
      candidates.push({ n, segs, topSegs, score, tier, discHard, hardIdf, anchorIdf, anchorCount, denseMax: Math.max(...segs.map(x => Number(x.denseSim || 0)), 0) });
    }
    candidates.sort((a, b) => b.score - a.score);

    // Collapse two generations of notes for the same parent item unless explicitly requested.
    const dupStyle = ["bar", "pin", "both"].includes(options.dupStyle) ? options.dupStyle : String(pref("duplicateStyle", "bar"));
    let shown = candidates;
    if (dupStyle !== "both" && options.showDup !== true) {
      const groups = new Map();
      for (const p of candidates) {
        const profile = noteProfiles().get(p.n.profile_id);
        const ident = profile?.duplicatePolicy?.enabled && p.n.parent_item_key
          ? `${profile.id}|${p.n.parent_library_key || p.n.library_key}:${p.n.parent_item_key}`
          : p.n.note_uid;
        if (!groups.has(ident)) groups.set(ident, []);
        groups.get(ident).push(p);
      }
      shown = [];
      for (const arr of groups.values()) {
        if (arr.length === 1) { arr[0].siblings = []; shown.push(arr[0]); continue; }
        const preferred = arr.filter(x => x.n.note_style === dupStyle);
        const pool = preferred.length ? preferred : arr;
        const pick = pool.reduce((a, b) => {
          if (Number(b.n.tagged_segs || 0) !== Number(a.n.tagged_segs || 0)) return Number(b.n.tagged_segs || 0) > Number(a.n.tagged_segs || 0) ? b : a;
          if (Number(b.n.chars || 0) !== Number(a.n.chars || 0)) return Number(b.n.chars || 0) > Number(a.n.chars || 0) ? b : a;
          return b.score > a.score ? b : a;
        });
        pick.siblings = arr.filter(x => x !== pick).map(x => ({ noteKey: x.n.note_key, libraryKey: x.n.library_key, style: x.n.note_style, chars: Number(x.n.chars || 0) }));
        shown.push(pick);
      }
      shown.sort((a, b) => b.score - a.score);
    }

    const notes = shown.slice(0, top).map(p => {
      const n = p.n;
      return {
        noteUID: n.note_uid, noteKey: n.note_key, libraryKey: n.library_key, parentLibraryKey: n.parent_library_key,
        zoteroNoteKey: n.note_key, zoteroParentKey: n.parent_item_key, zoteroNote: zoteroNoteForRow(n), zoteroParent: zoteroParentForRow(n),
        title: n.parent_title || n.note_title || "", noteTitle: n.note_title || "", doi: n.doi || "", journal: n.journal || "", year: n.year || "", authors: n.authors || "",
        noteStyle: n.note_style || "none", profileId: n.profile_id || "generic", score: p.score, tier: p.tier, discHard: p.discHard, hardIdf: p.hardIdf,
        anchorIdf: p.anchorIdf, anchorCount: p.anchorCount, denseMax: p.denseMax, siblings: p.siblings || [],
        hits: p.topSegs.slice(0, hits).map(h => ({
          segmentId: Number(h.id), lineStart: Number(h.line_start), lineEnd: Number(h.line_end), tag: h.tag || null, rawTag: h.tag || null, canonicalRole: h.canonical_role || "UNKNOWN",
          heading: h.heading || "", sectionPath: h.section_path || "", text: String(h.text || "").slice(0, maxChars),
          lexicalScore: Number(h.lexical_hit) ? Number(h.bm || 0) : null, semanticScore: Number(h.denseSim || 0), score: Number(h.score || 0), matchTerms: h.matchTerms || []
        }))
      };
    });
    return {
      query,
      mode: dense.used && plan.expression ? "hybrid" : dense.used ? "semantic" : "lexical",
      queryPlan: { ...plan, advanced: adv }, want, semantic: dense,
      notes,
      truncation: { returned: notes.length, top, candidateSegments: rows.length, candidateNotes: candidates.length, collapsed: candidates.length - shown.length, truncated: shown.length > top || rows.length >= rowLimit }
    };
  }

  async function resolveNote(key, libraryKey = null) {
    await initSchema();
    const k = String(key || "").toUpperCase();
    if (!k) return null;
    if (libraryKey) return (await Zotero.DB.queryAsync(`SELECT * FROM ${DB_ALIAS}.notes WHERE library_key=? AND note_key=?`, [libraryKey, k]))?.[0] || null;
    const rows = await Zotero.DB.queryAsync(`SELECT * FROM ${DB_ALIAS}.notes WHERE note_key=? ORDER BY CASE WHEN library_key='user' THEN 0 ELSE 1 END LIMIT 2`, [k]);
    return rows?.[0] || null;
  }
  async function trace(key, options = {}) {
    const n = await resolveNote(key, options.libraryKey || null);
    if (!n) throw new Error(`LNE note not found: ${key}`);
    const lines = String(n.canonical_text || "").split("\n");
    const from = Math.max(1, Number(options.from || 1));
    const requestedTo = options.to === undefined || options.to === null || options.to === "" ? from : Math.max(1, Number(options.to));
    const lo = Math.min(from, requestedTo), hi = Math.max(from, requestedTo);
    const around = Math.max(0, Math.min(100, Number(options.around ?? 3)));
    const start = Math.max(1, lo - around);
    const end = Math.min(lines.length, hi + around);
    const selected = [];
    for (let i = start; i <= end; i++) selected.push({ line: i, text: lines[i - 1] || "" });
    const rawText = lines.slice(lo - 1, Math.min(lines.length, hi)).join("\n");
    const quote = String(options.quote || "").replace(/\s+/g, " ").trim();
    const rawNorm = rawText.replace(/\s+/g, " ").trim();
    const quoteCheck = quote ? { requested: quote, verified: rawNorm.includes(quote), normalizedTarget: rawNorm.slice(0, 500) } : null;
    const cap = Math.max(200, Math.min(20000, Number(options.maxChars || 6000)));
    const clippedRaw = rawText.length > cap ? rawText.slice(0, cap) + "…" : rawText;
    return {
      noteUID: n.note_uid, noteKey: n.note_key, libraryKey: n.library_key,
      title: n.parent_title || n.note_title || "", parentItemKey: n.parent_item_key,
      zoteroNote: zoteroNoteForRow(n), zoteroParent: zoteroParentForRow(n),
      sourceVersion: Number(n.source_version || 0), sourceHash: n.source_hash,
      canonicalHash: n.canonical_hash, requestedLine: from, requestedTo: requestedTo,
      startLine: start, endLine: end, exactStartLine: lo, exactEndLine: Math.min(lines.length, hi),
      citation: `${n.library_key}:${n.note_key}:L${lo}-L${Math.min(lines.length, hi)}`,
      quoteCheck, rawText: clippedRaw,
      lines: selected, text: selected.map(x => `L${x.line}: ${x.text}`).join("\n")
    };
  }
  async function read(key, options = {}) {
    const n = await resolveNote(key, options.libraryKey || null);
    if (!n) throw new Error(`LNE note not found: ${key}`);
    const lines = String(n.canonical_text || "").split("\n");
    const start = Math.max(1, Number(options.startLine || options.from || 1));
    const limit = Math.max(1, Math.min(500, Number(options.limit || 120)));
    const end = Math.min(lines.length, start + limit - 1);
    return {
      noteUID: n.note_uid, noteKey: n.note_key, libraryKey: n.library_key,
      title: n.parent_title || n.note_title || "", startLine: start, endLine: end, totalLines: lines.length,
      nextStartLine: end < lines.length ? end + 1 : null,
      text: lines.slice(start - 1, end).map((x, i) => `L${start + i}: ${x}`).join("\n")
    };
  }
  async function hits(key, query, options = {}) {
    const n = await resolveNote(key, options.libraryKey || null);
    if (!n) throw new Error(`LNE note not found: ${key}`);
    const needle = normIdentity(query);
    if (!needle) return { noteKey: n.note_key, query, queryPlan: { mode: "literal", normalization: "NFKC-casefold" }, hits: [] };
    const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
    const rows = await Zotero.DB.queryAsync(`SELECT id,ord,line_start,line_end,tag,canonical_role,heading,section_path,text
      FROM ${DB_ALIAS}.segments WHERE note_uid=? ORDER BY ord`, [n.note_uid]) || [];
    const literalRows = rows.filter(r => normIdentity(r.text).includes(needle)).slice(0, limit);
    return { noteKey: n.note_key, libraryKey: n.library_key, query,
      queryPlan: { mode: "literal", normalization: "NFKC-casefold", needle, exactCharacterOrder: true }, hits: literalRows.map(r => ({
      segmentId: Number(r.id), lineStart: Number(r.line_start), lineEnd: Number(r.line_end), tag: r.tag || null, rawTag: r.tag || null, canonicalRole: r.canonical_role || "UNKNOWN",
      heading: r.heading || "", sectionPath: r.section_path || "", text: r.text || "", literal: true
    })) };
  }
  async function paper(key, options = {}) {
    const n = await resolveNote(key, options.libraryKey || null);
    if (!n) throw new Error(`LNE note not found: ${key}`);
    const segs = await Zotero.DB.queryAsync(`SELECT id,ord,line_start,line_end,tag,canonical_role,heading,section_path,kind,sec_kind,text FROM ${DB_ALIAS}.segments WHERE note_uid=? ORDER BY ord`, [n.note_uid]);
    return {
      noteUID: n.note_uid, noteKey: n.note_key, libraryKey: n.library_key, parentItemKey: n.parent_item_key,
      title: n.parent_title || n.note_title || "", noteTitle: n.note_title || "", doi: n.doi || "", journal: n.journal || "",
      year: n.year || "", authors: n.authors || "", noteStyle: n.note_style || "none", profileId: n.profile_id || "generic", profileSignature: n.profile_signature || null, zoteroNote: zoteroNoteForRow(n), zoteroParent: zoteroParentForRow(n),
      sourceVersion: Number(n.source_version || 0), sourceHash: n.source_hash, canonicalHash: n.canonical_hash,
      segments: (segs || []).map(s => ({ segmentId: Number(s.id), ord: Number(s.ord), lineStart: Number(s.line_start), lineEnd: Number(s.line_end), tag: s.tag || null, rawTag: s.tag || null, canonicalRole: s.canonical_role || "UNKNOWN", heading: s.heading || "", sectionPath: s.section_path || "", kind: s.kind, sectionKind: s.sec_kind, text: s.text }))
    };
  }

  async function health() {
    try {
      await initSchema();
      const notes = Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB_ALIAS}.notes`) || 0);
      const segments = Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB_ALIAS}.segments`) || 0);
      const uniqueHashes = Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(DISTINCT hash) FROM ${DB_ALIAS}.segments`) || 0);
      const tagged = Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB_ALIAS}.segments WHERE tag IS NOT NULL AND tag<>''`) || 0);
      const model = semanticEnabled() ? await activeEmbeddingModel().catch(() => null) : null;
      let probe = state.queryProbe;
      if (model && (!probe || probe.modelId !== model.id || Date.now() - probe.at > 30000)) {
        try {
          const result = await embeddingAPI().embedText("semantic readiness", { kind: "query" });
          if (!result?.embedding?.length) throw new Error("empty query embedding");
          probe = { modelId: model.id, at: Date.now(), ready: true, error: null };
          state.lastVectorError = null;
        } catch (e) {
          probe = { modelId: model.id, at: Date.now(), ready: false, error: e?.message || String(e) };
          state.lastVectorError = probe.error;
        }
        state.queryProbe = probe;
      }
      const vectors = model ? Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB_ALIAS}.segment_vectors WHERE model_id=?`, [model.id]) || 0) : 0;
      const coverage = uniqueHashes ? vectors / uniqueHashes : 0;
      return {
        ok: !state.lastError, product: "ZotQuery Core", version: VERSION, schemaVersion: SCHEMA_VERSION,
        parserVersion: PARSER_VERSION, canonicalizerVersion: CANON_VERSION, source: "zotero-notes",
        database: PathUtils.join(Zotero.DataDirectory.dir, DB_FILE), notes, segments, uniqueSegmentHashes: uniqueHashes, taggedSegments: tagged,
        semantic: {
          enabled: semanticEnabled(), configured: !!model, available: !!probe?.ready, queryReady: !!probe?.ready,
          queryProbeAt: probe?.at ? new Date(probe.at).toISOString() : null,
          queryError: probe?.error || null, modelId: model?.id || null, dimensions: model?.dimensions || 0,
          vectors, totalUniqueSegments: uniqueHashes, coverage, coveragePercent: Math.round(coverage * 10000) / 100,
          pending: state.vectorPending.size, indexing: state.vectorSyncing, workerLoaded: !!state.vectorWorker,
          workerModelId: state.vectorWorkerModelId, lastSyncAt: state.lastVectorSyncAt, lastError: state.lastVectorError
        },
        autoSync: !!pref("autoSync", true), pending: state.pending.size, syncing: state.syncing,
        lastSyncAt: state.lastSyncAt, lastError: state.lastError
      };
    } catch (e) {
      return { ok: false, product: "ZotQuery Core", version: VERSION, error: e?.message || String(e) };
    }
  }

  async function startup({ rootURI } = {}) {
    if (state.started) return;
    state.rootURI = rootURI || null;
    await initSchema();
    registerNotifier();
    registerEmbeddingModelObserver();
    state.started = true;
    // Do not block Zotero startup on a full note scan.
    setTimeout(() => reconcile({ force: false }).then(r => log(`startup reconcile: ${JSON.stringify(r)}`)).catch(e => { state.lastError = e?.message || String(e); Zotero.logError(e); }), 1500);
    log(`started ${VERSION}`);
  }
  async function shutdown() {
    if (state.timer) clearTimeout(state.timer);
    if (state.vectorTimer) clearTimeout(state.vectorTimer);
    state.timer = null;
    state.vectorTimer = null;
    terminateVectorWorker();
    unregisterEmbeddingModelObserver();
    if (state.notifierID) {
      try { Zotero.Notifier.unregisterObserver(state.notifierID); } catch (_) {}
      state.notifierID = null;
    }
    try { if (state.attached) await Zotero.DB.queryAsync(`DETACH DATABASE ${DB_ALIAS}`); } catch (_) {}
    state.attached = false;
    state.started = false;
  }

  const api = {
    version: VERSION,
    health, reconcile,
    refresh: () => reconcile({ force: false }),
    rebuild: () => reconcile({ force: true }),
    refreshSemantic: () => queueMissingVectors({ limit: 5000 }),
    find, trace, hits, read, paper,
    _canonicalizeNoteHTML: canonicalizeNoteHTML,
    _parseCanonical: parseCanonical,
    _makeCJKGrams: makeCJKGrams,
    _parseAdvanced: parseAdvanced,
    _lexicalPlan: lexicalPlan,
    _normIdentity: normIdentity,
    _isExactIdentifier: isExactIdentifier,
    _denseTopK: denseTopK,
  };

  Zotero.ZotQueryLNE = { api, startup, shutdown, version: VERSION };
  global.ZotQueryLNEBootstrap = { startup, shutdown };
})(typeof _globalThis !== "undefined" ? _globalThis : this);
