import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import test from 'node:test';

const source=fs.readFileSync(new URL('../content/scripts/research-engine.js',import.meta.url),'utf8');
const start=source.indexOf('  async function startVisualPaperSession(');
const end=source.indexOf('  async function documentCoverage(',start);
assert.ok(start>0&&end>start);

test('exact parent key starts an image session when duplicate title and search index are unusable',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec("ATTACH DATABASE ':memory:' AS zotqueryresearch;CREATE TABLE zotqueryresearch.sessions(session_id TEXT PRIMARY KEY,question TEXT,created_at TEXT,updated_at TEXT,status TEXT,query_json TEXT,question_mode TEXT,reading_policy TEXT,coverage_version TEXT);CREATE TABLE zotqueryresearch.positions(position_id TEXT PRIMARY KEY,session_id TEXT,source TEXT,work_key TEXT,library_key TEXT,item_key TEXT,title TEXT,match_kind TEXT,preview TEXT,review_status TEXT,coverage_required INTEGER,position_role TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE zotqueryresearch.visual_session_targets(library_key TEXT,parent_item_key TEXT,attachment_key TEXT,session_id TEXT,position_id TEXT,PRIMARY KEY(library_key,parent_item_key,attachment_key))");
  const pdfA={key:'PDF00001',deleted:false,isPDFAttachment:()=>true,getFilePathAsync:async()=>'/local/a.pdf'};
  const pdfB={key:'PDF00002',deleted:false,isPDFAttachment:()=>true,getFilePathAsync:async()=>'/local/b.pdf'};
  const parentA={key:'PARENT01',libraryID:1,deleted:false,isRegularItem:()=>true,getAttachments:()=>[11],getField:()=> 'Identical complete title'};
  const parentB={key:'PARENT02',libraryID:1,deleted:false,isRegularItem:()=>true,getAttachments:()=>[12],getField:()=> 'Identical complete title'};
  const items=new Map([[1,parentA],[2,parentB],[11,pdfA],[12,pdfB]]);
  const queryAsync=async(sql,args=[])=>{const statement=db.prepare(sql);return statement.columns().length?statement.all(...args):statement.run(...args);};
  const context={RDB:'zotqueryresearch',ensureResearchSchema:async()=>{},rid:()=>`rs-${randomUUID()}`,now:()=>new Date().toISOString(),Services:{uuid:{generateUUID:()=>randomUUID()}},Zotero:{Libraries:{userLibraryID:1},Groups:{getLibraryIDFromGroupID:()=>null},Items:{getIDFromLibraryAndKey:(_id,key)=>key==='PARENT01'?1:key==='PARENT02'?2:null,getAsync:async value=>Array.isArray(value)?value.map(id=>items.get(id)):items.get(value)},DB:{queryAsync,executeTransaction:async fn=>{db.exec('BEGIN');try{const result=await fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.open=startVisualPaperSession;',context);
  const result=await context.open({library:'user',parentItemKey:'PARENT02'});
  assert.equal(result.attachmentKey,'PDF00002');assert.equal(result.visualOnly,true);assert.equal(result.synthesisAllowed,false);
  assert.equal(db.prepare('SELECT item_key FROM zotqueryresearch.positions WHERE position_id=?').get(result.positionId).item_key,'PARENT02');
  assert.equal(db.prepare('SELECT coverage_required FROM zotqueryresearch.positions WHERE position_id=?').get(result.positionId).coverage_required,0);
  assert.equal((await context.open({library:'user',parentItemKey:'PARENT02'})).sessionId,result.sessionId);
  await assert.rejects(context.open({library:'user',parentItemKey:'PARENT02',attachmentKey:'PDF00001'}),/候选/);
  await assert.rejects(context.open({library:'user',parentItemKey:'UNKNOWN1'}),/不存在/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM zotqueryresearch.sessions').get().n,1);
 }finally{db.close();}
});
