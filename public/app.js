import {CUE_TYPES,normalizeTurn,validateCandidates,ruleCandidates,formatTime} from '/lib/evidence.mjs';
import {speakerName,speakerDisplay,updateSpeaker,applySpeakerEvent,setTurnSpeaker,acceptSpeakerRevision,proposedSpeakerTurns,sampleTurn,quoteSpeakerFields,namedNotebook,namedMarkdownNotes,groupSpeakerTurns,resolveSpeakerExcerpt,sameExcerpt,nextSpeechPreview,previewSpeakerTurns} from '/lib/speakers.mjs?v=20260920-followup-passages-4';
import {ANALYSIS_CONTEXT_VERSION,analysisPassages,analysisRequest,resolvePassageCues} from '/lib/analysis-passages.mjs?v=20260920-followup-passages-4';
import {presentCue,sameCue} from '/lib/cues.mjs';
import {pcmForPlayback,playbackReader} from '/file-playback.js?v=20260920-live-cards-2';
import {zipSync,strToU8} from '/vendor/fflate.mjs';

const $=selector=>document.querySelector(selector);
const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const button=(label,cls,action)=>{const b=node('button',cls,label);b.type='button';b.addEventListener('click',action);return b;};
const audio=$('#interview-audio');
const recordingMonitor=$('#recording-monitor');
const spokenAudio=$('#companion-audio');let speechRequest=0,speechUrl=null;
let config=null,session,analyzing=false,analysisQueued=false,stream=null,context=null,mic=null,worklet=null,
  pcmChunks=[],recording=false,commandMode=false,stopping=false,startedAt=0,ticker=null,fileTimer=null,
  audioBlob=null,audioUrl=null,playUntil=null,speaking=false,sampleData=null,samplePlaying=false,
  toastTimer=null,requestVersion=0,sessionGeneration=0,lastEngine='',commandHeard='',speechPreview=null,
  uploadPlayback=null,uploadUrl=null,stopTimeout=null;

function emptySession(){return {version:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),title:$('#interview-title').value,
  brief:$('#interview-brief').value,mode:'empty',turns:[],cues:[],quotes:[],events:[],speakers:[],speechTurns:[],speakerOverrides:[],
  goals:[]};}
session=emptySession();
function event(type,detail={}){session.events.push({at:new Date().toISOString(),type,...detail});}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
function notice(message,error=false){$('#notice').textContent=message;$('#notice').className=`notice${error?' error':''}`;$('#notice').hidden=!message;}
function status(text,kind=''){ $('#session-status').textContent=text;$('#status-dot').className=`status-dot ${kind}`;}
function askConfirmation(message){
  const dialog=$('#action-dialog');if(dialog.open)return Promise.resolve(false);
  $('#action-message').textContent=message;dialog.returnValue='';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='continue'),{once:true}));
}
function view(name){for(const el of document.querySelectorAll('.view'))el.hidden=el.id!==`view-${name}`;
  for(const el of document.querySelectorAll('[data-view]')){el.classList.toggle('active',el.dataset.view===name);if(el.dataset.view===name)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}
  if(name==='evidence')renderNotebook();}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));

function renderGoals(){
  const box=$('#goals-list');box.replaceChildren();
  for(const goal of session.goals){
    const row=node('div',`goal-row${goal.done?' done':''}`),label=node('label'),check=node('input');check.type='checkbox';check.checked=goal.done;
    check.addEventListener('change',()=>{goal.done=check.checked;requestVersion++;event('goal_marked',{text:goal.text,done:goal.done});renderGoals();});
    label.append(check,node('span','',goal.text));
    const remove=button('×','goal-remove',()=>{session.goals=session.goals.filter(g=>g!==goal);requestVersion++;event('goal_removed',{text:goal.text});renderGoals();});
    remove.setAttribute('aria-label',`Remove question: ${goal.text}`);remove.title='Remove question';row.append(label,remove);box.append(row);
  }
  $('#goals-progress').textContent=`${session.goals.filter(g=>g.done).length} / ${session.goals.length}`;
}
$('#goal-form').addEventListener('submit',e=>{e.preventDefault();const text=$('#new-goal').value.trim();if(!text)return;if(session.goals.length>=8)return toast('Keep up to eight questions in this interview.');session.goals.push({text,done:false});requestVersion++;$('#new-goal').value='';renderGoals();});
$('#interview-title').addEventListener('input',()=>session.title=$('#interview-title').value);
$('#interview-brief').addEventListener('input',()=>{session.brief=$('#interview-brief').value;requestVersion++;});

function controls(){
  $('#analyze').disabled=!session.turns.length||analyzing||commandMode;
  $('#speak-next').disabled=!session.cues.some(c=>c.status==='open');
  $('#ask-companion').disabled=!session.turns.length||recording||!config?.liveAvailable;
  $('#question-upload').disabled=$('#ask-companion').disabled;
  $('#record-start').disabled=recording||!config?.liveAvailable;
  $('#record-start').hidden=recording;$('#record-stop').hidden=!recording;
  $('#upload-button').disabled=recording||!config?.liveAvailable;
  $('#new-session').disabled=recording||analyzing;
  $('#quote-count').textContent=session.quotes.length;
  $('#cue-count').textContent=session.cues.filter(c=>c.status==='open').length;
}

function renderPeople(){
  const box=$('#people-list');
  for(const row of [...box.children])if(!session.speakers.some(p=>p.id===row.dataset.speakerId))row.remove();
  for(const person of session.speakers){
    let row=box.querySelector(`[data-speaker-id="${person.id}"]`);
    if(!row){
      row=node('div','person-row');row.dataset.speakerId=person.id;
      const badge=node('span','person-badge',person.id);badge.title=`Detected voice ${person.id}`;
      const name=node('input','person-name');name.type='text';name.maxLength=60;name.placeholder=`Person ${person.id}`;name.setAttribute('aria-label',`Name for Person ${person.id}`);
      name.addEventListener('input',()=>{
        try{updateSpeaker(session,person.id,{name:name.value});renderTurns();if(!$('#view-evidence').hidden)renderNotebook();}catch(e){toast(e.message);}
      });
      name.addEventListener('change',()=>event('speaker_named',{speakerId:person.id,name:person.name}));
      const role=node('select','person-role');role.setAttribute('aria-label',`Role for Person ${person.id}`);
      for(const [value,label]of [['Unassigned','Choose role…'],['Reporter','Reporter (interviewer)'],['Source','Interviewee']]){const option=node('option','',label);option.value=value;role.append(option);}
      role.addEventListener('change',()=>{
        const before=person.role,changed=updateSpeaker(session,person.id,{role:role.value});if(changed.length)requestVersion++;
        event('speaker_role_assigned',{speakerId:person.id,before,role:person.role});renderTurns();renderCues();renderNotebook();
        if($('#auto-analyze').checked&&session.turns.at(-1)?.speaker==='Source')void analyze();
      });
      row.append(badge,name,role);box.append(row);
    }
    const name=row.querySelector('input'),role=row.querySelector('select');
    if(document.activeElement!==name)name.value=person.name;
    if(document.activeElement!==role)role.value=person.role;
  }
  const count=session.speakers.length;
  $('#people-count').textContent=count?`${count} ${count===1?'person':'people'}${session.mode==='sample'?' · scripted sample':''}`:'Voices appear here when someone speaks.';
}

function speakerCorrection(turns,label){
  const correction=node('select');correction.setAttribute('aria-label',label);
  correction.title=turns.length>1?'Changes the speaker for this whole passage.':'Changes the speaker for this segment.';
  const placeholder=node('option','','Change speaker…');placeholder.value='';placeholder.disabled=true;placeholder.selected=true;correction.append(placeholder);
  for(const person of session.speakers){const option=node('option','',speakerName(session,person.id));option.value=person.id;correction.append(option);}
  const unknown=node('option','','Speaker unclear');unknown.value='unknown';correction.append(unknown);
  correction.addEventListener('change',()=>{
    const speakerId=correction.value==='unknown'?null:correction.value;
    for(const turn of turns){setTurnSpeaker(session,turn.id,speakerId);event('speaker_corrected',{turnId:turn.id,before:turn.speakerId,speakerId});}
    requestVersion++;renderTurns();renderCues();renderNotebook();
  });
  return correction;
}

function renderTurns(){
  renderPeople();
  if($('#notice').textContent.startsWith('The final voice check disagrees')&&!session.turns.some(t=>t.speakerReviewRequired))notice('Speaker labels confirmed.');
  if(!session.turns.length){renderLivePreview();return;}
  const box=$('#transcript');const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<90;box.replaceChildren();
  for(const turn of groupSpeakerTurns(session.turns)){
    const el=node('article',`turn ${turn.speaker==='Reporter'?'reporter':'source'}`);el.id=`passage-${turn.id}`;el.dataset.speakerId=turn.speakerId||'';
    const meta=node('div','turn-meta');meta.append(node('span','turn-speaker',speakerDisplay(session,turn)),node('span','turn-time',formatTime(turn.start)));
    if(turn.speakerStatus==='mixed')meta.append(node('span','turn-typed','Mixed speakers · review'));
    if(turn.speakerReviewRequired)meta.append(node('span','speaker-review','Check speaker'));
    if(turn.speakerStatus==='corrected')meta.append(node('span','turn-typed','Speaker corrected by you'));
    if(turn.source==='typed')meta.append(node('span','turn-typed','Typed · no audio'));
    const text=node('p','turn-text');
    for(const [index,segment]of turn.segments.entries()){
      if(index)text.append(document.createTextNode(' '));
      const span=node('span','transcript-segment',segment.turn.text);span.id=`transcript-${segment.turn.id}`;text.append(span);
    }
    el.append(meta,text);const tools=node('div','turn-tools');
    const listen=button('Listen to passage','text-button',()=>playPassage(turn.start,turn.end,turn.id));listen.disabled=!audioBlob||turn.source==='typed';
    tools.append(listen,button('Save excerpt','text-button',()=>saveQuote(turn)));
    if(turn.source==='assemblyai'){
      tools.append(speakerCorrection(turn.segments.map(s=>s.turn),`Correct speaker for passage at ${formatTime(turn.start)}`));
    }
    el.append(tools);
    if(turn.speakerReviewRequired){
      const review=node('details','speaker-update-review');review.append(node('summary','','Review speaker update'));
      review.append(node('p','','The final voice check disagrees with the live labels. The live labels stay in place until you review them.'));
      review.append(button(`Keep ${speakerName(session,turn.speakerId)} for this passage`,'secondary',()=>{
        for(const {turn:part}of turn.segments)setTurnSpeaker(session,part.id,part.speakerId);
        requestVersion++;event('live_speaker_confirmed',{turnIds:turn.segments.map(s=>s.turn.id)});renderTurns();renderCues();renderNotebook();
      }));
      const orders=[...new Set(turn.segments.filter(s=>s.turn.speakerReviewRequired).map(s=>s.turn.providerTurnOrder))];
      for(const order of orders){
        const proposed=proposedSpeakerTurns(session,order);if(!proposed.length)continue;
        const section=node('div','proposed-speakers');
        section.append(node('p','',`Proposed labels for the section at ${formatTime(proposed[0].start)}:`));
        for(const part of proposed)section.append(node('p','',`${speakerName(session,part.speakerId)}: ${part.text}`));
        section.append(button('Use these labels for this section','text-button',()=>{
          acceptSpeakerRevision(session,order);requestVersion++;event('speaker_revision_accepted',{turnOrder:order});renderTurns();renderCues();renderNotebook();
        }));review.append(section);
      }
      el.append(review);
    }
    if(turn.source==='assemblyai'&&turn.segments.length>1){
      const details=node('details','segment-corrections');details.append(node('summary','','Correct part of this passage'));
      for(const {turn:part}of turn.segments){
        const row=node('div','segment-correction');
        row.append(node('span','turn-time',formatTime(part.start)),node('p','',part.text),
          speakerCorrection([part],`Correct speaker for segment at ${formatTime(part.start)}`));details.append(row);
      }
      el.append(details);
    }
    box.append(el);
  }
  if(nearBottom)box.scrollTop=box.scrollHeight;
  renderLivePreview();
  controls();
}

function renderLivePreview(){
  const box=$('#transcript'),nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<90;
  box.querySelectorAll('.provisional-turn,.live-preview,.live-preview-space,.live-badge').forEach(el=>el.remove());
  const previews=previewSpeakerTurns(session,speechPreview);
  if(previews.length){box.querySelector('.welcome')?.remove();renderPeople();}
  for(const turn of groupSpeakerTurns(previews)){
    let card=box.lastElementChild;
    if(!turn.speakerId||!card?.classList.contains('turn')||card.dataset.speakerId!==turn.speakerId){
      card=node('article','turn source provisional-turn');card.dataset.speakerId=turn.speakerId||'';
      const meta=node('div','turn-meta');meta.append(node('span','turn-speaker',turn.speakerId?speakerDisplay(session,turn):'Identifying speaker…'),node('span','turn-time',formatTime(turn.start)));
      card.append(meta,node('p','turn-text'));box.append(card);
    }
    if(!card.querySelector('.live-badge'))card.querySelector('.turn-meta').append(node('span','live-badge',recording?'Live · updating':'Unconfirmed · not saved'));
    const text=card.querySelector('.turn-text');if(text.textContent)text.append(node('span','live-preview-space',' '));
    text.append(node('span','live-preview',turn.text));
  }
  if(nearBottom)box.scrollTop=box.scrollHeight;
}

function saveQuote(turn,quoteText){
  let text=quoteText;const selected=window.getSelection();
  const passage=$(`#passage-${CSS.escape(turn.id)} .turn-text`);
  if(selected?.rangeCount&&passage?.querySelector('.live-preview')&&selected.getRangeAt(0).intersectsNode(passage.querySelector('.live-preview')))
    return toast('Wait for the live words to settle before saving that excerpt.');
  if(!text&&selected?.toString().trim()&&passage?.contains(selected.anchorNode)&&passage.contains(selected.focusNode))text=selected.toString().trim();
  text=text||turn.text;
  const ref=resolveSpeakerExcerpt(turn,text);
  if(!ref)return toast('Select a unique excerpt of 4–500 characters from this passage.');
  if(session.quotes.some(q=>sameExcerpt(q,ref)))return toast('That excerpt is already in your notebook.');
  const position=session.turns.findIndex(t=>t.id===turn.id);const previous=session.turns[position-1];
  session.quotes.push({...ref,id:crypto.randomUUID(),audioChecked:false,note:'',savedAt:new Date().toISOString(),
    context:{turnText:turn.text,previousTurn:previous?{id:previous.id,speaker:previous.speaker,...quoteSpeakerFields(previous,{startChar:0,endChar:previous.text.length}),text:previous.text}:null}});
  event('excerpt_saved',{turnId:ref.turnId,startChar:ref.startChar,endChar:ref.endChar});controls();toast('Excerpt saved. Check its audio in the evidence notebook.');
}

function addCues(cues,engine){
  let added=0;
  for(const raw of cues){const cue=presentCue(raw),existing=session.cues.find(c=>sameCue(c,cue));
    if(!existing){session.cues.push({...cue,engine,createdAt:new Date().toISOString()});added++;}
    else event('duplicate_cue_suppressed',{id:cue.id,existingId:existing.id});}
  lastEngine=engine;renderCues();controls();return added;
}
function renderCues(){const box=$('#cue-list');box.replaceChildren();
  if(!session.cues.length){const empty=node('div','empty-cues');empty.append(node('span','','“'),node('p','','No follow-up to show yet.'),node('small','','A quiet companion can be useful, too.'));box.append(empty);return;}
  const sorted=[...session.cues].sort((a,b)=>(a.status==='open'?0:1)-(b.status==='open'?0:1));
  for(const cue of sorted){const card=node('article',`cue ${cue.status}`);
    const topic=node('p','cue-topic');topic.append(node('span','cue-topic-label','Regarding '),node('q','',cue.focus));
    card.append(node('div','cue-label',cue.status==='open'?cue.title:`${cue.status} · ${cue.title}`),topic,node('p','cue-question',cue.question));
    for(const evidence of cue.evidence){const b=button(`${formatTime(evidence.start)}  “${evidence.quote}”`,'cue-evidence',()=>{view('interview');const turn=$(`#transcript-${CSS.escape(evidence.turnId)}`);turn?.scrollIntoView({behavior:'smooth',block:'nearest'});highlight(evidence.turnId);});b.title='Show this evidence in the transcript';card.append(b);}
    const actions=node('div','cue-tools');actions.append(button('Read aloud','text-button',()=>speak(cue.question)));
    if(cue.status==='open')actions.append(button('Asked','text-button',()=>{cue.status='asked';requestVersion++;event('cue_asked',{id:cue.id});renderCues();controls();}),button('Dismiss','text-button',()=>{cue.status='dismissed';requestVersion++;event('cue_dismissed',{id:cue.id});renderCues();controls();}));
    else actions.append(button('Reopen','text-button',()=>{cue.status='open';requestVersion++;renderCues();controls();}));card.append(actions);box.append(card);
  }
}

async function analyze(){
  if(!session.turns.length)return;
  const passages=analysisPassages(session.turns),latest=passages.at(-1);
  if(!latest)return;
  if(latest.speakerReviewRequired){$('#analysis-status').textContent='Part of this answer needs a speaker check. Open Review speaker update on the answer, then confirm the person before looking for a follow-up.';return;}
  if(latest.speaker!=='Source'){$('#analysis-status').textContent=latest.speaker==='Reporter'?'The latest passage is from the reporter. Wait for an interviewee’s answer.':latest.speakerId?'Choose Interviewee for the latest speaker under People before requesting a follow-up.':'The latest speaker is unclear. Use Change speaker on that passage and choose the person’s role under People.';return;}
  if(analyzing){analysisQueued=true;return;}
  analyzing=true;const generation=sessionGeneration,version=++requestVersion;controls();$('#analysis-status').textContent='Looking for a useful follow-up in the interviewee’s answer…';
  try{
    if(session.mode==='sample'){
      const turn=session.turns.at(-1);
      const cached=sampleData?.analyses?.find(x=>x.afterTurnId===turn.id);
      if(cached?.error){$('#analysis-status').textContent='The recorded model response at this point failed its format check. Your transcript remains available.';return;}
      const result=cached ? validateCandidates(cached.raw,session.turns) : validateCandidates(ruleCandidates(session.turns),session.turns);
      addCues(result.cues,cached?'Recorded sample analysis':'Sample · local checks');
      $('#analysis-status').textContent=cached?'Recorded analysis of this sample. No new API call.':'Sample uses local checks. No API credits spent.';
    }else{
      const response=await fetch('/api/analyze',{method:'POST',headers:{'content-type':'application/json','x-nonius-client':'interview-desk'},
        body:JSON.stringify(analysisRequest(session,passages))});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Analysis failed.');
      if(generation!==sessionGeneration||version!==requestVersion){if(generation===sessionGeneration)$('#analysis-status').textContent='The interview context changed during analysis. Look for a follow-up again when ready.';return;}
      // Validate again against the current transcript, since revisions may arrive during a request.
      const rechecked=resolvePassageCues({cues:data.cues.map(c=>({kind:c.kind,focus:c.focus,evidence:c.evidence.map(e=>({turn_id:e.turnId,quote:e.quote}))}))},analysisPassages(session.turns));
      const added=addCues(rechecked.cues,data.engine),rejectedCount=(data.rejected?.length||0)+rechecked.rejected.length;
      event('analysis',{engine:data.engine,promptVersion:data.promptVersion,contextVersion:ANALYSIS_CONTEXT_VERSION,
        passageIds:passages.map(p=>p.id),targetPassageId:latest.id,targetCharacters:latest.text.length,
        outcome:data.outcome,elapsedMs:data.elapsedMs,rejectedCount,added});
      $('#analysis-status').textContent=added?`${data.engine} · ${data.elapsedMs?`${(data.elapsedMs/1000).toFixed(1)} s`:'local'} · excerpts checked`:
        rejectedCount?'No new card passed the source-evidence checks. Your transcript is still available.':
        (data.suppressedCount||rechecked.cues.length)?'That follow-up is already in your cards. Continue the conversation.':
        data.outcome==='needs_source'?'Choose Interviewee for the speaker, then wait for an answer.':
        data.outcome==='needs_speaker_review'?'Review the latest passage’s speaker before requesting a follow-up.':
        'The model returned no suggestion for this answer. This does not mean every question is answered; your brief and covered questions influence the result.';
      if(!session.cues.length&&data.outcome==='abstained'){
        $('#cue-list .empty-cues p').textContent='The model did not select a question.';
        $('#cue-list .empty-cues small').textContent='Add what you still want to learn to the interview brief, or keep listening.';
      }
      if(data.budget)renderBudget(data.budget);
    }
  }catch(error){if(generation===sessionGeneration&&version===requestVersion){const fallback=validateCandidates(ruleCandidates(session.turns),session.turns);addCues(fallback.cues,'Local fallback');$('#analysis-status').textContent=`${error.message} Local checks remain available.`;event('analysis_error',{message:error.message});}}
  finally{analyzing=false;controls();if(analysisQueued){analysisQueued=false;void analyze();}}
}
$('#analyze').addEventListener('click',()=>void analyze());
$('#speak-next').addEventListener('click',()=>{const cue=session.cues.find(c=>c.status==='open');if(cue)speak(cue.question);});

async function speak(text){
  const request=++speechRequest;spokenAudio.pause();audio.pause();window.speechSynthesis?.cancel();speaking=false;
  if(config?.localSpeechAvailable){
    $('#analysis-status').textContent='Preparing the spoken suggestion…';
    try{
      const response=await fetch('/api/speak',{method:'POST',headers:{'content-type':'application/json','x-nonius-client':'interview-desk'},body:JSON.stringify({text})});
      if(!response.ok)throw new Error('Local speech could not start.');const blob=await response.blob();if(request!==speechRequest)return;
      if(speechUrl)URL.revokeObjectURL(speechUrl);speechUrl=URL.createObjectURL(blob);spokenAudio.src=speechUrl;
      spokenAudio.onplaying=()=>{speaking=true;$('#analysis-status').textContent='Nonius is speaking. Microphone audio is muted while it speaks.';event('speech_started',{engine:'Windows local speech'});};
      spokenAudio.onended=()=>{speaking=false;$('#analysis-status').textContent='The reporter decides whether to ask this question.';event('speech_ended',{engine:'Windows local speech'});};
      spokenAudio.onerror=()=>{speaking=false;toast('Spoken output could not play. The text remains available.');};
      event('speech_requested',{text,engine:'Windows local speech'});await spokenAudio.play();return;
    }catch{if(request!==speechRequest)return;/* A browser engine may still be available. */}
  }
  if(!('speechSynthesis'in window))return toast('Spoken output is unavailable in this browser. The suggestion is shown as text.');
  speechSynthesis.cancel();audio.pause();
  const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-GB';utterance.rate=1;
  const voices=speechSynthesis.getVoices();const voice=voices.find(v=>v.lang==='en-GB'&&v.localService)||voices.find(v=>v.lang.startsWith('en')&&v.localService)||voices.find(v=>v.lang.startsWith('en'));
  if(voice)utterance.voice=voice;
  utterance.onstart=()=>{speaking=true;$('#analysis-status').textContent='Nonius is speaking. Microphone audio is muted while it speaks.';};
  const done=()=>{speaking=false;$('#analysis-status').textContent='The reporter decides whether to ask this question.';};
  utterance.onend=done;utterance.onerror=()=>{done();toast('Spoken output could not play. The text remains available.');};
  event('speech_requested',{text,voice:voice?.name||'browser default'});speechSynthesis.speak(utterance);
}
function answerCommand(text){
  event('companion_question',{text});
  let answer;
  if(/\b(quote|excerpt)\b/i.test(text)){
    const quote=session.quotes.at(-1);answer=quote?`Your last saved excerpt says: ${quote.quote}. ${quote.audioChecked?'You marked its audio checked.':'Its audio has not been checked.'}`:'There is no saved excerpt yet. Save a passage from the transcript first.';
  }else if(/\b(uncovered|cover|miss|remaining|agenda)\b/i.test(text)){
    const goals=session.goals.filter(g=>!g.done);answer=goals.length?`Your checklist still has ${goals.length} open ${goals.length===1?'question':'questions'}. ${goals[0].text}`:'You have marked every question in the brief covered.';
  }else if(/\b(next|ask|question|follow.?up|suggest)\b/i.test(text)){
    const cue=session.cues.find(c=>c.status==='open');answer=cue?`A possible follow-up is: ${cue.question}`:'I do not have a supported follow-up yet. Keep listening, or select Look for a follow-up.';
  }else answer='I can read the next follow-up, read your last saved excerpt, or tell you which questions remain open.';
  notice(`You asked: “${text}” Nonius: ${answer}`);speak(answer);
}

function highlight(id){document.querySelectorAll('.turn.highlight').forEach(e=>e.classList.remove('highlight'));if(id)$(`#transcript-${CSS.escape(id)}`)?.closest('.turn')?.classList.add('highlight');}
async function playPassage(start,end,id){
  if(!audioBlob)return toast('No audio is attached to this turn.');
  if(recording)return toast('End the interview before replaying its audio.');
  speechRequest++;spokenAudio.pause();window.speechSynthesis?.cancel();speaking=false;samplePlaying=false;audio.currentTime=Math.max(0,start/1000-.18);playUntil=end/1000+.2;highlight(id);
  try{await audio.play();event('audio_play_requested',{turnId:id,start,end});}catch{toast('Audio playback was blocked. Try the play button again.');}
}
audio.addEventListener('timeupdate',()=>{
  $('#session-clock').textContent=formatTime(audio.currentTime*1000);
  if(playUntil!==null&&audio.currentTime>=playUntil){audio.pause();playUntil=null;}
  if(samplePlaying&&sampleData){const available=sampleData.turns.filter(t=>t.end<=audio.currentTime*1000);if(available.length>session.turns.length){for(const t of available.slice(session.turns.length)){session.turns.push(sampleTurn(session,t,session.turns.length));}renderTurns();if($('#auto-analyze').checked)void analyze();}}
  const current=session.turns.find(t=>audio.currentTime*1000>=t.start&&audio.currentTime*1000<=t.end);if(current)highlight(current.id);
});
audio.addEventListener('ended',()=>{samplePlaying=false;$('#sample-play').textContent='Replay sample audio';if(session.mode==='sample')status('Sample complete','sample');});

function setAudio(blob){if(audioUrl)URL.revokeObjectURL(audioUrl);audioBlob=blob;audioUrl=URL.createObjectURL(blob);audio.src=audioUrl;}
function wavBlob(chunks){const samples=chunks.reduce((n,b)=>n+b.byteLength,0);const bytes=new Uint8Array(44+samples);const d=new DataView(bytes.buffer);const write=(offset,s)=>{for(let i=0;i<s.length;i++)d.setUint8(offset+i,s.charCodeAt(i));};
  write(0,'RIFF');d.setUint32(4,36+samples,true);write(8,'WAVE');write(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,16000,true);d.setUint32(28,32000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);write(36,'data');d.setUint32(40,samples,true);let pos=44;for(const chunk of chunks){bytes.set(new Uint8Array(chunk),pos);pos+=chunk.byteLength;}return new Blob([bytes],{type:'audio/wav'});}

async function loadSample(){
  if(recording)return toast('End the current interview first.');
  if(session.turns.length&&!await askConfirmation('Replace the current notebook with the fictional sample? Download your notes first if needed.'))return;
  await resetSession(false);
  try{
    sampleData=await fetch('/fixtures/demo.json').then(r=>{if(!r.ok)throw new Error('Sample is unavailable.');return r.json();});
    session.mode='sample';session.title=sampleData.title;session.brief=sampleData.brief;$('#interview-title').value=session.title;$('#interview-brief').value=session.brief;
    session.goals=sampleData.goals.map(text=>({text,done:false}));renderGoals();
    if(sampleData.audio){const response=await fetch(sampleData.audio);if(response.ok)setAudio(await response.blob());}
    $('#mode-label').textContent='Fictional sample';$('#sample-play').hidden=!audioBlob;$('#sample-all').hidden=false;
    // Start with the first completed exchange so the workflow is immediately inspectable.
    session.turns=sampleData.turns.slice(0,2).map((t,i)=>sampleTurn(session,t,i));renderTurns();status('Sample interview','sample');
    notice('Fictional sample with synthetic audio and scripted speaker assignments. Rename its people to try the controls. Suggestions use recorded analysis or local checks; no API credits are spent.');
    event('sample_loaded',{fixture:sampleData.id});await analyze();
  }catch(e){notice(e.message,true);}
}
$('#sample-start').addEventListener('click',()=>void loadSample());
$('#sample-all').addEventListener('click',()=>{if(!sampleData)return;audio.pause();samplePlaying=false;session.turns=sampleData.turns.map((t,i)=>sampleTurn(session,t,i));renderTurns();
  for(const analysis of sampleData.analyses||[]){const cutoff=sampleData.turns.findIndex(t=>t.id===analysis.afterTurnId);const valid=validateCandidates(analysis.raw,session.turns.slice(0,cutoff+1));addCues(valid.cues,'Recorded sample analysis');}
  if(!sampleData.analyses?.length)for(let i=0;i<session.turns.length;i++)addCues(validateCandidates(ruleCandidates(session.turns.slice(0,i+1)),session.turns.slice(0,i+1)).cues,'Sample · local checks');
  status('Sample complete','sample');$('#analysis-status').textContent=sampleData.analyses?.some(a=>a.error)?'One recorded response failed its format check. Review the remaining suggestions; some may now be answered.':'Review these suggestions against the full conversation. Some may now be answered.';
});
$('#sample-play').addEventListener('click',async()=>{if(!audioBlob)return;
  if(!audio.paused){audio.pause();samplePlaying=false;$('#sample-play').textContent='Resume sample audio';return;}
  playUntil=null;samplePlaying=true;if(audio.ended)audio.currentTime=0;
  try{await audio.play();$('#sample-play').textContent='Pause sample audio';status('Playing sample','sample');}catch{toast('Audio could not play. Try again.');}});

async function resetSession(confirm=true,{keepGoals=false}={}){
  if(recording)return false;
  if(confirm&&(session.turns.length||speechPreview)&&!await askConfirmation('Clear this browser notebook? Download your interview bundle first to keep a copy.'))return false;
  sessionGeneration++;requestVersion++;analysisQueued=false;audio.pause();audio.removeAttribute('src');audio.load();if(audioUrl)URL.revokeObjectURL(audioUrl);
  const goals=keepGoals?session.goals.map(g=>({...g,done:false})):[];
  audioBlob=null;audioUrl=null;pcmChunks=[];sampleData=null;samplePlaying=false;playUntil=null;speechPreview=null;session=emptySession();session.goals=goals;
  if('speechSynthesis'in window)speechSynthesis.cancel();speaking=false;
  speechRequest++;spokenAudio.pause();if(speechUrl)URL.revokeObjectURL(speechUrl);speechUrl=null;spokenAudio.removeAttribute('src');
  const empty=node('div','welcome');empty.append(node('h2','','Ready for your next interview'),node('p','','Start the microphone, use a recording, or explore the fictional sample.'),button('Explore a sample interview','primary',()=>void loadSample()));$('#transcript').replaceChildren(empty);
  $('#sample-play').hidden=true;$('#sample-all').hidden=true;$('#mode-label').textContent='Nothing recorded';$('#session-clock').textContent='00:00';$('#interim').hidden=true;
  notice('');status('Ready when you are');lastEngine='';$('#analysis-status').textContent='You stay in control of the conversation.';renderPeople();renderGoals();renderCues();controls();return true;
}
$('#new-session').addEventListener('click',()=>void resetSession());

async function cleanupCapture(){
  clearInterval(ticker);clearInterval(fileTimer);fileTimer=null;
  uploadPlayback=null;recordingMonitor.onended=null;recordingMonitor.pause();recordingMonitor.removeAttribute('src');recordingMonitor.load();
  if(uploadUrl)URL.revokeObjectURL(uploadUrl);uploadUrl=null;$('#resume-recording').hidden=true;
  if(worklet){worklet.port.onmessage=null;worklet.disconnect();worklet=null;}
  if(mic){mic.getTracks().forEach(t=>t.stop());mic=null;}
  if(context){const closing=context;context=null;await closing.close().catch(()=>{});}
}
async function finishCapture(connection=stream){
  if(!recording||connection!==stream)return;const wasCommand=commandMode;stopping=true;await cleanupCapture();
  if(connection!==stream)return;recording=false;commandMode=false;stopping=false;
  clearTimeout(stopTimeout);stopTimeout=null;
  $('#interim').hidden=true;if(!wasCommand&&pcmChunks.length)setAudio(wavBlob(pcmChunks));
  status(wasCommand?'Interview paused':'Interview ended');$('#recording-hint').textContent='Your notebook stays here until you clear it or close the page.';
  renderTurns();controls();void refreshConfig();
  if(wasCommand&&commandHeard)answerCommand(commandHeard);
  else if(wasCommand)notice('No question was recognized. You can still read suggestions aloud with the button.');
}
function acceptPCM(buffer){
  if(!recording||stopping||stream?.readyState!==WebSocket.OPEN)return;
  const send=speaking&&!uploadPlayback?new ArrayBuffer(buffer.byteLength):buffer;
  if(!commandMode)pcmChunks.push(send.slice(0));
  if(stream.bufferedAmount>1000000){notice('Audio connection is falling behind. Ending the recording to preserve your notes.',true);void stopCapture();return;}
  stream.send(send);
}

async function startCapture({command=false,file=null}={}){
  if(recording)return;
  if(!command&&(session.turns.length||speechPreview)){if(!await resetSession(true,{keepGoals:true}))return;}
  audio.pause();if('speechSynthesis'in window)speechSynthesis.cancel();speaking=false;
  speechRequest++;spokenAudio.pause();
  if(!command){session.mode=file?'recording':'microphone';session.createdAt=new Date().toISOString();pcmChunks=[];speechPreview=null;$('#mode-label').textContent=file?'Recording via AssemblyAI':'AssemblyAI live';}
  commandMode=command;commandHeard='';stopping=false;recording=true;startedAt=Date.now();controls();status(command?'Listening to your question':'Connecting to AssemblyAI…','live');notice('');
  $('#recording-hint').textContent=command?'Try “What should I ask next?”, “Read my last quote”, or “What remains uncovered?”':'Recording and cloud transcription are active.';
  const connection=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/stream${command?'?purpose=question':''}`);stream=connection;
  connection.addEventListener('error',()=>{if(connection===stream)notice('Could not connect to AssemblyAI. Check the credit controls or try the sample.',true);});
  connection.addEventListener('close',()=>void finishCapture(connection));
  connection.addEventListener('message',async message=>{
    if(connection!==stream)return;
    let data;try{data=JSON.parse(message.data);}catch{return;}
    if(data.type==='Begin'&&!stopping){
      event('speech_session_started',{providerSessionId:data.id,command,configuration:data.configuration||null});
      try{
        if(file)await streamFile(file,connection);
        else{
          mic=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
          if(!recording||stopping||connection!==stream){mic.getTracks().forEach(t=>t.stop());mic=null;return;}
          context=new AudioContext();await context.audioWorklet.addModule('/audio-worklet.js');await context.resume();
          worklet=new AudioWorkletNode(context,'pcm-recorder');worklet.port.onmessage=e=>acceptPCM(e.data);
          const source=context.createMediaStreamSource(mic);source.connect(worklet);
          const silence=context.createGain();silence.gain.value=0;worklet.connect(silence);silence.connect(context.destination);
        }
        if(!recording||stopping||connection!==stream)return;
        if(file)updateRecordingPlaybackStatus();else status(command?'Ask Nonius a question':'Interview in progress','live');
        ticker=setInterval(()=>$('#session-clock').textContent=formatTime(uploadPlayback?recordingMonitor.currentTime*1000:Date.now()-startedAt),500);
      }catch(e){notice(e.name==='NotAllowedError'?'Microphone permission was not granted. Use a WAV recording or the sample.':`Audio could not start: ${e.message}`,true);void stopCapture();}
    }
    if(data.type==='Turn'){
      if(!command){
        speechPreview=nextSpeechPreview(session,speechPreview,data);$('#interim').hidden=true;
        if(!data.end_of_turn){try{renderLivePreview();}catch{notice('Live text could not be displayed yet. Waiting for the completed segment.',true);}return;}
      }else if(!data.end_of_turn){$('#interim').textContent=data.transcript||'';$('#interim').hidden=!data.transcript;return;}
      $('#interim').hidden=true;if(!data.transcript?.trim()){if(!command)renderLivePreview();return;}
      if(command){commandHeard+=(commandHeard?' ':'')+data.transcript;void stopCapture();return;}
      try{
        if(applySpeakerEvent(session,{...data,end:data.words?.at(-1)?.end??Date.now()-startedAt}).length)requestVersion++;
        if(session.speakers.some(p=>p.role==='Unassigned'))notice('Voices detected. Choose each person’s role under People once; you can give them a name at any time.');
        renderTurns();renderCues();if(!$('#view-evidence').hidden)renderNotebook();if($('#auto-analyze').checked)void analyze();
      }catch{notice('This speech segment could not be displayed. Stop and review the recording.',true);}
    }
    if(data.type==='SpeakerRevision'&&!command){
      const changed=applySpeakerEvent(session,data);if(changed.length)requestVersion++;
      event('speaker_revision',{changedTurnIds:changed,revisions:data.revisions});renderTurns();renderCues();renderNotebook();
      if(session.turns.some(t=>t.speakerReviewRequired))notice('The final voice check disagrees with some live labels. Your cards keep their live speakers. Use Review speaker update on marked passages; disputed sections are excluded from follow-ups until confirmed.');
    }
    if(data.type==='Termination'){event('speech_session_ended',{audioSeconds:data.audio_duration_seconds,sessionSeconds:data.session_duration_seconds});connection.close();}
    if(data.type==='Error'||data.type==='Limit'){notice(data.message,data.type==='Error');void stopCapture();}
  });
}

function invalidateTurn(id){
  session.cues=session.cues.filter(c=>!c.evidence.some(e=>e.turnId===id));
  for(const q of session.quotes.filter(q=>q.turnId===id)){q.audioChecked=false;q.note=`[Transcript revised; review original saved excerpt.] ${q.note}`;q.transcriptRevised=true;}
  event('transcript_revised',{turnId:id});renderCues();
}
async function stopCapture(){
  if(stopping||!recording)return;stopping=true;const closing=stream;await cleanupCapture();status('Finishing transcription…');
  if(closing?.readyState===WebSocket.OPEN){
    // Terminate flushes the last transcript; keep listening until Termination.
    closing.send(JSON.stringify({type:'Terminate'}));
    stopTimeout=setTimeout(()=>{if(closing===stream&&closing.readyState===WebSocket.OPEN){
      notice('Final transcription confirmation did not arrive. Check the last words against the recording.',true);closing.close();
    }},9000);
  }
  else {closing?.close();await finishCapture(closing);}
}
$('#record-stop').addEventListener('click',()=>void stopCapture());
$('#record-start').addEventListener('click',()=>{$('#consent-check').checked=false;$('#consent-dialog').showModal();});
$('#consent-dialog').addEventListener('close',()=>{if($('#consent-dialog').returnValue==='start'&&$('#consent-check').checked)void startCapture();});
$('#ask-companion').addEventListener('click',()=>void startCapture({command:true}));
$('#question-upload').addEventListener('click',()=>$('#question-file').click());
$('#question-file').addEventListener('change',async()=>{const file=$('#question-file').files[0];$('#question-file').value='';if(!file)return;
  if(file.size>2000000)return notice('Choose a short WAV voice question below 2 MB.',true);
  if(!await askConfirmation('Send this voice question to AssemblyAI for transcription? Use a recording you have permission to process.'))return;
  await startCapture({command:true,file});});
$('#upload-button').addEventListener('click',()=>$('#audio-file').click());
$('#audio-file').addEventListener('change',async()=>{const file=$('#audio-file').files[0];$('#audio-file').value='';if(!file)return;if(file.size>12*1024*1024)return notice('Choose a WAV recording smaller than 12 MB.',true);
  if(!await askConfirmation('Transcribe this recording with AssemblyAI? Confirm that you have permission to process everyone recorded.'))return;
  await startCapture({file});});

function updateRecordingPlaybackStatus(){
  if(!uploadPlayback||stopping)return;
  const waiting=recordingMonitor.paused&&!recordingMonitor.ended;
  $('#resume-recording').hidden=!waiting;
  status(waiting?'Ready to play recording':commandMode?'Listening to your recorded question':recordingMonitor.muted?'Transcribing your recording':'Playing and transcribing','live');
  $('#recording-hint').textContent=waiting?'Press Play recording to start the audio and transcription together.':recordingMonitor.muted?'Recording sound is muted. Transcription continues.':'Your recording is playing while the live transcript appears.';
}
async function resumeRecordingPlayback(){
  const playback=uploadPlayback;if(!playback||stopping)return;
  try{await recordingMonitor.play();}catch{/* The visible play control supplies a fresh user gesture. */}
  if(playback===uploadPlayback)updateRecordingPlaybackStatus();
}
$('#resume-recording').addEventListener('click',()=>void resumeRecordingPlayback());
$('#recording-sound').addEventListener('change',()=>{recordingMonitor.muted=!$('#recording-sound').checked;updateRecordingPlaybackStatus();});

async function streamFile(file,connection){
  const bytes=await file.arrayBuffer();if(new TextDecoder().decode(bytes.slice(0,4))!=='RIFF'||new TextDecoder().decode(bytes.slice(8,12))!=='WAVE')throw new Error('Please use a WAV audio file.');
  if(!recording||stopping||connection!==stream)return;
  const decoder=new OfflineAudioContext(1,1,16000);const decoded=await decoder.decodeAudioData(bytes.slice(0));
  const maximum=(commandMode?Math.min(25,config.maxSessionSeconds):config.maxSessionSeconds)-3;
  if(decoded.duration>maximum)throw new Error(`Keep the recording below ${maximum} seconds.`);
  const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
  const rendered=await offline.startRendering();
  if(!recording||stopping||connection!==stream)return;
  const pcm=pcmForPlayback(rendered.getChannelData(0)),reader=playbackReader(pcm);
  const playback={reader};uploadPlayback=playback;
  uploadUrl=URL.createObjectURL(wavBlob([pcm.buffer]));recordingMonitor.src=uploadUrl;
  recordingMonitor.muted=!$('#recording-sound').checked;recordingMonitor.volume=1;
  const pump=ended=>{
    if(uploadPlayback!==playback||!recording||stopping||connection!==stream)return;
    for(const chunk of reader.take(recordingMonitor.currentTime,ended)){if(stopping)break;acceptPCM(chunk);}
    if(reader.complete)void stopCapture();
  };
  fileTimer=setInterval(()=>pump(false),50);
  recordingMonitor.onended=()=>pump(true);
  await resumeRecordingPlayback();
}

$('#typed-form').addEventListener('submit',e=>{e.preventDefault();if(recording)return toast('End the recording before adding a typed turn.');const text=$('#typed-text').value.trim();if(!text)return;
  if(session.mode==='empty')session.mode='typed';const start=session.turns.at(-1)?.end||0;
  session.turns.push(normalizeTurn({id:`typed-${crypto.randomUUID()}`,text,speaker:$('#typed-speaker').value,start,end:start,source:'typed'}));
  $('#typed-text').value='';$('#mode-label').textContent=session.mode==='sample'?'Sample + typed rehearsal':'Typed rehearsal';renderTurns();status('Rehearsal');if($('#auto-analyze').checked)void analyze();});

function renderNotebook(){
  $('#notebook-title').textContent=session.title;$('#turn-total').textContent=groupSpeakerTurns(session.turns).length;$('#checked-total').textContent=`${session.quotes.filter(q=>q.audioChecked).length} / ${session.quotes.length}`;
  $('#open-total').textContent=session.cues.filter(c=>c.status==='open').length;
  const box=$('#quotes-list');box.replaceChildren();
  if(!session.quotes.length){const empty=node('div','empty-notebook');empty.append(node('h2','','Keep the original close.'),node('p','','Save an excerpt from the conversation. Its timestamp and audio will come with it.'),button('Return to interview','text-button',()=>view('interview')));box.append(empty);return;}
  for(const quote of session.quotes){const card=node('article','quote-card');card.append(node('blockquote','',`“${quote.quote}”`));
    const meta=node('div','quote-meta');meta.append(node('span','',speakerDisplay(session,quote)),node('span','',`${formatTime(quote.start)}–${formatTime(quote.end)}`),node('span','',quote.source==='typed'?'Typed excerpt':quote.alignment==='word'?'Word timing':'Turn timing'));card.append(meta);
    if(quote.attributionRevised)card.append(node('p','subtle',quote.reviewReason||'Speaker attribution changed. Review this excerpt.'));
    if(quote.transcriptRevised)card.append(node('p','subtle','The transcript changed after this excerpt was saved. Review both versions.'));
    if(quote.context){const context=node('details','quote-context');context.append(node('summary','','Read the surrounding context'));
      if(quote.context.previousTurn)context.append(node('p','',`${speakerDisplay(session,quote.context.previousTurn)}: ${quote.context.previousTurn.text}`));
      context.append(node('p','',`Complete source turn at save time: ${quote.context.turnText}`));card.append(context);}
    const notes=node('textarea');notes.placeholder='Your notes or corrections. The original excerpt stays unchanged.';notes.value=quote.note;notes.maxLength=2000;notes.setAttribute('aria-label',`Reporter note for excerpt at ${formatTime(quote.start)}`);notes.addEventListener('input',()=>quote.note=notes.value);card.append(notes);
    const actions=node('div','quote-actions');const play=button('Listen to original','text-button',()=>playPassage(quote.start,quote.end,quote.turnId));play.disabled=!audioBlob||quote.source==='typed';
    const label=node('label','check-line');const checked=node('input');checked.type='checkbox';checked.checked=quote.audioChecked;checked.disabled=!audioBlob||quote.source==='typed';checked.addEventListener('change',()=>{quote.audioChecked=checked.checked;event('reporter_audio_check',{quoteId:quote.id,checked:quote.audioChecked});$('#checked-total').textContent=`${session.quotes.filter(q=>q.audioChecked).length} / ${session.quotes.length}`;});label.append(checked,node('span','','I checked this against the audio'));
    actions.append(play,label,button('Remove','text-button',()=>{session.quotes=session.quotes.filter(q=>q.id!==quote.id);renderNotebook();controls();}));card.append(actions);box.append(card);
  }
}

async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
$('#export-bundle').addEventListener('click',async()=>{
  if(recording)return toast('End the interview before exporting its final audio.');
  if(!session.turns.length)return toast('Start an interview or load the sample first.');
  const files={'interview.json':strToU8(JSON.stringify(namedNotebook(session),null,2)),'notes.md':strToU8(namedMarkdownNotes(session))};
  if(audioBlob)files['interview.wav']=new Uint8Array(await audioBlob.arrayBuffer());
  const manifest={schemaVersion:1,createdAt:new Date().toISOString(),sessionId:session.id,mode:session.mode,
    disclaimer:'Checksums detect file changes only. They do not authenticate a speaker or prove claims true.',files:[]};
  for(const [name,bytes]of Object.entries(files))manifest.files.push({name,bytes:bytes.length,sha256:await digest(bytes)});
  files['manifest.json']=strToU8(JSON.stringify(manifest,null,2));
  const zip=zipSync(files,{level:0});const url=URL.createObjectURL(new Blob([zip],{type:'application/zip'}));const link=node('a');link.href=url;link.download=`nonius-${session.id.slice(0,8)}.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);event('bundle_exported');toast('Interview bundle downloaded.');
});

function renderBudget(b){const daily=Number.isFinite(b.dailyLimitUsd)?`Today: $${b.dailyReservedUsd.toFixed(3)} of $${b.dailyLimitUsd.toFixed(2)}. Resets at midnight in ${b.resetTimeZone}. `:'';$('#budget-description').textContent=daily+`Total: $${b.reservedUsd.toFixed(3)} of $${b.limitUsd.toFixed(2)} reserved. ${b.llmCalls} analysis calls reserved. Audio reservations cover the maximum permitted session duration.`;}
async function refreshConfig(){try{const response=await fetch('/api/config');if(!response.ok)throw new Error();config=await response.json();renderBudget(config.budget);if(!config.liveAvailable)$('#recording-hint').textContent='Add an AssemblyAI key on the server to enable live speech. The sample works now.';controls();}catch{notice('The local server could not be reached. Please restart it and reload.',true);}}
window.addEventListener('beforeunload',e=>{if(recording){e.preventDefault();e.returnValue='';}if(stream?.readyState===WebSocket.OPEN)stream.send(JSON.stringify({type:'Terminate'}));});
renderPeople();renderGoals();controls();void refreshConfig();
