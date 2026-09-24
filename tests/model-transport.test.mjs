import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import test from 'node:test';
const source=fs.readFileSync(new URL('../content/scripts/model-transport.js',import.meta.url),'utf8');
function fixture(request=()=>{throw Error('unexpected request');}) {
 const timers=new Set(),box={Zotero:{HTTP:{request}},setTimeout:(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;},clearTimeout:id=>{timers.delete(id);clearTimeout(id);}};
 vm.createContext(box);vm.runInContext(source,box);return {api:box.Zotero.ZotQueryModelTransport,box,timers};
}
const frame=row=>`data: ${JSON.stringify(row)}\r\n\r\n`;
const delta=(d,finish=null)=>frame({choices:[{index:0,delta:d,finish_reason:finish}]});
const end='data: [DONE]\r\n\r\n';
test('UTF-8 size guard is separate from token budgets and aborts oversized requests before HTTP',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return {};});
 assert.equal(f.api._utf8Bytes('A中文🙂'),Buffer.byteLength('A中文🙂'));
 assert.doesNotThrow(()=>f.api._checkSize(100,100,'RESPONSE_TOO_LARGE'));
 assert.throws(()=>f.api._checkSize(101,100,'RESPONSE_TOO_LARGE'),e=>e.code==='RESPONSE_TOO_LARGE');
 await assert.rejects(f.api.request('http://127.0.0.1/test',{text:'x'.repeat(32*1024*1024)}, {},2),e=>e.code==='REQUEST_TOO_LARGE');
 assert.equal(calls,0);assert.equal(f.timers.size,0);
 const p=f.api._streamParser();assert.throws(()=>p.push('data: '+ 'x'.repeat(16*1024*1024)),e=>e.code==='RESPONSE_TOO_LARGE');
});

test('SSE accepts text blocks, reasoning alias and complete-message gateways without duplicating deltas',()=>{
 const f=fixture(),p=f.api._streamParser();
 p.push(delta({reasoning:'thought',content:[{type:'text',text:'Hel'}]}));
 p.push(frame({choices:[{index:0,message:{content:'Hello',reasoning:'thought'},finish_reason:'stop'}]})+end);
 assert.equal(p.result().choices[0].message.content,'Hello');
 assert.equal(p.stats().reasoningChars,7);
 const tool=f.api._streamParser();
 tool.push(frame({choices:[{message:{content:null,tool_calls:[{id:'c',function:{name:'read',arguments:'{}'}}]},finish_reason:'tool_calls'}]})+end);
 assert.equal(tool.result().choices[0].message.tool_calls[0].function.name,'read');
 const refusal=f.api._streamParser();refusal.push(delta({refusal:'blocked'},'stop')+end);assert.equal(refusal.result().choices[0].message.refusal,'blocked');
 const bad=f.api._streamParser();bad.push(delta({content:'Original'}));
 assert.throws(()=>bad.push(frame({choices:[{message:{content:'Changed'},finish_reason:'stop'}]})),e=>e.code==='STREAM_INVALID');
 assert.throws(()=>f.api._streamParser().push(delta({content:{text:'not a text block'}})),e=>e.code==='UNSUPPORTED_RESPONSE');
});
test('SSE character fragmentation preserves interleaved reasoning, tool arguments, usage and terminal state',()=>{
 const p=fixture().api._streamParser();
 const text=': keepalive\r\n\r\n'+delta({reasoning_content:'private reasoning'})+delta({tool_calls:[{index:1,id:'b',function:{name:'tool_b',arguments:'{"b":'}},{index:0,id:'a',function:{name:'tool_a',arguments:'{"a":'}}]})+delta({tool_calls:[{index:0,function:{arguments:'1}'}},{index:1,function:{arguments:'2}'}}]},'tool_calls')+frame({choices:[],usage:{completion_tokens:20}})+end;
 for(const c of text)p.push(c);
 const result=p.result();assert.equal(result.choices[0].message.tool_calls[0].function.arguments,'{"a":1}');assert.equal(result.choices[0].message.tool_calls[1].id,'b');assert.equal(result.usage.completion_tokens,20);
 assert.equal(result.choices[0].message.reasoning_content,'private reasoning');assert.doesNotMatch(JSON.stringify(p.stats()),/private|tool_a/);
});
test('SSE rejects incomplete/error/malformed tool data and never treats truncation as complete',()=>{
 for(const text of [delta({content:'partial'}),delta({content:'partial'},'stop'),delta({content:'partial'})+end]){
  const p=fixture().api._streamParser();p.push(text);assert.throws(()=>p.result(),e=>e.code==='STREAM_INCOMPLETE');
 }
 const malformed=delta({tool_calls:[{index:0,id:'a',function:{name:'read',arguments:'{"x":'}}]},'tool_calls')+end;
 const p=fixture().api._streamParser();p.push(malformed);assert.throws(()=>p.result(),e=>e.code==='STREAM_INVALID');
 const q=fixture().api._streamParser();q.push(delta({content:'partial'},'length')+end);assert.equal(q.result().choices[0].finish_reason,'length');
 assert.throws(()=>fixture().api._streamParser().push(frame({error:{message:'private'}})),e=>e.code==='STREAM_ERROR');
});
test('hard deadline and cancellation abort even when underlying HTTP promise never settles; timers cleaned',async()=>{
 let aborted=0,requests=0;
 const f=fixture((_m,_u,o)=>{requests++;o.cancellerReceiver(()=>aborted++);return new Promise(()=>{});});
 await assert.rejects(f.api.request('http://127.0.0.1/test',{}, {},.02),e=>e.code==='REQUEST_TIMEOUT');assert.equal(aborted,1);assert.equal(f.timers.size,0);
 const control=f.api.createControl(),promise=f.api.request('http://127.0.0.1/test',{}, {},2,{control});control.cancel();control.cancel();
 await assert.rejects(promise,e=>e.code==='CANCELLED');assert.equal(aborted,2);assert.equal(f.timers.size,0);
 await assert.rejects(f.api.request('http://127.0.0.1/test',{}, {},2,{control}),e=>e.code==='CANCELLED');assert.equal(requests,2);
});
test('HTTP statuses opt out of Zotero backoff; ignored-stream JSON is accepted without replay',async()=>{
 for(const status of [200,401,429,503]){
  let n=0;const f=fixture(async(_m,_u,o)=>{n++;assert.equal(o.successCodes,false);assert.equal(o.errorDelayMax,0);assert.equal(o.noRetryOnThrottle,true);assert.equal(o.logBodyLength,0);return {status,responseText:JSON.stringify({choices:[{message:{content:'Answer'}}]}),getResponseHeader:()=> 'application/json'};});
  const result=f.api.request('http://127.0.0.1/test',{}, {},2,{stream:true});
  if(status===200) assert.equal((await result).choices[0].message.content,'Answer');else await assert.rejects(result,e=>e.status===status);
  assert.equal(n,1);assert.equal(f.timers.size,0);
 }
});
test('real local chunked HTTP produces progress and complete output without exposing response bodies',async()=>{
 let requests=0;
 const server=http.createServer((req,res)=>{requests++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(delta({reasoning_content:'PRIVATE_REASONING'}));setTimeout(()=>res.end(delta({content:'Answer'},'stop')+frame({choices:[],usage:{completion_tokens:8}})+end),20);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const progress=[];
 const f=fixture((method,url,o)=>new Promise((resolve,reject)=>{
  const listeners=new Map(),xhr={status:0,responseText:'',getResponseHeader:()=> 'text/event-stream',addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)};
  o.requestObserver(xhr);
  const req=http.request(url,{method},res=>{xhr.status=res.statusCode;res.setEncoding('utf8');res.on('data',c=>{xhr.responseText+=c;listeners.get('progress')?.();});res.on('end',()=>resolve(xhr));});
  req.on('error',reject);o.cancellerReceiver(()=>req.destroy());req.end(o.body);
 }));
 try {
  const result=await f.api.request(`http://127.0.0.1:${server.address().port}/`,{}, {},2,{stream:true,onProgress:s=>progress.push(s)});
  assert.equal(result.choices[0].message.content,'Answer');assert.equal(result.usage.completion_tokens,8);assert.ok(progress.some(s=>s.reasoningChars>0));assert.doesNotMatch(JSON.stringify(progress),/PRIVATE_REASONING|Answer/);assert.equal(requests,1);assert.equal(f.timers.size,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
