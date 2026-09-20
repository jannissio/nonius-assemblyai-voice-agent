import {Pool} from 'pg';
import {emptyBudget,validateBudget,nextReservation,budgetSnapshot} from './budget-policy.mjs';

const quotaCodes=new Set(['BUDGET_EXHAUSTED','DAILY_BUDGET_EXHAUSTED','LLM_COOLDOWN']);
const unavailable=()=>Object.assign(new Error('Usage controls are temporarily unavailable. No new provider request is allowed.'),{code:'BUDGET_UNAVAILABLE',status:503});

export class PostgresBudget {
  constructor(config,{pool,connectionString,id='nonius-global-budget-v1'}={}){
    this.config=config;this.id=id;this.durable=true;
    this.pool=pool||new Pool({connectionString,max:3,connectionTimeoutMillis:8000,idleTimeoutMillis:20000,
      statement_timeout:8000,query_timeout:10000});
    this.pool.on?.('error',()=>{});
  }
  async initialize(){
    try{
      await this.pool.query('CREATE TABLE IF NOT EXISTS nonius_usage_budget (id text PRIMARY KEY, state jsonb NOT NULL)');
      await this.pool.query('INSERT INTO nonius_usage_budget (id,state) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO NOTHING',[this.id,JSON.stringify(emptyBudget())]);
      await this.snapshot();return this;
    }catch{throw unavailable();}
  }
  async reserve(kind,options={}){
    let client,broken=false;
    try{
      client=await this.pool.connect();await client.query('BEGIN');
      const result=await client.query('SELECT state FROM nonius_usage_budget WHERE id=$1 FOR UPDATE',[this.id]);
      if(result.rows.length!==1)throw unavailable();
      // Read database time after acquiring the lock, including across midnight.
      const clock=await client.query('SELECT clock_timestamp() AS now');
      const next=nextReservation(validateBudget(result.rows[0].state),this.config,kind,options,new Date(clock.rows[0].now).getTime());
      await client.query('UPDATE nonius_usage_budget SET state=$2::jsonb WHERE id=$1',[this.id,JSON.stringify(next.state)]);
      await client.query('COMMIT');return next.entry;
    }catch(error){
      if(client)try{await client.query('ROLLBACK');}catch{broken=true;}
      if(quotaCodes.has(error.code))throw error;
      throw unavailable();
    }finally{client?.release(broken);}
  }
  async snapshot(){
    try{
      const result=await this.pool.query('SELECT state, clock_timestamp() AS now FROM nonius_usage_budget WHERE id=$1',[this.id]);
      if(result.rows.length!==1)throw unavailable();
      return {...budgetSnapshot(result.rows[0].state,this.config,new Date(result.rows[0].now).getTime()),storage:'persistent database'};
    }catch{throw unavailable();}
  }
  async close(){await this.pool.end();}
}
