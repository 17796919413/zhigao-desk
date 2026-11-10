// 精确匹配局部补丁；所有检查通过后才返回可持久化结果。
export const reviewError=(code,message,details={})=>Object.assign(new Error(message),{code,details});
export function reviewBlocks(task){return task.cells.filter(c=>String(c.current).trim()).map(c=>({id:c.id,type:task.fmt==='xlsx'?'cell':'paragraph',address:c.address||c.id,sheet:c.sheetName||'',characters:c.current.length,editable:!c.note,...(c.note?{note:c.note}:{})}));}
export function parseReview(data,task,snapshot){
 const fail=(code,message,details)=>{throw reviewError(code,message,details);};
 if(!data||data.snapshot!==snapshot)fail('SNAPSHOT_CHANGED','这份结果对应旧稿件，或缺少 snapshot。请重新获取审稿指令。');
 const cells=new Map(task.cells.map(c=>[c.id,c])),changes=new Map();
 const cell=id=>{const c=cells.get(id);if(!c)fail('UNKNOWN_BLOCK',`找不到修改位置 ${id}。`,{cellId:id});return c;};
 if(!Array.isArray(data.changes??[])||!Array.isArray(data.patches??[]))fail('INVALID_RESULT','changes 和 patches 必须为数组。');
 for(const x of data.changes||[]){
  const c=cell(x.id);if(changes.has(x.id))fail('DUPLICATE_BLOCK',`重复修改 ${x.id}。`,{cellId:x.id});
  if(x.original!==c.current){let index=0;const actual=String(x.original??'');while(index<c.current.length&&index<actual.length&&c.current[index]===actual[index])index++;
   fail('ORIGINAL_MISMATCH',`${x.id} 原文第 ${index+1} 个字符不一致。`,{cellId:x.id,index,expected:JSON.stringify(c.current.slice(Math.max(0,index-16),index+24)),actual:JSON.stringify(actual.slice(Math.max(0,index-16),index+24))});}
  changes.set(x.id,{...x});
 }
 const groups=new Map();
 for(const p of data.patches||[]){const id=p.cellId||p.id;cell(id);if(changes.has(id))fail('MIXED_BLOCK_EDITS',`${id} 不能同时使用整段修改和局部替换。`,{cellId:id});if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p);}
 for(const [id,patches] of groups){const c=cell(id),edits=[];
  for(const p of patches){
   if(typeof p.find!=='string'||!p.find.length||typeof p.replace!=='string')fail('INVALID_PATCH',`${id} 的 find 须为非空文字，replace 须为文字。`,{cellId:id});
   const positions=[];for(let at=0;(at=c.current.indexOf(p.find,at))!==-1;at++)positions.push(at);
   if(!positions.length)fail('PATCH_NOT_FOUND',`${id} 未找到指定原句。`,{cellId:id,find:p.find});
   if(p.occurrence===undefined&&positions.length!==1)fail('PATCH_AMBIGUOUS',`${id} 原句出现 ${positions.length} 次，请指定 occurrence（从 1 开始，或 all）。`,{cellId:id,matches:positions.length});
   const n=p.occurrence??1;
   if(n!=='all'&&(!Number.isInteger(n)||n<1||n>positions.length))fail('INVALID_OCCURRENCE',`${id} occurrence 超出匹配范围。`,{cellId:id,matches:positions.length});
   for(const start of n==='all'?positions:[positions[n-1]])edits.push({start,end:start+p.find.length,text:p.replace});
  }
  edits.sort((a,b)=>a.start-b.start);let end=0,revised='';for(const x of edits){if(x.start<end)fail('PATCH_OVERLAP',`${id} 局部替换范围重叠。`,{cellId:id});revised+=c.current.slice(end,x.start)+x.text;end=x.end;}revised+=c.current.slice(end);
  changes.set(id,{id,original:c.current,revised,reason:patches.map(p=>p.reason||'局部替换').join('；')});
 }
 for(const [id,x] of changes){const c=cell(id);if(typeof x.revised!=='string'||x.revised.length>30000)fail('INVALID_REVISED',`${id} 修改内容格式不正确或超过 30000 字。`,{cellId:id});if(c.note&&x.revised!==c.current)fail('BLOCK_READ_ONLY',`${id} 含不可安全改写的内容，请列入 blockingWarnings。`,{cellId:id,note:c.note});}
 const blocks=reviewBlocks(task),allIds=new Set(blocks.map(c=>c.id)),reported=data.reviewedIds!==undefined;
 if(reported&&(!Array.isArray(data.reviewedIds)||data.reviewedIds.some(id=>!allIds.has(id))||new Set(data.reviewedIds).size!==data.reviewedIds.length))fail('INVALID_COVERAGE','reviewedIds 必须是已审非空单元的 ID，不能未知或重复。');
 const reviewedIds=reported?data.reviewedIds:[],unreviewedIds=blocks.filter(c=>!reviewedIds.includes(c.id)).map(c=>c.id);
 if(reported&&[...changes.keys()].some(id=>allIds.has(id)&&!reviewedIds.includes(id)))fail('INVALID_COVERAGE','修改位置必须包含在 reviewedIds 中。');
 const warnings=[],blockingWarnings=[];
 if(data.warnings!==undefined&&!Array.isArray(data.warnings)||data.blockingWarnings!==undefined&&!Array.isArray(data.blockingWarnings))fail('INVALID_WARNINGS','warnings 和 blockingWarnings 必须为数组。');
 for(const w of data.warnings||[]){if(w&&typeof w==='object'){const text=String(w.text||w.message||'');if(!text)fail('INVALID_WARNINGS','提醒缺少正文。');warnings.push(text);if(w.blocking||w.severity==='blocking')blockingWarnings.push(text);}else warnings.push(String(w));}
 for(const w of data.blockingWarnings||[]){if(typeof w!=='string'||!w.trim())fail('INVALID_WARNINGS','blockingWarnings 须为非空文字数组。');blockingWarnings.push(w);if(!warnings.includes(w))warnings.push(w);}
 const changed=[...changes.values()].filter(x=>x.original!==x.revised).map(x=>({id:x.id,original:x.original,revised:x.revised,reason:String(x.reason||'AI 建议'),status:'pending'}));
 return {changes:changed,warnings,blockingWarnings:[...new Set(blockingWarnings)],coverage:{reported,total:blocks.length,reviewed:reviewedIds.length,reviewedIds,unreviewedIds,changed:changed.length,complete:reported&&!unreviewedIds.length&&!blockingWarnings.length},needsSupplement:!reported||!!unreviewedIds.length||!!blockingWarnings.length};
}
