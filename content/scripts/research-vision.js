/* Local PDF page snapshots and explicitly unverified visual observations. */
(function(global){
 'use strict';
 const DB='zotqueryresearch',query=(sql,args=[])=>Zotero.DB.queryAsync(sql,args);
 const fields=['visual_id','session_id','position_id','library_key','attachment_key','page_number','crop_json','pdf_hash','image_hash','width','height','created_at','observation_json'];
 const pending=new Map();
 const rasterCache=new Map(),inFlight=new Map();
 const CACHE_BYTES=48*1024*1024;
 let cacheBytes=0,renderBusy=false;
 const renderWaiters=[];
 function cacheGet(key){
  const entry=rasterCache.get(key);if(!entry)return null;
  rasterCache.delete(key);rasterCache.set(key,entry);
  return entry.image;
 }
 function cachePut(key,image){
  const bytes=image.data.length*2;
  if(bytes>CACHE_BYTES)return;
  const old=rasterCache.get(key);if(old){cacheBytes-=old.bytes;rasterCache.delete(key);}
  rasterCache.set(key,{image,bytes});cacheBytes+=bytes;
  while(cacheBytes>CACHE_BYTES){const first=rasterCache.keys().next().value;cacheBytes-=rasterCache.get(first).bytes;rasterCache.delete(first);}
 }
 async function renderSlot(task){
  if(renderBusy){
   await new Promise((resolve,reject)=>{
    const waiter={resolve,reject};renderWaiters.push(waiter);
    waiter.timer=setTimeout(()=>{const at=renderWaiters.indexOf(waiter);if(at>=0)renderWaiters.splice(at,1);reject(Error('PDF 渲染队列繁忙，请稍后重试；未标记已看图'));},8000);
   });
  }else renderBusy=true;
  try{return await task();}finally{
   const next=renderWaiters.shift();
   if(next){clearTimeout(next.timer);next.resolve();}else renderBusy=false;
  }
 }
 const enabled=()=>Zotero.Prefs.get('zotquery.modelAgent.visionEnabled',true)===true;
 const requireEnabled=()=>{if(!enabled())throw Error('PDF 看图未启用；请在 ZotQuery 设置中允许向模型发送页面图片。文字读取不等于看图。');};
 function normalizedCrop(value={x:0,y:0,width:1,height:1}) {
  if(!value||typeof value!=='object')throw Error('无效截图区域');
  const c=Object.fromEntries(['x','y','width','height'].map(k=>[k,value[k]]));
  if(Object.values(c).some(v=>typeof v!=='number'||!Number.isFinite(v))||c.x<0||c.y<0||c.width<=0||c.height<=0||c.x+c.width>1.000001||c.y+c.height>1.000001)throw Error('区域须为从页面左上角开始的 0–1 归一化坐标');
  return c;
 }
 function metadata(row) {
  const r=Object.fromEntries(fields.map(k=>[k,row[k]]));
  const library=r.library_key==='user'?'library':/^group:\d+$/.test(r.library_key)?`groups/${r.library_key.slice(6)}`:null;
  return {visualId:r.visual_id,sessionId:r.session_id,positionId:r.position_id,attachmentKey:r.attachment_key,pageNumber:r.page_number,crop:JSON.parse(r.crop_json),pdfHash:r.pdf_hash,imageHash:r.image_hash,width:r.width,height:r.height,createdAt:r.created_at,observation:r.observation_json?JSON.parse(r.observation_json):null,pdfLink:library?`zotero://open-pdf/${library}/items/${r.attachment_key}?page=${r.page_number}`:null,evidenceKind:'visual-observation',verification:'not-text-verified'};
 }
 async function startup(){
  await query(`CREATE TABLE IF NOT EXISTS ${DB}.visual_evidence(visual_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,position_id TEXT NOT NULL,library_key TEXT NOT NULL,attachment_key TEXT NOT NULL,page_number INTEGER NOT NULL,crop_json TEXT NOT NULL,pdf_hash TEXT NOT NULL,image_hash TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,image_base64 TEXT NOT NULL,created_at TEXT NOT NULL,observation_json TEXT)`);
  await query(`CREATE INDEX IF NOT EXISTS ${DB}.idx_visual_session ON visual_evidence(session_id)`);
 }
 async function renderAttempt(bytes,page,crop,maxDimension,fallbackDimension,timeoutMs){
  const win=Zotero.getMainWindow();if(!win)throw Error('PDF 页面渲染需要 Zotero 主窗口');
  const frame=win.document.createXULElement('browser');frame.setAttribute('type','content');frame.setAttribute('remote','false');frame.style.cssText='width:1px;height:1px;position:fixed;left:-10000px;visibility:hidden';
  let timer,timedOut=false;
  try {
   await new Promise((resolve,reject)=>{
    timer=win.setTimeout(()=>reject(Error('PDF 渲染器启动超时')),10000);
    frame.addEventListener('load',()=>{if(frame.contentWindow?.ZotQueryRenderPDF)resolve();},{capture:true});
    frame.setAttribute('src','chrome://zotquery/content/pdf-renderer.xhtml');win.document.documentElement.appendChild(frame);
   });
   win.clearTimeout(timer);
   return await Promise.race([frame.contentWindow.ZotQueryRenderPDF(bytes,page,crop,{maxDimension,fallbackDimension}),new Promise((_,reject)=>{timer=win.setTimeout(()=>{timedOut=true;reject(Error('PDF 页面渲染超时；未标记已看图'));},timeoutMs);})]);
  }finally{
   win.clearTimeout(timer);
   if(timedOut){
    try{await Promise.race([Promise.resolve(frame.contentWindow?.ZotQueryCancelPDF?.()),new Promise(resolve=>win.setTimeout(resolve,1500))]);}catch(_error){}
   }
   frame.remove();
  }
 }
 async function render(bytes,page,crop){
  const region=crop.x!==0||crop.y!==0||crop.width!==1||crop.height!==1;
  const choices=region?[1800,1200]:[1600,1050];
  const started=Date.now();
  const image=await renderAttempt(bytes,page,crop,choices[0],choices[1],74000);
  return {...image,renderTotalMs:Date.now()-started};
 }
 async function cachedRender(path,pdfHash,page,crop){
  const key=`pdfjs-v2:${pdfHash}:${page}:${JSON.stringify(crop)}`;
  const found=cacheGet(key);if(found)return {...found,cacheHit:true,sourceRenderTotalMs:found.renderTotalMs,renderTotalMs:0,timings:{parseMs:0,renderMs:0,encodeMs:0}};
  if(inFlight.has(key)){const started=Date.now(),image=await inFlight.get(key);return {...image,cacheHit:false,sharedInFlight:true,sourceRenderTotalMs:image.renderTotalMs,renderTotalMs:Date.now()-started};}
  const work=renderSlot(async()=>{
   const ready=cacheGet(key);if(ready)return ready;
   const image=await render(await IOUtils.read(path),page,crop);
   if(await Zotero.Utilities.Internal.md5Async(path)!==pdfHash)throw Error('渲染期间 PDF 已变化，请重新读取');
   cachePut(key,image);return image;
  });
  inFlight.set(key,work);
  try{return {...await work,cacheHit:false};}finally{inFlight.delete(key);}
 }
 async function attachmentFor(p,key){
  const libraryID=p.library_key==='user'?Zotero.Libraries.userLibraryID:/^group:\d+$/.test(p.library_key)?Zotero.Groups.getLibraryIDFromGroupID(Number(p.library_key.slice(6))):null;
  if(libraryID==null)throw Error('无效文献库');
  const parentID=Zotero.Items.getIDFromLibraryAndKey(libraryID,p.item_key),parent=parentID?await Zotero.Items.getAsync(parentID):null;
  const candidates=parent?.isPDFAttachment?.()?[parent]:(await Zotero.Items.getAsync(parent?.getAttachments?.()||[])).filter(a=>a?.isPDFAttachment?.());
  const selected=key?candidates.find(a=>a.key===key):candidates.length===1?candidates[0]:null;
  if(!selected)throw Error(`请指定该文献下的 PDF attachmentKey；候选：${candidates.map(a=>a.key).join(', ')||'无'}`);
  return selected;
 }
 async function readPage(args={}){const id=args.sessionId;pending.set(id,(pending.get(id)||0)+1);try{return await renderPage(args);}finally{const n=pending.get(id)-1;if(n)pending.set(id,n);else pending.delete(id);}}
 async function renderPage({sessionId,positionId,pageNumber,attachmentKey,crop}={}){
  requireEnabled();await Zotero.ZotQueryResearch.validateSessionScope(sessionId,{positionId});
  if(!Number.isInteger(pageNumber)||pageNumber<1)throw Error('pageNumber 必须为从 1 开始的 PDF 页码');
  crop=normalizedCrop(crop);
  const p=(await query(`SELECT session_id,library_key,item_key FROM ${DB}.positions WHERE position_id=? AND session_id=?`,[positionId,sessionId]))[0];if(!p)throw Error('研究证据位置不存在');
  const attachment=await attachmentFor(p,attachmentKey),path=await attachment.getFilePathAsync();if(!path)throw Error('PDF 未保存在本机');
  const stat=await IOUtils.stat(path);if(stat.size>200*1024*1024)throw Error('PDF 超过本次渲染内存保护大小');
  const hash=await Zotero.Utilities.Internal.md5Async(path);
  const existing=(await query(`SELECT ${fields.join(',')},image_base64 FROM ${DB}.visual_evidence WHERE session_id=? AND position_id=? AND attachment_key=? AND page_number=? AND crop_json=? AND pdf_hash=? LIMIT 1`,[sessionId,positionId,attachment.key,pageNumber,JSON.stringify(crop),hash]))[0];
  if(existing)return {...metadata(existing),images:[{mimeType:'image/png',data:existing.image_base64}],cached:true};
  const image=await cachedRender(path,hash,pageNumber,crop);
  const id='vi-'+Services.uuid.generateUUID().toString().replace(/[{}]/g,''),imageHash=Zotero.Utilities.Internal.md5(image.data),ts=new Date().toISOString();
  // Parameterized local snapshot; never modifies source PDFs or annotations.
  await query(`INSERT INTO ${DB}.visual_evidence(visual_id,session_id,position_id,library_key,attachment_key,page_number,crop_json,pdf_hash,image_hash,width,height,image_base64,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,sessionId,positionId,p.library_key,attachment.key,pageNumber,JSON.stringify(crop),hash,imageHash,image.width,image.height,image.data,ts]);
  return {...metadata((await query(`SELECT ${fields.join(',')} FROM ${DB}.visual_evidence WHERE visual_id=?`,[id]))[0]),images:[{mimeType:image.mimeType,data:image.data}],pageCount:image.pageCount,
   renderDiagnostics:{cacheHit:image.cacheHit,sharedInFlight:!!image.sharedInFlight,renderPixels:image.renderPixels,renderFallback:image.renderFallback,renderTotalMs:image.renderTotalMs,sourceRenderTotalMs:image.sourceRenderTotalMs??null,...image.timings},
   rule:'Actual page image supplied. Describe visible labels and coordinates; do not infer unreadable characters. A rendered image is not automatically a reviewed or verified fact.'};
 }
 async function list(sessionId,{offset=0,limit=12}={}){
  offset=Math.max(0,Math.floor(Number(offset)||0));limit=Math.min(50,Math.max(1,Math.floor(Number(limit)||12)));
  const total=Number((await query(`SELECT COUNT(*) n FROM ${DB}.visual_evidence WHERE session_id=?`,[sessionId]))[0].n);
  const rows=await query(`SELECT ${fields.join(',')} FROM ${DB}.visual_evidence WHERE session_id=? ORDER BY created_at,visual_id LIMIT ? OFFSET ?`,[sessionId,limit,offset]);
  return {total,offset,nextOffset:offset+rows.length<total?offset+rows.length:null,results:rows.map(metadata)};
 }
 async function readSaved(sessionId,visualId){
  const r=(await query(`SELECT ${fields.join(',')},image_base64 FROM ${DB}.visual_evidence WHERE session_id=? AND visual_id=?`,[sessionId,visualId]))[0];if(!r)throw Error('图像不属于当前研究或已删除');
  return {...metadata(r),images:[{mimeType:'image/png',data:r.image_base64}]};
 }
 async function previewPage({sessionId,positionId,pageNumber,attachmentKey,crop}={}){
  requireEnabled();await Zotero.ZotQueryResearch.validateSessionScope(sessionId,{positionId});
  if(!Number.isInteger(pageNumber)||pageNumber<1)throw Error('pageNumber 必须为从 1 开始的 PDF 页码');
  crop=normalizedCrop(crop);
  const p=(await query(`SELECT session_id,library_key,item_key FROM ${DB}.positions WHERE position_id=? AND session_id=?`,[positionId,sessionId]))[0];
  if(!p)throw Error('研究证据位置不存在');
  const attachment=await attachmentFor(p,attachmentKey),path=await attachment.getFilePathAsync();
  if(!path)throw Error('PDF 未保存在本机');
  const stat=await IOUtils.stat(path);if(stat.size>200*1024*1024)throw Error('PDF 超过本次渲染内存保护大小');
  const pdfHash=await Zotero.Utilities.Internal.md5Async(path);
  const image=await cachedRender(path,pdfHash,pageNumber,crop);
  const library=p.library_key==='user'?'library':/^group:\d+$/.test(p.library_key)?`groups/${p.library_key.slice(6)}`:null;
  return {sessionId,positionId,attachmentKey:attachment.key,pageNumber,crop,pdfHash,
   imageHash:Zotero.Utilities.Internal.md5(image.data),width:image.width,height:image.height,pageCount:image.pageCount,
   pdfLink:library?`zotero://open-pdf/${library}/items/${attachment.key}?page=${pageNumber}`:null,
   evidenceKind:'visual-observation',verification:'not-text-verified',persisted:false,
   renderDiagnostics:{cacheHit:image.cacheHit,sharedInFlight:!!image.sharedInFlight,renderPixels:image.renderPixels,renderFallback:image.renderFallback,renderTotalMs:image.renderTotalMs,sourceRenderTotalMs:image.sourceRenderTotalMs??null,...image.timings},
   rule:'Live page preview; no evidence status or saved research record was changed. Preserve visible labels and numbering; do not infer unreadable characters.',
   images:[{mimeType:image.mimeType,data:image.data}]};
 }
 async function observe({sessionId,visualId,observation,rowLabel,numbering,uncertainties,relation}={}){
  requireEnabled();
  if(!['full','partial','context','contradicts'].includes(relation)||typeof observation!=='string'||!observation.trim()||typeof uncertainties!=='string'||typeof rowLabel!=='string'||typeof numbering!=='string')throw Error('图像观察须填写 observation、rowLabel、numbering、uncertainties 和 relation；不适用时明确说明');
  if([observation,rowLabel,numbering,uncertainties].some(x=>x.length>12000))throw Error('图像观察字段过长');
  const saved=await readSaved(sessionId,visualId);
  if(saved.observation)throw Error('图像观察已登记；后续解释写入回答，不覆盖原观察');
  const value={observation,rowLabel,numbering,uncertainties,relation,source:'model-visual-reading',verified:false};
  await query(`UPDATE ${DB}.visual_evidence SET observation_json=? WHERE session_id=? AND visual_id=? AND observation_json IS NULL`,[JSON.stringify(value),sessionId,visualId]);
  return {sessionId,visualId,observation:value,rule:'Visual observation retained with image provenance; not a text-verbatim DIRECT fact and not automatic EXACT closure. Answer the supported part with this limitation.'};
 }
 const schemas={sessionId:{type:'string'},positionId:{type:'string'},pageNumber:{type:'integer',minimum:1},attachmentKey:{type:'string'},crop:{type:'object',description:'Displayed page fractions from top left; retain row labels and coordinate headers.',properties:Object.fromEntries(['x','y','width','height'].map(k=>[k,{type:'number',minimum:0,maximum:1}])),required:['x','y','width','height']}};
 const toolDefinitions=()=>[
  {name:'evidence_page_image',description:'Read an actual PDF page or region image, not OCR/text. Use when figures, alignments or tables carry missing evidence. First read full page, then crop preserving labels/numbering. Page numbers are physical PDF pages, 1-based. Requires enabled image permission.',inputSchema:{type:'object',properties:schemas,required:['sessionId','positionId','pageNumber']}},
  {name:'evidence_visual_observe',description:'Persist a visually read observation separately from text-verified facts. Include row/axis labels, numbering and ambiguities. Does not pretend OCR was run or automatically close EXACT facts.',inputSchema:{type:'object',properties:{sessionId:{type:'string'},visualId:{type:'string'},...Object.fromEntries(['observation','rowLabel','numbering','uncertainties'].map(k=>[k,{type:'string'}])),relation:{type:'string',enum:['full','partial','context','contradicts']}},required:['sessionId','visualId','observation','rowLabel','numbering','uncertainties','relation']}},
  {name:'evidence_visual_list',description:'Page saved image metadata and observations; not a fresh visual read. No images included.',inputSchema:{type:'object',properties:{sessionId:{type:'string'},offset:{type:'integer'},limit:{type:'integer'}},required:['sessionId']}}
 ];
 Zotero.ZotQueryVision={startup,readPage,readSaved,previewPage,observe,list,toolDefinitions,normalizedCrop,isSessionActive:id=>pending.has(id),callTool:(name,a)=>name==='evidence_page_image'?readPage(a):name==='evidence_visual_observe'?observe(a):list(a.sessionId,a)};
})(typeof _globalThis!=='undefined'?_globalThis:this);
