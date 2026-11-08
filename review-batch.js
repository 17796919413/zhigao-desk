// MCP 审稿与批次：只提交待确认结果；不采纳、不推进品牌状态、不写飞书。
import {aiPrompt,parseAI,fingerprint} from './engine.js';
import {reviewNotes,effectiveRules} from './brand.js';
import {flowOf} from './model.js';

export const REVIEW_LEASE_MS=15*60*1000;
export const BATCH_STATES={queued:'排队中',reviewing:'审稿中',pending:'待确认',failed:'失败',interrupted:'已中断',skipped:'已跳过'};
export const canDeepReview=t=>!t.reviewReadError&&!!t.cells?.length&&!['pdf','video'].includes(t.fmt);
const unfinished=e=>['queued','reviewing','failed','interrupted'].includes(e.status);
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID();
const copy=x=>structuredClone(x);
const resultText=v=>JSON.stringify(typeof v==='string'?JSON.parse(v.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')):v);
export function batchSummary(b){
 const counts=Object.fromEntries(Object.keys(BATCH_STATES).map(s=>[s,b.entries.filter(e=>e.status===s).length]));
 return {...copy(b),counts,finished:!b.entries.some(e=>['queued','reviewing'].includes(e.status)),
  success:counts.pending,failed:counts.failed,interrupted:counts.interrupted,skipped:counts.skipped,
  location:'审稿工作台 → 稿件列表 → 审稿详情',
  next:'逐份调用 zhigao_get_review_brief({docId,batchId})，提交时带回 reviewToken。失败后继续其他排队稿件；重试失败或中断稿件时取指令传 retry:true。结束用 zhigao_get_review_batch 核对完成、失败、中断和跳过数。'};
}

export function createReviewService(ctx){
 const sessionId=uid(),S=()=>ctx.state(),singleBasis=new Map();
 const project=id=>{const p=S().settings.projects.find(p=>p.id===id);if(!p)throw Error('稿件所属项目不存在。');return p;};
 const doc=id=>{const t=S().tasks.find(t=>t.id===id);if(!t)throw Error('找不到稿件，请先列出任务取得 docId。');return t;};
 const batch=id=>{const b=(S().batches||[]).find(b=>b.id===id);if(!b)throw Error('找不到审稿批次。');return b;};
 const entry=(b,id)=>{const e=b.entries.find(e=>e.docId===id);if(!e)throw Error('稿件不在这个批次中。');return e;};
 const basis=t=>{const p=project(t.projectId);return JSON.stringify({projectId:p.id,round:flowOf(t).round,stage:t.stage,platform:t.platform,kind:t.kind,
  notes:reviewNotes({...t,notes:p.notes||''},p),rules:effectiveRules(p),cells:t.cells.map(c=>({id:c.id,current:c.current,note:c.note||''}))});};
 const checkDoc=t=>{const p=project(t.projectId);if(p.status==='ended')throw Error('项目已结束，不接受 AI 审稿。');
  if(!canDeepReview(t))throw Error('这份稿件不支持 AI 审稿（PDF、视频或没有可读取文字）。');};
 async function persist(b){b.updated=now();await ctx.saveBatch(b);return b;}
 async function recover(){
  for(const old of [...(S().batches||[])]){
   const b=copy(old);let changed=false;
   for(const e of b.entries){
    if(!unfinished(e))continue;
    const t=S().tasks.find(t=>t.id===e.docId),p=S().settings.projects.find(p=>p.id===b.projectId);
    if(!t||!p||p.status==='ended'||t.projectId!==b.projectId||(t.ai&&!t.fullReviewPending)||flowOf(t).state!=='review'||flowOf(t).round!==e.round||!canDeepReview(t)||fingerprint(t.cells)!==e.snapshot){
     Object.assign(e,{status:'skipped',reason:'稿件或项目已移除、已审阅、已修改或进入其他轮次／状态，请另建批次。',reviewToken:null});changed=true;
    }else if(e.status==='reviewing'&&(e.sessionId!==sessionId||Date.now()-Date.parse(e.startedAt)>=REVIEW_LEASE_MS)){
     Object.assign(e,{status:'interrupted',reason:e.sessionId!==sessionId?'页面会话已变化，请重新获取指令后续审。':'审稿超过 15 分钟未提交，请重新获取指令后续审。',reviewToken:null});changed=true;
    }
   }
   if(changed)await persist(b);
  }
 }
 async function markFailure(batchId,docId,reviewToken,reason){
  const b=copy(batch(batchId)),e=entry(b,docId);
  if(e.status!=='reviewing'||!reviewToken||e.reviewToken!==reviewToken)throw Error('审稿凭据已失效，请查询批次并重新获取指令。');
  Object.assign(e,{status:'failed',reason:String(reason||'客户端审稿失败').slice(0,1000),reviewToken:null});await persist(b);
 }
 return {
  recover,
  async zhigao_create_review_batch({docIds}={}){
   await recover();const p=project(S().settings.selected);if(p.status==='ended')throw Error('当前项目已结束，请选择正在执行的品牌项目。');
   if(docIds!==undefined&&(!Array.isArray(docIds)||!docIds.length||docIds.some(id=>typeof id!=='string')))throw Error('docIds 须为非空稿件 ID 数组。');
   const docs=docIds?[...new Set(docIds)].map(doc):S().tasks.filter(t=>t.projectId===p.id&&(!t.ai||t.fullReviewPending)&&flowOf(t).state==='review');
   if(docs.some(t=>t.projectId!==p.id))throw Error('只能为当前选中项目建立批次，不能跨品牌。');
   const existing=(S().batches||[]).find(b=>b.projectId===p.id&&b.entries.some(unfinished)&&
    docs.every(t=>b.entries.some(e=>e.docId===t.id&&e.round===flowOf(t).round))&&b.entries.filter(unfinished).every(e=>docs.some(t=>t.id===e.docId&&flowOf(t).round===e.round)));
   if(existing)return {...batchSummary(existing),reused:true};
   if((S().batches||[]).some(b=>b.projectId===p.id&&b.entries.some(e=>unfinished(e)&&docs.some(t=>t.id===e.docId&&flowOf(t).round===e.round))))
    {
    const overlaps=(S().batches||[]).filter(b=>b.projectId===p.id&&b.entries.some(e=>unfinished(e)&&docs.some(t=>t.id===e.docId&&flowOf(t).round===e.round)));
    if(overlaps.some(b=>b.entries.some(e=>e.status==='reviewing')))throw Error('部分稿件正在审稿，请等本批完成后再加入新稿。');
    for(const old of overlaps){const prior=copy(old);for(const e of prior.entries)if(unfinished(e)&&docs.some(t=>t.id===e.docId)){e.status='skipped';e.reason='已并入新的上传批次。';e.reviewToken=null;}await persist(prior);}
   }
   const b={id:uid(),projectId:p.id,projectName:p.name,created:now(),updated:now(),entries:docs.map(t=>{
    const reason=t.ai&&!t.fullReviewPending?'已有 AI 审稿结果，不重复处理。':flowOf(t).state!=='review'?'当前不是待审稿件。':!canDeepReview(t)?'PDF、视频或没有可读取文字，不支持 AI 审稿。':'';
    return {docId:t.id,author:t.author||'',stage:t.stage,round:flowOf(t).round,snapshot:canDeepReview(t)?fingerprint(t.cells):null,
     status:reason?'skipped':'queued',reason};
   })};
   await persist(b);return batchSummary(b);
  },
  async zhigao_get_review_batch({batchId}={}){
   await recover();return batchId?batchSummary(batch(batchId)):(S().batches||[]).filter(b=>b.projectId===S().settings.selected).map(batchSummary);
  },
  async zhigao_fail_review({batchId,docId,reviewToken,reason}){
   await recover();await markFailure(batchId,docId,reviewToken,reason);return {ok:true,message:'已记录该稿失败，请继续其他排队稿件。',batch:batchSummary(batch(batchId))};
  },
  async zhigao_get_review_brief({docId,batchId,retry=false}){
   await recover();const t=doc(docId);checkDoc(t);const p=project(t.projectId);
   let reviewToken;
   if(batchId){const b=copy(batch(batchId)),e=entry(b,docId);
    if(b.projectId!==t.projectId)throw Error('稿件不属于批次锁定的品牌项目。');
    if(e.status==='reviewing')throw Error('这份稿件正在审稿，请勿重复领取；超时后可续审。');
    if(!['queued','failed','interrupted'].includes(e.status))throw Error(e.reason||'这份稿件已完成或已跳过。');
    if(e.status!=='queued'&&retry!==true)throw Error('重新审查失败或中断稿件需 retry:true。');
    if((t.ai&&!t.fullReviewPending)||flowOf(t).state!=='review'||flowOf(t).round!==e.round||fingerprint(t.cells)!==e.snapshot){
     Object.assign(e,{status:'skipped',reason:'稿件已被审阅、修改或进入其他轮次／状态，请另建批次。'});await persist(b);throw Error(e.reason);
    }
    reviewToken=uid();Object.assign(e,{status:'reviewing',reviewToken,sessionId,startedAt:now(),reason:'',basis:basis(t)});await persist(b);
   }
   if(!batchId)singleBasis.set(t.id,basis(t));
   return {docId:t.id,...(batchId?{batchId,reviewToken}:{}),instruction:aiPrompt(t,reviewNotes({...t,notes:p.notes||''},p)),
    howToSubmit:'按 instruction 审稿，调用 zhigao_submit_review({docId,result'+(batchId?',batchId,reviewToken':'')+'})；只提交待确认建议。客户端无法完成时调用 zhigao_fail_review 记录原因，然后继续其他稿件。'};
  },
  async zhigao_submit_review({docId,result,batchId,reviewToken,rereview=false}){
   await recover();const t=doc(docId);checkDoc(t);let b,e,raw;
   if(batchId){b=copy(batch(batchId));e=entry(b,docId);
    if(b.projectId!==t.projectId)throw Error('稿件已不属于这个批次。');
    if(e.status==='pending'&&reviewToken===e.reviewToken&&t.ai?.reviewToken===reviewToken){
     if(resultText(result)!==t.ai.submissionResult)throw Error('同一审稿凭据不能提交不同结果。');
     if(['failed','waiting','saving'].includes(t.ai.archive?.state)&&!t.ai.saved?.path)try{await ctx.saveAIDraft?.(t);}catch{}
     return {ok:true,duplicate:true,imported:t.ai.changes.length,warnings:t.ai.warnings.length,savedPath:t.ai.saved?.path||null,message:'这份结果已保存，未重复导入或另存。'};
    }
    if(e.status!=='reviewing'||!reviewToken||reviewToken!==e.reviewToken)throw Error('审稿凭据已失效，请重新获取指令。');
   }else if((S().batches||[]).some(b=>b.entries.some(e=>e.docId===docId&&['queued','reviewing'].includes(e.status))))throw Error('这份稿件已进入批次，请携带 batchId 和 reviewToken 提交。');
   try{
    if(t.ai&&!t.fullReviewPending&&rereview!==true)throw Error('已有 AI 审稿结果；明确要求重审时才可传 rereview:true，旧结果将保留在历史中。');
    if(e&&(flowOf(t).state!=='review'||basis(t)!==e.basis))throw Error('稿件或审稿依据已变化，请重新获取指令。');
    if(!batchId&&singleBasis.has(t.id)&&singleBasis.get(t.id)!==basis(t))throw Error('项目资料或最新口径已变化，请重新获取审稿指令。');
    raw=resultText(result);const ai={...parseAI(raw,t),at:now(),submissionResult:raw,...(batchId?{batchId,reviewToken}:{})};
    const updated={...t,ai,fullReviewPending:false,updated:now()};
    if(t.ai)updated.aiHistory=[...(t.aiHistory||[]),copy(t.ai)];
    if(e){Object.assign(e,{status:'pending',completedAt:ai.at,reason:'',imported:ai.changes.length,warnings:ai.warnings.length});delete e.basis;b.updated=now();}
    // 唯一完成点：结果和批次一起持久化成功后，才更新内存并返回成功。
    await ctx.commitReview(updated,b);
   }catch(error){if(batchId)await markFailure(batchId,docId,reviewToken,error.message);throw Error(`没有导入：${error.message}`);}
   const saved=doc(docId);let savedPath=null,archiveError=null;
   try{savedPath=await ctx.saveAIDraft?.(saved)||null;}catch(error){archiveError=String(error.message||error);}
   return {ok:true,imported:saved.ai.changes.length,warnings:saved.ai.warnings.length,savedPath,archiveError,
    message:`已保存 ${saved.ai.changes.length} 条待确认建议、${saved.ai.warnings.length} 条提醒。`+(savedPath?`AI修改版（未确认）已另存：${savedPath}`:'归档尚未完成，请查看工作台稿件旁的归档状态。')};
  }
 };
}
