import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const nodes = new Map();
function node(id) { if(!nodes.has(id)) nodes.set(id,{ value:'',textContent:'',disabled:false,dataset:{},handlers:{},
  addEventListener(e,f){this.handlers[e]=f;},replaceChildren(){},append(){} }); return nodes.get(id); }
const doc={getElementById:node,createElementNS:()=>({dataset:{}})};
let resolveSave,rejectSave,saved, tested, imports=[],clears=0;
const config={provider:'test',providerLabel:'Test',model:'saved-model',baseURL:'https://example.test',reasoningEffort:'high',maxSteps:30,timeoutSeconds:180,temperature:0.7,maxTokens:16000,apiKeyConfigured:true};
let file='D:\\用户模板\\输出格式.MD',result=0;
class FilePicker { modeOpen=0; returnOK=0; init(){} appendFilter(){} async show(){return result;} get file(){ if(result===1)throw Error('cancel read');return file;} }
const api={ getConfig:()=>config,providers:()=>[{id:'test',label:'Test',defaultBaseURL:'https://example.test',defaultModel:'default'}],
  templateInfo:async()=>({configured:false}),saveConfig:(form,key)=>{saved={form,key};return new Promise((r,j)=>{resolveSave=r;rejectSave=j;});},
  testConnection:async(form,key)=>{tested={form,key};return {provider:'test',model:'new',reply:'OK'};},
  setTemplatePath:async path=>{imports.push(path);},resetTemplate:async()=>{clears++;} };
const ctx={Zotero:{ZotQueryModelAgent:api},ChromeUtils:{importESModule:()=>({FilePicker})}};
vm.createContext(ctx); vm.runInContext(fs.readFileSync(new URL('../content/scripts/model-preferences.js',import.meta.url),'utf8'),ctx);
await ctx.Zotero.ZotQueryModelPreferences.bind({document:doc});
assert.equal(node('model-name').value,'saved-model');assert.equal(node('model-reasoning').value,'high');
assert.equal(node('model-api-key').value,'','never fill a stored secret');
const click=id=>node(id).handlers.click({currentTarget:node(id)});
node('model-api-key').value='synthetic-key';node('model-name').value='new';
const saving=click('model-save');assert.equal(node('model-save').disabled,true);
assert.equal(node('model-api-key').value,'synthetic-key');assert.equal(saved.form.temperature,0.7);assert.equal(saved.form.maxTokens,16000);
resolveSave(config);await saving;assert.equal(node('model-api-key').value,'');assert.match(node('model-settings-status').textContent,/配置已保存/);
node('model-api-key').value='retry-key';const failure=click('model-save');rejectSave(Error('storage failure'));await failure;
assert.equal(node('model-api-key').value,'retry-key');assert.equal(node('model-save').disabled,false);assert.match(node('model-settings-status').textContent,/storage failure/);
await click('model-test');assert.equal(tested.key,'retry-key');assert.equal(node('model-api-key').value,'retry-key');assert.match(node('model-settings-status').textContent,/测试不会保存/);
await click('choose-template');assert.equal(imports.at(-1),file);
file={path:'D:\\templates\\legacy.md'};await click('choose-template');assert.equal(imports.at(-1),file.path);
result=1;await click('choose-template');assert.equal(imports.length,2);
result=0;file=null;await click('choose-template');assert.equal(imports.length,2);assert.match(node('model-settings-status').textContent,/有效路径/);
await click('reset-template');assert.equal(clears,1);
const oldHandler=node('model-save').handlers.click;await ctx.Zotero.ZotQueryModelPreferences.bind({document:doc});assert.equal(node('model-save').handlers.click,oldHandler);
console.log('3.1.17 preferences: async credential save, failure retry, transient test, preserved values, template import/cancel/clear passed');
