import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
const path=process.argv[2];if(!path)throw new Error('Usage: node scripts/verify-bundle.mjs path/to/interview.zip [report.json]');
const bytes=readFileSync(path);if(bytes.length>25*1024*1024)throw new Error('Bundle exceeds the local review size limit.');
const allowed=new Set(['interview.json','notes.md','interview.wav','manifest.json']);
const files=unzipSync(bytes,{filter:f=>allowed.has(f.name)&&f.originalSize<=20*1024*1024});
const manifest=JSON.parse(strFromU8(files['manifest.json']));
const checked=manifest.files.map(row=>{const file=files[row.name];return {name:row.name,valid:!!file&&file.length===row.bytes&&createHash('sha256').update(file).digest('hex')===row.sha256};});
if(checked.some(r=>!r.valid))throw new Error('A bundle file does not match its manifest.');
const interview=JSON.parse(strFromU8(files['interview.json']));
const report={checkedAt:new Date().toISOString(),bundle:path,manifestValid:true,files:checked,mode:interview.mode,
  turns:interview.turns.length,savedExcerpts:interview.quotes.length,reporterAudioAttestations:interview.quotes.filter(q=>q.audioChecked).length,
  voiceCommands:interview.events.filter(e=>e.type==='companion_question'),
  speechEvents:interview.events.filter(e=>e.type.startsWith('speech_')),
  limitations:'Checksums establish file consistency, not authenticity or truth. Automated rehearsal is not human validation.'};
if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
