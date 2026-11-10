import {aiPrompt,parseAI,fingerprint} from './engine.js';
import {reviewBlocks,reviewError} from './review-protocol.js';
import {reviewNotes,effectiveRules} from './brand.js';
import {flowOf} from './model.js';
export const REVIEW_LEASE_MS=15*60*1000;
export const BATCH_STATES={queued:'排队中',reviewing:'审稿中',pending:'待确认',partial:'审核未完成',failed:'失败',interrupted:'已中断',skipped:'已跳过'};
export const canDeepReview=t=>!t.reviewReadError&&!!t.cells?.length&&!['pdf','video'].includes(t.fmt);
const unfinished=e=>['queued','reviewing','failed','interrupted'].includes(e.status);
const now=()=>new Date().toISOString(),uid=()=>crypto.randomUUID(),copy=x=>structuredClone(x);
const resultText=v=>JSON.stringify(typeof v==='string'?JSON.parse(v.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')):v);
const fail=(code,message,details={})=>{throw reviewError(code,message,details);};
export function batchSummary(b){
 const entries=b.entries.map(({basis,reviewToken,sessionId,submissionResult,...e})=>copy(e));
 const counts=Object.fromEntries(Object.keys(BATCH_STATES).map(s=>[s,entries.filter(e=>e.status===s).length]));
 const unknown=entries.filter(e=>e.status==='pending'&&!e.coverage?.reported).length;
 return {id:b.id,projectId:b.projectId,projectName:b.projectName,created:b.created,updated:b.updated,entries,counts,
  finished:!entries.some(e=>['queued','reviewing'].includes(e.status)),success:entries.filter(e=>e.status==='pending'&&e.coverage?.complete).length,
  submitted:counts.pending+counts.partial,partial:counts.partial,coverageUnreported:unknown,needsAttention:counts.partial+unknown+counts.failed+counts.interrupted,
  failed:counts.failed,interrupted:counts.interrupted,skipped:counts.skipped,location:'审稿工作台 → 稿件列表 → 审稿详情',
  next:'逐份获取指令并完整提交；校验失败用原凭据修正重交。结束核对 success、partial、coverageUnreported；审核未完成不计成功。补漏用 reopen_review，再提交完整替换结果。'};
}
export function createReviewService(ctx){
 const sessionId=uid(),S=()=>ctx.state(),singles=new Map();let queue=Promise.resolve();
 const project=id=>{const p=S().settings.projects.find(p=>p.id===id);if(!p)fail('PROJECT_NOT_FOUND','稿件所属项目不存在。');return p;};
 const doc=id=>{const t=S().tasks.find(t=>t.id===id);if(!t)fail('DOC_NOT_FOUND','找不到稿件，请先列出任务取得 docId。');return t;};
 const batch=id=>{const b=(S().batches||[]).find(b=>b.id===id);if(!b)fail('BATCH_NOT_FOUND','找不到审稿批次。');return b;};
 const entry=(b,id)=>{const e=b.entries.find(e=>e.docId===id);if(!e)fail('DOC_NOT_IN_BATCH','稿件不在这个批次中。');return e;};
 const basis=t=>{const p=project(t.projectId);return JSON.stringify({projectId:p.id,round:flowOf(t).round,stage:t.stage,platform:t.platform,kind:t.kind,notes:reviewNotes({...t,notes:p.notes||''},p),rules:effectiveRules(p),cells:t.cells.map(c=>({id:c.id,current:c.current,note:c.note||''}))});};
 const checkDoc=t=>{if(project(t.projectId).status==='ended')fail('PROJECT_ENDED','项目已结束，不接受 AI 审稿。');if(!canDeepReview(t))fail('UNSUPPORTED_DOCUMENT','这份稿件不支持 AI 审稿（PDF、视频或没有可读取文字）。');};
 async function persist(b){b.updated=now();await ctx.saveBatch(b);return b;}
 function newLease(t,rereview=false){return {status:'reviewing',reviewToken:uid(),sessionId,startedAt:now(),leaseExpiresAt:new Date(Date.now()+REVIEW_LEASE_MS).toISOString(),basis:basis(t),snapshot:fingerprint(t.cells),round:flowOf(t).round,rereview,reason:''};}
 async function recover(){
  for(const old of [...(S().batches||[])]){const b=copy(old);let changed=false;
   for(const e of b.entries){if(!unfinished(e))continue;const t=S().tasks.find(t=>t.id===e.docId),p=S().settings.projects.find(p=>p.id===b.projectId);
    if(!t||!p||p.status==='ended'||t.projectId!==b.projectId||(t.ai&&!t.fullReviewPending&&!e.rereview)||flowOf(t).state!=='review'||flowOf(t).round!==e.round||!canDeepReview(t)||fingerprint(t.cells)!==e.snapshot){Object.assign(e,{status:'skipped',reason:'稿件或项目已移除、已修改或进入其他轮次／状态，请重新获取指令。',errorCode:'DOCUMENT_CHANGED'});delete e.basis;delete e.reviewToken;changed=true;}
    else if(e.status==='reviewing'&&(e.sessionId!==sessionId||Date.now()>=Date.parse(e.leaseExpiresAt||new Date(Date.parse(e.startedAt)+REVIEW_LEASE_MS).toISOString()))){Object.assign(e,{status:'interrupted',errorCode:e.sessionId!==sessionId?'SESSION_CHANGED':'TOKEN_EXPIRED',reason:e.sessionId!==sessionId?'页面会话已变化，请重新获取指令后续审。':'审稿租约已到期，请用 retry:true 重新获取指令。'});delete e.basis;changed=true;}
   }if(changed)await persist(b);
  }
 }
 function leaseFor(t,batchId){if(batchId){const b=copy(batch(batchId));if(b.projectId!==t.projectId)fail('PROJECT_MISMATCH','稿件不属于批次锁定的项目。');return {b,e:entry(b,t.id)};}return {b:null,e:singles.get(t.id)};}
 function checkLease(t,e,reviewToken){
  if(!e)fail('BRIEF_REQUIRED','请先获取这份稿件的审稿指令。');
  if(!reviewToken||reviewToken!==e.reviewToken)fail('TOKEN_MISMATCH','审稿凭据与这份稿件不匹配；请使用该 docId 的 brief 返回值。',{docId:t.id,status:e.status});
  if(e.errorCode==='SESSION_CHANGED'||e.sessionId!==sessionId)fail('SESSION_CHANGED','页面会话已变化，请用 retry:true 重新获取指令。',{docId:t.id});
  if(e.status==='interrupted'&&e.errorCode==='TOKEN_EXPIRED'||Date.now()>=Date.parse(e.leaseExpiresAt))fail('TOKEN_EXPIRED','审稿租约已到期，请用 retry:true 重新获取指令。',{docId:t.id,leaseExpiresAt:e.leaseExpiresAt});
  if(e.status!=='reviewing')fail('REVIEW_NOT_ACTIVE',`这份稿件当前状态为 ${e.status}，请重新获取指令。`,{docId:t.id,status:e.status});
  if(flowOf(t).state!=='review'||basis(t)!==e.basis)fail('BASIS_CHANGED','稿件或审稿依据已变化，请用 retry:true 重新获取指令。',{docId:t.id});
 }
 async function brief({docId,batchId,retry=false,rereview=false}){
  await recover();const t=doc(docId);checkDoc(t);if(flowOf(t).state!=='review')fail('WRONG_FLOW','当前稿件不在内部审核阶段。');
  const active=(S().batches||[]).find(b=>b.id!==batchId&&b.entries.some(e=>e.docId===docId&&['queued','reviewing'].includes(e.status)));if(active)fail('BATCH_REQUIRED','这份稿件已进入另一个批次，请使用返回的 batchId。',{batchId:active.id});
  let {b,e}=leaseFor(t,batchId),reused=false;
  if(e?.status==='reviewing'&&e.sessionId===sessionId&&Date.now()<Date.parse(e.leaseExpiresAt)&&e.basis===basis(t))reused=true;
  else{
   if(t.ai&&!t.fullReviewPending&&!rereview&&!e?.rereview)fail('REREVIEW_REQUIRED','这份稿件已有结果；补漏或重审请调用 zhigao_reopen_review。');
   if(e&&['failed','interrupted','reviewing','skipped'].includes(e.status)&&!retry&&!rereview)fail('RETRY_REQUIRED','重新领取需 retry:true。',{status:e.status});
   const fresh=newLease(t,rereview||!!e?.rereview);if(b){Object.assign(e,fresh);delete e.errorCode;await persist(b);}else{e=fresh;singles.set(t.id,e);}
  }
  const p=project(t.projectId);return {protocolVersion:'1.7.0',docId:t.id,...(batchId?{batchId}:{}),reviewToken:e.reviewToken,snapshot:e.snapshot,leaseExpiresAt:e.leaseExpiresAt,leaseDurationMs:REVIEW_LEASE_MS,reused,blocks:reviewBlocks(t),instruction:aiPrompt(t,reviewNotes({...t,notes:p.notes||''},p)),
   ...(e.rereview&&t.ai?{previousResult:{changes:t.ai.changes,warnings:t.ai.warnings,coverage:t.ai.coverage},replacement:'本次完整替换旧建议。保留仍有效的旧建议并补齐遗漏，旧结果在成功提交后进入历史。'}:{}),
   howToSubmit:'使用返回的 snapshot、reviewToken 和 docId，一次提交完整结果。支持 patches、reviewedIds、blockingWarnings 和 dryRun:true；校验失败不消费凭据。到期前可 renew_review，放弃用 release_review，补漏用 reopen_review。'};
 }
 const api={recover,exclusive:fn=>fn(),
  async zhigao_create_review_batch({docIds}={}){
   await recover();const p=project(S().settings.selected);if(p.status==='ended')fail('PROJECT_ENDED','当前项目已结束。');
   if(docIds!==undefined&&(!Array.isArray(docIds)||!docIds.length||docIds.some(id=>typeof id!=='string')))fail('INVALID_DOC_IDS','docIds 须为非空稿件 ID 数组。');
   const docs=docIds?[...new Set(docIds)].map(doc):S().tasks.filter(t=>t.projectId===p.id&&(!t.ai||t.fullReviewPending)&&flowOf(t).state==='review');
   if(docs.some(t=>t.projectId!==p.id))fail('PROJECT_MISMATCH','只能为当前项目建立批次。');
   const existing=(S().batches||[]).find(b=>b.projectId===p.id&&b.entries.some(unfinished)&&docs.every(t=>b.entries.some(e=>e.docId===t.id&&e.round===flowOf(t).round))&&b.entries.filter(unfinished).every(e=>docs.some(t=>t.id===e.docId&&flowOf(t).round===e.round)));
   if(existing)return {...batchSummary(existing),reused:true};
   const overlaps=(S().batches||[]).filter(b=>b.projectId===p.id&&b.entries.some(e=>unfinished(e)&&docs.some(t=>t.id===e.docId&&flowOf(t).round===e.round)));
   if(overlaps.some(b=>b.entries.some(e=>e.status==='reviewing')))fail('REVIEW_BUSY','部分稿件正在审稿，请等本批完成后再加入新稿。');
   for(const old of overlaps){const prior=copy(old);for(const e of prior.entries)if(unfinished(e)&&docs.some(t=>t.id===e.docId)){Object.assign(e,{status:'skipped',reason:'已并入新的上传批次。'});delete e.reviewToken;delete e.basis;}await persist(prior);}
   const b={id:uid(),projectId:p.id,projectName:p.name,created:now(),entries:docs.map(t=>{const reason=t.ai&&!t.fullReviewPending?'已有 AI 审稿结果，补漏请调用 reopen_review。':flowOf(t).state!=='review'?'当前不是待审稿件。':!canDeepReview(t)?'不支持 AI 审稿。':'';return {docId:t.id,author:t.author||'',stage:t.stage,round:flowOf(t).round,snapshot:canDeepReview(t)?fingerprint(t.cells):null,status:reason?'skipped':'queued',reason};})};await persist(b);return batchSummary(b);
  },
  async zhigao_get_review_batch({batchId}={}){await recover();return batchId?batchSummary(batch(batchId)):(S().batches||[]).filter(b=>b.projectId===S().settings.selected).map(batchSummary);},
  zhigao_get_review_brief:brief,
  async zhigao_reopen_review({docId,batchId}){const t=doc(docId);if(!batchId){const related=(S().batches||[]).filter(b=>b.projectId===t.projectId&&b.entries.some(e=>e.docId===docId&&e.round===flowOf(t).round));batchId=(related.find(b=>b.entries.some(e=>e.docId===docId&&['queued','reviewing'].includes(e.status)))||related.find(b=>b.id===t.ai?.batchId)||related.sort((a,b)=>String(b.created).localeCompare(String(a.created)))[0])?.id;}return brief({docId,batchId,retry:true,rereview:true});},
  async zhigao_renew_review({docId,batchId,reviewToken}){const t=doc(docId);checkDoc(t);const {b,e}=leaseFor(t,batchId);checkLease(t,e,reviewToken);e.leaseExpiresAt=new Date(Date.now()+REVIEW_LEASE_MS).toISOString();if(b)await persist(b);return {ok:true,docId,leaseExpiresAt:e.leaseExpiresAt};},
  async zhigao_release_review({docId,batchId,reviewToken,reason}){const t=doc(docId),{b,e}=leaseFor(t,batchId);if(!e||!reviewToken||reviewToken!==e.reviewToken||e.status!=='reviewing')fail('TOKEN_MISMATCH','这份稿件没有匹配的进行中审稿。');Object.assign(e,{status:'interrupted',reason:String(reason||'已主动释放，可重新获取指令。'),errorCode:'LEASE_RELEASED'});delete e.basis;if(b)await persist(b);else singles.delete(docId);return {ok:true,docId,status:'interrupted'};},
  async zhigao_fail_review({batchId,docId,reviewToken,reason}){const b=copy(batch(batchId)),e=entry(b,docId);if(!reviewToken||e.reviewToken!==reviewToken||!['reviewing','interrupted'].includes(e.status))fail('TOKEN_MISMATCH','凭据不匹配或这份审稿已结束。');Object.assign(e,{status:'failed',reason:String(reason||'客户端审稿失败').slice(0,1000)});delete e.basis;await persist(b);return {ok:true,docId,status:'failed',reason:e.reason};},
  async zhigao_submit_review({docId,result,batchId,reviewToken,rereview=false,dryRun=false}){
   const t=doc(docId);checkDoc(t);const {b,e}=leaseFor(t,batchId);let raw;
   try{raw=resultText(result);}catch{fail('INVALID_JSON','审稿结果不是有效 JSON；凭据仍可用。');}
   reviewToken=reviewToken||(!batchId?e?.reviewToken:undefined);
   if(e&&['pending','partial'].includes(e.status)&&reviewToken===e.reviewToken&&t.ai?.reviewToken===reviewToken){
    if(raw!==t.ai.submissionResult)fail('RESULT_ALREADY_COMMITTED','同一审稿凭据不能提交不同结果；补漏请调用 zhigao_reopen_review。',{docId,batchId});
    if(!dryRun&&['failed','waiting','saving'].includes(t.ai.archive?.state)&&!t.ai.saved?.path)try{await ctx.saveAIDraft?.(t);}catch{}
    return {ok:true,duplicate:true,imported:t.ai.changes.length,warnings:t.ai.warnings.length,coverage:t.ai.coverage,needsSupplement:t.ai.needsSupplement,savedPath:t.ai.saved?.path||null};
   }
   checkLease(t,e,reviewToken);
   if(t.ai&&!t.fullReviewPending&&!rereview&&!e.rereview)fail('REREVIEW_REQUIRED','已有 AI 结果，补漏请先 reopen_review。');
   let parsed;try{parsed=parseAI(raw,t);}catch(error){if(error.code)throw error;fail('INVALID_RESULT',error.message);}
   if(dryRun)return {ok:true,validated:true,imported:0,changes:parsed.changes.length,coverage:parsed.coverage,needsSupplement:parsed.needsSupplement,leaseExpiresAt:e.leaseExpiresAt};
   const ai={...parsed,at:now(),submissionResult:raw,reviewToken,...(batchId?{batchId}:{})},updated={...t,ai,fullReviewPending:false,updated:now()};
   if(t.ai)updated.aiHistory=[...(t.aiHistory||[]),copy(t.ai)];
   const completed={...e,status:ai.needsSupplement?'partial':'pending',completedAt:ai.at,reason:ai.needsSupplement?'全文未审完或仍有未落实的修改，请继续审核。':'',imported:ai.changes.length,warnings:ai.warnings.length,blockingWarnings:ai.blockingWarnings.length,coverage:copy(ai.coverage)};delete completed.basis;
   if(b){Object.assign(e,completed);delete e.basis;b.updated=now();}
   try{await ctx.commitReview(updated,b);}catch(error){fail('PERSIST_FAILED','审稿结果未保存，凭据仍可重试。',{cause:error.message});}
   if(!batchId)singles.set(docId,completed);
   const saved=doc(docId);let savedPath=null,archiveError=null;try{savedPath=await ctx.saveAIDraft?.(saved)||null;}catch(error){archiveError=String(error.message||error);}
   return {ok:true,status:completed.status,imported:ai.changes.length,warnings:ai.warnings.length,coverage:ai.coverage,needsSupplement:ai.needsSupplement,savedPath,archiveError,message:`已保存 ${ai.changes.length} 条待确认建议、${ai.warnings.length} 条提醒。${ai.needsSupplement?'本稿审核未完成，请继续审核。':'全文已审，待人工复核。'}`};
  }
 };
 // UI 和 MCP 并发操作串行保存，避免旧批次副本覆盖另一份稿件的凭据。
 return {...Object.fromEntries(Object.entries(api).map(([name,fn])=>[name,(...args)=>{const run=queue.then(()=>fn(...args));queue=run.catch(()=>{});return run;}])),forget:ids=>{for(const id of ids)singles.delete(id);}};
}
