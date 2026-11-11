import {purgeProject} from '../project-lifecycle.js';
import {feedbackRecord,feedbackFor} from '../draft-feedback.js';
import {makeBundle,readBundle} from '../bundle.js';
const assert=(v,m)=>{if(!v)throw Error(m);};
export async function run(){
 const checks=[],name='zhigao-cleanup-fixture-'+crypto.randomUUID();
 const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(name,1);q.onupgradeneeded=()=>{for(const s of ['tasks','items','media','batches','integrations','folders'])q.result.createObjectStore(s,{keyPath:'id'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 const op=(method,value,store)=>new Promise((resolve,reject)=>{const tx=db.transaction(store,method==='get'?'readonly':'readwrite'),q=tx.objectStore(store)[method](value);tx.oncomplete=()=>resolve(q.result);tx.onerror=()=>reject(tx.error);});
 try{
  await op('put',{id:'shared',file:{buffer:new ArrayBuffer(8)}},'media');await op('put',{id:'old',file:{buffer:new ArrayBuffer(8)}},'media');await op('put',{id:'d',projectId:'A'},'tasks');
  await purgeProject(db,{id:'A',assetKeys:['shared','old']},{protectedAssets:['shared']});assert(await op('get','shared','media'),'another brand shared asset preserved');assert(!await op('get','old','media'),'unreferenced original deleted');assert(!await op('get','d','tasks'),'task deleted');checks.push('品牌删除保留其他品牌仍引用的同一交接原件，清理本品牌独有原件');
  const p={id:'A',name:'甲',library:[],rules:[]},t={id:'d',projectId:'A',cells:[],flow:{round:1}};
  const bytes=new Uint8Array([1,2,3,4]).buffer;t.brandFeedback=[feedbackRecord(t,{title:'原件',text:'反馈原话',originalAsset:{fmt:'image',filename:'example.png',buffer:bytes}})];
  const blob=await makeBundle({projects:[p],items:[],docs:[t],media:[]}),restored=await readBundle(await blob.arrayBuffer());
  assert(feedbackFor(restored.docs[0]).length===1,'feedback binding survives bundle');assert(new Uint8Array(restored.docs[0].brandFeedback[0].originalAsset.buffer).join(',')==='1,2,3,4','feedback bytes survive bundle');checks.push('专属反馈交接包往返保留原话、品牌/稿件绑定与原件字节');
 }finally{db.close();indexedDB.deleteDatabase(name);}
 return checks;
}
