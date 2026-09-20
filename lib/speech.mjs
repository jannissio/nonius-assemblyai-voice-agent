import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeWav} from './wav.mjs';

export function synthesizeLocal(text) {
  if(typeof text!=='string'||!text.trim()||text.length>1000)throw new Error('Speech must contain 1–1,000 characters.');
  if(process.platform!=='win32')throw new Error('Local Windows speech is unavailable; use browser speech.');
  return new Promise((resolve,reject)=>{
    // Text is data on stdin, never interpolated into a command or script.
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../scripts/synthesize.ps1',import.meta.url))],
      {windowsHide:true,stdio:['pipe','pipe','pipe']});
    let done=false,size=0;const chunks=[];
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);if(error){child.kill();reject(error);}else resolve(writeWav(Buffer.concat(chunks)));};
    const timer=setTimeout(()=>finish(new Error('Local speech timed out.')),18000);
    child.on('error',()=>finish(new Error('Local speech could not start.')));
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>6000000)return finish(new Error('Local speech exceeded its size limit.'));chunks.push(chunk);});
    child.stderr.resume();child.stdin.on('error',()=>{});
    child.on('close',code=>finish(code===0&&size>44?null:new Error('Local speech generation failed.')));
    child.stdin.end(JSON.stringify({text}),'utf8');
  });
}
