import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {imageFixture} from './grid_images_fixture.mjs';
import {gridTable,cellEditable} from '../source-grid.js';

const home=fs.mkdtempSync(path.join(os.tmpdir(),'zhigao-grid-images-'));
let runtimeFactory;
if(process.argv.includes('--embedded')){
 const connector=fs.readFileSync(new URL('../zhigao-connector.mjs',import.meta.url),'utf8');
 const modules=JSON.parse(connector.match(/^const TASK_MODULES = (.*);$/m)[1]);
 runtimeFactory=(await import('data:text/javascript;base64,'+modules['grid-runtime.mjs'])).createGridRuntime;
}
const fixture=imageFixture(home,runtimeFactory),run=fixture.runtime,url='https://synthetic.feishu.cn/sheets/book';
const read=()=>run({action:'gridRead',url,sheetId:'s',startRow:1,pageSize:40});
const batch=(s,ids)=>run({action:'gridImages',url,sheetId:s.sheetId,token:s.token,ids});
const checks=[],ok=s=>{checks.push(s);console.log('PASS '+s);};
try{
 let s=await read();
 assert.ok(Array.isArray(s.images),'Reading the table must expose its embedded image references');
 assert.equal(s.images.length,9);assert.equal(fixture.state().requests.length,0);
 assert.deepEqual((await run({action:'gridRead',url,sheetId:'other',startRow:1,pageSize:8})).images,[]);
 assert.ok(s.images.some(i=>i.address==='B3'));assert.ok(s.images.some(i=>i.address==='B9'));assert.ok(s.images.some(i=>i.address==='A39'));
 ok('图片引用覆盖富文本、原始数组、原始对象和跨页合并起点，读表不等待图片下载');
 const byAddress=a=>s.images.find(i=>i.address===a).id;
 let result=await batch(s,[byAddress('B3'),byAddress('D3'),byAddress('F3')]);
 assert.equal(fixture.state().requests.length,1);assert.deepEqual(fixture.state().requests[0],['red','blue']);
 assert.equal(result.images.length,3);assert.ok(result.images.every(i=>i.state==='ready'));
 await batch(s,[byAddress('B3')]);assert.equal(fixture.state().requests.length,1);
 ok('每批最多5项，同图多格去重，已读图片链接只保存在当前快照内存');
 const calls=fixture.state().requests.length;
 await assert.rejects(batch(s,['unknown']),{code:'GRID_IMAGE'});
 await assert.rejects(batch(s,Array(6).fill(byAddress('B3'))),{code:'GRID_IMAGE'});
 await assert.rejects(run({action:'gridImages',url:url+'x',sheetId:'s',token:s.token,ids:[byAddress('B3')]}),{code:'GRID_STALE'});
 assert.equal(fixture.state().requests.length,calls);
 ok('伪造图片、超量请求及跨表凭据被拒绝，不调用下载接口');
 result=await batch(s,[byAddress('B6'),byAddress('F9')]);
 assert.ok(result.images.every(i=>i.state==='unavailable'&&!i.url));
 ok('缺失链接及非HTTPS地址按图片失败返回，不伪装已加载或执行链接');
 const html=gridTable(s,{},'', '',Object.fromEntries(result.images.map(i=>[i.id,i])));
 assert.ok(html.includes('data-grid-image='));assert.ok(html.includes('图片前说明'));assert.ok(html.includes('图片后说明'));
 assert.ok(!html.includes('<img src="javascript:'));
 assert.equal(cellEditable(s.ranges[0].cells[2][1]),false);
 ok('配图保留位置、前后文字和只读保护，渲染不接受非HTTPS图片');
 s=await read();fixture.control({mode:'changed'});
 await assert.rejects(batch(s,[s.images[0].id]),{code:'GRID_CHANGED'});
 fixture.control({mode:'ready'});
 ok('下载过程中原表变化拒绝旧图，不将旧链接用于新版本');
 s=await read();fixture.control({mode:'denied'});
 await assert.rejects(batch(s,[s.images[0].id]),{code:'FEISHU_ACCESS'});
 fixture.control({mode:'ready'});
 await batch(s,[s.images[0].id]);
 assert.equal(fixture.state().writes,0);
 ok('图片权限失败可在刷新后重读，所有图片读取均不修改源表');
 const fileContents=fs.readdirSync(path.join(home,'grid-snapshots')).map(f=>fs.readFileSync(path.join(home,'grid-snapshots',f),'utf8')).join('');
 assert.ok(!fileContents.includes('tmp_download_url')&&!fileContents.includes('images.synthetic.test')&&!fileContents.includes('image_token'));
 ok('持久结构快照不保存图片内容或临时下载链接');
 s=await read();
 await assert.rejects(run({action:'gridWrite',url,sheetId:'s',token:s.token,address:'B3',cell:{value:'replace image'},operationId:crypto.randomUUID()}),{code:'GRID_COMPLEX'});
 await run({action:'gridWrite',url,sheetId:'s',token:s.token,address:'F6',cell:{value:'normal cell saved'},operationId:crypto.randomUUID()});
 assert.equal(fixture.state().rows.F6.rawValue,'normal cell saved');assert.equal(fixture.state().writes,1);
 ok('带图原表仍能写入普通格，图片格在服务端拒绝覆盖');
 if(process.env.ZHIGAO_VERIFY_OUT){fs.mkdirSync(process.env.ZHIGAO_VERIFY_OUT,{recursive:true});fs.writeFileSync(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks,requests:fixture.state().requests,writes:fixture.state().writes},null,2));}
}finally{fs.rmSync(home,{recursive:true,force:true});}
