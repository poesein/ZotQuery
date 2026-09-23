import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
 constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.style={};this.handlers={};this.textContent='';}
 append(...children){this.children.push(...children);} replaceChildren(...children){this.children=children;}
 setAttribute(k,v){this.attributes[k]=v;} addEventListener(k,f){this.handlers[k]=f;}
}
const doc={createElementNS:(_ns,tag)=>new Element(tag,doc),createDocumentFragment:()=>new Element('fragment',doc),createTextNode:text=>({tag:'#text',textContent:text,children:[]})};
const root=new Element('article',doc),ctx={URL};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../content/vendor/marked.umd.js',import.meta.url),'utf8'),ctx);
vm.runInContext(fs.readFileSync(new URL('../content/scripts/markdown-view.js',import.meta.url),'utf8'),ctx);
const api=ctx.ZotQueryMarkdown;
const markdown='<!-- ZotQuery private provenance -->\n# Heading\n\n**bold** and *emphasis* and ~~deleted~~ with `x < y`.\n\n> quoted\n\n1. first\n2. second\n\n- [x] checked\n- [ ] open\n\n| A | B |\n|---|---:|\n| value | 2 |\n\n```js\n<script>alert(1)</script>\n```\n\n[paper](https://example.org/paper) [PDF](zotero://open-pdf/library/items/ABCDEFGH?page=3)\n\n[bad](javascript:alert) [bad2](data:text/html,x) [file](file:///secret)\n\n![remote](https://example.org/image.png)\n\n<img src="https://example.org/tracker" onerror="alert(1)">\n<script>evil()</script>\n';
let opened;api.render(root,markdown,{onLink:url=>{opened=url;}});
const flatten=n=>[n,...n.children.flatMap(flatten)],nodes=flatten(root),tags=nodes.map(n=>n.tag);
for(const tag of ['h1','strong','em','del','code','blockquote','ol','ul','li','table','th','td','pre','a'])assert.ok(tags.includes(tag),tag);
for(const tag of ['script','img','iframe','style','svg','object','input'])assert.ok(!tags.includes(tag),tag);
assert.ok(!nodes.some(n=>String(n.textContent).includes('private provenance')));
const links=nodes.filter(n=>n.tag==='a');assert.equal(links.length,3);assert.ok(links.every(n=>Object.keys(n.attributes).every(k=>['href','rel'].includes(k))));
let prevented=false;links[0].handlers.click({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(opened,'https://example.org/paper');
for(const url of ['javascript:alert(1)','javas&#99;ript:alert(1)','data:text/html,a','file:///secret','chrome://zotero','https://user:password@example.org','https://example.org/\nx','zotero://unknown/path'])assert.equal(api.safeLink(url),null,url);
api.render(root,'## Replacement\n\nNew source');assert.equal(flatten(root).filter(n=>n.tag==='table').length,0,'rerender clears previous DOM');
const page=fs.readFileSync(new URL('../content/researchDashboard.xhtml',import.meta.url),'utf8');
assert.match(page,/id="report-editor" class="report-editor hidden"/);assert.match(page,/id="report-preview" class="markdown-body"/);
assert.ok(page.indexOf('vendor/marked.umd.js')<page.indexOf('scripts/markdown-view.js'));
console.log('3.1.8 Markdown headings, tables, lists, quotes, code, links, HTML/XSS isolation, source refresh and default read mode passed');
