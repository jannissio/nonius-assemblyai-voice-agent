import test from 'node:test';
import assert from 'node:assert/strict';
import {CUE_TYPES,normalizeTurn,validateCandidates} from '../lib/evidence.mjs';
import {presentCue,sameCue} from '../lib/cues.mjs';
import {namedNotebook,namedMarkdownNotes} from '../lib/speakers.mjs';

const turns=[normalizeTurn({id:'t',speaker:'Source',text:'We will open next spring, with funding of fifty million pounds.'})];
const candidate=(kind,focus)=>validateCandidates({cues:[{kind,focus,evidence:[{turn_id:'t',quote:turns[0].text}]}]},turns).cues[0];

test('presentation separates a literal reference from the spoken question without changing evidence',()=>{
  const original=candidate('date','next spring'),before=structuredClone(original);
  const shown=presentCue({...original,question:'Invented model-written question.'});
  assert.equal(shown.question,'When exactly would that be?');
  assert.equal(shown.focus,'next spring');assert.deepEqual(shown.evidence,original.evidence);
  assert.deepEqual(original,before);
  for(const kind of Object.keys(CUE_TYPES))assert.doesNotMatch(presentCue({...original,kind}).question,/you mentioned/i);
});

test('duplicate checks survive wording changes but keep distinct topics and new source passages',()=>{
  const date=presentCue(candidate('date','next spring'));
  assert.ok(sameCue(date,{...date,id:'other-excerpt',question:'Different wording'}));
  assert.equal(sameCue(date,{...date,id:'other-topic',focus:'fifty million pounds'}),false);
  assert.equal(sameCue(date,{...date,id:'later-turn',evidence:[{...date.evidence[0],turnId:'t2'}]}),false);
});

test('JSON and Markdown retain the referenced topic even though read-aloud text is just the question',()=>{
  const session={turns,cues:[presentCue(candidate('date','next spring'))],quotes:[]};
  assert.equal(namedNotebook(session).cues[0].focus,'next spring');
  const notes=namedMarkdownNotes(session);
  assert.match(notes,/When exactly would that be\? \(Regarding: “next spring”\)/);
  assert.doesNotMatch(session.cues[0].question,/Regarding|mentioned/);
});
