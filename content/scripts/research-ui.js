/* ZotQuery user interface.
 * Replaces the upstream ZotQuery discovery controls with a workflow-oriented
 * research entry point while preserving the proven PDF indexing engine.
 */
"use strict";

((global) => {
  const VERSION = "3.0.13";
  let dashboardWindow = null;
  let observer = null;
  let refreshTimer = null;

  const log = (...parts) => Zotero.debug(`[ZotQuery UI] ${parts.join(" ")}`);
  const isChinese = () => /^zh(?:-|$)/i.test(String(Zotero.locale || Services.locale?.appLocaleAsBCP47 || "en-US"));
  const uiText = (zh, en) => isChinese() ? zh : en;
  const EN_PREFS = {
    "PDF 与笔记检索、证据审阅、Survey 和研究输出。": "PDF and note search, evidence review, surveys, and research output.",
    "研究系统状态": "Research status", "整体": "Overall", "PDF 索引": "PDF index", "阅读笔记": "Indexed notes",
    "Note 向量覆盖": "Note vector coverage", "共享模型合同": "Shared-model contract", "PDF 与笔记共用模型": "Model shared by PDFs and notes",
    "检查中…": "Checking…", "刷新状态": "Refresh status", "打开研究工作台": "Open research workspace",
    "笔记索引": "Note indexing", "文库范围": "Library scope", "我的文库": "My Library", "全部文库": "All libraries",
    "笔记范围": "Note scope", "兼容旧版精读笔记": "Legacy reading notes", "全部笔记": "All notes",
    "按标题或内容字面量": "Match title or content", "匹配字面量": "Match text", "自动跟踪笔记变更": "Track note changes automatically",
    "解析配置": "Parsing profile", "保存笔记索引设置": "Save note index settings", "立即同步笔记与向量": "Sync notes and vectors now",
    "读取中…": "Loading…", "PDF 原文索引": "PDF full-text index",
    "PDF chunks 是精确事实和稳定 locator 的原始证据层。更新会跳过已完成项目；重建只在模型、范围或切分策略发生实质变化时使用。": "PDF chunks provide source locations. Update skips completed items; rebuild only after substantive model, scope, or chunking changes.",
    "更新 PDF 索引": "Update PDF index", "重建 PDF 索引": "Rebuild PDF index", "刷新 PDF 统计": "Refresh PDF statistics",
    "内容范围": "Content scope", "仅题名与摘要": "Title and abstract only", "完整 PDF（推荐）": "Full PDF (recommended)",
    "自动索引新文献": "Index new papers automatically", "自动索引延迟（秒）": "Auto-index delay (seconds)",
    "排除书籍": "Exclude books", "排除标签": "Exclusion tag", "共享向量模型": "Shared embedding model",
    "PDF chunks 与 Note segments 始终调用同一个 ZotQuery 向量模型。切换模型后，两类索引都会按 model ID 增量补齐，旧向量不会被破坏。": "PDF chunks and note segments use the same active embedding model. Switching models fills both indexes by model ID without deleting old vectors.",
    "当前模型": "Active model", "本机或局域网 embedding server": "Local or LAN embedding server",
    "连接兼容 OpenAI embedding API 的本机或可信局域网服务。支持 10.x、172.16–31.x、192.168.x 私有 IPv4 地址；HTTP 连接不加密。不同服务地址使用独立向量缓存，切换地址后需补建索引。": "Connect a local or trusted-LAN OpenAI-compatible embedding service. Private IPv4 ranges 10.x, 172.16–31.x and 192.168.x are allowed; HTTP is unencrypted. Each server address has a separate vector cache; changing addresses requires indexing the new model.",
    "地址": "Address", "连接并列出模型": "Connect and list models", "加入共享模型": "Add to shared models",
    "API key（可选）": "API key (optional)",
    "笔记模板与研究输出": "Note templates and research output", "自定义笔记模板": "Custom note template",
    "从模板生成并导入 Note Profile JSON": "Generate and import a Note Profile JSON",
    "粘贴 Markdown 模板后生成草稿。请自行核对 selector 与每个 evidenceTags 的角色；系统不会自动把普通段落认作原始证据。": "Paste a Markdown template to create a draft. Review the selector and every evidence tag role before import.",
    "粘贴 Markdown 笔记模板": "Paste a Markdown note template", "生成待审草稿": "Create draft", "校验 JSON": "Validate JSON",
    "确认并导入": "Confirm and import", "默认研究输出格式": "Default research output",
    "保存默认格式": "Save default format", "导入 Output Profile JSON": "Import an Output Profile JSON",
    "自定义格式必须保留 Query Contract、研究漏斗、Coverage Gate、候选审计、事实槽、冲突和来源。": "Custom formats must retain the Query Contract, research funnel, Coverage Gate, candidate audit, fact slots, conflicts, and sources.",
    "Agent 与统一 MCP": "Agent and unified MCP", "研究工具统一从本机 ZotQuery MCP 端点提供。": "Research tools are available through the local ZotQuery MCP endpoint.",
    "复制 MCP 令牌": "Copy MCP token", "更换 MCP 令牌": "Rotate MCP token", "连接须使用 Authorization: Bearer 令牌；请勿公开令牌。": "Connect with an Authorization: Bearer token. Never share it.",
    "高级检索与维护": "Advanced search and maintenance", "每个 PDF chunk 最大 tokens": "Maximum tokens per PDF chunk",
    "每篇最大 chunks": "Maximum chunks per paper", "快速检索 Top K": "Quick-search Top K", "最低相似度 %": "Minimum similarity %",
    "空闲时自动整理数据库": "Compact database when idle",
    "以下操作只维护 PDF embedding 数据库，不会删除 Zotero 文献或笔记。": "These operations maintain the PDF embedding database; Zotero items and notes remain untouched.",
    "整理数据库": "Compact database", "清空 PDF 索引": "Clear PDF index", "清理失联向量": "Purge orphan vectors", "失联向量：-": "Orphan vectors: -",
  };
  function localizePreferences(win) {
    if (isChinese()) return;
    const root = win?.document?.getElementById("zotquery-preferences");
    if (!root) return;
    for (const node of root.querySelectorAll("*")) {
      for (const attribute of ["label", "placeholder"]) {
        const value = node.getAttribute?.(attribute);
        if (value && EN_PREFS[value]) node.setAttribute(attribute, EN_PREFS[value]);
      }
    }
    const walker = win.document.createTreeWalker(root, 4);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.localName === "textarea") continue;
      const value = node.nodeValue?.trim();
      if (value && EN_PREFS[value]) node.nodeValue = node.nodeValue.replace(value, EN_PREFS[value]);
    }
  }

  function openDashboard(options = {}) {
    try {
      if (dashboardWindow && !dashboardWindow.closed && !Components.utils.isDeadWrapper(dashboardWindow)) {
        dashboardWindow.focus();
        if (options.query) dashboardWindow.setResearchQuery?.(String(options.query));
        return dashboardWindow;
      }
      dashboardWindow = Zotero.getMainWindow().openDialog(
        "chrome://zotquery/content/researchDashboard.xhtml",
        "zotquery-lne-research-dashboard",
        "chrome,centerscreen,resizable,dialog=no,width=980,height=720",
        { query: String(options.query || "") }
      );
      return dashboardWindow;
    } catch (e) {
      Zotero.logError(e);
      return null;
    }
  }

  function replaceButton(node, { label, tooltip, onCommand, id = null }) {
    if (!node?.parentNode) return null;
    const fresh = node.cloneNode(false);
    if (id) fresh.id = id;
    for (const attr of ["command", "oncommand", "mousedown", "onmousedown"]) fresh.removeAttribute(attr);
    fresh.setAttribute("label", label);
    fresh.setAttribute("tooltiptext", tooltip);
    fresh.style.listStyleImage = 'url("chrome://zotquery/content/icons/icon-toolbar.svg")';
    const eventName = String(fresh.localName || "").toLowerCase() === "menuitem" ? "command" : "click";
    fresh.addEventListener(eventName, onCommand);
    node.replaceWith(fresh);
    return fresh;
  }

  function customizeMainWindow(win = Zotero.getMainWindow()) {
    const doc = win?.document;
    if (!doc) return;

    // Remove the upstream toolbar entry; keep context-menu and settings access.
    doc.getElementById("zotquery-toolbar-button")?.remove();

    const contextIds = ["zotquery-find-similar", "zotquery-open-dialog"];
    const first = doc.getElementById(contextIds[0]);
    if (first && first.getAttribute("data-lne-ui") !== "3") {
      const fresh = replaceButton(first, {
        label: "ZotQuery 研究工作台",
        tooltip: "打开统一 PDF + Note 研究入口",
        onCommand: () => openDashboard(),
      });
      fresh?.setAttribute("data-lne-ui", "3");
    }
    doc.getElementById(contextIds[1])?.remove();

    const labels = {
      "zotquery-index-selected": "更新所选文献的 PDF 索引",
      "zotquery-index-collection": "更新所选分类的 PDF 索引",
      "zotquery-index-library": "更新全部 PDF 索引",
      "zotquery-remove-from-index": "从 PDF 索引移除所选文献",
    };
    for (const [id, label] of Object.entries(labels)) doc.getElementById(id)?.setAttribute("label", label);

    const toolsItem = doc.getElementById("zotquery-menuTools-search")
      || doc.querySelector('[data-l10n-id="zotquery-menuTools-search"]')
      || Array.from(doc.querySelectorAll("#menu_ToolsPopup menuitem")).find(node =>
        [node.getAttribute("label"), node.label, node.querySelector(".menu-text")?.textContent?.trim(), node.textContent?.trim()]
          .some(value => value === "ZotQuery")
      );
    toolsItem?.remove();

    for (const reader of Zotero.Reader?._readers || []) customizeReader(reader);
  }

  function customizeReader(reader) {
    try {
      const doc = reader?._iframeWindow?.document;
      for (const button of doc?.querySelectorAll?.(".zotquery-reader-button") || []) {
        if (button.getAttribute("data-lne-ui") === "3") continue;
        const fresh = button.cloneNode(true);
        fresh.setAttribute("data-lne-ui", "3");
        fresh.title = "在 ZotQuery 中研究当前论文";
        fresh.addEventListener("click", event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          const item = reader?._item?.parentItem || (reader?._item?.parentItemID ? Zotero.Items.get(reader._item.parentItemID) : reader?._item);
          openDashboard({ query: item?.getField?.("title") || "" });
        }, true);
        button.replaceWith(fresh);
      }
    } catch (e) {
      log("reader customization skipped:", e?.message || e);
    }
  }

  async function health() {
    if (!Zotero.ZotQueryResearch?.health) throw new Error(`Research Engine is unavailable${Zotero.ZotQueryStartupErrors?.research ? `: ${Zotero.ZotQueryStartupErrors.research}` : ""}`);
    return Zotero.ZotQueryResearch.health();
  }

  async function syncNotes() {
    if (!Zotero.ZotQueryLNE?.api?.refresh) throw new Error("Native LNE is unavailable");
    const notes = await Zotero.ZotQueryLNE.api.refresh();
    const vectors = await Zotero.ZotQueryLNE.api.refreshSemantic();
    return { notes, vectors };
  }

  async function refreshPreferenceHealth(win) {
    const doc = win?.document;
    if (!doc) return;
    const set = (id, value, state = "") => {
      const el = doc.getElementById(id);
      if (!el) return;
      el.textContent = value;
      if (state) el.setAttribute("data-state", state);
      else el.removeAttribute("data-state");
    };
    set("lne-health-overall", uiText("检查中…", "Checking…"));
    try {
      const h = await health();
      set("lne-health-overall", h.ok ? uiText("运行正常", "Healthy") : uiText("需要处理", "Needs attention"), h.ok ? "ok" : "bad");
      set("lne-health-pdfs", `${h.search?.indexedPapers || 0} / ${h.search?.totalPapers || 0}`);
      set("lne-health-notes", `${h.lne?.notes || 0}`);
      set("lne-health-segments", `${h.lne?.segments || 0}`);
      set("lne-health-vectors", `${h.lne?.semantic?.vectors || 0} / ${h.lne?.semantic?.totalUniqueSegments || 0}`);
      set("lne-health-model", h.embeddingContract?.pdfModelId || uiText("未配置", "Not configured"));
      set("lne-health-contract", !h.embeddingContract?.sameModel ? uiText("模型不一致", "Model mismatch") : h.embeddingContract.queryReady ? uiText("同一模型，查询可用", "Same model; query ready") : uiText("模型一致，查询不可用", "Same model; query unavailable"), h.embeddingContract?.sameModel && h.embeddingContract.queryReady ? "ok" : "bad");
      set("lne-health-mcp", `http://127.0.0.1:${Zotero.Server?.port || 23119}/zotquery/mcp`);
    } catch (e) {
      set("lne-health-overall", `${uiText("检查失败", "Check failed")}: ${e?.message || e}`, "bad");
      for (const id of ["lne-health-pdfs", "lne-health-notes", "lne-health-segments", "lne-health-vectors", "lne-health-model", "lne-health-contract"]) set(id, "-");
    }
  }

  function refreshProfilePreferences(win) {
    const doc = win?.document;
    if (!doc) return;
    const noteAPI = Zotero.ZotQueryNoteProfiles;
    const outputAPI = Zotero.ZotQueryOutputProfiles;
    const fill = (id, choices, selected) => {
      const menu = doc.getElementById(id);
      const popup = menu?.querySelector("menupopup");
      if (!popup) return;
      while (popup.firstChild) popup.firstChild.remove();
      for (const choice of choices) {
        const item = doc.createXULElement ? doc.createXULElement("menuitem") : doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "menuitem");
        item.setAttribute("label", choice.label);
        item.setAttribute("value", choice.value);
        popup.appendChild(item);
      }
      menu.value = selected;
    };
    const noteStatus = doc.getElementById("lne-note-profile-status");
    const outputStatus = doc.getElementById("lne-output-profile-status");
    if (noteAPI) {
      const active = noteAPI.active() || "";
      fill("lne-note-profile", [{value:"",label:uiText("自动识别（通用及兼容格式）", "Auto-detect (generic and compatible formats)")}, ...noteAPI.list().map(p => ({value:p.id,label:`${p.name} [${p.source}]`}))], active);
      const scope = String(Zotero.Prefs.get("zotquery.lneNative.noteScope", true) || "all");
      doc.getElementById("lne-note-scope").value = scope;
      doc.getElementById("lne-note-library-scope").value = String(Zotero.Prefs.get("zotquery.lneNative.libraryScope", true) || "user");
      doc.getElementById("lne-note-autosync").checked = Zotero.Prefs.get("zotquery.lneNative.autoSync", true) === true;
      doc.getElementById("lne-note-title-pattern").value = String(Zotero.Prefs.get("zotquery.lneNative.titlePattern", true) || "");
      noteStatus.textContent = uiText(`当前：${active || "自动识别"}；笔记范围：${scope}。`, `Current: ${active || "auto-detect"}; note scope: ${scope}.`);
    } else noteStatus.textContent = uiText(`Note Profile 未启动${Zotero.ZotQueryStartupErrors?.lne ? `：${Zotero.ZotQueryStartupErrors.lne}` : ""}`, `Note Profile unavailable${Zotero.ZotQueryStartupErrors?.lne ? `: ${Zotero.ZotQueryStartupErrors.lne}` : ""}`);
    if (outputAPI) {
      const selected = String(Zotero.Prefs.get("zotquery.outputProfile", true) || "standard");
      fill("lne-output-profile", outputAPI.list().map(p => ({value:p.id,label:`${p.name} [${p.source}]`})), outputAPI.get(selected) ? selected : "standard");
      outputStatus.textContent = uiText(`默认 ${selected}。`, `Default: ${selected}.`);
    } else outputStatus.textContent = uiText(`Output Profile 未启动${Zotero.ZotQueryStartupErrors?.research ? `：${Zotero.ZotQueryStartupErrors.research}` : ""}`, `Output Profile unavailable${Zotero.ZotQueryStartupErrors?.research ? `: ${Zotero.ZotQueryStartupErrors.research}` : ""}`);
  }

  function bindProfilePreferences(win) {
    const doc = win?.document;
    if (!doc) return;
    const status = (id, message, error = false) => {
      const node = doc.getElementById(id);
      if (node) { node.textContent = message; node.setAttribute("data-state", error ? "bad" : "ok"); }
    };
    const parsed = id => JSON.parse(doc.getElementById(id)?.value || "");
    const confirm = message => Services.prompt.confirm(win, "ZotQuery", message);
    doc.getElementById("lne-note-profile-apply")?.addEventListener("command", () => {
      try {
        const api = Zotero.ZotQueryNoteProfiles;
        if (!api) throw new Error(uiText("Note Profile 未启动", "Note Profile unavailable"));
        const id = String(doc.getElementById("lne-note-profile").value || "");
        const scope = String(doc.getElementById("lne-note-scope").value || "all");
        const libraryScope = String(doc.getElementById("lne-note-library-scope").value || "user");
        const autoSync = doc.getElementById("lne-note-autosync").checked === true;
        const pattern = String(doc.getElementById("lne-note-title-pattern").value || "").trim();
        if (!["reading-notes", "all", "pattern"].includes(scope)) throw new Error(uiText("索引范围无效", "Invalid note scope"));
        if (!["user", "all"].includes(libraryScope)) throw new Error(uiText("文库范围无效", "Invalid library scope"));
        if (scope !== "all" && !pattern) throw new Error(uiText("请填写笔记匹配字面量", "Enter note match text"));
        if (!confirm(uiText("保存后需重启 Zotero 才会按新范围重新同步笔记索引。缩小范围会移除不再匹配的索引记录，不会删除 Zotero 原始笔记或 PDF 索引。继续吗？", "Restart Zotero after saving to resync the note index. Narrowing the scope removes unmatched index records, not original Zotero notes or the PDF index. Continue?"))) return;
        api.select(id, {confirmed:true});
        Zotero.Prefs.set("zotquery.lneNative.noteScope", scope, true);
        Zotero.Prefs.set("zotquery.lneNative.libraryScope", libraryScope, true);
        Zotero.Prefs.set("zotquery.lneNative.autoSync", autoSync, true);
        Zotero.Prefs.set("zotquery.lneNative.titlePattern", pattern, true);
        refreshProfilePreferences(win);
        status("lne-note-profile-status", uiText("笔记索引设置已保存；请重启 Zotero 后刷新状态。", "Note index settings saved. Restart Zotero, then refresh status."));
      } catch (e) { status("lne-note-profile-status", e?.message || String(e), true); }
    });
    doc.getElementById("lne-note-profile-draft")?.addEventListener("command", () => {
      try {
        const draft = Zotero.ZotQueryNoteProfiles.draftFromTemplate(doc.getElementById("lne-note-template-input").value);
        doc.getElementById("lne-note-profile-json").value = JSON.stringify(draft, null, 2);
        status("lne-note-profile-import-status", uiText("草稿已生成；请填写 selector.patterns，并逐条核对证据角色后再导入。", "Draft created. Fill selector.patterns and review each evidence role before import."));
      } catch (e) { status("lne-note-profile-import-status", e?.message || String(e), true); }
    });
    doc.getElementById("lne-note-profile-validate")?.addEventListener("command", () => {
      try { const result = Zotero.ZotQueryNoteProfiles.validate(parsed("lne-note-profile-json")); status("lne-note-profile-import-status", result.valid ? uiText("Note Profile JSON 校验通过。", "Note Profile JSON is valid.") : result.errors.join("; "), !result.valid); }
      catch (e) { status("lne-note-profile-import-status", e?.message || String(e), true); }
    });
    doc.getElementById("lne-note-profile-install")?.addEventListener("command", async () => {
      try {
        const value = parsed("lne-note-profile-json");
        const result = Zotero.ZotQueryNoteProfiles.validate(value);
        if (!result.valid) throw new Error(result.errors.join("；"));
        if (!confirm(uiText(`确认导入 Note Profile「${value.name}」？请确保 selector 和证据角色已人工核对。`, `Import Note Profile “${value.name}”? Confirm its selector and evidence roles first.`))) return;
        const installed = await Zotero.ZotQueryNoteProfiles.installCustom(value, {confirmed:true});
        refreshProfilePreferences(win);
        status("lne-note-profile-import-status", uiText(`已导入 ${installed.id}；如需启用，请在上方选择并应用。`, `Imported ${installed.id}. Select it above and save to activate.`));
      } catch (e) { status("lne-note-profile-import-status", e?.message || String(e), true); }
    });
    doc.getElementById("lne-output-profile-save")?.addEventListener("command", () => {
      try {
        const id = String(doc.getElementById("lne-output-profile").value || "");
        if (!Zotero.ZotQueryOutputProfiles?.get(id)) throw new Error(uiText("输出配置不存在", "Output profile not found"));
        Zotero.Prefs.set("zotquery.outputProfile", id, true);
        refreshProfilePreferences(win);
        status("lne-output-profile-status", uiText(`默认输出已设为 ${id}。`, `Default output set to ${id}.`));
      } catch (e) { status("lne-output-profile-status", e?.message || String(e), true); }
    });
    doc.getElementById("lne-output-profile-validate")?.addEventListener("command", () => {
      try { const result = Zotero.ZotQueryOutputProfiles.validate(parsed("lne-output-profile-json")); status("lne-output-profile-import-status", result.valid ? uiText("Output Profile JSON 校验通过。", "Output Profile JSON is valid.") : result.errors.join("; "), !result.valid); }
      catch (e) { status("lne-output-profile-import-status", e?.message || String(e), true); }
    });
    doc.getElementById("lne-output-profile-install")?.addEventListener("command", async () => {
      try {
        const value = parsed("lne-output-profile-json");
        const result = Zotero.ZotQueryOutputProfiles.validate(value);
        if (!result.valid) throw new Error(result.errors.join("；"));
        if (!confirm(uiText(`确认导入 Output Profile「${value.name}」？必需的研究合同与门禁字段会保留。`, `Import Output Profile “${value.name}”? Required contract and gate sections will remain.`))) return;
        const installed = await Zotero.ZotQueryOutputProfiles.installCustom(value, {confirmed:true});
        refreshProfilePreferences(win);
        status("lne-output-profile-import-status", uiText(`已导入 ${installed.id}；可在上方设为默认格式。`, `Imported ${installed.id}. You can select it as the default above.`));
      } catch (e) { status("lne-output-profile-import-status", e?.message || String(e), true); }
    });
    refreshProfilePreferences(win);
  }

  function onPrefsLoad(win) {
    const doc = win?.document;
    const root = doc?.getElementById("zotquery-preferences");
    if (!root || root.getAttribute("data-lne-bound") === "1") return;
    root.setAttribute("data-lne-bound", "1");
    const navigation = doc.getElementById("prefs-navigation");
    if (navigation) {
      for (const item of navigation.querySelectorAll('[label="ZotQuery"], [aria-label="ZotQuery"]')) {
        if (item.getAttribute("label") === "ZotQuery") item.setAttribute("label", "ZotQuery");
        if (item.getAttribute("aria-label") === "ZotQuery") item.setAttribute("aria-label", "ZotQuery");
      }
      const walker = doc.createTreeWalker(navigation, 4);
      while (walker.nextNode()) {
        if (walker.currentNode.nodeValue?.trim() === "ZotQuery") {
          walker.currentNode.nodeValue = "ZotQuery";
        }
      }
    }
    doc.getElementById("lne-refresh-health")?.addEventListener("command", () => refreshPreferenceHealth(win));
    doc.getElementById("lne-sync-notes")?.addEventListener("command", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.setAttribute("label", uiText("同步中…", "Syncing…"));
      try { await syncNotes(); await refreshPreferenceHealth(win); }
      catch (e) { Services.prompt.alert(win, "ZotQuery", e?.message || String(e)); }
      finally { button.disabled = false; button.setAttribute("label", uiText("立即同步笔记与向量", "Sync notes and vectors now")); }
    });
    doc.getElementById("lne-open-dashboard")?.addEventListener("command", () => openDashboard());
    doc.getElementById("lne-copy-mcp-token")?.addEventListener("command", () => {
      const status = doc.getElementById("lne-mcp-token-status");
      try {
        const token = Zotero.ZotQueryResearch?.getMcpToken?.();
        if (!token) throw new Error(uiText("Research Engine 未启动", "Research Engine is unavailable"));
        Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(token);
        if (status) status.textContent = uiText("令牌已复制；请保密并配置为 Bearer 请求头。", "Token copied. Keep it private and use it in the Bearer header.");
      } catch (e) { if (status) status.textContent = e?.message || String(e); }
    });
    doc.getElementById("lne-rotate-mcp-token")?.addEventListener("command", () => {
      const status = doc.getElementById("lne-mcp-token-status");
      if (!Services.prompt.confirm(win, "ZotQuery", uiText("更换令牌会立刻断开所有使用旧令牌的客户端。继续吗？", "Rotating the token immediately disconnects clients using the old token. Continue?"))) return;
      try {
        if (!Zotero.ZotQueryResearch?.rotateMcpToken) throw new Error(uiText("Research Engine 未启动", "Research Engine is unavailable"));
        Zotero.ZotQueryResearch.rotateMcpToken();
        if (status) status.textContent = uiText("令牌已更换；请复制新令牌并更新客户端。", "Token rotated. Copy the new token and update your clients.");
      } catch (e) { if (status) status.textContent = e?.message || String(e); }
    });
    bindProfilePreferences(win);
    localizePreferences(win);
    refreshPreferenceHealth(win);
  }

  function onPrefsUnload() {}

  async function startup() {
    customizeMainWindow();
    const win = Zotero.getMainWindow();
    if (win?.MutationObserver) {
      let queued = false;
      observer = new win.MutationObserver(() => {
        if (queued) return;
        queued = true;
        win.setTimeout(() => { queued = false; customizeMainWindow(win); }, 0);
      });
      observer.observe(win.document.documentElement, { childList: true, subtree: true });
    }
    refreshTimer = win?.setInterval?.(() => customizeMainWindow(win), 5000) || null;
    log("started", VERSION);
  }

  async function shutdown() {
    observer?.disconnect();
    observer = null;
    const win = Zotero.getMainWindow();
    if (refreshTimer) win?.clearInterval?.(refreshTimer);
    refreshTimer = null;
    try { dashboardWindow?.close(); } catch (_) {}
    dashboardWindow = null;
    delete Zotero.ZotQueryResearchUI;
  }

  const api = { version: VERSION, startup, shutdown, openDashboard, customizeMainWindow, onPrefsLoad, onPrefsUnload, health, syncNotes };
  Zotero.ZotQueryResearchUI = api;
  global.ZotQueryResearchUIBootstrap = { startup, shutdown };
})(typeof _globalThis !== "undefined" ? _globalThis : this);
