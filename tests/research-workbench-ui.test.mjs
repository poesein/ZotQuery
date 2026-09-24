import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const view=read('content/researchDashboard.xhtml'),prefs=read('content/preferences.xhtml');
const script=read('content/scripts/research-dashboard.js'),settings=read('content/scripts/model-preferences.js');
const css=read('content/researchDashboard.css'),agent=read('content/scripts/model-agent.js');
assert.equal(JSON.parse(read('manifest.json')).version,'3.1.17');
assert.equal(JSON.parse(read('BUILD-INFO.json')).version,'3.1.17');
assert.doesNotMatch(view,/right-rail|left-rail|data-tab="search"|search-results|模型与输出流水线|quick-find|output-profile/);
assert.match(view,/id="agent-generate"[^>]*>大模型回答/);
assert.match(view,/id="view-report" class="view active"/);
assert.match(view,/icons\/favicon.png/);assert.match(css,/\.brand-mark \{ width:30px; height:30px/);
assert.match(css,/\.workbench-body \{[^}]*overflow:auto/);
assert.match(read('content/scripts/research-ui.js'),/width:\s*16px/);
assert.match(read('bootstrap.js'),/scripts\/model-preferences.js/);
assert.match(read('content/scripts/research-ui.js'),/ZotQueryModelPreferences\?\.bind\(win\)/);
for(const id of ['model-provider','model-base-url','model-name','model-api-key','model-reasoning','model-max-steps','model-timeout','model-save','model-test','template-state','choose-template','reset-template']) {
  assert.ok(prefs.includes(`id="${id}"`),`settings missing ${id}`);assert.ok(!view.includes(`id="${id}"`));
}
for(const [src,markup] of [[script,view],[settings,prefs]]) {
  for(const [,id] of src.matchAll(/\$\("([a-z0-9-]+)"\)/g)) assert.ok(markup.includes(`id="${id}"`),`missing DOM target ${id}`);
  const ids=[...markup.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,'duplicate IDs');
}
for(const action of ['startOrchestratedResearch','.positions(','.positionContext(','.reviewPosition(','.recordFact(','.finalize(','.researchResult(','IOUtils.writeUTF8','runAgent','researchOptions(q)']) assert.ok(script.includes(action),action);
const apiAction=script.slice(script.indexOf('async function generateWithAgent'),script.indexOf('async function renderReport'));
assert.doesNotMatch(apiAction,/await ensureSession|startOrchestratedResearch/,'model planning precedes automatic session creation');
assert.ok(prefs.includes('id="model-max-tokens"'));
assert.ok(prefs.includes('id="model-budget-mode"'));
assert.doesNotMatch(prefs,/自动模式优先读取服务商公布的输出上限|重试会额外计费/);
assert.doesNotMatch(prefs+settings,/model-effort-note|renderEffort|协议映射|旧模型或兼容路由可能不支持全部等级/);
assert.doesNotMatch(prefs,/研究轮数之外|两轮模拟工具请求|最近 3 个会话|393216/);
assert.doesNotMatch(prefs, /id="model-max-tokens"[^>]*\smax=/);
for(const effort of ['auto','none','minimal','low','medium','high','xhigh','max']) assert.ok(prefs.includes(`value="${effort}"`));
assert.doesNotMatch(script,/saveConfig|testConnection|setTemplatePath|fetch\s*\(/);
assert.ok(!fs.existsSync(new URL('../content/templates/full-research-vnext.md',import.meta.url)));
assert.doesNotMatch(agent,/Prefs\.set\([^\n]*apiKey/i);
console.log('3.1.17 single-column workbench, settings separation, DOM and action contracts passed');
