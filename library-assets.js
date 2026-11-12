import {createVideoProcessor} from './video-processing.js';
import {digest} from './review-knowledge.js';

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
 const selected=()=>ctx.state().settings.projects.find(p=>p.id===ctx.state().settings.selected);
 const entry=id=>{const p=selected(),d=p?.library?.find(d=>d.id===id);if(!d||!d.ingestion?.assetKey)throw Error('资料不属于当前品牌或没有原件。');return {p,d};};
 async function load(id){const {p,d}=entry(id),file=await ctx.getLibraryFile(d.ingestion.assetKey);if(!file)throw Error('品牌资料原件缺失。');const t={...file,id:d.id,projectId:p.id};records.set(id,t);return t;}
 const video=createVideoProcessor({state:()=>({...ctx.state(),tasks:[...records.values()]}),getMediaFile:async id=>(await load(id)).originalFile,
  save:async t=>{const {p,d}=entry(t.id);if(t.projectId!==p.id)throw Error('品牌已切换。');const old=await ctx.getLibraryFile(d.ingestion.assetKey);if(old?.mediaRevision!==t.mediaRevision)throw Error('原件已变化。');await ctx.saveLibraryPreparation(p.id,d.id,d.ingestion.assetKey,t);records.set(t.id,t);}});
 return {
  async prepare({libraryId,retry=false}={}){const p=selected(),list=libraryId?[entry(libraryId).d]:(p?.library||[]).filter(d=>d.active!==false&&d.ingestion?.format==='video'),results=[];
   for(const d of list){const t=await load(d.id);results.push({libraryId:d.id,title:d.title,...(t.fmt==='video'?await video.prepare({docId:d.id,retry}):{state:d.ingestion.state,blockers:d.ingestion.blockers})});}return {projectId:p.id,materials:results};},
  async status({libraryId}={}){await load(libraryId);return video.status({docId:libraryId});},
  async analysis(file){records.set(file.id,file);return video.analysis(file);},
  readAsset:(file,id)=>video.readAsset(file,id)
 };
}
