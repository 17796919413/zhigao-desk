import {reviewBlocks,reviewError} from './review-protocol.js';
import {stableJSON} from './review-knowledge.js';

export const CONTEXT_PAGE_CHARACTERS=18000;
const required=['sources','rules','blocks','assets','timeline','media'];
const sections=[...required,'updates','previousChecks','savedChecks'];
// Fragment transport records, never edit or truncate the user's source.
export function textParts(text,size=4000){
 const out=[];for(let start=0;start<text.length;){let end=Math.min(start+size,text.length);const ch=text.charCodeAt(end-1);if(end<text.length&&ch>=0xD800&&ch<=0xDBFF)end--;out.push({text:text.slice(start,end),start,end});start=end;}return out;
}
function bounded(rows){return rows.flatMap((row,index)=>{const text=JSON.stringify(row);if(text.length<=8000)return [row];const parts=textParts(text);return parts.map((p,part)=>({encoding:'json-fragment',recordIndex:index,part,parts:parts.length,...p}));});}
export function contextSections(task,manifest,media,entry={}){
 const fullTask={...task,cells:[...(task.cells||[]),...(media.supplementalText||[])]};
 const metadata=new Map(reviewBlocks(fullTask).map(b=>[b.id,b]));
 const {assets=[],frameTimeline=[],supplementalText,...info}=media;
 const updates=Array.isArray(entry.basisChanges)?entry.basisChanges:entry.basisChanges?.changes||[];
 const rows={sources:manifest.sources,rules:manifest.rules,blocks:fullTask.cells.filter(c=>metadata.has(c.id)).flatMap(c=>textParts(String(c.current),6000).map(p=>({...metadata.get(c.id),...p}))),assets:assets.map(a=>({...a,...(entry.mediaReceipts?.[a.id]?{readReceipt:entry.mediaReceipts[a.id].token}:{} )})),timeline:frameTimeline,media:[info],updates,previousChecks:entry.previousChecks||[],savedChecks:Object.entries(entry.savedChecks||{}).flatMap(([kind,values])=>values.map(value=>({kind,value})))};
 return Object.fromEntries(sections.map(s=>[s,bounded(rows[s])]));
}
export function contextSummary(all,entry){return Object.fromEntries(sections.map(s=>{
 const read=Math.min(entry?.contextDelivery?.readThrough?.[s]||0,all[s].length);let nextCursor=null;
 if(read>0&&read<all[s].length&&entry){const delivery=entry.contextDelivery;nextCursor=Object.entries(delivery.cursors).find(([,v])=>v.section===s&&v.start===read)?.[0]||crypto.randomUUID();delivery.cursors[nextCursor]={section:s,start:read};}
 return [s,{total:all[s].length,required:required.includes(s),read,complete:read===all[s].length,nextCursor}];
}));}
export function createContextDelivery(){return {readThrough:{},cursors:{}};}
export function contextPage(entry,all,section,cursor){
 if(!sections.includes(section))throw reviewError('INVALID_CONTEXT_SECTION','未知资料分区，请使用 brief.context 列出的名称。');
 const delivery=entry.contextDelivery||(entry.contextDelivery=createContextDelivery());let start=0;
 if(cursor!==undefined&&cursor!==null){const value=Object.hasOwn(delivery.cursors,cursor)&&delivery.cursors[cursor];if(!value||value.section!==section)throw reviewError('CONTEXT_CURSOR_INVALID','分页凭据不属于本次审稿或当前资料分区。');start=value.start;}
 const rows=all[section],items=[];let chars=0,end=start;
 while(end<rows.length&&items.length<100){const size=JSON.stringify(rows[end]).length+1;if(items.length&&chars+size>16000)break;items.push(rows[end]);chars+=size;end++;}
 delivery.readThrough[section]=Math.max(delivery.readThrough[section]||0,end);
 let nextCursor=null;if(end<rows.length){const found=Object.entries(delivery.cursors).find(([,v])=>v.section===section&&v.start===end);nextCursor=found?.[0]||crypto.randomUUID();delivery.cursors[nextCursor]={section,start:end};}
 return {section,items,total:rows.length,start,end,nextCursor};
}
export function unreadContext(entry,all){return required.filter(s=>(entry.contextDelivery?.readThrough?.[s]||0)<all[s].length).map(s=>({section:s,read:entry.contextDelivery?.readThrough?.[s]||0,total:all[s].length}));}
const keys={ruleChecks:'id',sourceChecks:'id',mediaChecks:'assetId',reviewedIds:null};
export function mergeReviewChecks(stored={},incoming={}){
 const result=structuredClone(stored);
 for(const [key,id] of Object.entries(keys)){
  if(incoming[key]===undefined)continue;const values=incoming[key];
  if(!Array.isArray(values))throw reviewError('INVALID_CHECKS',key+' 须为数组。');
  const ids=values.map(x=>id?x?.[id]:x);if(ids.some(x=>typeof x!=='string'||!x)||new Set(ids).size!==ids.length)throw reviewError('INVALID_CHECKS',key+' 含缺失或重复的 ID。');
  const map=new Map((result[key]||[]).map(x=>[id?x[id]:x,x]));for(const value of values)map.set(id?value[id]:value,structuredClone(value));result[key]=[...map.values()];
 }return result;
}
export function validateCheckIds(checks,all){
 const expected={ruleChecks:new Set(all.manifest.rules.map(x=>x.id)),sourceChecks:new Set(all.manifest.sources.map(x=>x.id)),mediaChecks:new Set(all.media.assets.map(x=>x.id)),reviewedIds:new Set(reviewBlocks(all.task).map(x=>x.id))};
 const diagnostics=[];
 for(const [key,id] of Object.entries(keys)){
  const values=checks[key];if(values===undefined)continue;
  if(!Array.isArray(values)){diagnostics.push({section:key,field:key,code:'ARRAY_REQUIRED'});continue;}
  const seen=new Set();values.forEach((item,index)=>{const value=id?item?.[id]:item;
   if(!expected[key].has(value))diagnostics.push({section:key,index,id:value??null,field:id||key,code:'UNKNOWN_ID'});
   else if(seen.has(value))diagnostics.push({section:key,index,id:value,field:id||key,code:'DUPLICATE_ID'});
   seen.add(value);
  });
 }
 if(diagnostics.length)throw reviewError('INVALID_CHECKS','核对记录存在未知或重复 ID，或数组格式错误；请按 diagnostics 一次修正。',{diagnostics});
}
// Notices identify changes; they never synthesize replacement brand policy.
export function basisChanges(previous,current){
 const changes=[];for(const section of ['rules','sources']){
  const old=new Map((previous?.[section]||[]).map(x=>[x.id,x])),fresh=new Map((current?.[section]||[]).map(x=>[x.id,x]));
  for(const [id,value] of fresh){const before=old.get(id);if(!before||stableJSON(before)!==stableJSON(value))changes.push({section,id,title:value.title,change:before?'changed':'added'});}
  for(const [id,value] of old)if(!fresh.has(id))changes.push({section,id,title:value.title,change:'removed'});
 }return changes;
}
export function previousChecks(entry){return Object.keys(keys).flatMap(key=>(entry?.savedChecks?.[key]||[]).map(value=>({kind:key,value,advisoryOnly:true})));}
export function basisUpdateSummary(update){if(!update)return null;const {changes=[],...summary}=update;return {...summary,changesSection:'updates',totalChanges:changes.length};}
