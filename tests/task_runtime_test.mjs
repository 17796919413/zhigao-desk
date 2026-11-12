import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTaskRuntime, taskError} from '../task-runtime.mjs';

let count = 0;
const roots = [];
function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhigao-task-')); roots.push(root);
  const state = {ready: false, binding: 'source-A', installs: 0, resumes: 0, clock: Date.now(), verify: true, ...options};
  const args = {root, version: '1.14.0', now: () => state.clock,
    inspect: async () => ({binding: {projectId: 'brand-A', fingerprint: state.binding}, environment: {os: 'isolated'}, requirements: [{id: 'media', state: state.ready ? 'ready' : 'needs_confirmation', action: 'prepare', fingerprint: 'pinned-v1', message: 'Prepare private component?'}]}),
    prepare: async () => { state.installs++; if (state.wait) await state.wait; if (state.fail) throw Object.assign(Error('secret-key=NEVER_ECHO'), {code: state.fail}); state.ready = true; },
    verify: async () => { if (!state.verify) throw Error('verification failed'); return {actualProbe: true}; },
    resume: async () => { state.resumes++; if (state.resumeFail) throw Object.assign(Error('uncertain'), {code: 'CALL_TRANSPORT_UNCERTAIN'}); return {result: {started: true}, next: {tool: 'original', args: {docId: 'doc-A'}}}; }};
  return {state, root, args, runtime: createTaskRuntime(args)};
}
const request = {operation: 'review', projectId: 'brand-A', docId: 'doc-A'};
async function check(name, fn) { await fn(); console.log('PASS ' + name); count++; }
try {
await check('planning is read-only and duplicate inspection reuses unexpired plan', async () => {
  const f = fixture(), a = await f.runtime.plan(request), b = await f.runtime.plan(request);
  assert.equal(a.state, 'awaiting_confirmation'); assert.equal(a.taskId, b.taskId); assert.equal(f.state.installs, 0);
});
await check('approval installs, verifies and continues the bound original exactly once', async () => {
  const f = fixture(), p = await f.runtime.plan(request), args = {taskId: p.taskId, revision: p.revision, decision: 'approve'};
  await Promise.all([f.runtime.confirm(args), f.runtime.confirm(args)]); await f.runtime.wait(p.taskId);
  const done = f.runtime.status(p); assert.equal(done.state, 'continued'); assert.equal(done.next.tool, 'original'); assert.equal(done.taskComplete, false);
  await f.runtime.confirm(args); await f.runtime.resume(p); assert.equal(f.state.installs, 1); assert.equal(f.state.resumes, 1);
});
await check('wrong revision and cross-task consent never execute', async () => {
  const f = fixture(), p = await f.runtime.plan(request), other = await f.runtime.plan({...request, docId: 'other'});
  await assert.rejects(f.runtime.confirm({taskId: p.taskId, revision: other.revision, decision: 'approve'}), {code: 'PLAN_CHANGED'}); assert.equal(f.state.installs, 0);
});
await check('decline and later arbitrary approve preserve task without installing', async () => {
  const f = fixture(), p = await f.runtime.plan(request); await f.runtime.confirm({...p, decision: 'decline'});
  await assert.rejects(f.runtime.confirm({...p, decision: 'approve'}), {code: 'CONFIRMATION_REQUIRED'}); assert.equal(f.state.installs, 0);
});
await check('expired approval requires fresh plan', async () => {
  const f = fixture(), p = await f.runtime.plan(request); f.state.clock += 31 * 60000;
  await assert.rejects(f.runtime.confirm({...p, decision: 'approve'}), {code: 'CONFIRMATION_REQUIRED'});
  assert.notEqual((await f.runtime.plan(request)).taskId, p.taskId);
});
await check('changed original invalidates consent before installation', async () => {
  const f = fixture(), p = await f.runtime.plan(request); f.state.binding = 'new-original';
  const next = await f.runtime.confirm({...p, decision: 'approve'}); assert.equal(next.state, 'awaiting_confirmation'); assert.notEqual(next.revision, p.revision); assert.equal(f.state.installs, 0);
});
await check('already usable environment verifies and resumes without confirmation or installation', async () => {
  const f = fixture({ready: true}), p = await f.runtime.plan(request); assert.equal(p.state, 'ready');
  await f.runtime.resume(p); await f.runtime.wait(p.taskId); const done = f.runtime.status(p); assert.equal(done.state, 'continued'); assert.equal(f.state.installs, 0);
});
await check('cancellation during preparation waits for safe completion and prevents resume', async () => {
  let release; const f = fixture({wait: new Promise(r => { release = r; })}), p = await f.runtime.plan(request);
  await f.runtime.confirm({...p, decision: 'approve'}); assert.equal(f.runtime.cancel(p).state, 'cancelling'); release(); await f.runtime.wait(p.taskId);
  assert.equal(f.runtime.status(p).state, 'cancelled'); assert.equal(f.state.resumes, 0);
});
await check('installation success without functional verification cannot resume', async () => {
  const f = fixture({verify: false}), p = await f.runtime.plan(request); await f.runtime.confirm({...p, decision: 'approve'}); await f.runtime.wait(p.taskId);
  assert.equal(f.runtime.status(p).state, 'failed'); assert.equal(f.state.resumes, 0);
});
await check('download/permission/disk failures preserve task and never echo credentials', async () => {
  for (const code of ['NETWORK', 'ENOSPC', 'EACCES', 'EPERM', 'INTEGRITY']) {
    const f = fixture({fail: code}), p = await f.runtime.plan(request); await f.runtime.confirm({...p, decision: 'approve'}); await f.runtime.wait(p.taskId);
    const result = f.runtime.status(p); assert.equal(result.state, 'failed'); assert.equal(result.error.code, code); assert(!JSON.stringify(result).includes('NEVER_ECHO'));
  }
});
await check('shared runtime serializes separate plans, preserving busy failure for retry', async () => {
  let release; const f = fixture({wait: new Promise(r => { release = r; })}), a = await f.runtime.plan(request), b = await f.runtime.plan({...request, docId: 'B'});
  await f.runtime.confirm({...a, decision: 'approve'}); await f.runtime.confirm({...b, decision: 'approve'}); await f.runtime.wait(b.taskId);
  assert.equal(f.runtime.status(b).error.code, 'PREPARATION_BUSY'); release(); await f.runtime.wait(a.taskId); assert.equal(f.state.installs, 1);
  await f.runtime.resume(b); await f.runtime.wait(b.taskId); assert.equal(f.runtime.status(b).state, 'continued'); assert.equal(f.state.installs, 1);
});
await check('persisted plan survives reconnect without losing original binding', async () => {
  const f = fixture(), p = await f.runtime.plan(request), next = createTaskRuntime(f.args);
  assert.deepEqual(next.status(p).binding, p.binding); await next.confirm({...p, decision: 'approve'}); await next.wait(p.taskId); assert.equal(next.status(p).state, 'continued');
});
await check('invalid identifiers and unknown operations cannot escape journal scope', async () => {
  const f = fixture(); assert.throws(() => f.runtime.status({taskId: '../outside'}), {code: 'TASK_NOT_FOUND'});
  await assert.rejects(f.runtime.plan({operation: 'arbitrary-command'}), {code: 'INVALID_TASK'});
});
await check('corrupt journal fails closed and is not silently overwritten', async () => {
  const f = fixture(), p = await f.runtime.plan(request), file = path.join(f.root, 'tasks', p.taskId + '.json'); fs.writeFileSync(file, '{');
  assert.throws(() => f.runtime.status(p), {code: 'TASK_NOT_FOUND'}); assert.equal(fs.readFileSync(file, 'utf8'), '{');
});
await check('changed original during install blocks automatic continuation', async () => {
  let release; const f = fixture({wait: new Promise(r => { release = r; })}), p = await f.runtime.plan(request); await f.runtime.confirm({...p, decision: 'approve'});
  f.state.binding = 'source-B'; release(); await f.runtime.wait(p.taskId); assert.equal(f.runtime.status(p).error.code, 'TASK_CHANGED'); assert.equal(f.state.resumes, 0);
});
await check('crashed owner is not assumed to have stopped installer children', async () => {
  const f = fixture({ready: true}), p = await f.runtime.plan(request); fs.writeFileSync(path.join(f.root, 'preparation.lock'), JSON.stringify({pid: 2147483647, taskId: p.taskId, key: 'old'}));
  await f.runtime.resume(p); await f.runtime.wait(p.taskId); const result = f.runtime.status(p); assert.equal(result.error.code, 'TASK_UNCERTAIN'); assert.equal(f.state.resumes, 0); assert(fs.existsSync(path.join(f.root, 'preparation.lock')));
});
await check('errors without public messages omit raw private process output', async () => {
  assert(!JSON.stringify(taskError(Error('password=secret'))).includes('password'));
});
await check('uncertain original result never becomes an automatic retry plan',async()=>{
 const f=fixture({ready:true,resumeFail:true}),p=await f.runtime.plan(request);await f.runtime.resume(p);await f.runtime.wait(p.taskId);
 const result=f.runtime.status(p);assert.equal(result.state,'uncertain');assert.equal(result.next.requiresUserReview,true);await f.runtime.resume(p);assert.equal(f.state.resumes,1);
});
await check('dependency becoming ready during execution still returns the same active plan',async()=>{
 let release;const f=fixture({wait:new Promise(r=>release=r)}),p=await f.runtime.plan(request);await f.runtime.confirm({...p,decision:'approve'});
 f.state.ready=true;assert.equal((await f.runtime.plan(request)).taskId,p.taskId);release();await f.runtime.wait(p.taskId);
});
await check('parallel resume callers cannot duplicate the original step',async()=>{
 const f=fixture({ready:true}),p=await f.runtime.plan(request);await Promise.all([f.runtime.resume(p),f.runtime.resume(p)]);await f.runtime.wait(p.taskId);assert.equal(f.state.resumes,1);
});
await check('new plan cannot bypass an uncertain original result',async()=>{
 const f=fixture({ready:true,resumeFail:true}),p=await f.runtime.plan(request);await f.runtime.resume(p);await f.runtime.wait(p.taskId);
 const again=await f.runtime.plan(request);assert.equal(again.taskId,p.taskId);assert.equal(again.state,'uncertain');assert.equal(f.state.resumes,1);
});
await check('cancellation during original resume cannot be reported as continued',async()=>{
 let release;const f=fixture({ready:true});f.args.resume=async()=>{await new Promise(r=>release=r);return {result:{completedStep:true}};};f.runtime=createTaskRuntime(f.args);
 const p=await f.runtime.plan(request);await f.runtime.resume(p);while(!release)await new Promise(r=>setTimeout(r,1));f.runtime.cancel(p);release();await f.runtime.wait(p.taskId);
 assert.equal(f.runtime.status(p).state,'cancelled');assert.equal(f.runtime.status(p).result.completedStep,true);
});
await check('corrupt unrelated journal does not block a different task',async()=>{
 const f=fixture(),p=await f.runtime.plan(request);fs.writeFileSync(path.join(f.root,'tasks',p.taskId+'.json'),'{');
 const next=await f.runtime.plan({...request,docId:'different'});assert.notEqual(next.taskId,p.taskId);
});
await check('crash recovery requires proof of reboot and preserves the old lock record',async()=>{
 const f=fixture({ready:true}),p=await f.runtime.plan(request),lock=path.join(f.root,'preparation.lock');
 fs.writeFileSync(lock,JSON.stringify({pid:2147483647,key:'old',taskId:p.taskId,createdAt:Date.now()}));
 await f.runtime.resume(p);await f.runtime.wait(p.taskId);assert.equal((await f.runtime.recover(p)).recovery.safe,false);assert(fs.existsSync(lock));
 const restarted=createTaskRuntime({...f.args,bootTime:()=>Date.now()+10000});const result=await restarted.recover(p);
 assert.equal(result.recovery.safe,true);assert.equal(result.state,'ready');assert(!fs.existsSync(lock));assert(fs.readdirSync(f.root).some(n=>n.startsWith('preparation.lock.recovered-')));
});
await check('explicit media model survives plan persistence and changes plan identity',async()=>{
 const f=fixture(),a=await f.runtime.plan({...request,mediaModel:'tiny'}),b=await f.runtime.plan({...request,mediaModel:'small'});assert.notEqual(a.taskId,b.taskId);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'tasks',a.taskId+'.json'))).request.mediaModel,'tiny');
 await assert.rejects(f.runtime.plan({...request,mediaModel:'unsupported'}),{code:'INVALID_TASK'});
});
await check('expiry between preparation steps cannot authorize the next component',async()=>{
 const f=fixture();let first=false,second=false;
 f.args.inspect=async()=>({binding:{projectId:'A'},environment:{},requirements:[{id:'one',state:first?'ready':'needs_confirmation',action:'one',fingerprint:'1'},{id:'two',state:second?'ready':'needs_confirmation',action:'two',fingerprint:'2'}]});
 f.args.prepare=async r=>{if(r.id==='one'){first=true;f.state.clock+=31*60000;}else second=true;};f.runtime=createTaskRuntime(f.args);
 const p=await f.runtime.plan(request);await f.runtime.confirm({...p,decision:'approve'});await f.runtime.wait(p.taskId);const next=f.runtime.status(p);
 assert.equal(first,true);assert.equal(second,false);assert.equal(next.state,'awaiting_confirmation');assert.notEqual(next.revision,p.revision);
});
await check('journal storage failure stops safely without unhandled rejection or false persistence',async()=>{
 const f=fixture(),p=await f.runtime.plan(request);let release;
 f.state.wait=new Promise(r=>release=r);await f.runtime.confirm({...p,decision:'approve'});
 const original=fs.renameSync;
 try{
  fs.renameSync=(from,to)=>{if(String(to).startsWith(path.join(f.root,'tasks')))throw Object.assign(Error('disk full'),{code:'ENOSPC'});return original(from,to);};
  release();await f.runtime.wait(p.taskId);
  const result=f.runtime.status(p);assert.equal(result.state,'uncertain');assert.equal(result.error.code,'ENOSPC');assert.equal(result.error.persisted,false);assert.equal(f.state.resumes,0);
 }finally{fs.renameSync=original;}
 const recovered=await f.runtime.recover(p);assert.equal(recovered.state,'ready');
});
await check('a timed out installer with possible descendants retains the preparation lock',async()=>{
 const f=fixture();f.args.prepare=async()=>{throw Object.assign(Error('timeout'),{code:'PROCESS_TIMEOUT',mayStillRun:true});};f.runtime=createTaskRuntime(f.args);
 const p=await f.runtime.plan(request);await f.runtime.confirm({...p,decision:'approve'});await f.runtime.wait(p.taskId);
 assert.equal(f.runtime.status(p).state,'uncertain');assert(fs.existsSync(path.join(f.root,'preparation.lock')));assert.equal((await f.runtime.recover(p)).recovery.safe,false);
});
console.log(JSON.stringify({passed: true, checks: count}));
} finally { for (const root of roots) fs.rmSync(root, {recursive: true, force: true}); }
