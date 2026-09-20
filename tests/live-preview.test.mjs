import test from 'node:test';
import assert from 'node:assert/strict';
import {applySpeakerEvent,nextSpeechPreview,previewSpeakerTurns,groupSpeakerTurns,resolveSpeakerExcerpt,updateSpeaker} from '../lib/speakers.mjs';

const session=()=>({turns:[],speakers:[],speechTurns:[],quotes:[],cues:[]});
const turn=(order,text,label='B',final=false,words=[])=>({type:'Turn',turn_order:order,transcript:text,speaker_label:label,end_of_turn:final,words});

test('partial revisions replace live text without becoming saved transcript or cue evidence',()=>{
  const s=session();let preview=nextSpeechPreview(s,null,turn(0,'The estimate is forty'));
  preview=nextSpeechPreview(s,preview,turn(0,'The estimate is forty one.'));
  const drafts=previewSpeakerTurns(s,preview);
  assert.equal(drafts.length,1);assert.equal(drafts[0].text,'The estimate is forty one.');assert.equal(drafts[0].provisional,true);
  assert.equal(s.turns.length,0);assert.equal(s.speechTurns.length,0);assert.equal(s.quotes.length,0);
  assert.equal(resolveSpeakerExcerpt(groupSpeakerTurns(drafts)[0],drafts[0].text),null);
});

test('a completed segment replaces its preview and joins earlier speech from that voice',()=>{
  const s=session();applySpeakerEvent(s,turn(0,'First part of the answer.','B',true));
  let preview=nextSpeechPreview(s,null,turn(1,'The answer continues.'));
  const view=groupSpeakerTurns([...s.turns,...previewSpeakerTurns(s,preview)]);
  assert.equal(view.length,1);assert.equal(view[0].segments.length,2);
  const final=turn(1,'The answer continues.','B',true);preview=nextSpeechPreview(s,preview,final);applySpeakerEvent(s,final);
  assert.equal(preview,null);assert.equal(groupSpeakerTurns(s.turns).length,1);assert.equal(s.turns.length,2);
  assert.equal(groupSpeakerTurns(s.turns)[0].text,'First part of the answer. The answer continues.');
  assert.equal(nextSpeechPreview(s,null,turn(1,'Late duplicate.')),null);
});

test('unknown partials are not attributed to the last speaker, but resolve when a label arrives',()=>{
  const s=session();applySpeakerEvent(s,turn(0,'An earlier answer.','B',true));
  let preview=nextSpeechPreview(s,null,turn(1,'New words.','PENDING'));
  assert.equal(previewSpeakerTurns(s,preview)[0].speakerId,null);
  assert.equal(groupSpeakerTurns([...s.turns,...previewSpeakerTurns(s,preview)]).length,2);
  preview=nextSpeechPreview(s,preview,turn(1,'New words.','B'));
  assert.equal(groupSpeakerTurns([...s.turns,...previewSpeakerTurns(s,preview)]).length,1);
});

test('interjections in partial speech retain A/B/A boundaries and explicit pending words',()=>{
  const s=session();const words=[{text:'Yes.',speaker:'A',start:0,end:200},{text:'But.',speaker:'B',start:210,end:400},{text:'Continuing.',speaker:'A',start:410,end:600},{text:'Uh.',speaker:'PENDING',start:610,end:700}];
  const preview=nextSpeechPreview(s,null,turn(0,'Yes. But. Continuing. Uh.','A',false,words));
  assert.deepEqual(previewSpeakerTurns(s,preview).map(t=>t.speakerId),['A','B','A',null]);
});

test('late messages cannot erase a newer live preview; malformed orders are ignored',()=>{
  const s=session(),current=nextSpeechPreview(s,null,turn(2,'Latest words.'));
  assert.equal(nextSpeechPreview(s,current,turn(1,'Earlier final.','A',true)),current);
  assert.equal(nextSpeechPreview(s,current,turn(1,'Earlier partial.')),current);
  assert.equal(nextSpeechPreview(s,current,turn(-1,'Invalid order.')),current);
  assert.equal(nextSpeechPreview(s,current,turn(2,'  ')),null);
  assert.equal(nextSpeechPreview(s,current,turn(3,'Later final.','A',true)),null);
});

test('roles chosen during live text apply on completion without storing the provisional wording',()=>{
  const s=session(),preview=nextSpeechPreview(s,null,turn(0,'Rough live wording.'));
  previewSpeakerTurns(s,preview);updateSpeaker(s,'B',{name:'Guest',role:'Source'});
  applySpeakerEvent(s,turn(0,'The completed wording.','B',true));
  assert.equal(s.turns[0].speaker,'Source');assert.equal(s.turns[0].text,'The completed wording.');
  assert.equal(s.speechTurns[0].transcript,'The completed wording.');assert.equal(s.speakers[0].name,'Guest');
});
