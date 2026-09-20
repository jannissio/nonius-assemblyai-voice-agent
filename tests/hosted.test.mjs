import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedConfiguration} from '../scripts/start-hosted.mjs';

test('public hosted mode ignores provider secrets and paid-use limits',()=>{
  const config=hostedConfiguration({ASSEMBLYAI_API_KEY:'test-only-provider-key',NONIUS_DEMO_PASSWORD:'test-only-demo-password',
    NONIUS_BUDGET_USD:'50',REPLIT_DOMAINS:'nonius.example',REPLIT_DEV_DOMAIN:'preview.example'});
  assert.equal(config.key,'');assert.equal(config.demoPassword,'');
  assert.equal(config.budgetUsd,0);assert.equal(config.maxAudioSeconds,0);assert.equal(config.maxLlmCalls,0);
  assert.ok(config.allowedHosts.includes('nonius.example'));assert.ok(config.allowedHosts.includes('preview.example'));
});

test('live hosted mode fails closed without a host, durable budget, key and password',()=>{
  const base={NONIUS_HOSTED_MODE:'live'};
  assert.throws(()=>hostedConfiguration(base),/hostname/);
  base.NONIUS_ALLOWED_HOSTS='nonius.example';assert.throws(()=>hostedConfiguration(base),/durable/);
  base.NONIUS_BUDGET_PATH='/durable/budget.json';base.NONIUS_DURABLE_BUDGET_CONFIRMED='true';
  assert.throws(()=>hostedConfiguration(base),/AssemblyAI secret/);
  base.ASSEMBLYAI_API_KEY='test-only-provider-key';assert.throws(()=>hostedConfiguration(base),/password/);
  base.NONIUS_DEMO_PASSWORD='test-only-demo-password';
  assert.equal(hostedConfiguration(base).key,base.ASSEMBLYAI_API_KEY);
  assert.throws(()=>hostedConfiguration({...base,NONIUS_ALLOWED_HOSTS:'*.example'}),/exact hostnames/);
  assert.throws(()=>hostedConfiguration({NONIUS_HOSTED_MODE:'unexpected'}),/sample or live/);
});

