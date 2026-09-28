import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const read=file=>fs.readFileSync(new URL('../content/scripts/'+file,import.meta.url),'utf8');
function fixture(){
 const box={Zotero:{},console};box._globalThis=box;vm.createContext(box);
 vm.runInContext(read('lne-native.js'),box);
 vm.runInContext(read('lne-tools.js'),box);
 const api=box.Zotero.ZotQueryLNE.api;
 const papers={
  AAAA1111:{noteKey:'AAAA1111',libraryKey:'user',parentItemKey:'PARENT01',title:'H1047R paper',profileId:'generic',segments:[
   {lineStart:5,lineEnd:6,text:'H1047R increased membrane recruitment in cells.',tag:'实验支持',canonicalRole:'OBSERVED_EVIDENCE'},
   {lineStart:9,lineEnd:9,text:'Other notes discuss membrane recruitment without this variant.',canonicalRole:'UNKNOWN'}]},
  BBBB2222:{noteKey:'BBBB2222',libraryKey:'user',parentItemKey:'PARENT02',title:'E545K paper',profileId:'generic',segments:[
   {lineStart:3,lineEnd:3,text:'E545K altered membrane recruitment.',canonicalRole:'UNKNOWN'}]}
 };
 api.paper=async key=>papers[key];
 api.hits=async(_key,query)=>({hits:query==='H1047R membrane recruitment'?[{lineStart:5,lineEnd:6,text:'H1047R membrane recruitment',canonicalRole:'OBSERVED_EVIDENCE'}]:[]});
 return box.Zotero.ZotQueryLNETools;
}

test('compare falls back to note-scoped query terms while preserving mutation identity',async()=>{
 const tools=fixture();
 const result=await tools.callTool('lne_compare',{question:'What do these notes say about H1047R membrane recruitment?',noteKeys:['AAAA1111','BBBB2222']});
 assert.equal(result.notes[0].retrievalMode,'note-scoped-query-terms');
 assert.equal(result.notes[0].evidence.length,1);
 assert.equal(result.notes[0].evidence[0].line,'L5-L6');
 assert.equal(result.notes[1].evidence.length,0,'a generic membrane segment cannot satisfy H1047R');
 assert.ok(result.queryPlan.hardTerms.includes('h1047r'));
});

test('compare retains exact phrase hits before fallback',async()=>{
 const tools=fixture();
 const result=await tools.callTool('lne_compare',{question:'H1047R membrane recruitment',noteKeys:['AAAA1111']});
 assert.equal(result.notes[0].retrievalMode,'literal-full-question');
 assert.equal(result.notes[0].evidence.length,1);
});
