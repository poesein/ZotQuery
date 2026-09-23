import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scan} from '../scripts/privacy-scan.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zotquery-privacy-test-'));
try {
 fs.writeFileSync(path.join(root,'generic.md'),'Generic public documentation');
 assert.equal(scan(root).hits.length,0);
 fs.writeFileSync(path.join(root,'state.sqlite'),'synthetic fixture');
 fs.writeFileSync(path.join(root,'credential.txt'),'ghp_'+'a'.repeat(32));
 fs.writeFileSync(path.join(root,'personal.md'),['C:','Users','example-person','report.txt'].join('\\'));
 fs.mkdirSync(path.join(root,'templates'));fs.writeFileSync(path.join(root,'templates','private.md'),'synthetic user content');
 const findings=scan(root).hits;
 for(const rule of ['private-or-build-artifact','credential-pattern','personal-home-path','user-content'])assert.ok(findings.some(x=>x.rule===rule),rule);
 assert.ok(findings.every(x=>Object.keys(x).length===2),'reports contain only relative paths and rule names');
} finally {
 const resolved=path.resolve(root),prefix=path.join(path.resolve(os.tmpdir()),'zotquery-privacy-test-');
 if(!resolved.startsWith(prefix))throw Error('Unsafe fixture cleanup path');
 fs.rmSync(resolved,{recursive:true});
}
console.log('Privacy scanner: public sample allowed, artifacts/home paths/credentials/user-content blocked without echoing content');
