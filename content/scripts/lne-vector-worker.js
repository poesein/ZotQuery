/**
 * ZotQuery-LNE Research 3.0.1
 * Dense-search worker for LNE Native.
 *
 * Protocol:
 *  load   {jobId, modelId, dim, hashes, buffer}
 *  search {jobId, buffer, topK}
 *  clear  {jobId}
 */
"use strict";

let modelId = null;
let dim = 0;
let hashes = [];
let matrix = null;

function reply(type, jobId, payload = {}) {
  postMessage({ type, jobId, ...payload });
}

function normInPlace(v) {
  let ss = 0;
  for (let i = 0; i < v.length; i++) ss += v[i] * v[i];
  const n = Math.sqrt(ss);
  if (n > 0 && Math.abs(n - 1) > 1e-4) {
    for (let i = 0; i < v.length; i++) v[i] /= n;
  }
  return v;
}


function decodeBase64Float32(text) {
  const bin = atob(String(text || ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function denseTopK(query, topK) {
  if (!matrix || !dim || !hashes.length) return [];
  if (query.length !== dim) throw new Error(`query dimension ${query.length} != index dimension ${dim}`);
  normInPlace(query);
  const n = hashes.length;
  const k = Math.max(1, Math.min(Number(topK || 150), n));
  // For the current LNE scale (~40-50k vectors), a full scan is simpler and
  // deterministic. Keep only K elements to avoid allocating an N-sized object array.
  const best = [];
  for (let i = 0; i < n; i++) {
    const off = i * dim;
    let sim = 0;
    for (let d = 0; d < dim; d++) sim += query[d] * matrix[off + d];
    if (best.length < k) {
      best.push({ hash: hashes[i], sim });
      if (best.length === k) best.sort((a, b) => a.sim - b.sim);
    } else if (sim > best[0].sim) {
      best[0] = { hash: hashes[i], sim };
      // K is intentionally small (default 150), so insertion-sort maintenance
      // is fast enough and avoids sorting all ~40k results.
      let j = 0;
      while (j + 1 < best.length && best[j].sim > best[j + 1].sim) {
        const t = best[j]; best[j] = best[j + 1]; best[j + 1] = t; j++;
      }
    }
  }
  best.sort((a, b) => b.sim - a.sim);
  return best;
}

addEventListener("message", event => {
  const msg = event.data || {};
  const jobId = msg.jobId || null;
  try {
    if (msg.type === "load") {
      modelId = msg.modelId || null;
      dim = Number(msg.dim || 0);
      hashes = Array.isArray(msg.hashes) ? msg.hashes : [];
      matrix = msg.buffer ? new Float32Array(msg.buffer) : new Float32Array(0);
      if (!dim || matrix.length !== hashes.length * dim) {
        throw new Error(`invalid matrix: ${matrix.length} floats for ${hashes.length}×${dim}`);
      }
      reply("loaded", jobId, { modelId, dim, count: hashes.length });
      return;
    }
    if (msg.type === "loadEncoded") {
      modelId = msg.modelId || null;
      dim = Number(msg.dim || 0);
      const records = Array.isArray(msg.records) ? msg.records : [];
      if (!dim) throw new Error("invalid embedding dimension");
      hashes = new Array(records.length);
      matrix = new Float32Array(records.length * dim);
      let kept = 0;
      for (let i = 0; i < records.length; i++) {
        const v = decodeBase64Float32(records[i].embedding);
        if (v.length !== dim) continue;
        hashes[kept] = String(records[i].hash);
        matrix.set(v, kept * dim);
        kept++;
      }
      if (kept !== records.length) {
        hashes.length = kept;
        matrix = matrix.slice(0, kept * dim);
      }
      reply("loaded", jobId, { modelId, dim, count: hashes.length });
      return;
    }
    if (msg.type === "search") {
      if (!matrix) throw new Error("vector index not loaded");
      const q = new Float32Array(msg.buffer);
      const started = Date.now();
      const results = denseTopK(q, msg.topK || 150);
      reply("results", jobId, { modelId, dim, count: hashes.length, processingTimeMs: Date.now() - started, results });
      return;
    }
    if (msg.type === "clear") {
      modelId = null; dim = 0; hashes = []; matrix = null;
      reply("cleared", jobId);
      return;
    }
    throw new Error(`unknown worker message: ${msg.type}`);
  } catch (e) {
    reply("error", jobId, { error: e?.message || String(e) });
  }
});

postMessage({ type: "ready" });
