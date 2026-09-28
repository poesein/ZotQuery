/* ZotQuery 3.1.25: scoped selection, managed child notes and resumable reading batches. */
(function(global){
 'use strict';
 const DB='zotqueryresearch';
 const pending=new Map();
 const itemKeyPattern=/^[A-Z0-9]{8}$/;
 const tagsAllowed=new Set(['p','div','h1','h2','h3','h4','h5','h6','br','hr','strong','b','em','i','u','s','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td','a','sup','sub']);
 const dropContent=new Set(['script','style','iframe','object','embed','svg','math','form','button','input','select','textarea','img','video','audio','link','meta']);
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function libraryID(key){
  if(key==='user')return Zotero.Libraries.userLibraryID;
  if(!/^group:[1-9][0-9]*$/.test(String(key)))throw Error('无效文献库；请使用 user 或 group:<数字>');
  const id=Zotero.Groups.getLibraryIDFromGroupID(Number(key.slice(6)));
  if(!id)throw Error('群组文献库不存在');
  return id;
 }
 function libraryKey(id){
  if(id===Zotero.Libraries.userLibraryID)return'user';
  const group=Zotero.Groups.getGroupIDFromLibraryID?.(id)||Zotero.Libraries.get(id)?.groupID;
  return Number.isInteger(Number(group))&&Number(group)>0?`group:${group}`:null;
 }
 function safeHTML(input){
  const win=Zotero.getMainWindow?.();
  const Parser=win?.DOMParser||global.DOMParser;
  if(!Parser)throw Error('HTML 清理器不可用，未创建笔记');
  const parsed=new Parser().parseFromString(input,'text/html');
  const clean=node=>{
   if(node.nodeType===3)return escape(node.nodeValue||'');
   if(node.nodeType!==1)return'';
   const tag=String(node.localName||'').toLowerCase();
   if(dropContent.has(tag))return'';
   const body=Array.from(node.childNodes||[],clean).join('');
   if(!tagsAllowed.has(tag))return body;
   if(tag==='br'||tag==='hr')return`<${tag}>`;
   let attrs='';
   if(tag==='a'){
    const href=String(node.getAttribute?.('href')||'').trim();
    if(/^(https?:\/\/|zotero:\/\/)/i.test(href)&&!/[\u0000-\u001f\u007f]/.test(href))attrs=` href="${escape(href)}"`;
   }
   if(tag==='td'||tag==='th')for(const name of ['colspan','rowspan']){
    const value=Number(node.getAttribute?.(name));
    if(Number.isInteger(value)&&value>=2&&value<=20)attrs+=` ${name}="${value}"`;
   }
   return`<${tag}${attrs}>${body}</${tag}>`;
  };
  const html=Array.from(parsed.body?.childNodes||[],clean).join('');
  if(!String(parsed.body?.textContent||'').trim()||!html.replace(/<[^>]*>/g,'').trim())throw Error('笔记正文为空或只有不允许的内容');
  return html;
 }
 async function startup(){
  await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB}.child_note_receipts(fingerprint TEXT PRIMARY KEY,library_key TEXT NOT NULL,parent_item_key TEXT NOT NULL,note_item_key TEXT NOT NULL,created_at TEXT NOT NULL)`);
  await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB}.managed_child_notes(library_key TEXT NOT NULL,parent_item_key TEXT NOT NULL,reading_profile_id TEXT NOT NULL,note_item_key TEXT NOT NULL,note_hash TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(library_key,parent_item_key,reading_profile_id))`);
  await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB}.reading_batch_failures(library_key TEXT NOT NULL,collection_key TEXT NOT NULL,parent_item_key TEXT NOT NULL,reading_profile_id TEXT NOT NULL,reason TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,PRIMARY KEY(library_key,collection_key,parent_item_key,reading_profile_id))`);
  await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB}.reading_depth_qc(library_key TEXT NOT NULL,parent_item_key TEXT NOT NULL,reading_profile_id TEXT NOT NULL,generation_profile_id TEXT NOT NULL,article_type TEXT NOT NULL,note_hash TEXT NOT NULL,report_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(library_key,parent_item_key,reading_profile_id))`);
  await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB}.reading_depth_qc_failures(library_key TEXT NOT NULL,parent_item_key TEXT NOT NULL,reading_profile_id TEXT NOT NULL,report_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(library_key,parent_item_key,reading_profile_id))`);
 }
 async function selectedItems(){
  const pane=Zotero.getActiveZoteroPane?.();
  if(!pane?.getSelectedItems)throw Error('Zotero 主窗口未打开，无法读取当前选中条目');
  const selected=pane.getSelectedItems()||[];
  const results=selected.slice(0,20).map(item=>{
   const scope=libraryKey(item.libraryID);
   const parent=item.parentItemID?Zotero.Items.get(item.parentItemID):null;
   return {library:scope,itemKey:item.key,title:String(item.getField?.('title')||item.getNoteTitle?.()||''),
    itemType:Zotero.ItemTypes.getName(item.itemTypeID),isRegularItem:!!item.isRegularItem?.(),
    parentItemKey:parent?.key||null,parentTitle:parent?String(parent.getField?.('title')||''):null,
    itemLink:scope?`zotero://select/${scope==='user'?'library':`groups/${scope.slice(6)}`}/items/${item.key}`:null};
  });
  return {results,totalSelected:selected.length,truncated:selected.length>results.length,
   rule:'This is the current Zotero UI selection, not a persistent research target. For writing, pass the stable library and regular parent item key explicitly.'};
 }
 async function existingReceipt(fingerprint,parent,scope){
  const row=(await Zotero.DB.queryAsync(`SELECT note_item_key FROM ${DB}.child_note_receipts WHERE fingerprint=? AND library_key=? AND parent_item_key=?`,[fingerprint,scope,parent.key]))[0];
  if(!row)return null;
  const id=Zotero.Items.getIDFromLibraryAndKey(parent.libraryID,row.note_item_key);
  const note=id?await Zotero.Items.getAsync(id):null;
  return note?.isNote?.()&&note.parentItemID===parent.id?note:null;
 }
 async function createChildNote({library,parentItemKey,title,html,tags=[]}={}){
  const scope=String(library||''),id=libraryID(scope),key=String(parentItemKey||'');
  if(!itemKeyPattern.test(key))throw Error('parentItemKey 必须是八位 Zotero 条目 key');
  if(typeof title!=='string'||!title.trim()||title.length>300)throw Error('笔记标题须为 1–300 字符');
  if(typeof html!=='string'||!html.trim()||html.length>300000)throw Error('HTML 正文须为 1–300000 字符');
  if(!Array.isArray(tags)||tags.length>12||tags.some(t=>typeof t!=='string'||!t.trim()||t.length>100))throw Error('tags 最多 12 个，每个不超过 100 字符');
  const parentID=Zotero.Items.getIDFromLibraryAndKey(id,key),parent=parentID?await Zotero.Items.getAsync(parentID):null;
  if(!parent?.isRegularItem?.()||parent.deleted||parent.libraryID!==id)throw Error('父条目不存在或不是该文献库中的普通文献条目');
  if(Zotero.Libraries.get(id)?.editable===false)throw Error('该文献库不可写');
  const cleaned=safeHTML(html),noteHTML=`<div data-schema-version="9"><h1>${escape(title.trim())}</h1>${cleaned}</div>`;
  const cleanTags=[...new Set(tags.map(t=>t.trim()))];
  const fingerprint=Zotero.Utilities.Internal.md5(JSON.stringify([scope,key,noteHTML,cleanTags]));
  const link=noteKey=>`zotero://select/${scope==='user'?'library':`groups/${scope.slice(6)}`}/items/${noteKey}`;
  if(pending.has(fingerprint))return pending.get(fingerprint);
  const work=(async()=>{
   const prior=await existingReceipt(fingerprint,parent,scope);
   if(prior)return {created:false,alreadyExists:true,library:scope,parentItemKey:key,noteItemKey:prior.key,noteLink:link(prior.key),tags:cleanTags};
   let note;
   await Zotero.DB.executeTransaction(async()=>{
    note=new Zotero.Item('note');
    note.libraryID=id;
    note.parentItemID=parent.id;
    note.setNote(noteHTML);
    for(const tag of cleanTags)note.addTag(tag);
    const savedID=await note.save();
    const linked=await Zotero.DB.valueQueryAsync('SELECT parentItemID FROM itemNotes WHERE itemID=?',[savedID]);
    if(Number(linked)!==parent.id)throw Error('Zotero 未将新笔记保存为指定条目的子笔记；事务已回滚');
    await Zotero.DB.queryAsync(`INSERT OR REPLACE INTO ${DB}.child_note_receipts(fingerprint,library_key,parent_item_key,note_item_key,created_at) VALUES(?,?,?,?,?)`,[fingerprint,scope,key,note.key,new Date().toISOString()]);
   });
   return {created:true,alreadyExists:false,library:scope,parentItemKey:key,noteItemKey:note.key,noteLink:link(note.key),tags:cleanTags,
    rule:'Created a Zotero child note and verified its parent relation. No existing note or source PDF was overwritten.'};
  })();
  pending.set(fingerprint,work);
  try{return await work;}finally{pending.delete(fingerprint);}
 }
 const validProfile=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);
 const digest=value=>Zotero.Utilities.Internal.md5(value);
 async function regularParent(scope,key){
  const id=libraryID(scope);
  if(!itemKeyPattern.test(key))throw Error('parentItemKey 必须是八位 Zotero 条目 key');
  const itemID=Zotero.Items.getIDFromLibraryAndKey(id,key);
  const parent=itemID?await Zotero.Items.getAsync(itemID):null;
  if(!parent?.isRegularItem?.()||parent.deleted||parent.libraryID!==id)throw Error('父条目不存在或不是该文献库中的普通文献条目');
  return parent;
 }
 async function managedNote(scope,parent,profile){
  const row=(await Zotero.DB.queryAsync(`SELECT note_item_key,note_hash FROM ${DB}.managed_child_notes WHERE library_key=? AND parent_item_key=? AND reading_profile_id=?`,[scope,parent.key,profile]))[0];
  if(!row)return {row:null,note:null};
  const noteID=Zotero.Items.getIDFromLibraryAndKey(parent.libraryID,row.note_item_key);
  const note=noteID?await Zotero.Items.getAsync(noteID):null;
  if(!note?.isNote?.()||note.deleted||note.parentItemID!==parent.id)throw Error('已管理精读笔记已移动或删除；拒绝自动重建，请人工核对');
  return {row,note};
 }
 function noteLink(scope,key){return `zotero://select/${scope==='user'?'library':`groups/${scope.slice(6)}`}/items/${key}`;}
 async function depthQC(scope,key,profile){
  const passed=(await Zotero.DB.queryAsync(`SELECT generation_profile_id,article_type,note_hash,report_json FROM ${DB}.reading_depth_qc WHERE library_key=? AND parent_item_key=? AND reading_profile_id=?`,[scope,key,profile]))[0]||null;
  const failed=(await Zotero.DB.queryAsync(`SELECT report_json,updated_at FROM ${DB}.reading_depth_qc_failures WHERE library_key=? AND parent_item_key=? AND reading_profile_id=?`,[scope,key,profile]))[0]||null;
  return {passed,failed};
 }
 function generationProfile({generationProfileId='strawberry-vnext-depth'}={}){
  const profile=Zotero.ZotQueryReadingGeneration?.get?.(generationProfileId);
  if(!profile)throw Error('Generation Profile 不存在');
  return {...profile,submissionSchema:Zotero.ZotQueryReadingGeneration?.submissionSchema?.(generationProfileId)||null};
 }
 async function checkDepthQC({library,parentItemKey,readingProfileId,generationProfileId,generation,html}={}){
  const scope=String(library||''),key=String(parentItemKey||''),profile=String(readingProfileId||'');
  if(!validProfile(profile))throw Error('readingProfileId 须为 1–80 位字母、数字、点、横线或下划线');
  if(typeof generationProfileId!=='string'||!generationProfileId.trim()||!generation||typeof generation!=='object'||Array.isArray(generation))throw Error('必须提交 Generation Profile 和深度生成记录');
  if(typeof html!=='string'||!html.trim()||html.length>300000)throw Error('HTML 正文须为 1–300000 字符');
  const parent=await regularParent(scope,key),cleaned=safeHTML(html);
  const qc=Zotero.ZotQueryReadingGeneration?.evaluate?.({profileId:generationProfileId,readingProfileId:profile,generation,html:cleaned});
  if(!qc)throw Error('Generation Profile 未加载；拒绝写入托管笔记');
  if(generation.articleType==='original_research'){
   let sourceIsParentPDF=false;
   for(const attachmentID of parent.getAttachments?.()||[]){
    const attachment=await Zotero.Items.getAsync(attachmentID);
    if(attachment?.key===generation.fullTextRead?.attachmentKey&&attachment.attachmentContentType==='application/pdf'&&!attachment.deleted){sourceIsParentPDF=true;break;}
   }
   if(!sourceIsParentPDF){qc.status='DEPTH_QC_FAIL';qc.reasons.push('SOURCE_PDF_NOT_PARENT_ATTACHMENT');}
  }
  return {scope,key,profile,parent,cleaned,qc};
 }
 async function depthQCPreview(args={}){
  const checked=await checkDepthQC(args);
  return {status:checked.qc.status,previewOnly:true,library:checked.scope,parentItemKey:checked.key,readingProfileId:checked.profile,generationProfileId:args.generationProfileId,depthQC:checked.qc,noteWritten:false,parentTagged:false,
   rule:'Read-only preflight. The same Depth QC and source-PDF checks run at upsert; no Zotero note, tag, or batch failure record is changed.'};
 }
 async function upsertChildNote({library,parentItemKey,readingProfileId,generationProfileId,generation,title,html,tagOnSuccess=true}={}){
  const scope=String(library||''),key=String(parentItemKey||''),profile=String(readingProfileId||'');
  if(!validProfile(profile))throw Error('readingProfileId 须为 1–80 位字母、数字、点、横线或下划线；它是幂等标识，不会自动执行模板');
  if(typeof title!=='string'||!title.trim()||title.length>300)throw Error('笔记标题须为 1–300 字符');
  if(typeof html!=='string'||!html.trim()||html.length>300000)throw Error('HTML 正文须为 1–300000 字符');
  if(typeof tagOnSuccess!=='boolean')throw Error('tagOnSuccess 必须是布尔值');
  if(typeof generationProfileId!=='string'||!generationProfileId.trim()||!generation||typeof generation!=='object'||Array.isArray(generation))throw Error('必须提交 Generation Profile 和深度生成记录');
  const checked=await checkDepthQC({library,parentItemKey,readingProfileId,generationProfileId,generation,html});
  const {parent,cleaned,qc}=checked;
  if(Zotero.Libraries.get(parent.libraryID)?.editable===false)throw Error('该文献库不可写');
  if(qc.status!=='DEPTH_QC_PASS'){
   await Zotero.DB.queryAsync(`INSERT OR REPLACE INTO ${DB}.reading_depth_qc_failures(library_key,parent_item_key,reading_profile_id,report_json,updated_at) VALUES(?,?,?,?,?)`,[scope,key,profile,JSON.stringify(qc),new Date().toISOString()]);
   return {status:'DEPTH_QC_FAIL',library:scope,parentItemKey:key,readingProfileId:profile,generationProfileId,depthQC:qc,noteWritten:false,parentTagged:false};
  }
  const noteHTML=`<div data-schema-version="9"><h1>${escape(title.trim())}</h1>${cleaned}</div>`;
  const lock=`${scope}:${key}:${profile}`;
  if(pending.has(lock))return pending.get(lock);
  const work=(async()=>{
   const prior=await managedNote(scope,parent,profile);
   if(prior.note&&digest(prior.note.getNote())!==prior.row.note_hash)throw Error('精读笔记在上次写入后被人工修改；拒绝覆盖，请人工核对');
   if(!prior.note){
    for(const noteID of parent.getNotes?.()||[]){
     const candidate=await Zotero.Items.getAsync(noteID);
     if(candidate?.getNoteTitle?.()===title.trim())throw Error('同名子笔记已存在但不归 ZotQuery 管理；拒绝覆盖或再建，请人工核对');
    }
   }
   const unchanged=!!prior.note&&prior.note.getNote()===noteHTML;
   let note=prior.note;
   await Zotero.DB.executeTransaction(async()=>{
    if(!note){note=new Zotero.Item('note');note.libraryID=parent.libraryID;note.parentItemID=parent.id;}
    if(!unchanged){note.setNote(noteHTML);await note.save();}
    const linked=await Zotero.DB.valueQueryAsync('SELECT parentItemID FROM itemNotes WHERE itemID=?',[note.id]);
    if(Number(linked)!==parent.id)throw Error('Zotero 未将精读笔记保存为指定条目的子笔记；事务已回滚');
    await Zotero.DB.queryAsync(`INSERT OR REPLACE INTO ${DB}.managed_child_notes(library_key,parent_item_key,reading_profile_id,note_item_key,note_hash,updated_at) VALUES(?,?,?,?,?,?)`,[scope,key,profile,note.key,digest(note.getNote()),new Date().toISOString()]);
    await Zotero.DB.queryAsync(`INSERT OR REPLACE INTO ${DB}.reading_depth_qc(library_key,parent_item_key,reading_profile_id,generation_profile_id,article_type,note_hash,report_json,updated_at) VALUES(?,?,?,?,?,?,?,?)`,[scope,key,profile,generationProfileId,qc.articleType,digest(note.getNote()),JSON.stringify(qc),new Date().toISOString()]);
    if(tagOnSuccess&&!parent.getTags().some(entry=>entry.tag==='✅精读完成')){parent.addTag('✅精读完成');await parent.save();}
    await Zotero.DB.queryAsync(`DELETE FROM ${DB}.reading_batch_failures WHERE library_key=? AND parent_item_key=? AND reading_profile_id=?`,[scope,key,profile]);
    await Zotero.DB.queryAsync(`DELETE FROM ${DB}.reading_depth_qc_failures WHERE library_key=? AND parent_item_key=? AND reading_profile_id=?`,[scope,key,profile]);
   });
   return {status:tagOnSuccess?'completed':'written_unmarked',created:!prior.note,updated:!!prior.note&&!unchanged,alreadyCurrent:unchanged,library:scope,parentItemKey:key,readingProfileId:profile,generationProfileId,noteItemKey:note.key,noteLink:noteLink(scope,note.key),parentTagged:tagOnSuccess,depthQC:qc,
    rule:'Depth QC passed before managed-note upsert. The completion tag is applied after note save in the same transaction; readingProfileId remains the idempotency namespace.'};
  })();
  pending.set(lock,work);try{return await work;}finally{pending.delete(lock);}
 }
 async function setItemTag({library,parentItemKey,readingProfileId,tag}={}){
  const scope=String(library||''),key=String(parentItemKey||''),profile=String(readingProfileId||'');
  if(tag!=='✅精读完成')throw Error('只允许设置 ✅精读完成 标签');
  if(!validProfile(profile))throw Error('readingProfileId 无效');
  const parent=await regularParent(scope,key);
  if(Zotero.Libraries.get(parent.libraryID)?.editable===false)throw Error('该文献库不可写');
  const {row,note}=await managedNote(scope,parent,profile);
  if(!note)throw Error('该 profile 尚无 ZotQuery 管理的子笔记；不能标记精读完成');
  if(digest(note.getNote())!==row.note_hash)throw Error('精读笔记在上次写入后被人工修改；不能自动标记完成');
  const qc=await depthQC(scope,key,profile);
  if(!qc.passed||qc.passed.note_hash!==digest(note.getNote()))throw Error('该笔记没有通过当前内容的 Depth QC；不能标记精读完成');
  const alreadyTagged=parent.getTags().some(entry=>entry.tag===tag);
  if(!alreadyTagged){parent.addTag(tag);await parent.saveTx();}
  return {library:scope,parentItemKey:key,readingProfileId:profile,tag,alreadyTagged,noteItemKey:note.key};
 }
 async function addItemTag({library,parentItemKey,tag}={}){
  const scope=String(library||''),key=String(parentItemKey||'');
  if(typeof tag!=='string'||!tag.trim()||tag!==tag.trim()||tag.length>100||/[\u0000-\u001f\u007f]/.test(tag))throw Error('tag 须为 1–100 个可见字符，且首尾不能有空格');
  if(tag==='✅精读完成')throw Error('✅精读完成 必须通过 Depth QC 后使用 set_item_tag 或托管笔记写入');
  const parent=await regularParent(scope,key);
  if(Zotero.Libraries.get(parent.libraryID)?.editable===false)throw Error('该文献库不可写');
  const alreadyTagged=parent.getTags().some(entry=>entry.tag===tag);
  if(!alreadyTagged){parent.addTag(tag);await parent.saveTx();}
  return {library:scope,parentItemKey:key,tag,alreadyTagged,added:!alreadyTagged};
 }
 async function collectionItems({library='user',collectionKey,offset=0,limit=10,readingProfileId}={}){
  const scope=String(library),id=libraryID(scope),profile=String(readingProfileId||'');
  if(!itemKeyPattern.test(String(collectionKey||'')))throw Error('collectionKey 必须是八位 Zotero collection key');
  if(!validProfile(profile))throw Error('readingProfileId 无效');
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>10)throw Error('分页必须为 offset≥0、limit 1–10');
  const collectionID=Zotero.Collections.getIDFromLibraryAndKey(id,collectionKey);
  const collection=collectionID?await Zotero.Collections.getAsync(collectionID):null;
  if(!collection||collection.deleted||collection.libraryID!==id)throw Error('collection 不存在或不属于指定文献库');
  const ids=collection.getChildItems(true).filter(itemID=>!!itemID);
  const parents=[];
  for(const itemID of ids){const item=await Zotero.Items.getAsync(itemID);if(item?.isRegularItem?.()&&!item.deleted)parents.push(item);}
  parents.sort((a,b)=>a.key.localeCompare(b.key));
  const page=parents.slice(offset,offset+limit),results=[];
  for(const parent of page){
   let row=null,note=null,managedConflict=null;
   try{({row,note}=await managedNote(scope,parent,profile));}catch(error){managedConflict=String(error?.message||error);}
   const tags=parent.getTags?.()||[];
   const tagged=tags.some(entry=>entry.tag==='✅精读完成');
   const pdfIDs=parent.getAttachments?.()||[];
   let hasPDF=false;
   for(const attachmentID of pdfIDs){const a=await Zotero.Items.getAsync(attachmentID);if(a?.attachmentContentType==='application/pdf'&&!a.deleted){hasPDF=true;break;}}
   const failure=(await Zotero.DB.queryAsync(`SELECT reason,attempts,updated_at FROM ${DB}.reading_batch_failures WHERE library_key=? AND collection_key=? AND parent_item_key=? AND reading_profile_id=?`,[scope,collectionKey,parent.key,profile]))[0];
   if(note&&digest(note.getNote())!==row.note_hash)managedConflict='已管理笔记被人工修改';
   const qc=await depthQC(scope,parent.key,profile);
   const qcCurrent=!!note&&qc.passed?.note_hash===digest(note.getNote());
   const status=managedConflict?'managed_note_conflict':note?(qcCurrent?(tagged?'completed':'written_unmarked'):'legacy_unverified'):(tagged?'externally_tagged':qc.failed?'depth_qc_failed':failure?'failed':hasPDF?'pending':'missing_pdf');
   results.push({itemKey:parent.key,title:String(parent.getField?.('title')||''),status,hasPDF,tagged,noteItemKey:note?.key||null,noteLink:note?noteLink(scope,note.key):null,existingChildNoteCount:(parent.getNotes?.()||[]).length,managedConflict,generation:qc.passed?{profileId:qc.passed.generation_profile_id,articleType:qc.passed.article_type}:null,depthQC:{status:qcCurrent?'DEPTH_QC_PASS':qc.failed?'DEPTH_QC_FAIL':'NOT_ASSESSED',report:qcCurrent?JSON.parse(qc.passed.report_json):qc.failed?JSON.parse(qc.failed.report_json):null},failure:failure?{reason:failure.reason,attempts:failure.attempts,updatedAt:failure.updated_at}:null});
  }
  return {library:scope,collectionKey,readingProfileId:profile,offset,limit,total:parents.length,results,nextOffset:offset+page.length<parents.length?offset+page.length:null,
   rule:'Only completed means a ZotQuery-managed note, matching passed Depth QC, and parent completion tag all exist. Legacy tagged notes are shown as legacy_unverified and never modified automatically.'};
 }
 async function recordBatchFailure({library='user',collectionKey,parentItemKey,readingProfileId,reason}={}){
  const scope=String(library),key=String(parentItemKey||''),profile=String(readingProfileId||'');
  if(!itemKeyPattern.test(String(collectionKey||''))||!validProfile(profile))throw Error('collectionKey 或 readingProfileId 无效');
  await regularParent(scope,key);
  if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw Error('失败原因须为 1–1000 字符');
  const collectionID=Zotero.Collections.getIDFromLibraryAndKey(libraryID(scope),collectionKey),collection=collectionID?await Zotero.Collections.getAsync(collectionID):null;
  if(!collection||!collection.getChildItems(true).some(id=>Zotero.Items.get(id)?.key===key))throw Error('目标条目不在指定 collection 中');
  await Zotero.DB.queryAsync(`INSERT INTO ${DB}.reading_batch_failures(library_key,collection_key,parent_item_key,reading_profile_id,reason,attempts,updated_at) VALUES(?,?,?,?,?,1,?) ON CONFLICT(library_key,collection_key,parent_item_key,reading_profile_id) DO UPDATE SET reason=excluded.reason,attempts=attempts+1,updated_at=excluded.updated_at`,[scope,collectionKey,key,profile,reason.trim(),new Date().toISOString()]);
  return {recorded:true,library:scope,collectionKey,parentItemKey:key,readingProfileId:profile};
 }
 const argLibrary={type:'string',pattern:'^(user|group:[1-9][0-9]*)$'};
 const argKey={type:'string',pattern:'^[A-Z0-9]{8}$'};
 const argProfile={type:'string',minLength:1,maxLength:80};
 const argHTML={type:'string',minLength:1,maxLength:300000};
 const toolDefinitions=()=>[
  {name:'get_selected_items',description:'Read the current Zotero desktop selection. Returns stable library/item keys and, for a selected attachment or note, its regular parent key. Selection may change; use explicit keys for later writes.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'create_child_note',description:'Create one ordinary Zotero child note under an explicit regular parent item. This WRITES to the Zotero library, never overwrites an existing note, verifies the parent relation, and deduplicates an identical retry. Obtain user authorization before calling. html is the note body without the title heading; tags apply to the new note only.',inputSchema:{type:'object',properties:{library:{type:'string',pattern:'^(user|group:[1-9][0-9]*)$'},parentItemKey:{type:'string',pattern:'^[A-Z0-9]{8}$'},title:{type:'string',minLength:1,maxLength:300},html:{type:'string',minLength:1,maxLength:300000},tags:{type:'array',maxItems:12,items:{type:'string',minLength:1,maxLength:100}}},required:['library','parentItemKey','title','html'],additionalProperties:false}},
  {name:'reading_batch_status',description:'Page 1–10 regular parent items in one Zotero collection in stable key order. Shows PDF availability, managed-note completion, external tags and recorded failures. Read-only; page to nextOffset=null.',inputSchema:{type:'object',properties:{library:argLibrary,collectionKey:argKey,readingProfileId:argProfile,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:10}},required:['collectionKey','readingProfileId'],additionalProperties:false}},
  {name:'reading_generation_profile',description:'Read the independent Generation Profile, its three article-type branches, and the exact Generation submission schema. Does not modify Zotero or the Note Parsing Profile.',inputSchema:{type:'object',properties:{generationProfileId:argProfile},additionalProperties:false}},
  {name:'depth_qc_preview',description:'Read-only Depth QC preflight with the same source-PDF and content checks as upsert. Returns exact missing generation paths and reasons; does not write a note, tag or failure record.',inputSchema:{type:'object',properties:{library:argLibrary,parentItemKey:argKey,readingProfileId:argProfile,generationProfileId:argProfile,generation:Zotero.ZotQueryReadingGeneration?.submissionSchema?.()||{type:'object'},html:argHTML},required:['library','parentItemKey','readingProfileId','generationProfileId','generation','html'],additionalProperties:false}},
  {name:'upsert_child_note',description:'WRITE a managed note only after the independent Generation Profile Depth QC passes. Supply the exact generation schema available from reading_generation_profile; call depth_qc_preview first. A failure records DEPTH_QC_FAIL without note or completion tag. readingProfileId remains the idempotency namespace.',inputSchema:{type:'object',properties:{library:argLibrary,parentItemKey:argKey,readingProfileId:argProfile,generationProfileId:argProfile,generation:Zotero.ZotQueryReadingGeneration?.submissionSchema?.()||{type:'object'},title:{type:'string',minLength:1,maxLength:300},html:argHTML,tagOnSuccess:{type:'boolean'}},required:['library','parentItemKey','readingProfileId','generationProfileId','generation','title','html'],additionalProperties:false}},
  {name:'set_item_tag',description:'WRITE only the ✅精读完成 tag on an explicit parent item, and only if a ZotQuery-managed child note exists for the given readingProfileId. Obtain user approval.',inputSchema:{type:'object',properties:{library:argLibrary,parentItemKey:argKey,readingProfileId:argProfile,tag:{type:'string',enum:['✅精读完成']}},required:['library','parentItemKey','readingProfileId','tag'],additionalProperties:false}},
  {name:'add_item_tag',description:'Add any ordinary Zotero tag to an explicit regular parent item, including Chinese tags. Idempotent; never removes tags. The reserved ✅精读完成 tag remains gated by Depth QC and is rejected here.',inputSchema:{type:'object',properties:{library:{type:'string',pattern:'^(user|group:[1-9][0-9]*)$'},parentItemKey:{type:'string',pattern:'^[A-Z0-9]{8}$'},tag:{type:'string',minLength:1,maxLength:100}},required:['library','parentItemKey','tag'],additionalProperties:false}},
  {name:'reading_batch_record_failure',description:'Record a per-item batch failure reason without modifying Zotero items; this changes ZotQuery batch state and requires approval. Retry remains possible.',inputSchema:{type:'object',properties:{library:argLibrary,collectionKey:argKey,parentItemKey:argKey,readingProfileId:argProfile,reason:{type:'string',minLength:1,maxLength:1000}},required:['collectionKey','parentItemKey','readingProfileId','reason'],additionalProperties:false}}
 ];
 Zotero.ZotQueryNotes={startup,selectedItems,createChildNote,upsertChildNote,depthQCPreview,setItemTag,addItemTag,collectionItems,recordBatchFailure,toolDefinitions,callTool:(name,args)=>({get_selected_items:selectedItems,create_child_note:createChildNote,upsert_child_note:upsertChildNote,depth_qc_preview:depthQCPreview,set_item_tag:setItemTag,add_item_tag:addItemTag,reading_batch_status:collectionItems,reading_generation_profile:generationProfile,reading_batch_record_failure:recordBatchFailure}[name]||(()=>{throw Error('Unknown note/batch tool')}))(args)};
})(typeof _globalThis!=='undefined'?_globalThis:this);
