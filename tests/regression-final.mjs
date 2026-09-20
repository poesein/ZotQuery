import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativePath = path.join(root, "content", "scripts", "lne-native.js");
const toolsPath = path.join(root, "content", "scripts", "lne-tools.js");
const researchPath = path.join(root, "content", "scripts", "research-engine.js");
const noteProfilesPath = path.join(root, "content", "scripts", "note-profiles.js");
const outputProfilesPath = path.join(root, "content", "scripts", "output-profiles.js");
const uiPath = path.join(root, "content", "scripts", "research-ui.js");
const nativeSource = fs.readFileSync(nativePath, "utf8");
const toolsSource = fs.readFileSync(toolsPath, "utf8");
const researchSource = fs.readFileSync(researchPath, "utf8");
const uiSource = fs.readFileSync(uiPath, "utf8");
const prefsSource = fs.readFileSync(path.join(root, "prefs.js"), "utf8");
const preferencesView = fs.readFileSync(path.join(root, "content", "preferences.xhtml"), "utf8");
const bootstrapSource = fs.readFileSync(path.join(root, "bootstrap.js"), "utf8");
const dashboardView = fs.readFileSync(path.join(root, "content", "researchDashboard.xhtml"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const reportTemplate = fs.readFileSync(path.join(root, "docs", "REPORT-TEMPLATE-vNext.md"), "utf8");
const sandbox = {
  Zotero: {
    File: {
      getContentsFromURLAsync: async () => { throw new Error("generic URL reader cannot load jar resources"); },
      getResourceAsync: async url => fs.readFileSync(path.join(root, url.slice(url.indexOf("content/"))), "utf8"),
    },
    DataDirectory: { dir: path.join(root, "tests", "unused-data") },
    debug: () => {},
  },
  PathUtils: { join: path.join },
  IOUtils: { exists: async () => false },
  console, setTimeout, clearTimeout,
};
sandbox._globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(noteProfilesPath, "utf8"), sandbox, { filename: noteProfilesPath });
await sandbox.ZotQueryNoteProfilesBootstrap.startup({ rootURI: "resource://zotquery/" });
vm.runInContext(fs.readFileSync(outputProfilesPath, "utf8"), sandbox, { filename: outputProfilesPath });
await sandbox.ZotQueryOutputProfilesBootstrap.startup({ rootURI: "resource://zotquery/" });
vm.runInContext(nativeSource, sandbox, { filename: nativePath });
vm.runInContext(toolsSource, sandbox, { filename: toolsPath });
vm.runInContext(researchSource, sandbox, { filename: researchPath });
const api = sandbox.Zotero.ZotQueryLNE.api;
const toolsApi = sandbox.Zotero.ZotQueryLNETools;
const noteProfiles = sandbox.Zotero.ZotQueryNoteProfiles;
const outputProfiles = sandbox.Zotero.ZotQueryOutputProfiles;

const plan = api._lexicalPlan("x42α mβ7 amino acid sequence and residue positions");
assert(plan.terms.includes("x42α"), "x42α must remain one token");
assert(plan.terms.includes("mβ7"), "mβ7 must remain one token");
assert(!plan.terms.includes("x42"), "x42α must not degrade to x42");
assert(!plan.terms.includes("12"), "mβ7 must not degrade to 12");
assert(plan.hardTerms.includes("x42α") && plan.hardTerms.includes("mβ7"), "mixed identifiers must be hard terms");
assert.notEqual(api._normIdentity("mβ7"), api._normIdentity("βm7"), "character order is identity-significant");
assert.notEqual(api._normIdentity("mβ7"), api._normIdentity("mb7"), "Greek alpha must not become ASCII a");
assert.deepEqual(Array.from(toolsApi._extractSurveyAnchors("x42α mβ7 amino acid sequence and residue positions")), ["x42α", "mβ7"], "ordinary concept words must not become Survey identity anchors");
assert(Array.from(toolsApi._classifyQuestion("mβ7 amino acid sequence and residue positions")).includes("sequence"), "sequence questions need a sequence-specific Survey axis");
const factRequest = sandbox.ZotQueryResearchBootstrap._defaultFactRequest("x42α mβ7 amino acid sequence and residue positions", "EXACT");
assert.deepEqual(Array.from(factRequest.slots, s => [s.id, s.type]), [["sequence", "sequence"], ["residue_range", "residue_range"]], "EXACT sequence questions need separate sequence and residue-range slots");

// Run the actual planner with only its database cardinality probe stubbed.
const plannerSource = researchSource
  .replace("await ensureFTS(false); question=", "question=")
  .replace(/async function expressionStats\(expression,[\s\S]*?\r?\n  }\r?\n  function genericEvidenceHint/, `async function expressionStats(expression) {
    const both = expression.includes('x42α') && expression.includes('mβ7');
    const extraFamilyTerm = expression.includes('"x42"');
    return { matches: both ? (extraFamilyTerm ? 10 : 63) : 1696, papers: both ? (extraFamilyTerm ? 4 : 18) : 264 };
  }
  function genericEvidenceHint`)
  .replace("_globalThis.ZotQueryResearchBootstrap=", "_globalThis.__planEvidenceQuery = planEvidenceQuery; _globalThis.__allTools = allTools; _globalThis.__directValueSupported = directValueSupported; _globalThis.__authorized = authorized; _globalThis.__ensureAuthToken = ensureAuthToken; _globalThis.__rotateAuthToken = rotateAuthToken; _globalThis.__MCP = MCP; _globalThis.ZotQueryResearchBootstrap=");
const plannerSandbox = { Zotero: {}, console };
plannerSandbox._globalThis = plannerSandbox;
vm.createContext(plannerSandbox);
vm.runInContext(plannerSource, plannerSandbox);
assert.equal(plannerSandbox.__directValueSupported("A42B", "The A42B variant was observed."), true);
assert.equal(plannerSandbox.__directValueSupported("A42", "The A420 variant was observed."), false, "partial identifiers must not prove DIRECT values");
assert.equal(plannerSandbox.__directValueSupported("A42B", "The unrelated C18D variant was observed."), false, "an authentic quote must not validate an unrelated value");
const authPrefs = new Map();
let uuidCounter = 0;
plannerSandbox.Services = { uuid: { generateUUID: () => `{123e4567-e89b-42d3-a456-42661417400${uuidCounter++}}` } };
plannerSandbox.Zotero.Prefs = { get: key => authPrefs.get(key), set: (key, value) => authPrefs.set(key, value) };
const testToken = plannerSandbox.__ensureAuthToken();
assert.equal(testToken.length, 72);
assert.equal(plannerSandbox.__authorized({ headers: { host: "127.0.0.1:23119" } }), false, "missing Bearer token must be rejected");
assert.equal(plannerSandbox.__authorized({ headers: { host: "127.0.0.1:23119", authorization: `Bearer ${testToken}` } }), true);
assert.equal(plannerSandbox.__authorized({ headers: { host: "example.test", authorization: `Bearer ${testToken}` } }), false, "non-loopback Host must be rejected");
assert.equal(plannerSandbox.__authorized({ headers: { host: "127.0.0.1:23119", origin: "https://example.test", authorization: `Bearer ${testToken}` } }), false, "non-loopback Origin must be rejected");
const rotatedToken = plannerSandbox.__rotateAuthToken();
assert.notEqual(rotatedToken, testToken);
assert.equal(plannerSandbox.__authorized({ headers: { host: "127.0.0.1:23119", authorization: `Bearer ${testToken}` } }), false, "rotation must invalidate the old token immediately");
assert.equal(plannerSandbox.__authorized({ headers: { host: "127.0.0.1:23119", authorization: `Bearer ${rotatedToken}` } }), true);
const mcpEndpoint = new plannerSandbox.__MCP();
assert.equal((await mcpEndpoint.init({ headers: { host: "127.0.0.1:23119" }, data: { method: "initialize", id: 1 } }))[0], 401);
assert.equal((await mcpEndpoint.init({ headers: { host: "127.0.0.1:23119", authorization: `Bearer ${rotatedToken}` }, data: { method: "initialize", id: 1 } }))[0], 200);
const finalizeSource = researchSource.slice(researchSource.indexOf("async function finalize("), researchSource.indexOf("async function health()"));
const finalizeSandbox = {
  Zotero: { DB: { queryAsync: async (_sql, args) => { assert.equal(args[0], "blocked"); } } },
  RDB: "testdb", now: () => "2026-01-01T00:00:00Z",
  sessionLedger: async () => ({ status: "running", synthesisAllowed: false, questionMode: "STANDARD", readingPolicy: "QUERY_EXHAUSTIVE", orchestration: { required: false }, coverage: { lexicalComplete: true, reviewUnits: 0, documents: {} } }),
};
finalizeSandbox._globalThis = finalizeSandbox;
vm.createContext(finalizeSandbox);
vm.runInContext(`${finalizeSource}\n_globalThis.__finalize = finalize;`, finalizeSandbox);
const emptyFinal = await finalizeSandbox.__finalize("empty-session");
assert.equal(emptyFinal.status, "blocked");
assert.equal(emptyFinal.synthesisAllowed, false);
assert(emptyFinal.blockers.some(x => x.includes("No gate-required evidence")));
const resolutionSource = researchSource.slice(researchSource.indexOf("async function resolveFactConflict("), researchSource.indexOf("async function sessionLedger("));
let resolutionSaved = false;
const resolutionSandbox = {
  Zotero: { DB: { queryAsync: async (sql, args) => {
    if (sql.includes("FROM testdb.fact_records")) return [{ fact_id: "selected", position_id: "source", value_text: "A42B", source_quote: "The A42B variant was observed." }];
    if (sql.includes("FROM testdb.positions")) return [args[0] === "source" ? { position_id: "source", source: "pdf", review_status: "reviewed", supports_question: "yes" } : { position_id: "independent", source: "pdf", context_read_at: "read" }];
    if (sql.includes("INSERT OR REPLACE")) { resolutionSaved = true; return []; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } } },
  RDB: "testdb", now: () => "2026-01-01T00:00:00Z",
  factConflicts: async () => resolutionSaved ? [] : [{ conflictKey: "slot|entity|type||", factIds: ["selected", "other"] }],
  directValueSupported: plannerSandbox.__directValueSupported,
  normalizeQuote: value => String(value || "").normalize("NFKC").toLowerCase(),
  pdfChunkText: async () => "An independent PDF passage confirms A42B at the same site.",
};
resolutionSandbox._globalThis = resolutionSandbox;
vm.createContext(resolutionSandbox);
vm.runInContext(`${resolutionSource}\n_globalThis.__resolve = resolveFactConflict;`, resolutionSandbox);
const resolutionInput = { conflictKey: "slot|entity|type||", selectedFactId: "selected", resolutionPositionId: "independent", resolutionQuote: "An independent PDF passage confirms A42B", reason: "Independent PDF passage resolves the discrepancy." };
await assert.rejects(resolutionSandbox.__resolve("session", { ...resolutionInput, resolutionQuote: "An unrelated source confirms C18D" }), /resolutionQuote must occur/);
assert.equal(resolutionSaved, false);
const resolved = await resolutionSandbox.__resolve("session", resolutionInput);
assert.equal(resolved.ok, true);
assert.equal(resolutionSaved, true);
const barePlan = await plannerSandbox.__planEvidenceQuery({ question: "x42α mβ7的氨基酸序列和位置" });
assert.deepEqual(Array.from(barePlan.mustGroups, g => g.surface), ["x42α", "mβ7"], "bare question must require both distinct identifiers");
assert(barePlan.hardExpression.includes(" AND "), "distinct identifiers must intersect, not become one OR group");
assert.deepEqual(Array.from(barePlan.droppedTerms), [], "surface terms must not disappear");
const familyQuestion = "比较 x42α、mβ7 与 x42 的并存边界";
const familyPlan = await plannerSandbox.__planEvidenceQuery({ question: familyQuestion });
assert.deepEqual(Array.from(familyPlan.mustGroups, g => g.surface), ["x42α", "mβ7"], "bare comparison must protect full independent identifiers, not the contained family shorthand");
assert(familyPlan.shouldGroups.some(g => g.surface === "x42"), "the x42 surface must remain auditable as SHOULD");
assert.equal(familyPlan.shouldGroups.find(g => g.surface === "x42")?.identifierType, "identifier", "lowercase x42 is not an amino-acid residue label");
assert(!familyPlan.hardExpression.includes('"x42"'), "x42 must not become a third AND term");
assert.equal(familyPlan.rawMatches, 63, "the synthetic cardinality probe must not take the over-narrowed third-term branch");
const comparePlan = await plannerSandbox.__planEvidenceQuery({ question: "比较 x42α 与 mβ7 的证据" });
assert.equal(comparePlan.mustGroups.length, 1, "a pure comparison should retain a union of separate literature universes");
assert.equal(comparePlan.mustGroups[0].source, "comparison-union");
assert(comparePlan.mustGroups[0].aliases.includes("x42α") && comparePlan.mustGroups[0].aliases.includes("mβ7"));
const numericPlan = await plannerSandbox.__planEvidenceQuery({ question: "x42 x420" });
assert.deepEqual(Array.from(numericPlan.mustGroups, g => g.surface), ["x42", "x420"], "a numeric extension is not automatically the same family identifier");
const contractedPlan = await plannerSandbox.__planEvidenceQuery({ question: familyQuestion, aliasGroups: [
  { id: "isoform", role: "MUST", aliases: ["x42α", "x42alpha"] },
  { id: "motif", role: "MUST", aliases: ["mβ7", "mbeta7"] },
] });
assert.deepEqual(Array.from(contractedPlan.mustGroups, g => g.id), ["isoform", "motif"], "an explicit hard contract must not acquire auto-promoted AND groups");
assert(contractedPlan.shouldGroups.some(g => g.surface === "x42"), "explicit contracts must retain but not promote other question surfaces");
assert(!contractedPlan.hardExpression.includes('"x42"'), "structured contract must not narrow to a third x42 group");
const directMustPlan = await plannerSandbox.__planEvidenceQuery({ question: familyQuestion, mustGroups: [
  { id: "isoform", aliases: ["x42α"] }, { id: "motif", aliases: ["mβ7"] },
] });
assert.deepEqual(Array.from(directMustPlan.mustGroups, g => g.id), ["isoform", "motif"], "direct mustGroups must own the hard predicate too");
const broadContract = await plannerSandbox.__planEvidenceQuery({ question: familyQuestion, aliasGroups: [
  { id: "isoform", role: "MUST", aliases: ["x42α"] }, { id: "motif", role: "MUST", aliases: ["mβ7"] },
], maxRawPositions: 50 });
assert.equal(broadContract.requiresRefinement, true, "an over-limit explicit contract must request refinement instead of silently tightening");
assert.equal(broadContract.mustGroups.length, 2, "auto-tightening must not rewrite explicit coverage boundaries");
plannerSandbox.Zotero.ZotQueryLNE = { api: { toolDefinitions: () => [{ name: "lne_find", inputSchema: { type: "object" } }] } };
const publishedTools = plannerSandbox.__allTools();
assert(publishedTools.every(tool => tool.name.startsWith("zotquery_")), "every published MCP tool must carry the ZotQuery namespace");
assert(publishedTools.some(tool => tool.name === "zotquery_find"), "native find must use the functional public name");

const parsed = api._parseCanonical([
  "## 【实验支持】",
  "这是第一段足够长的实验结果描述 A123B。",
  "",
  "### 结果",
  "这是跨普通标题后仍应继承实验支持标签的第二段内容。",
  "",
  "### 【综合推断】",
  "这是显式新标签之后应当切换为综合推断的第三段内容。",
].join("\n"));
assert.equal(parsed[0].tag, null);
assert.equal(parsed[0].canonicalRole, "UNKNOWN");
assert.equal(parsed[1].tag, null, "unmapped headings must not gain evidence tags");
assert.equal(parsed[2].tag, null, "an unmapped label must remain unclassified");
assert.equal(parsed[2].canonicalRole, "UNKNOWN");
const genericParsed = api._parseCanonical("## Results\nAn ordinary note describes an experiment in enough detail for a segment.", noteProfiles.get("generic"));
assert.equal(genericParsed[0].canonicalRole, "UNKNOWN", "generic notes must not inherit custom evidence semantics");
assert.equal(noteProfiles.choose("General note", "Some freeform prose").id, "generic");
assert.equal(noteProfiles.choose("Unmatched template", "【custom tag】 Results").id, "generic");
assert.equal(noteProfiles.choose("精读笔记｜Synthetic paper", "【实验支持】 Results").id, "strawberry-vnext", "the format-only compatibility profile must auto-select without affecting unrelated notes");
const compatibleParsed = api._parseCanonical("## 【实验支持】\nA synthetic experiment reported the observation in detail.", noteProfiles.get("strawberry-vnext"));
assert.equal(compatibleParsed[0].canonicalRole, "OBSERVED_EVIDENCE", "compatible evidence tags must retain their canonical role");
const draft = noteProfiles.draftFromTemplate("## Results\n【My evidence label】 text");
assert.equal(draft.evidenceTags["My evidence label"].role, "UNKNOWN", "profile draft must not invent evidence status");
assert.equal(noteProfiles.validate(draft).valid, false, "draft must require an explicit selector before installation");
assert.equal(outputProfiles.validate({id:"unsafe",name:"Unsafe",sections:["summary"]}).valid, false, "custom output cannot remove mandatory audit sections");
const blockedOutput = outputProfiles.render({ question:"Exact sequence?", status:"blocked", coverageGate:{synthesisAllowed:false,blockers:["Missing original PDF"]}, facts:[] }, "compact");
assert.equal(blockedOutput.synthesisAllowed, false);
assert(blockedOutput.markdown.includes("不能输出确定答案"));
assert(!blockedOutput.markdown.includes("## 执行摘要"), "compact output must not imply a final synthesis");
const linkedOutput = outputProfiles.render({
  question: "Linked evidence", status: "ready_for_synthesis", coverageGate: { synthesisAllowed: true, blockers: [] },
  facts: [{ factId: "f1", slot: "sequence", valueType: "sequence", value: "ABC", evidenceStatus: "DIRECT", sourceQuote: "the exact source quote", locator: { pageNumber: 5, chunkIndex: 12 }, links: { pdfPage: "zotero://open-pdf/library/items/ABCDEFGH?page=5", parent: "zotero://select/library/items/ZXCVBNML" } }],
  references: [{ title: "Original study", workKey: "user:ZXCVBNML", parentLink: "zotero://select/library/items/ZXCVBNML" }],
}, "exhaustive-vnext");
assert(linkedOutput.markdown.includes("[打开 PDF 页](zotero://open-pdf/library/items/ABCDEFGH?page=5)"));
assert(linkedOutput.markdown.includes("[Original study](zotero://select/library/items/ZXCVBNML)"));
assert(linkedOutput.markdown.includes("the exact source quote"));
const fullProfile = JSON.parse(fs.readFileSync(path.join(root, "docs", "ZotQuery-全量研究输出-vNext.json"), "utf8"));
assert.equal(fullProfile.layout, "structured-vnext", "importable JSON must select the data-bound vNext renderer");
assert.equal(outputProfiles.validate(fullProfile).valid, true, "structured vNext JSON must pass the plugin validator");
assert.equal(outputProfiles.validate({ ...fullProfile, layout: "unknown" }).valid, false, "unknown render layouts must be rejected");
let installedOutputJSON = null;
sandbox.IOUtils.makeDirectory = async () => {};
sandbox.IOUtils.writeUTF8 = async (_path, value) => { installedOutputJSON = value; };
await outputProfiles.installCustom(fullProfile, { confirmed: true });
assert.equal(JSON.parse(installedOutputJSON).layout, "structured-vnext", "import must persist the structured renderer selection");
const blockedFullOutput = outputProfiles.render({ question: "Exact sequence?", status: "blocked", questionMode: "EXACT", coverageGate: { synthesisAllowed: false, blockers: ["Missing original PDF"] },
  coverage: { reviewUnits: 31, listed: 8, unlisted: 23, contextRead: 4, contextUnread: 27, unreviewed: 27 },
  candidateDecisions: [{ positionId: "p1", workKey: "user:ZXCVBNML", title: "Original study", source: "pdf", contextRead: true, reviewStatus: "reviewed", reason: "direct" }],
  references: [{ title: "Original study", workKey: "user:ZXCVBNML", parentLink: "zotero://select/library/items/ZXCVBNML" }],
  pagination: { offset: 0, limit: 1, totalDecisions: 31, nextOffset: 1, truncated: true }, facts: [] }, fullProfile.id);
assert.equal(blockedFullOutput.synthesisAllowed, false, "the structured layout must never open the synthesis gate");
assert(blockedFullOutput.markdown.includes("23 / 31") || blockedFullOutput.markdown.includes("8 / 31"), "render must map persisted coverage counts");
assert(blockedFullOutput.markdown.includes("nextOffset=1") && blockedFullOutput.markdown.includes("不得称为全量审阅"), "pagination boundaries must remain explicit");
assert(blockedFullOutput.markdown.includes("[Original study](zotero://select/library/items/ZXCVBNML)"), "candidate references must retain Zotero backlinks");
assert(blockedFullOutput.markdown.includes("不得形成确定答案") && !blockedFullOutput.markdown.includes("## 附：vNext 写作模板"), "render must not append an empty writing scaffold");
await outputProfiles.installCustom({ ...fullProfile, layout: undefined, templateMarkdown: reportTemplate }, { confirmed: true });
assert.equal(outputProfiles.get(fullProfile.id).layout, "structured-vnext", "previously imported vNext JSON must migrate in memory without rewriting user data");
assert(!outputProfiles.render({ question: "Legacy profile", status: "blocked", coverageGate: { synthesisAllowed: false } }, fullProfile.id).markdown.includes("## 附：vNext 写作模板"));
const linkStart = researchSource.indexOf("function zoteroItemLink(");
const linkEnd = researchSource.indexOf("async function ensureZotQuery()", linkStart);
assert(linkStart >= 0 && linkEnd > linkStart, "source backlink helpers must exist");
const linkSandbox = {
  Zotero: {
    Libraries: { userLibraryID: 1 }, Groups: { getLibraryIDFromGroupID: id => id === 42 ? 2 : null },
    Items: {
      getIDFromLibraryAndKey: (lib, key) => lib === 1 && key === "ZXCVBNML" ? 10 : null,
      getAsync: async ids => Array.isArray(ids) ? ids.map(id => ({ key: id === 20 ? "ABCDEFGH" : "QWERTYUI", attachmentMIMEType: "application/pdf" })) : { getAttachments: () => [20] },
    },
  },
};
vm.createContext(linkSandbox);
vm.runInContext(researchSource.slice(linkStart, linkEnd) + "\nthis.sourceLinks = sourceLinks; this.zoteroItemLink = zoteroItemLink;", linkSandbox);
const pdfLinks = await linkSandbox.sourceLinks({ libraryKey: "user", itemKey: "ZXCVBNML", pageNumber: 5 });
assert.equal(pdfLinks.pdfPage, "zotero://open-pdf/library/items/ABCDEFGH?page=5", "PDF link must use attachment key and physical page");
assert.equal(linkSandbox.zoteroItemLink("group:42", "ZXCVBNML"), "zotero://select/groups/42/items/ZXCVBNML");
linkSandbox.Zotero.Items.getAsync = async ids => Array.isArray(ids) ? [{ key: "ABCDEFGH", attachmentMIMEType: "application/pdf" }, { key: "QWERTYUI", attachmentMIMEType: "application/pdf" }] : { getAttachments: () => [20, 21] };
const ambiguousLinks = await linkSandbox.sourceLinks({ libraryKey: "user", itemKey: "ZXCVBNML", pageNumber: 5 });
assert.equal(ambiguousLinks.pdfPage, null, "multiple PDF attachments must not produce a guessed page link");

const hitsStart = nativeSource.indexOf("async function hits(");
const hitsEnd = nativeSource.indexOf("async function read(", hitsStart);
const hitsSource = nativeSource.slice(hitsStart, hitsEnd);
assert(hitsSource.includes("normIdentity(r.text).includes(needle)"), "lne_hits must use normalized literal containment");
assert(!hitsSource.includes("buildFTSQuery(query)"), "lne_hits must not use tokenized FTS semantics");
assert(nativeSource.includes('${profile.signature}\\n${html}'), "profile changes must invalidate derived note segments");
assert(nativeSource.includes("profile?.duplicatePolicy?.enabled"), "paired-note deduplication must be opt-in per Note Profile");

assert(researchSource.includes('name:"evidence_research_start"'), "unified orchestrator tool must be registered");
assert(researchSource.includes('name:"evidence_promote_notes"'), "survey-to-PDF continuation tool must be registered");
assert(researchSource.includes("promotionComplete"), "finalization must track Survey note promotion completion");
assert(researchSource.includes('status:allowed?"ready_for_synthesis":"blocked"'), "finalization must return the persisted terminal status rather than the stale pre-update status");
assert(researchSource.includes("led.coverage.reviewUnits===0"), "finalize must explicitly block an empty coverage universe");
assert(researchSource.includes("led.synthesisAllowed===true&&blockers.length===0"), "finalize must respect the ledger's authoritative gate");
assert(researchSource.includes("if(!directValueSupported(value,quote))throw"), "DIRECT insertion must bind the value to its verified quote");
assert(researchSource.includes("resolution_position_id") && researchSource.includes("resolution_quote"), "conflict adjudication must persist PDF provenance");

assert.equal(manifest.version, "3.0.14", "manifest must identify the local candidate version");
assert(nativeSource.includes('if (explicitProfile && !noteProfiles().matches'), "a fixed Note Profile must not bypass index scope");
assert(nativeSource.includes('reason: "library-out-of-scope"'), "item notifier must honor Note library scope");
assert(/^https:\/\//.test(manifest.applications.zotero.update_url), "Zotero requires an HTTPS update_url to accept the manifest");
assert.equal(manifest.name, "ZotQuery");
assert(reportTemplate.includes("zotquery_evidence_research_start") && reportTemplate.includes("zotquery_research_render"), "template must follow the unified MCP workflow");
assert(reportTemplate.includes("zotero://open-pdf/library/items/ATTACHMENTKEY?page=N") && reportTemplate.includes("NOTEKEY:L起-L止"), "template must distinguish PDF page links from Note line citations");
for (const [file, size] of [["favicon.png", 96], ["favicon@0.5x.png", 48]]) {
  const png = fs.readFileSync(path.join(root, "content", "icons", file));
  assert.equal(png.subarray(1, 4).toString(), "PNG", `${file} must be a PNG`);
  assert.equal(png.readUInt32BE(16), size, `${file} width`);
  assert.equal(png.readUInt32BE(20), size, `${file} height`);
}
assert.equal(manifest.homepage_url, "https://github.com/poesein/ZotQuery");
assert.equal(manifest.applications.zotero.id, "zotquery@poesein.github.io", "ZotQuery must have its own extension identity");
assert(prefsSource.includes('extensions.zotero.zotquery.embeddingModel'), "ZotQuery settings must use their own preference branch");
assert(nativeSource.includes('const DB_FILE = "zotquery-lne.sqlite"'), "Note index must use its own database");
assert(researchSource.includes('const RFILE = "zotquery-research.sqlite"'), "Research ledger must use its own database");
assert(bootstrapSource.includes('["content", "zotquery"'), "chrome resources must use the ZotQuery namespace");
for (const source of [prefsSource, bootstrapSource, nativeSource, toolsSource, researchSource, uiSource, preferencesView]) {
  assert(!/zotseek/i.test(source), "active ZotQuery runtime must not share ZotSeek namespaces");
}
assert(researchSource.includes("getEmbeddingModel"), "Research health must read the active ZotQuery embedding model");
assert(researchSource.includes("embeddingContract") && researchSource.includes("sameModel"), "health must expose the single-model contract");
for (const obsolete of ["127.0.0.1:43150", "lneBaseUrl", "preferNative", "qwen3:8b", "genModel", "/api/tool/find"]) {
  assert(!researchSource.includes(obsolete), `Research runtime must not contain obsolete path: ${obsolete}`);
  assert(!prefsSource.includes(obsolete), `preferences must not contain obsolete path: ${obsolete}`);
}

const expectedLNETools = [
  "lne_probe", "lne_find", "lne_trace", "lne_trace_many", "lne_hits", "lne_read",
  "lne_paper", "lne_compare", "lne_unify", "lne_search_raw", "lne_survey_plan",
  "lne_survey_run", "lne_survey_results", "lne_survey_screen", "lne_survey_audit",
  "lne_survey_review", "lne_survey_fact", "lne_survey_deep_read",
];
for (const name of expectedLNETools) assert(toolsSource.includes(`"${name}"`), `missing V3-compatible tool ${name}`);
assert(uiSource.includes("openDashboard") && uiSource.includes("ZotQuery 研究工作台"), "custom UI must replace upstream discovery entry points");
assert(uiSource.includes('#menu_ToolsPopup menuitem') && uiSource.includes('toolsItem?.remove()'), "upstream Tools entry must be removed");
assert(uiSource.includes('getElementById("zotquery-toolbar-button")?.remove()'), "upstream toolbar entry must be removed");
assert(!uiSource.includes("replaceButton(toolbar"), "toolbar entry must not be rebranded and retained");
assert(uiSource.includes('prefs-navigation') && uiSource.includes('ZotQuery'), "preferences navigation must be rebranded");
assert(uiSource.includes("bindProfilePreferences(win)"), "Note and Output settings must be bound");
assert(preferencesView.includes('id="lne-note-profile"') && preferencesView.includes('id="lne-output-profile"'), "settings must expose profile selectors");
assert(preferencesView.includes('id="zotquery-group-note-indexing"') && preferencesView.includes('id="lne-note-library-scope"') && preferencesView.includes('id="lne-note-autosync"'), "Note indexing must have its own settings section");
assert(uiSource.includes('"zotquery.lneNative.libraryScope"') && uiSource.includes('"zotquery.lneNative.autoSync"'), "Note index controls must persist their preferences");
assert(uiSource.includes('root.getAttribute("data-lne-bound")'), "settings binding guard must be per pane, not per preferences window");
const settingIds = [...preferencesView.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(settingIds).size, settingIds.length, "settings controls must have unique IDs");
const localeStart = uiSource.indexOf("const isChinese = (");
const localeEnd = uiSource.indexOf("function openDashboard(", localeStart);
assert(localeStart >= 0 && localeEnd > localeStart, "preferences locale selector must exist");
const localeSandbox = { Zotero: { locale: "en-US" }, Services: { locale: { appLocaleAsBCP47: "zh-CN" } } };
vm.createContext(localeSandbox);
vm.runInContext(uiSource.slice(localeStart, localeEnd) + "\nthis.localizePreferences = localizePreferences;", localeSandbox);
const labelNode = { label: "笔记索引", getAttribute(key) { return key === "label" ? this.label : null; }, setAttribute(key, value) { if (key === "label") this.label = value; } };
const textNode = { nodeValue: "研究系统状态", parentElement: { localName: "summary" } };
const rootNode = { querySelectorAll: () => [labelNode] };
const doc = { getElementById: id => id === "zotquery-preferences" ? rootNode : null, createTreeWalker: () => ({ currentNode: null, nextNode() { if (this.currentNode) return false; this.currentNode = textNode; return true; } }) };
localeSandbox.localizePreferences({ document: doc });
assert.equal(labelNode.label, "Note indexing", "English Zotero locale must translate settings labels");
assert.equal(textNode.nodeValue, "Research status", "English Zotero locale must translate settings text");
localeSandbox.Zotero.locale = "zh-CN";
labelNode.label = "笔记索引";
localeSandbox.localizePreferences({ document: doc });
assert.equal(labelNode.label, "笔记索引", "Chinese Zotero locale must retain Chinese labels");
assert(preferencesView.includes('id="lne-note-profile-json"') && preferencesView.includes('id="lne-output-profile-json"'), "settings must support JSON profile import");
assert(prefsSource.includes('zotquery.outputProfile'), "default output profile preference must exist");
assert(researchSource.includes('Zotero.Prefs.get("zotquery.outputProfile",true)'), "research rendering must honor the selected default profile");
assert(bootstrapSource.includes("ZotQueryStartupErrors"), "startup failures must retain concrete diagnostics");
assert(researchSource.includes('`zotquery_${String(name).replace(/^lne_/,"")}`'), "MCP must expose ZotQuery tool names");
assert(researchSource.includes('source:"protected-identity"'), "distinct protected identifiers must remain MUST terms");
assert(nativeSource.includes('queryReady: !!probe?.ready'), "health must report live query readiness separately from vector coverage");
assert(preferencesView.includes("研究系统状态") && preferencesView.includes("共享向量模型") && preferencesView.includes("Agent 与统一 MCP"), "preferences must use the Research workflow information architecture");
assert(dashboardView.includes("创建证据研究会话") && dashboardView.includes("EXACT：必须由 PDF FactRecord 闭合"), "dashboard must expose evidence-first workflow controls");

// Each bundled search entry point embeds the server URL policy. Keep them in sync:
// inference may use trusted LAN IPs, but the research MCP remains loopback-only.
for (const [file, endMarker, validatorName] of [
  ["index.js", "var Fe;", "H"],
  ["search-dialog-vtable.js", "var U;", "lt"],
  ["similar-documents-dialog.js", "var K;", "ot"],
]) {
  const source = fs.readFileSync(path.join(root, "content", "scripts", file), "utf8");
  const start = source.indexOf("function isPrivateLANHost(");
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `${file} must have the LAN server policy`);
  const validate = vm.runInNewContext(`${source.slice(start, end)}; ${validatorName}`, { URL });
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.2", "172.31.255.254", "192.168.1.5"]) {
    assert.equal(validate(`http://${address}:11434`).hostname, address, `${file} must accept ${address}`);
  }
  for (const address of ["172.15.0.1", "172.32.0.1", "192.169.1.5", "169.254.1.2", "8.8.8.8", "example.org"]) {
    assert.throws(() => validate(`http://${address}:11434`), `${file} must reject ${address}`);
  }
  assert.throws(() => validate("http://user:password@10.1.2.3:11434"), `${file} must reject URL credentials`);
  assert.throws(() => validate("file:///tmp/model"), `${file} must reject non-HTTP URLs`);
  assert(source.includes('redirect:"error"'), `${file} must reject inference-server redirects`);
  if (file === "index.js") {
    const idStart = source.indexOf("function et(");
    const idEnd = source.indexOf("function Oe(", idStart);
    assert(idStart >= 0 && idEnd > idStart);
    const modelId = vm.runInNewContext(`${source.slice(idStart, idEnd)}; ${source.slice(start, end)}; et`, { URL });
    assert.notEqual(modelId("bge-m3:latest", "http://10.1.2.3:11434"), modelId("bge-m3:latest", "http://127.0.0.1:11434"), "different inference endpoints must not share a vector-cache model ID");
    assert(source.includes("const preferredId=et(re.modelName,re.baseUrl)"), "server registrations must retain a distinct provisional ID until equivalence is verified");
    assert(source.includes("existing.verifiedDigest || existing.baseUrl"), "re-registering a changed model under one tag must not erase its verified fingerprint");
  }
}

// Same model at another trusted server must retain the indexed cache ID only
// after both model metadata and query/document output behavior are verified.
{
  const source = fs.readFileSync(path.join(root, "content", "scripts", "index.js"), "utf8");
  const begin = source.indexOf("async function zotqueryServerDigest(");
  const end = source.indexOf("var mr=class n{", begin);
  assert(begin >= 0 && end > begin, "model compatibility guards must be bundled");
  const digestA = "a".repeat(64), digestB = "b".repeat(64);
  const endpointDigests = new Map([["http://127.0.0.1:11434", digestA], ["http://192.0.2.19:11434", digestA]]);
  class FakeClient {
    constructor(config) { this.config = config; }
    async request() { return { models: [{ name: "bge-m3:latest", digest: endpointDigests.get(this.config.baseUrl) }] }; }
    async embed() { return [[1, 0, 0], [0, 1, 0]]; }
  }
  const check = vm.runInNewContext(`${source.slice(begin, end)}; zotqueryEquivalentServerModels`, {
    oe: FakeClient, Se: text => text, Te: () => [],
  });
  const local = { id: "local", runtime: "server", baseUrl: "http://127.0.0.1:11434", serverModelName: "bge-m3:latest", dimensions: 3, queryPrefix: "", docPrefix: "", pooling: "mean", normalize: true };
  const lan = { ...local, id: "lan", baseUrl: "http://192.0.2.19:11434" };
  assert.equal((await check(local, lan))?.digest, digestA, "same digest and probe outputs allow reuse");
  assert.equal(await check(local, { ...lan, queryPrefix: "query: " }), null, "changed preprocessing must not reuse vectors");
  endpointDigests.set(lan.baseUrl, digestB);
  assert.equal(await check(local, lan), null, "same model tag with different digest must not reuse vectors");
  endpointDigests.set(lan.baseUrl, digestA);
  let savedEntries = [{ ...lan }];
  const remember = vm.runInNewContext(`${source.slice(begin, end)}; zotqueryRememberServerIdentity`, {
    oe: FakeClient, Se: text => text,
    Te: () => savedEntries,
    Ct: entry => { savedEntries = [entry]; },
  });
  await remember(lan);
  assert.equal(savedEntries[0].verifiedDigest, digestA, "startup must remember the verified digest");
  assert.equal(savedEntries[0].compatibilityProbes.length, 2, "startup must remember fixed probes");
  endpointDigests.set(lan.baseUrl, digestB);
  await assert.rejects(remember(lan), /digest changed/, "a model replaced under the same tag must not reuse indexed vectors");

  const switchStart = source.indexOf("async setModel(e){");
  const switchEnd = source.indexOf("getModelId(){", switchStart);
  assert(switchStart >= 0 && switchEnd > switchStart);
  async function runSwitch(equivalent, failFirstInit = false) {
    let entries = [local, lan], active = local.id, resets = 0, initCalls = 0;
    const setModel = vm.runInNewContext(`({${source.slice(switchStart, switchEnd)}}).setModel`, {
      U: id => entries.find(item => item.id === id),
      Te: () => entries.map(item => ({ ...item })),
      At: id => { entries = entries.filter(item => item.id !== id); },
      Ct: entry => { entries = entries.filter(item => item.id !== entry.id); entries.push(entry); },
      ln: id => { active = id; },
      ir: "zotquery.serverModels",
      Zotero: { Prefs: { set: (_name, json) => { entries = JSON.parse(json); } } },
      zotqueryCanAdoptCache: async () => true,
      zotqueryEquivalentServerModels: async () => equivalent ? { digest: digestA, probes: [[1,0,0],[0,1,0]] } : null,
    });
    const pipeline = { model: local, ready: true, workerReady: true,
      logger: { info() {}, warn() {} }, reset() { resets++; }, async init() { initCalls++; if (failFirstInit && initCalls === 1) throw new Error("network lost"); this.model = entries.find(item => item.id === active); } };
    let result, error;
    try { result = await setModel.call(pipeline, lan.id); }
    catch (caught) { error = caught; }
    return { entries, active, resets, result, error, model: pipeline.model };
  }
  const adopted = await runSwitch(true);
  assert.equal(adopted.active, local.id, "equivalent endpoint must keep original indexed identity");
  assert.equal(adopted.model.baseUrl, lan.baseUrl, "queries must route to the selected LAN server");
  assert.equal(adopted.entries.length, 1, "duplicate endpoint registration must be removed without deleting DB rows");
  assert.equal(adopted.resets, 1, "pipeline must reconnect even when the cache ID stays the same");
  assert.equal(adopted.result.reused, true);
  const rejected = await runSwitch(false);
  assert.equal(rejected.active, lan.id, "different model must keep a distinct active identity");
  assert.equal(rejected.entries.length, 2, "rejected reuse must preserve both registrations");
  assert.equal(rejected.result.verificationFailed, true);
  const rolledBack = await runSwitch(true, true);
  assert.match(rolledBack.error.message, /network lost/, "a failed endpoint connection must be surfaced");
  assert.equal(rolledBack.active, local.id, "failed adoption must restore the prior active model");
  assert.equal(rolledBack.entries.length, 2, "failed adoption must restore both registrations");
  const rejectedAndFailed = await runSwitch(false, true);
  assert.equal(rejectedAndFailed.active, local.id, "an unreachable new model must restore the previous active model even without adoption");
}

console.log("3.0.14 model-switch offline regression tests passed");
