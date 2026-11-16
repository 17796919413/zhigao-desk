// All record versions are checked inside the same transaction as their writes.
export const recordKey=(store,id)=>store+':'+id;
export const tombstoneKey=(store,id)=>'deleted-record:'+recordKey(store,id);
const versioned=store=>store==='tasks'||store==='items';
export function writeRecords(db,records,{expected=new Map(),required=[],guard,beforeCommit}={}){
 if(!db)return Promise.reject(Error('浏览器数据库不可用。'));
 return new Promise((resolve,reject)=>{
  let failure;const tx=db.transaction([...new Set(['integrations',...records.map(([s])=>s),...required.map(([s])=>s)])],'readwrite');
  const writes=records.map(([s,v])=>[s,Object.hasOwn(v,'buffer')?{...structuredClone({...v,buffer:null}),buffer:v.buffer}:structuredClone(v)]),live=new Map(),deleted=new Map();
  tx.oncomplete=()=>resolve(writes);
  tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error('未保存，请重试。'));
  const abort=e=>{failure=e;tx.abort();};
  const checks=new Map(required.map(([s,id])=>[recordKey(s,id),[s,id]]));
  for(const [s,v] of writes)if(versioned(s))checks.set(recordKey(s,v.id),[s,v.id]);
  let left=checks.size*2;
  const commit=()=>{try{
   for(const [s,id] of required)if(!live.get(recordKey(s,id)))throw Error('稿件或任务已删除，请刷新页面。');
   for(const [s,v] of writes)if(versioned(s)){
    const key=recordKey(s,v.id),old=live.get(key),revision=expected.get(key);
    if(deleted.get(key)||revision!==null&&revision!==undefined&&!old)throw Error('稿件或任务已删除，请刷新页面。');
    if(revision===null||revision===undefined){if(old)throw Error('记录已存在，请刷新后重试。');}
    else if((old.revision||0)!==revision)throw Error('记录已在其他页面更新，请保留输入并刷新后重试。');
    v.revision=(old?.revision||0)+1;
   }
   guard?.();
   for(const [s,v] of writes)tx.objectStore(s).put(v);
   beforeCommit?.(tx);
  }catch(e){abort(e);}};
  try{
   if(!left)commit();
   for(const [key,[s,id]] of checks){
    const r=tx.objectStore(s).get(id);r.onsuccess=()=>{live.set(key,r.result);if(!--left)commit();};
    const d=tx.objectStore('integrations').get(tombstoneKey(s,id));d.onsuccess=()=>{deleted.set(key,d.result);if(!--left)commit();};
   }
  }catch(e){abort(e);}
 });
}

const SETTINGS='zhigao-settings-v1';
export const readRecords=(db,store)=>new Promise((resolve,reject)=>{const tx=db.transaction(store),q=tx.objectStore(store).getAll();tx.oncomplete=()=>resolve(q.result);tx.onerror=()=>reject(tx.error);});
const lock=fn=>navigator.locks?navigator.locks.request('zhigao-bundle-import',fn):fn();
const journalOp=(db,method,value)=>new Promise((resolve,reject)=>{const tx=db.transaction('integrations','readwrite');const q=tx.objectStore('integrations')[method](value);tx.oncomplete=()=>resolve(q.result);tx.onerror=tx.onabort=()=>reject(tx.error);});
const restoreSettings=(before,after)=>{const current=localStorage.getItem(SETTINGS);if(current===before)return;if(current!==after)throw Error('导入期间品牌设置已变化，请保留交接包并核对设置。');if(before===null)localStorage.removeItem(SETTINGS);else localStorage.setItem(SETTINGS,before);};
// Prepared journals are persisted before any settings write. The committed marker
// shares the transaction with every imported record; startup can distinguish both.
async function recoverImports(db){
 const journals=await journalOp(db,'getAll');
 for(const j of journals.filter(x=>x.kind==='bundle-import')){
  if(j.state==='prepared')restoreSettings(j.before,j.after);
  else if(localStorage.getItem(SETTINGS)===j.before)localStorage.setItem(SETTINGS,j.after);
  await journalOp(db,'delete',j.id);
 }
}
export const recoverBundleImports=db=>lock(()=>recoverImports(db));
export function commitBundleImport(db,records,nextSettings,baseline){return lock(async()=>{
 await recoverImports(db);
 const before=localStorage.getItem(SETTINGS),after=JSON.stringify(nextSettings);
 if(before!==baseline)throw Error('品牌设置已变化，请重新打开交接包。');
 const j={id:'bundle-import:'+crypto.randomUUID(),kind:'bundle-import',state:'prepared',before,after};
 await journalOp(db,'put',j);
 let committed;
 try{committed=await writeRecords(db,[...records,['integrations',{...j,state:'committed'}]],{
  guard:()=>{if(localStorage.getItem(SETTINGS)!==before)throw Error('品牌设置已变化，请重新打开交接包。');},
  beforeCommit:()=>localStorage.setItem(SETTINGS,after)
 });}catch(e){
  try{restoreSettings(before,after);await journalOp(db,'delete',j.id);}catch{throw Error('导入未完成，请刷新页面恢复后再试。');}
  throw e;
 }
 // Cleanup failure is recoverable: the durable committed marker prevents replay.
 try{await journalOp(db,'delete',j.id);}catch{}
 return committed.filter(([s,v])=>s!=='integrations'||v.id!==j.id);
});}
