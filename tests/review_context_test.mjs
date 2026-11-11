import assert from 'node:assert/strict';
import {createReviewService,batchSummary} from '../review-service.js';
import {buildBasisManifest} from '../review-assurance.js';
import {contextSections,contextPage,unreadContext} from '../review-context.js';
import {extractFacts,inspectFactConflicts,createKnowledgeCache,sourceUnits} from '../review-knowledge.js';

const results=[];
async function test(name,fn){await fn();results.push(name);console.log('PASS '+name);}
function fixture(){
 const p={id:'A',name:'合成品牌',status:'active',notes:'',rules:[],library:[{id:'s',title:'资料',kind:'产品资料',text:'星河杯的容量为 300 毫升。'}]};
 const t={id:'d',projectId:'A',fmt:'text',kind:'图文',stage:'初稿',platform:'其他',cells:[{id:'p',current:'星河杯的容量为 300 毫升。',original:'星河杯的容量为 300 毫升。'}],flow:{state:'review',round:1,feedback:[]}};
 const state={settings:{selected:'A',projects:[p,{...p,id:'B',name:'其他品牌'}]},tasks:[t],batches:[]};
 const disk=new Map(),f={p,t,state,disk,commits:0,failSave:false,failCommit:false,failClear:false};
 const ctx={state:()=>state,loadReviewProgress:async id=>structuredClone(disk.get(id)),saveReviewProgress:async value=>{if(f.onSave)await f.onSave();if(f.failSave)throw Error('disk full');disk.set(value.docId,structuredClone(value));},clearReviewProgress:async id=>{if(f.failClear)throw Error('cleanup failed');disk.delete(id);},saveBatch:async b=>{if(f.failSave)throw Error('disk full');state.batches=state.batches.filter(x=>x.id!==b.id).concat(structuredClone(b));},commitReview:async(value,b,guard)=>{if(f.beforeCommit)await f.beforeCommit();guard?.();if(f.failCommit)throw Error('commit failed');f.commits++;Object.assign(t,value);if(b)state.batches=state.batches.filter(x=>x.id!==b.id).concat(structuredClone(b));}};
 f.restart=()=>f.service=createReviewService(ctx);f.ctx=ctx;f.restart();return f;
}
const args=(f,b)=>({docId:f.t.id,reviewToken:b.reviewToken,...(b.batchId?{batchId:b.batchId}:{})});
async function read(f,b,section){let cursor,rows=[];do{const page=await f.service.zhigao_read_review_context({...args(f,b),section,cursor});assert(JSON.stringify(page).length<18000);rows.push(...page.items);cursor=page.nextCursor;}while(cursor);return rows;}
async function response(f,b){for(const [s,v] of Object.entries(b.context))if(v.required)await read(f,b,s);const m=await buildBasisManifest(f.t,f.p);return {snapshot:b.snapshot,basis:b.basis,reviewedIds:f.t.cells.map(c=>c.id),changes:[],warnings:[],ruleChecks:m.rules.map(x=>({id:x.id,status:'pass',reason:'已对照本稿产品容量的完整描述',evidence:[{blockId:'p',quote:f.t.cells[0].current}]})),sourceChecks:m.sources.map(x=>({id:x.id,status:'checked',application:'applies',quote:x.text,reason:'本稿产品容量与此处准确数值一致',evidence:[{blockId:'p',quote:f.t.cells[0].current}]})),mediaChecks:[]};}
const send=(f,b,result,extra={})=>f.service.zhigao_submit_review({...args(f,b),result,dryRun:true,...extra});

await test('无指令不可提交，同一稿件转入其他品牌不泄露旧依据或检查记录',async()=>{
 const f=fixture();await assert.rejects(f.service.zhigao_submit_review({docId:'d',result:{}}),e=>e.code==='BRIEF_REQUIRED');
 const b=await f.service.zhigao_get_review_brief({docId:'d'});await f.service.zhigao_record_review_checks({...args(f,b),basis:b.basis,checks:{reviewedIds:['p']}});
 f.t.projectId='B';f.state.settings.selected='B';const fresh=await f.service.zhigao_get_review_brief({docId:'d'});assert.equal(fresh.project.id,'B');assert(!fresh.basisUpdate);assert.deepEqual(await read(f,fresh,'previousChecks'),[]);
});
await test('每次分页仍核对媒体身份；素材读取途中变更不发放有效回执',async()=>{
 const f=fixture();let inspections=0;f.t.fmt='video';f.ctx.getVideoAnalysis=async()=>{inspections++;return {sourceHash:'s',reportHash:'r',assets:[{id:'a',type:'prepared-video-frame',coverage:'full'}],supplementalText:[],frames:[]};};f.ctx.readPreparedVideoAsset=async()=>{f.p.library[0].text+='更新';return {type:'image',data:'fixture',coverage:'full'};};f.restart();
 const b=await f.service.zhigao_get_review_brief({docId:'d'});const before=inspections;await read(f,b,'sources');assert.equal(inspections-before,1);
 await assert.rejects(f.service.zhigao_read_review_asset({...args(f,b),assetId:'a'}),e=>e.code==='BASIS_CHANGED');assert.deepEqual(f.disk.get('d').entry.mediaReceipts,{});
});

await test('资料更新后可重领、分页读取更新项；旧凭据与旧游标失效',async()=>{
 const f=fixture();f.p.library[0].text+=' 原文😀'.repeat(9000);let b=await f.service.zhigao_get_review_brief({docId:'d'});const old=b;
 const page=await f.service.zhigao_read_review_context({...args(f,b),section:'sources'});assert(page.nextCursor);
 await f.service.zhigao_record_review_checks({...args(f,b),basis:b.basis,checks:{reviewedIds:['p']}});
 f.p.library[0].text='星河杯的容量为500毫升。';await assert.rejects(f.service.zhigao_renew_review(args(f,b)),e=>e.code==='BASIS_CHANGED');
 b=await f.service.zhigao_get_review_brief({docId:'d',retry:true});assert.equal(b.basisUpdate.totalChanges,old.context.sources.total);assert(!b.basisUpdate.changes);
 assert((await read(f,b,'updates')).length>0);assert.equal((await read(f,b,'previousChecks')).length,1);
 await assert.rejects(f.service.zhigao_renew_review(args(f,old)),e=>e.code==='TOKEN_MISMATCH');
 await assert.rejects(f.service.zhigao_read_review_context({...args(f,b),section:'sources',cursor:page.nextCursor}),e=>e.code==='CONTEXT_CURSOR_INVALID');
 const again=await f.service.zhigao_get_review_brief({docId:'d'});assert(again.reused);assert.equal(again.reviewToken,b.reviewToken);
});
await test('持久化失败不会提前领取、累计阅读进度或保存检查',async()=>{
 const f=fixture();f.failSave=true;await assert.rejects(f.service.zhigao_get_review_brief({docId:'d'}),/disk full/);f.failSave=false;
 const b=await f.service.zhigao_get_review_brief({docId:'d'});assert(!b.reused);f.failSave=true;
 await assert.rejects(read(f,b,'sources'),/disk full/);await assert.rejects(f.service.zhigao_record_review_checks({...args(f,b),basis:b.basis,checks:{reviewedIds:['p']}}),/disk full/);
 f.failSave=false;const saved=await f.service.zhigao_record_review_checks({...args(f,b),basis:b.basis,checks:{}});assert.deepEqual(saved.saved,{});assert(saved.unread.some(x=>x.section==='sources'&&x.read===0));
 await assert.rejects(send(f,b,{snapshot:b.snapshot}),e=>e.code==='CONTEXT_INCOMPLETE');
});
await test('分批检查幂等、刷新恢复保留完整参考记录但不自动算已审',async()=>{
 const f=fixture();let b=await f.service.zhigao_get_review_brief({docId:'d'}),r=await response(f,b);const {snapshot,basis,changes,warnings,...checks}=r;
 await f.service.zhigao_record_review_checks({...args(f,b),basis,checks});const again=await f.service.zhigao_record_review_checks({...args(f,b),basis,checks});assert.equal(again.saved.reviewedIds,1);
 assert((await send(f,b,{snapshot,basis,changes,warnings})).coverage.complete);
 f.restart();b=await f.service.zhigao_get_review_brief({docId:'d',retry:true});assert.equal((await read(f,b,'previousChecks')).length,2);
 await assert.rejects(send(f,b,{snapshot:b.snapshot,basis:b.basis}),e=>e.code==='CONTEXT_INCOMPLETE');
 r=await response(f,b);assert((await send(f,b,r)).coverage.complete);
});
await test('提交失败可重试；清理失败不误报未提交且刷新后不重复写入',async()=>{
 const f=fixture(),b=await f.service.zhigao_get_review_brief({docId:'d'}),r=await response(f,b);f.failCommit=true;
 await assert.rejects(send(f,b,r,{dryRun:false}),e=>e.code==='PERSIST_FAILED');assert.equal(f.commits,0);f.failCommit=false;f.failClear=true;
 const out=await send(f,b,r,{dryRun:false});assert(out.ok&&out.checkpointCleanupPending);assert.equal(f.commits,1);
 assert((await send(f,b,r,{dryRun:false})).duplicate);f.restart();assert((await send(f,b,r,{dryRun:false})).duplicate);assert.equal(f.commits,1);
 await assert.rejects(send(f,b,{...r,warnings:['different']},{dryRun:false}),e=>e.code==='RESULT_ALREADY_COMMITTED');
 f.p.library[0].text+='当前资料已更新';await assert.rejects(send(f,b,r,{dryRun:false}),e=>e.code==='BASIS_CHANGED');assert.equal(f.commits,1);
});
await test('release、批次会话恢复和失败重领不伪造资料变更',async()=>{
 const f=fixture();let b=await f.service.zhigao_get_review_brief({docId:'d'});await f.service.zhigao_release_review(args(f,b));b=await f.service.zhigao_get_review_brief({docId:'d',retry:true});assert(!b.basisUpdate);
 await f.service.zhigao_release_review(args(f,b));const batch=await f.service.zhigao_create_review_batch();b=await f.service.zhigao_get_review_brief({docId:'d',batchId:batch.id});f.restart();
 b=await f.service.zhigao_get_review_brief({docId:'d',batchId:batch.id,retry:true});assert(!b.basisUpdate);await f.service.zhigao_fail_review({...args(f,b),reason:'test'});
 b=await f.service.zhigao_get_review_brief({docId:'d',batchId:batch.id,retry:true});assert(!b.basisUpdate);assert((await send(f,b,await response(f,b))).coverage.complete);
 const summary=await f.service.zhigao_get_review_batch({batchId:batch.id});for(const k of ['savedChecks','basisRef','contextDelivery','previousChecks','media'])assert(!Object.hasOwn(summary.entries[0],k));
});
await test('跨品牌及跨 await 变更阻断读取和提交',async()=>{
 let f=fixture();f.ctx.getVideoAnalysis=async()=>{f.state.settings.selected='B';return {sourceHash:'s',reportHash:'r',assets:[],supplementalText:[],frames:[]};};f.t.fmt='video';f.restart();
 await assert.rejects(f.service.zhigao_get_review_brief({docId:'d'}),e=>e.code==='PROJECT_MISMATCH');
 f=fixture();let b=await f.service.zhigao_get_review_brief({docId:'d'});f.onSave=async()=>{f.p.library[0].text+='changed';};await assert.rejects(read(f,b,'sources'),e=>e.code==='BASIS_CHANGED');
 f=fixture();b=await f.service.zhigao_get_review_brief({docId:'d'});const r=await response(f,b);f.beforeCommit=async()=>{f.p.library[0].text+='changed';};await assert.rejects(send(f,b,r,{dryRun:false}),e=>e.code==='BASIS_CHANGED');assert.equal(f.commits,0);
});
await test('超长条目和 Unicode 原文完整往返；无静默截断历史',async()=>{
 const raw='😀正文'.repeat(20000),t={cells:[{id:'p',current:raw}]},m={sources:[{id:'s',text:raw}],rules:[]},e={previousChecks:Array.from({length:700},(_,i)=>({kind:'reviewedIds',value:'p'+i}))};
 const all=contextSections(t,m,{assets:[],supplementalText:[]},e),fragments=[];let cursor;
 do{const page=contextPage(e,all,'sources',cursor);assert(JSON.stringify(page).length<18000);fragments.push(...page.items);cursor=page.nextCursor;}while(cursor);
 assert.equal(JSON.parse(fragments.map(p=>p.text).join('')).text,raw);assert.equal(all.blocks.map(p=>p.text).join(''),raw);assert.equal(all.previousChecks.length,700);assert(unreadContext(e,all).some(x=>x.section==='blocks'));
 assert.equal(sourceUnits('s','Brief','t',raw).map(x=>x.text).join(''),raw);
});
await test('缓存损坏、存储故障、品牌隔离和版本变化均回当前原文',async()=>{
 const f=fixture();let disk;const cache=createKnowledgeCache({save:async(_,v)=>{disk=v;}});let v=await cache(f.p);assert(!v.cache.hit);assert((await cache(f.p)).cache.hit);
 disk.data.sources[0].text='tampered';const restored=createKnowledgeCache({load:async()=>disk});v=await restored(f.p);assert.equal(v.sources[0].text,f.p.library[0].text);assert(!v.cache.hit);
 f.p.library[0].text+='UPDATED';assert((await cache(f.p)).sources[0].text.endsWith('UPDATED'));
 v=await restored({...f.p,id:'B',library:[{...f.p.library[0],text:'Brand B'}]});assert.equal(v.projectId,'B');assert.equal(v.sources[0].text,'Brand B');
 v=await createKnowledgeCache({load:async()=>{throw Error();},save:async()=>{throw Error();}})(f.p);assert.equal(v.cache.persisted,false);assert.equal(v.sources[0].text,f.p.library[0].text);
});
await test('数值空格、小数、单位换算；范围否定条件例外与产品词边界不猜测',async()=>{
 const facts=text=>extractFacts([{id:'s',text,kind:'产品资料'}]);
 for(const text of ['星河杯的容量为300毫升。','星河杯的容量为 300 毫升。','星河杯的容量为0.3升。'])assert.equal(facts(text)[0].value,300);
 for(const text of ['星河杯的容量为300毫升以上。','星河杯的容量为300毫升到500毫升。','如果加盖，星河杯的容量为300毫升。','星河杯的容量为300毫升，特定款除外。','不是星河杯的容量为300毫升。','例如星河杯的容量为300毫升。','星河杯的容量为300毫升/份。','星河杯和月光杯的容量为300毫升。'])assert.equal(facts(text).length,0,text);
 const rows=facts('星河杯的容量为300毫升，月光杯的容量为500毫升。');assert.deepEqual(rows.map(x=>x.subject),['星河杯','月光杯']);
 const manifest={rules:[],sources:[{id:'s',text:'星河杯的容量为300毫升。'}]},scan=text=>inspectFactConflicts(manifest,[{id:'p',current:text}]);
 assert.equal(scan('星河杯的容量为0.3升。').length,0);assert.equal(scan('星河杯的容量为500毫升。').length,1);assert.equal(scan('大星河杯的容量为500毫升。').length,0);assert.equal(scan('星河杯的容量为300毫升，月光杯的容量为500毫升。').length,0);
});
await test('当前规则优先旧资料；反馈冲突不选边；不采纳反馈不成为事实',async()=>{
 const manifest={rules:[{id:'r',description:'星河杯的容量为500毫升。'}],sources:[{id:'s',kind:'产品资料',text:'星河杯的容量为300毫升。'}]},cells=[{id:'p',current:'星河杯的容量为500毫升。'}];assert.equal(inspectFactConflicts(manifest,cells).length,0);
 manifest.sources.push({id:'f',kind:'feedback-item',status:'dropped',text:'星河杯的容量为200毫升。'});assert.equal(inspectFactConflicts(manifest,cells).length,0);
 manifest.sources[1].status='open';assert(inspectFactConflicts(manifest,cells)[0].conflictingSources);
 manifest.sources.pop();manifest.rules.push({id:'r2',description:'星河杯的容量为600毫升。'});assert(inspectFactConflicts(manifest,cells)[0].conflictingSources);
});
await test('机械数值错误、短引用和无依据 superseded 均不能计完整',async()=>{
 const f=fixture();f.t.cells[0].current='星河杯的容量为500毫升。';const b=await f.service.zhigao_get_review_brief({docId:'d'}),r=await response(f,b);assert(!(await send(f,b,r)).coverage.complete);
 r.patches=[{cellId:'p',find:'500',replace:'300',reason:'匹配当前原文'}];assert((await send(f,b,r)).coverage.complete);
 r.sourceChecks[0].quote='星';assert(!(await send(f,b,r)).coverage.complete);r.sourceChecks[0].quote=f.p.library[0].text;r.sourceChecks[0].application='superseded';assert(!(await send(f,b,r)).coverage.complete);
});
console.log(JSON.stringify({total:results.length,checks:results},null,2));
