import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const fail=(code,message)=>Object.assign(Error(message),{code});
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const columnName=n=>{let out='';for(n++;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
export function normalizeGridLayout(layout,meta){
 const invalid=()=>{throw fail('GRID_LAYOUT','原表布局无法确认，请在飞书核对。');};
 if(!layout||typeof layout!=='object')invalid();
 const frozen=(key,legacy,limit)=>{
  const value=layout[key]??layout[legacy]??0;
  if(layout[key]!=null&&layout[legacy]!=null&&layout[key]!==layout[legacy])invalid();
  if(!Number.isInteger(value)||value<0||value>limit)invalid();
  return value;
 };
 const hidden=(list,axis,limit)=>{
  if(list===undefined)return [];
  if(!Array.isArray(list))invalid();
  return [...new Set(list.map(entry=>{
   // Live CLI sheet-info returns zero-based numeric hidden row indices;
   // A1 strings and legacy range objects already use visible sheet numbering.
   if(typeof entry==='number'){
    if(!Number.isInteger(entry)||entry<0||entry>=limit)invalid();
    return axis==='rows'?String(entry+1):columnName(entry);
   }
   const text=typeof entry==='string'?entry:entry?.[axis];
   const parts=typeof text==='string'&&text.match(axis==='rows'?/^(\d+)(?::(\d+))?$/:/^([A-Z]+)(?::([A-Z]+))?$/);
   if(!parts)invalid();
   const index=s=>axis==='rows'?Number(s):[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
   const start=index(parts[1]),end=index(parts[2]||parts[1]);
   if(start<1||end<start||end>limit)invalid();
   return text;
  }))];
 };
 return {...layout,frozen_row_count:frozen('frozen_rows','frozen_row_count',meta.row_count),frozen_column_count:frozen('frozen_columns','frozen_column_count',meta.column_count),hidden_rows:hidden(layout.hidden_rows,'rows',meta.row_count),hidden_columns:hidden(layout.hidden_columns,'cols',meta.column_count)};
}
export function createGridRuntime({larkJson,workbookInfo,sheetInfo,home}){
 const snapshots=new Map();
 function imageReferences(data){
  const images=new Map(),isImage=r=>r&&['embed-image','image'].includes(r.type);
  for(const block of data.ranges)for(let i=0;i<block.row_indices.length;i++)for(let j=0;j<block.col_indices.length;j++){
   const cell=block.cells?.[i]?.[j];if(!cell)continue;
   const address=block.col_indices[j]+block.row_indices[i],rich=cell.rich_text||[],origin=rich.some(isImage)?'rich_text':'rawValue';
   const runs=origin==='rich_text'?rich:Array.isArray(cell.rawValue)?cell.rawValue:[cell.rawValue];
   const refs=[];
   runs.forEach((run,index)=>{
    if(!isImage(run))return;
    const id=address+':'+index,rawToken=run.image_token||run.fileToken||run.file_token;
    const token=typeof rawToken==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(rawToken)?rawToken:null;
    const ref={id,address,origin,index,alt:typeof run.text==='string'&&run.text?run.text:'原表图片'};
    refs.push(ref);images.set(id,{ref,token});
   });
   if(refs.length)cell.imageRefs=refs;
  }
  return images;
 }
 const imageURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=8192?u.href:null;}catch{return null;}};
 const snapshotDir=path.join(home,'grid-snapshots'),snapshotTTL=30*60*1000,snapshotLimit=32;
 const snapshotFile=token=>/^[a-f0-9-]{36}$/.test(token||'')?path.join(snapshotDir,token+'.json'):null;
 function rememberStructure(token,s){
  // Structural continuation needs only the observed identity and bounds. Never
  // persist source cells, comments, styles or titles in this short-lived cache.
  const record={version:1,url:s.url,sheetId:s.sheetId,bookToken:s.bookToken,revision:s.revision,meta:{sheet_id:s.meta.sheet_id,row_count:s.meta.row_count,column_count:s.meta.column_count},at:s.at};
  try{
   fs.mkdirSync(snapshotDir,{recursive:true,mode:0o700});persist(snapshotFile(token),record);
   const files=fs.readdirSync(snapshotDir).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(name=>{const file=path.join(snapshotDir,name);return {file,mtime:fs.statSync(file).mtimeMs};}).sort((a,b)=>b.mtime-a.mtime);
   for(const [i,f] of files.entries())if(i>=snapshotLimit||Date.now()-f.mtime>snapshotTTL)fs.rmSync(f.file,{force:true});
  }catch{throw fail('GRID_STORAGE','表格操作记录无法保存，请检查本机存储后刷新。');}
 }
 function restoredStructure(body){
  const file=snapshotFile(body.token);if(!file)return;
  try{
   const s=JSON.parse(fs.readFileSync(file,'utf8'));
   if(s.version===1&&typeof s.bookToken==='string'&&/^[A-Za-z0-9]+$/.test(s.bookToken)&&Number.isInteger(s.revision)&&s.revision>=0&&s.meta?.sheet_id===s.sheetId&&['row_count','column_count'].every(k=>Number.isInteger(s.meta[k])&&s.meta[k]>0))return s;
  }catch{}
 }
 const call=async(command,url,sheetId,args=[],input)=>{const r=await larkJson(['sheets',command,'--url',url,...(sheetId?['--sheet-id',sheetId]:[]),...args,'--as','user','--format','json'],input);return r.data;};
 async function cells(url,sheetId,range,bookToken){
  const data=await call('+cells-get',url,sheetId,['--range',range,'--include','value,formula,style,comment,data_validation']);
  if(data.has_more||data.truncated||!data.ranges?.length||data.ranges.some(r=>r.truncated))throw fail('GRID_TRUNCATED','原表范围未完整读取，请缩小分页范围。');
  // The shortcut returns formatted strings for ordinary numeric and boolean cells.
  // Read typed values separately; never infer the type of an identifier from its text.
  if(!/^[A-Za-z0-9]+$/.test(bookToken||''))throw fail('GRID_VALUE','无法确认工作簿身份。');
  const rawRange=range.includes(':')?range:range+':'+range;
  const response=await larkJson(['api','GET',`/open-apis/sheets/v2/spreadsheets/${bookToken}/values/${encodeURIComponent(sheetId+'!'+rawRange)}`,'--params',JSON.stringify({valueRenderOption:'UnformattedValue'}),'--as','user','--format','json']);
  const raw=response.data,vr=raw?.valueRange;
  if(raw?.revision!==data.revision||!vr||vr.majorDimension!=='ROWS')throw fail('GRID_CHANGED','读取期间表格已变化，请刷新。');
  const match=String(vr.range||'').split('!').at(-1).match(/^([A-Z]+)(\d+)(?::[A-Z]+\d+)?$/);
  if(!match)throw fail('GRID_RANGE','原始单元格范围无法确认。');
  const colIndex=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
  for(const block of data.ranges)for(let i=0;i<block.row_indices.length;i++)for(let j=0;j<block.col_indices.length;j++){
   const ri=block.row_indices[i]-Number(match[2]),ci=colIndex(block.col_indices[j])-colIndex(match[1]);
   if(ri<0||ci<0)throw fail('GRID_RANGE','原始单元格位置不一致。');
   block.cells[i]??=[];block.cells[i][j]??={};block.cells[i][j].rawValue=vr.values?.[ri]?.[ci]??null;
  }
  return data;
 }
 async function read(body){
  const info=await workbookInfo(body.url),all=info.data?.sheets||[],visible=all.filter(s=>s.resource_type==='sheet'&&!s.is_hidden),sheetId=body.sheetId||visible[0]?.sheet_id;
  const meta=sheetInfo(info,sheetId),start=body.startRow??1,count=body.pageSize??40;
  if(!Number.isInteger(start)||start<1||start>meta.row_count||!Number.isInteger(count)||count<1||count>50)throw fail('GRID_RANGE','分页行号无效。');
  const end=Math.min(meta.row_count,start+count-1),range=`A${start}:${columnName(meta.column_count-1)}${end}`;
  const layout=normalizeGridLayout(await call('+sheet-info',body.url,sheetId,['--range',range,'--include','merges,row_heights,col_widths,hidden_rows,hidden_cols,frozen']),meta);
  const bookToken=info.data.token||info.data.spreadsheet_token;
  const data=await cells(body.url,sheetId,range,bookToken);
  if(info.data.revision!==data.revision||layout.revision!==data.revision)throw fail('GRID_CHANGED','读表期间源表发生变化，请刷新。');
  const frozen={rows:layout.frozen_row_count??0,columns:layout.frozen_column_count??0};
  if(!Number.isInteger(frozen.rows)||frozen.rows<0||frozen.rows>meta.row_count||!Number.isInteger(frozen.columns)||frozen.columns<0||frozen.columns>meta.column_count)throw fail('GRID_LAYOUT','原表冻结范围无效，请在飞书核对。');
  // Read the frozen band outside this page in bounded batches. Keep original
  // row numbers, so repeated headers are still the same editable source cells.
  const missing=[[1,Math.min(frozen.rows,start-1)],[end+1,frozen.rows]];
  for(const [first,last] of missing)for(let row=first;row<=last;row+=50){
   const frozenRange=`A${row}:${columnName(meta.column_count-1)}${Math.min(last,row+49)}`;
   const extraLayout=normalizeGridLayout(await call('+sheet-info',body.url,sheetId,['--range',frozenRange,'--include','merges,row_heights,hidden_rows']),meta);
   const extra=await cells(body.url,sheetId,frozenRange,bookToken);
   if(extra.revision!==data.revision||extraLayout.revision!==data.revision)throw fail('GRID_CHANGED','读取冻结区域期间原表已变化，请刷新。');
   data.ranges.push(...extra.ranges);
   for(const field of ['merged_cells','row_heights','hidden_rows'])layout[field]=[...new Map([...(layout[field]||[]),...(extraLayout[field]||[])].map(v=>[JSON.stringify(v),v])).values()];
  }
  // A merge straddling frozen and scrolling rows keeps its full geometry even
  // when part of it is outside the current page. Only layout is needed here.
  for(const merge of layout.merged_cells||[]){
   const m=String(merge.range).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
   if(!m||Number(m[2])>frozen.rows||Number(m[4])<=frozen.rows||Number(m[2])>=start&&Number(m[4])<=end)continue;
   const geometry=normalizeGridLayout(await call('+sheet-info',body.url,sheetId,['--range',merge.range,'--include','row_heights,hidden_rows']),meta);
   if(geometry.revision!==data.revision)throw fail('GRID_CHANGED','读取冻结合并区域期间原表已变化，请刷新。');
   for(const field of ['row_heights','hidden_rows'])layout[field]=[...new Map([...(layout[field]||[]),...(geometry[field]||[])].map(v=>[JSON.stringify(v),v])).values()];
  }
  // A merge is owned by its original top-left cell, even when that cell is on
  // an earlier page. Read only those anchors, at the same observed revision.
  const anchors=new Set();
  for(const merge of layout.merged_cells||[]){
   const m=String(merge.range).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
   if(m&&Number(m[2])<start&&Number(m[2])>frozen.rows&&Number(m[4])>=start)anchors.add(m[1]+m[2]);
  }
  for(const address of anchors){
   const anchor=await cells(body.url,sheetId,address,bookToken);
   if(anchor.revision!==data.revision)throw fail('GRID_CHANGED','读取合并区域期间原表已变化，请刷新。');
   locate(anchor,address);data.ranges.push(...anchor.ranges);
  }
  const images=imageReferences(data);
  const token=crypto.randomUUID(),snapshot={url:body.url,sheetId,bookToken,revision:data.revision,meta:structuredClone(meta),range,data,layout,images,imageURLs:new Map(),startRow:start,endRow:end,frozen,at:Date.now()};
  rememberStructure(token,snapshot);
  snapshots.set(token,snapshot);while(snapshots.size>snapshotLimit)snapshots.delete(snapshots.keys().next().value);
  return {token,sheetId,title:info.data.title,sheets:visible,meta,layout,...data,startRow:start,endRow:end,frozen,floatingAvailable:true,images:[...images.values()].map(i=>i.ref)};
 }
 function locate(data,address){for(const block of data.ranges||[])for(let i=0;i<block.row_indices.length;i++)for(let j=0;j<block.col_indices.length;j++)if(block.col_indices[j]+block.row_indices[i]===address)return block.cells?.[i]?.[j]||{};throw fail('GRID_RANGE','目标单元格不在当前已读取范围。');}
 function proof(body){const s=snapshots.get(body.token)||(['gridStructure','gridResolve'].includes(body.action)?restoredStructure(body):null),age=Date.now()-s?.at;if(!s||s.url!==body.url||s.sheetId!==body.sheetId||!Number.isFinite(age)||age<0||age>snapshotTTL)throw fail('GRID_STALE','表格快照已失效，请刷新后核对保留的输入。');return s;}
 async function current(body,s){const info=await workbookInfo(body.url),meta=sheetInfo(info,body.sheetId);if((info.data.token||info.data.spreadsheet_token)!==s.bookToken||info.data.revision!==s.revision||meta.row_count!==s.meta.row_count||meta.column_count!==s.meta.column_count)throw fail('GRID_CHANGED','源表版本已变化，已保留输入；请刷新核对后再保存。');return info;}
 async function readFloating(body){
  const s=proof(body);await current(body,s);
  const response=await larkJson(['api','GET',`/open-apis/sheets/v3/spreadsheets/${s.bookToken}/sheets/${s.sheetId}/float_images/query`,'--as','user','--format','json']);
  if(!Array.isArray(response.data?.items)||response.data.has_more)throw fail('GRID_IMAGE','浮动图片未完整读取，请刷新表格重试。');
  const items=[],seen=new Set();
  for(const item of response.data.items){
   const parts=String(item.range||'').split('!'),m=parts.at(-1).match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
   const id=item.float_image_id,row=Number(m?.[2]),col=m?[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0):0;
   const width=item.width,height=item.height,offsetX=item.offset_x??0,offsetY=item.offset_y??0;
   if(parts.length!==2||parts[0]!==s.sheetId||!m||m[3]&&(m[1]!==m[3]||m[2]!==m[4])||typeof id!=='string'||!id||seen.has(id)||!Number.isInteger(row)||row<1||row>s.meta.row_count||col<1||col>s.meta.column_count||![width,height,offsetX,offsetY].every(Number.isFinite)||width<=0||height<=0||offsetX<0||offsetY<0)throw fail('GRID_IMAGE','浮动图片位置无法确认，请在飞书核对。');
   seen.add(id);
   const ref={id:'float:'+id,address:m[1]+m[2],row,column:col-1,width,height,offsetX,offsetY,alt:'原表浮动图片'};
   const token=typeof item.float_image_token==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(item.float_image_token)?item.float_image_token:null;
   items.push({ref,token});
  }
  // A picture anchored before the page can still overlap it. Read geometry,
  // never off-page cell contents, to retain its original size and crop.
  const floatingLayout={row_heights:[],hidden_rows:[]},last=Math.max(s.endRow,s.frozen.rows);
  if(items.some(i=>i.ref.row<=last))for(let row=1;row<=last;row+=500){
   const geometry=normalizeGridLayout(await call('+sheet-info',body.url,s.sheetId,['--range',`A${row}:${columnName(s.meta.column_count-1)}${Math.min(last,row+499)}`,'--include','row_heights,hidden_rows']),s.meta);
   if(geometry.revision!==s.revision)throw fail('GRID_CHANGED','读取浮动图片期间原表已变化，请刷新。');
   for(const field of ['row_heights','hidden_rows'])floatingLayout[field].push(...(geometry[field]||[]));
  }
  await current(body,s);
  for(const [id] of s.images)if(id.startsWith('float:'))s.images.delete(id);
  for(const item of items)s.images.set(item.ref.id,item);
  return {revision:s.revision,floatingImages:items.map(i=>i.ref),floatingLayout};
 }
 async function readImages(body){
  const s=proof(body);
  if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>5||body.ids.some(id=>typeof id!=='string'||!s.images?.has(id)))throw fail('GRID_IMAGE','图片不在当前已读取的原表范围内。');
  await current(body,s);
  const ids=[...new Set(body.ids)],tokens=[...new Set(ids.map(id=>s.images.get(id).token).filter(token=>token&&!s.imageURLs.has(token)))],resolved=new Map();
  if(tokens.length){
   const response=await larkJson(['api','GET','/open-apis/drive/v1/medias/batch_get_tmp_download_url','--params',JSON.stringify({file_tokens:tokens}),'--as','user','--format','json']);
   if(!Array.isArray(response.data?.tmp_download_urls))throw fail('GRID_IMAGE','图片地址未完整返回，请刷新表格重试。');
   for(const entry of response.data.tmp_download_urls)if(tokens.includes(entry.file_token)){
    const url=imageURL(entry.tmp_download_url);if(url)resolved.set(entry.file_token,url);
   }
   // The table may change while the download URLs are being requested. Never
   // attach an old image to a newer table, or persist temporary signed URLs.
   await current(body,s);
   for(const token of tokens)s.imageURLs.set(token,resolved.get(token)||null);
  }
  return {revision:s.revision,images:ids.map(id=>{const url=s.imageURLs.get(s.images.get(id).token);return {id,state:url?'ready':'unavailable',...(url?{url}:{})};})};
 }
 function journal(body){if(!/^[a-f0-9-]{36}$/.test(body.operationId||''))throw fail('GRID_OPERATION','缺少有效操作标识。');const dir=path.join(home,'grid-operations');fs.mkdirSync(dir,{recursive:true,mode:0o700});return path.join(dir,body.operationId+'.json');}
 function persist(file,value){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);}
 function structurePending(bookToken){const dir=path.join(home,'grid-operations');if(!fs.existsSync(dir))return;for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))){let record;try{record=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));}catch{throw fail('GRID_UNCERTAIN','操作记录无法读取，请核对原表。');}if(record.action==='gridStructure'&&record.bookToken===bookToken&&record.state==='uncertain')throw fail('GRID_UNCERTAIN','有行列操作待核对，请先在审核表完成核对。');}}
 function structureResult(old,info){const meta=sheetInfo(info,old.sheetId),field=old.dimension==='row'?'row_count':'column_count',other=old.dimension==='row'?'column_count':'row_count';if(info.data.revision!==old.revision+1||meta[field]!==old.meta[field]+(old.kind==='insert'?old.count:-old.count)||meta[other]!==old.meta[other])throw fail('GRID_UNCERTAIN','行列操作结果待核对，未重复执行。');return {state:'saved',revision:info.data.revision,meta};}
 async function mutate(body){
  const file=journal(body),identity=hash(body);let old;try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw fail('GRID_UNCERTAIN','旧操作记录不可读取，请核对源表，勿重复提交。');}
  if(old){if(old.identity!==identity)throw fail('GRID_OPERATION','操作标识不能用于另一请求。');if(['saved','acknowledged'].includes(old.state))return old.result;if(old.state!=='rejected-scope')throw fail('GRID_UNCERTAIN','上次写入结果未明，请先刷新原表核对，未重复写入。');}
  const s=proof(body);structurePending(s.bookToken);await current(body,s);let argv,input,expected;
  if(body.action==='gridWrite'){
   if(!/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(body.address||''))throw fail('GRID_RANGE','单元格地址无效。');
   const before=locate(s.data,body.address),v=body.cell;
   const target=body.address.match(/^([A-Z]+)(\d+)$/),col=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
   for(const merge of s.layout.merged_cells||[]){
    const m=String(merge.range).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if(m&&Number(target[2])>=Number(m[2])&&Number(target[2])<=Number(m[4])&&col(target[1])>=col(m[1])&&col(target[1])<=col(m[3])&&body.address!==m[1]+m[2])throw fail('GRID_MERGED','请编辑合并区域的起始单元格。');
   }
   if(!v||Object.keys(v).length!==1||!(Object.hasOwn(v,'value')&&['string','number','boolean'].includes(typeof v.value)||typeof v.formula==='string'&&v.formula.startsWith('='))||typeof v.value==='number'&&!Number.isFinite(v.value)||JSON.stringify(v).length>50000)throw fail('GRID_VALUE','单元格须为文字、数值、布尔或公式。');
   if(before.rich_text?.length||before.multiple_values?.length||typeof before.value==='object'&&before.value!==null||typeof before.rawValue==='object'&&before.rawValue!==null)throw fail('GRID_COMPLEX','此格包含图片、富文本或多选，请在飞书编辑以保留结构。');
   const actual=await cells(body.url,body.sheetId,body.address,s.bookToken);if(actual.revision!==s.revision||hash(locate(actual,body.address))!==hash(before))throw fail('GRID_CHANGED','写入前单元格已变化，请刷新核对。');
   argv=['+cells-set',['--range',body.address,'--cells','-']];input=JSON.stringify([[v]]);expected=v;
  }else{
   if(!['insert','delete'].includes(body.kind)||!['row','column'].includes(body.dimension)||!Number.isInteger(body.position)||body.position<1||!Number.isInteger(body.count)||body.count<1||body.count>100)throw fail('GRID_RANGE','行列操作范围无效。');
   const bound=body.dimension==='row'?s.meta.row_count:s.meta.column_count;
   if(body.position>bound||body.kind==='delete'&&(body.position+body.count-1>bound||body.count>=bound))throw fail('GRID_RANGE','操作超出当前行列范围。');
   const start=body.dimension==='row'?String(body.position):columnName(body.position-1),end=body.dimension==='row'?String(body.position+body.count-1):columnName(body.position+body.count-2);
   if(body.kind==='delete'){
    const confirmation=`${body.sheetId}:${body.dimension}:${body.position}:${body.count}`;
    if(body.confirmation!==confirmation)throw fail('GRID_CONFIRM','请先确认要删除的具体行列范围。');
    await call('+dim-delete',body.url,body.sheetId,['--range',`${start}:${end}`,'--dry-run']);
    await current(body,s);
    argv=['+dim-delete',['--range',`${start}:${end}`,'--yes']];
   }else argv=['+dim-insert',['--position',start,'--count',String(body.count),'--inherit-style',body.position===1?'after':'before']];
  }
  const record={identity,state:'uncertain',action:body.action,at:Date.now(),url:body.url,sheetId:body.sheetId,bookToken:s.bookToken,revision:s.revision,meta:s.meta,address:body.address,expected,kind:body.kind,dimension:body.dimension,position:body.position,count:body.count};
  if(old)persist(file,record);else fs.writeFileSync(file,JSON.stringify(record),{flag:'wx',mode:0o600});
  // A lost response may have committed. The durable journal prevents blind replay.
  try{await call(argv[0],body.url,body.sheetId,argv[1],input);}
  catch(e){
   if(e.code==='FEISHU_SCOPE'&&e.details?.definitelyNotExecuted===true)persist(file,{...record,state:'rejected-scope'});
   else if(['FEISHU_SCOPE','FEISHU_AUTH','FEISHU_CONFIG'].includes(e.code))throw fail('GRID_UNCERTAIN','写入结果未确认，请先核对原表。');
   throw e;
  }
  // Only a received success response is evidence of execution. Dimensions alone
  // cannot distinguish this operation from an unrelated edit after a timeout.
  if(!expected){record.acknowledged=true;persist(file,record);}
  let result;
  if(expected){const after=await cells(body.url,body.sheetId,body.address,s.bookToken),cell=locate(after,body.address),ok=matches(cell,expected);if(!ok)throw fail('GRID_UNCERTAIN','写后回读不一致，请核对源表，输入已保留。');result={state:'saved',address:body.address,cell,revision:after.revision};}
  else result=structureResult(record,await workbookInfo(body.url));
  const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify({identity,state:'saved',result}),{mode:0o600});fs.renameSync(temp,file);return result;
 }
 function matches(cell,expected){return expected.formula!==undefined?cell.formula===expected.formula:!cell.formula&&(cell.rawValue===expected.value||expected.value===''&&cell.rawValue==null);}
 async function recover(body){
  const file=journal(body);let old;try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {state:'not-started'};throw fail('GRID_UNCERTAIN','操作记录无法读取，请核对原表。');}
  const {resolutionToken,...original}=body;
  if(old.identity!==hash({...original,action:body.kind?'gridStructure':'gridWrite'}))throw fail('GRID_OPERATION','操作内容不一致。');
  if(['saved','acknowledged'].includes(old.state))return old.result;
  if(old.state==='rejected-scope')return {state:'not-started'};
  if(!old.expected){
   if(body.action==='gridResolve'){
    const s=proof({...body,token:resolutionToken});await current(body,s);
    const result={state:'acknowledged',revision:s.revision,meta:s.meta};persist(file,{...old,state:'acknowledged',result});return result;
   }
   if(!old.acknowledged)throw fail('GRID_UNCERTAIN','未收到行列操作回执，请核对当前原表；不会再次执行。');
   const result=structureResult(old,await workbookInfo(body.url));persist(file,{...old,state:'saved',result});return result;
  }
  if(body.action==='gridResolve')throw fail('GRID_OPERATION','仅行列操作支持人工核对。');
  const info=await workbookInfo(body.url),meta=sheetInfo(info,body.sheetId);
  if(meta.row_count!==old.meta.row_count||meta.column_count!==old.meta.column_count||info.data.revision!==old.revision+1)throw fail('GRID_UNCERTAIN','表格已变化，请核对原表和保留的输入。');
  const after=await cells(body.url,body.sheetId,old.address,old.bookToken),cell=locate(after,old.address);
  if(after.revision!==info.data.revision||!matches(cell,old.expected))throw fail('GRID_UNCERTAIN','保存结果待核对，输入已保留。');
  const result={state:'saved',address:old.address,cell,revision:after.revision},temp=file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify({identity:old.identity,state:'saved',result}),{mode:0o600});fs.renameSync(temp,file);return result;
 }
 let writes=Promise.resolve();
 return body=>{if(body.action==='gridRead')return read(body);if(body.action==='gridImages')return readImages(body);if(body.action==='gridFloating')return readFloating(body);if(!['gridWrite','gridStructure','gridRecover','gridResolve'].includes(body.action))throw fail('GRID_OPERATION','未知表格操作。');const p=writes.then(()=>['gridRecover','gridResolve'].includes(body.action)?recover(body):mutate(body));writes=p.catch(()=>{});return p;};
}
