import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {autoMap,rowIdentity,activityColumnChoice,activityColumns,activityMappingError,refreshSheetMap,rowKey} from '../feishu.js';
import {activityRowMatch,activityMappingSheets} from '../creator-match.js';
import {createSyncFixture} from './feishu_sync_fixture.mjs';

const home=fs.mkdtempSync(path.join(os.tmpdir(),'zhigao-custom-activity-'));
const fixture=createSyncFixture(home),checks=[];
const project={id:'p',selectedActivity:'a',activities:[{id:'a',name:'秋季活动'},{id:'b',name:'冬季活动'}]};
const a={id:'ia',projectId:'p',activityId:'a',author:'同名达人',platform:'小红书',title:'同款内容',kind:'图文'},b={...a,id:'ib',activityId:'b'};
const ok=s=>{checks.push(s);console.log('PASS '+s);};
try{
 const headers=[...fixture.state().headers];headers[3]='营销项目';fixture.control({headers});
 const sheet={id:'s',headers,rows:fixture.state().rows,map:{...autoMap(headers),activity:3},activityMapping:{header:'营销项目'}};
 const match=activityRowMatch(a,[a,b],[sheet],project);
 assert.equal(match.hits.length,1,'明确选定自定义活动列后，应唯一匹配当前活动');
 assert.equal(match.hits[0].row,0);assert.equal(match.conflicts.length,0);ok('显式自定义活动列能区分同名同标题的不同活动');
 const identity=rowIdentity(sheet,0),write={status:'update',field:'outline',column:4,header:'大纲',value:'AI已审 · 1处修改',...identity};
 assert.equal(fixture.validate(write).physicalRow,2);
 const before=structuredClone(fixture.state().rows),result=await fixture.invoke({action:'write',url:'https://example.feishu.cn/sheets/book',sheetId:'s',writes:[write]});
 assert.equal(result.written,1);assert.equal(fixture.state().writes.length,1);
 for(let i=0;i<before.length;i++)for(let j=0;j<before[i].length;j++)if(i!==0||j!==4)assert.equal(fixture.state().rows[i][j],before[i][j]);
 ok('真实连接器匹配及写入管线接受显式列，仅修改当前活动的阶段格');
 const raw={...sheet,map:autoMap(headers)};delete raw.activityMapping;
 assert.equal(raw.map.activity,-1);assert.equal(activityMappingSheets(project,[a,b],[raw]).length,1);
 assert.equal(activityMappingSheets(project,[a],[{...raw,rows:[raw.rows[0]]}]).length,0);
 assert.equal(activityMappingSheets(project,[a,b],[sheet]).length,0);
 assert.equal(activityRowMatch(a,[a,b],[{...raw,map:{...raw.map,activity:3}}],project).hits.length,0);
 ok('不猜自定义列；只在活动匹配有歧义时请求选择，旧map不能冒充确认');
 for(const col of [-1,1.5,100,0,4])assert.throws(()=>activityColumnChoice(sheet,col));
 assert.throws(()=>activityColumnChoice({...sheet,headers:[...headers,'营销项目']},3),/重复/);
 assert.throws(()=>activityColumnChoice({...sheet,headers:headers.map((h,i)=>i===3?' ':h)},3));
 assert.deepEqual(activityColumnChoice(sheet,3),{header:'营销项目'});
 ok('空列、重复列、无效地址和已用于其他字段的列不能作为活动列');
 let w=structuredClone(write);delete w.activityMapping;assert.throws(()=>fixture.validate(w),/活动列/);
 for(const mutate of [w=>w.activityMapping.column=2,w=>w.activityMapping.header='旧活动名',w=>w.keyColumns.activity=2,w=>w.key.activity='']){
  w=structuredClone(write);mutate(w);assert.throws(()=>fixture.validate(w));
 }
 w=structuredClone(write);w.activityMapping={header:'大纲',column:4};w.keyColumns.activity=4;assert.throws(()=>fixture.validate(w),/重叠/);
 ok('连接器独立复核显式表头、列号和活动身份，拒绝漏传、过期和重叠字段');
 for(const replacement of ['新营销项目','活动']){
  const changed=headers.map((h,i)=>i===3?replacement:h),changedSheet={...sheet,headers:changed,map:refreshSheetMap(changed,sheet)};
  assert.equal(changedSheet.map.activity,-1);assert(activityMappingError(changedSheet));assert.equal(activityRowMatch(a,[a,b],[changedSheet],project).hits.length,0);
  assert.equal(activityMappingSheets(project,[a,b],[changedSheet]).length,1);
 }
 const duplicated={...sheet,headers:[...headers,' 营销项目 '],map:refreshSheetMap([...headers,' 营销项目 '],sheet)};
 assert(activityMappingError(duplicated));assert.deepEqual(activityColumns(duplicated),[]);
 fixture.control({headers:duplicated.headers});assert.throws(()=>fixture.validate(write),/活动列/);
 ok('已选列改名、删除或出现规范化重名时失效，不回退到旧匹配或另一自动列');
 fixture.control({reset:true});fixture.control({headers});
 const cols=[3,0,1,2,5,6,7,8,9,4],movedHeaders=cols.map(i=>headers[i]),movedRows=fixture.state().rows.map(r=>cols.map(i=>r[i]));
 fixture.control({headers:movedHeaders,rows:movedRows});
 const moved={...sheet,headers:movedHeaders,rows:movedRows,map:refreshSheetMap(movedHeaders,sheet)};
 assert.equal(moved.map.activity,0);assert.equal(moved.map.outline,9);assert.equal(rowKey(moved,0),rowKey(sheet,0));
 w={...write,column:9,...rowIdentity(moved,0)};assert.equal((await fixture.invoke({action:'write',url:'https://example.feishu.cn/sheets/book',sheetId:'s',writes:[w]})).written,1);
 assert.equal(fixture.state().writes[0].cell,'J2');ok('列移动按已确认表头重新定位，行身份不变并写入新阶段地址');
 fixture.control({reset:true});fixture.control({headers,changeActivity:true,activityHeader:'营销项目'});
 const changedActivity=await fixture.invoke({action:'write',url:'https://example.feishu.cn/sheets/book',sheetId:'s',writes:[write]});assert.equal(changedActivity.rejected,1);assert.equal(fixture.state().writes.length,0);
 ok('写前活动单元格变化时拒绝派发，避免写到另一活动');
 fixture.control({reset:true});fixture.control({headers,lost:true});
 assert.equal((await fixture.invoke({action:'write',url:'https://example.feishu.cn/sheets/book',sheetId:'s',writes:[write]})).uncertain,1);
 assert.equal((await fixture.invoke({action:'write',url:'https://example.feishu.cn/sheets/book',sheetId:'s',writes:[write]})).written,1);assert.equal(fixture.state().writes.length,1);
 ok('自定义活动写入响应丢失后只读核对恢复，不重复写入');
 const doubleHeaders=[...headers,'活动名称'],double={...sheet,headers:doubleHeaders,rows:sheet.rows.map(r=>[...r,'其他活动']),map:{...autoMap(doubleHeaders),activity:3}};
 assert.equal(activityRowMatch(a,[a,b],[double],project).hits[0].row,0);
 fixture.control({reset:true,headers:doubleHeaders,rows:double.rows});assert.equal(fixture.validate({...write,...rowIdentity(double,0)}).physicalRow,2);
 ok('存在多个不同活动表头时，显式选择生效且仍核对所选活动值');
 const duplicateName={...project,activities:[...project.activities,{id:'c',name:'秋季活动'}]};assert.equal(activityRowMatch(a,[a,b],[sheet],duplicateName).hits.length,0);
 for(const value of ['', '未知活动'])assert.equal(activityRowMatch(a,[a,b],[{...sheet,rows:[sheet.rows[0].map((x,i)=>i===3?value:x)]}],project).hits.length,0);
 ok('选列不能绕过空白活动、未知活动或重名活动保护');
 if(process.env.ZHIGAO_VERIFY_OUT){fs.mkdirSync(process.env.ZHIGAO_VERIFY_OUT,{recursive:true});fs.writeFileSync(path.join(process.env.ZHIGAO_VERIFY_OUT,'result.json'),JSON.stringify({ok:true,checks},null,2));}
}finally{fs.rmSync(home,{recursive:true,force:true});}
