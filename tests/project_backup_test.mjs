import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createBackupCache,saveProjectBackup,readProjectBackup,backupDirectoryName,discoverProjectBackups,createProjectBackup,CHUNK_BYTES} from '../project-backup.js';
import {localDirectory} from './backup_fs_fixture.mjs';
const home=await fs.mkdtemp(path.join(os.tmpdir(),'zhigao-backup-')),flags={},root=localDirectory(home,flags),checks=[];
const snapshot=()=>({projects:[{id:'p',name:'合成备份品牌',activities:[{id:'a',name:'秋季活动'},{id:'b',name:'冬季活动'}],selectedActivity:'a',notes:'品牌笔记',library:[{id:'source',activityId:'a',title:'当前资料',ingestion:{assetKey:'lib'}}],rules:[],feishu:{refined:{url:'https://example.feishu.cn/sheets/book'},sheets:[]}}],items:[{id:'i',projectId:'p',activityId:'a',kind:'视频',author:'达人'}],docs:[{id:'d',projectId:'p',itemId:'i',activityId:'a',kind:'视频',fmt:'video',cells:[],flow:{state:'review',round:2},rounds:[{id:'old',filename:'旧稿.txt',buffer:new TextEncoder().encode('旧轮次').buffer,cells:[],flow:{state:'passed',round:1}}],ai:{at:'result',changes:[],archive:{state:'saved'}},brandFeedback:[{id:'feedback',text:'只作用于本轮'}]}],batches:[{id:'batch',projectId:'p',activityId:'a',entries:[{docId:'d',status:'reviewing',reviewToken:'secret-lease',sessionId:'secret-session',savedChecks:{text:[{id:'last',status:'checked'}]}}]}],integrations:[{id:'pending',projectId:'p',activityId:'b',kind:'pending-upload',filename:'待确认.png',originalFile:new File(['pending'],'待确认.png')}],media:[{id:'d',blob:new Blob([new Uint8Array(CHUNK_BYTES+123)])}],libraryAssets:[{id:'lib',file:{filename:'新资料.txt',originalFile:new File(['最新资料'],'新资料.txt')}}],artifacts:[{docId:'d',path:'结果.html',blob:new Blob(['审稿结果'])}]});
const pass=s=>{checks.push(s);console.log('PASS '+s);};
try{
 const data=snapshot(),cache=createBackupCache(),first=await saveProjectBackup(root,data,{cache});assert.equal(first.state,'saved');assert(first.stats.sourceBytes>CHUNK_BYTES);
 const dir=await root.getDirectoryHandle(await backupDirectoryName('p')),read=await readProjectBackup(dir,{projectId:'p'});
 assert.equal(read.data.docs[0].flow.round,2);assert.equal(await new Blob([read.data.docs[0].rounds[0].buffer]).text(),'旧轮次');assert.equal(await read.data.media[0].blob.text(),await data.media[0].blob.text());assert.equal(await read.data.artifacts[0].blob.text(),'审稿结果');
 assert.equal(read.data.batches[0].entries[0].reviewToken,undefined);assert.equal(read.data.batches[0].entries[0].sessionId,undefined);assert.deepEqual(read.data.batches[0].entries[0].savedChecks,data.batches[0].entries[0].savedChecks);
 pass('多活动、多轮次、视频、反馈、结果与未完成上传完整回读；运行凭据不进入备份');
 data.projects[0].notes='仅改一字';const second=await saveProjectBackup(root,data,{cache});assert.equal(second.stats.sourceBytes,0);assert.equal(second.stats.writtenBytes,0);assert.equal(second.stats.verifiedBytes,0);
 assert.equal((await readProjectBackup(dir)).data.projects[0].notes,'仅改一字');assert.equal((await fs.readdir(dir.root)).filter(x=>/latest|good|staging/.test(x)).length,1);
 pass('仅改记录复用已验证原件块，不重新读取视频或打整包，只有一个已提交版本');
 const previous=await fs.readFile(path.join(dir.root,'latest.json'),'utf8');flags.close=async name=>{if(name==='staging.json')throw Error('synthetic disk full');};data.projects[0].notes='写入将失败';await assert.rejects(saveProjectBackup(root,data,{cache}),/disk full/);assert.equal(await fs.readFile(path.join(dir.root,'latest.json'),'utf8'),previous);assert.equal((await readProjectBackup(dir)).data.projects[0].notes,'仅改一字');delete flags.close;
 pass('暂存写入磁盘满时上一份最新备份仍完整可恢复');
 flags.close=async name=>{if(name==='latest.json')throw Error('synthetic interrupted commit');};await assert.rejects(saveProjectBackup(root,data,{cache}),/interrupted/);assert.equal((await readProjectBackup(dir)).data.projects[0].notes,'仅改一字');delete flags.close;
 pass('提交中断不删除唯一可用备份，也不把暂存当作成功');
 flags.close=async name=>{if(name==='latest.json'){await fs.writeFile(path.join(dir.root,'latest.json'),'corrupt');throw Error('damaged manifest');}};await assert.rejects(saveProjectBackup(root,data,{cache}),/damaged/);delete flags.close;
 const fallback=await readProjectBackup(dir);assert(fallback.fallback);assert.equal(fallback.data.projects[0].notes,'仅改一字');assert.equal((await discoverProjectBackups(root))[0].projectId,'p');
 pass('最新索引损坏时从写入期间保留的最后可用索引恢复');
 await saveProjectBackup(root,data,{cache});const latest=JSON.parse(await fs.readFile(path.join(dir.root,'latest.json'),'utf8')),oldHash=latest.payload.data.libraryAssets[0].file.originalFile.chunks[0].hash;
 data.libraryAssets[0].file.originalFile=new File(['替换后的品牌资料'],'新资料.txt');await saveProjectBackup(root,data,{cache});const after=await readProjectBackup(dir);assert.equal(await after.data.libraryAssets[0].file.originalFile.text(),'替换后的品牌资料');await assert.rejects(fs.access(path.join(dir.root,'blocks',oldHash)));assert.equal(await new Blob([after.data.docs[0].rounds[0].buffer]).text(),'旧轮次');
 pass('资料替换后清除不再引用的旧块，同时保留达人旧稿与旧轮结果');
 const saved=await fs.readFile(path.join(dir.root,'latest.json'),'utf8');let guardCalls=0;
 await assert.rejects(saveProjectBackup(root,data,{cache,guard:()=>{if(++guardCalls===3)throw Error('changed source');}}),/changed source/);assert.equal(await fs.readFile(path.join(dir.root,'latest.json'),'utf8'),saved);
 pass('长备份中项目变化会阻止旧快照提交');
 flags.denied=true;await assert.rejects(saveProjectBackup(root,data,{cache}),/permission/);flags.denied=false;assert.equal((await readProjectBackup(dir)).projectId,'p');
 pass('写权限失效保留旧备份，恢复读取无需登录或会话');
 const absent=snapshot();absent.media=[];await assert.rejects(saveProjectBackup(root,absent),/视频原件缺失/);
 const unknown={...data,projects:[{...data.projects[0],id:'other'}]};await assert.rejects(saveProjectBackup(root,unknown));await assert.rejects(readProjectBackup(dir,{projectId:'wrong'}),/身份/);
 pass('缺少必需原件和项目身份不一致时停止，不生成伪完整备份');
 const many=snapshot();many.media[0].blob=new Blob(['video']);many.docs[0].fmt='text';many.docs[0].buffer=new TextEncoder().encode('a').buffer;many.media=[];
 for(let n=1;n<105;n++){many.items.push({...many.items[0],id:'i'+n});many.docs.push({...many.docs[0],id:'d'+n,itemId:'i'+n});}
 const large=await saveProjectBackup(root,many,{cache});assert.equal((await readProjectBackup(dir)).data.docs.length,105);assert(large.stats.writtenBytes<10000);
 pass('105份混合记录没有产品上限，重复原件按块去重');
 const blockDir=path.join(dir.root,'blocks'),files=await fs.readdir(blockDir);await fs.writeFile(path.join(blockDir,files[0]),'broken');await assert.rejects(readProjectBackup(dir),/无法使用/);
 pass('缺失或损坏原件块不能导入或被误认为通过校验');
 const status=[],schedulerRoot=localDirectory(await fs.mkdtemp(path.join(home,'scheduler-'))),scheduler=createProjectBackup({folder:()=>schedulerRoot,snapshot:async()=>snapshot(),status:async(id,s)=>status.push(s)},{delay:10});
 scheduler.mark('p');await new Promise(r=>setTimeout(r,100));await scheduler.run('p');assert(status.some(s=>s.state==='saved'));scheduler.dispose();
 pass('后台调度合并变更并报告实际保存状态');
 if(process.env.ZHIGAO_VERIFY_OUT){await fs.mkdir(process.env.ZHIGAO_VERIFY_OUT,{recursive:true});await fs.writeFile(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks,realRemoteWrites:0},null,2));}
}finally{await fs.rm(home,{recursive:true,force:true});}
