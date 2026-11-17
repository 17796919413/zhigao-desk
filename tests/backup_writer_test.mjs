import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {saveProjectBackup,readProjectBackup,backupDirectoryName,BACKUP_KIND,BACKUP_VERSION} from '../project-backup.js';
import {planProjectRestore} from '../backup-restore.js';
import {localDirectory} from './backup_fs_fixture.mjs';

const snapshot=(text,id='p')=>({projects:[{id,name:'单浏览器备份合成品牌',notes:text,rules:[],library:[]}],items:[{id:'i',projectId:id,kind:'图文'}],docs:[{id:'d',projectId:id,itemId:'i',fmt:'text',cells:[],buffer:new TextEncoder().encode(text).buffer}],batches:[],integrations:[],media:[],libraryAssets:[],artifacts:[]});
if(process.argv[2]==='worker'){
 const [, , ,folder,writerId,mode,text]=process.argv,control={};
 const pause=state=>new Promise(resolve=>{process.send({state});process.once('message',resolve);});
 if(mode==='pause-cleanup')control.remove=async name=>{if(name==='last-good.json')await pause('cleanup');};
 if(mode==='pause-staging')control.close=async name=>{if(name==='staging.json')await pause('staging');};
 if(mode==='first-claim'){let scanned=false;control.listed=async()=>{if(!scanned){scanned=true;await pause('preclaim');}};control.created=async name=>{if(/^writer-/.test(name))await pause('claim');};}
 try{
  const root=localDirectory(folder,control);let data=snapshot(text);
  if(mode==='restore'){
   const read=await readProjectBackup(await root.getDirectoryHandle(await backupDirectoryName('p'))),plan=planProjectRestore(read.data,{projects:[]},{items:[],tasks:[],media:[],batches:[],integrations:[]});
   const rows=name=>plan.records.filter(([store])=>store===name).map(([,r])=>r);
   data={projects:plan.settings.projects,items:rows('items'),docs:rows('tasks'),batches:rows('batches'),integrations:rows('integrations'),media:rows('media'),libraryAssets:[],artifacts:[]};data.projects[0].notes=text;
  }
  const saved=await saveProjectBackup(root,data,{writerId});
  process.send({state:'done',ok:true,projectId:data.projects[0].id,saved});
 }catch(e){process.send({state:'done',ok:false,error:e.message});}
 process.disconnect();
}else{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'zhigao-backup-writer-')),root=localDirectory(home),checks=[],children=new Set();
 const pass=name=>{checks.push(name);console.log('PASS '+name);};
 const start=(writer,mode,text,folder=home)=>{
  const child=fork(fileURLToPath(import.meta.url),['worker',folder,writer,mode,text],{stdio:['ignore','pipe','pipe','ipc']});children.add(child);child.stderr.on('data',data=>process.stderr.write(data));
  const waiting=new Map(),seen=new Map();child.on('message',value=>{seen.set(value.state,value);waiting.get(value.state)?.(value);waiting.delete(value.state);});
  child.on('exit',()=>children.delete(child));
  return {child,wait:state=>seen.has(state)?Promise.resolve(seen.get(state)):new Promise((resolve,reject)=>{waiting.set(state,resolve);child.once('error',reject);child.once('exit',code=>{if(!seen.has(state))reject(Error('Worker exited before '+state+': '+code));});})};
 };
 const tree=async folder=>{const out={};async function walk(dir,prefix=''){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name),name=prefix+entry.name;if(entry.isDirectory())await walk(full,name+'/');else out[name]=(await fs.readFile(full)).toString('base64');}}await walk(folder);return out;};
 try{
  await saveProjectBackup(root,snapshot('baseline'),{writerId:'browser-A'});
  const dir=await root.getDirectoryHandle(await backupDirectoryName('p'));
  const a=start('browser-A','pause-cleanup','writer-A');await a.wait('cleanup');const before=await tree(dir.root);
  const b=start('browser-B','save','writer-B'),rejected=await b.wait('done');assert.equal(rejected.ok,false);assert.match(rejected.error,/其他浏览器/);assert.deepEqual(await tree(dir.root),before);
  a.child.send('resume');assert.equal((await a.wait('done')).ok,true);assert.equal((await readProjectBackup(dir)).data.projects[0].notes,'writer-A');
  pass('两个独立进程争用同一已归属项目时拒绝外来配置，原目录逐文件不变且清理后可恢复');

  const restarted=start('browser-A','save','restarted');assert.equal((await restarted.wait('done')).ok,true);assert.equal((await readProjectBackup(dir)).data.projects[0].notes,'restarted');
  pass('相同持久身份在另一个进程重新打开后可继续写入，无需解锁或新步骤');

  const sourceBefore=await tree(dir.root),c=start('browser-B','restore','restored-B'),d=start('browser-C','restore','restored-C');
  const [copyB,copyC]=await Promise.all([c.wait('done'),d.wait('done')]);assert(copyB.ok,copyB.error);assert(copyC.ok,copyC.error);assert.notEqual(copyB.projectId,'p');assert.notEqual(copyC.projectId,'p');assert.notEqual(copyB.projectId,copyC.projectId);assert.deepEqual(await tree(dir.root),sourceBefore);
  for(const copy of [copyB,copyC])assert.equal((await readProjectBackup(await root.getDirectoryHandle(await backupDirectoryName(copy.projectId)))).projectId,copy.projectId);
  pass('两个独立进程同时恢复同一源备份，各建独立项目和目录，源备份字节保持');

  const interrupted=start('browser-A','pause-staging','interrupted');await interrupted.wait('staging');interrupted.child.kill();await new Promise(resolve=>interrupted.child.once('exit',resolve));
  assert.equal((await readProjectBackup(dir)).data.projects[0].notes,'restarted');
  const resumed=start('browser-A','save','after-crash');assert.equal((await resumed.wait('done')).ok,true);assert.equal((await readProjectBackup(dir)).data.projects[0].notes,'after-crash');
  pass('真实子进程在暂存期间退出后保留旧备份，原浏览器身份重启可继续保存');

  const fresh=await fs.mkdtemp(path.join(home,'first-claim-')),freshRoot=localDirectory(fresh),freshDir=await freshRoot.getDirectoryHandle(await backupDirectoryName('p'),{create:true});
  const handle=await freshDir.getFileHandle('owner.json',{create:true}),write=await handle.createWritable();await write.write(JSON.stringify({kind:BACKUP_KIND,version:BACKUP_VERSION,projectId:'p'}));await write.close();
  const first=start('first-A','first-claim','first-A',fresh),second=start('first-B','first-claim','first-B',fresh);await Promise.all([first.wait('preclaim'),second.wait('preclaim')]);first.child.send('resume');second.child.send('resume');await Promise.all([first.wait('claim'),second.wait('claim')]);first.child.send('resume');second.child.send('resume');
  const initial=await Promise.all([first.wait('done'),second.wait('done')]);assert(initial.filter(r=>r.ok).length<=1);assert(initial.some(r=>!r.ok&&/其他浏览器/.test(r.error)));
  if(initial.some(r=>r.ok))await readProjectBackup(freshDir);
  pass('旧目录首次迁移的并发身份声明可见后才检查，两个浏览器不能同时获得写入归属');
  if(process.env.ZHIGAO_VERIFY_OUT){await fs.mkdir(process.env.ZHIGAO_VERIFY_OUT,{recursive:false});await fs.writeFile(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks,independentNodeProcesses:true,externalBrowserPermission:false,realRemoteWrites:0},null,2));}
 }finally{for(const child of children)child.kill();await fs.rm(home,{recursive:true,force:true});}
}
