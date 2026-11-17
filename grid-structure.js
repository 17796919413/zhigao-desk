import {esc} from './engine.js';
import {columnName} from './source-grid.js';

// A workbook-scoped pending record survives refresh and is shared by tabs.
// All structural and cell writes use the same browser lock.
export function createGridStructure({request,storage,context,finish,onChanged,onStatus,repaint,onSettled=()=>{}}){
 let flight=false,dialog=null;
 const key=url=>'zhigao-grid-structure:'+url;
 const read=url=>JSON.parse(storage.getItem(key(url))||'null');
 const lock=fn=>navigator.locks?navigator.locks.request('zhigao-grid-writes',fn):Promise.reject(Error('当前浏览器不支持安全保存，请使用 Edge 或 Chrome。'));
 const label=(d,p,n)=>d==='row'?`第 ${p}${n>1?'–'+(p+n-1):''} 行`:`${columnName(p-1)}${n>1?'–'+columnName(p+n-2):''} 列`;
 const same=c=>{const now=context();return now.url===c.url&&now.projectId===c.projectId&&now.data?.sheetId===c.data?.sheetId;};
 function blocked(){try{return flight||!!read(context().url);}catch{return true;}}
 function notice(){try{const p=read(context().url);return p?(flight?'正在更新行列…':p.error||'行列操作待核对'):'';}catch{return '行列操作记录无法读取，请检查浏览器存储。';}}
 function close(){dialog?.close();dialog?.remove();dialog=null;}
 function draftCheck(url){for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k.startsWith('zhigao-grid-drafts:')&&k.endsWith(':'+url)&&Object.keys(JSON.parse(storage.getItem(k)||'{}')).length)throw Error('请先保存待处理的单元格，再增删行列。');}}
 async function complete(c,p,result){
  // Invalidate stale row mappings before releasing the workbook for editing.
  await onChanged({...c,body:p.body,result});
  onSettled({projectId:c.projectId,url:c.url,sheetId:p.body.sheetId});
  storage.removeItem(key(c.url));
  if(same(c))onStatus(result.state==='saved'?'行列已更新':'已按核对后的原表继续');
 }
 async function recover(c){
  const p=read(c.url);if(!p)return;
  const result=await request('gridRecover',p.body);
  if(result.state==='not-started'){
   // No connector journal means no mutation was dispatched. Never reissue
   // a structural request automatically; a new user action needs a fresh view.
   onSettled({projectId:c.projectId,url:c.url,sheetId:p.body.sheetId});
   storage.removeItem(key(c.url));if(same(c))onStatus('上次行列操作未执行，请重新选择。');return;
  }
  if(!['saved','acknowledged'].includes(result.state))throw Error('行列操作仍待核对。');
  await complete(c,p,result);
 }
 async function guarded(c,fn){if(flight)return;flight=true;repaint();try{await lock(fn);}catch(e){const p=read(c.url);if(p){p.error=e.message;storage.setItem(key(c.url),JSON.stringify(p));}if(same(c))onStatus(e.message);}finally{flight=false;repaint();}}
 async function resume(){const c=context();if(!c.url||!read(c.url)||flight)return;await guarded(c,()=>recover(c));}
 async function resumeAccess(){
  const c=context(),p=read(c.url);if(!p||flight)return;
  await guarded(c,async()=>{
   const result=await request('gridRecover',p.body);
   if(result.state!=='not-started'){if(!['saved','acknowledged'].includes(result.state))throw Error('行列操作仍待核对。');await complete(c,p,result);return;}
   // Login failed before dispatch: preserve the user's exact confirmed range.
   // The original snapshot token is revalidated by the runtime before any write.
   if(!same(c)||p.projectId!==c.projectId)throw Error('表格已切换，请重新选择。');
   draftCheck(c.url);
   await complete(c,p,await request('gridStructure',p.body));
  });
 }
 async function submit(c,dimension,position,count,kind){
  onStatus('正在准备行列操作…');repaint();
  await finish();if(!same(c))throw Error('表格已切换，请重新选择。');
  await guarded(c,async()=>{
   if(read(c.url))throw Error('请先核对上次行列操作。');draftCheck(c.url);
   if(!same(c))throw Error('表格已切换，请重新选择。');
   const body={url:c.url,sheetId:c.data.sheetId,token:c.data.token,dimension,position,count,kind,operationId:crypto.randomUUID(),...(kind==='delete'?{confirmation:`${c.data.sheetId}:${dimension}:${position}:${count}`}:{})};
   const p={body,projectId:c.projectId,sheetTitle:c.data.sheets.find(s=>s.sheet_id===body.sheetId)?.title||body.sheetId};
   storage.setItem(key(c.url),JSON.stringify(p));repaint();
   const result=await request('gridStructure',body);
   await complete(c,p,result);
  });
 }
 function open(dimension,position){
  const c=context();if(!c.data||blocked())return;close();
  const bound=dimension==='row'?c.data.meta.row_count:c.data.meta.column_count;
  const title=c.data.sheets.find(s=>s.sheet_id===c.data.sheetId)?.title||c.data.sheetId;
  dialog=document.createElement('dialog');dialog.className='grid-structure-dialog';dialog.setAttribute('aria-label','增删行列');
  dialog.innerHTML=`<form><h2>${esc(title)} · ${label(dimension,position,1)}</h2><label>操作<select class="input" name="kind"><option value="insert">在此之前插入</option><option value="delete">从此处删除</option></select></label><label>数量<input class="input" name="count" type="number" min="1" max="100" value="1" required></label><p data-structure-preview></p><p class="error" role="alert"></p><div class="grid-structure-actions"><button type="button" class="button" data-structure-cancel>取消</button><button type="submit" class="button primary" data-structure-submit>插入</button></div></form>`;
  const d=dialog,form=d.querySelector('form'),preview=d.querySelector('[data-structure-preview]'),button=d.querySelector('[type=submit]');
  const update=()=>{const kind=form.elements.kind.value,count=Number(form.elements.count.value),valid=Number.isInteger(count)&&count>=1&&count<=100&&(kind!=='delete'||position+count-1<=bound&&count<bound);preview.textContent=valid?(kind==='delete'?`删除 ${label(dimension,position,count)}，其中的内容也会删除。`:`在 ${label(dimension,position,1)} 之前插入 ${count} ${dimension==='row'?'行':'列'}。`):'数量超出可操作范围。';button.textContent=kind==='delete'?'确认删除':'插入';button.disabled=!valid;};
  form.addEventListener('input',update);d.querySelector('[data-structure-cancel]').onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close();});
  form.onsubmit=async e=>{e.preventDefault();if(button.disabled)return;const count=Number(form.elements.count.value),kind=form.elements.kind.value;button.disabled=true;close();try{await submit(c,dimension,position,count,kind);}catch(e){onStatus(e.message);repaint();}};
  document.body.append(d);update();d.showModal();form.elements.kind.focus();
 }
 async function inspect(){
  const c=context(),p=read(c.url);if(!p||flight)return;
  await guarded(c,async()=>{
   try{await recover(c);return;}catch(e){if(e.code!=='GRID_UNCERTAIN')throw e;}
   const fresh=await request('gridRead',{url:c.url,sheetId:p.body.sheetId,startRow:1,pageSize:40});if(!same(c))return;
   close();const b=p.body;dialog=document.createElement('dialog');dialog.className='grid-structure-dialog';dialog.setAttribute('aria-label','核对行列操作');
   dialog.innerHTML=`<h2>核对行列操作</h2><p>${esc(p.sheetTitle)} · ${b.kind==='insert'?'插入':'删除'} ${label(b.dimension,b.position,b.count)}</p><p>没有收到完整结果。当前原表为 ${fresh.meta.row_count} 行、${fresh.meta.column_count} 列。</p><p>请打开飞书，核对上述位置及周围内容。确认后按当前原表继续，本次操作不会重做。</p><p><a class="textbtn" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">在飞书打开</a></p><div class="grid-structure-actions"><button class="button" data-structure-cancel>稍后核对</button><button class="button primary" data-structure-resolve>已核对，继续使用</button></div>`;
   dialog.querySelector('[data-structure-cancel]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
   dialog.querySelector('[data-structure-resolve]').onclick=async()=>{close();await guarded(c,async()=>{if(!same(c))throw Error('表格已切换，请重新核对。');const result=await request('gridResolve',{...b,resolutionToken:fresh.token});await complete(c,p,result);});};
   document.body.append(dialog);dialog.showModal();
  });
 }
 return {open,close,blocked,notice,resume,resumeAccess,inspect};
}
