/* ZotQuery Output Profiles render stored evidence; they never relax research gates. */
(function (global) {
  "use strict";
  const BUILTINS = ["compact", "standard", "exact", "exhaustive-vnext"];
  const MANDATORY = ["status", "queryContract", "funnel", "coverageGate", "evidenceSlots", "candidateAudit", "facts", "conflicts", "gaps", "references"];
  const OPTIONAL = new Set(["summary", "identity", "corpusHealth", "evidenceUnits", "claims", "audit", "machineAppendix"]);
  const profiles = new Map();
  let rootURI = null;
  const safe = value => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  const linked = (label, url) => /^zotero:\/\/(?:select|open-pdf)\/(?:library|groups\/\d+)\/items\/[A-Z0-9]{8}(?:\?page=\d+)?$/.test(String(url || ""))
    ? `[${safe(label).replace(/[\[\]]/g, "\\$&")}](${url})` : safe(label);
  function factSource(fact) {
    const locator = fact?.locator || {}, links = fact?.links || {};
    const where = [locator.pageNumber != null ? `PDF p.${locator.pageNumber}` : null, locator.chunkIndex != null ? `chunk ${locator.chunkIndex}` : null,
      locator.noteKey && locator.lineStart != null ? `${locator.noteKey}:L${locator.lineStart}-L${locator.lineEnd ?? locator.lineStart}` : null].filter(Boolean).join(" / ");
    const targets = [links.pdfPage ? linked("打开 PDF 页", links.pdfPage) : null, links.note ? linked("打开笔记", links.note) : null,
      links.parent ? linked("父条目", links.parent) : null].filter(Boolean).join("；");
    return [safe(where || fact?.positionId || "定位未记录"), targets].filter(Boolean).join("；");
  }
  function validate(value) {
    const errors = [];
    if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: ["output profile must be a JSON object"] };
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(String(value.id || ""))) errors.push("invalid output profile id");
    if (!String(value.name || "").trim()) errors.push("name is required");
    if (!String(value.version || "").trim()) errors.push("version is required");
    if (!Array.isArray(value.sections)) errors.push("sections must be an array");
    else {
      for (const section of MANDATORY) if (!value.sections.includes(section)) errors.push(`mandatory section cannot be omitted: ${section}`);
      for (const section of value.sections) if (!MANDATORY.includes(section) && !OPTIONAL.has(section)) errors.push(`unknown section: ${section}`);
      if (new Set(value.sections).size !== value.sections.length) errors.push("duplicate section");
    }
    if (value.templateMarkdown !== undefined && (typeof value.templateMarkdown !== "string" || !value.templateMarkdown.trim() || value.templateMarkdown.length > 65536))
      errors.push("templateMarkdown must be non-empty Markdown of at most 65536 characters");
    if (value.templateSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(String(value.templateSha256)))
      errors.push("templateSha256 must be a 64-character SHA-256 hex digest");
    if (value.layout !== undefined && value.layout !== "structured-vnext") errors.push("unknown output layout");
    return { valid: !errors.length, errors };
  }
  function register(value, source) { const check = validate(value); if (!check.valid) throw new Error(check.errors.join("; ")); const profile = { ...value, source };
    // The previously distributed vNext JSON used this id with an inert Markdown
    // appendix. Keep that installed user file intact and render it structurally.
    if (profile.id === "zotquery-full-research-vnext" && profile.templateMarkdown && !profile.layout) profile.layout = "structured-vnext";
    profiles.set(profile.id, profile); return profile; }
  async function readBundled(id) {
    const url = `${rootURI}content/profiles/outputs/${id}.json`;
    const text = Zotero.File.getResourceAsync ? await Zotero.File.getResourceAsync(url) : Zotero.File.getResource(url);
    return JSON.parse(text);
  }
  async function reloadCustom() {
    const directory = PathUtils.join(Zotero.DataDirectory.dir, "zotquery", "profiles", "outputs");
    if (!(await IOUtils.exists(directory))) return { directory, loaded: 0 };
    let loaded = 0;
    for (const path of await IOUtils.getChildren(directory)) {
      if (!/\.json$/i.test(path)) continue;
      try { const parsed = JSON.parse(await IOUtils.readUTF8(path)); if (BUILTINS.includes(parsed.id)) throw new Error("built-in id is reserved"); register(parsed, "custom"); loaded++; }
      catch (e) { Zotero.debug(`[ZotQuery Output Profiles] Ignored ${path}: ${e?.message || e}`); }
    }
    return { directory, loaded };
  }
  async function startup({ rootURI: uri }) { rootURI = uri; profiles.clear(); for (const id of BUILTINS) register(await readBundled(id), "built-in"); await reloadCustom(); }
  function get(id) { return profiles.get(String(id || "")) || null; }
  function list() { return [...profiles.values()].map(p => ({ id: p.id, name: p.name, version: p.version, source: p.source, sections: p.sections, layout: p.layout || "sections" })); }
  async function installCustom(value, { confirmed = false } = {}) {
    if (!confirmed) throw new Error("Confirm the section mapping before installing an Output Profile");
    if (BUILTINS.includes(value?.id)) throw new Error("Built-in id is reserved");
    const check = validate(value); if (!check.valid) throw new Error(check.errors.join("; "));
    const directory = PathUtils.join(Zotero.DataDirectory.dir, "zotquery", "profiles", "outputs");
    await IOUtils.makeDirectory(directory, { createAncestors: true });
    const path = PathUtils.join(directory, `${value.id}.json`);
    if (await IOUtils.exists(path)) throw new Error("Profile already exists; choose another id or remove it explicitly");
    await IOUtils.writeUTF8(path, JSON.stringify(value, null, 2));
    return register(value, "custom");
  }
  function renderStructured(result, profile) {
    const permitted = result?.coverageGate?.synthesisAllowed === true && result?.status === "ready_for_synthesis";
    const q = result?.queryContract || {}, c = result?.coverage || {}, f = result?.funnel || {}, p = result?.pagination || {};
    const show = value => value == null || value === "" ? "未记录" : safe(value);
    const yes = value => value == null ? "未记录" : value ? "是" : "否";
    const table = (headers, rows) => [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows.map(cells => `| ${cells.map(show).join(" | ")} |`)];
    const refs = new Map((result?.references || []).map(x => [x.workKey, x]));
    const lines = [
      `# ${safe(result?.question || "Research session")}（${permitted ? "证据就绪" : "阶段性报告"}）`, "",
      "## 1. 报告状态与可交付边界", "",
      ...table(["字段", "本次值"], [
        ["Research session", result?.sessionId], ["报告数据版本", result?.reportVersion], ["Output Profile", profile.id],
        ["问题模式", result?.questionMode], ["会话状态", result?.status], ["synthesisAllowed", permitted],
      ]), "",
      permitted ? "已通过 Coverage Gate；下文仍是可核验的证据台账，不自动生成机制综合或最终答案。" : "Coverage Gate 未通过：只能交付阶段性证据台账，不得形成确定答案。", "",
      "## 2. Query Contract 与标识符身份", "",
      `硬检索表达式：\`${safe(q.hardExpression || "未记录")}\``, "",
      ...table(["Group ID", "角色", "原始词面", "别名（组内 OR）", "来源"], [
        ...(q.mustGroups || []).map(g => [g.id, "MUST", g.surface || "未记录", (g.aliases || []).join(" OR "), g.source]),
        ...(q.shouldGroups || []).map(g => [g.id, "SHOULD", g.surface || "未记录", (g.aliases || []).join(" OR "), g.source]),
        ...(!(q.mustGroups?.length || q.shouldGroups?.length) ? [["未记录", "未记录", "未记录", "未记录", "未记录"]] : []),
      ]), "",
      `原始位置：${show(q.rawMatches)}；论文：${show(q.papers)}；上限：${show(q.maxRawPositions)}；需人工收紧：${yes(q.requiresRefinement)}。`,
      `自动提升组：${(q.autoPromotedGroups || []).map(show).join("、") || "无"}；droppedTerms：${(q.droppedTerms || []).map(show).join("、") || "无"}。`,
      ...(q.identityPolicy?.warnings || []).map(x => `- 身份警告：${safe((x.terms || []).join(" ≠ "))}；${safe(x.action)}`), "",
      "## 3. 语料边界与阅读漏斗", "",
      `本会话必需检索分支完成：${yes(c.retrievalComplete)}。索引总量、模型及实时查询状态未包含在持久化 ResearchResult 中，须另附当时的 health 快照；不得从缓存覆盖率推断实时可用。`, "",
      ...table(["阶段", "独立论文数", "含义"], [
        ["候选召回", f.retrievedPapers, "本会话候选，不等于已读"], ["分段筛查", f.screenedPapers, "已有审阅决策"],
        ["上下文阅读", f.contextReadPapers, "打开证据上下文"], ["全文分页", f.fullTextPagedPapers, "完成文档分页"],
        ["机制级深读", f.deepReadPapers, "系统目前不跟踪；未记录不能写成 0"],
      ]), "",
      `原始位置：${show(c.rawPositions)}；门禁审阅单元：${show(c.reviewUnits)}；导航位置：${show(c.navigationPositions)}。`, "",
      "## 4. Coverage Gate 与 Evidence Slots", "",
      ...table(["门禁项目", "完成 / 总计", "剩余或状态"], [
        ["候选列出", `${show(c.listed)} / ${show(c.reviewUnits)}`, `未列出 ${show(c.unlisted)}`],
        ["上下文阅读", `${show(c.contextRead)} / ${show(c.reviewUnits)}`, `未读 ${show(c.contextUnread)}`],
        ["审阅决策", `${show(c.reviewed)} / ${show(c.reviewUnits)}`, `未审阅 ${show(c.unreviewed)}；需补上下文 ${show(c.needsContext)}`],
        ["全文分页", show(c.documents?.completeDocuments), yes(c.documents?.allCandidateDocumentsListed)],
        ["DIRECT Facts", show(c.directFacts), yes(c.factsComplete)],
        ["未解决事实冲突", show(c.unresolvedFactConflicts), "须逐项核验"],
      ]), "",
      ...table(["Slot ID", "valueType", "DIRECT Fact IDs", "状态"], result?.evidenceSlots?.length
        ? result.evidenceSlots.map(s => [s.id, s.type, (s.directFactIds || []).join("、") || "无", s.closed ? "closed" : "open"])
        : [["未声明", "未记录", "无", "未闭合/不适用需核查"]]), "",
      ...(result?.coverageGate?.blockers || []).map(x => `- 阻断项：${safe(x)}`), "",
      "## 5. 候选审阅审计（本页）", "",
      ...table(["positionId", "文献 / 回链", "来源", "context", "reviewStatus", "理由"], result?.candidateDecisions?.length ? result.candidateDecisions.map(d => {
        const ref = refs.get(d.workKey);
        return [d.positionId, ref?.parentLink ? linked(d.title || d.workKey, ref.parentLink) : d.title || d.workKey, d.source, yes(d.contextRead), d.reviewStatus, d.reason || "未记录"];
      }) : [["本页无记录", "未记录", "未记录", "未记录", "未记录", "未记录"]]), "",
      `本页 offset=${show(p.offset)}，limit=${show(p.limit)}，全量决策=${show(p.totalDecisions)}，nextOffset=${Object.hasOwn(p, "nextOffset") ? (p.nextOffset == null ? "null" : show(p.nextOffset)) : "未记录"}。${p.truncated === true ? "仍有后续页；本页不得称为全量审阅。" : p.truncated === false ? "本页无后续决策页。" : "分页完整性未记录。"}`, "",
      "## 6. 类型化事实与原文定位", "",
      "以下仅列持久化 FactRecord。原文短引和 locator 是复核入口；Note 或综述线索不自动成为 DIRECT 原始证据。", "",
      ...table(["Fact ID / Slot", "实体与编号", "valueType", "值 / 单位", "状态", "逐字短引", "定位与回链"], result?.facts?.length ? result.facts.map(x => [
        `${show(x.factId)} / ${show(x.slot)}`, `${show(x.entity)}；${show(x.numbering)}`, x.valueType,
        `${show(x.value)} ${x.unit ? safe(x.unit) : ""}`, x.evidenceStatus, x.sourceQuote, factSource(x),
      ]) : [["无已登记 FactRecord", "未记录", "未记录", "未记录", "未记录", "未记录", "未记录"]]), "",
      "## 7. 主体综合与 Claim–Evidence", "",
      permitted ? "本输出不自动撰写机制综合。请基于上方已核验事实，逐条建立最小主张、反证和外推限制。" : "阶段性状态：不得填写确定机制、序列答案或 Claim–Evidence 强度结论。", "",
      "## 8. 冲突、空白与限制", "",
      ...(result?.conflicts?.length ? result.conflicts.map(x => `- 直接事实冲突：${safe(x.conflictKey || x.key || JSON.stringify(x))}`) : ["未登记直接事实冲突；不代表文献不存在冲突。"]),
      ...(result?.gaps?.length ? result.gaps.map(x => `- ${safe(x)}`) : ["无已登记空白；仍须核对覆盖范围。"]), "",
      "## 9. 来源清单", "",
      ...(result?.references?.length ? result.references.map(x => `- ${linked(x.title || x.workKey, x.parentLink)}（${safe(x.workKey)}）`) : ["未记录来源条目。"]), "",
      "## 10. 可复现与机器可读附录", "",
      `生成时间：${show(result?.audit?.generatedAt)}；数据来自：${show(result?.audit?.source)}。检索与阅读操作日志未包含在 ResearchResult 中，不得补造。`, "",
      "```json", JSON.stringify({ reportVersion: result?.reportVersion, sessionId: result?.sessionId, questionMode: result?.questionMode,
        queryContract: result?.queryContract, funnel: result?.funnel, coverage: result?.coverage, coverageGate: result?.coverageGate,
        evidenceSlots: result?.evidenceSlots, candidateDecisions: result?.candidateDecisions, facts: result?.facts,
        conflicts: result?.conflicts, references: result?.references, pagination: result?.pagination }, null, 2), "```", "",
    ];
    return { profileId: profile.id, synthesisAllowed: permitted, markdown: lines.join("\n").trim() + "\n", warning: permitted ? null : "Blocked: staged output only; do not present as a definitive answer." };
  }
  function render(result, profileId = "standard") {
    const profile = get(profileId); if (!profile) throw new Error(`Unknown Output Profile: ${profileId}`);
    if (profile.layout === "structured-vnext") return renderStructured(result, profile);
    const permitted = result?.coverageGate?.synthesisAllowed === true && result?.status === "ready_for_synthesis";
    const lines = [`# ${safe(result?.question || "Research session")} — ${permitted ? "证据就绪" : "阶段性结果"}`, ""];
    const row = (a, b) => `| ${safe(a)} | ${safe(b)} |`;
    for (const section of profile.sections) {
      if (section === "status") lines.push("## 交付状态", "", permitted ? "Coverage Gate 已通过；以下仍是证据台账，不自动生成未经核验的综合结论。" : "Coverage Gate 未通过：不能输出确定答案，只能报告已有证据和阻断项。", "");
      if (section === "summary") lines.push("## 执行摘要", "", permitted ? "请基于下列已核验事实撰写，并逐条引用原始来源。" : "尚不能形成确定摘要。", "");
      if (section === "identity") lines.push("## 术语身份", "", `字符顺序重要；自动别名不证明科学等价。警告：${(result?.queryContract?.identityPolicy?.warnings || []).map(x => safe(x.terms?.join(" ≠ "))).join("；") || "无"}`, "");
      if (section === "queryContract") lines.push("## Query Contract", "", `硬查询：\`${result?.queryContract?.hardExpression || "未记录"}\``, "", "MUST：" + (result?.queryContract?.mustGroups || []).map(g => `[${(g.aliases || []).join(" OR ")}]`).join(" AND "), "SHOULD：" + (result?.queryContract?.shouldGroups || []).map(g => `[${(g.aliases || []).join(" OR ")}]`).join("；"), "");
      if (section === "corpusHealth") lines.push("## 语料健康", "", `检索完成：${result?.coverage?.retrievalComplete ? "是" : "否"}；索引范围仅限本次会话声明的语料。`, "");
      if (section === "funnel") { const f = result?.funnel || {}; lines.push("## 研究漏斗", "", "| 阶段 | 独立计数 |", "|---|---:|", row("候选召回文献", f.retrievedPapers ?? "未记录"), row("分段筛查文献", f.screenedPapers ?? "未记录"), row("上下文阅读文献", f.contextReadPapers ?? "未记录"), row("全文分页文献", f.fullTextPagedPapers ?? "未记录"), row("深读文献", f.deepReadPapers ?? "未记录"), ""); }
      if (section === "coverageGate") lines.push("## Coverage Gate", "", `synthesisAllowed = **${permitted}**`, ...(result?.coverageGate?.blockers || []).map(x => `- ${safe(x)}`), "");
      if (section === "evidenceSlots") lines.push("## Evidence Slots", "", ...(result?.evidenceSlots?.length ? result.evidenceSlots.map(x => `- ${safe(x.id)}（${safe(x.type)}）：${x.closed ? "已由 DIRECT FactRecord 闭合" : "未闭合"}`) : ["未声明事实槽；若为 EXACT 问题，不得据此给出确定答案。"]), "");
      if (section === "candidateAudit") lines.push("## 候选审阅审计", "", `门禁候选：${result?.coverage?.reviewUnits ?? 0}；已审阅：${result?.coverage?.reviewed ?? 0}；未审阅：${result?.coverage?.unreviewed ?? 0}。`, ...(result?.candidateDecisions || []).map(x => `- ${safe(x.workKey)}：${safe(x.reviewStatus)}；${safe(x.reason)}`), result?.pagination?.truncated ? "候选列表已截断；需继续分页，不能视为全量审阅。" : "", "");
      if (section === "evidenceUnits") lines.push("## 证据单元", "", ...(result?.evidenceUnits?.length ? result.evidenceUnits.map(x => `- ${safe(x)}`) : ["暂无已登记证据单元。"]), "");
      if (section === "facts") lines.push("## 结构化硬事实", "", ...(result?.facts?.length ? result.facts.map(f => `- **${safe(f.factId || f.slot)} / ${safe(f.valueType)}**：${safe(f.value)}（${safe(f.evidenceStatus)}；${factSource(f)}）；原文：${safe(f.sourceQuote)}`) : ["暂无已登记事实。"]), "");
      if (section === "claims") lines.push("## Claim–Evidence 矩阵", "", "系统不自动生成主张；请只用已核验的原文证据逐条建立主张与来源映射。", "");
      if (section === "conflicts") lines.push("## 冲突与反证", "", ...(result?.conflicts?.length ? result.conflicts.map(x => `- ${safe(x.conflictKey || x.key || JSON.stringify(x))}`) : ["当前台账无已登记的直接事实冲突；不代表文献中不存在冲突。"]), "");
      if (section === "gaps") lines.push("## 证据空白", "", ...(result?.gaps?.length ? result.gaps.map(x => `- ${safe(x)}`) : ["无已登记空白；仍须核对覆盖范围。"]), "");
      if (section === "references") lines.push("## 来源", "", ...(result?.references?.length ? result.references.map(x => `- ${linked(x.title || x.workKey, x.parentLink)}（${safe(x.workKey)}）`) : ["暂无来源条目。"]), "");
      if (section === "audit") lines.push("## 可复现与审计", "", `会话：${safe(result?.sessionId)}；结果版本：${safe(result?.reportVersion)}；输出 profile：${safe(profile.id)}。`, "");
      if (section === "machineAppendix") lines.push("## 机器可读附录", "", "```json", JSON.stringify({ reportVersion: result.reportVersion, sessionId: result.sessionId, queryContract: result.queryContract, funnel: result.funnel, coverageGate: result.coverageGate, evidenceSlots: result.evidenceSlots, facts: result.facts, references: result.references, pagination: result.pagination }, null, 2), "```", "");
    }
    return { profileId: profile.id, synthesisAllowed: permitted, markdown: lines.join("\n").trim() + "\n", warning: permitted ? null : "Blocked: staged output only; do not present as a definitive answer." };
  }
  const api = { startup, list, get, validate, installCustom, reloadCustom, render, mandatorySections: [...MANDATORY] };
  Zotero.ZotQueryOutputProfiles = api;
  global.ZotQueryOutputProfilesBootstrap = { startup };
})(typeof _globalThis !== "undefined" ? _globalThis : this);
