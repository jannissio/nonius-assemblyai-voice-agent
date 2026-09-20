import {readFileSync} from 'node:fs';
export function readEnvFile(path='.env') {
  let text; try{text=readFileSync(path,'utf8');}catch(e){if(e.code==='ENOENT')return {};throw e;}
  const result={};
  for(const line of text.split(/\r?\n/)) {
    const match=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*?)\s*$/);
    if(!match)continue;
    let value=match[2];
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    else value=value.replace(/\s+#.*$/,'');
    result[match[1]]=value;
  }
  return result;
}
const number=(v,fallback,min,max)=> {const n=Number(v);return v!==undefined&&Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
export function configuration(env={...readEnvFile(),...process.env}) {
  return {
    key:env.ASSEMBLYAI_API_KEY||env.ASEEMBLYAI_API_KEY||env['assembly.ai.api']||'',
    host:env.HOST||'127.0.0.1', port:number(env.PORT,4317,1,65535),
    allowedHosts:(env.NONIUS_ALLOWED_HOSTS||'127.0.0.1,localhost,[::1]').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean),
    demoPassword:env.NONIUS_DEMO_PASSWORD||'',
    allowPublicLive:env.NONIUS_PUBLIC_LIVE==='true',
    speechModel:env.ASSEMBLYAI_SPEECH_MODEL||'universal-3-5-pro',
    llmModel:env.ASSEMBLYAI_LLM_MODEL||'qwen3.5-4b-32k-fast',
    budgetUsd:number(env.NONIUS_BUDGET_USD,2,0,50),
    dailyBudgetUsd:env.NONIUS_DAILY_BUDGET_USD===undefined?undefined:number(env.NONIUS_DAILY_BUDGET_USD,0,0,50),
    budgetTimeZone:env.NONIUS_BUDGET_TIMEZONE||'Europe/Berlin',
    maxSessionSeconds:number(env.NONIUS_MAX_SESSION_SECONDS,180,5,300),
    maxAudioSeconds:number(env.NONIUS_MAX_AUDIO_SECONDS,1800,0,90000),
    maxLlmCalls:number(env.NONIUS_MAX_LLM_CALLS,80,0,2000),
    llmCooldownSeconds:number(env.NONIUS_LLM_COOLDOWN_SECONDS,35,0,120),
    budgetPath:env.NONIUS_BUDGET_PATH||'runtime/budget.json'
  };
}
