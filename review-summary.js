import {esc} from './engine.js';
// Internal completion checks stay out of the interface and exported opinions.
export function reviewNeedsAttention(t,p){return !!t.ai&&(t.ai.needsSupplement||!t.ai.assurance?.complete||t.fullReviewPending||!!p&&t.ai.assurance.projectRevision!==(p.date||''));}
export function reviewWarnings(t){
 const ai=t.ai;if(!ai)return [];
 const internal=new Set([...(ai.blockingWarnings||[]),...(ai.processingWarnings||[])]);
 const findings=(ai.assurance?.mediaChecks||[]).flatMap(x=>x.findings||[]);
 return [...new Set((ai.warnings||[]).filter(w=>!internal.has(w)).map(w=>findings.find(f=>w.endsWith('：'+f))||w))];
}
export function reviewFeedbackHtml(t){return reviewWarnings(t).map(w=>'<p>'+esc(w)+'</p>').join('');}
export function reviewReportHtml(t,p){
 const status=!t.ai?'未审核':reviewNeedsAttention(t,p)?'待补审':'已审稿';
 const changes=t.ai?.changes||[],warnings=reviewWarnings(t),remarks=t.remarks||[];
 const edits=changes.map(c=>'<section><h2>修改建议 · '+esc(c.address||c.id)+'</h2><p>原文：'+esc(c.original)+'</p><p>建议：'+esc(c.revised)+'</p><p>'+esc(c.reason)+'</p></section>').join('');
 const notes=remarks.map(n=>'<p>'+esc(n.page?'第'+n.page+'页':n.t!==undefined?n.t+'秒':'')+' '+esc(n.text)+'</p>').join('');
 return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'+esc(t.filename)+' · 审稿意见</title><style>body{max-width:900px;margin:32px auto;padding:24px;font:16px/1.8 system-ui;color:#222}p{white-space:pre-wrap;overflow-wrap:anywhere}h2{font-size:18px}</style><h1>'+esc(t.filename)+' · 审稿意见</h1><p>'+esc(t.projectName||'')+' · '+status+' · 原文件未修改</p>'+edits+reviewFeedbackHtml(t)+notes+(!changes.length&&!warnings.length&&!remarks.length?'<p>暂无修改意见。</p>':'')+'</html>';
}
