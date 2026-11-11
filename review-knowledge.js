import {effectiveRules} from './brand.js';

export const KNOWLEDGE_VERSION='grounded-sources-v2';
export const stableJSON=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export async function digest(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}

// Pack adjacent sentences without losing a character or an original offset.
// A cache stores source material, never an AI judgement about a new draft.
export function sourceUnits(id,kind,title,text,extra={}){
 const raw=String(text||''),units=[];let start=0;
 while(start<raw.length){
  let end=Math.min(start+1200,raw.length);
  if(end<raw.length){const part=raw.slice(start,end),boundary=Math.max(part.lastIndexOf('。'),part.lastIndexOf('；'),part.lastIndexOf('\n'));if(boundary>=600)end=start+boundary+1;if(/[\uD800-\uDBFF]/.test(raw[end-1]))end--;}
  const value=raw.slice(start,end);if(value.trim())units.push({id:id+':unit:'+(units.length+1),sourceId:id,kind,title,text:value,start,end,...extra});start=end;
 }
 return units;
}
const attributes='容量|净含量|重量|净重|功率|厚度|长度|宽度|高度|续航';
const units='毫升|千克|公斤|毫克|毫米|厘米|千瓦|小时|分钟|升|克|米|瓦|mL|ml|kg|mg|cm|mm|kW|W|L|g';
const unitTable={毫升:['volume',1],ml:['volume',1],升:['volume',1000],l:['volume',1000],千克:['mass',1000],公斤:['mass',1000],kg:['mass',1000],克:['mass',1],g:['mass',1],毫克:['mass',.001],mg:['mass',.001],毫米:['length',1],mm:['length',1],厘米:['length',10],cm:['length',10],米:['length',1000],千瓦:['power',1000],kw:['power',1000],瓦:['power',1],w:['power',1],小时:['time',60],分钟:['time',1]};
const numberValue=(value,unit)=>{const normalized=unitTable[unit.toLowerCase()];return normalized?{dimension:normalized[0],value:Number(value)*normalized[1]}:null;};
const ambiguous=/(?:不|非|否|错写|错误|旧版|例如|比如|假设|如果|若|当|可能|约|至少|最多|至多|超过|低于|高于|大于|小于|以上|以下|左右|上下|之间|范围|除外|例外|除非|仅限|条件|情况下|分别|[~～±]|\d\s*[-—–至到]\s*\d)/;

// Intentionally narrow: explicit subject + property + exact numeric assertion.
// Unparsed language stays in the full source cards for the connected agent.
export function extractFacts(rows){
 const facts=[];
 for(const row of rows){
  if(row.status==='dropped')continue;
  const text=String(row.text||row.description||'');
  const pattern=new RegExp(String.raw`(?:^|[，,；;。\n]|以及|和)([A-Za-z0-9®\u4e00-\u9fff_-]{2,32})的(${attributes})(?:必须写(?:成)?|必须为|统一为|应为|为|是|：|:)\s*([0-9]+(?:\.[0-9]+)?)\s*(${units})(?=$|[\s，,；;。！？!?、）)和]|以及)`,'g');
  for(const sentence of text.matchAll(/[^。；;\n]+[。；;\n]?/g)){
   // Context-dependent or negative statements remain verbatim for agent review.
   if(ambiguous.test(sentence[0]))continue;
   for(const match of sentence[0].matchAll(pattern)){
    if(/和|以及|与|及|或/.test(match[1]))continue;
    const offset=sentence.index+match.index;
    facts.push({id:'fact:'+row.id+':'+offset,sourceId:row.id,sourceKind:row.kind||'rule',subject:match[1],attribute:match[2],amount:match[3],unit:match[4],quote:match[0].replace(/^[，,；;。\n]/,''),...numberValue(match[3],match[4]),priority:row.kind==='rule'?2:1});
   }
  }
 }
 return facts;
}
export function inspectFactConflicts(manifest,cells){
 const facts=extractFacts([...manifest.rules.map(r=>({...r,kind:'rule'})),...manifest.sources]),groups=new Map(),findings=[];
 for(const f of facts){const key=[f.subject,f.attribute,f.dimension].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}
 for(const list of groups.values()){
  const priority=Math.max(...list.map(f=>f.priority)),current=list.filter(f=>f.priority===priority||['feedback','feedback-item'].includes(f.sourceKind)),fact=current[0],values=new Set(current.map(f=>f.value));
  for(const cell of cells){
   for(const actual of extractFacts([{id:cell.id,text:String(cell.current||'')}])){
    if(actual.subject!==fact.subject||actual.attribute!==fact.attribute||actual.dimension!==fact.dimension)continue;
    if(values.size===1&&Math.abs(actual.value-fact.value)<1e-8)continue;
    findings.push({cellId:cell.id,assetId:cell.assetId||null,sourceIds:current.map(f=>f.sourceId),subject:fact.subject,attribute:fact.attribute,actual:actual.amount+actual.unit,expected:current.map(f=>f.amount+f.unit),quote:actual.quote,conflictingSources:values.size>1,readOnly:!!cell.note});
   }
  }
 }
 return findings;
}

function brandInput(project){return {compiler:KNOWLEDGE_VERSION,projectId:project.id,projectName:project.name,notes:project.notes||'',rules:effectiveRules(project).map(r=>({id:r.id,title:r.title,description:r.description||'',type:r.type,find:r.find||'',replace:r.replace||'',action:r.action||'check',source:r.source||'',updated:r.updated||'',supersedes:r.supersedes||[]})),library:(project.library||[]).filter(d=>d.active!==false).map((d,i)=>({id:d.id||String(i),kind:d.kind,title:d.title,text:String(d.text||''),ingestion:d.ingestion||null,source:d.source||'',updated:d.updated||''}))};}
export function createKnowledgeCache({load,save}={}){
 const memory=new Map();
 return async project=>{
  const input=brandInput(project),inputHash=await digest(stableJSON(input));let cached=memory.get(project.id),origin='memory';
  if(!cached&&load){try{cached=await load(project.id);origin='persistent';}catch{}}
  if(cached?.compiler===KNOWLEDGE_VERSION&&cached.inputHash===inputHash&&cached.data?.projectId===project.id&&cached.dataHash===await digest(stableJSON(cached.data))){memory.set(project.id,cached);return {...structuredClone(cached.data),cache:{hit:true,origin}};}
  const sources=sourceUnits('notes','notes','项目笔记',input.notes);
  for(const d of input.library)sources.push(...sourceUnits('library:'+d.id,d.kind,d.title,d.text,{ingestion:d.ingestion,source:d.source,updated:d.updated}));
  const data={projectId:project.id,projectName:project.name,rules:input.rules,sources,sourceRevision:inputHash};
  cached={compiler:KNOWLEDGE_VERSION,inputHash,data,dataHash:await digest(stableJSON(data))};memory.set(project.id,cached);
  let persisted=false;if(save)try{await save(project.id,structuredClone(cached));persisted=true;}catch{}
  return {...structuredClone(data),cache:{hit:false,origin:'compiled',persisted}};
 };
}
