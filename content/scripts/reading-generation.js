/* Separate from Note Parsing Profiles: generation instructions and a write-time depth gate. */
(function(global){
 'use strict';
 const profiles=new Map();
 const submissionSchemas=new Map();
 const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/g,' ').trim();
 const visible=html=>String(html||'').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g,' ').replace(/\s+/g,' ').trim();
 const headings=html=>[...String(html||'').matchAll(/<h([1-6])>(.*?)<\/h\1>/gis)].map(m=>({level:Number(m[1]),name:visible(m[2]),start:m.index,end:m.index+m[0].length}));
 const wordy=value=>typeof value==='string'&&visible(value).length>=12;
 function validate(profile){
  const errors=[];
  if(!profile||typeof profile!=='object'||Array.isArray(profile))return{valid:false,errors:['profile must be an object']};
  if(!/^[a-z][a-z0-9-]{1,63}$/.test(profile.id||''))errors.push('invalid id');
  if(profile.kind!=='reading-generation-protocol'||!profile.readingProfileId||!profile.version)errors.push('invalid generation profile identity');
  for(const type of ['original_research','review','design_note']){
   const branch=profile.branches?.[type];
   if(!branch||!branch.requiredSections||!Object.keys(branch.requiredSections).length)errors.push(`missing ${type} sections`);
   else for(const [key,aliases] of Object.entries(branch.requiredSections))if(!key||!Array.isArray(aliases)||!aliases.length||aliases.some(x=>typeof x!=='string'||!x.trim()))errors.push(`invalid ${type}.${key}`);
   if(!Number.isInteger(branch?.softVisibleCharacters)||branch.softVisibleCharacters<1)errors.push(`invalid ${type} soft threshold`);
  }
  const original=profile.branches?.original_research;
  if(!Number.isInteger(original?.minEvidenceUnits)||!Number.isInteger(original?.minCoreFigures)||!Array.isArray(original?.figureFields)||original.figureFields.length<7)errors.push('invalid original research depth rules');
  return{valid:!errors.length,errors};
 }
 async function startup({rootURI}){
  const url=`${rootURI}content/profiles/generation/strawberry-vnext-depth.json`;
  const raw=Zotero.File.getResourceAsync?await Zotero.File.getResourceAsync(url):Zotero.File.getResource(url);
  const profile=JSON.parse(raw),check=validate(profile);
  if(!check.valid)throw Error(`Invalid Generation Profile: ${check.errors.join('; ')}`);
  profiles.set(profile.id,profile);
  const schemaRaw=Zotero.File.getResourceAsync?await Zotero.File.getResourceAsync(`${rootURI}content/profiles/generation/strawberry-vnext-depth.schema.json`):Zotero.File.getResource(`${rootURI}content/profiles/generation/strawberry-vnext-depth.schema.json`);
  const schema=JSON.parse(schemaRaw);
  if(schema?.type!=='object'||!schema.properties?.articleType||!schema.properties?.fullTextRead||!schema.properties?.causalTests)throw Error('Invalid Generation submission schema');
  submissionSchemas.set(profile.id,schema);
 }
 function get(id){return profiles.get(String(id||''))||null;}
 function submissionSchema(id='strawberry-vnext-depth'){return submissionSchemas.get(String(id||''))||null;}
 function list(){return [...profiles.values()].map(p=>({id:p.id,name:p.name,version:p.version,readingProfileId:p.readingProfileId,articleTypes:Object.keys(p.branches)}));}
 function readComplete(trace){
  if(!trace||!(/^[A-Z0-9]{8}$/.test(trace.attachmentKey||''))||!Number.isInteger(trace.totalCharacters)||trace.totalCharacters<1||!Array.isArray(trace.chunks)||!trace.chunks.length)return false;
  let offset=0;
  for(let i=0;i<trace.chunks.length;i++){
   const chunk=trace.chunks[i];
   if(!Number.isInteger(chunk?.offset)||chunk.offset!==offset||!Number.isInteger(chunk.length)||chunk.length<1)return false;
   offset+=chunk.length;
   if(chunk.nextOffset!==null&&chunk.nextOffset!==offset)return false;
   if(i<trace.chunks.length-1&&chunk.nextOffset===null)return false;
  }
  return offset===trace.totalCharacters&&trace.chunks.at(-1).nextOffset===null;
 }
 function validateSubmission(value,profileId='strawberry-vnext-depth'){
  const root=submissionSchema(profileId),issues=[];
  if(!root)return['SCHEMA_UNAVAILABLE'];
  const walk=(item,rule,path,depth=0)=>{
   if(depth>16){issues.push(`SCHEMA_INVALID:${path}:nesting`);return;}
   if(rule.$ref){const target=rule.$ref.replace(/^#\/\$defs\//,'');rule=root.$defs?.[target];if(!rule){issues.push(`SCHEMA_INVALID:${path}:reference`);return;}}
   const types=Array.isArray(rule.type)?rule.type:[rule.type];
   const kind=item===null?'null':Array.isArray(item)?'array':Number.isInteger(item)?'integer':typeof item;
   if(!types.includes(kind)&&!(kind==='integer'&&types.includes('number'))){issues.push(`SCHEMA_INVALID:${path}:type`);return;}
   if(rule.enum&&!rule.enum.includes(item))issues.push(`SCHEMA_INVALID:${path}:enum`);
   if(typeof item==='string'&&(rule.minLength!==undefined&&item.length<rule.minLength||rule.maxLength!==undefined&&item.length>rule.maxLength||rule.pattern&&!new RegExp(rule.pattern).test(item)))issues.push(`SCHEMA_INVALID:${path}:string`);
   if(typeof item==='number'&&(rule.minimum!==undefined&&item<rule.minimum||rule.maximum!==undefined&&item>rule.maximum))issues.push(`SCHEMA_INVALID:${path}:number`);
   if(Array.isArray(item)){
    if(rule.minItems!==undefined&&item.length<rule.minItems)issues.push(`SCHEMA_INVALID:${path}:minItems`);
    if(rule.maxItems!==undefined&&item.length>rule.maxItems)issues.push(`SCHEMA_INVALID:${path}:maxItems`);
    if(rule.items)item.forEach((entry,index)=>walk(entry,rule.items,`${path}[${index}]`,depth+1));
   }
   if(item&&typeof item==='object'&&!Array.isArray(item)){
    for(const key of rule.required||[])if(item[key]===undefined)issues.push(`SCHEMA_REQUIRED:${path}.${key}`);
    for(const [key,entry] of Object.entries(item)){
     if(!Object.hasOwn(rule.properties||{},key)){if(rule.additionalProperties===false)issues.push(`SCHEMA_UNKNOWN:${path}.${key}`);}
     else walk(entry,rule.properties[key],`${path}.${key}`,depth+1);
    }
   }
  };
  walk(value,root,'generation');
  if(value&&typeof value==='object'&&!Array.isArray(value)){
   const required=value.articleType==='original_research'?['fullTextRead','evidenceUnits','coreFigureIds','figures','causalTests']:value.articleType==='review'?['originalStudies']:value.articleType==='design_note'?['designBasis','validationCriterion']:[];
   for(const key of required)if(value[key]===undefined||value[key]===null)issues.push(`SCHEMA_REQUIRED:generation.${key}`);
  }
  return issues;
 }
 function evaluate({profileId,readingProfileId,generation,html}){
  const profile=get(profileId),reasons=[],warnings=[];
  if(!profile){reasons.push('GENERATION_PROFILE_UNKNOWN');return{status:'DEPTH_QC_FAIL',reasons,warnings,articleType:null,profileId};}
  if(profile.readingProfileId!==readingProfileId)reasons.push('READING_PROFILE_MISMATCH');
  reasons.push(...validateSubmission(generation,profileId));
  const type=generation?.articleType;
  const branch=profile.branches[type];
  if(!branch){reasons.push('ARTICLE_TYPE_REQUIRED');return{status:'DEPTH_QC_FAIL',reasons,warnings,articleType:type||null,profileId};}
  const body=visible(html),parts=headings(html);
  for(const [section,aliases] of Object.entries(branch.requiredSections)){
   const at=parts.findIndex(h=>h.level<=3&&aliases.some(alias=>normalize(h.name).includes(normalize(alias))));
   if(at<0){reasons.push(`SECTION_MISSING:${section}`);continue;}
   const start=parts[at].end,end=parts.slice(at+1).find(h=>h.level<=parts[at].level)?.start??String(html).length;
   if(visible(String(html).slice(start,end)).length<60)reasons.push(`SECTION_SHALLOW:${section}`);
  }
  if(body.length<branch.softVisibleCharacters)warnings.push(`SOFT_LENGTH_BELOW:${body.length}/${branch.softVisibleCharacters}`);
  const figures=generation?.figures;
  if(type==='original_research'){
   if(!readComplete(generation?.fullTextRead))reasons.push('FULL_TEXT_NOT_PAGED_TO_NULL');
   const units=generation?.evidenceUnits;
   if(!Array.isArray(units)||units.length<branch.minEvidenceUnits)reasons.push('EVIDENCE_UNITS_INSUFFICIENT');
   else for(const [i,u] of units.entries())if(!wordy(u?.claim)||!wordy(u?.sourceLocator)||!['实验支持','作者陈述','作者解释','综合推断','我的判断'].includes(u?.role)||!normalize(body).includes(normalize(u.claim).slice(0,24)))reasons.push(`EVIDENCE_UNIT_INCOMPLETE:${i+1}`);
   const expected=generation?.coreFigureIds;
   if(!Array.isArray(expected)||expected.length<branch.minCoreFigures||new Set(expected).size!==expected.length||!Array.isArray(figures)||figures.length!==expected.length)reasons.push('CORE_FIGURE_COVERAGE_INCOMPLETE');
   else for(const id of expected){
    const figure=figures.find(f=>f?.id===id);
    if(!figure||!normalize(body).includes(normalize(id)))reasons.push(`FIGURE_MISSING:${id}`);
    else{
     if(!wordy(figure.sourceLocator))reasons.push(`FIGURE_LOCATOR_MISSING:${id}`);
     for(const field of branch.figureFields)if(!wordy(figure[field])||!normalize(body).includes(normalize(figure[field]).slice(0,24)))reasons.push(`FIGURE_FIELD_MISSING:${id}:${field}`);
     if(Array.isArray(figure.expectedPanelIds))for(const panel of figure.expectedPanelIds)if(!figure.panels?.some(p=>p?.id===panel&&wordy(p.design)&&wordy(p.result)&&normalize(body).includes(normalize(panel))&&normalize(body).includes(normalize(p.design).slice(0,24))&&normalize(body).includes(normalize(p.result).slice(0,24))))reasons.push(`PANEL_MISSING:${id}:${panel}`);
    }
   }
   for(const key of ['necessity','sufficiency','rescue','orthogonalValidation']){
    const test=generation?.causalTests?.[key];
    if(!test||!['tested','not_tested','not_applicable'].includes(test.status)||!wordy(test.explanation)||!normalize(body).includes(normalize(test.explanation).slice(0,24))||test.status==='tested'&&!wordy(test.sourceLocator))reasons.push(`CAUSAL_ASSESSMENT_MISSING:${key}`);
   }
  }else if(type==='review'){
   if(!Array.isArray(generation?.originalStudies)||generation.originalStudies.length<2||generation.originalStudies.some(s=>!wordy(s?.citation)||!wordy(s?.contribution)||!wordy(s?.sourceLocator)||!normalize(body).includes(normalize(s.citation).slice(0,24))))reasons.push('ORIGINAL_STUDY_LINEAGE_INSUFFICIENT');
  }else if(type==='design_note'){
   if(!wordy(generation?.designBasis)||!wordy(generation?.validationCriterion)||!normalize(body).includes(normalize(generation.designBasis).slice(0,24))||!normalize(body).includes(normalize(generation.validationCriterion).slice(0,24)))reasons.push('DESIGN_RATIONALE_OR_VALIDATION_MISSING');
  }
  return{status:reasons.length?'DEPTH_QC_FAIL':'DEPTH_QC_PASS',reasons,warnings,articleType:type,profileId,visibleCharacters:body.length,sectionCount:parts.length,coreFigures:type==='original_research'?(figures?.length||0):null};
 }
 Zotero.ZotQueryReadingGeneration={startup,get,list,validate,evaluate,readComplete,submissionSchema,validateSubmission};
 global.ZotQueryReadingGenerationBootstrap={startup};
})(typeof _globalThis!=='undefined'?_globalThis:this);
