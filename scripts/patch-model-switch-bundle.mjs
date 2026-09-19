// Reproducible, anchored edit of the upstream-derived compiled entry point.
// The distributed package does not contain the original TypeScript sources.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "content", "scripts", "index.js");
let source = fs.readFileSync(file, "utf8");

function replaceOnce(before, after, label) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + 1) >= 0) {
    throw new Error(`${label}: expected exactly one build anchor`);
  }
  source = source.slice(0, at) + after + source.slice(at + before.length);
}

const helpers = `
async function zotqueryServerDigest(model) {
  const client = new oe({baseUrl:model.baseUrl,serverModelName:model.serverModelName,apiKey:model.apiKey});
  const tags = await client.request("/api/tags", {method:"GET"}, 8000);
  const record = (Array.isArray(tags?.models) ? tags.models : []).find(x => x?.name === model.serverModelName);
  return /^[0-9a-f]{64}$/i.test(record?.digest || "") ? record.digest.toLowerCase() : null;
}
async function zotqueryServerProbes(model) {
  const client = new oe({baseUrl:model.baseUrl,serverModelName:model.serverModelName,apiKey:model.apiKey});
  return client.embed([
    Se("ZotQuery fixed document compatibility probe", "doc", model),
    Se("ZotQuery fixed query compatibility probe", "query", model)
  ], 0);
}
function zotqueryProbeCosine(a, b, dimensions) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== dimensions || b.length !== dimensions) return -1;
  let dot=0, aa=0, bb=0;
  for (let i=0;i<dimensions;i++) {
    const x=Number(a[i]), y=Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
    dot+=x*y; aa+=x*x; bb+=y*y;
  }
  return aa>0 && bb>0 ? dot/Math.sqrt(aa*bb) : -1;
}
async function zotqueryEquivalentServerModels(previous, next) {
  if (previous?.runtime !== "server" || next?.runtime !== "server" ||
      previous.dimensions !== next.dimensions ||
      previous.queryPrefix !== next.queryPrefix || previous.docPrefix !== next.docPrefix ||
      previous.pooling !== next.pooling || previous.normalize !== next.normalize) return null;
  const saved = Te().find(x => x.id === previous.id);
  const nextDigest = await zotqueryServerDigest(next);
  if (!nextDigest) return null;
  const oldDigest = saved?.verifiedDigest || await zotqueryServerDigest(previous);
  if (!oldDigest || oldDigest !== nextDigest) return null;
  const oldProbes = saved?.compatibilityProbes || await zotqueryServerProbes(previous);
  const nextProbes = await zotqueryServerProbes(next);
  if (!Array.isArray(oldProbes) || !Array.isArray(nextProbes) || oldProbes.length !== 2 || nextProbes.length !== 2) return null;
  if (oldProbes.some((v,i) => zotqueryProbeCosine(v,nextProbes[i],next.dimensions) < 0.999)) return null;
  return {digest:nextDigest,probes:nextProbes};
}
async function zotqueryRememberServerIdentity(model) {
  const raw = Te().find(x => x.id === model.id);
  if (!raw || model.runtime !== "server") return;
  let digest;
  try { digest = await zotqueryServerDigest(model); }
  catch (_) { return; } // Non-Ollama OpenAI-compatible servers keep endpoint-scoped IDs.
  if (!digest) return;
  if (raw.verifiedDigest && raw.verifiedDigest !== digest) {
    throw new Error("The server model digest changed under the same name. Existing vectors cannot be reused; register it as a new model.");
  }
  const probes = await zotqueryServerProbes(model);
  if (raw.compatibilityProbes?.length === 2 &&
      raw.compatibilityProbes.some((v,i) => zotqueryProbeCosine(v,probes[i],model.dimensions) < 0.999)) {
    throw new Error("The server embedding output changed. Existing vectors cannot be reused; register it as a new model.");
  }
  if (!raw.verifiedDigest || !raw.compatibilityProbes) {
    Ct({...raw,verifiedDigest:digest,compatibilityProbes:probes});
  }
}
async function zotqueryCanAdoptCache(previousId, nextId) {
  try {
    const previous = await _.getCoverage(previousId), next = await _.getCoverage(nextId);
    if (previous.covered > 0 && next.covered === 0) return true;
    if (previous.covered || next.covered) return false;
    const count = async id => Number(await Zotero.DB.valueQueryAsync(
      "SELECT COUNT(*) FROM zotquerylne.segment_vectors WHERE model_id=?", [id]) || 0);
    return await count(previousId) > 0 && await count(nextId) === 0;
  } catch (_) { return false; }
}
`;

replaceOnce("};var mr=class n{", `};${helpers}var mr=class n{`, "compatibility helpers");

replaceOnce(
  "this.serverClient=i}async embedWithWorker",
  "await zotqueryRememberServerIdentity(this.model);this.serverClient=i}async embedWithWorker",
  "cache active model fingerprint"
);

replaceOnce(
  "async setModel(e){let t=U(e);if(!t){this.logger.warn(`setModel: unknown model id '${e}', keeping active model`);return}t.id===this.model.id&&this.ready&&this.workerReady||(this.logger.info(`Switching embedding model to ${t.id}`),ln(t.id),this.reset(),await this.init())}",
  `async setModel(e){
    let t=U(e);
    if(!t){this.logger.warn(\`setModel: unknown model id '\${e}', keeping active model\`);return}
    let reused=false, verificationFailed=false, rollbackEntries=null;
    const previous=this.model;
    if(t.id!==previous.id && previous?.runtime==="server" && t.runtime==="server" &&
       await zotqueryCanAdoptCache(previous.id,t.id)) {
      try {
        const verified=await zotqueryEquivalentServerModels(previous,t);
        if(verified){
          const selectedId=t.id;
          rollbackEntries=Te();
          At(selectedId);
          Ct({...t,id:previous.id,verifiedDigest:verified.digest,compatibilityProbes:verified.probes});
          t=U(previous.id);
          reused=true;
          this.logger.info("Verified equivalent server model; retaining indexed cache identity while changing endpoint");
        } else verificationFailed=true;
      } catch(err) {
        verificationFailed=true;
        this.logger.warn(\`Cannot verify server model equivalence: \${err?.message||err}\`);
      }
    }
    if(reused || t.id!==this.model.id || !this.ready || !this.workerReady){
      this.logger.info(\`Switching embedding model to \${t.id}\`);
      ln(t.id);this.reset();
      try { await this.init(); }
      catch(err) {
        if(reused && rollbackEntries){
          Zotero.Prefs.set(ir,JSON.stringify(rollbackEntries),!0);
        }
        ln(previous.id);this.reset();
        try { await this.init(); } catch (_) {}
        throw err;
      }
    }
    return {reused,verificationFailed};
  }`,
  "guarded model switch"
);

replaceOnce(
  'await F.setModel(v),Q(e)&&(b&&(b.textContent=""),await dt(e),await Mt(e),await Zt(e)),await Xi(e,v)',
  'let switchResult=await F.setModel(v);Q(e)&&(b&&(b.textContent=switchResult?.reused?(/^zh(?:-|$)/i.test(String(Zotero.locale||Services.locale?.appLocaleAsBCP47||"en-US"))?"已验证为同一模型，沿用 PDF 与笔记索引。":"Verified same model; existing PDF and Note indexes reused."):switchResult?.verificationFailed?(/^zh(?:-|$)/i.test(String(Zotero.locale||Services.locale?.appLocaleAsBCP47||"en-US"))?"无法确认模型等价；旧索引已保留，此地址需要单独建索引。":"Model equivalence could not be verified. The previous index is preserved; this endpoint needs its own index."):""),await dt(e),await Mt(e),await Zt(e)),await Xi(e,K())',
  "settings status"
);

// An adopted cache ID may contain the first endpoint's address even after its
// configuration points elsewhere. Re-adding that original address must not
// overwrite the active configuration before equivalence is checked.
replaceOnce(
  'async function ts(n){let e=Ue(n);re&&(Ct({id:et(re.modelName,re.baseUrl),label:`${re.modelName} (${new URL(re.baseUrl).host})`,baseUrl:re.baseUrl,serverModelName:re.modelName,dimensions:re.dims,queryPrefix:e.queryPrefix?.value??"",docPrefix:e.docPrefix?.value??"",apiKey:re.apiKey}),ue(n,"Added. Select it in the Embedding Model menu above to start using it."),Q(n)&&(await dt(n),await Zt(n)))}',
  `async function ts(n){
    let e=Ue(n);if(!re)return;
    const preferredId=et(re.modelName,re.baseUrl);
    const existing=Te().find(x=>x.id===preferredId);
    const changed=existing && (existing.verifiedDigest || existing.baseUrl!==re.baseUrl || existing.serverModelName!==re.modelName ||
      existing.dimensions!==re.dims || existing.queryPrefix!==(e.queryPrefix?.value??"") ||
      existing.docPrefix!==(e.docPrefix?.value??"") || existing.apiKey!==re.apiKey);
    const id=changed ? preferredId+"-candidate-"+Date.now().toString(36) : preferredId;
    Ct({id,label:re.modelName+" ("+new URL(re.baseUrl).host+")",baseUrl:re.baseUrl,
      serverModelName:re.modelName,dimensions:re.dims,queryPrefix:e.queryPrefix?.value??"",
      docPrefix:e.docPrefix?.value??"",apiKey:re.apiKey});
    ue(n,"Added. Select it in the Embedding Model menu above to start using it.");
    if(Q(n)){await dt(n);await Zt(n)}
  }`,
  "collision-safe registration"
);

fs.writeFileSync(file, source);
console.log("Patched guarded endpoint switch in compiled ZotQuery entry point");
