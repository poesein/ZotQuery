import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The optional reference stays outside the distribution; reports never echo
// matching text, credentials, or the reference path.
export function scan(root, privateReference) {
 const hits=[],files=[];
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name),rel=path.relative(root,p).replaceAll('\\','/');
  if(['.git','node_modules','dist','build'].includes(e.name)&&e.isDirectory())continue;
  if(e.isSymbolicLink()){hits.push({file:rel,rule:'symlink'});continue;}
  if(e.isDirectory()){walk(p);continue;} files.push({p,rel});
 }}
 walk(root);
 const fragments=privateReference ? [...new Set(fs.readFileSync(privateReference,'utf8').replaceAll('\r\n','\n').split('\n').map(s=>s.trim()).filter(s=>s.length>=100))] : [];
 for(const {p,rel} of files){
  if(/(?:^|\/)(?:\.env(?:\..*)?|prefs\.sqlite|logins\.json|key[34]\.db|cookies\.sqlite|REPORT-TEMPLATE-vNext\.md)$|\.(?:sqlite(?:-.*)?|db|log|bak|xpi|zip)$/i.test(rel))hits.push({file:rel,rule:'private-or-build-artifact'});
  if(/^(?:templates|user-data|zotero-profile|gpt-records|recycle)\//i.test(rel)||/^content\/templates\/.*\.md$/i.test(rel))hits.push({file:rel,rule:'user-content'});
  if(!/\.(?:js|mjs|json|md|txt|html|xhtml|css|svg|ps1|py|ftl|dtd)$/i.test(rel))continue;
  const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
  if(/[A-Z]:[\\/]+Users[\\/]+(?!Public(?:[\\/])|<|\$|\{)[a-z0-9_.-]+[\\/]/i.test(s))hits.push({file:rel,rule:'personal-home-path'});
  if(/\b(?:ghp_|github_pat_|sk-proj-)[a-zA-Z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s))hits.push({file:rel,rule:'credential-pattern'});
  if(fragments.some(fragment=>s.includes(fragment)))hits.push({file:rel,rule:'private-reference-fragment'});
 }
 return {files:files.length,referenceFragments:fragments.length,hits};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(process.argv[2]||'.');
 const result=scan(root,process.argv[3]);console.log(JSON.stringify(result,null,2));if(result.hits.length)process.exitCode=1;
}
