import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {configuration} from '../lib/config.mjs';
import {createApplication} from '../server.mjs';

test('WebSocket proxy preserves PCM, bounds commands and closes on malformed audio without another paid session',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'nonius-stream-'));let upstream;
  class FakeUpstream extends EventEmitter{
    constructor(url,options){super();this.readyState=WebSocket.OPEN;this.bufferedAmount=0;this.sent=[];upstream=this;
      assert.ok(url.startsWith('wss://streaming.assemblyai.com/v3/ws?'));assert.equal(options.headers.Authorization,'test-only-placeholder');
      assert.equal(new URL(url).searchParams.get('speaker_labels'),'true');assert.equal(new URL(url).searchParams.has('max_speakers'),false);
      setImmediate(()=>this.emit('message',Buffer.from(JSON.stringify({type:'Begin',id:'synthetic-test-session'}))));}
    send(data){this.sent.push(data);}
    terminate(){this.readyState=WebSocket.CLOSED;this.emit('close');}
  }
  const config=configuration({ASSEMBLYAI_API_KEY:'test-only-placeholder',NONIUS_MAX_SESSION_SECONDS:'5',NONIUS_MAX_AUDIO_SECONDS:'5',NONIUS_BUDGET_PATH:join(directory,'budget.json')});
  const {server,budget}=createApplication({config,Upstream:FakeUpstream});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`ws://127.0.0.1:${server.address().port}/api/stream`;const client=new WebSocket(base);
  const messages=[];client.on('message',b=>messages.push(JSON.parse(b.toString())));
  try{
    await once(client,'open');await new Promise(resolve=>setTimeout(resolve,20));assert.equal(messages[0].type,'Begin');
    client.send(Buffer.alloc(3200,7));client.send(JSON.stringify({type:'DeleteEverything'}));client.send(JSON.stringify({type:'ForceEndpoint'}));
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(Buffer.isBuffer(upstream.sent[0]));assert.deepEqual(upstream.sent[0],Buffer.alloc(3200,7));
    assert.deepEqual(upstream.sent.slice(1).map(x=>JSON.parse(x.toString())),[{type:'ForceEndpoint'}]);
    upstream.emit('message',Buffer.from(JSON.stringify({type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'B'}]})));
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(messages.at(-1).type,'SpeakerRevision');
    const closed=once(client,'close');client.send(Buffer.alloc(3));await closed;
    assert.ok(messages.some(m=>m.type==='Error'&&m.message==='Audio limit reached.'));
    assert.equal(budget.snapshot().audioSecondsReserved,5);
    const blocked=new WebSocket(base);const status=await new Promise(resolve=>{blocked.on('unexpected-response',(_r,res)=>{res.resume();blocked.terminate();resolve(res.statusCode);});blocked.on('error',()=>{});});
    assert.equal(status,429);assert.equal(budget.snapshot().audioSecondsReserved,5);
  }finally{client.terminate();upstream?.terminate();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true});}
});

test('voice-command streams omit the paid speaker add-on',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'nonius-command-'));let upstream;
  class FakeUpstream extends EventEmitter{
    constructor(url){super();upstream=this;this.readyState=WebSocket.OPEN;this.bufferedAmount=0;
      assert.equal(new URL(url).searchParams.has('speaker_labels'),false);
      setImmediate(()=>this.emit('message',Buffer.from(JSON.stringify({type:'Begin'}))));}
    send(){} terminate(){this.readyState=WebSocket.CLOSED;this.emit('close');}
  }
  const config=configuration({ASSEMBLYAI_API_KEY:'test-only-placeholder',NONIUS_BUDGET_PATH:join(directory,'budget.json')});
  const {server,budget}=createApplication({config,Upstream:FakeUpstream});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const client=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/stream?purpose=question`);
  try{await once(client,'message');assert.equal(budget.snapshot().audioSecondsReserved,25);}
  finally{client.terminate();upstream?.terminate();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true});}
});

test('ending a stream waits for delayed final words, speaker revisions and the termination acknowledgement',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'nonius-final-'));let upstream;
  class DelayedUpstream extends EventEmitter{
    constructor(){super();upstream=this;this.readyState=WebSocket.OPEN;this.bufferedAmount=0;this.commands=[];this.timers=[];
      setImmediate(()=>this.emit('message',Buffer.from(JSON.stringify({type:'Begin'}))));}
    send(data){
      if(Buffer.isBuffer(data)){this.commands.push('audio');return;}
      const command=JSON.parse(data);this.commands.push(command.type);
      if(command.type==='Terminate')this.timers.push(setTimeout(()=>{
        for(const event of [
          {type:'Turn',end_of_turn:true,turn_order:0,speaker_label:'A',transcript:'The final words arrived.'},
          {type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'B'}]},
          {type:'Termination',audio_duration_seconds:1}
        ])this.emit('message',Buffer.from(JSON.stringify(event)));
      },2100));
    }
    terminate(){this.timers.forEach(clearTimeout);this.readyState=WebSocket.CLOSED;this.emit('close');}
  }
  const config=configuration({ASSEMBLYAI_API_KEY:'test-only-placeholder',NONIUS_MAX_SESSION_SECONDS:'10',NONIUS_BUDGET_PATH:join(directory,'budget.json')});
  const {server,budget}=createApplication({config,Upstream:DelayedUpstream});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const client=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/stream`),messages=[];
  client.on('message',b=>messages.push(JSON.parse(b.toString())));
  try{
    await once(client,'message');const closed=once(client,'close');
    client.send(JSON.stringify({type:'Terminate'}));client.send(JSON.stringify({type:'Terminate'}));client.send(Buffer.alloc(3200));
    await closed;
    assert.deepEqual(messages.map(m=>m.type),['Begin','Turn','SpeakerRevision','Termination']);
    assert.equal(messages[1].transcript,'The final words arrived.');
    assert.deepEqual(upstream.commands,['Terminate']);assert.equal(upstream.readyState,WebSocket.CLOSED);
    assert.equal(budget.snapshot().audioSecondsReserved,10);
  }finally{client.terminate();upstream?.terminate();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true});}
});
