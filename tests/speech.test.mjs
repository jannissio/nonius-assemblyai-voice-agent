import test from 'node:test';
import assert from 'node:assert/strict';
import {synthesizeLocal} from '../lib/speech.mjs';
import {readWav} from '../lib/wav.mjs';
test('speech rejects empty, non-text and excessive input before starting a process',()=>{
  for(const text of ['',{},'a'.repeat(1001)])assert.throws(()=>synthesizeLocal(text),/characters/);
});
test('Windows local speech produces playable mono PCM without a cloud request',{skip:process.platform!=='win32'},async()=>{
  const wav=await synthesizeLocal('What is the baseline for that comparison?');const parsed=readWav(wav);
  assert.ok(parsed.seconds>1&&parsed.seconds<10);assert.ok(parsed.pcm.some(x=>x!==0));
});
