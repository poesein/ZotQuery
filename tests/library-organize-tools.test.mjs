import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source=fs.readFileSync(new URL('../content/scripts/library-organize-tools.js',import.meta.url),'utf8');
function fixture(){
 let saves=0,tx=0,seq=0;
 const byID=new Map(),byKey=new Map(),collections=new Map();
 const makeItem=(id,key,title,doi='')=>{
  const fields={title,DOI:doi,extra:'Other: keep this'};
  const item={id,key,libraryID:1,deleted:false,dateModified:'fixed',itemType:'journalArticle',
   _tags:[{tag:'# 分子/IRS1',type:0}],_collections:[10],isRegularItem:()=>true,
   getField:k=>fields[k]||'',setField:(k,v)=>{fields[k]=v},getTags(){return this._tags},setTags(v){this._tags=v},getCollections(){return this._collections},setCollections(v){this._collections=v},addTag(v){this._tags.push({tag:v,type:0})},setCreators(v){this.creators=v},async save(){saves++;return this.id}};
  byID.set(id,item);byKey.set(key,item);return item;
 };
 makeItem(1,'AAAAAAAA','Existing paper','10.1/existing');
 collections.set('CCCCCCCC',{id:10,key:'CCCCCCCC',name:'Old',parentID:null,libraryID:1,deleted:false,getChildItems:()=>[1]});
 collections.set('DDDDDDDD',{id:11,key:'DDDDDDDD',name:'New',parentID:null,libraryID:1,deleted:false,getChildItems:()=>[]});
 const Zotero={Libraries:{userLibraryID:1,get:()=>({editable:true})},Groups:{getLibraryIDFromGroupID:()=>null},
  Items:{getIDFromLibraryAndKey:(_id,k)=>byKey.get(k)?.id,getAsync:async id=>byID.get(id),get:id=>byID.get(id),getAll:async()=>[...byID.values()]},
  Collections:{getIDFromLibraryAndKey:(_id,k)=>collections.get(k)?.id,getAsync:async id=>[...collections.values()].find(x=>x.id===id),getByLibrary:async()=>[...collections.values()]},
  ItemTypes:{getID:()=>1},ItemFields:{getID:()=>1,isValidForType:()=>true},Prefs:{get:()=> 'extra'},DB:{executeTransaction:async fn=>{tx++;return fn()}},
  Item:function(type){const item=makeItem(20+seq++,`NEW${String(seq).padStart(5,'0')}`,'');item.itemType=type;return item},
  Collection:function(){this.libraryID=1;this.deleted=false;this.save=async()=>{this.id=30+seq++;this.key=`COL${String(seq).padStart(5,'0')}`;collections.set(this.key,this);saves++}} ,
  Search:function(){this.addCondition=(field,_op,value)=>{this.field=field;this.value=value};this.search=async()=>[...byID.values()].filter(x=>x.getField(this.field)===this.value).map(x=>x.id)}
 };
 const Services={uuid:{generateUUID:()=>`{plan-${++seq}-xxxxxxxx}`}};
 vm.runInNewContext(source,{Zotero,Services});
 return {api:Zotero.ZotQueryOrganizer,byKey,collections,stats:()=>({saves,tx})};
}

test('organization preview is read only, applies exact-key tag/collection/Extra changes, and retry is idempotent',async()=>{
 const f=fixture();
 const preview=await f.api.callTool('library_organize_preview',{library:'user',changes:[{itemKey:'AAAAAAAA',addTags:['# 机制/膜结合'],removeTags:['# 分子/IRS1'],addCollectionKeys:['DDDDDDDD'],removeCollectionKeys:['CCCCCCCC'],rating:4,remark:'Useful for TIRF design'}]});
 assert.equal(f.stats().saves,0);assert.equal(preview.writeCount,1);
 assert.deepEqual([...preview.items[0].after.tags],['# 机制/膜结合']);
 const receipt=await f.api.callTool('library_apply_plan',{planId:preview.planId});
 assert.deepEqual([...receipt.changedItemKeys],['AAAAAAAA']);
 const item=f.byKey.get('AAAAAAAA');
 assert.deepEqual([...item.getCollections()],[11]);
 assert.match(item.getField('extra'),/Other: keep this/);assert.match(item.getField('extra'),/rate: 4/);assert.match(item.getField('extra'),/remark: Useful/);
 assert.deepEqual(await f.api.callTool('library_apply_plan',{planId:preview.planId}),receipt);
 assert.equal(f.stats().saves,1);
});

test('stale previews and reserved completion tag fail closed',async()=>{
 const f=fixture();
 await assert.rejects(f.api.callTool('library_organize_preview',{library:'user',changes:[{itemKey:'AAAAAAAA',addTags:['✅精读完成']}]}),/reserved/);
 const p=await f.api.callTool('library_organize_preview',{library:'user',changes:[{itemKey:'AAAAAAAA',addTags:['# 方法/TIRF']} ]});
 f.byKey.get('AAAAAAAA').addTag('external edit');
 await assert.rejects(f.api.callTool('library_apply_plan',{planId:p.planId}),/STALE_PREVIEW/);
 assert.equal(f.stats().saves,0);
});

test('structured import detects DOI duplicates and creates one item only after a fresh preview',async()=>{
 const f=fixture();
 const dup=await f.api.callTool('library_import_item_preview',{library:'user',itemType:'journalArticle',fields:{title:'Different title',DOI:'10.1/existing'}});
 assert.equal(dup.blocked,true);assert.equal(dup.planId,undefined);
 const titleDup=await f.api.callTool('library_import_item_preview',{library:'user',itemType:'journalArticle',fields:{title:'Existing paper',DOI:'10.1/different'}});
 assert.equal(titleDup.blocked,true);
 const p=await f.api.callTool('library_import_item_preview',{library:'user',itemType:'journalArticle',fields:{title:'New paper',DOI:'10.1/new'},creators:[{firstName:'A',lastName:'Scientist'}],tags:['# 类型/原创研究'],collectionKeys:['DDDDDDDD']});
 assert.equal(f.stats().saves,0);
 const receipt=await f.api.callTool('library_apply_plan',{planId:p.planId});
 assert.equal(receipt.kind,'import');assert.equal(f.byKey.get(receipt.itemKey).getField('DOI'),'10.1/new');
 assert.equal(f.stats().saves,1);
});

test('inventory pages explicit items and a new collection is created only after apply',async()=>{
 const f=fixture();
 const inventory=await f.api.callTool('library_tag_inventory',{library:'user',collectionKey:'CCCCCCCC',limit:1});
 assert.equal(inventory.totalItems,1);assert.deepEqual([...inventory.items[0].tags],['# 分子/IRS1']);
 const p=await f.api.callTool('library_collection_preview',{library:'user',name:'00.Inbox'});
 assert.equal(f.stats().saves,0);
 const receipt=await f.api.callTool('library_apply_plan',{planId:p.planId});
 assert.equal(receipt.name,'00.Inbox');assert.equal(f.stats().saves,1);
 await assert.rejects(f.api.callTool('library_collection_preview',{library:'user',name:'00.Inbox'}),/already exists/);
});
