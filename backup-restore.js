import {validateProjectSnapshot,backupArtifactTarget} from './project-backup.js';

// Plan in memory first. The existing bundle-import transaction commits the new
// project and every record together; existing projects are never overwritten.
export function planProjectRestore(snapshot,settings,existing,makeId=()=>crypto.randomUUID()){
 validateProjectSnapshot(snapshot);
 const data=structuredClone(snapshot),source=data.projects[0],taken=new Set([
  ...settings.projects.map(p=>p.id),...(settings.deletedProjects||[]).map(p=>p.id),
  ...Object.values(existing).flatMap(rows=>rows.map(r=>typeof r==='string'?r:r.id))
 ]);
 // Deleted identities stay reserved: the shared import transaction rejects any
 // attempt to reuse them, even though the original record no longer exists.
 for(const row of existing.integrations||[]){const match=row.kind==='deleted-record'&&row.id.match(/^deleted-record:(?:tasks|items):(.+)$/s);if(match)taken.add(match[1]);}
 const fresh=old=>{let id=old;if(taken.has(id))do{id=makeId();}while(taken.has(id));taken.add(id);return id;};
 // A restored project always owns a fresh backup directory, even in an empty
 // browser. It must never take over the source browser's latest backup.
 taken.add(source.id);
 const projectId=fresh(source.id),itemIds=new Map(data.items.map(i=>[i.id,fresh(i.id)])),docIds=new Map(),assetIds=new Map(data.libraryAssets.map(a=>[a.id,fresh(a.id)])),batchIds=new Map(data.batches.map(b=>[b.id,fresh(b.id)]));
 // Embedded old rounds can share an original document identity. Reserve all
 // identities before changing any references, including references in feedback.
 function reserveDocument(d){if(d.id&&!docIds.has(d.id))docIds.set(d.id,fresh(d.id));for(const r of d.rounds||[])reserveDocument(r);}
 for(const d of data.docs)reserveDocument(d);
 const project={...source,id:projectId};
 project.name=source.name.replace(/（恢复副本）$/,'')+'（恢复副本）';
 for(const entry of project.library||[])if(entry.ingestion?.assetKey)entry.ingestion={...entry.ingestion,assetKey:assetIds.get(entry.ingestion.assetKey),...(entry.ingestion.format==='video'?{state:'pending',blockers:['恢复后需重新准备视频资料']}:{})};
 if(project.feishu){delete project.feishu.liveMeta;for(const sheet of project.feishu.sheets||[]){sheet.writeHistory=[];sheet.stale=true;}}
 const records=[];
 for(const a of data.libraryAssets)records.push(['media',{...a,id:assetIds.get(a.id)}]);
 for(const it of data.items){delete it.revision;records.push(['items',{...it,id:itemIds.get(it.id),projectId}]);}
 const resetDocument=(d,parent)=>{
  if(d.id)d.id=docIds.get(d.id);
  d.itemId=itemIds.get(d.itemId)||parent?.itemId;d.projectId=projectId;delete d.revision;delete d.originalSaved;d.saved=[];d.restoredOutputs=[];
  if(d.ai){delete d.ai.saved;if(batchIds.has(d.ai.batchId))d.ai.batchId=batchIds.get(d.ai.batchId);d.ai.archive={state:'waiting',message:'待重新授权保存文件夹',paths:[]};d.fullReviewPending=true;}
  for(const review of d.aiHistory||[]){delete review.saved;review.restoredOutputs=[];if(batchIds.has(review.batchId))review.batchId=batchIds.get(review.batchId);review.archive={state:'waiting',message:'历史结果待恢复',paths:[]};}
  if(d.fmt==='video'){d.videoAnalysis=null;d.videoPreparation=null;}
  for(const f of d.brandFeedback||[]){f.projectId=projectId;f.docId=d.id||parent?.id;}
  for(const r of d.rounds||[])resetDocument(r,d);
 };
 for(const d of data.docs){
  const originalId=d.id;
  resetDocument(d);
  const media=data.media.find(m=>m.id===originalId);if(media&&d.fmt==='video')d.originalFile=new File([media.blob],d.filename||'视频.mp4',{type:media.blob.type});
  records.push(['tasks',d]);if(media)records.push(['media',{...media,id:d.id}]);
 }
 for(const b of data.batches){
  b.id=batchIds.get(b.id);b.projectId=projectId;
  for(const e of b.entries){e.docId=docIds.get(e.docId);for(const k of ['reviewToken','sessionId','leaseExpiresAt','checkpointSeal','contextDelivery','mediaReceipts'])delete e[k];if(e.status==='reviewing'){e.status='interrupted';e.error='从备份恢复，请重新领取审核任务。';}}
  records.push(['batches',b]);
 }
 for(const row of data.integrations){
  row.id=fresh(row.id);row.projectId=projectId;if(row.docId)row.docId=docIds.get(row.docId);if(row.itemId)row.itemId=itemIds.get(row.itemId);
  if(row.kind==='review-checkpoint'){row.id='review-checkpoint:'+row.docId;row.entry={...row.entry,docId:row.docId,projectId,status:'interrupted'};for(const key of ['reviewToken','sessionId','leaseExpiresAt','checkpointSeal','contextDelivery','mediaReceipts'])delete row.entry[key];}
  if(row.kind==='pending-upload'){
   row.uploadId=fresh(makeId());row.id='upload:'+row.uploadId;
   if(row.target?.itemId&&itemIds.has(row.target.itemId))row.target={...row.target,itemId:itemIds.get(row.target.itemId)};
   row.choices=(row.choices||[]).map(choice=>choice.id?{...records.find(([s,v])=>s==='items'&&v.id===itemIds.get(choice.id))?.[1],revision:1}:choice);
   if(row.target?.it?.id)row.target={...row.target,it:row.choices.find(c=>c.id===itemIds.get(row.target.it.id))};
   if(['reading','queued'].includes(row.status))row.status='queued';
  }
  records.push(['integrations',row]);
 }
 for(const a of data.artifacts){
  const sourceRecord=backupArtifactTarget(snapshot.docs.find(d=>d.id===a.docId),a.recordPath);
  records.push(['integrations',{id:fresh('restored-output:'+makeId()),kind:'restored-output',projectId,docId:docIds.get(a.docId),sourcePath:a.path,recordPath:a.recordPath||[],original:a.original===true||sourceRecord.originalSaved===a.path,blob:a.blob}]);
 }
 return {settings:{...settings,selected:projectId,projects:[...settings.projects,project]},records,projectId,sourceProjectId:source.id,docIds,itemIds,assetIds};
}
