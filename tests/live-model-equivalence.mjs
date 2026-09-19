// Read-only compatibility probe for two Ollama OpenAI-compatible endpoints.
const [leftUrl, rightUrl, modelName, dimensionsText] = process.argv.slice(2);
if (!leftUrl || !rightUrl || !modelName || !dimensionsText) {
  throw new Error("Usage: node tests/live-model-equivalence.mjs URL_A URL_B MODEL DIMENSIONS");
}
const dimensions = Number(dimensionsText);
const inputs = [
  "ZotQuery fixed document compatibility probe",
  "ZotQuery fixed query compatibility probe",
];
async function inspect(baseUrl) {
  const tagsResponse = await fetch(new URL("/api/tags", baseUrl));
  if (!tagsResponse.ok) throw new Error(`Model metadata HTTP ${tagsResponse.status}`);
  const tags = await tagsResponse.json();
  const digest = tags.models?.find((entry) => entry.name === modelName)?.digest;
  const response = await fetch(new URL("/v1/embeddings", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelName, input: inputs }),
  });
  if (!response.ok) throw new Error(`Embedding HTTP ${response.status}`);
  const payload = await response.json();
  const vectors = payload.data?.sort((a, b) => a.index - b.index).map((entry) => entry.embedding);
  return { digest, vectors };
}
function cosine(a, b) {
  if (a?.length !== dimensions || b?.length !== dimensions) return -1;
  let dot = 0, normA = 0, normB = 0;
  for (let index = 0; index < dimensions; index++) {
    dot += a[index] * b[index];
    normA += a[index] ** 2;
    normB += b[index] ** 2;
  }
  return dot / Math.sqrt(normA * normB);
}
const [left, right] = await Promise.all([inspect(leftUrl), inspect(rightUrl)]);
const similarities = inputs.map((_, index) => cosine(left.vectors?.[index], right.vectors?.[index]));
const equivalent = Boolean(left.digest && left.digest === right.digest && similarities.every((value) => value >= 0.999));
console.log(JSON.stringify({ sameDigest: left.digest === right.digest, dimensions, similarities, equivalent }));
if (!equivalent) process.exitCode = 1;
