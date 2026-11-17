import assert from 'node:assert/strict';
import {activityRevision,projectForActivity,assertActivitySelection} from '../activities.js';
import {prepareProjectUpdate,persistProjectUpdate,projectSnapshot} from '../project-data.js';
import {reviewNeedsAttention,reviewBasisImpact} from '../review-summary.js';
import {verifyLibraryOriginal,createLibraryProcessor} from '../library-assets.js';
import {activityRowMatch} from '../creator-match.js';
import {createTaskBridge} from '../task-context.js';
import {createReviewService} from '../review-service.js';
import {buildBasisManifest} from '../review-assurance.js';
import {stageDir} from '../folder.js';
import {validateBundle} from '../bundle-validation.js';

const checks=[];
async function test(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const project=()=>({id:'p',name:'合成品牌',status:'active',date:'original',selectedActivity:'a',activities:[{id:'a',name:'秋季',notes:'秋季笔记'},{id:'b',name:'冬季',notes:'冬季笔记'}],notes:'历史活动笔记',rules:[],library:[
 {id:'a',title:'秋季资料',text:'星河杯的容量为300毫升。',kind:'产品资料',activityId:'a'},
 {id:'b',title:'冬季资料',text:'冬季限定要求',kind:'产品资料',activityId:'b'},
 {id:'shared',title:'品牌共用',text:'星河杯的容量为300毫升。',kind:'产品资料',activityId:'*'}]});
const doc=(id='d',activityId='a')=>({id,projectId:'p',itemId:'i-'+id,activityId,fmt:'text',platform:'其他',kind:'图文',stage:'初稿',ruleDate:'original',cells:[{id:'c',original:'星河杯的容量为300毫升。',current:'星河杯的容量为300毫升。'}],flow:{state:'review',round:2,submissions:[],feedback:[],log:[]}});
await test('活动资料和笔记只使本活动过期；共用资料使全部活动过期',()=>{
 const p=project(),a=prepareProjectUpdate(p,{notes:'秋季新笔记'}).project;
 assert.notEqual(activityRevision(a,'a'),'original');assert.equal(activityRevision(a,'b'),'original');assert.equal(activityRevision(a,'legacy'),'original');
 assert.equal(projectForActivity(a,'b').notes,'冬季笔记');assert.equal(a.notes,p.notes);
 const b=prepareProjectUpdate(a,{library:[{...a.library[2],text:'新的共用资料'}]}).project;
 for(const id of ['a','b','legacy'])assert.notEqual(activityRevision(a,id),activityRevision(b,id));
 assert.equal(prepareProjectUpdate(b,{notes:'秋季新笔记'}).changed,false);
});
await test('活动转长期及转回同时更新受影响范围，其他来源与原对象不变',()=>{
 const p=project(),first=prepareProjectUpdate(p,{library:[{...p.library[0],activityId:'*'}]}).project;
 assert.equal(p.library[0].activityId,'a');for(const id of ['a','b','legacy'])assert.notEqual(activityRevision(first,id),'original');
 const second=prepareProjectUpdate(first,{library:[{...first.library[0],activityId:'a'}]}).project;
 assert.equal(projectForActivity(second,'b').library.some(x=>x.id==='a'),false);
 for(const id of ['a','b','legacy'])assert.notEqual(activityRevision(second,id),activityRevision(first,id));
 assert.deepEqual(second.library[1],p.library[1]);
});
await test('作用域expected可回写；旧expected、跨活动ID和非法替代被拒绝',()=>{
 const p=project(),scoped=projectForActivity(p),expected={notes:scoped.notes,library:scoped.library,rules:scoped.rules};
 const next=prepareProjectUpdate(p,{activityId:'a',expected,notes:'新笔记'}).project;
 assert.throws(()=>prepareProjectUpdate(next,{activityId:'a',expected,notes:'迟到笔记'}),/已变化/);
 const empty={...p,notes:'',library:[],rules:[],selectedActivity:'b',activities:[{id:'a',name:'a',notes:''},{id:'b',name:'b',notes:''}]};
 assert.throws(()=>prepareProjectUpdate(empty,{activityId:'b',expected:{activityId:'a',notes:'',library:[],rules:[]},notes:'旧活动的迟到写入'}),/另一活动/);
 assert.throws(()=>prepareProjectUpdate(p,{library:[{...p.library[1],text:'越界'}]}),/其他活动/);
 p.rules=[{id:'rb',title:'冬季要求',description:'冬季原话',activityId:'b',enabled:true}];
 assert.throws(()=>prepareProjectUpdate(p,{rules:[{title:'秋季要求',description:'秋季原话',enabled:true,supersedes:['rb']}]}),/其他活动/);
 assert.throws(()=>assertActivitySelection(p,'p','b'),e=>e.code==='ACTIVITY_MISMATCH');
});
await test('资料连续替换不留library历史；保存失败保留上一可用资料',()=>{
 const p=project();p.library[0].history=[{text:'过时内容'}];
 const next=prepareProjectUpdate(p,{library:[{...p.library[0],text:'新版本一'}]}).project;
 assert(!('history' in next.library[0]));
 const newest=prepareProjectUpdate(next,{library:[{...next.library[0],text:'新版本二'}]}).project;
 assert(!JSON.stringify(newest.library).includes('新版本一'));assert.equal(p.library[0].text,'星河杯的容量为300毫升。');
 const settings={selected:'p',projects:[p]};let raw=JSON.stringify(settings);
 const storage={getItem:()=>raw,setItem:()=>{throw Error('quota');}};
 assert.throws(()=>persistProjectUpdate(settings,newest,storage),/保存失败/);assert.deepEqual(JSON.parse(raw),settings);
 storage.setItem=(_,value)=>{raw=value;};const saved=persistProjectUpdate(settings,newest,storage);
 assert.deepEqual(JSON.parse(raw),saved);assert.equal(activityRevision(saved.projects[0],'b'),'original');
 assert.deepEqual(projectSnapshot(p),projectSnapshot(settings.projects[0]));
});
await test('原件同长度篡改、缺件和完整正文错配均不能切换资料',async()=>{
 const original={originalFile:new Blob(['abcd']),extractedText:'完整原文'};
 assert.equal((await verifyLibraryOriginal(original,{...original,originalFile:new Blob(['abcd'])})).length,64);
 await assert.rejects(verifyLibraryOriginal(original,{...original,originalFile:new Blob(['abce'])}),/摘要/);
 await assert.rejects(verifyLibraryOriginal(original,{...original,extractedText:'截断'}),/正文/);
 await assert.rejects(verifyLibraryOriginal(original,{}),/核验/);
});
await test('审核中、已审未交付、已交付分别提示；归档不推定交付',()=>{
 const p=prepareProjectUpdate(project(),{notes:'更新'}).project,t=doc(),flow=structuredClone(t.flow);
 assert.equal(reviewBasisImpact(t,p).state,'reviewing');
 t.ai={changes:[],assurance:{complete:true,projectRevision:'original'},archive:{state:'saved'}};
 assert.equal(reviewBasisImpact(t,p).state,'reviewed');assert(reviewNeedsAttention(t,p));
 t.flow.submissions=[{round:1}];assert.equal(reviewBasisImpact(t,p).state,'reviewed');
 t.flow.submissions.push({round:2});assert.equal(reviewBasisImpact(t,p).state,'delivered');
 t.flow={...flow,state:'passed',passedAt:'original',passedFp:'original'};const before=structuredClone(t.flow);
 assert.equal(reviewBasisImpact(t,p).state,'delivered');assert.deepEqual(t.flow,before);
 const other=doc('b','b');other.ai={assurance:{complete:true,projectRevision:'original'}};assert(!reviewNeedsAttention(other,p));
});
await test('不同活动归档路径分离，legacy路径兼容原有文件夹',()=>{
 const item={author:'同名达人',platform:'其他',title:'同名内容'};
 assert.deepEqual(stageDir(item,'初稿'),stageDir({...item,activityId:'legacy'},'初稿'));
 assert.notDeepEqual(stageDir({...item,activityId:'a'},'初稿'),stageDir({...item,activityId:'b'},'初稿'));
});
await test('准备期间切活动拒绝迟到结果；共享相同原件仍有不同任务身份',async()=>{
 const p=project();p.library=[];const state={settings:{selected:'p',projects:[p]},tasks:[]};
 const bridge=createTaskBridge({state:()=>state,setupStatus:async()=>{p.selectedActivity='b';return {archive:{state:'granted'}};}},{});
 await assert.rejects(bridge.context({operation:'archive'}),e=>e.code==='PROJECT_MISMATCH');
 p.selectedActivity='a';const a=await bridge.context({operation:'library'});p.selectedActivity='b';const b=await bridge.context({operation:'library'});
 assert.notEqual(a.binding.operationFingerprint,b.binding.operationFingerprint);
});
await test('显式复审保留品牌通过与旧结果；普通领取不能重开已交付稿',async()=>{
 const p=project(),t=doc();t.flow={...t.flow,state:'passed',passedAt:'已记录',passedFp:'old',submissions:[{round:2,fp:'old'}]};t.ai={at:'old',changes:[],assurance:{complete:true,projectRevision:'original'}};
 const before=structuredClone(t.flow),state={settings:{selected:'p',projects:[p]},tasks:[t],batches:[]};
 const service=createReviewService({state:()=>state,saveReviewProgress:async()=>{},clearReviewProgress:async()=>{},commitReview:async value=>Object.assign(t,value)});
 await assert.rejects(service.zhigao_get_review_brief({docId:t.id}),e=>e.code==='WRONG_FLOW');
 const brief=await service.zhigao_reopen_review({docId:t.id}),args={docId:t.id,reviewToken:brief.reviewToken};
 for(const [section,meta] of Object.entries(brief.context))if(meta.required){let cursor;do{cursor=(await service.zhigao_read_review_context({...args,section,cursor})).nextCursor;}while(cursor);}
 const manifest=await buildBasisManifest(t,p),result={snapshot:brief.snapshot,basis:brief.basis,reviewedIds:['c'],changes:[],warnings:[],ruleChecks:[],sourceChecks:manifest.sources.map(s=>({id:s.id,status:'checked',application:'applies',quote:s.text,reason:'根据本稿完整容量表述核对当前活动依据',evidence:[{blockId:'c',quote:t.cells[0].current}]})),mediaChecks:[]};
 const done=await service.zhigao_submit_review({...args,result});assert(done.ok);assert.deepEqual(t.flow,before);assert.equal(t.aiHistory[0].at,'old');assert.equal(t.ai.assurance.projectRevision,activityRevision(p,'a'));
});
await test('同名跨活动争用同一飞书行时拒绝自动匹配；不同内容可区分',()=>{
 const a={id:'a',projectId:'p',activityId:'a',author:'同名达人',platform:'小红书',title:'秋季内容'},b={...a,id:'b',activityId:'b',title:'冬季内容'};
 const sheet={id:'s',map:{author:0,platform:1,title:2},rows:[['同名达人','小红书','秋季内容']]};
 assert.equal(activityRowMatch(a,[a,b],[sheet]).conflicts.length,1);
 sheet.rows.push(['同名达人','小红书','冬季内容']);const match=activityRowMatch(a,[a,b],[sheet]);assert.equal(match.hits[0].row,0);assert.equal(match.conflicts.length,0);
});
await test('共享资料读取期间切换活动也拒绝迟到的准备结果',async()=>{
 const p=project();p.library=[{id:'shared',activityId:'*',ingestion:{assetKey:'k',format:'video'}}];
 const state={settings:{selected:'p',projects:[p]},tasks:[]};
 const processor=createLibraryProcessor({state:()=>state,getLibraryFile:async()=>{p.selectedActivity='b';return {fmt:'video',originalFile:new Blob(['synthetic'])};}});
 await assert.rejects(processor.prepare({libraryId:'shared'}),/活动或资料已变化/);
});
await test('交接包校验活动身份，拒绝孤立活动与跨活动稿件归属',()=>{
 const p=project(),t=doc(),item={id:t.itemId,projectId:p.id,activityId:'a',kind:t.kind};
 const bundle={version:2,projects:[p],items:[item],docs:[t]};assert.equal(validateBundle(bundle),bundle);
 assert.throws(()=>validateBundle({...bundle,docs:[{...t,activityId:'b'}]}),/稿件活动/);
 assert.throws(()=>validateBundle({...bundle,items:[{...item,activityId:'missing'}]}),/任务活动/);
 const old={version:1,projects:[{id:'old',name:'旧项目',rules:[],library:[]}],items:[{id:'i',projectId:'old',kind:'图文'}],docs:[{id:'t',projectId:'old',itemId:'i'}]};assert.equal(validateBundle(old),old);
});
console.log(JSON.stringify({passed:true,total:checks.length,checks}));
