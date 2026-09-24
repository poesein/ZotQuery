import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=fs.readFileSync(new URL('../content/scripts/model-agent.js',import.meta.url),'utf8');
const cfg={provider:'deepseek',format:'openai',baseURL:'https://example.test',model:'deepseek-fixture',maxTokens:16384,maxSteps:8,timeoutSeconds:60,temperature:0.1,reasoningEffort:'high'};
const call=(name='zotquery_evidence_context',args={},id='c')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const response=(content='',tools=[],extra={})=>({choices:[{message:{content,...(tools.length?{tool_calls:tools}:{}),reasoning_content:'synthetic-reasoning',...extra}}]});
function fixture(){
 const requests=[],calls=[],events=[];
 const state={queue:[],metadata:{data:[]},metadataRequests:0,ready:true,toolResult:()=>({text:'Source passage'}),result:id=>({sessionId:id,status:state.ready?'ready_for_synthesis':'reviewing',coverageGate:{synthesisAllowed:state.ready,blockers:state.ready?[]:['unreviewed']},facts:[]})};
 const names=['health','evidence_plan','evidence_research_start','evidence_sweep','evidence_context','evidence_review','evidence_promote_notes','evidence_finalize','evidence_session','evidence_next_actions','research_result','evidence_page_image','evidence_visual_observe','evidence_visual_list'];
 const box={URL,Services:{logins:{findLogins:()=>[]}},Zotero:{Prefs:{get:()=>undefined},HTTP:{request:async(_method,_url,options)=>{if(_method==='GET'){state.metadataRequests++;if(state.metadata instanceof Error)throw state.metadata;return {response:state.metadata};}const body=JSON.parse(options.body);requests.push(body);const next=state.queue.shift();assert.ok(next,'unexpected model request');if(next instanceof Error)throw next;return {response:typeof next==='function'?await next(body):next};}},
  ZotQueryResearch:{toolDefinitions:()=>names.map(n=>({name:'zotquery_'+n,description:n,inputSchema:{type:'object',properties:{}}})),callTool:async(name,args)=>{calls.push({name,args});if(name.endsWith('research_start')||name.endsWith('sweep'))return {sessionId:'S-new'};return state.toolResult(name,args);},researchResult:async id=>state.result(id)},ZotQueryOutputProfiles:{render:()=>({markdown:'# Separate audit'})}}};
 box._globalThis=box;vm.createContext(box);vm.runInContext(source,box);
 const api=box.Zotero.ZotQueryModelAgent;
 const run=opts=>api.runAgent({question:'Synthetic question',sessionId:'S',config:cfg,apiKey:'synthetic-key',onEvent:e=>events.push(e),...opts});
 return {api,state,requests,calls,events,run,zotero:box.Zotero};
}
const limited=(tokens,tools=[],input=2000)=>{
 const r=response('INCOMPLETE_NEVER_COMMIT',tools);r.choices[0].finish_reason='length';
 if(tokens!==null)r.usage={prompt_tokens:input,completion_tokens:tokens,completion_tokens_details:{reasoning_tokens:Math.max(0,tokens-10)}};
 return r;
};
const budgetError=(message,fields={})=>Object.assign(new Error('safe synthetic failure'),{status:400,xmlhttp:{response:{error:{message,...fields}}}});
test('explicit route budget rejection is corrected to the allowed maximum and retained on resume',async()=>{
 const f=fixture(),config={...cfg,maxTokensMode:'auto'};
 f.state.metadata={data:[{id:cfg.model,max_output_tokens:131072}]};
 f.state.queue=[budgetError('max_tokens must be <= 65536'),response('',[call()]),new Error('offline')];
 await assert.rejects(f.run({config}),e=>e.code==='NETWORK_ERROR');
 assert.deepEqual(f.requests.map(r=>r.max_tokens),[131072,65536,65536]);
 f.state.queue=[response('Ready'),response('Answer')];await f.run({config});
 assert.equal(f.requests.at(-1).max_tokens,65536);assert.equal(f.calls.length,1);
 assert.equal(f.events.filter(e=>e.type==='budget-corrected').length,1);
});
test('remaining context allowance is request-local, not a permanent model output limit',async()=>{
 const f=fixture(),config={...cfg,maxTokensMode:'auto'};
 f.state.metadata={data:[{id:cfg.model,max_output_tokens:100000,context_length:1000000}]};
 f.state.queue=[budgetError('Prompt plus max_tokens exceeds context; max_tokens must be <= 40000'),response('',[call()]),response('Ready'),response('Answer')];
 await f.run({config});assert.deepEqual(f.requests.map(r=>r.max_tokens),[100000,40000,100000,100000]);
});
test('budget correction never infers an output maximum from unrelated numbers and never loops indefinitely',async()=>{
 const f=fixture();
 for(const message of ['rate limited 429 retry after 60','invalid model 123456','maximum context length is 1000000','max_tokens invalid; received 999999'])assert.equal(f.api._rejectedBudget({},message),null);
 assert.equal(f.api._rejectedBudget({},'max_tokens must be between 1 and 65,536').limit,65536);
 assert.equal(f.api._rejectedBudget({},'maximum context length is 100000 tokens; messages resulted in 70000 tokens').limit,30000);
 f.state.metadata={data:[{id:cfg.model,max_output_tokens:131072}]};
 f.state.queue=[budgetError('max_tokens must be <= 65536'),budgetError('max_tokens must be <= 32768'),budgetError('max_tokens must be <= 16384')];
 await assert.rejects(f.run({config:{...cfg,maxTokensMode:'auto'}}),e=>e.code==='BUDGET_REJECTED');assert.equal(f.requests.length,3);
 const manual=fixture();manual.state.queue=[budgetError('max_tokens must be <= 8192')];await assert.rejects(manual.run(),e=>e.code==='BUDGET_REJECTED');assert.equal(manual.requests.length,1);
});
test('transmission-too-large recovery preserves session and requires source re-read; oversized response does not replay',async()=>{
 const f=fixture();f.state.queue=[Object.assign(new Error('payload too big'),{status:413}),response('',[call()]),response('Ready'),response('Answer')];
 await f.run({config:{...cfg,maxTokensMode:'auto'}});assert.equal(f.events.filter(e=>e.type==='context-recovery').length,1);
 assert.match(f.requests[1].messages.at(-1).content,/重新读取/);
 const tooLarge=fixture();tooLarge.state.queue=[Object.assign(new Error('response too big'),{code:'RESPONSE_TOO_LARGE'})];
 await assert.rejects(tooLarge.run({config:{...cfg,maxTokensMode:'auto'}}),e=>e.code==='RESPONSE_TOO_LARGE');assert.equal(tooLarge.requests.length,1);
});
test('a fifty-work note promotion gives bounded navigation while retaining the complete research result',async()=>{
 const f=fixture(),original='PRIVATE_SOURCE_PASSAGE_SHOULD_BE_READ_THROUGH_CONTEXT';
 const promoted=Array.from({length:50},(_,i)=>({workKey:'user:W'+i,noteKey:'N'+i,verification:{status:'located',registeredPositions:1,text:original}}));
 f.state.toolResult=name=>name.endsWith('promote_notes')?{sessionId:'S',surveyId:'V',pagination:{offset:0,limit:50,nextOffset:50},promoted,missing:[],failed:[],next:'Continue at 50'}:{text:'Source'};
 f.state.queue=[response('',[call('zotquery_evidence_promote_notes',{sessionId:'S',offset:0,limit:50})]),response('Ready'),response('Answer')];
 await f.run();
 const receipt=f.requests[1].messages.find(m=>m.role==='tool'&&m.tool_call_id==='c');
 const navigation=JSON.parse(receipt.content);
 assert.equal(navigation.promotedCount,50);assert.equal(navigation.pagination.nextOffset,50);
 assert.equal(navigation.promotedPreview.length,8);assert.equal(navigation.promotedPreviewTruncated,true);
 assert.doesNotMatch(receipt.content,/PRIVATE_SOURCE_PASSAGE/);
 assert.equal(promoted.length,50);assert.ok(f.events.some(e=>e.type==='context-navigation'));
});
test('image tool receipts stay paired; actual image is attached in the following multimodal message',async()=>{
 const f=fixture();f.state.toolResult=name=>name.endsWith('page_image')?{visualId:'V',sessionId:'S',positionId:'P',pageNumber:2,crop:{x:0,y:0,width:1,height:1},images:[{mimeType:'image/png',data:'IMAGE_BYTES'}]}:{text:'Source'};
 f.state.queue=[response('',[call('zotquery_evidence_page_image',{sessionId:'S',positionId:'P',pageNumber:2},'image'),call(undefined,{},'text')]),response('Ready'),response('Answer from figure')];
 await f.run({config:{...cfg,visionEnabled:true}});
 const msgs=f.requests[1].messages,index=msgs.findIndex(m=>m.tool_call_id==='image');assert.equal(msgs[index+1].tool_call_id,'text');assert.equal(msgs[index+2].content[1].type,'image_url');assert.match(msgs[index+2].content[1].image_url.url,/IMAGE_BYTES/);assert.doesNotMatch(msgs[index].content,/IMAGE_BYTES/);
 assert.ok(f.events.some(e=>e.type==='visual-read'));
});
test('disabled visual permission removes image tools and old cached images on resume',async()=>{
 const f=fixture();f.state.queue=[response('Ready'),response('Answer')];await f.run();assert.ok(f.requests.every(r=>!r.tools.some(t=>t.function.name==='zotquery_evidence_page_image')));
});
test('all API adapters send actual image parts, not textual JSON image paths',async()=>{
 for(const [provider,format] of [['deepseek','openai'],['anthropic','anthropic'],['gemini','gemini'],['ollama','ollama']]){
  const f=fixture();f.state.queue=[provider==='anthropic'?{content:[{type:'text',text:'ok'}]}:provider==='gemini'?{candidates:[{content:{parts:[{text:'ok'}]}}]}:response('ok')];
  await f.api._requestTurn({...cfg,provider,format,apiKey:'test'},[{role:'user',content:'Image',images:[{mimeType:'image/png',data:'IMAGE_BYTES'}]}],[]);
  const b=f.requests[0];if(format==='openai')assert.equal(b.messages[0].content[1].image_url.url,'data:image/png;base64,IMAGE_BYTES');
  else if(format==='anthropic')assert.equal(b.messages[0].content[1].source.data,'IMAGE_BYTES');
  else if(format==='gemini')assert.equal(b.contents[0].parts[1].inlineData.data,'IMAGE_BYTES');
  else assert.equal(b.messages[0].images[0],'IMAGE_BYTES');
 }
});
test('writer refreshes real finalize state even when model forgot the tool; blocked evidence stays blocked',async()=>{
 const f=fixture();let checks=0;f.zotero.ZotQueryResearch.finalize=async()=>{checks++;};f.state.queue=[response('Ready'),response('Answer')];await f.run();assert.ok(checks>=3);
});
test('auto resume retains increased budget after failure; explicit lower budget resets it',async()=>{
 const f=fixture(),config={...cfg,maxTokens:8192,maxTokensMode:'auto'};
 f.state.queue=[limited(8192),response('',[call()]),new Error('network down')];
 await assert.rejects(f.run({config}),e=>e.code==='NETWORK_ERROR');
 f.state.queue=[response('Ready'),response('Answer')];await f.run({config});
 assert.deepEqual(f.requests.map(r=>r.max_tokens),[undefined,16384,16384,16384,16384]);
 assert.ok(f.events.some(e=>e.type==='budget-resume'));
 f.state.queue=[response('Ready'),response('Answer')];await f.run({config:{...config,maxTokens:4096}});
 assert.equal(f.requests.at(-2).max_tokens,undefined);
 assert.ok(!f.requests.at(-2).messages.some(m=>m.role==='tool'));
});
test('30 research and six tool-writing rounds always leave a separate final answer request',async()=>{
 const f=fixture();f.state.ready=false;
 f.state.queue=Array.from({length:36},(_,i)=>response('',[call('zotquery_evidence_context',{positionId:'P'+i},'c'+i)]));
 f.state.queue.push(body=>{assert.equal(body.tool_choice,'none');assert.equal(body.reasoning_effort,'max');assert.ok(body.messages.some(m=>m.role==='tool'&&m.tool_call_id==='c35'));assert.ok(body.messages.some(m=>m.reasoning_content==='synthetic-reasoning'));assert.match(body.messages[0].content,/输出模板测试/);return response('Evidence-supported partial answer; unresolved details remain.');});
 const r=await f.run({config:{...cfg,maxSteps:30,reasoningEffort:'max'},templateName:'synthetic.md',templateMarkdown:'# 输出模板测试'});
 assert.equal(f.requests.length,37);assert.equal(f.calls.length,36);assert.equal(r.answerKind,'limited-answer');assert.match(r.markdown,/Evidence-supported partial answer/);assert.doesNotMatch(r.markdown,/# Separate audit/);
 assert.equal(f.events.filter(e=>e.type==='final-writing').length,1);assert.ok(f.events.some(e=>e.phase==='final'&&e.toolCallCount===0));
});
test('final request failure resumes final directly, preserves last tool response and manual budget',async()=>{
 const f=fixture();f.state.queue=[response('Ready'),...Array.from({length:6},()=>response('',[call()])),new Error('Request timed out')];
 await assert.rejects(f.run(),e=>e.code==='REQUEST_TIMEOUT');const before=f.requests.length;
 f.state.queue=[body=>{assert.equal(body.tool_choice,'none');assert.equal(body.max_tokens,cfg.maxTokens);return response('Recovered final answer');}];
 const r=await f.run();assert.match(r.markdown,/Recovered final answer/);assert.equal(f.requests.length,before+1);
 assert.equal(f.events.filter(e=>e.type==='model').length,1);assert.equal(f.calls.length,6);
});
test('partially completed writer resumes at remaining writing rounds, not a new research loop',async()=>{
 const f=fixture();f.state.queue=[response('Ready'),response('',[call()]),response('',[call()]),new Error('offline')];
 await assert.rejects(f.run());const before=f.requests.length;
 f.state.queue=[response('Direct recovered answer')];const r=await f.run();
 assert.equal(f.requests.length,before+1);assert.equal(f.requests.at(-1).tool_choice,'auto');assert.match(r.markdown,/Direct recovered answer/);
 assert.equal(f.events.filter(e=>e.type==='model').length,1);
 // An intentional new run after a completed answer starts research normally.
 f.state.queue=[response('Ready'),response('Fresh answer')];await f.run();assert.equal(f.events.filter(e=>e.type==='model').length,2);
});
test('provider ignoring final-only tool policy fails safely and never executes the extra call',async()=>{
 const f=fixture();f.state.queue=[response('Ready'),...Array.from({length:7},()=>response('',[call()]))];
 await assert.rejects(f.run(),e=>e.code==='FINAL_TOOL_CALL');assert.equal(f.calls.length,6);
 f.state.queue=[response('Safe final')];const r=await f.run();assert.match(r.markdown,/Safe final/);assert.equal(f.calls.length,6);
});
test('truncated final is never saved and budget retry stays in final-only mode',async()=>{
 const f=fixture();f.state.queue=[response('Ready'),...Array.from({length:6},()=>response('',[call()])),limited(16384,[call()]),response('Complete final')];
 const r=await f.run({config:{...cfg,maxTokensMode:'auto'}});
 assert.equal(f.calls.length,6);assert.equal(f.requests.at(-1).max_tokens,32768);assert.ok(f.requests.slice(-2).every(x=>x.tool_choice==='none'));
 assert.doesNotMatch(r.markdown,/INCOMPLETE/);assert.match(r.markdown,/Complete final/);
});
test('final context overflow pauses for source recovery; resume does not loop through research again',async()=>{
 const f=fixture(),config={...cfg,maxTokensMode:'auto'};
 f.state.queue=[response('Ready'),...Array.from({length:6},()=>response('',[call()])),new Error('maximum context length exceeded')];
 await assert.rejects(f.run({config}),e=>e.code==='CONTEXT_LIMIT');
 f.state.queue=[response('',[call()]),response('Reread final answer')];const r=await f.run({config});
 assert.match(r.markdown,/Reread final answer/);assert.equal(f.events.filter(e=>e.type==='model').length,1);assert.equal(f.calls.length,7);
});
test('final synthesis does not discard freshly read source due to proactive context target',async()=>{
 const f=fixture();const last=response('',[call('zotquery_evidence_context',{},'last')]);last.usage={prompt_tokens:200000,completion_tokens:100};
 f.state.queue=[response('Ready'),...Array.from({length:5},()=>response('',[call()])),last,response('Final')];
 await f.run();assert.equal(f.events.filter(e=>e.type==='context-recovery').length,0);assert.ok(f.requests.at(-1).messages.some(m=>m.tool_call_id==='last'));
});
test('all adapters disable tools for final synthesis without changing reasoning intensity',async()=>{
 const f=fixture();
 const cases=[['openai','openai',response('A'),b=>assert.equal(b.tool_choice,'none')],['deepseek','openai',response('A'),b=>{assert.equal(b.tool_choice,'none');assert.equal(b.thinking.type,'enabled');assert.equal(b.reasoning_effort,'high');}],['anthropic','anthropic',{content:[{type:'text',text:'A'}]},b=>assert.equal(b.tool_choice.type,'none')],['gemini','gemini',{candidates:[{content:{parts:[{text:'A'}]}}]},b=>assert.equal(b.toolConfig.functionCallingConfig.mode,'NONE')],['ollama','ollama',{message:{content:'A'}},b=>assert.equal(b.tools,undefined)]];
 for(const [provider,format,res,check] of cases){f.state.queue=[res];await f.api._requestTurn({...cfg,provider,format},[{role:'user',content:'Q'}],f.api.toolDefinitions(),true);check(f.requests.at(-1));}
});
test('cold writer without source re-read can only produce explicitly unverified final output',async()=>{
 const f=fixture();
 // Configuration binding is obtained through the public save path in the SQL
 // tests; here a matching in-memory writer is restored after real context loss.
 f.state.queue=[response('Ready'),...Array.from({length:6},()=>response('',[call()])),new Error('maximum context length exceeded')];
 const config={...cfg,maxTokensMode:'auto'};await assert.rejects(f.run({config}),e=>e.code==='CONTEXT_LIMIT');
 f.state.queue=[...Array.from({length:6},()=>response('UNSUPPORTED_DRAFT_DO_NOT_KEEP')),body=>{assert.equal(body.tool_choice,'none');assert.match(body.messages[0].content,/不得输出具体事实结论/);assert.ok(!JSON.stringify(body).includes('UNSUPPORTED_DRAFT_DO_NOT_KEEP'));return response('当前无法确认：尚缺原文回读，需核对相应来源。');}];
 const r=await f.run({config});assert.equal(r.synthesisAllowed,false);assert.equal(r.answerKind,'limited-answer');assert.ok(r.blockers.includes('source_context_not_reread'));
 assert.equal(f.events.filter(e=>e.type==='model').length,1);assert.doesNotMatch(r.markdown,/UNSUPPORTED_DRAFT/);
});
test('all-reasoning exhaustion increases fourfold and preserves budget even if no attempt completes',async()=>{
 const f=fixture(),config={...cfg,maxTokens:8192,maxTokensMode:'auto',reasoningEffort:'max'};
 const exhausted=n=>{const r=limited(n);r.usage.completion_tokens_details.reasoning_tokens=n;return r;};
 f.state.queue=[exhausted(8192),exhausted(32768),exhausted(131072)];
 await assert.rejects(f.run({config}),e=>e.code==='OUTPUT_LIMIT');
 assert.deepEqual(f.requests.map(r=>r.max_tokens),[undefined,32768,131072]);
 assert.equal(f.calls.length,0);
 f.state.queue=[response('Ready'),response('Answer')];await f.run({config});
 assert.equal(f.requests[3].max_tokens,131072);
 assert.ok(!JSON.stringify(f.requests[3]).includes('INCOMPLETE_NEVER_COMMIT'));
});
test('measured large input compacts complete protocol and re-reads sources before answering',async()=>{
 const f=fixture();f.state.metadata={data:[{id:cfg.model,context_length:1000000}]};
 const big=response('',[call()]);big.usage={prompt_tokens:493237,completion_tokens:1200};
 f.state.queue=[big,response('',[call('zotquery_evidence_context',{positionId:'P'},'new')]),response('Ready'),response('Answer')];
 await f.run({config:{...cfg,maxTokensMode:'auto'}});
 assert.equal(f.calls.length,2);assert.equal(f.events.filter(e=>e.type==='context-recovery').length,1);
 assert.ok(!f.requests[1].messages.some(m=>m.role==='assistant'||m.role==='tool'));
 assert.match(f.requests[1].messages.at(-1).content,/必须用工具重新读取/);
 assert.equal(f.requests[2].messages.find(m=>m.role==='assistant').reasoning_content,'synthetic-reasoning');
 assert.equal(f.requests[2].messages.find(m=>m.role==='tool').tool_call_id,'new');
});
test('large-input truncation chain resumes without replaying small budgets or broken tool groups',async()=>{
 const f=fixture(),config={...cfg,maxTokens:8192,maxTokensMode:'auto',reasoningEffort:'max'};
 const big=response('',[call()]);big.usage={prompt_tokens:493237,completion_tokens:700};
 // First completed tool exchange is retained on transport failure; next run
 // rebuilds the oversized conversation before sending another HTTP request.
 f.state.queue=[big,new Error('offline')];
 await assert.rejects(f.run({config}));
 // Recovery had already removed the oversized history before the failed HTTP.
 const r=limited(8192,[],10000);r.usage.completion_tokens_details.reasoning_tokens=8192;
 f.state.queue=[r,response('',[call()]),new Error('offline')];await assert.rejects(f.run({config}));
 f.state.queue=[response('Ready'),response('Answer')];await f.run({config});
 assert.equal(f.requests.at(-2).max_tokens,32768);
 assert.ok(f.requests.at(-2).messages.some(m=>m.role==='tool'));
 assert.ok(!JSON.stringify(f.requests.at(-2)).includes('INCOMPLETE_NEVER_COMMIT'));
});
test('transport failures checkpoint status and timings without saving raw provider errors',async()=>{
 for(const [status,message,code] of [[401,'bad key','AUTH_FAILED'],['429','quota','RATE_LIMITED'],[503,'upstream','SERVER_ERROR'],[400,'unsupported parameter','PROVIDER_REJECTED'],[0,'Request timed out','REQUEST_TIMEOUT'],[0,'offline','NETWORK_ERROR']]){
  const f=fixture(),snapshots=[];let failure;
  f.zotero.ZotQueryHistory={begin:async()=> 'R',checkpoint:async(_id,x)=>snapshots.push(JSON.parse(JSON.stringify(x))),fail:async(_id,x)=>{failure=x;}};
  const e=new Error(message+' PRIVATE_ERROR_BODY');e.status=status;f.state.queue=[e];
  await assert.rejects(f.run(),x=>x.code===code);
  assert.equal(f.requests.length,1);assert.equal(snapshots[0].runtime.status,'waiting');
  assert.equal(failure.diagnostics[0].kind,code);assert.equal(failure.diagnostics[0].httpStatus,Number(status)||null);
  assert.equal(failure.diagnostics[0].timeoutSeconds,60);assert.ok(failure.diagnostics[0].elapsedMs>=0);
  assert.ok(!JSON.stringify(failure).includes('PRIVATE_ERROR_BODY'));
 }
});
test('checkpoint failure warns once without losing an otherwise complete answer',async()=>{
 const f=fixture();f.zotero.ZotQueryHistory={begin:async()=> 'R',checkpoint:async()=>{throw Error('disk full');},finish:async()=>{}};
 f.state.queue=[response('Ready'),response('Answer')];const r=await f.run();assert.match(r.markdown,/Answer/);
 assert.equal(f.events.filter(e=>e.type==='history-warning').length,1);
});
test('empty provider response fails once rather than spending the research loop on empty replies',async()=>{
 const f=fixture();f.state.queue=[{}];await assert.rejects(f.run(),e=>e.code==='UNSUPPORTED_RESPONSE');assert.equal(f.requests.length,1);
});

test('complete reasoning-only response continues once at the same budget, preserving receipts; repeated emptiness stops',async()=>{
 const empty=()=>({choices:[{message:{content:null,reasoning_content:'PRIVATE_REASONING'},finish_reason:'stop'}],usage:{prompt_tokens:1234,completion_tokens:32,completion_tokens_details:{reasoning_tokens:32}}});
 const f=fixture();f.state.queue=[response('',[call()]),empty(),response('Ready'),response('Actual answer')];
 const answer=await f.run();assert.match(answer.markdown,/Actual answer/);assert.doesNotMatch(answer.markdown,/PRIVATE_REASONING/);
 assert.equal(f.calls.length,1);assert.ok(f.requests.every(r=>r.max_tokens===cfg.maxTokens));
 assert.ok(f.requests[2].messages.some(m=>m.role==='tool'));
 assert.ok(f.requests[2].messages.some(m=>m.reasoning_content==='PRIVATE_REASONING'));
 assert.ok(f.events.some(e=>e.type==='response-diagnostic' && /1234.*32.*32/.test(e.label)));
 assert.doesNotMatch(JSON.stringify(f.events),/PRIVATE_REASONING/);
 const repeated=fixture();repeated.state.queue=[empty(),empty()];await assert.rejects(repeated.run(),e=>e.code==='REASONING_ONLY');assert.equal(repeated.requests.length,2);
 const blank=fixture();blank.state.queue=[{choices:[{message:{content:''},finish_reason:'stop'}]}];await assert.rejects(blank.run(),e=>e.code==='EMPTY_RESPONSE');assert.equal(blank.requests.length,1);
});

test('structured text is rendered, refusals and unknown content are never converted to answers',async()=>{
 const f=fixture();f.state.queue=[response('Ready'),response([{type:'text',text:'# Answer'},{type:'output_text',text:' from blocks'}])];
 assert.match((await f.run()).markdown,/# Answer from blocks/);
 for(const [content,extra,code] of [[{unexpected:'body'},{},'UNSUPPORTED_RESPONSE'],['',{refusal:'Not allowed'},'MODEL_REFUSAL']]){
  const x=fixture();x.state.queue=[response(content,[],extra)];await assert.rejects(x.run(),e=>e.code===code);assert.equal(x.requests.length,1);
 }
});

test('audit rendering failure cannot discard or prevent persistence of a completed model answer',async()=>{
 const f=fixture();let stored;
 f.zotero.ZotQueryOutputProfiles.render=()=>{throw Error('stale audit profile');};
 f.zotero.ZotQueryHistory={begin:async()=> 'R',checkpoint:async()=>{},finish:async(_id,value)=>{stored=value;},fail:async()=>{}};
 f.state.queue=[response('Ready'),response('Actual answer')];
 const result=await f.run();assert.match(result.markdown,/Actual answer/);assert.equal(result.deterministicAuditMarkdown,'');
 assert.ok(f.events.some(e=>e.type==='audit-warning'));
 assert.match(stored.markdown,/Actual answer/);assert.equal(result.historySaved,true);
});
test('empty source page after context recovery never counts as re-reading',async()=>{
 const f=fixture();f.state.toolResult=()=>({chunks:[],text:'',complete:true});
 f.state.queue=[new Error('maximum context length exceeded'),response('',[call()]),response('Unsupported')];
 await assert.rejects(f.run({config:{...cfg,maxTokensMode:'auto'}}),e=>e.code==='CONTEXT_REREAD_REQUIRED');
});
test('complete reasoning levels map DeepSeek through compatible gateways; max remains max',async()=>{
 const f=fixture();
 for(const [effort,expected] of Object.entries({minimal:'low',low:'low',medium:'high',high:'high',xhigh:'high',max:'max'})){
  f.state.queue=[response('OK')];await f.api._requestTurn({...cfg,provider:'openai_compatible',model:'deepseek/deepseek-v4.1-flash',reasoningEffort:effort},[],[]);
  assert.equal(f.requests.at(-1).reasoning_effort,expected);assert.equal(f.requests.at(-1).thinking.type,'enabled');
 }
 f.state.queue=[response('OK')];await f.api._requestTurn({...cfg,provider:'openai_compatible',model:'deepseek/deepseek-v4.1-flash',reasoningEffort:'none'},[],[]);
 assert.equal(f.requests.at(-1).thinking.type,'disabled');assert.equal(f.requests.at(-1).reasoning_effort,undefined);
});
test('model capability lookup uses exact ID and never treats context as output cap',async()=>{
 const f=fixture();const caps=f.api._capabilityRecord({data:[{id:cfg.model,context_length:1000000},{id:'other',max_output_tokens:8192}]},cfg.model);
 assert.equal(caps.output,null);assert.equal(caps.context,1000000);
 assert.equal(f.api._capabilityRecord({data:[{id:cfg.model,limit:{output:99000,context:1000000}}]},cfg.model).output,99000);
});
test('unknown auto output cap delegates to server; manual budget has no former local ceiling',async()=>{
 const f=fixture();f.state.queue=[response('Ready'),response('Final')];await f.run({config:{...cfg,maxTokensMode:'auto',maxTokens:2000000}});
 assert.ok(f.requests.every(r=>r.max_tokens===undefined));
 const manual=fixture();manual.state.queue=[response('Ready'),response('Final')];await manual.run({config:{...cfg,maxTokensMode:'manual',maxTokens:2000000}});
 assert.ok(manual.requests.every(r=>r.max_tokens===2000000));
});
test('unknown cap retries can cross former ceiling but still stop after two increases',async()=>{
 const f=fixture();f.state.queue=[limited(262144),limited(524288),limited(1048576)];
 await assert.rejects(f.run({config:{...cfg,maxTokensMode:'auto',maxTokens:262144}}),/token 上限/);
 assert.deepEqual(f.requests.map(r=>r.max_tokens),[undefined,524288,1048576]);assert.equal(f.requests.length,3);
});
test('removing client cap does not override a published provider maximum',async()=>{
 const f=fixture();f.state.metadata={data:[{id:cfg.model,max_output_tokens:500000}]};f.state.queue=[limited(500000)];
 await assert.rejects(f.run({config:{...cfg,maxTokensMode:'auto',maxTokens:2000000}}),/token 上限/);assert.equal(f.requests[0].max_tokens,500000);assert.equal(f.requests.length,1);
});
test('auto selects published output maximum, keeps manual preference intact, no duplicate generation',async()=>{
 const f=fixture();f.state.metadata={data:[{id:cfg.model,context_length:1000000,max_output_tokens:100000}]};
 f.state.queue=[response('Ready'),response('Final')];await f.run({config:{...cfg,maxTokensMode:'auto'}});
 assert.equal(f.state.metadataRequests,1);assert.equal(f.requests[0].max_tokens,100000);assert.equal(f.requests.length,2);
});
test('unknown cap adapts at most twice; truncated tool calls never execute or enter transcript',async()=>{
 const f=fixture();f.state.metadata={data:[{id:cfg.model,context_length:1000000}]};
 f.state.queue=[limited(65536,[call()]),limited(131072,[call()]),limited(262144,[call()])];
 await assert.rejects(f.run({config:{...cfg,maxTokensMode:'auto',maxTokens:65536}}),/token 上限/);
 assert.deepEqual(f.requests.map(r=>r.max_tokens),[undefined,131072,262144]);assert.equal(f.calls.length,0);
 assert.ok(f.requests.every(r=>!JSON.stringify(r.messages).includes('INCOMPLETE_NEVER_COMMIT')));
 assert.equal(f.events.filter(e=>e.type==='budget-retry').length,2);
});
test('successful budget retry writes one complete answer and preserves complete protocol',async()=>{
 const f=fixture();f.state.queue=[limited(16384),response('',[call()]),response('Ready'),response('Final')];
 const r=await f.run({config:{...cfg,maxTokensMode:'auto'}});assert.match(r.markdown,/Final/);assert.doesNotMatch(r.markdown,/INCOMPLETE/);assert.equal(f.calls.length,1);assert.equal(f.requests[1].max_tokens,32768);
});
test('provider truncating well below requested budget does not trigger pointless growth',async()=>{
 const f=fixture();f.state.metadata={data:[{id:cfg.model,max_output_tokens:65536}]};f.state.queue=[limited(8192)];await assert.rejects(f.run({config:{...cfg,maxTokensMode:'auto',maxTokens:65536}}),/请求预算之前截断/);
 assert.equal(f.requests.length,1);assert.equal(f.events.at(-2).kind,'LIMIT_UNKNOWN');
});
test('missing usage allows only one cautious retry; metadata failure is not fatal',async()=>{
 const f=fixture();f.state.metadata=new Error('offline metadata');f.state.queue=[limited(null),limited(null)];
 await assert.rejects(f.run({config:{...cfg,maxTokensMode:'auto'}}),/实际输入 未知/);assert.equal(f.requests.length,2);
});
test('manual budget remains exact and does not probe metadata or retry',async()=>{
 const f=fixture();f.state.queue=[limited(65536)];await assert.rejects(f.run({config:{...cfg,maxTokensMode:'manual',maxTokens:65536}}),/输出耗尽预算/);
 assert.equal(f.requests[0].max_tokens,65536);assert.equal(f.requests.length,1);assert.equal(f.state.metadataRequests,0);
});
test('auto output cap is not reduced by a character-based input estimate',async()=>{
 const f=fixture();f.state.metadata={data:[{id:cfg.model,context_length:50000,max_output_tokens:50000}]};f.state.queue=[response('Ready'),response('Final')];
 await f.run({config:{...cfg,maxTokensMode:'auto'}});assert.ok(f.requests.every(r=>r.max_tokens===50000));
});
test('catalog context metadata cannot locally reject a provider-accepted request',async()=>{
 const f=fixture();f.state.metadata={data:[{id:cfg.model,context_length:128,max_output_tokens:128}]};
 f.state.queue=[response('Ready'),response('Final')];await f.run({config:{...cfg,maxTokensMode:'auto'}});assert.equal(f.requests.length,2);assert.equal(f.events.filter(e=>e.type==='context-recovery').length,0);
});
test('large valid raw source is sent intact even when chars times two exceeds catalog context',async()=>{
 const f=fixture();f.state.metadata={data:[{id:cfg.model,context_length:1000000}]};
 const passage='BOUNDARY_START '+ 'English '.repeat(90000)+' BOUNDARY_END';f.state.toolResult=()=>({text:passage});
 f.state.queue=[response('',[call()]),response('Ready'),response('Final')];await f.run({config:{...cfg,maxTokensMode:'auto'}});
 const source=f.requests[1].messages.find(m=>m.role==='tool');assert.equal(JSON.parse(source.content).text,passage);assert.equal(f.events.filter(e=>e.type==='context-recovery').length,0);
});
test('large persisted ledger is bounded in cold restore, recovery and writer; evidence data stays intact',async()=>{
 const f=fixture();const state=f.state.result('S');const assessment='HUGE_ASSESSMENT'.repeat(80000);
 const slots=Array.from({length:20},(_,i)=>({id:'slot-'+i,type:'text',assessments:[{sourceMeaning:assessment}]}));
 const facts=Array.from({length:20},(_,i)=>({factId:'F'+i,positionId:'P'+i,sourceQuote:'Source '+i}));
 const full={...state,evidenceSlots:slots,coverage:{reviewUnits:20,slotClosure:{slots}},facts,nextActions:{slots,readOrReview:[{positionId:'P0',nextTool:'zotquery_evidence_context'}]}};
 f.state.result=()=>full;
 f.state.queue=[new Error('maximum context length exceeded'),response('',[call()]),response('Ready'),response('Final')];
 await f.run({config:{...cfg,maxTokensMode:'auto'}});
 for(const r of f.requests){assert.ok(JSON.stringify(r.messages).length<30000);assert.ok(!JSON.stringify(r.messages).includes('HUGE_ASSESSMENT'));}
 assert.equal(full.coverage.slotClosure.slots[0].assessments[0].sourceMeaning,assessment);
 const restored=f.requests[1].messages.at(-1).content;assert.match(restored,/navigationOnly/);assert.match(restored,/"truncated":true/);assert.match(restored,/"total":20/);assert.match(restored,/P0/);
});
test('cold large-summary restore cannot answer without reading sources',async()=>{
 const f=fixture();const original=f.state.result;f.state.result=id=>({...original(id),facts:[{positionId:'P',sourceQuote:'q'.repeat(100000)}]});
 f.state.queue=[response('Unsupported answer')];await assert.rejects(f.run(),/未重新读取原文/);
});
test('oversized ledger tool gets explicitly marked navigation; original source tool remains uncut',async()=>{
 const f=fixture();const huge='x'.repeat(100000);f.state.toolResult=name=>name.endsWith('context')?{text:huge}:{slots:[{id:'SLOT',assessments:[huge]}],readOrReview:[{positionId:'P'}]};
 f.state.queue=[response('',[call('zotquery_evidence_next_actions',{sessionId:'S'},'a'),call('zotquery_evidence_context',{positionId:'P'},'b')]),response('Ready'),response('Final')];
 await f.run();const results=f.requests[1].messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
 assert.equal(results[0].navigationOnly,true);assert.equal(results[0].truncated,true);assert.equal(results[1].text,huge);
});
test('usage normalization counts Gemini thought tokens in total output and distinguishes context limit',()=>{
 const f=fixture();const usage=f.api._usageOf({usageMetadata:{promptTokenCount:900,candidatesTokenCount:50,thoughtsTokenCount:50}});
 assert.equal(usage.output,100);assert.equal(usage.reasoning,50);assert.equal(f.api._truncationKind({usage},200,{context:1000}),'CONTEXT_LIMIT');
 assert.equal(f.api._truncationKind({usage:{input:1000,output:64000}},65536,{context:1000000}),'OUTPUT_LIMIT');
});
test('context error restores same persisted session and requires a new source read',async()=>{
 const f=fixture();const error=new Error('maximum context length exceeded');
 f.state.queue=[response('',[call()]),error,response('',[call()]),response('Ready'),response('Final')];
 const r=await f.run({config:{...cfg,maxTokensMode:'auto'}});assert.equal(r.sessionId,'S');assert.equal(f.calls.length,2);
 const recovered=f.requests[2].messages;assert.ok(recovered.some(m=>m.content.includes('此前完整工具对话已移出')));assert.ok(!recovered.some(m=>m.role==='tool'));
 assert.equal(f.events.filter(e=>e.type==='context-recovery').length,1);
});
test('context recovery cannot silently accept an answer without re-reading; retry guard survives resume',async()=>{
 const f=fixture();f.state.queue=[new Error('maximum context length exceeded'),response('Unsupported answer')];
 await assert.rejects(f.run({config:{...cfg,maxTokensMode:'auto'}}),/未重新读取原文/);
 f.state.queue=[response('Still unsupported')];await assert.rejects(f.run({config:{...cfg,maxTokensMode:'auto'}}),/未重新读取原文/);
});
test('context HTTP retries are bounded to one restoration per run',async()=>{
 const f=fixture();f.state.queue=[new Error('maximum context length exceeded'),new Error('maximum context length exceeded')];
 await assert.rejects(f.run({config:{...cfg,maxTokensMode:'auto'}}),/输出模型请求失败/);assert.equal(f.requests.length,2);
});
test('current Claude adaptive and Gemini 3 level APIs receive appropriate maximum parameters',async()=>{
 const f=fixture();f.state.queue=[{content:[],stop_reason:'end_turn'}];
 await f.api._requestTurn({...cfg,provider:'anthropic',format:'anthropic',model:'claude-opus-4-6',reasoningEffort:'max'},[],[]);
 assert.equal(f.requests.at(-1).thinking.type,'adaptive');assert.equal(f.requests.at(-1).output_config.effort,'max');assert.equal(f.requests.at(-1).temperature,undefined);
 f.state.queue=[{candidates:[{content:{parts:[]},finishReason:'STOP'}]}];
 await f.api._requestTurn({...cfg,provider:'gemini',format:'gemini',model:'gemini-3.1-pro-preview',reasoningEffort:'max'},[],[]);
 assert.equal(f.requests.at(-1).generationConfig.thinkingConfig.thinkingLevel,'high');assert.equal(f.requests.at(-1).generationConfig.thinkingConfig.thinkingBudget,undefined);
});

test('DeepSeek effort mapping and thinking switch are sent; auto does not override defaults',async()=>{
 const f=fixture();
 for(const effort of ['auto','none','low','medium','high']){
  f.state.queue=[response('OK')];await f.api._requestTurn({...cfg,reasoningEffort:effort},[{role:'user',content:'Q'}],[]);
  const body=f.requests.at(-1);
  if(effort==='auto'){assert.ok(!body.thinking&&!body.reasoning_effort);continue;}
  assert.equal(body.thinking.type,effort==='none'?'disabled':'enabled');
  assert.equal(body.reasoning_effort,effort==='none'?undefined:effort==='low'?'low':'high');
 }
});
test('all 9 parallel calls receive results and DeepSeek reasoning survives into writer',async()=>{
 const f=fixture();f.state.queue=[response('',Array.from({length:9},(_,i)=>call(undefined,{positionId:'P'+i},String(i)))),response('Research ready'),response('Final answer')];
 await f.run();assert.equal(f.calls.length,9);
 const next=f.requests[1];assert.equal(next.messages.filter(m=>m.role==='tool').length,9);
 assert.equal(next.messages.find(m=>m.tool_calls).reasoning_content,'synthetic-reasoning');
 const writing=f.requests[2];assert.ok(writing.tools.length);
 assert.ok(writing.messages.some(m=>m.content==='Research ready'&&m.reasoning_content==='synthetic-reasoning'));
});
test('30 long tool results, including >90000 character single result, survive uncut',async()=>{
 const f=fixture();f.state.toolResult=(_name,args)=>({text:`BEGIN${args.positionId}|`+'x'.repeat(args.positionId==='0'?95000:13000)+`|END${args.positionId}`});
 f.state.queue=[response('',Array.from({length:30},(_,i)=>call(undefined,{positionId:String(i)},String(i)))),response('Ready'),response('Answer')];
 await f.run();const toolMessages=f.requests.at(-1).messages.filter(m=>m.role==='tool');assert.equal(toolMessages.length,30);
 for(let i=0;i<30;i++)assert.ok(JSON.parse(toolMessages[i].content).text.endsWith('|END'+i));
 assert.ok(toolMessages[0].content.length>90000);
});
test('unready research continues beyond two nudges up to configured budget',async()=>{
 const f=fixture();f.state.ready=false;
 f.state.queue=[response('',[call()]),...Array.from({length:7},()=>response('Need to read more')),response('Clearly limited answer')];
 const result=await f.run();assert.equal(f.events.filter(e=>e.type==='model').length,8);
 assert.equal(f.events.filter(e=>e.type==='continue').length,6);assert.equal(result.blocked,true);
 assert.match(result.markdown,/核验状态：未完成/);
});
test('partial answer policy is generic, resists template gate suppression and preserves actual gate',async()=>{
 const f=fixture();f.state.ready=false;
 f.state.queue=[response('Need facts'),response('Need facts'),response('Source reports the mapped interval; full sequence remains unconfirmed.')];
 const result=await f.run({config:{...cfg,maxSteps:1},templateMarkdown:'## Answer\n门禁未过不得主体综合'});
 const prompt=f.requests.at(-1).messages[0].content;
 assert.match(prompt,/先逐个子问题/);assert.match(prompt,/不自动否定原文数值/);assert.match(prompt,/模板控制标题和排版/);
 assert.doesNotMatch(prompt,/p110|1050|kα12/);
 assert.equal(result.synthesisAllowed,false);assert.match(result.markdown,/mapped interval/);assert.match(result.markdown,/未完成（全流程）/);
});
test('writer can perform another read then re-evaluates persisted gate',async()=>{
 const f=fixture();f.state.queue=[response('',[call()]),response('Ready'),response('',[call('zotquery_evidence_review',{positionId:'P'},'write-read')]),response('Limited answer')];
 f.state.toolResult=name=>{if(name.endsWith('review'))f.state.ready=false;return {text:'New contradictory passage'};};
 const result=await f.run();assert.equal(result.blocked,true);assert.match(result.markdown,/核验状态：未完成/);
 assert.match(f.requests.at(-1).messages[0].content,/尚未通过/);
});
test('plan required before start, query plan flows into new session, UI options retained',async()=>{
 const f=fixture();f.state.queue=[response('',[call('zotquery_evidence_research_start',{},'early')]),response('',[
  call('zotquery_evidence_plan',{mustGroups:[{aliases:['ExactToken']}],question:'model rewriting'},'plan'),call('zotquery_evidence_research_start',{readingPolicy:'ALL_POSITIONS'},'start')]),response('Ready'),response('Answer')];
 const result=await f.run({sessionId:null,readingPolicy:'QUERY_EXHAUSTIVE',includeSemantic:false});
 assert.equal(result.sessionId,'S-new');assert.equal(f.calls.filter(c=>c.name.endsWith('research_start')).length,1);
 const args=f.calls.find(c=>c.name.endsWith('research_start')).args;
 assert.equal(args.mustGroups[0].aliases[0],'ExactToken');assert.equal(args.question,'Synthetic question');
 assert.equal(args.readingPolicy,'QUERY_EXHAUSTIVE');assert.equal(args.includeSemantic,false);
 assert.ok(f.requests[1].messages.some(m=>m.role==='tool'&&JSON.parse(m.content).isError));
});
test('bound session cannot create or target another session; every rejection is returned',async()=>{
 const f=fixture();f.state.queue=[response('',[call('zotquery_evidence_research_start',{},'new'),call('zotquery_evidence_session',{sessionId:'OTHER'},'other'),call('not_authorized',{},'bad')]),response('Ready'),response('Answer')];
 const result=await f.run();assert.equal(result.sessionId,'S');assert.equal(f.calls.length,0);
 const errors=f.requests[1].messages.filter(m=>m.role==='tool');assert.equal(errors.length,3);assert.ok(errors.every(m=>JSON.parse(m.content).isError));
});
test('failed request can resume full matching transcript without saving secrets',async()=>{
 const f=fixture();f.state.queue=[response('',[call()]),new Error('synthetic network failure')];
 await assert.rejects(f.run(),/输出模型请求失败/);
 assert.ok(f.events.some(e=>e.type==='paused'&&e.sessionId==='S'));
 f.state.queue=[response('Ready'),response('Answer')];await f.run();
 const resumed=f.requests[2];assert.ok(resumed.messages.some(m=>m.role==='tool'&&m.content.includes('Source passage')));
 assert.ok(resumed.messages.some(m=>m.reasoning_content==='synthetic-reasoning'));
 assert.ok(!JSON.stringify(resumed).includes('synthetic-key'));
});
test('different question/model does not reuse cached conversation',async()=>{
 const f=fixture();f.state.queue=[response('',[call()]),response('Ready'),response('Answer')];await f.run();
 f.state.queue=[response('Ready'),response('New answer')];await f.run({question:'Different question'});
 assert.ok(!JSON.stringify(f.requests[3]).includes('Source passage'));
});
test('token truncation never becomes a finished answer',async()=>{
 const f=fixture();const truncated=response('Incomplete');truncated.choices[0].finish_reason='length';f.state.queue=[truncated];
 await assert.rejects(f.run(),/token 上限/);assert.ok(!f.events.some(e=>e.type==='complete'));
 f.state.queue=[response('Ready'),response('Answer')];await f.run();
 assert.ok(!f.requests[1].messages.some(m=>m.content==='Incomplete'));
});
test('tool connection test roundtrips reasoning and receipt, rejects text-only OK',async()=>{
 const f=fixture();f.state.queue=[response('OK')];await assert.rejects(f.api.testConnection(cfg,'synthetic-key'),/未完成工具调用测试/);
 f.state.queue=[response('',[call('zotquery_connection_probe',{},'probe')]),body=>{
  assert.equal(body.messages[2].reasoning_content,'synthetic-reasoning');
  return response(JSON.parse(body.messages.at(-1).content).receipt);
 }];const result=await f.api.testConnection(cfg,'synthetic-key');assert.equal(result.toolRoundtrip,true);assert.equal(f.calls.length,0);
});
test('Anthropic thinking blocks and Gemini thought signatures survive serialization',async()=>{
 const f=fixture();const content=[{type:'thinking',thinking:'synthetic',signature:'signature-A'},{type:'tool_use',id:'A',name:'zotquery_health',input:{}}];
 f.state.queue=[{content}, {content:[{type:'text',text:'OK'}]}];
 const ac={...cfg,provider:'anthropic',format:'anthropic'};
 const a=await f.api._requestTurn(ac,[{role:'user',content:'Q'}],[]);
 await f.api._requestTurn(ac,[{role:'assistant',...a},{role:'tool',toolCallId:'A',content:'{}'}],[]);
 assert.deepEqual(f.requests.at(-1).messages[0].content,content);
 const parts=[{thought:true,text:'not final'},{functionCall:{name:'zotquery_health',args:{}},thoughtSignature:'signature-G'}];
 f.state.queue=[{candidates:[{content:{parts}}]}, {candidates:[{content:{parts:[{text:'OK'}]}}]}];
 const gc={...cfg,provider:'gemini',format:'gemini'};
 const g=await f.api._requestTurn(gc,[{role:'user',content:'Q'}],[]);assert.equal(g.content,'');
 await f.api._requestTurn(gc,[{role:'assistant',...g},{role:'tool',toolName:'zotquery_health',content:'{}'}],[]);
 assert.deepEqual(f.requests.at(-1).contents[0].parts,parts);
});
test('same session cannot run concurrently; lock releases after completion',async()=>{
 const f=fixture();let release;
 f.state.queue=[()=>new Promise(r=>{release=()=>r(response('Ready'));}),response('Answer')];
 const first=f.run();await new Promise(r=>setImmediate(r));await assert.rejects(f.run(),/另一个调用/);
 release();await first;f.state.queue=[response('Ready'),response('Answer again')];await f.run();
});
test('persisted question mismatch fails before HTTP or tool mutation',async()=>{
 const f=fixture();const original=f.state.result;f.state.result=id=>({...original(id),question:'An unrelated stored question'});
 await assert.rejects(f.run(),/会话问题与当前问题不一致/);assert.equal(f.requests.length,0);assert.equal(f.calls.length,0);
});
test('completed and failed API runs persist answers only; storage failure preserves exportable text',async()=>{
 const f=fixture(),saved=[],failed=[];
 // Install the real public hook shape, keeping the provider exchange synthetic.
 const history={begin:async()=> 'RUN',bindSession:async()=>{},finish:async(_id,data)=>saved.push(data),fail:async id=>failed.push(id)};
 // The fixture exposes the shared Zotero object solely to inject storage boundaries.
 f.zotero.ZotQueryHistory=history;
 f.state.queue=[response('Ready'),response('Answer')];const result=await f.run();assert.equal(result.historySaved,true);assert.equal(saved.length,1);assert.equal(saved[0].markdown,result.markdown);assert.ok(!JSON.stringify(saved).includes('synthetic-reasoning'));
 history.finish=async()=>{throw Error('disk full');};f.state.queue=[response('Ready'),response('Export this answer')];const unsaved=await f.run();assert.equal(unsaved.historySaved,false);assert.match(unsaved.markdown,/Export this answer/);assert.deepEqual(failed,['RUN']);
 f.state.queue=[new Error('network down')];await assert.rejects(f.run());assert.deepEqual(failed,['RUN','RUN']);
});
test('cold session restore supplies persisted facts and actionable gaps without pretending to restore reasoning',async()=>{
 const f=fixture();f.state.result=id=>({sessionId:id,question:'Synthetic question',status:'ready_for_synthesis',coverageGate:{synthesisAllowed:true},facts:[{factId:'OLD',value:'Synthetic persisted fact'}],nextActions:{readOrReview:[{positionId:'P'}]}});
 f.state.queue=[response('Ready'),response('Answer')];await f.run();const messages=f.requests[0].messages;
 assert.ok(messages.some(m=>m.content.includes('Synthetic persisted fact')));assert.ok(messages[0].content.includes('assessment'));assert.ok(messages[0].content.includes('lengthFromSlot'));
});
