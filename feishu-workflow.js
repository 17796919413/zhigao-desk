// 提炼草稿与人工确认后的空表填充计划。仅使用执行字段白名单。
import {normName,dateISO,kindOf,platformsOf} from './feishu.js';
export const EXEC_FIELDS=['author','type','product','date','platform','owner','kind','direction'];
export const EXEC_LABELS={author:'达人',type:'达人类型',product:'合作产品',date:'发布档期',platform:'发布平台',owner:'内容负责人',kind:'内容形式',direction:'细分方向'};
export const executionKey=e=>[normName(e.author),normName(e.platform),normName(e.product)].join('|');
export function reviewExecutionRows(original,submitted){
 if(!Array.isArray(submitted)||submitted.length!==original.length)throw Error('复核须保留原始达人及平台清单。');
 const identity=e=>normName(e.author)+'|'+e.platform,byId=new Map(original.map(e=>[identity(e),e])),seen=new Set();
 return submitted.map(raw=>{const id=identity(raw),old=byId.get(id);if(!old||seen.has(id))throw Error('复核须保留原始达人及平台清单。');seen.add(id);
  const next={...old};for(const k of [...EXEC_FIELDS,'group'])if(raw[k]!==undefined){if(typeof raw[k]!=='string'||raw[k].length>500)throw Error('复核字段需为简短文本。');next[k]=raw[k].trim();}
  if(!['','视频','图文'].includes(next.kind))throw Error('内容形式请选择图文或视频，未明确时留空。');
  next.author=old.author;next.platform=old.platform;next.on=!!next.kind;return next;
 });
}
export function validateExecutionRows(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>300)throw Error('一次须确认 1 到 300 条执行记录。');
 const seen=new Set();return rows.map(e=>{
  const row={};for(const k of EXEC_FIELDS){const s=String(e[k]??'').trim();if(s.length>500)throw Error(`${EXEC_LABELS[k]}过长，请人工核对。`);row[k]=s;}
  if(!row.author||!['抖音','小红书','其他'].includes(row.platform)||!['视频','图文'].includes(row.kind))throw Error('请补齐达人、平台和内容形式后确认。');
  if(seen.has(executionKey(row)))throw Error('所选记录中有相同达人、平台和产品，请去重或区分产品后确认。');seen.add(executionKey(row));
  return {...row,group:String(e.group||'执行部分').slice(0,120),source:e.source?{sheetId:String(e.source.sheetId||''),row:Number(e.source.row)||0}:null};
 });
}
export function executionTask(e){return {author:e.author,platform:e.platform,kind:e.kind,type:e.type,title:e.product,date:dateISO(e.date)};}
const norm=s=>String(s??'').replace(/[\s:：()（）【】\[\]]/g,'').toLowerCase();
const COLS={author:['达人','达人昵称','达人名称'],type:['达人类型','达人方向','方向'],product:['合作产品','产品','内容标题/产品','内容标题'],date:['发布档期','发布日期','档期'],platform:['发布平台','平台'],owner:['内容负责人','负责人'],kind:['内容形式','形式'],direction:['细分方向'],outline:['大纲'],script:['脚本'],draft:['初稿'],publish:['发布情况'],feedback:['品牌方反馈','品牌反馈']};
export function seedColumns(headers){
 const seen=new Set();const fields=headers.map(h=>{const f=Object.keys(COLS).find(k=>COLS[k].includes(norm(h)));if(f&&seen.has(f))throw Error('精炼表有重复执行字段，请核对表头。');if(f)seen.add(f);return f||null;});
 if(!['author','platform','product'].every(f=>seen.has(f)))throw Error('精炼表必须包含达人、发布平台和合作产品列。');return fields;
}
export function seedRows(headers,entries){const fs=seedColumns(headers);return entries.map(e=>fs.map(f=>f==='script'&&e.kind==='图文'?'/':EXEC_FIELDS.includes(f)?String(e[f]||''):''));}
export function extractionDefaults(e){const ps=platformsOf(e.platform);return {...e,platform:ps.length===1?ps[0]:'',kind:kindOf(e.kind),on:!!e.author&&ps.length===1&&!!kindOf(e.kind)};}
