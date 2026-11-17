import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {imageFixture} from './grid_images_fixture.mjs';
import {gridTable} from '../source-grid.js';

const home=fs.mkdtempSync(path.join(os.tmpdir(),'zhigao-grid-floating-'));
let runtimeFactory;
if(process.argv.includes('--embedded')){
 const source=fs.readFileSync(new URL('../zhigao-connector.mjs',import.meta.url),'utf8');
 const modules=JSON.parse(source.match(/^const TASK_MODULES = (.*);$/m)[1]);
 runtimeFactory=(await import('data:text/javascript;base64,'+modules['grid-runtime.mjs'])).createGridRuntime;
}
const fixture=imageFixture(home,runtimeFactory,{floating:true}),run=fixture.runtime,url='https://synthetic.feishu.cn/sheets/book';
const read=(startRow=1)=>run({action:'gridRead',url,sheetId:'s',startRow,pageSize:40});
const floats=s=>run({action:'gridFloating',url,sheetId:s.sheetId,token:s.token});
const images=(s,ids)=>run({action:'gridImages',url,sheetId:s.sheetId,token:s.token,ids});
const checks=[],ok=s=>{checks.push(s);console.log('PASS '+s);};
try{
 let s=await read();
 assert.equal(fixture.state().floatReads,0,'Text read must not wait for floating images');
 let result=await floats(s);
 assert.equal(result.floatingImages.length,3);assert.equal(result.revision,s.revision);
 assert.deepEqual(result.floatingImages.map(i=>i.id),['float:banner','float:page','float:missing']);
 assert.equal(result.floatingImages[1].address,'B39');
 ok('浮动图片按官方字段读取并绑定当前快照，普通格先返回');
 let downloaded=await images(s,[s.images.find(i=>i.address==='B3').id,result.floatingImages[0].id]);
 assert.deepEqual(fixture.state().requests,[['red']]);assert.equal(downloaded.images.length,2);
 ok('浮动图与单元格图共用下载去重，图片令牌不传给网页');
 const merged={...s,...result,images:[...s.images,...result.floatingImages]};
 const html=gridTable(merged,{},'','',Object.fromEntries(downloaded.images.map(i=>[i.id,i])));
 assert.ok(html.includes('data-grid-floating="float:banner"'));
 assert.ok(html.includes('data-grid-floating="float:page"'));
 assert.ok(!html.includes('float_image_token')&&!html.includes('NaN'));
 const future=gridTable({...merged,floatingImages:[{...result.floatingImages[0],id:'float:future',row:84}],floatingLayout:{row_heights:[],hidden_rows:[]}});
 assert.ok(!future.includes('data-grid-floating="float:future"'),'Future anchors cannot be pulled into this page by unqueried geometry');
 ok('浮动图按原位置分片显示，跨冻结区域仍保留单一原图尺寸');
 s=await read(41);result=await floats(s);
 const next=gridTable({...s,...result},{});
 assert.ok(next.includes('data-grid-floating="float:page"'),'Previous page anchor must remain visible where image crosses into this page');
 assert.ok(!next.includes('data-grid-floating="float:missing"'));
 ok('跨页图片读取前页锚点几何，当前页只显示相交部分');
 await assert.rejects(run({action:'gridFloating',url:url+'x',sheetId:'s',token:s.token}),{code:'GRID_STALE'});
 fixture.control({mode:'float-changed'});await assert.rejects(floats(s),{code:'GRID_CHANGED'});
 fixture.control({mode:'float-denied'});s=await read();await assert.rejects(floats(s),{code:'FEISHU_ACCESS'});
 fixture.control({mode:'float-invalid'});await assert.rejects(floats(s),{code:'GRID_IMAGE'});
 ok('切表、版本变化、失权及非法定位均不混入当前表');
 fixture.control({mode:'ready'});s=await read();await floats(s);
 const stored=fs.readdirSync(path.join(home,'grid-snapshots')).map(f=>fs.readFileSync(path.join(home,'grid-snapshots',f),'utf8')).join('');
 assert.ok(!stored.includes('float_image_token')&&!stored.includes('float:banner')&&!stored.includes('images.synthetic.test'));
 assert.equal(fixture.state().writes,0);
 ok('浮动读取不写源表，也不持久化图片信息或临时链接');
 if(process.env.ZHIGAO_VERIFY_OUT){fs.mkdirSync(process.env.ZHIGAO_VERIFY_OUT,{recursive:true});fs.writeFileSync(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks,embedded:process.argv.includes('--embedded')},null,2));}
}finally{fs.rmSync(home,{recursive:true,force:true});}
