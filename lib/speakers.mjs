// Session-scoped voice labels. Editorial roles stay separate from display names.
// The frozen evidence checker continues to see only Source/Reporter/Unassigned.
import {normalizeTurn,markdownNotes,resolveEvidence} from './evidence.mjs';
import {cueForNotes,evidenceTurnIds} from './cues.mjs';

const ROLES=new Set(['Unassigned','Source','Reporter']);
export const voiceLabel=value=>typeof value==='string'&&/^[A-Z]{1,3}$/.test(value)&&!['PENDING','UNKNOWN'].includes(value)?value:null;
const roleOf=(session,id)=>session.speakers?.find(p=>p.id===id)?.role||'Unassigned';
export function ensureSpeaker(session,label,role='Unassigned'){
  const id=voiceLabel(label);if(!id)return null;
  session.speakers??=[];
  if(!session.speakers.some(p=>p.id===id))session.speakers.push({id,name:'',role:ROLES.has(role)?role:'Unassigned'});
  return id;
}
export function speakerName(session,id){const person=session.speakers?.find(p=>p.id===id);return person?.name|| (id?`Person ${id}`:'Speaker unclear');}
export function speakerDisplay(session,item){
  if(!Object.hasOwn(item,'speakerId'))return item.speaker;
  const name=speakerName(session,item.speakerId);
  const role=roleOf(session,item.speakerId);
  return `${name}${role!=='Unassigned'?` · ${role==='Source'?'Interviewee':role}`:''}`;
}
function markQuoteForReview(quote,reason){quote.audioChecked=false;quote.attributionRevised=true;quote.reviewReason=reason;}
function invalidateCues(session,ids){session.cues=(session.cues||[]).filter(c=>!c.evidence.some(e=>evidenceTurnIds(e).some(id=>ids.has(id))));}

// Provider endpoints are not speaker changes. Group only the view; retain every
// original segment and its offsets for revisions, follow-up evidence and exports.
export function groupSpeakerTurns(turns){
  const groups=[];
  const identity=turn=>Object.hasOwn(turn,'speakerId')?(turn.speakerId?`voice:${turn.speakerId}`:null):
    turn.source==='typed'?`typed:${turn.speaker}`:null;
  for(const turn of turns){
    let group=groups.at(-1);const key=identity(turn);
    if(!group||!key||identity(group)!==key||group.source!==turn.source){
      group={...turn,text:'',words:[],segments:[],speakerReviewRequired:false};groups.push(group);
    }
    const from=group.text.length+(group.segments.length?1:0);
    group.text+=(group.segments.length?' ':'')+turn.text;
    group.segments.push({turn,from,to:group.text.length});
    group.words.push(...(turn.words||[]));
    group.start=Math.min(group.start,turn.start);group.end=Math.max(group.end,turn.end);
    group.speakerReviewRequired||=Boolean(turn.speakerReviewRequired);
    if(group.speakerReviewRequired)group.speakerStatus='revised';
  }
  return groups;
}

// Partial text is a replaceable preview, never saved transcript or cue evidence.
export function nextSpeechPreview(session,current,event){
  const order=event.turn_order;
  if(event.type!=='Turn'||!Number.isSafeInteger(order)||order<0)return current;
  if(event.end_of_turn)return current&&order>=current.turn_order?null:current;
  if(session.speechTurns?.some(t=>t.turn_order>=order)||current&&current.turn_order>order)return current;
  if(!event.transcript?.trim())return current?.turn_order===order?null:current;
  return {turn_order:order,transcript:event.transcript,speaker_label:event.speaker_label??null,
    words:(event.words||[]).map(w=>({...w})),start:event.start,end:event.end};
}

export function previewSpeakerTurns(session,preview){
  if(!preview)return [];
  return buildTurns(session,preview).map(turn=>({...turn,id:`preview-${turn.providerTurnOrder}-${turn.sourceStart}`,provisional:true}));
}

// Cross-segment excerpts retain an exact source reference for each component.
// The only text inserted for display is one space between provider segments.
export function resolveSpeakerExcerpt(group,text){
  if(group.segments.some(s=>s.turn.provisional))return null;
  const ref=resolveEvidence([group],{turn_id:group.id,quote:text});if(!ref)return null;
  const parts=[];
  for(const {turn,from,to}of group.segments){
    const startChar=Math.max(ref.startChar,from)-from,endChar=Math.min(ref.endChar,to)-from;
    if(startChar>=endChar)continue;
    const quote=turn.text.slice(startChar,endChar);
    const part={turnId:turn.id,quote,startChar,endChar,speaker:turn.speaker,
      ...quoteSpeakerFields(turn,{startChar,endChar})};
    parts.push(part);
  }
  if(parts.length===1){
    const turn=group.segments.find(s=>s.turn.id===parts[0].turnId).turn;
    const original=resolveEvidence([turn],{turn_id:turn.id,quote:ref.quote});
    return original?{...original,...quoteSpeakerFields(turn,original)}:null;
  }
  if(!parts.length||parts.map(p=>p.quote).join(' ')!==ref.quote)return null;
  return {...ref,turnId:parts[0].turnId,...(Object.hasOwn(group,'speakerId')?{speakerId:group.speakerId}:{}),
    speaker:parts.some(p=>p.speakerReviewRequired)?'Unassigned':parts[0].speaker,
    speakerReviewRequired:parts.some(p=>p.speakerReviewRequired),
    rangeScope:'speaker-passage',sourceParts:parts};
}

export function sameExcerpt(a,b){
  const key=q=>JSON.stringify((q.sourceParts||[q]).map(p=>[
    p.providerTurnOrder??p.turnId,p.sourceStart??p.startChar,p.sourceEnd??p.endChar]));
  return key(a)===key(b);
}

function refreshCombinedAttribution(quote,changed){
  const parts=quote.sourceParts,ids=new Set(parts.map(p=>p.speakerId)),roles=new Set(parts.map(p=>p.speaker));
  if(parts.some(p=>Object.hasOwn(p,'speakerId')))quote.speakerId=ids.size===1?parts[0].speakerId:null;
  quote.speakerReviewRequired=ids.size!==1||parts.some(p=>p.speakerReviewRequired);
  quote.speaker=!quote.speakerReviewRequired&&roles.size===1?parts[0].speaker:'Unassigned';
  quote.turnId=parts[0].turnId;
  if(parts.some(p=>p.transcriptRevised))quote.transcriptRevised=true;
  if(changed)markQuoteForReview(quote,'Speaker attribution or transcript changed. Check the original audio before using this excerpt.');
}

export function updateSpeaker(session,id,patch){
  const person=session.speakers?.find(p=>p.id===id);if(!person)throw new Error('Unknown speaker.');
  if(Object.hasOwn(patch,'name')){
    if(typeof patch.name!=='string'||patch.name.trim().length>60||/[\x00-\x1f\x7f]/.test(patch.name))throw new Error('Use a name of up to 60 characters.');
    person.name=patch.name.trim();
  }
  const changed=[];
  if(Object.hasOwn(patch,'role')){
    if(!ROLES.has(patch.role))throw new Error('Unknown editorial role.');
    person.role=patch.role;
    for(const turn of session.turns||[])if(turn.speakerId===id){const role=turn.speakerReviewRequired?'Unassigned':person.role;if(turn.speaker!==role){turn.speaker=role;changed.push(turn.id);}}
    for(const quote of session.quotes||[]){
      let revised=false;
      for(const part of quote.sourceParts||[quote])if(part.speakerId===id){const role=part.speakerReviewRequired?'Unassigned':person.role;if(part.speaker!==role){part.speaker=role;revised=true;}}
      if(quote.sourceParts)refreshCombinedAttribution(quote,revised);
      else if(revised)markQuoteForReview(quote,'The speaker role changed. Review this excerpt’s attribution.');
    }
    invalidateCues(session,new Set(changed));
  }
  return changed;
}

function splitSpeech(raw){
  const words=Array.isArray(raw.words)?raw.words:[];
  const fallback=voiceLabel(raw.speaker_label);
  const labels=words.map(w=>Object.hasOwn(w,'speaker')?voiceLabel(w.speaker):fallback);
  const unique=new Set(labels.length?labels:[fallback]);
  if(unique.size===1)return [{from:0,to:raw.transcript.length,label:[...unique][0],words,status:[...unique][0]?'detected':'pending'}];
  let cursor=0;const aligned=[];
  for(let index=0;index<words.length;index++){
    const word=words[index];const position=typeof word.text==='string'&&word.text?raw.transcript.indexOf(word.text,cursor):-1;
    if(position<0)return [{from:0,to:raw.transcript.length,label:null,words,status:'mixed'}];
    aligned.push({position,word,label:labels[index]});cursor=position+word.text.length;
  }
  const parts=[];
  for(const [index,word]of aligned.entries()){
    const previous=parts.at(-1);
    if(!previous||previous.label!==word.label){
      if(previous)previous.to=word.position;
      parts.push({from:index===0?0:word.position,to:raw.transcript.length,label:word.label,words:[word.word],status:word.label?'detected':'pending'});
    }else previous.words.push(word.word);
  }
  return parts;
}

function buildTurns(session,raw){
  ensureSpeaker(session,raw.speaker_label);
  for(const word of raw.words||[])ensureSpeaker(session,word.speaker);
  const parts=splitSpeech(raw).flatMap(part=>{
    const boundaries=[part.from,part.to];
    for(const o of session.speakerOverrides||[])if(o.turnOrder===raw.turn_order)
      for(const at of [o.from,o.to])if(at>part.from&&at<part.to)boundaries.push(at);
    const cuts=[...new Set(boundaries)].sort((a,b)=>a-b);if(cuts.length===2)return [part];
    let cursor=part.from;const aligned=part.words.map(word=>{
      const from=raw.transcript.indexOf(word.text,cursor);cursor=from+word.text.length;return {word,from,to:cursor};
    });
    return cuts.slice(0,-1).map((from,i)=>({...part,from,to:cuts[i+1],
      words:aligned.filter(w=>w.from<cuts[i+1]&&w.to>from).map(w=>w.word)}));
  });
  return parts.filter(p=>raw.transcript.slice(p.from,p.to).trim()).map(part=>{
    while(part.from<part.to&&/\s/.test(raw.transcript[part.from]))part.from++;
    while(part.to>part.from&&/\s/.test(raw.transcript[part.to-1]))part.to--;
    const correction=session.speakerOverrides?.findLast(o=>o.turnOrder===raw.turn_order&&o.from<=part.from&&o.to>=part.to);
    const speakerId=correction?correction.speakerId:part.label;
    const speakerReviewRequired=!correction&&Boolean(session.speakerReviews?.some(r=>r.turnOrder===raw.turn_order&&r.from<part.to&&r.to>part.from));
    const start=part.words[0]?.start??raw.start??0,end=part.words.at(-1)?.end??raw.end??start;
    const turn=normalizeTurn({id:`live-${raw.turn_order}-${part.from}`,text:raw.transcript.slice(part.from,part.to),
      start,end,words:part.words,speaker:speakerReviewRequired?'Unassigned':roleOf(session,speakerId),source:'assemblyai'});
    return {...turn,speakerId,providerSpeakerId:part.label,providerTurnOrder:raw.turn_order,sourceStart:part.from,sourceEnd:part.to,
      speakerReviewRequired,speakerStatus:correction?'corrected':speakerReviewRequired?'revised':part.status};
  });
}

function refreshExcerptPart(session,quote,order,raw){
  if(quote.providerTurnOrder!==order)return false;
  const match=session.turns.find(t=>t.providerTurnOrder===order&&t.sourceStart<=quote.sourceStart&&t.sourceEnd>=quote.sourceEnd);
  const textMatches=raw.transcript.slice(quote.sourceStart,quote.sourceEnd)===quote.quote;
  const speakerId=match&&textMatches?match.speakerId:null;
  const changed=quote.speakerId!==speakerId||!match||!textMatches||(!quote.speakerReviewRequired&&Boolean(match.speakerReviewRequired));
  if(changed)markQuoteForReview(quote,'Speaker attribution or transcript changed. Check the original audio before using this excerpt.');
  if(!textMatches)quote.transcriptRevised=true;
  quote.speakerId=speakerId;quote.speakerReviewRequired=Boolean(match?.speakerReviewRequired)||!match;
  quote.speaker=match&&textMatches?match.speaker:'Unassigned';
  if(match&&textMatches){quote.turnId=match.id;quote.startChar=quote.sourceStart-match.sourceStart;quote.endChar=quote.sourceEnd-match.sourceStart;}
  return changed;
}

function refreshSavedAttribution(session,order,raw){
  for(const quote of session.quotes||[]){
    const previous=quote.context?.previousTurn;
    if(previous?.providerTurnOrder===order){
      const match=session.turns.find(t=>t.providerTurnOrder===order&&t.sourceStart<=previous.sourceStart&&t.sourceEnd>=previous.sourceEnd);
      previous.speakerId=match&&raw.transcript.slice(previous.sourceStart,previous.sourceEnd)===previous.text?match.speakerId:null;
      previous.speakerReviewRequired=Boolean(match?.speakerReviewRequired);
      previous.speaker=previous.speakerReviewRequired?'Unassigned':roleOf(session,previous.speakerId);
    }
    if(quote.sourceParts){
      const changed=quote.sourceParts.map(part=>refreshExcerptPart(session,part,order,raw)).some(Boolean);
      refreshCombinedAttribution(quote,changed);
    }else refreshExcerptPart(session,quote,order,raw);
  }
}

function replaceSpeechTurn(session,raw){
  const before=session.turns.filter(t=>t.providerTurnOrder===raw.turn_order);
  const after=buildTurns(session,raw),index=session.turns.findIndex(t=>t.providerTurnOrder===raw.turn_order);
  session.turns=session.turns.filter(t=>t.providerTurnOrder!==raw.turn_order);
  session.turns.splice(index<0?session.turns.length:index,0,...after);
  const changed=before.filter(t=>{const next=after.find(n=>n.id===t.id);return !next||next.text!==t.text||next.speakerId!==t.speakerId||next.speaker!==t.speaker;}).map(t=>t.id);
  invalidateCues(session,new Set(changed));refreshSavedAttribution(session,raw.turn_order,raw);
  return changed;
}

export function applySpeakerEvent(session,event){
  session.speechTurns??=[];const changed=[];
  if(event.type==='Turn'){
    if(!event.end_of_turn||!event.transcript?.trim())return changed;
    if(!Number.isSafeInteger(event.turn_order)||event.turn_order<0)throw new Error('Invalid speech turn identifier.');
    // Preserve the provider's exact text and word labels independently of UI names.
    const raw={turn_order:event.turn_order,transcript:event.transcript,speaker_label:event.speaker_label??null,
      words:(event.words||[]).map(w=>({...w})),start:event.start,end:event.end};
    const index=session.speechTurns.findIndex(t=>t.turn_order===raw.turn_order);
    const updates=replaceSpeechTurn(session,raw);
    if(index<0)session.speechTurns.push(raw);else session.speechTurns[index]=raw;
    changed.push(...updates);
  }else if(event.type==='SpeakerRevision'){
    for(const revision of event.revisions||[]){
      const raw=session.speechTurns.find(t=>t.turn_order===revision.turn_order);if(!raw)continue;
      const before=session.turns.filter(t=>t.providerTurnOrder===raw.turn_order).map(t=>({...t}));
      const proposed={...raw,words:raw.words.map(w=>({...w}))};
      if(Object.hasOwn(revision,'speaker_label'))proposed.speaker_label=revision.speaker_label;
      // Revisions may only change speaker assignments, never words or timing.
      // Apply supplied labels only when each word matches the retained original.
      if(Array.isArray(revision.words)){
        const used=new Set();
        for(const word of proposed.words){
          const index=revision.words.findIndex((r,i)=>!used.has(i)&&r.text===word.text&&r.start===word.start&&r.end===word.end);
          if(index>=0){used.add(index);const r=revision.words[index];if(Object.hasOwn(r,'speaker'))word.speaker=r.speaker;else delete word.speaker;}
        }
      }
      ensureSpeaker(session,proposed.speaker_label);
      for(const word of proposed.words)ensureSpeaker(session,word.speaker);
      session.speakerProposals??=[];
      const proposal={turnOrder:raw.turn_order,live:structuredClone(raw),proposed,decision:'pending'};
      const prior=session.speakerProposals.findIndex(p=>p.turnOrder===raw.turn_order);
      if(prior<0)session.speakerProposals.push(proposal);else session.speakerProposals[prior]=proposal;
      // A late model prediction is not a verified correction. Preserve the live
      // conversation and request review of disagreements, rather than relabeling
      // named people and breaking up cards at the end of an interview.
      session.speakerReviews=(session.speakerReviews||[]).filter(r=>r.turnOrder!==raw.turn_order);
      const proposedParts=splitSpeech(proposed);
      if(before.every(t=>!t.speakerId&&t.speakerStatus!=='corrected')){
        Object.assign(raw,proposed);proposal.decision='resolved-unknown';
      }else for(const turn of before){
        if(turn.speakerStatus==='corrected')continue;
        if(proposedParts.some(p=>p.from<turn.sourceEnd&&p.to>turn.sourceStart&&p.label!==turn.speakerId))
          session.speakerReviews.push({turnOrder:raw.turn_order,from:turn.sourceStart,to:turn.sourceEnd});
      }
      const updates=replaceSpeechTurn(session,raw);
      // Review flags matter even when the editorial role was already Unassigned.
      const disputed=session.turns.filter(t=>t.providerTurnOrder===raw.turn_order&&t.speakerReviewRequired).map(t=>t.id);
      invalidateCues(session,new Set(disputed));changed.push(...new Set([...updates,...disputed]));
    }
  }
  return changed;
}

export function proposedSpeakerTurns(session,order){
  const proposal=session.speakerProposals?.find(p=>p.turnOrder===order);if(!proposal)return [];
  return buildTurns({...session,speakerOverrides:[],speakerReviews:[]},proposal.proposed);
}

export function acceptSpeakerRevision(session,order){
  const proposal=session.speakerProposals?.find(p=>p.turnOrder===order);
  const raw=session.speechTurns?.find(t=>t.turn_order===order);
  if(!proposal||!raw)throw new Error('No speaker update for this passage.');
  session.speakerReviews=(session.speakerReviews||[]).filter(r=>r.turnOrder!==order);
  Object.assign(raw,structuredClone(proposal.proposed));proposal.decision='accepted';
  return replaceSpeechTurn(session,raw);
}

export function setTurnSpeaker(session,turnId,speakerId){
  const turn=session.turns.find(t=>t.id===turnId);if(!turn)throw new Error('Unknown transcript passage.');
  if(speakerId!==null&&!session.speakers.some(p=>p.id===speakerId))throw new Error('Choose a detected person.');
  session.speakerOverrides??=[];
  session.speakerOverrides.push({turnOrder:turn.providerTurnOrder,from:turn.sourceStart,to:turn.sourceEnd,speakerId});
  const changed=replaceSpeechTurn(session,session.speechTurns.find(t=>t.turn_order===turn.providerTurnOrder));
  const proposal=session.speakerProposals?.find(p=>p.turnOrder===turn.providerTurnOrder);
  if(proposal&&!session.turns.some(t=>t.providerTurnOrder===turn.providerTurnOrder&&t.speakerReviewRequired))proposal.decision='manually-reviewed';
  return changed;
}

export function sampleTurn(session,raw,index){
  const speakerId=ensureSpeaker(session,raw.speaker==='Reporter'?'A':'B',raw.speaker);
  return {...normalizeTurn({...raw,speaker:roleOf(session,speakerId)},index),speakerId,speakerStatus:'scripted'};
}
export function quoteSpeakerFields(turn,ref){
  return {...(Object.hasOwn(turn,'speakerId')?{speakerId:turn.speakerId}:{}),
    ...(turn.speakerReviewRequired?{speakerReviewRequired:true}:{}),
    ...(turn.providerTurnOrder!==undefined?{providerTurnOrder:turn.providerTurnOrder,originalTurnId:turn.id,
      sourceStart:turn.sourceStart+ref.startChar,sourceEnd:turn.sourceStart+ref.endChar,providerSpeakerIdAtSave:turn.providerSpeakerId}:{})};
}
export function namedNotebook(session){
  const named=item=>({...item,speakerName:speakerDisplay(session,item)});
  return {...session,turns:session.turns.map(named),quotes:session.quotes.map(q=>({...named(q),
    ...(q.sourceParts?{sourceParts:q.sourceParts.map(named)}:{}),
    ...(q.context?{context:{...q.context,previousTurn:q.context.previousTurn?named(q.context.previousTurn):null}}:{})}))};
}
export function namedMarkdownNotes(session){
  const named=namedNotebook(session);
  const label=item=>item.speakerName+(item.speakerReviewRequired?' · speaker needs review':'');
  return markdownNotes({...named,cues:(named.cues||[]).map(cueForNotes),turns:groupSpeakerTurns(named.turns).map(t=>({...t,speaker:label(t)})),quotes:named.quotes.map(q=>({...q,speaker:label(q)}))});
}
