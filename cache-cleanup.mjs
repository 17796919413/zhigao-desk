// Only connector-owned cache directories are eligible. No caller supplies a path.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const cleanupError=(code,message='旧资料准备缓存尚未清理，恢复连接或等待当前准备结束后重试。')=>Object.assign(Error(message),{code});
export function cleanupManifest(value){
 if(!value||typeof value.projectId!=='string'||!value.projectId||!Array.isArray(value.sources)||!Array.isArray(value.scopes)||!Array.isArray(value.protectedKeys)||!Array.isArray(value.protectedHashes))throw cleanupError('CLEANUP_INPUT');
 const string=v=>typeof v==='string'&&v.length>0&&v.length<=200;
 if(!string(value.id)||!string(value.projectId)||value.sources.some(s=>!string(s.libraryId)||s.assetKey!==undefined&&!string(s.assetKey)||s.sourceHash!==undefined&&!/^[a-f0-9]{64}$/.test(s.sourceHash)||s.mediaRevision!==undefined&&!string(s.mediaRevision))||value.scopes.some(s=>!string(s.activityId)||!/^[a-f0-9]{64}$/.test(s.identity))||value.protectedKeys.some(k=>!string(k))||value.protectedHashes.some(k=>!/^[a-f0-9]{64}$/.test(k)))throw cleanupError('CLEANUP_INPUT');
 return value;
}
export function assertCachePath(root,target){
 const base=path.resolve(root),resolved=path.resolve(target),relative=path.relative(base,resolved);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw cleanupError('CLEANUP_PATH');
 let cursor=base;
 for(const part of ['',...relative.split(path.sep)]){
  if(part)cursor=path.join(cursor,part);
  try{if(fs.lstatSync(cursor).isSymbolicLink())throw cleanupError('CLEANUP_PATH');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 // An ancestor above the configured root may itself be a junction.
 const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
 if(fs.existsSync(base)&&normalize(path.resolve(fs.realpathSync(base)))!==normalize(base))throw cleanupError('CLEANUP_PATH');
 return resolved;
}
export function removeCacheJob(root,id){
 if(!/^[a-f0-9-]{36}$/.test(id))throw cleanupError('CLEANUP_PATH');
 const dir=assertCachePath(root,path.join(root,id));if(!fs.existsSync(dir))return;
 const files=[],dirs=[];
 const visit=p=>{for(const entry of fs.readdirSync(p,{withFileTypes:true})){const file=assertCachePath(root,path.join(p,entry.name));if(entry.isSymbolicLink())throw cleanupError('CLEANUP_PATH');if(entry.isDirectory()){visit(file);dirs.push(file);}else files.push(file);}};
 visit(dir);
 // Keep the retired metadata until every payload has gone, so a partial failure is retryable.
 for(const file of files.filter(f=>f!==path.join(dir,'meta.json')))fs.unlinkSync(file);
 for(const sub of dirs)fs.rmdirSync(sub);
 if(fs.existsSync(path.join(dir,'meta.json')))fs.unlinkSync(path.join(dir,'meta.json'));
 fs.rmdirSync(dir);
}
export function createCacheRetirement(root){
 const file=path.join(root,'retired-library-sources.json');
 const read=()=>{assertCachePath(root,file);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];};
 const key=(projectId,assetKey)=>crypto.createHash('sha256').update(JSON.stringify([projectId,assetKey])).digest('hex');
 return {
  assert(projectId,assetKey){if(assetKey&&read().includes(key(projectId,assetKey)))throw cleanupError('SOURCE_RETIRED','此资料原件已被替换，请读取当前资料。');},
  retire(manifest){
   const values=new Set(read());for(const s of manifest.sources)if(s.assetKey&&!manifest.protectedKeys.includes(s.assetKey))values.add(key(manifest.projectId,s.assetKey));
   if(!values.size)return;fs.mkdirSync(root,{recursive:true});assertCachePath(root,file);
   const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify([...values]),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  }
 };
}
export function matchesRetiredSource(meta,manifest,kind){
 if(meta.projectId!==manifest.projectId)return false;
 if(meta.libraryAssetKey)return !manifest.protectedKeys.includes(meta.libraryAssetKey)&&manifest.sources.some(s=>s.assetKey===meta.libraryAssetKey);
 // Legacy conversion jobs were shared by source hash. Preserve any live reference.
 if(kind==='office')return !manifest.protectedHashes.includes(meta.sourceHash)&&manifest.sources.some(s=>s.sourceHash===meta.sourceHash);
 return manifest.sources.some(s=>s.libraryId===meta.docId&&s.mediaRevision===meta.revision&&!manifest.protectedKeys.includes(s.assetKey));
}
