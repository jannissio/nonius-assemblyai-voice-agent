import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {emptyBudget,validateBudget,nextReservation,budgetSnapshot} from './budget-policy.mjs';

export class Budget {
  constructor(config){this.config=config;this.read();}
  read(){
    this.state=existsSync(this.config.budgetPath)?validateBudget(JSON.parse(readFileSync(this.config.budgetPath,'utf8'))):emptyBudget();
  }
  reserve(kind,options={}){
    if(!['audio','llm'].includes(kind)||![options.seconds??0,options.inputBytes??0,options.maxOutputTokens??0].every(value=>Number.isFinite(value)&&value>=0))
      throw new Error('Invalid reservation.');
    mkdirSync(dirname(this.config.budgetPath),{recursive:true});
    const lockPath=`${this.config.budgetPath}.lock`;let lock;
    try{lock=openSync(lockPath,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('Credit ledger is busy or has an interrupted write. No request was sent.');throw error;}
    try{
      this.read();const next=nextReservation(this.state,this.config,kind,options);
      writeFileSync(`${this.config.budgetPath}.tmp`,JSON.stringify(next.state,null,2));
      renameSync(`${this.config.budgetPath}.tmp`,this.config.budgetPath);
      this.state=next.state;return next.entry;
    }finally{closeSync(lock);unlinkSync(lockPath);}
  }
  snapshot(){this.read();return budgetSnapshot(this.state,this.config);}
}
