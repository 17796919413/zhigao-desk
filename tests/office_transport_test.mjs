// Real LibreOffice conversion; optional fixture path keeps business files out of tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createChannelRuntime} from '../channel-runtime.mjs';
const out=process.env.ZHIGAO_VERIFY_OUT;
if(!out||!process.env.ZHIGAO_TEST_DOC)throw Error('Set isolated ZHIGAO_VERIFY_OUT and synthetic ZHIGAO_TEST_DOC');
const root=path.join(out,'office-transport');fs.mkdirSync(root,{recursive:true});
const runtime=createChannelRuntime({root}),source=fs.readFileSync(process.env.ZHIGAO_TEST_DOC),sourceHash=crypto.createHash('sha256').update(source).digest('hex');
const input={action:'begin',projectId:'synthetic-A',sourceHash,size:source.length,extension:'doc'};
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const [a,b]=await Promise.all([runtime.officeAction(input),runtime.officeAction(input)]);assert.equal(a.jobId,b.jobId);pass('concurrent begin returns one job');
const token={jobId:a.jobId,token:a.token,projectId:input.projectId,sourceHash};
const end=Math.floor(source.length/2),chunk={action:'chunk',...token,offset:0,data:source.subarray(0,end).toString('base64')};
await runtime.officeAction(chunk);assert.equal((await runtime.officeAction(chunk)).received,end);pass('lost upload response can replay exact chunk');
await assert.rejects(runtime.officeAction({...chunk,data:Buffer.alloc(end,4).toString('base64')}),{code:'INTEGRITY'});pass('replayed bytes must match original');
const restart=createChannelRuntime({root});const resumed=await restart.officeAction(input);assert.equal(resumed.jobId,a.jobId);assert.equal(resumed.received,end);pass('restart resumes saved upload offset');
await restart.officeAction({action:'chunk',...token,offset:end,data:source.subarray(end).toString('base64')});
await Promise.all([restart.officeAction({action:'finish',...token}),restart.officeAction({action:'finish',...token})]);
let status;for(let i=0;i<240;i++){status=await restart.officeAction({action:'status',...token});if(status.state==='complete'||status.state==='failed')break;await new Promise(r=>setTimeout(r,500));}
assert.equal(status.state,'complete',JSON.stringify(status));pass('concurrent finish completes actual DOC to DOCX once');
const c=await restart.officeAction(input);assert.equal(c.jobId,a.jobId);assert.equal(c.state,'complete');pass('refresh reuses completed conversion');
await assert.rejects(restart.officeAction({action:'read',...token,projectId:'synthetic-B',offset:0}),{code:'CONVERSION_BINDING'});pass('cross-brand read refused');
const data=await restart.officeAction({action:'read',...token,offset:0});assert.equal(Buffer.from(data.data,'base64').subarray(0,2).toString(),'PK');
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:true,checks,sourceHash,outputHash:status.sha256,jobId:a.jobId},null,2));
