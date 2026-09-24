/* Local research history. No credentials, provider URLs, templates or reasoning transcripts. */
"use strict";
(function (global) {
  const DB = "zotqueryresearch";
  const now = () => new Date().toISOString();
  const active = new Set();
  const errorCodes = ["OUTPUT_LIMIT", "CONTEXT_LIMIT", "LIMIT_UNKNOWN", "REQUEST_FAILED", "CONTEXT_REREAD_REQUIRED", "REQUEST_TIMEOUT", "AUTH_FAILED", "RATE_LIMITED", "SERVER_ERROR", "PROVIDER_REJECTED", "NETWORK_ERROR", "INVALID_RESPONSE", "BUDGET_REJECTED", "REQUEST_TOO_LARGE", "RESPONSE_TOO_LARGE", "EMPTY_RESPONSE", "REASONING_ONLY", "UNSUPPORTED_RESPONSE", "MODEL_REFUSAL", "FINAL_TOOL_CALL", "CANCELLED", "STREAM_INVALID", "STREAM_INCOMPLETE", "STREAM_ERROR"];
  const query = (sql, args = []) => Zotero.DB.queryAsync(sql, args);
  const parse = text => { try { return JSON.parse(text || "{}"); } catch (_) { return {}; } };
  // Zotero returns mozStorage row proxies, not enumerable plain objects.
  // Read only SQL-selected columns; spreading them probes native QueryInterface.
  const project = (row, fields) => row ? Object.fromEntries(fields.map(key => [key, row[key]])) : null;
  const runColumns = ['run_id','created_at','updated_at','status','provider','model','options_json','metadata_json','error_code','has_answer'];
  const page = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Math.floor(Number(value)))) : fallback;
  async function startup() {
    await query(`CREATE TABLE IF NOT EXISTS ${DB}.answer_runs (
      run_id TEXT PRIMARY KEY, session_id TEXT, question TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL,
      provider TEXT, model TEXT, options_json TEXT NOT NULL, markdown TEXT,
      metadata_json TEXT NOT NULL, error_code TEXT
    )`);
    await query(`CREATE INDEX IF NOT EXISTS ${DB}.idx_answer_session ON answer_runs(session_id,created_at)`);
    // A process restart cannot resume an HTTP request. Evidence stays intact.
    await query(`UPDATE ${DB}.answer_runs SET status='interrupted' WHERE status='running'`);
    Zotero.ZotQueryHistory = { begin, bindSession, checkpoint, resumeBudget, resumeState, finish, fail, list, read, remove, shutdown, isActive: id => active.has(id) };
  }
  function safeOptions(input = {}) {
    const out = {};
    for (const key of ["questionMode", "readingPolicy", "surveyPreset", "includeSemantic", "surveyLexicalOnly", "reasoningEffort", "maxSteps", "maxTokens", "maxTokensMode", "timeoutSeconds"]) {
      if (["string", "number", "boolean"].includes(typeof input[key])) out[key] = input[key];
    }
    if (/^[a-f0-9-]{36}$/i.test(input.budgetBinding || "")) out.budgetBinding = input.budgetBinding;
    return out;
  }
  async function begin({ sessionId = null, question, provider, model, options = {} }) {
    if (sessionId && !(await query(`SELECT session_id FROM ${DB}.sessions WHERE session_id=?`, [sessionId])).length) throw new Error("研究会话不存在或已删除，请新建研究");
    const id = `ar-${Services.uuid.generateUUID().toString().replace(/[{}]/g, "")}`, ts = now();
    await query(`INSERT INTO ${DB}.answer_runs(run_id,session_id,question,created_at,updated_at,status,provider,model,options_json,metadata_json) VALUES(?,?,?,?,?,'running',?,?,?,'{}')`,
      [id, sessionId, String(question), ts, ts, String(provider || ""), String(model || ""), JSON.stringify(safeOptions(options))]);
    active.add(id);
    return id;
  }
  async function bindSession(runId, sessionId) {
    if (!sessionId) return;
    const rows = await query(`SELECT question FROM ${DB}.sessions WHERE session_id=?`, [sessionId]);
    const runs = await query(`SELECT question,session_id FROM ${DB}.answer_runs WHERE run_id=?`, [runId]);
    if (!rows?.length || !runs?.length || rows[0].question !== runs[0].question || (runs[0].session_id && runs[0].session_id !== sessionId)) throw new Error("历史记录与研究会话不匹配");
    await query(`UPDATE ${DB}.answer_runs SET session_id=?,updated_at=? WHERE run_id=?`, [sessionId, now(), runId]);
  }
  function safeDiagnostics(rows = []) {
    return (Array.isArray(rows) ? rows : []).slice(-110).map(row => {
      const out = {};
      for (const key of ["requested", "effective", "input", "output", "reasoning", "outputLimit", "contextLimit", "httpStatus", "elapsedMs", "timeoutSeconds", "round", "attempt", "messageChars", "toolChars", "reasoningChars", "contentChars", "responseReasoningChars", "toolCallCount", "receivedChars", "firstDataMs", "idleMs"]) out[key] = Number.isFinite(row?.[key]) && row[key] >= 0 ? Math.floor(row[key]) : null;
      out.finishReason = ["stop","length","max_tokens","tool_calls","end_turn","STOP","MAX_TOKENS","content_filter","SAFETY"].includes(row?.finishReason) ? row.finishReason : "unknown";
      out.providerDefault = row?.providerDefault === true;
      out.kind = ["OK", ...errorCodes].includes(row?.kind) ? row.kind : "LIMIT_UNKNOWN";
      out.phase = ["writing", "final"].includes(row?.phase) ? row.phase : "research";
      return out;
    });
  }
  function safeRuntime(input = {}) {
    if (!input || typeof input !== "object") input = {};
    const out = {};
    for (const key of ["round", "attempt", "budget", "successfulBudget", "lastInput", "budgetRetries", "routeOutputLimit", "contextRecoveries", "proactiveRecoveries", "writingRounds", "requestElapsedMs", "receivedChars", "contentChars", "reasoningChars", "firstDataMs", "idleMs"]) out[key] = Number.isSafeInteger(input[key]) && input[key] >= 0 ? input[key] : null;
    out.providerDefault = input.providerDefault === true;
    out.phase = ["writing", "final"].includes(input.phase) ? input.phase : "research";
    out.status = ["waiting", "received", "request-failed", "context-recovered", "budget-increased", "budget-corrected", "reasoning-only-continuation", "tools-complete", "complete", "failed", "cancelled"].includes(input.status) ? input.status : "unknown";
    return out;
  }
  async function checkpoint(runId, { diagnostics = [], runtime = {} } = {}) {
    await query(`UPDATE ${DB}.answer_runs SET metadata_json=?,updated_at=? WHERE run_id=? AND status='running'`,
      [JSON.stringify({diagnostics:safeDiagnostics(diagnostics),runtime:safeRuntime(runtime)}), now(), runId]);
  }
  async function resumeState(sessionId, binding, autoOnly = false) {
    if (!sessionId || !/^[a-f0-9-]{36}$/i.test(binding || "")) return null;
    const rows = await query(`SELECT options_json,metadata_json FROM ${DB}.answer_runs WHERE session_id=? ORDER BY created_at DESC,rowid DESC`, [sessionId]);
    for (const row of rows) {
      const options = parse(row.options_json), runtime = safeRuntime(parse(row.metadata_json).runtime);
      if (options.budgetBinding === binding && (!autoOnly || options.maxTokensMode === "auto") && runtime.budget >= 256) return runtime;
    }
    return null;
  }
  const resumeBudget = (sessionId, binding) => resumeState(sessionId, binding, true);
  async function finish(runId, { markdown, synthesisAllowed, blockers = [], toolCalls = 0, diagnostics = [], runtime = {} }) {
    if (!String(markdown || "").trim()) throw new Error("不能保存空回答");
    // The immutable answer revision records the gate at generation time.
    await query(`UPDATE ${DB}.answer_runs SET markdown=?,status=?,metadata_json=?,updated_at=? WHERE run_id=? AND status='running'`,
      [markdown, synthesisAllowed ? "complete" : "limited", JSON.stringify({ synthesisAllowed: !!synthesisAllowed, blockers, toolCalls, diagnostics: safeDiagnostics(diagnostics), runtime:safeRuntime(runtime) }), now(), runId]);
    active.delete(runId);
  }
  async function fail(runId, { code, diagnostics = [], runtime = {} } = {}) {
    const safeCode = errorCodes.includes(code) ? code : "RUN_FAILED";
    await query(`UPDATE ${DB}.answer_runs SET status=?,error_code=?,metadata_json=?,updated_at=? WHERE run_id=? AND status='running'`, [safeCode === "CANCELLED" ? "cancelled" : "failed",safeCode, JSON.stringify({diagnostics:safeDiagnostics(diagnostics),runtime:safeRuntime(runtime)}), now(), runId]);
    active.delete(runId);
  }
  async function list({ search = "", offset = 0, limit = 20 } = {}) {
    offset = page(offset, 0, 1e8); limit = Math.max(1, page(limit, 20, 100));
    // Literal substring search (not LIKE patterns); orphan attempts also remain visible.
    const base = `SELECT s.session_id id,s.session_id sessionId,s.question,s.status,COALESCE((SELECT MAX(updated_at) FROM ${DB}.answer_runs a WHERE a.session_id=s.session_id),s.updated_at) updatedAt,
      (SELECT COUNT(*) FROM ${DB}.answer_runs a WHERE a.session_id=s.session_id AND a.markdown IS NOT NULL) answers
      FROM ${DB}.sessions s
      UNION ALL SELECT run_id,NULL,question,status,updated_at,0 FROM ${DB}.answer_runs WHERE session_id IS NULL`;
    const filter = " WHERE instr(lower(question),lower(?))>0";
    const total = Number((await query(`SELECT COUNT(*) n FROM (${base})${filter}`, [String(search).trim()]))[0].n);
    const results = await query(`SELECT * FROM (${base})${filter} ORDER BY updatedAt DESC,id DESC LIMIT ? OFFSET ?`, [String(search).trim(), limit, offset]);
    return { total, offset, limit, nextOffset: offset + results.length < total ? offset + results.length : null, results:results.map(r=>project(r,['id','sessionId','question','status','updatedAt','answers'])) };
  }
  async function read(id, { offset = 0, limit = 20, runId = null } = {}) {
    offset = page(offset, 0, 1e8); limit = Math.max(1, page(limit, 20, 100));
    const session = (await query(`SELECT session_id,question,question_mode,reading_policy,survey_id FROM ${DB}.sessions WHERE session_id=?`, [id]))?.[0] || null;
    const where = session ? "session_id=?" : "run_id=?";
    const total = Number((await query(`SELECT COUNT(*) n FROM ${DB}.answer_runs WHERE ${where}`, [id]))[0].n);
    if (!session && !total) throw new Error("研究历史不存在");
    const runs = await query(`SELECT run_id,created_at,updated_at,status,provider,model,options_json,metadata_json,error_code,CASE WHEN markdown IS NULL THEN 0 ELSE 1 END has_answer FROM ${DB}.answer_runs WHERE ${where} ORDER BY created_at DESC,run_id DESC LIMIT ? OFFSET ?`, [id, limit, offset]);
    let selected;
    if (runId) selected = (await query(`SELECT * FROM ${DB}.answer_runs WHERE ${where} AND run_id=?`, [id, runId]))?.[0];
    else selected = (await query(`SELECT * FROM ${DB}.answer_runs WHERE ${where} ORDER BY (markdown IS NOT NULL) DESC,created_at DESC,run_id DESC LIMIT 1`, [id]))?.[0];
    if (runId && !selected) throw new Error("回答版本不属于当前研究");
    const decode = (row,selectedRow=false) => {
      if(!row)return null;
      const fields=selectedRow?runColumns.filter(k=>k!=='has_answer').concat(['session_id','question','markdown']):runColumns;
      const plain=project(row,fields);
      const result={...plain,options:parse(plain.options_json),metadata:parse(plain.metadata_json),active:active.has(plain.run_id)};
      delete result.options_json;delete result.metadata_json;return result;
    };
    return { session:project(session,['session_id','question','question_mode','reading_policy','survey_id']), runs:runs.map(row=>decode(row)), selected:decode(selected,true), total, offset, nextOffset: offset + runs.length < total ? offset + runs.length : null };
  }
  async function remove(id) {
    if (typeof id !== "string" || !id.trim()) throw new Error("请选择有效的研究历史");
    // Only delete this session's local research artifacts. Indexed literature,
    // shared survey caches, original Zotero items and exported files are untouched.
    const result = await Zotero.DB.executeTransaction(async () => {
      const session = (await query(`SELECT session_id FROM ${DB}.sessions WHERE session_id=?`, [id]))[0];
      const runs = await query(`SELECT run_id,status FROM ${DB}.answer_runs WHERE session_id=? OR (run_id=? AND session_id IS NULL)`, [id,id]);
      if (!session && !runs.length) throw new Error("研究历史不存在或已删除");
      if (Zotero.ZotQueryModelAgent?.isSessionActive?.(id) || Zotero.ZotQueryVision?.isSessionActive?.(id) || runs.some(r => active.has(r.run_id) || r.status === "running")) throw new Error("研究仍在执行，请先停止后再删除");
      if (session) {
        if (Zotero.ZotQueryVision) await query(`DELETE FROM ${DB}.visual_evidence WHERE session_id=?`, [id]);
        await query(`DELETE FROM ${DB}.fact_assessment_revisions WHERE fact_id IN (SELECT fact_id FROM ${DB}.fact_records WHERE session_id=?)`, [id]);
        for (const table of ["fact_resolutions","fact_records","document_chunks_listed","positions","answer_runs","sessions"]) await query(`DELETE FROM ${DB}.${table} WHERE session_id=?`, [id]);
      } else await query(`DELETE FROM ${DB}.answer_runs WHERE run_id=? AND session_id IS NULL`, [id]);
      return {id, deleted:true, runs:runs.length};
    });
    Zotero.ZotQueryModelAgent?.forgetSession?.(id);
    return result;
  }
  async function shutdown() { active.clear(); delete Zotero.ZotQueryHistory; }
  global.ZotQueryHistoryBootstrap = { startup, shutdown };
})(typeof _globalThis !== "undefined" ? _globalThis : this);
