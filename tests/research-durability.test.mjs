import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
const read = name => fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
async function fixture(nativeRows=false) {
 const db=new DatabaseSync(':memory:');
 db.exec("ATTACH DATABASE ':memory:' AS zotqueryresearch; ATTACH DATABASE ':memory:' AS zotquery;");
 db.exec(`CREATE TABLE zotquery.items(item_pk INTEGER,library_key TEXT,item_key TEXT,title TEXT,was_truncated INTEGER,pages_indexed INTEGER,pages_total INTEGER);
 CREATE TABLE zotquery.chunks(item_pk INTEGER,model_id TEXT,chunk_index INTEGER,chunk_text TEXT,page_number INTEGER,paragraph_index INTEGER,text_source TEXT,start_char INTEGER,end_char INTEGER);
 INSERT INTO zotquery.items VALUES(1,'user','ITEM0001','Synthetic source',0,1,1);
 INSERT INTO zotquery.chunks VALUES(1,'model-A',0,'Protein X spans residues 40–45. The complete segment is ACDEFG. A short motif is CDE.',1,0,'pdf',0,90);`);
 const nativeRow = values => new Proxy({QueryInterface:()=>{}}, { get(_target,name) { if(name==='then')return undefined; if(Object.hasOwn(values,name))return values[name];throw Error(`DB column '${String(name)}' not found`); } });
 const query=async(sql,args=[])=>{const s=db.prepare(sql);return s.columns().length?s.all(...args).map(row=>nativeRows?nativeRow(row):row):s.run(...args);};
 const box={Zotero:{DB:{queryAsync:query,valueQueryAsync:async(sql,args=[])=>{const r=db.prepare(sql).get(...args);return r?Object.values(r)[0]:false;},executeTransaction:async f=>{db.exec('BEGIN');try{const r=await f();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},debug:()=>{},
 ZotQuery:{vectorStore:{ensureInit:async()=>{}},api:{getEmbeddingModel:()=>({activeModelId:'model-A'})}},Items:{getIDFromLibraryAndKey:()=>null},Libraries:{userLibraryID:1}},Services:{uuid:{generateUUID:randomUUID}}};
 box._globalThis=box;vm.createContext(box);
 vm.runInContext(read('content/scripts/research-engine.js').replace('_globalThis.ZotQueryResearchBootstrap=', '_globalThis.testAPI={ensureResearchSchema,recordFact,assessFact,factSlotClosure,normalizedFactSlots,genericEvidenceHint,positionContext,pdfChunkText,validateSessionScope,nextActions,registerSurveyNote,promoteSurveyNotes}; _globalThis.ZotQueryResearchBootstrap='),box);
 const api=box.testAPI;await api.ensureResearchSchema();
 await query("INSERT INTO zotqueryresearch.sessions(session_id,question,created_at,updated_at,status,fact_request_json) VALUES('S','Synthetic research','2026-01-01','2026-01-01','reviewing',?)",[JSON.stringify({slots:[{id:'seq',type:'sequence',lengthFromSlot:'range'},{id:'range',type:'residue_range'}]})]);
 await query("INSERT INTO zotqueryresearch.positions(position_id,session_id,source,work_key,library_key,item_key,chunk_index,page_number,review_status,supports_question,created_at,updated_at) VALUES('P','S','pdf','user:ITEM0001','user','ITEM0001',0,1,'reviewed','yes','t','t')");
 vm.runInContext(read('content/scripts/research-vision.js'),box);await box.Zotero.ZotQueryVision.startup();
 vm.runInContext(read('content/scripts/research-history.js'),box);await box.ZotQueryHistoryBootstrap.startup();
 return {db,box,api,history:box.Zotero.ZotQueryHistory,query,close:()=>db.close()};
}
const assessment={relation:'full',sourceMeaning:'Explicit definition of the complete target segment in Protein X.',rationale:'The value describes the entire declared target, not a sub-motif.'};

test('Survey promotion uses a fifty-work page by default and marks exhaustion durably',async()=>{
 const f=await fixture(true);try{
  let screenedOptions;
  f.box.Zotero.ZotQueryLNE={api:{surveyScreen:async(_id,options)=>{
   screenedOptions=options;
   return {results:[],pagination:{nextOffset:null}};
  }}};
  await f.query("UPDATE zotqueryresearch.sessions SET survey_id='V',orchestration_required=1,orchestration_json=? WHERE session_id='S'",[JSON.stringify({promotionOffset:0,promotionComplete:false})]);
  const result=await f.api.promoteSurveyNotes('S');
  assert.equal(screenedOptions.limit,50);assert.equal(result.pagination.limit,50);
  assert.equal(result.orchestration.promotionComplete,true);
  const stored=JSON.parse(f.db.prepare("SELECT orchestration_json FROM zotqueryresearch.sessions WHERE session_id='S'").get().orchestration_json);
  assert.equal(stored.promotionReachedEnd,true);
 }finally{f.close();}
});
test('reviewed PDF support is offered for fact registration until a sourced record is saved',async()=>{
 const f=await fixture(true);try{
  await f.api.positionContext('P',{level:0});
  await f.query("UPDATE zotqueryresearch.positions SET supports_question='yes',evidence_scope='REGION_MAPPING' WHERE position_id='P'");
  const before=await f.api.nextActions('S');
  assert.equal(before.factCandidates[0].positionId,'P');
  assert.equal(before.factCandidates[0].nextTool,'zotquery_evidence_fact');
  assert.match(before.priorities[0],/Register or explicitly assess/);
  await f.api.recordFact({positionId:'P',slot:'range',value:'40–45',valueType:'residue_range',sourceQuote:'Protein X spans residues 40–45.',evidenceStatus:'DIRECT',assessment});
  const after=await f.api.nextActions('S');
  assert.equal(after.factCandidates.length,0);
 }finally{f.close();}
});

test('empty-response diagnostics survive SQLite restart without raw body or reasoning text',async()=>{
 const f=await fixture(true);try{
  const run=await f.history.begin({question:'Synthetic research',sessionId:'S',provider:'deepseek',model:'fixture',options:{}});
  await f.history.fail(run,{code:'REASONING_ONLY',diagnostics:[{kind:'REASONING_ONLY',effective:32768,input:1000,output:800,reasoning:800,finishReason:'stop',contentChars:0,responseReasoningChars:4000,reasoning_content:'PRIVATE_THOUGHT',raw:'PRIVATE_BODY'}]});
  await f.box.ZotQueryHistoryBootstrap.startup();
  const saved=(await f.history.read('S',{runId:run})).selected;
  assert.equal(saved.error_code,'REASONING_ONLY');assert.equal(saved.metadata.diagnostics[0].finishReason,'stop');
  assert.equal(saved.metadata.diagnostics[0].responseReasoningChars,4000);
  assert.doesNotMatch(JSON.stringify(saved),/PRIVATE_/);
 }finally{f.close();}
});
test('delete is scoped, transactional, active-safe and preserves source index',async()=>{
 const f=await fixture(true);try{
  const run=await f.history.begin({sessionId:'S',question:'Synthetic research'});
  await assert.rejects(f.history.remove('S'),/仍在执行/);
  await f.history.finish(run,{markdown:'Saved answer',synthesisAllowed:false});
  await f.query("INSERT INTO zotqueryresearch.visual_evidence(visual_id,session_id,position_id,library_key,attachment_key,page_number,crop_json,pdf_hash,image_hash,width,height,image_base64,created_at) VALUES('V','S','P','user','PDF00001',1,'{}','hash','hash',1,1,'FAKE_IMAGE','t')");
  await f.query("INSERT INTO zotqueryresearch.sessions(session_id,question,created_at,updated_at,status) VALUES('OTHER','Other research','t','t','reviewing')");
  await f.api.positionContext('P',{level:0});
  await f.api.recordFact({positionId:'P',slot:'range',value:'40–45',valueType:'residue_range',sourceQuote:'Protein X spans residues 40–45.',evidenceStatus:'DIRECT',assessment});
  // Failure midway must roll back earlier child deletions too.
  f.db.exec("CREATE TRIGGER zotqueryresearch.block_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  await assert.rejects(f.history.remove('S'),/synthetic failure/);
  assert.equal((await f.history.read('S')).selected.markdown,'Saved answer');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM zotqueryresearch.fact_records').get().n,1);
  f.db.exec('DROP TRIGGER zotqueryresearch.block_delete');
  const forgotten=[];f.box.Zotero.ZotQueryModelAgent={isSessionActive:()=>true,forgetSession:id=>forgotten.push(id)};
  await assert.rejects(f.history.remove('S'),/仍在执行/);
  f.box.Zotero.ZotQueryModelAgent.isSessionActive=()=>false;
  await f.history.remove('S');assert.deepEqual(forgotten,['S']);
  await assert.rejects(f.history.read('S'),/不存在/);await assert.rejects(f.history.begin({sessionId:'S',question:'Synthetic research'}),/已删除/);
  for(const table of ['positions','answer_runs','fact_records','fact_resolutions','fact_assessment_revisions','document_chunks_listed','visual_evidence']) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM zotqueryresearch.${table}`).get().n,0,table);
  assert.equal((await f.history.list()).results[0].id,'OTHER');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM zotquery.chunks').get().n,1);
 }finally{f.close();}
});
test('delete orphan attempt does not accept an answer revision as a session target',async()=>{
 const f=await fixture(true);try{
  const linked=await f.history.begin({sessionId:'S',question:'Synthetic research'});await f.history.fail(linked);
  await assert.rejects(f.history.remove(linked),/不存在/);
  const orphan=await f.history.begin({question:'No session'});await f.history.fail(orphan);
  await f.history.remove(orphan);await assert.rejects(f.history.read(orphan),/不存在/);
  assert.equal((await f.history.read('S')).selected.run_id,linked);
 }finally{f.close();}
});
const direct=(id,slot,type,value,extra={})=>({fact_id:id,slot,value_type:type,value_text:value,source_quote:`The source explicitly states ${value}.`,evidence_status:'DIRECT',source_review_status:'reviewed',source_supports_question:'yes',assessment_json:JSON.stringify(assessment),...extra});

test('checkpoint survives restart, projects native rows and persists only safe runtime fields',async()=>{
 const f=await fixture(true);try{
  const binding=randomUUID();
  const run=await f.history.begin({sessionId:'S',question:'Synthetic research',options:{budgetBinding:binding,maxTokensMode:'auto',timeoutSeconds:1800,baseURL:'PRIVATE_ENDPOINT'}});
  await f.history.checkpoint(run,{runtime:{status:'waiting',budget:32768,successfulBudget:16384,lastInput:493237,round:2,apiKey:'PRIVATE_KEY'},diagnostics:[{kind:'RATE_LIMITED',httpStatus:429,elapsedMs:51000,effective:32768,raw:'PRIVATE_ERROR'}]});
  const before=await f.history.read('S',{runId:run});assert.equal(before.selected.status,'running');assert.equal(before.selected.metadata.runtime.budget,32768);
  await f.box.ZotQueryHistoryBootstrap.startup();
  const restored=await f.history.resumeBudget('S',binding);assert.equal(restored.budget,32768);assert.equal(restored.successfulBudget,16384);
  assert.equal((await f.history.read('S',{runId:run})).selected.status,'interrupted');
  assert.equal(await f.history.resumeBudget('S',randomUUID()),null);assert.equal(await f.history.resumeBudget('OTHER',binding),null);
  const dump=JSON.stringify(f.db.prepare('SELECT * FROM zotqueryresearch.answer_runs').all());assert.doesNotMatch(dump,/PRIVATE_/);
 }finally{f.close();}
});

test('saved preferences reach HTTP; real SQL learns budgets across restart and isolates config changes',async()=>{
 const f=await fixture(true);try{
  const prefs=new Map(),requests=[];let queue=[];
  f.box.URL=URL;f.box.Services.logins={findLogins:()=>[]};
  f.box.Zotero.Prefs={get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)};
  f.box.Zotero.ZotQueryResearch={toolDefinitions:()=>[{name:'zotquery_health',inputSchema:{type:'object'}},{name:'zotquery_evidence_context',inputSchema:{type:'object'}}],callTool:async()=>({text:'Synthetic source passage'}),researchResult:async()=>({sessionId:'S',question:'Synthetic research',status:'ready_for_synthesis',coverageGate:{synthesisAllowed:true},facts:[]})};
  f.box.Zotero.ZotQueryOutputProfiles={render:()=>({markdown:'# Audit'})};
  f.box.Zotero.HTTP={request:async(method,url,opts)=>{
   if(method==='GET')return {response:{data:[]}};
   requests.push({body:JSON.parse(opts.body),timeout:opts.timeout});const next=queue.shift();assert.ok(next,'unexpected request');if(next instanceof Error)throw next;return {response:next};
  }};
  const load=()=>{vm.runInContext(read('content/scripts/model-agent.js'),f.box);return f.box.Zotero.ZotQueryModelAgent;};
  let agent=load();
  const config={provider:'openai_compatible',baseURL:'https://route-a.example.test',model:'deepseek-fixture',maxTokens:8192,maxTokensMode:'auto',reasoningEffort:'max',maxSteps:30,timeoutSeconds:1800};
  await agent.saveConfig(config);
  const reply=(text,n=0)=>({choices:[{finish_reason:n?'length':'stop',message:{content:text,reasoning_content:'PRIVATE_REASONING'}}],usage:{prompt_tokens:1000,completion_tokens:n||100,completion_tokens_details:{reasoning_tokens:n}}});
  const run=()=>agent.runAgent({question:'Synthetic research',sessionId:'S'});
  queue=[reply('TRUNCATED',8192),reply('Ready'),Object.assign(new Error('PRIVATE_ERROR'),{status:503})];
  await assert.rejects(run(),e=>e.code==='SERVER_ERROR');
  assert.deepEqual(requests.map(r=>r.body.max_tokens),[undefined,32768,32768]);assert.ok(requests.every(r=>r.timeout===1800000));
  await agent.shutdown();await f.box.ZotQueryHistoryBootstrap.shutdown();await f.box.ZotQueryHistoryBootstrap.startup();agent=load();
  queue=[{choices:[{message:{content:'',tool_calls:[{id:'reread',type:'function',function:{name:'zotquery_evidence_context',arguments:'{}'}}]}}]},reply('Answer')];await run();assert.equal(requests.at(-2).body.max_tokens,32768);
  assert.doesNotMatch(JSON.stringify(requests.at(-2).body),/PRIVATE_REASONING|TRUNCATED/);
  await agent.saveConfig({...config,timeoutSeconds:600});queue=[reply('Ready'),reply('Answer')];await run();assert.equal(requests.at(-2).body.max_tokens,32768);assert.equal(requests.at(-2).timeout,600000);
  for(const change of [{maxTokens:4096},{baseURL:'https://route-b.example.test'},{model:'other-model'},{reasoningEffort:'low'},{maxTokensMode:'manual'}]){
   await agent.saveConfig({...config,...change});queue=[reply('Ready'),reply('Answer')];await run();assert.equal(requests.at(-2).body.max_tokens,change.maxTokensMode==='manual'?8192:undefined);
  }
  await agent.saveConfig({...config,maxTokens:65536});queue=[reply('Ready'),reply('Answer')];await run();assert.equal(requests.at(-2).body.max_tokens,undefined);
  const dump=JSON.stringify(f.db.prepare('SELECT * FROM zotqueryresearch.answer_runs').all());assert.doesNotMatch(dump,/PRIVATE_|route-a|route-b|TRUNCATED/);
 }finally{f.close();}
});

test('3.1.13 failed sixth writer migrates by phase in real SQLite, including manual-budget cold resume',async()=>{
 for(const mode of ['auto','manual']){
  const f=await fixture(true);try{
   const prefs=new Map(),requests=[],events=[],calls=[];let queue=[];
   f.box.URL=URL;f.box.Services.logins={findLogins:()=>[]};f.box.Zotero.Prefs={get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)};
   f.box.Zotero.ZotQueryResearch={toolDefinitions:()=>['zotquery_health','zotquery_evidence_context'].map(name=>({name,inputSchema:{type:'object'}})),callTool:async name=>{calls.push(name);return {text:'Synthetic original passage'};},researchResult:async()=>({sessionId:'S',question:'Synthetic research',status:'reviewing',coverageGate:{synthesisAllowed:false,blockers:['incomplete']},facts:[]})};
   f.box.Zotero.ZotQueryOutputProfiles={render:()=>({markdown:'# Internal audit'})};
   f.box.Zotero.HTTP={request:async(method,_url,opts)=>{if(method==='GET')return {response:{data:[]}};requests.push(JSON.parse(opts.body));const next=queue.shift();assert.ok(next,'unexpected extra research request');return {response:next};}};
   vm.runInContext(read('content/scripts/model-agent.js'),f.box);const agent=f.box.Zotero.ZotQueryModelAgent;
   await agent.saveConfig({provider:'openai_compatible',baseURL:'https://fixture.example.test',model:'deepseek-fixture',maxTokens:8192,maxTokensMode:mode,reasoningEffort:'max',maxSteps:30});
   const binding=prefs.get('zotquery.modelAgent.budgetBinding');
   const old=await f.history.begin({sessionId:'S',question:'Synthetic research',options:{budgetBinding:binding,maxTokensMode:mode}});
   // Original 3.1.13 shape has phase/round, but no writingRounds field.
   await f.history.fail(old,{runtime:{phase:'writing',round:6,status:'failed',budget:32768}});
   queue=[{choices:[{message:{content:'',tool_calls:[{id:'read',type:'function',function:{name:'zotquery_evidence_context',arguments:'{}'}}]}}]}, {choices:[{message:{content:'Source-supported limited answer'}}]}];
   const result=await agent.runAgent({sessionId:'S',question:'Synthetic research',onEvent:e=>events.push(e)});
   assert.equal(requests.length,2);assert.deepEqual(calls,['zotquery_evidence_context']);assert.ok(!events.some(e=>e.type==='model'));
   assert.equal(requests[0].max_tokens,mode==='auto'?32768:8192);assert.match(requests[0].messages.at(-2).content,/不是重新规划研究/);
   assert.equal(result.answerKind,'limited-answer');assert.match(result.markdown,/Source-supported limited answer/);
   assert.equal((await f.history.read('S',{runId:old})).selected.status,'failed');assert.equal((await f.history.read('S')).total,2);
  }finally{f.close();}
 }
});

test('native Zotero row proxies: history list/read/version/resume payloads never probe QueryInterface',async()=>{
 const f=await fixture(true);try{
  const rows=await f.query('SELECT session_id FROM zotqueryresearch.sessions');
  assert.throws(()=>({...rows[0]}),/QueryInterface/); // Reproduces the old implementation.
  const legacy=await f.history.read('S');assert.equal(legacy.session.session_id,'S');assert.doesNotThrow(()=>JSON.stringify(legacy));
  const run=await f.history.begin({sessionId:'S',question:'Synthetic research'});
  await f.history.fail(run,{code:'OUTPUT_LIMIT',diagnostics:[{effective:65536,output:65536,reasoning:65000,kind:'OUTPUT_LIMIT',apiKey:'DO_NOT_STORE',reasoning_content:'DO_NOT_STORE'}]});
  const failed=await f.history.read('S',{runId:run});assert.equal(failed.selected.error_code,'OUTPUT_LIMIT');assert.equal(failed.selected.metadata.diagnostics[0].reasoning,65000);assert.ok(!JSON.stringify(failed).includes('DO_NOT_STORE'));
  const answer=await f.history.begin({sessionId:'S',question:'Synthetic research'});await f.history.finish(answer,{markdown:'# Persisted',synthesisAllowed:true});
  const loaded=await f.history.read('S',{runId:answer});assert.equal(loaded.selected.markdown,'# Persisted');assert.doesNotThrow(()=>JSON.stringify(loaded));
  const list=await f.history.list();assert.equal(list.results[0].sessionId,'S');assert.doesNotThrow(()=>JSON.stringify(list));
  const orphan=await f.history.begin({question:'Synthetic orphan'});await f.history.fail(orphan);const unbound=await f.history.read(orphan);assert.equal(unbound.session,null);assert.doesNotThrow(()=>JSON.stringify(unbound));
 }finally{f.close();}
});
test('additive schema is idempotent and old sessions remain visible without invented answers',async()=>{
 const f=await fixture();try{await f.api.ensureResearchSchema();const list=await f.history.list();assert.equal(list.total,1);assert.equal(list.results[0].answers,0);const entry=await f.history.read('S');assert.equal(entry.selected,null);assert.equal(entry.session.question,'Synthetic research');}finally{f.close();}
});
test('answer revisions persist, search is literal, pagination is stable, restart preserves answers',async()=>{
 const f=await fixture();try{
  for(let i=0;i<23;i++){const id=await f.history.begin({sessionId:'S',question:'Synthetic research',provider:'fixture',model:'test',options:{maxSteps:8,apiKey:'NEVER_STORE',baseURL:'https://secret.invalid',templateMarkdown:'PRIVATE_TEMPLATE',reasoningContent:'PRIVATE_REASONING'}});await f.history.finish(id,{markdown:'# Answer '+i,synthesisAllowed:i%2===0});}
  let data=await f.history.read('S');assert.equal(data.total,23);assert.equal(data.runs.length,20);assert.equal(data.nextOffset,20);assert.ok(data.selected.markdown.startsWith('# Answer '));
  const older=await f.history.read('S',{offset:20});assert.equal(older.runs.length,3);assert.equal(older.nextOffset,null);
  assert.equal((await f.history.list({search:'%' })).total,0);
  const dump=JSON.stringify(f.db.prepare('SELECT * FROM zotqueryresearch.answer_runs').all());for(const secret of ['NEVER_STORE','secret.invalid','PRIVATE_TEMPLATE','PRIVATE_REASONING'])assert.ok(!dump.includes(secret));
  await f.history.begin({question:'Unbound attempt',provider:'fixture',model:'test'});await f.box.ZotQueryHistoryBootstrap.startup();
  const unbound=(await f.history.list({search:'Unbound'})).results[0];assert.equal(unbound.status,'interrupted');assert.equal((await f.history.read('S')).total,23);
 }finally{f.close();}
});
test('failed attempts are discoverable, binding enforces identity, cross-session answer selection fails',async()=>{
 const f=await fixture();try{const run=await f.history.begin({question:'Different question'});await assert.rejects(f.history.bindSession(run,'S'),/不匹配/);await f.history.fail(run);assert.equal((await f.history.read(run)).selected.status,'failed');await assert.rejects(f.history.read('S',{runId:run}),/不属于/);const okay=await f.history.begin({question:'Synthetic research'});await f.history.bindSession(okay,'S');assert.equal((await f.history.read('S',{runId:okay})).selected.session_id,'S');}finally{f.close();}
});
test('literal match, partial motif and missing assessment do not close a whole-answer slot',async()=>{
 const f=await fixture();try{
  const request={slots:[{id:'seq',type:'sequence',lengthFromSlot:'range'},{id:'range',type:'residue_range'}]},range=direct('R','range','residue_range','40-45');
  const partial=direct('F','seq','sequence','CDE');
  let closure=f.api.factSlotClosure(request,[range,partial]);assert.equal(closure.allRequiredClosed,false);assert.match(closure.slots[0].assessments[0].issues.join(),/expected 6/);
  const full=direct('F','seq','sequence','ACDEFG');assert.equal(f.api.factSlotClosure(request,[range,full]).allRequiredClosed,true);
  full.assessment_json=null;assert.equal(f.api.factSlotClosure(request,[range,full]).allRequiredClosed,false);
  full.assessment_json=JSON.stringify({...assessment,relation:'partial'});assert.equal(f.api.factSlotClosure(request,[range,full]).allRequiredClosed,false);
 }finally{f.close();}
});
test('general slot constraints distinguish entity, coordinates, quantity and complete sequence',async()=>{
 const f=await fixture();try{
  const req={slots:[{id:'dose',type:'quantitative_measurement',entity:'compound A',numbering:'condition B'}]};
  const fact=direct('D','dose','quantitative_measurement','20',{entity:'compound C',numbering:'condition B'});assert.equal(f.api.factSlotClosure(req,[fact]).allRequiredClosed,false);
  fact.entity='compound A';assert.equal(f.api.factSlotClosure(req,[fact]).allRequiredClosed,true);
  fact.numbering='condition C';assert.equal(f.api.factSlotClosure(req,[fact]).allRequiredClosed,false);
  assert.notEqual(f.api.genericEvidenceHint('Residues 40–45 define a sequence').scope,'CONSTRUCT_DEFINITION');
  assert.equal(f.api.genericEvidenceHint('A deletion construct removes residues 40–45').scope,'CONSTRUCT_DEFINITION');
 }finally{f.close();}
});
test('fact registration and reassessment execute real SQL; old values and provenance survive',async()=>{
 const f=await fixture();try{
  await f.api.positionContext('P',{level:0});
  const payload={positionId:'P',slot:'seq',valueType:'sequence',value:'CDE',evidenceStatus:'DIRECT',sourceQuote:'A short motif is CDE.'};
  await assert.rejects(f.api.recordFact(payload),/assessment/);
  const result=await f.api.recordFact({...payload,assessment:{...assessment,relation:'partial'}});assert.equal(result.slotClosure.allRequiredClosed,false);
  await f.api.assessFact({factId:result.factId,assessment:{...assessment,relation:'context'}});
  const saved=f.db.prepare('SELECT * FROM zotqueryresearch.fact_records WHERE fact_id=?').get(result.factId);assert.equal(saved.value_text,'CDE');assert.equal(saved.source_quote,payload.sourceQuote);assert.equal(JSON.parse(saved.assessment_json).relation,'context');
 }finally{f.close();}
});
test('successful reading pins original context; reindexing cannot silently replace quoted evidence',async()=>{
 const f=await fixture();try{
  const read=await f.api.positionContext('P',{level:0});assert.ok(read.chunks[0].text.includes('ACDEFG'));
  f.db.exec("UPDATE zotquery.chunks SET chunk_text='A completely different source after reindexing'");
  assert.ok((await f.api.positionContext('P',{level:0})).chunks[0].text.includes('ACDEFG'));
  await assert.rejects(f.api.positionContext('P',{level:2}),/changed since/);
  const row=f.db.prepare("SELECT * FROM zotqueryresearch.positions WHERE position_id='P'").get();assert.ok((await f.api.pdfChunkText(row)).includes('ACDEFG'));
 }finally{f.close();}
});
test('missing original chunk is never marked as read; foreign position/fact IDs are rejected',async()=>{
 const f=await fixture();try{
  f.db.exec("DELETE FROM zotquery.chunks");await assert.rejects(f.api.positionContext('P'),/not marked as read/);
  assert.equal(f.db.prepare("SELECT context_read_at FROM zotqueryresearch.positions WHERE position_id='P'").get().context_read_at,null);
  await f.api.validateSessionScope('S',{positionId:'P'});await assert.rejects(f.api.validateSessionScope('OTHER',{positionId:'P'}),/bound research/);await assert.rejects(f.api.validateSessionScope('S',{factId:'FOREIGN'}),/bound research/);
 }finally{f.close();}
});
test('survey notes outside sweep page resolve actual parent without claiming to have read them',async()=>{
 const f=await fixture();try{
  f.box.Zotero.Items={getIDFromLibraryAndKey:()=>2,getAsync:async id=>id===2?{isNote:()=>true,parentItemID:1}:{key:'ITEM0001',getField:()=> 'Synthetic source'}};
  const p=await f.api.registerSurveyNote('S',{libraryKey:'user',title:'Synthetic'},['NOTE0001']);assert.equal(p.item_key,'ITEM0001');assert.equal(p.coverage_required,0);assert.equal(p.context_read_at,null);assert.equal(p.source,'note');
 }finally{f.close();}
});
test('toolbar registers only the final workbench entry, before slow core startup',()=>{
 const bundle=read('content/scripts/index.js'),owner=bundle.indexOf('this.buttonId="zotquery-toolbar-button"'),start=bundle.indexOf('add(e){',owner),end=bundle.indexOf('createButtonFallback(e){',start);
 const body=bundle.slice(start,end);assert.equal(body,'add(e){P()?.ZotQueryResearchUI?.customizeMainWindow?.(e)}');
 let calls=0;const box={P:()=>({ZotQueryResearchUI:{customizeMainWindow:win=>{assert.equal(win.id,'window');calls++;}}})};vm.createContext(box);vm.runInContext(`globalThis.add=({${body}}).add`,box);box.add({id:'window'});assert.equal(calls,1);
 const bootstrap=read('bootstrap.js');assert.ok(bootstrap.indexOf('scripts/research-ui.js')<bootstrap.indexOf('await Zotero.ZotQuery.hooks.onStartup()'));
 assert.equal((bootstrap.match(/scripts\/research-ui\.js/g)||[]).length,1);
});
