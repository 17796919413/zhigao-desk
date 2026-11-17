// Actual connector matching, cell rechecks, write pipeline and journal against
// synthetic read/CLI adapters. No credentials, real CLI or remote I/O.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import http from 'node:http';
import {columnName} from '../grid-runtime.mjs';
const source=fs.readFileSync(new URL('../zhigao-connector.mjs',import.meta.url),'utf8');
const pipeline=source.slice(source.indexOf('const normFeishu ='),source.indexOf('// ---------- 执行表提炼'));
const journal=source.slice(source.indexOf('function journal()'),source.indexOf('const SEED_HEADERS='));
export function createSyncFixture(home){
 fs.mkdirSync(home,{recursive:true});
 const headers=['达人','发布平台','内容标题','活动','大纲','脚本','初稿','发布档期','发布状态','品牌方反馈'];
 const initial=[['同名达人','小红书','同款内容','秋季活动','','/','','2026-11-20','待发布','品牌原话保留'],['同名达人','小红书','同款内容','冬季活动','','/','','2026-12-20','待发布','冬季反馈保留']];
 let rows=structuredClone(initial),columns=[...headers],revision=1,writes=[],readCalls=0,freshCalls=0,flags={};
 const index=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
 const valueAt=(row,col)=>row===1?columns[col]:rows[row-2]?.[col]??'';
 const readSheet=async(u,id)=>({sheetId:id,name:id==='s'?'多活动审核表':'其他子表',headers:[...columns],rows:id==='s'?structuredClone(rows):[['其他达人','抖音','其他内容','秋季活动','','','','','','其他表保持']],rowStart:1,writeHistory:vm.runInContext(`historyFor('book',${JSON.stringify(id)})`,ctx)});
 const larkJson=async(args)=>{
  const get=k=>args[args.indexOf(k)+1],range=get('--range'),m=range.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if(args[1]==='+cells-get'){
   if(flags.readbackScope&&writes.length)throw Object.assign(Error('scope denied during readback'),{code:'FEISHU_SCOPE',details:{definitelyNotExecuted:true,missingScopes:['sheets:read']}});
   freshCalls++;
   if(flags.changeActivity){flags.changeActivity=false;rows[0][columns.indexOf(flags.activityHeader||'活动')]='冬季活动';revision++;}
   const first=+m[2],last=+(m[4]||m[2]),a=index(m[1]),b=index(m[3]||m[1]);
   const cells=Array.from({length:last-first+1},(_,i)=>Array.from({length:b-a+1},(_,j)=>({value:valueAt(first+i,a+j),...(flags.formula&&a+j===columns.indexOf('大纲')?{formula:'=""'}:{})})));
   return {data:{ranges:[{row_indices:Array.from({length:last-first+1},(_,i)=>first+i),col_indices:Array.from({length:b-a+1},(_,i)=>columnName(a+i)),cells}]}};
  }
  if(args[1]==='+cells-set'){
   if(flags.writeScope)throw Object.assign(Error('scope denied'),{code:'FEISHU_SCOPE',details:{definitelyNotExecuted:flags.writeScope==='definite',missingScopes:['sheets:spreadsheet']}});
   if(flags.fail)throw Error('synthetic remote failure');
   const value=JSON.parse(get('--cells'))[0][0].value;rows[+m[2]-2][index(m[1])]=value;writes.push({sheetId:get('--sheet-id'),cell:range,value});revision++;
   if(flags.lost){flags.lost=false;throw Error('synthetic response lost');}return {data:{revision}};
  }
  throw Error('Unexpected synthetic command '+args[1]);
 };
 const ctx=vm.createContext({fs,path,crypto,JOURNAL:path.join(home,'sync-history.json'),larkJson,columnLabel:columnName,columnNumber:index,feishuUrl:u=>u,readSheet,workbookInfo:async()=>({data:{token:'book',revision}})});
 vm.runInContext(pipeline+journal,ctx);
 const state=()=>({headers:columns,rows,writes,revision,readCalls,freshCalls});
 const control=b=>{if(b.reset){rows=structuredClone(initial);columns=[...headers];revision++;writes=[];flags={};fs.rmSync(path.join(home,'sync-history.json'),{force:true});}Object.assign(flags,b);if(b.rows){rows=structuredClone(b.rows);revision++;}if(b.headers){columns=[...b.headers];revision++;}return state();};
 async function invoke(b){
  if(b.action==='readAll'){readCalls++;if(flags.readDelay)await new Promise(r=>setTimeout(r,flags.readDelay));return {title:'多活动合成审核表',revision,sheets:[await readSheet(b.url,'s'),await readSheet(b.url,'other')],identity:'synthetic'};}
  if(b.action==='write'){
   if(flags.insertBeforeWrite){flags.insertBeforeWrite=false;rows.unshift(columns.map(()=>''));revision++;}
   if(flags.writeDelay)await new Promise(r=>setTimeout(r,flags.writeDelay));
   ctx.input=b;const result=await vm.runInContext('writeFeishu(input.url,input.sheetId,input.writes)',ctx);
   return flags.emptyResult?{}:result;
  }
  throw Error('Unexpected action '+b.action);
 }
 return {invoke,control,state,validate:w=>{ctx.check=w;ctx.sheet={headers:columns,rows,rowStart:1};return vm.runInContext('validateWrite(check,sheet)',ctx);}};
}
if(process.env.ZHIGAO_SYNC_SERVER==='1'){
 const fixture=createSyncFixture(process.env.ZHIGAO_VERIFY_OUT);
 let queue=Promise.resolve();
 http.createServer(async(req,res)=>{let data='';for await(const x of req)data+=x;try{const b=JSON.parse(data||'{}');let value;if(req.url==='/control')value=fixture.control(b);else{const call=()=>fixture.invoke(b);if(b.action==='write'){const p=queue.then(call);queue=p.catch(()=>{});value=await p;}else value=await call();}res.end(JSON.stringify({ok:true,data:value}));}catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message,code:e.code}));}}).listen(0,'127.0.0.1',function(){console.log(JSON.stringify({port:this.address().port}));});
}
