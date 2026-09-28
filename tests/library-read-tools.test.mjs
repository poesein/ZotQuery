import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source=fs.readFileSync(new URL('../content/scripts/library-read-tools.js',import.meta.url),'utf8');
function fixture(reply){
 const calls=[];
 const Zotero={Server:{port:23119},HTTP:{request:async(method,url,options)=>{
  calls.push({method,url:new URL(url),options});
  return {status:200,response:reply,getResponseHeader:()=>String(Array.isArray(reply)?reply.length:0)};
 }}};
 vm.runInNewContext(source,{Zotero,URL,JSON,Number,Error,Object,String});
 return {library:Zotero.ZotQueryLibrary,calls};
}

test('native library navigation exposes seven read-only stable-key tools',()=>{
 const {library}=fixture([]);
 const definitions=library.toolDefinitions();
 assert.equal(definitions.length,7);
 assert.ok(definitions.every(tool=>tool.name.startsWith('library_')));
 assert.equal(definitions.find(tool=>tool.name==='library_get_item').inputSchema.properties.itemKey.pattern,'^[A-Z0-9]{8}$');
});

test('collection browsing uses local Zotero API with bounded scope and paging',async()=>{
 const {library,calls}=fixture([{key:'9MSCFEL6'}]);
 const result=await library.callTool('library_get_collection_items',{library:'group:12',collectionKey:'ABCDEFGH',offset:5,limit:10});
 assert.equal(calls[0].method,'GET');
 assert.equal(calls[0].url.pathname,'/api/groups/12/collections/ABCDEFGH/items/top');
 assert.equal(calls[0].url.searchParams.get('start'),'5');
 assert.equal(calls[0].options.headers['Zotero-Allowed-Request'],'1');
 assert.equal(result.navigationOnly,true);
 assert.equal(result.results[0].key,'9MSCFEL6');
 await assert.rejects(library.callTool('library_get_item',{library:'group:0',itemKey:'9MSCFEL6'}),/Invalid library read field: library/);
 await assert.rejects(library.callTool('library_get_item',{itemKey:'../../etc'}),/Invalid library read field: itemKey/);
 await assert.rejects(library.callTool('library_get_collection_items',{collectionKey:'ABCDEFGH',limit:5000}),/Invalid library read field: limit/);
 await assert.rejects(library.callTool('library_get_item',{itemKey:'9MSCFEL6',delete:true}),/Unknown library read field/);
});

test('fulltext pages through terminal null without changing Zotero state',async()=>{
 const {library,calls}=fixture({content:'abcdefghij',indexedPages:1,totalPages:1});
 const first=await library.callTool('library_read_attachment_fulltext',{itemKey:'LSJ9R28W',offset:0,limit:4});
 const last=await library.callTool('library_read_attachment_fulltext',{itemKey:'LSJ9R28W',offset:8,limit:4});
 assert.equal(first.text,'abcd');assert.equal(first.nextOffset,4);
 assert.equal(last.text,'ij');assert.equal(last.nextOffset,null);
 assert.ok(calls.every(call=>call.method==='GET'&&call.url.pathname==='/api/users/0/items/LSJ9R28W/fulltext'));
});
