import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createChannelRuntime} from '../channel-runtime.mjs';
if(!process.env.ZHIGAO_TEST_DOC||!process.env.ZHIGAO_VERIFY_OUT)throw Error('Synthetic DOC and isolated output required');
const source=fs.readFileSync(process.env.ZHIGAO_TEST_DOC),sourceHash=crypto.createHash('sha256').update(source).digest('hex');
let checks=0;
for(const code of ['ENOSPC','EACCES','EPERM','EBUSY']){
 const root=path.join(process.env.ZHIGAO_VERIFY_OUT,code);fs.mkdirSync(root,{recursive:true});
 let runtime=createChannelRuntime({root});
 const input={action:'begin',projectId:'synthetic',sourceHash,size:source.length,extension:'doc'},begun=await runtime.officeAction(input);
 const token={jobId:begun.jobId,token:begun.token,projectId:'synthetic',sourceHash};
 await runtime.officeAction({action:'chunk',...token,offset:0,data:source.toString('base64')});
 const rename=fs.renameSync;
 try{
  fs.renameSync=(from,to)=>{if(String(from).startsWith(root)&&String(from).endsWith('meta.tmp')&&JSON.parse(fs.readFileSync(from)).state==='complete')throw Object.assign(Error('synthetic checkpoint failure'),{code});return rename(from,to);};
  await runtime.officeAction({action:'finish',...token});
  let status;for(let n=0;n<180;n++){await new Promise(r=>setTimeout(r,200));status=await runtime.officeAction({action:'status',...token});if(status.state==='checkpoint_unsaved')break;}
  assert.equal(status.state,'checkpoint_unsaved');assert.equal(status.persisted,false);assert.equal(status.conversionComplete,true);assert.equal(status.error,code);assert.equal(runtime.busy(),false);
  await assert.rejects(runtime.officeAction({...token,action:'read',offset:0}),{code});
  await assert.rejects(runtime.officeAction(input),{code});
  runtime=createChannelRuntime({root});assert.equal((await runtime.officeAction({action:'status',...token})).state,'checkpoint_unsaved');
 }finally{fs.renameSync=rename;}
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {createChannelRuntime} from ${JSON.stringify(new URL('../channel-runtime.mjs',import.meta.url).href)};console.log(JSON.stringify(await createChannelRuntime({root:${JSON.stringify(root)}}).officeAction(${JSON.stringify({action:'status',...token})})));`],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(child.status,0,child.stderr);const recovered=JSON.parse(child.stdout);assert.equal(recovered.state,'complete');assert.equal(recovered.persisted,true);
 const output=path.join(root,'conversions',begun.jobId,'out','source.docx'),before=fs.statSync(output).mtimeMs;
 assert.equal((await runtime.officeAction(input)).jobId,begun.jobId);await runtime.officeAction({action:'finish',...token});assert.equal(fs.statSync(output).mtimeMs,before);
 const bytes=await runtime.officeAction({action:'read',...token,offset:0});assert.equal(crypto.createHash('sha256').update(Buffer.from(bytes.data,'base64')).digest('hex'),recovered.sha256);
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({code,recovered,newProcessRecovery:true,originalRetained:fs.readFileSync(path.join(root,'conversions',begun.jobId,'source.doc')).equals(source)},null,2));
 checks++;console.log('PASS '+code+' survives, reports unsaved, verifies output after restart, never converts twice');
}
console.log(JSON.stringify({passed:true,checks}));
