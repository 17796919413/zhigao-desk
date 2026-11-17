import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createGridRuntime} from '../grid-runtime.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'zhigao-grid-test-'));
let revision=1,writes=0,lost=false,truncate=false,rawRevision=false,scopeError=null;
let merges=[],anchorChanged=false;
let frozenRows=0,frozenCols=0,frozenChanged=false,frozenTruncated=false;
const layoutReads=[],cellReads=[];
const rows={A1:{value:'表头',rawValue:'表头'},A2:{value:'001',rawValue:'001'},B2:{value:'7',rawValue:7},C2:{value:'TRUE',rawValue:true},D2:{value:8,rawValue:8,formula:'=B2+1'},E2:{value:'链接',rawValue:[],rich_text:[{type:'link',text:'链接',link:'https://example.com'}]}};
const meta={sheet_id:'s',title:'合成',resource_type:'sheet',row_count:80,column_count:5},url='https://test.feishu.cn/sheets/book';
const unpack=r=>{const m=r.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);return {cols:Array.from({length:(m[3]||m[1]).charCodeAt(0)-m[1].charCodeAt(0)+1},(_,i)=>String.fromCharCode(m[1].charCodeAt(0)+i)),rows:Array.from({length:Number(m[4]||m[2])-Number(m[2])+1},(_,i)=>Number(m[2])+i)};};
const workbookInfo=async()=>({data:{token:'book',title:'测试',revision,sheets:[meta]}}),sheetInfo=(info,id)=>{assert.equal(id,'s');return info.data.sheets[0];};
const larkJson=async(args,input)=>{const get=k=>args[args.indexOf(k)+1],cmd=args[1];
 if(args[0]==='api'){const range=decodeURIComponent(args[2].split('/').at(-1)).split('!')[1],r=unpack(range);return {data:{revision:revision+(rawRevision?1:0),valueRange:{majorDimension:'ROWS',range:'s!'+range,values:r.rows.map(n=>r.cols.map(c=>rows[c+n]?.rawValue??null))}}};}
 if(cmd==='+sheet-info'){const range=get('--range'),r=unpack(range);layoutReads.push(range);return {data:{revision,frozen_row_count:frozenRows,frozen_column_count:frozenCols,merged_cells:merges,row_heights:r.rows.map(n=>({rows:`${n}:${n}`,height:n===4?45:27})),column_widths:[]}};}
 if(cmd==='+cells-get'){const range=get('--range'),r=unpack(range);cellReads.push(range);if(range==='A39'&&anchorChanged){anchorChanged=false;revision++;}if(range==='A1:E3'&&frozenChanged){frozenChanged=false;revision++;}return {data:{revision,has_more:truncate||frozenTruncated&&range==='A1:E3',ranges:[{actual_range:range,row_indices:r.rows,col_indices:r.cols,cells:r.rows.map(n=>r.cols.map(c=>{const v={...rows[c+n]};delete v.rawValue;return v;}))}]}};}
 if(cmd==='+cells-set'){if(scopeError)throw Object.assign(Error('scope rejected'),scopeError);writes++;const cell=JSON.parse(input)[0][0],address=get('--range');rows[address]={...cell,rawValue:cell.value??42,value:cell.formula?42:typeof cell.value==='boolean'?String(cell.value).toUpperCase():String(cell.value)};revision++;if(lost){lost=false;throw Error('lost response');}return {data:{revision}};}
 if(cmd==='+dim-insert'){writes++;meta.row_count+=Number(get('--count'));revision++;return {data:{revision}};}
 throw Error('Unexpected command '+cmd);
};
const create=()=>createGridRuntime({larkJson,workbookInfo,sheetInfo,home});let run=create();
const read=()=>run({action:'gridRead',url,sheetId:'s',pageSize:5});
const body=(token,address,cell)=>({url,sheetId:'s',token,address,cell,operationId:crypto.randomUUID()});
const checks=[];const ok=s=>{checks.push(s);console.log('PASS '+s);};
try{
 let s=await read();assert.equal(s.ranges[0].cells[1][1].rawValue,7);assert.equal(s.ranges[0].cells[1][0].rawValue,'001');ok('格式化显示与数字、布尔、编号原始类型分离');
 let b=body(s.token,'B2',{value:9}),r=await run({...b,action:'gridWrite'});assert.equal(r.cell.rawValue,9);assert.equal((await run({...b,action:'gridWrite'})).revision,r.revision);assert.equal(writes,1);ok('数字回读成功，同操作重复调用不重复写入');
 run=create();assert.equal((await run({...b,action:'gridRecover'})).state,'saved');assert.equal(writes,1);ok('连接器重启后从操作记录恢复成功结果');
 s=await read();b=body(s.token,'C2',{value:false});lost=true;await assert.rejects(run({...b,action:'gridWrite'}),/lost/);assert.equal((await run({...b,action:'gridRecover'})).cell.rawValue,false);assert.equal(writes,2);ok('响应丢失后只读核对已保存布尔值，不重复写');
 s=await read();b=body(s.token,'A2',{value:'002'});lost=true;await assert.rejects(run({...b,action:'gridWrite'}));revision++;await assert.rejects(run({...b,action:'gridRecover'}),e=>e.code==='GRID_UNCERTAIN');assert.equal(writes,3);ok('不确定写入后再发生外部修改，拒绝猜测恢复');
 s=await read();const b1=body(s.token,'A2',{value:'003'}),b2=body(s.token,'B2',{value:10});const both=await Promise.allSettled([run({...b1,action:'gridWrite'}),run({...b2,action:'gridWrite'})]);assert.equal(both[0].status,'fulfilled');assert.equal(both[1].reason.code,'GRID_CHANGED');ok('串行写入防止同旧版本的并发请求覆盖');
 s=await read();for(const [address,cell,code] of [['E2',{value:'drop'},'GRID_COMPLEX'],['B2',{value:NaN},'GRID_VALUE'],['A99',{value:'x'},'GRID_RANGE']])await assert.rejects(run({...body(s.token,address,cell),action:'gridWrite'}),e=>e.code===code);ok('富文本保护、非有限数和越界地址拒绝');
 truncate=true;await assert.rejects(read(),e=>e.code==='GRID_TRUNCATED');truncate=false;rawRevision=true;await assert.rejects(read(),e=>e.code==='GRID_CHANGED');rawRevision=false;ok('截断或显示值/原始值版本不一致时停止');
 s=await read();b=body(s.token,'D2',{formula:'=B2+2'});assert.equal((await run({...b,action:'gridWrite'})).cell.formula,'=B2+2');await assert.rejects(run({...b,cell:{value:'changed'},action:'gridWrite'}),e=>e.code==='GRID_OPERATION');ok('公式回读与操作标识内容绑定');
 assert.equal((await run({...body(s.token,'A1',{value:'none'}),action:'gridRecover'})).state,'not-started');assert.throws(()=>run({action:'oops'}),e=>e.code==='GRID_OPERATION');ok('未派发请求可辨认，未知动作拒绝');
 merges=[{range:'A39:B43'}];rows.A39={value:'跨页正文',rawValue:'跨页正文'};
 const page2=()=>run({action:'gridRead',url,sheetId:'s',startRow:41,pageSize:5});s=await page2();
 assert.equal(s.startRow,41);assert.equal(s.endRow,45);assert.equal(s.ranges.length,2);assert.deepEqual(s.ranges[1].row_indices,[39]);assert.equal(s.ranges[1].cells[0][0].rawValue,'跨页正文');
 await assert.rejects(run({...body(s.token,'B41',{value:'wrong cell'}),action:'gridWrite'}),e=>e.code==='GRID_MERGED');
 b=body(s.token,'A39',{value:'原始起点更新'});r=await run({...b,action:'gridWrite'});assert.equal(rows.A39.rawValue,'原始起点更新');assert.equal(rows.B41,undefined);ok('跨页只补读原始起点，写入仍定位起点，覆盖格写入被拒绝');
 anchorChanged=true;await assert.rejects(page2(),e=>e.code==='GRID_CHANGED');ok('跨页补读期间版本变化时拒绝混合快照');
 merges=[];rows.A2={value:'复杂对象',rawValue:{type:'attachment'}};s=await read();await assert.rejects(run({...body(s.token,'A2',{value:'drop object'}),action:'gridWrite'}),e=>e.code==='GRID_COMPLEX');ok('只有原始值暴露的复杂对象仍受到写入保护');
 const beforeFrozenWrites=writes;frozenRows=3;frozenCols=2;merges=[{range:'A2:B6'}];s=await page2();
 assert.deepEqual(s.frozen,{rows:3,columns:2});assert.deepEqual(s.ranges[1].row_indices,[1,2,3]);assert.equal(s.startRow,41);assert.ok(layoutReads.includes('A2:B6'));assert.ok(s.layout.row_heights.some(x=>x.rows==='4:4'&&x.height===45));ok('后续页补读冻结行及跨冻结边界合并几何，保留原始行号');
 frozenRows=62;cellReads.length=0;s=await run({action:'gridRead',url,sheetId:'s',startRow:71,pageSize:5});assert.deepEqual(cellReads,['A71:E75','A1:E50','A51:E62']);assert.ok(s.ranges.every(b=>b.row_indices.length<=50));ok('超过一页的冻结区按50行补读，不丢行或一口读完整大表');
 frozenRows=3;frozenChanged=true;await assert.rejects(page2(),e=>e.code==='GRID_CHANGED');frozenTruncated=true;await assert.rejects(page2(),e=>e.code==='GRID_TRUNCATED');frozenTruncated=false;ok('冻结补读版本变化或截断时拒绝生成不完整快照');
 frozenRows=-1;await assert.rejects(page2(),e=>e.code==='GRID_LAYOUT');frozenRows=81;await assert.rejects(page2(),e=>e.code==='GRID_LAYOUT');frozenRows=0;frozenCols=.5;await assert.rejects(page2(),e=>e.code==='GRID_LAYOUT');frozenCols=0;assert.equal(writes,beforeFrozenWrites);ok('非法冻结边界拒绝；所有冻结读取均不产生写入');
 const scopeStart=writes;merges=[];frozenRows=0;frozenCols=0;s=await read();b={...body(s.token,'B2',{value:123}),action:'gridWrite'};
 scopeError={code:'FEISHU_SCOPE',details:{definitelyNotExecuted:true,missingScopes:['sheets:spreadsheet']}};
 await assert.rejects(run(b),{code:'FEISHU_SCOPE'});assert.equal(writes,scopeStart);assert.equal((await run({...b,action:'gridRecover'})).state,'not-started');
 await assert.rejects(run({...b,cell:{value:999}}),{code:'GRID_OPERATION'});scopeError=null;await run(b);await run(b);assert.equal(writes,scopeStart+1);ok('明确scope拒绝保持操作身份，重新核对后仅执行一次');
 s=await read();b={...body(s.token,'B2',{value:124}),action:'gridWrite'};scopeError={code:'FEISHU_SCOPE',details:{definitelyNotExecuted:true}};await assert.rejects(run(b));scopeError=null;revision++;await assert.rejects(run(b),{code:'GRID_CHANGED'});assert.equal(writes,scopeStart+1);ok('授权期间原表变化仍阻止旧写入');
 s=await read();b={...body(s.token,'B2',{value:125}),action:'gridWrite'};scopeError={code:'FEISHU_SCOPE'};await assert.rejects(run(b),{code:'GRID_UNCERTAIN'});scopeError=null;
 run=create();await assert.rejects(run({...b,action:'gridRecover'}),{code:'GRID_UNCERTAIN'});assert.equal(writes,scopeStart+1);ok('没有明确未执行证据的scope错误，重启后仍不自动重放');
 if(process.env.ZHIGAO_VERIFY_OUT){fs.mkdirSync(process.env.ZHIGAO_VERIFY_OUT,{recursive:true});fs.writeFileSync(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks,writes},null,2));}
}finally{fs.rmSync(home,{recursive:true,force:true});}
