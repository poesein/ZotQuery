import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import test from 'node:test';

const source=fs.readFileSync(new URL('../content/scripts/library-note-tools.js',import.meta.url),'utf8');
const generationSource=fs.readFileSync(new URL('../content/scripts/reading-generation.js',import.meta.url),'utf8');
const generationProfile=fs.readFileSync(new URL('../content/profiles/generation/strawberry-vnext-depth.json',import.meta.url),'utf8');
const generationSchema=fs.readFileSync(new URL('../content/profiles/generation/strawberry-vnext-depth.schema.json',import.meta.url),'utf8');
const reviewGeneration={articleType:'review',originalStudies:[
 {citation:'Original experimental study Alpha 2001',contribution:'Direct mechanism evidence in tested cells',sourceLocator:'Review references 1, PDF page 4'},
 {citation:'Original experimental study Beta 2002',contribution:'Independent perturbation and rescue results',sourceLocator:'Review references 2, PDF page 5'}]};
const reviewHTML=Object.values(JSON.parse(generationProfile).branches.review.requiredSections).map(aliases=>`<h2>${aliases[0]}</h2><p>${'来源、实验条件和证据边界均需逐一核对。'.repeat(7)}</p>`).join('')+`<p>${reviewGeneration.originalStudies.map(s=>s.citation).join('；')}</p>`;
const text=value=>({nodeType:3,nodeValue:value});
const element=(name,children=[],attrs={})=>({nodeType:1,localName:name,childNodes:children,getAttribute:key=>attrs[key]||null});
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec("ATTACH DATABASE ':memory:' AS zotqueryresearch;CREATE TABLE itemNotes(itemID INTEGER PRIMARY KEY,parentItemID INTEGER,note TEXT)");
 const state={saved:1,wrongParent:false,selection:[],notes:new Map(),parentTags:[],pdf:true};
 const parent={id:1,key:'PARENT01',libraryID:1,itemTypeID:2,isRegularItem:()=>true,getField:()=> 'Example article',
  getNotes:()=>[...state.notes.values()].filter(note=>note.parentItemID===1).map(note=>note.id),getAttachments:()=>state.pdf?[9]:[],getTags:()=>state.parentTags.map(tag=>({tag})),addTag:tag=>state.parentTags.push(tag),save:async()=>1,saveTx:async()=>1};
 const pdf={id:9,key:'PDFITEM1',libraryID:1,attachmentContentType:'application/pdf'};
 state.selection=[parent];
 class Note{
  constructor(type){assert.equal(type,'note');this.tags=[];}
  setNote(value){this.html=value;}
  getNote(){return this.html;}
  getNoteTitle(){return this.html?.match(/<h1>(.*?)<\/h1>/)?.[1]||'';}
  addTag(value){this.tags.push(value);}
  isNote(){return true;}
  async save(){if(!this.id){this.id=++state.saved;this.key=`NOTE${String(this.id).padStart(4,'0')}`;db.prepare('INSERT INTO itemNotes VALUES(?,?,?)').run(this.id,state.wrongParent?null:this.parentItemID,this.html);}else{db.prepare('UPDATE itemNotes SET note=? WHERE itemID=?').run(this.html,this.id);}state.notes.set(this.key,this);return this.id;}
 }
 const query=async(sql,args=[])=>{const s=db.prepare(sql);return s.columns().length?s.all(...args):s.run(...args);};
 const box={Zotero:{
  DB:{queryAsync:query,valueQueryAsync:async(sql,args=[])=>db.prepare(sql).get(...args)?.parentItemID,executeTransaction:async(fn)=>{db.exec('BEGIN');try{const result=await fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}},
  Item:Note,Items:{getIDFromLibraryAndKey:(id,key)=>id===1&&key==='PARENT01'?1:[...state.notes.values()].find(n=>n.key===key)?.id,
   getAsync:async id=>id===1?parent:id===9?pdf:[...state.notes.values()].find(n=>n.id===id),get:id=>id===1?parent:null},
  Collections:{getIDFromLibraryAndKey:(id,key)=>id===1&&key==='COLLECT1'?3:null,getAsync:async id=>id===3?{id:3,key:'COLLECT1',libraryID:1,getChildItems:()=>[1]}:null},
  Libraries:{userLibraryID:1,get:()=>({editable:true})},Groups:{getLibraryIDFromGroupID:()=>null,getGroupIDFromLibraryID:()=>null},
  ItemTypes:{getName:()=> 'journalArticle'},getActiveZoteroPane:()=>({getSelectedItems:()=>state.selection}),
  getMainWindow:()=>({DOMParser:class{parseFromString(input){const plain=input.replace(/<[^>]*>/g,'');const children=input.includes('unsafe')?[element('p',[text('Safe'),element('script',[text('bad')]),element('a',[text('link')],{href:'javascript:alert(1)'}),element('img',[],{src:'https://remote.invalid/tracker'})])]:[...input.matchAll(/<(h[1-6]|p)>(.*?)<\/\1>/gs)].map(m=>element(m[1],[text(m[2])]));if(!children.length&&!input.includes('unsafe'))children.push(element('p',[text(plain)]));const body=element('body',children);body.textContent=input.includes('unsafe')?'Safebadlink':plain;return{body};}}}),
  File:{getResourceAsync:async url=>url.endsWith('.schema.json')?generationSchema:generationProfile},
  Utilities:{Internal:{md5:value=>createHash('md5').update(value).digest('hex')}}
 },_globalThis:null,Date};box._globalThis=box;
 vm.createContext(box);vm.runInContext(generationSource,box);vm.runInContext(source,box);
 const api=box.Zotero.ZotQueryNotes,startup=api.startup;
 api.startup=async()=>{await box.Zotero.ZotQueryReadingGeneration.startup({rootURI:'test://'});await startup();};
 return {api,state,db,parent};
}

test('selection returns explicit library, item key and regular parent key',async()=>{
 const f=fixture();try{
  await f.api.startup();
  const selected=await f.api.selectedItems();
  assert.equal(selected.results[0].itemKey,'PARENT01');assert.equal(selected.results[0].library,'user');
  assert.equal(selected.results[0].isRegularItem,true);
 }finally{f.db.close();}
});

test('ordinary parent tags are idempotent while completion remains Depth QC gated',async()=>{
 const f=fixture();try{
  await f.api.startup();
  const args={library:'user',parentItemKey:'PARENT01',tag:'PI3Kα／IRS1'};
  assert.equal((await f.api.addItemTag(args)).added,true);
  assert.equal((await f.api.addItemTag(args)).alreadyTagged,true);
  assert.deepEqual(f.state.parentTags,['PI3Kα／IRS1']);
  await assert.rejects(f.api.addItemTag({...args,tag:'✅精读完成'}),/Depth QC/);
  await assert.rejects(f.api.addItemTag({...args,tag:' bad '}),/首尾/);
  await assert.rejects(f.api.addItemTag({...args,parentItemKey:'MISSING1'}),/不存在/);
  assert.deepEqual(f.state.parentTags,['PI3Kα／IRS1']);
 }finally{f.db.close();}
});

test('child note is sanitized, tagged, parent-linked and idempotent',async()=>{
 const f=fixture();try{
  await f.api.startup();
  const args={library:'user',parentItemKey:'PARENT01',title:'精读笔记',html:'unsafe',tags:['✅精读完成']};
  const first=await f.api.createChildNote(args);
  assert.equal(first.created,true);assert.equal(first.noteItemKey,'NOTE0002');
  assert.equal(f.db.prepare('SELECT parentItemID FROM itemNotes').get().parentItemID,1);
  const note=f.state.notes.get('NOTE0002');
  assert.deepEqual(note.tags,['✅精读完成']);
  assert.match(note.html,/精读笔记/);assert.match(note.html,/Safe/);
  assert.doesNotMatch(note.html,/script|img|onclick|javascript:|tracker|bad/);
  const again=await f.api.createChildNote(args);
  assert.equal(again.created,false);assert.equal(again.alreadyExists,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM itemNotes').get().n,1);
 }finally{f.db.close();}
});

test('invalid target and failed parent linkage never leave a note or receipt',async()=>{
 const f=fixture();try{
  await f.api.startup();
  const args={library:'user',parentItemKey:'PARENT01',title:'Read',html:'<p>Answer</p>'};
  await assert.rejects(f.api.createChildNote({...args,parentItemKey:'BAD'}),/parentItemKey/);
  await assert.rejects(f.api.createChildNote({...args,library:'group:999'}),/不存在/);
  f.state.wrongParent=true;
  await assert.rejects(f.api.createChildNote(args),/事务已回滚/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM itemNotes').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM zotqueryresearch.child_note_receipts').get().n,0);
 }finally{f.db.close();}
});

test('managed upsert is idempotent, updates only its own note, and tags parent after save',async()=>{
 const f=fixture();try{
  await f.api.startup();
  const args={library:'user',parentItemKey:'PARENT01',readingProfileId:'strawberry-vnext',generationProfileId:'strawberry-vnext-depth',generation:reviewGeneration,title:'精读笔记',html:reviewHTML};
  const first=await f.api.upsertChildNote(args);
  assert.equal(first.created,true);assert.deepEqual(f.state.parentTags,['✅精读完成']);
  const again=await f.api.upsertChildNote(args);
  assert.equal(again.alreadyCurrent,true);assert.equal(f.state.notes.size,1);
  const status=await f.api.collectionItems({collectionKey:'COLLECT1',readingProfileId:'strawberry-vnext'});
  assert.equal(status.results[0].status,'completed');assert.equal(status.nextOffset,null);
  const updated=await f.api.upsertChildNote({...args,html:reviewHTML.replace('逐一核对','仔细核对')});
  assert.equal(updated.updated,true);assert.equal(f.state.notes.size,1);
  f.state.notes.get(first.noteItemKey).setNote('<p>User edited</p>');
  await assert.rejects(f.api.upsertChildNote(args),/人工修改/);
 }finally{f.db.close();}
});

test('batch failure is resumable, missing PDF is visible, and unmanaged same-title note is protected',async()=>{
 const f=fixture();try{
  await f.api.startup();
  const args={library:'user',parentItemKey:'PARENT01',readingProfileId:'strawberry-vnext',generationProfileId:'strawberry-vnext-depth',generation:reviewGeneration,title:'精读笔记',html:reviewHTML};
  await f.api.recordBatchFailure({collectionKey:'COLLECT1',parentItemKey:'PARENT01',readingProfileId:'strawberry-vnext',reason:'PDF read timeout'});
  assert.equal((await f.api.collectionItems({collectionKey:'COLLECT1',readingProfileId:'strawberry-vnext'})).results[0].status,'failed');
  f.state.pdf=false;
  assert.equal((await f.api.collectionItems({collectionKey:'COLLECT1',readingProfileId:'strawberry-vnext'})).results[0].status,'failed');
  await assert.rejects(f.api.setItemTag({...args,tag:'✅精读完成'}),/尚无/);
  const note={id:8,key:'NOTE0008',parentItemID:1,getNoteTitle:()=> '精读笔记',isNote:()=>true};f.state.notes.set(note.key,note);
  await assert.rejects(f.api.upsertChildNote(args),/同名子笔记/);
  f.state.notes.delete(note.key);
  const saved=await f.api.upsertChildNote(args);
  assert.equal(saved.created,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM zotqueryresearch.reading_batch_failures').get().n,0);
 }finally{f.db.close();}
});

test('Depth QC failure blocks both managed note and completion tag, then passing retry completes',async()=>{
 const f=fixture();try{
  await f.api.startup();
  const base={library:'user',parentItemKey:'PARENT01',readingProfileId:'strawberry-vnext',generationProfileId:'strawberry-vnext-depth',generation:reviewGeneration,title:'精读笔记'};
  const failed=await f.api.upsertChildNote({...base,html:'<h2>综述定位</h2><p>太短</p>'});
  assert.equal(failed.status,'DEPTH_QC_FAIL');assert.equal(failed.noteWritten,false);
  assert.equal(f.state.notes.size,0);assert.deepEqual(f.state.parentTags,[]);
  const status=await f.api.collectionItems({collectionKey:'COLLECT1',readingProfileId:'strawberry-vnext'});
  assert.equal(status.results[0].status,'depth_qc_failed');
  assert.ok(status.results[0].depthQC.report.reasons.includes('SECTION_SHALLOW:position'));
  const wrongPDF=await f.api.upsertChildNote({...base,generation:{articleType:'original_research',fullTextRead:{attachmentKey:'WRONGPDF',totalCharacters:1,chunks:[{offset:0,length:1,nextOffset:null}]}},html:reviewHTML});
  assert.ok(wrongPDF.depthQC.reasons.includes('SOURCE_PDF_NOT_PARENT_ATTACHMENT'));
  assert.equal(f.state.notes.size,0);
  const passed=await f.api.upsertChildNote({...base,html:reviewHTML,tagOnSuccess:false});
  assert.equal(passed.depthQC.status,'DEPTH_QC_PASS');assert.equal(passed.parentTagged,false);
  assert.equal((await f.api.collectionItems({collectionKey:'COLLECT1',readingProfileId:'strawberry-vnext'})).results[0].status,'written_unmarked');
  await f.api.setItemTag({...base,tag:'✅精读完成'});
  assert.equal((await f.api.collectionItems({collectionKey:'COLLECT1',readingProfileId:'strawberry-vnext'})).results[0].status,'completed');
 }finally{f.db.close();}
});

test('Depth QC preview uses the upsert gate without writing any batch or Zotero state',async()=>{
 const f=fixture();try{
  await f.api.startup();
  const base={library:'user',parentItemKey:'PARENT01',readingProfileId:'strawberry-vnext',generationProfileId:'strawberry-vnext-depth',generation:reviewGeneration,html:reviewHTML};
  const profile=f.api.toolDefinitions().find(tool=>tool.name==='upsert_child_note');
  assert.ok(profile.inputSchema.properties.generation.properties.fullTextRead);
  assert.ok(f.api.toolDefinitions().some(tool=>tool.name==='depth_qc_preview'));
  const passed=await f.api.depthQCPreview(base);
  assert.equal(passed.status,'DEPTH_QC_PASS');assert.equal(passed.previewOnly,true);
  const failed=await f.api.depthQCPreview({...base,generation:{articleType:'original_research',fullTextTrace:{reads:[]}}});
  assert.equal(failed.status,'DEPTH_QC_FAIL');
  assert.ok(failed.depthQC.reasons.includes('SCHEMA_UNKNOWN:generation.fullTextTrace'));
  assert.ok(failed.depthQC.reasons.includes('SCHEMA_REQUIRED:generation.fullTextRead'));
  assert.equal(f.state.notes.size,0);assert.deepEqual(f.state.parentTags,[]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM zotqueryresearch.reading_depth_qc_failures').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM zotqueryresearch.reading_depth_qc').get().n,0);
 }finally{f.db.close();}
});
