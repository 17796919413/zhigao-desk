import {digest,stableJSON} from './review-knowledge.js';
import {validateBundle} from './bundle-validation.js';

export const BACKUP_KIND='zhigao-project-backup',BACKUP_VERSION=1,CHUNK_BYTES=4*1024*1024;
const HASH=/^[a-f0-9]{64}$/;
const WRITER_CLAIM=/^writer-[a-f0-9]{64}\.json$/,WRITER_KEY='zhigao-backup-writer-v1';
const runtimeWriter=crypto.randomUUID();
// Runtime credentials and machine-specific processing jobs cannot cross devices.
const transient=new Set(['reviewToken','sessionId','accessToken','refreshToken','apiKey','authorization','cookie','password','privateKey','checkpointSeal','contextDelivery','mediaReceipts','leaseExpiresAt','videoPreparation','videoAnalysis','jobId','fileHandle','originalStamp']);
const missing=e=>e?.name==='NotFoundError';
const fail=message=>{throw Error('项目备份无法使用：'+message);};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const metadataKeys=new Set(['projects','items','docs','batches','integrations','media','libraryAssets','artifacts']);
const envelope=async payload=>({kind:BACKUP_KIND,version:BACKUP_VERSION,hash:await digest(stableJSON(payload)),payload});
export const backupDirectoryName=async projectId=>'知稿项目备份-'+(await digest(projectId)).slice(0,24);

// Paths name a retained round or historical review inside a top-level draft.
// Legacy backups have no recordPath and therefore still target that draft.
export function backupArtifactTarget(document,recordPath=[]){
 if(!Array.isArray(recordPath)||recordPath.length%2)fail('结果文件记录路径');
 let target=document;
 for(let i=0;i<recordPath.length;i+=2){
  const key=recordPath[i],index=recordPath[i+1];
  if(!['rounds','aiHistory'].includes(key)||!Number.isSafeInteger(index)||index<0||!Array.isArray(target?.[key])||!plain(target[key][index]))fail('结果文件记录归属');
  target=target[key][index];
 }
 if(!plain(target))fail('结果文件记录缺失');return target;
}
export function backupArtifactReferences(document){
 const refs=[];
 function visit(node,recordPath){
  const saved=Array.isArray(node.saved)?node.saved.map(x=>x.path):[node.saved?.path];
  const archives=[node.archive,node.ai?.archive];
  const paths=[node.originalSaved,...saved,node.ai?.saved?.path,...(node.restoredOutputs||[]).map(x=>x.path),...archives.flatMap(a=>[a?.output,a?.notes,...(a?.paths||[])])];
  for(const path of new Set(paths.filter(Boolean)))refs.push({path,recordPath});
  for(const key of ['rounds','aiHistory'])for(const [index,child]of(node[key]||[]).entries())visit(child,[...recordPath,key,index]);
 }
 visit(document,[]);return refs;
}

async function backupWriterIdentity(){
 if(typeof localStorage==='undefined')return runtimeWriter;
 const load=()=>{let id=localStorage.getItem(WRITER_KEY);if(!id){id=crypto.randomUUID();localStorage.setItem(WRITER_KEY,id);}if(localStorage.getItem(WRITER_KEY)!==id)throw Error('浏览器未能保存备份身份，请重试。');return id;};
 return globalThis.navigator?.locks?navigator.locks.request('zhigao-backup-writer-identity',load):load();
}

// The claim persists for this browser configuration. Foreign configurations
// may read/restore, but cannot write this project. Unique claim filenames become
// visible before scanning, so simultaneous first claims cannot both proceed.
async function claimBackupWriter(dir,writerId){
 if(typeof writerId!=='string'||!writerId.trim())throw Error('缺少浏览器备份身份。');
 const name='writer-'+await digest(writerId)+'.json';let created=false;
 const foreign=async()=>{for await(const [entry]of dir.entries())if(WRITER_CLAIM.test(entry)&&entry!==name)return true;return false;};
 const conflict=()=>{throw Error('此项目备份由其他浏览器保存，请恢复为独立副本。');};
 if(await foreign())conflict();
 try{
  if(!await textFile(dir,name)){await dir.getFileHandle(name,{create:true});created=true;}
  if(await foreign())conflict();
  if(created)await writeVerified(dir,name,JSON.stringify({kind:'zhigao-backup-writer',version:1}));
 }catch(e){if(created)try{await removeOwnFile(dir,name);}catch{}throw e;}
}

async function textFile(dir,name){try{return await(await dir.getFileHandle(name)).getFile();}catch(e){if(missing(e))return null;throw e;}}
async function parseEnvelope(dir,name,content){
 if(content===undefined){const file=await textFile(dir,name);content=file?await file.text():null;}if(content===null)return null;
 let value;try{value=JSON.parse(content);}catch{fail(name+' 已损坏');}
 if(value.kind!==BACKUP_KIND||value.version!==BACKUP_VERSION||!plain(value.payload)||!HASH.test(value.hash)||await digest(stableJSON(value.payload))!==value.hash)fail(name+' 校验失败');
 return value;
}
async function writeVerified(dir,name,value){
 const bytes=typeof value==='string'?new Blob([value],{type:'application/json'}):value;
 const handle=await dir.getFileHandle(name,{create:true});let writer;
 try{writer=await handle.createWritable();await writer.write(bytes);await writer.close();}
 catch(e){try{await writer?.abort?.();}catch{}throw e;}
 const file=await handle.getFile();
 if(file.size!==bytes.size||await digest(await file.arrayBuffer())!==await digest(await bytes.arrayBuffer()))throw Error('项目备份写后校验失败。');
 return file;
}
async function removeOwnFile(dir,name){try{await dir.removeEntry(name);}catch(e){if(!missing(e))throw e;}}

export function validateProjectSnapshot(data){
 if(!plain(data)||!Object.keys(data).every(k=>metadataKeys.has(k))||!Array.isArray(data.projects)||data.projects.length!==1)fail('项目结构');
 validateBundle({version:2,...data});
 const project=data.projects[0],docs=new Set(data.docs.map(d=>d.id)),library=new Set((project.library||[]).map(d=>d.ingestion?.assetKey).filter(Boolean));
 for(const key of ['batches','integrations','media','libraryAssets','artifacts'])if(!Array.isArray(data[key]))fail(key+' 清单缺失');
 for(const b of data.batches)if(b.projectId!==project.id||!Array.isArray(b.entries)||b.entries.some(e=>!docs.has(e.docId)))fail('批次归属');
 for(const r of data.integrations)if(r.projectId!==project.id||r.docId&&!docs.has(r.docId)||!['pending-upload','review-checkpoint'].includes(r.kind))fail('未完成任务归属');
 for(const m of data.media)if(!docs.has(m.id))fail('媒体归属');
 for(const a of data.libraryAssets)if(!library.has(a.id)||!a.file)fail('品牌原件归属');
 for(const id of library)if(!data.libraryAssets.some(a=>a.id===id))fail('品牌原件缺失');
 for(const d of data.docs)if(d.fmt==='video'&&!data.media.some(m=>m.id===d.id&&m.blob))fail('视频原件缺失');
 for(const a of data.artifacts){if(!docs.has(a.docId)||typeof a.path!=='string'||!a.blob||a.original!==undefined&&typeof a.original!=='boolean')fail('结果文件归属');backupArtifactTarget(data.docs.find(d=>d.id===a.docId),a.recordPath);}
 return project;
}

export function createBackupCache(){return {sources:new WeakMap(),verified:new Map()};}
async function verifySourceHashes(snapshot){
 const verify=async d=>{if(d.officeConversion&&(!d.officeOriginal?.buffer||!d.buffer||await digest(d.officeOriginal.buffer)!==d.officeConversion.sourceHash||await digest(d.buffer)!==d.officeConversion.convertedHash))fail('Office 原件与转换件不一致');for(const r of d.rounds||[])await verify(r);};
 for(const d of snapshot.docs)await verify(d);
 for(const a of snapshot.libraryAssets){const f=a.file,c=f.conversion;if(c){const original=f.originalFile instanceof Blob?await f.originalFile.arrayBuffer():f.buffer;if(!original||!c.buffer||await digest(original)!==c.sourceHash||await digest(c.buffer)!==c.convertedHash)fail('品牌资料转换件不一致');}}
}
async function putBinary(blob,dir,cache,stats){
 const old=cache.sources.get(blob);if(old){let present=true;for(const chunk of old.chunks)if(!await textFile(dir,chunk.hash)){present=false;break;}if(present){for(const chunk of old.chunks)await checkChunk(dir,chunk,cache,stats);return old;}}
 const chunks=[];
 for(let offset=0;offset<blob.size;offset+=CHUNK_BYTES){
  const part=blob.slice(offset,offset+CHUNK_BYTES),hash=await digest(await part.arrayBuffer()),chunk={hash,size:part.size};stats.sourceBytes+=part.size;
  let existing=await textFile(dir,hash);
  if(existing){await checkChunk(dir,chunk,cache,stats);}
  else{existing=await writeVerified(dir,hash,part);stats.writtenBytes+=part.size;cache.verified.set(hash,{size:existing.size,lastModified:existing.lastModified});}
  chunks.push(chunk);
 }
 const ref={size:blob.size,type:blob.type||'',chunks};cache.sources.set(blob,ref);return ref;
}
async function checkChunk(dir,ref,cache,stats={verifiedBytes:0},detach=false){
 if(!plain(ref)||!HASH.test(ref.hash)||!Number.isInteger(ref.size)||ref.size<=0||ref.size>CHUNK_BYTES)fail('原件块索引');
 const file=await textFile(dir,ref.hash);if(!file||file.size!==ref.size)fail('原件块缺失或长度错误');
 const known=cache.verified.get(ref.hash);
 if(detach||!known||known.lastModified!==file.lastModified||known.size!==file.size){const bytes=await file.arrayBuffer();if(await digest(bytes)!==ref.hash)fail('原件块摘要错误');stats.verifiedBytes+=file.size;cache.verified.set(ref.hash,{size:file.size,lastModified:file.lastModified});if(detach)return new Blob([bytes]);}
 return file;
}
// Binary values are streamed in bounded chunks, never JSON/base64 or one big ZIP.
async function pack(value,dir,cache,stats,seen=new WeakSet()){
 if(value instanceof Blob){const ref=await putBinary(value,dir,cache,stats);return {$binary:'blob',...ref,...(typeof File!=='undefined'&&value instanceof File?{name:value.name,lastModified:value.lastModified}:{})};}
 if(value instanceof ArrayBuffer||ArrayBuffer.isView(value)){
  let cached=cache.sources.get(value);if(cached)for(const part of cached.chunks)if(!await textFile(dir,part.hash)){cached=null;break;}
  const bytes=value instanceof ArrayBuffer?value:value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);
  const ref=cached||await putBinary(new Blob([bytes]),dir,cache,stats);if(cached)for(const part of ref.chunks)await checkChunk(dir,part,cache,stats);else cache.sources.set(value,ref);
  return {$binary:'buffer',...ref};
 }
 if(value===undefined)return null;if(value===null||typeof value!=='object')return value;
 if(value instanceof Date)return value.toISOString();
 if(typeof value.getFile==='function')fail('未读取的外部原件句柄');
 if(seen.has(value))fail('循环记录');seen.add(value);let out;
 if(Array.isArray(value)){out=[];for(const v of value)out.push(await pack(v,dir,cache,stats,seen));}
 else{out={};for(const [key,v] of Object.entries(value))if(!transient.has(key)&&v!==undefined){if(['__proto__','constructor','prototype','$binary'].includes(key))fail('非法字段');out[key]=await pack(v,dir,cache,stats,seen);}}
 seen.delete(value);return out;
}
async function unpack(value,dir,cache,stats){
 if(value===null||typeof value!=='object')return value;
 if(value.$binary){
  if(!['blob','buffer'].includes(value.$binary)||!Number.isSafeInteger(value.size)||value.size<0||!Array.isArray(value.chunks)||value.chunks.reduce((n,x)=>n+x.size,0)!==value.size)fail('原件索引');
  // A File returned by getFile() still depends on the backup directory. Copy
  // each bounded chunk before returning, so later compaction cannot invalidate
  // a pending upload or output file already being restored.
  const parts=[];for(const ref of value.chunks)parts.push(await checkChunk(dir,ref,cache,stats,true));
  const blob=value.name&&typeof File!=='undefined'?new File(parts,value.name,{type:value.type,lastModified:value.lastModified}):new Blob(parts,{type:value.type||''});
  return value.$binary==='buffer'?blob.arrayBuffer():blob;
 }
 if(Array.isArray(value)){const out=[];for(const v of value)out.push(await unpack(v,dir,cache,stats));return out;}
 const out={};for(const [k,v] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))fail('非法字段');out[k]=await unpack(v,dir,cache,stats);}return out;
}
function referencedChunks(value,set=new Set()){
 if(value&&typeof value==='object'){if(value.$binary)for(const c of value.chunks||[])set.add(c.hash);else for(const v of Object.values(value))referencedChunks(v,set);}return set;
}
async function getDirectory(root,projectId,create){
 const name=await backupDirectoryName(projectId);let dir;
 try{dir=await root.getDirectoryHandle(name);}catch(e){if(!create||!missing(e))throw e;dir=await root.getDirectoryHandle(name,{create:true});}
 const owner=await textFile(dir,'owner.json');
 if(owner){let data;try{data=JSON.parse(await owner.text());}catch{fail('目录标识损坏');}if(data.kind!==BACKUP_KIND||data.projectId!==projectId)fail('目录归属不一致');}
 else{
  for await(const _ of dir.entries())fail('目录已含其他文件');
  if(!create)fail('缺少目录标识');
  await writeVerified(dir,'owner.json',JSON.stringify({kind:BACKUP_KIND,version:BACKUP_VERSION,projectId}));
 }
 return dir;
}

export async function saveProjectBackup(root,snapshot,{guard=()=>{},cache=createBackupCache(),writerId}={}){
 const project=validateProjectSnapshot(snapshot);await verifySourceHashes(snapshot);await guard();
 const dir=await getDirectory(root,project.id,true);await claimBackupWriter(dir,writerId??await backupWriterIdentity());
 const blocks=await dir.getDirectoryHandle('blocks',{create:true});
 let previous;try{previous=await parseEnvelope(dir,'latest.json');}catch(e){previous=await parseEnvelope(dir,'last-good.json');if(!previous)throw e;}
 const stats={sourceBytes:0,writtenBytes:0,verifiedBytes:0},data=await pack(snapshot,blocks,cache,stats);
 // All chunks were verified while packing. Validate binary presence from refs;
 // full reconstruction belongs to restore, avoiding a second in-memory copy.
 validateProjectSnapshot(data);
 const payload={projectId:project.id,projectName:project.name,created:new Date().toISOString(),data};
 const next=await envelope(payload),text=JSON.stringify(next);
 await guard();
 // A prior committed manifest remains readable until the new manifest is closed
 // and read back successfully. Staging files never count as committed backups.
 const baseline=await textFile(dir,'latest.json'),baselineText=baseline&&await baseline.text();
 if(previous&&previous.payload.projectId!==project.id)fail('项目身份不一致');
 if(previous)await writeVerified(dir,'last-good.json',JSON.stringify(previous));
 await writeVerified(dir,'staging.json',text);
 await guard();
 const latest=await textFile(dir,'latest.json');if((latest&&await latest.text())!==baselineText)throw Error('项目备份已在其他页面更新，请重试。');
 await writeVerified(dir,'latest.json',text);
 const verified=await parseEnvelope(dir,'latest.json');if(verified.hash!==next.hash)throw Error('项目备份提交未确认。');await guard();
 // Only generated blocks without a committed reference are eligible for cleanup.
 let cleanupPending=false;
 try{await removeOwnFile(dir,'last-good.json');await removeOwnFile(dir,'staging.json');const keep=referencedChunks(data);for await(const [name,handle] of blocks.entries())if(handle.kind==='file'&&HASH.test(name)&&!keep.has(name)){await blocks.removeEntry(name);cache.verified.delete(name);}}
 catch{cleanupPending=true;}
 return {state:'saved',projectId:project.id,at:payload.created,hash:next.hash,path:await backupDirectoryName(project.id),cleanupPending,stats};
}
export async function readProjectBackup(directory,{projectId,cache=createBackupCache()}={}){
 const blocks=await directory.getDirectoryHandle('blocks'),replaced=Symbol('replaced');
 const latestText=async()=>{try{const file=await textFile(directory,'latest.json');return file?await file.text():null;}catch(e){if(['NotFoundError','NotReadableError'].includes(e.name))return replaced;throw e;}};
 for(let attempt=0;attempt<3;attempt++){
  const baseline=await latestText(),errors=[];let changed=false;
  if(baseline===replaced)continue;
  for(const name of ['latest.json','last-good.json']){
   try{
    const value=await parseEnvelope(directory,name,name==='latest.json'?baseline:undefined);if(!value)continue;
    if(projectId&&value.payload.projectId!==projectId)fail('项目身份不一致');
    const stats={verifiedBytes:0},data=await unpack(value.payload.data,blocks,cache,stats),p=validateProjectSnapshot(data);await verifySourceHashes(data);
    const owner=await textFile(directory,'owner.json');if(!owner||JSON.parse(await owner.text()).projectId!==p.id||value.payload.projectId!==p.id)fail('目录与项目身份不一致');
    if(await latestText()!==baseline){changed=true;break;}
    return {data,projectId:p.id,created:value.payload.created,hash:value.hash,fallback:name!=='latest.json',stats};
   }catch(e){errors.push(e.message);if(await latestText()!==baseline){changed=true;break;}}
  }
  if(!changed&&await latestText()===baseline)fail(errors.join('；')||'没有完整备份');
 }
 fail('备份暂时无法完整读取，请稍后重试');
}
export async function discoverProjectBackups(root){
 const found=[];for await(const [name,dir] of root.entries()){
  if(dir.kind!=='directory'||!/^知稿项目备份-[a-f0-9]{24}$/.test(name))continue;
  try{let value;try{value=await parseEnvelope(dir,'latest.json');}catch{}value ||= await parseEnvelope(dir,'last-good.json');if(value)found.push({directory:dir,projectId:value.payload.projectId,name:value.payload.projectName,created:value.payload.created});}catch{found.push({directory:dir,name,invalid:true});}
 }return found;
}

// One writer per project. Failed writes stay stale and retain the last-good copy.
export function createProjectBackup(ctx,{delay=1200}={}){
 const caches=new Map(),timers=new Map(),running=new Map(),versions=new Map();
 function mark(id){versions.set(id,(versions.get(id)||0)+1);clearTimeout(timers.get(id));timers.set(id,setTimeout(()=>{timers.delete(id);run(id).catch(()=>{});},delay));}
 async function run(id){
  clearTimeout(timers.get(id));timers.delete(id);if(running.has(id))return running.get(id);
  const version=versions.get(id)||0,execute=async()=>{
   const root=ctx.folder(id);if(!root)return {state:'unconfigured'};
   let cache=caches.get(id);if(!cache)caches.set(id,cache=createBackupCache());
   const permission=async()=>{let state;try{state=await root.queryPermission({mode:'readwrite'});}catch{state='denied';}await ctx.permission?.(id,root,state);return state;};
   try{
    if(await permission()!=='granted'){const value={state:'stale',message:'备份未更新，请重新授权保存文件夹。'};await ctx.status(id,value);return value;}
    await ctx.status(id,{state:'saving',message:'正在更新备份'});
    const snapshot=await ctx.snapshot(id),result=await saveProjectBackup(root,snapshot,{cache,guard:()=>{if((versions.get(id)||0)!==version||ctx.folder(id)!==root)throw Error('项目已更新，正在重新备份。');return ctx.guard?.(id,snapshot);}});
    await ctx.status(id,result);return result;
   }catch(e){await permission();const value={state:'stale',message:'备份未更新：'+e.message};await ctx.status(id,value);return value;}
  };
  const lock=()=>globalThis.navigator?.locks?navigator.locks.request('zhigao-project-backup:'+id,execute):execute();
  const promise=lock().finally(()=>{running.delete(id);if((versions.get(id)||0)!==version&&!timers.has(id))timers.set(id,setTimeout(()=>{timers.delete(id);run(id).catch(()=>{});},delay));});running.set(id,promise);return promise;
 }
 return {mark,run,isBusy:id=>running.has(id),dispose(){for(const timer of timers.values())clearTimeout(timer);timers.clear();}};
}
