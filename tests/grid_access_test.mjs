import assert from 'node:assert/strict';
import {createGridAccess} from '../grid-access.js';
const checks=[];
const turn=()=>new Promise(r=>setTimeout(r,5));
function fixture(){
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const c={projectId:'A',activityId:'one',url:'https://test.feishu.cn/sheets/book',sheetId:'s'},plans=[],errors=[];
 let code='FEISHU_AUTH',details,calls=0,resumes=0,settleOnResume=false;
 const access=createGridAccess({storage,context:()=>({...c}),prepare:async p=>plans.push(p),onError:e=>errors.push(e),request:async()=>{calls++;if(code)throw Object.assign(Error(code),{code,details});return {ok:true};},resume:async()=>{resumes++;if(settleOnResume)access.settle('gridStructure');await access.request('gridRead',{url:c.url});}});
 return {access,c,plans,errors,map,storage,setCode:(v,d)=>{code=v;details=d;},settleDuringResume:()=>{settleOnResume=true;},counts:()=>({calls,resumes})};
}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
await check('prewrite reads preserve the pending write intent without storing cells or tokens',async()=>{
 const f=fixture();await assert.rejects(f.access.request('gridRead',{url:f.c.url,token:'private-token',cell:{value:'private-body'}},'gridWrite'));await turn();
 const id=f.plans[0].originalCall.args.continuationId;assert.equal(f.access.pending(id).action,'gridWrite');assert(!JSON.stringify([...f.map]).includes('private-'));
 await assert.rejects(f.access.request('gridRead',{url:f.c.url}));await turn();assert.equal(f.access.pending(id).action,'gridWrite');
 f.setCode(null);await f.access.resume(id);assert.equal(f.counts().resumes,1);assert.equal(f.map.size,0);await assert.rejects(f.access.resume(id),{code:'TASK_CHANGED'});
});
await check('project, activity, URL and subtable changes reject continuation before any operation',async()=>{
 for(const key of ['projectId','activityId','url','sheetId']){
  const f=fixture();await assert.rejects(f.access.request('gridWrite',{url:f.c.url}));await turn();const id=f.plans[0].originalCall.args.continuationId;
  f.c[key]='changed';const before=f.counts();await assert.rejects(f.access.resume(id),{code:'TASK_CHANGED'});assert.deepEqual(f.counts(),before);assert.equal(f.map.size,1);
 }
});
await check('access denial, rate limit, network, uncertain writes and unproven scope errors never authorize replay',async()=>{
 for(const code of ['FEISHU_ACCESS','FEISHU_RATE_LIMIT','FEISHU_NETWORK','GRID_UNCERTAIN','FEISHU_SCOPE']){
  const f=fixture();f.setCode(code);await assert.rejects(f.access.request('gridWrite',{url:f.c.url}));await turn();assert.equal(f.plans.length,0);assert.equal(f.map.size,0);
 }
});
await check('explicitly rejected write scope is persisted without cell content and resumes once',async()=>{
 const f=fixture();f.setCode('FEISHU_SCOPE',{definitelyNotExecuted:true,missingScopes:['sheets:spreadsheet','sheets:spreadsheet','invalid scope']});
 await assert.rejects(f.access.request('gridWrite',{url:f.c.url,cell:{value:'private-body'}}));await turn();
 const id=f.plans[0].originalCall.args.continuationId,p=f.access.pending(id);assert.deepEqual(p.scopeRequest.scopes,['sheets:spreadsheet']);assert(!JSON.stringify([...f.map]).includes('private-body'));
 f.setCode(null);await f.access.resume(id);assert.equal(f.map.size,0);
});
await check('failed continuation preserves identity and does not recursively create another plan',async()=>{
 const f=fixture();await assert.rejects(f.access.request('gridRead',{url:f.c.url}));await turn();const id=f.plans[0].originalCall.args.continuationId;
 await assert.rejects(f.access.resume(id));await turn();assert.equal(f.plans.length,1);assert.equal(f.access.pending(id).id,id);
});
await check('ticket persistence failure stops preparation without losing the original error',async()=>{
 const f=fixture();f.storage.setItem=()=>{throw Error('quota');};await assert.rejects(f.access.request('gridWrite',{url:f.c.url}),{code:'FEISHU_AUTH'});await turn();assert.equal(f.plans.length,0);assert.equal(f.errors[0].message,'quota');
});
await check('manually settled structure attempts stop restoring their old access preparation',async()=>{
 const f=fixture();await assert.rejects(f.access.request('gridStructure',{url:f.c.url}));await turn();assert.equal(f.access.restore(),true);await turn();
 f.access.settle('gridStructure');assert.equal(f.map.size,0);assert.equal(f.access.restore(),false);
});
await check('settling a structure attempt preserves other actions and other identities',async()=>{
 const cell=fixture();await assert.rejects(cell.access.request('gridWrite',{url:cell.c.url}));await turn();cell.access.settle('gridStructure');assert.equal(cell.map.size,1);
 for(const key of ['projectId','activityId','url','sheetId']){
  const f=fixture();await assert.rejects(f.access.request('gridStructure',{url:f.c.url}));await turn();f.c[key]='changed';f.access.settle('gridStructure');assert.equal(f.map.size,1);
 }
});
await check('normal access continuation owns ticket removal until its result is confirmed',async()=>{
 const f=fixture();await assert.rejects(f.access.request('gridStructure',{url:f.c.url}));await turn();const id=f.plans[0].originalCall.args.continuationId;
 f.settleDuringResume();f.setCode(null);const result=await f.access.resume(id);assert.equal(result.ok,true);assert.equal(f.map.size,0);
 const failed=fixture();await assert.rejects(failed.access.request('gridStructure',{url:failed.c.url}));await turn();const failedId=failed.plans[0].originalCall.args.continuationId;
 failed.settleDuringResume();await assert.rejects(failed.access.resume(failedId));assert.equal(failed.access.pending(failedId).id,failedId);
});
console.log(JSON.stringify({passed:true,checks}));
