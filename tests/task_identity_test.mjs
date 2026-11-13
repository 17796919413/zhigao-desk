import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTaskRuntime} from '../task-runtime.mjs';
import {createTaskBridge} from '../task-context.js';
let failures=0,checks=0;
const roots=[];
const call={name:'zhigao_get_review_brief',args:{docId:'D',batchId:'B'}};
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'zg-identity-'));roots.push(root);let count=0;const args={root,version:'test',inspect:async()=>({binding:{projectId:'P',fingerprint:'original-v1'},environment:{},requirements:[]}),prepare:async()=>{},verify:async()=>true,resume:async(p,checkpoint)=>{checkpoint('original');count++;throw Error('lost response');}};return {args,runtime:createTaskRuntime(args),count:()=>count};}
async function check(name,fn){try{await fn();checks++;console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+' '+e.message);}}
try{
await check('business identity ignores review round and brand rules but changes with original content',async()=>{
 const project={id:'P',notes:'first',rules:[],library:[]},doc={id:'D',projectId:'P',fmt:'text',flow:{round:1},cells:[{id:'p',current:'original'}]};
 const bridge=createTaskBridge({state:()=>({settings:{selected:'P',projects:[project]},tasks:[doc]})},{}),request={operation:'office',docId:'D'};
 const a=await bridge.context(request);project.notes='changed';doc.flow.round=2;const b=await bridge.context(request);
 assert.notEqual(a.binding.fingerprint,b.binding.fingerprint);assert.equal(a.binding.operationFingerprint,b.binding.operationFingerprint);
 const f=fixture();let binding=a.binding;f.args.inspect=async()=>({binding,environment:{},requirements:[]});f.runtime=createTaskRuntime(f.args);
 const p=await f.runtime.plan({...request,projectId:'P',originalCall:call});await f.runtime.resume(p);await f.runtime.wait(p.taskId);binding=b.binding;
 assert.equal((await f.runtime.plan({...request,projectId:'P',originalCall:call})).taskId,p.taskId);assert.equal(f.runtime.findOriginal(call,'P',binding).taskId,p.taskId);
 doc.cells[0].current='new original';const c=await bridge.context(request);assert.notEqual(c.binding.operationFingerprint,b.binding.operationFingerprint);assert.equal(f.runtime.findOriginal(call,'P',c.binding),null);
});
await check('decline cannot erase uncertain dispatched operation, even after restart or cancel',async()=>{
 const f=fixture(),p=await f.runtime.plan({operation:'office',projectId:'P',docId:'D',originalCall:call});await f.runtime.resume(p);await f.runtime.wait(p.taskId);
 await assert.rejects(f.runtime.confirm({...p,decision:'decline'}),{code:'INVALID_TASK_STATE'});
 f.runtime.cancel(p);f.runtime=createTaskRuntime(f.args);
 await assert.rejects(f.runtime.confirm({...p,decision:'decline'}),{code:'INVALID_TASK_STATE'});
 assert.equal(f.runtime.status(p).state,'uncertain');assert.equal(f.runtime.findOriginal(call,'P',{fingerprint:'original-v1'}).taskId,p.taskId);assert.equal(f.count(),1);
});
await check('retry, rereview, batch and review entry variations reuse one unresolved business operation',async()=>{
 const f=fixture(),p=await f.runtime.plan({operation:'office',projectId:'P',docId:'D',originalCall:call});await f.runtime.resume(p);await f.runtime.wait(p.taskId);f.runtime=createTaskRuntime(f.args);
 for(const originalCall of [call,...[false,true].map(retry=>({name:call.name,args:{batchId:'new-batch',retry,docId:'D'}})),{name:call.name,args:{docId:'D',rereview:true}},{name:'zhigao_reopen_review',args:{docId:'D'}}]){
  assert.equal(f.runtime.findOriginal(originalCall,'P',{fingerprint:'original-v1'})?.taskId,p.taskId);
  const again=await f.runtime.plan({operation:'office',projectId:'P',docId:'D',originalCall});assert.equal(again.taskId,p.taskId);await f.runtime.resume(again);
 }
 assert.equal(f.count(),1);
 assert.equal(f.runtime.findOriginal({...call,args:{docId:'other'}},'P',{fingerprint:'original-v1'}),null);
 assert.equal(f.runtime.findOriginal(call,'other',{fingerprint:'original-v1'}),null);
 assert.equal(f.runtime.findOriginal(call,'P',{fingerprint:'original-v2'}),null);
});
await check('late cancellation after dispatch cannot mark the original as not executed',async()=>{
 const f=fixture();let release;f.args.resume=async(p,checkpoint)=>{checkpoint('original');await new Promise(r=>release=r);return {result:{confirmed:true}};};f.runtime=createTaskRuntime(f.args);
 const p=await f.runtime.plan({operation:'office',projectId:'P',docId:'D',originalCall:call});await f.runtime.resume(p);while(!release)await new Promise(r=>setTimeout(r,1));f.runtime.cancel(p);release();await f.runtime.wait(p.taskId);assert.equal(f.runtime.status(p).state,'continued');
 await assert.rejects(f.runtime.confirm({...p,decision:'decline'}),{code:'INVALID_TASK_STATE'});
 const next=await f.runtime.plan({operation:'office',projectId:'P',docId:'D',originalCall:call});assert.notEqual(next.taskId,p.taskId);assert.equal(next.state,'ready');
});
}finally{for(const root of roots)fs.rmSync(root,{recursive:true,force:true});}
console.log(JSON.stringify({checks,failures}));if(failures)process.exitCode=1;
