// 只删除知稿数据库记录；不接触本地归档文件或飞书。
export function deleteContentRecords(db,{docIds=[],itemId=null}){
 if(!db)return Promise.reject(Error('浏览器数据库不可用，未执行删除。'));
 return new Promise((resolve,reject)=>{
  const stores=['tasks','items','media','batches','integrations'],reads=stores.filter(s=>s!=='media'),tx=db.transaction(stores,'readwrite'),snapshot={};let result,error,remaining=reads.length;
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(error||tx.error||Error('删除失败，请重试。'));tx.onabort=()=>reject(error||tx.error||Error('删除未完成，请重试。'));
  const abort=e=>{error=e;tx.abort();};
  for(const store of reads){const request=tx.objectStore(store).getAll();request.onsuccess=()=>{snapshot[store]=request.result;if(--remaining)return;
   try{
    const ids=new Set(docIds),selected=snapshot.tasks.filter(t=>ids.has(t.id));
    if(selected.length!==ids.size)throw Error('稿件列表已变化，请刷新后再删除。');
    if(itemId){if(!snapshot.items.some(i=>i.id===itemId)||snapshot.tasks.some(t=>t.itemId===itemId&&!ids.has(t.id)))throw Error('任务已有新稿件或已变化，请刷新后再删除。');if(selected.some(t=>t.itemId!==itemId))throw Error('稿件不属于所选任务。');}
    if(selected.some(t=>t.ai?.archive?.state==='saving'))throw Error('稿件正在归档，请完成后再删除。');
    const removedItems=new Set(itemId?[itemId]:[]);
    for(const t of selected)if(!snapshot.tasks.some(other=>other.itemId===t.itemId&&!ids.has(other.id)))removedItems.add(t.itemId);
    // 旧版删稿曾留下批次占位。仅清理已无稿件、且能唯一归到本次任务的同项目同达人记录。
    const owners=snapshot.items.filter(i=>removedItems.has(i.id)&&i.author&&!snapshot.items.some(other=>!removedItems.has(other.id)&&other.projectId===i.projectId&&other.author===i.author));
    const liveIds=new Set(snapshot.tasks.map(t=>t.id));
    for(const b of snapshot.batches)for(const e of b.entries)if(!liveIds.has(e.docId)&&owners.some(i=>i.projectId===b.projectId&&i.author===e.author))ids.add(e.docId);
    for(const id of ids){tx.objectStore('tasks').delete(id);tx.objectStore('media').delete(id);}
    for(const id of removedItems)tx.objectStore('items').delete(id);
    const updatedBatches=[],deletedBatches=[],updatedIntegrations=[];
    for(const b of snapshot.batches){const entries=b.entries.filter(e=>!ids.has(e.docId));if(entries.length===b.entries.length)continue;if(!entries.length){tx.objectStore('batches').delete(b.id);deletedBatches.push(b.id);}else{const updated={...b,entries,updated:new Date().toISOString()};tx.objectStore('batches').put(updated);updatedBatches.push(updated);}}
    for(const integration of snapshot.integrations){if(!integration.taskIds?.some(id=>removedItems.has(id)))continue;const updated={...integration,taskIds:integration.taskIds.filter(id=>!removedItems.has(id))};tx.objectStore('integrations').put(updated);updatedIntegrations.push(updated);}
    result={docIds:[...ids],itemIds:[...removedItems],updatedBatches,deletedBatches,updatedIntegrations};
   }catch(e){abort(e);}
  };}
 });
}
