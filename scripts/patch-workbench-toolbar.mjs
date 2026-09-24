// Reproducible generated-bundle patch: the workbench owns the main toolbar.
// Reader buttons and core search/index APIs remain unchanged.
import fs from 'node:fs';
const file = new URL('../content/scripts/index.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8');
const anchor = 'this.buttonId="zotquery-toolbar-button"';
const owner = source.indexOf(anchor);
if (owner < 0 || source.indexOf(anchor, owner + 1) !== -1) throw new Error('Toolbar owner is not unique');
const begin = source.indexOf('add(e){', owner), end = source.indexOf('createButtonFallback(e){', begin);
if (begin < 0 || end < 0 || end - begin > 3000) throw new Error('Unexpected toolbar bundle layout');
const replacement = 'add(e){P()?.ZotQueryResearchUI?.customizeMainWindow?.(e)}';
if (source.slice(begin,end) !== replacement) fs.writeFileSync(file, source.slice(0,begin) + replacement + source.slice(end));
console.log('Main-toolbar registration delegates directly to the ZotQuery workbench; no intermediate legacy button.');
