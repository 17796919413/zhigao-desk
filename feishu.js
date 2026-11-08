// 飞书表格：链接校验、粘贴表格解析、字段自动对应、任务与行匹配、同步核对。纯函数，不访问网络。
// 生成待人工确认的同步差异；反馈仅可更新本机上次写入且未被他人修改的值。
import {reviewStagesFor,flowOf} from './model.js';
const TAB=String.fromCharCode(9),NL=String.fromCharCode(10),CR=String.fromCharCode(13);

// 只接受飞书 / Lark 的 https 链接，避免把任意网页嵌进工作台。
export function parseFeishuUrl(raw){const s=String(raw||'').trim();if(!s)return null;let u;try{u=new URL(s);}catch{return{error:'链接格式不对。'};}if(u.protocol!=='https:'||!/(^|\.)(feishu\.cn|larksuite\.com|feishu\.net)$/i.test(u.hostname))return{error:'只支持 feishu.cn 或 larksuite.com 的 https 链接。'};const m=u.pathname.match(/^\/(wiki|sheets|base|docx|docs)\/([A-Za-z0-9]+)/);if(!m)return{error:'不是飞书表格或知识库链接。'};return{url:u.href,host:u.hostname,type:m[1],token:m[2],sheet:u.searchParams.get('sheet')||''};}

// 从飞书 / Excel 复制出来的是制表符分隔，单元格里有换行时会带引号；也兼容逗号分隔。
export function parseTable(text){
 const t=String(text||'').split(CR+NL).join(NL).split(CR).join(NL),d=t.includes(TAB)?TAB:',',rows=[];let row=[],cell='',q=false;
 for(let i=0;i<t.length;i++){const ch=t[i];if(q){if(ch==='"'){if(t[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=ch;}else if(ch==='"'&&cell==='')q=true;else if(ch===d){row.push(cell);cell='';}else if(ch===NL){row.push(cell);rows.push(row);row=[];cell='';}else cell+=ch;}
 row.push(cell);rows.push(row);
 const clean=rows.map(r=>r.map(c=>c.trim())).filter(r=>r.some(Boolean)),hi=clean.findIndex(r=>r.filter(Boolean).length>=2);
 if(hi<0)return{headers:[],rows:[]};
 const headers=clean[hi],w=Math.max(headers.length,...clean.map(r=>r.length));
 return{headers:[...headers,...Array(w-headers.length).fill('')],rows:clean.slice(hi+1).map(r=>[...r,...Array(w-r.length).fill('')])};
}

export const FIELDS=[
 {k:'author',label:'达人',need:true},{k:'platform',label:'发布平台'},{k:'kind',label:'内容形式'},{k:'type',label:'达人类型 / 方向'},{k:'title',label:'内容标题 / 产品'},{k:'date',label:'发布档期'},
 {k:'outline',label:'大纲'},{k:'script',label:'脚本'},{k:'draft',label:'初稿'},{k:'publish',label:'发布情况'},{k:'feedback',label:'品牌方反馈'},{k:'owner',label:'内容负责人'}
];
const SYN={author:['达人','达人名称','达人昵称','达人id','达人账号','博主','kol','账号'],platform:['发布平台','平台'],kind:['内容形式','形式','内容类型','稿件类型'],type:['达人类型','达人方向','方向','账号类型','达人分类'],title:['内容标题','标题','主题','选题','内容方向','合作产品','产品','寄品'],date:['发布档期','发布日期','发布时间','档期','排期'],outline:['大纲'],script:['脚本'],draft:['初稿'],publish:['发布情况','发布链接','发布状态','抖红发布情况'],feedback:['品牌方反馈','品牌反馈','甲方反馈','客户反馈'],owner:['内容负责人','内容侧负责人','负责人']};
const normHead=h=>String(h||'').replace(/[\s*＊:：()（）【】\[\]]/g,'').toLowerCase();
// 每个字段挑得分最高的列，每列只用一次；“达人类型”不能当成达人或内容形式。
export function autoMap(headers){
 const cand=[];
 for(const f of Object.keys(SYN))headers.forEach((h,i)=>{const n=normHead(h);if(!n)return;const exact=SYN[f].indexOf(n);let score=exact>=0?100-exact:0;if(!score&&SYN[f].some(s=>s.length>=2&&n.includes(s))){if((f==='kind'||f==='title')&&n.includes('达人'))return;if(f==='author'&&/类型|方向/.test(n))return;score=10;}if(score)cand.push({f,i,score});});
 cand.sort((a,b)=>b.score-a.score||a.i-b.i);
 const map=Object.fromEntries(Object.keys(SYN).map(f=>[f,-1])),used=new Set();
 for(const c of cand)if(map[c.f]<0&&!used.has(c.i)){map[c.f]=c.i;used.add(c.i);}
 return map;
}
export const cellOf=(row,map,f)=>map&&map[f]>=0?String(row[map[f]]??'').trim():'';

export const normName=s=>String(s||'').replace(/[\s@＠·・]/g,'').toLowerCase();
export function platformsOf(cell){const s=String(cell||'').trim(),out=[];if(!s)return out;if(/抖音|douyin|抖红|^dy$/i.test(s))out.push('抖音');if(/小红书|红书|xhs|抖红/i.test(s))out.push('小红书');return out.length?out:['其他'];}
export function kindOf(cell){const s=String(cell||'');return/图文/.test(s)?'图文':/视频|口播|vlog/i.test(s)?'视频':'';}
// 支持 2026-11-20、2026/11/20、11.20、11/20、11月20日；年份缺省用今年。
export function dateISO(cell,year=new Date().getFullYear()){const s=String(cell||'').trim();let m=s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);if(!m){const k=s.match(/(?:^|\D)(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?:\D|$)/);if(k)m=[0,year,k[1],k[2]];}if(!m)return'';const y=+m[1],mo=+m[2],d=+m[3];if(mo<1||mo>12||d<1||d>31)return'';return`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
const monthDay=s=>{const v=dateISO(s,2000);return v?v.slice(5):'';};

// 绑定按“达人 | 平台 | 标题”识别行，不按行号（行号会因增删行变化）。
export function rowKey(sheet,i){const r=sheet.rows[i]||[];return[normName(cellOf(r,sheet.map,'author')),normName(cellOf(r,sheet.map,'platform')),normName(cellOf(r,sheet.map,'title'))].join('|');}
export function locate(sheet,b){if(!sheet||!b)return{row:null,why:'missing'};const hit=sheet.rows.map((_,i)=>i).filter(i=>rowKey(sheet,i)===b.key);if(hit.length===1)return{row:hit[0]};if(hit.length>1)return{row:null,why:'ambiguous'};return{row:null,why:'notfound'};}
export function candidates(item,sheets){
 const ni=normName(item.author),nt=normName(item.title),out=[];if(!ni)return out;
 for(const s of sheets){if(!s.map||s.map.author<0)continue;s.rows.forEach((r,i)=>{const na=normName(cellOf(r,s.map,'author'));if(!na)return;const exact=na===ni;if(!exact&&!(ni.length>=2&&na.includes(ni))&&!(na.length>=2&&ni.includes(na)))return;if(s.map.platform>=0){const ps=platformsOf(cellOf(r,s.map,'platform'));if(ps.length&&!ps.includes(item.platform))return;}const ct=normName(cellOf(r,s.map,'title'));const tb=nt&&ct&&(ct.includes(nt)||nt.includes(ct))?1:0;out.push({sheetId:s.id,sheet:s.name,row:i,author:cellOf(r,s.map,'author'),platform:cellOf(r,s.map,'platform'),title:cellOf(r,s.map,'title'),score:(exact?2:1)+tb});});}
 return out.sort((a,b)=>b.score-a.score);
}

const STAGE_FIELD={outline:'大纲',script:'脚本',draft:'初稿'};
export const SYNC_FIELDS=['outline','script','draft','date','publish','feedback'];
// 工作台这一侧“应该是什么”：✅ 只来自人工记录的品牌通过；图文没有脚本记为“/”。
export function itemValues(item,docs){
 const v={};
 for(const [f,stage] of Object.entries(STAGE_FIELD)){if(!reviewStagesFor(item.kind).includes(stage)){v[f]='/';continue;}const d=docs.filter(x=>x.stage===stage).sort((a,b)=>String(b.updated).localeCompare(String(a.updated)))[0];v[f]=d&&flowOf(d).state==='passed'?'✅':d?.ai?'AI已审 · '+d.ai.changes.length+'处修改 · 待复核':'';}
 const pb=item.publish||{};v.date=pb.date||'';v.publish=pb.status==='已发布'?'✅':'';
 const fb=docs.flatMap(d=>(d.fbItems||[]).filter(x=>x.status==='done'&&String(x.text||'').trim()).map(x=>({...x,stage:d.stage}))).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
 v.feedback=fb.map(x=>`【${x.stage}】${x.text}`).join('；');v.feedbackText=fb.map(x=>x.text).join('；');
 return v;
}
export function compareCell(f,feishu,ours,raw=''){
 const x=String(feishu||'').trim(),o=String(ours||'');
 if(STAGE_FIELD[f]){if(!o){if(!x)return{status:'skip'};if(x==='✅')return{status:'conflict',note:'飞书已标“✅”，工作台还没记录品牌通过'};if(x==='/')return{status:'conflict',note:'飞书标“/”（没有这个阶段），但按内容形式这个阶段适用'};return{status:'skip',note:`飞书为“${x}”`};}if(x===o)return{status:'same'};if(!x)return{status:'update'};return{status:'conflict',note:`飞书为“${x}”`};}
 if(!o)return{status:'skip'};if(!x)return{status:'update'};
 if(f==='date')return monthDay(x)&&monthDay(x)===monthDay(o)?{status:'same'}:{status:'conflict',note:`飞书为“${x}”`};
 if(f==='feedback')return x===o||raw&&x.includes(raw)?{status:'same'}:{status:'conflict',note:'飞书里已有其他反馈内容，请人工合并'};
 return x===o||x.includes(o)?{status:'same'}:{status:'conflict',note:`飞书为“${x}”`};
}
// 汇总所有已绑定任务的核对结果；多个任务共用一行且数值不同时，一律改为人工确认。
export function buildPlan(list,docsOf,sheets){
 const entries=[];
 for(const it of list){const b=it.feishu;if(!b)continue;const s=sheets.find(x=>x.id===b.sheetId);if(!s){entries.push({it,error:'子表快照已删除，请重新绑定'});continue;}const loc=locate(s,b);if(loc.row==null){entries.push({it,sheet:s,error:loc.why==='ambiguous'?'快照里有多行同名记录，请重新绑定':'在最新快照里找不到这一行（可能改了名或删除了），请重新绑定'});continue;}const v=itemValues(it,docsOf(it)),r=s.rows[loc.row],cells=[];for(const f of SYNC_FIELDS){if(s.map[f]<0)continue;const feishu=r[s.map[f]]||'',c=compareCell(f,feishu,v[f],f==='feedback'?v.feedbackText:'');cells.push({f,header:s.headers[s.map[f]],feishu,ours:v[f],...c});}entries.push({it,sheet:s,row:loc.row,cells});}
 // 只有连接器提供的最近写入历史与在线值完全一致，反馈格才允许进入人工确认的覆盖计划。
 for(const e of entries)if(e.cells&&e.sheet.live)for(const c of e.cells){
  if(!['feedback','outline','script','draft'].includes(c.f)||c.status!=='conflict'||!c.ours)continue;
  const history=(e.sheet.writeHistory||[]).findLast(h=>h.key===rowKey(e.sheet,e.row)&&h.header===c.header);
  if(history&&history.value===c.feishu){c.status='update';c.expected=c.feishu;c.note='更新本机上次写入的反馈；写前还会回读核对';}
 }
 // 分组时把“工作台这边为空”的也算进去：一行对应多个任务、各自进度不同，就不能拿其中一个去写。
 const seen=new Map();for(const e of entries)if(e.cells)for(const c of e.cells){const k=`${e.sheet.id}|${e.row}|${c.f}`;(seen.get(k)||seen.set(k,[]).get(k)).push(c);}
 for(const group of seen.values())if(group.length>1&&new Set(group.map(c=>c.ours)).size>1)for(const c of group)if(c.status!=='skip'||c.ours){c.status='conflict';c.note=`共用这一行的 ${group.length} 个任务数值不同`;}
 return entries;
}
// 粘贴回飞书用：制表符分隔，含换行或引号的单元格加引号。
export const toTSV=rows=>rows.map(r=>r.map(c=>{const s=String(c??'');return/[\t\n"]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}).join(TAB)).join(NL);
