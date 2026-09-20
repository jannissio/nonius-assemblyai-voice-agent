import test from 'node:test';
import assert from 'node:assert/strict';
import {applySpeakerEvent,updateSpeaker,speakerDisplay,quoteSpeakerFields,setTurnSpeaker,acceptSpeakerRevision,proposedSpeakerTurns,namedNotebook,namedMarkdownNotes,sampleTurn} from '../lib/speakers.mjs';
import {resolveEvidence,validateCandidates} from '../lib/evidence.mjs';

const session=()=>({turns:[],speakers:[],quotes:[],cues:[],events:[]});
const speech=(order,label,text='The route is twenty percent faster.',words=[])=>({type:'Turn',end_of_turn:true,turn_order:order,speaker_label:label,transcript:text,words});
function save(s,turn,quote=turn.text){const ref=resolveEvidence(s.turns,{turn_id:turn.id,quote});const q={...ref,...quoteSpeakerFields(turn,ref),audioChecked:true,note:'Reporter note'};s.quotes.push(q);return q;}

test('anonymous voices A/B/C are discovered without guessing roles; names apply to past and future speech',()=>{
  const s=session();for(const [i,label]of ['A','B','C'].entries())applySpeakerEvent(s,speech(i,label));
  assert.deepEqual(s.speakers.map(p=>[p.id,p.name,p.role]),[['A','','Unassigned'],['B','','Unassigned'],['C','','Unassigned']]);
  assert.equal(speakerDisplay(s,s.turns[0]),'Person A');
  const q=save(s,s.turns[0]);updateSpeaker(s,'A',{name:'Alex'});
  applySpeakerEvent(s,speech(3,'A','This is another answer.'));
  assert.equal(speakerDisplay(s,s.turns[0]),'Alex');assert.equal(speakerDisplay(s,s.turns[3]),'Alex');
  assert.equal(speakerDisplay(s,q),'Alex');assert.equal(q.audioChecked,true);assert.equal(q.quote,'The route is twenty percent faster.');
  assert.match(namedMarkdownNotes(s),/Alex/);assert.equal(namedNotebook(s).quotes[0].speakerName,'Alex');
  updateSpeaker(s,'A',{name:'Alex Morgan'});assert.equal(namedNotebook(s).turns[3].speakerName,'Alex Morgan');
  assert.equal(s.speechTurns[0].speaker_label,'A');assert.equal(s.speechTurns[0].transcript,q.quote);
  assert.equal(session().speakers.length,0);
});

test('editorial roles stay separate from names and preserve the frozen Source evidence boundary',()=>{
  const s=session();applySpeakerEvent(s,speech(0,'A'));const turn=s.turns[0];
  const candidate={cues:[{kind:'comparison',focus:'twenty percent faster',evidence:[{turn_id:turn.id,quote:turn.text}]}]};
  updateSpeaker(s,'A',{name:'Source'});assert.equal(validateCandidates(candidate,s.turns).cues.length,0);
  updateSpeaker(s,'A',{role:'Source'});s.cues=validateCandidates(candidate,s.turns).cues;assert.equal(s.cues.length,1);
  const q=save(s,turn);updateSpeaker(s,'A',{role:'Reporter'});
  assert.equal(s.cues.length,0);assert.equal(q.speaker,'Reporter');assert.equal(q.audioChecked,false);
  assert.equal(validateCandidates(candidate,s.turns).cues.length,0);
  applySpeakerEvent(s,speech(1,'A'));assert.equal(s.turns[1].speaker,'Reporter');
});

test('mixed turns split at exact word boundaries and explicit PENDING never inherits the dominant voice',()=>{
  const s=session();const words=[{text:'Hello.',start:0,end:300,speaker:'A'},{text:'Yes.',start:400,end:650,speaker:'PENDING'},{text:'Welcome.',start:700,end:1400,speaker:'B'}];
  applySpeakerEvent(s,speech(0,'A','Hello. Yes. Welcome.',words));
  assert.deepEqual(s.turns.map(t=>[t.text,t.speakerId]),[['Hello.','A'],['Yes.',null],['Welcome.','B']]);
  for(const t of s.turns)assert.equal(s.speechTurns[0].transcript.slice(t.sourceStart,t.sourceEnd),t.text);
  assert.deepEqual(s.turns.map(t=>[t.start,t.end]),[[0,300],[400,650],[700,1400]]);
  applySpeakerEvent(s,speech(1,'A','Formatting differs.',words));
  assert.equal(s.turns.at(-1).speakerId,null);assert.equal(s.turns.at(-1).speakerStatus,'mixed');
  for(const label of ['PENDING',null,'__proto__','<script>'])applySpeakerEvent(s,speech(s.speechTurns.length,label));
  assert.deepEqual(s.speakers.map(p=>p.id),['A','B']);
});

test('late provider disagreements preserve live names and quote text, require review, and invalidate affected cues',()=>{
  const s=session();applySpeakerEvent(s,speech(0,'A'));applySpeakerEvent(s,speech(1,'B','The second person speaks.'));
  updateSpeaker(s,'A',{name:'Reporter',role:'Reporter'});updateSpeaker(s,'B',{name:'Guest',role:'Source'});
  const q=save(s,s.turns[0]);s.cues=[{id:'old',evidence:[{turnId:s.turns[0].id}]}];
  applySpeakerEvent(s,{type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'B'}]});
  assert.equal(speakerDisplay(s,s.turns[0]),'Reporter · Reporter');assert.equal(speakerDisplay(s,q),'Reporter · Reporter');
  assert.equal(proposedSpeakerTurns(s,0)[0].speakerId,'B');
  assert.equal(s.turns[0].speakerReviewRequired,true);assert.equal(s.turns[0].speaker,'Unassigned');assert.equal(q.speaker,'Unassigned');
  assert.equal(q.audioChecked,false);assert.equal(q.attributionRevised,true);assert.equal(q.quote,'The route is twenty percent faster.');
  assert.equal(q.note,'Reporter note');assert.equal(s.cues.length,0);
  assert.equal(s.speakers[0].name,'Reporter');assert.equal(s.speakers[1].name,'Guest');
  updateSpeaker(s,'B',{role:'Source'});assert.equal(s.turns[0].speaker,'Unassigned');
  setTurnSpeaker(s,s.turns[0].id,'B');assert.equal(s.turns[0].speaker,'Source');assert.equal(s.turns[0].speakerReviewRequired,false);
});

test('word-level revision can split a saved quote across people without assigning the whole quote to either',()=>{
  const s=session();const words=[{text:'Hello.',start:0,end:300,speaker:'A'},{text:'Welcome.',start:400,end:1100,speaker:'A'}];
  applySpeakerEvent(s,speech(0,'A','Hello. Welcome.',words));const q=save(s,s.turns[0]);
  applySpeakerEvent(s,{type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'A',words:[{...words[0]},{...words[1],speaker:'B'}]}]});
  assert.equal(s.turns.length,1);assert.equal(q.speakerReviewRequired,true);assert.equal(q.audioChecked,false);
  acceptSpeakerRevision(s,0);
  assert.equal(s.turns.length,2);assert.equal(q.speakerId,null);assert.equal(q.audioChecked,false);assert.equal(q.quote,'Hello. Welcome.');
  assert.equal(q.speaker,'Unassigned');
});

test('manual speaker correction survives later provider updates without rewriting source words',()=>{
  const s=session();applySpeakerEvent(s,speech(0,'A'));applySpeakerEvent(s,speech(1,'B'));
  setTurnSpeaker(s,s.turns[0].id,'B');const q=save(s,s.turns[0]);
  applySpeakerEvent(s,speech(0,'A'));applySpeakerEvent(s,{type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'A'}]});
  assert.equal(s.turns[0].speakerId,'B');assert.equal(s.turns[0].providerSpeakerId,'A');assert.equal(s.turns[0].speakerStatus,'corrected');
  assert.equal(q.speakerId,'B');assert.equal(q.audioChecked,true);
  setTurnSpeaker(s,s.turns[0].id,null);assert.equal(q.speakerId,null);assert.equal(q.audioChecked,false);
});

test('speaker revision cannot change recorded words or timestamps',()=>{
  const s=session();const word={text:'Hello.',start:0,end:500,speaker:'A'};
  applySpeakerEvent(s,speech(0,'A','Hello.',[word]));
  applySpeakerEvent(s,{type:'SpeakerRevision',revisions:[{turn_order:0,words:[{text:'Fabricated.',start:50,end:900,speaker:'B'}]}]});
  assert.equal(s.turns[0].text,'Hello.');assert.deepEqual(s.turns[0].words,[{text:'Hello.',start:0,end:500}]);
  assert.equal(s.turns[0].speakerId,'A');
});

test('scripted sample naming uses the same registry and remains distinct from live speaker detection',()=>{
  const s=session();s.turns.push(sampleTurn(s,{id:'s1',text:'Question here?',speaker:'Reporter',source:'sample'},0));
  updateSpeaker(s,'A',{name:'Taylor'});
  s.turns.push(sampleTurn(s,{id:'s2',text:'Another question?',speaker:'Reporter',source:'sample'},1));
  assert.equal(s.turns[1].speakerId,'A');assert.equal(speakerDisplay(s,s.turns[1]),'Taylor · Reporter');
  assert.equal(s.turns[1].speakerStatus,'scripted');
});

test('saved surrounding context follows accepted speaker revisions and renaming',()=>{
  const s=session();applySpeakerEvent(s,speech(0,'A','First statement.'));applySpeakerEvent(s,speech(1,'B','Second statement.'));
  const previous=s.turns[0],q=save(s,s.turns[1]);q.context={previousTurn:{text:previous.text,speaker:previous.speaker,...quoteSpeakerFields(previous,{startChar:0,endChar:previous.text.length})}};
  applySpeakerEvent(s,{type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'B'}]});acceptSpeakerRevision(s,0);updateSpeaker(s,'B',{name:'Jordan'});
  assert.equal(namedNotebook(s).quotes[0].context.previousTurn.speakerName,'Jordan');assert.equal(q.context.previousTurn.text,'First statement.');
});

test('a final known label resolves a wholly unknown voice without requiring review',()=>{
  const s=session();applySpeakerEvent(s,speech(0,'PENDING','A previously unidentified person.'));
  applySpeakerEvent(s,{type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'A'}]});
  assert.equal(s.turns[0].speakerId,'A');assert.equal(s.turns[0].speakerReviewRequired,false);
  assert.equal(s.speakerProposals[0].decision,'resolved-unknown');
});

test('manual corrections to part of a section survive accepting a merged provider proposal',()=>{
  const s=session(),words=[{text:'Hello.',start:0,end:300,speaker:'A'},{text:'Welcome.',start:400,end:1100,speaker:'B'}];
  applySpeakerEvent(s,speech(0,'A','Hello. Welcome.',words));
  setTurnSpeaker(s,s.turns[0].id,'A');
  applySpeakerEvent(s,{type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'B',words:words.map(w=>({...w,speaker:'B'}))}]});
  acceptSpeakerRevision(s,0);
  assert.deepEqual(s.turns.map(t=>[t.text,t.speakerId]),[['Hello.','A'],['Welcome.','B']]);
  assert.equal(s.turns[0].speakerStatus,'corrected');
});
