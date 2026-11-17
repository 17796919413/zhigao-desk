import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reviewExecutionRows,validateExecutionRows} from '../feishu-workflow.js';
import {compareCell,dateISO,itemValues} from '../feishu.js';
import {parseReview} from '../review-protocol.js';
import {safeName} from '../folder.js';
import {itemProgress} from '../model.js';
import {matchUploadedCreator} from '../creator-match.js';
import {numericDisplay} from '../xlsx-values.js';
const results=[];
function check(id,run){try{run();results.push({id,passed:true});}catch(e){results.push({id,passed:false,error:e.stack});}}
check('R05',()=>{
 const it={id:'i',author:'合成达人',platform:'小红书',title:'【合成达人】小红书图文大纲v1'};
 assert.notEqual(matchUploadedCreator({filename:'【合成达人】小红书图文大纲-另一款产品.txt',cells:[]},[it]).status,'matched');
 assert.equal(matchUploadedCreator({filename:'【合成达人】小红书图文大纲v2.txt',cells:[]},[it]).status,'matched');
 assert.notEqual(matchUploadedCreator({filename:'【合成达人】小红书图文大纲-产品甲升级.txt',cells:[]},[{...it,title:'产品甲'}]).status,'matched');
 assert.notEqual(matchUploadedCreator({filename:'【合成达人】小红书图文大纲v2.txt',cells:[{current:'合作产品：产品乙'}]},[{...it,title:'产品甲'}]).status,'matched');
});
check('R06',()=>{
 const docs=[{id:'old',stage:'大纲',created:'2026-01-01',updated:'2099',flow:{round:1,state:'passed'}},{id:'new',stage:'大纲',created:'2026-01-02',updated:'2026',flow:{round:2,state:'review'}}];
 assert.equal(itemProgress({kind:'图文'},docs).doc?.id,'new');assert.equal(itemValues({kind:'图文'},docs).outline,'');
});
check('R11',()=>{
 const rows=['产品甲','产品乙'].map(product=>({author:'合成达人',platform:'小红书',kind:'图文',product}));
 assert.equal(validateExecutionRows(rows).length,2);assert.equal(reviewExecutionRows(rows,structuredClone(rows)).length,2);
});
check('R12',()=>{assert.equal(compareCell('date','2025-11-13','2026-11-13').status,'conflict');assert.equal(dateISO('2026-02-31'),'');assert.equal(dateISO('2024-02-29'),'2024-02-29');assert.equal(dateISO('2025-02-29'),'');});
check('R13',()=>{const n=safeName('合成名称'.repeat(35)+'.docx',120);assert.ok(n.endsWith('.docx'));assert.ok(n.length<=120);});
check('R14',()=>{const text='甲'.repeat(30001),t={fmt:'text',cells:[{id:'p1',current:text}]};const r=parseReview({snapshot:'s',patches:[{cellId:'p1',find:'甲',occurrence:1,replace:'乙'}],reviewedIds:['p1']},t,'s');assert.equal(r.changes[0].revised,'乙'+text.slice(1));});
check('R15',()=>{assert.ok(!itemValues({kind:'图文'},[{stage:'大纲',updated:'2026',flow:{state:'review'},fullReviewPending:true,ai:{needsSupplement:false,changes:[],assurance:{complete:true}}}]).outline.includes('AI已审'));});
check('R11-stable-identity',()=>{const rows=['a','b'].map((rowId,i)=>({rowId,author:'达人',platform:'小红书',kind:'图文',product:'产品'+i}));const r=reviewExecutionRows(rows,[{...rows[1],product:'更正乙'},{...rows[0],product:'更正甲'}]);assert.equal(r[0].rowId,'b');assert.equal(r[1].rowId,'a');assert.throws(()=>reviewExecutionRows(rows,[rows[0],rows[0]]));assert.throws(()=>reviewExecutionRows(rows,[{...rows[0],author:'别人'},rows[1]]));});
check('R12-date-boundaries',()=>{assert.equal(dateISO('2026-13-01'),'');assert.equal(dateISO('2026-04-31'),'');assert.equal(dateISO('11月13日',2026),'2026-11-13');assert.equal(compareCell('date','11/13','2026-11-13').status,'conflict');assert.equal(compareCell('date','','2026-02-31').status,'conflict');assert.equal(compareCell('date','2026/11/13','2026-11-13').status,'same');});
check('R13-unicode-reserved',()=>{for(const ext of ['.docx','.xlsx','.mp4']){const s=safeName('😀'.repeat(100)+ext,120);assert.ok(s.endsWith(ext));assert.ok(s.length<=120);assert.ok(!/[\uD800-\uDBFF]$/.test(s.slice(0,-ext.length)));}assert.equal(safeName('CON.docx',120),'_CON.docx');});
check('R14-patch-limits',()=>{const current='甲'.repeat(40000),task={cells:[{id:'p',current}]};assert.throws(()=>parseReview({snapshot:'s',changes:[{id:'p',original:current,revised:current+'乙'}]},task,'s'),e=>e.code==='INVALID_REVISED');assert.throws(()=>parseReview({snapshot:'s',patches:[{cellId:'p',find:'甲',replace:'乙乙',occurrence:'all'}]},task,'s'),e=>e.code==='INVALID_PATCH');assert.throws(()=>parseReview({snapshot:'s',patches:[{cellId:'p',find:'甲',replace:'乙',occurrence:1}]},{cells:[{id:'p',current,note:'只读'}]},'s'),e=>e.code==='BLOCK_READ_ONLY');});
check('R04-formatted-values',()=>{assert.equal(numericDisplay('0.25',10).text,'25.00%');assert.equal(numericDisplay('1',14).text,'01-01-00');assert.equal(numericDisplay('0',14,undefined,true).text,'01-01-04');assert.ok(numericDisplay('60',14).blocker);assert.ok(numericDisplay('123',164,'[Red][>10]0.0').blocker);assert.equal(numericDisplay('123',11).text,'1.23E+02');});
check('R04-native-excel-date-separators',()=>{
 assert.equal(numericDisplay('46342',164,String.raw`yyyy\-mm\-dd`).text,'2026-11-16');
 assert.equal(numericDisplay('46342.5',164,String.raw`yyyy\-mm\-dd hh\:mm`).text,'2026-11-16 12:00');
 assert.equal(numericDisplay('46342',164,'yyyy"-"mm"-"dd').text,'2026-11-16');
 assert.ok(numericDisplay('46342',164,String.raw`yyyy\mdd`).blocker);
 assert.ok(numericDisplay('60',164,String.raw`yyyy\-mm\-dd`).blocker);
 assert.ok(numericDisplay('46342',164,'[Red]yyyy-mm-dd').blocker);
 assert.ok(numericDisplay('12.5',164,String.raw`0\.00`).blocker);
 assert.ok(numericDisplay('12.5',164,'0"."00').blocker);
});
for(const r of results)console.log((r.passed?'PASS ':'FAIL ')+r.id+(r.error?' '+r.error:''));
if(process.env.ZHIGAO_VERIFY_OUT){fs.mkdirSync(process.env.ZHIGAO_VERIFY_OUT,{recursive:true});fs.writeFileSync(process.env.ZHIGAO_VERIFY_OUT+'/logic-results.json',JSON.stringify(results,null,2));}
if(results.some(r=>!r.passed))process.exitCode=1;
