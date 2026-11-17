import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const connector=process.argv.includes('--embedded')?fs.readFileSync(new URL('../zhigao-connector.mjs',import.meta.url),'utf8'):null;
const {createGridRuntime}=await import(connector?'data:text/javascript;base64,'+JSON.parse(connector.match(/^const TASK_MODULES = (.*);$/m)[1])['grid-runtime.mjs']:'../grid-runtime.mjs');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'zhigao-structure-')),url='https://test.feishu.cn/sheets/book';
let revision=1,writes=0,lost=false,readback=false,readbackNext=false,dryChanged=false;
const meta={sheet_id:'s',title:'合成',resource_type:'sheet',row_count:10,column_count:6},commands=[],checks=[];
const workbookInfo=async()=>{if(readbackNext){readbackNext=false;throw Error('readback failed');}return {data:{token:'book',revision,sheets:[structuredClone(meta)]}};},sheetInfo=i=>i.data.sheets[0];
const larkJson=async a=>{const get=k=>a[a.indexOf(k)+1],cmd=a[1];commands.push(a);
 if(cmd==='+sheet-info')return {data:{revision}};
 if(cmd==='+cells-get')return {data:{revision,ranges:[{row_indices:[1],col_indices:['A'],cells:[[{value:'表头'}]]}]}};
 if(a[0]==='api')return {data:{revision,valueRange:{range:'s!A1:F10',majorDimension:'ROWS',values:[['表头']]}}};
 if(a.includes('--dry-run')){if(dryChanged){dryChanged=false;revision++;}return {data:{dry:true}};}
 if(['+dim-insert','+dim-delete'].includes(cmd)){const row=/^\d/.test(get(cmd==='+dim-insert'?'--position':'--range')),range=get('--range').split(':'),toNum=s=>row?+s:[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),count=cmd==='+dim-insert'?+get('--count'):toNum(range[1])-toNum(range[0])+1;meta[row?'row_count':'column_count']+=cmd==='+dim-insert'?count:-count;revision++;writes++;if(lost){lost=false;throw Error('response lost');}if(readback){readback=false;readbackNext=true;}return {data:{revision}};}
 throw Error('Unexpected '+cmd);
};
const create=()=>createGridRuntime({larkJson,workbookInfo,sheetInfo,home});let run=create();
const read=()=>run({action:'gridRead',url,sheetId:'s',pageSize:5});
const body=async(kind='insert',dimension='row',position=3,count=2)=>({action:'gridStructure',url,sheetId:'s',token:(await read()).token,operationId:crypto.randomUUID(),kind,dimension,position,count,...(kind==='delete'?{confirmation:`s:${dimension}:${position}:${count}`}:{})});
const ok=s=>{checks.push(s);console.log('PASS '+s);};
try{
 let b=await body();assert.equal((await run(b)).state,'saved');assert.equal(meta.row_count,12);assert.equal(writes,1);run=create();assert.equal((await run({...b,action:'gridRecover'})).state,'saved');await run(b);assert.equal(writes,1);ok('插行回读与重启恢复，重复请求只写一次');
 b=await body('delete','column',2,2);await run(b);assert.equal(meta.column_count,4);assert.ok(commands.some(a=>a.includes('B:C')&&a.includes('--dry-run')));assert.ok(commands.some(a=>a.includes('B:C')&&a.includes('--yes')));ok('删列具体范围预演、确认及维度回读');
 b=await body('delete');delete b.confirmation;await assert.rejects(run(b),e=>e.code==='GRID_CONFIRM');b=await body('delete','row',12,2);await assert.rejects(run(b),e=>e.code==='GRID_RANGE');b=await body('delete','column',1,4);await assert.rejects(run(b),e=>e.code==='GRID_RANGE');ok('拒绝无确认、越界及删除所有行列');
 b=await body('insert','column',4,8);await run(b);assert.equal(meta.column_count,12);ok('插入数量不误用删除范围限制');
 b=await body('delete');dryChanged=true;const before=writes;await assert.rejects(run(b),e=>e.code==='GRID_CHANGED');assert.equal(writes,before);ok('删除预演期间版本变化，不派发删除');
 b=await body();readback=true;await assert.rejects(run(b),/readback failed/);run=create();assert.equal((await run({...b,action:'gridRecover'})).state,'saved');assert.equal(writes,before+1);ok('已有成功回执但回读中断，重启后只读恢复');
 b=await body();lost=true;await assert.rejects(run(b),/response lost/);run=create();await assert.rejects(run({...b,action:'gridRecover'}),e=>e.code==='GRID_UNCERTAIN');await assert.rejects(run(await body()),e=>e.code==='GRID_UNCERTAIN');const count=writes;ok('无回执不凭尺寸猜成功，并阻止后续结构写入');
 const stale=await read();revision++;await assert.rejects(run({...b,action:'gridResolve',resolutionToken:stale.token}),e=>e.code==='GRID_CHANGED');const fresh=await read();assert.equal((await run({...b,action:'gridResolve',resolutionToken:fresh.token})).state,'acknowledged');assert.equal((await run({...b,action:'gridRecover'})).state,'acknowledged');assert.equal(writes,count);ok('人工核对绑定当前快照，状态不同于成功且不重写');
 await run(await body('insert','column',1,1));assert.equal(meta.column_count,13);await assert.rejects(run({...b,count:5,action:'gridRecover'}),e=>e.code==='GRID_OPERATION');ok('核对后可继续；操作标识不能更换范围');
 b=await body();readback=true;await assert.rejects(run(b));revision++;await assert.rejects(run({...b,action:'gridRecover'}),e=>e.code==='GRID_UNCERTAIN');ok('回执后的额外外部修改仍需核对');
 if(process.env.ZHIGAO_VERIFY_OUT){fs.mkdirSync(process.env.ZHIGAO_VERIFY_OUT,{recursive:true});fs.writeFileSync(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks,writes},null,2));}
}finally{fs.rmSync(home,{recursive:true,force:true});}
