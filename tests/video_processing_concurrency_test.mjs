import assert from 'node:assert/strict';
import {createVideoProcessor} from '../video-processing.js';

const make=()=>({id:'video',projectId:'brand',fmt:'video',revision:1,mediaRevision:'original',videoPreparation:{state:'processing',job:{jobId:'job',jobToken:'synthetic'}}});
const report={reportHash:'report',sourceHash:'source',assets:[],supplementalText:[]};
const originalFetch=globalThis.fetch;
function fixture(){
 const task=make();let databaseRevision=1,saves=0;
 const ctx={state:()=>({settings:{selected:'brand'},tasks:[task]}),save:async value=>{
  await new Promise(r=>setTimeout(r,5));
  assert.equal(value.revision,databaseRevision,'stale revision must not overwrite storage');
  saves++;databaseRevision++;Object.assign(task,value,{revision:databaseRevision});
 }};
 globalThis.fetch=async(_url,{body})=>({ok:true,json:async()=>({ok:true,data:JSON.parse(body).action==='result'?report:{state:'complete',reportHash:'report'}})});
 return {task,processor:createVideoProcessor(ctx),saves:()=>saves,externalWrite:()=>{databaseRevision++;}};
}
try{
 let f=fixture();
 const results=await Promise.allSettled([f.processor.status({docId:'video'}),f.processor.status({docId:'video'})]);
 assert.ok(results.every(r=>r.status==='fulfilled'),JSON.stringify(results.map(r=>({status:r.status,error:r.reason?.message}))));
 assert.equal(f.saves(),1);assert.equal(f.task.videoPreparation.state,'complete');assert.equal(f.task.videoAnalysis.reportHash,'report');
 console.log('PASS overlapping progress polls share one persisted completion');

 f=fixture();f.externalWrite();
 await assert.rejects(f.processor.status({docId:'video'}),/stale revision/);
 assert.equal(f.saves(),0);assert.equal(f.task.videoAnalysis,undefined);
 console.log('PASS external storage conflict remains rejected');

 f=fixture();let release;const gate=new Promise(r=>release=r);
 globalThis.fetch=async()=>{await gate;return {ok:true,json:async()=>({ok:true,data:{state:'complete',reportHash:'report'}})};};
 const pending=f.processor.status({docId:'video'});f.task.mediaRevision='replacement';release();
 await assert.rejects(pending,/原件或品牌已变化/);assert.equal(f.saves(),0);
 console.log('PASS changed original cannot receive a delayed old preparation');
}finally{globalThis.fetch=originalFetch;}
