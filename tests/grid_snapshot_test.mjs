import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const connector=process.argv.includes('--embedded')?fs.readFileSync(new URL('../zhigao-connector.mjs',import.meta.url),'utf8'):null;
const {createGridRuntime}=await import(connector?'data:text/javascript;base64,'+JSON.parse(connector.match(/^const TASK_MODULES = (.*);$/m)[1])['grid-runtime.mjs']:'../grid-runtime.mjs');
const checks=[];
function fixture(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'zhigao-grid-snapshot-')),url='https://test.feishu.cn/sheets/book';
 const meta={sheet_id:'s',resource_type:'sheet',title:'Private sheet title',row_count:12,column_count:3};
 let revision=1,writes=0,auth=false,scope=false,lost=false,bookToken='book';
 const workbookInfo=async()=>{if(auth)throw Object.assign(Error('login expired'),{code:'FEISHU_AUTH'});return {data:{token:bookToken,revision,sheets:[{...meta}]}};};
 const sheetInfo=(info,id)=>{const sheet=info.data.sheets.find(s=>s.sheet_id===id);if(!sheet)throw Error('sheet not found');return sheet;};
 const larkJson=async a=>{
  const cmd=a[1],get=k=>a[a.indexOf(k)+1];
  if(cmd==='+sheet-info')return {data:{revision}};
  if(cmd==='+cells-get')return {data:{revision,ranges:[{row_indices:[1],col_indices:['A'],cells:[[{value:'PRIVATE-CELL',comment:'PRIVATE-COMMENT'}]]}]}};
  if(a[0]==='api')return {data:{revision,valueRange:{range:'s!A1:C12',majorDimension:'ROWS',values:[['PRIVATE-CELL']]}}};
  if(['+dim-insert','+dim-delete'].includes(cmd)){
   if(a.includes('--dry-run'))return {data:{}};
   if(scope)throw Object.assign(Error('scope rejected'),{code:'FEISHU_SCOPE',details:{definitelyNotExecuted:true}});
   const row=/^\d/.test(get(cmd==='+dim-insert'?'--position':'--range')),count=cmd==='+dim-insert'?+get('--count'):1;
   meta[row?'row_count':'column_count']+=(cmd==='+dim-insert'?1:-1)*count;revision++;writes++;
   if(lost)throw Error('lost response');
   return {data:{revision}};
  }
  throw Error('Unexpected '+cmd);
 };
 const create=()=>createGridRuntime({larkJson,workbookInfo,sheetInfo,home});let run=create();
 return {home,url,read:()=>run({action:'gridRead',url,sheetId:'s',pageSize:5}),
  body:async(kind='insert')=>({action:'gridStructure',url,sheetId:'s',token:(await run({action:'gridRead',url,sheetId:'s',pageSize:5})).token,operationId:crypto.randomUUID(),kind,dimension:'row',position:4,count:1,...(kind==='delete'?{confirmation:'s:row:4:1'}:{})}),
  run:b=>run(b),restart:()=>{run=create();},state:()=>({revision,writes,rows:meta.row_count}),
  set:v=>{if('auth'in v)auth=v.auth;if('scope'in v)scope=v.scope;if('lost'in v)lost=v.lost;if('revision'in v)revision=v.revision;if('rows'in v)meta.row_count=v.rows;if('bookToken'in v)bookToken=v.bookToken;},
  close:()=>fs.rmSync(home,{recursive:true,force:true})};
}
async function check(name,fn){const f=fixture();try{await fn(f);checks.push(name);console.log('PASS '+name);}finally{f.close();}}
await check('confirmed insert and delete survive restart and remain idempotent',async f=>{
 for(const kind of ['insert','delete']){const b=await f.body(kind),before=f.state();f.restart();assert.equal((await f.run(b)).state,'saved');f.restart();await f.run(b);assert.equal(f.state().writes,before.writes+1);assert.equal(f.state().rows,before.rows+(kind==='insert'?1:-1));}
});
await check('login failure before journaling resumes the same confirmed range after restart',async f=>{
 const b=await f.body();f.set({auth:true});await assert.rejects(f.run(b),{code:'FEISHU_AUTH'});f.restart();assert.equal((await f.run({...b,action:'gridRecover'})).state,'not-started');f.set({auth:false});await f.run(b);assert.equal(f.state().writes,1);
});
await check('definite scope rejection resumes after restart and only dispatches once',async f=>{
 const b=await f.body();f.set({scope:true});await assert.rejects(f.run(b),{code:'FEISHU_SCOPE'});f.restart();assert.equal((await f.run({...b,action:'gridRecover'})).state,'not-started');f.set({scope:false});await f.run(b);assert.equal(f.state().writes,1);
});
await check('external revision or dimension change blocks the retained operation',async f=>{
 const b=await f.body();f.restart();f.set({revision:2});await assert.rejects(f.run(b),{code:'GRID_CHANGED'});f.set({revision:1,rows:13});await assert.rejects(f.run(b),{code:'GRID_CHANGED'});assert.equal(f.state().writes,0);
});
await check('a changed workbook identity blocks an old proof even at the same revision',async f=>{
 const b=await f.body();f.restart();f.set({bookToken:'anotherBook'});await assert.rejects(f.run(b),{code:'GRID_CHANGED'});assert.equal(f.state().writes,0);
});
await check('proofs cannot cross URLs or sheets, or authorize a cell write after restart',async f=>{
 const b=await f.body();f.restart();for(const changed of [{url:f.url+'2'},{sheetId:'other'}])await assert.rejects(f.run({...b,...changed}),{code:'GRID_STALE'});
 await assert.rejects(f.run({action:'gridWrite',url:f.url,sheetId:'s',token:b.token,operationId:crypto.randomUUID(),address:'A1',cell:{value:'changed'}}),{code:'GRID_STALE'});assert.equal(f.state().writes,0);
});
await check('lost structural receipts remain uncertain after restart and are never replayed',async f=>{
 const b=await f.body();f.set({lost:true});await assert.rejects(f.run(b),/lost response/);f.restart();await assert.rejects(f.run({...b,action:'gridRecover'}),{code:'GRID_UNCERTAIN'});await assert.rejects(f.run(b),{code:'GRID_UNCERTAIN'});assert.equal(f.state().writes,1);
 const fresh=await f.read();f.restart();assert.equal((await f.run({...b,action:'gridResolve',resolutionToken:fresh.token})).state,'acknowledged');assert.equal(f.state().writes,1);
});
await check('expired proofs fail closed across restart',async f=>{
 const b=await f.body(),now=Date.now;Date.now=()=>now()+31*60*1000;try{f.restart();await assert.rejects(f.run(b),{code:'GRID_STALE'});assert.equal(f.state().writes,0);}finally{Date.now=now;}
});
await check('disk proofs contain bounds and identity without source cells or sheet titles',async f=>{
 const b=await f.body(),dir=path.join(f.home,'grid-snapshots'),files=fs.readdirSync(dir);assert(files.length);
 const text=files.map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('\n');assert(!/PRIVATE-CELL|PRIVATE-COMMENT|Private sheet title/.test(text));
 for(const n of files)fs.writeFileSync(path.join(dir,n),'{broken');f.restart();await assert.rejects(f.run(b),{code:'GRID_STALE'});assert.equal(f.state().writes,0);
});
await check('future-dated or unavailable proofs cannot authorize a structural mutation',async f=>{
 const b=await f.body(),now=Date.now;Date.now=()=>now()-1000;try{f.restart();await assert.rejects(f.run(b),{code:'GRID_STALE'});}finally{Date.now=now;}
 const dir=path.join(f.home,'grid-snapshots');fs.rmSync(dir,{recursive:true});fs.writeFileSync(dir,'blocked');f.restart();await assert.rejects(f.read(),{code:'GRID_STORAGE'});assert.equal(f.state().writes,0);
});
await check('proof storage is bounded across runtime instances without deleting operation journals',async f=>{
 const first=await f.body();await f.run(first);const stale=(await f.read()).token;
 for(let i=0;i<34;i++){f.restart();await f.read();}
 assert(fs.readdirSync(path.join(f.home,'grid-snapshots')).length<=32);assert(fs.readdirSync(path.join(f.home,'grid-operations')).length===1);
 f.restart();await assert.rejects(f.run({...first,operationId:crypto.randomUUID(),token:stale}),{code:'GRID_STALE'});assert.equal((await f.run({...first,action:'gridRecover'})).state,'saved');assert.equal(f.state().writes,1);
});
if(process.env.ZHIGAO_VERIFY_OUT){fs.mkdirSync(process.env.ZHIGAO_VERIFY_OUT,{recursive:true});fs.writeFileSync(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks},null,2));}
