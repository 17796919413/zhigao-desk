import {activityOf,selectedActivity,projectForActivity,activitiesOf,activityName,addActivity} from './activities.js';
import {createVideoProcessor} from './video-processing.js';
import {digest} from './review-knowledge.js';

export async function verifyLibraryOriginal(original,stored){
 if(!(original?.originalFile instanceof Blob)||!(stored?.originalFile instanceof Blob))throw Error('品牌原件保存核验失败。');
 if(original.originalFile.size!==stored.originalFile.size)throw Error('品牌原件保存不完整。');
 const hash=await digest(await original.originalFile.arrayBuffer());
 if(hash!==await digest(await stored.originalFile.arrayBuffer()))throw Error('品牌原件摘要校验失败，旧资料仍保留。');
 if(typeof original.extractedText!=='string'||original.extractedText!==stored.extractedText)throw Error('品牌资料完整正文保存核验失败。');
 return hash;
}

// Settings hold descriptions; originals and complete extracted text live in IndexedDB.
export async function hydrateLibraryProject(project,load){
 const p=structuredClone(project);
 for(const d of p.library||[]){
  if(d.active===false||!d.ingestion?.externalText)continue;
  const file=await load(d.ingestion.assetKey);
  if(!file||typeof file.extractedText!=='string')throw Error('品牌资料完整正文缺失：'+d.title);
  if(await digest(file.extractedText)!==d.ingestion.textHash)throw Error('品牌资料正文版本不一致：'+d.title);
  d.text=file.extractedText;
 }return p;
}
export async function materializeLibraryFile(file){
 if(!file)return null;
 if(file.conversion){
  const c=file.conversion;
  if(await digest(c.buffer)!==c.convertedHash||!file.originalFile||await digest(await file.originalFile.arrayBuffer())!==c.sourceHash)throw Error('转换副本或原件已变化，不能继续认证完整审核。');
  return {...file,buffer:c.buffer,fmt:c.fmt,filename:c.filename};
 }
 if(!file.buffer&&file.originalFile instanceof Blob&&!['video','attachment','text'].includes(file.fmt))return {...file,buffer:await file.originalFile.arrayBuffer()};
 return file;
}
export function createLibraryProcessor(ctx){
 const records=new Map();
 const selected=()=>{const p=ctx.state().settings.projects.find(p=>p.id===ctx.state().settings.selected);return p&&projectForActivity(p);};
 const entry=id=>{const p=selected(),d=p?.library?.find(d=>d.id===id);if(!d||!d.ingestion?.assetKey)throw Error('资料不属于当前品牌或没有原件。');return {p,d};};
 async function load(id){const {p,d}=entry(id),file=await ctx.getLibraryFile(d.ingestion.assetKey);if(!file)throw Error('品牌资料原件缺失。');const live=entry(id);if(live.p.id!==p.id||live.p.activityId!==p.activityId||live.d.ingestion.assetKey!==d.ingestion.assetKey)throw Error('读取期间品牌、活动或资料已变化。');const t={...file,id:d.id,projectId:p.id,activityId:p.activityId,libraryAssetKey:d.ingestion.assetKey};records.set(id,t);return t;}
 const video=createVideoProcessor({state:()=>({...ctx.state(),tasks:[...records.values()]}),getMediaFile:async id=>(await load(id)).originalFile,
  save:async t=>{const {p,d}=entry(t.id);if(t.projectId!==p.id||t.activityId!==p.activityId)throw Error('品牌或活动已切换。');const old=await ctx.getLibraryFile(d.ingestion.assetKey);if(old?.mediaRevision!==t.mediaRevision)throw Error('原件已变化。');await ctx.saveLibraryPreparation(p.id,d.id,d.ingestion.assetKey,t);records.set(t.id,t);}});
 return {
  async prepare({libraryId,retry=false}={}){const p=selected(),list=libraryId?[entry(libraryId).d]:(p?.library||[]).filter(d=>d.active!==false&&d.ingestion?.format==='video'),results=[];
   for(const d of list){const t=await load(d.id);results.push({libraryId:d.id,title:d.title,...(t.fmt==='video'?await video.prepare({docId:d.id,retry}):{state:d.ingestion.state,blockers:d.ingestion.blockers})});}return {projectId:p.id,materials:results};},
  async status({libraryId}={}){await load(libraryId);return video.status({docId:libraryId});},
  async analysis(file){records.set(file.id,file);return video.analysis(file);},
  readAsset:(file,id)=>video.readAsset(file,id)
 };
}
