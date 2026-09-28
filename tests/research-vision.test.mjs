import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import test from 'node:test';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
async function fixture(){
 const db=new DatabaseSync(':memory:');db.exec("ATTACH DATABASE ':memory:' AS zotqueryresearch;CREATE TABLE zotqueryresearch.sessions(session_id TEXT);INSERT INTO zotqueryresearch.sessions VALUES('S');CREATE TABLE zotqueryresearch.positions(position_id TEXT,session_id TEXT,library_key TEXT,item_key TEXT);INSERT INTO zotqueryresearch.positions VALUES('P','S','user','PARENT01')");
 const state={enabled:true,hash:'original',renders:0,removed:0,fail:false,cancels:0,stall:false,timeoutMs:0,dimensions:[]};
 const query=async(sql,args=[])=>{const s=db.prepare(sql);return s.columns().length?s.all(...args):s.run(...args);};
 const attachment={key:'PDF00001',isPDFAttachment:()=>true,getFilePathAsync:async()=>'/private/local.pdf'};
 const win={setTimeout:(fn,ms)=>setTimeout(fn,state.timeoutMs&&ms>=25000?state.timeoutMs:ms),clearTimeout,document:{documentElement:{appendChild:frame=>frame.onload()},createXULElement:()=>({setAttribute(){},style:{},addEventListener(_n,fn){this.onload=fn;},remove(){state.removed++;},contentWindow:{ZotQueryCancelPDF:async()=>{state.cancels++;},ZotQueryRenderPDF:async(_bytes,_page,_crop,options)=>{state.renders++;state.dimensions.push([options.maxDimension,options.fallbackDimension]);if(state.fail)throw Error('render failed');if(state.stall)return new Promise(()=>{});return {data:'SYNTHETIC_IMAGE',mimeType:'image/png',width:100,height:200,pageCount:4,renderPixels:options.maxDimension,renderFallback:false};}}})}};
 const box={setTimeout,clearTimeout,Services:{uuid:{generateUUID:randomUUID}},IOUtils:{stat:async()=>({size:200}),read:async()=>new Uint8Array([1])},Zotero:{getMainWindow:()=>win,DB:{queryAsync:query},Prefs:{get:()=>state.enabled},Libraries:{userLibraryID:1},Items:{getIDFromLibraryAndKey:()=>1,getAsync:async ids=>Array.isArray(ids)?[attachment]:{getAttachments:()=>[2]}},Utilities:{Internal:{md5Async:async()=>state.hash,md5:x=>createHash('md5').update(x).digest('hex')}},ZotQueryResearch:{validateSessionScope:async(s,a)=>{if(s!=='S'||a.positionId!=='P')throw Error('cross-session');}}}};
 vm.createContext(box);vm.runInContext(read('content/scripts/research-vision.js'),box);const api=box.Zotero.ZotQueryVision;await api.startup();return {api,state,db,box};
}
test('visual snapshots cache by file fingerprint/page/region and never count as text reads',async()=>{
 const f=await fixture();try{
  const args={sessionId:'S',positionId:'P',pageNumber:3};
  const first=await f.api.readPage(args);assert.equal(first.images[0].data,'SYNTHETIC_IMAGE');assert.equal(first.pdfLink,'zotero://open-pdf/library/items/PDF00001?page=3');assert.equal(f.state.removed,1);
  assert.equal((await f.api.readPage(args)).visualId,first.visualId);assert.equal(f.state.renders,1);
  const list=await f.api.list('S');assert.equal(list.total,1);assert.doesNotMatch(JSON.stringify(list),/SYNTHETIC_IMAGE|private\/local/);
  await assert.rejects(f.api.readSaved('OTHER',first.visualId),/不属于/);
  f.state.hash='changed';assert.notEqual((await f.api.readPage(args)).visualId,first.visualId);
  assert.equal((await f.api.list('S',{limit:1})).nextOffset,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM zotqueryresearch.positions').get().n,1);
 }finally{f.db.close();}
});
test('visual permission, scope, bounds, ambiguous attachments and render failures fail closed',async()=>{
 const f=await fixture();try{
  const a={sessionId:'S',positionId:'P',pageNumber:1};f.state.enabled=false;await assert.rejects(f.api.readPage(a),/未启用/);f.state.enabled=true;
  await assert.rejects(f.api.readPage({...a,sessionId:'OTHER'}),/cross-session/);
  await assert.rejects(f.api.readPage({...a,pageNumber:0}),/pageNumber/);
  for(const crop of [{x:-1,y:0,width:1,height:1},{x:0,y:0,width:2,height:1},{x:0,y:0,width:NaN,height:1}])await assert.rejects(f.api.readPage({...a,crop}),/坐标/);
  await assert.rejects(f.api.readPage({...a,attachmentKey:'FOREIGN1'}),/指定/);
  f.state.fail=true;await assert.rejects(f.api.readPage(a),/render failed/);assert.equal(f.api.isSessionActive('S'),false);assert.equal((await f.api.list('S')).total,0);
 }finally{f.db.close();}
});
test('preview and saved visual read share the same in-process raster cache',async()=>{
 const f=await fixture();try{
  const a={sessionId:'S',positionId:'P',pageNumber:3};
  const first=await f.api.previewPage(a),second=await f.api.previewPage(a);
  assert.equal(first.renderDiagnostics.cacheHit,false);
  assert.equal(second.renderDiagnostics.cacheHit,true);
  assert.equal(second.renderDiagnostics.renderTotalMs,0,'cache reuse must not report the original render time as current latency');
  assert.equal(typeof second.renderDiagnostics.sourceRenderTotalMs,'number');
  assert.equal(first.persisted,false);assert.equal(f.state.renders,1);
  const saved=await f.api.readPage(a);assert.equal(saved.renderDiagnostics.cacheHit,true);
  assert.equal(f.state.renders,1);assert.equal((await f.api.list('S')).total,1);
  f.state.hash='different';await f.api.previewPage(a);assert.equal(f.state.renders,2);
 }finally{f.db.close();}
});
test('hard timeout cancels the PDF worker and never saves visual evidence',async()=>{
 const f=await fixture();try{
  f.state.stall=true;f.state.timeoutMs=10;
  await assert.rejects(f.api.readPage({sessionId:'S',positionId:'P',pageNumber:1}),/PDF 页面渲染超时/);
  assert.deepEqual(f.state.dimensions,[[1600,1050]]);
  assert.equal(f.state.cancels,1);assert.equal(f.state.removed,1);
  assert.equal((await f.api.list('S')).total,0);
 }finally{f.db.close();}
});
test('visual observations are immutable and explicitly not text-verified or automatic gate closure',async()=>{
 const f=await fixture();try{
  const image=await f.api.readPage({sessionId:'S',positionId:'P',pageNumber:1});
  const args={sessionId:'S',visualId:image.visualId,observation:'A mapped interval is visible',rowLabel:'Protein X',numbering:'reference isoform',uncertainties:'last character unclear',relation:'partial'};
  assert.equal((await f.api.observe(args)).observation.verified,false);
  await assert.rejects(f.api.observe(args),/已登记/);await assert.rejects(f.api.observe({...args,sessionId:'OTHER'}),/不属于/);
  assert.equal((await f.api.list('S')).results[0].observation.uncertainties,'last character unclear');
 }finally{f.db.close();}
});
test('MCP sends image blocks separately, never a base64 blob in textual JSON',()=>{
 const box={Zotero:{},_globalThis:null};box._globalThis=box;vm.createContext(box);
 vm.runInContext(read('content/scripts/research-engine.js').replace('_globalThis.ZotQueryResearchBootstrap=','_globalThis.resultForTest=mcpResult;_globalThis.ZotQueryResearchBootstrap='),box);
 const r=JSON.parse(box.resultForTest(1,{visualId:'V',images:[{mimeType:'image/png',data:'IMAGE_BYTES'}]})[2]).result;
 assert.equal(r.content[1].type,'image');assert.equal(r.content[1].data,'IMAGE_BYTES');assert.doesNotMatch(r.content[0].text,/IMAGE_BYTES/);
});
