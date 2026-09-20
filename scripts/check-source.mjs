import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'})
  .split('\0').filter(Boolean);
const findings=[];
for(const path of files){
  if(/(^|\/)(?:\.env(?:\..*)?|runtime|node_modules|output|tmp|submission|presentation)(?:\/|$)/.test(path)&&path!=='.env.example')
    findings.push(`${path}: excluded file`);
  if(/\.(?:wav|png|jpg|pdf|mp4|zip)$/i.test(path))continue;
  const text=readFileSync(path,'utf8');
  if(/\b[A-Z]:[\\/]/i.test(text))findings.push(`${path}: private absolute path`);
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))findings.push(`${path}: private key material`);
  if(/\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_\-]{20,}/.test(text))findings.push(`${path}: credential-shaped text`);
}
assert.equal(findings.length,0,findings.join('\n'));
const pkg=JSON.parse(readFileSync('package.json','utf8'));
for(const name of Object.keys(pkg.dependencies)){
  const installed=JSON.parse(readFileSync(`node_modules/${name}/package.json`,'utf8'));
  assert.equal(installed.license,'MIT',`${name} licence changed`);
  assert.equal(installed.version,pkg.dependencies[name],`${name} version changed`);
}
assert.ok(files.includes('LICENSE'));
console.log(`Source check passed: ${files.length} files; two pinned MIT dependencies; no excluded paths or detected credential patterns.`);
console.log('This is a bounded source check, not a guarantee against every possible secret.');
