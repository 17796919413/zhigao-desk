import {esc} from './engine.js';
import {buildPlan,rowKey} from './feishu.js';

export function migrateReviewTable(settings){
 const next=structuredClone(settings);let changed=false;
 for(const p of next.projects){const f=p.feishu;if(!f||f.reviewTableVersion===2)continue;
  f.legacyLinks={source:f.source||null,refined:f.refined||null};
  f.refined=f.refined||f.source||null;f.source=null;f.reviewTableVersion=2;changed=true;
 }return {settings:next,changed};
}
export function tableModel(project,items,docsOf,{sheetId='',query='',filter='',page=0,pageSize=50}={}){
 const f=project.feishu||{},sheets=(f.sheets||[]).filter(s=>s.live&&!s.stale&&s.sourceUrl===f.refined?.url),sheet=sheets.find(s=>s.id===sheetId)||sheets[0];
 if(!sheet)return {sheets,sheet:null,rows:[],count:0,page:0,pages:1};
 const plans=buildPlan(items.filter(i=>i.projectId===project.id&&i.feishu?.sheetId===sheet.id),docsOf,[sheet]);
 const byRow=new Map();for(const e of plans){if(e.error||!Number.isInteger(e.row))continue;const list=byRow.get(e.row)||[];list.push(e);byRow.set(e.row,list);}
 const q=query.trim().toLowerCase();
 const rows=sheet.rows.map((values,index)=>{const plans=byRow.get(index)||[],cells=plans.flatMap(e=>e.cells||[]);return {values,index,key:rowKey(sheet,index),plans,cells,updates:cells.filter(c=>c.status==='update').length,conflicts:cells.filter(c=>c.status==='conflict').length};})
  .filter(r=>(!q||r.values.some(v=>String(v??'').toLowerCase().includes(q)))&&(!filter||filter==='pending'&&r.updates||filter==='conflict'&&r.conflicts||filter==='linked'&&r.plans.length));
 const pages=Math.max(1,Math.ceil(rows.length/pageSize)),current=Math.max(0,Math.min(page,pages-1));
 return {sheets,sheet,rows:rows.slice(current*pageSize,(current+1)*pageSize),count:rows.length,page:current,pages};
}
const tone=c=>c?.status==='conflict'?'conflict':c?.status==='update'?'pending':'';
export function tableBody(model){
 if(!model.sheet)return '<div class="empty">保存审核表链接后，点击“在工作台显示”读取表格。</div>';
 const {sheet,rows}=model;
 return `<div class="review-table-scroll" tabindex="0" aria-label="审核表，可左右滚动"><table class="review-table"><thead><tr><th scope="col" class="row-number">行</th>${sheet.headers.map((h,i)=>`<th scope="col" ${i===0?'class="frozen"':''}>${esc(h||`第 ${i+1} 列`)}</th>`).join('')}<th scope="col">工作台进度</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="row-number">${r.index+(sheet.rowStart||2)}</td>${sheet.headers.map((_,i)=>{const c=r.cells.find(c=>sheet.map?.[c.f]===i&&['update','conflict'].includes(c.status));return `<td class="${i===0?'frozen ':''}${tone(c)}"><div class="table-cell">${esc(r.values[i]??'')||'<span class="table-blank">—</span>'}</div>${c?`<div class="table-proposal"><span>${c.status==='conflict'?'需核对':'待同步'}</span>${esc(c.ours||'')}${c.note?`<small>${esc(c.note)}</small>`:''}</div>`:''}</td>`;}).join('')}<td class="table-task">${r.plans.length?r.plans.map(e=>`<button class="textbtn" data-action="open-item" data-id="${esc(e.it.id)}">查看内容任务</button>`).join(''):'<span class="muted">未关联任务</span>'}${r.updates?`<small>${r.updates} 项待同步</small>`:''}${r.conflicts?`<small class="error">${r.conflicts} 项需核对</small>`:''}</td></tr>`).join('')||`<tr><td colspan="${sheet.headers.length+2}"><div class="empty">没有符合条件的记录。清空搜索或切换筛选后重试。</div></td></tr>`}</tbody></table></div>`;
}
