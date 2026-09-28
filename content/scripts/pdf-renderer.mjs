// Isolated local document: no reader tab, selection, annotation or source writes.
import {getDocument,GlobalWorkerOptions} from 'resource://zotero/reader/pdf/build/pdf.mjs';
GlobalWorkerOptions.workerSrc='resource://zotero/reader/pdf/build/pdf.worker.mjs';
let active=null;
function destroy(job){
 if(!job.loading)return Promise.resolve();
 if(!job.cleanup)job.cleanup=Promise.resolve().then(()=>job.loading.destroy()).catch(()=>{});
 return job.cleanup;
}
window.ZotQueryCancelPDF=()=>{
 const job=active;
 if(!job)return Promise.resolve();
 job.cancelled=true;
 try{job.renderTask?.cancel();}catch(_error){}
 return destroy(job);
};
window.ZotQueryRenderPDF=async (bytes,pageNumber,crop,options={}) => {
 if(active)throw new Error('PDF 渲染器正忙');
 const started=performance.now();
 const job={cancelled:false,renderTask:null,loading:null,cleanup:null};
 active=job;
 const check=()=>{if(job.cancelled)throw new Error('PDF 渲染已取消');};
 try {
  job.loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,
   cMapUrl:'resource://zotero/reader/pdf/web/cmaps/',cMapPacked:true,
   standardFontDataUrl:'resource://zotero/reader/pdf/web/standard_fonts/'});
  const pdf=await job.loading.promise;
  check();
  if(pageNumber>pdf.numPages)throw new Error(`页码超出 PDF 范围（共 ${pdf.numPages} 页）`);
  const page=await pdf.getPage(pageNumber),unit=page.getViewport({scale:1});
  check();
  const parseMs=Math.round(performance.now()-started);
  // The canvas is limited to the requested region; PDF.js may still need to parse
  // the page's complete operator list before it can draw that region.
  const renderOne=async (dimension,limitMs)=>{
   const renderStarted=performance.now();
   const scale=Math.min(4,dimension/Math.max(unit.width*crop.width,unit.height*crop.height));
   const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
   canvas.width=Math.ceil(viewport.width*crop.width);canvas.height=Math.ceil(viewport.height*crop.height);
   if(canvas.width*canvas.height>6000000)throw new Error('页面渲染过大，请缩小区域');
   const context=canvas.getContext('2d');
   const task=page.render({canvasContext:context,viewport,transform:[1,0,0,1,-viewport.width*crop.x,-viewport.height*crop.y],background:'rgb(255,255,255)'});
   job.renderTask=task;
   let timer,timedOut=false;
   try{
    await Promise.race([task.promise,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;try{task.cancel();}catch(_error){}reject(Error('PDF 栅格化超时'));},limitMs);})]);
    check();
   }catch(error){
    if(timedOut){
     let settled=false;
     await Promise.race([task.promise.then(()=>{settled=true;},()=>{settled=true;}),new Promise(resolve=>setTimeout(resolve,1500))]);
     if(!settled)throw Error('PDF 栅格化取消未完成；未继续并发渲染');
     const timeout=Error('PDF 栅格化超时');timeout.code='PDF_RASTER_TIMEOUT';throw timeout;
    }
    throw error;
   }
   finally{clearTimeout(timer);job.renderTask=null;}
   const renderMs=Math.round(performance.now()-renderStarted);
   const encodeStarted=performance.now();
   const image=canvas.toDataURL('image/png').split(',')[1];
   check();
   if(image.length>12*1024*1024)throw new Error('图像过大，请缩小区域');
   return {data:image,mimeType:'image/png',width:canvas.width,height:canvas.height,pageCount:pdf.numPages,rotation:viewport.rotation,
    rendererBackend:'pdfjs',renderPixels:dimension,timings:{parseMs,renderMs,encodeMs:Math.round(performance.now()-encodeStarted)}};
  };
  const firstDimension=options.maxDimension||1600,fallbackDimension=options.fallbackDimension||1050;
  // Complex vector pages can spend most of the former 35 s first-pass budget
  // before a successful 18 s fallback. Try high resolution briefly, then leave
  // enough time for the lower-resolution pass on the same parsed document.
  const remaining=Math.max(0,68000-(performance.now()-started));
  const firstMs=Math.max(5000,Math.min(18000,remaining-40000));
  const firstStarted=performance.now();
  try{return {...await renderOne(firstDimension,firstMs),renderFallback:false};}
  catch(error){
   if(error.code!=='PDF_RASTER_TIMEOUT')throw error;
   check();
   const firstAttemptMs=Math.round(performance.now()-firstStarted);
   const fallbackMs=Math.max(3000,Math.min(40000,68000-(performance.now()-started)));
   const fallbackStarted=performance.now();
   const image=await renderOne(fallbackDimension,fallbackMs);
   return {...image,renderFallback:true,timings:{...image.timings,firstAttemptMs,fallbackAttemptMs:Math.round(performance.now()-fallbackStarted)}};
  }
 } finally {
  active=null;
  if(job.loading){
   // Do not let PDF.js worker cleanup hold a timed-out tool call indefinitely.
   const cleanup=destroy(job);
   if(!job.cancelled)await Promise.race([cleanup,new Promise(resolve=>setTimeout(resolve,1500))]);
  }
 }
};
