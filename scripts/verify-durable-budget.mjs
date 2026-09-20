// Run inside the host with DATABASE_URL supplied privately. No provider calls.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresBudget} from '../lib/postgres-budget.mjs';

if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required; supply it through the hosting secret manager.');
const id=`nonius-probe-${randomUUID()}`;
const config={budgetUsd:0.02,dailyBudgetUsd:0.02,budgetTimeZone:'Europe/Berlin',
  maxAudioSeconds:90000,maxLlmCalls:2000,llmCooldownSeconds:0};
const make=()=>new PostgresBudget(config,{connectionString:process.env.DATABASE_URL,id});
const instances=[make(),make()];let reopened;
try{
  await Promise.all(instances.map(budget=>budget.initialize()));
  const results=await Promise.allSettled(Array.from({length:20},(_,i)=>instances[i%2].reserve('audio',{seconds:18})));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,4,'Concurrent reservations exceeded or underused the allowance.');
  for(const result of results.filter(result=>result.status==='rejected'))assert.equal(result.reason.code,'BUDGET_EXHAUSTED');
  await Promise.all(instances.map(budget=>budget.close()));
  reopened=await make().initialize();
  const snapshot=await reopened.snapshot();
  assert.equal(snapshot.reservedUsd,0.02);assert.equal(snapshot.dailyReservedUsd,0.02);
  assert.equal(snapshot.audioSecondsReserved,72);
  await assert.rejects(()=>reopened.reserve('audio',{seconds:1}),error=>error.code==='BUDGET_EXHAUSTED');
  console.log('PASS: concurrent reservations were serialized; committed totals survived new database connections; exhausted limits blocked further use. No AssemblyAI calls were made.');
}catch{
  process.exitCode=1;console.error('FAIL: durable quota probe did not pass. Leave provider access disabled and review the database configuration.');
}finally{
  // Only this run's random, disposable test ledger can be removed.
  const cleanup=reopened||make();
  try{
    assert.match(id,/^nonius-probe-[0-9a-f-]{36}$/);
    await cleanup.pool.query('DELETE FROM nonius_usage_budget WHERE id=$1',[id]);
    console.log('Disposable probe ledger removed. The live allowance was not touched.');
  }catch{process.exitCode=1;console.error('Probe cleanup failed. No production ledger was modified.');}
  await Promise.allSettled([...instances,cleanup].map(budget=>budget.close()));
}
