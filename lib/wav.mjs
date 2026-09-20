export function readWav(bytes){
  const b=Buffer.from(bytes);if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw new Error('Invalid WAV header.');
  let format=null,pcm=null;
  for(let p=12;p+8<=b.length;){const name=b.toString('ascii',p,p+4),size=b.readUInt32LE(p+4);if(p+8+size>b.length)throw new Error('Truncated WAV chunk.');
    if(name==='fmt '){if(size<16)throw new Error('Invalid WAV format.');format={encoding:b.readUInt16LE(p+8),channels:b.readUInt16LE(p+10),sampleRate:b.readUInt32LE(p+12),bits:b.readUInt16LE(p+22)};}
    if(name==='data')pcm=b.subarray(p+8,p+8+size);p+=8+size+(size%2);
  }
  if(!format||!pcm||format.encoding!==1||format.channels!==1||format.bits!==16||format.sampleRate!==16000||pcm.length%2)throw new Error('Expected 16 kHz mono PCM16 WAV.');
  return {...format,pcm,seconds:pcm.length/32000};
}
export function writeWav(pcm){const data=Buffer.from(pcm);const b=Buffer.alloc(44+data.length);b.write('RIFF');b.writeUInt32LE(36+data.length,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(data.length,40);data.copy(b,44);return b;}
