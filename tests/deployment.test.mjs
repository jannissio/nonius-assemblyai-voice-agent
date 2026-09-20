import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configuration} from '../lib/config.mjs';
import {createApplication} from '../server.mjs';

test('a network-bound live server fails closed without a demo credential',()=>{
  const config=configuration({HOST:'0.0.0.0',ASSEMBLYAI_API_KEY:'test-only-placeholder'});
  assert.throws(()=>createApplication({config,budget:{}}),/at least 16 characters/);
  // Public sample mode requires no paid API key or login.
  const {server}=createApplication({config:{...config,key:''},budget:{snapshot:()=>({})}});server.close();
});

test('demo authentication covers app and APIs while preserving a non-sensitive health check',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'nonius-auth-'));
  const config=configuration({NONIUS_DEMO_PASSWORD:'test-only-credential-123',NONIUS_BUDGET_PATH:join(directory,'budget.json')});
  const {server}=createApplication({config});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const path of ['/','/app.js','/api/config'])assert.equal((await fetch(base+path)).status,401);
    assert.equal((await fetch(base+'/healthz')).status,200);
    const response=await fetch(base+'/api/config',{headers:{authorization:'Basic '+Buffer.from(`nonius:${config.demoPassword}`).toString('base64')}});
    assert.equal(response.status,200);assert.ok(!(await response.text()).includes(config.demoPassword));
  }finally{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true});}
});
