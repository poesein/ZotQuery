import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const nativeContract=JSON.parse(read('content/profiles/tools/tool-contracts.json'));
const bridgeContract=JSON.parse(read('bridge/tool-contracts.json'));

test('one contract covers native and bridge tools with explicit identity and effects',()=>{
 assert.deepEqual(bridgeContract,nativeContract);
 assert.equal(nativeContract.version,2);
 assert.deepEqual(nativeContract.identity.item,['library','parentItemKey']);
 assert.equal(nativeContract.identity.title,'navigation-only');
 assert.equal(Object.values(nativeContract.tools).filter(policy=>policy.origin==='native').length,73);
 assert.equal(nativeContract.tools.zotquery_add_item_tag.effect,'library-write');
 assert.equal(nativeContract.tools.zotquery_set_item_tag.effect,'reading-write');
 assert.equal(nativeContract.tools.zotquery_evidence_visual_session_start.effect,'evidence-write');
 assert.equal(nativeContract.tools.zotquery_evidence_context.effect,'evidence-write','context reads update the research ledger');
 assert.equal(nativeContract.tools.zotquery_note_profile_install.full,'hidden');
 for(const [name,policy] of Object.entries(nativeContract.tools)){
  assert.match(name,/^zotquery_[a-z_]+$/);
  assert.ok(['library','evidence','reading','configuration'].includes(policy.domain),name);
  assert.ok(Object.hasOwn(nativeContract.effects,policy.effect),name);
  assert.ok(['native','zotero-local-api','bridge-read','bridge-preview','bridge-adapter'].includes(policy.origin),name);
 }
});

test('native MCP reports contract effects and fails closed on unregistered tools',()=>{
 const source=read('content/scripts/research-engine.js');
 const section=source.slice(source.indexOf('  const allTools=()=>'),source.indexOf('  const mcpResult=',source.indexOf('  const allTools=()=>')));
 const context={tools:[{name:'evidence_visual_session_start',description:'Exact item',inputSchema:{type:'object'}}],lneTools:()=>[],Zotero:{},publicToolName:name=>`zotquery_${name}`,toolContract:nativeContract};
 vm.createContext(context);vm.runInContext(section+'\nthis.getTools=allTools;',context);
 const item=context.getTools()[0];
 assert.equal(item.name,'zotquery_evidence_visual_session_start');
 assert.equal(item.annotations.readOnlyHint,false);
 assert.equal(item._meta['zotquery/domain'],'evidence');
 context.tools[0].name='unregistered_tool';
 assert.throws(()=>context.getTools(),/Tool contract missing/);
});

test('REST contract endpoint returns the same policy and optional native schemas',async()=>{
 const source=read('content/scripts/research-engine.js');
 const line=source.match(/  const Contracts=Endpoint\(\["GET"\].*\);/)?.[0];
 assert.ok(line,'REST contract endpoint must exist');
 const context={toolContract:nativeContract,Endpoint:(_methods,handler)=>handler,guard:async(_request,fn)=>fn(),qstr:request=>request.searchParams,allTools:()=>[{name:'zotquery_add_item_tag',inputSchema:{type:'object'}}]};
 vm.createContext(context);vm.runInContext(line+'\nthis.getContracts=Contracts;',context);
 const compact=await context.getContracts({searchParams:new URLSearchParams()});
 assert.equal(compact.version,2);assert.equal(compact.tools.zotquery_add_item_tag.effect,'library-write');assert.equal(compact.nativeTools,undefined);
 const expanded=await context.getContracts({searchParams:new URLSearchParams('includeSchemas=1')});
 assert.equal(expanded.nativeTools[0].name,'zotquery_add_item_tag');
});
