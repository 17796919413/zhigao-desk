import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {backupArtifactReferences,backupArtifactTarget,validateProjectSnapshot,saveProjectBackup,readProjectBackup,backupDirectoryName} from '../project-backup.js';
import {planProjectRestore} from '../backup-restore.js';
import {localDirectory} from './backup_fs_fixture.mjs';

const snapshot=()=>({
 projects:[{id:'p',name:'历史归档合成品牌',activities:[{id:'a',name:'秋季'}],rules:[],library:[]}],
 items:[{id:'i',projectId:'p',activityId:'a',kind:'视频'}],
 docs:[{id:'d',itemId:'i',projectId:'p',activityId:'a',fmt:'text',cells:[],flow:{state:'review',round:2},originalSaved:'original.txt',saved:[{path:'manual.txt'}],aiHistory:[{at:'first',summary:'首审结论',batchId:'b',saved:{path:'first.txt'},archive:{state:'saved',output:'first.txt',notes:'first.html',paths:['first.txt','first.html']}},{at:'second',summary:'复审结论',saved:{path:'second.txt'}}],rounds:[{id:'old',itemId:'i',projectId:'p',activityId:'a',fmt:'text',cells:[],flow:{state:'passed',round:1},originalSaved:'old-original.txt',saved:[{path:'manual.txt'}],aiHistory:[{at:'old-result',saved:{path:'old-result.txt'}}]}]}],
 batches:[{id:'b',projectId:'p',entries:[{docId:'d',status:'completed'}]}],integrations:[],media:[],libraryAssets:[],artifacts:[]
});
const current={selected:'local',projects:[{id:'local',name:'本机保留'}]},existing={tasks:[{id:'d'}],items:[{id:'i'}],batches:[{id:'b'}],integrations:[],media:[]};
const checks=[];
const check=async(name,run)=>{await run();checks.push(name);console.log('PASS '+name);};
let sequence=0;
const plan=s=>planProjectRestore(s,current,existing,()=>'restored-'+(++sequence));

await check('首审与复审的修改稿、意见和不完整旧paths索引都进入备份引用',()=>{
 const refs=backupArtifactReferences(snapshot().docs[0]);
 assert.equal(refs.length,8);assert(refs.some(r=>r.path==='second.txt'&&r.recordPath[0]==='aiHistory'));
 assert(refs.some(r=>r.path==='first.html'&&r.recordPath[1]===0));
});
await check('同一记录内按路径去重，不合并属于当前稿与旧轮的同路径文件',()=>{
 const refs=backupArtifactReferences(snapshot().docs[0]);
 assert.equal(refs.filter(r=>r.path==='first.txt').length,1);
 assert.deepEqual(refs.filter(r=>r.path==='manual.txt').map(r=>r.recordPath),[[],['rounds',0]]);
});
await check('嵌套旧轮与历史审稿可准确定位，旧备份默认仍指向当前稿',()=>{
 const doc=snapshot().docs[0];assert.equal(backupArtifactTarget(doc),doc);
 assert.equal(backupArtifactTarget(doc,['rounds',0,'aiHistory',0]),doc.rounds[0].aiHistory[0]);
});
await check('越界、非法类型和任意字段路径在导入前拒绝',()=>{
 const data=snapshot();
 for(const bad of [null,'aiHistory', ['rounds'],['rounds',-1],['rounds','0'],['rounds',0.5],['rounds',10],['ai',0],['__proto__',0],['aiHistory',0,'rounds',0]]){
  data.artifacts=[{docId:'d',path:'result.txt',recordPath:bad,blob:new Blob(['result'])}];
  assert.throws(()=>validateProjectSnapshot(data),/结果文件记录/);
 }
 data.artifacts=[{docId:'d',path:'result.txt',original:'yes',blob:new Blob(['result'])}];assert.throws(()=>validateProjectSnapshot(data),/结果文件归属/);
});
await check('恢复规划保留历史结论与流转事实，清理旧机器路径并绑定新批次',()=>{
 const data=snapshot(),before=structuredClone(data),p=plan(data),d=p.records.find(([s])=>s==='tasks')[1],b=p.records.find(([s])=>s==='batches')[1];
 assert.deepEqual(data,before);assert.equal(d.aiHistory[0].summary,'首审结论');assert.equal(d.aiHistory[1].summary,'复审结论');
 assert.equal(d.aiHistory[0].saved,undefined);assert.deepEqual(d.aiHistory[0].archive.paths,[]);assert.equal(d.aiHistory[0].batchId,b.id);
 assert.equal(d.rounds[0].originalSaved,undefined);assert.equal(d.rounds[0].flow.state,'passed');
});
await check('结果恢复记录保留所属旧轮与历史审稿，不跨身份关联',()=>{
 const data=snapshot();data.artifacts=[{docId:'d',path:'first.txt',recordPath:['aiHistory',0],blob:new Blob(['首审'])},{docId:'d',path:'old-result.txt',recordPath:['rounds',0,'aiHistory',0],blob:new Blob(['旧轮'])}];
 const p=plan(data),d=p.records.find(([s])=>s==='tasks')[1],rows=p.records.filter(([s,v])=>s==='integrations'&&v.kind==='restored-output').map(([,v])=>v);
 assert(rows.every(r=>r.docId===d.id&&r.projectId===p.projectId));assert.deepEqual(rows.map(r=>r.recordPath),data.artifacts.map(r=>r.recordPath));
});
await check('原件归档关系在普通恢复、旧备份和中断后再备份中都可续接',()=>{
 const data=snapshot();data.artifacts=[{docId:'d',path:'original.txt',blob:new Blob(['original'])},{docId:'d',path:'old-original.txt',recordPath:['rounds',0],blob:new Blob(['old'])}];
 let rows=plan(data).records.filter(([s,v])=>s==='integrations'&&v.kind==='restored-output').map(([,v])=>v);assert(rows.every(r=>r.original));
 delete data.docs[0].originalSaved;data.artifacts=[{docId:'d',path:'original.txt',original:true,blob:new Blob(['original'])}];
 rows=plan(data).records.filter(([s,v])=>s==='integrations'&&v.kind==='restored-output').map(([,v])=>v);assert.equal(rows[0].original,true);
});
await check('旧数据中已有的恢复所得历史文件重新收录且不会要求旧路径',()=>{
 const d=snapshot().docs[0];d.aiHistory=[{at:'restored',archive:{state:'saved',paths:['new/result.txt']},restoredOutputs:[{path:'new/result.txt',sourcePath:'old/result.txt'}]}];
 const refs=backupArtifactReferences(d).filter(r=>r.recordPath[0]==='aiHistory');assert.deepEqual(refs,[{path:'new/result.txt',recordPath:['aiHistory',0]}]);
});
await check('实际Windows目录写入后，各历史归属、字节摘要与原件标识可回读',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zhigao-history-'));
 try{
  const data=snapshot();data.artifacts=backupArtifactReferences(data.docs[0]).map(ref=>({docId:'d',...ref,original:backupArtifactTarget(data.docs[0],ref.recordPath).originalSaved===ref.path,blob:new Blob([JSON.stringify(ref)])}));
  const root=localDirectory(dir);await saveProjectBackup(root,data);const result=await readProjectBackup(await root.getDirectoryHandle(await backupDirectoryName('p')));
  assert.equal(result.data.artifacts.length,8);
  for(const a of result.data.artifacts){assert.deepEqual(JSON.parse(await a.blob.text()),{path:a.path,recordPath:a.recordPath});assert.equal(a.original,backupArtifactTarget(result.data.docs[0],a.recordPath).originalSaved===a.path);}
  const before=await fs.readdir(dir),invalid=structuredClone(data);invalid.artifacts[0].recordPath=['rounds',999];await assert.rejects(saveProjectBackup(root,invalid),/记录归属/);assert.deepEqual(await fs.readdir(dir),before);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
if(process.env.ZHIGAO_VERIFY_OUT){await fs.mkdir(process.env.ZHIGAO_VERIFY_OUT,{recursive:false});await fs.writeFile(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks,realFeishuWrites:0},null,2));}
