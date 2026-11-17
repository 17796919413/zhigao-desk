import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {saveProjectBackup,readProjectBackup,backupDirectoryName,createBackupCache} from '../project-backup.js';
import {localDirectory} from './backup_fs_fixture.mjs';

const home=await fs.mkdtemp(path.join(os.tmpdir(),'zhigao-backup-read-')),root=localDirectory(home),checks=[];
const snapshot=text=>({projects:[{id:'p',name:'读取一致性合成品牌',notes:text,rules:[],library:[]}],items:[{id:'i',projectId:'p',kind:'图文'}],docs:[{id:'d',projectId:'p',itemId:'i',fmt:'text',cells:[]}],batches:[],integrations:[{id:'upload:u',kind:'pending-upload',projectId:'p',file:new File([text],'original.txt')}],media:[],libraryAssets:[],artifacts:[{docId:'d',path:'result.html',blob:new Blob([text])}]});
function intercepted(dir,onRead){return {...dir,async getDirectoryHandle(...args){return intercepted(await dir.getDirectoryHandle(...args),onRead);},async getFileHandle(name,...args){const handle=await dir.getFileHandle(name,...args);return {...handle,async getFile(){await onRead(name);return handle.getFile();}};}};}
const pass=name=>{checks.push(name);console.log('PASS '+name);};
try{
 await saveProjectBackup(root,snapshot('baseline'));
 const dir=await root.getDirectoryHandle(await backupDirectoryName('p'));
 let waiting,release,held=false;const reached=new Promise(resolve=>waiting=resolve),resume=new Promise(resolve=>release=resolve);
 const reading=readProjectBackup(intercepted(dir,async name=>{if(/^[a-f0-9]{64}$/.test(name)&&!held){held=true;waiting();await resume;}}));
 await reached;await saveProjectBackup(root,snapshot('newer'));release();
 const retried=await reading;assert.equal(retried.data.projects[0].notes,'newer');assert.equal(await retried.data.integrations[0].file.text(),'newer');
 pass('读取旧块期间新备份提交并清理，自动重读新索引且不返回混合记录');

 let changed=false;
 const latest=await readProjectBackup(intercepted(dir,async name=>{if(name==='owner.json'&&!changed){changed=true;await saveProjectBackup(root,snapshot('changed-after-chunks'));}}));
 assert.equal(latest.data.projects[0].notes,'changed-after-chunks');
 pass('文件均已读取但索引在返回前变化，仍选择新的完整版本');

 let churn=0;
 await assert.rejects(readProjectBackup(intercepted(dir,async name=>{if(name==='owner.json')await saveProjectBackup(root,snapshot('churn-'+(++churn)));})),/稍后重试/);
 assert.equal(churn,3);
 pass('持续变化只尝试三轮并如实报稍后重试，不无限重读或伪成功');

 const cache=createBackupCache();await readProjectBackup(dir,{cache});
 const manifest=JSON.parse(await fs.readFile(path.join(dir.root,'latest.json'),'utf8')),hash=manifest.payload.data.integrations[0].file.chunks[0].hash,block=path.join(dir.root,'blocks',hash),savedBlock=await fs.readFile(block),stat=await fs.stat(block);
 await fs.writeFile(block,Buffer.alloc(savedBlock.length,88));await fs.utimes(block,stat.atime,stat.mtime);
 await assert.rejects(readProjectBackup(dir,{cache}),/摘要/);
 pass('恢复读取重新核验实际字节，相同长度时间戳和旧校验缓存不能掩盖损坏');
 await fs.writeFile(block,savedBlock);

 const valid=await fs.readFile(path.join(dir.root,'latest.json'),'utf8');await fs.writeFile(path.join(dir.root,'last-good.json'),valid);await fs.writeFile(path.join(dir.root,'latest.json'),'broken');
 const fallback=await readProjectBackup(dir);assert.equal(fallback.fallback,true);assert.equal(await fallback.data.artifacts[0].blob.text(),'churn-3');
 pass('稳定损坏的新索引继续使用完整的上一份可用索引');
 await fs.unlink(path.join(dir.root,'latest.json'));assert.equal((await readProjectBackup(dir)).fallback,true);
 pass('最新索引缺失时仍能读取完整的上一份可用索引');
 if(process.env.ZHIGAO_VERIFY_OUT){await fs.mkdir(process.env.ZHIGAO_VERIFY_OUT,{recursive:false});await fs.writeFile(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks,realRemoteWrites:0},null,2));}
}finally{await fs.rm(home,{recursive:true,force:true});}
