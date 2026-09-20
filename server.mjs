import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {WebSocketServer,WebSocket} from 'ws';
import {configuration} from './lib/config.mjs';
import {Budget} from './lib/budget.mjs';
import {normalizeTurn} from './lib/evidence.mjs';
import {proposeFollowups,PROMPT_VERSION} from './lib/followups.mjs';
import {synthesizeLocal} from './lib/speech.mjs';
import {createHash,timingSafeEqual} from 'node:crypto';

const ROOT=dirname(fileURLToPath(import.meta.url));
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
 '.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.wav':'audio/wav','.ico':'image/x-icon'};

function securityHeaders(res){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','microphone=(self), camera=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
function reply(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
function validOrigin(req){
  if(!req.headers.origin)return true; // Local CLI/testing. Browsers supply Origin on writes.
  try{return new URL(req.headers.origin).host===req.headers.host;}catch{return false;}
}
async function jsonBody(req){let bytes=0,parts=[];for await(const part of req){bytes+=part.length;if(bytes>48000){const e=new Error('Request exceeds 48 KB.');e.status=413;throw e;}parts.push(part);}return JSON.parse(Buffer.concat(parts).toString());}

export function createApplication({config=configuration(),budget=new Budget(config),analyze=proposeFollowups,synthesize=synthesizeLocal,Upstream=WebSocket}={}) {
  if(config.key&&!['127.0.0.1','localhost','::1'].includes(config.host)&&config.demoPassword.length<16)
    throw new Error('A non-local live server requires a NONIUS_DEMO_PASSWORD of at least 16 characters.');
  const validHost=req=>{try{return config.allowedHosts.includes(new URL(`http://${req.headers.host}`).hostname);}catch{return false;}};
  const digest=value=>createHash('sha256').update(value).digest();
  const authorized=req=>!config.demoPassword||timingSafeEqual(digest(req.headers.authorization||''),digest('Basic '+Buffer.from(`nonius:${config.demoPassword}`).toString('base64')));
  const rate=new Map();let activeStreams=0,activeAnalysis=0,activeSpeech=0;
  const allow=(req,type,max=25)=>{const key=`${req.socket.remoteAddress}:${type}`;const now=Date.now();
    let bucket=rate.get(key);if(!bucket||bucket.until<now)bucket={count:0,until:now+60000};
    bucket.count++;rate.set(key,bucket);if(rate.size>1000){for(const [k,v]of rate)if(v.until<now)rate.delete(k);}return bucket.count<=max;};
  const server=http.createServer(async(req,res)=>{
    securityHeaders(res);
    try{
      if(!validHost(req))return reply(res,403,{error:'This host is not allowed.'});
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/healthz')return reply(res,200,{status:'ok',application:'Nonius'});
      if(!authorized(req)){res.setHeader('WWW-Authenticate','Basic realm="Nonius demo", charset="UTF-8"');return reply(res,401,{error:'This demonstration requires access credentials.'});}
      if(req.method==='GET'&&url.pathname==='/api/config')return reply(res,200,{liveAvailable:Boolean(config.key),
        speechModel:config.speechModel,speakerDetection:true,llmModel:config.llmModel,promptVersion:PROMPT_VERSION,localSpeechAvailable:process.platform==='win32',maxSessionSeconds:config.maxSessionSeconds,budget:budget.snapshot()});
      if(req.method==='POST'&&url.pathname==='/api/speak'){
        if(!validOrigin(req)||req.headers['x-nonius-client']!=='interview-desk')return reply(res,403,{error:'Same-origin client required.'});
        if(!allow(req,'speech',12)||activeSpeech>=1)return reply(res,429,{error:'Please wait for the current spoken response.'});
        const body=await jsonBody(req);if(typeof body.text!=='string'||!body.text.trim()||body.text.length>1000)return reply(res,400,{error:'Speech must contain 1–1,000 characters.'});
        activeSpeech++;try{const wav=await synthesize(body.text);res.writeHead(200,{'content-type':'audio/wav','cache-control':'no-store','content-length':wav.length});return res.end(wav);}finally{activeSpeech--;}
      }
      if(req.method==='POST'&&url.pathname==='/api/analyze'){
        if(!validOrigin(req)||req.headers['x-nonius-client']!=='interview-desk')return reply(res,403,{error:'Same-origin client required.'});
        if(!allow(req,'analysis')||activeAnalysis>=2)return reply(res,429,{error:'Please wait for the current analysis to finish.'});
        const body=await jsonBody(req);
        if(!Array.isArray(body.turns)||!body.turns.length||body.turns.length>30) return reply(res,400,{error:'Provide 1–30 transcript turns.'});
        const turns=body.turns.map((raw,index)=>({...normalizeTurn(raw,index),speakerReviewRequired:raw.speakerReviewRequired===true}));
        if(new Set(turns.map(t=>t.id)).size!==turns.length||turns.reduce((n,t)=>n+t.text.length,0)>18000) return reply(res,400,{error:'Transcript is too long or has duplicate identifiers.'});
        activeAnalysis++;
        try{
          const result=await analyze({turns,brief:typeof body.brief==='string'?body.brief:'',goals:Array.isArray(body.goals)?body.goals:[],previousCues:Array.isArray(body.previousCues)?body.previousCues:[]},
            {config,budget,forceRules:body.engine==='rules'});
          const {raw,...visible}=result;
          return reply(res,200,{...visible,budget:budget.snapshot()});
        }finally{activeAnalysis--;}
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return reply(res,405,{error:'Method not allowed.'});
      let relative;
      if(url.pathname==='/')relative='public/index.html';
      else if(['/lib/evidence.mjs','/lib/speakers.mjs','/lib/cues.mjs','/lib/analysis-passages.mjs'].includes(url.pathname))relative=url.pathname.slice(1);
      else if(url.pathname==='/vendor/fflate.mjs')relative='node_modules/fflate/esm/browser.js';
      else if(/^\/fixtures\/[a-zA-Z0-9_.-]+\.(json|wav)$/.test(url.pathname))relative=url.pathname.slice(1);
      else if(/^\/[a-zA-Z0-9_./-]+\.(html|css|js|mjs|svg|png|ico)$/.test(url.pathname)&&!url.pathname.includes('..'))relative=`public${url.pathname}`;
      else return reply(res,404,{error:'Not found.'});
      const path=resolve(ROOT,relative);
      const info=await stat(path).catch(()=>null);if(!info?.isFile())return reply(res,404,{error:'Not found.'});
      const headers={'content-type':MIME[extname(path)]||'application/octet-stream','cache-control':'no-cache','accept-ranges':'bytes'};
      if(req.headers.range){const m=req.headers.range.match(/^bytes=(\d+)-(\d*)$/);if(!m)return reply(res,416,{error:'Invalid range.'});
        const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),info.size-1):info.size-1;
        if(start>end||start>=info.size)return reply(res,416,{error:'Invalid range.'});
        const data=await readFile(path);res.writeHead(206,{...headers,'content-length':end-start+1,'content-range':`bytes ${start}-${end}/${info.size}`});
        return res.end(req.method==='HEAD'?undefined:data.subarray(start,end+1));}
      res.writeHead(200,{...headers,'content-length':info.size});res.end(req.method==='HEAD'?undefined:await readFile(path));
    }catch(error){
      if(res.headersSent){res.end();return;}
      const status=['BUDGET_EXHAUSTED','LLM_COOLDOWN'].includes(error.code)?429:error.code==='PROVIDER_ERROR'?502:error.name==='TimeoutError'?504:error.status||400;
      // No upstream response body, request headers, or credentials are logged or returned.
      reply(res,status,{error:error.code==='PROVIDER_ERROR'?error.message:error.name==='TimeoutError'?'Analysis timed out. Please retry or use local checks.':error.message?.slice(0,180)||'Request failed.'});
    }
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:64000,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    let url;try{url=new URL(req.url,'http://localhost');}catch{socket.destroy();return;}
    if(url.pathname!=='/api/stream'||!validHost(req)||!authorized(req)||!validOrigin(req)||!config.key||activeStreams>=1||!allow(req,'stream',4)){
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    const sessionSeconds=url.searchParams.get('purpose')==='question'?Math.min(25,config.maxSessionSeconds):config.maxSessionSeconds;
    try{budget.reserve('audio',{seconds:sessionSeconds});}catch{socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    activeStreams++;
    wss.handleUpgrade(req,socket,head,client=>{
      let closed=false,ready=false,totalBytes=0,upstream,terminating=false,terminated=false,terminationTimeout;
      const send=payload=>{if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify(payload));};
      const close=()=>{if(closed)return;closed=true;activeStreams--;clearTimeout(hardStop);clearTimeout(connectTimeout);clearTimeout(terminationTimeout);
        if(upstream?.readyState===WebSocket.OPEN){
          if(terminated)upstream.terminate();
          else {if(!terminating){terminating=true;upstream.send(JSON.stringify({type:'Terminate'}));}setTimeout(()=>upstream.terminate(),1000).unref();}}
        else if(upstream?.readyState===WebSocket.CONNECTING)upstream.terminate();
        if(client.readyState===WebSocket.OPEN)client.close(1000,'Session ended');};
      const hardStop=setTimeout(()=>{send({type:'Limit',message:'Session limit reached. Your notes remain available.'});close();},sessionSeconds*1000);
      const connectTimeout=setTimeout(()=>{if(!ready){send({type:'Error',message:'The speech service did not connect.'});close();}},15000);
      const query=new URLSearchParams({sample_rate:'16000',encoding:'pcm_s16le',speech_model:config.speechModel,
        include_partial_turns:'true',inactivity_timeout:'30'});
      if(url.searchParams.get('purpose')!=='question')query.set('speaker_labels','true');
      try{upstream=new Upstream(`wss://streaming.assemblyai.com/v3/ws?${query}`,{headers:{Authorization:config.key},handshakeTimeout:12000,maxPayload:1024*1024});}
      catch{send({type:'Error',message:'Speech connection failed.'});close();return;}
      upstream.on('message',data=>{let event;try{event=JSON.parse(data.toString());}catch{return;}
        if(event.type==='Begin'){ready=true;clearTimeout(connectTimeout);}
        if(['Begin','Turn','Termination','SpeechStarted','SpeakerRevision','Heartbeat'].includes(event.type))send(event);
        else if(event.type==='Error'||event.error){send({type:'Error',message:'AssemblyAI could not process this audio. Check the local settings and retry.'});close();}
        if(event.type==='Termination'){terminated=true;close();}
      });
      upstream.on('unexpected-response',(_request,response)=>{response.resume();send({type:'Error',message:`Speech service returned HTTP ${response.statusCode}.`});close();});
      upstream.on('error',()=>{send({type:'Error',message:'Speech service connection failed. The sample interview is available.'});close();});
      upstream.on('close',()=>close());
      client.on('message',(data,binary)=>{
        if(binary){if(!ready||terminating||upstream.readyState!==WebSocket.OPEN)return;
          totalBytes+=data.length;
          if(data.length%2||totalBytes>sessionSeconds*32000||upstream.bufferedAmount>1024*1024){send({type:'Error',message:'Audio limit reached.'});close();return;}
          upstream.send(data);return;}
        let event;try{event=JSON.parse(data.toString());}catch{return;}
        if(event.type==='Terminate'&&!terminating){
          if(!ready){close();return;}
          terminating=true;upstream.send(JSON.stringify({type:'Terminate'}));
          // Continue forwarding final words and revisions until the provider's
          // acknowledgement. The original hard session/budget limit still applies.
          terminationTimeout=setTimeout(()=>{send({type:'Error',message:'Final transcription confirmation timed out. Review the ending against the audio.'});close();},8000);terminationTimeout.unref();
        }
        if(event.type==='ForceEndpoint'&&ready&&!terminating)upstream.send(JSON.stringify({type:'ForceEndpoint'}));
      });
      client.on('close',close);client.on('error',close);
    });
  });
  server.on('close',()=>{for(const c of wss.clients)c.terminate();wss.close();});
  return {server,budget,config};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const app=createApplication();app.server.listen(app.config.port,app.config.host,()=>console.log(`Nonius ready at http://${app.config.host}:${app.config.port} (local only by default)`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{app.server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();});
}
