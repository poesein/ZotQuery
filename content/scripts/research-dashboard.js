/* ZotQuery 3.1.17 research workbench controller. */
(function () {
  "use strict";

  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const Z = window.opener?.Zotero || Zotero;
  const state = { sessionId: null, sessionSignature: null, running: false, surveyId: null, ledger: null, positions: [], selectedPosition: null, markdown: "", positionOffset:0, historyOffset:0, historyNext:null, historyId:null, versionOffset:0, versionNext:null, unsavedAnswer:false };
  const $ = id => document.getElementById(id);
  const all = selector => [...document.querySelectorAll(selector)];
  const text = (id, value) => { const node = $(id); if (node) node.textContent = String(value ?? "—"); };
  const number = value => Number(value || 0).toLocaleString();
  const h = (tag, className = "", content = "") => {
    const node = document.createElementNS(HTML_NS, tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = String(content);
    return node;
  };

  function notify(message, tone = "") {
    const node = $("notice");
    node.textContent = String(message || "");
    node.className = `notice${tone ? ` ${tone}` : ""}`;
  }
  const errorMessage = error => error?.message || String(error || "未知错误");

  function lockResearch(locked) {
    for (const id of ["research-query", "question-mode", "survey-preset", "reading-policy", "include-semantic", "lexical-only", "research-vision", "run-research", "agent-generate"]) $(id).disabled = locked;
    for (const id of ["new-research","answer-version","review-support","review-exclude","review-more","record-fact"]) $(id).disabled = locked;
  }

  async function busy(button, label, task) {
    const old = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try { return await task(); }
    finally { button.disabled = false; button.textContent = old; }
  }

  function question() {
    const value = $("research-query").value.trim();
    if (!value) throw new Error("请先输入研究问题");
    return value;
  }

  function showTab(name) {
    all(".tab").forEach(node => {
      node.classList.toggle("active", node.dataset.tab === name);
      node.setAttribute("aria-pressed", String(node.dataset.tab === name));
    });
    all(".view").forEach(node => node.classList.toggle("active", node.id === `view-${name}`));
  }

  function setWorkflow(stage) {
    const order = ["query", "retrieve", "evidence", "output"];
    const current = order.indexOf(stage);
    order.forEach((name, index) => {
      const node = $(`step-${name}`);
      node.classList.toggle("done", index < current);
      node.classList.toggle("active", index === current);
    });
  }

  async function refreshHealth() {
    try {
      const health = await Z.ZotQueryResearchUI.health();
      $("health-dot").className = `status-dot ${health.ok ? "ok" : "bad"}`;
      text("health-label", health.ok ? "索引就绪" : "部分组件需要处理");
      text("metric-pdf", `${number(health.search?.indexedPapers)}/${number(health.search?.totalPapers)}`);
      text("metric-chunks", number(health.search?.totalChunks || health.fts?.chunks));
      text("metric-notes", number(health.lne?.notes));
      text("metric-vectors", `${number(health.lne?.semantic?.vectors)}/${number(health.lne?.semantic?.totalUniqueSegments)}`);
      text("metric-model", health.embeddingContract?.pdfModelId || "未配置");
      notify(health.ok ? "系统状态已刷新。" : "状态已刷新；请检查标红的组件或模型合同。", health.ok ? "ok" : "error");
      return health;
    } catch (error) {
      $("health-dot").className = "status-dot bad";
      text("health-label", "状态读取失败");
      notify(`状态读取失败：${errorMessage(error)}`, "error");
      return null;
    }
  }

  function badge(label, className = "") { return h("span", `badge ${className}`.trim(), label); }

  function sessionCard(ledger) {
    const root = $("session-state"); root.replaceChildren();
    root.append(h("strong", "", ledger ? `${ledger.questionMode} · ${ledger.status}` : "研究会话已创建"));
    root.append(h("div", "session-id", state.sessionId || "—"));
    if (state.surveyId) root.append(h("div", "session-id", `Survey: ${state.surveyId}`));
  }
  const ratio = (done, total) => `${number(done)}/${number(total)}`;

  function renderLedger(ledger) {
    state.ledger = ledger;
    sessionCard(ledger);
    const c = ledger?.coverage || {};
    text("coverage-listed", ratio(c.listed, c.reviewUnits));
    text("coverage-context", ratio(c.contextRead, c.reviewUnits));
    text("coverage-reviewed", ratio(c.reviewed, c.reviewUnits));
    text("coverage-facts", number(c.directFacts));
    const total = Number(c.reviewUnits || 0);
    const progress = total ? Math.round((Number(c.reviewed || 0) / total) * 100) : 0;
    $("coverage-progress").style.width = `${Math.max(0, Math.min(100, progress))}%`;
    text("evidence-meta", `${ledger?.questionMode || "—"} · ${ledger?.status || "—"} · 门禁位置 ${number(c.reviewUnits)}`);
    const slots = ledger?.factRequest?.slots || [];
    if (slots.length) {
      if (!slots.some(s => (s.id || s.slot) === $("fact-slot").value)) $("fact-slot").value = slots[0].id || slots[0].slot || "answer";
      const selected = slots.find(s => (s.id || s.slot) === $("fact-slot").value);
      if (selected && [...$("fact-type").options].some(x => x.value === (selected.type || selected.valueType))) $("fact-type").value = selected.type || selected.valueType;
    }
    const slotRoot=$("slot-status"); slotRoot.replaceChildren();
    for(const slot of c.slotClosure?.slots||[]) {
      const row=h("div","slot-status-row");
      row.append(h("strong","",`${slot.id} · ${slot.closed?"有完整支持":"尚未完整支持"}`));
      const issues=(slot.assessments||[]).flatMap(a=>a.issues.map(issue=>`${a.factId}: ${issue}`));
      if(issues.length)row.append(h("p","muted",issues.join("；")));
      slotRoot.append(row);
    }
    if (!state.running) setWorkflow(ledger?.synthesisAllowed ? "output" : "evidence");
  }

  async function refreshLedger() {
    if (!state.sessionId) return null;
    const ledger = await Z.ZotQueryResearch.sessionLedger(state.sessionId);
    renderLedger(ledger);
    if(Z.ZotQueryVision) await loadVisuals(0);
    return ledger;
  }
  async function loadVisuals(offset=0) {
    const sessionId=state.sessionId;if(!sessionId||!Z.ZotQueryVision)return;
    const page=await Z.ZotQueryVision.list(sessionId,{offset,limit:12});if(sessionId!==state.sessionId)return;
    text("visual-summary",`图像证据 ${page.total} · 截图不等于核验通过`);
    const root=$("visual-list");root.replaceChildren();$("visual-next").disabled=page.nextOffset==null;
    $("visual-next").onclick=()=>loadVisuals(page.nextOffset??0);
    for(const row of page.results){
      const card=h("div","position-card"),button=h("button","",`查看原图 · PDF 第 ${row.pageNumber} 页`);
      button.onclick=async()=>{try{
        const saved=await Z.ZotQueryVision.readSaved(sessionId,row.visualId);if(sessionId!==state.sessionId)return;
        const preview=$("visual-preview");preview.replaceChildren();const img=h("img");img.src=`data:image/png;base64,${saved.images[0].data}`;img.alt=`PDF 第 ${row.pageNumber} 页保存截图`;img.style.maxWidth="100%";preview.append(img,h("p","muted",`区域（左上角归一化）：${JSON.stringify(row.crop)} · PDF 指纹 ${row.pdfHash}`));
      }catch(error){notify(errorMessage(error),"error");}};
      card.append(button,h("p","muted",row.observation?`${row.observation.observation}\n行/图例：${row.observation.rowLabel} · 编号：${row.observation.numbering} · 疑点：${row.observation.uncertainties}`:"已保存页面图像，尚未登记视觉观察"));
      if(row.pdfLink){const link=h("a","","跳转 PDF 原页");link.href=row.pdfLink;card.append(link);}
      root.append(card);
    }
  }

  function researchOptions(q) {
    return { question: q, questionMode: $("question-mode").value,
      readingPolicy: $("reading-policy").value, includeSemantic: $("include-semantic").checked,
      surveyPreset: $("survey-preset").value, surveyLexicalOnly: $("lexical-only").checked, promotionLimit: 12 };
  }

  async function ensureSession(q, force = false) {
    const options = researchOptions(q), signature = JSON.stringify(options);
    if (!force && state.sessionId && state.sessionSignature === signature) return;
    notify("正在检索文献并建立证据会话…"); setWorkflow("retrieve");
    const result = await Z.ZotQueryResearch.startOrchestratedResearch(options);
    if (!result.sessionId) throw new Error("研究会话未创建；请检查索引与查询状态");
    state.sessionId = result.sessionId; state.surveyId = result.surveyId || null; state.sessionSignature = signature;
    state.positions = []; state.selectedPosition = null;
    $("evidence-list").replaceChildren(); $("context-drawer").classList.add("hidden");
    $("load-positions").disabled = false; $("finalize-session").disabled = false; $("render-report").disabled = false;
    await refreshLedger();
  }

  async function startResearch(event) {
    if (state.running) return;
    if (!canReplaceAnswer()) return;
    state.running = true;
    lockResearch(true);
    try {
      const q = question();
      await busy(event.currentTarget, "正在创建…", async () => {
        await ensureSession(q, true); clearAnswer(); resetEvidenceView(); state.historyId=state.sessionId; showTab("evidence");
        notify(`研究会话已创建：${state.sessionId}`, "ok");
        await loadPositions();
      });
    } catch (error) { notify(`创建失败：${errorMessage(error)}`, "error"); }
    finally { state.running = false; lockResearch(false); }
  }

  function sourceAnchor(label, url) {
    if (!/^zotero:\/\/(?:select\/(?:library|groups\/\d+)\/(?:items|collections)\/[A-Z0-9]{8}|open-pdf\/(?:library|groups\/\d+)\/items\/[A-Z0-9]{8}(?:\?page=[1-9]\d*)?)$/.test(String(url || ""))) return null;
    const anchor = h("a", "badge", label);
    anchor.setAttribute("href", url); anchor.setAttribute("title", label);
    anchor.addEventListener("click", event => {
      event.preventDefault();
      try {
        const pane = Z.getMainWindow?.()?.ZoteroPane || window.opener?.ZoteroPane;
        if (pane?.loadURI) pane.loadURI(url);
        else Z.launchURL(url);
      } catch (error) { notify(`原文跳转失败：${errorMessage(error)}`, "error"); }
    });
    return anchor;
  }

  function appendSourceLinks(root, position, links = position.links || {}) {
    const add = (label, url) => { const anchor = sourceAnchor(label, url); if (anchor) root.append(anchor); };
    add("父条目", links.parent);
    for (const collection of links.collections || []) add(`父目录：${collection.name}`, collection.url);
    add("来源笔记", links.note);
    for (const note of links.notes || []) if (note.url !== links.note) add(`笔记：${note.name}`, note.url);
    if (links.pdfPage) add(`PDF 第 ${position.pageNumber} 页`, links.pdfPage);
    else if (links.pdf) add("打开 PDF", links.pdf);
    else for (const attachment of links.pdfAttachments || []) add(`PDF：${attachment.name}`, attachment.url);
    const loc = [];
    if (position.chunkIndex != null) loc.push(`语段 chunk ${position.chunkIndex}`);
    if (position.paragraphIndex != null) loc.push(`段落索引 ${position.paragraphIndex}`);
    if (position.lineStart != null) loc.push(`笔记 L${position.lineStart}${position.lineEnd != null ? `–L${position.lineEnd}` : ""}（打开笔记后按原文查找）`);
    if (position.source === "pdf" && !links.pdfPage) loc.push("页级定位未核验；请在 PDF 中查找下方原文语段");
    if (loc.length) root.append(h("span", "source-locator", loc.join(" · ")));
  }

  function renderPositions(payload) {
    state.positions = payload?.results || [];
    const root = $("evidence-list"); root.className = ""; root.replaceChildren();
    text("evidence-meta", `门禁证据 ${payload?.offset || 0}–${(payload?.offset || 0) + state.positions.length} / ${payload?.total || 0}${payload?.nextOffset != null ? " · 尚有后续页" : " · 本页结束"}`);
    if (!state.positions.length) {
      root.className = "empty";
      const wrap = h("div"); wrap.append(h("strong", "", "没有门禁证据位置"), document.createTextNode("空候选不能视为已完成研究，请检查硬查询表达式。")); root.append(wrap); return;
    }
    state.positions.forEach((position, index) => {
      const card = h("article", "position-card");
      const head = h("div", "card-head"); head.append(h("div", "rank", `#${state.positionOffset + index + 1}`));
      const body = h("div"); body.style.flex = "1"; body.style.minWidth = "0";
      body.append(h("div", "card-title", position.title || position.workKey || position.positionId));
      const meta = h("div", "card-meta");
      meta.append(badge(position.source || "source"), badge(position.reviewStatus || "unreviewed", position.reviewStatus || "unreviewed"));
      if (position.pageNumber != null) meta.append(badge(`PDF p.${position.pageNumber}`));
      if (position.chunkIndex != null) meta.append(badge(`chunk ${position.chunkIndex}`));
      if (position.contextRead) meta.append(badge("已读上下文", "reviewed"));
      body.append(meta, h("div", "hit", position.preview || "无预览"));
      const actions = h("div", "card-actions");
      const open = h("button", "", position.contextRead ? "重新打开上下文" : "读取上下文"); open.type = "button";
      open.addEventListener("click", () => openContext(position)); actions.append(open);
      appendSourceLinks(actions, position);
      body.append(actions); head.append(body); card.append(head); root.append(card);
    });
  }

  async function loadPositions(offset = state.positionOffset) {
    if (!state.sessionId) return;
    if (typeof offset !== "number") offset = state.positionOffset;
    try {
      notify("正在列出门禁证据位置…");
      const payload = await Z.ZotQueryResearch.positions(state.sessionId, { scope: "coverage", offset, limit: 100, compact: true, includeLinks: true });
      state.positionOffset = payload.offset; state.positionNext = payload.nextOffset;
      text("positions-page", `${payload.total ? payload.offset + 1 : 0}–${payload.offset + payload.results.length} / ${payload.total}`);
      $("positions-prev").disabled = !payload.offset; $("positions-next").disabled = payload.nextOffset == null;
      renderPositions(payload); await refreshLedger();
      notify(`已列出 ${payload.results?.length || 0} / ${payload.total || 0} 个门禁位置。`, "ok");
    } catch (error) { notify(`证据列表读取失败：${errorMessage(error)}`, "error"); }
  }

  function contextText(context) {
    if (context?.text) return context.text;
    if (context?.trace?.text) return context.trace.text;
    if (Array.isArray(context?.trace?.lines)) return context.trace.lines.map(x => typeof x === "string" ? x : x.text || JSON.stringify(x)).join("\n");
    return JSON.stringify(context, null, 2);
  }

  async function openContext(position) {
    try {
      notify("正在读取证据上下文…");
      const context = await Z.ZotQueryResearch.positionContext(position.positionId, { level: 1 });
      state.selectedPosition = position;
      text("context-title", `${position.source?.toUpperCase() || "证据"} · ${position.title || position.workKey}`);
      text("context-text", contextText(context));
      const links = $("context-links"); links.replaceChildren();
      appendSourceLinks(links, position, { ...position.links, ...context.links,
        collections: position.links?.collections || [], notes: position.links?.notes || [], pdfAttachments: position.links?.pdfAttachments || [] });
      const copyQuote = h("button", "", "复制原文语段"); copyQuote.type = "button";
      copyQuote.addEventListener("click", () => {
        try { Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(contextText(context)); notify("已复制原文，可在 PDF 或笔记中查找。", "ok"); }
        catch (error) { notify(`复制失败：${errorMessage(error)}`, "error"); }
      });
      links.append(copyQuote);
      $("context-drawer").classList.remove("hidden"); $("context-drawer").scrollIntoView({ block: "nearest" });
      await refreshLedger(); notify("上下文已读取；请明确记录支持关系和理由。", "ok");
    } catch (error) { notify(`上下文读取失败：${errorMessage(error)}`, "error"); }
  }

  async function review(decision) {
    if (!state.selectedPosition) return notify("请先打开一个证据位置。", "error");
    const reason = $("review-reason").value.trim();
    if (!reason) return notify("审阅理由不能为空。", "error");
    const map = {
      support: { reviewStatus: "reviewed", supportsQuestion: "yes" },
      exclude: { reviewStatus: "excluded", supportsQuestion: "no" },
      more: { reviewStatus: "needs_context", supportsQuestion: "unclear", contextLevel: 2 },
    };
    try {
      await Z.ZotQueryResearch.reviewPosition(state.selectedPosition.positionId, { ...map[decision], evidenceScope: $("review-scope").value, reason });
      await refreshLedger(); await loadPositions();
      notify("审阅决策已写入会话台账。", "ok");
    } catch (error) { notify(`审阅写入失败：${errorMessage(error)}`, "error"); }
  }

  async function recordFact() {
    if (!state.selectedPosition) return notify("请先打开一个 PDF 证据位置。", "error");
    try {
      const result = await Z.ZotQueryResearch.recordFact({
        positionId: state.selectedPosition.positionId,
        slot: $("fact-slot").value.trim(), entity: $("fact-entity").value.trim() || null,
        value: $("fact-value").value.trim(), valueType: $("fact-type").value,
        numbering: $("fact-numbering").value.trim() || null, evidenceStatus: "DIRECT",
        sourceQuote: $("fact-quote").value.trim(),
        assessment:{relation:$("fact-relation").value,sourceMeaning:$("fact-meaning").value.trim(),rationale:$("fact-rationale").value.trim()},
      });
      await refreshLedger(); notify(`FactRecord 已登记：${result.factId}`, "ok");
    } catch (error) { notify(`FactRecord 登记失败：${errorMessage(error)}`, "error"); }
  }

  async function finalizeSession() {
    if (!state.sessionId) return;
    try {
      const result = await Z.ZotQueryResearch.finalize(state.sessionId);
      renderLedger(result); showTab(result.synthesisAllowed ? "report" : "evidence");
      notify(result.synthesisAllowed ? "Coverage Gate 已通过，可以生成证据约束的输出。" : `Coverage Gate 未通过：${(result.blockers || []).join("；")}`, result.synthesisAllowed ? "ok" : "error");
    } catch (error) { notify(`门禁检查失败：${errorMessage(error)}`, "error"); }
  }

  const outputProfile = () => "standard"; // Audit layout is internal; the user .md controls answer formatting.
  async function refreshModelSummary() {
    try {
      const config = Z.ZotQueryModelAgent.getConfig();
      text("active-model", config.model ? config.model + " · 思考 " + (config.reasoningEffort || "auto") + " · " + (config.maxTokensMode === "auto" ? "自动预算" : "预算 " + (config.maxTokens ?? "未知")) + " · 超时 " + (config.timeoutSeconds ?? "未知") + " 秒" : "请先在 ZotQuery 设置中配置输出模型");
      const info = await Z.ZotQueryModelAgent.templateInfo();
      text("active-template", info.configured ? "模板：" + info.name : info.error ? "模板不可用，请到设置检查" : "无模板 · 自由回答");
    } catch (error) { text("active-model", "模型配置不可用，请打开 ZotQuery 设置"); }
  }

  function appendAgentEvent(event) {
    if (["request","request-progress"].includes(event.type)) text("request-status",event.label);
    if (event.type === "request-progress") { text("agent-status",event.label); return; }
    const log = $("agent-log"); log.classList.remove("hidden");
    log.textContent += `${log.textContent ? "\n" : ""}[${new Date(event.at).toLocaleTimeString()}] ${event.label || event.type}`;
    log.scrollTop = log.scrollHeight;
    text("agent-status", event.label || event.type);
    if (event.type === "writing" || event.type === "complete") setWorkflow("output");
    else if (/context|review|fact|finalize/.test(event.tool || "")) setWorkflow("evidence");
    else if (event.type === "tool") setWorkflow("retrieve");
    if (event.type === "tool-result" && !state.ledgerRefresh) {
      state.ledgerRefresh = refreshLedger().catch(() => {}).finally(() => { state.ledgerRefresh = null; });
    }
  }

  function showAnswerMode(source = false) {
    $("report-preview").classList.toggle("hidden", source);
    $("report-editor").classList.toggle("hidden", !source);
    for (const [id, active] of [["answer-read", !source], ["answer-source", source]]) {
      $(id).classList.toggle("mode-active", active); $(id).setAttribute("aria-pressed", String(active));
    }
    if (!source && $("report-editor").value) window.ZotQueryMarkdown.render($("report-preview"), $("report-editor").value, {
      onLink: url => {
        try {
          const pane = Z.getMainWindow?.()?.ZoteroPane || window.opener?.ZoteroPane;
          if (url.startsWith("zotero://") && pane?.loadURI) pane.loadURI(url); else Z.launchURL(url);
        } catch (error) { notify(`链接打开失败：${errorMessage(error)}`, "error"); }
      },
    });
    else if (!source && !$("report-editor").value) text("report-preview", "尚无回答。输入问题后点击“大模型回答”。");
  }

  function canReplaceAnswer() {
    if (state.running) { notify("研究仍在执行，请完成后再切换会话。", "error"); return false; }
    return (!state.unsavedAnswer && $("report-editor").value === state.markdown) || window.confirm("当前回答有未保存的内容。请先保存 .md；仍要切换并放弃当前未保存内容吗？");
  }
  function clearAnswer() {
    state.markdown = ""; state.unsavedAnswer = false;
    $("report-editor").value = ""; $("audit-editor").value = "";
    $("copy-report").disabled = true; $("save-report").disabled = true;
    $("answer-versions").classList.add("hidden");
    showAnswerMode(false);
  }
  function resetEvidenceView() {
    state.positions = []; state.selectedPosition = null; state.positionOffset = 0; state.positionNext = null;
    $("evidence-list").replaceChildren(); $("context-drawer").classList.add("hidden");
    $("positions-prev").disabled = true; $("positions-next").disabled = true; text("positions-page", "");
    $("fact-slot").value = "answer";
    $("visual-list")?.replaceChildren();$("visual-preview")?.replaceChildren();text("visual-summary","图像证据（与文字读取分开记录）");if($("visual-next"))$("visual-next").disabled=true;
  }
  function newResearch() {
    if (!canReplaceAnswer()) return;
    state.sessionId = null; state.sessionSignature = null; state.surveyId = null; state.historyId = null; state.ledger = null;
    clearAnswer(); resetEvidenceView();
    $("research-query").value = ""; $("agent-log").textContent = "";
    for (const id of ["load-positions","finalize-session","render-report"]) $(id).disabled = true;
    renderLedger(null); setWorkflow("query"); showTab("report"); text("report-meta", "新研究 · 旧记录保留在研究历史中"); $("research-query").focus();
  }
  async function loadHistory(offset = 0) {
    try {
      const data = await Z.ZotQueryHistory.list({search:$("history-search").value,offset,limit:20});
      state.historyOffset = data.offset; state.historyNext = data.nextOffset;
      text("history-meta", `${data.total ? data.offset + 1 : 0}–${data.offset + data.results.length} / ${data.total}`);
      $("history-prev").disabled = !data.offset; $("history-next").disabled = data.nextOffset == null;
      const root = $("history-list"); root.replaceChildren();
      for (const entry of data.results) {
        const card=h("article","position-card"), title=h("strong","",entry.question), meta=h("div","muted",`${new Date(entry.updatedAt).toLocaleString()} · ${entry.status} · ${entry.answers} 个回答版本`);
        const open=h("button","","打开 / 续跑"); open.type="button"; open.addEventListener("click",()=>openHistory(entry.id));
        const remove=h("button","","删除"); remove.type="button"; remove.disabled=state.running; remove.addEventListener("click",()=>deleteHistory(entry.id,entry.question));
        const actions=h("div","history-actions"); actions.append(open,remove);
        card.append(title,meta,actions); root.append(card);
      }
      if (!data.results.length) root.append(h("p","muted","没有匹配的研究记录。"));
    } catch(error) { notify(`历史读取失败：${errorMessage(error)}`,"error"); }
  }
  function renderVersions(data) {
    const select=$("answer-version"); select.replaceChildren();
    const rows=[...data.runs];
    if(data.selected && !rows.some(r=>r.run_id===data.selected.run_id)) rows.unshift(data.selected);
    for (const run of rows) { const option=h("option","",`${new Date(run.created_at).toLocaleString()} · ${run.status} · ${run.model || ""}`); option.value=run.run_id; select.append(option); }
    if(data.selected) select.value=data.selected.run_id;
    state.versionOffset=data.offset; state.versionNext=data.nextOffset;
    $("answer-versions").classList.toggle("hidden",!rows.length);
    $("versions-prev").disabled=!data.offset; $("versions-next").disabled=data.nextOffset==null;
    text("version-meta",`${data.total} 次运行 · 保留各次回答，不覆盖旧版本`);
  }
  async function deleteHistory(id, title) {
    if (state.running) return notify("请先停止当前研究，再删除历史。","error");
    if (!window.confirm(`删除研究“${title}”？\n将永久删除这项研究的全部回答版本和本地证据台账，无法撤销。\n不会删除 Zotero 文献、PDF、笔记、索引或已导出的文件。`)) return;
    try {
      await Z.ZotQueryHistory.remove(id);
      if (state.historyId === id || state.sessionId === id) {
        clearAnswer(); resetEvidenceView();
        state.sessionId=null; state.sessionSignature=null; state.historyId=null; state.surveyId=null; state.ledger=null;
        $("research-query").value=""; $("answer-versions").classList.add("hidden");
        $("agent-log").textContent=""; text("agent-status",""); text("report-meta",""); renderLedger(null);
        for (const key of ["load-positions","finalize-session","render-report"]) $(key).disabled=true;
      }
      await loadHistory(0);
      notify("该研究的历史回答与证据台账已删除，无法撤销；原始文献和导出文件未改动。","ok");
    } catch(error) { notify(`删除失败：${errorMessage(error)}`,"error"); }
  }
  async function openHistory(id,runId=null,offset=0) {
    if(!canReplaceAnswer())return;
    try {
      const data=await Z.ZotQueryHistory.read(id,{runId,offset,limit:20}), run=data.selected, stored=data.session;
      if(state.running)return notify("研究已开始执行，请稍后再切换历史。","error");
      if(data.runs.some(r=>r.active)||run?.active) return notify("该研究仍在执行，请稍后再打开。","error");
      clearAnswer(); resetEvidenceView(); state.historyId=id;
      state.sessionId=stored?.session_id||null; state.surveyId=stored?.survey_id||null; state.ledger=null;
      $("research-query").value=stored?.question||run?.question||"";
      const opts=run?.options||{};
      for(const [key,element,fallback] of [["questionMode","question-mode",stored?.question_mode||"AUTO"],["readingPolicy","reading-policy",stored?.reading_policy||"QUERY_EXHAUSTIVE"],["surveyPreset","survey-preset","balanced"]]) {
        const value=opts[key]||fallback; $(element).value=[...$(element).options].some(o=>o.value===value)?value:fallback;
      }
      $("include-semantic").checked=opts.includeSemantic!==false; $("lexical-only").checked=opts.surveyLexicalOnly===true;
      state.sessionSignature=JSON.stringify(researchOptions($("research-query").value));
      state.markdown=run?.markdown||""; $("report-editor").value=state.markdown; showAnswerMode(false);
      $("copy-report").disabled=!state.markdown; $("save-report").disabled=!state.markdown;
      for(const key of ["load-positions","finalize-session","render-report"]) $(key).disabled=!state.sessionId;
      $("agent-log").textContent="";
      const diagnosticRows = run?.metadata?.diagnostics || [];
      if (diagnosticRows.length) $("agent-log").textContent = diagnosticRows.map((d,i)=>`请求 ${d.attempt ?? i+1} · ${d.phase === "final" ? "正文收尾" : d.phase === "writing" ? "写作" : "研究"} ${d.round ?? ""} · ${d.kind}${d.httpStatus ? ` / HTTP ${d.httpStatus}` : ""} · 预算 ${d.effective ?? "未知"} · 输入 ${d.input ?? "未知"} / 输出 ${d.output ?? "未知"} / 思考 ${d.reasoning ?? "未知"} tokens${d.toolCallCount != null ? ` · 工具调用 ${d.toolCallCount}` : ""}${d.elapsedMs != null ? ` · ${(d.elapsedMs/1000).toFixed(1)} 秒` : ""}`).join("\n");
      renderVersions(data);
      text("report-meta",run?.markdown?`${run.provider}/${run.model} · 历史回答 · ${new Date(run.created_at).toLocaleString()} · 生成时${run.metadata?.synthesisAllowed?"核验通过":"为阶段性回答"}`:"此记录没有保存的回答正文；证据仍保留，可点击大模型回答续跑。");
      text("agent-status",run?`历史运行：${run.status}${run.error_code ? ` · ${run.error_code}` : ""}${run.metadata?.runtime?.budget ? ` · 最近预算 ${run.metadata.runtime.budget}` : ""}${run.metadata?.runtime?.status === "waiting" ? " · 中断前正在等待模型响应" : ""}`:"旧版证据会话");
      if(state.sessionId) await refreshLedger(); else renderLedger(null);
      showTab("report"); notify("研究历史已打开；续跑将新增回答版本，不覆盖旧回答。","ok");
    }catch(error){notify(`打开历史失败：${errorMessage(error)}`,"error");}
  }

  async function generateWithAgent(event) {
    if (state.running) return;
    if (!canReplaceAnswer()) return;
    state.running = true;
    lockResearch(true);
    try {
      const q = question();
      await busy(event.currentTarget, "研究与回答中…", async () => {
        state.runControl = Z.ZotQueryModelAgent.createRunControl?.();
        $("live-request")?.classList.remove("hidden");
        if ($("agent-stop")) $("agent-stop").disabled = !state.runControl;
        text("request-status","正在准备研究…");
        const template = await Z.ZotQueryModelAgent.getTemplate();
        await refreshModelSummary();
        // Let the model plan before creating the session, within the same click.
        // Keep an existing matching session for manual review or a paused run.
        const researchConfig = researchOptions(q), signature = JSON.stringify(researchConfig);
        if (state.sessionSignature !== signature) {
          state.sessionId = null; state.surveyId = null; state.ledger = null;
          state.positions = []; state.selectedPosition = null;
          $("evidence-list").replaceChildren(); $("context-drawer").classList.add("hidden");
          clearAnswer(); resetEvidenceView(); state.historyId = null;
        }
        state.sessionSignature = signature;
        setWorkflow("retrieve");
        const log = $("agent-log"); log.textContent = ""; log.classList.remove("hidden");
        showTab("report"); setWorkflow("retrieve"); notify("输出大模型正在规划并调用 ZotQuery 研究工具…");
        const result = await Z.ZotQueryModelAgent.runAgent({
          control: state.runControl,
          question: q, sessionId: state.sessionId, profileId: outputProfile(),
          questionMode: $("question-mode").value, readingPolicy: $("reading-policy").value,
          surveyPreset: $("survey-preset").value,
          includeSemantic: researchConfig.includeSemantic, surveyLexicalOnly: researchConfig.surveyLexicalOnly,
          onEvent: row => {
            if (row.sessionId) {
              state.sessionId = row.sessionId;
              $("load-positions").disabled = false; $("finalize-session").disabled = false; $("render-report").disabled = false;
            }
            appendAgentEvent(row);
          },
          templateMarkdown: template.markdown, templateName: template.name,
        });
        state.sessionId = result.sessionId; state.markdown = result.markdown || "";
        state.historyId = result.sessionId; state.unsavedAnswer = !result.historySaved;
        $("report-editor").value = state.markdown;
        showAnswerMode(false);
        $("audit-editor").value = result.deterministicAuditMarkdown || "";
        $("audit-panel").open = false;
        $("copy-report").disabled = !state.markdown; $("save-report").disabled = !state.markdown;
        $("load-positions").disabled = false; $("finalize-session").disabled = false; $("render-report").disabled = false;
        await refreshLedger();
        const templateCoverage = result.template?.coverage;
        text("report-meta", `${result.provider}/${result.model} · 大模型回答 · ${result.template?.name || "无模板输出"} · ${result.synthesisAllowed ? "证据核验已通过" : "阶段性回答，核验未完成"}${templateCoverage?.total ? ` · 模板标题 ${templateCoverage.matched}/${templateCoverage.total}` : ""}`);
        setWorkflow("output");
        text("agent-status", result.blocked ? "回答已生成 · 核验未完成" : "回答已生成 · 核验通过");
        notify(result.blocked ? "已生成大模型阶段性回答；证据核验尚未完成，可在证据台账中查看缺口。" : "大模型回答已生成，证据核验已通过。", result.blocked ? "" : "ok");
        if (result.historySaved) {
          try { renderVersions(await Z.ZotQueryHistory.read(state.historyId,{runId:result.runId})); } catch (_) { /* Answer is saved even if refreshing version controls fails. */ }
        } else notify("回答已生成，但自动保存失败；请立即使用“保存 .md”。","error");
      });
    } catch (error) {
      const stopped = error.code === "CANCELLED";
      text("agent-status", stopped ? "已停止，证据保留，可续跑" : "研究失败，请查看下方提示");
      notify(stopped ? "已停止当前研究；未完成响应没有保存为答案，已完成证据和历史保留。停止客户端请求不保证服务商停止计费。" : `API 代理失败：${errorMessage(error)}`, stopped ? "" : "error");
    }
    finally { state.running = false; state.runControl=null; if($("agent-stop")) $("agent-stop").disabled=true; $("live-request")?.classList.add("hidden"); lockResearch(false); }
  }

  async function renderReport() {
    if (!state.sessionId) return notify("请先创建研究会话。", "error");
    try {
      notify("正在加载证据台账…");
      const result = await Z.ZotQueryResearch.researchResult(state.sessionId, { offset: 0, limit: 500 });
      const rendered = Z.ZotQueryOutputProfiles.render(result, outputProfile());
      $("audit-editor").value = rendered.markdown || "";
      $("audit-panel").open = true;
      showTab("evidence"); notify("证据台账已展开；回答正文和保存内容保持不变。", "ok");
    } catch (error) { notify(`台账读取失败：${errorMessage(error)}`, "error"); }
  }

  function copyReport() {
    const markdown = $("report-editor").value;
    if (!markdown) return;
    try {
      Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(markdown);
      notify("Markdown 已复制到剪贴板。", "ok");
    } catch (error) { notify(`复制失败：${errorMessage(error)}`, "error"); }
  }

  function safeFilename(value) { return String(value || "zotquery-research").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "zotquery-research"; }

  function selectedFilePath(picker) {
    // Zotero's FilePicker wrapper returns a string; raw nsIFile uses .path.
    const file = picker.file;
    const path = typeof file === "string" ? file : file?.path;
    if (typeof path !== "string" || !path.trim()) throw new Error("文件选择器未返回有效路径，请重新选择文件");
    return path;
  }

  async function saveReport() {
    const markdown = $("report-editor").value;
    if (!markdown) return;
    try {
      const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
      const picker = new FilePicker();
      picker.init(window, "保存 ZotQuery Markdown 报告", picker.modeSave);
      picker.defaultString = `${safeFilename($("research-query").value)}.md`;
      picker.appendFilter("Markdown", "*.md");
      const result = await picker.show();
      if (result !== picker.returnOK && result !== picker.returnReplace) return;
      const path = selectedFilePath(picker);
      await IOUtils.writeUTF8(path, markdown);
      state.markdown = markdown; state.unsavedAnswer = false;
      notify(`已保存：${path}`, "ok");
    } catch (error) { notify(`保存失败：${errorMessage(error)}`, "error"); }
  }

  async function syncNotes(event) {
    try {
      await busy(event.currentTarget, "同步中…", async () => {
        notify("正在同步 Zotero Notes 与共享向量…");
        await Z.ZotQueryResearchUI.syncNotes(); await refreshHealth();
        notify("Note 与向量同步完成。", "ok");
      });
    } catch (error) { notify(`同步失败：${errorMessage(error)}`, "error"); }
  }

  function bind() {
    all(".tab").forEach(node => node.addEventListener("click", () => {
      showTab(node.dataset.tab);
      if (node.dataset.tab === "evidence" && state.sessionId) loadPositions();
      if (node.dataset.tab === "history") loadHistory(state.historyOffset);
    }));
    $("run-research").addEventListener("click", startResearch);
    $("new-research").addEventListener("click",newResearch);
    $("history-refresh").addEventListener("click",()=>loadHistory(0));
    $("history-search").addEventListener("keydown",event=>{if(event.key==="Enter")loadHistory(0);});
    $("history-prev").addEventListener("click",()=>loadHistory(Math.max(0,state.historyOffset-20)));
    $("history-next").addEventListener("click",()=>{if(state.historyNext!=null)loadHistory(state.historyNext);});
    $("answer-version").addEventListener("change",()=>openHistory(state.historyId,$("answer-version").value,state.versionOffset));
    $("versions-prev").addEventListener("click",()=>openHistory(state.historyId,null,Math.max(0,state.versionOffset-20)));
    $("versions-next").addEventListener("click",()=>{if(state.versionNext!=null)openHistory(state.historyId,null,state.versionNext);});
    $("positions-prev").addEventListener("click",()=>loadPositions(Math.max(0,state.positionOffset-100)));
    $("positions-next").addEventListener("click",()=>{if(state.positionNext!=null)loadPositions(state.positionNext);});
    $("load-positions").addEventListener("click", loadPositions); $("finalize-session").addEventListener("click", finalizeSession);
    $("close-context").addEventListener("click", () => $("context-drawer").classList.add("hidden"));
    $("review-support").addEventListener("click", () => review("support"));
    $("review-exclude").addEventListener("click", () => review("exclude"));
    $("review-more").addEventListener("click", () => review("more"));
    $("record-fact").addEventListener("click", recordFact);
    $("render-report").addEventListener("click", renderReport); $("agent-generate").addEventListener("click", generateWithAgent); $("copy-report").addEventListener("click", copyReport);
    $("agent-stop")?.addEventListener("click", () => { state.runControl?.cancel(); $("agent-stop").disabled=true; text("request-status","正在停止模型请求；正在执行的本地工具会安全收尾，已完成证据保留…"); });
    $("save-report").addEventListener("click", saveReport); $("refresh-health").addEventListener("click", refreshHealth);
    $("answer-read").addEventListener("click", () => showAnswerMode(false));
    $("answer-source").addEventListener("click", () => showAnswerMode(true));
    $("report-editor").addEventListener("input", () => {
      const empty = !$("report-editor").value;
      $("copy-report").disabled = empty; $("save-report").disabled = empty;
    });
    $("sync-notes").addEventListener("click", syncNotes);
    $("open-settings").addEventListener("click", () => {
      try { Z.ZotQueryResearchUI.openSettings(); }
      catch (error) { notify("无法打开设置：" + errorMessage(error), "error"); }
    });
    $("research-query").addEventListener("input", () => setWorkflow("query"));
    $("research-query").addEventListener("keydown", event => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!$("agent-generate").disabled) generateWithAgent({ currentTarget: $("agent-generate") }); }
    });
  }

  async function init() {
    $("research-query").value = String(window.arguments?.[0]?.query || "");
    bind(); Z.ZotQueryModelPreferences?.bindVision(window, "research-vision", "research-vision-state"); window.addEventListener("focus", refreshModelSummary); await refreshModelSummary(); await refreshHealth(); $("research-query").focus();
  }

  window.addEventListener("DOMContentLoaded", init, { once: true });
  window.addEventListener?.("unload", () => state.runControl?.cancel());
})();
