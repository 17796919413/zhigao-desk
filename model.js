// 阶段、状态与送审流转的纯函数，不依赖页面。视频有脚本，图文没有；“发布”不是审稿阶段。
export const STAGES={'视频':['大纲','脚本','初稿','发布'],'图文':['大纲','初稿','发布']};
export const reviewStagesFor=kind=>(STAGES[kind]||STAGES['视频']).filter(s=>s!=='发布');
export const pendingRules=t=>(t.findings||[]).filter(f=>f.status==='pending').length;
export const pendingAI=t=>(t.ai?.changes||[]).filter(x=>x.status==='pending').length;
// PDF 和视频稿件用人工意见（remarks）代替逐字改稿。
export const pendingNotes=t=>(t.remarks||[]).filter(n=>n.status==='open').length;
export const pendingCount=t=>pendingRules(t)+pendingAI(t)+pendingNotes(t);
export function reviewStatus(t){const r=pendingRules(t),a=pendingAI(t),n=pendingNotes(t),parts=[];if(r)parts.push(`规则 ${r}`);if(a)parts.push(`AI ${a}`);if(n)parts.push(`意见 ${n}`);return parts.length?{label:`待确认：${parts.join(' · ')}`,tone:'amber'}:{label:t.remarks?'意见均已处理':'规则与 AI 建议均已处理',tone:''};}
// 送审流转：内部复核完成不等于品牌通过，只有人工记录“品牌通过”才进入 passed。
export const FLOW_STATES={
 review:{label:'审核复核中',tone:'amber',hint:'处理规则与 AI 建议，并人工通读修改稿；确认没问题后点“复核完成”。'},
 ready:{label:'待交品牌',tone:'amber',hint:'导出稿件发给品牌方，然后记录提交。'},
 brand:{label:'品牌审核中',tone:'gray',hint:'等待品牌方反馈。'},
 revise:{label:'待达人修改',tone:'red',hint:'品牌有修改意见。请反馈达人，收到新版后点“收到新版，开始下一轮”上传。'},
 passed:{label:'该阶段品牌通过',tone:'dark',hint:'品牌已通过这一版，等待下一阶段稿件。'}
};
export const newFlow=(round=1)=>({state:'review',round,submissions:[],feedback:[],log:[]});
export const flowOf=t=>t.flow||newFlow();
const logFlow=(f,text)=>f.log.push({at:new Date().toISOString(),text});
const FLOW_FROM={ready:'review',submit:'ready',feedback:'brand',pass:'brand',undo:'passed'};
export function applyFlow(task,kind,{note='',text='',fp='',changed=0,exportedAt=null}={}){
 const f=task.flow||(task.flow=newFlow()),from=FLOW_FROM[kind];
 if(!from)throw Error('未知的流转操作。');
 if(f.state!==from)throw Error('当前状态不能执行这个操作，请重新打开稿件后再试。');
 const at=new Date().toISOString(),R=`第 ${f.round} 轮`,N=note?`：${note}`:'';
 if(kind==='ready'){f.state='ready';logFlow(f,`${R} 内部复核完成${N}`);}
 else if(kind==='submit'){f.state='brand';f.submissions.push({at,round:f.round,fp,changed,exportedAt,note});logFlow(f,`${R} 记录已提交品牌（人工发送）${N}`);}
 else if(kind==='feedback'){if(!text.trim())throw Error('请先粘贴品牌反馈原话。');f.state='revise';f.feedback.push({at,round:f.round,text:text.trim()});logFlow(f,`${R} 品牌要求修改，已记录原话`);}
 else if(kind==='pass'){f.state='passed';f.passedFp=f.submissions.at(-1)?.fp||null;f.passedAt=at;logFlow(f,`${R} 品牌明确通过${N}`);}
 else{f.state='brand';f.passedFp=null;f.passedAt=null;logFlow(f,`${R} 撤销“品牌通过”，回到品牌审核中${N}`);}
 return f;
}
// 补充品牌反馈：任何状态下都可追加原话，不改变送审状态（例如上传新版后品牌又补了意见）。
export function addFeedbackNote(task,text){const s=String(text||'').trim();if(!s)throw Error('请先粘贴品牌反馈原话。');const f=task.flow||(task.flow=newFlow()),at=new Date().toISOString();f.feedback.push({at,round:f.round,text:s,extra:true});logFlow(f,`第 ${f.round} 轮 补充品牌反馈原话`);return f;}
export function nextRound(prev){const f=flowOf(prev),n=newFlow(f.round+1);n.submissions=f.submissions;n.feedback=f.feedback;n.log=[...f.log];logFlow(n,`收到达人新版，开始第 ${n.round} 轮`);return n;}
// 内容任务 = 一个达人在一个平台的一篇内容。发布信息记在任务上，品牌通过不等于已发布。
export const PUBLISH_STATES=['待排期','已排期','已发布'];
export const PUBLISH_TONE={'待排期':'amber','已排期':'gray','已发布':'dark'};
// 进度以最后一个有稿件的阶段为准；更早且没有稿件的阶段记为“未记录”，不算待办。
export function itemProgress(item,docs){
 const stages=reviewStagesFor(item.kind).map(name=>{const doc=docs.filter(d=>d.stage===name).sort((a,b)=>String(b.updated).localeCompare(String(a.updated)))[0]||null;return{name,doc,state:doc?flowOf(doc).state:'none'};});
 let last=-1;stages.forEach((s,k)=>{if(s.doc)last=k;});
 const at=last<0?0:stages[last].state==='passed'?last+1:last;
 if(at>=stages.length){const ps=item.publish?.status||'待排期';return{stages,current:'发布',state:'publish',label:ps,tone:PUBLISH_TONE[ps]||'amber',doc:null};}
 const s=stages[at];return{stages,current:s.name,state:s.state,label:s.doc?FLOW_STATES[s.state].label:'等达人来稿',tone:s.doc?FLOW_STATES[s.state].tone:'gray',doc:s.doc};
}
// 这一步在等谁：首页按它分组。发布阶段已排期也算“我”，因为发布要人去盯。
export const WAIT={me:'待我处理',brand:'等品牌反馈',creator:'等达人稿件',publish:'待发布',done:'已完成'};
export function waitingOn(item,pr){if(pr.state==='review'||pr.state==='ready')return'me';if(pr.state==='brand')return'brand';if(pr.state==='none'||pr.state==='revise')return'creator';if(pr.state==='publish')return(item.publish?.status||'待排期')==='已发布'?'done':'publish';return'me';}
// 发布档期距今天数（本地日期）；未排期、已发布返回 null。
export function daysToPublish(item,today=new Date()){const d=item.publish?.date;if(!d||(item.publish?.status==='已发布'))return null;const m=String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;const t=new Date(+m[1],+m[2]-1,+m[3]),z=new Date(today.getFullYear(),today.getMonth(),today.getDate());return Math.round((t-z)/864e5);}
export const dueLabel=n=>n==null?'':n<0?`已过档期 ${-n} 天`:n===0?'今天发布':n===1?'明天发布':`${n} 天后发布`;
// 品牌反馈清单里还没处理的条目（不含待确认的草稿）。
export const openFeedback=docs=>docs.reduce((a,d)=>a+(d.fbItems||[]).filter(x=>x.status==='open').length,0);
// 列表筛选：状态（等谁）、平台、形式、当前阶段、档期临近；任一条件为空表示不限。
export function matchFilter(item,pr,f,today=new Date()){if(f.wait&&waitingOn(item,pr)!==f.wait)return false;if(f.platform&&item.platform!==f.platform)return false;if(f.kind&&item.kind!==f.kind)return false;if(f.type&&(item.type||'')!==f.type)return false;if(f.stage&&pr.current!==f.stage)return false;if(f.due){const n=daysToPublish(item,today);if(n==null||n>Number(f.due))return false;}return true;}
