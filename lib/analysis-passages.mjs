// Analyze the same contiguous speaker passages shown in the transcript, while
// retaining exact original segment references for every accepted quotation.
import {groupSpeakerTurns,resolveSpeakerExcerpt} from './speakers.mjs';
import {validateCandidates} from './evidence.mjs';
import {evidenceTurnIds} from './cues.mjs';

export const ANALYSIS_CONTEXT_VERSION='speaker-passages-v1';

export function analysisPassages(turns){
  const passages=[];
  for(const group of groupSpeakerTurns(turns.filter(t=>!t.provisional))){
    let batch=[],length=0;
    const flush=()=>{if(batch.length)passages.push(...groupSpeakerTurns(batch));batch=[];length=0;};
    for(const {turn}of group.segments){
      if(length+turn.text.length+(batch.length?1:0)>6000)flush();
      length+=turn.text.length+(batch.length?1:0);batch.push(turn);
    }
    flush();
  }
  const result=[];let length=0;
  for(const group of passages.reverse()){
    if(result.length>=10||length+group.text.length>18000)break;
    length+=group.text.length;
    // A display card can contain disputed sections; it must never hide them
    // behind the first segment's role when used as model evidence.
    const roles=new Set(group.segments.map(s=>s.turn.speaker));
    result.unshift({...group,speaker:group.speakerReviewRequired||roles.size!==1?'Unassigned':group.speaker});
  }
  return result;
}

export function analysisRequest(session,passages=analysisPassages(session.turns)){
  const groupFor=id=>passages.find(g=>g.segments.some(s=>s.turn.id===id))?.id||id;
  return {
    // The model does not consume word timing. Resolve it locally from the
    // retained source when the response arrives; don't send duplicate words.
    turns:passages.map(({id,text,speaker,source,start,end,speakerReviewRequired})=>({id,text,speaker,source,start,end,speakerReviewRequired})),
    brief:session.brief,goals:session.goals,
    previousCues:(session.cues||[]).slice(-20).map(c=>({kind:c.kind,focus:c.focus,status:c.status,
      evidence:[...new Set(c.evidence.flatMap(e=>evidenceTurnIds(e).map(groupFor)))].map(turnId=>({turnId}))}))
  };
}

export function resolvePassageCues(payload,passages){
  const checked=validateCandidates(payload,passages),cues=[],rejected=[...checked.rejected];
  for(const cue of checked.cues){
    const evidence=cue.evidence.map(e=>resolveSpeakerExcerpt(passages.find(g=>g.id===e.turnId),e.quote));
    if(evidence.some(e=>!e||e.speaker!=='Source'||e.speakerReviewRequired)){
      rejected.push({reason:'source_passage_changed'});continue;
    }
    const id=`${cue.kind}:${evidence.flatMap(e=>(e.sourceParts||[e]).map(p=>`${p.turnId}:${p.startChar}`)).join(':')}`;
    cues.push({...cue,id,evidence});
  }
  return {cues,rejected};
}
