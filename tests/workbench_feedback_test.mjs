import assert from 'node:assert/strict';
import {feedbackFor,feedbackRecord} from '../draft-feedback.js';
import {removeRule,persistSettingsChange,projectTombstone} from '../project-lifecycle.js';
import {buildBasisManifest} from '../review-assurance.js';
import {reviewNotes} from '../brand.js';
import {createReviewService} from '../review-service.js';

const checks=[];
const test=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const task=()=>({id:'d',projectId:'A',fmt:'text',kind:'图文',platform:'其他',stage:'大纲',cells:[{id:'p',original:'本稿内容',current:'本稿内容'}],flow:{state:'review',round:1,feedback:[]}});
const project=()=>({id:'A',name:'甲品牌',status:'active',notes:'',rules:[],library:[{id:'l',kind:'产品资料',title:'有效资料',text:'仅使用品牌当前确认事实。'}]});
await test('专属反馈按品牌、稿件与轮次同时隔离',async()=>{
 const t=task(),f=feedbackRecord(t,{text:'只适用本稿',title:'原话'});t.brandFeedback=[f];assert.equal(feedbackFor(t).length,1);
 for(const other of [{...t,projectId:'B'},{...t,id:'other'},{...t,flow:{round:2}}])assert.equal(feedbackFor(other).length,0);
 const m=await buildBasisManifest(t,project());assert(m.sources.some(s=>s.text==='只适用本稿'));
 t.brandFeedback=[];assert.notEqual((await buildBasisManifest(t,project())).hash,m.hash);
});
await test('空笔记不会回退旧稿件保存的品牌记忆',()=>{assert(!reviewNotes({...task(),notes:'已删除旧笔记'},project()).includes('已删除旧笔记'));});
await test('删除替代规则不会复活旧规则，也不会影响其他有效规则',()=>{
 const p={...project(),rules:[{id:'old',enabled:true},{id:'middle',enabled:true,supersedes:['old']},{id:'latest',enabled:true,supersedes:['middle']},{id:'other',enabled:true}]};
 const next=removeRule(p,'latest');assert(next.rules.filter(r=>['old','middle'].includes(r.id)).every(r=>!r.enabled));assert(next.rules.find(r=>r.id==='other').enabled);assert.equal(p.rules.length,4);
});
await test('项目保存失败或跨页面冲突不会更改内存；墓碑包含历史附件',()=>{
 const current={selected:'A',projects:[project()]},next={...current,projects:[]};
 assert.throws(()=>persistSettingsChange(current,next,{getItem:()=>JSON.stringify(current),setItem:()=>{throw Error('disk full');}}),/disk full/);assert.equal(current.projects.length,1);
 assert.throws(()=>persistSettingsChange(current,next,{getItem:()=>JSON.stringify({...current,selected:'B'})}),/另一个页面/);
 const initialized=structuredClone(current);initialized.projects[0].feishu={source:null,refined:null,sheets:[]};let written;
 assert.equal(persistSettingsChange(initialized,next,{getItem:()=>JSON.stringify(current),setItem:(k,v)=>written=v}),next);assert(written);
 const legacy={projects:[{id:'sailimu',name:'历史示例'}]},migrated={projects:[{...legacy.projects[0],status:'ended',sample:true}]};assert.equal(persistSettingsChange(migrated,next,{getItem:()=>JSON.stringify(legacy),setItem:()=>{}}),next);
 assert.deepEqual(projectTombstone({id:'A',library:[{ingestion:{assetKey:'current'},history:[{ingestion:{assetKey:'old'}}]}]}).assetKeys,['current','old']);
});
await test('删除依据后旧引用不会经 previousChecks 回流，其他品牌访问被阻断',async()=>{
 const p=project(),t=task();t.brandFeedback=[feedbackRecord(t,{title:'专属反馈',text:'删除后不能回流的原话'})];
 const state={settings:{selected:'A',projects:[p,{...p,id:'B'}]},tasks:[t],batches:[]},disk=new Map();
 const service=createReviewService({state:()=>state,saveBatch:async b=>state.batches.push(b),saveReviewProgress:async e=>disk.set(e.docId,e),loadReviewProgress:async id=>disk.get(id)});
 const b=await service.zhigao_get_review_brief({docId:'d'}),args={docId:'d',reviewToken:b.reviewToken};
 const sources=await service.zhigao_read_review_context({...args,section:'sources'}),s=sources.items.find(s=>s.kind==='feedback');
 await service.zhigao_record_review_checks({...args,basis:b.basis,checks:{sourceChecks:[{id:s.id,quote:s.text}]}});
 t.brandFeedback=[];await assert.rejects(service.zhigao_renew_review(args),e=>e.code==='BASIS_CHANGED');
 const fresh=await service.zhigao_get_review_brief({docId:'d',retry:true});assert.deepEqual((await service.zhigao_read_review_context({docId:'d',reviewToken:fresh.reviewToken,section:'previousChecks'})).items,[]);
 state.settings.selected='B';await assert.rejects(service.zhigao_read_review_context({docId:'d',reviewToken:fresh.reviewToken,section:'sources'}),e=>e.code==='PROJECT_MISMATCH');
});
console.log(JSON.stringify({count:checks.length,checks}));
