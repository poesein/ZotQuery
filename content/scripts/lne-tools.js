/*
 * ZotQuery-LNE Research 3.1.8
 * LNE Native agent-tool layer: full tools, persistent surveys, MCP definitions.
 * Loaded after lne-native.js and before research-engine.js.
 */
(function (global) {
  "use strict";

  const VERSION = "3.1.8";
  const DB = "zotquerylne";
  const FACT_TYPES = new Set([
    "naming_equivalence", "construct_boundary", "structure_resolved_range",
    "secondary_structure_range", "functional_motif", "mutation_site",
    "hdx_peptide", "sequence", "sequence_alignment", "homology_mapping",
    "quantitative_measurement", "mechanism", "other",
  ]);
  const INTERVAL_TYPES = new Set([
    "construct_boundary", "structure_resolved_range", "secondary_structure_range",
    "functional_motif", "mutation_site", "hdx_peptide", "homology_mapping",
  ]);
  let surveySeq = 0;
  let started = false;

  const api = () => Zotero.ZotQueryLNE?.api;
  function clampInt(v, dflt, min, max) {
    const n = v === undefined || v === null || v === "" ? dflt : parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  }
  function parseAxes(v) {
    if (Array.isArray(v)) return v.map(x => String(x || "").trim()).filter(Boolean);
    const s = String(v || "").trim();
    if (!s) return [];
    if (s.startsWith("[")) { try { const a = JSON.parse(s); if (Array.isArray(a)) return parseAxes(a); } catch (_) {} }
    return s.split(/[\n,;|]+/).map(x => x.trim()).filter(Boolean);
  }
  function norm(s) { return String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim(); }
  function oneline(s, max = 500) { const t = norm(s); return t.length > max ? t.slice(0, max) + "…" : t; }
  function roleOf(tag, role, profileId = "generic") {
    return role || Zotero.ZotQueryNoteProfiles?.roleForTag(tag, Zotero.ZotQueryNoteProfiles.get(profileId)) || "UNKNOWN";
  }
  function evidenceClass(tag, role, profileId) {
    const canonical = roleOf(tag, role, profileId);
    if (canonical === "OBSERVED_EVIDENCE" || canonical === "AUTHOR_CLAIM") return "paper-side";
    if (["AUTHOR_INTERPRETATION", "USER_INFERENCE", "EVIDENCE_QUALITY"].includes(canonical)) return "interpretive";
    return "untagged";
  }
  function segTagNote(tag, role, profileId) {
    if (!tag) return "该段没有证据标签：不能据此区分论文结论与读者推断";
    const canonical = roleOf(tag, role, profileId);
    if (canonical === "USER_INFERENCE") return `【${tag}】读者推论，不是论文直接结论`;
    if (canonical === "AUTHOR_INTERPRETATION") return `【${tag}】解释性推断，非直接观测`;
    return `【${tag}】${evidenceClass(tag, canonical, profileId) === "paper-side" ? "论文侧线索，仍须原文核验" : canonical}`;
  }
  function paperKeyOf(n) {
    if (n?.zoteroParentKey) return `zp:${n.parentLibraryKey || n.libraryKey || "user"}:${n.zoteroParentKey}`;
    const doi = String(n?.doi || "").trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    if (doi) return `doi:${doi}`;
    const t = String(n?.title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return t ? `t:${t}|${n?.year || ""}` : `k:${n?.noteKey || ""}`;
  }
  function surveyWorkKey(n) {
    const doi = String(n?.doi || "").trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    if (doi) return `doi:${doi}`;
    const title = String(n?.title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (title) return `title:${title}|${n?.year || ""}`;
    return paperKeyOf(n);
  }
  function classifyQuestion(question) {
    const q = String(question || "").toLowerCase(), out = [];
    if (/(sequence|residue|amino\s+acid|construct boundary|numbering|isoform|序列|残基|位点|编号|异构体)/iu.test(q)) out.push("sequence");
    if (/(\bvs\.?\b|versus|compar|differ|contrast|差异|区别|比较|对比)/iu.test(q)) out.push("comparison");
    if (/(mechanis|causal|how\b|why\b|pathway|机制|如何|为什么|因果|通路)/iu.test(q)) out.push("mechanism");
    if (/(therap|treat|drug|inhibitor|resistan|response|治疗|药物|抑制剂|耐药|疗效)/iu.test(q)) out.push("intervention");
    if (/(method|assay|protocol|measure|detect|方法|检测|测量|实验设计)/iu.test(q)) out.push("method");
    if (/(associat|correlat|risk|predict|biomarker|相关|关联|风险|预测|标志物)/iu.test(q)) out.push("association");
    return out.length ? out : ["overview"];
  }
  function genericAxes(types) {
    const axes = [
      "direct evidence and primary experiment",
      "context dependence model system and boundary conditions",
      "contradictory evidence limitations and negative results",
      "independent validation replication and orthogonal methods",
    ];
    if (types.includes("comparison")) axes.unshift("direct head-to-head comparison under the same conditions");
    if (types.includes("mechanism")) axes.unshift("causal perturbation upstream downstream interaction and conformation");
    if (types.includes("intervention")) axes.unshift("efficacy mechanism resistance toxicity and response heterogeneity");
    if (types.includes("method")) axes.unshift("assay principle controls sensitivity specificity and artifacts");
    if (types.includes("association")) axes.unshift("effect size confounding stratification and causal evidence");
    if (types.includes("sequence")) axes.unshift("sequence definition construct boundaries residue numbering isoform and homology mapping");
    if (types.includes("overview")) axes.unshift("definition scope major findings and unresolved questions");
    return [...new Set(axes)];
  }
  function extractSurveyAnchors(question, supplied = "") {
    const explicit = parseAxes(supplied); if (explicit.length) return [...new Set(explicit)].slice(0, 8);
    const q = String(question || "");
    const quoted = [...q.matchAll(/["“”']([^"“”']{2,80})["“”']/gu)].map(m => m[1].trim());
    const toks = q.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || [];
    const ids = toks.filter(x => /\p{L}/u.test(x) && /\p{N}/u.test(x));
    const comparisonRx = /\bvs\.?\b|\bversus\b|与|对比|比较/iu;
    const versus = comparisonRx.test(q) ? q.split(/\s*(?:\bvs\.?\b|\bversus\b|与|对比|比较)\s*/iu)
      .flatMap(p => p.match(/[\p{L}][\p{L}\p{N}_-]{2,}/gu) || [])
      .filter(x => !/^(the|and|with|activation|mechanism|difference|compare)$/i.test(x)) : [];
    return [...new Set([...quoted, ...ids, ...versus])].slice(0, 8);
  }
  function identifierIdentityAudit(anchors) {
    const ids = [...new Set((anchors || []).filter(x => /\p{L}/u.test(x) && /\p{N}/u.test(x)))];
    const warnings = [], canon = s => String(s).normalize("NFKC").toLocaleLowerCase("und"), bag = s => [...canon(s)].sort().join("");
    for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) if (canon(ids[i])!==canon(ids[j]) && bag(ids[i])===bag(ids[j])) warnings.push({terms:[ids[i],ids[j]],kind:"same-characters-different-order",action:"keep-separate-and-require-explicit-identity-evidence"});
    return {normalization:"NFKC for comparison only; original surfaces retained",characterOrder:"identity-significant",automaticEquivalence:"none",fuzzySimilarityMayEstablishIdentity:false,warnings};
  }
  function methodSignals(text) {
    const t = String(text || "").toLowerCase();
    const defs = [
      ["genetic-perturbation", /(knockout|knockdown|crispr|sirna|mutagen|deletion|rescue|loss.of.function|gain.of.function|\bko\b)/i],
      ["structure", /(cryo.?em|crystall|structure|pdb|x-ray|molecular dynamics|\bmd\b)/i],
      ["biophysics", /(spr|surface plasmon|hdx|deuterium|quench|binding affinity|kinetic|liposome|vesicle)/i],
      ["biochemistry", /(kinase assay|enzyme activity|atpase|western blot|immunoblot|co-?ip|immunoprecip|mass spectrom)/i],
      ["cellular", /(isogenic|cell line|transformation|focus formation|migration|invasion|organoid|xenograft|mouse|in vivo)/i],
      ["omics", /(proteomic|phosphoproteomic|transcriptomic|rna-seq|silac|lc-ms|mass spectrom)/i],
      ["orthogonal-controls", /(orthogonal|control|replicate|reverse.label|dose.response|time course|independent validation)/i],
    ];
    return defs.filter(([,re]) => re.test(t)).map(([n]) => n);
  }
  const numericSignal = t => /(?:\b\d+(?:\.\d+)?\s*(?:%|fold|x\b|nm|um|μm|mm|pmol|nmol|ng|mg|s\b|min\b|h\b)|[~≈<>]\s*\d)/iu.test(String(t || ""));
  const conflictSignal = t => /(contradict|conflict|inconsisten|however|whereas|but\b|not support|negative result|limitation|矛盾|冲突|不一致|但是|然而|不支持|局限)/iu.test(String(t || ""));
  const referenceLikeEvidence = e => /(references?|bibliograph|further reading|related literature|参考文献|延伸阅读|关键文献|原文参考)/iu.test(String(e?.section || ""));
  function axisTerms(axis) {
    const stop = new Set(["direct","evidence","primary","experiment","comparison","under","same","conditions","and","versus","difference","effects"]);
    return (String(axis || "").toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu)||[]).filter(x => !stop.has(x));
  }
  function highSpecificityAxisTerms(axis) { return (String(axis||"").match(/[A-Za-z][A-Za-z0-9_-]{1,}/g)||[]).filter(x => /\d/.test(x)||/[A-Z]{2,}/.test(x)||/[a-z][A-Z]/.test(x)).map(x=>x.toLowerCase()); }
  function titleTokens(t){ return new Set(String(t||"").toLowerCase().match(/[a-z0-9]{4,}/g)||[]); }
  function authorTokens(t){ return new Set(String(t||"").toLowerCase().match(/[a-z]{4,}/g)||[]); }
  function jaccard(a,b){ if(!a.size||!b.size)return 0;let n=0;for(const x of a)if(b.has(x))n++;return n/(a.size+b.size-n); }
  function lineageSuggestions(results) {
    const out=[];
    for(let i=0;i<results.length;i++)for(let j=i+1;j<results.length;j++){
      const a=results[i],b=results[j],yg=Math.abs(Number(a.year||0)-Number(b.year||0)); if(yg>3)continue;
      const ts=jaccard(titleTokens(a.title),titleTokens(b.title)),as=jaccard(authorTokens(a.authors),authorTokens(b.authors));
      const shared=[...titleTokens(a.title)].filter(x=>x.length>=7&&titleTokens(b.title).has(x)).length;
      const pre=/^10\.1101\//.test(String(a.doi||""))||/^10\.1101\//.test(String(b.doi||""));
      if(ts>=.72||(pre&&as>=.35&&(ts>=.3||shared>=2)))out.push({workKeys:[a.workKey,b.workKey],noteKeys:[a.noteKey,b.noteKey],titleSimilarity:+ts.toFixed(3),authorSimilarity:+as.toFixed(3),yearGap:yg,possiblePreprintPublishedPair:pre,note:"Review manually; lineage warning, not automatic merge."});
    }
    return out.slice(0,100);
  }
  function tierFor(note, best) {
    if (["strong", "normal", "weak", "noise"].includes(note?.tier)) return note.tier;
    const observed = (note.hits || []).some(h => evidenceClass(h.tag, h.canonicalRole, note.profileId) === "paper-side");
    const ratio = best > 0 ? Number(note.score || 0) / best : 0;
    const matched = Math.max(0, ...(note.hits || []).map(h => (h.matchTerms || []).length));
    if ((observed && ratio >= .55) || matched >= 2) return "strong";
    if (ratio >= .35 || observed) return "normal";
    if (ratio >= .15) return "weak";
    return "noise";
  }
  function scoreSurveyWork(work, plan) {
    const all=work._allEvidence||[], substantive=all.filter(e=>!referenceLikeEvidence(e)), anchors=plan.anchors||[];
    const blob=`${work.title||""} ${substantive.map(x=>x.quote).join(" ")}`.toLowerCase(), title=String(work.title||"").toLowerCase();
    const anchorHits=anchors.filter(a=>blob.includes(String(a).toLowerCase())), directComparison=anchors.length>=2&&anchorHits.length>=2;
    const paperSide=substantive.filter(x=>x.evidenceClass==="paper-side"), methods=[...new Set(methodSignals(blob))];
    const identityAnchors=anchors.filter(a=>/\p{L}/u.test(String(a))&&/\p{N}/u.test(String(a)));
    const identityEvidenceSegments=paperSide.filter(e=>{const t=String(e.quote||"").toLowerCase();return identityAnchors.some(a=>t.includes(String(a).toLowerCase()));}).length;
    const directEvidenceSegments=paperSide.filter(e=>{const t=String(e.quote||"").toLowerCase();return anchors.length>=2&&anchors.filter(a=>t.includes(String(a).toLowerCase())).length>=2;}).length;
    const axisSpecific=[],axisScores={};
    for(const query of (plan.queries||[]).filter(x=>x.id!=="q0")){
      const terms=axisTerms(query.axis), high=new Set(highSpecificityAxisTerms(query.axis)), matching=paperSide.filter(e=>e.matchedBy.includes(query.id));
      const termEvidence=matching.filter(e=>terms.some(t=>String(e.quote||"").toLowerCase().includes(t))), titleHits=terms.filter(t=>title.includes(t)).length;
      const highEv=matching.filter(e=>[...high].some(t=>String(e.quote||"").toLowerCase().includes(t))).length, highTitle=[...high].filter(t=>title.includes(t)).length;
      const directOnAxis=matching.filter(e=>{const t=String(e.quote||"").toLowerCase();return anchors.length>=2&&anchors.filter(a=>t.includes(String(a).toLowerCase())).length>=2;}).length;
      const axisMethods=[...new Set(matching.flatMap(e=>methodSignals(e.quote)))], qm=work.queryMatches.find(x=>x.id===query.id);
      const score=Math.min(18,termEvidence.length*3)+Math.min(18,titleHits*6)+Math.min(24,highEv*8)+Math.min(30,highTitle*15)+Math.min(15,directOnAxis*5)+Math.min(15,axisMethods.length*4)+Math.min(5,Number(qm?.score||0)/4);
      axisScores[query.id]=+score.toFixed(2); if(termEvidence.length)axisSpecific.push(query.id);
    }
    const numericEvidence=substantive.filter(x=>numericSignal(x.quote)).map(x=>x.id), conflictEvidence=substantive.filter(x=>conflictSignal(x.quote)).map(x=>x.id);
    const titleAnchorHits=anchors.filter(a=>title.includes(String(a).toLowerCase())).length, titleAxisHits=[...new Set((plan.queries||[]).flatMap(q=>axisTerms(q.axis)).filter(t=>title.includes(t)))].length;
    const focusedTitleScore=Math.min(18,titleAnchorHits*5+titleAxisHits*3+(/(mechanis|structur|conformation|membrane|interaction|regulation|activation)/i.test(title)?4:0));
    const reviewLike=/(review|overview|past \d+ years|human disease|cancer therapy|perspective)/i.test(title), tierPoints={strong:20,normal:14,weak:7,noise:0}[work.tier]||0;
    const mechanism=(plan.questionTypes||[]).includes("mechanism");
    const methodPoints=methods.reduce((s,n)=>s+(!mechanism?4:["genetic-perturbation","structure","biophysics","biochemistry","orthogonal-controls"].includes(n)?7:n==="cellular"?3:n==="omics"?1:0),0);
    const qualityScore=tierPoints+(directComparison?8:0)+Math.min(24,directEvidenceSegments*6)+Math.min(12,identityEvidenceSegments*4)+Math.min(18,paperSide.length*2)+Math.min(28,methodPoints)+Math.min(24,axisSpecific.length*6)+focusedTitleScore+(numericEvidence.length?3:0)+(conflictEvidence.length?2:0)-(reviewLike?14:0)-(paperSide.length?0:15);
    const coreEligible=paperSide.length>0&&(axisSpecific.length>0||directEvidenceSegments>0||identityEvidenceSegments>0)&&(directEvidenceSegments>0||identityEvidenceSegments>0||methods.some(x=>x!=="omics"));
    return {qualityScore,coreEligible,directComparison,directEvidenceSegments,identityEvidenceSegments,focusedTitleScore,reviewLike,substantiveEvidence:substantive.length,anchorsFound:anchorHits,paperSideEvidence:paperSide.length,axisCoverage:axisSpecific.length,axisSpecificQueries:axisSpecific,axisScores,methodSignals:methods,numericEvidence,conflictEvidence};
  }
  function parseEvidenceSlots(value,mustCover){
    if(!value)return mustCover.map((c,i)=>({id:`concept-${i+1}`,type:"other",concepts:[c],required:true}));
    let a;try{a=typeof value==="string"?JSON.parse(value):value;}catch(_){throw new Error("surveyAudit slots must be a JSON array");}
    if(!Array.isArray(a)||!a.length)throw new Error("surveyAudit slots must be a non-empty JSON array");
    const seen=new Set();return a.map((r,i)=>{const id=String(r?.id||`slot-${i+1}`).trim(),type=String(r?.type||"other").trim();if(!id||seen.has(id))throw new Error(`duplicate or empty evidence slot id: ${id||"(empty)"}`);if(!FACT_TYPES.has(type))throw new Error(`unsupported evidence slot type: ${type}`);seen.add(id);return{id,type,concepts:parseAxes(r?.concepts||r?.concept||""),required:r?.required!==false};});
  }

  async function initSchema(){
    await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB}.surveys (survey_id TEXT PRIMARY KEY, question TEXT NOT NULL, preset TEXT, evidence_policy TEXT, state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB}.survey_reviews (survey_id TEXT NOT NULL, work_key TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, reviewed_at TEXT, decision_json TEXT NOT NULL, PRIMARY KEY(survey_id,work_key))`);
    await Zotero.DB.queryAsync(`CREATE TABLE IF NOT EXISTS ${DB}.survey_facts (survey_id TEXT NOT NULL, fact_id TEXT NOT NULL, slot_id TEXT NOT NULL, type TEXT NOT NULL, value TEXT NOT NULL, work_key TEXT, source_type TEXT, source_locator TEXT, source_quote TEXT, original_verified INTEGER NOT NULL DEFAULT 0, recorded_at TEXT NOT NULL, fact_json TEXT NOT NULL, PRIMARY KEY(survey_id,fact_id))`);
    await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${DB}.idx_survey_reviews_status ON survey_reviews(survey_id,status)`);
    await Zotero.DB.queryAsync(`CREATE INDEX IF NOT EXISTS ${DB}.idx_survey_facts_slot ON survey_facts(survey_id,slot_id)`);
  }
  function serializeRecord(r){
    return {id:r.id,createdAt:r.createdAt,plan:r.plan,coverage:r.coverage,evidencePolicy:r.evidencePolicy,maxPerQuery:r.maxPerQuery,results:r.results,rawEvidenceByWork:Object.fromEntries(r.rawEvidenceByWork||[]),possibleLineages:r.possibleLineages||[],slotDefs:r.slotDefs||null,factSeq:r.factSeq||0};
  }
  async function saveRecord(r){
    const now=new Date().toISOString(), state=serializeRecord(r);
    await Zotero.DB.queryAsync(`INSERT INTO ${DB}.surveys(survey_id,question,preset,evidence_policy,state_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(survey_id) DO UPDATE SET question=excluded.question,preset=excluded.preset,evidence_policy=excluded.evidence_policy,state_json=excluded.state_json,updated_at=excluded.updated_at`,[r.id,r.plan.question,r.plan.preset,r.evidencePolicy,JSON.stringify(state),r.createdAt,now]);
  }
  async function loadRecord(id){
    await initSchema();
    const row=(await Zotero.DB.queryAsync(`SELECT * FROM ${DB}.surveys WHERE survey_id=?`,[String(id||"").trim()]))?.[0];
    if(!row)throw new Error(`unknown surveyId: ${id}`);
    const s=JSON.parse(row.state_json), reviewsRows=await Zotero.DB.queryAsync(`SELECT decision_json FROM ${DB}.survey_reviews WHERE survey_id=?`,[row.survey_id])||[], factRows=await Zotero.DB.queryAsync(`SELECT fact_json FROM ${DB}.survey_facts WHERE survey_id=? ORDER BY recorded_at`,[row.survey_id])||[];
    return {...s,rawEvidenceByWork:new Map(Object.entries(s.rawEvidenceByWork||{})),reviews:new Map(reviewsRows.map(x=>{const d=JSON.parse(x.decision_json);return[d.workKey,d];})),facts:factRows.map(x=>JSON.parse(x.fact_json))};
  }

  async function findLiteralInNote(noteKey, libraryKey, concept) {
    const needle = norm(concept).toLocaleLowerCase("und");
    if (!needle) return null;
    const p = await api().paper(noteKey, { libraryKey });
    for (const seg of p.segments || []) {
      const hay = norm(seg.text).toLocaleLowerCase("und");
      if (!hay.includes(needle)) continue;
      return { ...seg, citation: `${libraryKey || p.libraryKey}:${p.noteKey}:L${seg.lineStart}-L${seg.lineEnd}` };
    }
    return null;
  }
  async function traceQuote(noteKey,lineStart,lineEnd,libraryKey,maxChars=2000){
    const tr=await api().trace(noteKey,{libraryKey,from:lineStart,to:lineEnd,around:0,maxChars});
    return {quote:oneline(tr.rawText||tr.lines?.map(x=>x.text).join("\n")||tr.text,maxChars),citation:tr.citation||`${noteKey}:L${lineStart}-L${lineEnd}`,trace:tr};
  }
  async function normalizeFound(found){
    const notes=found.notes||[],best=Math.max(0,...notes.map(n=>Number(n.score||0)));
    for(const n of notes){
      n.paperKey=paperKeyOf(n); n.tier=tierFor(n,best); n.collapsedSiblings=(n.siblings||[]).length;
      const p=await api().paper(n.noteKey,{libraryKey:n.libraryKey});
      n.tagCounts={}; for(const s of p.segments||[]){const k=s.tag||"(none)";n.tagCounts[k]=(n.tagCounts[k]||0)+1;}
      for(const h of n.hits||[]){
        h.line=`L${h.lineStart}-L${h.lineEnd}`; h.section=h.sectionPath||h.heading||""; h.tagNote=segTagNote(h.tag,h.canonicalRole,n.profileId);
        try{const q=await traceQuote(n.noteKey,h.lineStart,h.lineEnd,n.libraryKey,1800);h.quote=q.quote;h.exact=true;h.citation=q.citation;}catch(_){h.quote="";h.exact=false;}
      }
    }
    found.truncation.availableAfterTierFilter=found.truncation.candidateNotes??notes.length;
    return found;
  }

  async function probe(){
    await initSchema(); const h=await api().health();
    const tags=(await Zotero.DB.queryAsync(`SELECT COALESCE(NULLIF(tag,''),'(none)') tag,COUNT(*) count FROM ${DB}.segments GROUP BY tag ORDER BY count DESC`)||[]).map(r=>({tag:r.tag,count:Number(r.count)||0}));
    const years=(await Zotero.DB.queryAsync(`SELECT year,COUNT(*) count FROM ${DB}.notes WHERE year IS NOT NULL AND year<>'' GROUP BY year ORDER BY year`)||[]).map(r=>({year:r.year,count:Number(r.count)||0}));
    const surveys=Number(await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM ${DB}.surveys`)||0);
    return {...h,evidenceTags:tags,years,persistedSurveys:surveys,capabilities:["native Zotero Note source","FTS lexical retrieval","shared semantic retrieval","persistent survey workflow","unified MCP"]};
  }
  async function find(question,opts={}){ return normalizeFound(await api().find(question,opts)); }
  async function traceMany(requests,opts={}){
    let list=requests;if(typeof list==="string")try{list=JSON.parse(list);}catch(_){throw new Error("requests must be a JSON array");}
    if(!Array.isArray(list)||!list.length)throw new Error("trace-many needs a non-empty requests array");
    const out=[];for(const r of list.slice(0,clampInt(opts.max,50,1,200))){try{out.push(await api().trace(r.noteKey||r.key,{...r,libraryKey:r.libraryKey||opts.libraryKey}));}catch(e){out.push({noteKey:r.noteKey||r.key,error:e.message});}}return{results:out};
  }
  async function compare(question,keys,opts={}){
    const list=(Array.isArray(keys)?keys:String(keys||"").split(/[,\s]+/)).filter(Boolean);if(!list.length)throw new Error("compare needs noteKeys");
    const notes=[];for(const raw of list){const [libMaybe,keyMaybe]=String(raw).includes(":")?String(raw).split(":",2):[opts.libraryKey||null,String(raw)];const key=keyMaybe||raw;try{const p=await api().paper(key,{libraryKey:libMaybe});const h=await api().hits(key,question,{libraryKey:libMaybe,limit:clampInt(opts.hits,3,1,8)});const counts={};for(const s of p.segments||[]){const t=s.tag||"(none)";counts[t]=(counts[t]||0)+1;}notes.push({noteKey:p.noteKey,libraryKey:p.libraryKey,paperKey:paperKeyOf({...p,zoteroParentKey:p.parentItemKey}),title:p.title,year:p.year,journal:p.journal,tagCounts:counts,untaggedNote:Object.keys(counts).length===1&&counts["(none)"],evidence:(h.hits||[]).map(s=>({line:`L${s.lineStart}-L${s.lineEnd}`,tag:s.tag||"",tagNote:segTagNote(s.tag,s.canonicalRole,p.profileId),section:s.sectionPath||s.heading||"",text:oneline(s.text,clampInt(opts.maxChars,500,120,3000))}))});}catch(e){notes.push({noteKey:key,error:e.message});}}
    return{question,noteKeys:list,notes,howToRead:["All notes are queried with the same question.","Paper-side tags and reader inference are separated.","Use lne_trace for verbatim canonical-note context; verify hard facts in the parent PDF."]};
  }
  async function unify(keys,opts={}){
    const list=(Array.isArray(keys)?keys:String(keys||"").split(/[,\s]+/)).filter(Boolean);if(!list.length)throw new Error("unify needs noteKeys");
    const rows=[];for(const k of list){try{const p=await api().paper(k,{libraryKey:opts.libraryKey});const pk=paperKeyOf({...p,zoteroParentKey:p.parentItemKey});rows.push({noteKey:p.noteKey,libraryKey:p.libraryKey,paperKey:pk,title:p.title,year:p.year,journal:p.journal,doi:p.doi,noteStyle:p.noteStyle||null,taggedSegments:(p.segments||[]).filter(x=>x.tag).length});}catch(e){rows.push({noteKey:String(k),error:e.message});}}
    const m=new Map();for(const r of rows)if(r.paperKey){if(!m.has(r.paperKey))m.set(r.paperKey,[]);m.get(r.paperKey).push(r.noteKey);}const groups=[...m.entries()].filter(([,v])=>v.length>1).map(([paperKey,noteKeys])=>({paperKey,noteKeys,note:"same paper; count once"}));
    return{notes:rows,samePaperGroups:groups,distinctPapers:m.size,distinctNotes:rows.filter(x=>!x.error).length};
  }
  async function searchRaw(question,opts={}){
    const r=await find(question,{top:clampInt(opts.limit,40,1,200),hits:clampInt(opts.hits,3,1,10),maxChars:clampInt(opts.maxChars,300,80,2000),dupStyle:"both",showDup:true,lexicalOnly:!!opts.lexicalOnly});
    return{question,note:"Raw uncollapsed ranking for audit.",mode:r.mode,semantic:r.semantic,totals:{candidateNotes:r.truncation.candidateNotes||r.notes.length,returned:r.notes.length},rows:r.notes.map(n=>({noteKey:n.noteKey,libraryKey:n.libraryKey,paperKey:n.paperKey,title:n.title,tier:n.tier,score:n.score,segments:n.hits.map(s=>({line:s.line,tag:s.tag||"",section:s.section,semanticScore:s.semanticScore,lexicalScore:s.lexicalScore,text:oneline(s.text,clampInt(opts.maxChars,300,80,2000))}))}))};
  }

  function surveyPlan(question,opts={}){
    const q=String(question||"").trim();if(!q)throw new Error("survey-plan needs question");const preset=["quick","balanced","exhaustive","audit"].includes(opts.preset)?opts.preset:"balanced",defaultN={quick:3,balanced:6,exhaustive:10,audit:12}[preset],maxQueries=clampInt(opts.maxQueries,defaultN,1,20),types=classifyQuestion(q),anchors=extractSurveyAnchors(q,opts.anchors),anchorQuery=anchors.length?anchors.join(" "):q,supplied=parseAxes(opts.axes),axes=[...new Set(supplied.length?supplied:genericAxes(types))],queries=[{id:"q0",axis:"core question",query:q}];
    for(const axis of axes){if(queries.length>=maxQueries)break;queries.push({id:`q${queries.length}`,axis,query:`${anchorQuery} ${axis}`,queryMode:"anchor-plus-axis"});}
    return{question:q,preset,questionTypes:types,anchors,termIdentityPolicy:identifierIdentityAudit(anchors),axes,queries,stoppingRule:{minimumQueries:Math.min(3,queries.length),saturationRounds:clampInt(opts.saturationRounds,preset==="quick"?1:2,1,5),newWorkRatioBelow:Number.isFinite(Number(opts.newWorkThreshold))?Math.max(0,Math.min(1,Number(opts.newWorkThreshold))):.01,metric:"new qualified core works / current qualified core union"},designNote:supplied.length?"caller-supplied axes":"generic question-type axes"};
  }
  async function addAxisEvidence(work,note,query,anchors,limit=4){
    if(query.id==="q0")return;const p=await api().paper(note.noteKey,{libraryKey:note.libraryKey}),terms=axisTerms(query.axis),high=highSpecificityAxisTerms(query.axis),anchorTerms=(anchors||[]).map(x=>String(x).toLowerCase());let cand=[];
    for(const s of p.segments||[]){if(roleOf(s.tag,s.canonicalRole,p.profileId)!=="OBSERVED_EVIDENCE")continue;const section=s.sectionPath||s.heading||"";if(referenceLikeEvidence({section}))continue;const t=String(s.text||"").toLowerCase(),ah=anchorTerms.filter(x=>t.includes(x)).length,th=terms.filter(x=>t.includes(x)).length,hh=high.filter(x=>t.includes(x)).length;if(anchorTerms.length&&!ah)continue;if(!hh&&th<2)continue;cand.push({s,section,ah,th,hh});}
    cand.sort((a,b)=>Number(b.ah>=2)-Number(a.ah>=2)||b.hh-a.hh||b.th-a.th||methodSignals(b.s.text).length-methodSignals(a.s.text).length);
    for(const {s,section} of cand.slice(0,limit)){const id=`${note.libraryKey}:${note.noteKey}:${s.lineStart}-${s.lineEnd}`;const ex=work._allEvidence.find(x=>x.id===id);if(ex){if(!ex.matchedBy.includes(query.id))ex.matchedBy.push(query.id);continue;}const q=await traceQuote(note.noteKey,s.lineStart,s.lineEnd,note.libraryKey,1200);const cls=evidenceClass(s.tag,s.canonicalRole,p.profileId);work._rawEvidenceClasses.add(cls);work._allEvidence.push({id,noteKey:note.noteKey,libraryKey:note.libraryKey,lineStart:s.lineStart,lineEnd:s.lineEnd,tag:s.tag,canonicalRole:s.canonicalRole,evidenceClass:cls,section,quote:q.quote,exact:true,matchedBy:[query.id],source:"candidate-note-axis-scan"});}
  }
  async function surveyRun(question,opts={}){
    await initSchema();const plan=surveyPlan(question,opts),maxPerQuery=clampInt(opts.maxPerQuery,plan.preset==="quick"?50:plan.preset==="balanced"?200:500,1,500),perNote=clampInt(opts.hits,3,1,8),evidencePolicy=["paper-side-only","paper-side-preferred","all"].includes(opts.evidencePolicy)?opts.evidencePolicy:"paper-side-preferred",works=new Map(),coverage=[];let low=0,previousQualified=0;const tierRank={strong:0,normal:1,weak:2,noise:3};
    for(let i=0;i<plan.queries.length;i++){
      const pq=plan.queries[i],before=works.size,found=await find(pq.query,{top:maxPerQuery,hits:perNote,dupStyle:opts.dupStyle||"bar",lexicalOnly:!!opts.lexicalOnly});
      for(const note of found.notes){if(!opts.includeNoise&&note.tier==="noise")continue;const key=surveyWorkKey(note);let w=works.get(key);if(!w){w={workKey:key,paperKey:note.paperKey,noteKey:note.noteKey,libraryKey:note.libraryKey,noteKeys:[note.noteKey],noteRefs:[{libraryKey:note.libraryKey,noteKey:note.noteKey}],title:note.title,year:note.year,journal:note.journal,doi:note.doi,authors:note.authors,tier:note.tier,bestScore:note.score,zoteroParent:note.zoteroParent||"",zoteroParents:note.zoteroParent?[note.zoteroParent]:[],zoteroParentKey:note.zoteroParentKey||"",zoteroNote:note.zoteroNote||"",queryMatches:[],_allEvidence:[],tagCounts:{},_rawEvidenceClasses:new Set()};works.set(key,w);}if(!w.noteKeys.includes(note.noteKey))w.noteKeys.push(note.noteKey);if(!w.noteRefs.some(x=>x.libraryKey===note.libraryKey&&x.noteKey===note.noteKey))w.noteRefs.push({libraryKey:note.libraryKey,noteKey:note.noteKey});if(note.zoteroParent&&!w.zoteroParents.includes(note.zoteroParent))w.zoteroParents.push(note.zoteroParent);w.bestScore=Math.max(w.bestScore,note.score);if((tierRank[note.tier]??9)<(tierRank[w.tier]??9))w.tier=note.tier;if(!w.queryMatches.some(x=>x.id===pq.id))w.queryMatches.push({id:pq.id,axis:pq.axis,score:note.score,tier:note.tier});for(const[tag,c]of Object.entries(note.tagCounts||{}))w.tagCounts[tag]=Math.max(w.tagCounts[tag]||0,c);for(const hit of note.hits||[]){const cls=evidenceClass(hit.tag,hit.canonicalRole,note.profileId),eid=`${note.libraryKey}:${note.noteKey}:${hit.lineStart}-${hit.lineEnd}`;w._rawEvidenceClasses.add(cls);const ex=w._allEvidence.find(x=>x.id===eid);if(ex){if(!ex.matchedBy.includes(pq.id))ex.matchedBy.push(pq.id);}else w._allEvidence.push({id:eid,noteKey:note.noteKey,libraryKey:note.libraryKey,line:hit.line,lineStart:hit.lineStart,lineEnd:hit.lineEnd,tag:hit.tag,evidenceClass:cls,section:hit.section,quote:hit.quote||hit.text||"",exact:!!hit.exact,matchedBy:[pq.id]});}await addAxisEvidence(w,note,pq,plan.anchors,4);}
      const added=works.size-before,qualified=[...works.values()].filter(w=>scoreSurveyWork(w,plan).coreEligible).length,newQ=Math.max(0,qualified-previousQualified),ratio=qualified?newQ/qualified:0;low=ratio<plan.stoppingRule.newWorkRatioBelow?low+1:0;coverage.push({...pq,returnedNotes:found.notes.length,availableAfterTierFilter:found.truncation.availableAfterTierFilter,queryTruncated:found.truncation.truncated,newWorks:added,unionWorks:works.size,qualifiedCoreWorks:qualified,newQualifiedCoreWorks:newQ,newQualifiedRatio:+ratio.toFixed(4)});previousQualified=qualified;if(i+1>=plan.stoppingRule.minimumQueries&&low>=plan.stoppingRule.saturationRounds)break;
    }
    const rawEvidenceByWork=new Map(),perAxis=clampInt(opts.evidencePerAxis??opts.evidencePerWork,3,1,8),results=[...works.values()].map(w=>{w._allEvidence.sort((a,b)=>Number(referenceLikeEvidence(a))-Number(referenceLikeEvidence(b))||({"paper-side":0,interpretive:1,untagged:2}[a.evidenceClass]??9)-({"paper-side":0,interpretive:1,untagged:2}[b.evidenceClass]??9)||Number(b.exact)-Number(a.exact));rawEvidenceByWork.set(w.workKey,w._allEvidence);w.evidenceClass=w._rawEvidenceClasses.has("paper-side")?"paper-side":w._rawEvidenceClasses.has("interpretive")?"interpretive-only":"untagged-or-no-hit";w.screening=scoreSurveyWork(w,plan);const allowed=e=>evidencePolicy!=="paper-side-only"||e.evidenceClass==="paper-side",selected=new Map(),evidenceByAxis={};for(const q of plan.queries){const rows=w._allEvidence.filter(e=>e.matchedBy.includes(q.id)&&allowed(e)).slice(0,perAxis);evidenceByAxis[q.id]=rows.map(e=>e.id);for(const e of rows)selected.set(e.id,e);}w.evidenceByAxis=evidenceByAxis;w.evidence=[...selected.values()];w.navigationEvidence=w.evidence.length?[]:w._allEvidence.filter(e=>e.evidenceClass!=="paper-side").slice(0,2);delete w._rawEvidenceClasses;delete w._allEvidence;return w;}).sort((a,b)=>b.screening.qualityScore-a.screening.qualityScore||b.bestScore-a.bestScore);
    const id=`survey-${Date.now().toString(36)}-${(++surveySeq).toString(36)}`,record={id,createdAt:new Date().toISOString(),plan,coverage,evidencePolicy,maxPerQuery,results,rawEvidenceByWork,possibleLineages:lineageSuggestions(results),reviews:new Map(),facts:[],factSeq:0,slotDefs:null};await saveRecord(record);return surveyResults(id,{offset:0,limit:clampInt(opts.pageSize,50,1,200)});
  }
  async function surveyResults(id,opts={}){const r=await loadRecord(id),offset=clampInt(opts.offset,0,0,1e6),limit=clampInt(opts.limit,50,1,200);let rows=r.results;if(opts.tier)rows=rows.filter(x=>x.tier===opts.tier);if(opts.evidenceClass)rows=rows.filter(x=>x.evidenceClass===opts.evidenceClass);const page=rows.slice(offset,offset+limit),classCounts={},tierCounts={};for(const x of r.results){classCounts[x.evidenceClass]=(classCounts[x.evidenceClass]||0)+1;tierCounts[x.tier]=(tierCounts[x.tier]||0)+1;}return{surveyId:r.id,createdAt:r.createdAt,question:r.plan.question,preset:r.plan.preset,evidencePolicy:r.evidencePolicy,plan:r.plan,coverage:r.coverage,totals:{works:r.results.length,filteredWorks:rows.length,evidenceClass:classCounts,tier:tierCounts},dedupe:{method:"DOI, else normalized exact title+year, else Zotero parent identity",warning:"Possible preprint/published lineage is flagged, never silently merged."},possibleLineages:r.possibleLineages,pagination:{offset,limit,returned:page.length,nextOffset:offset+page.length<rows.length?offset+page.length:null},persistence:{storedIn:"zotquery-lne.sqlite",survivesRestart:true},results:page};}
  async function surveyScreen(id,opts={}){const r=await loadRecord(id);let rows=r.results;const coreOnly=opts.coreOnly===undefined?true:!!opts.coreOnly;if(coreOnly)rows=rows.filter(x=>x.screening.coreEligible);if(opts.requirePaperSide)rows=rows.filter(x=>x.screening.paperSideEvidence>0);if(opts.directComparisonOnly)rows=rows.filter(x=>x.screening.directComparison);const minQuality=Number.isFinite(Number(opts.minQuality))?Number(opts.minQuality):0;rows=rows.filter(x=>x.screening.qualityScore>=minQuality);const offset=clampInt(opts.offset,0,0,1e6),limit=clampInt(opts.limit,30,1,100),axisShortlists={};for(const q of r.plan.queries.filter(x=>x.id!=="q0"))axisShortlists[q.id]=rows.filter(x=>x.screening.axisSpecificQueries.includes(q.id)).sort((a,b)=>(b.screening.axisScores[q.id]||0)-(a.screening.axisScores[q.id]||0)||b.screening.qualityScore-a.screening.qualityScore).slice(0,5).map(x=>({noteKey:x.noteKey,workKey:x.workKey,title:x.title,axisScore:x.screening.axisScores[q.id],qualityScore:x.screening.qualityScore}));return{surveyId:r.id,question:r.plan.question,criteria:{coreOnly,requirePaperSide:!!opts.requirePaperSide,directComparisonOnly:!!opts.directComparisonOnly,minQuality},totals:{allWorks:r.results.length,screenedWorks:rows.length},pagination:{offset,limit,returned:rows.slice(offset,offset+limit).length,nextOffset:offset+limit<rows.length?offset+limit:null},rankingRule:"qualityScore rewards direct comparison, paper-side evidence, mechanistic methods, axis coverage, numeric evidence, and conflict handling.",axisShortlists,possibleLineages:r.possibleLineages,results:rows.slice(offset,offset+limit)};}
  async function surveyReview(id,workKey,opts={}){const r=await loadRecord(id),key=String(workKey||"").trim(),w=r.results.find(x=>x.workKey===key||x.paperKey===key||x.noteKey===key);if(!w)throw new Error(`workKey not in survey: ${key}`);const status=String(opts.status||"").trim(),reason=String(opts.reason||"").trim();if(!["pending","included","excluded"].includes(status))throw new Error("status must be pending|included|excluded");if(status!=="pending"&&!reason)throw new Error("included/excluded requires reason");const d={workKey:w.workKey,noteKey:w.noteKey,title:w.title,status,reason,reviewedAt:new Date().toISOString()};await Zotero.DB.queryAsync(`INSERT INTO ${DB}.survey_reviews(survey_id,work_key,status,reason,reviewed_at,decision_json) VALUES(?,?,?,?,?,?) ON CONFLICT(survey_id,work_key) DO UPDATE SET status=excluded.status,reason=excluded.reason,reviewed_at=excluded.reviewed_at,decision_json=excluded.decision_json`,[r.id,w.workKey,status,reason,d.reviewedAt,JSON.stringify(d)]);return{surveyId:r.id,decision:d,persisted:true};}
  async function surveyFact(id,slotId,opts={}){const r=await loadRecord(id),sid=String(slotId||"").trim(),type=String(opts.type||"").trim(),value=String(opts.value||"").trim();if(!sid||!FACT_TYPES.has(type)||!value)throw new Error("survey-fact requires valid slotId, type, value");const slot=r.slotDefs?.find(x=>x.id===sid)||null;if(r.slotDefs&&!slot)throw new Error(`unknown evidence slot: ${sid}`);if(slot&&slot.type!=="other"&&slot.type!==type)throw new Error(`fact type ${type} does not match slot ${sid} type ${slot.type}`);const sourceType=String(opts.sourceType||"").trim(),sourceLocator=String(opts.sourceLocator||"").trim(),originalVerified=opts.originalVerified===true;if(originalVerified&&(!new Set(["pdf","pmc","publisher","database_record"]).has(sourceType)||!sourceLocator))throw new Error("originalVerified requires original sourceType and sourceLocator");let workKey=String(opts.workKey||"").trim();if(workKey){const w=r.results.find(x=>x.workKey===workKey||x.paperKey===workKey||x.noteKey===workKey);if(!w)throw new Error(`fact workKey not in survey: ${workKey}`);workKey=w.workKey;}r.factSeq=(r.factSeq||0)+1;const fact={factId:`${r.id}:fact-${r.factSeq}`,slotId:sid,type,value,workKey:workKey||null,sourceType:sourceType||"note",sourceLocator,sourceQuote:String(opts.sourceQuote||"").trim(),originalVerified,recordedAt:new Date().toISOString()};await Zotero.DB.queryAsync(`INSERT INTO ${DB}.survey_facts(survey_id,fact_id,slot_id,type,value,work_key,source_type,source_locator,source_quote,original_verified,recorded_at,fact_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[r.id,fact.factId,sid,type,value,fact.workKey,fact.sourceType,sourceLocator,fact.sourceQuote,originalVerified?1:0,fact.recordedAt,JSON.stringify(fact)]);await saveRecord(r);return{surveyId:r.id,fact,closureEligible:originalVerified,intervalTypePolicy:INTERVAL_TYPES.has(type)?"Interval types remain biologically distinct even when numeric ranges match.":null};}
  async function surveyAudit(id,opts={}){
    const r=await loadRecord(id),mustCover=[...new Set(parseAxes(opts.mustCover))];if(!mustCover.length)throw new Error("survey-audit needs mustCover");const slots=opts.slots?parseEvidenceSlots(opts.slots,mustCover):(r.slotDefs||parseEvidenceSlots("",mustCover));r.slotDefs=slots;await saveRecord(r);const tierOrder={strong:0,normal:1,weak:2,noise:3},minTier=["strong","normal","weak","noise"].includes(opts.tier)?opts.tier:"strong",cap=clampInt(opts.maxPerConcept,30,1,100),candidates=r.results.filter(w=>(tierOrder[w.tier]??9)<=tierOrder[minTier]),conceptCoverage=[],reviewMap=new Map();
    for(const concept of mustCover){const matches=[];for(const w of candidates){let first=null;for(const ref of w.noteRefs||[{libraryKey:w.libraryKey,noteKey:w.noteKey}]){const hit=await findLiteralInNote(ref.noteKey,ref.libraryKey,concept);if(hit){first={ref,hit};break;}}if(!first)continue;const row={workKey:w.workKey,noteKey:first.ref.noteKey,libraryKey:first.ref.libraryKey,title:w.title,year:w.year||null,doi:w.doi||null,tier:w.tier,qualityScore:w.screening?.qualityScore??null,zoteroParent:w.zoteroParent||"",citation:first.hit.citation,tag:first.hit.tag||"",tagNote:segTagNote(first.hit.tag,first.hit.canonicalRole),text:first.hit.text||"",noteLevelOnly:true,literalVerified:true,requiredNextStep:"Verify the structured fact against an original PDF/PMC passage before synthesis."};matches.push(row);const prior=reviewMap.get(w.workKey),decision=r.reviews.get(w.workKey)||{};if(prior)prior.matchedConcepts.push(concept);else reviewMap.set(w.workKey,{...row,matchedConcepts:[concept],reviewStatus:decision.status||"pending",reviewReason:decision.reason||"",reviewedAt:decision.reviewedAt||null});}matches.sort((a,b)=>(b.qualityScore||0)-(a.qualityScore||0)||String(a.title).localeCompare(String(b.title)));conceptCoverage.push({concept,candidateCount:matches.length,covered:matches.length>0,candidates:matches.slice(0,cap),truncated:matches.length>cap});}
    const mustReview=[...reviewMap.values()].sort((a,b)=>(b.qualityScore||0)-(a.qualityScore||0)),uncovered=conceptCoverage.filter(x=>!x.covered).map(x=>x.concept),terminal=new Set(["included","excluded"]),pendingReviews=mustReview.filter(x=>!terminal.has(x.reviewStatus)).map(x=>x.workKey),included=new Set(mustReview.filter(x=>x.reviewStatus==="included").map(x=>x.workKey)),facts=r.facts.map(x=>({...x})),evidenceSlots=slots.map(s=>{const sf=facts.filter(f=>f.slotId===s.id),vf=sf.filter(f=>f.originalVerified&&(!f.workKey||included.has(f.workKey)));return{...s,noteConceptsCovered:s.concepts.length===0||s.concepts.every(c=>!!conceptCoverage.find(x=>x.concept===c)?.covered),factCount:sf.length,verifiedOriginalFactCount:vf.length,closed:vf.length>0,factIds:sf.map(f=>f.factId)}}),open=evidenceSlots.filter(s=>s.required&&!s.closed).map(s=>s.id),m=new Map();for(const f of facts.filter(x=>INTERVAL_TYPES.has(x.type))){const v=String(f.value||"").normalize("NFKC").replace(/\s+/g,"").toLowerCase();if(!v)continue;if(!m.has(v))m.set(v,new Set());m.get(v).add(f.type);}const cross=[...m.entries()].filter(([,t])=>t.size>1).map(([value,types])=>({value,types:[...types],warning:"Same range/value recorded under different interval types; do not merge biological meanings."})),blockers=[];if(uncovered.length)blockers.push(`uncovered concepts: ${uncovered.join(", ")}`);if(!mustReview.length)blockers.push("no must-review candidates");if(pendingReviews.length)blockers.push(`pending candidate decisions: ${pendingReviews.length}`);if(open.length)blockers.push(`open required evidence slots: ${open.join(", ")}`);if(cross.length)blockers.push(`cross-type interval warnings: ${cross.length}`);return{surveyId:r.id,question:r.plan.question,scope:{tier:minTier,auditedWorks:candidates.length,mustCover},evidenceBoundary:"Note hits are navigation evidence; original-source verification is required for hard facts.",reviewContract:"Every mustReview candidate needs a terminal decision and every required slot needs an original-source-verified typed fact.",conceptCoverage,mustReview,uncovered,evidenceSlots,facts,crossTypeWarnings:cross,blockers,readyForSynthesis:blockers.length===0};
  }
  async function surveyDeepRead(id,opts={}){const r=await loadRecord(id),requested=parseAxes(opts.noteKeys),exhaustive=["exhaustive","audit"].includes(r.plan.preset),offset=clampInt(opts.offset,0,0,1e6),wanted=clampInt(opts.limit,exhaustive?60:30,1,100);let chosen;if(requested.length)chosen=r.results.filter(x=>requested.includes(x.noteKey)||requested.includes(x.workKey)).slice(offset,offset+wanted);else chosen=r.results.filter(x=>x.screening.coreEligible).slice(offset,offset+wanted);if(!chosen.length)throw new Error("survey-deep-read found no matching core papers");const perAxis=clampInt(opts.evidencePerAxis,3,1,6),papers=[];for(const w of chosen){const raw=r.rawEvidenceByWork.get(w.workKey)||[],axisEvidence=[];for(const q of r.plan.queries){const candidates=raw.filter(e=>e.matchedBy.includes(q.id)&&e.evidenceClass==="paper-side"&&!referenceLikeEvidence(e)).slice(0,perAxis),verified=[];for(const e of candidates){try{const tr=await api().trace(e.noteKey,{libraryKey:e.libraryKey,from:e.lineStart,to:e.lineEnd,around:0,maxChars:clampInt(opts.maxChars,6000,500,20000),quote:e.quote});verified.push({citation:tr.citation,noteKey:tr.noteKey,libraryKey:tr.libraryKey,tag:e.tag,section:e.section,verified:tr.quoteCheck?.verified??true,text:tr.rawText||tr.text,zoteroParent:tr.zoteroParent,methodSignals:methodSignals(tr.rawText||tr.text),numeric:numericSignal(tr.rawText||tr.text),conflict:conflictSignal(tr.rawText||tr.text)});}catch(err){verified.push({citation:e.id,noteKey:e.noteKey,verified:false,error:err.message});}}axisEvidence.push({queryId:q.id,axis:q.axis,evidence:verified});}papers.push({workKey:w.workKey,noteKey:w.noteKey,title:w.title,year:w.year,doi:w.doi,authors:w.authors,zoteroParents:w.zoteroParents,screening:w.screening,axisEvidence});}return{surveyId:r.id,question:r.plan.question,selectedPapers:papers.length,pagination:{offset,limit:wanted,returned:papers.length,nextOffset:offset+papers.length<r.results.filter(x=>x.screening.coreEligible).length?offset+papers.length:null},selection:requested.length?"caller-specified":"core papers by qualityScore",synthesisGuide:{rule:"Synthesize only from verified paper-side evidence; note evidence remains navigation until parent-PDF verification.",requiredOutputs:["conclusion by axis","proof method","numeric results","conflicts and boundary conditions","parent Zotero links"]},possibleLineages:r.possibleLineages,papers};}

  const TOOL_DEFS = [
    ["lne_probe","Corpus/index health, evidence-tag distribution, and persistent-survey status",{}],
    ["lne_find","Find reading notes for a question with lexical/semantic evidence segments",{question:{type:"string"},top:{type:"integer",minimum:1,maximum:500},hits:{type:"integer",minimum:1,maximum:8},dupStyle:{type:"string",enum:["bar","pin","both"]},lexicalOnly:{type:"boolean"},evidenceOnly:{type:"boolean"},hideInference:{type:"boolean"}}],
    ["lne_trace","Read canonical-note lines with provenance",{noteKey:{type:"string"},libraryKey:{type:"string"},from:{type:"integer"},to:{type:"integer"},around:{type:"integer",minimum:0,maximum:100},quote:{type:"string"}}],
    ["lne_trace_many","Trace multiple note ranges",{requests:{},max:{type:"integer",minimum:1,maximum:200}}],
    ["lne_hits","Search within one indexed note",{noteKey:{type:"string"},libraryKey:{type:"string"},query:{type:"string"},limit:{type:"integer",minimum:1,maximum:200}}],
    ["lne_read","Page canonical note text",{noteKey:{type:"string"},libraryKey:{type:"string"},startLine:{type:"integer"},limit:{type:"integer",minimum:1,maximum:500}}],
    ["lne_paper","Return all parsed segments and metadata for one note",{noteKey:{type:"string"},libraryKey:{type:"string"}}],
    ["lne_compare","Compare a question across specified notes",{question:{type:"string"},noteKeys:{},libraryKey:{type:"string"},hits:{type:"integer"},maxChars:{type:"integer"}}],
    ["lne_unify","Collapse note keys to paper identities and identify duplicate note generations",{noteKeys:{},libraryKey:{type:"string"}}],
    ["lne_search_raw","Audit uncollapsed search ranking",{question:{type:"string"},limit:{type:"integer"},hits:{type:"integer"},maxChars:{type:"integer"},lexicalOnly:{type:"boolean"}}],
    ["lne_survey_plan","Plan a broad generic multi-axis literature survey",{question:{type:"string"},preset:{type:"string",enum:["quick","balanced","exhaustive","audit"]},anchors:{},axes:{},maxQueries:{type:"integer"},saturationRounds:{type:"integer"},newWorkThreshold:{type:"number"}}],
    ["lne_survey_run","Run and persist a broad multi-query LNE survey",{question:{type:"string"},preset:{type:"string",enum:["quick","balanced","exhaustive","audit"]},anchors:{},axes:{},maxQueries:{type:"integer"},maxPerQuery:{type:"integer"},hits:{type:"integer"},evidencePerAxis:{type:"integer"},pageSize:{type:"integer"},includeNoise:{type:"boolean"},evidencePolicy:{type:"string",enum:["paper-side-only","paper-side-preferred","all"]},dupStyle:{type:"string",enum:["bar","pin","both"]},lexicalOnly:{type:"boolean"}}],
    ["lne_survey_results","Page a persisted survey",{surveyId:{type:"string"},offset:{type:"integer"},limit:{type:"integer"},tier:{type:"string",enum:["strong","normal","weak","noise"]},evidenceClass:{type:"string",enum:["paper-side","interpretive-only","untagged-or-no-hit"]}}],
    ["lne_survey_screen","Screen a survey for mechanism-grade core papers",{surveyId:{type:"string"},coreOnly:{type:"boolean"},requirePaperSide:{type:"boolean"},directComparisonOnly:{type:"boolean"},minQuality:{type:"integer"},offset:{type:"integer"},limit:{type:"integer"}}],
    ["lne_survey_audit","Audit must-cover concepts and typed Evidence Slots",{surveyId:{type:"string"},mustCover:{},slots:{},tier:{type:"string",enum:["strong","normal","weak","noise"]},maxPerConcept:{type:"integer"}}],
    ["lne_survey_review","Persist an included/excluded/pending decision for a survey work",{surveyId:{type:"string"},workKey:{type:"string"},status:{type:"string",enum:["pending","included","excluded"]},reason:{type:"string"}}],
    ["lne_survey_fact","Persist a typed evidence-slot fact",{surveyId:{type:"string"},slotId:{type:"string"},type:{type:"string"},value:{type:"string"},workKey:{type:"string"},sourceType:{type:"string"},sourceLocator:{type:"string"},sourceQuote:{type:"string"},originalVerified:{type:"boolean"}}],
    ["lne_survey_deep_read","Read trace-verified paper-side evidence from core survey papers",{surveyId:{type:"string"},noteKeys:{},offset:{type:"integer"},limit:{type:"integer"},evidencePerAxis:{type:"integer"},maxChars:{type:"integer"}}],
  ];
  const REQUIRED = {
    lne_probe: [], lne_find: ["question"], lne_trace: ["noteKey"], lne_trace_many: ["requests"],
    lne_hits: ["noteKey","query"], lne_read: ["noteKey"], lne_paper: ["noteKey"],
    lne_compare: ["question","noteKeys"], lne_unify: ["noteKeys"], lne_search_raw: ["question"],
    lne_survey_plan: ["question"], lne_survey_run: ["question"], lne_survey_results: ["surveyId"],
    lne_survey_screen: ["surveyId"], lne_survey_audit: ["surveyId","mustCover"],
    lne_survey_review: ["surveyId","workKey","status"], lne_survey_fact: ["surveyId","slotId","type","value"],
    lne_survey_deep_read: ["surveyId"],
  };
  for (let i = 0; i < TOOL_DEFS.length; i++) {
    const [name, description, properties] = TOOL_DEFS[i];
    TOOL_DEFS[i] = { name, description, inputSchema: { type: "object", properties, required: REQUIRED[name] || [] } };
  }

  async function callTool(name,a={}){
    switch(name){
      case"lne_probe":return probe();case"lne_find":return find(a.question,a);case"lne_trace":return api().trace(a.noteKey,a);case"lne_trace_many":return traceMany(a.requests,a);case"lne_hits":return api().hits(a.noteKey,a.query,a);case"lne_read":return api().read(a.noteKey,a);case"lne_paper":return api().paper(a.noteKey,a);case"lne_compare":return compare(a.question,a.noteKeys,a);case"lne_unify":return unify(a.noteKeys,a);case"lne_search_raw":return searchRaw(a.question,a);case"lne_survey_plan":return surveyPlan(a.question,a);case"lne_survey_run":return surveyRun(a.question,a);case"lne_survey_results":return surveyResults(a.surveyId,a);case"lne_survey_screen":return surveyScreen(a.surveyId,a);case"lne_survey_audit":return surveyAudit(a.surveyId,a);case"lne_survey_review":return surveyReview(a.surveyId,a.workKey,a);case"lne_survey_fact":return surveyFact(a.surveyId,a.slotId,a);case"lne_survey_deep_read":return surveyDeepRead(a.surveyId,a);default:throw new Error(`Unknown LNE tool: ${name}`);
    }
  }
  async function startup(){if(started)return;if(!api())throw new Error("LNE Native core not available");await initSchema();Object.assign(api(),{probe,traceMany,compare,unify,searchRaw,surveyPlan,surveyRun,surveyResults,surveyScreen,surveyAudit,surveyReview,surveyFact,surveyDeepRead,toolDefinitions:()=>TOOL_DEFS,callTool});started=true;Zotero.debug(`[ZotQuery LNE Tools] started ${VERSION}`);}
  async function shutdown(){started=false;}
  Zotero.ZotQueryLNETools={version:VERSION,startup,shutdown,toolDefinitions:()=>TOOL_DEFS,callTool,
    _extractSurveyAnchors:extractSurveyAnchors,_classifyQuestion:classifyQuestion,_scoreSurveyWork:scoreSurveyWork};
  global.ZotQueryLNEToolsBootstrap={startup,shutdown};
})(typeof _globalThis !== "undefined" ? _globalThis : this);
