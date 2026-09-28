#!/usr/bin/env node
// Private MCP adapter. Secrets are accepted only through the
// process environment and are never written to stdout, logs, or a file.
import readline from "node:readline";
import { readFileSync } from "node:fs";

const generationSchema = JSON.parse(readFileSync(new URL("./strawberry-vnext-depth.schema.json", import.meta.url), "utf8"));
const contract = JSON.parse(readFileSync(new URL("./tool-contracts.json", import.meta.url), "utf8"));
if (contract.version !== 1 || !contract.tools || contract.identity?.title !== "navigation-only") throw new Error("ZotQuery tool contract is unavailable");

const token = process.env.ZOTQUERY_MCP_TOKEN || "";
const port = Number(process.env.ZOTQUERY_ZOTERO_PORT || 23119);
const allowImages = process.env.ZOTQUERY_CHATGPT_ALLOW_IMAGES !== "0";
// Keep the compact ChatGPT catalog for large native schemas. It exposes only
// narrowly scoped Zotero writes after approval.
const compactRead = process.env.ZOTQUERY_CHATGPT_SURFACE === "compact-read";
const maxTextBytes = 64 * 1024 * 1024;
const maxImageBytes = 96 * 1024 * 1024;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write("Invalid ZOTQUERY_ZOTERO_PORT.\n");
  process.exit(2);
}

const pagination = {
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 50 },
};
const sessionId = { type: "string", minLength: 1, maxLength: 120 };
const workKey = { type: "string", minLength: 1, maxLength: 160 };
const imageCrop = { type: "object", properties: Object.fromEntries(["x", "y", "width", "height"].map(key => [key, { type: "number", minimum: 0, maximum: 1 }])), required: ["x", "y", "width", "height"], additionalProperties: false };
const tool = (name, description, properties, required = []) => ({
  name, description,
  inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
});
const writeTool = (name, description, properties, required = []) => ({
  ...tool(name, description, properties, required),
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
});
const tools = [
  tool("zotquery_list_research", "List persisted ZotQuery research sessions. Page until nextOffset is null. This does not read or verify evidence.",
    { search: { type: "string", maxLength: 200 }, ...pagination }),
  tool("zotquery_read_ledger", "Read the coverage gate, exact-fact slots, blockers and review counts of one session. A blocked gate must never be described as verified.",
    { sessionId }, ["sessionId"]),
  tool("zotquery_list_facts", "Page saved FactRecords, exact source quotes and locators. Distinguish DIRECT original-PDF facts from INFERRED or SECONDARY records.",
    { sessionId, ...pagination }, ["sessionId"]),
  tool("zotquery_list_positions", "Page evidence positions without changing listed/reviewed status. Continue nextOffset to null before claiming complete coverage. Navigation hits are not direct proof.",
    { sessionId, scope: { type: "string", enum: ["coverage", "navigation", "all"] }, status: { type: "string" }, ...pagination }, ["sessionId"]),
  tool("zotquery_read_context", "Read original PDF text or note trace around a position without changing its review state. Use a PDF source for direct evidence; notes are navigation aids.",
    { sessionId, positionId: { type: "string", minLength: 1 }, level: { type: "integer", minimum: 0, maximum: 3 } }, ["sessionId", "positionId"]),
  tool("zotquery_list_saved_images", "List already saved PDF page/region images and unverified visual observations. Does not render or save a new image.",
    { sessionId, ...pagination }, ["sessionId"]),
  tool("zotquery_list_answers", "List saved answer versions and lengths for one research session. Read answer text separately in bounded chunks.",
    { sessionId, ...pagination }, ["sessionId"]),
  tool("zotquery_read_answer_chunk", "Read a section of a saved model answer. Page to nextOffset=null for the complete answer. An answer is not independent evidence.",
    { sessionId, runId: { type: "string", minLength: 1, maxLength: 120 }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100000 } }, ["sessionId", "runId"]),
  tool("zotquery_list_documents", "List PDFs linked to a saved research session, including each PDF's indexed document key.",
    { sessionId, ...pagination }, ["sessionId"]),
  tool("zotquery_read_document_chunks", "Page the original indexed PDF text for a session-linked document without marking it read or reviewed. Use small pages for model context.",
    { sessionId, workKey, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 20 } }, ["sessionId", "workKey"]),
  tool("zotquery_search_document", "Find literal text inside one session-linked PDF. Results are navigation hints; open the indexed chunks and, where needed, the page image before drawing conclusions.",
    { sessionId, workKey, query: { type: "string", minLength: 1, maxLength: 200 }, ...pagination }, ["sessionId", "workKey", "query"]),
  tool("zotquery_preview_note_profile_install", "Validate a proposed Note Profile without installing or selecting it.",
    { profile: { type: "object" } }, ["profile"]),
  tool("zotquery_preview_note_profile_select", "Check whether a Note Profile ID is available without changing Zotero preferences.",
    { id: { type: "string", maxLength: 120 } }, ["id"]),
  tool("zotquery_preview_output_profile_install", "Validate a proposed Output Profile without installing it.",
    { profile: { type: "object" } }, ["profile"]),
];
if (allowImages) tools.push(tool("zotquery_read_saved_image", "Read an already saved PDF page image. Visual reading does not automatically verify an exact fact; preserve page, crop and row labels.",
  { sessionId, visualId: { type: "string", minLength: 1, maxLength: 120 } }, ["sessionId", "visualId"]));
if (allowImages) tools.push(tool("zotquery_preview_pdf_page", "Render a session-linked original PDF page or normalized region for visual reading without saving a new evidence record or changing review status. Read the full page before cropping away labels.",
  { sessionId, positionId: { type: "string", minLength: 1, maxLength: 160 }, pageNumber: { type: "integer", minimum: 1, maximum: 100000 }, attachmentKey: { type: "string", minLength: 1, maxLength: 30 }, crop: imageCrop }, ["sessionId", "positionId", "pageNumber"]));

const actions = new Map([
  ["zotquery_list_research", "sessions"],
  ["zotquery_read_ledger", "ledger"],
  ["zotquery_list_facts", "facts"],
  ["zotquery_list_positions", "positions"],
  ["zotquery_read_context", "context"],
  ["zotquery_list_saved_images", "images"],
  ["zotquery_list_answers", "answers"],
  ["zotquery_read_answer_chunk", "answer_chunk"],
  ["zotquery_list_documents", "documents"],
  ["zotquery_read_document_chunks", "document_chunks"],
  ["zotquery_search_document", "search_document"],
  ...(allowImages ? [["zotquery_read_saved_image", "saved_image"]] : []),
  ...(allowImages ? [["zotquery_preview_pdf_page", "page_image"]] : []),
]);

// One contract governs domain, effect and ChatGPT exposure. Native schemas are
// fetched from Zotero so a bridge refresh cannot silently retain stale fields.
const nativeEntries = Object.entries(contract.tools).filter(([, policy]) => policy.origin === "native" && policy.full !== "hidden");
const nativeReadOnly = new Set(nativeEntries.filter(([, policy]) => policy.effect === "read").map(([name]) => name));
const nativeMutating = new Set(nativeEntries.filter(([, policy]) => policy.effect !== "read").map(([name]) => name));
const nativeAllowed = new Set(nativeEntries.map(([name]) => name));
const compactDirect = new Set(nativeEntries.filter(([, policy]) => policy.compact === "direct").map(([name]) => name));
const nativeHighImpact = new Set(nativeEntries.filter(([, policy]) => policy.highImpact).map(([name]) => name));
if (compactRead) {
  tools.push(tool("zotquery_native_read_catalog", "Page additional read-only ZotQuery research actions and their current native input schemas.", pagination));
  tools.push(tool("zotquery_native_read_call", "Run one read-only native research action discovered through the catalog.",
    { name: { type: "string", enum: [...nativeReadOnly] }, arguments: { type: "object" } }, ["name", "arguments"]));
}
for (const entry of tools) {
  const policy = contract.tools[entry.name];
  if (!policy || policy.origin === "native") throw new Error(`Bridge tool contract missing: ${entry.name}`);
  entry._meta = { "zotquery/domain": policy.domain, "zotquery/effect": policy.effect, "zotquery/contractVersion": contract.version };
}
let nativeDefinitions = null;

function validateValue(value, schema = {}, path = "arguments", depth = 0) {
  if (depth > 12) throw new Error(`Invalid ${path}: nesting too deep`);
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\/\$defs\//, "");
    schema = generationSchema.$defs?.[target];
    if (!schema) throw new Error(`Invalid ${path}: unknown schema reference`);
  }
  const types = schema.type == null ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some(type => type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
    : type === "array" ? Array.isArray(value) : type === "null" ? value === null : type === "integer" ? Number.isInteger(value)
      : type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === type)) throw new Error(`Invalid ${path}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`Invalid ${path}`);
  if (typeof value === "number" && (schema.minimum != null && value < schema.minimum || schema.maximum != null && value > schema.maximum)) throw new Error(`Invalid ${path}`);
  if (typeof value === "string" && (schema.minLength != null && value.length < schema.minLength || schema.maxLength != null && value.length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value))) throw new Error(`Invalid ${path}`);
  if (Array.isArray(value) && (schema.minItems != null && value.length < schema.minItems || schema.maxItems != null && value.length > schema.maxItems)) throw new Error(`Invalid ${path}`);
  if (Array.isArray(value) && schema.items) for (let i = 0; i < value.length; i++) validateValue(value[i], schema.items, `${path}[${i}]`, depth + 1);
  if (value && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    for (const key of schema.required || []) if (value[key] === undefined || (value[key] === null && !(Array.isArray(schema.properties?.[key]?.type) && schema.properties[key].type.includes("null"))) || typeof value[key] === "string" && !value[key].trim()) throw new Error(`Missing ${path}.${key}`);
    for (const [key, part] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) {
        throw new Error(`Unexpected ${path}.${key}`);
      } else validateValue(part, schema.properties[key], `${path}.${key}`, depth + 1);
    }
  }
}

function validate(definition, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Arguments must be an object");
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > 512 * 1024) throw new Error("Arguments exceed the 512 KiB safety limit");
  validateValue(input, definition.inputSchema);
  if (input.crop && (input.crop.width <= 0 || input.crop.height <= 0 || input.crop.x + input.crop.width > 1.000001 || input.crop.y + input.crop.height > 1.000001)) throw new Error("Invalid crop");
}

async function readBounded(response, maxBytes) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("ZotQuery returned too much data; use a smaller page or context level");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("ZotQuery returned too much data; use a smaller page or context level");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function callZotQuery(action, args) {
  if (!/^[0-9a-f-]{70,80}$/i.test(token)) throw new Error("Set ZOTQUERY_MCP_TOKEN from ZotQuery settings before starting the bridge");
  const response = await fetch(`http://127.0.0.1:${port}/zotquery/bridge-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}`, "Zotero-Allowed-Request": "1" },
    body: JSON.stringify({ ...args, action }),
    signal: AbortSignal.timeout(90000),
  });
  const raw = await readBounded(response, action === "saved_image" || action === "page_image" ? maxImageBytes : maxTextBytes);
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error("ZotQuery returned invalid JSON"); }
  if (!response.ok) throw new Error(response.status === 401 ? "ZotQuery rejected the local token" : String(result.error || `ZotQuery HTTP ${response.status}`).slice(0, 500));
  return result;
}

async function nativeRpc(method, params = {}, timeoutMs = 30000) {
  if (!/^[0-9a-f-]{70,80}$/i.test(token)) throw new Error("ZotQuery local Bearer token is unavailable");
  const response = await fetch(`http://127.0.0.1:${port}/zotquery/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}`, "Zotero-Allowed-Request": "1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await readBounded(response, params.name === "zotquery_evidence_page_image" ? maxImageBytes : maxTextBytes);
  let message;
  try { message = JSON.parse(raw); } catch { throw new Error("ZotQuery MCP returned invalid JSON"); }
  if (!response.ok || message.error) throw new Error(String(message.error?.message || `ZotQuery MCP HTTP ${response.status}`).slice(0, 600));
  return message.result;
}

async function getNativeDefinitions() {
  if (nativeDefinitions) return nativeDefinitions;
  const listing = await nativeRpc("tools/list");
  if (!Array.isArray(listing?.tools)) throw new Error("ZotQuery native MCP tool list is unavailable");
  const found = new Map();
  let nativeContractVersion = null;
  for (const original of listing.tools) {
    const declaredVersion = original?._meta?.["zotquery/contractVersion"];
    if (declaredVersion != null) nativeContractVersion = declaredVersion;
    if (!nativeAllowed.has(original.name) || !original.inputSchema || found.has(original.name)) continue;
    if (!allowImages && ["zotquery_evidence_page_image", "zotquery_evidence_visual_list", "zotquery_evidence_visual_observe", "zotquery_evidence_visual_session_start"].includes(original.name)) continue;
    const mutating = nativeMutating.has(original.name);
    found.set(original.name, {
      ...original,
      description: `${original.description || original.name}${mutating ? " This operation changes the local research ledger or creates saved research state; use only when the user requests that research action." : ""}`,
      annotations: { readOnlyHint: !mutating, destructiveHint: nativeHighImpact.has(original.name), openWorldHint: false },
    });
  }
  if (nativeContractVersion != null && nativeContractVersion !== contract.version) throw new Error("ZotQuery bridge and Zotero tool contract versions differ");
  if (nativeContractVersion != null) {
    const missing = [...compactDirect].filter(name => (allowImages || name !== "zotquery_evidence_visual_session_start") && !found.has(name));
    if (missing.length) throw new Error(`ZotQuery native tools are incomplete: ${missing.join(", ")}`);
  }
  nativeDefinitions = found;
  return found;
}

async function callPreview(name, args) {
  const native = await getNativeDefinitions();
  const target = name === "zotquery_preview_note_profile_install" ? "zotquery_note_profile_validate"
    : name === "zotquery_preview_output_profile_install" ? "zotquery_output_profile_validate" : "zotquery_note_profile_list";
  const definition = native.get(target);
  if (!definition) throw new Error("Profile validation is unavailable in ZotQuery");
  const result = await nativeRpc("tools/call", { name: target, arguments: target.endsWith("_list") ? {} : { profile: args.profile } });
  if (name === "zotquery_preview_note_profile_select") return { content: [{ type: "text", text: JSON.stringify({ requestedId: args.id, previewOnly: true, availableProfiles: result }) }] };
  return result;
}

async function dispatch(request) {
  if (request.method === "initialize") return {
    protocolVersion: request.params?.protocolVersion || "2025-06-18",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "ZotQuery private research workspace", version: "3.1.25" },
    instructions: compactRead
      ? "Browse the full Zotero library and saved research on demand. Page collections and batch status; process at most 3–10 papers per batch. Read the separate Reading Generation Protocol, route original research/review/design notes, and finish Depth QC before each managed-note upsert or completion tag. Original research PDF text must be paged to nextOffset=null. readingProfileId remains the idempotency namespace. Library and note hits are navigation, not direct PDF proof. Compare may use note-scoped query-term fallback; verify its line-level hits in the original source."
      : "Browse the Zotero library and read source evidence on demand, paging to nextOffset=null before claiming comprehensive coverage. Library and note hits are navigation, not direct PDF proof. Compare may use note-scoped query-term fallback; verify its line-level hits in the original source. PDF preview diagnostics separate first-attempt and fallback render time; cached previews report current latency separately. Native evidence operations can change research state; only use them when the user requests research execution or a specific update. Do not treat inferred facts or unverified images as direct PDF proof. Report blocked exact-fact gates and cite source locators. Profile install and selection are preview-only in this bridge.",
  };
  if (request.method === "ping") return {};
  if (request.method === "tools/list") { const native = [...(await getNativeDefinitions()).values()]; return { tools: [...tools, ...(compactRead ? native.filter(entry => compactDirect.has(entry.name)) : native)] }; }
  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    try {
      const definition = tools.find(t => t.name === name) || (await getNativeDefinitions()).get(name);
      if (!definition) throw new Error("Tool is not available in this ZotQuery bridge");
      validate(definition, args);
      if (compactRead && name === "zotquery_native_read_catalog") {
        const definitions = [...(await getNativeDefinitions()).values()].filter(entry => nativeReadOnly.has(entry.name));
        const offset = args.offset || 0, limit = args.limit || 20;
        const results = definitions.slice(offset, offset + limit);
        return { content: [{ type: "text", text: JSON.stringify({ total: definitions.length, offset, limit, results, nextOffset: offset + results.length < definitions.length ? offset + results.length : null }) }] };
      }
      if (compactRead && name === "zotquery_native_read_call") {
        if (!nativeReadOnly.has(args.name)) throw new Error("Only read-only native research actions are available");
        const nativeDefinition = (await getNativeDefinitions()).get(args.name);
        if (!nativeDefinition) throw new Error("Native read action is unavailable");
        validate(nativeDefinition, args.arguments);
        return await nativeRpc("tools/call", { name: args.name, arguments: args.arguments }, 30 * 60 * 1000);
      }
       if (compactRead && compactDirect.has(name)) return await nativeRpc("tools/call", { name, arguments: args }, 30000);
      if (compactRead && nativeAllowed.has(name)) throw new Error("Use the read-only catalog and call action; writes are unavailable");
      if (nativeAllowed.has(name)) return await nativeRpc("tools/call", { name, arguments: args }, 30 * 60 * 1000);
            if (name.startsWith("zotquery_preview_note_profile_") || name === "zotquery_preview_output_profile_install") return await callPreview(name, args);
      const result = await callZotQuery(actions.get(name), args);
      if (name === "zotquery_read_saved_image" || name === "zotquery_preview_pdf_page") {
        const images = Array.isArray(result.images) ? result.images : [];
        if (images.length !== 1 || images[0].mimeType !== "image/png" || typeof images[0].data !== "string") throw new Error("Saved image format is unavailable");
        const { images: _ignored, ...metadata } = result;
        return { content: [{ type: "text", text: JSON.stringify(metadata) }, { type: "image", mimeType: "image/png", data: images[0].data }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message || error).slice(0, 600) }] };
    }
  }
  throw new Error("Method not found");
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try { request = JSON.parse(line); }
  catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n"); continue; }
  if (request.id == null) continue;
  try {
    const result = await dispatch(request);
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: String(error?.message || error).slice(0, 300) } }) + "\n");
  }
}
