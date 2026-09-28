/* Read-only Zotero library navigation shared by local MCP, REST MCP and ChatGPT. */
"use strict";
(() => {
  const library={type:'string',pattern:'^(user|group:[1-9][0-9]*)$'};
  const key={type:'string',pattern:'^[A-Z0-9]{8}$'};
  const paging={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}};
  const define=(name,description,properties,required=[])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
  const toolDefinitions=()=>[
    define('library_list_groups','List group libraries available in this Zotero profile.',{}),
    define('library_list_collections','Page collections in one Zotero library.',{library,...paging}),
    define('library_search_items','Search or page Zotero items, including items absent from the ZotQuery index. Results are navigation, not verified evidence.',{library,query:{type:'string',maxLength:200},collectionKey:key,...paging}),
    define('library_get_collection_items','Page top-level parent items in a Zotero collection.',{library,collectionKey:key,...paging},['collectionKey']),
    define('library_get_item','Read metadata of one Zotero item by stable key.',{library,itemKey:key},['itemKey']),
    define('library_list_children','Page a Zotero item’s child notes and attachments.',{library,itemKey:key,...paging},['itemKey']),
    define('library_read_attachment_fulltext','Page indexed attachment full text. Navigation only until the original PDF is checked.',{library,itemKey:key,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100000}},['itemKey'])
  ];
  function validate(name,args){
    const definition=toolDefinitions().find(tool=>tool.name===name);
    if(!definition)throw Error('Unknown library read action');
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Invalid library read arguments');
    const {properties,required}=definition.inputSchema;
    for(const field of Object.keys(args)){
      const schema=properties[field],value=args[field];
      if(!schema)throw Error(`Unknown library read field: ${field}`);
      if(schema.type==='string'&&(typeof value!=='string'||(schema.pattern&&!new RegExp(schema.pattern).test(value))||(schema.maxLength&&value.length>schema.maxLength)))throw Error(`Invalid library read field: ${field}`);
      if(schema.type==='integer'&&(!Number.isInteger(value)||value<(schema.minimum??0)||value>(schema.maximum??Number.MAX_SAFE_INTEGER)))throw Error(`Invalid library read field: ${field}`);
    }
    for(const field of required)if(args[field]===undefined)throw Error(`Missing library read field: ${field}`);
  }
  function base(scope='user'){
    if(scope==='user')return '/api/users/0';
    if(/^group:[1-9][0-9]*$/.test(scope))return `/api/groups/${scope.slice(6)}`;
    throw Error('Invalid Zotero library scope');
  }
  async function get(path,params={}){
    const port=Number(Zotero.Server?.port||23119);
    if(!Number.isInteger(port)||port<1||port>65535)throw Error('Zotero local API port is unavailable');
    const url=new URL(`http://127.0.0.1:${port}${path}`);
    for(const [name,value] of Object.entries(params))if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(name,String(value));
    const xhr=await Zotero.HTTP.request('GET',url.toString(),{headers:{'Zotero-Allowed-Request':'1'},responseType:'json',timeout:30000,successCodes:false,errorDelayMax:0,noRetryOnThrottle:true});
    if(xhr.status<200||xhr.status>=300)throw Error(`Zotero library API HTTP ${xhr.status}`);
    const data=xhr.response&&typeof xhr.response==='object'?xhr.response:JSON.parse(xhr.responseText||'null');
    if(JSON.stringify(data).length>64*1024*1024)throw Error('Zotero library response is too large; use a smaller page');
    const rawHeader=xhr.getResponseHeader?.('Total-Results');
    const header=rawHeader==null?NaN:Number(rawHeader);
    return {data,total:Number.isFinite(header)&&header>=0?header:null};
  }
  async function callTool(name,args={}){
    validate(name,args);
    if(name==='library_list_groups')return (await get('/api/users/0/groups')).data;
    const scope=args.library||'user',root=base(scope),offset=args.offset||0,limit=args.limit||25;
    const page=(result,extra={})=>({library:scope,offset,limit,total:result.total,results:result.data,nextOffset:result.total!=null&&offset+result.data.length<result.total?offset+result.data.length:null,...extra});
    if(name==='library_list_collections')return page(await get(`${root}/collections`,{start:offset,limit}));
    if(name==='library_search_items'){
      const path=args.collectionKey?`${root}/collections/${args.collectionKey}/items`:`${root}/items`;
      return page(await get(path,{start:offset,limit,q:args.query}),{query:args.query||'',navigationOnly:true});
    }
    if(name==='library_get_collection_items')return page(await get(`${root}/collections/${args.collectionKey}/items/top`,{start:offset,limit,sort:'title',direction:'asc'}),{collectionKey:args.collectionKey,navigationOnly:true});
    if(name==='library_get_item')return (await get(`${root}/items/${args.itemKey}`)).data;
    if(name==='library_list_children')return page(await get(`${root}/items/${args.itemKey}/children`,{start:offset,limit}),{parentItemKey:args.itemKey});
    if(name==='library_read_attachment_fulltext'){
      const {data}=await get(`${root}/items/${args.itemKey}/fulltext`);
      if(typeof data?.content!=='string')throw Error('Indexed attachment full text is unavailable');
      const start=args.offset||0,size=args.limit||20000;
      return {library:scope,itemKey:args.itemKey,offset:start,limit:size,totalCharacters:data.content.length,text:data.content.slice(start,start+size),nextOffset:start+size<data.content.length?start+size:null,indexedPages:data.indexedPages??null,totalPages:data.totalPages??null,navigationOnly:true};
    }
    throw Error('Unknown library read action');
  }
  Zotero.ZotQueryLibrary={toolDefinitions,callTool};
})(typeof _globalThis!=='undefined'?_globalThis:this);
