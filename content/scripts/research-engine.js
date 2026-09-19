/* ZotQuery Evidence 3.0.12
 * Evidence Engine layered on the Search component.
 * Keeps normal search/indexing intact while adding exhaustive lexical
 * passage enumeration, semantic-union retrieval, adaptive context, LNE bridge,
 * persistent review sessions, coverage gates, REST and unified MCP.
 */
"use strict";

(() => {
  const VERSION = "3.0.12";
  const DB = "zotquery";
  const RDB = "zotqueryresearch";
  const RFILE = "zotquery-research.sqlite";
  const PREFIX = "[ZotQuery Evidence]";
  const ENDPOINTS = [
    "/zotquery/health",
    "/zotquery/lexical",
    "/zotquery/plan",
    "/zotquery/context",
    "/zotquery/sweep",
    "/zotquery/session",
    "/zotquery/positions",
    "/zotquery/document",
    "/zotquery/review",
    "/zotquery/fact",
    "/zotquery/resolve",
    "/zotquery/verify-note",
    "/zotquery/finalize",
    "/zotquery/mcp",
  ];
  let started = false;
  const AUTH_PREF = "zotquery.research.authToken";
  let authToken = null;

  const log = (...x) => Zotero.debug(`${PREFIX} ${x.map(v => typeof v === "string" ? v : JSON.stringify(v)).join(" ")}`);
  const now = () => new Date().toISOString();
  const num = (v, d, lo, hi) => {
    const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  const bool = (v, d=false) => v == null || v === "" ? d : [true,1,"1","true","yes","on"].includes(typeof v === "string" ? v.toLowerCase() : v);
  const jres = (status, body) => [status, "application/json", JSON.stringify(body)];
  const headerValue = (req, name) => req?.headers?.get?.(name) || req?.headers?.[name] || req?.headers?.[name.toLowerCase()] || req?.headers?.[name.toUpperCase()] || "";
  const localOnly = req => {
    const origin = String(headerValue(req,"Origin")), host = String(headerValue(req,"Host"));
    return (!origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) &&
      (!host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host));
  };
  function ensureAuthToken() {
    if (authToken) return authToken;
    const saved = String(Zotero.Prefs.get(AUTH_PREF, true) || "");
    if (/^[0-9a-f-]{70,80}$/i.test(saved)) return authToken = saved;
    return rotateAuthToken();
  }
  function rotateAuthToken() {
    if (!Services?.uuid?.generateUUID) throw new Error("Secure local token generator is unavailable");
    const fresh = `${Services.uuid.generateUUID()}${Services.uuid.generateUUID()}`.replace(/[{}]/g, "");
    Zotero.Prefs.set(AUTH_PREF, fresh, true);
    return authToken = fresh;
  }
  function authorized(req) {
    if (!localOnly(req)) return false;
    const header = String(headerValue(req,"Authorization"));
    const match = /^Bearer ([0-9a-f-]{70,80})$/i.exec(header);
    return !!match && match[1] === ensureAuthToken();
  }
  const qstr = req => req?.searchParams;
  const activeModel = () => {
    const info = Zotero.ZotQuery?.api?.getEmbeddingModel?.();
    const id = String(info?.activeModelId || info?.id || "");
    if (!id) throw new Error("ZotQuery shared embedding model is unavailable");
    return id;
  };
  const rid = () => `rs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  // Position identity must be scoped to the research session.  A global
  // source/work/locator key caused a later sweep to silently move evidence out
  // of older sessions through INSERT OR REPLACE.
  const positionId = (sessionId, source, workKey, locator) => `${sessionId}:${source}:${workKey}:${locator}`;
  const factId = () => `fr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  function zoteroItemLink(libraryKey, key, target = "select", pageNumber = null) {
    const itemKey = String(key || "").toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(itemKey)) return null;
    const library = libraryKey === "user" ? "library" : /^group:\d+$/.test(String(libraryKey)) ? `groups/${String(libraryKey).slice(6)}` : null;
    if (!library) return null;
    const base = `zotero://${target}/${library}/items/${itemKey}`;
    return target === "open-pdf" ? Number.isInteger(pageNumber) && pageNumber > 0 ? `${base}?page=${pageNumber}` : null : base;
  }
  async function singlePdfAttachmentKey(libraryKey, parentKey) {
    try {
      const libraryID = libraryKey === "user" ? Zotero.Libraries.userLibraryID : Zotero.Groups.getLibraryIDFromGroupID(Number(String(libraryKey).slice(6)));
      if (libraryID == null) return null;
      const parentID = Zotero.Items.getIDFromLibraryAndKey(libraryID, parentKey);
      const parent = parentID ? await Zotero.Items.getAsync(parentID) : null;
      const ids = parent?.getAttachments?.() || [];
      if (!ids.length) return null;
      const attachments = await Zotero.Items.getAsync(ids);
      const pdfs = (attachments || []).filter(item => item?.attachmentMIMEType === "application/pdf" && /^[A-Z0-9]{8}$/i.test(String(item.key || "")));
      return pdfs.length === 1 ? String(pdfs[0].key).toUpperCase() : null;
    } catch (_) { return null; }
  }
  async function sourceLinks(locator) {
    const libraryKey = locator?.libraryKey, itemKey = locator?.itemKey, noteKey = locator?.noteKey;
    const parent = zoteroItemLink(libraryKey, itemKey);
    const note = zoteroItemLink(libraryKey, noteKey);
    const page = Number(locator?.pageNumber);
    const attachmentKey = parent && Number.isInteger(page) && page > 0 ? await singlePdfAttachmentKey(libraryKey, itemKey) : null;
    const pdfPage = attachmentKey ? zoteroItemLink(libraryKey, attachmentKey, "open-pdf", page) : null;
    return { parent, note, pdfPage, attachmentKey, precision: pdfPage ? "pdf-page" : note ? "note-item-plus-lines" : parent ? "parent-item" : "locator-only" };
  }

  async function ensureZotQuery() {
    if (!Zotero.ZotQuery?.vectorStore) throw new Error("ZotQuery core is unavailable");
    await Zotero.ZotQuery.vectorStore.ensureInit();
  }

  async function attachResearchDB() {
    const list = await Zotero.DB.queryAsync("PRAGMA database_list");
    if (list?.some(r => r.name === RDB)) return;
    const path = PathUtils.join(Zotero.DataDirectory.dir, RFILE);
    await Zotero.DB.queryAsync(`ATTACH DATABASE ? AS ${RDB}`, [path]);
  }

  async function ensureResearchSchema() {
    await attachResearchDB();
    await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${RDB}.sessions (
      session_id TEXT PRIMARY KEY, question TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, status TEXT NOT NULL, query_json TEXT,
      lexical_complete INTEGER NOT NULL DEFAULT 0, semantic_complete INTEGER NOT NULL DEFAULT 0,
      lne_complete INTEGER NOT NULL DEFAULT 0, notes TEXT
    )`);
    await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${RDB}.positions (
      position_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, source TEXT NOT NULL,
      work_key TEXT NOT NULL, library_key TEXT, item_key TEXT, title TEXT,
      chunk_index INTEGER, page_number INTEGER, paragraph_index INTEGER,
      note_key TEXT, line_start INTEGER, line_end INTEGER,
      match_kind TEXT, match_score REAL, preview TEXT,
      review_status TEXT NOT NULL DEFAULT 'unreviewed', context_level INTEGER NOT NULL DEFAULT 0,
      evidence_scope TEXT, supports_question TEXT, reason TEXT, evidence_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${RDB}.idx_positions_session ON positions(session_id)`);
    await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${RDB}.idx_positions_work ON positions(work_key)`);
    await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${RDB}.idx_positions_review ON positions(session_id, review_status)`);
    const positionColumns = new Set((await Zotero.DB.queryAsync(`PRAGMA ${RDB}.table_info(positions)`))?.map(r => r.name) || []);
    if (!positionColumns.has("evidence_hint")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN evidence_hint TEXT`);
    if (!positionColumns.has("evidence_priority")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN evidence_priority INTEGER NOT NULL DEFAULT 50`);
    if (!positionColumns.has("listed_at")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN listed_at TEXT`);
    if (!positionColumns.has("context_read_at")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN context_read_at TEXT`);
    if (!positionColumns.has("same_parent_pdf_status")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN same_parent_pdf_status TEXT`);
    if (!positionColumns.has("same_parent_pdf_json")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN same_parent_pdf_json TEXT`);
    if (!positionColumns.has("coverage_required")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN coverage_required INTEGER NOT NULL DEFAULT 1`);
    if (!positionColumns.has("position_role")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN position_role TEXT NOT NULL DEFAULT 'evidence'`);
    if (!positionColumns.has("cluster_id")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN cluster_id TEXT`);
    if (!positionColumns.has("should_match_count")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN should_match_count INTEGER NOT NULL DEFAULT 0`);
    if (!positionColumns.has("query_match_json")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.positions ADD COLUMN query_match_json TEXT`);
    await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${RDB}.idx_positions_priority ON positions(session_id, evidence_priority)`);
    await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${RDB}.idx_positions_coverage ON positions(session_id, coverage_required, review_status)`);
    await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${RDB}.idx_positions_cluster ON positions(session_id, cluster_id)`);
    const sessionColumns = new Set((await Zotero.DB.queryAsync(`PRAGMA ${RDB}.table_info(sessions)`))?.map(r => r.name) || []);
    if (!sessionColumns.has("question_mode")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.sessions ADD COLUMN question_mode TEXT NOT NULL DEFAULT 'STANDARD'`);
    if (!sessionColumns.has("fact_request_json")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.sessions ADD COLUMN fact_request_json TEXT`);
    if (!sessionColumns.has("reading_policy")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.sessions ADD COLUMN reading_policy TEXT NOT NULL DEFAULT 'ALL_POSITIONS'`);
    if (!sessionColumns.has("require_semantic")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.sessions ADD COLUMN require_semantic INTEGER NOT NULL DEFAULT 0`);
    if (!sessionColumns.has("require_lne")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.sessions ADD COLUMN require_lne INTEGER NOT NULL DEFAULT 0`);
    if (!sessionColumns.has("coverage_version")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.sessions ADD COLUMN coverage_version TEXT NOT NULL DEFAULT 'v1'`);
    if (!sessionColumns.has("survey_id")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.sessions ADD COLUMN survey_id TEXT`);
    if (!sessionColumns.has("orchestration_required")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.sessions ADD COLUMN orchestration_required INTEGER NOT NULL DEFAULT 0`);
    if (!sessionColumns.has("orchestration_json")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.sessions ADD COLUMN orchestration_json TEXT`);
    await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${RDB}.document_chunks_listed (
      session_id TEXT NOT NULL, work_key TEXT NOT NULL, chunk_index INTEGER NOT NULL,
      listed_at TEXT NOT NULL, PRIMARY KEY(session_id,work_key,chunk_index)
    )`);
    await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${RDB}.fact_records (
      fact_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, position_id TEXT NOT NULL,
      slot TEXT NOT NULL, entity TEXT, value_text TEXT NOT NULL, normalized_value TEXT NOT NULL,
      value_type TEXT, unit TEXT, numbering TEXT, evidence_status TEXT NOT NULL,
      source_quote TEXT NOT NULL, locator_json TEXT NOT NULL, notes TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${RDB}.idx_facts_session ON fact_records(session_id)`);
    await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${RDB}.fact_resolutions (
      session_id TEXT NOT NULL, conflict_key TEXT NOT NULL, resolution TEXT NOT NULL,
      selected_fact_id TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(session_id, conflict_key)
    )`);
    const resolutionColumns = new Set((await Zotero.DB.queryAsync(`PRAGMA ${RDB}.table_info(fact_resolutions)`))?.map(r => r.name) || []);
    if (!resolutionColumns.has("resolution_position_id")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.fact_resolutions ADD COLUMN resolution_position_id TEXT`);
    if (!resolutionColumns.has("resolution_quote")) await Zotero.DB.queryAsync(`ALTER TABLE ${RDB}.fact_resolutions ADD COLUMN resolution_quote TEXT`);
  }

  async function ensureFTS(force=false) {
    await ensureZotQuery();
    await Zotero.DB.queryAsync(`CREATE VIRTUAL TABLE IF NOT EXISTS ${DB}.chunks_fts USING fts5(
      chunk_text, item_pk UNINDEXED, chunk_index UNINDEXED, model_id UNINDEXED,
      tokenize='unicode61 remove_diacritics 2'
    )`);
    await Zotero.DB.queryAsync(`CREATE TRIGGER IF NOT EXISTS ${DB}.research_chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(chunk_text,item_pk,chunk_index,model_id)
      VALUES (new.chunk_text,new.item_pk,new.chunk_index,new.model_id);
    END`);
    await Zotero.DB.queryAsync(`CREATE TRIGGER IF NOT EXISTS ${DB}.research_chunks_ad AFTER DELETE ON chunks BEGIN
      DELETE FROM chunks_fts WHERE item_pk=old.item_pk AND chunk_index=old.chunk_index AND model_id=old.model_id;
    END`);
    await Zotero.DB.queryAsync(`CREATE TRIGGER IF NOT EXISTS ${DB}.research_chunks_au AFTER UPDATE ON chunks BEGIN
      DELETE FROM chunks_fts WHERE item_pk=old.item_pk AND chunk_index=old.chunk_index AND model_id=old.model_id;
      INSERT INTO chunks_fts(chunk_text,item_pk,chunk_index,model_id)
      VALUES (new.chunk_text,new.item_pk,new.chunk_index,new.model_id);
    END`);
    const model = activeModel();
    const c = Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB}.chunks WHERE model_id=? AND chunk_text IS NOT NULL`, [model]) || 0);
    const f = Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB}.chunks_fts WHERE model_id=?`, [model]) || 0);
    if (force || c !== f) {
      log(`Rebuilding FTS mirror for ${model}: chunks=${c}, fts=${f}`);
      await Zotero.DB.executeTransaction(async () => {
        await Zotero.DB.queryAsync(`DELETE FROM ${DB}.chunks_fts WHERE model_id=?`, [model]);
        await Zotero.DB.queryAsync(`INSERT INTO ${DB}.chunks_fts(chunk_text,item_pk,chunk_index,model_id)
          SELECT chunk_text,item_pk,chunk_index,model_id FROM ${DB}.chunks
          WHERE model_id=? AND chunk_text IS NOT NULL`, [model]);
      });
    }
    const papers = Number(await Zotero.DB.valueQueryAsync(
      `SELECT COUNT(DISTINCT item_pk) FROM ${DB}.chunks WHERE model_id=?`, [model]
    ) || 0);
    const chunksWithLocation = Number(await Zotero.DB.valueQueryAsync(
      `SELECT COUNT(*) FROM ${DB}.chunks WHERE model_id=? AND page_number IS NOT NULL`, [model]
    ) || 0);
    const lastIndexed = await Zotero.DB.valueQueryAsync(
      `SELECT MAX(indexed_at) FROM ${DB}.item_models WHERE model_id=?`, [model]
    );
    return { model, chunks:c, fts:c, papers, chunksWithLocation, lastIndexed:lastIndexed || null };
  }

  async function countEligiblePapers() {
    const scope = String(Zotero.Prefs.get("zotquery.indexScope", true) || "user");
    const excludeBooks = Zotero.Prefs.get("zotquery.excludeBooks", true) !== false;
    const excludeTag = String(Zotero.Prefs.get("zotquery.excludeTag", true) || "zotquery-exclude");
    const libraries = scope === "all"
      ? (Zotero.Libraries.getAll?.() || []).filter(l => l.libraryType !== "feed")
      : [Zotero.Libraries.get(Zotero.Libraries.userLibraryID)];
    let total = 0;
    for (const library of libraries) {
      const libraryID = library?.libraryID ?? library?.id;
      if (!libraryID) continue;
      const items = await Zotero.Items.getAll(libraryID);
      for (const item of items || []) {
        if (!item?.isRegularItem?.()) continue;
        const typeName = Zotero.ItemTypes.getName(item.itemTypeID);
        if (excludeBooks && typeName === "book") continue;
        if (excludeTag && item.getTags?.().some(t => t?.tag === excludeTag)) continue;
        total++;
      }
    }
    return total;
  }

  // ---------- Generic Query Contract v2 ----------
  // Core rule: domain knowledge may be supplied explicitly as alias groups, but
  // the Research Engine itself contains no field-specific gene/drug/motif preset.
  // Meaningful user surface forms may never be silently deleted.
  const STOP_WORDS = new Set([
    "what","which","where","when","why","how","does","do","did","is","are","was","were","the","a","an","of","to","in","on","for","and","or","with","from","by","as","this","that","these","those","about","between","versus","vs","define","defined","constitute","contains","include","including","show","find","known","effect","effects","role","study","studies","paper","papers","evidence","result","results"
  ]);
  const uniq = xs => [...new Set((xs||[]).filter(Boolean).map(x=>String(x).trim()).filter(Boolean))];
  const normSurface = s => String(s||"").normalize("NFKC").replace(/[‐‑‒–—−]/g,"-").trim();
  const normKey = s => normSurface(s).toLowerCase();
  const stripOuterQuotes = s => normSurface(s).replace(/^["“”「」']+|["“”「」']+$/g,"").trim();
  const ftsQuote = s => `"${stripOuterQuotes(s).replace(/"/g,'""')}"`;
  function normalizeGroup(g, index=0, fallbackRole="SHOULD") {
    if (typeof g === "string") return {id:`g${index+1}`, aliases:[stripOuterQuotes(g)], role:fallbackRole};
    if (Array.isArray(g)) return {id:`g${index+1}`, aliases:uniq(g.map(stripOuterQuotes)), role:fallbackRole};
    const aliases=uniq([...(g?.aliases||[]),...(g?.terms||[]),...(g?.values||[])].map(stripOuterQuotes));
    return {id:String(g?.id||g?.name||`g${index+1}`),aliases,role:String(g?.role||fallbackRole).toUpperCase(),source:g?.source||null};
  }
  function dedupeGroups(groups) {
    const seen=new Set(),out=[];
    for(const g0 of groups||[]){const normalized=normalizeGroup(g0,out.length),g=(g0&&typeof g0==="object"&&!Array.isArray(g0))?{...g0,...normalized}:normalized;if(!g.aliases.length)continue;const key=g.aliases.map(normKey).sort().join("|");if(seen.has(key))continue;seen.add(key);out.push(g);}return out;
  }
  function parseQuerySyntax(question) {
    let rest=String(question||""); const must=[],mustNot=[],braceGroups=[];
    // {a|b|c}: one required alias group (OR inside, AND between groups).
    rest=rest.replace(/\{([^{}]{1,400})\}/g,(m,body)=>{const terms=uniq(body.split("|").map(stripOuterQuotes));if(terms.length)braceGroups.push({id:`brace${braceGroups.length+1}`,aliases:terms,role:"MUST",source:"brace"});return " ";});
    // +/- quoted phrases first. Operators count only at line start/after whitespace,
    // preserving identifiers such as drug-1234, IL-6 and C2+.
    rest=rest.replace(/(^|\s)([-+])["“”「」]([^"“”「」]{1,160})["“”「」]/g,(m,pre,op,t)=>{(op==="-"?mustNot:must).push(t.trim());return pre;});
    // Bare quoted phrase is required, matching the LNE-side Google syntax.
    rest=rest.replace(/["“”「」]([^"“”「」]{1,160})["“”「」]/g,(m,t)=>{must.push(t.trim());return " ";});
    rest=rest.replace(/(^|\s)([-+])([^\s"“”「」]{1,120})/g,(m,pre,op,t)=>{(op==="-"?mustNot:must).push(t.trim());return pre;});
    return {must:uniq(must),mustNot:uniq(mustNot),braceGroups,rest:rest.replace(/\s+/g," ").trim()};
  }
  function meaningfulTokens(text) {
    return uniq(String(text||"").normalize("NFKC")
      .replace(/[,:;!?()[\]{}<>，。；：！？、]/g," ")
      // A scientific identifier adjacent to Chinese prose is still its own token.
      .replace(/(?<=[\p{Script=Latin}\p{Script=Greek}\d])(?=\p{Script=Han})|(?<=\p{Script=Han})(?=[\p{Script=Latin}\p{Script=Greek}])/gu," ")
      .split(/\s+/).map(t=>t.replace(/^[.]+|[.]+$/g,"").trim())
      .filter(t=>t && t.length>=2 && !STOP_WORDS.has(t.toLowerCase())));
  }
  function identifierType(term) {
    const t=normSurface(term);
    if(/^10\.\d{4,9}\//i.test(t))return"doi";
    if(/^[A-Z]\d{1,5}[A-Z*]$/.test(t))return"mutation";
    if(/^[A-Z]\d{1,5}$/.test(t))return"residue";
    if(/^(?:p\.)?\p{L}[\p{L}]*\d{1,5}(?:[\p{L}*]+)?$/iu.test(t))return"identifier";
    if(/\p{L}/u.test(t)&&/\d/.test(t)&&/[-_]/.test(t))return"compound_or_identifier";
    if(/\p{L}/u.test(t)&&/\d/.test(t))return"identifier";
    if(/^(?:IC50|EC50|GI50|LC50|KD|KI|KM|VMAX)$/i.test(t))return"measurement_type";
    if(/^\d+(?:\.\d+)?\s*(?:pM|nM|uM|µM|mM|M|ng\/mL|ug\/mL|mg\/mL|s|min|h|hr|day|days)$/i.test(t))return"measurement";
    return null;
  }
  function genericAliases(term) {
    const t=normSurface(term),out=[t];
    const pairs=[["α","alpha"],["β","beta"],["γ","gamma"],["δ","delta"]];
    for(const [g,w] of pairs){if(t.includes(g))out.push(t.replaceAll(g,w));if(new RegExp(w,"i").test(t))out.push(t.replace(new RegExp(w,"ig"),g));}
    return uniq(out);
  }
  function identifierIdentityAudit(terms) {
    const ids=uniq((terms||[]).filter(t=>identifierType(t)));
    const canon=s=>normSurface(s).toLocaleLowerCase("und");
    const bag=s=>[...canon(s)].sort().join("");
    const warnings=[];
    for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
      if(canon(ids[i])!==canon(ids[j])&&bag(ids[i])===bag(ids[j]))warnings.push({
        terms:[ids[i],ids[j]],kind:"same-characters-different-order",
        action:"keep-separate-and-require-explicit-identity-evidence"
      });
    }
    return{normalization:"NFKC for comparison only; original surfaces retained",characterOrder:"identity-significant",automaticAsciiDegradationAliases:false,fuzzySimilarityMayEstablishIdentity:false,warnings};
  }
  function assertNoConfusableAliasGroups(groups) {
    for(const g of groups||[]){const audit=identifierIdentityAudit(g.aliases||[]);if(audit.warnings.length){const p=audit.warnings[0];throw new Error(`Confusable identifiers cannot share one alias group: ${p.terms.join(" vs ")}. Keep them in separate MUST groups and provide explicit identity evidence if they are scientifically equivalent.`);}}
  }
  function expandByAliasRegistry(term, aliasGroups) {
    const key=normKey(term);
    for(const g of aliasGroups||[])if(g.aliases.some(a=>normKey(a)===key))return uniq(g.aliases.flatMap(genericAliases));
    return genericAliases(term);
  }
  function groupExpr(g){const terms=uniq((g?.aliases||[]).map(stripOuterQuotes));return terms.length?`(${terms.map(ftsQuote).join(" OR ")})`:"";}
  function expressionFromGroups(mustGroups,mustNot=[]) {
    const positive=(mustGroups||[]).map(groupExpr).filter(Boolean);
    if(!positive.length)return"";
    let expr=positive.join(" AND ");
    const neg=uniq(mustNot).map(ftsQuote);
    if(neg.length)expr=`(${expr}) NOT (${neg.join(" OR ")})`;
    return expr;
  }
  async function expressionStats(expression,{libraryKey=null,itemKey=null,modelId=null}={}) {
    if(!expression)return{matches:0,papers:0}; await ensureFTS(false); const model=modelId||activeModel();
    const whereLib=`${libraryKey?" AND i.library_key = ?":""}${itemKey?" AND i.item_key = ?":""}`;
    const args=[expression,model,...(libraryKey?[libraryKey]:[]),...(itemKey?[itemKey]:[])];
    const r=(await Zotero.DB.queryAsync(`SELECT COUNT(*) matches,COUNT(DISTINCT i.item_pk) papers FROM ${DB}.chunks_fts f JOIN ${DB}.items i ON i.item_pk=f.item_pk WHERE chunks_fts MATCH ? AND f.model_id=?${whereLib}`,args))?.[0]||{};
    return{matches:Number(r.matches||0),papers:Number(r.papers||0)};
  }
  function genericEvidenceHint(text) {
    const t=String(text||"").replace(/[\[\]]/g,"").replace(/\s+/g," ");
    if(/\b(?:IC50|EC50|GI50|LC50)\b/i.test(t)&&/\d/.test(t))return{scope:"DOSE_RESPONSE",method:null,priority:5,warning:null};
    if(/\b(?:Kd|Ki|Km|Vmax)\b/i.test(t)&&/\d/.test(t))return{scope:"BINDING_OR_KINETIC_RESULT",method:null,priority:6,warning:null};
    if(/\b(?:SPR|surface plasmon resonance|BLI|biolayer interferometry|ITC|isothermal titration calorimetry)\b/i.test(t))return{scope:"BINDING_RESULT",method:null,priority:8,warning:null};
    if(/\b(?:HDX|hydrogen.?deuterium|deuterium exchange)\b/i.test(t))return{scope:"REGION_MAPPING",method:"HDX_MS",priority:10,warning:null};
    if(/(?:Δ|delta|deletion|truncat|construct|mutant construct|residues?\s+\d{1,5}\s*(?:-|–|—|to)\s*\d{1,5})/i.test(t))return{scope:"CONSTRUCT_DEFINITION",method:null,priority:12,warning:null};
    if(/\b(?:cryo-?EM|crystal structure|X-ray|NMR|structure of|helix|strand|loop|domain)\b/i.test(t))return{scope:"STRUCTURE_OBSERVATION",method:null,priority:14,warning:null};
    if(/\b(?:motif|sequence|residue|residues|amino acid|position)\b/i.test(t)&&/\d/.test(t))return{scope:"SEQUENCE_OR_RESIDUE_DEFINITION",method:null,priority:15,warning:null};
    if(/\b\d+(?:\.\d+)?\s*(?:pM|nM|uM|µM|mM|M|ng\/mL|ug\/mL|mg\/mL|ms|s|min|h|hr|days?|Å|nm|µm|um)\b/i.test(t))return{scope:"QUANTITATIVE_MEASUREMENT",method:null,priority:16,warning:null};
    if(/\b(?:increased|decreased|reduced|enhanced|inhibited|activated|abolished|required for|resulted in|we found|we observed)\b/i.test(t))return{scope:"EXPERIMENT_RESULT",method:null,priority:22,warning:null};
    if(/\b(?:suggest|propose|we believe|consistent with|indicate that|may explain)\b/i.test(t))return{scope:"AUTHOR_INTERPRETATION",method:null,priority:30,warning:null};
    if(/\b(?:methods?|protocol|incubat|transfect|purif|expressed in|assay was performed)\b/i.test(t))return{scope:"METHOD",method:null,priority:35,warning:null};
    return{scope:"BACKGROUND_OR_OTHER",method:null,priority:50,warning:null};
  }
  function prioritizeEvidenceHint(hint,requested=[]) {
    const wanted=new Set((requested||[]).map(x=>String(x).toUpperCase()));
    const matched=wanted.has(String(hint?.scope||"").toUpperCase())||wanted.has(String(hint?.method||"").toUpperCase());
    return{...(hint||{}),requestedEvidenceTypeMatch:matched,priority:matched?Math.max(0,Number(hint?.priority??50)-10):Number(hint?.priority??50)};
  }

  function inferQuestionMode(question, requested="AUTO") {
    const explicit=String(requested||"AUTO").toUpperCase();
    if(explicit==="STANDARD" || explicit==="EXACT")return explicit;
    return /(?:residue|sequence|motif|boundary|range|position|numbering|concentration|dose|time|distance|copy\s*number|\bK[dDiI]\b|\bIC50\b|\bEC50\b|\bKi\b|\bKd\b|残基|序列|范围|边界|浓度|剂量|时间|距离|拷贝数)/i.test(String(question||"")) ? "EXACT" : "STANDARD";
  }
  function defaultFactRequest(question, mode) {
    if(mode!=="EXACT")return null;
    const q=String(question||""),slots=[];
    const add=(id,type)=>{if(!slots.some(s=>s.id===id))slots.push({id,type,required:true});};
    if(/sequence|amino\s+acid\s+sequence|序列/i.test(q))add("sequence","sequence");
    if(/motif|基序/i.test(q))add("functional_motif","functional_motif");
    if(/construct|构建体|克隆边界/i.test(q))add("construct_boundary","construct_boundary");
    else if(/resolved|structure.{0,12}(?:range|boundary)|解析|结构.{0,8}(?:范围|边界)/i.test(q))add("structure_resolved_range","structure_resolved_range");
    else if(/helix|sheet|secondary.structure|螺旋|折叠|二级结构/i.test(q))add("secondary_structure_range","secondary_structure_range");
    else if(/residue|position|numbering|boundary|range|残基|位置|编号|边界|范围/i.test(q))add("residue_range","residue_range");
    if(/\b(?:Kd|Ki|IC50|EC50)\b/i.test(q))add("quantitative_measurement","quantitative_measurement");
    if(!slots.length)add("answer","exact_value");
    return{factType:slots[0].type,requestedField:"value",slots,answerRequiresDirectSource:true,allowInferenceAsFinalAnswer:false};
  }
  const FACT_TYPES=new Set(["naming_equivalence","construct_boundary","structure_resolved_range","secondary_structure_range","functional_motif","mutation_site","hdx_peptide","sequence","sequence_alignment","homology_mapping","quantitative_measurement","mechanism","other","exact_value","residue_range","binding_or_activity_value"]);
  const INTERVAL_FACT_TYPES=new Set(["construct_boundary","structure_resolved_range","secondary_structure_range","functional_motif","mutation_site","hdx_peptide","residue_range"]);
  function normalizedFactSlots(request){
    const slots=Array.isArray(request?.slots)?request.slots:[];
    return slots.map((s,i)=>({id:String(s?.id||s?.slot||`slot-${i+1}`).trim(),type:String(s?.type||s?.valueType||"other").trim(),required:s?.required!==false})).filter(s=>s.id);
  }
  function supportedDirectFact(f){return f?.evidence_status==="DIRECT"&&directValueSupported(f.value_text,f.source_quote)&&f.source_review_status==="reviewed"&&f.source_supports_question==="yes";}
  function factSlotClosure(request,facts){
    const slots=normalizedFactSlots(request),direct=(facts||[]).filter(supportedDirectFact);
    const detail=slots.map(s=>{const matched=direct.filter(f=>f.slot===s.id&&(!s.type||s.type==="other"||f.value_type===s.type));return{...s,closed:matched.length>0,directFactIds:matched.map(f=>f.fact_id)};});
    return{declared:slots.length,required:detail.filter(s=>s.required).length,closedRequired:detail.filter(s=>s.required&&s.closed).length,openRequired:detail.filter(s=>s.required&&!s.closed).map(s=>({id:s.id,type:s.type})),slots:detail,allRequiredClosed:detail.filter(s=>s.required).every(s=>s.closed)};
  }
  function crossTypeIntervalWarnings(facts){
    const groups=new Map();
    for(const f of facts||[]){if(f.evidence_status!=="DIRECT"||!INTERVAL_FACT_TYPES.has(f.value_type))continue;const k=[f.entity||"",f.normalized_value||"",f.numbering||""].join("|").toLowerCase();if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f);}
    const out=[];for(const [key,list] of groups){const types=[...new Set(list.map(f=>f.value_type))];if(types.length>1)out.push({key,value:list[0].value_text,types,factIds:list.map(f=>f.fact_id),warning:"The same interval was recorded under different evidence types; these boundaries are not interchangeable without an explicit source-supported mapping."});}return out;
  }
  function normalizeFactValue(value, valueType="") {let s=String(value??"").trim().replace(/[‐‑‒–—−]/g,"-").replace(/\s+/g," ");if(/range|residue/i.test(valueType))s=s.replace(/\s*(?:-|to)\s*/gi,"-");return s.toLowerCase();}
  function normalizeQuote(value){return String(value||"").normalize("NFKC").replace(/[‐‑‒–—−]/g,"-").replace(/\s+/g," ").trim().toLowerCase();}
  function directValueSupported(value, quote) {
    const v = normalizeQuote(value), q = normalizeQuote(quote);
    if (!v || !q) return false;
    let at = -1;
    while ((at = q.indexOf(v, at + 1)) >= 0) {
      const left = at === 0 ? "" : q[at - 1], right = q[at + v.length] || "";
      const first = v[0], last = v[v.length - 1];
      if ((!/[\p{L}\p{N}]/u.test(first) || !/[\p{L}\p{N}]/u.test(left)) &&
          (!/[\p{L}\p{N}]/u.test(last) || !/[\p{L}\p{N}]/u.test(right))) return true;
    }
    return false;
  }
  async function pdfChunkText(position) {
    if (position?.source !== "pdf" || position.chunk_index == null) return null;
    const pk=await Zotero.DB.valueQueryAsync(`SELECT item_pk FROM ${DB}.items WHERE library_key=? AND item_key=?`,[position.library_key,position.item_key]);
    return pk==null?null:await Zotero.DB.valueQueryAsync(`SELECT chunk_text FROM ${DB}.chunks WHERE item_pk=? AND model_id=? AND chunk_index=?`,[Number(pk),activeModel(),Number(position.chunk_index)]);
  }

  async function planEvidenceQuery({question,aliases=[],aliasGroups=[],mustGroups=[],shouldGroups=[],mustNot=[],evidenceTypeHints=[],libraryKey=null,itemKey=null,maxRawPositions=2500,autoTighten=true,querySpec=null}={}) {
    await ensureFTS(false); question=String(question||"").trim(); if(!question)throw new Error("question is required");
    const spec=querySpec&&typeof querySpec==="object"?querySpec:{};
    const syntax=parseQuerySyntax(question);
    const registry=dedupeGroups([
      ...(aliasGroups||[]).map(g=>typeof g==="object"&&!Array.isArray(g)&&g.role?g:{...(Array.isArray(g)?{aliases:g}:{...(typeof g==="string"?{aliases:[g]}:g)}),role:"MUST"}),...(spec.aliasGroups||[]).map(g=>typeof g==="object"&&!Array.isArray(g)&&g.role?g:{...(Array.isArray(g)?{aliases:g}:{...(typeof g==="string"?{aliases:[g]}:g)}),role:"MUST"}),
      ...(aliases?.length?[{id:"flat-aliases",aliases,role:"SHOULD",source:"caller"}]:[])
    ]);
    const fixedMust=[...syntax.must.map((t,i)=>({id:`explicit${i+1}`,aliases:expandByAliasRegistry(t,registry),role:"MUST",source:"syntax"})),...syntax.braceGroups];
    const explicitMust=[...(mustGroups||[]),...(spec.mustGroups||[])].map((g,i)=>({...normalizeGroup(g,i,"MUST"),role:"MUST"}));
    const explicitShould=[...(shouldGroups||[]),...(spec.shouldGroups||[])].map((g,i)=>({...normalizeGroup(g,i,"SHOULD"),role:"SHOULD"}));
    const tokens=meaningfulTokens(syntax.rest);
    const identityPolicy=identifierIdentityAudit(tokens);
    const surfaceGroups=tokens.map((t,i)=>({id:`surface${i+1}`,aliases:expandByAliasRegistry(t,registry),role:"SHOULD",source:"surface",surface:t,identifierType:identifierType(t)}));
    assertNoConfusableAliasGroups([...registry,...fixedMust,...explicitMust,...explicitShould,...surfaceGroups]);
    for(const rg of registry){if(rg.role==="MUST")fixedMust.push({...rg,source:rg.source||"alias-registry"});else if(rg.role==="SHOULD"&&!tokens.some(t=>rg.aliases.some(a=>normKey(a)===normKey(t))))explicitShould.push({...rg,source:rg.source||"alias-registry"});}
    let must=dedupeGroups([...fixedMust,...explicitMust]);
    let should=dedupeGroups([...explicitShould,...surfaceGroups]);
    // A caller-specified hard contract owns the retrieval universe. Question
    // surface forms remain visible as SHOULD, but cannot silently add ANDs.
    const explicitHardContract=must.length>0||registry.some(g=>g.role==="MUST");
    const negatives=uniq([...syntax.mustNot,...(mustNot||[]),...(spec.mustNot||[])]);
    // Confusable reordered identifiers are independent identities. Promote each
    // surface to its own MUST group; never combine them through fuzzy similarity.
    if(identityPolicy.warnings.length&&!explicitHardContract){
      const guarded=new Set(identityPolicy.warnings.flatMap(x=>x.terms.map(normKey)));
      for(const g of should.filter(g=>g.surface&&guarded.has(normKey(g.surface)))){
        if(!must.some(m=>m.aliases.some(a=>normKey(a)===normKey(g.surface))))must.push({...g,role:"MUST",source:"confusable-identity-guard",autoPromoted:true});
      }
      must=dedupeGroups(must);should=should.filter(g=>!g.surface||!guarded.has(normKey(g.surface)));
    }
    // A shorter family shorthand already contained in a full identifier is
    // context, not a third independent hard requirement. Co-occurrence asks
    // intersect independent identities; pure comparisons retrieve their union.
    if(!explicitHardContract){
      const protectedGroups=should.filter(g=>g.surface&&g.identifierType&&g.identifierType!=="measurement_type"&&g.identifierType!=="measurement");
      const maximal=protectedGroups.filter(g=>!protectedGroups.some(other=>{
        if(other===g)return false;
        const short=normKey(g.surface),long=normKey(other.surface);
        return long.startsWith(short)&&/^(?:[-_.]?\p{L}|\*)/u.test(long.slice(short.length));
      }));
      const comparison=/(?:\b(?:vs\.?|versus|compared?\s+(?:with|to))\b|比较|对比|相比)/i.test(question);
      const joint=/(?:并存|共现|共同|同时|共存|co-?occur|coexist|together|\bboth\b)/i.test(question);
      if(comparison&&!joint&&maximal.length>1&&!must.length){
        must.push({id:"auto-comparison-identifiers",aliases:uniq(maximal.flatMap(g=>g.aliases)),role:"MUST",source:"comparison-union",autoPromoted:true});
      }else for(const g of maximal){
        if(!must.some(m=>m.aliases.some(a=>normKey(a)===normKey(g.surface))))must.push({...g,role:"MUST",source:"protected-identity",autoPromoted:true});
      }
      must=dedupeGroups(must);
      const protectedKeys=new Set(must.flatMap(g=>g.aliases.map(normKey)));
      should=should.filter(g=>!g.surface||!protectedKeys.has(normKey(g.surface)));
    }
    // Remove groups already represented in MUST from SHOULD.
    const mustKeys=new Set(must.flatMap(g=>g.aliases.map(normKey))); should=should.filter(g=>!g.aliases.some(a=>mustKeys.has(normKey(a))));
    const preflight=[];
    async function statsFor(ms){const expression=expressionFromGroups(ms,negatives);const stats=await expressionStats(expression,{libraryKey,itemKey});return{expression,...stats};}
    // No explicit hard predicate: protected identifiers outrank generic rare words.
    // This prevents protected identifiers from disappearing behind a rare adjective.
    if(!must.length&&should.length){
      const candidates=should.slice(0,16);
      const anchorPriority=t=>t==="doi"?0:t==="compound_or_identifier"?1:(t==="mutation"||t==="residue")?2:t==="identifier"?3:t==="measurement_type"?4:t==="measurement"?5:9;
      const minP=Math.min(...candidates.map(g=>anchorPriority(g.identifierType)));
      let pool=candidates.filter(g=>anchorPriority(g.identifierType)===minP),best=null;
      // Multiple compounds or multiple mutation/residue labels are normally alternatives
      // in comparison/motif questions, so preserve them as one OR anchor group.
      if((minP===1||minP===2)&&pool.length>1){
        const merged={id:minP===1?"auto-compound-identifiers":"auto-sequence-identifiers",aliases:uniq(pool.flatMap(g=>g.aliases)),role:"MUST",source:"auto-protected-anchor",identifierType:minP===1?"compound_or_identifier":"mutation_or_residue",autoPromoted:true};
        const mst=await statsFor([merged]);preflight.push({groupId:merged.id,aliases:merged.aliases,identifierType:merged.identifierType,...mst});best={g:merged,st:mst,consumed:new Set(pool.map(g=>g.id))};
      }else{
        for(const g of pool){const gst=await statsFor([g]);preflight.push({groupId:g.id,aliases:g.aliases,identifierType:g.identifierType||null,...gst});if(gst.matches>0&&(!best||gst.matches<best.st.matches))best={g,gst,st:gst,consumed:new Set([g.id])};}
      }
      if(!best){const g=pool[0]||candidates[0],gst=await statsFor([g]);best={g,gst,st:gst,consumed:new Set([g.id])};}
      must=[{...best.g,role:"MUST",autoPromoted:true,source:best.g.source||"auto-anchor"}]; should=should.filter(g=>!best.consumed.has(g.id));
    }
    let st=await statsFor(must);
    const ceiling=num(maxRawPositions,2500,50,1000000);
    if(autoTighten!==false&&!explicitHardContract&&must.length<=1&&st.matches>ceiling&&should.length){
      const pool=should.slice(0,16); let guard=0;
      while(st.matches>ceiling&&pool.length&&guard++<4){
        let best=null;
        for(const g of pool){const trial=await statsFor([...must,g]);preflight.push({groupId:g.id,aliases:g.aliases,withCurrentMust:true,...trial});if(trial.matches>0&&trial.matches<st.matches&&(!best||trial.matches<best.st.matches))best={g,st:trial};}
        if(!best)break;
        must.push({...best.g,role:"MUST",autoPromoted:true,source:"auto-tighten"});should=should.filter(g=>g.id!==best.g.id);pool.splice(pool.findIndex(g=>g.id===best.g.id),1);st=best.st;
      }
    }
    const surfaceAudit=[];
    for(const x of syntax.must)surfaceAudit.push({text:x,role:"MUST",reason:"explicit + or quoted phrase"});
    for(const g of syntax.braceGroups)surfaceAudit.push({text:`{${g.aliases.join("|")}}`,role:"MUST",reason:"explicit alias group"});
    for(const x of negatives)surfaceAudit.push({text:x,role:"MUST_NOT",reason:"explicit exclusion"});
    for(const t of tokens){const mg=must.find(g=>g.aliases.some(a=>normKey(a)===normKey(t)));surfaceAudit.push({text:t,role:mg?"MUST":"SHOULD",reason:mg?(mg.source||"auto anchor"):(identifierType(t)?`protected ${identifierType(t)}`:"meaningful surface term")});}
    const hardExpression=st.expression||expressionFromGroups(must,negatives);
    const plan={version:"query-contract-v2",originalQuestion:question,preset:null,planType:"must-groups-and/aliases-or",mustGroups:must,shouldGroups:should,mustNot:negatives,evidenceTypeHints:uniq([...(evidenceTypeHints||[]),...(spec.evidenceTypeHints||[])]),hardExpression,rawMatches:st.matches,papers:st.papers,maxRawPositions:ceiling,requiresRefinement:st.matches>ceiling,autoPromotedGroups:must.filter(g=>g.autoPromoted).map(g=>g.id),surfaceAudit,droppedTerms:[],preflight,identityPolicy,libraryKey:libraryKey||null,itemKey:itemKey||null};
    plan.lneQuery=[...must.filter(g=>g.aliases.length===1).map(g=>`+"${g.aliases[0].replace(/"/g,'')}"`),...must.filter(g=>g.aliases.length>1).flatMap(g=>g.aliases.slice(0,6)),...should.slice(0,12).flatMap(g=>g.aliases.slice(0,2)),...negatives.map(x=>`-"${x.replace(/"/g,'')}"`)].join(" ").trim()||question;
    return plan;
  }
  function planPublic(plan){return{version:plan.version,planType:plan.planType,preset:plan.preset,mustGroups:plan.mustGroups,shouldGroups:plan.shouldGroups,mustNot:plan.mustNot,evidenceTypeHints:plan.evidenceTypeHints||[],hardExpression:plan.hardExpression,rawMatches:plan.rawMatches,papers:plan.papers,maxRawPositions:plan.maxRawPositions,requiresRefinement:plan.requiresRefinement,autoPromotedGroups:plan.autoPromotedGroups,surfaceAudit:plan.surfaceAudit,droppedTerms:plan.droppedTerms,identityPolicy:plan.identityPolicy,lneQuery:plan.lneQuery};}
  function shouldMatchInfo(text,plan){const t=normKey(text),matched=[];for(const g of plan?.shouldGroups||[]){if(g.aliases.some(a=>t.includes(normKey(a))))matched.push(g.id);}return{count:matched.length,groups:matched};}

  async function lexicalSearch({query, aliases=[], aliasGroups=[], mustGroups=[], shouldGroups=[], mustNot=[], evidenceTypeHints=[], queryPlan=null, preset=null, maxRawPositions=2500, autoTighten=true, limit=500, offset=0, libraryKey=null, itemKey=null, modelId=null}) {
    await ensureFTS(false); const model=modelId||activeModel();
    const plan=queryPlan||await planEvidenceQuery({question:query,aliases,aliasGroups,mustGroups,shouldGroups,mustNot,evidenceTypeHints,libraryKey,itemKey,preset,maxRawPositions,autoTighten});
    const expr=plan.hardExpression;
    if(!expr)return{query,totalMatches:0,offset,limit,complete:true,results:[],queryPlan:planPublic(plan)};
    const whereLib=`${libraryKey?" AND i.library_key = ?":""}${itemKey?" AND i.item_key = ?":""}`;
    const baseArgs=[expr,model,...(libraryKey?[libraryKey]:[]),...(itemKey?[itemKey]:[])];
    const total=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB}.chunks_fts f JOIN ${DB}.items i ON i.item_pk=f.item_pk WHERE chunks_fts MATCH ? AND f.model_id=?${whereLib}`,baseArgs)||0);
    const rows=await Zotero.DB.queryAsync(`SELECT i.library_key,i.item_key,i.title,f.chunk_index,c.page_number,c.paragraph_index,c.text_source,c.chunk_text,snippet(chunks_fts,0,'[',']',' … ',28) AS snippet,bm25(chunks_fts) AS bm25score FROM ${DB}.chunks_fts f JOIN ${DB}.items i ON i.item_pk=f.item_pk JOIN ${DB}.chunks c ON c.item_pk=f.item_pk AND c.chunk_index=f.chunk_index AND c.model_id=f.model_id WHERE chunks_fts MATCH ? AND f.model_id=?${whereLib} ORDER BY bm25score ASC,i.item_pk,f.chunk_index LIMIT ? OFFSET ?`,[...baseArgs,num(limit,500,1,2000),num(offset,0,0,10000000)]);
    return{query,expression:expr,queryPlan:planPublic(plan),modelId:model,totalMatches:total,offset:num(offset,0,0,10000000),limit:num(limit,500,1,2000),nextOffset:offset+rows.length<total?offset+rows.length:null,complete:offset+rows.length>=total,results:(rows||[]).map(r=>{const snippet=r.snippet||"",full=`${r.title||""}\n${r.chunk_text||snippet}`,soft=shouldMatchInfo(full,plan);return{source:"pdf",libraryKey:r.library_key,itemKey:r.item_key,workKey:`${r.library_key}:${r.item_key}`,title:r.title,chunkIndex:Number(r.chunk_index),pageNumber:r.page_number==null?null:Number(r.page_number),paragraphIndex:r.paragraph_index==null?null:Number(r.paragraph_index),textSource:r.text_source,snippet,lexicalScore:Number(r.bm25score||0),shouldMatchCount:soft.count,shouldMatchedGroups:soft.groups,matchKind:"lexical",evidenceHint:prioritizeEvidenceHint(genericEvidenceHint(full,plan.preset),plan.evidenceTypeHints)};})};
  }

  async function context({libraryKey, itemKey, chunkIndex, before=2, after=2, modelId=null}) {
    await ensureZotQuery();
    const model = modelId || activeModel();
    const pk = await Zotero.DB.valueQueryAsync(`SELECT item_pk FROM ${DB}.items WHERE library_key=? AND item_key=?`, [libraryKey,itemKey]);
    if (!pk) throw new Error(`Indexed item not found: ${libraryKey}:${itemKey}`);
    const lo = Math.max(0, Number(chunkIndex)-num(before,2,0,50));
    const hi = Number(chunkIndex)+num(after,2,0,50);
    const rows = await Zotero.DB.queryAsync(`SELECT chunk_index,chunk_text,text_source,page_number,paragraph_index,start_char,end_char
      FROM ${DB}.chunks WHERE item_pk=? AND model_id=? AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index`, [Number(pk),model,lo,hi]);
    const item = await Zotero.DB.queryAsync(`SELECT title,was_truncated,pages_indexed,pages_total FROM ${DB}.items WHERE item_pk=?`, [Number(pk)]);
    const combinedText=(rows||[]).map(r=>r.chunk_text||"").join("\n");
    return {
      libraryKey,itemKey,workKey:`${libraryKey}:${itemKey}`,title:item?.[0]?.title||"",modelId:model,
      targetChunk:Number(chunkIndex), before:num(before,2,0,50), after:num(after,2,0,50),
      indexStatus:{wasTruncated:!!item?.[0]?.was_truncated,pagesIndexed:Number(item?.[0]?.pages_indexed||0),pagesTotal:Number(item?.[0]?.pages_total||0)},
      chunks:(rows||[]).map(r=>({chunkIndex:Number(r.chunk_index),text:r.chunk_text||"",textSource:r.text_source,pageNumber:r.page_number==null?null:Number(r.page_number),paragraphIndex:r.paragraph_index==null?null:Number(r.paragraph_index),startChar:r.start_char,endChar:r.end_char,target:Number(r.chunk_index)===Number(chunkIndex)})),
      text:(rows||[]).map(r=>`[chunk ${r.chunk_index}${r.page_number?`, p.${r.page_number}`:""}]\n${r.chunk_text||""}`).join("\n\n"),
      evidenceHint:genericEvidenceHint(`${item?.[0]?.title||""}\n${combinedText}`)
    };
  }

  async function lneFind(query, {top=500,hits=8}={}) {
    if(!Zotero.ZotQueryLNE?.api?.find) throw new Error("Native LNE API is unavailable");
    return Zotero.ZotQueryLNE.api.find(query,{top,hits,maxChars:1400});
  }

  function noteIdentity(n) {
    const directKey=String(n?.zoteroParentKey||n?.parentItemKey||"").toUpperCase();
    const directLibrary=String(n?.parentLibraryKey||n?.libraryKey||"");
    if(directKey&&directLibrary)return{libraryKey:directLibrary,itemKey:directKey};
    let m=String(n?.zoteroParent||"").match(/^zotero:\/\/select\/library\/items\/([A-Z0-9]{8})/i);
    if(m)return{libraryKey:"user",itemKey:m[1].toUpperCase()};
    m=String(n?.zoteroParent||"").match(/^zotero:\/\/select\/groups\/(\d+)\/items\/([A-Z0-9]{8})/i);
    if(m)return{libraryKey:`group:${m[1]}`,itemKey:m[2].toUpperCase()};
    return directKey?{libraryKey:"user",itemKey:directKey}:null;
  }

  async function semanticSearch(query,{limit=500,minSimilarity=0.30,libraryKey=null,preset=null,evidenceTypeHints=[]}={}) {
    if(!Zotero.ZotQuery?.api?.search) return {completeAboveThreshold:false, results:[], error:"ZotQuery JS API unavailable"};
    // JS API is not constrained by the public MCP's 100-result clamp.
    const rows = await Zotero.ZotQuery.api.search(query,{topK:num(limit,500,1,5000),minSimilarity:num(minSimilarity,.30,0,1),returnAllChunks:true});
    const out=[];
    for(const r of rows||[]) {
      const item=r.itemId?Zotero.Items.get(r.itemId):null;
      let lk="user";
      try { const lib=Zotero.Libraries.get(item?.libraryID); if(lib?.libraryType==="group") lk=`group:${lib.groupID}`; } catch {}
      if(libraryKey && lk!==libraryKey) continue;
      const ik=String(r.itemKey||item?.key||"").toUpperCase(); if(!ik)continue;
      const title=r.title||item?.getField?.("title")||"", snippet=r.chunkText||"";
      out.push({source:"pdf",libraryKey:lk,itemKey:ik,workKey:`${lk}:${ik}`,title,chunkIndex:r.chunkIndex??r.matchedChunkIndex??null,pageNumber:r.pageNumber??null,paragraphIndex:r.paragraphIndex??null,snippet,semanticScore:Number(r.similarity||0),matchKind:"semantic",evidenceHint:prioritizeEvidenceHint(genericEvidenceHint(`${title}\n${snippet}`,preset),evidenceTypeHints)});
    }
    return {threshold:minSimilarity,requestedLimit:limit,returned:out.length,completeAboveThreshold:out.length < limit,results:out};
  }

  function mergeCandidates(sessionId,...lists) {
    const map=new Map();
    for(const list of lists)for(const p of list||[]){
      const locator=p.source==="pdf"?`c${p.chunkIndex??"x"}`:`n${p.noteKey||"x"}:${p.lineStart||0}-${p.lineEnd||0}`;
      const id=positionId(sessionId,p.source,p.workKey,locator);
      if(!map.has(id))map.set(id,{...p,positionId:id,matchKinds:[]});
      const x=map.get(id);if(p.matchKind&&!x.matchKinds.includes(p.matchKind))x.matchKinds.push(p.matchKind);
      if((p.semanticScore||0)>(x.semanticScore||0))x.semanticScore=p.semanticScore;
      x.shouldMatchCount=Math.max(Number(x.shouldMatchCount||0),Number(p.shouldMatchCount||0));
      x.shouldMatchedGroups=uniq([...(x.shouldMatchedGroups||[]),...(p.shouldMatchedGroups||[])]);
      if(!x.preview)x.preview=p.preview||p.snippet||"";
      const hint=p.evidenceHint||genericEvidenceHint(`${p.title||""}\n${p.preview||p.snippet||""}`);
      if(!x.evidenceHint||hint.priority<x.evidenceHint.priority)x.evidenceHint=hint;
    }
    return[...map.values()];
  }
  function assignCoverageRoles(candidates,{readingPolicy="QUERY_EXHAUSTIVE",clusterGap=1,preset=null}={}) {
    const policy=String(readingPolicy||"QUERY_EXHAUSTIVE").toUpperCase();
    const out=candidates.map(x=>({...x,coverageRequired:false,positionRole:x.source==="note"?"navigation-note":"navigation-semantic",clusterId:null}));
    if(policy==="ALL_POSITIONS")return out.map((x,i)=>({...x,coverageRequired:true,positionRole:"all-position",clusterId:`all-${i+1}`}));
    const byWork=new Map();
    for(const x of out){if(x.source!=="pdf"||!(x.matchKinds||[]).includes("lexical"))continue;if(!byWork.has(x.workKey))byWork.set(x.workKey,[]);byWork.get(x.workKey).push(x);}
    let ci=0;
    for(const [workKey,rows] of byWork){rows.sort((a,b)=>(a.chunkIndex??1e9)-(b.chunkIndex??1e9));let cluster=[];const flush=()=>{if(!cluster.length)return;ci++;const cid=`ec-${ci}`;for(const x of cluster)x.clusterId=cid;const rep=[...cluster].sort((a,b)=>(b.shouldMatchCount||0)-(a.shouldMatchCount||0)||(a.evidenceHint?.priority??50)-(b.evidenceHint?.priority??50)||(a.lexicalScore??0)-(b.lexicalScore??0))[0];rep.coverageRequired=true;rep.positionRole="evidence-cluster-representative";for(const x of cluster)if(x!==rep)x.positionRole="duplicate-cluster-member";cluster=[];};
      let prev=null;for(const x of rows){if(prev!=null&&x.chunkIndex!=null&&prev!=null&&Number(x.chunkIndex)-Number(prev)>num(clusterGap,1,0,5))flush();cluster.push(x);prev=x.chunkIndex;}flush();
    }
    return out;
  }

  async function runSweep({question,aliases=[],aliasGroups=[],mustGroups=[],shouldGroups=[],mustNot=[],evidenceTypeHints=[],includeSemantic=true,requireSemantic=false,semanticLimit=500,minSimilarity=.30,libraryKey=null,includeLNE=true,requireLNE=false,questionMode="AUTO",factRequest=null,readingPolicy="QUERY_EXHAUSTIVE",preset=null,maxRawPositions=2500,allowLargeSweep=false,autoTighten=true,clusterGap=1,querySpec=null}={}) {
    await ensureResearchSchema();await ensureFTS(false);
    const plan=await planEvidenceQuery({question,aliases,aliasGroups,mustGroups,shouldGroups,mustNot,evidenceTypeHints,libraryKey,preset,maxRawPositions,autoTighten,querySpec});
    if(plan.requiresRefinement&&!allowLargeSweep)return{sessionId:null,blockedBeforeSweep:true,question,queryPlan:planPublic(plan),reason:`Hard lexical predicate still matches ${plan.rawMatches} positions across ${plan.papers} papers, above maxRawPositions=${plan.maxRawPositions}. Add a quoted/+ MUST term, {alias|group}, mustGroups, or exclusions; or explicitly set allowLargeSweep=true.`,next:"Call evidence_plan with a narrower contract or provide explicit mustGroups/aliasGroups."};
    const sessionId=rid(),ts=now(),mode=inferQuestionMode(question,questionMode),request=factRequest||defaultFactRequest(question,mode);
    const p0=String(readingPolicy||"QUERY_EXHAUSTIVE").toUpperCase();const policy=["QUERY_EXHAUSTIVE","ALL_POSITIONS","FULL_TEXT_CANDIDATES"].includes(p0)?p0:"QUERY_EXHAUSTIVE";
    const stored={queryContract:planPublic(plan),options:{aliases,aliasGroups,mustGroups,shouldGroups,mustNot,evidenceTypeHints,includeSemantic,requireSemantic,semanticLimit,minSimilarity,libraryKey,includeLNE,requireLNE,preset,maxRawPositions,autoTighten,clusterGap}};
    await Zotero.DB.queryAsync(`INSERT INTO ${RDB}.sessions (session_id,question,created_at,updated_at,status,query_json,question_mode,fact_request_json,reading_policy,require_semantic,require_lne,coverage_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[sessionId,question,ts,ts,"retrieving",JSON.stringify(stored),mode,request?JSON.stringify(request):null,policy,requireSemantic?1:0,requireLNE?1:0,"v2"]);
    let lex,sem={results:[],completeAboveThreshold:true},lne={notes:[]},errors={};
    try{lex=await lexicalSearch({query:question,queryPlan:plan,limit:2000,offset:0,libraryKey});let all=[...lex.results],next=lex.nextOffset;while(next!=null){const pg=await lexicalSearch({query:question,queryPlan:plan,limit:2000,offset:next,libraryKey});all.push(...pg.results);next=pg.nextOffset;}lex.results=all;lex.complete=true;lex.totalMatches=all.length;}catch(e){lex={results:[],complete:false,totalMatches:0,queryPlan:planPublic(plan)};errors.lexical=e.message;}
    if(includeSemantic){try{sem=await semanticSearch(question,{limit:semanticLimit,minSimilarity,libraryKey,preset,evidenceTypeHints:plan.evidenceTypeHints});}catch(e){errors.semantic=e.message;sem={results:[],completeAboveThreshold:false};}}
    if(includeLNE){try{lne=await lneFind(plan.lneQuery,{top:500,hits:8});}catch(e){errors.lne=e.message;lne={notes:[]};}}
    const notePositions=[];for(const n of lne.notes||[]){const id=noteIdentity(n);if(!id)continue;for(const h of n.hits||[]){const preview=h.text||h.snippet||"";notePositions.push({source:"note",libraryKey:id.libraryKey,itemKey:id.itemKey,workKey:`${id.libraryKey}:${id.itemKey}`,title:n.title||"",noteKey:n.noteKey,lineStart:h.lineStart??h.line_start??null,lineEnd:h.lineEnd??h.line_end??null,preview,evidenceTag:h.tag||h.evidenceTag||null,matchKind:"lne",evidenceHint:prioritizeEvidenceHint(genericEvidenceHint(`${n.title||""}\n${preview}`,preset),plan.evidenceTypeHints)});}}
    const merged=mergeCandidates(sessionId,lex.results,sem.results,notePositions),candidates=assignCoverageRoles(merged,{readingPolicy:policy,clusterGap,preset});
    await Zotero.DB.executeTransaction(async()=>{for(const p of candidates){const hint=p.evidenceHint||genericEvidenceHint(`${p.title||""}\n${p.preview||p.snippet||""}`,preset);await Zotero.DB.queryAsync(`INSERT OR REPLACE INTO ${RDB}.positions (position_id,session_id,source,work_key,library_key,item_key,title,chunk_index,page_number,paragraph_index,note_key,line_start,line_end,match_kind,match_score,preview,review_status,evidence_hint,evidence_priority,coverage_required,position_role,cluster_id,should_match_count,query_match_json,listed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[p.positionId,sessionId,p.source,p.workKey,p.libraryKey,p.itemKey,p.title||"",p.chunkIndex??null,p.pageNumber??null,p.paragraphIndex??null,p.noteKey??null,p.lineStart??null,p.lineEnd??null,(p.matchKinds||[p.matchKind]).join("+"),p.semanticScore??p.lexicalScore??null,p.preview||p.snippet||"","unreviewed",JSON.stringify(hint),hint.priority??50,p.coverageRequired?1:0,p.positionRole||"navigation",p.clusterId||null,Number(p.shouldMatchCount||0),JSON.stringify({shouldMatchedGroups:p.shouldMatchedGroups||[],matchKinds:p.matchKinds||[p.matchKind]}),null,ts,ts]);}});
    const lneComplete=!includeLNE||(!errors.lne&&!lne?.truncation?.truncated);await Zotero.DB.queryAsync(`UPDATE ${RDB}.sessions SET status='reviewing',updated_at=?,lexical_complete=?,semantic_complete=?,lne_complete=? WHERE session_id=?`,[now(),lex.complete?1:0,sem.completeAboveThreshold?1:0,lneComplete?1:0,sessionId]);
    const reviewUnits=candidates.filter(x=>x.coverageRequired).length,indexStats=await ensureFTS(false);
    return{sessionId,question,questionMode:mode,factRequest:request,readingPolicy:policy,coverageVersion:"v2",queryPlan:planPublic(plan),coverage:{corpus:{indexedPapers:indexStats.papers,indexedChunks:indexStats.chunks,screenedByLexicalIndex:indexStats.papers,screenComplete:true},lexical:{rawMatches:lex.results.length,complete:!!lex.complete,hardExpression:plan.hardExpression},semantic:{requested:!!includeSemantic,required:!!requireSemantic,matches:sem.results.length,threshold:minSimilarity,completeAboveThreshold:!!sem.completeAboveThreshold},lne:{requested:!!includeLNE,required:!!requireLNE,matches:notePositions.length,notesReturned:Number(lne?.truncation?.returned??lne?.notes?.length??0),truncated:!!lne?.truncation?.truncated,complete:lneComplete},rawCandidatePositions:candidates.length,reviewUnits,navigationPositions:candidates.length-reviewUnits,candidatePapers:new Set(candidates.map(x=>x.workKey)).size},errors,next:"Page evidence_positions(scope=coverage) to nextOffset=null; open and review every review unit. Semantic/LNE navigation hits do not expand the gate unless explicitly verified/promoted. EXACT questions also require direct PDF FactRecords."};
  }

  async function documentCoverage(sessionId) {
    const allWorkRows=await Zotero.DB.queryAsync(`SELECT DISTINCT work_key FROM ${RDB}.positions WHERE session_id=? AND coverage_required=1`,[sessionId]);
    const works=await Zotero.DB.queryAsync(`SELECT DISTINCT work_key,library_key,item_key FROM ${RDB}.positions WHERE session_id=? AND source='pdf' AND coverage_required=1`,[sessionId]);
    const pdfWorkKeys=new Set((works||[]).map(w=>w.work_key));
    const unavailablePdfWorks=(allWorkRows||[]).map(w=>w.work_key).filter(k=>!pdfWorkKeys.has(k));
    let totalChunks=0,listedChunks=0,completeWorks=0;
    const details=[];
    for(const w of works||[]){
      const pk=await Zotero.DB.valueQueryAsync(`SELECT item_pk FROM ${DB}.items WHERE library_key=? AND item_key=?`,[w.library_key,w.item_key]);
      const total=pk?Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB}.chunks WHERE item_pk=? AND model_id=?`,[Number(pk),activeModel()])||0):0;
      const listed=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${RDB}.document_chunks_listed WHERE session_id=? AND work_key=?`,[sessionId,w.work_key])||0);
      totalChunks+=total;listedChunks+=Math.min(listed,total);if(total>0&&listed>=total)completeWorks++;
      details.push({workKey:w.work_key,totalChunks:total,listedChunks:Math.min(listed,total),complete:total>0&&listed>=total});
    }
    return {candidateWorks:(allWorkRows||[]).length,candidateDocuments:(works||[]).length,unavailablePdfWorks,unavailablePdfCount:unavailablePdfWorks.length,completeDocuments:completeWorks,totalChunks,listedChunks,allCandidateDocumentsListed:(works||[]).length>0&&completeWorks===(works||[]).length,details};
  }

  async function documentRead(sessionId,workKey,{offset=0,limit=20}={}) {
    await ensureResearchSchema();
    const p=(await Zotero.DB.queryAsync(`SELECT library_key,item_key,title FROM ${RDB}.positions WHERE session_id=? AND work_key=? AND source='pdf' LIMIT 1`,[sessionId,workKey]))?.[0];
    if(!p)throw new Error("Candidate PDF work not found in this session");
    const pk=await Zotero.DB.valueQueryAsync(`SELECT item_pk FROM ${DB}.items WHERE library_key=? AND item_key=?`,[p.library_key,p.item_key]);
    if(!pk)throw new Error("Indexed work not found");
    const pageLimit=num(limit,20,1,50),pageOffset=num(offset,0,0,1e8),model=activeModel();
    const total=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB}.chunks WHERE item_pk=? AND model_id=?`,[Number(pk),model])||0);
    const rows=await Zotero.DB.queryAsync(`SELECT chunk_index,chunk_text,text_source,page_number,paragraph_index FROM ${DB}.chunks WHERE item_pk=? AND model_id=? ORDER BY chunk_index LIMIT ? OFFSET ?`,[Number(pk),model,pageLimit,pageOffset]);
    const stamp=now();
    for(const r of rows||[])await Zotero.DB.queryAsync(`INSERT OR IGNORE INTO ${RDB}.document_chunks_listed(session_id,work_key,chunk_index,listed_at) VALUES(?,?,?,?)`,[sessionId,workKey,Number(r.chunk_index),stamp]);
    const listed=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${RDB}.document_chunks_listed WHERE session_id=? AND work_key=?`,[sessionId,workKey])||0);
    const nextOffset=pageOffset+(rows?.length||0)<total?pageOffset+(rows?.length||0):null;
    return {sessionId,workKey,title:p.title,modelId:model,totalChunks:total,offset:pageOffset,limit:pageLimit,nextOffset,complete:nextOffset==null,listingCoverage:{listedChunks:Math.min(listed,total),unlistedChunks:Math.max(0,total-listed),allChunksListed:total>0&&listed>=total},chunks:(rows||[]).map(r=>({chunkIndex:Number(r.chunk_index),pageNumber:r.page_number==null?null:Number(r.page_number),paragraphIndex:r.paragraph_index==null?null:Number(r.paragraph_index),textSource:r.text_source,text:r.chunk_text||""}))};
  }

  function conflictKeyForFact(f){return [f.slot||"value",f.entity||"",f.value_type||"",f.unit||"",f.numbering||""].join("|").toLowerCase();}

  async function factConflicts(sessionId,facts=null){
    const rows=facts||await Zotero.DB.queryAsync(`SELECT f.*,p.review_status source_review_status,p.supports_question source_supports_question FROM ${RDB}.fact_records f LEFT JOIN ${RDB}.positions p ON p.position_id=f.position_id WHERE f.session_id=?`,[sessionId]);
    const groups=new Map();
    for(const f of rows||[]){if(f.evidence_status!=="DIRECT")continue;const k=conflictKeyForFact(f);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f);}
    const resolutions=await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.fact_resolutions WHERE session_id=?`,[sessionId])||[];
    const resolved=new Set();
    for(const r of resolutions){
      const group=groups.get(r.conflict_key)||[],selected=group.find(f=>f.fact_id===r.selected_fact_id);
      if(!selected||!directValueSupported(selected.value_text,selected.source_quote)||!r.resolution_position_id||!r.resolution_quote)continue;
      try {
        const position=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.positions WHERE position_id=? AND session_id=?`,[r.resolution_position_id,sessionId]))?.[0];
        const source=await pdfChunkText(position);
        const selectedPosition=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.positions WHERE position_id=? AND session_id=?`,[selected.position_id,sessionId]))?.[0];
        const selectedSource=await pdfChunkText(selectedPosition);
        if(position?.context_read_at&&position.position_id!==selected.position_id&&selectedPosition?.review_status==="reviewed"&&selectedPosition.supports_question==="yes"&&source&&selectedSource&&normalizeQuote(selectedSource).includes(normalizeQuote(selected.source_quote))&&normalizeQuote(source).includes(normalizeQuote(r.resolution_quote))&&directValueSupported(selected.value_text,r.resolution_quote))resolved.add(r.conflict_key);
      } catch (_) { /* An unverifiable resolution remains a blocking conflict. */ }
    }
    const out=[];
    for(const [key,list] of groups){const values=[...new Set(list.map(f=>f.normalized_value))];if(values.length>1&&!resolved.has(key))out.push({conflictKey:key,slot:list[0].slot,entity:list[0].entity||null,values,factIds:list.map(f=>f.fact_id)});}
    return out;
  }

  async function recordFact(payload={}){
    await ensureResearchSchema();
    const p=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.positions WHERE position_id=?`,[payload.positionId]))?.[0];if(!p)throw new Error("Unknown position");
    if(!p.context_read_at)throw new Error("Read evidence_context before recording a fact");
    const status=String(payload.evidenceStatus||"DIRECT").toUpperCase();if(!["DIRECT","INFERRED","SECONDARY"].includes(status))throw new Error("Invalid evidenceStatus");
    if(status==="DIRECT"&&p.source!=="pdf")throw new Error("DIRECT facts require an original PDF position; notes are navigation evidence");
    if(status==="DIRECT"&&(p.review_status!=="reviewed"||p.supports_question!=="yes"))throw new Error("Review the PDF position as supporting the question before recording a DIRECT fact");
    const slot=String(payload.slot||"value").trim(),value=String(payload.value??payload.valueText??"").trim(),quote=String(payload.sourceQuote||"").trim();
    if(!slot||!value||!quote)throw new Error("slot, value and sourceQuote are required");
    const canonicalLocator={libraryKey:p.library_key,itemKey:p.item_key,chunkIndex:p.chunk_index,pageNumber:p.page_number,paragraphIndex:p.paragraph_index,noteKey:p.note_key,lineStart:p.line_start,lineEnd:p.line_end};
    const locator=status==="DIRECT"?canonicalLocator:(payload.locator||canonicalLocator);
    if(status==="DIRECT"&&p.page_number==null&&p.chunk_index==null)throw new Error("DIRECT fact requires a stable PDF locator");
    if(status==="DIRECT"){
      const sourceText=await pdfChunkText(p);
      const nq=normalizeQuote(quote),ns=normalizeQuote(sourceText||"");
      if(nq.length<8||!ns.includes(nq))throw new Error("sourceQuote was not found verbatim in the referenced PDF chunk");
      if(!directValueSupported(value,quote))throw new Error("DIRECT value must occur as a bounded literal in sourceQuote; record derived or converted values as INFERRED");
    }
    const id=factId(),ts=now(),valueType=String(payload.valueType||"").trim();
    if(!valueType)throw new Error("valueType is required; exact evidence must declare its biological/evidentiary type");
    if(!FACT_TYPES.has(valueType))throw new Error(`Unsupported valueType: ${valueType}`);
    const sessionRow=(await Zotero.DB.queryAsync(`SELECT fact_request_json FROM ${RDB}.sessions WHERE session_id=?`,[p.session_id]))?.[0];let request=null;try{request=sessionRow?.fact_request_json?JSON.parse(sessionRow.fact_request_json):null;}catch{}
    const declaredSlots=normalizedFactSlots(request),declared=declaredSlots.find(s=>s.id===slot);
    if(declaredSlots.length&&!declared)throw new Error(`slot '${slot}' is not declared by this session's factRequest`);
    if(declared&&declared.type&&declared.type!=="other"&&declared.type!==valueType)throw new Error(`slot '${slot}' requires valueType '${declared.type}', not '${valueType}'`);
    await Zotero.DB.queryAsync(`INSERT INTO ${RDB}.fact_records(fact_id,session_id,position_id,slot,entity,value_text,normalized_value,value_type,unit,numbering,evidence_status,source_quote,locator_json,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,p.session_id,p.position_id,slot,payload.entity||null,value,normalizeFactValue(value,valueType),valueType,payload.unit||null,payload.numbering||null,status,quote,JSON.stringify(locator),payload.notes||null,ts,ts]);
    const newConflictKey=conflictKeyForFact({slot,entity:payload.entity||null,value_type:valueType,unit:payload.unit||null,numbering:payload.numbering||null});
    await Zotero.DB.queryAsync(`DELETE FROM ${RDB}.fact_resolutions WHERE session_id=? AND conflict_key=?`,[p.session_id,newConflictKey]);
    return {ok:true,factId:id,sessionId:p.session_id,conflicts:await factConflicts(p.session_id),slotClosure:factSlotClosure(request,await Zotero.DB.queryAsync(`SELECT f.*,p.review_status source_review_status,p.supports_question source_supports_question FROM ${RDB}.fact_records f LEFT JOIN ${RDB}.positions p ON p.position_id=f.position_id WHERE f.session_id=?`,[p.session_id]))};
  }

  async function resolveFactConflict(sessionId,payload={}){
    const key=String(payload.conflictKey||""),reason=String(payload.reason||"").trim();
    if(!key||reason.length<20)throw new Error("conflictKey and a substantive reason (at least 20 characters) are required");
    const conflicts=await factConflicts(sessionId),conflict=conflicts.find(c=>c.conflictKey===key);if(!conflict)throw new Error("Unknown or already resolved conflict");
    if(!payload.selectedFactId||!conflict.factIds.includes(payload.selectedFactId))throw new Error("Select a DIRECT FactRecord in the conflict group");
    const selected=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.fact_records WHERE fact_id=? AND session_id=?`,[payload.selectedFactId,sessionId]))?.[0];
    if(!selected||!directValueSupported(selected.value_text,selected.source_quote))throw new Error("Selected fact lacks a source-supported DIRECT value");
    const selectedPosition=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.positions WHERE position_id=? AND session_id=?`,[selected.position_id,sessionId]))?.[0];
    if(selectedPosition?.review_status!=="reviewed"||selectedPosition.supports_question!=="yes")throw new Error("Selected DIRECT fact lacks an affirmative PDF review");
    const position=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.positions WHERE position_id=? AND session_id=?`,[payload.resolutionPositionId,sessionId]))?.[0];
    if(position?.source!=="pdf"||!position.context_read_at)throw new Error("Read an original PDF resolution position in this session first");
    if(position.position_id===selected.position_id)throw new Error("Use an independent PDF position to adjudicate this conflict");
    const resolutionQuote=String(payload.resolutionQuote||"").trim(),source=await pdfChunkText(position);
    if(normalizeQuote(resolutionQuote).length<8||!normalizeQuote(source||"").includes(normalizeQuote(resolutionQuote)))throw new Error("resolutionQuote must occur in the referenced PDF chunk");
    if(!directValueSupported(selected.value_text,resolutionQuote))throw new Error("resolutionQuote must explicitly support the selected value");
    await Zotero.DB.queryAsync(`INSERT OR REPLACE INTO ${RDB}.fact_resolutions(session_id,conflict_key,resolution,selected_fact_id,reason,created_at,resolution_position_id,resolution_quote) VALUES(?,?,?,?,?,?,?,?)`,[sessionId,key,"source_adjudicated",payload.selectedFactId,reason,now(),position.position_id,resolutionQuote]);
    return {ok:true,sessionId,remainingConflicts:await factConflicts(sessionId)};
  }

  async function sessionLedger(sessionId) {
    await ensureResearchSchema();const s=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.sessions WHERE session_id=?`,[sessionId]))?.[0];if(!s)throw new Error("Unknown session");
    const rows=await Zotero.DB.queryAsync(`SELECT review_status,COUNT(*) n FROM ${RDB}.positions WHERE session_id=? AND coverage_required=1 GROUP BY review_status`,[sessionId]);const counts={};for(const r of rows||[])counts[r.review_status]=Number(r.n);
    const total=Object.values(counts).reduce((a,b)=>a+b,0),reviewed=total-(counts.unreviewed||0)-(counts.needs_context||0),rawPositions=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${RDB}.positions WHERE session_id=?`,[sessionId])||0),navigationPositions=Math.max(0,rawPositions-total);
    const listed=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${RDB}.positions WHERE session_id=? AND coverage_required=1 AND listed_at IS NOT NULL`,[sessionId])||0),contextRead=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${RDB}.positions WHERE session_id=? AND coverage_required=1 AND context_read_at IS NOT NULL`,[sessionId])||0),works=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(DISTINCT work_key) FROM ${RDB}.positions WHERE session_id=? AND coverage_required=1`,[sessionId])||0),candidateWorks=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(DISTINCT work_key) FROM ${RDB}.positions WHERE session_id=?`,[sessionId])||0);
    const facts=await Zotero.DB.queryAsync(`SELECT f.*,p.review_status source_review_status,p.supports_question source_supports_question FROM ${RDB}.fact_records f LEFT JOIN ${RDB}.positions p ON p.position_id=f.position_id WHERE f.session_id=? ORDER BY f.slot,f.created_at`,[sessionId]),conflicts=await factConflicts(sessionId,facts||[]),doc=await documentCoverage(sessionId);let factRequest=null,queryInfo=null,orchestrationState={};try{factRequest=s.fact_request_json?JSON.parse(s.fact_request_json):null;}catch{}try{queryInfo=s.query_json?JSON.parse(s.query_json):null;}catch{}try{orchestrationState=s.orchestration_json?JSON.parse(s.orchestration_json):{};}catch{}
    const exact=String(s.question_mode||"STANDARD")==="EXACT",unsupportedDirectFacts=(facts||[]).filter(f=>f.evidence_status==="DIRECT"&&!supportedDirectFact(f)).map(f=>f.fact_id),directFacts=(facts||[]).filter(supportedDirectFact).length,slotClosure=factSlotClosure(factRequest,facts||[]),intervalWarnings=crossTypeIntervalWarnings(facts||[]),allReviewed=reviewed===total&&!(counts.unreviewed||0)&&!(counts.needs_context||0)&&!(counts.unresolved||0)&&!(counts.conflicting||0),retrievalComplete=!!s.lexical_complete&&(!s.require_semantic||!!s.semantic_complete)&&(!s.require_lne||!!s.lne_complete),fullTextComplete=String(s.reading_policy||"QUERY_EXHAUSTIVE")!=="FULL_TEXT_CANDIDATES"||doc.allCandidateDocumentsListed;
    const factsComplete=!exact||(slotClosure.declared?slotClosure.allRequiredClosed:directFacts>0);
    const orchestrationComplete=!s.orchestration_required||orchestrationState.promotionComplete===true;
    const allowed=total>0&&listed===total&&contextRead===total&&allReviewed&&retrievalComplete&&fullTextComplete&&factsComplete&&unsupportedDirectFacts.length===0&&conflicts.length===0&&intervalWarnings.length===0&&orchestrationComplete;
    return{sessionId,question:s.question,questionMode:s.question_mode||"STANDARD",factRequest,readingPolicy:s.reading_policy||"QUERY_EXHAUSTIVE",coverageVersion:s.coverage_version||"v1",queryPlan:queryInfo?.queryContract||null,status:s.status,createdAt:s.created_at,updatedAt:s.updated_at,orchestration:{required:!!s.orchestration_required,surveyId:s.survey_id||null,complete:orchestrationComplete,state:orchestrationState},coverage:{rawPositions,reviewUnits:total,navigationPositions,listed,unlisted:Math.max(0,total-listed),allReviewUnitsListed:total>0&&listed===total,contextRead,contextUnread:Math.max(0,total-contextRead),allReviewContextsRead:total>0&&contextRead===total,reviewed,unreviewed:counts.unreviewed||0,needsContext:counts.needs_context||0,conflicting:counts.conflicting||0,unresolved:counts.unresolved||0,papers:works,candidatePapers:candidateWorks,lexicalComplete:!!s.lexical_complete,semanticRequired:!!s.require_semantic,semanticCompleteAboveThreshold:!!s.semantic_complete,lneRequired:!!s.require_lne,lneComplete:!!s.lne_complete,retrievalComplete,directFacts,unsupportedDirectFacts,factRecords:(facts||[]).length,factsComplete,slotClosure,crossTypeIntervalWarnings:intervalWarnings,unresolvedFactConflicts:conflicts.length,documents:doc},reviewCounts:counts,factConflicts:conflicts,synthesisAllowed:allowed};
  }

  async function researchResult(sessionId,{offset=0,limit=200}={}) {
    const ledger=await sessionLedger(sessionId);
    const pageOffset=num(offset,0,0,1e8),pageLimit=num(limit,200,1,500);
    const decisionTotal=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${RDB}.positions WHERE session_id=? AND coverage_required=1`,[sessionId])||0);
    const raw=await Zotero.DB.queryAsync(`SELECT position_id,work_key,title,review_status,reason,source,context_read_at,listed_at FROM ${RDB}.positions WHERE session_id=? AND coverage_required=1 ORDER BY evidence_priority,work_key,position_id LIMIT ? OFFSET ?`,[sessionId,pageLimit,pageOffset]);
    const decisions=(raw||[]).map(r=>({positionId:r.position_id,workKey:r.work_key,title:r.title,reviewStatus:r.review_status,reason:r.reason||"",source:r.source,listed:!!r.listed_at,contextRead:!!r.context_read_at}));
    const factRows=await Zotero.DB.queryAsync(`SELECT fact_id,position_id,slot,entity,value_text,value_type,unit,numbering,evidence_status,source_quote,locator_json FROM ${RDB}.fact_records WHERE session_id=? ORDER BY slot,created_at`,[sessionId]);
    const facts=await Promise.all((factRows||[]).map(async r=>{const locator=jsonObject(r.locator_json,{});return{factId:r.fact_id,positionId:r.position_id,slot:r.slot,entity:r.entity,value:r.value_text,valueType:r.value_type,unit:r.unit,numbering:r.numbering,evidenceStatus:r.evidence_status,sourceQuote:r.source_quote,locator,links:await sourceLinks(locator)};}));
    const refRows=await Zotero.DB.queryAsync(`SELECT work_key,MAX(title) title FROM ${RDB}.positions WHERE session_id=? GROUP BY work_key ORDER BY title`,[sessionId]);
    const references=(refRows||[]).map(r=>{const workKey=String(r.work_key||"");const split=workKey.lastIndexOf(":");return{workKey,title:r.title||"",parentLink:split>0?zoteroItemLink(workKey.slice(0,split),workKey.slice(split+1)):null};});
    const screenedPapers=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(DISTINCT work_key) FROM ${RDB}.positions WHERE session_id=? AND coverage_required=1 AND review_status NOT IN ('unreviewed','needs_context')`,[sessionId])||0);
    const contextReadPapers=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(DISTINCT work_key) FROM ${RDB}.positions WHERE session_id=? AND coverage_required=1 AND context_read_at IS NOT NULL`,[sessionId])||0);
    const ready=ledger.status==="ready_for_synthesis"&&ledger.synthesisAllowed===true;
    const blockers=[];
    if(!ready)blockers.push("Coverage Gate has not been finalized as ready_for_synthesis");
    if(ledger.coverage.unlisted)blockers.push(`${ledger.coverage.unlisted} gate-required review units have not been listed`);
    if(ledger.coverage.contextUnread)blockers.push(`${ledger.coverage.contextUnread} gate-required review units have not had context read`);
    if(ledger.coverage.unreviewed)blockers.push(`${ledger.coverage.unreviewed} gate-required review units remain unreviewed`);
    if(!ledger.coverage.retrievalComplete)blockers.push("Required retrieval branches have not completed");
    if(ledger.readingPolicy==="FULL_TEXT_CANDIDATES"&&!ledger.coverage.documents?.allCandidateDocumentsListed)blockers.push("Candidate full-text document pagination is incomplete");
    if(ledger.orchestration?.required&&!ledger.orchestration.complete)blockers.push("Research orchestration or Note-to-PDF promotion is incomplete");
    if(!ledger.coverage.factsComplete)blockers.push("Required direct original-source FactRecords are incomplete");
    if(ledger.coverage.slotClosure?.openRequired?.length)blockers.push(`Open exact fact slots: ${ledger.coverage.slotClosure.openRequired.map(x=>x.id).join(', ')}`);
    if(ledger.coverage.unresolvedFactConflicts)blockers.push(`${ledger.coverage.unresolvedFactConflicts} direct-fact conflicts remain unresolved`);
    if(ledger.coverage.crossTypeIntervalWarnings?.length)blockers.push(`${ledger.coverage.crossTypeIntervalWarnings.length} cross-type interval mappings require source-backed resolution`);
    return {reportVersion:"zotquery-result-v1",sessionId,question:ledger.question,questionMode:ledger.questionMode,status:ledger.status,queryContract:ledger.queryPlan,
      corpusHealth:{retrievalComplete:ledger.coverage.retrievalComplete},
      funnel:{retrievedPapers:ledger.coverage.candidatePapers,screenedPapers,contextReadPapers,fullTextPagedPapers:ledger.coverage.documents?.completeDocuments??0,deepReadPapers:null,deepReadTracking:"not recorded; do not infer from retrieval"},
      coverage:ledger.coverage,coverageGate:{synthesisAllowed:ready,blockers},evidenceSlots:ledger.coverage.slotClosure?.slots||[],
      candidateDecisions:decisions,evidenceUnits:[],facts,claims:[],conflicts:ledger.factConflicts||[],gaps:blockers,references,
      pagination:{offset:pageOffset,limit:pageLimit,totalDecisions:decisionTotal,nextOffset:pageOffset+decisions.length<decisionTotal?pageOffset+decisions.length:null,truncated:pageOffset+decisions.length<decisionTotal},
      audit:{generatedAt:now(),source:"persisted research session",noteEvidenceIsNavigation:true,directFactsRequireOriginalPdf:true}};
  }

  async function positions(sessionId,{offset=0,limit=100,status=null,scope="coverage"}={}) {
    await ensureResearchSchema();const args=[sessionId];let w="session_id=?";const sc=String(scope||"coverage").toLowerCase();if(sc==="coverage")w+=" AND coverage_required=1";else if(sc==="navigation")w+=" AND coverage_required=0";if(status){w+=" AND review_status=?";args.push(status);}const total=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${RDB}.positions WHERE ${w}`,args)||0),pageLimit=num(limit,100,1,1000),pageOffset=num(offset,0,0,1e8);
    const rows=await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.positions WHERE ${w} ORDER BY coverage_required DESC,should_match_count DESC,evidence_priority ASC,source,work_key,COALESCE(chunk_index,line_start,0) LIMIT ? OFFSET ?`,[...args,pageLimit,pageOffset]);if(rows?.length){const ids=rows.map(r=>r.position_id);await Zotero.DB.queryAsync(`UPDATE ${RDB}.positions SET listed_at=COALESCE(listed_at,?),updated_at=? WHERE position_id IN (${ids.map(()=>"?").join(",")})`,[now(),now(),...ids]);}
    const listed=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${RDB}.positions WHERE ${w} AND listed_at IS NOT NULL`,args)||0),nextOffset=pageOffset+(rows?.length||0)<total?pageOffset+(rows?.length||0):null;
    return{sessionId,scope:sc,total,offset:pageOffset,limit:pageLimit,nextOffset,pageComplete:nextOffset==null,listingCoverage:{listed,unlisted:Math.max(0,total-listed),allListed:total>0&&listed===total},results:(rows||[]).map(r=>{let evidenceHint=null,queryMatch=null;try{evidenceHint=r.evidence_hint?JSON.parse(r.evidence_hint):null;}catch{}try{queryMatch=r.query_match_json?JSON.parse(r.query_match_json):null;}catch{}return{positionId:r.position_id,source:r.source,workKey:r.work_key,libraryKey:r.library_key,itemKey:r.item_key,title:r.title,chunkIndex:r.chunk_index,pageNumber:r.page_number,paragraphIndex:r.paragraph_index,noteKey:r.note_key,lineStart:r.line_start,lineEnd:r.line_end,matchKind:r.match_kind,score:r.match_score,preview:r.preview,evidenceHint,coverageRequired:!!r.coverage_required,positionRole:r.position_role,clusterId:r.cluster_id,shouldMatchCount:Number(r.should_match_count||0),queryMatch,listedAt:r.listed_at,contextReadAt:r.context_read_at,sameParentPdfStatus:r.same_parent_pdf_status,reviewStatus:r.review_status,contextLevel:Number(r.context_level||0),evidenceScope:r.evidence_scope,supportsQuestion:r.supports_question,reason:r.reason};})};
  }

  async function positionContext(positionId,{level=1}={}) {
    await ensureResearchSchema();const p=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.positions WHERE position_id=?`,[positionId]))?.[0];if(!p)throw new Error("Unknown position");await Zotero.DB.queryAsync(`UPDATE ${RDB}.positions SET context_read_at=COALESCE(context_read_at,?),context_level=MAX(context_level,?),updated_at=? WHERE position_id=?`,[now(),num(level,1,0,3),now(),positionId]);let registeredHint=null;try{registeredHint=p.evidence_hint?JSON.parse(p.evidence_hint):null;}catch{}
    if(p.source==="pdf"){const span=level<=0?0:level===1?2:level===2?5:12,ctx=await context({libraryKey:p.library_key,itemKey:p.item_key,chunkIndex:p.chunk_index,before:span,after:span});const links=await sourceLinks({libraryKey:p.library_key,itemKey:p.item_key,pageNumber:p.page_number});return{positionId,source:"pdf",level,...ctx,links,registeredEvidenceHint:registeredHint,evidenceRule:"Evidence hints are ranking aids only. Decide scope/support from the source context; exact facts require a direct PDF FactRecord with stable locator."};}
    if(p.source==="note"){
      if(!Zotero.ZotQueryLNE?.api?.trace)throw new Error("Native LNE trace API is unavailable");
      const trace=await Zotero.ZotQueryLNE.api.trace(p.note_key,{libraryKey:p.library_key,from:p.line_start??1,around:level<=0?1:level===1?3:level===2?8:20});
      const links=await sourceLinks({libraryKey:p.library_key,itemKey:p.item_key,noteKey:p.note_key,lineStart:p.line_start,lineEnd:p.line_end});
      return{positionId,source:"note",level,trace,links,registeredEvidenceHint:registeredHint,evidenceRule:"LNE notes are navigation/synthesis aids, not primary proof. Use evidence_verify_note to locate same-parent PDF evidence before recording a DIRECT fact."};
    }
    throw new Error("Unsupported position source");
  }

  async function reviewPosition(positionId, payload={}) {
    await ensureResearchSchema();
    const existing=(await Zotero.DB.queryAsync(`SELECT context_read_at FROM ${RDB}.positions WHERE position_id=?`,[positionId]))?.[0];if(!existing)throw new Error("Unknown position");
    if(!existing.context_read_at)throw new Error("Read evidence_context before reviewing this position");
    const allowedStatus=new Set(["reviewed","excluded","conflicting","unresolved","needs_context"]);
    const status=allowedStatus.has(payload.reviewStatus)?payload.reviewStatus:"reviewed";
    const scope=payload.evidenceScope||null, supports=payload.supportsQuestion||null, reason=payload.reason||null, level=num(payload.contextLevel,1,0,9);
    const reviewedAt=now();
    await Zotero.DB.queryAsync(`UPDATE ${RDB}.positions SET review_status=?,context_level=?,evidence_scope=?,supports_question=?,reason=?,evidence_json=?,listed_at=COALESCE(listed_at,?),updated_at=? WHERE position_id=?`,[status,level,scope,supports,reason,payload.evidence?JSON.stringify(payload.evidence):null,reviewedAt,reviewedAt,positionId]);
    const sid=await Zotero.DB.valueQueryAsync(`SELECT session_id FROM ${RDB}.positions WHERE position_id=?`,[positionId]);if(sid)await Zotero.DB.queryAsync(`UPDATE ${RDB}.sessions SET updated_at=? WHERE session_id=?`,[now(),sid]);
    return {ok:true,positionId,reviewStatus:status,session: sid?await sessionLedger(sid):null};
  }

  async function verifyNoteSource(notePositionId,{query=null,aliases=[],limit=50}={}){
    await ensureResearchSchema();
    const p=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.positions WHERE position_id=?`,[notePositionId]))?.[0];if(!p)throw new Error("Unknown position");
    if(p.source!=="note")throw new Error("Same-parent verification applies to note positions");
    const q=String(query||p.preview||"").trim();if(!q)throw new Error("No note claim text available");
    const r=await lexicalSearch({query:q,aliases,libraryKey:p.library_key,itemKey:p.item_key,limit:num(limit,50,1,200),offset:0});
    const status=r.results.length?"LOCATED":"NOT_LOCATED";
    const ts=now(),registered=[];
    for(const hit of r.results||[]){
      const id=positionId(p.session_id,"pdf",hit.workKey,`c${hit.chunkIndex}`),hint=hit.evidenceHint||genericEvidenceHint(`${hit.title||""}\n${hit.snippet||""}`);
      await Zotero.DB.queryAsync(`INSERT OR IGNORE INTO ${RDB}.positions
        (position_id,session_id,source,work_key,library_key,item_key,title,chunk_index,page_number,paragraph_index,match_kind,match_score,preview,review_status,evidence_hint,evidence_priority,coverage_required,position_role,cluster_id,should_match_count,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,p.session_id,"pdf",hit.workKey,hit.libraryKey,hit.itemKey,hit.title||"",hit.chunkIndex??null,hit.pageNumber??null,hit.paragraphIndex??null,"same-parent-verification",hit.lexicalScore??null,hit.snippet||"","unreviewed",JSON.stringify(hint),hint.priority??50,1,"verified-note-evidence",`verify-${hit.chunkIndex??"x"}`,Number(hit.shouldMatchCount||0),ts,ts]);
      await Zotero.DB.queryAsync(`UPDATE ${RDB}.positions SET coverage_required=1,position_role='verified-note-evidence',cluster_id=COALESCE(cluster_id,?),evidence_hint=?,evidence_priority=MIN(evidence_priority,?),updated_at=? WHERE position_id=?`,[`verify-${hit.chunkIndex??"x"}`,JSON.stringify(hint),hint.priority??50,ts,id]);
      registered.push({...hit,positionId:id});
    }
    const payload={status,query:q,totalMatches:r.totalMatches,complete:r.complete,registeredPositions:registered.length,results:registered};
    await Zotero.DB.queryAsync(`UPDATE ${RDB}.positions SET same_parent_pdf_status=?,same_parent_pdf_json=?,updated_at=? WHERE position_id=?`,[status,JSON.stringify(payload),now(),notePositionId]);
    return {positionId:notePositionId,noteKey:p.note_key,workKey:p.work_key,...payload,rule:"A located passage is a verification candidate, not automatic proof. Read its PDF context and record any direct fact from the PDF position."};
  }

  function jsonObject(value, fallback={}) { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }

  async function promoteSurveyNotes(sessionId,{offset=0,limit=12,query=null,aliases=[]}={}) {
    await ensureResearchSchema();
    const s=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.sessions WHERE session_id=?`,[sessionId]))?.[0];
    if(!s)throw new Error("Unknown session");
    if(!s.survey_id)throw new Error("Session is not linked to an LNE survey; start it with evidence_research_start");
    if(!Zotero.ZotQueryLNE?.api?.surveyScreen)throw new Error("LNE Survey tools are unavailable");
    const pageLimit=num(limit,12,1,50),pageOffset=num(offset,0,0,1e8);
    const screened=await Zotero.ZotQueryLNE.api.surveyScreen(s.survey_id,{coreOnly:true,requirePaperSide:true,offset:pageOffset,limit:pageLimit});
    const stored=jsonObject(s.query_json,{}),contract=stored?.queryContract||{};
    // Same-parent verification is a locator step, not an identity rewrite.
    // Prefer non-identifier evidence concepts inside the already-bound parent
    // PDF, so a font-layer loss such as α -> a cannot make the entire lookup
    // impossible. Identity is still decided from the opened original passage.
    const conceptTerms=[...(contract.mustGroups||[]),...(contract.shouldGroups||[])]
      .filter(g=>!g.identifierType).map(g=>g.aliases?.[0]).filter(Boolean);
    const verifyQuery=String(query||[...new Set(conceptTerms)].join(" ")||contract.lneQuery||s.question).trim();
    const promoted=[],missing=[],failed=[];
    for(const work of screened.results||[]){
      const keys=[...new Set([work.noteKey,...(work.noteKeys||[])].filter(Boolean).map(x=>String(x).toUpperCase()))];
      if(!keys.length){missing.push({workKey:work.workKey,title:work.title,reason:"survey work has no note key"});continue;}
      const ph=keys.map(()=>"?").join(",");
      const pos=(await Zotero.DB.queryAsync(`SELECT * FROM ${RDB}.positions WHERE session_id=? AND source='note' AND note_key IN (${ph}) ORDER BY evidence_priority ASC,match_score DESC,line_start LIMIT 1`,[sessionId,...keys]))?.[0];
      if(!pos){missing.push({workKey:work.workKey,noteKeys:keys,title:work.title,reason:"core survey note was outside the sweep navigation page"});continue;}
      try{promoted.push({workKey:work.workKey,noteKey:pos.note_key,verification:await verifyNoteSource(pos.position_id,{query:verifyQuery,aliases,limit:50})});}
      catch(e){failed.push({workKey:work.workKey,noteKey:pos.note_key,error:e.message});}
    }
    const nextOffset=screened.pagination?.nextOffset??null,prior=jsonObject(s.orchestration_json,{});
    const state={...prior,surveyId:s.survey_id,promotionOffset:pageOffset+(screened.results?.length||0),promotionComplete:nextOffset==null,
      promotedWorks:Number(prior.promotedWorks||0)+promoted.length,missingWorks:Number(prior.missingWorks||0)+missing.length,
      failedWorks:Number(prior.failedWorks||0)+failed.length,lastPromotionAt:now()};
    await Zotero.DB.queryAsync(`UPDATE ${RDB}.sessions SET orchestration_json=?,updated_at=? WHERE session_id=?`,[JSON.stringify(state),now(),sessionId]);
    return{sessionId,surveyId:s.survey_id,verificationQuery:verifyQuery,pagination:{offset:pageOffset,limit:pageLimit,nextOffset,complete:nextOffset==null},promoted,missing,failed,orchestration:state,
      next:nextOffset==null?"Review all promoted PDF positions with evidence_context/evidence_review and record typed DIRECT facts before finalize.":`Call evidence_promote_notes again with offset=${nextOffset}.`};
  }

  async function startOrchestratedResearch(args={}) {
    const question=String(args.question||"").trim();if(!question)throw new Error("evidence_research_start requires question");
    if(!Zotero.ZotQueryLNE?.api?.surveyRun)throw new Error("LNE Survey tools are unavailable");
    const sweep=await runSweep({...args,question,includeLNE:true,requireLNE:false});
    if(!sweep.sessionId)return{...sweep,orchestrationStarted:false};
    const identifierAnchors=[...(sweep.queryPlan?.mustGroups||[]),...(sweep.queryPlan?.shouldGroups||[])]
      .filter(g=>g.identifierType).map(g=>g.surface||g.aliases?.[0]).filter(Boolean);
    const survey=await Zotero.ZotQueryLNE.api.surveyRun(question,{preset:args.surveyPreset||"balanced",anchors:args.surveyAnchors||identifierAnchors,axes:args.surveyAxes,
      maxQueries:args.surveyMaxQueries,maxPerQuery:args.surveyMaxPerQuery,hits:args.surveyHits,evidencePolicy:"paper-side-preferred",lexicalOnly:args.surveyLexicalOnly===true,pageSize:Math.max(12,num(args.promotionLimit,12,1,50))});
    const orchestration={surveyId:survey.surveyId,promotionOffset:0,promotionComplete:false,promotedWorks:0,missingWorks:0,failedWorks:0,startedAt:now()};
    await Zotero.DB.queryAsync(`UPDATE ${RDB}.sessions SET survey_id=?,orchestration_required=1,orchestration_json=?,updated_at=? WHERE session_id=?`,[survey.surveyId,JSON.stringify(orchestration),now(),sweep.sessionId]);
    const promotion=await promoteSurveyNotes(sweep.sessionId,{offset:0,limit:num(args.promotionLimit,12,1,50),query:args.verificationQuery||null,aliases:args.verificationAliases||[]});
    return{orchestrationStarted:true,sessionId:sweep.sessionId,surveyId:survey.surveyId,sweep,survey:{surveyId:survey.surveyId,plan:survey.plan,coverage:survey.coverage,totals:survey.totals,pagination:survey.pagination},promotion,
      workflow:["LNE survey and PDF sweep created together","core paper-side note candidates promoted to same-parent PDF verification","page and review every gate-required PDF position","record type-matching DIRECT FactRecords","call evidence_finalize"]};
  }

  async function finalize(sessionId) {
    const led=await sessionLedger(sessionId),blockers=[];
    if(!led.coverage.lexicalComplete)blockers.push("hard lexical corpus sweep incomplete");
    if(led.coverage.reviewUnits===0)blockers.push("No gate-required evidence positions were retrieved; an empty coverage universe cannot be finalized as synthesis-ready");
    if(led.coverage.semanticRequired&&!led.coverage.semanticCompleteAboveThreshold)blockers.push("semantic retrieval was explicitly required but is incomplete above threshold");
    if(led.coverage.lneRequired&&!led.coverage.lneComplete)blockers.push("LNE retrieval was explicitly required but is incomplete");
    if(led.coverage.unlisted)blockers.push(`${led.coverage.unlisted} review units were never returned through evidence_positions(scope=coverage)`);
    if(led.coverage.contextUnread)blockers.push(`${led.coverage.contextUnread} review units were listed but never opened with evidence_context`);
    if(led.coverage.unreviewed)blockers.push(`${led.coverage.unreviewed} unreviewed evidence clusters`);
    if(led.coverage.needsContext)blockers.push(`${led.coverage.needsContext} evidence clusters still need context`);
    if(led.coverage.conflicting)blockers.push(`${led.coverage.conflicting} evidence clusters are marked conflicting and need resolution`);
    if(led.coverage.unresolved)blockers.push(`${led.coverage.unresolved} unresolved evidence clusters`);
    if(led.questionMode==="EXACT"&&!led.coverage.factsComplete)blockers.push(led.coverage.slotClosure?.openRequired?.length?`EXACT question has open required fact slots: ${led.coverage.slotClosure.openRequired.map(s=>`${s.id}:${s.type}`).join(", ")}`:"EXACT question has no direct FactRecord from an original PDF passage with a stable locator");
    if(led.coverage.unresolvedFactConflicts)blockers.push(`${led.coverage.unresolvedFactConflicts} direct-fact conflict groups remain unresolved`);
    if(led.coverage.unsupportedDirectFacts?.length)blockers.push(`${led.coverage.unsupportedDirectFacts.length} DIRECT FactRecords lack literal value support or an affirmative PDF review`);
    if(led.coverage.crossTypeIntervalWarnings?.length)blockers.push(`${led.coverage.crossTypeIntervalWarnings.length} interval values were assigned to multiple non-interchangeable evidence types and require explicit resolution`);
    if(led.readingPolicy==="FULL_TEXT_CANDIDATES"&&!led.coverage.documents.allCandidateDocumentsListed)blockers.push(`${led.coverage.documents.candidateDocuments-led.coverage.documents.completeDocuments} coverage-candidate documents have not been fully paged through evidence_document`);
    if(led.readingPolicy==="FULL_TEXT_CANDIDATES"&&led.coverage.documents.unavailablePdfCount)blockers.push(`${led.coverage.documents.unavailablePdfCount} coverage works have no indexed PDF document available for full-text review`);
    if(led.orchestration?.required&&!led.orchestration?.state?.promotionComplete)blockers.push("LNE Survey core-note promotion is incomplete; continue evidence_promote_notes to nextOffset=null");
    const allowed=led.synthesisAllowed===true&&blockers.length===0;await Zotero.DB.queryAsync(`UPDATE ${RDB}.sessions SET status=?,updated_at=? WHERE session_id=?`,[allowed?"ready_for_synthesis":"blocked",now(),sessionId]);
    return{...led,status:allowed?"ready_for_synthesis":"blocked",synthesisAllowed:allowed,blockers,rule:"Coverage Gate v2 is exhaustive over the declared hard Query Contract, after adjacent duplicate lexical positions are clustered into review units. SHOULD/semantic/LNE navigation hits do not silently enlarge the gate. Exact claims require every declared fact slot to be closed by a type-matching direct PDF FactRecord; unresolved direct-value conflicts and cross-type interval ambiguity block synthesis."};
  }

  async function health() {
    let zs={}, fts={}, lne={ok:false}, research={ok:false};
    try{
      await ensureZotQuery();
      zs=await Zotero.ZotQuery.api.getStats();
      fts=await ensureFTS(false);
      const totalPapers=await countEligiblePapers();
      zs={
        ...zs,
        totalPapers,
        indexedPapers:fts.papers,
        totalChunks:fts.chunks,
        avgChunksPerPaper:fts.papers ? Math.round((fts.chunks/fts.papers)*10)/10 : 0,
        modelId:fts.model,
        lastIndexed:fts.lastIndexed || zs.lastIndexed || null,
        chunksWithLocation:fts.chunksWithLocation,
        locationCoveragePercent:fts.chunks ? Math.round((fts.chunksWithLocation/fts.chunks)*100) : 0,
        statsSource:"research-direct"
      };
    }catch(e){zs={error:e.message};}
    try{await ensureResearchSchema();research={ok:true,path:PathUtils.join(Zotero.DataDirectory.dir,RFILE)};}catch(e){research={ok:false,error:e.message};}
    try{
      if(!Zotero.ZotQueryLNE?.api?.health)throw new Error("Native LNE health API is unavailable");
      lne=await Zotero.ZotQueryLNE.api.health();
    }catch(e){lne={ok:false,error:e.message};}
    const pdfModelId=String(fts?.model||zs?.modelId||"")||null;
    const noteModelId=String(lne?.semantic?.modelId||"")||null;
    const sameModel=!!pdfModelId&&!!noteModelId&&pdfModelId===noteModelId;
    const embeddingContract={provider:"ZotQuery Search shared embedding API",pdfModelId,noteModelId,sameModel,queryReady:!!lne?.semantic?.queryReady};
    return {ok:!zs.error&&research.ok&&lne.ok&&sameModel&&(!lne?.semantic?.enabled||!!lne?.semantic?.queryReady),version:VERSION,product:"ZotQuery",components:{core:"ZotQuery Core",search:"ZotQuery Search",evidence:"ZotQuery Evidence",survey:"ZotQuery Survey",mcp:"ZotQuery MCP",agent:"ZotQuery Agent"},search:zs,fts,lne,research,embeddingContract,policy:{queryContractVersion:"v2",retrievalIsNavigation:true,sessionScopedEvidenceIdentity:true,coverageUniverse:"hard-query lexical evidence clusters",allCoveragePagesMustBeListed:true,contextMustBeReadBeforeReview:true,semanticAndLneSupplementalByDefault:true,exactFactsRequireDirectPdfRecord:true,directFactConflictsBlockSynthesis:true,sameParentNoteVerification:true,genericEvidenceOntology:true,bundledDomainPresets:false,identifierCharacterOrderSignificant:true,fuzzySimilarityNeverEstablishesIdentity:true,automaticAsciiDegradationAliases:false,adaptiveContext:true,fullTextCandidateModeAvailable:true}};
  }

  // ---------- REST endpoints ----------
  function Endpoint(methods, init){function E(){}E.prototype={supportedMethods:methods,supportedDataTypes:["application/json"],permitBookmarklet:false,init};return E;}
  const guard = async (req, fn) => {if(!authorized(req))return jres(401,{error:"Unauthorized: local Bearer token required"});try{return jres(200,await fn());}catch(e){log("endpoint error",e?.stack||e);return jres(400,{error:e?.message||String(e)});}};
  const Health=Endpoint(["GET"], req=>guard(req,()=>health()));
  const Lexical=Endpoint(["GET"], req=>guard(req,()=>{const s=qstr(req),aliases=(s.get("aliases")||"").split("|").filter(Boolean);return lexicalSearch({query:s.get("q")||"",aliases,limit:s.get("limit")||500,offset:s.get("offset")||0,libraryKey:s.get("libraryKey")||null,itemKey:s.get("itemKey")||null,maxRawPositions:s.get("maxRawPositions")||2500});}));
  const Plan=Endpoint(["POST"], req=>guard(req,async()=>planPublic(await planEvidenceQuery(req.data||{}))));
  const Context=Endpoint(["GET"], req=>guard(req,()=>{const s=qstr(req);return context({libraryKey:s.get("libraryKey")||"user",itemKey:s.get("itemKey"),chunkIndex:Number(s.get("chunkIndex")),before:s.get("before")||2,after:s.get("after")||2});}));
  const Sweep=Endpoint(["POST"], req=>guard(req,()=>runSweep(req.data||{})));
  const Session=Endpoint(["GET"], req=>guard(req,()=>sessionLedger(qstr(req).get("sessionId"))));
  const Positions=Endpoint(["GET"], req=>guard(req,()=>{const s=qstr(req);return positions(s.get("sessionId"),{offset:s.get("offset")||0,limit:s.get("limit")||100,status:s.get("status")||null,scope:s.get("scope")||"coverage"});}));
  const Document=Endpoint(["GET"], req=>guard(req,()=>{const s=qstr(req);return documentRead(s.get("sessionId"),s.get("workKey"),{offset:s.get("offset")||0,limit:s.get("limit")||20});}));
  const Review=Endpoint(["POST"], req=>guard(req,()=>reviewPosition(req.data?.positionId,req.data||{})));
  const Fact=Endpoint(["POST"], req=>guard(req,()=>recordFact(req.data||{})));
  const Resolve=Endpoint(["POST"], req=>guard(req,()=>resolveFactConflict(req.data?.sessionId,req.data||{})));
  const VerifyNote=Endpoint(["POST"], req=>guard(req,()=>verifyNoteSource(req.data?.positionId,req.data||{})));
  const Finalize=Endpoint(["POST"], req=>guard(req,()=>finalize(req.data?.sessionId)));

  // ---------- Unified MCP ----------
  const groupSchema={type:"array",items:{type:"object",properties:{id:{type:"string"},aliases:{type:"array",items:{type:"string"}},role:{type:"string",enum:["MUST","SHOULD"]}},required:["aliases"]}};
  const planProps={question:{type:"string"},aliases:{type:"array",items:{type:"string"},description:"Flat caller-supplied aliases. Prefer named aliasGroups when identity roles matter."},aliasGroups:groupSchema,mustGroups:groupSchema,shouldGroups:groupSchema,mustNot:{type:"array",items:{type:"string"}},evidenceTypeHints:{type:"array",items:{type:"string"},description:"Optional generic evidence scopes/methods to rank earlier, e.g. DOSE_RESPONSE, BINDING_RESULT, HDX_MS, CONSTRUCT_DEFINITION."},maxRawPositions:{type:"integer",minimum:50,maximum:1000000},autoTighten:{type:"boolean"}};
  const tools=[
    {name:"quick_search",description:"Fast ZotQuery Search semantic/hybrid discovery. Discovery hits are navigation only; use the evidence workflow for auditable claims.",inputSchema:{type:"object",properties:{query:{type:"string"},max_results:{type:"integer",minimum:1,maximum:100},min_similarity:{type:"number",minimum:0,maximum:1}},required:["query"]}},
    {name:"research_health",description:"Check ZotQuery Search, Evidence, Core and Survey stores, and query embedding readiness.",inputSchema:{type:"object",properties:{}}},
    {name:"evidence_plan",description:"Non-mutating Query Contract v2 preflight. Supports quoted/+ MUST terms, - exclusions, {a|b} alias groups, structured must/should/alias groups, protected identifiers, cardinality estimates and surface-preservation audit. Use this before broad sweeps.",inputSchema:{type:"object",properties:planProps,required:["question"]}},
    {name:"evidence_research_start",description:"Preferred unified entry point. Starts the PDF Coverage Gate and a persistent LNE Survey together, then automatically promotes the first page of core paper-side note candidates into same-parent PDF verification. Preserves Unicode identifier surfaces and never invents ASCII aliases.",inputSchema:{type:"object",properties:{...planProps,includeSemantic:{type:"boolean"},requireSemantic:{type:"boolean"},semanticLimit:{type:"integer",minimum:1,maximum:5000},minSimilarity:{type:"number",minimum:0,maximum:1},libraryKey:{type:"string"},questionMode:{type:"string",enum:["AUTO","STANDARD","EXACT"]},factRequest:{type:"object"},readingPolicy:{type:"string",enum:["QUERY_EXHAUSTIVE","ALL_POSITIONS","FULL_TEXT_CANDIDATES"]},allowLargeSweep:{type:"boolean"},clusterGap:{type:"integer",minimum:0,maximum:5},surveyPreset:{type:"string",enum:["quick","balanced","exhaustive","audit"]},surveyAnchors:{},surveyAxes:{},surveyMaxQueries:{type:"integer",minimum:1,maximum:20},surveyMaxPerQuery:{type:"integer",minimum:1,maximum:500},surveyHits:{type:"integer",minimum:1,maximum:8},surveyLexicalOnly:{type:"boolean"},promotionLimit:{type:"integer",minimum:1,maximum:50},verificationQuery:{type:"string"},verificationAliases:{type:"array",items:{type:"string"}}},required:["question"]}},
    {name:"evidence_sweep",description:"Start Coverage Gate v2. Exhaustiveness is defined over the hard Query Contract (MUST groups AND; aliases within a group OR; exclusions NOT). QUERY_EXHAUSTIVE clusters adjacent duplicate lexical hits into review units; semantic and LNE hits are navigation-only unless explicitly required/verified.",inputSchema:{type:"object",properties:{...planProps,includeSemantic:{type:"boolean"},requireSemantic:{type:"boolean"},semanticLimit:{type:"integer",minimum:1,maximum:5000},minSimilarity:{type:"number",minimum:0,maximum:1},libraryKey:{type:"string"},includeLNE:{type:"boolean"},requireLNE:{type:"boolean"},questionMode:{type:"string",enum:["AUTO","STANDARD","EXACT"]},factRequest:{type:"object"},readingPolicy:{type:"string",enum:["QUERY_EXHAUSTIVE","ALL_POSITIONS","FULL_TEXT_CANDIDATES"]},allowLargeSweep:{type:"boolean"},clusterGap:{type:"integer",minimum:0,maximum:5}},required:["question"]}},
    {name:"evidence_positions",description:"Page evidence positions. scope=coverage (default) returns only gate-required evidence clusters; scope=navigation shows supplemental semantic/LNE/duplicate hits; scope=all is the audit view.",inputSchema:{type:"object",properties:{sessionId:{type:"string"},offset:{type:"integer"},limit:{type:"integer",minimum:1,maximum:1000},status:{type:"string"},scope:{type:"string",enum:["coverage","navigation","all"]}},required:["sessionId"]}},
    {name:"evidence_context",description:"Read sufficient surrounding context for one position. level 0=matched chunk, 1=±2 chunks/default, 2=±5, 3=±12; note positions use LNE trace with analogous expansion.",inputSchema:{type:"object",properties:{positionId:{type:"string"},level:{type:"integer",minimum:0,maximum:3}},required:["positionId"]}},
    {name:"evidence_document",description:"Page every indexed chunk of one coverage-candidate PDF. Required to exhaustion only for FULL_TEXT_CANDIDATES sessions.",inputSchema:{type:"object",properties:{sessionId:{type:"string"},workKey:{type:"string"},offset:{type:"integer"},limit:{type:"integer",minimum:1,maximum:50}},required:["sessionId","workKey"]}},
    {name:"evidence_review",description:"Record the decision for one evidence position after evidence_context. Recommended scopes: DIRECT_FACT, EXPERIMENT_RESULT, QUANTITATIVE_MEASUREMENT, SEQUENCE_DEFINITION, STRUCTURE_OBSERVATION, CONSTRUCT_DEFINITION, REGION_MAPPING, BINDING_RESULT, METHOD, AUTHOR_INTERPRETATION, BACKGROUND, INFERENCE.",inputSchema:{type:"object",properties:{positionId:{type:"string"},reviewStatus:{type:"string",enum:["reviewed","excluded","conflicting","unresolved","needs_context"]},contextLevel:{type:"integer"},evidenceScope:{type:"string"},supportsQuestion:{type:"string",enum:["yes","partial","no","contradicts","unclear"]},reason:{type:"string"},evidence:{type:"object"}},required:["positionId","reviewStatus"]}},
    {name:"evidence_fact",description:"Create a typed FactRecord from a context-read position. DIRECT facts require an original PDF locator and a value occurring literally in the verified sourceQuote. Derived or converted values must be INFERRED and cannot close EXACT slots.",inputSchema:{type:"object",properties:{positionId:{type:"string"},slot:{type:"string"},entity:{type:"string"},value:{type:["string","number"]},valueType:{type:"string",enum:["naming_equivalence","construct_boundary","structure_resolved_range","secondary_structure_range","functional_motif","mutation_site","hdx_peptide","sequence","sequence_alignment","homology_mapping","quantitative_measurement","mechanism","other","exact_value","residue_range","binding_or_activity_value"]},unit:{type:"string"},numbering:{type:"string"},evidenceStatus:{type:"string",enum:["DIRECT","INFERRED","SECONDARY"]},sourceQuote:{type:"string"},locator:{type:"object"},notes:{type:"string"}},required:["positionId","slot","value","valueType","evidenceStatus","sourceQuote"]}},
    {name:"evidence_resolve_conflict",description:"Adjudicate a DIRECT conflict by selecting a source-backed FactRecord, citing another context-read original PDF passage whose quote explicitly supports that value, and documenting the reason. Older unanchored resolutions remain blocking.",inputSchema:{type:"object",properties:{sessionId:{type:"string"},conflictKey:{type:"string"},selectedFactId:{type:"string"},resolutionPositionId:{type:"string"},resolutionQuote:{type:"string"},reason:{type:"string"}},required:["sessionId","conflictKey","selectedFactId","resolutionPositionId","resolutionQuote","reason"]}},
    {name:"evidence_verify_note",description:"Search only the same Zotero parent PDF for a navigation-note claim. Located PDF passages are promoted into the coverage universe and must be reviewed.",inputSchema:{type:"object",properties:{positionId:{type:"string"},query:{type:"string"},aliases:{type:"array",items:{type:"string"}},limit:{type:"integer",minimum:1,maximum:200}},required:["positionId"]}},
    {name:"evidence_promote_notes",description:"Continue the unified LNE-to-PDF bridge for an evidence_research_start session. Pages core Survey works, verifies matching note candidates only against their same-parent PDFs, and registers located PDF passages as required review units.",inputSchema:{type:"object",properties:{sessionId:{type:"string"},offset:{type:"integer"},limit:{type:"integer",minimum:1,maximum:50},query:{type:"string"},aliases:{type:"array",items:{type:"string"}}},required:["sessionId"]}},
    {name:"evidence_session",description:"Return the auditable raw-position/navigation/review-unit coverage ledger and Query Contract.",inputSchema:{type:"object",properties:{sessionId:{type:"string"}},required:["sessionId"]}},
    {name:"evidence_finalize",description:"Apply Coverage Gate v2. Synthesis requires 100% listing/context/review of hard-query evidence clusters, closure of every declared exact-fact slot by type-matching direct PDF records, and resolution of value or cross-type interval conflicts.",inputSchema:{type:"object",properties:{sessionId:{type:"string"}},required:["sessionId"]}},
    {name:"research_result",description:"Read a canonical, paginated ResearchResult from a persisted session. Retrieval, screening, context reading, full-text paging and deep reading are counted separately; unknown counts remain null.",inputSchema:{type:"object",properties:{sessionId:{type:"string"},offset:{type:"integer"},limit:{type:"integer",minimum:1,maximum:500}},required:["sessionId"]}},
    {name:"research_render",description:"Render a persisted ResearchResult with a compact, standard, exact or exhaustive output profile. A blocked gate yields only a staged report, never a definitive answer.",inputSchema:{type:"object",properties:{sessionId:{type:"string"},profileId:{type:"string"},offset:{type:"integer"},limit:{type:"integer",minimum:1,maximum:500}},required:["sessionId"]}},
    {name:"note_profile_list",description:"List built-in and user Note Profiles, including signatures.",inputSchema:{type:"object",properties:{}}},
    {name:"note_profile_validate",description:"Validate a Note Profile JSON object without installing it.",inputSchema:{type:"object",properties:{profile:{type:"object"}},required:["profile"]}},
    {name:"note_profile_draft",description:"Analyze headings and labels in a supplied Note template into an unconfirmed profile draft. Evidence roles must be reviewed before use.",inputSchema:{type:"object",properties:{template:{type:"string"}},required:["template"]}},
    {name:"note_profile_install",description:"Install a confirmed custom Note Profile in the Zotero data directory without changing built-ins.",inputSchema:{type:"object",properties:{profile:{type:"object"},confirmed:{type:"boolean"}},required:["profile","confirmed"]}},
    {name:"note_profile_select",description:"Select an installed Note Profile, or empty id for automatic selection. Requires confirmation and Zotero restart before reindexing; PDF and vector caches are retained.",inputSchema:{type:"object",properties:{id:{type:"string"},confirmed:{type:"boolean"}},required:["id","confirmed"]}},
    {name:"output_profile_list",description:"List output profiles. Templates can change presentation but cannot remove the research contract or Evidence Gate.",inputSchema:{type:"object",properties:{}}},
    {name:"output_profile_validate",description:"Validate an Output Profile without installing it; all mandatory research-contract sections must remain.",inputSchema:{type:"object",properties:{profile:{type:"object"}},required:["profile"]}},
    {name:"output_profile_install",description:"Install a confirmed custom Output Profile in the Zotero data directory.",inputSchema:{type:"object",properties:{profile:{type:"object"},confirmed:{type:"boolean"}},required:["profile","confirmed"]}},
  ];
  const lneTools=()=>{try{return Zotero.ZotQueryLNE?.api?.toolDefinitions?.()||[];}catch(_){return[];}};
  const publicToolName=name=>name==="quick_search"?"zotquery_search":name==="research_health"?"zotquery_health":`zotquery_${String(name).replace(/^lne_/,"")}`;
  const internalToolName=name=>{
    if(name==="zotquery_search")return"quick_search";
    if(name==="zotquery_health")return"research_health";
    if(!String(name||"").startsWith("zotquery_"))throw new Error("Use a listed zotquery_* tool name");
    const suffix=String(name).slice("zotquery_".length);
    return suffix.startsWith("evidence_")||suffix.startsWith("research_")||suffix.startsWith("note_profile_")||suffix.startsWith("output_profile_")?suffix:`lne_${suffix}`;
  };
  const allTools=()=>[...tools,...lneTools()].map(tool=>({...tool,name:publicToolName(tool.name)}));
  const mcpResult=(id,obj,isError=false)=>[200,"application/json",JSON.stringify({jsonrpc:"2.0",id:id??null,result:{content:[{type:"text",text:JSON.stringify(obj,null,2)}],...(isError?{isError:true}:{})}})];
  async function callTool(name,a){
    name=internalToolName(name);
    if(name==="research_result")return researchResult(a.sessionId,a);
    if(name==="research_render")return Zotero.ZotQueryOutputProfiles.render(await researchResult(a.sessionId,a),a.profileId||Zotero.Prefs.get("zotquery.outputProfile",true)||"standard");
    if(name==="note_profile_list")return {activeProfile:Zotero.ZotQueryNoteProfiles.active(),profiles:Zotero.ZotQueryNoteProfiles.list()};
    if(name==="note_profile_validate")return Zotero.ZotQueryNoteProfiles.validate(a.profile);
    if(name==="note_profile_draft")return Zotero.ZotQueryNoteProfiles.draftFromTemplate(a.template);
    if(name==="note_profile_install")return Zotero.ZotQueryNoteProfiles.installCustom(a.profile,{confirmed:a.confirmed===true});
    if(name==="note_profile_select")return Zotero.ZotQueryNoteProfiles.select(a.id,{confirmed:a.confirmed===true});
    if(name==="output_profile_list")return Zotero.ZotQueryOutputProfiles.list();
    if(name==="output_profile_validate")return Zotero.ZotQueryOutputProfiles.validate(a.profile);
    if(name==="output_profile_install")return Zotero.ZotQueryOutputProfiles.installCustom(a.profile,{confirmed:a.confirmed===true});
    if(String(name||"").startsWith("lne_")){
      if(!Zotero.ZotQueryLNE?.api?.callTool)throw new Error("LNE Native tool layer unavailable");
      return Zotero.ZotQueryLNE.api.callTool(name,a||{});
    }
    if(name==="quick_search")return{results:await Zotero.ZotQuery.api.search(a.query,{topK:num(a.max_results,10,1,100),minSimilarity:num(a.min_similarity,.3,0,1)})};
    if(name==="research_health")return health();if(name==="evidence_plan")return planPublic(await planEvidenceQuery(a));if(name==="evidence_research_start")return startOrchestratedResearch(a);if(name==="evidence_sweep")return runSweep(a);if(name==="evidence_positions")return positions(a.sessionId,a);if(name==="evidence_context")return positionContext(a.positionId,{level:a.level??1});if(name==="evidence_document")return documentRead(a.sessionId,a.workKey,a);if(name==="evidence_review")return reviewPosition(a.positionId,a);if(name==="evidence_fact")return recordFact(a);if(name==="evidence_resolve_conflict")return resolveFactConflict(a.sessionId,a);if(name==="evidence_verify_note")return verifyNoteSource(a.positionId,a);if(name==="evidence_promote_notes")return promoteSurveyNotes(a.sessionId,a);if(name==="evidence_session")return sessionLedger(a.sessionId);if(name==="evidence_finalize")return finalize(a.sessionId);throw new Error(`Unknown tool: ${name}`);
  }
  const MCP=Endpoint(["POST"], async req=>{if(!authorized(req))return[401,"application/json",JSON.stringify({jsonrpc:"2.0",id:null,error:{code:-32001,message:"Unauthorized: local Bearer token required"}})];const b=req.data||{},id=b.id;if(b.method==="initialize")return[200,"application/json",JSON.stringify({jsonrpc:"2.0",id,result:{protocolVersion:b.params?.protocolVersion||"2025-06-18",capabilities:{tools:{listChanged:false}},serverInfo:{name:"ZotQuery MCP",version:VERSION}}})];if(b.method==="ping")return[200,"application/json",JSON.stringify({jsonrpc:"2.0",id,result:{}})];if(b.method==="tools/list")return[200,"application/json",JSON.stringify({jsonrpc:"2.0",id,result:{tools:allTools()}})];if(b.method==="tools/call"){try{return mcpResult(id,await callTool(b.params?.name,b.params?.arguments||{}));}catch(e){return mcpResult(id,{error:e.message},true);}}return[200,"application/json",JSON.stringify({jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}})];});

  const classes={
    "/zotquery/health":Health,"/zotquery/lexical":Lexical,"/zotquery/plan":Plan,"/zotquery/context":Context,"/zotquery/sweep":Sweep,"/zotquery/session":Session,"/zotquery/positions":Positions,"/zotquery/document":Document,"/zotquery/review":Review,"/zotquery/fact":Fact,"/zotquery/resolve":Resolve,"/zotquery/verify-note":VerifyNote,"/zotquery/finalize":Finalize,"/zotquery/mcp":MCP
  };

  async function startup(){if(started)return;ensureAuthToken();await ensureZotQuery();await ensureResearchSchema();await ensureFTS(false);if(!Zotero.Server?.Endpoints)throw new Error("Zotero Local API server is unavailable");for(const [p,c] of Object.entries(classes))Zotero.Server.Endpoints[p]=c;Zotero.ZotQueryResearch={version:VERSION,health,planEvidenceQuery,lexicalSearch,context,runSweep,startOrchestratedResearch,promoteSurveyNotes,positions,positionContext,documentRead,reviewPosition,recordFact,resolveFactConflict,verifyNoteSource,sessionLedger,researchResult,getMcpToken:ensureAuthToken,rotateMcpToken:rotateAuthToken,finalize,shutdown};started=true;log("started",VERSION);}
  async function shutdown(){for(const p of ENDPOINTS)try{delete Zotero.Server.Endpoints[p];}catch{}try{const l=await Zotero.DB.queryAsync("PRAGMA database_list");if(l?.some(r=>r.name===RDB))await Zotero.DB.queryAsync(`DETACH DATABASE ${RDB}`);}catch{}delete Zotero.ZotQueryResearch;started=false;log("stopped");}

  _globalThis.ZotQueryResearchBootstrap={startup,shutdown,_defaultFactRequest:defaultFactRequest};
})();
