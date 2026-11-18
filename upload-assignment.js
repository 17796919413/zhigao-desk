import {creatorEvidence,creatorKey,matchUploadedCreator,tasksFromSheets} from './creator-match.js';
import {activityOf,selectedActivity,projectForActivity} from './activities.js';
import {currentDocumentForStage,reviewStagesFor,flowOf,nextRound,newFlow} from './model.js';
import {effectiveRules} from './brand.js';
import {uid,scan} from './engine.js';

const unique=values=>[...new Set(values.map(s=>s.trim()).filter(Boolean))];
const only=values=>unique(values).length===1?unique(values)[0]:'';
export function uploadEvidence(doc){
 const text=(doc.book?.sheets?.flatMap(s=>s.cells)||doc.cells||[]).map(c=>c.current??c.original??'').join('\n');
 const filename=doc.filename.replace(/\.[^.]+$/,'');
 const labeled=label=>[...text.matchAll(new RegExp('(?:^|\\n)\\s*(?:'+label+')\\s*[:：]\\s*([^\\r\\n]+)','g'))].map(m=>m[1]);
 const author=only([...labeled('达人(?:ID|名称|昵称|账号)?|博主(?:名称|昵称)?|作者|账号名称'),...[...filename.matchAll(/[【\[]([^】\]]+)[】\]]/g)].map(m=>m[1])]);
 const platform=only([...filename.matchAll(/抖音|小红书/g)].map(m=>m[0]).concat(labeled('平台|发布平台')));
 const kind=only([...filename.matchAll(/图文|视频/g)].map(m=>m[0]).concat(labeled('形式|内容形式'),doc.fmt==='video'?['视频']:[]));
 const stage=only([...filename.matchAll(/大纲|脚本|初稿/g)].map(m=>m[0]).concat(labeled('阶段|稿件阶段')))||(doc.fmt==='video'?'初稿':'');
 const title=creatorEvidence(doc).contentTitle||filename;
 const version=filename.match(/(?:^|[^a-z])v\s*(\d+)(?:$|[^\d.])/i)?.[1]||filename.match(/第\s*(\d+)\s*[轮版]/)?.[1];
 return {author,platform:['抖音','小红书','其他'].includes(platform)?platform:'',kind:['图文','视频'].includes(kind)?kind:'',stage,title,version:version?Number(version):null};
}

export function uploadProposal(doc,{items,tasks,project,sheets=[],target}={}){
 const e=uploadEvidence(doc),local=items.filter(i=>i.projectId===project.id&&activityOf(i)===selectedActivity(project));
 const found=matchUploadedCreator(doc,local),remote=found.status==='unmatched'?matchUploadedCreator(doc,tasksFromSheets(sheets)):null;
 const hits=target?[local.find(i=>i.id===target.itemId)].filter(Boolean):found.hits.length?found.hits:remote?.hits||[];
 if(target&&!hits.length)throw Error('原内容任务已删除或属于另一活动，请重新上传并选择归属。');
 const matched=target||found.status==='matched'||remote?.status==='matched'?hits[0]:null;
 const choices=[...hits,...local.filter(i=>!hits.some(h=>h.id===i.id))];
 const draft={target:matched?String(choices.indexOf(matched)):found.status==='ambiguous'||remote?.status==='ambiguous'?'':'new',
  author:matched?.author||e.author,platform:matched?.platform||e.platform,kind:matched?.kind||e.kind,title:matched?.title||e.title,stage:target?.stage||e.stage};
 const missing=assignmentIssues(draft,choices);
 if(matched&&e.author&&creatorKey(e.author)!==creatorKey(matched.author))missing.push('稿件作者与指定任务不同，请确认归属');
 if(matched&&e.platform&&e.platform!==matched.platform)missing.push('稿件平台与指定任务不同，请确认归属');
 if(matched&&e.kind&&e.kind!==matched.kind)missing.push('稿件形式与指定任务不同，请确认归属');
 const previous=matched?.id&&currentDocumentForStage(tasks.filter(t=>t.itemId===matched.id),draft.stage);
 if(previous&&!target?.newRound&&e.version!==flowOf(previous).round+1)missing.push('同内容已有稿件，请确认加入新一轮或另建内容');
 return {draft,choices:structuredClone(choices),issues:missing,previous:previous?{id:previous.id,round:flowOf(previous).round}:null};
}

export function assignmentIssues(draft,choices){
 const issues=[],item=draft.target!==''&&draft.target!=='new'?choices[Number(draft.target)]:null;
 if(draft.target===''||draft.target!=='new'&&!item)issues.push('请选择内容归属');
 const values=item?{...draft,author:item.author,platform:item.platform,kind:item.kind,title:item.title}:draft;
 for(const [field,label] of [['author','达人'],['platform','平台'],['kind','形式'],['stage','阶段'],['title','内容标题']])if(!String(values[field]||'').trim())issues.push('请填写'+label);
 if(values.kind&&values.stage&&!reviewStagesFor(values.kind).includes(values.stage))issues.push('图文没有脚本阶段，请选择大纲或初稿');
 if(values.platform&&!['抖音','小红书','其他'].includes(values.platform))issues.push('请选择有效平台');
 if(values.kind&&!['视频','图文'].includes(values.kind))issues.push('请选择有效形式');
 return issues;
}

// Parsed objects stay in memory; the original File and the confirmation form are durable.
export function createUploadQueue(ctx){
 const rows=[];let chain=Promise.resolve();
 const state=ctx.state,notify=()=>ctx.refresh();
 const serialize=row=>{const {doc,issues,previous,...value}=row;return {...value,id:'upload:'+row.id,uploadId:row.id,kind:'pending-upload'};};
 const save=row=>ctx.savePending(serialize(row));
 const project=row=>{const p=state().settings.projects.find(p=>p.id===row.projectId);if(!p||p.status==='ended')throw Error('原品牌已删除或结束，请恢复品牌后重试。');return projectForActivity(p,activityOf(row));};
 const selected=row=>state().settings.selected===row.projectId&&selectedActivity(state().settings.projects.find(p=>p.id===row.projectId))===activityOf(row);
 async function commit(row){
  if(!selected(row))throw Error('品牌或活动已切换，请回到原活动后确认。');
  const doc=row.doc||await ctx.parseFile(row.file),p=project(row),chosen=row.draft.target==='new'?null:row.choices[Number(row.draft.target)];
  let it=chosen?.id?state().items.find(i=>i.id===chosen.id):null;
  if(chosen?.id&&(!it||it.projectId!==row.projectId||activityOf(it)!==activityOf(row)||JSON.stringify(it)!==JSON.stringify(chosen)))throw Error('内容任务信息已变化，请重新读取并确认。');
  if(!it)it=ctx.makeItem({...row.draft,projectId:row.projectId,activityId:activityOf(row),...(chosen||{})});
  if(chosen?.feishu&&!chosen.id)it.feishu=structuredClone(chosen.feishu);
  const previous=currentDocumentForStage(state().tasks.filter(t=>t.itemId===it.id),row.draft.stage),at=new Date().toISOString(),rules=structuredClone(effectiveRules(p));
  if(!selected(row))throw Error('读取期间品牌或活动已切换，请回到原活动后确认。');
  const t={id:uid(),itemId:it.id,projectId:row.projectId,activityId:activityOf(row),projectName:p.name,filename:doc.filename,author:it.author,platform:it.platform,kind:it.kind,stage:row.draft.stage,created:at,updated:at,fmt:doc.fmt,mime:doc.mime,mediaRevision:uid(),buffer:doc.buffer||null,scope:doc.scope||null,cells:doc.cells,rules,notes:p.notes||'',ruleDate:p.date,base:Object.fromEntries(doc.cells.map(c=>[c.id,c.current])),findings:scan(doc.cells,rules,it.platform),ai:null,flow:previous?{...nextRound(previous),feedback:[]}:newFlow(),rounds:[],uploadGroup:row.groupId,originalFile:row.file,
   ...(doc.fmt==='pdf'?{pages:doc.pages,textless:doc.textless,remarks:[]}:{}),...(doc.fmt==='video'?{size:doc.size,duration:doc.duration,width:doc.width,height:doc.height,remarks:[]}:{})};
  const marker={id:'upload:'+row.id,kind:'pending-upload',uploadId:row.id,projectId:row.projectId,activityId:activityOf(row),status:'saved',docId:t.id};
  await ctx.commitUpload([['items',it],['tasks',t],...(doc.fmt==='video'?[['media',{id:t.id,blob:doc.blob}]]:[]),['integrations',marker]],marker.id,()=>{if(!selected(row)||project(row).date!==p.date)throw Error('保存期间活动或品牌依据已变化，请重新确认。');});
  row.status='saved';row.docId=t.id;delete row.doc;delete row.file;
  // Keep the small completion marker: another tab must never recreate this upload.
  try{await ctx.archiveOriginal(t);}catch{/* Delivery shows archive failure and resumes later. */}
 }
 async function prepare(row){
  row.status='reading';notify();
  try{
   const doc=await ctx.parseFile(row.file);row.doc=doc;
   if(!doc.cells.length&&!['xlsx','docx','pdf','video','image','office-pending','pptx'].includes(doc.fmt))throw Error('文件没有可审稿的文字。');
   const p=project(row),proposal=uploadProposal(doc,{items:state().items,tasks:state().tasks,project:p,target:row.target});
   // Uncertain imports are independent drafts, never accidental revisions of another task.
   if(row.target&&proposal.issues.some(issue=>issue.includes('与指定任务不同')))throw Error('稿件与指定任务不同，请从工作台单独投入。');
   Object.assign(row,proposal.issues.length&&!row.target?{draft:{...uploadEvidence(doc),target:'new'},choices:[]}:proposal);
   await commit(row);
  }catch(e){row.status='failed';row.error=e.message;try{await save(row);}catch{row.error+='；浏览器未保存此文件，请保留原件后重试';}}
  notify();
 }
 function enqueue(fn){const run=chain.then(fn);chain=run.catch(e=>ctx.toast(e.message));return run;}
 return {rows,
  upload(files,options={}){const p=state().settings.projects.find(p=>p.id===state().settings.selected),groupId=uid();const added=[...files].map(file=>({id:uid(),projectId:p.id,activityId:selectedActivity(p),groupId,name:file.name,file,status:'queued',target:options.target}));rows.push(...added);notify();return enqueue(async()=>{for(const row of added){try{await save(row);await prepare(row);}catch(e){row.status='failed';row.error='上传尚未保存：'+e.message;notify();}}});},
  async restore(){for(const stored of await ctx.loadPending()){if(stored.status==='saved'||rows.some(r=>r.id===stored.uploadId&&r.projectId===stored.projectId))continue;rows.push({...stored,id:stored.uploadId,status:'failed',error:stored.error||'上次上传未完成，可重新读取原件'});}notify();},
  retry(id){return enqueue(async()=>{const row=rows.find(r=>r.id===id);if(row&&row.file){await save(row);await prepare(row);}});},
  cancel(id){return enqueue(async()=>{const row=rows.find(r=>r.id===id);if(!row||['reading','saved'].includes(row.status))return;await ctx.removePending('upload:'+id);rows.splice(rows.indexOf(row),1);notify();});}
 };
}
