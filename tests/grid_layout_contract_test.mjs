import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gridTable} from '../source-grid.js';
let module=await import('../grid-runtime.mjs');
if(process.argv.includes('--embedded')){
 const source=fs.readFileSync(new URL('../zhigao-connector.mjs',import.meta.url),'utf8');
 const modules=JSON.parse(source.match(/^const TASK_MODULES = (.*);$/m)[1]);
 module=await import('data:text/javascript;base64,'+modules['grid-runtime.mjs']);
}
const {createGridRuntime,normalizeGridLayout}=module;
const meta={sheet_id:'s',row_count:85,column_count:8,resource_type:'sheet',is_hidden:false};
// Field names and numeric hidden-row representation captured from CLI 1.0.98
// against the authorized synthetic worksheet, checkpoint-24 revision 83.
const observed={revision:83,frozen_rows:2,frozen_columns:2,hidden_rows:[38],hidden_columns:['B'],merged_cells:[{range:'A1:H1'},{range:'B39:D43'}],row_heights:[{rows:'1:38',height:27},{rows:'39:39',height:0},{rows:'40:85',height:27}],column_widths:[{cols:'A:A',width:105},{cols:'B:B',width:0},{cols:'C:H',width:105}]};
const home=fs.mkdtempSync(path.join(os.tmpdir(),'zhigao-grid-layout-'));
const checks=[],ok=s=>{checks.push(s);console.log('PASS '+s);},reads=[];
let override={};
const url='https://synthetic.feishu.cn/sheets/book';
const workbookInfo=async()=>({data:{token:'book',revision:83,sheets:[meta]}});
const unpack=range=>{const m=range.match(/^([A-Z])(\d+)(?::([A-Z])(\d+))?$/);return {rows:Array.from({length:+(m[4]||m[2])-m[2]+1},(_,i)=>+m[2]+i),cols:Array.from({length:(m[3]||m[1]).charCodeAt(0)-m[1].charCodeAt(0)+1},(_,i)=>String.fromCharCode(m[1].charCodeAt(0)+i))};};
const text=(r,c)=>r===39&&c==='B'?'跨页合并':r===1&&c==='A'?'冻结标题':'';
const larkJson=async args=>{
 const range=args[args.indexOf('--range')+1];
 if(args[0]==='api'){
  if(args[2].endsWith('float_images/query'))return {data:{items:[{range:'s!C40:C40',float_image_id:'f',width:100,height:60}]}};
  const raw=decodeURIComponent(args[2].split('/').at(-1)).split('!')[1],r=unpack(raw);
  return {data:{revision:83,valueRange:{range:'s!'+raw,majorDimension:'ROWS',values:r.rows.map(n=>r.cols.map(c=>text(n,c)))}}};
 }
 if(args[1]==='+sheet-info')return {data:{...structuredClone(observed),...override}};
 if(args[1]==='+cells-get'){
  reads.push(range);const r=unpack(range);
  return {data:{revision:83,ranges:[{row_indices:r.rows,col_indices:r.cols,cells:r.rows.map(n=>r.cols.map(c=>({value:text(n,c)})))}]}};
 }
 throw Error('Unexpected non-read command '+args.join(' '));
};
const run=createGridRuntime({home,larkJson,workbookInfo,sheetInfo:()=>meta});
try{
 let result=await run({action:'gridRead',url,sheetId:'s',startRow:1,pageSize:40});
 assert.deepEqual(result.frozen,{rows:2,columns:2});assert.deepEqual(result.layout.hidden_rows,['39']);assert.deepEqual(result.layout.hidden_columns,['B']);
 let html=gridTable(result);assert.ok(!html.includes('data-grid-index="39"'));assert.ok(html.includes('data-grid-index="38"'));assert.match(html,/data-grid-cell="B39" data-grid-position="C40"/);assert.ok(html.includes('grid-frozen-row'));
 ok('真实CLI冻结字段与零基隐藏行通过运行时进入正确渲染位置');
 reads.length=0;result=await run({action:'gridRead',url,sheetId:'s',startRow:41,pageSize:40});
 assert.ok(reads.includes('A1:H2'));assert.ok(reads.includes('B39'));html=gridTable(result);assert.match(html,/data-grid-cell="B39" data-grid-position="C41"[^>]*rowspan="3" colspan="2"/);
 ok('真实字段契约下跨页补读冻结区和隐藏合并锚点，仍绑定原始地址');
 const floating=await run({action:'gridFloating',url,sheetId:'s',token:result.token});assert.deepEqual(floating.floatingLayout.hidden_rows,['39']);assert.ok(!gridTable({...result,...floating}).includes('NaN'));
 ok('浮图补读几何也归一化隐藏行，避免分页定位使用另一种索引');
 const legacy=normalizeGridLayout({frozen_row_count:3,frozen_column_count:1,hidden_rows:[{rows:'2:4'}],hidden_columns:[{cols:'B:C'}]},meta);
 assert.equal(legacy.frozen_row_count,3);assert.deepEqual(legacy.hidden_rows,['2:4']);assert.deepEqual(legacy.hidden_columns,['B:C']);
 assert.deepEqual(normalizeGridLayout({hidden_rows:[0,84],hidden_columns:[0,7]},meta).hidden_rows,['1','85']);
 ok('已有范围对象保持一基编号，数值隐藏索引可覆盖首末行和列');
 override={frozen_row_count:1};await assert.rejects(run({action:'gridRead',url,sheetId:'s'}),{code:'GRID_LAYOUT'});override={};
 ok('两种冻结字段冲突时拒绝生成误导性布局');
 for(const hidden_rows of [[-1],[85],[1.5],['0'],['86'],['4:2'],[{}],'39']){
  override={hidden_rows};await assert.rejects(run({action:'gridRead',url,sheetId:'s'}),{code:'GRID_LAYOUT'});
 }
 for(const frozen_rows of [-1,86,2.5,'2']){
  override={frozen_rows};await assert.rejects(run({action:'gridRead',url,sheetId:'s'}),{code:'GRID_LAYOUT'});
 }
 override={};ok('无效、越界或含糊的隐藏和冻结数据停止读取，不猜测行号');
 if(process.env.ZHIGAO_VERIFY_OUT){fs.mkdirSync(process.env.ZHIGAO_VERIFY_OUT,{recursive:true});fs.writeFileSync(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks,embedded:process.argv.includes('--embedded')},null,2));}
}finally{fs.rmSync(home,{recursive:true,force:true});}
