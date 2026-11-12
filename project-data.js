import {DOC_KINDS} from './brand.js';

const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const sameData = (a, b) => stable(a) === stable(b);
export const projectSnapshot = p => structuredClone({notes:p.notes||'', library:p.library||[], rules:p.rules||[]});
// A name is not an identity. Conflicting source versions stay in a separate project.
export function planProjectImport(existing,incoming,makeId=()=>crypto.randomUUID()){
 const projects=structuredClone(existing),mapping=new Map(),conflicts=[];
 for(const p of incoming){const same=projects.find(x=>x.id===p.id),named=projects.some(x=>x.name===p.name);
  if(same&&same.name===p.name&&sameData(projectSnapshot(same),projectSnapshot(p))){mapping.set(p.id,same.id);continue;}
  const clash=!!same||named,id=same?makeId():p.id,name=clash?p.name+'（交接资料副本）':p.name;
  if(clash)conflicts.push({sourceId:p.id,name:p.name,newId:id});
  projects.push({...structuredClone(p),id,name,status:p.status||'active'});mapping.set(p.id,id);
 }
 return {projects,mapping,conflicts};
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const revision = item => {const {history, ...previous}=item; return [...(history||[]), previous];};
const content = item => {const {history,updated,created,...rest}=item;return rest;};

// Build a candidate without mutating live data; validation errors discard the entire batch.
export function prepareProjectUpdate(project, args) {
  if (!['notes','library','rules'].some(k => own(args,k))) throw Error('请提供资料或口径。');
  const p=structuredClone(project), snapshot=projectSnapshot(project), now=new Date().toISOString();
  if(args.expected!==undefined){
    if(!args.expected||typeof args.expected!=='object'||Array.isArray(args.expected))throw Error('写前数据格式不正确。');
    for(const k of Object.keys(snapshot))if(own(args.expected,k)&&!sameData(args.expected[k],snapshot[k]))throw Error('项目资料已变化，请重新读取后保存。');
  }
  if(own(args,'notes')){
    if(typeof args.notes!=='string'||args.notes.length>200000)throw Error('笔记需为文本，且不超过20万字。');
    p.notes=args.notes;
  }
  const added=[],updated=[],unchanged=[];
  for(const key of ['library','rules']){
    if(!own(args,key))continue;
    if(!Array.isArray(args[key]))throw Error('资料和口径需使用条目列表。');
    p[key] ||= [];
    const seen=new Set();
    for(const raw of args[key]){
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('条目格式不正确。');
      if(raw.id!==undefined&&(typeof raw.id!=='string'||!raw.id))throw Error('条目 id 不正确。');
      if(raw.id&&seen.has(raw.id))throw Error('同一条目不能重复更新。');
      if(raw.id)seen.add(raw.id);
      const title=typeof raw.title==='string'?raw.title.trim():'';
      if(!title)throw Error('请填写标题。');
      let old=raw.id?p[key].find(x=>x.id===raw.id):null;
      if(raw.id&&!old)throw Error('需要更新的条目已不存在。');
      for(const flag of ['active','enabled','allowDuplicate'])if(own(raw,flag)&&typeof raw[flag]!=='boolean')throw Error('启用状态需为布尔值。');
      let fields;
      if(key==='library'){
        if(typeof raw.text!=='string'||!raw.text.trim())throw Error('资料正文不能为空。');
        if(old?.ingestion?.externalText&&raw.text!==old.text&&(raw.ingestion?.textHash??old.ingestion.textHash)===old.ingestion.textHash)throw Error('文件资料正文来自原件，请重新导入文件更新，不能只改摘要。');
        if(!DOC_KINDS.includes(raw.kind))throw Error('请选择资料类型。');
        fields={title,kind:raw.kind,text:raw.text,source:raw.source===undefined?(old?.source||''):String(raw.source).slice(0,500),active:raw.active??old?.active??true};
        if(raw.ingestion!==undefined){if(!raw.ingestion||typeof raw.ingestion!=='object'||!Array.isArray(raw.ingestion.blockers)||raw.ingestion.blockers.some(x=>typeof x!=='string'))throw Error('资料读取清单无效。');fields.ingestion=structuredClone(raw.ingestion);}
      }else{
        if(typeof raw.description!=='string'||!raw.description.trim())throw Error('请填写完整口径。');
        if(raw.supersedes!==undefined&&(!Array.isArray(raw.supersedes)||raw.supersedes.some(x=>typeof x!=='string')))throw Error('替代关系格式不正确。');
        if(raw.action!==undefined&&!['check','replace'].includes(raw.action))throw Error('文字检查方式不正确。');
        fields={title,description:raw.description.trim(),enabled:raw.enabled??old?.enabled??true,
          type:old?.type||'custom',find:raw.find??old?.find??'',replace:raw.replace??old?.replace??'',
          action:raw.action??old?.action??'check',source:raw.source===undefined?(old?.source||''):String(raw.source).slice(0,500),
          supersedes:[...new Set(raw.supersedes??old?.supersedes??[])]};
        if(typeof fields.find!=='string'||typeof fields.replace!=='string')throw Error('查找词和替换内容需为文本。');
        if(fields.find)fields.type='custom';
        // A changed prose-only built-in must not continue scanning with its old hardcoded behavior.
        if(old?.type==='builtin'&&!fields.find&&fields.description!==old.description)fields.type='custom';
        if(fields.action==='replace'&&!fields.find)throw Error('建议替换需填写查找词。');
      }
      if(!old){
        const matches=p[key].filter(x=>x.title===title);
        const identical=matches.find(x=>Object.entries(fields).every(([k,v])=>sameData(x[k]??(k==='supersedes'?[]:k==='find'||k==='replace'||k==='source'?'':k==='action'?'check':undefined),v)));
        if(identical&&!raw.allowDuplicate){unchanged.push(identical.id);continue;}
        if(matches.length&&!raw.allowDuplicate)throw Error('已有同名条目，请按 id 更新或选择新增一份。');
      }
      const next={...(old||{}),...fields,id:old?.id||(key==='rules'?'custom-':'')+crypto.randomUUID()};
      if(old&&sameData(content(old),content(next))){unchanged.push(old.id);continue;}
      next.updated=now;
      if(old)next.history=revision(old);else next.created=now;
      if(old){p[key][p[key].indexOf(old)]=next;updated.push(next.id);}else{p[key].push(next);added.push(next.id);}
    }
  }
  const byId=new Map((p.rules||[]).map(r=>[r.id,r])),done=new Set(),visiting=new Set();
  function visit(id){
    if(visiting.has(id))throw Error('口径替代关系不能形成循环。');
    if(done.has(id))return;
    const r=byId.get(id);if(!r)throw Error('被替代的口径已不存在。');
    visiting.add(id);for(const prev of r.supersedes||[])visit(prev);visiting.delete(id);done.add(id);
  }
  for(const id of byId.keys())visit(id);
  const changed=!sameData(snapshot,projectSnapshot(p));
  if(changed)p.date=now;
  return {project:p,added,updated,unchanged,changed};
}

// Commit synchronously and publish to memory only after reading the exact stored value.
export function persistProjectUpdate(settings, next, storage=localStorage) {
  const key='zhigao-settings-v1', before=storage.getItem(key), saved=before?JSON.parse(before):null;
  const current=settings.projects.find(p=>p.id===next.id), persisted=saved?.projects?.find(p=>p.id===next.id);
  if(saved&&(!persisted||!sameData(projectSnapshot(current),projectSnapshot(persisted))))throw Error('项目资料已变化，请刷新后保存。');
  const candidate=structuredClone(saved||settings);
  candidate.selected=settings.selected;
  const index=candidate.projects.findIndex(p=>p.id===next.id);
  candidate.projects[index]={...candidate.projects[index],...projectSnapshot(next),...(next.date?{date:next.date}:{})};
  const serialized=JSON.stringify(candidate);let wrote=false;
  try{
    storage.setItem(key,serialized);wrote=true;
    if(storage.getItem(key)!==serialized)throw Error('保存后读取不一致');
  }catch(e){
    if(wrote)try{if(before===null)storage.removeItem(key);else storage.setItem(key,before);}catch{throw Error('保存未完成，请刷新页面核对资料。');}
    throw Error('保存失败，请释放浏览器存储空间后重试。');
  }
  return candidate;
}
