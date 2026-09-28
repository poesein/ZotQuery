import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source=fs.readFileSync(new URL('../content/scripts/pdf-renderer.mjs',import.meta.url),'utf8')
 .replace(/^import \{getDocument,GlobalWorkerOptions\} from .*;\r?\n/m,'');

function fixture({stallFirst=false,shortTimers=false,neverSettleCancel=false}={}){
 const state={renders:0,cancels:0,destroys:0,canvases:[]};
 const page={getViewport:({scale})=>({width:600*scale,height:800*scale,rotation:0}),render:()=>{
  state.renders++;
  let rejectTask;
  const promise=stallFirst&&state.renders===1?new Promise((_,reject)=>{rejectTask=reject;}):Promise.resolve();
  return {promise,cancel:()=>{state.cancels++;if(!neverSettleCancel)rejectTask?.(Error('render cancelled'));}};
 }};
 const loading={promise:Promise.resolve({numPages:8,getPage:async()=>page}),destroy:async()=>{state.destroys++;}};
 const box={window:{},document:{createElement:()=>{const canvas={width:0,height:0,getContext:()=>({}),toDataURL:()=>`data:image/png;base64,cG5n`};state.canvases.push(canvas);return canvas;}},
  getDocument:()=>loading,GlobalWorkerOptions:{},Uint8Array,performance,setTimeout:(fn,ms)=>setTimeout(fn,shortTimers&&ms>=1000?10:ms),clearTimeout};
 vm.createContext(box);vm.runInContext(source,box);
 return {render:box.window.ZotQueryRenderPDF,cancel:box.window.ZotQueryCancelPDF,state};
}

test('full page uses navigation resolution; crop canvas represents only selected region',async()=>{
 const f=fixture();
 const full=await f.render(new Uint8Array([1]),3,{x:0,y:0,width:1,height:1},{maxDimension:1600,fallbackDimension:1050});
 assert.equal(full.width,1200);assert.equal(full.height,1600);assert.equal(full.renderFallback,false);
 const region=await f.render(new Uint8Array([1]),3,{x:0,y:0,width:1,height:0.5},{maxDimension:1800,fallbackDimension:1200});
 assert.equal(region.width,1800);assert.equal(region.height,1200);
 assert.equal(f.state.destroys,2);
});

test('raster timeout cancels the first task and retries on the same parsed PDF',async()=>{
 const f=fixture({stallFirst:true,shortTimers:true});
 const image=await f.render(new Uint8Array([1]),3,{x:0,y:0,width:1,height:1},{maxDimension:1600,fallbackDimension:1050});
 assert.equal(image.renderFallback,true);assert.equal(image.renderPixels,1050);
 assert.ok(image.timings.firstAttemptMs>=0);
 assert.ok(image.timings.fallbackAttemptMs>=image.timings.renderMs);
 assert.ok(image.timings.renderMs<image.timings.firstAttemptMs+image.timings.fallbackAttemptMs,'successful render timing must exclude the failed first pass');
 assert.equal(f.state.renders,2);assert.equal(f.state.cancels,1);assert.equal(f.state.destroys,1);
});

test('unsettled cancellation never starts a competing fallback render',async()=>{
 const f=fixture({stallFirst:true,shortTimers:true,neverSettleCancel:true});
 await assert.rejects(f.render(new Uint8Array([1]),3,{x:0,y:0,width:1,height:1},{maxDimension:1600,fallbackDimension:1050}),/取消未完成/);
 assert.equal(f.state.renders,1);assert.equal(f.state.cancels,1);assert.equal(f.state.destroys,1);
});
