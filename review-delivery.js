import {esc} from './engine.js';

// One writer per document. Persist each successful output so retries only write missing files.
export function createDelivery(ctx){
 const running=new Map();
 async function original(t){if(t.originalSaved)return t.originalSaved;const file=t.originalFile instanceof Blob?t.originalFile:(t.buffer?new Blob([t.buffer]):t.fmt==='text'?new Blob([t.cells.map(c=>c.original).join('\n\n')],{type:'text/plain;charset=utf-8'}):null);if(!file||!ctx.available(t))return null;const path=await ctx.write(t,'orig',`第${t.flow?.round||1}轮-${t.filename}`,file);await ctx.save({...t,originalSaved:path});return path;}
 async function once(id){let t=ctx.get(id);if(!t?.ai)return null;const ai=t.ai,token=ai.at;const get=()=>{const latest=ctx.get(id);if(latest?.ai?.at!==token)throw Error('审稿结果已更新，请重新归档。');return latest;};
  async function state(value){t=get();await ctx.save({...t,ai:{...t.ai,archive:value}});ctx.refresh();}
  if(ai.archive?.state==='saved')return ai.saved?.path||ai.archive.paths?.[1]||null;
  if(!ctx.available(t)){await state({...ai.archive,state:'waiting',message:'待授权保存文件夹'});return null;}
  let a={...ai.archive,state:'saving',message:'正在归档',paths:[...(ai.archive?.paths||[])]};await state(a);
  try{const orig=await original(get());if(orig&&!a.paths.includes(orig)){a.paths.push(orig);await state(a);}
   if(!a.output){const draft=await ctx.build(get());if(draft.skipped)throw Error(`有 ${draft.skipped} 处修改未能应用，请在审稿详情核对。`);a.output=await ctx.write(get(),'out',ctx.name(get(),draft.ext,'AI修改稿'),draft.blob);a.paths.push(a.output);await state(a);}
   if(!a.notes){const t=get(),html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(t.filename)} · 审稿意见</title><style>body{max-width:900px;margin:40px auto;padding:24px;font:16px/1.8 system-ui}section{margin:24px 0;border-bottom:1px solid #ddd}p{white-space:pre-wrap;overflow-wrap:anywhere}.after{color:#b52828}</style><h1>${esc(t.filename)}</h1><p>${esc(t.projectName)} · ${esc(t.stage)} · 第${t.flow?.round||1}轮</p>${t.ai.changes.map(c=>`<section><h2>${esc(t.cells.find(x=>x.id===c.id)?.address||c.id)}</h2><p>原文：${esc(c.original)}</p><p class="after">修改：${esc(c.revised)}</p><p>理由：${esc(c.reason)}</p></section>`).join('')}${t.ai.changes.length?'':'<p>本次审稿未发现需要修改的内容。</p>'}${t.ai.warnings.map(w=>`<p>提醒：${esc(w)}</p>`).join('')}`;a.notes=await ctx.write(t,'notes',ctx.name(t,'html','审稿意见'),new Blob([html],{type:'text/html;charset=utf-8'}));a.paths.push(a.notes);await state(a);}
   t=get();await ctx.save({...t,ai:{...t.ai,saved:{at:new Date().toISOString(),path:a.output},archive:{...a,state:'saved',message:'已自动归档',at:new Date().toISOString()}}});ctx.refresh();return a.output;
  }catch(e){await state({...a,state:'failed',message:'归档未完成：'+e.message});throw e;}
 }
 function draft(t){if(running.has(t.id))return running.get(t.id);const run=once(t.id).finally(()=>running.delete(t.id));running.set(t.id,run);return run;}
 async function resume(projectId){for(const t of ctx.all().filter(t=>t.projectId===projectId)){try{if(t.ai&&t.ai.archive?.state!=='saved'&&!t.ai.saved?.path)await draft(t);else if(!t.originalSaved)await original(t);}catch{ /* The row carries the failure and retry action. */ }}ctx.refresh();}
 return {draft,original,resume};
}
