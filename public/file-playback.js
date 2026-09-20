// The media clock drives upload pacing so sound and sent PCM cannot drift apart.
export function pcmForPlayback(floats,sampleRate=16000){
  const pcm=new Int16Array(floats.length+sampleRate); // One second for endpointing.
  for(let i=0;i<floats.length;i++){
    const value=Math.max(-1,Math.min(1,floats[i]));pcm[i]=Math.round(value*(value<0?32768:32767));
  }
  return pcm;
}

export function playbackReader(pcm,{sampleRate=16000,chunkSamples=1600}={}){
  let offset=0;
  return {
    take(seconds,ended=false){
      const due=ended?pcm.length:Math.min(pcm.length,Math.max(0,Math.floor(seconds*sampleRate)));
      const chunks=[];
      while(offset<due){
        const end=Math.min(offset+chunkSamples,pcm.length);
        if(end>due)break;
        chunks.push(pcm.slice(offset,end).buffer);offset=end;
      }
      return chunks;
    },
    get complete(){return offset===pcm.length;}
  };
}
