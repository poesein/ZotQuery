import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const research = fs.readFileSync(new URL("../content/scripts/research-engine.js", import.meta.url), "utf8");
let attachmentIDs = [20];
const items = new Map([
  [10, { getAttachments: () => attachmentIDs, getCollections: () => [40], getNotes: () => [30] }],
  [20, { key: "PDFKEY01", attachmentMIMEType: "application/pdf", getField: () => "Main PDF" }],
  [21, { key: "PDFKEY02", attachmentMIMEType: "application/pdf", getField: () => "Supplement" }],
  [30, { key: "NOTEKEY1", getNoteTitle: () => "Reading note" }],
]);
const row = { position_id: "p1", source: "pdf", work_key: "user:PARENT01", library_key: "user", item_key: "PARENT01", page_number: 7, chunk_index: 12, paragraph_index: 3, preview: "Source passage", coverage_required: 1 };
const ctx = {
  Zotero: {
    Libraries: { userLibraryID: 1 }, Groups: { getLibraryIDFromGroupID: () => 2 },
    Items: { getIDFromLibraryAndKey: (_lib, key) => key === "PARENT01" ? 10 : null,
      getAsync: async id => Array.isArray(id) ? id.map(x => items.get(x)) : items.get(id) },
    Collections: { getAsync: async () => ({ key: "COLLECT1", name: "Research" }) },
    DB: { valueQueryAsync: async () => 1, queryAsync: async sql => sql.startsWith("SELECT *") ? [row] : [] },
  },
  ensureResearchSchema: async () => {}, RDB: "research", num: (x, fallback) => Number(x ?? fallback), now: () => "test-time",
};
vm.createContext(ctx);
vm.runInContext(research.slice(research.indexOf("function zoteroItemLink("), research.indexOf("async function ensureZotQuery()")) +
  research.slice(research.indexOf("async function positions("), research.indexOf("async function positionContext(")) +
  "\nthis.links = sourceLinks; this.list = positions;", ctx);

let links = await ctx.links({ libraryKey: "user", itemKey: "PARENT01", pageNumber: 7, noteKey: "NOTEKEY1" }, { includeRelated: true });
assert.equal(links.parent, "zotero://select/library/items/PARENT01");
assert.equal(links.pdfPage, "zotero://open-pdf/library/items/PDFKEY01?page=7");
assert.equal(links.note, "zotero://select/library/items/NOTEKEY1");
assert.equal(links.collections[0].url, "zotero://select/library/collections/COLLECT1");
assert.equal(links.notes[0].url, links.note);
const listed = await ctx.list("s1", { compact: true, includeLinks: true });
assert.equal(listed.results[0].links.pdfPage, links.pdfPage, "compact evidence cards must retain resolved links");
assert.equal(listed.results[0].paragraphIndex, 3);
links = await ctx.links({ libraryKey: "group:42", itemKey: "PARENT01", pageNumber: 7 }, { includeRelated: true });
assert.equal(links.pdfPage, "zotero://open-pdf/groups/42/items/PDFKEY01?page=7");
assert.equal(links.collections[0].url, "zotero://select/groups/42/collections/COLLECT1");
links = await ctx.links({ libraryKey: "user", itemKey: "PARENT01" });
assert.equal(links.pdfPage, null, "missing page must not be replaced by a chunk number");
assert.equal(links.pdf, "zotero://open-pdf/library/items/PDFKEY01");
attachmentIDs = [20, 21];
links = await ctx.links({ libraryKey: "user", itemKey: "PARENT01", pageNumber: 7 }, { includeRelated: true });
assert.equal(links.pdfPage, null, "ambiguous attachments must not acquire a guessed page");
assert.equal(links.pdfAttachments.length, 2);
assert.ok(links.pdfAttachments.every(x => !x.url.includes("?page=")));

const dashboard = fs.readFileSync(new URL("../content/scripts/research-dashboard.js", import.meta.url), "utf8");
function element(tag) { return { tag, children: [], attributes: {}, handlers: {}, textContent: "",
  setAttribute(k,v) { this.attributes[k]=v; }, append(...children) { this.children.push(...children); },
  addEventListener(k,v) { this.handlers[k]=v; } }; }
let opened = null;
const ui = { window: {}, document: { createElementNS: (_ns, tag) => element(tag) }, Zotero: { getMainWindow: () => ({ ZoteroPane: { loadURI: uri => { opened = uri; } } }) } };
vm.createContext(ui);
vm.runInContext(dashboard.replace('window.addEventListener("DOMContentLoaded", init, { once: true });', 'globalThis.testLinks = { sourceAnchor, appendSourceLinks };'), ui);
assert.equal(ui.testLinks.sourceAnchor("bad", "javascript:alert(1)"), null);
assert.equal(ui.testLinks.sourceAnchor("bad", "https://example.com"), null);
const card = element("div");
ui.testLinks.appendSourceLinks(card, listed.results[0]);
const pageLink = card.children.find(x => x.attributes.href?.includes("?page=7"));
assert.ok(pageLink);
let prevented = false;
pageLink.handlers.click({ preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.equal(opened, "zotero://open-pdf/library/items/PDFKEY01?page=7");
assert.ok(card.children.some(x => x.textContent.includes("语段 chunk 12")));
console.log("3.1.8 evidence source links, collection/note/PDF routing, and ambiguity regressions passed");
