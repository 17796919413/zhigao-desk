import {createUploadQueue} from './upload-assignment.js';
import {activityOf,selectedActivity,projectForActivity,activitiesOf,activityName,addActivity,assertActivitySelection} from './activities.js';
import {feedbackFor,feedbackRecord,parseFeedbackFile} from './draft-feedback.js';
import {reviewNeedsAttention,reviewBasisImpact,reviewWarnings,reviewFeedbackHtml,mediaOpinionsText,mediaOpinionEntries,optionalSuggestionsHtml} from './review-summary.js';
import {esc,uid,scan,fingerprint} from './engine.js';
import {effectiveRules} from './brand.js';
import {currentDocuments,currentDocumentForStage,flowOf,newFlow,nextRound,reviewStagesFor} from './model.js';
import {canDeepReview,BATCH_STATES} from './review-batch.js';
import {matchDraftRow} from './creator-match.js';
import {rowKey,rowIdentity,cellOf,buildPlan} from './feishu.js';
import {documentPreview} from './document-preview.js';
import {digest} from './review-knowledge.js';

export function createWorkbench(ctx){
 const batchChoices=new Map();
 const feedbackOpen=new Set(),feedbackBusy=new Set(),feedbackImages=new Map();
 const S=ctx.state,$=s=>document.querySelector(s),opened=new Set(),previews=new Map(),syncing=new Set();let chain=Promise.resolve(),copying=false,lastPrompt='',refreshPending=false;
 const p=()=>S().settings.projects.find(p=>p.id===S().settings.selected),docs=()=>S().tasks.filter(t=>t.projectId===p().id&&activityOf(t)===selectedActivity(p())),itOf=t=>S().items.find(i=>i.id===t.itemId),date=s=>new Date(s).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),attrs=id=>`data-id="${esc(id)}"`,button=(a,l,style='',extra='')=>ctx.btn(a,l,style,extra);
 const owner=t=>S().settings.projects.find(p=>p.id===t.projectId);
 const eligible=()=>currentDocuments(docs()).filter(t=>(!t.ai||t.fullReviewPending||reviewNeedsAttention(t,owner(t)))&&flowOf(t).state==='review'&&canDeepReview(t));
 const uploadQueue=createUploadQueue({...ctx,refresh}),uploads=uploadQueue.rows;
 const uploadRows=()=>uploads.filter(r=>r.projectId===p().id&&activityOf(r)===selectedActivity(p())&&r.status!=='saved');
 const busy=()=>uploadRows().some(r=>r.status==='queued'||r.status==='reading');
 const canDelete=t=>!busy()&&!syncing.has(t.id)&&t.ai?.archive?.state!=='saving';
 function status(t){const impact=reviewBasisImpact(t,owner(t));if(impact)return impact.state==='delivered'?'已交品牌 · 依据有更新':impact.state==='reviewed'?'依据更新 · 需复核':'待按新依据审核';if(t.fmt==='office-pending')return '待审稿';if(t.reviewReadError)return '读取失败';if(t.fullReviewPending)return '待全文审核';if(t.ai)return reviewNeedsAttention(t,owner(t))?'审核未完成':'已审稿';if(!canDeepReview(t))return ['pdf','video'].includes(t.fmt)?'只读稿件':'未读到文字';const entry=S().batches.flatMap(b=>b.entries).findLast(e=>e.docId===t.id&&e.round===flowOf(t).round);return entry?BATCH_STATES[entry.status]||'待审稿':'待审稿';}
 function folderSetup(){const project=p(),folder=ctx.folder(project.id),granted=ctx.folderGranted(project.id);return `<div class="wb-setting" data-folder-setting="${esc(project.id)}"><span>自动归档</span><strong>${folder?esc(folder.name):'选择保存文件夹'}</strong>${button(folder&&!granted?'folder-grant':'folder-pick',folder?(granted?'更换':'授权并补存'):'选择文件夹','small',`data-pid="${esc(project.id)}"`)}<small>${granted?'文档另存修改稿；图片、视频另存意见单':'选择并授权后，审稿结果自动存入'}</small>${folder?`<small data-backup-status="${esc(project.id)}">${esc(ctx.backupStatus?.(project.id)||'')}</small>`:''}</div>`;}
 function setup(){const project=p(),refined=project.feishu?.refined,live=ctx.liveSheets(project);return `<div class="wb-setup"><label>品牌项目<select data-setting="project" aria-label="当前品牌项目" class="input">${ctx.projectOptions()}</select></label>${folderSetup()}<div class="wb-setting"><span>审核表</span><strong>${refined?(live.length?'已匹配 · '+live.length+' 个子表':'已关联，待匹配'):'尚未关联'}</strong>${button('wb-feishu-link',refined?'更换':'关联表格','small')}${refined?button('wb-match','匹配稿件','small'):''}${button('connect-open','连接设置','small','data-section="feishu"')}</div></div>`;}
 const selectionKey=t=>JSON.stringify([t.id,flowOf(t).round]);
 const selectedDocs=()=>eligible().filter(t=>batchChoices.get(selectionKey(t))!==false);
 document.addEventListener('change',e=>{const id=e.target.dataset?.batchDoc;if(!id)return;const t=docs().find(t=>t.id===id);if(t){batchChoices.set(selectionKey(t),e.target.checked);ctx.render();}});
 function toolbar(){const n=selectedDocs().length,total=eligible().length;return `<div class="wb-toolbar"><div><h2>稿件列表 <span>${docs().length}</span></h2><p>已选 ${n} / ${total} 份待审稿。${button('wb-select-all','全选','small')}${button('wb-select-none','清空选择','small')}</p></div><div class="toolbar-actions">${button('wb-copy',copying?'正在准备…':`一键复制审稿提示词${n?' · '+n+' 份':''}`,'primary',!n||busy()||copying||p().status==='ended'?'disabled':'')}${button('upload',ctx.icon('plus')+' 添加稿件')}</div></div><div id="wb-copy-status" role="status" class="wb-copy-status"></div>`;}
 function home(){return `<div class="page-title"><div><h1>审稿工作台</h1><p>批量上传 · 审稿对比 · 自动归档</p></div><button class="textbtn" data-page="rules">品牌资料与口径 →</button></div>${setup()}${p().status==='ended'?`<div class="callout">当前项目已结束。${button('new-project','新建品牌项目','small')}</div>`:''}<div class="dropzone wb-drop" id="dropzone" role="button" tabindex="0" aria-label="批量上传稿件">${ctx.icon('upload')}<div><b>拖入多份稿件，或点击上传</b><small>支持 Word、Excel、PDF、文字、图片和视频</small></div></div>${toolbar()}<section class="panel wb-list" id="wb-list">${rows(docs())}</section>`;}
 function archiveStatus(t){if(!t.ai)return '';const a=t.ai.archive;if(a?.state==='saved')return `<span class="wb-saved" title="${esc(a.paths?.join('\n')||t.ai.saved?.path||'')}">已自动归档</span>`;if(a?.state==='saving')return '<span>正在归档…</span>';if(t.ai.saved?.path&&!a)return '<span class="wb-saved">已归档</span>';return `<span class="${a?.state==='failed'?'error':'muted'}">${esc(a?.message||'待选择文件夹自动归档')}</span>${a?.state==='failed'?button('wb-archive','重试归档','small',attrs(t.id)):''}`;}
 function meta(t){const it=itOf(t),fields=[['author','达人',t.author||''],['title','内容标题',it?.title||'']];return `<details class="wb-meta"><summary>稿件信息</summary><div class="wb-fields">${fields.map(([f,label,v])=>`<label>${label}<input class="input" data-wb-field="${f}" value="${esc(v)}"></label>`).join('')}<label>平台<select class="input" data-wb-field="platform"><option value="">未识别</option>${['抖音','小红书','其他'].map(v=>`<option ${v===t.platform?'selected':''}>${v}</option>`).join('')}</select></label><label>形式<select class="input" data-wb-field="kind"><option value="">未识别</option>${['视频','图文'].map(v=>`<option ${v===t.kind?'selected':''}>${v}</option>`).join('')}</select></label><label>阶段<select class="input" data-wb-field="stage"><option value="">未识别</option>${['大纲','脚本','初稿'].map(v=>`<option ${v===t.stage?'selected':''}>${v}</option>`).join('')}</select></label>${button('wb-save-meta','保存','small',attrs(t.id))}${button('open-task','逐条处理','small',attrs(t.id))}${it?button('delete-item','删除内容任务','small',attrs(it.id)):''}</div></details>`;}
 function detail(t){if(!opened.has(t.id))return '';const ai=t.ai,changes=ai?.changes||[],optional=ai?.optionalSuggestions||[];if(['video','image'].includes(t.fmt))return `<div class="wb-detail">${button('open-task','查看原件与意见','small',attrs(t.id))}${mediaOpinionsText(t)?`<pre class="media-opinions">${esc(mediaOpinionsText(t))}</pre>${button('wb-copy-opinions','复制简短意见','small',attrs(t.id))}`:''}${reviewFeedbackHtml(t)}</div>`;return `<div class="wb-detail" id="wb-detail-${esc(t.id)}"><div class="wb-detail-head"><strong>全文对比</strong><span>修改后为 AI 修改稿 · 新增与替换标红</span>${button('wb-expand','放大对比','small',attrs(t.id))}</div><div class="wb-compare" data-preview-id="${esc(t.id)}"><div class="wb-document"><h3>修改前 · 原稿</h3><iframe title="修改前：${esc(t.filename)}" sandbox="allow-same-origin"></iframe></div><div class="wb-document"><h3>修改后 · ${changes.length} 处修改</h3><iframe title="修改后：${esc(t.filename)}" sandbox="allow-same-origin"></iframe></div></div><p class="wb-preview-state" role="status">正在载入文档…</p><details class="wb-reasons"><summary>修改理由、提醒与可选优化 · ${changes.length+reviewWarnings(t).length+optional.length}</summary>${changes.map(x=>`<p><strong>${esc(t.cells.find(c=>c.id===x.id)?.address||x.id)}</strong> · ${esc(x.reason)}</p>`).join('')}${reviewWarnings(t).map(w=>`<p>${esc(w)}</p>`).join('')}${optionalSuggestionsHtml(t)}${!changes.length&&!reviewWarnings(t).length&&!optional.length?'<p>暂无修改意见。</p>':''}</details></div>`;}
 function row(t){const st=status(t),can=canDeepReview(t),ai=!!t.ai,job=S().batches.flatMap(b=>b.entries).findLast(e=>e.docId===t.id&&e.round===flowOf(t).round),sync=t.feishuSync,impact=reviewBasisImpact(t,owner(t));return `<article class="wb-row" data-doc-id="${esc(t.id)}"><div class="wb-row-main">${eligible().some(d=>d.id===t.id)?`<label class="wb-select"><input type="checkbox" data-batch-doc="${esc(t.id)}" aria-label="选择审稿：${esc(t.filename)}" ${batchChoices.get(selectionKey(t))!==false?'checked':''}></label>`:''}<div class="wb-file">${ctx.icon('doc')}<div><h3>${esc(t.filename)}</h3><p>${[t.author,t.platform,t.stage].filter(Boolean).map(esc).concat('').join(' · ')}第 ${flowOf(t).round} 轮</p></div></div><div class="wb-state"><span class="tag ${ai?'dark':st==='失败'?'red':'gray'}">${st}</span>${ai?`<small>${t.ai.changes.length} 处修改 · ${reviewWarnings(t).length} 条提醒${mediaOpinionEntries(t).length?` · ${mediaOpinionEntries(t).length} 条媒体意见`:""}${t.ai.optionalSuggestions?.length?` · ${t.ai.optionalSuggestions.length} 条可选优化`:""}</small>`:''}</div><div class="wb-row-actions">${ai&&can?button('wb-detail',opened.has(t.id)?'收起详情':'审稿详情','small',attrs(t.id)+` aria-expanded="${opened.has(t.id)}" aria-controls="wb-detail-${esc(t.id)}"`):!can?button('open-task',['pdf','video'].includes(t.fmt)?'查看 / 写意见':'查看稿件','small',attrs(t.id)):''}${can&&(reviewNeedsAttention(t,owner(t))||['failed','interrupted'].includes(job?.status))?button('wb-continue',impact?.state==='delivered'?'决定重新审核':'继续审核','small',attrs(t.id)):''}${ai?button('wb-sync',syncing.has(t.id)?'正在同步…':'同步至审核表','small',attrs(t.id)+(syncing.has(t.id)?' disabled':'')):''}${button('delete-task',ctx.icon('trash')+' 删除','small',attrs(t.id)+` aria-label="删除稿件：${esc(t.filename)}"`+(canDelete(t)?'':' disabled'))}</div></div><div class="wb-row-foot">${archiveStatus(t)}${impact?'<span class="basis-impact">'+esc(impact.message)+'</span>':''}${sync?`<span class="${sync.state==='failed'?'error':'muted'}">${esc(sync.message)}</span>`:''}${job?.reason&&!ai?`<span class="error">${esc(job.reason)}</span>`:''}</div>${feedbackPanel(t)}${meta(t)}${detail(t)}</article>`;}
 function feedbackPanel(t){const list=feedbackFor(t),id=esc(t.id);return `<details class="wb-feedback" data-feedback-doc="${id}" ${feedbackOpen.has(t.id)?'open':''}><summary>品牌方专属反馈 <span>${list.length?list.length+' 条':'添加文字 / 截图 / 文件'}</span></summary><div class="wb-feedback-body"><p class="muted">仅供这份稿件第 ${flowOf(t).round} 轮审核使用，与当前品牌资料一起核对。不会带到其他稿件；删除即停止使用。</p>${list.map(f=>`<div class="wb-feedback-entry"><div><strong>${esc(f.title)}</strong><p>${esc(f.text)}</p>${f.originalAsset?.fmt==='image'?`<img class="feedback-thumbnail" data-feedback-preview="${esc(f.id)}" alt="${esc(f.title)}">`:''}${f.originalAsset?'<small>原件已保存，AI 审核时一并读取文字与图片。</small>':''}</div><div class="toolbar-actions">${button('wb-feedback-edit','编辑','small',attrs(t.id)+` data-feedback-id="${esc(f.id)}"`)}${button('wb-feedback-delete','删除','small',attrs(t.id)+` data-feedback-id="${esc(f.id)}" aria-label="删除反馈：${esc(f.title)}"`)}</div></div>`).join('')}<label for="feedback-text-${id}">品牌方原话</label><textarea id="feedback-text-${id}" data-feedback-text placeholder="粘贴原话，或在这里粘贴截图" aria-label="品牌方原话"></textarea><div class="toolbar-actions">${button('wb-feedback-save','添加文字','small primary',attrs(t.id))}<label class="button small feedback-file-label">添加截图 / 文件<input type="file" data-feedback-files="${id}" multiple accept=".png,.jpg,.jpeg,.webp,.bmp,.docx,.pptx,.pdf,.txt,.md" aria-label="添加反馈文件"></label><small>图片、Word、PPTX、PDF、TXT</small></div><p role="status" class="feedback-status">${feedbackBusy.has(t.id)?'正在读取并保存反馈…':''}</p></div></details>`;}
 async function mutateFeedback(id,change){return ctx.exclusive(async()=>{const current=S().tasks.find(t=>t.id===id);if(!current||current.projectId!==p().id||activityOf(current)!==selectedActivity(p()))throw Error('稿件或品牌已变化，请重新选择。');const next={...current,brandFeedback:change(feedbackFor(current)),fullReviewPending:!!current.ai,updated:new Date().toISOString()};await ctx.persist([['tasks',next]]);feedbackOpen.add(id);});}
 async function addFeedbackFiles(id,files){if(feedbackBusy.has(id))return;const original=S().tasks.find(t=>t.id===id);if(!original)return;const binding=[original.projectId,flowOf(original).round];feedbackBusy.add(id);const host=document.querySelector(`[data-feedback-doc="${CSS.escape(id)}"]`);if(host)host.querySelector('.feedback-status').textContent='正在读取并保存反馈…';try{const rows=[];for(const file of files)rows.push(feedbackRecord(original,await parseFeedbackFile(file)));await mutateFeedback(id,list=>{const live=S().tasks.find(t=>t.id===id);if(live.projectId!==binding[0]||flowOf(live).round!==binding[1])throw Error('稿件轮次已变化，请重新添加。');return [...list,...rows];});ctx.render();ctx.toast('反馈已添加，仅用于这份稿件本轮审核。');}catch(e){ctx.toast(e.message);if(host?.isConnected)host.querySelector('.feedback-status').textContent=e.message;}finally{feedbackBusy.delete(id);const live=document.querySelector(`[data-feedback-doc="${CSS.escape(id)}"] .feedback-status`);if(live&&live.textContent==='正在读取并保存反馈…')live.textContent='';}}
 const feedbackDraftKey=id=>'zhigao-feedback-draft:'+id;
 document.addEventListener('input',e=>{if(e.target.matches?.('[data-feedback-text]')){const id=e.target.closest('[data-feedback-doc]')?.dataset.feedbackDoc;if(id)try{sessionStorage.setItem(feedbackDraftKey(id),e.target.value);}catch{}}});
 function restoreFeedbackDrafts(){for(const el of document.querySelectorAll('[data-feedback-text]')){const id=el.closest('[data-feedback-doc]').dataset.feedbackDoc;try{const value=sessionStorage.getItem(feedbackDraftKey(id));if(value!==null){el.value=value;if(value)el.closest('details').open=true;}}catch{}}}
 document.addEventListener('toggle' ,e=>{const id=e.target.dataset?.feedbackDoc;if(id)e.target.open?feedbackOpen.add(id):feedbackOpen.delete(id);},true);
 document.addEventListener('change',e=>{const id=e.target.dataset?.feedbackFiles;if(id&&e.target.files.length){const files=[...e.target.files];e.target.value='';addFeedbackFiles(id,files);}});
 document.addEventListener('paste',e=>{const host=e.target.closest?.('[data-feedback-doc]');if(!host)return;const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();addFeedbackFiles(host.dataset.feedbackDoc,files);}});
 function rows(list){const queue=uploadRows().map(r=>`<div class="wb-upload-row" data-upload-id="${esc(r.id)}"><div class="wb-upload-heading"><strong>${esc(r.name)}</strong><span role="status" class="${r.status==='failed'||r.error?'error':'muted'}">${esc(r.error||({queued:'等待读取',reading:'正在读取与保存',choice:'待确认归属'}[r.status])||'')}</span></div>${r.status==='failed'?`<div class="toolbar-actions">${button('wb-upload-cancel','取消这份','small',attrs(r.id))}${button('wb-upload-retry','重新读取','small',attrs(r.id))}</div>`:''}</div>`).join('');return queue+([...list].sort((a,b)=>String(b.created).localeCompare(String(a.created))).map(row).join('')||(!queue?'<div class="empty"><p>上传稿件后会列在这里</p><small>上传多少份，就能一次交给 AI 审多少份。</small></div>':''));}

 function items(list){return rows(list.flatMap(it=>S().tasks.filter(t=>t.itemId===it.id)))+list.filter(it=>!S().tasks.some(t=>t.itemId===it.id)).map(it=>`<div class="wb-row wb-empty-item"><strong>${esc(it.author)} · ${esc(it.title)}</strong><span>等待来稿</span><div class="toolbar-actions">${button('open-item','上传稿件','small',attrs(it.id))}${button('delete-item',ctx.icon('trash')+' 删除','small',attrs(it.id))}</div></div>`).join('');}
 function refresh(){if(!['home','history','item'].includes(S().page))return;if($('#modal-root .modal')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){refreshPending=true;return;}refreshPending=false;ctx.render();}
 document.addEventListener('focusout',()=>{if(refreshPending)setTimeout(refresh,0);});
 const upload=(files,options)=>uploadQueue.upload(files,options);
 async function mount(){restoreFeedbackDrafts();
  const live=new Set(S().tasks.flatMap(t=>feedbackFor(t)).map(f=>f.id));for(const [id,url] of feedbackImages)if(!live.has(id)){URL.revokeObjectURL(url);feedbackImages.delete(id);}
  for(const img of document.querySelectorAll('[data-feedback-preview]')){const t=S().tasks.find(t=>t.id===img.closest('[data-doc-id]')?.dataset.docId),f=t&&feedbackFor(t).find(f=>f.id===img.dataset.feedbackPreview);if(!f?.originalAsset?.buffer)continue;if(!feedbackImages.has(f.id))feedbackImages.set(f.id,URL.createObjectURL(new Blob([f.originalAsset.buffer],{type:f.originalAsset.mime||'image/png'})));img.src=feedbackImages.get(f.id);}
  for(const host of document.querySelectorAll('[data-preview-id]')){const t=S().tasks.find(t=>t.id===host.dataset.previewId);if(!t)continue;const key=t.id+'|'+(t.ai?.at||'')+'|'+fingerprint(t.cells)+'|'+JSON.stringify(t.ai?.changes||[]);try{if(!previews.has(key)){if(previews.size>8)previews.delete(previews.keys().next().value);previews.set(key,documentPreview(t));}const result=await previews.get(key);if(!host.isConnected)continue;const frames=host.querySelectorAll('iframe');frames[0].srcdoc=result.before;frames[1].srcdoc=result.after;let locked=false;for(let i=0;i<2;i++)frames[i].onload=()=>{frames[i].contentWindow?.addEventListener('scroll',()=>{if(locked)return;locked=true;const source=frames[i].contentDocument?.scrollingElement,target=frames[1-i].contentDocument?.scrollingElement;if(source&&target){const range=source.scrollHeight-source.clientHeight;target.scrollTop=range?source.scrollTop/range*(target.scrollHeight-target.clientHeight):0;target.scrollLeft=source.scrollLeft;}requestAnimationFrame(()=>locked=false);});};host.nextElementSibling.textContent=t.fmt==='xlsx'?'显示所有工作表、表格文字与图片；浮动图片列在所属工作表下方。':t.fmt==='docx'?'显示正文、表格与图片；分页以 Word 原文件为准。':'';}catch(e){previews.delete(key);if(host.isConnected)host.nextElementSibling.textContent='预览失败：'+e.message;}}
 }
 async function copyBatch(){if(copying||busy())return;const list=selectedDocs();if(!list.length)return ctx.toast('没有待审稿件。');copying=true;try{const batch=await ctx.createBatch(list.map(t=>t.id));lastPrompt=`用知稿审完批次 ${batch.id}。获取审稿指令时传 compact:true，直接核对随附原文，只补读未完成分区。按当前品牌资料和最新口径逐份审稿并提交结果，失败的说明原因，最后核对全部 ${batch.entries.length} 份。`;try{await navigator.clipboard.writeText(lastPrompt);ctx.toast('已复制，粘贴到任一已连接的 AI 客户端即可。');}catch{ctx.modal('复制审稿提示词',`<textarea id="wb-prompt" readonly>${esc(lastPrompt)}</textarea>`,button('close-modal','关闭'));$('#wb-prompt').select();}refresh();const hint=$('#wb-copy-status');if(hint)hint.textContent='已准备 '+batch.entries.length+' 份，请把提示词粘贴到已连接的 AI 客户端。';}finally{copying=false;const b=$('[data-action=wb-copy]');if(b){b.disabled=false;b.textContent='再次复制审稿提示词';}}}
 async function match(){const project=p(),url=project.feishu?.refined?.url;if(!url)throw Error('请先关联审核表。');await ctx.readFeishu(project,url);if(ctx.chooseActivityColumns?.(project))return;await ctx.bindExact(project);refresh();ctx.toast('已匹配，审完后点击稿件旁的同步按钮。');}
 const syncKey=id=>'zhigao-sync-access:'+id,openedSync=new Set();
 const syncSignature=(t,it)=>{const project=S().settings.projects.find(p=>p.id===t.projectId),choices=(project?.feishu?.sheets||[]).filter(s=>s.sourceUrl===project.feishu.refined?.url&&s.activityMapping).map(s=>[s.remoteId,s.activityMapping.header]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));return JSON.stringify([t.itemId,t.stage,t.kind,activityOf(t),flowOf(t).round,t.ai?.at,t.ai?.changes,t.ai?.assurance,it.author,it.platform,it.title,it.kind,activityOf(it),...(choices.length?[choices]:[])]);};
 async function syncAccessContext(continuationId){
  const ticket=Object.keys(localStorage).filter(k=>k.startsWith('zhigao-sync-access:')).map(k=>JSON.parse(localStorage.getItem(k))).find(t=>t?.id===continuationId);
  const t=ticket&&S().tasks.find(t=>t.id===ticket.docId),it=t&&itOf(t),project=t&&S().settings.projects.find(p=>p.id===t.projectId);
  if(!ticket||!t||!it||!project||t.projectId!==ticket.projectId||it.projectId!==ticket.projectId||project.status==='ended')throw Object.assign(Error('原同步稿件已变化。'),{code:'TASK_CHANGED'});
  assertActivitySelection(p(),ticket.projectId,ticket.activityId);
  if(project.feishu?.refined?.url!==ticket.url||reviewNeedsAttention(t,project)||!t.ai||t.ai.coverage?.complete===false||currentDocumentForStage(S().tasks.filter(d=>d.itemId===it.id),t.stage)?.id!==t.id||await digest(syncSignature(t,it))!==ticket.signature)throw Object.assign(Error('稿件或审核依据已变化，请核对后重新同步。'),{code:'TASK_CHANGED'});
  return ticket;
 }
 async function openSyncAccess(ticket){
  await syncAccessContext(ticket.id);
  return ctx.prepareAccess({operation:'feishu_sync',projectId:ticket.projectId,docId:ticket.docId,originalCall:{name:'zhigao_prepare_feishu_sync',args:{docId:ticket.docId,url:ticket.url,continuationId:ticket.id}}});
 }
 async function restoreSyncAccess(){
  if(!ctx.prepareAccess)return;
  for(const t of docs()){
   const ticket=JSON.parse(localStorage.getItem(syncKey(t.id))||'null');
   if(!ticket||openedSync.has(ticket.id))continue;
   openedSync.add(ticket.id);
   try{await openSyncAccess(ticket);return;}catch(e){ctx.toast(e.message);}
  }
 }
 async function syncDoc(id,continuation=null){
  if(syncing.has(id)){if(continuation)throw Object.assign(Error('这份稿件仍在同步，请稍后核对。'),{code:'SYNC_BUSY'});return;}
  if(continuation)await syncAccessContext(continuation.id);
  const pendingAtStart=JSON.parse(localStorage.getItem(syncKey(id))||'null');
  const initial=S().tasks.find(t=>t.id===id),initialItem=initial&&itOf(initial),initialProject=S().settings.projects.find(p=>p.id===initial?.projectId);
  if(!initial?.ai||!initialItem||!initialProject||initialProject.status==='ended'||reviewNeedsAttention(initial,initialProject)||initial.ai.coverage?.complete===false)throw Error('稿件尚未审完或项目已结束。');
  const projectId=initial.projectId,activityId=activityOf(initial),url=initialProject.feishu?.refined?.url;
  assertActivitySelection(p(),projectId,activityId);
  if(!url){ctx.toast('请先关联当前品牌的审核表。');return handle('wb-feishu-link');}
  const signature=syncSignature;
  const expected=signature(initial,initialItem),reviewAt=initial.ai.at;
  function current(){
   const state=S(),project=state.settings.projects.find(p=>p.id===projectId),t=state.tasks.find(t=>t.id===id),it=t&&state.items.find(i=>i.id===t.itemId);
   assertActivitySelection(p(),projectId,activityId);
   if(!project||project.status==='ended'||project.feishu?.refined?.url!==url)throw Error('项目或审核表已变化，请重新同步。');
   if(!t||!it||!t.ai||it.projectId!==projectId||activityOf(it)!==activityId||reviewNeedsAttention(t,project)||t.ai.coverage?.complete===false||signature(t,it)!==expected)throw Error('稿件或审核依据已变化，请核对后重新同步。');
   if(currentDocumentForStage(state.tasks.filter(d=>d.itemId===it.id),t.stage)?.id!==id)throw Error('这份稿件已有新版，请同步当前稿件。');
   return {project,t,it};
  }
  if(syncing.has(id))throw Object.assign(Error('这份稿件仍在同步，请稍后核对。'),{code:'SYNC_BUSY'});
  syncing.add(id);refresh();let preparation=null;
  try{
   if(continuation&&await digest(expected)!==continuation.signature)throw Object.assign(Error('原审核结果已变化，请重新同步。'),{code:'TASK_CHANGED'});
   current();await ctx.readFeishu(initialProject,url);
   let {project,t,it}=current();
   if(!['大纲','脚本','初稿'].includes(t.stage))throw Error('未能识别稿件阶段，无法确定要更新哪一列。请核对稿件信息后同步。');
   const {hits,conflicts,issues}=matchDraftRow(t,it,S().items,ctx.liveSheets(project),project);
   if(issues.length)throw Error(issues.join('；'));
   if(conflicts.length)throw Error('同一表格记录匹配到多个活动；本次未写入，请在审核表区分活动。');
   if(hits.length!==1)throw Error(hits.length?'匹配到多条同名记录，请核对活动、平台和内容标题。':'未找到当前活动对应的记录，请核对活动、达人名称和平台。');
   const {s,row}=hits[0];await ctx.persist([['items',{...it,feishu:{sheetId:s.id,key:rowKey(s,row)}}]]);
   ({project,t,it}=current());
   const entries=buildPlan(S().items.filter(i=>i.projectId===projectId&&i.feishu),i=>S().tasks.filter(d=>d.itemId===i.id),ctx.liveSheets(project),project),entry=entries.find(e=>e.it.id===it.id);
   if(!entry||entry.error)throw Error(entry?.error||'未能生成同步内容。');
   const stageField={大纲:'outline',脚本:'script',初稿:'draft'}[t.stage],cells=entry.cells.filter(c=>c.f===stageField),blocked=cells.filter(c=>c.status==='conflict'),updates=cells.filter(c=>c.status==='update'),same=cells.filter(c=>c.status==='same');
   if(blocked.length)throw Error(blocked.map(c=>`${c.header}：${c.note}`).join('；'));
   const writes=updates.map(c=>({status:'update',field:c.f,header:c.header,column:s.map[c.f],value:c.ours,...(c.expected!==undefined?{expected:c.expected}:{}),...rowIdentity(s,row)}));
   if(!writes.length&&!same.length)throw Error('审核表缺少对应的稿件阶段列，请检查表头。');
   current();
   if(writes.length){
    const result=await ctx.feishuWrite({url,sheetId:s.remoteId,writes});
    if(result.rejected||result.uncertain||result.notAttempted||result.written!==writes.length)throw Error(result.uncertain?'同步结果待确认，请刷新审核表核对。':result.results?.find(r=>r.status==='rejected')?.error||'未确认同步完成，请刷新审核表。');
    ({project}=current());await ctx.readFeishu(project,url);
   }
   ({t}=current());
   const message=writes.length?'已同步至飞书 · '+date(new Date()):'飞书已是最新';
   await ctx.persist([['tasks',{...t,feishuSync:{state:'saved',message,at:new Date().toISOString(),url,activityId,reviewAt}}]]);
   const ticket=JSON.parse(localStorage.getItem(syncKey(id))||'null');
   if(ticket&&ticket.id===(continuation?.id||pendingAtStart?.id))localStorage.removeItem(syncKey(id));
   ctx.toast(message);return {ok:true,docId:id,written:writes.length};
  }catch(e){
   const latest=S().tasks.find(t=>t.id===id);
   if(latest)await ctx.persist([['tasks',{...latest,feishuSync:{state:'failed',message:e.message,at:new Date().toISOString(),url,activityId,reviewAt}}]]);
   if(continuation)throw e;
   if(ctx.prepareAccess&&['FEISHU_CLI_MISSING','FEISHU_CONFIG','FEISHU_AUTH','FEISHU_SCOPE'].includes(e.code)){
    current();
    preparation={id:crypto.randomUUID(),action:'feishuSync',docId:id,projectId,activityId,url,signature:await digest(expected)};
    const scopes=[...new Set((e.details?.missingScopes||[]).filter(s=>typeof s==='string'&&/^[a-z][a-z0-9_:.]{1,150}$/.test(s)))].slice(0,20);
    if(e.code==='FEISHU_SCOPE'&&scopes.length)preparation.scopeRequest={id:crypto.randomUUID(),scopes};
    localStorage.setItem(syncKey(id),JSON.stringify(preparation));openedSync.add(preparation.id);
   }else ctx.showConnectionIssue(e)||ctx.toast(e.message);
  }finally{syncing.delete(id);refresh();if(preparation)setTimeout(()=>openSyncAccess(preparation).catch(e=>ctx.toast(e.message)),0);}
 }
 async function saveMeta(b){const t=S().tasks.find(t=>t.id===b.dataset.id),it=itOf(t),fields=Object.fromEntries([...b.closest('.wb-fields').querySelectorAll('[data-wb-field]')].map(e=>[e.dataset.wbField,e.value.trim()]));if(!reviewStagesFor(fields.kind).includes(fields.stage))throw Error('图文没有脚本阶段，请选择大纲或初稿。');const updated={...it,author:fields.author,title:fields.title,platform:fields.platform,kind:fields.kind,updated:new Date().toISOString()};const affected=S().tasks.filter(d=>d.itemId===it.id);if(affected.some(d=>!reviewStagesFor(fields.kind).includes(d.id===t.id?fields.stage:d.stage)))throw Error('其他稿件阶段与所选形式不一致。');await ctx.persist([['items',updated],...affected.map(d=>['tasks',{...d,author:fields.author,platform:fields.platform,kind:fields.kind,...(d.id===t.id?{stage:fields.stage}:{}),fullReviewPending:!!d.fullReviewPending||!!d.ai&&(fields.author!==d.author||fields.platform!==d.platform||fields.kind!==d.kind||d.id===t.id&&fields.stage!==d.stage),updated:updated.updated}])]);refresh();}
 async function handle(action,b){if(!action?.startsWith('wb-'))return false;
  if(action==='wb-upload-cancel'){await uploadQueue.cancel(b.dataset.id);return true;}
  if(action==='wb-upload-retry'){await uploadQueue.retry(b.dataset.id);return true;}
  if(action==='wb-feedback-save'){const value=b.closest('.wb-feedback').querySelector('[data-feedback-text]').value.trim();if(!value)throw Error('请填写品牌方原话。');b.disabled=true;try{const t=S().tasks.find(t=>t.id===b.dataset.id);await mutateFeedback(t.id,list=>[...list,feedbackRecord(t,{title:'品牌方原话',text:value})]);try{sessionStorage.removeItem(feedbackDraftKey(t.id));}catch{}ctx.render();ctx.toast('反馈已添加。');}finally{if(b.isConnected)b.disabled=false;}}
  if(action==='wb-feedback-delete'){b.disabled=true;try{await mutateFeedback(b.dataset.id,list=>list.filter(f=>f.id!==b.dataset.feedbackId));ctx.render();ctx.toast('反馈已删除，旧审核依据已失效。');}finally{if(b.isConnected)b.disabled=false;}}
  if(action==='wb-feedback-edit'){const t=S().tasks.find(t=>t.id===b.dataset.id),f=feedbackFor(t).find(x=>x.id===b.dataset.feedbackId);if(!f)throw Error('反馈已删除。');ctx.modal('编辑本稿反馈',`<label for="feedback-edit-text">品牌方原话 / 附件补充说明</label><textarea id="feedback-edit-text">${esc(f.text)}</textarea>`,button('close-modal','取消')+button('wb-feedback-update','保存','primary',attrs(t.id)+` data-feedback-id="${esc(f.id)}"`));}
  if(action==='wb-feedback-update'){const text=$('#feedback-edit-text').value.trim();if(!text)throw Error('反馈内容不能为空。');await mutateFeedback(b.dataset.id,list=>{if(!list.some(f=>f.id===b.dataset.feedbackId))throw Error('反馈已删除。');return list.map(f=>f.id===b.dataset.feedbackId?{...f,text}:f);});ctx.closeModal();ctx.render();ctx.toast('反馈已保存。');}
  if(action==='wb-select-all'||action==='wb-select-none'){for(const t of eligible())batchChoices.set(selectionKey(t),action==='wb-select-all');ctx.render();}
  if(action==='wb-copy-opinions'){const t=S().tasks.find(t=>t.id===b.dataset.id),text=mediaOpinionsText(t);if(!text)throw Error('没有带准确位置的简短意见。');try{await navigator.clipboard.writeText(text);ctx.toast('意见已复制。');}catch{ctx.modal('复制简短意见',`<textarea id="media-opinions-copy" readonly>${esc(text)}</textarea>`,button('close-modal','关闭'));$('#media-opinions-copy').select();}}
  if(action==='wb-copy')await copyBatch();
  if(action==='wb-detail'){const id=b.dataset.id;opened.has(id)?opened.delete(id):opened.add(id);refresh();}
  if(action==='wb-continue'){
   const t=S().tasks.find(t=>t.id===b.dataset.id),job=S().batches.findLast(x=>x.entries.some(e=>e.docId===t.id&&e.round===flowOf(t).round));
   const args={docId:t.id,...(job?{batchId:job.id}:{})};const text=`用知稿继续完成这份稿件的全文审核：${JSON.stringify(args)}。先调用 ${t.ai?'zhigao_reopen_review':'zhigao_get_review_brief（传 retry:true）'}，读取原稿和已有建议，补齐遗漏，一次提交完整结果；长正文用 patches，不把可执行修改降级为提醒。提交失败按错误修正重试，完成后核对覆盖和归档结果。`;
   await navigator.clipboard.writeText(text);ctx.toast('继续审核提示词已复制，粘贴到已连接的 AI 客户端。');
  }
  if(action==='wb-expand'){const el=b.closest('.wb-detail');el.classList.toggle('wb-expanded');b.textContent=el.classList.contains('wb-expanded')?'退出放大':'放大对比';}
  if(action==='wb-save-meta')await saveMeta(b);
  if(action==='wb-match'){b.disabled=true;try{await match();}finally{if(b.isConnected)b.disabled=false;}}
  if(action==='wb-sync')await syncDoc(b.dataset.id);
  if(action==='wb-archive'){await ctx.archiveDraft(S().tasks.find(t=>t.id===b.dataset.id));refresh();}
  if(action==='wb-feishu-link')ctx.modal('关联审核表',`<label for="wb-feishu-url">审核表链接</label><input id="wb-feishu-url" class="input" value="${esc(p().feishu?.refined?.url||'')}" placeholder="粘贴飞书表格或知识库链接"><p class="connect-inline">首次使用需登录飞书。${button('connect-open','连接设置','small','data-section="feishu"')}</p>`,button('close-modal','取消')+button('wb-save-feishu','保存并匹配','primary'));
  if(action==='wb-save-feishu'){await ctx.linkFeishu($('#wb-feishu-url').value);ctx.closeModal();await match();}
  return true;
 }
 document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const el of document.querySelectorAll('.wb-expanded')){el.classList.remove('wb-expanded');el.querySelector('[data-action=wb-expand]').textContent='放大对比';}});
 return {home,rows,items,toolbar,setup,refreshFolder:id=>{if(p()?.id!==id)return;for(const el of document.querySelectorAll('[data-folder-setting]'))if(el.dataset.folderSetting===id)el.outerHTML=folderSetup();},upload,restoreUploads:async()=>{await uploadQueue.restore();setTimeout(()=>restoreSyncAccess().catch(e=>ctx.toast(e.message)),0);},syncAccessContext,resumeSyncAccess:async id=>{const t=await syncAccessContext(id);return syncDoc(t.docId,t);},mount,handle,refresh,canDelete,isUploading:projectId=>uploads.some(r=>r.projectId===projectId&&['queued','reading','choice'].includes(r.status)),forget:ids=>{const removed=new Set(ids);const liveFeedback=new Set(S().tasks.filter(t=>!removed.has(t.id)).flatMap(feedbackFor).map(f=>f.id));for(const [id,url] of feedbackImages)if(!liveFeedback.has(id)){URL.revokeObjectURL(url);feedbackImages.delete(id);}for(const id of ids)feedbackOpen.delete(id);for(const id of ids)opened.delete(id);for(const key of previews.keys())if(removed.has(key.split('|')[0]))previews.delete(key);for(let i=uploads.length-1;i>=0;i--)if(removed.has(uploads[i].docId))uploads.splice(i,1);lastPrompt='';}};
}
