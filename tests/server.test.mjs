import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {configuration,readEnvFile} from '../lib/config.mjs';
import {Budget} from '../lib/budget.mjs';
import {createApplication} from '../server.mjs';
import {proposeCues} from '../lib/agent.mjs';
import {normalizeTurn} from '../lib/evidence.mjs';
import {readWav,writeWav} from '../lib/wav.mjs';

function setup(){const directory=mkdtempSync(join(tmpdir(),'nonius-tests-'));const config=configuration({NONIUS_BUDGET_PATH:join(directory,'budget.json'),NONIUS_BUDGET_USD:'0.1',NONIUS_MAX_AUDIO_SECONDS:'10',NONIUS_MAX_LLM_CALLS:'2',NONIUS_LLM_COOLDOWN_SECONDS:'0'});return {directory,config};}
test('legacy credential spelling works without modifying the secret file',()=>{const {directory}=setup();try{const path=join(directory,'.env');writeFileSync(path,'ASEEMBLYAI_API_KEY="test-only-placeholder"\n# comment\n');assert.equal(configuration(readEnvFile(path)).key,'test-only-placeholder');assert.ok(readFileSync(path,'utf8').includes('ASEEMBLYAI'));}finally{rmSync(directory,{recursive:true});}});
test('persistent budget stops exhausted audio, LLM calls and USD reservations',()=>{const {directory,config}=setup();try{const b=new Budget(config);b.reserve('audio',{seconds:10});assert.throws(()=>b.reserve('audio',{seconds:1}),/limit reached/);b.reserve('llm',{inputBytes:10,maxOutputTokens:10});b.reserve('llm',{inputBytes:10,maxOutputTokens:10});assert.throws(()=>b.reserve('llm'),/limit reached/);assert.equal(new Budget(config).snapshot().llmCalls,2);const c=new Budget({...config,budgetPath:join(directory,'other.json'),budgetUsd:0});assert.throws(()=>c.reserve('audio',{seconds:1}),/limit reached/);}finally{rmSync(directory,{recursive:true});}});
test('a malformed credit ledger fails closed',()=>{const {directory,config}=setup();try{writeFileSync(config.budgetPath,'{"version":1,"reservedUsd":-1}');assert.throws(()=>new Budget(config),/invalid/);}finally{rmSync(directory,{recursive:true});}});
test('separate budget instances retain every reservation and fail closed on a lock',()=>{const {directory,config}=setup();try{const a=new Budget(config),b=new Budget(config);a.reserve('llm');b.reserve('llm');assert.equal(a.snapshot().llmCalls,2);assert.throws(()=>a.reserve('llm'),/limit reached/);writeFileSync(config.budgetPath+'.lock','');assert.throws(()=>b.reserve('audio',{seconds:1}),/ledger is busy/);assert.equal(b.snapshot().audioSecondsReserved,0);assert.throws(()=>b.reserve('audio',{seconds:-1}),/Invalid/);}finally{rmSync(directory,{recursive:true});}});
test('persistent cooldown prevents sending or reserving another live analysis early',()=>{const {directory,config}=setup();try{const b=new Budget({...config,llmCooldownSeconds:35});b.reserve('llm');assert.throws(()=>new Budget({...config,llmCooldownSeconds:35}).reserve('llm'),e=>e.code==='LLM_COOLDOWN');assert.equal(b.snapshot().llmCalls,1);}finally{rmSync(directory,{recursive:true});}});
test('WAV parser accepts original PCM and rejects malformed or truncated input',()=>{const data=Buffer.alloc(32000);const wav=writeWav(data);assert.equal(readWav(wav).seconds,1);assert.deepEqual(readWav(wav).pcm,data);assert.throws(()=>readWav(wav.subarray(0,100)),/Truncated/);const stereo=Buffer.from(wav);stereo.writeUInt16LE(2,22);assert.throws(()=>readWav(stereo),/mono/);});
test('provider errors omit upstream bodies and preserve credit reservation',async()=>{const {directory,config}=setup();config.key='test-only-placeholder';try{const b=new Budget(config);await assert.rejects(()=>proposeCues({turns:[normalizeTurn({id:'t',text:'Hello there.'})]},{config,budget:b,fetchImpl:async()=>({ok:false,status:403,json:async()=>({apiKey:'do not expose'})})}),/^Error: AssemblyAI analysis returned HTTP 403\.$/);assert.equal(b.snapshot().llmCalls,1);}finally{rmSync(directory,{recursive:true});}});
test('HTTP routes protect secrets, validate origins and process local fallback',async()=>{const {directory,config}=setup();const {server}=createApplication({config});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const path of ['/.env','/.env.example','/server.mjs','/lib/config.mjs','/lib/followups.mjs','/runtime/budget.json','/package.json','/.git/config','/.replit','/SECURITY.md','/attached_assets/source.zip','/%2eenv','/lib/%2e%2e/server.mjs','/..%5c.env'])assert.equal((await fetch(base+path)).status,404,path);
    const settings=await fetch(base+'/api/config').then(r=>r.json());assert.equal(settings.liveAvailable,false);assert.ok(!JSON.stringify(settings).includes('key'));
    const reboundStatus=await new Promise((resolve,reject)=>{const req=request(base+'/api/config',{headers:{host:'rebound.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
    assert.equal(reboundStatus,403);
    const payload=JSON.stringify({turns:[{id:'s',text:'We will open next spring.',start:0,end:1000}],engine:'rules'});
    assert.equal((await fetch(base+'/api/analyze',{method:'POST',headers:{'content-type':'application/json','x-nonius-client':'interview-desk',origin:'https://untrusted.example'},body:payload})).status,403);
    assert.equal((await fetch(base+'/api/analyze',{method:'POST',body:payload})).status,403);
    const response=await fetch(base+'/api/analyze',{method:'POST',headers:{'content-type':'application/json','x-nonius-client':'interview-desk'},body:payload});assert.equal(response.status,200);const result=await response.json();assert.equal(result.engine,'local rules');assert.equal(result.cues[0].kind,'date');
    const page=await fetch(base);assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));const html=await page.text();assert.ok(html.includes('Nonius'));
    const entry=html.match(/<script type="module" src="([^"]+)"/)[1];assert.match(entry,/app\.js\?v=/);
    const client=await fetch(base+entry).then(r=>r.text());assert.ok(client.includes('renderLivePreview'));assert.ok(client.includes('groupSpeakerTurns(session.turns)'));
    for(const asset of [...client.matchAll(/from '(\/[^']+)'/g)].map(m=>m[1]))assert.equal((await fetch(base+asset)).status,200,asset);
    const range=await fetch(base+'/fixtures/demo.wav',{headers:{range:'bytes=0-43'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,44);
  }finally{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true});}
});

test('HTTP errors never return internal diagnostics, even for known error codes',async()=>{
  const {directory,config}=setup();
  const diagnostic='test-only-sensitive-diagnostic';
  let failure;
  const {server}=createApplication({config,analyze:async()=>{throw failure;}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={'content-type':'application/json','x-nonius-client':'interview-desk'};
  const body=JSON.stringify({turns:[{id:'s',text:'We will open next spring.'}]});
  try{
    for(const [code,status]of [['EACCES',500],['PROVIDER_ERROR',502],['BUDGET_UNAVAILABLE',503],['BUDGET_EXHAUSTED',429],['DAILY_BUDGET_EXHAUSTED',429],['LLM_COOLDOWN',429]]){
      failure=Object.assign(new Error(diagnostic),{code,retryAfterSeconds:7});
      const response=await fetch(base+'/api/analyze',{method:'POST',headers,body});
      assert.equal(response.status,status,code);
      const result=await response.text();assert.ok(!result.includes(diagnostic),code);
      assert.ok(!result.includes('stack'));if(code==='LLM_COOLDOWN')assert.match(result,/7 seconds/);
    }
    const malformed=await fetch(base+'/api/analyze',{method:'POST',headers,body:diagnostic});
    assert.equal(malformed.status,400);assert.ok(!(await malformed.text()).includes(diagnostic));
    const oversized=await fetch(base+'/api/analyze',{method:'POST',headers,body:'x'.repeat(48001)});
    assert.equal(oversized.status,413);
  }finally{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true});}
});

test('browser configuration exposes availability but no credential or private runtime path',async()=>{
  const {directory,config}=setup();config.key='test-only-provider-key';
  const {server}=createApplication({config});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/config`),text=await response.text();
    assert.equal(response.status,200);assert.equal(JSON.parse(text).liveAvailable,true);
    assert.ok(!text.includes(config.key));assert.ok(!text.includes(directory));
    assert.ok(!Object.hasOwn(JSON.parse(text),'key'));assert.ok(!Object.hasOwn(JSON.parse(text),'demoPassword'));
    assert.equal(response.headers.get('cache-control'),'no-store');
  }finally{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true});}
});

test('analysis route preserves goal completion, cue history and speaker-review flags',async()=>{
  const {directory,config}=setup();let received;
  const {server}=createApplication({config,analyze:async input=>{received=input;return {cues:[],raw:{private:'provider output'}};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const payload={turns:[{id:'s',speaker:'Source',text:'This speaker label needs review.',speakerReviewRequired:true}],goals:[{text:'Already covered',done:true}],previousCues:[{kind:'example',focus:'label',status:'dismissed',evidence:[{turnId:'s'}]}]};
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/analyze`,{method:'POST',headers:{'content-type':'application/json','x-nonius-client':'interview-desk'},body:JSON.stringify(payload)});
    assert.equal(response.status,200);assert.equal(received.turns[0].speakerReviewRequired,true);
    assert.deepEqual(received.goals,payload.goals);assert.deepEqual(received.previousCues,payload.previousCues);assert.equal((await response.json()).raw,undefined);
  }finally{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true});}
});
