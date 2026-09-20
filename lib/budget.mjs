import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';

export class Budget {
  constructor(config) {
    this.config=config;
    this.read();
  }
  read() {
    const config=this.config;
    this.state={version:1,reservedUsd:0,audioSeconds:0,llmCalls:0,entries:[]};
    if(existsSync(config.budgetPath)) {
      const stored=JSON.parse(readFileSync(config.budgetPath,'utf8'));
      if(stored.version!==1 || !['reservedUsd','audioSeconds','llmCalls'].every(k=>Number.isFinite(stored[k])&&stored[k]>=0)||!Array.isArray(stored.entries)) throw new Error('Budget ledger is invalid. Live calls disabled until reviewed.');
      this.state=stored;
    }
  }
  reserve(kind,{seconds=0,inputBytes=0,maxOutputTokens=0}={}) {
    if(![seconds,inputBytes,maxOutputTokens].every(x=>Number.isFinite(x)&&x>=0)||
      (kind==='llm'&&seconds!==0))throw new Error('Invalid reservation.');
    mkdirSync(dirname(this.config.budgetPath),{recursive:true});
    const lockPath=`${this.config.budgetPath}.lock`;
    let lock;
    try{lock=openSync(lockPath,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Credit ledger is busy or has an interrupted write. No request was sent.');throw e;}
    try {
    // Separate CLI evaluations and the running server share one ledger.
    this.read();
    if(kind==='llm'){
      const last=this.state.entries.findLast(e=>e.kind==='llm');
      const seconds=last?Math.ceil((Date.parse(last.at)+(this.config.llmCooldownSeconds||0)*1000-Date.now())/1000):0;
      if(seconds>0){const e=new Error(`Live analysis is available in ${seconds} seconds. Existing suggestions and local checks remain available.`);e.code='LLM_COOLDOWN';e.retryAfterSeconds=seconds;throw e;}
    }
    // Conservative allowances, not an account balance or billing guarantee.
    // $1/hour covers base STT ($0.45) + interview diarization ($0.12), with headroom.
    // LLM reservations retain Haiku's higher prices ($1/$5 per million +10%),
    // also conservative for Qwen 3.5 4B Fast ($0.10/$0.50, checked 2026-09-19).
    const usd=kind==='audio'?seconds/3600:(inputBytes+3000)*1.1/1e6+maxOutputTokens*5.5/1e6;
    if(!['audio','llm'].includes(kind)||!Number.isFinite(usd)||usd<0)throw new Error('Invalid reservation.');
    if(this.state.reservedUsd+usd>this.config.budgetUsd+1e-9 ||
       this.state.audioSeconds+seconds>this.config.maxAudioSeconds ||
       (kind==='llm'&&this.state.llmCalls>=this.config.maxLlmCalls)) {
      const e=new Error('Development credit limit reached. The sample interview remains available.');e.code='BUDGET_EXHAUSTED';throw e;
    }
    const entry={id:this.state.entries.length+1,at:new Date().toISOString(),kind,reservedUsd:usd,seconds};
    const next={...this.state,reservedUsd:this.state.reservedUsd+usd,audioSeconds:this.state.audioSeconds+seconds,
      llmCalls:this.state.llmCalls+(kind==='llm'?1:0),entries:[...this.state.entries,entry]};
    writeFileSync(`${this.config.budgetPath}.tmp`,JSON.stringify(next,null,2));
    renameSync(`${this.config.budgetPath}.tmp`,this.config.budgetPath);
    this.state=next;return entry;
    } finally {closeSync(lock);unlinkSync(lockPath);}
  }
  snapshot(){this.read();return {reservedUsd:this.state.reservedUsd,limitUsd:this.config.budgetUsd,audioSecondsReserved:this.state.audioSeconds,
    audioSecondsLimit:this.config.maxAudioSeconds,llmCalls:this.state.llmCalls,llmCallsLimit:this.config.maxLlmCalls,
    label:'Conservative local reservations, not your AssemblyAI account balance'};}
}
