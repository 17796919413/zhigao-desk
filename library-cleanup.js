import {activitiesOf,activityOf,activityRevision,projectForActivity} from './activities.js';
import {digest,stableJSON} from './review-knowledge.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const assetKeys=rows=>rows.flatMap(row=>[...(row.ingestion?.assetKey?[row.ingestion.assetKey]:[]),...assetKeys(row.history||[])]);
const sourceIdentity=row=>({id:row.id,activityId:activityOf(row),active:row.active!==false,assetKey:row.ingestion?.assetKey||null,text:row.ingestion?.assetKey?null:row.text||''});
const preparationBasis=(project,activityId)=>{const p=projectForActivity(project,activityId);return {notes:p.notes||'',rules:(p.rules||[]).map(({history,updated,created,...rule})=>rule),library:(p.library||[]).map(sourceIdentity).sort((a,b)=>a.id.localeCompare(b.id))};};
export async function libraryIdentity(project,activityId){
 return digest(stableJSON(preparationBasis(project,activityId)));
}
export function planConnectorCleanup(before,after){
 const changed=(before.library||[]).filter(old=>!same(sourceIdentity(old),(after.library||[]).find(row=>row.id===old.id)?sourceIdentity(after.library.find(row=>row.id===old.id)):null));
 const scopes=new Set(changed.flatMap(old=>[activityOf(old),activityOf((after.library||[]).find(row=>row.id===old.id)||old)]));
 const activityIds=activitiesOf(after).filter(a=>scopes.has('*')||scopes.has(a.id)||activitiesOf(before).some(old=>old.id===a.id)&&!same(preparationBasis(before,a.id),preparationBasis(after,a.id))).map(a=>a.id);
 if(!activityIds.length)return null;
 const sources=rows=>rows.flatMap(row=>[{libraryId:row.id,...(row.ingestion?.assetKey?{assetKey:row.ingestion.assetKey}:{}),...(row.ingestion?.originalSourceHash?{sourceHash:row.ingestion.originalSourceHash}:{})},...sources((row.history||[]).map(h=>({...h,id:row.id})))]);
 return {id:crypto.randomUUID(),projectId:after.id,activityIds,sources:sources(changed)};
}

// Capture legacy cache identities before the browser's old originals are removed.
export async function captureConnectorSources(jobs,load){
 const result=structuredClone(jobs);
 for(const job of result)for(const source of job.sources){
  if(!source.assetKey)continue;const file=await load(source.assetKey);if(!file)continue;
  if(file.mediaRevision)source.mediaRevision=file.mediaRevision;
  if(file.conversion?.sourceHash)source.sourceHash=file.conversion.sourceHash;
  else if(/\.(doc|xls|ppt)$/i.test(file.filename||'')&&file.originalFile instanceof Blob)source.sourceHash=await digest(await file.originalFile.arrayBuffer());
 }
 return result;
}

export async function connectorCleanupManifest(job,settings,load,tasks){
 const protectedKeys=[...new Set([...settings.projects.flatMap(p=>assetKeys(p.library||[])),...tasks.map(t=>t.id).filter(Boolean)])],protectedHashes=new Set();
 for(const key of protectedKeys){const file=await load(key);if(file?.conversion?.sourceHash)protectedHashes.add(file.conversion.sourceHash);else if(/\.(doc|xls|ppt)$/i.test(file?.filename||'')&&file.originalFile instanceof Blob)protectedHashes.add(await digest(await file.originalFile.arrayBuffer()));}
 for(const task of tasks){if(task.officeConversion?.sourceHash)protectedHashes.add(task.officeConversion.sourceHash);else if(task.fmt==='office-pending'&&task.buffer)protectedHashes.add(await digest(task.buffer));}
 const project=settings.projects.find(p=>p.id===job.projectId)||{library:[],activities:job.activityIds.filter(id=>id!=='legacy').map(id=>({id}))};
 const scopes=await Promise.all(job.activityIds.map(async activityId=>({activityId,identity:await libraryIdentity(project,activityId)})));
 return {id:job.id,projectId:job.projectId,sources:job.sources,scopes,protectedKeys,protectedHashes:[...protectedHashes]};
}

// Stored alongside the new library index: no old text or original bytes enter the journal.
export function planLibraryCleanup(before,after){
 const changed=(before.library||[]).filter(old=>!same(old,(after.library||[]).find(row=>row.id===old.id)));
 if(!changed.length)return null;
 const scopes=new Set(changed.flatMap(old=>[activityOf(old),activityOf((after.library||[]).find(row=>row.id===old.id)||old)]));
 return {id:crypto.randomUUID(),projectId:after.id,createdAt:new Date().toISOString(),
  activityIds:activitiesOf(after).filter(a=>scopes.has('*')||scopes.has(a.id)).map(a=>a.id),
  assetKeys:[...new Set(assetKeys(changed))]};
}

export function cleanReviewEntry(entry){
 const next={...entry};
 for(const key of ['basis','basisRef','resumeIdentity','checkpointSeal','draftHash','basisChanges','savedChecks','contextDelivery','previousChecks','reviewToken','sessionId','mediaReceipts','media'])delete next[key];
 if(['reviewing','interrupted'].includes(next.status))Object.assign(next,{status:'interrupted',errorCode:'BASIS_CHANGED',reason:'品牌资料已更新，请读取最新依据后继续审核。'});
 return next;
}

// Read, protect shared originals, and erase transient review data in one transaction.
// A settings change before commit aborts the transaction; its journal remains retryable.
export function purgeLibraryReferences(db,settings,{guard=()=>{}}={}){
 if(!db)return Promise.reject(Error('浏览器数据库不可用。'));
 const jobs=settings.libraryCleanup||[];
 if(!jobs.length)return Promise.resolve({batches:[],docIds:[],projectIds:[]});
 return new Promise((resolve,reject)=>{
  const names=['tasks','batches','integrations'],tx=db.transaction([...names,'media'],'readwrite'),all={};let left=names.length,failure,result;
  tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error('旧资料清理未完成。'));
  for(const name of names){const q=tx.objectStore(name).getAll();q.onsuccess=()=>{
   all[name]=q.result;if(--left)return;
   try{
    guard();
    const protectedKeys=new Set([...settings.projects.flatMap(p=>assetKeys(p.library||[])),...all.tasks.map(t=>t.id)]);
    for(const key of new Set(jobs.flatMap(j=>j.assetKeys)))if(!protectedKeys.has(key))tx.objectStore('media').delete(key);
    const affected=(projectId,activityId)=>jobs.some(j=>j.projectId===projectId&&j.activityIds.includes(activityId));
    const stale=(entry,projectId,activityId)=>affected(projectId,activityId)&&(!entry.projectRevision||entry.projectRevision!==activityRevision(settings.projects.find(p=>p.id===projectId),activityId));
    const docs=new Map(all.tasks.map(t=>[t.id,t])),projectIds=[...new Set(jobs.map(j=>j.projectId))],updated=[];
    for(const row of all.integrations){
     const t=docs.get(row.docId);
     if(row.kind==='review-knowledge'&&projectIds.includes(row.projectId)||row.kind==='review-checkpoint'&&stale(row.entry||{},row.projectId,activityOf(t||row.entry?.basisRef)))tx.objectStore('integrations').delete(row.id);
    }
    for(const batch of all.batches){
     let changed=false;const entries=batch.entries.map(entry=>{
      if(!stale(entry,batch.projectId,activityOf(docs.get(entry.docId)||batch)))return entry;
      const clean=cleanReviewEntry(entry);if(!same(clean,entry))changed=true;return clean;
     });
     if(changed){const value={...batch,entries};tx.objectStore('batches').put(value);updated.push(value);}
    }
    guard();result={batches:updated,projectIds,docIds:all.tasks.filter(t=>affected(t.projectId,activityOf(t))).map(t=>t.id)};
   }catch(e){failure=e;tx.abort();}
  };}
 });
}

export function acknowledgeLibraryCleanup(storage,baseline,ids){
 const key='zhigao-settings-v1',raw=storage.getItem(key);
 if(raw!==baseline)throw Error('资料在清理期间变化，待下次重试。');
 const next=JSON.parse(raw);next.libraryCleanup=(next.libraryCleanup||[]).filter(j=>!ids.includes(j.id));
 const serialized=JSON.stringify(next);storage.setItem(key,serialized);
 if(storage.getItem(key)!==serialized)throw Error('旧资料清理状态未保存，待下次重试。');
 return next;
}
