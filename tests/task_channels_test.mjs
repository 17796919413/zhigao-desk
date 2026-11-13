import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTaskRuntime} from '../task-runtime.mjs';
import {createTaskChannels} from '../task-channels.mjs';
import {runPrivate} from '../channel-runtime.mjs';
const roots=[];let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
function fixture(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'zg-channels-'));roots.push(home);
 const state={auth:'auth',identity:'A',access:null,resumes:0,logins:0,model:'large-v3-turbo',mediaReady:false,pending:false,originalCalls:0,source:'same-source'};
 const host={home,version:'1.14.0',site:'https://example.invalid/',
  pageCall:async(name,args)=>{
   if(name==='zhigao_task_context')return {binding:{projectId:'A',fingerprint:state.source},requirements:[{id:['review','office'].includes(args.operation)?'media':'feishu',state:'check_runtime'}],tableUrl:'https://example.feishu.cn/sheets/Synthetic',mediaIds:[],needsPreparation:state.pending};
   if(name==='zhigao_resume_prepared_task'){state.resumes++;if(state.resumeError&&(state.alwaysFail||state.resumes===1))throw Object.assign(Error('synthetic transport failure'),{code:state.resumeError});if(state.changeSource)state.source='changed-source';state.pending=false;return {result:{continued:true},next:{tool:'original'}};}
   state.originalCalls++;state.lastOriginal={name,args};if(state.originalError)throw Object.assign(Error('original response lost'),{code:state.originalError});return {reviewToken:'synthetic-review-token'};
  },
  mediaStatus:async()=>({ready:state.mediaReady,model:state.model,python:'synthetic-python',modelPath:'synthetic-model'}),
  prepareMedia:async(options)=>{state.mediaReady=true;state.model=options.model||state.model;},
  feishuStatus:async()=>({state:state.auth,accountFingerprint:state.identity}),
  inspectTable:async()=>{if(state.access)throw Object.assign(Error('private process secret'),state.access);},
  larkCommand:()=>({file:'synthetic-lark',prefix:[]}),
  larkJson:async(args)=>{if(args.includes('--device-code')){state.auth='ready';state.access=null;return {};}state.logins++;return {device_code:'PRIVATE_DEVICE',verification_url:'https://accounts.feishu.cn/synthetic',expires_in:600};}};
 const {tasks,automatic}=createTaskChannels(host,{createTaskRuntime,createChannelRuntime:()=>({busy:()=>false}),LARK_HASHES:{[process.platform+'-'+process.arch]:'test'},LARK_VERSION:'synthetic',OFFICE_PACKAGE:{},runPrivate:async()=>{throw Error('QR unavailable');}});
 return {tasks,automatic,state,home};
}
const request={operation:'feishu_read',projectId:'A'};
try{
await check('QR failure retains usable verified authorization URL and private device code',async()=>{
 const f=fixture(),p=await f.tasks.plan(request);await f.tasks.confirm({...p,decision:'approve'});await f.tasks.wait(p.taskId);
 const waiting=f.tasks.status(p);assert.equal(waiting.state,'waiting_for_user');assert.equal(waiting.userAction.kind,'feishu-login');assert(!JSON.stringify(waiting).includes('PRIVATE_DEVICE'));
 await Promise.all([f.tasks.resume(p),f.tasks.resume(p)]);await f.tasks.wait(p.taskId);assert.equal(f.tasks.status(p).state,'continued');assert.equal(f.state.logins,1);assert.equal(f.state.resumes,1);
});
await check('target scope request has its own confirmation and then rechecks actual target',async()=>{
 const f=fixture();f.state.auth='ready';f.state.access={code:'FEISHU_SCOPE',details:{missingScopes:['sheets:read']}};
 const p=await f.tasks.plan(request);assert.equal(p.requirements[0].action,'authorize_feishu');await f.tasks.confirm({...p,decision:'approve'});await f.tasks.wait(p.taskId);
 await f.tasks.resume(p);await f.tasks.wait(p.taskId);assert.equal(f.tasks.status(p).state,'continued');
});
await check('403/429/resource/network failures never become installation approval',async()=>{
 for(const code of ['FEISHU_ACCESS','FEISHU_RATE_LIMIT','FEISHU_NOT_FOUND','FEISHU_NETWORK']){const f=fixture();f.state.auth='ready';f.state.access={code};const p=await f.tasks.plan(request);assert.equal(p.state,'waiting_for_user');assert.equal(p.confirmation,null);assert.equal(f.state.logins,0);}
});
await check('account change before continuation forces a new checked revision',async()=>{
 const f=fixture();f.state.auth='ready';const p=await f.tasks.plan(request);f.state.identity='B';const next=await f.tasks.resume(p);assert.notEqual(next.revision,p.revision);assert.equal(f.state.resumes,0);
});
await check('explicit requested model is passed to actual preparation adapter',async()=>{
 const f=fixture(),p=await f.tasks.plan({operation:'review',projectId:'A',docId:'V',mediaModel:'tiny'});await f.tasks.confirm({...p,decision:'approve'});await f.tasks.wait(p.taskId);assert.equal(f.state.model,'tiny');assert.equal(f.tasks.status(p).state,'continued');
});
await check('normal review call automatically prepares then returns original result without a new UI action',async()=>{
 const f=fixture();f.state.mediaReady=true;f.state.pending=true;
 const response=await f.automatic('zhigao_get_review_brief',{docId:'D'});assert(response.preparation);assert.equal(response.preparation.confirmation,null);
 await f.tasks.wait(response.preparation.taskId);const done=f.tasks.status(response.preparation);assert.equal(done.state,'continued');assert.equal(done.result.originalResult.reviewToken,'synthetic-review-token');assert.equal(f.state.originalCalls,1);
 assert.equal(await f.automatic('zhigao_get_review_brief',{docId:'D'}),null);
});
await check('normal read call discovers missing authentication and never authorizes a cloud write',async()=>{
 const f=fixture(),response=await f.automatic('zhigao_extract_feishu',{});assert.equal(response.preparation.state,'awaiting_confirmation');assert.equal(f.state.logins,0);
 assert.equal(await f.automatic('zhigao_extract_feishu',{createDocument:true}),null);assert.equal(await f.automatic('zhigao_submit_review',{}),null);
});
await check('rereview and batch arguments survive automatic preparation and remain bound to the same draft',async()=>{
 const f=fixture();f.state.mediaReady=true;f.state.pending=true;
 const args={docId:'D',batchId:'B',retry:true,rereview:true};
 const response=await f.automatic('zhigao_get_review_brief',args);await f.tasks.wait(response.preparation.taskId);
 assert.deepEqual(f.state.lastOriginal,{name:'zhigao_get_review_brief',args});assert.equal(f.tasks.status(response.preparation).next.args.batchId,'B');
 const saved=JSON.parse(fs.readFileSync(path.join(f.home,'task-runtime','tasks',response.preparation.taskId+'.json')));assert.equal(saved.request.projectId,'A');
});
await check('explicit table URL still discovers missing authorization and preserves its title',async()=>{
 const f=fixture(),args={url:'https://example.feishu.cn/sheets/Explicit',title:'Synthetic title',createDocument:false};
 const response=await f.automatic('zhigao_extract_feishu',args);assert.equal(response.preparation.state,'awaiting_confirmation');
 const saved=JSON.parse(fs.readFileSync(path.join(f.home,'task-runtime','tasks',response.preparation.taskId+'.json')));assert.deepEqual(saved.request.originalCall.args,args);
});
await check('preparation cannot bind one draft then execute another or silently grant a cloud write',async()=>{
 const f=fixture();
 for(const request of [
  {operation:'office',docId:'A',originalCall:{name:'zhigao_get_review_brief',args:{docId:'B'}}},
  {operation:'feishu_read',originalCall:{name:'zhigao_extract_feishu',args:{createDocument:true}}},
  {operation:'library',docId:'A',originalCall:{name:'zhigao_get_review_brief',args:{docId:'A'}}},
  {operation:'office',docId:'A',originalCall:{name:'zhigao_get_review_brief',args:{docId:'A',rereview:'true'}}},
 ])await assert.rejects(f.tasks.plan(request),{code:'INVALID_TASK'});
 assert.equal(f.state.resumes,0);
});
await check('refresh during idempotent preparation resumes the same task before executing original once',async()=>{
 for(const resumeError of ['PAGE_SESSION_CHANGED','PREPARATION_TRANSPORT']){
 const f=fixture();Object.assign(f.state,{mediaReady:true,pending:true,resumeError});
 const response=await f.automatic('zhigao_get_review_brief',{docId:'D'});await f.tasks.wait(response.preparation.taskId);
 assert.equal(f.tasks.status(response.preparation).state,'continued');assert.equal(f.state.resumes,2);assert.equal(f.state.originalCalls,1);
 }
});
await check('execution timeout and changed source do not silently replay an original call',async()=>{
 for(const flags of [{resumeError:'CALL_EXECUTION_TIMEOUT'},{changeSource:true}]){
  const f=fixture();Object.assign(f.state,{mediaReady:true,pending:true,...flags});
  const response=await f.automatic('zhigao_get_review_brief',{docId:'D'});await f.tasks.wait(response.preparation.taskId);
  assert.equal(f.tasks.status(response.preparation).state,'uncertain');assert.equal(f.state.resumes,1);assert.equal(f.state.originalCalls,0);
 }
});
await check('original retry cannot bypass unresolved task after prerequisites become ready',async()=>{
 const f=fixture();Object.assign(f.state,{mediaReady:true,pending:true,resumeError:'CALL_EXECUTION_TIMEOUT'});
 const args={docId:'D'},first=await f.automatic('zhigao_get_review_brief',args);await f.tasks.wait(first.preparation.taskId);f.state.pending=false;
 const again=await f.automatic('zhigao_get_review_brief',args);assert.equal(again.preparation.taskId,first.preparation.taskId);assert.equal(again.preparation.state,'uncertain');assert.equal(f.state.resumes,1);
});
await check('lost original result remains uncertain across retry, recover and resume without another dispatch',async()=>{
 for(const originalError of ['PAGE_SESSION_CHANGED','CALL_EXECUTION_TIMEOUT']){
  const f=fixture();Object.assign(f.state,{mediaReady:true,pending:true,originalError});
  const args={docId:'D'},first=await f.automatic('zhigao_get_review_brief',args);await f.tasks.wait(first.preparation.taskId);
  const saved=JSON.parse(fs.readFileSync(path.join(f.home,'task-runtime','tasks',first.preparation.taskId+'.json')));
  assert.equal(saved.resumeCheckpoint,'original');assert.equal(saved.state,'uncertain');assert.equal(f.state.originalCalls,1);
  const retry=await f.automatic('zhigao_get_review_brief',args);assert.equal(retry.preparation.taskId,first.preparation.taskId);
  const checked=await f.tasks.recover(first.preparation);assert.equal(checked.recovery.safe,false);
  assert.equal((await f.tasks.resume(first.preparation)).state,'uncertain');assert.equal(f.state.originalCalls,1);
  assert.equal(f.tasks.cancel(first.preparation).state,'uncertain');
  assert.equal((await f.automatic('zhigao_get_review_brief',args)).preparation.taskId,first.preparation.taskId);
  assert.equal(f.state.originalCalls,1);
 }
});
await check('private command timeout is bounded even when a descendant holds its output pipe',async()=>{
 const started=Date.now();
 const script=`require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2000)'],{stdio:['ignore',1,2],windowsHide:true});setTimeout(()=>{},5000)`;
 await assert.rejects(runPrivate(process.execPath,['-e',script],{timeout:300}),e=>e.code==='PROCESS_TIMEOUT'&&e.mayStillRun);
 assert(Date.now()-started<1500);
});
await check('Office checkpoint failures can explicitly recover only before original dispatch',async()=>{
 for(const resumeError of ['CONVERSION_CHECKPOINT_UNSAVED','ENOSPC','EACCES','EPERM','EBUSY']){
  const f=fixture();f.state.mediaReady=true;f.state.pending=true;f.state.resumeError=resumeError;
  const first=await f.automatic('zhigao_get_review_brief',{docId:'D'});await f.tasks.wait(first.preparation.taskId);
  assert.equal(f.tasks.status(first.preparation).state,'uncertain');assert.equal(f.state.originalCalls,0);
  const checked=await f.tasks.recover(first.preparation);assert.equal(checked.recovery.safe,true);await f.tasks.resume(checked);await f.tasks.wait(checked.taskId);
  assert.equal(f.tasks.status(checked).state,'continued');assert.equal(f.state.originalCalls,1);
 }
});
await check('exhausted preparation reconnect can recover only before the original call is dispatched',async()=>{
 const f=fixture();Object.assign(f.state,{mediaReady:true,pending:true,resumeError:'PREPARATION_TRANSPORT',alwaysFail:true});
 const first=await f.automatic('zhigao_get_review_brief',{docId:'D'});await f.tasks.wait(first.preparation.taskId);
 assert.equal(f.tasks.status(first.preparation).state,'uncertain');assert.equal(f.state.resumes,3);assert.equal(f.state.originalCalls,0);
 f.state.alwaysFail=false;f.state.resumeError=null;
 const checked=await f.tasks.recover(first.preparation);assert.equal(checked.recovery.safe,true);await f.tasks.resume(checked);await f.tasks.wait(checked.taskId);
 assert.equal(f.tasks.status(checked).state,'continued');assert.equal(f.state.originalCalls,1);
});
await check('a genuinely changed source does not inherit an older uncertain preparation',async()=>{
 const f=fixture();Object.assign(f.state,{mediaReady:true,pending:true,resumeError:'CALL_EXECUTION_TIMEOUT'});
 const args={docId:'D'},first=await f.automatic('zhigao_get_review_brief',args);await f.tasks.wait(first.preparation.taskId);
 Object.assign(f.state,{source:'new-round-source',resumeError:null});
 const second=await f.automatic('zhigao_get_review_brief',args);assert.notEqual(second.preparation.taskId,first.preparation.taskId);
 await f.tasks.wait(second.preparation.taskId);assert.equal(f.tasks.status(second.preparation).state,'continued');
});
console.log(JSON.stringify({passed:true,checks}));
}finally{for(const root of roots)fs.rmSync(root,{recursive:true,force:true});}
