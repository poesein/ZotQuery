import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../content/scripts/research-dashboard.js", import.meta.url), "utf8");
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, { value: "", textContent: "", handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; } });
  return nodes.get(id);
}
let file = "D:\\用户模板\\输出格式.MD";
let result = 0;
let imported = null;
const writes = [];
class FilePicker {
  modeOpen = 0; modeSave = 1; returnOK = 0; returnCancel = 1; returnReplace = 2;
  init() {} appendFilter() {} async show() { return result; }
  get file() { if (result === 1) throw new Error("cancelled picker must not be read"); return file; }
}
const ctx = { window: {}, document: { getElementById: node, querySelectorAll: () => [] },
  ChromeUtils: { importESModule() { return { FilePicker }; } },
  IOUtils: { async writeUTF8(path, text) { writes.push({ path, text }); } },
  Zotero: { ZotQueryModelAgent: {
    async setTemplatePath(path) { assert.equal(typeof path, "string"); assert.match(path, /\.md$/i); imported = path; },
    async templateInfo() { return { configured: true, name: "test.md", path: imported, characters: 10 }; },
  } },
};
vm.createContext(ctx);
const binding = 'window.addEventListener("DOMContentLoaded", init, { once: true });';
assert.ok(source.includes(binding));
vm.runInContext(source.replace(binding, "bind();"), ctx);
const click = id => node(id).handlers.click({ currentTarget: node(id) });

result = 0; file = "D:\\reports\\输出.md";
node("report-editor").value = "# Synthetic research report";
node("research-query").value = "test";
await click("save-report");
assert.equal(writes.at(-1).path, file);
assert.equal(writes.at(-1).text, node("report-editor").value);
result = 2; file = { path: "D:\\reports\\replace.md" };
await click("save-report");
assert.equal(writes.at(-1).path, file.path);
result = 1;
await click("save-report");
assert.equal(writes.length, 2, "cancel must not write a file");
result = 0; file = null;
await click("save-report");
assert.equal(writes.length, 2, "missing path must not cause a write");
assert.match(node("notice").textContent, /未返回有效路径/);
console.log("3.1.8 file picker import/export string, nsIFile, replacement and cancellation regressions passed");
