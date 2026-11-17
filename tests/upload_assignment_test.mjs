import assert from 'node:assert/strict';
import {uploadEvidence,uploadProposal,assignmentIssues,createUploadQueue} from '../upload-assignment.js';
const checks=[];async function test(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const doc=(filename,text='正文')=>({filename,fmt:'text',cells:[{id:'c',original:text,current:text}]});
const project={id:'p',name:'品牌',date:'v1',rules:[],library:[],activities:[{id:'a'},{id:'b'}],selectedActivity:'a'};
const item={id:'i',projectId:'p',activityId:'a',author:'甲',platform:'小红书',kind:'图文',title:'【甲】小红书图文大纲'};
const previous={id:'d',itemId:'i',projectId:'p',activityId:'a',stage:'大纲',flow:{round:1,state:'passed',log:[],submissions:[],feedback:[]},ai:{changes:[]}};
await test('未知平台形式阶段保持空白，正文提及平台不当作归属',()=>{
 const e=uploadEvidence(doc('未知.txt','正文讨论抖音和视频行业'));assert.equal(e.platform,'');assert.equal(e.kind,'');assert.equal(e.stage,'');
 const p=uploadProposal(doc('未知.txt'),{project,items:[],tasks:[]});assert(p.issues.some(x=>x.includes('达人')));assert(p.issues.some(x=>x.includes('阶段')));
});
await test('明确标签可补全，视频原件仅确定视频初稿，图文脚本冲突阻止保存',()=>{
 const e=uploadEvidence(doc('材料.txt','达人：小甲\n平台：其他\n形式：图文\n阶段：大纲\n内容标题：旅行'));assert.equal(e.platform,'其他');assert.equal(e.author,'小甲');assert.equal(e.stage,'大纲');
 const v=uploadEvidence({...doc('电影.mp4'),fmt:'video'});assert.equal(v.kind,'视频');assert.equal(v.stage,'初稿');assert.equal(v.platform,'');
 assert(assignmentIssues({target:'new',author:'甲',platform:'抖音',kind:'图文',title:'内容',stage:'脚本'},[]).length);
});
await test('同内容无版号需确认，新版号及明确收到新版可续轮；不改旧结果',()=>{
 const base={project,items:[item],tasks:[previous]};assert(uploadProposal(doc('【甲】小红书图文大纲.txt'),base).issues.length);
 assert.equal(uploadProposal(doc('【甲】小红书图文大纲v2.txt'),base).issues.length,0);
 assert(uploadProposal(doc('【甲】小红书图文大纲v1.txt'),base).issues.length);
 assert.equal(uploadProposal(doc('【甲】小红书图文大纲.txt'),{...base,target:{itemId:'i',stage:'大纲',newRound:true}}).issues.length,0);assert.equal(previous.flow.state,'passed');assert(previous.ai);
});
await test('不同活动不合并，冲突作者不自动绑定，确认候选是独立快照',()=>{
 assert.equal(uploadProposal(doc('【甲】小红书图文大纲v2.txt'),{project:{...project,selectedActivity:'b'},items:[item],tasks:[previous]}).draft.target,'new');
 assert(uploadProposal(doc('【乙】小红书图文大纲.txt'),{project,items:[item],tasks:[],target:{itemId:'i',stage:'大纲'}}).issues.length);
 const proposal=uploadProposal(doc('【甲】小红书图文大纲v2.txt'),{project,items:[item],tasks:[previous]});item.title='临时变化';assert.notEqual(proposal.choices[0].title,item.title);item.title='【甲】小红书图文大纲';
});
await test('歧义和失败不阻断后续文件；保存后标记防重复，旧轮次结果保留',async()=>{
 const state={settings:{selected:'p',projects:[structuredClone(project)]},items:[structuredClone(item)],tasks:[structuredClone(previous)]},pending=new Map();let n=0;
 const queue=createUploadQueue({state:()=>state,refresh(){},toast(){},liveSheets:()=>[],parseFile:async f=>{if(f.name==='broken')throw Error('坏文件');return doc(f.name,await f.text());},makeItem:fields=>({...fields,id:'new-'+(++n)}),savePending:async row=>pending.set(row.id,structuredClone(row)),loadPending:async()=>[...pending.values()],removePending:async id=>pending.delete(id),archiveOriginal:async()=>{},commitUpload:async(records,id,guard)=>{guard();for(const [store,row] of records){if(store==='integrations')pending.set(row.id,row);else if(store==='items'){if(!state.items.some(i=>i.id===row.id))state.items.push(row);}else if(store==='tasks')state.tasks.push(row);}}});
 const file=name=>new File(['正文'],name);
 await queue.upload([file('未知.txt'),file('broken'),file('【甲】小红书图文大纲v2.txt'),file('【乙】抖音视频脚本.txt')]);
 assert.deepEqual(queue.rows.map(r=>r.status),['choice','failed','saved','saved']);assert.equal(state.tasks.length,3);assert.equal(state.tasks[1].flow.round,2);assert.deepEqual(state.tasks[0],previous);assert.equal([...pending.values()].filter(r=>r.status!=='saved').length,2);
 for(const [field,value] of Object.entries({author:'丙',platform:'其他',kind:'图文',stage:'初稿',title:'新内容'}))queue.edit(queue.rows[0].id,field,value);
 await queue.confirm([queue.rows[0].id]);assert.equal(state.tasks.length,4);await queue.confirm([queue.rows[0].id]);assert.equal(state.tasks.length,4);
 await queue.cancel(queue.rows[1].id);assert.equal([...pending.values()].filter(r=>r.status!=='saved').length,0);
});
console.log(JSON.stringify({passed:true,total:checks.length,checks}));
