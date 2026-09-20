class PCMRecorder extends AudioWorkletProcessor {
  constructor(){super();this.buffer=[];this.phase=0;this.acc=0;this.count=0;}
  process(inputs){
    const input=inputs[0]?.[0];if(!input)return true;
    const ratio=sampleRate/16000;
    for(let i=0;i<input.length;i++){
      this.acc+=input[i];this.count++;this.phase++;
      if(this.phase>=ratio){
        const value=Math.max(-1,Math.min(1,this.acc/this.count));
        this.buffer.push(Math.round(value*(value<0?32768:32767)));
        this.phase-=ratio;this.acc=0;this.count=0;
      }
      if(this.buffer.length>=1600){const pcm=new Int16Array(this.buffer);this.port.postMessage(pcm.buffer,[pcm.buffer]);this.buffer=[];}
    }
    return true;
  }
}
registerProcessor('pcm-recorder',PCMRecorder);
