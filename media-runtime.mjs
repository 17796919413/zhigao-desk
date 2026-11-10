// Private local runtime and resumable jobs; never accepts arbitrary executable paths from the page.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const ROOT=process.env.ZHIGAO_MEDIA_HOME||path.join(os.homedir(),'.zhigao','media');
const WORKER=fileURLToPath(new URL('./media-worker.py',import.meta.url));
const VENV=path.join(ROOT,'runtime'),PYTHON=path.join(VENV,process.platform==='win32'?'Scripts/python.exe':'bin/python');
const configPath=path.join(ROOT,'runtime.json'),jobs=path.join(ROOT,'jobs'),running=new Set();let queue=Promise.resolve();
const setupState=path.join(ROOT,'setup-progress.json');
const MODELS=['large-v3-turbo','large-v3','medium','small','tiny'];
function alive(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
export function mediaSetupProgress(){if(!fs.existsSync(setupState))return {state:'not_started'};const value=read(setupState);return value.state==='running'&& !alive(value.pid)?{...value,state:'interrupted'}:value;}
export async function beginMediaSetup(options={}){
 if(options.model!==undefined&&!MODELS.includes(options.model))throw Error('不支持的转写模型。');
 const prior=mediaSetupProgress();if(prior.state==='running')return {...prior,requestedModel:options.model||null,next:'等待当前安装完成后再次调用setup，核对返回模型。'};
 const status=await mediaDoctor();if(status.ready&&(!options.model||options.model===status.model))return {state:'ready',runtime:status};
 setupMedia(options).catch(e=>{if(e.code!=='MEDIA_SETUP_BUSY')save(setupState,{state:'failed',error:e.message,requestedModel:options.model||null});});return {state:'running',requestedModel:options.model||null,next:'查询 zhigao_video_runtime_status，setupProgress.state=ready且模型符合请求后继续视频准备。'};
}
export function mediaBusy(){return running.size>0||mediaSetupProgress().state==='running';}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function modelStamp(dir){
 if(!dir)return null;
 try{
  const entries=[],walk=root=>{for(const name of fs.readdirSync(root).sort()){const file=path.join(root,name),stat=fs.statSync(file);if(stat.isDirectory())walk(file);else entries.push([path.relative(dir,file),fs.realpathSync(file),stat.size,stat.mtimeMs,stat.ctimeMs]);}};
  walk(dir);return sha(JSON.stringify(entries));
 }catch{return null;}
}
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function save(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});const tmp=p+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(v));fs.renameSync(tmp,p);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
function run(command,args,timeout=1800000){return new Promise((resolve,reject)=>{let stdout='',stderr='';const child=spawn(command,args,{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1'}}),timer=setTimeout(()=>{child.kill();reject(Error('本地组件运行超时，任务未完成。'));},timeout);child.on('error',e=>{clearTimeout(timer);reject(e);});child.stdout.on('data',b=>{stdout+=b;if(stdout.length>4*1024*1024){child.kill();reject(Error('组件输出超过限制。'));}});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000);});child.on('close',code=>{clearTimeout(timer);if(code)reject(Error(stdout.slice(-2000)||stderr||'本地组件执行失败'));else resolve(stdout);});});}
function python(){if(fs.existsSync(PYTHON))return PYTHON;const privatePython=path.join(ROOT,'python','python.exe');if(process.platform==='win32'&&fs.existsSync(privatePython))return privatePython;for(const exe of process.platform==='win32'?['python','python3']:['python3','python']){const p=spawnSync(exe,['-c','import sys; assert sys.version_info >= (3,10); print(sys.executable)'],{encoding:'utf8',windowsHide:true,timeout:10000});if(!p.status&&p.stdout?.trim())return p.stdout.trim();}return null;}
async function bootstrapPython(){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('当前Agent需先从Python官方来源安装私有Python 3.10+；本机自动引导暂支持Windows x64。完成后原命令继续，不重复配置已存在组件。');
 const target=path.join(ROOT,'python'),installer=path.join(ROOT,'python-3.13.17-amd64.exe');
 if(!fs.existsSync(installer)){const response=await fetch('https://www.python.org/ftp/python/3.13.17/python-3.13.17-amd64.exe',{signal:AbortSignal.timeout(600000),redirect:'error'});if(!response.ok)throw Error('Python官方运行时下载失败。');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length<1000000||bytes.length>60000000)throw Error('Python安装包大小不正确。');fs.writeFileSync(installer,bytes,{flag:'wx'});}
 const quoted="'"+installer.replaceAll("'","''")+"'";
 await run('powershell.exe',['-NoProfile','-Command',`$s=Get-AuthenticodeSignature -LiteralPath ${quoted}; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notlike '*Python Software Foundation*'){throw 'Python installer signature validation failed'}`],120000);
 await run(installer,['/quiet','InstallAllUsers=0',`TargetDir=${target}`,'Include_launcher=0','InstallLauncherAllUsers=0','PrependPath=0','AssociateFiles=0','Shortcuts=0','Include_test=0','Include_pip=1'],600000);
 const exe=path.join(target,'python.exe');if(!fs.existsSync(exe))throw Error('私有Python运行时尚未安装成功。');return exe;
}
export async function mediaDoctor(){const py=python(),config=fs.existsSync(configPath)?read(configPath):{};if(!py)return{ready:false,code:'PYTHON_MISSING',missing:['Python 3.10+'],instruction:'由当前Agent安装项目私有Python运行时，再执行连接器 media setup --json；不必配置外部AI服务。'};try{const data=JSON.parse(await run(py,[WORKER,'doctor',...(config.model?['--model',config.model]:[])],60000));if(config.modelPath&&fs.existsSync(path.join(config.modelPath,'model.bin'))){data.modelPath=config.modelPath;data.model=config.model;data.missing=data.missing.filter(x=>x!=='speech-model');data.ready=!data.missing.length;}return {...data,privateRuntime:py===PYTHON,runtimeRoot:ROOT};}catch(e){return {ready:false,missing:['media-worker'],error:e.message};}}
async function performMediaSetup({model}={}){fs.mkdirSync(ROOT,{recursive:true});const py=python()||await bootstrapPython();if(!fs.existsSync(PYTHON))await run(py,['-m','venv','--system-site-packages',VENV]);let status=await mediaDoctor();if(status.missing.some(x=>x!=='speech-model')){await run(PYTHON,['-m','pip','install','--disable-pip-version-check','faster-whisper==1.2.1','rapidocr-onnxruntime==1.4.4','imageio-ffmpeg==0.6.0']);status=await mediaDoctor();}let name=model||status.model||'large-v3-turbo',modelPath=status.model===name?status.modelPath:null;if(!modelPath){const response=JSON.parse(await run(PYTHON,[WORKER,'download','--model',name,'--cache',path.join(ROOT,'models')],3600000));modelPath=response.modelPath;}save(configPath,{version:1,model:name,modelPath,python:PYTHON});status=await mediaDoctor();if(!status.ready||status.model!==name)throw Error('组件或指定模型仍未就绪：'+status.missing.join('、'));return status;}
function job(id,token){if(!/^[0-9a-f-]{36}$/.test(id||''))throw Error('任务标识无效。');const dir=path.join(jobs,id),meta=read(path.join(dir,'meta.json'));if(!token||token!==meta.token)throw Error('视频任务凭据不匹配。');return{dir,meta};}
function progressFor(dir,meta){
 let p=fs.existsSync(path.join(dir,'progress.json'))?read(path.join(dir,'progress.json')):{state:'uploading',received:meta.received,size:meta.size};
 if(['queued','running'].includes(p.state)&&!alive(p.pid)&&!alive(meta.ownerPid))p={...p,state:'interrupted',error:'本地处理进程已中断，可从已校验检查点继续。'};
 if(p.state==='complete'){
  const config=fs.existsSync(configPath)?read(configPath):{};
  if(meta.workerHash!==sha(fs.readFileSync(WORKER))||config.model&&meta.model!==config.model||!meta.modelStamp||modelStamp(meta.modelPath)!==meta.modelStamp||config.modelPath&&path.resolve(config.modelPath)!==meta.modelPath)p={...p,state:'interrupted',error:'视频处理组件或转写模型已变化，请重试准备；旧报告不计当前版本完成。'};
 }
 return p;
}
function launch(dir,meta){
 if(running.has(meta.id))return;
 const lock=path.join(dir,'process.lock');
 if(fs.existsSync(lock)){let prior;try{prior=read(lock);}catch{throw Error('视频处理锁正在创建，请稍后查询状态。');}if(alive(prior.pid)||alive(progressFor(dir,meta).pid))return;fs.unlinkSync(lock);}
 const key=crypto.randomUUID();try{fs.writeFileSync(lock,JSON.stringify({pid:process.pid,key}),{flag:'wx'});}catch(e){if(e.code==='EEXIST')return;throw e;}
 running.add(meta.id);meta.ownerPid=process.pid;save(path.join(dir,'meta.json'),meta);save(path.join(dir,'progress.json'),{state:'queued',stage:'queued',pid:process.pid});
 queue=queue.catch(()=>{}).then(async()=>{try{
  const status=await mediaDoctor();if(!status.ready)throw Error('视频组件未就绪，请运行 media setup --json。');
  meta.workerHash=sha(fs.readFileSync(WORKER));meta.model=status.model;meta.modelPath=path.resolve(status.modelPath);meta.modelStamp=modelStamp(meta.modelPath);save(path.join(dir,'meta.json'),meta);
  await run(status.python,[WORKER,'process','--input',path.join(dir,'source.media'),'--out',dir,'--model',status.model,'--model-path',status.modelPath],24*3600000);
 }catch(e){let p;try{p=read(path.join(dir,'progress.json'));}catch{}if(p?.state!=='failed')save(path.join(dir,'progress.json'),{state:'failed',stage:'failed',error:e.message});}
 finally{running.delete(meta.id);try{if(read(lock).key===key)fs.unlinkSync(lock);}catch{}}});
}
export async function mediaAction(body){
 if(body.action==='doctor')return mediaDoctor();
 if(body.action==='begin'){
  const status=await mediaDoctor();if(!status.ready)return {state:'setup_required',runtime:status};
  if(typeof body.docId!=='string'||typeof body.projectId!=='string'||typeof body.revision!=='string'||!Number.isSafeInteger(body.size)||body.size<=0||body.size>2*1024*1024*1024)throw Error('视频元数据无效。');
  const id=crypto.randomUUID(),token=crypto.randomBytes(24).toString('hex'),dir=path.join(jobs,id),meta={id,token,docId:body.docId,projectId:body.projectId,revision:body.revision,size:body.size,received:0,state:'uploading',created:new Date().toISOString()};save(path.join(dir,'meta.json'),meta);fs.writeFileSync(path.join(dir,'source.media'),'');return {jobId:id,jobToken:token,state:'uploading',chunkBytes:512*1024};
 }
 const {dir,meta}=job(body.jobId,body.jobToken);
 if(body.docId!==meta.docId||body.projectId!==meta.projectId||body.revision!==meta.revision)throw Error('视频任务所属品牌、稿件或原件版本不匹配。');
 if(body.action==='chunk'){
  if(meta.state!=='uploading'||body.offset!==meta.received||typeof body.data!=='string'||body.data.length>800000||!/^[A-Za-z0-9+/=]+$/.test(body.data))throw Error('视频上传分片不连续或无效。');const bytes=Buffer.from(body.data,'base64');if(!bytes.length||meta.received+bytes.length>meta.size)throw Error('视频分片大小不符。');const source=path.join(dir,'source.media'),actual=fs.statSync(source).size;if(actual<meta.received)throw Error('已保存的上传分片不完整，请重新关联原件。');if(actual>meta.received)fs.truncateSync(source,meta.received);fs.appendFileSync(source,bytes);meta.received+=bytes.length;save(path.join(dir,'meta.json'),meta);return {received:meta.received,size:meta.size};
 }
 if(body.action==='start'){
  if(meta.received!==meta.size||fs.statSync(path.join(dir,'source.media')).size!==meta.size)throw Error('视频文件未上传完整。');
  if(meta.state==='uploading'){meta.state='processing';save(path.join(dir,'meta.json'),meta);launch(dir,meta);}return {state:'processing',jobId:meta.id};
 }
 if(body.action==='retry'){const p=progressFor(dir,meta);if(!['failed','interrupted'].includes(p.state))throw Error('当前任务无需重试。');launch(dir,meta);return {state:'queued'};}
 if(body.action==='status')return {...progressFor(dir,meta),jobId:meta.id};
 if(['result','verify','asset'].includes(body.action)){
  const progress=progressFor(dir,meta);if(progress.state!=='complete')throw Error(progress.error||'视频尚未准备完整。');const bytes=fs.readFileSync(path.join(dir,'report.json'));if(sha(bytes)!==progress.reportHash)throw Error('视频处理报告版本校验失败。');const report=JSON.parse(bytes);
  if(body.action==='verify')return {ready:true,sourceHash:report.sourceHash,reportHash:progress.reportHash,decodedFrames:report.decodedFrames,uniqueFrames:report.uniqueFrames};
  if(body.action==='result')return {...report,reportHash:progress.reportHash};
  const a=report.assets.find(a=>a.id===body.assetId),audio=a?.type==='prepared-video-audio';
  if(!a||!(audio?/^audio\/[a-f0-9]{64}\.wav$/:/^frames\/[a-f0-9]{64}\.png$/).test(a.file))throw Error('素材不属于本视频清单。');
  const asset=fs.readFileSync(path.join(dir,a.file));if(sha(asset)!==a.sha256)throw Error('视频素材原件已改变。');if(asset.length>12*1024*1024)throw Error('单份素材过大，需由本地组件分段后审阅；当前未完成。');
  return {assetId:a.id,type:audio?'audio':'image',mimeType:audio?'audio/wav':'image/png',data:asset.toString('base64'),coverage:'full',location:a.location,...(audio?{track:a.track,channel:a.channel,start:a.start,end:a.end,reviewReasons:a.reviewReasons}:{frameIndexes:a.frameIndexes})};
 }
 throw Error('未知视频处理操作。');
}

export async function setupMedia(options={}){
 if(options.model!==undefined&&!MODELS.includes(options.model))throw Error('不支持的转写模型。');
 fs.mkdirSync(ROOT,{recursive:true});const lock=path.join(ROOT,'setup.lock');
 if(fs.existsSync(lock)){let prior;try{prior=read(lock);}catch{throw Error('组件安装锁损坏，请由Agent核对私有目录后处理。');}if(alive(prior.pid))throw Object.assign(Error('另一个Agent正在准备视频组件，请查询状态等待。'),{code:'MEDIA_SETUP_BUSY'});fs.unlinkSync(lock);}
 const key=crypto.randomUUID();let fd;try{fd=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')throw Object.assign(Error('另一个Agent正在准备视频组件，请查询状态等待。'),{code:'MEDIA_SETUP_BUSY'});throw e;}fs.writeFileSync(fd,JSON.stringify({pid:process.pid,key}));fs.closeSync(fd);save(setupState,{state:'running',stage:'checking-and-installing',pid:process.pid,requestedModel:options.model||null});
 try{const result=await performMediaSetup(options);save(setupState,{state:'ready',ready:result.ready,model:result.model});return result;}catch(e){save(setupState,{state:'failed',error:e.message});throw e;}finally{try{if(read(lock).key===key)fs.unlinkSync(lock);}catch{}}
}
