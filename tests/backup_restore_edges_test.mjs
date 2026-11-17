import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {planProjectRestore} from '../backup-restore.js';
import {createUploadQueue} from '../upload-assignment.js';
import {newFlow} from '../model.js';

const source=()=>({
 projects:[{id:'p',name:'恢复续办合成品牌',status:'active',date:'basis',selectedActivity:'a',activities:[{id:'a',name:'秋季'},{id:'b',name:'冬季'}],rules:[],library:[]}],
 items:[{id:'i',projectId:'p',activityId:'a',kind:'视频',author:'合成达人',platform:'抖音',title:'合成内容',revision:7}],
 docs:[{id:'d',itemId:'i',projectId:'p',activityId:'a',kind:'视频',author:'合成达人',platform:'抖音',stage:'脚本',fmt:'text',filename:'第二轮.txt',cells:[{id:'c',current:'第二轮原文',original:'第二轮原文'}],flow:newFlow(2),rounds:[{id:'old',itemId:'i',projectId:'p',activityId:'a',kind:'视频',fmt:'text',cells:[],flow:{...newFlow(1),state:'passed'},brandFeedback:[{docId:'old',projectId:'p',text:'原轮次反馈'}]}]}],
 batches:[],integrations:[{id:'upload:u',uploadId:'u',kind:'pending-upload',projectId:'p',activityId:'a',status:'failed',name:'【合成达人】抖音视频脚本v3.txt',file:new File(['第三轮原文'],'【合成达人】抖音视频脚本v3.txt',{type:'text/plain'}),target:{itemId:'i',stage:'脚本',newRound:true},error:'处理中断'}],
 media:[],libraryAssets:[],artifacts:[]
});
const current={selected:'p',projects:[{id:'p',name:'本机已有项目',rules:[],library:[]}]};
const existing={tasks:[{id:'d'},{id:'old'}],items:[{id:'i'}],batches:[],integrations:[],media:[]};
let sequence=0;
const restore=s=>planProjectRestore(s,current,existing,()=>'restore-'+(++sequence));
const checks=[];
async function check(name,run){try{await run();checks.push({name,ok:true});console.log('PASS '+name);}catch(e){checks.push({name,ok:false,error:e.stack});console.log('FAIL '+name+' '+e.message);}}

await check('冲突项目中的历史轮次、原轮次反馈与任务归属一起迁移',()=>{
 const p=restore(source()),d=p.records.find(([s])=>s==='tasks')[1],r=d.rounds[0];
 assert.equal(r.projectId,p.projectId);assert.equal(r.itemId,d.itemId);assert.notEqual(r.id,'old');
 assert.equal(r.brandFeedback[0].docId,r.id);assert.equal(r.brandFeedback[0].projectId,p.projectId);assert.equal(r.flow.state,'passed');
});
await check('待续办上传的指定任务与选择表单都指向恢复副本',()=>{
 const s=source();s.integrations[0].choices=[structuredClone(s.items[0])];s.integrations[0].draft={target:'0',author:'合成达人',platform:'抖音',kind:'视频',stage:'脚本',title:'合成内容'};
 const p=restore(s),r=p.records.find(([name])=>name==='integrations')[1],it=p.records.find(([name])=>name==='items')[1];
 assert.equal(r.target.itemId,it.id);assert.equal(r.choices[0].id,it.id);assert.equal(r.choices[0].projectId,p.projectId);assert.equal(r.choices[0].revision,1);
 assert.equal(s.integrations[0].target.itemId,'i');assert.equal(s.docs[0].rounds[0].itemId,'i');
});

function queueFor(plan){
 const rows=store=>plan.records.filter(([s])=>s===store).map(([,r])=>r);
 const state={settings:plan.settings,items:rows('items').map(v=>({...v,revision:1})),tasks:rows('tasks').map(v=>({...v,revision:1}))},pending=rows('integrations');
 const saved=[],queue=createUploadQueue({state:()=>state,refresh(){},toast(){},liveSheets:()=>[],loadPending:async()=>pending,savePending:async v=>saved.push(v),removePending:async()=>{},makeItem(){throw Error('续办不应创建另一个内容任务');},
  parseFile:async file=>({fmt:'text',filename:file.name,mime:file.type,buffer:await file.arrayBuffer(),cells:[{id:'p1',address:'第1段',current:await file.text(),original:await file.text()}]}),
  commitUpload:async records=>{for(const [store,value]of records){const list=store==='tasks'?state.tasks:store==='items'?state.items:null;if(list){const at=list.findIndex(v=>v.id===value.id);if(at>=0)list[at]=value;else list.push(value);}}},archiveOriginal:async()=>{}});
 return {queue,state,saved};
}
await check('未解析完成的新版上传恢复后真实重新解析并加入第三轮一次',async()=>{
 const p=restore(source()),{queue,state}=queueFor(p);await queue.restore();await queue.retry(queue.rows[0].id);
 assert.equal(queue.rows[0].status,'saved',queue.rows[0].error);assert.equal(state.tasks.length,2);assert.equal(state.tasks.at(-1).flow.round,3);assert.equal(state.tasks.at(-1).itemId,state.items[0].id);
 await queue.restore();assert.equal(state.tasks.length,2);assert.equal(state.tasks[0].cells[0].current,'第二轮原文');
});
await check('已填写归属的新版上传恢复后可直接确认且保留原轮次',async()=>{
 const s=source();s.integrations[0].choices=[structuredClone(s.items[0])];s.integrations[0].draft={target:'0',author:'合成达人',platform:'抖音',kind:'视频',stage:'脚本',title:'合成内容'};
 const p=restore(s),{queue,state}=queueFor(p);await queue.restore();await queue.confirm([queue.rows[0].id]);assert.equal(queue.rows[0].status,'saved',queue.rows[0].error);assert.equal(state.tasks.at(-1).flow.round,3);assert.equal(state.tasks[0].rounds[0].flow.state,'passed');
});
await check('历史视频的本机准备状态清除，保留原件与品牌通过事实',()=>{
 const s=source(),r=s.docs[0].rounds[0];r.fmt='video';r.originalFile=new File(['old-video'],'旧视频.mp4');r.videoAnalysis={state:'complete',jobId:'old-job'};r.videoPreparation={state:'running',jobId:'old-job'};r.revision=99;
 const p=restore(s),round=p.records.find(([name])=>name==='tasks')[1].rounds[0];
 assert.equal(round.videoAnalysis,null);assert.equal(round.videoPreparation,null);assert.equal(round.revision,undefined);assert.equal(round.flow.state,'passed');assert.equal(round.originalFile.size,9);
});
await check('恢复后结果与批次引用一致，未完成检查点仍需重新领取',()=>{
 const s=source();s.docs[0].ai={at:'result',batchId:'batch',changes:[],archive:{state:'saved'}};s.batches=[{id:'batch',projectId:'p',entries:[{docId:'d',status:'reviewing'}]}];s.integrations.push({id:'review-checkpoint:d',kind:'review-checkpoint',projectId:'p',docId:'d',entry:{docId:'d',projectId:'p',status:'reviewing'}});
 const p=planProjectRestore(s,current,{...existing,batches:[{id:'batch'}]},()=>'restore-'+(++sequence)),task=p.records.find(([name])=>name==='tasks')[1],batch=p.records.find(([name])=>name==='batches')[1],checkpoint=p.records.find(([name,v])=>name==='integrations'&&v.kind==='review-checkpoint')[1];
 assert.equal(task.ai.batchId,batch.id);assert.equal(batch.entries[0].docId,task.id);assert.equal(checkpoint.entry.docId,task.id);assert.equal(checkpoint.entry.projectId,p.projectId);assert.equal(checkpoint.entry.status,'interrupted');
});
await check('本机已删除的稿件与任务恢复时避让删除标记，不复活旧身份',()=>{
 const deleted={tasks:[],items:[],media:[],batches:[],integrations:[{id:'deleted-record:tasks:d',kind:'deleted-record'},{id:'deleted-record:items:i',kind:'deleted-record'}]};
 const p=planProjectRestore(source(),current,deleted,()=>'restore-'+(++sequence)),task=p.records.find(([s])=>s==='tasks')[1],item=p.records.find(([s])=>s==='items')[1];
 assert.notEqual(task.id,'d');assert.notEqual(item.id,'i');assert.equal(task.itemId,item.id);assert.equal(deleted.integrations.length,2);
});
if(process.env.ZHIGAO_VERIFY_OUT){await fs.mkdir(process.env.ZHIGAO_VERIFY_OUT,{recursive:false});await fs.writeFile(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:checks.every(c=>c.ok),checks,realFeishuWrites:0},null,2));}
if(checks.some(c=>!c.ok))process.exitCode=1;
