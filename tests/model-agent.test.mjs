import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "content", "scripts", "model-agent.js"), "utf8");
const prefs = new Map();
const logins = [];
const requests = [];
let scripted = [];
let blocked = false;
let credentialFailure = false;
let credentialReadFailure = false;
let releaseCredentialWrite;
let credentialWriteGate = null;
let legacyAddCalls = 0;
const toolCalls = [];
let templateMarkdown = "# Template\n\n## 1. 状态\n\n## 2. 结果\n";
let templateExists = true;

const researchResult = () => blocked ? {
  sessionId: "S-1", status: "reviewing", coverageGate: { synthesisAllowed: false, blockers: ["unreviewed"] },
} : { sessionId: "S-1", status: "ready_for_synthesis", coverageGate: { synthesisAllowed: true, blockers: [] } };

const sandbox = {
  URL,
  console,
  Ci: { nsILoginInfo: {} },
  Components: { Constructor() { return class LoginInfo { constructor(host, form, realm, username, password) { Object.assign(this, { host, form, realm, username, password }); } }; } },
  Services: { logins: {
    initializationPromise: Promise.resolve(),
    findLogins(host, form, realm) { if (credentialReadFailure) throw new Error("credential read failed"); return logins.filter(x => x.host === host && x.realm === realm); },
    addLogin() { legacyAddCalls++; throw new Error('JavaScript component does not have a method named: "addLogin"'); },
    async addLoginAsync(login) { await credentialWriteGate; if (credentialFailure) throw new Error("credential write failed"); logins.push(login); },
    modifyLogin(oldLogin, newLogin) { if (credentialFailure) throw new Error("credential write failed"); logins.splice(logins.indexOf(oldLogin), 1, newLogin); },
    removeLogin(login) { const i = logins.indexOf(login); if (i >= 0) logins.splice(i, 1); },
  } },
  IOUtils: { async exists() { return templateExists; }, async readUTF8() { return templateMarkdown; } },
  Zotero: {
    Prefs: {
      get(key) { return prefs.get(key); },
      set(key, value) { if (typeof value === "number" && !Number.isInteger(value)) throw new Error(`floating preference rejected: ${key}`); prefs.set(key, value); },
      clear(key) { prefs.delete(key); },
    },
    HTTP: { async request(method, url, options) { requests.push({ method, url, options }); return { response: scripted.shift() }; } },
    File: { async getResourceAsync() { throw new Error("Bundled templates must never be loaded"); } },
    debug() {},
    ZotQueryResearch: {
      toolDefinitions() { return [
        { name: "zotquery_health", description: "health", inputSchema: { type: "object", properties: {} } },
        { name: "zotquery_evidence_plan", description: "plan", inputSchema: { type: "object", properties: { question: { type: "string" } } } },
        { name: "zotquery_evidence_research_start", description: "start", inputSchema: { type: "object", properties: { question: { type: "string" } } } },
        { name: "zotquery_evidence_context", description: "read source", inputSchema: { type: "object", properties: { positionId: { type: "string" } } } },
      ]; },
      async callTool(name) { toolCalls.push(name); return name.endsWith("research_start") ? { sessionId: "S-1" } : name.endsWith("context") ? { text: "Synthetic source passage", positionId: "P-1" } : { ok: true }; },
      async researchResult() { return researchResult(); },
    },
    ZotQueryOutputProfiles: { render() { return { markdown: blocked ? "# STAGED\n" : "# AUDIT\n", synthesisAllowed: !blocked }; } },
  },
};
sandbox._globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "model-agent.js" });
await sandbox.ZotQueryModelAgentBootstrap.startup({ rootURI: "resource://zotquery/" });
const api = sandbox.Zotero.ZotQueryModelAgent;

assert.equal(api.getConfig().provider, "ollama");
assert.throws(() => api._validatedBaseURL("http://example.com/v1"), /HTTPS/);
assert.equal(api._validatedBaseURL("http://192.168.1.20:8000/v1"), "http://192.168.1.20:8000/v1");

const configInput = { provider: "deepseek", baseURL: "https://api.deepseek.com", model: "deepseek-chat", maxSteps: 8, timeoutSeconds: 60, temperature: 0.1, reasoningEffort: "high" };
credentialWriteGate = new Promise(resolve => { releaseCredentialWrite = resolve; });
let saveSettled = false;
const saving = api.saveConfig(configInput, { apiKey: "unit-test-key" }).then(result => { saveSettled = true; return result; });
await new Promise(resolve => setImmediate(resolve));
assert.equal(saveSettled, false, "save must wait for the asynchronous credential write");
assert.equal(prefs.size, 0, "config must not be persisted before credential storage succeeds");
releaseCredentialWrite();
const saved = await saving;
credentialWriteGate = null;
assert.equal(legacyAddCalls, 0, "the obsolete XPCOM addLogin method must never be called");
assert.equal(saved.apiKeyConfigured, true);
assert.equal(saved.reasoningEffort, "high");
assert.equal(Object.hasOwn(saved, "apiKey"), false);
assert.equal([...prefs.values()].some(x => String(x).includes("unit-test-key")), false, "secret must not enter prefs");
assert.equal(prefs.get("zotquery.modelAgent.temperature"), "0.1", "floating temperature must be stored as a string");
assert.equal([...prefs.keys()].some(x => x.includes("..")), false, "preference keys must not contain an empty segment");
await api.saveConfig(configInput, { apiKey: "unit-test-key" });
assert.equal(logins.length, 1, "saving the same key must not duplicate it");
credentialFailure = true;
await assert.rejects(api.saveConfig({ ...configInput, model: "changed-model" }, { apiKey: "replacement-test-key" }), /credential write failed/);
assert.equal(logins[0].password, "unit-test-key", "failed replacement must preserve the old key");
assert.equal(api.getConfig().model, "deepseek-chat", "failed secret write must preserve preferences");
await assert.rejects(api.saveConfig({ provider: "openai" }, { apiKey: "new-provider-test-key" }), /credential write failed/);
assert.equal(logins.length, 1, "failed first write must not add a login");
credentialFailure = false;
credentialReadFailure = true;
await assert.rejects(api.saveConfig(configInput, { apiKey: "replacement-test-key" }), /credential read failed/);
credentialReadFailure = false;
await assert.rejects(api.saveConfig({ ...configInput, reasoningEffort: "invalid" }, { clearApiKey: true }), /思考强度/);
assert.equal(logins[0].password, "unit-test-key", "invalid config must not clear credentials");
await api.saveConfig(configInput, { apiKey: "replacement-test-key" });
assert.equal(logins.length, 1);
assert.equal(logins[0].password, "replacement-test-key");
await api.saveConfig({ provider: "openai" }, { apiKey: "other-provider-test-key" });
await api.saveConfig(configInput, { clearApiKey: true });
assert.equal(api.getConfig().apiKeyConfigured, false);
assert.equal(logins.length, 1, "clear must preserve other providers");
assert.equal(logins[0].username, "output:openai");
await api.saveConfig(configInput, { apiKey: "unit-test-key" });
assert.equal((await api.templateInfo()).configured, false);
assert.equal((await api.getTemplate()).source, "none");
await api.setTemplatePath("D:\\templates\\custom.md");
assert.equal((await api.templateInfo()).source, "custom-file");
const originalTemplate = templateMarkdown;
templateExists = false;
assert.equal((await api.templateInfo()).configured, false);
await assert.rejects(api.runAgent({ question: "Q" }), /不存在/);
templateExists = true;
templateMarkdown = "";
await assert.rejects(api.getTemplate(), /无法读取/);
templateMarkdown = "# Edited template";
assert.equal((await api.getTemplate()).markdown, templateMarkdown, "imported template must be reread");
templateMarkdown = originalTemplate;
await api.resetTemplate();
assert.equal((await api.templateInfo()).source, "none");
assert.equal((await api.getTemplate()).source, "none");
assert.equal(requests.length, 0, "unavailable templates must never fall back or send API requests");
await api.setTemplatePath("D:\\templates\\custom.md");

scripted = [{ choices: [{ message: { content: "OK" } }] }];
const test = await api.testConnection();
assert.equal(test.ok, true);
assert.equal(requests.at(-1).options.headers.Authorization, "Bearer unit-test-key");

scripted = [{ choices: [{ message: { content: "OK" } }] }];
await api._requestTurn({ provider: "openai", format: "openai", baseURL: "https://api.openai.com/v1", model: "reasoning-model", apiKey: "test", timeoutSeconds: 60, temperature: 0.1, maxTokens: 1024, reasoningEffort: "high" }, [{ role: "user", content: "test" }], []);
assert.equal(JSON.parse(requests.at(-1).options.body).reasoning_effort, "high");
scripted = [{ message: { content: "OK" } }];
await api._requestTurn({ provider: "ollama", format: "ollama", baseURL: "http://127.0.0.1:11434", model: "qwen3", apiKey: "", timeoutSeconds: 60, temperature: 0.1, maxTokens: 1024, reasoningEffort: "low" }, [{ role: "user", content: "test" }], []);
assert.equal(JSON.parse(requests.at(-1).options.body).think, "low");

const agentTurns = [
  { choices: [{ message: { content: "", tool_calls: [
    { id: "1", function: { name: "zotquery_health", arguments: "{}" } },
    { id: "2", function: { name: "zotquery_evidence_plan", arguments: "{\"question\":\"Q\"}" } },
    { id: "3", function: { name: "zotquery_evidence_research_start", arguments: "{\"question\":\"Q\"}" } },
    { id: "4", function: { name: "zotquery_evidence_context", arguments: "{\"positionId\":\"P-1\"}" } },
  ] } }] },
  { choices: [{ message: { content: "# Evidence answer\n\n## 1. 状态\n\nready\n\n## 2. 结果\n\nFact: S-1" } }] },
];
const writtenAnswer = { choices: [{ message: { content: "# Model-written answer\n\n## 1. 状态\n\nready\n\n## 2. 结果\n\nEvidence answer: S-1" } }] };
const limitedAnswer = { choices: [{ message: { content: "目前提供的证据还无法确认精确答案，需要进一步核验原文。" } }] };
scripted = [...agentTurns, writtenAnswer]; blocked = false; toolCalls.length = 0;
const completed = await api.runAgent({ question: "Q", profileId: "standard" });
assert.equal(completed.synthesisAllowed, true);
assert.match(completed.markdown, /Evidence answer/);
assert.doesNotMatch(completed.markdown, /# AUDIT/);
assert.equal(completed.template.coverage.ratio, 1);
assert.equal(completed.deterministicAuditMarkdown, "# AUDIT\n");
assert.deepEqual(toolCalls, ["zotquery_health", "zotquery_evidence_plan", "zotquery_evidence_research_start", "zotquery_evidence_context"]);
assert.match(completed.markdown, /Model-written answer/);
assert.equal(completed.answerKind, "verified-answer");
const writingBody = JSON.parse(requests.at(-1).options.body);
assert.equal(Object.hasOwn(writingBody, "tools"), false, "writing pass is separate from tool execution");
assert.match(writingBody.messages[0].content, /<output-template>/);
assert.doesNotMatch(writingBody.messages[1].content, /# AUDIT|# Evidence answer/);
assert.match(writingBody.messages[1].content, /Synthetic source passage/);

scripted = [...agentTurns, agentTurns[1], agentTurns[1], limitedAnswer]; blocked = true; toolCalls.length = 0;
const stopped = await api.runAgent({ question: "Q", profileId: "standard" });
assert.equal(stopped.blocked, true);
assert.match(stopped.markdown, /目前提供的证据还无法确认/);
assert.match(stopped.markdown, /核验状态：未完成/);
assert.equal(stopped.deterministicAuditMarkdown, "# STAGED\n");
assert.equal(stopped.answerKind, "limited-answer");
assert.equal(stopped.synthesisAllowed, false);
assert.equal(stopped.events.filter(x => x.type === "continue").length, 2);
assert.doesNotMatch(stopped.markdown, /# STAGED/);
assert.doesNotMatch(stopped.markdown, /Evidence answer/);
assert.match(JSON.parse(requests.at(-1).options.body).messages[0].content, /不得把未闭合的精确事实/);

await api.resetTemplate();
scripted = [...agentTurns, writtenAnswer]; blocked = false;
const freeRequestStart = requests.length;
const withoutTemplate = await api.runAgent({ question: "Q" });
assert.equal(withoutTemplate.synthesisAllowed, true, "no template is required to complete research");
assert.equal(withoutTemplate.template.source, "none");
assert.equal(withoutTemplate.template.coverage, null);
assert.match(withoutTemplate.markdown, /Evidence answer/);
const freePrompt = JSON.parse(requests[freeRequestStart].options.body).messages[0].content;
assert.doesNotMatch(freePrompt, /<output-template/);
assert.match(freePrompt, /synthesisAllowed=true/);
const freeWritingPrompt = JSON.parse(requests.at(-1).options.body).messages[0].content;
assert.match(freeWritingPrompt, /未指定模板/);
assert.doesNotMatch(freeWritingPrompt, /<output-template>/);
scripted = [...agentTurns, agentTurns[1], agentTurns[1], limitedAnswer]; blocked = true;
const blockedWithoutTemplate = await api.runAgent({ question: "Q" });
assert.equal(blockedWithoutTemplate.blocked, true, "optional templates must never bypass the evidence gate");
assert.match(blockedWithoutTemplate.markdown, /目前提供的证据还无法确认/);
assert.doesNotMatch(blockedWithoutTemplate.markdown, /# STAGED/);

scripted = [agentTurns[0], agentTurns[0], limitedAnswer];
const exhausted = await api.runAgent({ question: "Q", config: { maxSteps: 2 } });
assert.equal(exhausted.answerKind, "limited-answer", "step exhaustion must still use an explicit model writing pass");
assert.match(exhausted.markdown, /目前提供的证据还无法确认/);
scripted = [...agentTurns, { choices: [{ message: { content: "" } }] }]; blocked = false;
await assert.rejects(api.runAgent({ question: "Q" }), /不会用台账替代回答/);

console.log("3.1.8 model-agent provider, secret, tool-loop, and gate contracts passed");
