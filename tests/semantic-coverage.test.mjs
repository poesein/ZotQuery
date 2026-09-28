import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import test from 'node:test';

const source=fs.readFileSync(new URL('../content/scripts/lne-native.js',import.meta.url),'utf8');
const expression=source.match(/SELECT COUNT\(DISTINCT s\.hash\)[\s\S]*?v\.embedding IS NOT NULL/)?.[0];
assert.ok(expression,'health must count current hashes with model-matched vectors');
const sql=expression.replaceAll('${DB_ALIAS}','main');

test('semantic coverage excludes historical cached vectors and wrong dimensions',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE segments(hash TEXT); CREATE TABLE segment_vectors(hash TEXT,model_id TEXT,dim INTEGER,embedding TEXT)');
  db.exec("INSERT INTO segments VALUES ('current-a'),('current-a'),('current-b')");
  db.exec("INSERT INTO segment_vectors VALUES ('current-a','m',1024,'a'),('current-b','m',1024,'b'),('old-hash','m',1024,'c')");
  const count=()=>Object.values(db.prepare(sql).get('m',1024))[0];
  assert.equal(count(),2,'cache rows absent from current segments do not increase coverage');
  db.exec("UPDATE segment_vectors SET dim=512 WHERE hash='current-b'");
  assert.equal(count(),1,'a vector with a wrong dimension does not count as covered');
 }finally{db.close();}
});
