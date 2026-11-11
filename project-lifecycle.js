import {sameData} from './project-data.js';

export function persistSettingsChange(current,next,storage=localStorage){
 const key='zhigao-settings-v1',raw=storage.getItem(key);
 const normalized=value=>({...value,projects:value.projects.map(p=>({...p,...(p.id==='sailimu'&&!p.status?{status:'ended',sample:true}:{}),library:p.library||[],feishu:p.feishu||{source:null,refined:null,sheets:[]}}))});
 if(raw&&!sameData(normalized(JSON.parse(raw)),normalized(current)))throw Error('另一个页面已更新资料，请刷新后重试。');
 storage.setItem(key,JSON.stringify(next));
 return next;
}
export function removeRule(project,id){
 const p=structuredClone(project),removed=p.rules.find(r=>r.id===id);
 if(!removed)throw Error('口径已删除，请刷新页面。');
 // Deleting a replacement must not silently reactivate an older superseded rule.
 const disabled=new Set();
 const visit=key=>{if(disabled.has(key))return;disabled.add(key);for(const old of p.rules.find(r=>r.id===key)?.supersedes||[])visit(old);};
 for(const old of removed.supersedes||[])visit(old);
 p.rules=p.rules.filter(r=>r.id!==id).map(r=>({...r,...(disabled.has(r.id)?{enabled:false}:{}),supersedes:(r.supersedes||[]).filter(key=>key!==id)}));
 return p;
}
export function projectTombstone(p){
 const keys=new Set();
 const collect=d=>{if(d.ingestion?.assetKey)keys.add(d.ingestion.assetKey);for(const h of d.history||[])collect(h);};
 for(const d of p.library||[])collect(d);
 return {id:p.id,assetKeys:[...keys]};
}
// One IndexedDB transaction removes all workspace-owned data for this brand.
// The settings tombstone is written first; a crash can only leave unreachable data.
export function purgeProject(db,tombstone,{protectedAssets=[]}={}){
 if(!db)return Promise.reject(Error('浏览器数据库不可用。'));
 return new Promise((resolve,reject)=>{
  const stores=['tasks','items','media','batches','integrations','folders'],tx=db.transaction(stores,'readwrite'),all={};let left=stores.length,error;
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error||Error('删除未完成。'));
  for(const name of stores){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{
   all[name]=request.result;if(--left)return;
   try{
    const protectedKeys=new Set(protectedAssets);
    const docIds=new Set(all.tasks.filter(t=>t.projectId===tombstone.id).map(t=>t.id)),assets=new Set((tombstone.assetKeys||[]).filter(k=>!protectedKeys.has(k)));
    for(const name of stores)for(const row of all[name]){
     const owned=row.projectId===tombstone.id||name==='folders'&&row.id===tombstone.id||name==='media'&&(docIds.has(row.id)||assets.has(row.id))||name==='integrations'&&docIds.has(row.docId);
     if(owned)tx.objectStore(name).delete(row.id);
    }
   }catch(e){error=e;tx.abort();}
  };}
 });
}
