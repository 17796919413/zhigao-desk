import {createVideoProcessor} from './video-processing.js';
// 本机 AI 连接：网页长轮询本机连接器（zhigao-connector.mjs），执行 AI 客户端发来的工具调用。
// 用户点“连接”后才开始访问本机；同一浏览器只允许一个标签页连接，避免两份内存状态互相覆盖。
import {createReviewService,canDeepReview} from './review-batch.js';
import {libraryText,effectiveRules,currentRulesText,fbPrompt,parseFbAI} from './brand.js';
import {reviewStagesFor,reviewStatus,pendingCount,flowOf,FLOW_STATES,itemProgress,WAIT,waitingOn} from './model.js';

export const AGENT_PORT=47821;
const HUB=`http://127.0.0.1:${AGENT_PORT}`;
const KEY='zhigao-agent-v1';
export const TOOL_LABELS={zhigao_reopen_review:'继续审核',zhigao_renew_review:'延长审稿时间',zhigao_release_review:'释放审稿',zhigao_update_project:'更新品牌资料与口径',zhigao_publish_feishu_extraction:'生成飞书精炼表',zhigao_extract_feishu:'提炼执行表',zhigao_prepare_feishu_sync:'准备同步核对',zhigao_create_review_batch:'建立审稿批次',zhigao_get_review_batch:'查询审稿批次',zhigao_fail_review:'记录审稿失败',zhigao_status:'查看状态',zhigao_list_tasks:'列出任务',zhigao_get_project:'读取项目规则',zhigao_open_task:'打开稿件',zhigao_get_review_brief:'读取审稿指令',zhigao_read_review_context:'分页读取审稿依据',zhigao_record_review_checks:'保存分批核对',zhigao_submit_review:'提交审稿建议',zhigao_get_feedback_brief:'读取品牌反馈',zhigao_submit_feedback_items:'提交反馈条目'};
const WRITES=new Set(['zhigao_update_project','zhigao_submit_review','zhigao_submit_feedback_items']);

export const agent={state:'off',clients:[],log:[],version:''};
let reviewService=null,videoProcessor=null;
let ctx=null,abort=null,running=false,lockAbort=null;
const pageId=crypto.randomUUID?.()||String(Math.random()).slice(2);
export const agentWanted=()=>{try{return localStorage.getItem(KEY)==='on';}catch{return false;}};
const remember=on=>{try{localStorage.setItem(KEY,on?'on':'off');}catch{}};
const set=(state,extra={})=>{Object.assign(agent,{state},extra);ctx?.changed();};
const sleep=(ms,signal)=>new Promise(r=>{const t=setTimeout(r,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);r();},{once:true});});
async function post(path,data,signal){const r=await fetch(HUB+path,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(data),signal,cache:'no-store'});if(!r.ok)throw Error(`连接器返回 ${r.status}`);return r.json();}

// 飞书读取可由 MCP 发起；写入入口仍仅由网页中的人工确认操作调用。
export async function feishuLocal(action,data={}){
 if(!['status','inspect','read','readAll','write','extract','seed','createRefined'].includes(action))throw Error('未知的飞书操作。');
 let r,p;try{r=await fetch(HUB+'/page/feishu',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({...data,action}),cache:'no-store',credentials:'omit',redirect:'error',...(action==='status'?{signal:AbortSignal.timeout(20000)}:{})});p=await r.json();}
 catch(e){throw Object.assign(Error(e.name==='TimeoutError'?'检查超时，请重试。':'请启动已接入知稿的 AI 客户端，并允许本地网络访问。'),{code:e.name==='TimeoutError'?'FEISHU_NETWORK':'CONNECTOR_OFFLINE'});}
 if(!r.ok||p?.ok!==true)throw Object.assign(Error(p?.error||`飞书连接返回 ${r.status}`),{code:p?.code||(r.status===403?'CONNECTOR_ORIGIN':action==='status'?'CONNECTOR_UPDATE':undefined)});
 return p.data;
}

// ---------- 工具：只读、提交待确认建议；采纳、流转、发送一律留给人 ----------
const S=()=>ctx.state();
const findProject=q=>{const ps=S().settings.projects,p=ps.find(p=>p.id===S().settings.selected);if(!p)throw Error('请选择有效品牌项目。');if(q&&q!==p.id&&q!==p.name)throw Object.assign(Error('请先在网页切换到指定品牌；当前连接只读取选中品牌资料。'),{code:'PROJECT_MISMATCH'});return p;};
const docOf=id=>{const t=S().tasks.find(t=>t.id===id);if(!t)throw Error(`找不到稿件 ${id}，请先调用 zhigao_list_tasks 取得 docId。`);if(t.projectId!==S().settings.selected)throw Object.assign(Error('稿件不属于当前选中品牌。'),{code:'PROJECT_MISMATCH'});return t;};
const canDeep=canDeepReview;
const docRow=t=>{const f=flowOf(t),st=reviewStatus(t);return{docId:t.id,stage:t.stage,format:t.fmt||'text',filename:t.filename||'',round:f.round,flow:FLOW_STATES[f.state]?.label||f.state,pending:st.label,pendingCount:pendingCount(t),aiSuggestions:t.ai?.changes?.length||0,brandFeedbackRounds:f.feedback.length,canDeepReview:canDeep(t),updated:t.updated||''};};
const unpack=v=>typeof v==='string'?v:JSON.stringify(v??'');
const tools={
 zhigao_setup_status:args=>ctx.setupStatus(args),
 zhigao_prepare_video_review:args=>videoProcessor.prepare(args),
 zhigao_get_video_review_status:args=>videoProcessor.status(args),
 zhigao_open_setup:args=>ctx.openSetup(args),
 async zhigao_update_project(args){return await ctx.updateProject(args);},
 async zhigao_extract_feishu({url,createDocument=false,title}={}){const p=findProject();if(!p||p.status==='ended')throw Error('请选择正在执行的品牌项目。');url=url||p.feishu?.source?.url;if(!url)throw Error('请在工作台保存原始表链接，或传入 url。');const projectId=p.id;
  const data=await feishuLocal('extract',{url});const draft=await ctx.saveExtraction(projectId,data);
  const result={ok:true,draftId:draft.id,project:p.name,rows:draft.entries.length,entries:draft.entries,warnings:draft.warnings,location:'工作台 → 飞书同步 → 执行提炼'};
  if(createDocument){try{result.document=await ctx.publishExtraction(draft.id,title);result.message='精炼飞书表已生成并回读核验，链接和表内数据已显示在工作台。';}catch(e){result.ok=false;result.message='提炼已保存，但飞书文档尚未验收：'+e.message;}}
  else {result.message='提炼草稿已保存。请核对名单、字段来源和缺项，再生成精炼表。';result.next='由当前客户端模型复核 entries/evidence，并检查 fieldCandidates 的其他档期与产品来源、sampleDetails 的寄样原文；纯尺码不是产品，寄样记录不等于最终选款。如需调整，将完整 reviewedEntries 随 draftId 交给 zhigao_publish_feishu_extraction。模拟测试到草稿为止。';}return result;},
 async zhigao_publish_feishu_extraction({draftId,title,reviewedEntries}){return {ok:true,document:await ctx.publishExtraction(draftId,title,reviewedEntries)};},
 zhigao_prepare_feishu_sync:()=>ctx.prepareFeishuSync(),
 zhigao_status(){const {settings,tasks,items}=S(),p=findProject();const by={};for(const it of items){const pr=itemProgress(it,tasks.filter(t=>t.itemId===it.id)),w=waitingOn(it,pr);by[WAIT[w]]=(by[WAIT[w]]||0)+1;}
  return{connected:true,protocolVersion:'1.10.0',currentProject:p?.name||'',projects:settings.projects.map(p=>({id:p.id,name:p.name,ended:p.status==='ended'})),tasks:items.length,documents:tasks.length,waiting:by,
   reviewBatches:(S().batches||[]).filter(b=>b.projectId===p?.id).map(b=>({batchId:b.id,project:b.projectName})),next:'批量审稿先调用 zhigao_create_review_batch 锁定当前项目和待审清单。单份可用 zhigao_list_tasks 找稿件（wait:"me" 是待我处理），再用 zhigao_get_review_brief 取审稿指令。'};},
 zhigao_list_tasks({project,wait,search}={}){const {settings,tasks,items}=S(),all=false,p=findProject(project);if(!p)throw Error(`找不到项目 ${project}`);
  const q=String(search||'').trim().toLowerCase(),pn=id=>settings.projects.find(x=>x.id===id)?.name||'';
  return items.filter(it=>all||it.projectId===p.id).map(it=>{const docs=tasks.filter(t=>t.itemId===it.id),pr=itemProgress(it,docs);return{taskId:it.id,project:pn(it.projectId),author:it.author,platform:it.platform,kind:it.kind,title:it.title,currentStage:pr.current,status:pr.label,waitingOn:WAIT[waitingOn(it,pr)],waitKey:waitingOn(it,pr),publishDate:it.publish?.date||'',documents:docs.sort((a,b)=>reviewStagesFor(it.kind).indexOf(a.stage)-reviewStagesFor(it.kind).indexOf(b.stage)).map(docRow)};})
   .filter(r=>(!wait||r.waitKey===wait)&&(!q||[r.author,r.title,r.platform].join(' ').toLowerCase().includes(q)));},
 zhigao_get_project({project,sections}={}){const p=findProject(project);if(!p)throw Error(`找不到项目 ${project}`);
  const fields={notes:()=>p.notes||'',rules:()=>effectiveRules(p),currentRules:()=>currentRulesText(p),library:()=>libraryText(p),libraryEntries:()=>structuredClone(p.library||[]),allRules:()=>structuredClone(p.rules||[]),expected:()=>structuredClone({notes:p.notes||'',library:p.library||[],rules:p.rules||[]})};
  if(sections!==undefined&&(!Array.isArray(sections)||sections.some(k=>!Object.hasOwn(fields,k))))throw Error('sections 含不支持的字段。');
  return {id:p.id,name:p.name,ended:p.status==='ended',precedence:'最新生效口径优先于旧资料；仅适用于当前品牌项目',libraryCount:(p.library||[]).length,ruleCount:effectiveRules(p).length,...Object.fromEntries((sections||['notes','rules','libraryEntries']).map(k=>[k,fields[k]()]))};},
 async zhigao_open_task({docId}){docOf(docId);await ctx.open(docId);return{ok:true,message:'已在用户的工作台上打开这份稿件。'};},
 zhigao_create_review_batch:args=>reviewService.zhigao_create_review_batch(args),
 zhigao_get_review_batch:args=>reviewService.zhigao_get_review_batch(args),
 zhigao_fail_review:args=>reviewService.zhigao_fail_review(args),
 zhigao_reopen_review:args=>reviewService.zhigao_reopen_review(args),
 zhigao_renew_review:args=>reviewService.zhigao_renew_review(args),
 zhigao_release_review:args=>reviewService.zhigao_release_review(args),
 zhigao_get_review_brief:args=>reviewService.zhigao_get_review_brief(args),
 zhigao_read_review_context:args=>reviewService.zhigao_read_review_context(args),
 zhigao_record_review_checks:args=>reviewService.zhigao_record_review_checks(args),
  zhigao_read_review_asset:args=>reviewService.zhigao_read_review_asset(args),
 zhigao_submit_review:args=>reviewService.zhigao_submit_review(args),
 zhigao_get_feedback_brief({docId}){const t=docOf(docId),f=flowOf(t),fb=f.feedback.at(-1);if(!fb)throw Error('这份稿件还没有记录品牌反馈原话。请让用户先在网页上“记录品牌反馈”。');
  const p=S().settings.projects.find(p=>p.id===t.projectId)||findProject();
  return{docId:t.id,round:fb.round,instruction:fbPrompt(fb.text,p,{author:t.author,platform:t.platform,kind:t.kind,stage:t.stage,round:fb.round}),howToSubmit:'整理后调用 zhigao_submit_feedback_items({docId, result})。'};},
 async zhigao_submit_feedback_items({docId,result}){const t=docOf(docId);if(!flowOf(t).feedback.length)throw Error('这份稿件还没有品牌反馈。');
  let list;try{list=parseFbAI(unpack(result));}catch(e){throw Error(`没有导入：${e.message}`);}
  for(const x of list)ctx.addFeedback(t,x);await ctx.save(t);
  return{ok:true,imported:list.length,message:`已导入 ${list.length} 条待确认反馈条目，等用户在网页上逐条确认。`};}
};

async function handle(call){
 const label=TOOL_LABELS[call.name]||call.name,at=new Date().toISOString();
 let res;
 try{const fn=tools[call.name];if(!fn)throw Error(`网页不支持工具 ${call.name}，请刷新工作台到最新版本。`);res={id:call.id,result:await fn(call.args||{})};agent.log.unshift({at,client:call.client,label,ok:true,...(res.result?.savedPath?{path:res.result.savedPath}:{})});}
 catch(e){res={id:call.id,error:e.message||String(e),errorCode:e.code||'REVIEW_ERROR',details:e.details||{}};agent.log.unshift({at,client:call.client,label,ok:false,error:res.error});}
 agent.log.length=Math.min(agent.log.length,30);
 if(WRITES.has(call.name)&&res.result&&!call.args?.dryRun&&res.result.message)ctx.notify(call.name==='zhigao_submit_review'?(call.client||'AI')+' 已提交审稿建议':(call.client||'AI')+' '+res.result.message);
 ctx.changed();
 try{await post('/page/result',res);}catch{}
}

async function loop(signal){
 let hello=true,wait=3000;
 while(!signal.aborted){
  try{const r=await post('/page/poll',{pageId,title:document.title,hello},signal);hello=false;wait=3000;
   set(r.clients?.length?'online':'waiting',{clients:r.clients||[],version:r.version||agent.version});
   for(const c of r.calls||[])await handle(c);}
  catch{if(signal.aborted)break;hello=true;set('offline',{clients:[]});await sleep(wait,signal);wait=Math.min(wait*2,15000);}
 }
}
async function run(){abort=new AbortController();set('connecting');try{await reviewService.recover();await loop(abort.signal);}finally{running=false;}}

export function initAgent(c){ctx=c;videoProcessor=createVideoProcessor(c);reviewService=createReviewService({...c,getVideoAnalysis:t=>videoProcessor.analysis(t),readPreparedVideoAsset:(t,id)=>videoProcessor.readAsset(t,id)});const url=new URL(location.href),requested=url.searchParams.get('connect')==='1';if(requested){url.searchParams.delete('connect');history.replaceState(history.state,'',url);}if(requested||agentWanted())startAgent();}
export async function startAgent(){
 remember(true);if(running)return;running=true;set('connecting');
 if(!navigator.locks)return run();
 lockAbort=new AbortController();
 const got=await navigator.locks.request('zhigao-agent',{ifAvailable:true},async l=>{if(!l)return false;await run();return true;});
 if(got===false&&running){set('other-tab');try{await navigator.locks.request('zhigao-agent',{signal:lockAbort.signal},()=>run());}catch{running=false;}}
}
export function stopAgent(){remember(false);lockAbort?.abort();abort?.abort();running=false;set('off',{clients:[]});}

export const withReviewLock=fn=>reviewService?reviewService.exclusive(fn):fn();
export const forgetReviews=ids=>reviewService?.forget(ids);
export async function createUIReviewBatch(docIds){if(!reviewService)throw Error("工作台尚未就绪，请稍后重试。");return reviewService.zhigao_create_review_batch({docIds});}
