import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source = fs.readFileSync(new URL("../content/scripts/research-dashboard.js", import.meta.url), "utf8");
const nodes = new Map();
function element() { return { value: "", textContent: "", disabled: false, open: false, style: {}, options: [], handlers: {}, setAttribute() {},
  classList: { add() {}, remove() {}, toggle() {} }, replaceChildren() {}, append() {},
  addEventListener(type, handler) { this.handlers[type] = handler; } }; }
function node(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }
const answer = "# Model answer\nThe current evidence is incomplete.";
const audit = "# Internal audit\n```json\n{\"status\":\"reviewing\"}\n```";
let savedText;
let starts = 0, calls = 0, delayStart, failStart = false;
const order = [];
class FilePicker {
  modeSave = 1; returnOK = 0; returnReplace = 2; file = "D:\\reports\\answer.md";
  init() {} appendFilter() {} async show() { return 0; }
}
let renderedMarkdown;
const ctx = { window: { ZotQueryMarkdown: { render(_root, markdown) { renderedMarkdown = markdown; } } }, document: { getElementById: node, querySelectorAll: () => [], createElementNS: () => element() },
  ChromeUtils: { importESModule: () => ({ FilePicker }) }, IOUtils: { async writeUTF8(_path, text) { savedText = text; } },
  Zotero: {
    Prefs: { get: () => "standard" },
    ZotQueryModelAgent: {
      getTemplate: async () => ({ source: "none", name: null, markdown: "" }),
      getConfig: () => ({ providerLabel: "Test", model: "test" }),
      templateInfo: async () => ({ configured: false }),
      saveConfig: () => { throw Error("workbench must not save settings"); },
      runAgent: async opts => { calls++; order.push("model"); assert.ok(opts.sessionId); return ({ sessionId: opts.sessionId, provider: "test", model: "test", markdown: answer,
        blocked: true, synthesisAllowed: false, deterministicAuditMarkdown: audit, template: { source: "none" } }); },
    },
    ZotQueryResearch: { startOrchestratedResearch: async opts => { starts++; order.push("evidence"); assert.ok(opts.question); if (failStart) throw Error("index unavailable"); if(delayStart) await delayStart; return {sessionId:`s${starts}`}; }, sessionLedger: async () => ({ questionMode: "EXACT", status: "reviewing", coverage: {} }), researchResult: async () => ({}) },
    ZotQueryOutputProfiles: { render: () => ({ markdown: audit, synthesisAllowed: false }) },
  },
};
vm.createContext(ctx);
vm.runInContext(source.replace('window.addEventListener("DOMContentLoaded", init, { once: true });', "bind();"), ctx);
node("research-query").value = "Synthetic research question";
node("model-base-url").value = "https://example.test";
node("model-name").value = "test";
const click = id => node(id).handlers.click({ currentTarget: node(id) });
await click("agent-generate");
assert.equal(node("report-editor").value, answer);
assert.equal(renderedMarkdown,answer,'model answers render immediately');
assert.equal(node("audit-editor").value, audit);
assert.equal(node("audit-panel").open, false);
assert.match(node("report-meta").textContent, /大模型回答/);
node("report-editor").value += "\nUser edit";
await click("answer-read");assert.equal(renderedMarkdown,answer + "\nUser edit",'returning to reading renders source edits');
await click("render-report");
assert.equal(node("audit-panel").open, true);
assert.equal(node("report-editor").value, answer + "\nUser edit", "viewing the ledger must preserve the model answer and user edits");
await click("save-report");
assert.equal(savedText, answer + "\nUser edit");
assert.doesNotMatch(savedText, /Internal audit|```json/);
assert.deepEqual(order,["evidence","model"],"one click must prepare evidence before requesting model answer");
await click("agent-generate");assert.equal(starts,1,"unchanged question can continue its session");
node("research-query").value="A different question";await click("agent-generate");assert.equal(starts,2,"new question must never reuse old evidence");
node("survey-preset").value="exhaustive";await click("agent-generate");assert.equal(starts,3,"changed strategy starts a new session");
node("research-query").value="Failure question";failStart=true;const before=calls;await click("agent-generate");assert.equal(calls,before);assert.match(node("notice").textContent,/index unavailable/);assert.equal(node("agent-generate").disabled,false);failStart=false;
let resume;delayStart=new Promise(r=>{resume=r;});const pending=click("agent-generate");await new Promise(r=>setImmediate(r));await click("agent-generate");await click("run-research");resume();await pending;assert.equal(calls,before+1,"busy clicks must not create parallel sessions");
node("research-query").value="";await click("agent-generate");assert.match(node("notice").textContent,/先输入研究问题/);
console.log("3.1.8 model-answer display, separate audit panel, and Markdown export regressions passed");
