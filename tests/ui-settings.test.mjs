import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('research desk opens the actual ZotQuery pane ID, including generated IDs, never the extension ID',()=>{
 const opened=[],panes=[
  {id:'other-pane',pluginID:'another@plugin',src:'chrome://other/content/preferences.xhtml'},
  {id:'plugin-pane-random-zotquery',pluginID:'zotquery@poesein.github.io',src:'jar:file:///plugin.xpi!/content/preferences.xhtml'}];
 const box={Zotero:{PreferencePanes:{pluginPanes:panes},Utilities:{Internal:{openPreferences:(id,options)=>opened.push({id,options})}}}};
 vm.createContext(box);vm.runInContext(read('content/scripts/research-ui.js'),box);
 box.Zotero.ZotQueryResearchUI.openSettings();assert.equal(opened[0].id,panes[1].id);
 assert.equal(opened[0].options.scrollTo,'#zotquery-group-output-model');
 panes[1].id='new-generated-id';box.Zotero.ZotQueryResearchUI.openSettings();assert.equal(opened[1].id,'new-generated-id');
 panes.pop();assert.throws(()=>box.Zotero.ZotQueryResearchUI.openSettings(),/尚未注册/);assert.equal(opened.length,2);
 assert.doesNotMatch(read('content/scripts/research-dashboard.js'),/openPreferences\("zotquery@/);
});
test('settings use one answer template path and grouped indexing, without obsolete output-profile controls',()=>{
 const prefs=read('content/preferences.xhtml'),ui=read('content/scripts/research-ui.js'),view=read('content/researchDashboard.xhtml'),css=read('content/researchDashboard.css');
 assert.doesNotMatch(prefs,/lne-output-profile|Output Profile JSON|Exhaustive vNext/);
 assert.doesNotMatch(ui,/getElementById\("lne-output-profile/);
 assert.match(prefs,/zotquery-group-retrieval/);assert.match(prefs,/高级：笔记解析规则/);
 assert.match(prefs,/input:not\(\[type="checkbox"\]\)/);
 assert.match(view,/研究台/);assert.doesNotMatch(view,/研究工作台/);
 assert.match(css,/\.request-bar \{[^}]*grid-template-columns:minmax\(0,1fr\) 118px/);
 assert.match(view,/id="research-vision"[^>]*role="switch"/);
 assert.match(read('content/scripts/research-dashboard.js'),/const outputProfile = \(\) => "standard"/);
});
test('vision permission syncs across views immediately, does not write other settings, and unsubscribes cleanly',()=>{
 let value=false,writes=[],fail=false;const observers=new Set();
 const config={visionEnabled:false};
 const box={Zotero:{Prefs:{set:(key,next,global)=>{if(fail)throw Error('write failed');writes.push({key,next,global});value=next;config.visionEnabled=next;for(const o of observers)o.observe();}},ZotQueryModelAgent:{getConfig:()=>config}},
 Services:{prefs:{addObserver:(_key,o)=>observers.add(o),removeObserver:(_key,o)=>observers.delete(o)}}};
 vm.createContext(box);vm.runInContext(read('content/scripts/model-preferences.js'),box);
 const make=()=>{const nodes=new Map(),events={};return {events,document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},handlers:{},addEventListener(k,f){this.handlers[k]=f;},removeEventListener(k){delete this.handlers[k];}});return nodes.get(id);}},addEventListener:(k,f)=>events[k]=f,removeEventListener:k=>delete events[k]};};
 const a=make(),b=make(),api=box.Zotero.ZotQueryModelPreferences;
 api.bindVision(a,'a','s');api.bindVision(b,'b','s');const an=a.document.getElementById('a'),bn=b.document.getElementById('b');
 assert.equal(an.checked,false);an.checked=true;an.handlers.change();assert.equal(bn.checked,true);assert.equal(value,true);
 bn.checked=false;bn.handlers.change();assert.equal(an.checked,false);assert.equal(writes.length,2);
 assert.ok(writes.every(x=>x.key==='zotquery.modelAgent.visionEnabled' && x.global===true));
 fail=true;an.checked=true;an.handlers.change();assert.equal(an.checked,false);assert.match(a.document.getElementById('s').textContent,/失败/);
 api.unbindVision(a);assert.equal(observers.size,1);api.unbindVision(a);api.bindVision(a,'a','s');assert.equal(observers.size,2);
 a.events.unload();b.events.unload();assert.equal(observers.size,0);
});
