import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const connector=fs.readFileSync(new URL('../zhigao-connector.mjs',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
let checks=0, failures=0;
async function check(name,fn){try{await fn();checks++;console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+' '+e.stack);}}
await check('saving an item propagates storage failure and does not insert it in memory',async()=>{
 const actual=app.slice(app.indexOf('async function saveTask('),app.indexOf('const docsOf='));
 const context=vm.createContext({tasks:[],items:[],itemOf:()=>null,db:{},clone:structuredClone,savedCopy:structuredClone,savedRecords:new Map(),Date,
  persistLocal:async()=>{throw Error('storage failed');},persistAI:async()=>{throw Error('storage failed');},
  dbOp:async()=>{throw Error('storage failed');},toast:()=>{},item:{id:'test'}});
 await assert.rejects(vm.runInContext(actual+'\nsaveItem(item)',context),{code:'LOCAL_SAVE_FAILED'});
 assert.equal(context.items.length,0);
});
for(const fault of ['readback','response','journal'])await check('remote '+fault+' uncertainty stops the remaining writes',async()=>{
 const actual=connector.slice(connector.indexOf('async function writeFeishu('),connector.indexOf('// ---------- 执行表提炼'));
 let remoteWrites=0,reads=0;
 const sandbox={workbookInfo:async()=>({}),workbookKey:()=> 'book',readSheet:async()=>({}),validateWrite:w=>({physicalRow:w.row,keyNames:['author'],keyColumns:[0]}),columnLabel:()=> 'B',
  freshRowCells:async()=>{reads++;if(fault==='readback'&&reads===2)throw Error('read failed');return new Map([[0,{value:'author'}],[1,{value:reads%2===0?'one':''}]]);},
  normFeishu:String,rememberedWrite:()=>null,cellHasValue:c=>!!c.value,journal:()=>({version:1,entries:[],intents:[]}),saveJournal:()=>{},
  beginWrite:()=> 'intent',resolveWrites:async()=>{},finishWrite:()=>{if(fault==='journal')throw Error('disk full');},
  larkJson:async()=>{remoteWrites++;if(fault==='response')throw Error('response lost');},feishuUrl:x=>x,
  recordWrite:()=>{if(fault==='journal')throw Error('disk full');},
  writes:[2,3].map(row=>({row,column:1,header:'脚本',field:'script',key:{author:'author'},keyColumns:{author:0},value:'one'}))};
 const result=await vm.runInNewContext(actual+'\nwriteFeishu("https://example.invalid/sheets/Synthetic","S",writes)',sandbox);
 assert.equal(remoteWrites,1);assert.equal(result.results[0].status,'uncertain');assert.equal(result.uncertain,1);assert.equal(result.rejected,0);assert.equal(result.notAttempted,1);
});
for(const scenario of ['confirmed','changed','blank','journal-before-send'])await check('persistent intent recovery: '+scenario,async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zg-write-intent-'));
 try{
  const actual=connector.slice(connector.indexOf('async function writeFeishu('),connector.indexOf('// ---------- 执行表提炼'));
  const helpers=connector.slice(connector.indexOf('function journal()'),connector.indexOf('const SEED_HEADERS='));
  const w={row:2,column:1,header:'脚本',field:'script',key:{author:'author'},keyColumns:{author:0},value:'one'};
  let value='',writes=0,lose=true;
  const sandbox={fs,path,crypto,JOURNAL:path.join(root,'journal.json'),normFeishu:String,feishuUrl:x=>x,
   workbookInfo:async()=>({data:{token:'book'}}),readSheet:async()=>({}),validateWrite:()=>({physicalRow:2,keyNames:['author'],keyColumns:[0]}),columnLabel:()=> 'B',cellHasValue:c=>!!c.value,
   freshRowCells:async()=>new Map([[0,{value:'author'}],[1,{value}]]),
   larkJson:async()=>{writes++;value='one';if(lose)throw Error('response lost');},w};
  const context=()=>{const c=vm.createContext({...sandbox});vm.runInContext(helpers+actual,c);return c;};
  let c=context();
  if(scenario==='journal-before-send'){
   fs.mkdirSync(sandbox.JOURNAL+'.tmp');const result=await vm.runInContext('writeFeishu("https://example.invalid/sheets/Test","S",[w])',c);assert.equal(writes,0);assert.equal(result.rejected,1);return;
  }
  const first=await vm.runInContext('writeFeishu("https://example.invalid/sheets/Test","S",[w])',c);assert.equal(first.uncertain,1);assert.equal(writes,1);
  assert.equal(JSON.parse(fs.readFileSync(sandbox.JOURNAL)).intents.length,1);
  lose=false;c=context();if(scenario==='changed')value='someone else';if(scenario==='blank')value='';
  if(scenario==='confirmed'){
   const next=await vm.runInContext('writeFeishu("https://example.invalid/sheets/Test","S",[w])',c);assert.equal(next.written,1);assert.equal(next.results[0].reused,true);assert.equal(JSON.parse(fs.readFileSync(sandbox.JOURNAL)).intents.length,0);
  }else await assert.rejects(vm.runInContext('writeFeishu("https://example.invalid/sheets/Test","S",[w])',c));
  assert.equal(writes,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
console.log(JSON.stringify({checks,failures}));if(failures)process.exitCode=1;
