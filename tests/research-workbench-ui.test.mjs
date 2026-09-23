import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const view=read('content/researchDashboard.xhtml'),prefs=read('content/preferences.xhtml');
const script=read('content/scripts/research-dashboard.js'),settings=read('content/scripts/model-preferences.js');
const css=read('content/researchDashboard.css'),agent=read('content/scripts/model-agent.js');
assert.equal(JSON.parse(read('manifest.json')).version,'3.1.8');
assert.equal(JSON.parse(read('BUILD-INFO.json')).version,'3.1.8');
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
for(const action of ['startOrchestratedResearch','.positions(','.positionContext(','.reviewPosition(','.recordFact(','.finalize(','.researchResult(','IOUtils.writeUTF8','runAgent','ensureSession(q)']) assert.ok(script.includes(action),action);
assert.doesNotMatch(script,/saveConfig|testConnection|setTemplatePath|fetch\s*\(/);
assert.ok(!fs.existsSync(new URL('../content/templates/full-research-vnext.md',import.meta.url)));
assert.doesNotMatch(agent,/Prefs\.set\([^\n]*apiKey/i);
console.log('3.1.8 single-column workbench, settings separation, DOM and action contracts passed');
