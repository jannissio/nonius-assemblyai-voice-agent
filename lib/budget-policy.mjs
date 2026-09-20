export const emptyBudget=()=>({version:1,reservedUsd:0,audioSeconds:0,llmCalls:0,entries:[]});
export function validateBudget(state){
  if(state?.version!==1||!['reservedUsd','audioSeconds','llmCalls'].every(key=>Number.isFinite(state[key])&&state[key]>=0)||!Array.isArray(state.entries)||
    (state.daily&&(!/^\d{4}-\d{2}-\d{2}$/.test(state.daily.day)||!Number.isFinite(state.daily.reservedUsd)||state.daily.reservedUsd<0)))
    throw new Error('Budget ledger is invalid. Live calls disabled until reviewed.');
  return state;
}
export function budgetDay(now,timeZone='Europe/Berlin'){
  return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
export function nextReservation(state,config,kind,{seconds=0,inputBytes=0,maxOutputTokens=0}={},now=Date.now()){
  validateBudget(state);
  if(!['audio','llm'].includes(kind)||![seconds,inputBytes,maxOutputTokens].every(value=>Number.isFinite(value)&&value>=0)||
    (kind==='llm'&&seconds!==0))throw new Error('Invalid reservation.');
  if(kind==='llm'){
    const last=state.entries.findLast(entry=>entry.kind==='llm');
    const wait=last?Math.ceil((Date.parse(last.at)+(config.llmCooldownSeconds||0)*1000-now)/1000):0;
    if(wait>0){const error=new Error(`Live analysis is available in ${wait} seconds. Existing suggestions and local checks remain available.`);
      error.code='LLM_COOLDOWN';error.retryAfterSeconds=wait;throw error;}
  }
  // Conservative allowances: $1/hour audio and $1/$5 per million LLM tokens,
  // with input-byte accounting and 10% LLM headroom. Not an account balance.
  const usd=kind==='audio'?seconds/3600:(inputBytes+3000)*1.1/1e6+maxOutputTokens*5.5/1e6;
  if(!Number.isFinite(usd)||usd<0)throw new Error('Invalid reservation.');
  if(state.reservedUsd+usd>config.budgetUsd+1e-9||state.audioSeconds+seconds>config.maxAudioSeconds||
    (kind==='llm'&&state.llmCalls>=config.maxLlmCalls)){
    const error=new Error('Credit limit reached. The sample interview remains available.');error.code='BUDGET_EXHAUSTED';throw error;
  }
  const day=budgetDay(now,config.budgetTimeZone),daily=state.daily?.day===day?state.daily.reservedUsd:0;
  if(Number.isFinite(config.dailyBudgetUsd)&&daily+usd>config.dailyBudgetUsd+1e-9){
    const error=new Error(`Today's demo allowance is used up. It resets at midnight in ${config.budgetTimeZone||'Europe/Berlin'}. The sample remains available.`);
    error.code='DAILY_BUDGET_EXHAUSTED';throw error;
  }
  const entry={id:state.entries.length+1,at:new Date(now).toISOString(),kind,reservedUsd:usd,seconds};
  return {entry,state:{...state,reservedUsd:state.reservedUsd+usd,audioSeconds:state.audioSeconds+seconds,
    llmCalls:state.llmCalls+(kind==='llm'?1:0),entries:[...state.entries,entry],daily:{day,reservedUsd:daily+usd}}};
}
export function budgetSnapshot(state,config,now=Date.now()){
  validateBudget(state);
  const result={reservedUsd:state.reservedUsd,limitUsd:config.budgetUsd,audioSecondsReserved:state.audioSeconds,
    audioSecondsLimit:config.maxAudioSeconds,llmCalls:state.llmCalls,llmCallsLimit:config.maxLlmCalls,
    label:'Conservative usage reservations, not your AssemblyAI account balance'};
  if(Number.isFinite(config.dailyBudgetUsd)){
    result.dailyLimitUsd=config.dailyBudgetUsd;result.dailyReservedUsd=state.daily?.day===budgetDay(now,config.budgetTimeZone)?state.daily.reservedUsd:0;
    result.resetTimeZone=config.budgetTimeZone||'Europe/Berlin';
  }
  return result;
}
