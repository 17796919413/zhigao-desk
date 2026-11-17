import {activityOf} from './activities.js';
// Screenshots must be embedded raster data, never HTML, SVG, or remote URLs.
export function safeShot(value){
 if(typeof value!=='string')return '';
 const m=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!m)return '';
 try{const raw=atob(m[2]);if(m[1]==='png'&&!raw.startsWith('\x89PNG\r\n\x1a\n')||m[1]==='jpeg'&&!raw.startsWith('\xff\xd8\xff')||m[1]==='webp'&&!(raw.startsWith('RIFF')&&raw.slice(8,12)==='WEBP'))return '';}catch{return '';}
 return value;
}
export function validateBundle(data){
 const bad=message=>{throw Error('交接包结构不正确：'+message);};
 if(!data||![1,2].includes(data.version))bad('版本');
 const index=name=>{const rows=data[name];if(!Array.isArray(rows))bad(name);const out=new Map();for(const row of rows){if(!row||typeof row.id!=='string'||!row.id.trim()||/[\u0000-\u001f]/.test(row.id)||['__proto__','constructor','prototype'].includes(row.id)||out.has(row.id))bad(name+' 标识');out.set(row.id,row);}return out;};
 const projects=index('projects'),items=index('items'),docs=index('docs');
 for(const p of projects.values())if(typeof p.name!=='string'||!Array.isArray(p.rules||[])||!Array.isArray(p.library||[]))bad('品牌');
 const scopes=new Map();
 for(const p of projects.values()){
  if(p.activities!==undefined&&!Array.isArray(p.activities))bad('活动清单');
  const ids=new Set(['legacy']);
  for(const a of p.activities||[]){if(!a||typeof a.id!=='string'||!a.id.trim()||['*','__proto__','constructor','prototype'].includes(a.id)||ids.has(a.id)||typeof a.name!=='string'||!a.name.trim())bad('活动标识或名称');ids.add(a.id);}
  scopes.set(p.id,ids);
  for(const source of [...(p.library||[]),...(p.rules||[])])if(activityOf(source)!=='*'&&!ids.has(activityOf(source)))bad('资料活动归属');
 }
 for(const it of items.values())if(!projects.has(it.projectId)||!['视频','图文'].includes(it.kind))bad('任务品牌归属或内容形式');
 for(const it of items.values())if(!scopes.get(it.projectId).has(activityOf(it)))bad('任务活动归属');
 const doc=d=>{if(!d||typeof d!=='object')bad('稿件');for(const name of ['remarks','rounds','cells','findings','brandFeedback'])if(d[name]!==undefined&&!Array.isArray(d[name]))bad(name);
  for(const name of ['duration','size','width','height'])if(d[name]!==undefined&&(!Number.isFinite(d[name])||d[name]<0))bad(name);
  if(d.flow&&(!['review','ready','brand','revise','passed'].includes(d.flow.state)||!Number.isInteger(d.flow.round)||d.flow.round<1))bad('轮次状态');
  for(const c of d.cells||[])if(!c||typeof c.id!=='string'||typeof c.current!=='string'||typeof c.original!=='string')bad('正文单元');
  for(const n of d.remarks||[]){if(!n||typeof n!=='object'||typeof n.text!=='string'||n.shot!=null&&n.shot!==''&&!safeShot(n.shot))bad('意见或截图');if(n.t!==undefined&&(!Number.isFinite(n.t)||n.t<0))bad('时间点');}
  for(const r of d.rounds||[])doc(r);
 };
 for(const d of data.docs){if(!projects.has(d.projectId)||!items.has(d.itemId)||items.get(d.itemId).projectId!==d.projectId)bad('稿件任务归属');if(activityOf(d)!==activityOf(items.get(d.itemId)))bad('稿件活动归属');doc(d);}
 for(const name of ['media','libraryAssets'])if(data[name]!==undefined&&!Array.isArray(data[name]))bad(name);
 for(const m of data.media||[])if(!docs.has(m.id))bad('视频原件归属');
 for(const name of ['media','libraryAssets'])if(new Set((data[name]||[]).map(x=>x.id)).size!==(data[name]||[]).length)bad(name+' 重复标识');
 return data;
}
