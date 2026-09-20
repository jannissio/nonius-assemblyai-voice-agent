import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analysisPassages,analysisRequest,resolvePassageCues} from '../lib/analysis-passages.mjs';
import {applySpeakerEvent,updateSpeaker,setTurnSpeaker} from '../lib/speakers.mjs';
import {evidenceTurnIds,sameCue} from '../lib/cues.mjs';
import {proposeFollowups} from '../lib/followups.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/usgs-speaker-revision.json',import.meta.url),'utf8'));
function interview({confirm=true}={}){
  const s={turns:[],speakers:[],quotes:[],cues:[],brief:'Understand how national water withdrawals were estimated.',goals:[{text:'How were the estimates made?',done:false}]};
  fixture.events.forEach(({event})=>applySpeakerEvent(s,event));
  updateSpeaker(s,'A',{role:'Reporter'});updateSpeaker(s,'B',{role:'Source'});
  if(confirm)for(const t of [...s.turns])if(t.speakerReviewRequired)setTurnSpeaker(s,t.id,t.speakerId);
  return s;
}
function candidate(s,quote,focus,kind='evidence'){
  return {cues:[{kind,focus,evidence:[{turn_id:analysisPassages(s.turns).at(-1).id,quote}]}]};
}

test('the USGS request contains the whole uninterrupted answer instead of treating the four-word tail as the latest answer',()=>{
  const s=interview(),before=structuredClone(s),request=analysisRequest(s);
  assert.equal(s.turns.at(-1).text,'levels in, in 1980.');
  assert.equal(request.turns.length,2);assert.equal(request.turns[0].speaker,'Reporter');
  assert.equal(request.turns[1].speaker,'Source');
  assert.ok(request.turns[1].text.startsWith('Well, we put out water use reports'));
  assert.ok(request.turns[1].text.includes('410 billion gallons per day'));
  assert.ok(request.turns[1].text.endsWith('levels in, in 1980.'));
  assert.deepEqual(request.goals,s.goals);assert.equal(request.brief,s.brief);
  assert.ok(request.turns.every(t=>!t.words&&!t.segments));assert.deepEqual(s,before);
});

test('a model quote from later in a combined answer resolves to its original segment and word times',()=>{
  const s=interview(),quote='The nation withdraws about 410 billion gallons per day for all types of use.';
  const result=resolvePassageCues(candidate(s,quote,'410 billion'),analysisPassages(s.turns));
  assert.equal(result.cues.length,1);assert.deepEqual(result.rejected,[]);
  const ref=result.cues[0].evidence[0];assert.equal(ref.turnId,'live-3-0');
  assert.equal(ref.start,34522);assert.equal(ref.end,39999);assert.equal(ref.alignment,'word');
  assert.equal(s.turns.find(t=>t.id===ref.turnId).text.slice(ref.startChar,ref.endChar),quote);
});

test('a quote spanning a transcription boundary preserves all source parts and later corrections invalidate it',()=>{
  const s=interview(),quote='Well, we put out water use reports once every 5 years to tell us where we stand in terms of how people are using water all across the United States.';
  const result=resolvePassageCues(candidate(s,quote,'water use reports','definition'),analysisPassages(s.turns));
  assert.equal(result.cues.length,1);const cue=result.cues[0],ref=cue.evidence[0];
  assert.equal(ref.quote,quote);assert.equal(ref.sourceParts.length,2);assert.equal(ref.start,2940);assert.equal(ref.end,11453);
  for(const part of ref.sourceParts)assert.equal(s.turns.find(t=>t.id===part.turnId).text.slice(part.startChar,part.endChar),part.quote);
  const second=ref.sourceParts[1];assert.ok(evidenceTurnIds(ref).includes(second.turnId));
  assert.ok(sameCue(cue,{...cue,id:'old-fragment-card',evidence:[{turnId:second.turnId}]}));
  s.cues=[cue];setTurnSpeaker(s,second.turnId,'A');assert.equal(s.cues.length,0);
});

test('disputed sections remain blocked even if the answer ends with an undisputed Source fragment',async()=>{
  const s=interview({confirm:false});assert.equal(s.turns.at(-1).speaker,'Source');
  const request=analysisRequest(s);assert.equal(request.turns.at(-1).speaker,'Unassigned');assert.equal(request.turns.at(-1).speakerReviewRequired,true);
  const result=await proposeFollowups(request,{config:{key:'test'},budget:{reserve(){assert.fail('No credits for an unreviewed answer');}},fetchImpl(){assert.fail('No provider request');}});
  assert.equal(result.outcome,'needs_speaker_review');assert.deepEqual(result.cues,[]);
  const payload=candidate(s,'all across the United States.','United States');
  assert.equal(resolvePassageCues(payload,analysisPassages(s.turns)).cues.length,0);
});

test('prior cards use passage identifiers for model history and keep asked/dismissed status',()=>{
  const s=interview(),quote='The nation withdraws about 410 billion gallons per day for all types of use.';
  s.cues=resolvePassageCues(candidate(s,quote,'410 billion'),analysisPassages(s.turns)).cues;s.cues[0].status='asked';
  const request=analysisRequest(s);assert.equal(request.previousCues[0].status,'asked');
  assert.deepEqual(request.previousCues[0].evidence,[{turnId:request.turns[1].id}]);
});

test('rechecking a returned question rejects changed words, changed roles and invented quotes',()=>{
  const quote='The nation withdraws about 410 billion gallons per day for all types of use.';
  for(const change of ['text','role','invented']){
    const s=interview(),payload=candidate(s,quote,'410 billion');
    if(change==='text')s.turns.find(t=>t.id==='live-3-0').text=s.turns.find(t=>t.id==='live-3-0').text.replace('410','420');
    if(change==='role')updateSpeaker(s,'B',{role:'Reporter'});
    if(change==='invented')payload.cues[0].evidence[0].quote='An invented claim of 410 billion.';
    assert.equal(resolvePassageCues(payload,analysisPassages(s.turns)).cues.length,0);
  }
});

test('model abstention stays empty and provisional words cannot enter analysis',()=>{
  const s=interview(),before=analysisRequest(s);s.turns.push({...s.turns.at(-1),id:'preview',text:'Invented interim statement.',provisional:true});
  assert.deepEqual(analysisRequest(s),before);
  assert.deepEqual(resolvePassageCues({cues:[]},analysisPassages(s.turns)),{cues:[],rejected:[]});
});

test('long sessions stay inside the existing request limits without merging different voices',()=>{
  const turns=Array.from({length:50},(_,i)=>({id:`t${i}`,text:`Sentence ${i}. `+'word '.repeat(240),speakerId:i<45?'A':'B',speaker:'Source',source:'assemblyai',start:i*1000,end:(i+1)*1000,words:[]}));
  const groups=analysisPassages(turns);
  assert.ok(groups.length<=10);assert.ok(groups.every(g=>g.text.length<=6000));assert.ok(groups.reduce((n,g)=>n+g.text.length,0)<=18000);
  assert.equal(groups.at(-1).segments.at(-1).turn.id,'t49');
  assert.ok(groups.every(g=>g.segments.every(s=>s.turn.speakerId===g.speakerId)));
});
