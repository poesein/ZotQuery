import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source=fs.readFileSync(new URL('../content/scripts/reading-generation.js',import.meta.url),'utf8');
const profile=JSON.parse(fs.readFileSync(new URL('../content/profiles/generation/strawberry-vnext-depth.json',import.meta.url),'utf8'));
const schema=JSON.parse(fs.readFileSync(new URL('../content/profiles/generation/strawberry-vnext-depth.schema.json',import.meta.url),'utf8'));
async function fixture(){
 const box={Zotero:{File:{getResourceAsync:async url=>JSON.stringify(url.endsWith('.schema.json')?schema:profile)}},_globalThis:null};
 box._globalThis=box;vm.createContext(box);vm.runInContext(source,box);
 const api=box.Zotero.ZotQueryReadingGeneration;
 await api.startup({rootURI:'test://'});
 return api;
}
const prose='实验条件、定量读数和证据边界均逐项核对；没有报告的数值明确说明为未报告。'.repeat(5);
const sections=branch=>Object.values(profile.branches[branch].requiredSections).map(terms=>`<h2>${terms[0]}</h2><p>${prose}</p>`).join('');
const figure={id:'Figure 1',sourceLocator:'PDF page 4, Figure 1 and legend',design:'Figure 1 使用处理组和匹配对照比较细胞表型',result:'Figure 1 处理组出现可重复的细胞表型变化',quantitation:'Figure 1 原文未报告可复核的精确效应量',authorInterpretation:'Figure 1 作者将变化解释为该通路被激活',evidenceJudgment:'Figure 1 对该表型的直接观察支持较强',canProve:'Figure 1 可以证明该体系中存在关联变化',cannotProve:'Figure 1 不能证明体内普遍适用或排除旁路'};
const unit={claim:'该干预在所用细胞体系里改变被测表型',sourceLocator:'PDF page 4, Figure 1 and legend',role:'实验支持'};
const causalTests=Object.fromEntries(['necessity','sufficiency','rescue','orthogonalValidation'].map(key=>[key,{status:'not_tested',explanation:`原文没有独立完成 ${key} 的判定实验`} ]));
const original={articleType:'original_research',fullTextRead:{attachmentKey:'PDFITEM1',totalCharacters:100,chunks:[{offset:0,length:60,nextOffset:60},{offset:60,length:40,nextOffset:null}]},evidenceUnits:[unit,{...unit,claim:'独立的第二个实验确认细胞表型的变化'}],coreFigureIds:['Figure 1'],figures:[figure],causalTests};
const originalHTML=sections('original_research')+`<h3>Figure 1</h3><p>${Object.values(figure).join('。')}</p><p>${original.evidenceUnits.map(x=>x.claim).join('。')}</p><p>${Object.values(causalTests).map(x=>x.explanation).join('。')}</p>`;

test('generation profile loads separately and routes three article types',async()=>{
 const api=await fixture();
 assert.equal(api.validate(profile).valid,true);
 assert.equal(api.list()[0].readingProfileId,'strawberry-vnext');
 const originalReport=api.evaluate({profileId:profile.id,readingProfileId:'strawberry-vnext',generation:original,html:originalHTML});
 assert.equal(originalReport.status,'DEPTH_QC_PASS',JSON.stringify(originalReport.reasons));
 const review={articleType:'review',originalStudies:[
  {citation:'Original source Alpha 2001',contribution:'Measured direct cellular response',sourceLocator:'PDF reference 1 on page 8'},
  {citation:'Original source Beta 2002',contribution:'Independent perturbation evidence',sourceLocator:'PDF reference 2 on page 8'}]};
 assert.equal(api.evaluate({profileId:profile.id,readingProfileId:'strawberry-vnext',generation:review,html:sections('review')+`<p>${review.originalStudies.map(s=>s.citation).join('；')}</p>`}).status,'DEPTH_QC_PASS');
 const design={articleType:'design_note',designBasis:'Design grounded in measured constraints and known controls',validationCriterion:'Success requires prespecified orthogonal assay result'};
 const designHTML=sections('design_note')+`<p>${design.designBasis}；${design.validationCriterion}</p>`;
 assert.equal(api.evaluate({profileId:profile.id,readingProfileId:'strawberry-vnext',generation:design,html:designHTML}).status,'DEPTH_QC_PASS');
 assert.equal(api.evaluate({profileId:profile.id,readingProfileId:'other',generation:design,html:designHTML}).status,'DEPTH_QC_FAIL');
});

test('original research requires contiguous PDF reading through terminal null',async()=>{
 const api=await fixture();
 for(const chunks of [[{offset:0,length:100,nextOffset:100}],[{offset:0,length:60,nextOffset:60},{offset:70,length:30,nextOffset:null}]]){
  const result=api.evaluate({profileId:profile.id,readingProfileId:'strawberry-vnext',generation:{...original,fullTextRead:{...original.fullTextRead,chunks}},html:originalHTML});
  assert.equal(result.status,'DEPTH_QC_FAIL');assert.ok(result.reasons.includes('FULL_TEXT_NOT_PAGED_TO_NULL'));
 }
});

test('missing figure field, evidence units or section blocks completion; length is warning only',async()=>{
 const api=await fixture();
 const noFigure={...original,figures:[{...figure,cannotProve:''}]};
 const result=api.evaluate({profileId:profile.id,readingProfileId:'strawberry-vnext',generation:noFigure,html:originalHTML});
 assert.equal(result.status,'DEPTH_QC_FAIL');assert.ok(result.reasons.includes('FIGURE_FIELD_MISSING:Figure 1:cannotProve'));
 assert.ok(result.warnings.some(x=>x.startsWith('SOFT_LENGTH_BELOW:')));
 const shallow=api.evaluate({profileId:profile.id,readingProfileId:'strawberry-vnext',generation:original,html:'<h2>核心科学问题</h2><p>简短结论</p>'});
 assert.equal(shallow.status,'DEPTH_QC_FAIL');assert.ok(shallow.reasons.includes('SECTION_SHALLOW:question'));
});

test('Hao-sized four-chunk audit with seven units and eight figures passes; wrong paths are reported',async()=>{
 const api=await fixture();
 const figures=Array.from({length:8},(_,n)=>Object.fromEntries(Object.entries(figure).map(([key,value])=>[key,typeof value==='string'?value.replaceAll('Figure 1',`Figure ${n+1}`):value])));
 const evidenceUnits=Array.from({length:7},(_,n)=>({...unit,claim:`第 ${n+1} 个独立证据单元显示 IRS1 与特定 p110α 突变体的机制关联和实验边界` }));
 const tests=Object.fromEntries(Object.entries(causalTests).map(([key,value])=>[key,{...value,status:'tested',sourceLocator:`PDF page ${key.length+1}, Figure and legend`} ]));
 const generation={...original,fullTextRead:{attachmentKey:'PDFITEM1',totalCharacters:55222,chunks:[
  {offset:0,length:18000,nextOffset:18000},{offset:18000,length:18000,nextOffset:36000},
  {offset:36000,length:18000,nextOffset:54000},{offset:54000,length:1222,nextOffset:null}
 ]},evidenceUnits,coreFigureIds:figures.map(f=>f.id),figures,causalTests:tests};
 const html=sections('original_research')+figures.map(f=>`<h3>${f.id}</h3><p>${Object.values(f).join('。')}</p>`).join('')+
  `<p>${evidenceUnits.map(u=>u.claim).join('。')}</p><p>${Object.values(tests).map(t=>t.explanation).join('。')}</p>`;
 const passed=api.evaluate({profileId:profile.id,readingProfileId:'strawberry-vnext',generation,html});
 assert.equal(passed.status,'DEPTH_QC_PASS',JSON.stringify(passed.reasons));
 assert.equal(passed.coreFigures,8);
 const wrong={...generation,fullPdfReadTrace:generation.fullTextRead,fullTextRead:undefined};
 const failed=api.evaluate({profileId:profile.id,readingProfileId:'strawberry-vnext',generation:wrong,html});
 assert.ok(failed.reasons.includes('SCHEMA_UNKNOWN:generation.fullPdfReadTrace'));
 assert.ok(failed.reasons.includes('SCHEMA_REQUIRED:generation.fullTextRead'));
 assert.ok(failed.reasons.includes('FULL_TEXT_NOT_PAGED_TO_NULL'));
});
