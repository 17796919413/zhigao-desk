import assert from 'node:assert/strict';
import {planLibraryCleanup,cleanReviewEntry,acknowledgeLibraryCleanup} from '../library-cleanup.js';
import {prepareProjectUpdate,persistProjectUpdate} from '../project-data.js';
const before={id:'p',name:'品牌',date:'v1',selectedActivity:'a',activities:[{id:'a'},{id:'b'}],rules:[],library:[{id:'source',activityId:'a',title:'资料',kind:'Brief',text:'旧资料正文',ingestion:{assetKey:'old',blockers:[]},history:[{text:'更早正文',ingestion:{assetKey:'older'}}]}]};
const next=prepareProjectUpdate(before,{library:[{...before.library[0],text:'新资料正文',ingestion:{assetKey:'new',blockers:[]}}]}).project;
const checks=[];function test(name,fn){fn();checks.push(name);console.log('PASS '+name);}
test('清理计划只存身份和原件键，不留旧正文；活动改长期覆盖全部活动',()=>{
 const job=planLibraryCleanup(before,next);assert.deepEqual(job.assetKeys,['old','older']);assert.deepEqual(job.activityIds,['a']);assert(!JSON.stringify(job).includes('正文'));
 const shared=structuredClone(next);shared.library[0].activityId='*';assert.deepEqual(planLibraryCleanup(before,shared).activityIds,['legacy','a','b']);assert.equal(planLibraryCleanup(before,before),null);
});
test('新资料和清理队列同次保存；配额失败都不切换；连续替换队列累积',()=>{
 let raw=JSON.stringify({selected:'p',projects:[before]});const original=raw,storage={getItem:()=>raw,setItem:()=>{throw Error('quota');}};
 assert.throws(()=>persistProjectUpdate(JSON.parse(raw),next,storage),/保存失败/);assert.equal(raw,original);
 storage.setItem=(_,v)=>{raw=v;};const saved=persistProjectUpdate(JSON.parse(raw),next,storage);assert.equal(saved.libraryCleanup.length,1);assert(!raw.includes('旧资料正文'));
 const next2=prepareProjectUpdate(next,{library:[{...next.library[0],text:'最终正文',ingestion:{assetKey:'newest',blockers:[]}}]}).project;
 const final=persistProjectUpdate(saved,next2,storage);assert.equal(final.libraryCleanup.length,2);assert(!JSON.stringify(final).includes('新资料正文'));
});
test('清除临时依据和凭据，保留批次完成统计与提交回执',()=>{
 const entry={docId:'d',status:'pending',coverage:{complete:true},assuranceComplete:true,submissionResult:{ok:true},savedChecks:{quote:'旧正文'},media:{assets:[]},basisRef:{},reviewToken:'old'};
 const clean=cleanReviewEntry(entry);assert(!('savedChecks'in clean));assert(!('reviewToken'in clean));assert.deepEqual(clean.submissionResult,entry.submissionResult);assert.equal(clean.status,'pending');assert(clean.assuranceComplete);
 assert.equal(cleanReviewEntry({...entry,status:'reviewing'}).errorCode,'BASIS_CHANGED');assert('savedChecks'in entry);
});
test('确认清理只移除已处理队列，晚到的设置不被覆盖',()=>{
 let raw=JSON.stringify({projects:[],libraryCleanup:[{id:'a'},{id:'b'}]});const storage={getItem:()=>raw,setItem:(_,v)=>{raw=v;}};
 const initial=raw;assert.deepEqual(acknowledgeLibraryCleanup(storage,initial,['a']).libraryCleanup,[{id:'b'}]);
 assert.throws(()=>acknowledgeLibraryCleanup(storage,initial,['b']),/变化/);assert.deepEqual(JSON.parse(raw).libraryCleanup,[{id:'b'}]);
});
console.log(JSON.stringify({passed:true,total:checks.length,checks}));
