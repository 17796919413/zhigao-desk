import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReviewService,batchSummary} from '../review-service.js';
import {buildBasisManifest,digest} from '../review-assurance.js';
import {docFeedbackText} from '../brand.js';
import {planProjectImport} from '../project-data.js';
import {reviewToolResult} from '../zhigao-connector.mjs';
const checks=[];function ok(name){checks.push(name);console.log('PASS '+name);}
function fixture(){
 const p={id:'A',name:'Brand A',status:'active',date:'2026-11-10',notes:'Review carefully',library:[{id:'l1',title:'Brief',kind:'Brief',text:'Approved brand data',active:true}],rules:[{id:'r1',type:'custom',title:'No BANNED',enabled:true,find:'BANNED',replace:'ALLOWED',action:'replace',description:'Replace BANNED with ALLOWED'}]};
 const t={id:'d1',projectId:'A',projectName:'Brand A',fmt:'text',kind:'图文',platform:'test',stage:'初稿',cells:[{id:'p1',original:'BANNED',current:'BANNED'}],flow:{state:'review',round:1,feedback:[],submissions:[],log:[]}};
 const state={settings:{selected:'A',projects:[p,{id:'B',name:'Brand B',status:'active',notes:'B_ONLY',library:[],rules:[]}]},tasks:[t],batches:[]};
 let commits=0;
 const service=createReviewService({state:()=>state,saveBatch:async b=>{state.batches=state.batches.filter(x=>x.id!==b.id).concat(b);},commitReview:async(x,b)=>{commits++;Object.assign(t,x);if(b)state.batches=state.batches.filter(v=>v.id!==b.id).concat(b);}});
 return {p,t,state,service,get commits(){return commits;}};
}
async function response(f,brief){const m=await buildBasisManifest(f.t,f.p);return {snapshot:brief.snapshot,basis:brief.basis,reviewedIds:brief.blocks.map(b=>b.id),patches:[{cellId:'p1',find:'BANNED',replace:'ALLOWED',reason:'Explicit current rule'}],ruleChecks:[{id:'r1',status:'issue',reason:'Corrected prohibited phrase',evidence:[{blockId:'p1',quote:'BANNED'}]}],sourceChecks:m.sources.map(s=>({id:s.id,status:'checked',quote:s.text,reason:'Read complete source'})),mediaChecks:[],warnings:[],blockingWarnings:[]};}
const send=(f,b,r,extra={})=>f.service.zhigao_submit_review({docId:f.t.id,reviewToken:b.reviewToken,result:r,dryRun:true,...extra});
assert.equal(await digest('abc'),createHash('sha256').update('abc').digest('hex'));ok('Basis SHA256 matches standard implementation');
let f=fixture(),b=await f.service.zhigao_get_review_brief({docId:'d1'}),r=await response(f,b);
let out=await send(f,b,r);assert(out.coverage.complete);assert.equal(f.commits,0);ok('Complete evidence validates in dry run without persisting');
out=await send(f,b,{snapshot:b.snapshot,reviewedIds:['p1']});assert(!out.coverage.complete&&out.assurance.blockingWarnings.length);ok('Self-reported full text does not imply complete brand review');
out=await send(f,b,{...r,patches:[],ruleChecks:[{id:'r1',status:'not_applicable',reason:'No issue'}]});assert(!out.coverage.complete&&out.assurance.mechanicalFindings.length);ok('Known prohibited phrase cannot be dismissed as not applicable');
out=await send(f,b,{...r,sourceChecks:[]});assert(!out.coverage.complete);ok('Omitted source prevents complete result');
out=await send(f,b,{...r,ruleChecks:[{...r.ruleChecks[0],evidence:[{blockId:'fake',quote:'BANNED'}]}]});assert(!out.coverage.complete);ok('Fabricated evidence location is rejected');
await assert.rejects(send(f,b,{...r,basis:{...r.basis,projectId:'B'}}),e=>e.code==='BASIS_MISMATCH');ok('Other brand basis is rejected');
f.state.settings.selected='B';await assert.rejects(send(f,b,r),e=>e.code==='PROJECT_MISMATCH');await assert.rejects(f.service.zhigao_get_review_brief({docId:'d1'}),e=>e.code==='PROJECT_MISMATCH');ok('Brand switch blocks stale reads and submissions');f.state.settings.selected='A';
f.p.library[0].text+=' changed';await assert.rejects(send(f,b,r),e=>e.code==='BASIS_CHANGED');ok('Source change invalidates issued lease');
f=fixture();f.p.library=[];f.p.rules=[];f.p.notes='Generic editing guidance';b=await f.service.zhigao_get_review_brief({docId:'d1'});r=await response(f,b);r.ruleChecks=[];r.patches=[];out=await send(f,b,r);assert(!out.coverage.complete);ok('Generic notes alone are not brand authority');
const long='x'.repeat(7000)+'TAIL_REQUIREMENT';assert(docFeedbackText({flow:{feedback:[{round:1,text:long}]}}).includes('TAIL_REQUIREMENT'));ok('Long feedback tail remains in review basis');
f=fixture();const batch=await f.service.zhigao_create_review_batch();b=await f.service.zhigao_get_review_brief({docId:'d1',batchId:batch.id});r=await response(f,b);out=await send(f,b,r,{batchId:batch.id,dryRun:false});assert.equal(out.status,'pending');assert.equal((await f.service.zhigao_get_review_batch({batchId:batch.id})).success,1);ok('Batch success requires complete assurance');
assert.equal(batchSummary({entries:[{status:'skipped'},{status:'pending',coverage:{complete:true}}]}).complete,false);assert.equal(batchSummary({entries:[{status:'skipped'}]}).needsAttention,1);ok('Skipped and legacy-only coverage are not successful batches');
const source={id:'a',name:'Same',notes:'NEW',rules:[],library:[]},existing={...source,notes:'OLD'};
let plan=planProjectImport([existing],[source],()=> 'new');assert.equal(plan.mapping.get('a'),'new');assert.equal(plan.projects[0].notes,'OLD');assert.equal(plan.projects[1].notes,'NEW');ok('Conflicting project versions preserved separately');
plan=planProjectImport([existing],[{...source,id:'b'}]);assert.equal(plan.mapping.get('b'),'b');assert.equal(plan.projects.length,2);ok('Same name does not merge different project identities');
plan=planProjectImport([source],[source]);assert.equal(plan.projects.length,1);ok('Same identity and source version reuse project');
const image=reviewToolResult('zhigao_read_review_asset',{type:'image',mimeType:'image/png',data:'YWJj',assetId:'i',receipt:'r'});assert.equal(image.content[1].type,'image');assert(!image.content[0].text.includes('YWJj'));assert.throws(()=>reviewToolResult('zhigao_read_review_asset',{type:'image',mimeType:'image/svg+xml',data:'YWJj'}));ok('Connector emits native image content and rejects invalid image formats');
f=fixture();f.t.fmt='video';f.t.cells=[];f.t.filename='sample.webm';f.t.duration=2;f.t.size=100;b=await f.service.zhigao_get_review_brief({docId:'d1'});const m=await buildBasisManifest(f.t,f.p);out=await send(f,b,{snapshot:b.snapshot,basis:b.basis,reviewedIds:[],sourceChecks:m.sources.map(s=>({id:s.id,status:'checked',quote:s.text,reason:'read'})),ruleChecks:[],mediaChecks:[]});assert(!out.coverage.complete);assert(b.media.assets.some(a=>a.type==='audio'));ok('Video and missing audio cannot be certified complete');
console.log(JSON.stringify({total:checks.length,checks},null,2));
