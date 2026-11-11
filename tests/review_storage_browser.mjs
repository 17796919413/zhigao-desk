import {deleteContentRecords} from '../content-delete.js';
import {createKnowledgeCache} from '../review-knowledge.js';
const assert=(value,message)=>{if(!value)throw Error(message);};
export async function run(){
 const checks=[],name='isolated-review-storage-'+crypto.randomUUID();
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{for(const s of ['tasks','items','media','batches','integrations'])r.result.createObjectStore(s,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const op=(method,value,store='integrations')=>new Promise((resolve,reject)=>{const tx=db.transaction(store,method==='get'||method==='getAll'?'readonly':'readwrite'),r=value===undefined?tx.objectStore(store)[method]():tx.objectStore(store)[method](value);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
 try{
  const p={id:'brand',name:'合成品牌',notes:'原文😀',rules:[],library:[]};
  const options={load:async id=>(await op('get','review-knowledge:'+id))?.cache,save:async(id,cache)=>op('put',{id:'review-knowledge:'+id,kind:'review-knowledge',cache})};
  await createKnowledgeCache(options)(p);const restored=await createKnowledgeCache(options)(p);assert(restored.cache.hit&&restored.cache.origin==='persistent','persistent cache reload');checks.push('IndexedDB 原文缓存跨实例命中');
  const corrupt=await op('get','review-knowledge:brand');corrupt.cache.data.sources[0].text='corrupt';await op('put',corrupt);const fresh=await createKnowledgeCache(options)(p);assert(!fresh.cache.hit&&fresh.sources[0].text===p.notes,'cache corruption fallback');checks.push('IndexedDB 缓存损坏回退当前原文');
  await op('put',{id:'d',itemId:'i',projectId:'brand'},'tasks');await op('put',{id:'i',projectId:'brand'},'items');await op('put',{id:'d',blob:new Blob(['fixture'])},'media');
  await op('put',{id:'review-checkpoint:d',kind:'review-checkpoint',docId:'d',entry:{} });
  await op('put',{id:'legacy-extraction',projectId:'brand',entries:[],taskIds:['i']});
  let rejected=false;try{await deleteContentRecords(db,{docIds:['d','missing']});}catch{rejected=true;}
  assert(rejected&&await op('get','d','tasks')&&await op('get','review-checkpoint:d'),'failed transaction rollback');checks.push('删除校验失败保留稿件和检查点');
  await deleteContentRecords(db,{docIds:['d']});assert(!await op('get','d','tasks')&&!await op('get','review-checkpoint:d'),'checkpoint deletion');assert(await op('get','review-knowledge:brand'),'brand cache preserved');assert((await op('get','legacy-extraction')).taskIds.length===0,'legacy record preserved');checks.push('删除稿件原子移除检查点并保留品牌缓存与旧提炼记录');
 }finally{db.close();indexedDB.deleteDatabase(name);}
 return checks;
}
