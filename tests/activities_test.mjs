import assert from 'node:assert/strict';
import {projectForActivity,activityOf,addActivity} from '../activities.js';
import {buildBasisManifest} from '../review-assurance.js';
import {createReviewService} from '../review-service.js';
import {prepareProjectUpdate,planProjectImport} from '../project-data.js';
import {docFeedbackText} from '../brand.js';

const p={id:'p',name:'合成品牌',status:'active',notes:'原有活动专属笔记',selectedActivity:'a',activities:[{id:'a',name:'秋季'},{id:'b',name:'冬季'}],rules:[],library:[
  {id:'old',title:'原有资料',text:'原有活动内容'}, {id:'a',title:'秋季资料',text:'秋季活动容量300毫升',activityId:'a'},
  {id:'b',title:'冬季资料',text:'冬季活动容量500毫升',activityId:'b'}, {id:'shared',title:'品牌长期资料',text:'品牌共用理念',activityId:'*'}]};
const make=(id,activityId)=>({id,itemId:'item-'+id,projectId:'p',activityId,fmt:'text',kind:'图文',stage:'初稿',platform:'其他',cells:[{id:'cell',current:'合成稿件',original:'合成稿件'}],flow:{state:'review',round:2,feedback:[{round:1,text:'上轮反馈不能继承'},{round:2,text:'本轮反馈保留'}]},fbItems:[{id:'f1',round:1,status:'open',text:'上轮已确认要求'},{id:'f2',round:2,status:'open',text:'本轮已确认要求'}]});
const a=make('a','a'),b=make('b','b'),old=make('old',undefined);
assert.deepEqual(projectForActivity(p,'a').library.map(x=>x.id),['a','shared']);
assert.deepEqual(projectForActivity(p,'legacy').library.map(x=>x.id),['old','shared']);
assert.equal(activityOf(old),'legacy');assert.equal(projectForActivity(p,'a').notes,'');
const ma=await buildBasisManifest(a,p),mb=await buildBasisManifest(b,p);
assert(ma.sources.some(x=>x.text.includes('300')));assert(!ma.sources.some(x=>x.text.includes('500')||x.text.includes('上轮')));
assert(mb.sources.some(x=>x.text.includes('500')));assert.notEqual(ma.hash,mb.hash);
assert(!docFeedbackText(a).includes('上轮'));assert(docFeedbackText(a).includes('本轮'));
const updated=prepareProjectUpdate(p,{library:[{title:'秋季资料',kind:'Brief',text:'这是冬季同名资料',activityId:'b'}]}).project;
assert.equal(updated.library.length,5);assert.equal(p.library.length,4);
assert.throws(()=>prepareProjectUpdate(p,{library:[{title:'非法活动',kind:'Brief',text:'内容',activityId:'missing'}]}),/活动/);
assert.equal(addActivity(p,'春季').activities.length,3);assert.equal(p.activities.length,2);
const state={settings:{selected:'p',projects:[p]},tasks:[a,b,old],batches:[]};
const ctx={state:()=>state,saveBatch:async value=>{state.batches=state.batches.filter(x=>x.id!==value.id).concat(structuredClone(value));},saveReviewProgress:async()=>{}};
const service=createReviewService(ctx),batch=await service.zhigao_create_review_batch();
assert.equal(batch.activityId,'a');assert.deepEqual(batch.entries.map(x=>x.docId),['a']);
await assert.rejects(service.zhigao_get_review_brief({docId:'b'}),e=>e.code==='ACTIVITY_MISMATCH');
const brief=await service.zhigao_get_review_brief({docId:'a',batchId:batch.id});
p.selectedActivity='b';
await assert.rejects(service.zhigao_read_review_context({docId:'a',batchId:batch.id,reviewToken:brief.reviewToken,section:'sources'}),e=>e.code==='ACTIVITY_MISMATCH');
p.selectedActivity='a';p.library[1].text='秋季新资料';
await assert.rejects(service.zhigao_read_review_context({docId:'a',batchId:batch.id,reviewToken:brief.reviewToken,section:'sources'}),e=>e.code==='BASIS_CHANGED');
console.log('PASS activity source/task/batch isolation; legacy compatibility; same-name source scoping; round feedback; stale response and basis rejection');
