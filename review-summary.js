import {esc} from './engine.js';
import {activityOf,activityRevision} from './activities.js';
// Internal completion checks stay out of the interface and exported opinions.
export const reviewScope=t=>JSON.stringify([t.projectId,t.itemId,t.author,t.platform,t.kind,t.stage,...(activityOf(t)==='legacy'?[]:[activityOf(t)])]);
export function reviewNeedsAttention(t,p){return !!t.ai&&(t.ai.needsSupplement||!t.ai.assurance?.complete||t.fullReviewPending||!!p&&t.ai.assurance.projectRevision!==activityRevision(p,activityOf(t))||!!t.ai.scope&&t.ai.scope!==reviewScope(t));}
export function reviewBasisImpact(t,p){
 const changed=t.ai?t.ai.assurance?.projectRevision!==activityRevision(p,activityOf(t)):t.ruleDate!==undefined&&t.ruleDate!==activityRevision(p,activityOf(t));
 if(!changed)return null;
 const f=t.flow||{},delivered=(f.submissions||[]).some(s=>s.round===(f.round||1))||['brand','revise','passed'].includes(f.state);
 return delivered?{state:'delivered',message:'依据已更新，已交品牌的结果可能受影响；是否重审由你决定。'}:t.ai?{state:'reviewed',message:'依据已更新，交付前需要复核；现有修改和归档保留。'}:{state:'reviewing',message:'依据已更新，继续审核时将重新核对最新资料。'};
}
export function reviewWarnings(t){
 const ai=t.ai;if(!ai)return [];
 const internal=new Set([...(ai.blockingWarnings||[]),...(ai.processingWarnings||[])]);
 const opinions=mediaOpinionEntries(t);
 return [...new Set((ai.warnings||[]).filter(w=>!internal.has(w)&&!opinions.some(x=>w===`${x.location}：${x.problem}`)))];
}
export function reviewFeedbackHtml(t){return reviewWarnings(t).map(w=>'<p>'+esc(w)+'</p>').join('');}
export function mediaOpinionEntries(t){
 const entries=[],seen=new Set(),add=x=>{if(typeof x.location!=='string'||!x.location.trim()||typeof x.problem!=='string'||!x.problem.trim())return;const key=JSON.stringify([x.location,x.problem]);if(!seen.has(key)){seen.add(key);entries.push(x);}};
 for(const x of t.ai?.mediaOpinions||[])if(x&&!/^(library|feedback):/.test(x.assetId||''))add(x);
 // Older reviews stored findings in assurance and their exact locations in warnings.
 // Recover only a known original asset; never guess a location from unbound prose.
 if(['pdf','image','video'].includes(t.fmt))for(const check of t.ai?.assurance?.mediaChecks||[]){
  if(check.status!=='reviewed'||!check.receipt||/^(library|feedback):/.test(check.assetId||''))continue;
  let location='';
  if(t.fmt==='image'&&check.assetId==='image:original')location='图片原件';
  if(t.fmt==='pdf'&&/^page:[1-9]\d*$/.test(check.assetId||'')){
   const n=Number(check.assetId.slice(5));
   if(t.pages?.some(p=>p.n===n))location=`PDF第${n}页`;
  }
  if(t.fmt==='video')location=t.videoAnalysis?.assets?.find(a=>a.id===check.assetId)?.location||'';
  if(!location)continue;
  for(const problem of check.findings||[])if(typeof problem==='string'&&(t.ai.warnings||[]).includes(`${location}：${problem}`))add({assetId:check.assetId,location,problem});
 }
 return entries;
}
export function mediaOpinionsText(t){return mediaOpinionEntries(t).map(x=>`${x.location}：${x.problem}`).join('\n');}
export function mediaOpinionsHtml(t){return mediaOpinionEntries(t).map(x=>'<section><h2>'+esc(x.location)+'</h2><p>'+esc(x.problem)+'</p></section>').join('');}
export function optionalSuggestionsHtml(t){const list=t.ai?.optionalSuggestions||[];return list.length?'<section><h2>可选表达优化（未写入修改稿）</h2>'+list.map(x=>'<p>'+esc(t.cells?.find(c=>c.id===x.id)?.address||x.id)+'：'+esc(x.suggestion)+'</p><p>'+esc(x.reason)+'</p>').join('')+'</section>':'';}
export function reviewReportHtml(t,p){
 const status=!t.ai?'未审核':reviewNeedsAttention(t,p)?'待补审':'已审稿';
 const changes=t.ai?.changes||[],warnings=reviewWarnings(t),remarks=t.remarks||[],media=mediaOpinionEntries(t),optional=t.ai?.optionalSuggestions||[];
 const edits=changes.map(c=>'<section><h2>修改建议 · '+esc(c.address||c.id)+'</h2><p>原文：'+esc(c.original)+'</p><p>建议：'+esc(c.revised)+'</p><p>'+esc(c.reason)+'</p></section>').join('');
 const notes=remarks.map(n=>'<p>'+esc(n.page?'第'+n.page+'页':n.t!==undefined?n.t+'秒':'')+' '+esc(n.text)+'</p>').join('');
 return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'+esc(t.filename)+' · 审稿意见</title><style>body{max-width:900px;margin:32px auto;padding:24px;font:16px/1.8 system-ui;color:#222}p{white-space:pre-wrap;overflow-wrap:anywhere}h2{font-size:18px}</style><h1>'+esc(t.filename)+' · 审稿意见</h1><p>'+esc(t.projectName||'')+' · '+status+' · 原文件未修改</p>'+mediaOpinionsHtml(t)+edits+reviewFeedbackHtml(t)+notes+optionalSuggestionsHtml(t)+(!changes.length&&!warnings.length&&!remarks.length&&!media.length&&!optional.length?'<p>暂无修改意见。</p>':'')+'</html>';
}
