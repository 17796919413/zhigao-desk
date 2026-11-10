// Isolated control-plane tests. The Python fixture has no network or model dependency.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'zhigao-media-runtime-'));
const runtime=path.join(temp,'private'),checks=[];
process.env.ZHIGAO_MEDIA_HOME=runtime;
fs.copyFileSync(path.join(source,'media-runtime.mjs'),path.join(temp,'media-runtime.mjs'));
fs.writeFileSync(path.join(temp,'media-worker.py'),String.raw`import argparse,sys,json,time,hashlib,wave
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('command');p.add_argument('--model');p.add_argument('--model-path');p.add_argument('--cache');p.add_argument('--input');p.add_argument('--out');a=p.parse_args()
model=a.model or 'large-v3-turbo';mp=Path(__file__).parent/'models'/model;mp.mkdir(parents=True,exist_ok=True)
if not (mp/'model.bin').exists(): (mp/'model.bin').write_bytes(b'fixture')
if a.command=='doctor': print(json.dumps({'ready':True,'missing':[],'model':model,'modelPath':str(mp),'python':sys.executable}))
elif a.command=='download': time.sleep(.2);print(json.dumps({'modelPath':str(mp)}))
elif a.command=='process':
 out=Path(a.out);(out/'audio').mkdir(exist_ok=True);wav=out/'temp.wav'
 with wave.open(str(wav),'wb') as w: w.setparams((1,2,16000,0,'NONE','not compressed'));w.writeframes(b'\0'*3200)
 data=wav.read_bytes();digest=hashlib.sha256(data).hexdigest();file='audio/'+digest+'.wav';wav.replace(out/file)
 report={'sourceHash':hashlib.sha256(Path(a.input).read_bytes()).hexdigest(),'model':model,'decodedFrames':1,'uniqueFrames':1,'assets':[{'id':'test-audio','type':'prepared-video-audio','file':file,'sha256':digest,'track':0,'channel':0,'start':0,'end':.1,'reviewReasons':['low-confidence-transcript']}]}
 raw=json.dumps(report).encode();(out/'report.json').write_bytes(raw);(out/'progress.json').write_text(json.dumps({'state':'complete','reportHash':hashlib.sha256(raw).hexdigest()}));print('{}')
`);
const module=await import(pathToFileURL(path.join(temp,'media-runtime.mjs')).href);
const note=name=>{checks.push(name);console.log('PASS '+name);};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));
async function wait(fn){for(let i=0;i<300;i++){const x=await fn();if(x)return x;await new Promise(r=>setTimeout(r,100));}throw Error('Fixture wait timed out');}
try{
 await module.setupMedia();
 const reuse=await module.beginMediaSetup();assert.equal(reuse.state,'ready');note('Ready runtime reuses matching model');
 const changed=await module.beginMediaSetup({model:'tiny'});assert.equal(changed.state,'running');
 await wait(()=>module.mediaSetupProgress().state==='ready');assert.equal((await module.mediaDoctor()).model,'tiny');note('Explicit model change is honored in an already ready runtime');
 const parallel=await Promise.allSettled([module.setupMedia({model:'small'}),module.setupMedia({model:'medium'})]);
 assert.equal(parallel.filter(x=>x.status==='fulfilled').length,1);assert.equal(parallel.find(x=>x.status==='rejected').reason.code,'MEDIA_SETUP_BUSY');note('Concurrent setup has a single writer and a retryable busy response');
 save(path.join(runtime,'setup.lock'),{pid:2147483647});save(path.join(runtime,'setup-progress.json'),{state:'running',pid:2147483647});assert.equal(module.mediaSetupProgress().state,'interrupted');
 await module.setupMedia();assert.equal(module.mediaSetupProgress().state,'ready');note('Interrupted setup resumes after a dead owner');
 await assert.rejects(module.beginMediaSetup({model:'../../arbitrary'}),/不支持/);note('Unsupported explicit model is rejected');
 const common={docId:'synthetic',projectId:'test-brand',revision:'rev-1'};
 const begin=await module.mediaAction({action:'begin',...common,size:4}),binding={...common,jobId:begin.jobId,jobToken:begin.jobToken};
 fs.appendFileSync(path.join(runtime,'jobs',begin.jobId,'source.media'),'uncommitted bytes');
 await module.mediaAction({action:'chunk',...binding,offset:0,data:Buffer.from('test').toString('base64')});
 assert.equal(fs.readFileSync(path.join(runtime,'jobs',begin.jobId,'source.media'),'utf8'),'test');note('Interrupted upload discards only an uncommitted chunk tail');
 await module.mediaAction({action:'start',...binding});assert.equal(module.mediaBusy(),true);
 await wait(async()=>{const s=await module.mediaAction({action:'status',...binding});if(s.state==='failed')throw Error(s.error);return s.state==='complete';});
 await wait(()=>!module.mediaBusy());note('Prepared jobs hold busy state until the worker exits');
 const audio=await module.mediaAction({action:'asset',...binding,assetId:'test-audio'});assert.equal(audio.type,'audio');assert.equal(audio.mimeType,'audio/wav');assert.equal(Buffer.from(audio.data,'base64').subarray(0,4).toString(),'RIFF');note('Verified required audio returns native WAV payload');
 await assert.rejects(module.mediaAction({action:'asset',...binding,projectId:'other',assetId:'test-audio'}),/不匹配/);note('Audio access remains bound to the source brand and revision');
 const dir=path.join(runtime,'jobs',begin.jobId),report=read(path.join(dir,'report.json')),audioFile=path.join(dir,report.assets[0].file),original=fs.readFileSync(audioFile);fs.appendFileSync(audioFile,'tamper');
 await assert.rejects(module.mediaAction({action:'asset',...binding,assetId:'test-audio'}),/已改变/);fs.writeFileSync(audioFile,original);note('Tampered source audio cannot produce a receipt');
 const configFile=path.join(runtime,'runtime.json'),config=read(configFile);save(configFile,{...config,model:'medium'});
 assert.equal((await module.mediaAction({action:'status',...binding})).state,'interrupted');await assert.rejects(module.mediaAction({action:'result',...binding}),/模型已变化/);save(configFile,config);note('Changing models invalidates completed preparation for reuse');
 save(configFile,{...config,modelPath:path.join(temp,'different-model')});assert.equal((await module.mediaAction({action:'status',...binding})).state,'interrupted');save(configFile,config);
 fs.appendFileSync(path.join(config.modelPath,'model.bin'),'changed-model-content');assert.equal((await module.mediaAction({action:'status',...binding})).state,'interrupted');note('Same-name model path and content changes invalidate old completed jobs');
 const metaFile=path.join(dir,'meta.json'),meta=read(metaFile);save(metaFile,{...meta,workerHash:'0'.repeat(64)});
 assert.equal((await module.mediaAction({action:'status',...binding})).state,'interrupted');save(metaFile,{...meta,ownerPid:2147483647});save(path.join(dir,'progress.json'),{state:'running',pid:2147483647});
 assert.equal((await module.mediaAction({action:'status',...binding})).state,'interrupted');
 await module.mediaAction({action:'retry',...binding});await wait(async()=>{const s=await module.mediaAction({action:'status',...binding});if(s.state==='failed')throw Error(s.error);return s.state==='complete';});await wait(()=>!module.mediaBusy());note('Worker updates and dead processing owners require safe retry');
 console.log(JSON.stringify({total:checks.length,checks}));
}finally{await wait(()=>!module.mediaBusy());fs.rmSync(temp,{recursive:true,force:true});}
