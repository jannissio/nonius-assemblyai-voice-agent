import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const first=json('eval/results/text-live-qwen-v2.json'),recovery=json('eval/results/text-rate-recovery-v2.json');
const rules=json('eval/results/text-rules-v1.json'),speech=json('eval/results/speech-v1.json');
const cases=json('eval/cases.json').cases,publication=json('eval/publication.json');
for(const file of json('eval/freeze-v2.json').files){
  if(file.path===publication.protocolRedaction.path){
    assert.equal(file.sha256,publication.protocolRedaction.originalSha256);
    assert.equal(hash(file.path),publication.protocolRedaction.publishedSha256,'Public protocol copy changed.');
  }else assert.equal(hash(file.path),file.sha256,`Frozen artifact changed: ${file.path}`);
}
assert.deepEqual(recovery.results.map(row=>row.id),first.results.filter(row=>row.error?.includes('HTTP 429')).map(row=>row.id));
const rows=first.results.map(row=>recovery.results.find(item=>item.id===row.id)||row);
assert.equal(rows.length,cases.length);assert.equal(new Set(rows.map(row=>row.id)).size,cases.length);
for(const row of [...rows,...first.results,...rules.results]){
  const expected=cases.find(item=>item.id===row.id).expected,got=[...new Set(row.cues.map(cue=>cue.kind))];
  assert.deepEqual(row.expected,expected);assert.deepEqual(row.got,got);
  assert.equal(row.exact,!row.error&&got.length===expected.length&&expected.every(kind=>got.includes(kind)));
}
const normalize=text=>text.toLowerCase().replace(/\s+/g,' ').trim();
function includesSlot(text,value){let from=0,at;while((at=text.indexOf(value,from))>=0){
  if(!/[a-z0-9]/i.test(text[at-1]||'')&&!/[a-z0-9]/i.test(text[at+value.length]||''))return true;from=at+1;
}return false;}
const speechCases=json('fixtures/speech-cases.json').cases.filter(row=>row.split==='test');
assert.deepEqual(speech.results.map(row=>row.id),speechCases.map(row=>row.id));
for(const row of speech.results){
  const original=speechCases.find(item=>item.id===row.id);
  assert.equal(row.reference,original.text);assert.equal(hash(row.audio.path),row.audio.sha256);
  assert.equal(row.slots.length,original.slots.length);
  row.slots.forEach((slot,index)=>{
    assert.deepEqual(slot.allowed,original.slots[index].allowed);
    assert.equal(slot.matched,!row.error&&slot.allowed.some(value=>includesSlot(normalize(row.transcript),normalize(value))));
  });
}
const latency=rows.map(row=>row.elapsedMs).filter(Number.isFinite).sort((a,b)=>a-b);
const result={scope:'Historical v2 engineering benchmark; not current v3 quality or journalist outcomes',
  text:{cases:rows.length,firstPassExact:first.results.filter(row=>row.exact).length,
    firstPassProviderErrors:first.results.filter(row=>row.error).length,recoveryAttempts:recovery.results.length,
    combinedExact:rows.filter(row=>row.exact).length,rulesExact:rules.results.filter(row=>row.exact).length,
    failures:rows.filter(row=>!row.exact).map(({id,expected,got})=>({id,expected,got})),
    latencyMedianMs:(latency[16]+latency[17])/2},
  speech:{clips:speech.results.length,slots:speech.results.flatMap(row=>row.slots).length,
    slotsPresent:speech.results.flatMap(row=>row.slots).filter(slot=>slot.matched).length},
  provenance:'Four original code/case hashes match. Published protocol redaction and original audio hashes match.'};
assert.equal(result.text.combinedExact,recovery.summary.combinedExactMatches);
assert.equal(result.speech.slotsPresent,speech.summary.slotsPresent);
console.log(JSON.stringify(result,null,2));

