/* ZotQuery 3.1.8 research workbench controller. */
(function () {
  "use strict";

  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const Z = window.opener?.Zotero || Zotero;
  const state = { sessionId: null, sessionSignature: null, running: false, surveyId: null, ledger: null, positions: [], selectedPosition: null, markdown: "" };
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
    for (const id of ["research-query", "question-mode", "survey-preset", "reading-policy", "include-semantic", "lexical-only", "run-research", "agent-generate"]) $(id).disabled = locked;
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
      $("fact-slot").value = slots[0].id || "answer";
      if ([...$("fact-type").options].some(x => x.value === slots[0].type)) $("fact-type").value = slots[0].type;
    }
    if (!state.running) setWorkflow(ledger?.synthesisAllowed ? "output" : "evidence");
  }

  async function refreshLedger() {
    if (!state.sessionId) return null;
    const ledger = await Z.ZotQueryResearch.sessionLedger(state.sessionId);
    renderLedger(ledger);
    return ledger;
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
    state.running = true;
    lockResearch(true);
    try {
      const q = question();
      await busy(event.currentTarget, "正在创建…", async () => {
        await ensureSession(q, true); showTab("evidence");
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
      const head = h("div", "card-head"); head.append(h("div", "rank", `#${index + 1}`));
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

  async function loadPositions() {
    if (!state.sessionId) return;
    try {
      notify("正在列出门禁证据位置…");
      const payload = await Z.ZotQueryResearch.positions(state.sessionId, { scope: "coverage", offset: 0, limit: 100, compact: true, includeLinks: true });
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

  const outputProfile = () => String(Z.Prefs.get("zotquery.outputProfile", true) || "standard");
  async function refreshModelSummary() {
    try {
      const config = Z.ZotQueryModelAgent.getConfig();
      text("active-model", config.model ? config.model + " · 思考强度 " + (config.reasoningEffort || "auto") : "请先在 ZotQuery 设置中配置输出模型");
      const info = await Z.ZotQueryModelAgent.templateInfo();
      text("active-template", info.configured ? "模板：" + info.name : info.error ? "模板不可用，请到设置检查" : "无模板 · 自由回答");
    } catch (error) { text("active-model", "模型配置不可用，请打开 ZotQuery 设置"); }
  }

  function appendAgentEvent(event) {
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

  async function generateWithAgent(event) {
    if (state.running) return;
    state.running = true;
    lockResearch(true);
    try {
      const q = question();
      await busy(event.currentTarget, "研究与回答中…", async () => {
        const template = await Z.ZotQueryModelAgent.getTemplate();
        await refreshModelSummary();
        // One action prepares the evidence session, then lets the model use its
        // tools to read/review/finalize and write. No separate manual click.
        await ensureSession(q);
        setWorkflow("retrieve");
        const log = $("agent-log"); log.textContent = ""; log.classList.remove("hidden");
        showTab("report"); setWorkflow("retrieve"); notify("输出大模型正在通过内置 MCP 等价工具链执行研究…");
        const result = await Z.ZotQueryModelAgent.runAgent({
          question: q, sessionId: state.sessionId, profileId: outputProfile(),
          questionMode: $("question-mode").value, readingPolicy: $("reading-policy").value,
          surveyPreset: $("survey-preset").value, onEvent: appendAgentEvent,
          templateMarkdown: template.markdown, templateName: template.name,
        });
        state.sessionId = result.sessionId; state.markdown = result.markdown || "";
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
      });
    } catch (error) { text("agent-status", "研究失败，请查看下方提示"); notify(`API 代理失败：${errorMessage(error)}`, "error"); }
    finally { state.running = false; lockResearch(false); }
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
    }));
    $("run-research").addEventListener("click", startResearch);
    $("load-positions").addEventListener("click", loadPositions); $("finalize-session").addEventListener("click", finalizeSession);
    $("close-context").addEventListener("click", () => $("context-drawer").classList.add("hidden"));
    $("review-support").addEventListener("click", () => review("support"));
    $("review-exclude").addEventListener("click", () => review("exclude"));
    $("review-more").addEventListener("click", () => review("more"));
    $("record-fact").addEventListener("click", recordFact);
    $("render-report").addEventListener("click", renderReport); $("agent-generate").addEventListener("click", generateWithAgent); $("copy-report").addEventListener("click", copyReport);
    $("save-report").addEventListener("click", saveReport); $("refresh-health").addEventListener("click", refreshHealth);
    $("answer-read").addEventListener("click", () => showAnswerMode(false));
    $("answer-source").addEventListener("click", () => showAnswerMode(true));
    $("report-editor").addEventListener("input", () => {
      const empty = !$("report-editor").value;
      $("copy-report").disabled = empty; $("save-report").disabled = empty;
    });
    $("sync-notes").addEventListener("click", syncNotes);
    $("open-settings").addEventListener("click", () => {
      try { Z.Utilities.Internal.openPreferences("zotquery@poesein.github.io"); }
      catch (error) { notify("无法打开设置：" + errorMessage(error), "error"); }
    });
    $("research-query").addEventListener("input", () => setWorkflow("query"));
    $("research-query").addEventListener("keydown", event => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!$("agent-generate").disabled) generateWithAgent({ currentTarget: $("agent-generate") }); }
    });
  }

  async function init() {
    $("research-query").value = String(window.arguments?.[0]?.query || "");
    bind(); window.addEventListener("focus", refreshModelSummary); await refreshModelSummary(); await refreshHealth(); $("research-query").focus();
  }

  window.addEventListener("DOMContentLoaded", init, { once: true });
})();
