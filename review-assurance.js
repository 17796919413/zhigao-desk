// Review completion is a checked contract, never a promise of semantic correctness.
import {effectiveRules} from './brand.js';
import {scan} from './engine.js';
export const ASSURANCE_VERSION='1.9.0';
export const stableJSON=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export async function digest(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function buildBasisManifest(task,project){
 const sources=[],add=(id,kind,title,text,extra={})=>{const raw=String(text||'');if(!raw.trim())return;const parts=[];for(const match of raw.matchAll(/[^。；;\n]+[。；;\n]?/g)){const value=match[0];for(let offset=0;offset<value.length;offset+=1200){const part=value.slice(offset,offset+1200);if(part.trim())parts.push({text:part,start:match.index+offset,end:match.index+offset+part.length});}}for(const [i,part] of parts.entries())sources.push({id:parts.length===1?id:id+':unit:'+(i+1),sourceId:id,kind,title:parts.length===1?title:title+' · 第'+(i+1)+'项',...part,...extra});};
 add('notes','notes','项目笔记',project.notes);
 for(const [i,d] of (project.library||[]).entries())if(d.active!==false)add('library:'+(d.id||i),d.kind,d.title,d.text,{ingestion:d.ingestion||null,source:d.source||'',updated:d.updated||''});
 for(const [i,f] of (task.flow?.feedback||[]).entries())add('feedback:'+i,'feedback',`第${f.round||1}轮品牌原话`,f.text);
 for(const [i,f] of (task.fbItems||[]).entries())if(f.status!=='draft')add('feedback-item:'+(f.id||i),'feedback-item',`反馈条目（${f.status}）`,f.text,{status:f.status});
 const rules=effectiveRules(project).map(r=>({id:r.id,title:r.title,description:r.description||'',type:r.type,find:r.find||'',replace:r.replace||'',action:r.action||'check',source:r.source||'',updated:r.updated||'',supersedes:r.supersedes||[]}));
 const value={schemaVersion:ASSURANCE_VERSION,projectId:project.id,projectName:project.name,rules,sources};
 const hash=await digest(stableJSON(value));
 return {...value,version:hash.slice(0,16),hash,hasBrandBasis:rules.length>0||sources.some(s=>s.kind!=='notes')};
}
export function assuranceInstruction(manifest){return `审核合同 ${ASSURANCE_VERSION}：必须回传 basis:${JSON.stringify({projectId:manifest.projectId,version:manifest.version,hash:manifest.hash})}。
逐项提交 ruleChecks:[{id,status:"pass|issue|not_applicable|uncertain",reason,evidence:[{blockId,quote} 或 {assetId,detail}]}；全部生效规则都要有结论，无法确认写 uncertain，不得伪造证据。文字 quote 必须原样出现在对应原文里；图片证据引用实际读取的 assetId。
逐项提交 sourceChecks:[{id,status:"checked|uncertain",quote,reason}]。资料按原句和段落拆为必核对单元（保留sourceId和原文位置），每个单元均须明确说明在稿件中如何核对或为何不适用，quote须出自该单元。不得只报整份资料已读或用引用片段代替全文核对。需人工判断的风险在warnings和条目中写明。
素材清单中每项须调用 zhigao_read_review_asset 读取，再提交 mediaChecks:[{assetId,receipt,status:"reviewed|uncertain",summary,findings:[],coverage:"full|sampled"}]。receipt 只证明取到素材，不证明理解正确。不会看图或听音频要如实报告，不得仅凭文件名或OCR声称看过画面。视频必须先完成prepare_video_review的全音轨转写与逐帧准备；prepared-video-frame须全部审阅，frameTimeline说明每帧位置，仅完全相同的解码像素可共用一条画面核对。未完整准备的任意抽帧不能代替全片。转写、OCR和画面必须结合前后时间轴，意见注明时间点，原视频不直接改写。
本次规则及资料清单：${JSON.stringify(manifest)}`;}
export function validateReviewAssurance(data,task,project,parsed,manifest,media={assets:[],blockers:[]},receipts={}){
 const blockingWarnings=[],warnings=[],valid=(x)=>typeof x==='string'&&!!x.trim();
 const block=s=>{if(!blockingWarnings.includes(s))blockingWarnings.push(s);};
 if(!data.basis)block('未回传品牌依据版本。');
 else if(data.basis.projectId!==manifest.projectId||data.basis.hash!==manifest.hash||data.basis.version!==manifest.version)throw Object.assign(Error('品牌或资料版本不匹配，请重新领取审稿指令。'),{code:'BASIS_MISMATCH'});
 if(!manifest.hasBrandBasis)block('品牌资料与有效口径为空，不能确认已按品牌要求审完。');
 for(const s of manifest.sources)for(const b of s.ingestion?.blockers||[])block(`资料「${s.title}」未完整读取：${b}`);
 const cells=new Map((task.cells||[]).map(c=>[c.id,c])),assets=new Map((media.assets||[]).map(a=>[a.id,a]));
 function checks(key,expected,statuses){
  const values=data[key],map=new Map();if(!Array.isArray(values)){if(expected.length)block(`缺少 ${key} 逐项核对记录。`);return map;}
  for(const x of values){if(!x||!expected.some(y=>y.id===x.id)||map.has(x.id)||!statuses.includes(x.status)){block(`${key} 存在未知、重复或无效条目。`);continue;}map.set(x.id,x);}
  for(const x of expected)if(!map.has(x.id))block(`未核对：${x.title||x.id}`);
  return map;
 }
 const ruleChecks=checks('ruleChecks',manifest.rules,['pass','issue','not_applicable','uncertain']);
 const sourceChecks=checks('sourceChecks',manifest.sources,['checked','uncertain']);
 for(const s of manifest.sources){const x=sourceChecks.get(s.id);if(!x)continue;if(x.status!=='checked'||!valid(x.reason)||!valid(x.quote)||!s.text.includes(x.quote))block(`资料「${s.title}」缺少有效阅读证据。`);}
 function evidence(x){return Array.isArray(x.evidence)&&x.evidence.length>0&&x.evidence.every(e=>{
  if(e?.blockId){const c=cells.get(e.blockId);return !!c&&valid(e.quote)&&String(c.current).includes(e.quote);}
  return !!e?.assetId&&assets.has(e.assetId)&&!!receipts[e.assetId]&&valid(e.detail);
 });}
 for(const r of manifest.rules){const x=ruleChecks.get(r.id);if(!x)continue;if(!valid(x.reason)||x.status!=='not_applicable'&&!evidence(x))block(`口径「${r.title}」缺少对应位置与证据。`);if(['issue','uncertain'].includes(x.status))warnings.push(`口径「${r.title}」：${x.reason||'需人工核对'}`);}
 const changes=new Map(parsed.changes.map(c=>[c.id,c.revised]));
 const corrected=(task.cells||[]).map(c=>({...c,original:changes.get(c.id)??c.current}));
 const mechanicalFindings=scan(corrected,effectiveRules(project),task.platform);
 for(const f of mechanicalFindings){
  const rule=manifest.rules.find(r=>r.id===f.rule)||manifest.rules.find(r=>f.rule.startsWith(r.id+'-'));
  if(!rule)continue;const x=ruleChecks.get(rule.id),c=cells.get(f.cellId);
  if(typeof f.replacement==='string'&&f.replacement!==f.original&&!c?.note)block(`可执行修改仍未落实：${rule.title} · ${c?.address||f.cellId||'全文'}`);
  else if(!x||!['issue','uncertain'].includes(x.status)||f.cellId&&!x.evidence?.some(e=>e.blockId===f.cellId))block(`规则仍有命中但未逐位置报告：${rule.title} · ${c?.address||f.cellId||'全文'}`);
 }
 const mediaValues=Array.isArray(data.mediaChecks)?data.mediaChecks:[],mediaChecks=new Map();
 for(const x of mediaValues){if(!x||!assets.has(x.assetId)||mediaChecks.has(x.assetId)){block('素材核对存在未知或重复条目。');continue;}mediaChecks.set(x.assetId,x);}
 for(const a of assets.values()){
  const x=mediaChecks.get(a.id),receipt=receipts[a.id];
  if(!x||!receipt||x.receipt!==receipt.token||x.status!=='reviewed'||!valid(x.summary)||!Array.isArray(x.findings))block(`素材未完整审阅：${a.location||a.id}`);
  if(a.coverage!=='full'||x?.coverage!=='full')block(`素材仅支持抽检或能力未就绪：${a.location||a.id}`);
  if(x?.findings)for(const f of x.findings)if(valid(f))warnings.push(`${a.location||a.id}：${f}`);else block(`素材意见格式不正确：${a.id}`);
 }
 for(const b of media.blockers||[])block(b);
 return {version:ASSURANCE_VERSION,projectRevision:project.date||'',basis:{projectId:manifest.projectId,version:manifest.version,hash:manifest.hash},complete:blockingWarnings.length===0,
  rules:{total:manifest.rules.length,checked:ruleChecks.size},sources:{total:manifest.sources.length,checked:sourceChecks.size},media:{total:assets.size,checked:[...mediaChecks.values()].filter(x=>x.status==='reviewed'&&receipts[x.assetId]?.token===x.receipt).length},
  ruleChecks:[...ruleChecks.values()],sourceChecks:[...sourceChecks.values()],mediaChecks:[...mediaChecks.values()],blockingWarnings,warnings,mechanicalFindings:mechanicalFindings.map(f=>({rule:f.rule,cellId:f.cellId,title:f.title}))};
}
