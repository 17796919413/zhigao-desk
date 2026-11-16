// 只以昵称精确匹配；不把相似昵称、正文提到的其他达人自动当成作者。
import {cellOf,kindOf,platformsOf,rowKey} from './feishu.js';
export const creatorKey=s=>String(s||'').normalize('NFKC').trim().replace(/^@/,'').toLowerCase();
export function contentKey(title,author=''){let value=creatorKey(title).replace(/\.[a-z0-9]+$/i,'').replace(/[【\[][^】\]]+[】\]]/g,'');if(author)value=value.replaceAll(creatorKey(author),'');return value.replace(/(?:大纲|脚本|初稿|图文|视频|小红书|抖音)/g,'').replace(/(?:第\s*\d+\s*[轮版]|v\s*\d+(?:\.\d+)*|[（(]?\d+版[）)]?)/gi,'').replace(/[\s_\-—·（）()]/g,'');}
export function creatorEvidence(doc){
 const cells=doc.book?.sheets?.flatMap(s=>s.cells)||doc.cells||[];
 const text=cells.map(c=>c.current??c.original??'').concat((doc.pages||[]).map(p=>p.text||'')).join('\n');
 const names=[...text.matchAll(/(?:^|\n)\s*(?:达人(?:ID|名称|昵称|账号)?|博主(?:名称|昵称)?|账号(?:名称)?|作者)(?:\s*[:：]\s*|\s*\n\s*)([^\r\n]+)/gi)].map(m=>m[1].trim());
 const filename=String(doc.filename||'').replace(/\.[^.]+$/,'');
 names.push(...[...filename.matchAll(/[【\[]([^】\]]+)[】\]]/g)].map(m=>m[1]),...filename.split(/[-_—]/));
 const platforms=[...new Set((filename+'\n'+text.slice(0,1000)).match(/抖音|小红书/g)||[])];
 const contentTitle=text.match(/(?:^|\n)\s*内容标题\s*[:：]\s*([^\r\n]+)/)?.[1]?.trim()||text.match(/(?:^|\n)\s*(?:合作产品|产品名称)\s*[:：]\s*([^\r\n]+)/)?.[1]?.trim()||'';
 return {names:[...new Set(names.map(creatorKey).filter(Boolean))],contentTitle,filename:creatorKey(filename),platform:platforms.length===1?platforms[0]:'',stage:filename.match(/大纲|脚本|初稿/)?.[0]||''};
}
export function matchUploadedCreator(doc,items){
 const e=creatorEvidence(doc);let hits=items.filter(it=>{const n=creatorKey(it.author);return n&&(e.names.includes(n)||e.filename===n);});
 if(e.platform)hits=hits.filter(it=>it.platform===e.platform);
 const title=e.contentTitle||doc.filename,exact=hits.filter(it=>contentKey(title,it.author)===contentKey(it.title,it.author));
 if(exact.length)return {status:exact.length===1?'matched':'ambiguous',hits:exact,evidence:e};
 // A different explicit content title creates its own task. Missing title evidence
 // leaves candidates for the user's assignment choice.
 if(hits.length&&contentKey(title,hits[0].author))return {status:'unmatched',hits:[],evidence:e};
 return {status:hits.length?'ambiguous':'unmatched',hits,evidence:e};
}
export function exactCreatorRows(item,sheets){
 if(!creatorKey(item.author))return [];
 let hits=sheets.flatMap(s=>s.rows.map((r,row)=>({s,row,r})).filter(({r})=>creatorKey(cellOf(r,s.map,'author'))===creatorKey(item.author)));
 if(item.platform)hits=hits.filter(({s,r})=>s.map.platform<0||platformsOf(cellOf(r,s.map,'platform')).includes(item.platform));
 if(hits.length>1&&item.title){const exact=hits.filter(({s,r})=>creatorKey(cellOf(r,s.map,'title'))===creatorKey(item.title));if(exact.length)hits=exact;}
 return hits;
}
export function tasksFromSheets(sheets){return sheets.flatMap(s=>s.rows.flatMap((r,row)=>{
 const author=cellOf(r,s.map,'author'),ps=platformsOf(cellOf(r,s.map,'platform'));
 if(!author||['达人','合计','总计'].includes(author)||ps.length!==1)return[];
 const kind=kindOf(cellOf(r,s.map,'kind'))||(cellOf(r,s.map,'script')==='/'?'图文':'');
 return [{author,platform:ps[0],kind,title:cellOf(r,s.map,'title'),type:cellOf(r,s.map,'type'),feishu:{sheetId:s.id,key:rowKey(s,row)}}];
}));}
