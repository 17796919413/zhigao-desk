"""Real Edge UI lifecycle checks with synthetic deferred task responses."""
from pathlib import Path
import functools,http.server,threading,os,json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT'])/'task-panel';OUT.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
checks=[]
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);page=browser.new_page()
  page.route('**/fixture',lambda r:r.fulfill(content_type='text/html',body='<html><body><div id="root"></div></body></html>'))
  page.goto(f'http://127.0.0.1:{server.server_port}/fixture')
  page.evaluate('''async()=>{
   const {createTaskPanel}=await import('/task-panel.js');window.calls=[];window.defer=null;window.pending=null;
   window.value={taskId:'A',revision:'R',state:'preparing',requirements:[]};
   window.fetch=async(u,o)=>{const b=JSON.parse(o.body);calls.push(b);if(b.action===defer)await new Promise(r=>window.pending=r);return {ok:true,json:async()=>({ok:true,data:structuredClone(value)})};};
   window.panel=createTaskPanel({esc:s=>String(s).replaceAll('<','&lt;'),btn:(a,t,c='',extra='')=>`<button data-action="${a}" ${extra}>${t}</button>`,modal:(title,b,f)=>document.querySelector('#root').innerHTML=`<section class="modal"><div class="modal-body">${b}</div><footer class="modal-footer">${f}</footer></section>`,toast:()=>{},connect:async()=>{}});
  }''')
  page.evaluate("async()=>{defer='status';await panel.open({operation:'library'})}")
  page.wait_for_function('pending!==null')
  page.evaluate("async()=>{await panel.handle('close-modal');document.querySelector('#root').innerHTML='';pending();}")
  page.wait_for_timeout(100);assert page.locator('#task-preparation-panel').count()==0
  checks.append('Closing while status is pending cannot reopen the panel')
  page.evaluate("async()=>{pending=null;defer=null;value.state='preparing';await panel.open({operation:'library'});}")
  page.locator('[data-action=task-cancel]').focus();page.wait_for_timeout(700)
  assert page.evaluate("document.activeElement.dataset.action")=='task-cancel'
  checks.append('Polling preserves keyboard focus')
  page.evaluate("async()=>{await panel.handle('close-modal');document.querySelector('#root').innerHTML='';value.state='awaiting_confirmation';value.confirmation={message:'Synthetic preparation'};await panel.open({operation:'library'});defer='confirm';pending=null;window.first=panel.handle('task-approve');}")
  page.wait_for_function('pending!==null');page.evaluate("panel.handle('task-approve')")
  assert page.evaluate("calls.filter(c=>c.action==='confirm').length")==1
  page.evaluate("async()=>{await panel.handle('close-modal');document.querySelector('#root').innerHTML='<p id=other>Another dialog</p>';value.state='preparing';pending();await first;}")
  assert page.locator('#other').count()==1 and page.locator('#task-preparation-panel').count()==0
  checks.append('Repeated approval runs once; late completion preserves another dialog')
  page.evaluate("async()=>{defer=null;value.state='preparing';await panel.open({operation:'library'});}")
  before=page.evaluate("calls.filter(c=>c.action==='status').length");page.wait_for_timeout(700)
  assert page.evaluate("calls.filter(c=>c.action==='status').length")>before
  checks.append('Reopening an active preparation resumes polling')
  result=page.evaluate('''async()=>{
   await panel.handle('close-modal');document.querySelector('#root').innerHTML='';
   const {createTaskBridge}=await import('/task-context.js');let cancelled=false;const started=[];
   const project={id:'A',library:[{id:'one',ingestion:{assetKey:'one',filename:'one.mp4',format:'video'}},{id:'two',ingestion:{assetKey:'two',filename:'two.mp4',format:'video'}}]},state={settings:{selected:'A',projects:[project]},tasks:[]};
   window.fetch=async()=>({ok:true,json:async()=>({ok:true,data:{state:'resuming',cancelRequested:cancelled}})});
   const bridge=createTaskBridge({state:()=>state,getLibraryFile:async key=>({originalFile:new File(['synthetic'],key+'.mp4'),mediaRevision:'same'})},{zhigao_prepare_library_assets:async args=>{started.push(args.libraryId);cancelled=true;return {state:'processing'}}});
   const request={operation:'library',projectId:'A'},report=await bridge.context(request);let code;
   try{await bridge.resume({request,binding:report.binding,preparationId:'synthetic'});}catch(e){code=e.code;}
   const unsupported=await bridge.context({...request,clientCapabilities:{tools:false}});
   return {started,code,unsupported:unsupported.requirements.some(r=>r.id==='client:tools')};
  }''')
  assert result=={'started':['one'],'code':'TASK_CANCELLED','unsupported':True},result
  checks.append('Cancellation after first media material prevents second material and unsupported tools are explicit')
  result=page.evaluate('''async()=>{
   const {createTaskBridge}=await import('/task-context.js');
   const bytes=new TextEncoder().encode('same original bytes').buffer;
   const p={id:'A',library:[],feishu:{refined:{url:'https://example.feishu.cn/sheets/Saved'}}};
   const draft={id:'D',projectId:'A',fmt:'office-pending',buffer:bytes,filename:'source.doc',cells:[],flow:{round:1},updated:'before'};
   const state={settings:{selected:'A',projects:[p]},tasks:[draft]};let retry;
   const bridge=createTaskBridge({state:()=>state},{zhigao_prepare_video_review:async args=>{retry=args.retry;return {state:'processing'}}});
   const req={operation:'office',docId:'D',originalCall:{name:'zhigao_get_review_brief',args:{docId:'D',retry:true}}};
   const before=await bridge.context(req);
   Object.assign(draft,{fmt:'docx',officeOriginal:{buffer:bytes},buffer:new TextEncoder().encode('converted').buffer,cells:[{id:'c',current:'parsed'}],base:{c:'parsed'},updated:'after',mediaRevision:'new-derived-revision'});
   const converted=await bridge.context(req);draft.cells[0].current='user changed';const edited=await bridge.context(req);
   const url='https://example.feishu.cn/sheets/Explicit';
   const table=await bridge.context({operation:'feishu_read',originalCall:{name:'zhigao_extract_feishu',args:{url}}});
   state.tasks=[{id:'V',projectId:'A',fmt:'video',mediaRevision:'same',flow:{round:1},buffer:bytes}];
   const video={operation:'office',docId:'V',originalCall:{name:'zhigao_prepare_video_review',args:{docId:'V',retry:true}}},report=await bridge.context(video);
   await bridge.resume({request:video,binding:report.binding});
   return {same:before.binding.fingerprint===converted.binding.fingerprint,changed:edited.binding.fingerprint!==converted.binding.fingerprint,url:table.tableUrl,retry};
  }''')
  assert result=={'same':True,'changed':True,'url':'https://example.feishu.cn/sheets/Explicit','retry':True},result
  checks.append('Converted source resumes with stable identity; user edits invalidate it; explicit URL and retry reach original adapters')
  page.add_script_tag(url=f'http://127.0.0.1:{server.server_port}/vendor/jszip.min.js')
  result=page.evaluate('''async()=>{
   const {makeBundle,readBundle}=await import('/bundle.js'),{digest}=await import('/review-assurance.js'),{createDelivery}=await import('/review-delivery.js');
   const original=new TextEncoder().encode('synthetic old original').buffer,buffer=new TextEncoder().encode('synthetic modern copy').buffer;
   const officeConversion={sourceHash:await digest(original),convertedHash:await digest(buffer),jobId:'local-only'},officeOriginal={filename:'旧稿.doc',buffer:original};
   const d={id:'D',projectId:'A',filename:'旧稿.docx',fmt:'docx',buffer,officeOriginal,officeConversion,cells:[],rounds:[{round:1,filename:'历史.docx',buffer,officeOriginal,officeConversion}]};
   const input={projects:[{id:'A',name:'Synthetic'}],items:[],docs:[d],media:[]},blob=await makeBundle(input),restored=(await readBundle(blob)).docs[0];
   const z=await JSZip.loadAsync(blob);z.file('files/D/office-original','tampered');let rejected=false;
   try{await readBundle(await z.generateAsync({type:'blob'}));}catch{rejected=true;}
   let saved,filename,bytes;const delivery=createDelivery({available:()=>true,get:()=>d,save:async t=>saved=t,write:async(t,kind,name,file)=>{filename=name;bytes=await file.text();return 'archive-path';}});await delivery.original(d);
   return {history:restored.rounds[0].officeOriginal.buffer.byteLength,original:original.byteLength,job:restored.officeConversion.jobId||null,historyJob:restored.rounds[0].officeConversion.jobId||null,rejected,filename,bytes,saved:saved.originalSaved};
  }''')
  assert result['history']==result['original'] and result['job'] is None and result['historyJob'] is None and result['rejected']
  assert result['filename'].endswith('旧稿.doc') and result['bytes']=='synthetic old original' and result['saved']=='archive-path'
  checks.append('Current and historical original bytes survive bundle; tampering fails and archive retains the old filename')
  browser.close()
finally:server.shutdown();server.server_close()
(OUT/'result.json').write_text(json.dumps({'passed':True,'checks':checks},indent=2),encoding='utf-8')
print(json.dumps({'passed':True,'checks':checks}))
