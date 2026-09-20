import test from 'node:test';
import assert from 'node:assert/strict';
import {configuration} from '../lib/config.mjs';
import {emptyBudget,nextReservation,budgetSnapshot,budgetDay} from '../lib/budget-policy.mjs';
import {PostgresBudget} from '../lib/postgres-budget.mjs';
import {proposeFollowups} from '../lib/followups.mjs';
import {createApplication} from '../server.mjs';
import {WebSocket} from 'ws';

const config=()=>configuration({NONIUS_BUDGET_USD:'2',NONIUS_DAILY_BUDGET_USD:'1',NONIUS_MAX_AUDIO_SECONDS:'90000',NONIUS_MAX_LLM_CALLS:'2000',NONIUS_LLM_COOLDOWN_SECONDS:'0'});
test('initialization serializes schema creation and never overwrites an existing allowance',async()=>{
  const commands=[];let released=false;
  const client={query:async sql=>{commands.push(sql);return {rows:[]};},release:()=>{released=true;}};
  const budget=new PostgresBudget(config(),{pool:{connect:async()=>client,query:async()=>({rows:[{state:emptyBudget(),now:new Date()}]})}});
  await budget.initialize();
  assert.equal(commands[0],'BEGIN');assert.match(commands[1],/pg_advisory_xact_lock/);
  assert.match(commands[3],/ON CONFLICT \(id\) DO NOTHING/);assert.equal(commands[4],'COMMIT');assert.equal(released,true);
});
test('Berlin midnight resets only the daily allowance; the cumulative limit survives the new day',()=>{
  const cfg=config(),before=Date.parse('2026-09-20T21:59:00Z'),after=Date.parse('2026-09-20T22:01:00Z');
  let state=nextReservation(emptyBudget(),cfg,'audio',{seconds:3600},before).state;
  assert.throws(()=>nextReservation(state,cfg,'audio',{seconds:1},before),error=>error.code==='DAILY_BUDGET_EXHAUSTED');
  assert.equal(budgetSnapshot(state,cfg,after).dailyReservedUsd,0);
  state=nextReservation(state,cfg,'audio',{seconds:3600},after).state;
  assert.equal(state.reservedUsd,2);assert.equal(state.daily.reservedUsd,1);
  assert.throws(()=>nextReservation(state,cfg,'audio',{seconds:1},after+86400000),error=>error.code==='BUDGET_EXHAUSTED');
  assert.equal(budgetDay(Date.parse('2026-03-28T23:30:00Z')),'2026-03-29');
  assert.equal(budgetDay(Date.parse('2026-03-29T22:30:00Z')),'2026-03-30');
});

test('a database reservation locks, writes and commits before resolving; failed commits do not permit a provider call',async()=>{
  const commands=[];let released=false;
  const client={query:async(sql,values)=>{commands.push(sql);if(sql.startsWith('SELECT'))return {rows:[{state:emptyBudget(),now:new Date()}]};
    if(sql.startsWith('UPDATE'))assert.equal(JSON.parse(values[1]).audioSeconds,60);return {rows:[]};},release:()=>{released=true;}};
  const budget=new PostgresBudget(config(),{pool:{connect:async()=>client}});
  await budget.reserve('audio',{seconds:60});
  assert.match(commands[1],/FOR UPDATE/);assert.equal(commands.at(-1),'COMMIT');assert.equal(released,true);
  const failure=new PostgresBudget(config(),{pool:{connect:async()=>({query:async sql=>{
    if(sql.startsWith('SELECT'))return {rows:[{state:emptyBudget(),now:new Date()}]};
    if(sql==='COMMIT')throw new Error('private connection detail');return {rows:[]};},release:()=>{}})}});
  await assert.rejects(()=>failure.reserve('audio',{seconds:60}),error=>error.code==='BUDGET_UNAVAILABLE'&&!error.message.includes('private'));
});

test('asynchronous quota rejection prevents any LLM request',async()=>{
  let calls=0;
  const budget={reserve:async()=>{await Promise.resolve();throw Object.assign(new Error('daily allowance'),{code:'DAILY_BUDGET_EXHAUSTED'});}};
  await assert.rejects(()=>proposeFollowups({turns:[{id:'s',speaker:'Source',text:'The budget is fifty million pounds.'}]},
    {config:{...config(),key:'test-only-provider-key'},budget,fetchImpl:async()=>{calls++;}}),error=>error.code==='DAILY_BUDGET_EXHAUSTED');
  assert.equal(calls,0);
});

test('public live mode requires durable accounting and an explicit daily cap',()=>{
  const cfg={...config(),host:'0.0.0.0',key:'test-only-provider-key',allowPublicLive:true};
  assert.throws(()=>createApplication({config:cfg,budget:{}}),/password/i);
  assert.throws(()=>createApplication({config:{...cfg,dailyBudgetUsd:undefined},budget:{durable:true}}),/password/i);
  const {server}=createApplication({config:cfg,budget:{durable:true}});server.close();
});

test('asynchronous quota rejection prevents opening an upstream speech connection',async()=>{
  let upstreamCalls=0;
  const budget={reserve:async()=>{await Promise.resolve();throw new Error('unavailable');}};
  const {server}=createApplication({config:{...config(),key:'test-only-provider-key'},budget,Upstream:class{constructor(){upstreamCalls++;}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/stream`);
  try{
    const status=await new Promise(resolve=>{client.on('unexpected-response',(_req,response)=>{response.resume();client.terminate();resolve(response.statusCode);});client.on('error',()=>{});});
    assert.equal(status,429);assert.equal(upstreamCalls,0);
  }finally{client.terminate();await new Promise(resolve=>server.close(resolve));}
});
