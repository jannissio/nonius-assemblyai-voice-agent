import test from 'node:test';
import assert from 'node:assert/strict';
import {groupSpeakerTurns,resolveSpeakerExcerpt,sameExcerpt,applySpeakerEvent,updateSpeaker,setTurnSpeaker,namedNotebook,namedMarkdownNotes,speakerDisplay} from '../lib/speakers.mjs';

const session=()=>({turns:[],speakers:[],quotes:[],cues:[],events:[]});
function speech(s,order,label,text,start=order*1000){
  let time=start;
  const words=text.split(' ').map(text=>{const word={text,start:time,end:time+100};time+=150;return word;});
  applySpeakerEvent(s,{type:'Turn',end_of_turn:true,turn_order:order,speaker_label:label,transcript:text,words});
}
function save(s,group,text=group.text){
  const q=resolveSpeakerExcerpt(group,text);assert.ok(q);
  s.quotes.push({...q,audioChecked:true,note:'Keep the original wording.'});return s.quotes.at(-1);
}

test('pauses and sentence boundaries do not split a speaker card or mutate its source segments',()=>{
  const s=session();speech(s,0,'A','What changed?');speech(s,1,'B','Water use fell');
  speech(s,2,'B','by five percent.',10000);speech(s,3,'B','Here is the comparison.',90000);
  const before=structuredClone(s),groups=groupSpeakerTurns(s.turns);
  assert.equal(groups.length,2);assert.equal(groups[1].text,'Water use fell by five percent. Here is the comparison.');
  assert.deepEqual(groups[1].segments.map(p=>p.turn.id),s.turns.slice(1).map(t=>t.id));
  assert.equal(groups[1].start,1000);assert.equal(groups[1].end,s.turns.at(-1).end);
  assert.deepEqual(s,before);
});

test('another voice ends the card even if both people have the same role and name',()=>{
  const s=session();for(const [i,id]of ['A','A','B','B','A','C','C'].entries())speech(s,i,id,`Statement number ${i}.`);
  for(const id of ['A','B','C'])updateSpeaker(s,id,{name:'Alex',role:'Source'});
  const groups=groupSpeakerTurns(s.turns);
  assert.deepEqual(groups.map(g=>g.speakerId),['A','B','A','C']);
  assert.deepEqual(groups.map(g=>g.segments.length),[2,2,1,2]);
});

test('unknown voices remain separate and never bridge two known voices',()=>{
  const s=session();for(const [i,id]of ['A',null,null,'A'].entries())speech(s,i,id,`Statement number ${i}.`);
  assert.deepEqual(groupSpeakerTurns(s.turns).map(g=>g.speakerId),['A',null,null,'A']);
  s.turns.push({id:'typed',text:'Typed rehearsal.',speaker:'Unassigned',source:'typed',start:0,end:0});
  assert.equal(groupSpeakerTurns(s.turns).length,5);
});

test('a speaker interruption within one provider message remains three cards',()=>{
  const s=session();applySpeakerEvent(s,{type:'Turn',end_of_turn:true,turn_order:0,speaker_label:'A',transcript:'Hello. Yes. Continuing.',words:[
    {text:'Hello.',speaker:'A',start:0,end:300},{text:'Yes.',speaker:'B',start:310,end:500},{text:'Continuing.',speaker:'A',start:600,end:900}]});
  assert.deepEqual(groupSpeakerTurns(s.turns).map(g=>[g.speakerId,g.text]),[['A','Hello.'],['B','Yes.'],['A','Continuing.']]);
});

test('new segments grow the same card; provider replacements do not append duplicate text',()=>{
  const s=session();speech(s,0,'B','A first phrase.');const id=groupSpeakerTurns(s.turns)[0].id;
  speech(s,1,'B','A second phrase.');speech(s,1,'B','The corrected second phrase.');
  const groups=groupSpeakerTurns(s.turns);assert.equal(groups.length,1);assert.equal(groups[0].id,id);
  assert.equal(groups[0].text,'A first phrase. The corrected second phrase.');assert.equal(groups[0].segments.length,2);
});

test('an excerpt across a pause retains exact per-segment provenance and word timing',()=>{
  const s=session();speech(s,0,'B','Water use fell',1000);speech(s,1,'B','by five percent.',6000);
  updateSpeaker(s,'B',{role:'Source'});const group=groupSpeakerTurns(s.turns)[0],q=save(s,group,'use fell by five');
  assert.equal(q.quote,'use fell by five');assert.equal(q.start,1150);assert.equal(q.end,6250);assert.equal(q.alignment,'word');
  assert.equal(q.rangeScope,'speaker-passage');assert.equal(q.speakerId,'B');assert.equal(q.speaker,'Source');
  assert.deepEqual(q.sourceParts.map(p=>[p.providerTurnOrder,p.sourceStart,p.sourceEnd,p.quote]),[[0,6,14,'use fell'],[1,0,7,'by five']]);
  for(const part of q.sourceParts)assert.equal(s.speechTurns.find(t=>t.turn_order===part.providerTurnOrder).transcript.slice(part.sourceStart,part.sourceEnd),part.quote);
  const later=resolveSpeakerExcerpt(group,'five percent.');assert.equal(later.turnId,s.turns[1].id);assert.equal(later.sourceStart,3);assert.equal(later.sourceParts,undefined);
  assert.equal(resolveSpeakerExcerpt(group,'use fell by six'),null);
  assert.equal(resolveSpeakerExcerpt(group,'use'),null);
});

test('excerpt identity survives passage growth, renaming and later grouping changes',()=>{
  const s=session();speech(s,0,'B','The first statement.');speech(s,1,'B','The second statement.');
  const first=groupSpeakerTurns(s.turns)[0],q=save(s,first);const single=save(s,first,'second statement.');
  speech(s,2,'B','The third statement.');updateSpeaker(s,'B',{name:'Guest'});
  const grown=groupSpeakerTurns(s.turns)[0];assert.ok(sameExcerpt(q,resolveSpeakerExcerpt(grown,q.quote)));
  assert.ok(sameExcerpt(single,resolveSpeakerExcerpt(grown,single.quote)));assert.equal(q.audioChecked,true);
  speech(s,3,'A','An interruption.');setTurnSpeaker(s,s.turns[0].id,'A');
  const regrouped=groupSpeakerTurns(s.turns).find(g=>g.speakerId==='B');
  assert.ok(sameExcerpt(single,resolveSpeakerExcerpt(regrouped,single.quote)));assert.equal(single.audioChecked,true);
});

test('late speaker disagreements keep cards stable, retain review markers and protect combined quotes',()=>{
  const s=session();speech(s,0,'A','The first statement.');speech(s,1,'A','The second statement.');speech(s,2,'A','The third statement.');
  updateSpeaker(s,'A',{role:'Source'});const q=save(s,groupSpeakerTurns(s.turns)[0]);const original=q.quote;
  applySpeakerEvent(s,{type:'SpeakerRevision',revisions:[{turn_order:1,speaker_label:'B'}]});
  let groups=groupSpeakerTurns(s.turns);assert.deepEqual(groups.map(g=>g.speakerId),['A']);
  assert.equal(groups[0].speakerReviewRequired,true);assert.equal(q.speakerId,'A');assert.equal(q.speaker,'Unassigned');assert.equal(q.audioChecked,false);
  assert.equal(q.quote,original);assert.equal(q.note,'Keep the original wording.');
  setTurnSpeaker(s,s.turns[1].id,'A');groups=groupSpeakerTurns(s.turns);assert.equal(groups.length,1);
  assert.equal(groups[0].speakerReviewRequired,false);assert.equal(q.speakerId,'A');assert.equal(q.speaker,'Source');assert.equal(q.audioChecked,false);
  q.audioChecked=true;speech(s,3,'B','An unrelated passage.');assert.equal(q.audioChecked,true);
  updateSpeaker(s,'A',{role:'Reporter'});assert.equal(q.speaker,'Reporter');assert.equal(q.audioChecked,false);
});

test('a revision to one portion of a grouped card is visible; renaming does not clear review',()=>{
  const s=session();speech(s,0,'A','First statement.');speech(s,1,'A','Second statement.');
  applySpeakerEvent(s,{type:'SpeakerRevision',revisions:[{turn_order:1,speaker_label:'B'}]});
  updateSpeaker(s,'A',{name:'Guest',role:'Source'});
  const group=groupSpeakerTurns(s.turns)[0];assert.equal(group.segments.length,2);assert.equal(group.speakerReviewRequired,true);
  const q=save(s,group);assert.equal(q.speaker,'Unassigned');assert.equal(q.speakerReviewRequired,true);
});

test('text revisions invalidate a combined quote without rewriting it',()=>{
  const s=session();speech(s,0,'B','The estimate was');speech(s,1,'B','five percent.');
  const q=save(s,groupSpeakerTurns(s.turns)[0]);speech(s,1,'B','six percent.');
  assert.equal(q.quote,'The estimate was five percent.');assert.equal(q.transcriptRevised,true);
  assert.equal(q.audioChecked,false);assert.equal(q.speaker,'Unassigned');
});

test('Markdown groups conversations while JSON preserves original segments and compound references',()=>{
  const s=session();speech(s,0,'A','What changed?');speech(s,1,'B','Water use fell');speech(s,2,'B','by five percent.');
  updateSpeaker(s,'B',{name:'Guest',role:'Source'});const q=save(s,groupSpeakerTurns(s.turns)[1]);
  const json=namedNotebook(s);assert.equal(json.turns.length,3);assert.equal(json.quotes[0].sourceParts.length,2);
  assert.equal(json.quotes[0].sourceParts[1].speakerName,'Guest · Interviewee');
  assert.ok(namedMarkdownNotes(s).includes('Water use fell by five percent.'));assert.equal(q.audioChecked,true);
});

test('typed rehearsal groups stay typed and keep their role display without invented voice labels',()=>{
  const s=session();s.turns=['One typed statement.','Another typed statement.'].map((text,i)=>({id:`typed-${i}`,speaker:'Source',text,source:'typed',start:0,end:0,words:[]}));
  const groups=groupSpeakerTurns(s.turns);assert.equal(groups.length,1);const q=save(s,groups[0]);
  assert.equal(Object.hasOwn(q,'speakerId'),false);assert.equal(q.source,'typed');assert.equal(speakerDisplay(s,q),'Source');
  speech(s,0,'A','An unrelated live voice.');updateSpeaker(s,'A',{role:'Reporter'});
  assert.equal(speakerDisplay(s,q),'Source');
});
