import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applySpeakerEvent,groupSpeakerTurns,nextSpeechPreview,setTurnSpeaker,updateSpeaker,resolveSpeakerExcerpt,namedNotebook,acceptSpeakerRevision} from '../lib/speakers.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/usgs-speaker-revision.json',import.meta.url),'utf8'));
const session=()=>({turns:[],speakers:[],quotes:[],cues:[]});

test('the real USGS end-of-session revision cannot swap named people or split the uninterrupted answer',()=>{
  const s=session();let preview=null,before;
  for(const {event} of fixture.events){
    preview=nextSpeechPreview(s,preview,event);
    if(event.type==='SpeakerRevision'){
      updateSpeaker(s,'A',{name:'David Hebert',role:'Reporter'});updateSpeaker(s,'B',{name:'Bob Hirsch',role:'Source'});
      const groups=groupSpeakerTurns(s.turns);assert.deepEqual(groups.map(g=>g.speakerId),['A','B']);
      before=groups.map(g=>({speakerId:g.speakerId,text:g.text}));
      s.quotes.push({...resolveSpeakerExcerpt(groups[1],'all across the United States.'),audioChecked:true,note:'Check the recording.'});
    }
    applySpeakerEvent(s,event);
  }
  assert.equal(preview,null);assert.equal(s.speechTurns.length,6);
  assert.deepEqual(groupSpeakerTurns(s.turns).map(g=>({speakerId:g.speakerId,text:g.text})),before);
  assert.ok(s.turns.some(t=>t.speakerReviewRequired));assert.equal(s.quotes[0].audioChecked,false);
  assert.equal(s.quotes[0].speakerId,'B');assert.equal(s.quotes[0].quote,'all across the United States.');
  const exported=namedNotebook(s);assert.equal(exported.speakerProposals.length,3);
  assert.equal(exported.turns[0].speakerName,'David Hebert · Reporter');
  for(const t of [...s.turns])if(t.speakerReviewRequired)setTurnSpeaker(s,t.id,t.speakerId);
  assert.equal(groupSpeakerTurns(s.turns).length,2);assert.ok(s.turns.every(t=>!t.speakerReviewRequired));
  assert.equal(s.quotes[0].speaker,'Source');assert.equal(s.quotes[0].audioChecked,false);
});

test('the recorded missing phrase is a provider draft revision, not text removed by card grouping',()=>{
  const turns=fixture.events.filter(x=>x.event.type==='Turn').map(x=>x.event);
  assert.ok(turns.some(t=>!t.end_of_turn&&t.transcript==='Of water.'));
  const s=session();turns.forEach(t=>applySpeakerEvent(s,t));
  const final=turns.filter(t=>t.end_of_turn).map(t=>t.transcript).join(' ');
  assert.ok(!final.toLowerCase().includes('of water.'));
  assert.equal(groupSpeakerTurns(s.turns).map(t=>t.text).join(' '),final);
  assert.ok(final.endsWith('levels in, in 1980.'));
});

test('applying the recorded final proposals is an explicit, inspectable decision',()=>{
  const s=session();fixture.events.forEach(({event})=>applySpeakerEvent(s,event));
  for(const p of s.speakerProposals)acceptSpeakerRevision(s,p.turnOrder);
  assert.equal(groupSpeakerTurns(s.turns).length,5);
  assert.ok(s.speakerProposals.every(p=>p.decision==='accepted'));
});
