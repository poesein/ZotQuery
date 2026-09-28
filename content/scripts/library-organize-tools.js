/* Explicit-key Zotero library organization. Previews never mutate Zotero. */
"use strict";
(() => {
  const plans = new Map();
  const receipts = new Map();
  const inFlight = new Map();
  const keyRE = /^[A-Z0-9]{8}$/;
  const reserved = '✅精读完成';
  const ttl = 30 * 60 * 1000;
  const define = (name, description, properties, required=[]) => ({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
  const key = {type:'string',pattern:'^[A-Z0-9]{8}$'};
  const library = {type:'string',pattern:'^(user|group:[1-9][0-9]*)$'};
  const tagList = {type:'array',items:{type:'string',minLength:1,maxLength:100},maxItems:30};
  const keyList = {type:'array',items:key,maxItems:30};
  const change = {type:'object',properties:{itemKey:key,addTags:tagList,removeTags:tagList,addCollectionKeys:keyList,removeCollectionKeys:keyList,rating:{type:'integer',minimum:0,maximum:5},remark:{type:'string',maxLength:300}},required:['itemKey'],additionalProperties:false};
  const fields = {type:'object',properties:Object.fromEntries(['title','DOI','abstractNote','publicationTitle','date','url','volume','issue','pages','language','extra','publisher','place','ISBN','ISSN'].map(x=>[x,{type:'string',maxLength:x==='abstractNote'?30000:2000}])),required:['title'],additionalProperties:false};
  const creator = {type:'object',properties:{firstName:{type:'string',maxLength:200},lastName:{type:'string',minLength:1,maxLength:200},creatorType:{type:'string',enum:['author','editor','translator']}},required:['lastName'],additionalProperties:false};
  const definitions = [
    define('library_item_organization','Read one item’s tags, collection membership and Zotero Style rating/remark without changing it.',{library,itemKey:key},['library','itemKey']),
    define('library_tag_inventory','Count tags on parent items in one collection or library. Page through stable item keys before planning a taxonomy migration.',{library,collectionKey:key,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}},['library']),
    define('library_organize_preview','Preview changes to explicit parent items: arbitrary tags, same-library collection moves, Zotero Style rating/remark. Returns an expiring plan ID; no Zotero write.',{library,changes:{type:'array',items:change,minItems:1,maxItems:25}},['library','changes']),
    define('library_collection_preview','Preview creation of a collection in one library. Returns an expiring plan ID; no Zotero write.',{library,name:{type:'string',minLength:1,maxLength:120},parentCollectionKey:key},['library','name']),
    define('library_import_item_preview','Preview creation of one structured Zotero item with duplicate DOI/title check. No attachment import or Zotero write.',{library,itemType:{type:'string',enum:['journalArticle','book','bookSection','conferencePaper','report','preprint','thesis']},fields,creators:{type:'array',items:creator,maxItems:100},tags:tagList,collectionKeys:keyList},['library','itemType','fields']),
    define('library_apply_plan','Apply exactly one fresh preview plan after rechecking item state and duplicates. Returns a receipt; retrying the same plan is idempotent.',{planId:{type:'string',minLength:10,maxLength:100}},['planId'])
  ];
  const supports = name => definitions.some(x=>x.name===name);
  const fail = message => { throw Error(message); };
  const list = value => Array.isArray(value)?value:[];
  const clean = value => String(value||'').trim();
  function checkObject(value, schema, label) {
    if(!value||typeof value!=='object'||Array.isArray(value))fail(`${label} must be an object`);
    for(const [name,v] of Object.entries(value)) {
      const s=schema.properties[name]; if(!s)fail(`Unknown ${label} field: ${name}`);
      if(s.type==='string' && (typeof v!=='string'||(s.pattern&&!new RegExp(s.pattern).test(v))||(s.enum&&!s.enum.includes(v))||(s.minLength&&v.length<s.minLength)||(s.maxLength&&v.length>s.maxLength)))fail(`Invalid ${label}.${name}`);
      if(s.type==='integer'&&(!Number.isInteger(v)||v<(s.minimum??-Infinity)||v>(s.maximum??Infinity)))fail(`Invalid ${label}.${name}`);
      if(s.type==='array'&&(!Array.isArray(v)||(s.minItems&&v.length<s.minItems)||(s.maxItems&&v.length>s.maxItems)))fail(`Invalid ${label}.${name}`);
      if(s.type==='object')checkObject(v,s,`${label}.${name}`);
      if(s.type==='array')for(const [i,entry] of v.entries()) {
        if(s.items.type==='object')checkObject(entry,s.items,`${label}.${name}[${i}]`);
        else if(s.items.type==='string'&&(typeof entry!=='string'||(s.items.pattern&&!new RegExp(s.items.pattern).test(entry))||(s.items.minLength&&entry.length<s.items.minLength)||(s.items.maxLength&&entry.length>s.items.maxLength)))fail(`Invalid ${label}.${name}[${i}]`);
      }
    }
    for(const required of schema.required||[])if(value[required]===undefined)fail(`Missing ${label}.${required}`);
  }
  function validate(name,args) { const d=definitions.find(x=>x.name===name); if(!d)fail('Unknown organization action'); checkObject(args,d.inputSchema,'arguments'); }
  function libraryID(scope) {
    if(scope==='user')return Zotero.Libraries.userLibraryID;
    if(!/^group:[1-9][0-9]*$/.test(scope))fail('Invalid library');
    const id=Zotero.Groups.getLibraryIDFromGroupID(Number(scope.slice(6)));
    if(!id)fail('Group library unavailable'); return id;
  }
  function writable(id) { if(Zotero.Libraries.get(id)?.editable===false)fail('Library is read-only'); }
  async function itemFor(id,k) {
    if(!keyRE.test(k))fail(`Invalid item key: ${k}`);
    const localID=Zotero.Items.getIDFromLibraryAndKey(id,k);
    const item=localID?await Zotero.Items.getAsync(localID):null;
    if(!item||item.deleted||item.libraryID!==id||!item.isRegularItem?.())fail(`Parent item unavailable: ${k}`);
    return item;
  }
  async function collectionFor(id,k) {
    if(!keyRE.test(k))fail(`Invalid collection key: ${k}`);
    const localID=Zotero.Collections.getIDFromLibraryAndKey(id,k);
    const c=localID?await Zotero.Collections.getAsync(localID):null;
    if(!c||c.deleted||c.libraryID!==id)fail(`Collection unavailable: ${k}`);
    return c;
  }
  const tagState = item => list(item.getTags?.()).map(t=>({tag:typeof t==='string'?t:t.tag,type:typeof t==='string'?0:(t.type||0)})).filter(t=>t.tag).sort((a,b)=>a.tag.localeCompare(b.tag));
  const snapshot = item => ({key:item.key,title:String(item.getField('title')||''),dateModified:String(item.dateModified||''),tags:tagState(item),collectionIDs:list(item.getCollections?.()).map(Number).sort((a,b)=>a-b),extra:String(item.getField('extra')||'')});
  const signature = state => JSON.stringify(state);
  const tagNames = state => state.tags.map(t=>t.tag);
  function extraField(extra,name,value) {
    const lines=extra.split(/\r?\n/),re=new RegExp(`^\\s*${name}\\s*:`, 'i');
    const matches=lines.map((line,i)=>re.test(line)?i:-1).filter(i=>i>=0);
    if(matches.length>1)fail(`Multiple ${name} fields in Extra; resolve manually`);
    const line=value===null?null:`${name}: ${value}`;
    if(matches.length) { if(line===null)lines.splice(matches[0],1); else lines[matches[0]]=line; }
    else if(line!==null)lines.push(line);
    return lines.join('\n').replace(/^\n|\n$/g,'');
  }
  function assertTags(values) {
    for(const tag of values)if(!clean(tag)||tag!==clean(tag)||tag===reserved)fail(`Invalid or reserved tag: ${tag}`);
    if(new Set(values).size!==values.length)fail('Duplicate tag in one change');
  }
  function applyChangeToState(before,c,collections) {
    const addTags=list(c.addTags),removeTags=list(c.removeTags),adds=list(c.addCollectionKeys),removes=list(c.removeCollectionKeys);
    assertTags(addTags);assertTags(removeTags);
    if(addTags.some(x=>removeTags.includes(x)))fail('A tag cannot be added and removed together');
    if(new Set(adds).size!==adds.length||new Set(removes).size!==removes.length||adds.some(x=>removes.includes(x)))fail('Conflicting collection changes');
    const tags=new Map(before.tags.map(t=>[t.tag,t]));
    for(const tag of removeTags)tags.delete(tag);
    for(const tag of addTags)if(!tags.has(tag))tags.set(tag,{tag,type:0});
    const ids=new Set(before.collectionIDs);
    for(const k of removes)ids.delete(collections.get(k).id);
    for(const k of adds)ids.add(collections.get(k).id);
    return {tags:[...tags.values()].sort((a,b)=>a.tag.localeCompare(b.tag)),ids,extra:before.extra};
  }
  function savePlan(data) {
    const id=String(Services.uuid.generateUUID()).replace(/[{}]/g,'');
    const plan={...data,planId:id,expiresAt:Date.now()+ttl};
    plans.set(id,plan);
    for(const [k,p] of plans)if(p.expiresAt<Date.now())plans.delete(k);
    return {planId:id,expiresAt:new Date(plan.expiresAt).toISOString()};
  }
  async function previewOrganize(args) {
    const id=libraryID(args.library);writable(id);
    const seen=new Set(),rows=[];
    for(const c of args.changes) {
      if(seen.has(c.itemKey))fail(`Duplicate item key: ${c.itemKey}`);seen.add(c.itemKey);
      const item=await itemFor(id,c.itemKey),before=snapshot(item);
      const collectionKeys=[...new Set([...list(c.addCollectionKeys),...list(c.removeCollectionKeys)])];
      const collections=new Map(); for(const k of collectionKeys)collections.set(k,await collectionFor(id,k));
      const after=applyChangeToState(before,c,collections);
      if(c.rating!==undefined) { if(Zotero.Prefs.get('extensions.zotero.zoterostyle.ratingColumn.storage')==='tag')fail('Zotero Style rating storage is set to tags'); after.extra=extraField(after.extra,'rate',c.rating===0?null:String(c.rating)); }
      if(c.remark!==undefined) { if(/[\r\n]/.test(c.remark))fail('Remark must be one line'); after.extra=extraField(after.extra,'remark',clean(c.remark)||null); }
      rows.push({itemKey:c.itemKey,title:before.title,before,after:{tags:after.tags,collectionIDs:[...after.ids].sort((a,b)=>a-b),extra:after.extra},changed:signature({tags:before.tags,collectionIDs:before.collectionIDs,extra:before.extra})!==signature({tags:after.tags,collectionIDs:[...after.ids].sort((a,b)=>a-b),extra:after.extra})});
    }
    return {kind:'organize',library:args.library,...savePlan({kind:'organize',library:args.library,rows}),items:rows.map(({itemKey,title,before,after,changed})=>({itemKey,title,changed,before:{tags:tagNames(before),collectionIDs:before.collectionIDs,extra:before.extra},after:{tags:tagNames(after),collectionIDs:after.collectionIDs,extra:after.extra}})),writeCount:rows.filter(x=>x.changed).length};
  }
  async function previewCollection(args) {
    const id=libraryID(args.library);writable(id);const name=clean(args.name);
    if(!name)fail('Collection name is empty');
    const parent=args.parentCollectionKey?await collectionFor(id,args.parentCollectionKey):null;
    const matches=list(await Zotero.Collections.getByLibrary(id,true)).filter(c=>!c.deleted&&c.name===name&&Number(c.parentID||0)===Number(parent?.id||0));
    if(matches.length)fail(`Collection already exists: ${matches[0].key}`);
    return {kind:'collection',library:args.library,name,parentCollectionKey:parent?.key||null,...savePlan({kind:'collection',library:args.library,name,parentCollectionKey:parent?.key||null})};
  }
  async function duplicates(id,fields) {
    const ids=new Set();
    for(const [field,value] of [['DOI',clean(fields.DOI)],['title',clean(fields.title)]]) {
      if(!value)continue;
      const search=new Zotero.Search();search.libraryID=id;search.addCondition(field,'is',value);
      for(const itemID of await search.search())ids.add(itemID);
    }
    return (await Promise.all([...ids].slice(0,20).map(x=>Zotero.Items.getAsync(x)))).filter(x=>x?.isRegularItem?.()&&!x.deleted).map(x=>({itemKey:x.key,title:String(x.getField('title')||''),DOI:String(x.getField('DOI')||'')}));
  }
  async function previewImport(args) {
    const id=libraryID(args.library);writable(id);
    if(!clean(args.fields.title))fail('Title is required');
    const itemTypeID=Zotero.ItemTypes.getID(args.itemType);
    if(!itemTypeID)fail('Unsupported Zotero item type');
    for(const field of Object.keys(args.fields)) {
      const fieldID=Zotero.ItemFields?.getID?.(field);
      if(!fieldID||!Zotero.ItemFields.isValidForType(fieldID,itemTypeID))fail(`Field ${field} is unavailable for ${args.itemType}`);
    }
    for(const k of list(args.collectionKeys))await collectionFor(id,k);
    assertTags(list(args.tags));
    const found=await duplicates(id,args.fields);
    if(found.length) return {kind:'import',duplicateCandidates:found,blocked:true,reason:'Existing DOI or exact title; review before import'};
    return {kind:'import',library:args.library,itemType:args.itemType,fields:args.fields,creators:list(args.creators),tags:list(args.tags),collectionKeys:list(args.collectionKeys),duplicateCandidates:[],...savePlan({kind:'import',args})};
  }
  async function applyPlanInternal({planId}) {
    if(receipts.has(planId))return receipts.get(planId);
    const p=plans.get(planId);if(!p||p.expiresAt<Date.now())fail('Plan unavailable or expired; preview again');
    const id=libraryID(p.library||p.args?.library);writable(id);
    let result;
    await Zotero.DB.executeTransaction(async()=>{
      if(p.kind==='organize') {
        const items=[];
        for(const row of p.rows) {const item=await itemFor(id,row.itemKey);if(signature(snapshot(item))!==signature(row.before))fail(`STALE_PREVIEW: ${row.itemKey}`);items.push(item);}
        for(let i=0;i<items.length;i++)if(p.rows[i].changed){const item=items[i],after=p.rows[i].after;item.setTags(after.tags);item.setCollections(after.collectionIDs);item.setField('extra',after.extra);await item.save();}
        result={kind:'organize',library:p.library,changedItemKeys:p.rows.filter(x=>x.changed).map(x=>x.itemKey),unchangedItemKeys:p.rows.filter(x=>!x.changed).map(x=>x.itemKey)};
      } else if(p.kind==='collection') {
        const parent=p.parentCollectionKey?await collectionFor(id,p.parentCollectionKey):null;
        const matches=list(await Zotero.Collections.getByLibrary(id,true)).filter(c=>!c.deleted&&c.name===p.name&&Number(c.parentID||0)===Number(parent?.id||0));
        if(matches.length)fail('STALE_PREVIEW: collection now exists');
        const c=new Zotero.Collection();c.libraryID=id;c.name=p.name;if(parent)c.parentID=parent.id;await c.save();
        result={kind:'collection',library:p.library,collectionKey:c.key,name:c.name};
      } else if(p.kind==='import') {
        const a=p.args;if((await duplicates(id,a.fields)).length)fail('STALE_PREVIEW: duplicate item now exists');
        const collectionIDs=[];for(const k of list(a.collectionKeys))collectionIDs.push((await collectionFor(id,k)).id);
        const item=new Zotero.Item(a.itemType);item.libraryID=id;
        for(const [field,value] of Object.entries(a.fields))if(clean(value))item.setField(field,value);
        if(a.creators?.length)item.setCreators(a.creators.map(x=>({firstName:x.firstName||'',lastName:x.lastName,creatorType:x.creatorType||'author'})));
        for(const tag of list(a.tags))item.addTag(tag);
        if(collectionIDs.length)item.setCollections(collectionIDs);
        await item.save();result={kind:'import',library:a.library,itemKey:item.key,itemType:a.itemType,title:a.fields.title};
      } else fail('Unknown plan kind');
    });
    const receipt={...result,planId,applied:true};receipts.set(planId,receipt);plans.delete(planId);return receipt;
  }
  async function applyPlan(args) {
    if(receipts.has(args.planId))return receipts.get(args.planId);
    if(inFlight.has(args.planId))return inFlight.get(args.planId);
    const pending=applyPlanInternal(args);inFlight.set(args.planId,pending);
    try{return await pending;}finally{inFlight.delete(args.planId);}
  }
  async function tagInventory(args) {
    const id=libraryID(args.library),offset=args.offset||0,limit=args.limit||100;
    const collection=args.collectionKey?await collectionFor(id,args.collectionKey):null;
    if(collection)await collection.loadDataType?.('childItems');
    const ids=collection?list(collection.getChildItems?.(true)):list(await Zotero.Items.getAll(id));
    const items=ids.map(x=>typeof x==='number'?Zotero.Items.get(x):x).filter(x=>x?.isRegularItem?.()&&!x.deleted).sort((a,b)=>a.key.localeCompare(b.key));
    const page=items.slice(offset,offset+limit),counts=new Map();
    for(const item of page)for(const {tag} of tagState(item))counts.set(tag,(counts.get(tag)||0)+1);
    return {library:args.library,collectionKey:collection?.key||null,offset,limit,totalItems:items.length,nextOffset:offset+page.length<items.length?offset+page.length:null,items:page.map(x=>({itemKey:x.key,title:String(x.getField('title')||''),tags:tagState(x).map(t=>t.tag),collectionIDs:list(x.getCollections?.())})),tagCounts:[...counts].sort((a,b)=>a[0].localeCompare(b[0])).map(([tag,count])=>({tag,count})),countsCoverPageOnly:true};
  }
  async function callTool(name,args={}) {
    validate(name,args);
    if(name==='library_item_organization') {const id=libraryID(args.library),state=snapshot(await itemFor(id,args.itemKey));return {library:args.library,...state};}
    if(name==='library_tag_inventory')return tagInventory(args);
    if(name==='library_organize_preview')return previewOrganize(args);
    if(name==='library_collection_preview')return previewCollection(args);
    if(name==='library_import_item_preview')return previewImport(args);
    if(name==='library_apply_plan')return applyPlan(args);
  }
  Zotero.ZotQueryOrganizer={toolDefinitions:()=>definitions,supports,callTool};
})();
