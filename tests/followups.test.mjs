import test from 'node:test';
import assert from 'node:assert/strict';
import {followupContext,makeFollowupRequest,proposeFollowups,PROMPT_VERSION} from '../lib/followups.mjs';
import {normalizeTurn} from '../lib/evidence.mjs';

const config={key:'test-only-placeholder',llmModel:'qwen3.5-4b-32k-fast'};
const turn=(id,text,speaker='Source',extra={})=>({...normalizeTurn({id,text,speaker}),...extra});
const input={turns:[turn('s','Our workshops changed how participants approach their work.')]};
const cue={kind:'example',focus:'Our workshops',evidence:[{turn_id:'s',quote:input.turns[0].text}]};
function harness(payload){
  const sent=[],reserved=[];
  return {sent,reserved,options:{config,budget:{reserve:(...args)=>reserved.push(args)},fetchImpl:async(_url,request)=>{
    sent.push(JSON.parse(request.body));return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(payload)}}]})};
  }}};
}

test('live context carries covered goals and prior card statuses, bounded without losing speech roles',()=>{
  const context=followupContext({...input,goals:['A legacy question',{text:'An answered question',done:true}],
    previousCues:[{...cue,status:'asked',evidence:[{turnId:'s'}]}],turns:[turn('r','Tell me more.','Reporter'),...input.turns]});
  assert.deepEqual(context.questions,[{text:'A legacy question',covered:false},{text:'An answered question',covered:true}]);
  assert.deepEqual(context.previous_followups[0],{kind:'example',focus:'Our workshops',question:'Can you walk me through a specific example?',status:'asked',turn_ids:['s']});
  assert.equal(context.transcript[0].role,'Reporter');
  const bounded=followupContext({brief:'x'.repeat(1300),turns:Array.from({length:15},()=>input.turns[0]),goals:Array(12).fill('g'.repeat(300)),previousCues:Array(25).fill(cue)});
  assert.equal(bounded.interview_brief.length,1200);assert.equal(bounded.questions.length,8);assert.equal(bounded.questions[0].text.length,250);
  assert.equal(bounded.transcript.length,10);assert.equal(bounded.previous_followups.length,20);
});

test('current Qwen request supports probing without unsupported response_format',()=>{
  const request=makeFollowupRequest(input,config.llmModel);
  assert.equal(request.response_format,undefined);assert.equal(request.temperature,0);assert.equal(request.max_tokens,1200);
  assert.deepEqual(JSON.parse(request.messages.at(-1).content).transcript,[{turn_id:'s',role:'Source',text:input.turns[0].text}]);
});

test('validated model opportunities survive, while an invented quote is rejected',async()=>{
  const h=harness({cues:[cue,{...cue,focus:'invented',evidence:[{turn_id:'s',quote:'This invented quotation is absent.'}]}]});
  const result=await proposeFollowups(input,h.options);
  assert.equal(result.cues.length,1);assert.equal(result.cues[0].focus,'Our workshops');assert.equal(result.rejected.length,1);
  assert.equal(result.outcome,'suggestions');assert.equal(result.promptVersion,PROMPT_VERSION);assert.equal(h.sent.length,1);assert.equal(h.reserved.length,1);
});

test('an empty model response remains empty with no forced fallback or extra call',async()=>{
  const h=harness({cues:[]});const result=await proposeFollowups({turns:[turn('s','We plan to open next spring.')]},h.options);
  assert.deepEqual(result.cues,[]);assert.equal(result.outcome,'abstained');assert.equal(h.sent.length,1);assert.equal(h.reserved.length,1);
});

test('asked, dismissed and open duplicates are suppressed; another category survives',async()=>{
  for(const status of ['asked','dismissed','open']){
    const h=harness({cues:[cue,{...cue,kind:'evidence'}]});
    const result=await proposeFollowups({...input,previousCues:[{...cue,status,evidence:[{turnId:'s'}]}]},h.options);
    assert.deepEqual(result.cues.map(c=>c.kind),['evidence']);assert.equal(result.suppressedCount,1);
    assert.equal(JSON.parse(h.sent[0].messages.at(-1).content).previous_followups[0].status,status);
  }
});

test('unassigned, reporter and pending-review latest passages make no paid request',async()=>{
  for(const latest of [turn('u','We will open next spring.','Unassigned'),turn('r','When is opening?','Reporter'),turn('s','We will open next spring.','Source',{speakerReviewRequired:true})]){
    const h=harness({cues:[cue]}),result=await proposeFollowups({turns:[...input.turns,latest]},h.options);
    assert.deepEqual(result.cues,[]);assert.equal(h.sent.length,0);assert.equal(h.reserved.length,0);
    assert.equal(result.outcome,latest.speakerReviewRequired?'needs_speaker_review':'needs_source');
  }
});

test('a previous pending-review source is context only and cannot support evidence',async()=>{
  const h=harness({cues:[cue]});const result=await proposeFollowups({turns:[{...input.turns[0],speakerReviewRequired:true},turn('s2','There is more to discuss.')]},h.options);
  assert.deepEqual(result.cues,[]);assert.equal(result.rejected[0].reason,'source_role_required');
  assert.equal(JSON.parse(h.sent[0].messages.at(-1).content).transcript[0].role,'Unassigned');
});

test('provider failure stays explicit, never exposes its body and makes no retry',async()=>{
  let calls=0;const h=harness({});h.options.fetchImpl=async()=>{calls++;return {ok:false,status:429,json:()=>{throw new Error('Sensitive upstream body should not be read.');}};};
  await assert.rejects(()=>proposeFollowups(input,h.options),{code:'PROVIDER_ERROR',message:'AssemblyAI analysis returned HTTP 429.'});
  assert.equal(calls,1);assert.equal(h.reserved.length,1);
});
