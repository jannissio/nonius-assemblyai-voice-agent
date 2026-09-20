export const CUE_TYPES = Object.freeze({
  comparison: { label: 'Clarify the comparison', question: 'What is the baseline for that comparison, and how was it measured?' },
  date: { label: 'Pin down the date', question: 'What exact date or period are you referring to?' },
  definition: { label: 'Clarify the meaning', question: 'What do you mean by that, specifically?' },
  evidence: { label: 'Ask for the source', question: 'Which document, data or first-hand observation supports that claim?' },
  example: { label: 'Ask for an example', question: 'Could you give a specific example?' },
  reconcile: { label: 'Reconcile the statements', question: 'How do these two statements fit together?' },
  next_step: { label: 'Follow the next step', question: 'What happens next, and who is responsible?' },
  correction: { label: 'Confirm the correction', question: 'Which version should I record as your correction?' }
});

export function normalizeTurn(raw, index = 0) {
  if (!raw || typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 6000) throw new Error('Invalid transcript turn.');
  const id = typeof raw.id === 'string' && /^[\w-]{1,80}$/.test(raw.id) ? raw.id : `turn-${index}`;
  const start = Number.isFinite(raw.start) && raw.start >= 0 ? raw.start : 0;
  const end = Number.isFinite(raw.end) && raw.end >= start ? raw.end : start;
  const words = Array.isArray(raw.words) ? raw.words.slice(0,1200).filter(w =>
    typeof w.text === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= start && w.end >= w.start && w.end <= end + 200
  ).map(w => ({ text: w.text.slice(0,150), start: w.start, end: w.end,
    ...(Number.isFinite(w.confidence) ? { confidence: Math.max(0,Math.min(1,w.confidence)) } : {}) })) : [];
  return { id, text: raw.text, start, end, speaker: String(raw.speaker || 'Source').slice(0,60), words,
    source: ['assemblyai','sample','typed'].includes(raw.source) ? raw.source : 'typed' };
}

/** Verify a literal excerpt, then derive timing from the original recognized words.
 * A valid excerpt proves textual membership, not truth or faithful ASR. */
export function resolveEvidence(turns, ref) {
  if (!ref || typeof ref.turn_id !== 'string' || typeof ref.quote !== 'string') return null;
  const turn = turns.find(t => t.id === ref.turn_id);
  const quote = ref.quote;
  if (!turn || quote.trim().length < 4 || quote.length > 500) return null;
  const startChar = turn.text.indexOf(quote);
  if (startChar < 0 || turn.text.indexOf(quote,startChar+1) >= 0) return null;
  const endChar = startChar + quote.length;
  let cursor=0, aligned=[];
  for (const word of turn.words || []) {
    const position = turn.text.indexOf(word.text,cursor);
    if(position < 0) { aligned=[]; break; }
    aligned.push({...word, startChar:position, endChar:position+word.text.length});
    cursor=position+word.text.length;
  }
  const overlapping = aligned.filter(w=>w.endChar>startChar && w.startChar<endChar);
  return { turnId:turn.id, quote, startChar, endChar, speaker:turn.speaker,
    start:overlapping[0]?.start ?? turn.start,
    end:overlapping.at(-1)?.end ?? turn.end,
    alignment:overlapping.length ? 'word' : 'turn',
    source:turn.source };
}

export function validateCandidates(payload, turns, {limit=3}={}) {
  const accepted=[], rejected=[];
  if (!payload || !Array.isArray(payload.cues)) return { cues:[], rejected:[{reason:'invalid_schema'}] };
  for (const raw of payload.cues.slice(0,12)) {
    if (!raw || !Object.hasOwn(CUE_TYPES,raw.kind)) { rejected.push({reason:'unknown_kind'}); continue; }
    const refs=Array.isArray(raw.evidence) ? raw.evidence.slice(0,3) : [];
    const evidence=refs.map(ref=>resolveEvidence(turns,ref));
    if (!refs.length || evidence.some(e=>!e)) { rejected.push({reason:'unsupported_excerpt'}); continue; }
    if(evidence.some(e=>e.speaker!=='Source')){rejected.push({reason:'source_role_required'});continue;}
    if (raw.kind==='reconcile' && (evidence.length<2 || new Set(evidence.map(e=>`${e.turnId}:${e.startChar}`)).size<2)) {
      rejected.push({reason:'reconcile_needs_two_excerpts'}); continue;
    }
    // The model selects a supported focus. It cannot author an asserted premise.
    const focus=typeof raw.focus==='string' ? raw.focus.trim() : '';
    if (!focus || focus.length>120 || !evidence.some(e=>e.quote.includes(focus))) { rejected.push({reason:'unsupported_focus'}); continue; }
    if (/[\r\n<>]/.test(focus)) { rejected.push({reason:'invalid_focus'}); continue; }
    const key=`${raw.kind}:${evidence.map(e=>`${e.turnId}:${e.startChar}`).join(':')}`;
    if (accepted.some(c=>c.id===key)) { rejected.push({reason:'duplicate'}); continue; }
    const template=CUE_TYPES[raw.kind];
    const question=raw.kind==='reconcile' ? template.question : `You mentioned “${focus}”. ${template.question}`;
    accepted.push({ id:key, kind:raw.kind, title:template.label, focus, question, evidence, status:'open' });
  }
  return { cues:accepted.slice(0,limit), rejected };
}

/** Conservative, visible offline fallback. It does not claim semantic coverage. */
export function ruleCandidates(turns) {
  const turn=turns.at(-1);
  if(!turn||turn.speaker!=='Source') return {cues:[]};
  const cues=[];
  const add=(kind,match)=>{if(match) cues.push({kind,focus:match[0],evidence:[{turn_id:turn.id,quote:turn.text}]});};
  add('correction',turn.text.match(/(?:sorry[, ]+|I mean\b|let me correct\b|correction\b).{0,65}/i));
  if(!/\b(compared (?:with|to)|baseline|versus|vs\.?|from \d{4}|than (?:in )?\d{4})\b/i.test(turn.text)) {
    add('comparison',turn.text.match(/(?:\d+(?:\.\d+)?\s*(?:%|percent)|(?:ten|twenty|thirty|forty|fifty) percent)\s*(?:more|less|faster|slower|higher|lower)?/i));
  }
  if(!/\b20\d\d\b/.test(turn.text)) add('date',turn.text.match(/\b(?:last|next)\s+(?:year|month|week|spring|summer|autumn|fall|winter)\b|\bsoon\b/i));
  add('evidence',turn.text.match(/\b(?:research shows|studies show|the data proves|everyone agrees|experts say)\b/i));
  return { cues:cues.slice(0,3) };
}

export function formatTime(ms=0) {
  const seconds=Math.max(0,Math.floor(ms/1000));
  return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
}

export function markdownNotes(session) {
  const line=s=>String(s??'').replace(/[\r\n]/g,' ');
  const content=[`# ${line(session.title || 'Interview notes')}`,'',
    `Mode: ${line(session.mode || 'unknown')}. Transcript excerpts are source claims, not independently verified facts.`,
    '', '## Interview brief', '', line(session.brief),'','## Saved excerpts',''];
  for(const q of session.quotes||[]) content.push(
    `> ${line(q.quote)}`,'',`${line(q.speaker)} · ${formatTime(q.start)}–${formatTime(q.end)} · ${q.audioChecked?'Reporter marked audio checked':'Audio not checked'} · ${line(q.turnId)}`,
    ...(q.note ? ['',`Reporter note: ${line(q.note)}`] : []),''
  );
  if(!session.quotes?.length) content.push('No excerpts saved.','');
  content.push('## Follow-ups','');
  for(const c of session.cues||[]) content.push(`- [${c.status==='asked'?'x':' '}] ${line(c.question)} (${line(c.status)})`);
  content.push('','## Transcript','');
  for(const t of session.turns||[]) content.push(`**${formatTime(t.start)} ${line(t.speaker)}**`,line(t.text),'');
  content.push('## Interpretation limits','','Exact excerpt checks establish membership in the transcript. They do not establish accurate speech recognition, speaker identity, source truth, or completeness. Reporter annotations are separate from original text.');
  return content.join('\n');
}
