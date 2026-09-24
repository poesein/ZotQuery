import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=fs.readFileSync(new URL('../content/scripts/research-dashboard.js',import.meta.url),'utf8');
function fixture(){
 const nodes=new Map(),reads=[],offsets=[],rendered=[],deleted=[];let confirm=true;
 const element=()=>({value:'',textContent:'',disabled:false,options:[],children:[],style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},focus(){},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);}});
 const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const opts={questionMode:'EXACT',readingPolicy:'QUERY_EXHAUSTIVE',surveyPreset:'balanced',includeSemantic:false,surveyLexicalOnly:true};
 for(const [id,values]of [['question-mode',['AUTO','EXACT']],['reading-policy',['QUERY_EXHAUSTIVE']],['survey-preset',['balanced']],['fact-type',['sequence']]])node(id).options=values.map(value=>({value}));
 const data={session:{session_id:'S',question:'Stored question',question_mode:'EXACT',reading_policy:'QUERY_EXHAUSTIVE',survey_id:'V'},selected:{run_id:'R',question:'Stored question',markdown:'# Stored answer',created_at:'2026-01-01',status:'limited',options:opts,metadata:{synthesisAllowed:false}},runs:[],total:1,offset:0,nextOffset:null};
 data.runs=[data.selected];
 const z={ZotQueryHistory:{remove:async id=>deleted.push(id),list:async()=>({results:[],total:0,offset:0,nextOffset:null}),read:async(id,args)=>{reads.push({id,args});return data;}},ZotQueryResearch:{sessionLedger:async()=>({coverage:{}}),positions:async(_id,{offset})=>{offsets.push(offset);return {offset,total:201,nextOffset:offset+100<201?offset+100:null,results:[]};}}};
 const box={window:{confirm:()=>confirm,ZotQueryMarkdown:{render:(_root,text)=>rendered.push(text)}},Zotero:z,document:{getElementById:node,querySelectorAll:()=>[],createElementNS:()=>element()}};
 vm.createContext(box);vm.runInContext(source.replace('window.addEventListener("DOMContentLoaded", init, { once: true });','window.test={state,openHistory,loadPositions,newResearch,researchOptions,deleteHistory};'),box);
 return {api:box.window.test,node,data,reads,offsets,rendered,deleted,setConfirm:v=>confirm=v};
}
test('history deletion requires confirmation, blocks active work, resets only deleted selection',async()=>{
 const f=fixture();await f.api.openHistory('S');f.setConfirm(false);await f.api.deleteHistory('S','Stored question');assert.equal(f.deleted.length,0);
 f.setConfirm(true);f.api.state.running=true;await f.api.deleteHistory('S','Stored question');assert.equal(f.deleted.length,0);
 f.api.state.running=false;await f.api.deleteHistory('OTHER','Other');assert.equal(f.api.state.sessionId,'S');assert.equal(f.node('report-editor').value,'# Stored answer');
 await f.api.deleteHistory('S','Stored question');assert.deepEqual(f.deleted,['OTHER','S']);assert.equal(f.api.state.sessionId,null);assert.equal(f.node('report-editor').value,'');assert.equal(f.node('load-positions').disabled,true);
});
test('history renders saved Markdown, restores exact session/options, permits resume without a fresh sweep',async()=>{
 const f=fixture();await f.api.openHistory('S');assert.equal(f.api.state.sessionId,'S');assert.equal(f.node('research-query').value,'Stored question');assert.equal(f.node('include-semantic').checked,false);assert.equal(f.node('lexical-only').checked,true);assert.equal(f.rendered.at(-1),'# Stored answer');assert.equal(f.api.state.sessionSignature,JSON.stringify(f.api.researchOptions('Stored question')));assert.match(f.node('report-meta').textContent,/阶段性/);
});
test('legacy sessions keep evidence but do not fabricate lost answer text',async()=>{
 const f=fixture();f.data.selected=null;f.data.runs=[];f.data.total=0;await f.api.openHistory('S');assert.equal(f.api.state.sessionId,'S');assert.equal(f.node('report-editor').value,'');assert.match(f.node('report-meta').textContent,/没有保存/);assert.equal(f.node('load-positions').disabled,false);
});

test('failed history shows actual token diagnostics and remains resumable without fabricating answer',async()=>{
 const f=fixture();Object.assign(f.data.selected,{markdown:null,status:'failed',error_code:'LIMIT_UNKNOWN',metadata:{diagnostics:[{effective:65536,input:20000,output:8192,reasoning:null,kind:'LIMIT_UNKNOWN'}]}});
 await f.api.openHistory('S');assert.equal(f.api.state.sessionId,'S');assert.equal(f.node('report-editor').value,'');assert.match(f.node('agent-log').textContent,/65536.*20000.*8192.*未知/);assert.match(f.node('agent-status').textContent,/LIMIT_UNKNOWN/);
});
test('unsaved edits and active research prevent accidental history replacement',async()=>{
 const f=fixture();f.node('report-editor').value='Unexported edit';f.setConfirm(false);await f.api.openHistory('S');assert.equal(f.reads.length,0);f.setConfirm(true);f.api.state.running=true;await f.api.openHistory('S');assert.equal(f.reads.length,0);
});
test('evidence pagination requests later pages rather than reloading the first 100 forever',async()=>{
 const f=fixture();f.api.state.sessionId='S';await f.api.loadPositions(100);assert.deepEqual(f.offsets,[100]);assert.equal(f.api.state.positionOffset,100);assert.equal(f.api.state.positionNext,200);await f.api.loadPositions(200);assert.equal(f.node('positions-next').disabled,true);
});
