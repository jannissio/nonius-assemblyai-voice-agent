import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelResponse,makeRequest} from '../lib/agent.mjs';
import {validateCandidates,normalizeTurn,ruleCandidates} from '../lib/evidence.mjs';

test('a complete Markdown JSON wrapper is stripped without rewriting source text',()=>{
  const data={cues:[{kind:'evidence',focus:'not',evidence:[{turn_id:'t',quote:'It is not measured.'}]}]};
  assert.deepEqual(parseModelResponse('```json\n'+JSON.stringify(data)+'\n```'),data);
  assert.throws(()=>parseModelResponse('Some explanation: '+JSON.stringify(data)),/invalid analysis/);
  assert.throws(()=>parseModelResponse('{"cues":[],}'),/invalid analysis/);
});
test('reporter assertions and unassigned speakers cannot become source evidence',()=>{
  for(const speaker of ['Reporter','Unassigned']){
    const turns=[normalizeTurn({id:'t',text:'The service is 20 percent faster.',speaker})];
    const result=validateCandidates({cues:[{kind:'comparison',focus:'20 percent faster',evidence:[{turn_id:'t',quote:turns[0].text}]}]},turns);
    assert.equal(result.cues.length,0);assert.equal(result.rejected[0].reason,'source_role_required');assert.deepEqual(ruleCandidates(turns),{cues:[]});
  }
});
test('Qwen adapter never requests its unsupported structured-output parameter',()=>{
  const request=makeRequest({turns:[]},'qwen3.5-4b-32k-fast');assert.equal(request.response_format,undefined);
  assert.ok(request.messages[0].content.includes('JSON schema:'));
});
