// Presentation of validated cues. Keep the frozen selector and evidence checks intact.
export const CUE_PRESENTATION_VERSION='questions-with-separate-reference-v1';
const QUESTIONS=Object.freeze({
  comparison:'What is the baseline, and how was the comparison measured?',
  date:'When exactly would that be?',
  definition:'What does that mean in practice?',
  evidence:'What evidence supports that claim?',
  example:'Can you walk me through a specific example?',
  reconcile:'How do you reconcile these two statements?',
  next_step:'What happens next, and who is responsible?',
  correction:'Which version should I use?'
});

export function presentCue(cue){
  if(!Object.hasOwn(QUESTIONS,cue.kind))throw new Error('Unknown follow-up category.');
  return {...cue,question:QUESTIONS[cue.kind],presentationVersion:CUE_PRESENTATION_VERSION};
}

export const evidenceTurnIds=e=>e.sourceParts?.length?e.sourceParts.map(p=>p.turnId):[e.turnId];

// Question wording can change independently of the supported topic. Never merge
// distinct topics merely because their question template is the same.
export function sameCue(a,b){
  return a.id===b.id||(a.kind===b.kind&&a.focus===b.focus&&
    a.evidence.some(x=>b.evidence.some(y=>evidenceTurnIds(x).some(id=>evidenceTurnIds(y).includes(id)))));
}

export function cueForNotes(cue){
  return cue.focus?{...cue,question:`${cue.question} (Regarding: “${cue.focus}”)`}:cue;
}
