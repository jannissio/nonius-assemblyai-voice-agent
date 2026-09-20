import {WebSocket} from 'ws';
import {readWav} from './wav.mjs';

export async function transcribeWav(bytes,{config,budget}) {
  const audio=readWav(bytes);const reservationSeconds=Math.ceil(audio.seconds+12);
  budget.reserve('audio',{seconds:reservationSeconds});
  return new Promise((resolve,reject)=>{
    const params=new URLSearchParams({sample_rate:'16000',encoding:'pcm_s16le',speech_model:config.speechModel,include_partial_turns:'false'});
    const socket=new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`,{headers:{Authorization:config.key},handshakeTimeout:12000});
    const turns=new Map(),events=[];let timer,offset=0,done=false,began=false,started=performance.now();
    const hardStop=setTimeout(()=>finish(new Error('Speech test timed out.')),reservationSeconds*1000+5000);
    function finish(error){if(done)return;done=true;clearInterval(timer);clearTimeout(hardStop);socket.terminate();if(error)reject(error);else resolve({
      speechModel:config.speechModel,inputAudioSeconds:audio.seconds,elapsedMs:Math.round(performance.now()-started),
      turns:[...turns.values()].sort((a,b)=>a.turn_order-b.turn_order),events,transcript:[...turns.values()].sort((a,b)=>a.turn_order-b.turn_order).map(t=>t.transcript).join(' ')});}
    socket.on('unexpected-response',(_request,response)=>{response.resume();finish(new Error(`Speech service returned HTTP ${response.statusCode}.`));});
    socket.on('error',error=>finish(new Error(`Speech connection failed (${error.code||'connection error'}).`)));
    socket.on('close',()=>{if(!done)finish(began?undefined:new Error('Speech connection closed before Begin.'));});
    socket.on('message',buffer=>{let event;try{event=JSON.parse(buffer.toString());}catch{return;}
      if(event.type==='Begin'){began=true;events.push({type:event.type,configuration:event.configuration||null});timer=setInterval(()=>{
        if(socket.readyState!==WebSocket.OPEN)return;
        if(offset<audio.pcm.length){socket.send(audio.pcm.subarray(offset,Math.min(offset+3200,audio.pcm.length)));offset+=3200;}
        else {clearInterval(timer);socket.send(Buffer.alloc(16000));setTimeout(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ForceEndpoint'}));},550);setTimeout(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'Terminate'}));},1800);}
      },100);}
      if(event.type==='Turn'&&event.end_of_turn)turns.set(event.turn_order,event);
      if(event.type==='Termination'){events.push(event);finish();}
      if(event.type==='Error'||event.error)finish(new Error(`Speech provider rejected the session: ${String(event.error||event.message||'unknown error').replaceAll(config.key,'[REDACTED]').slice(0,200)}`));
    });
  });
}
