import {esc} from './engine.js';
import {gridCells,gridTable,cellEditable,editText,editValue,imageContent} from './source-grid.js';
import {createGridStructure} from './grid-structure.js';
import {createGridAccess} from './grid-access.js';

// Drafts contain user input and the observed row, never credentials or sessions.
export function createGridEditor({request:rawRequest,storage=localStorage,onSaved=()=>{},prepareAccess,currentActivity=()=> 'legacy',currentProject=null}){
 let root=null,key='',projectId='',url='',data=null,sheetId='',startRow=1,loading=false,error='',localError='',status='',editing='',generation=0,timer=null,flight=null,paintedView='',editingPosition='',resizeObserver=null;
 let imageStates={};
 const draftKey=(sid,address)=>sid+'!'+address;
 const read=()=>{const v=JSON.parse(storage.getItem(key)||'{}');if(!v||Array.isArray(v)||typeof v!=='object')throw Error('待保存内容无法读取。');return v;};
 const write=v=>{storage.setItem(key,JSON.stringify(v));};
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const rowContext=(value,address)=>Object.fromEntries([...gridCells(value)].filter(([cell])=>cell!==address&&cell.match(/\d+$/)?.[0]===address.match(/\d+$/)?.[0]));
 const conflict=()=>Object.assign(Error('此行已在飞书修改，输入已保留。请查看最新内容后重新编辑。'),{code:'GRID_EDIT_CONFLICT'});
 const access=createGridAccess({request:rawRequest,storage,context:()=>({projectId:currentProject?currentProject():projectId,activityId:currentActivity(),url,sheetId}),prepare:prepareAccess,onError:e=>{error=e.message;paint();},resume:async p=>{
  if(flight)await flight;
  await refresh();if(error)throw Error(error);
  if(p.action!=='gridRead'){
   if(structure.blocked())await structure.resumeAccess();else await retry();
   if(structure.blocked()||Object.keys(read()).length)throw Error(error||structure.notice()||'输入仍待保存，请核对原表后继续。');
  }
 }});
 const request=access.request;
 const structure=createGridStructure({request,storage,context:()=>({projectId,url,data}),finish:async()=>{finish();if(localError)throw Error(localError);await flush();},onStatus:message=>{error=message;status=message;},repaint:()=>paint(),onSettled:c=>{if(projectId===c.projectId&&url===c.url&&sheetId===c.sheetId)access.settle('gridStructure');},onChanged:async c=>{await onSaved({projectId:c.projectId,url:c.url,sheetId:c.body.sheetId,structure:true});if(url===c.url&&projectId===c.projectId){startRow=1;await refresh();}}});
 window.addEventListener('storage',e=>{if(e.key==='zhigao-grid-structure:'+url){if(!e.newValue){startRow=1;refresh();}else paint();}});
 function paint(){if(!root)return;let drafts={};try{drafts=read();error=error||Object.values(drafts).find(d=>d.blocked)?.error||'';}catch(e){error=e.message;}
  const focus=root.querySelector('[data-grid-input]'),selection=focus&&[focus.selectionStart,focus.selectionEnd],wasFocused=focus===document.activeElement;
  const view=key+':'+data?.sheetId+':'+data?.startRow,scroll=root.querySelector('.source-grid-scroll'),position=paintedView===view&&scroll?[scroll.scrollLeft,scroll.scrollTop]:null;
  root.innerHTML=`<div class="panel-heading"><h2>${esc(data?.title||'表格视图')}</h2><button class="button small" data-grid-refresh ${loading||!url?'disabled':''}>${loading?'读取中…':'刷新表格'}</button></div><div class="source-grid-tools"><label>子表 <select class="input" data-grid-sheet aria-label="选择审核子表">${data?.sheets.map(s=>`<option value="${esc(s.sheet_id)}" ${s.sheet_id===data.sheetId?'selected':''}>${esc(s.title||s.sheet_name)}</option>`).join('')||'<option>尚未读取</option>'}</select></label><span role="status" data-grid-status>${esc(error||(Object.keys(drafts).length?'正在保存到飞书…':status||'双击单元格编辑，修改后自动保存到飞书'))}</span></div>${gridTable(data,drafts,editing,editingPosition,imageStates)}<div class="table-pagination"><span>${data?`第 ${data.startRow}–${data.endRow} 行，共 ${data.meta.row_count} 行`:''}</span><div><button class="button small" data-grid-prev ${!data||startRow<=1||loading?'disabled':''}>上一页</button><button class="button small" data-grid-next ${!data||data.endRow>=data.meta.row_count||loading?'disabled':''}>下一页</button></div></div>`;
  const input=root.querySelector('[data-grid-input]');if(input&&focus&&input.dataset.gridInput===focus.dataset.gridInput&&input.dataset.gridPosition===focus.dataset.gridPosition)input.value=focus.value;
  if(localError)root.querySelector('[data-grid-status]').textContent=localError;
  const structureNotice=structure.notice();if(structureNotice){root.querySelector('[data-grid-status]').textContent=structureNotice;const b=document.createElement('button');b.className='textbtn';b.dataset.gridStructureRecover='';b.textContent='核对行列';root.querySelector('.source-grid-tools').append(b);}
  for(const b of root.querySelectorAll('[data-grid-dimension]'))b.disabled=loading||structure.blocked();
  if(wasFocused){input?.focus({preventScroll:true});if(input&&selection)input.setSelectionRange(...selection);}
  const nextScroll=root.querySelector('.source-grid-scroll');if(position&&nextScroll){nextScroll.scrollLeft=position[0];nextScroll.scrollTop=position[1];}paintedView=view;
  resizeObserver?.disconnect();
  if(nextScroll){const fit=()=>{if(root?.querySelector('.source-grid-scroll')!==nextScroll)return;const fh=Number(nextScroll.dataset.gridFrozenHeight),fw=Number(nextScroll.dataset.gridFrozenWidth),rowOverflow=fh>0&&fh>nextScroll.clientHeight-76,colOverflow=fw>0&&fw>nextScroll.clientWidth-92;nextScroll.classList.toggle('grid-unpin-rows',rowOverflow);nextScroll.classList.toggle('grid-unpin-cols',colOverflow);root.querySelector('[data-grid-freeze-note]').hidden=!(rowOverflow||colOverflow);};fit();resizeObserver=new ResizeObserver(fit);resizeObserver.observe(nextScroll);}
  paintFloatingNotice();
 }
 function paintFloatingNotice(){
  if(!data?.floatingError||!root||root.querySelector('[data-grid-floating-error]'))return;
  const note=document.createElement('span');note.dataset.gridFloatingError='';note.textContent='浮动图片未加载，刷新表格重试。';note.setAttribute('role','status');root.querySelector('.source-grid-tools')?.append(note);
 }
 function paintImages(){
  const refs=new Map((data?.images||[]).map(r=>[r.id,r]));
  for(const node of root?.querySelectorAll('[data-grid-image]')||[]){
   const ref=refs.get(node.dataset.gridImage);if(!ref)continue;
   const image=imageStates[ref.id],state=image?.state==='ready'?'ready':image?'unavailable':'loading';
   if(node.dataset.gridImageState===state&&(state!=='ready'||node.querySelector('img')?.getAttribute('src')===image.url))continue;
   node.outerHTML=imageContent(ref,imageStates);
  }
 }
 async function loadImages(value,g){
  const shown=new Set([...root.querySelectorAll('[data-grid-image]')].map(n=>n.dataset.gridImage));
  const ids=(value.images||[]).filter(r=>shown.has(r.id)&&!imageStates[r.id]).map(r=>r.id);
  for(let offset=0;offset<ids.length;offset+=5){
   if(g!==generation||data!==value)return;
   const batch=ids.slice(offset,offset+5);
   try{
    const response=await rawRequest('gridImages',{url,sheetId:value.sheetId,token:value.token,ids:batch});
    if(g!==generation||data!==value)return;
    for(const id of batch)imageStates[id]=response.revision===value.revision?response.images?.find(i=>i.id===id)||{state:'unavailable'}:{state:'unavailable'};
   }catch(e){
    if(g!==generation||data!==value)return;
    for(const id of batch)imageStates[id]={state:'unavailable'};
    if(['FEISHU_AUTH','FEISHU_SCOPE','FEISHU_ACCESS','GRID_CHANGED','GRID_STALE'].includes(e.code)){for(const id of ids.slice(offset+5))imageStates[id]={state:'unavailable'};paintImages();return;}
   }
   paintImages();
  }
 }
 async function loadFloating(value,g){
  if(!value.floatingAvailable||g!==generation||data!==value)return;
  try{
   const response=await rawRequest('gridFloating',{url,sheetId:value.sheetId,token:value.token});
   if(g!==generation||data!==value)return;
   if(response.revision!==value.revision)throw Error('原表版本已变化。');
   value.floatingImages=response.floatingImages||[];value.floatingLayout=response.floatingLayout;
   value.images=[...(value.images||[]),...value.floatingImages];
   // Append only the new picture fragments. Late geometry must not replace an
   // existing image, active editor, selection or scroll container.
   const template=document.createElement('template');template.innerHTML=gridTable(value,{},'','',imageStates);
   const destinations=new Map([...root.querySelectorAll('[data-grid-position]')].filter(n=>n.matches('td')).map(n=>[n.dataset.gridPosition,n]));
   for(const fragment of template.content.querySelectorAll('.grid-float-fragment'))destinations.get(fragment.parentElement.dataset.gridPosition)?.append(fragment);
   await loadImages(value,g);
  }catch(e){
   if(g!==generation||data!==value)return;
   value.floatingError=true;paintFloatingNotice();
  }
 }
 async function refresh(){const g=++generation,u=url;loading=true;error='';paint();try{const value=await request('gridRead',{url:u,sheetId,startRow,pageSize:40});if(g!==generation||u!==url)return;data=value;imageStates={};sheetId=value.sheetId;status='';}catch(e){if(g===generation)error=e.message;}finally{if(g===generation){loading=false;paint();if(data&&!error){const value=data;loadImages(value,g).then(()=>loadFloating(value,g)).catch(()=>{});}}}}
 function record(el){try{const address=el.dataset.gridInput,dk=draftKey(data.sheetId,address),drafts=read(),cell=gridCells(data).get(address)||{},old=drafts[dk],base=old?.blocked&&!old.request?null:old;if(el.value===editText(cell)&&!old?.request)delete drafts[dk];else drafts[dk]={...old,sheetId:data.sheetId,address,text:el.value,base:base?.base||cell,row:base?.row||rowContext(data,address),revision:base?.revision??data.revision,rows:data.meta.row_count,cols:data.meta.column_count,version:(old?.version||0)+1,error:'',blocked:false,attempts:0,retryAt:0};write(drafts);error='';localError='';status=Object.keys(drafts).length?'正在保存到飞书…':'已保存';root.querySelector('[data-grid-status]').textContent=status;}catch(e){localError='输入尚未保存：'+e.message;root.querySelector('[data-grid-status]').textContent=localError;}}
 function startEdit(address,position){if(structure.blocked())return;if(editing&&(editing!==address||editingPosition!==position)){finish();if(localError)return;}const cell=gridCells(data).get(address);if(!cell||!cellEditable(cell))return;editing=address;editingPosition=position;paint();const el=root.querySelector('[data-grid-input]');el?.focus({preventScroll:true});el?.select();}
 function finish(){if(!editing)return;const el=root.querySelector('[data-grid-input]');if(el)record(el);if(localError)return;editing='';editingPosition='';paint();clearTimeout(timer);timer=setTimeout(()=>flush(),200);}
 async function run(){
  if(structure.blocked())return;
  const runKey=key,runUrl=url,runProject=projectId;const readRun=()=>JSON.parse(storage.getItem(runKey)||'{}'),saveRun=v=>storage.setItem(runKey,JSON.stringify(v));
  for(const id of Object.keys(readRun())){
   if(runKey!==key||structure.blocked())return;let drafts=readRun(),d=drafts[id];if(!d||d.blocked||d.error&&!d.retryAt||d.retryAt>Date.now()||editing===d.address&&data?.sheetId===d.sheetId)continue;
   let body=d.request,response;
   try{
    if(body){response=await request('gridRecover',body);if(response.state==='not-started'){delete d.request;drafts=readRun();if(drafts[id]){delete drafts[id].request;saveRun(drafts);}body=null;} }
    if(!body){
     const current=await request('gridRead',{url:runUrl,sheetId:d.sheetId,startRow:Math.floor((Number(d.address.match(/\d+$/)[0])-1)/40)*40+1,pageSize:40},'gridWrite');
     if(runKey!==key)return;
     if(current.meta.row_count!==d.rows||current.meta.column_count!==d.cols||!same(gridCells(current).get(d.address),d.base)||current.revision!==d.revision&&(!d.row||!same(rowContext(current,d.address),d.row)))throw conflict();
     d={...d,revision:current.revision,row:rowContext(current,d.address)};
     body={url:runUrl,sheetId:d.sheetId,token:current.token,address:d.address,cell:editValue(d.text,d.base),operationId:crypto.randomUUID()};
     drafts=readRun();if(!drafts[id]||drafts[id].version!==d.version)continue;
     Object.assign(drafts[id],{revision:d.revision,row:d.row,request:body,sentText:d.text});saveRun(drafts);
     response=await request('gridWrite',body);
    }
    if(response.state!=='saved')throw Error('保存结果待核对，输入已保留。');
    drafts=readRun();const latest=drafts[id];if(latest){if(latest.text===(latest.sentText??d.text))delete drafts[id];else{latest.base=response.cell;latest.revision=response.revision;delete latest.request;delete latest.sentText;latest.error='';}}
    // Only the known single revision can advance other queued cells. An external
    // edit (including a same-size row move) never silently rebases stale addresses.
    for(const x of Object.values(drafts))if(!x.request){if(x.revision===d.revision&&response.revision===d.revision+1)x.revision=response.revision;if(x.sheetId===d.sheetId&&x.row?.[d.address]&&same(x.row[d.address],d.base))x.row[d.address]=response.cell;}
    saveRun(drafts);onSaved({projectId:runProject,url:runUrl,sheetId:d.sheetId});
    if(runKey===key){status='保存中…';if(data?.sheetId===d.sheetId)await refresh();status='已保存';paint();}
   }catch(e){drafts=readRun();if(drafts[id]){const value=drafts[id],needsAccess=['FEISHU_AUTH','FEISHU_SCOPE','FEISHU_CONFIG','FEISHU_CLI_MISSING'].includes(e.code);value.error=e.message;value.blocked=e.code==='GRID_EDIT_CONFLICT';value.attempts=(value.attempts||0)+1;value.retryAt=!value.blocked&&!needsAccess&&value.attempts<4?Date.now()+1000*value.attempts:0;saveRun(drafts);}if(runKey===key){error='保存未完成：'+e.message;if(e.code==='GRID_EDIT_CONFLICT')await refresh();paint();}break;}
  }
 }
 function flush(){if(flight)return flight;flight=(navigator.locks?navigator.locks.request('zhigao-grid-writes',run):Promise.reject(Error('当前浏览器不支持安全保存，请使用 Edge 或 Chrome。'))).catch(e=>{error=e.message;paint();}).finally(()=>{flight=null;try{const pending=Object.values(read()).filter(d=>!d.blocked&&(!d.error||d.retryAt)&&!(editing===d.address&&data?.sheetId===d.sheetId));if(!structure.blocked()&&pending.length){clearTimeout(timer);timer=setTimeout(flush,Math.max(250,Math.min(...pending.map(d=>(d.retryAt||0)-Date.now()))));}}catch{}});return flight;}
 async function retry(){
  if(editing)finish();const drafts=read();for(const d of Object.values(drafts))if(!d.blocked){d.error='';d.attempts=0;d.retryAt=0;}write(drafts);error='';paint();await flush();
 }
 function bind(){root.addEventListener('error',e=>{if(!e.target.matches?.('[data-grid-image] img'))return;const node=e.target.closest('[data-grid-image]');imageStates[node.dataset.gridImage]={state:'unavailable'};paintImages();},true);
  root.addEventListener('dblclick',e=>{const td=e.target.closest('[data-grid-cell]');if(td&&!e.target.closest('a'))startEdit(td.dataset.gridCell,td.dataset.gridPosition);});
  root.addEventListener('input',e=>{if(e.target.matches('[data-grid-input]'))record(e.target);});
  root.addEventListener('focusout',e=>{if(e.target.matches('[data-grid-input]'))setTimeout(()=>{if(editing&&!root.querySelector('[data-grid-input]')?.matches(':focus'))finish();},0);});
  root.addEventListener('keydown',e=>{if(e.target.matches('[data-grid-input]')){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();finish();}}else if(e.key==='Enter'&&e.target.dataset.gridCell){e.preventDefault();startEdit(e.target.dataset.gridCell,e.target.dataset.gridPosition);}});
  root.addEventListener('change',e=>{if(e.target.matches('[data-grid-sheet]')){const target=e.target.value;structure.close();finish();if(localError){paint();return;}sheetId=target;startRow=1;refresh();}});
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.gridDimension)structure.open(b.dataset.gridDimension,Number(b.dataset.gridIndex));if(b.hasAttribute('data-grid-structure-recover'))structure.inspect().catch(e=>{error=e.message;paint();});});
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-grid-refresh'))refresh().then(()=>{if(!error)return retry();}).catch(e=>{error=e.message;paint();});if(b.hasAttribute('data-grid-prev')||b.hasAttribute('data-grid-next')){finish();if(localError)return;startRow=Math.max(1,startRow+(b.hasAttribute('data-grid-next')?40:-40));refresh();}});
 }
 return {mount(p){const placeholder=document.querySelector('#source-grid-panel');if(!placeholder)return;const nextUrl=p.feishu?.refined?.url||'',nextKey='zhigao-grid-drafts:'+p.id+':'+nextUrl;
   if(key!==nextKey){structure.close();generation++;key=nextKey;projectId=p.id;url=nextUrl;data=null;imageStates={};sheetId=p.feishu?.refined?.sheet||'';startRow=1;editing='';editingPosition='';resizeObserver?.disconnect();error='';localError='';status='';root=null;}
    if(root){
     placeholder.replaceWith(root);
     const latest=p.feishu?.liveMeta;
     if(!loading&&latest?.url===url&&Number.isInteger(latest.revision)&&Number.isInteger(data?.revision)&&latest.revision>data.revision)refresh();
     return;
    }root=placeholder;bind();paint();if(url)refresh().then(async()=>{if(!access.restore()&&!error){await structure.resume();await retry();}}).catch(e=>{error=e.message;paint();});
  },refresh,flush,accessContext:access.pending,resumeAccess:access.resume,html:()=>'<section id="source-grid-panel" class="panel review-table-panel"></section>'};
}
