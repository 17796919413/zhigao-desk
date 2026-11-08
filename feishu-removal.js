const workbook=url=>{try{const u=new URL(url);return u.origin+u.pathname.replace(/\/$/,'');}catch{return '';}};
export const sameWorkbook=(a,b)=>!!workbook(a)&&workbook(a)===workbook(b);

export function planFeishuRemoval(project,items,extractions,{kind,id}={}){
 if(!['source','refined','extraction'].includes(kind))throw Error('请选择要移除的表。');
 const p=structuredClone(project),F=p.feishu||{source:null,refined:null,sheets:[]},removed=new Set();p.feishu=F;
 const selected=kind==='extraction'?extractions.find(d=>d.id===id&&d.projectId===p.id):null;
 if(kind==='extraction'&&!selected)throw Error('提炼记录已不存在。');
 const url=kind==='extraction'?selected.document?.url:F[kind]?.url;
 if(kind!=='extraction'&&!url)throw Error('这张表已经移除。');
 if(selected)removed.add(selected.id);
 for(const d of extractions.filter(d=>d.projectId===p.id)){
  if(kind==='source'&&sameWorkbook(d.sourceUrl,url))removed.add(d.id);
  if(kind==='refined'&&sameWorkbook(d.document?.url,url))removed.add(d.id);
 }
 const removeRefined=kind==='refined'||(kind==='extraction'&&sameWorkbook(F.refined?.url,url));
 if(kind==='source')F.source=null;
 const sheetIds=new Set();
 if(removeRefined){
  for(const s of F.sheets||[])if(sameWorkbook(s.sourceUrl,url)||(!s.sourceUrl&&s.live))sheetIds.add(s.id);
  F.refined=null;F.sheets=(F.sheets||[]).filter(s=>!sheetIds.has(s.id));delete F.liveMeta;
 }
 const changedItems=items.filter(i=>i.projectId===p.id&&sheetIds.has(i.feishu?.sheetId)).map(i=>{const next=structuredClone(i);delete next.feishu;return next;});
 return {project:p,removedIds:[...removed],changedItems,removeRefined};
}

export async function commitFeishuRemoval(settings,plan,persist,storage=localStorage){
 const key='zhigao-settings-v1',before=storage.getItem(key),disk=before?JSON.parse(before):settings;
 const old=settings.projects.find(p=>p.id===plan.project.id),stored=disk.projects.find(p=>p.id===old.id);
 if(!stored||JSON.stringify(stored.feishu)!==JSON.stringify(old.feishu))throw Error('表格链接已变化，请刷新后重试。');
 const next=structuredClone(disk);next.selected=settings.selected;
 next.projects.find(p=>p.id===old.id).feishu=plan.project.feishu;
 const encoded=JSON.stringify(next);let wrote=false;
 try{
  storage.setItem(key,encoded);wrote=true;if(storage.getItem(key)!==encoded)throw Error('保存失败。');
  await persist(plan);
 }catch(e){
  if(wrote){if(storage.getItem(key)!==encoded)throw Error('移除未完成，请刷新页面核对。');try{if(before===null)storage.removeItem(key);else storage.setItem(key,before);}catch{throw Error('移除未完成，请刷新页面核对。');}}
  throw Error('移除失败，请重试。');
 }
 return next;
}
