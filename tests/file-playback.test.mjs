import test from 'node:test';
import assert from 'node:assert/strict';
import {pcmForPlayback,playbackReader} from '../public/file-playback.js';

test('audible playback and cloud transcription share mono PCM with one silent endpointing second',()=>{
  const input=Float32Array.from([-1,-0.5,0,0.5,1,2,-2]),before=input.slice();
  const pcm=pcmForPlayback(input);
  assert.deepEqual([...pcm.slice(0,7)],[-32768,-16384,0,16384,32767,32767,-32768]);
  assert.equal(pcm.length,16007);assert.ok(pcm.slice(7).every(x=>x===0));assert.deepEqual(input,before);
});

test('a paused media clock sends no extra audio and late timer ticks catch up without duplicates',()=>{
  const pcm=Int16Array.from({length:8007},(_,i)=>i),reader=playbackReader(pcm),sent=[];
  assert.equal(reader.take(0).length,0);assert.equal(reader.take(0.099).length,0);
  sent.push(...reader.take(0.1));assert.equal(sent[0].byteLength,3200);
  assert.equal(reader.take(0.1).length,0);assert.equal(reader.take(0.09).length,0);
  sent.push(...reader.take(0.45));assert.equal(reader.complete,false);
  sent.push(...reader.take(pcm.length/16000,true));assert.equal(reader.complete,true);
  assert.equal(reader.take(99,true).length,0);
  assert.deepEqual(Buffer.concat(sent.map(b=>Buffer.from(b))),Buffer.from(pcm.buffer));
});

test('clock pacing never uploads words ahead of the played samples',()=>{
  const pcm=new Int16Array(17003),reader=playbackReader(pcm);let sentSamples=0;
  for(let ms=0;ms<=1000;ms+=37){
    sentSamples+=reader.take(ms/1000).reduce((sum,b)=>sum+b.byteLength/2,0);
    assert.ok(sentSamples<=ms*16);assert.ok(ms*16-sentSamples<1600);
  }
  sentSamples+=reader.take(pcm.length/16000,true).reduce((sum,b)=>sum+b.byteLength/2,0);
  assert.equal(sentSamples,pcm.length);
});

test('stopping an import early leaves only audio already played in the saved stream',()=>{
  const pcm=new Int16Array(16000),reader=playbackReader(pcm);
  const chunks=reader.take(0.35);assert.equal(chunks.reduce((n,b)=>n+b.byteLength/2,0),4800);
  assert.equal(reader.complete,false);assert.equal(reader.take(0.35).length,0);
});
