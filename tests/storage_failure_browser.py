"""Actual UI/IndexedDB failure and recovery; synthetic records, isolated Edge profile."""
from pathlib import Path
import functools,http.server,threading,json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path.split('?',1)[0]=='/app.js':
   script=(ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.storageProbe={persistLocal,saveTask,seed:async(records)=>{await persistLocal(records);},lists:()=>({tasks,items}),db:()=>db};'
   data=script.encode();self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
checks=[]
def passed(name):checks.append(name);print('PASS '+name,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);ctx=browser.new_context(viewport={'width':1440,'height':1000})
  ctx.route('http://127.0.0.1:47821/**',lambda r:r.abort())
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}');page.wait_for_selector('#agent-chip')
  page.evaluate('''async()=>{
   localStorage.setItem('zhigao-agent-v1','off');localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'A',projects:[{id:'A',name:'隔离存储故障测试',status:'active',rules:[],library:[],notes:''}]}));
   const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});
   await new Promise((r,j)=>{const tx=db.transaction('items','readwrite');tx.objectStore('items').put({id:'synthetic-item',projectId:'A',author:'合成达人',platform:'小红书',kind:'图文',title:'保存故障',created:new Date().toISOString(),updated:new Date().toISOString(),publish:{date:'',link:'',status:'待排期'}});tx.oncomplete=r;tx.onerror=()=>j(tx.error)});db.close();
  }''')
  def open_item():
   page.locator('.navbtn[data-page=history]').click();page.locator('[data-action=open-item]').first.click();page.locator('details.wb-secondary > summary').click();page.wait_for_selector('#pub-status')
  def stored():return page.evaluate('''async()=>{const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const q=db.transaction('items').objectStore('items').get('synthetic-item');q.onsuccess=()=>{db.close();r(q.result)}})}''')
  page.reload();page.wait_for_selector('#agent-chip');open_item()
  for mode in ['quota','abort','unavailable']:
   before=stored()
   page.evaluate('''mode=>{window.restorePut=IDBObjectStore.prototype.put;window.restoreTx=IDBDatabase.prototype.transaction;
    if(mode==='unavailable')IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('unavailable','InvalidStateError');return restoreTx.apply(this,args)};
    else IDBObjectStore.prototype.put=function(...args){if(this.name==='items'){if(mode==='quota')throw new DOMException('full','QuotaExceededError');const r=restorePut.apply(this,args);this.transaction.abort();return r;}return restorePut.apply(this,args)};
   }''',mode)
   page.locator('#pub-status').select_option('已排期');page.locator('#pub-date').fill('2026-11-20');page.locator('[data-action=save-publish]').click()
   page.wait_for_function('document.querySelector("#toast").textContent.includes("未保存")')
   assert page.locator('#pub-date').input_value()=='2026-11-20';assert stored()['publish']==before['publish']
   if mode=='quota':page.screenshot(path=str(OUT/'save-failure-input-retained.png'),full_page=True)
   # Navigation must expose committed state, not the rejected mutation.
   open_item();assert page.locator('#pub-date').input_value()==before['publish']['date']
   page.evaluate('()=>{IDBObjectStore.prototype.put=restorePut;IDBDatabase.prototype.transaction=restoreTx;}')
   passed(mode+': no success, input retained, database and shared memory unchanged')
  page.locator('#pub-status').select_option('已排期');page.locator('#pub-date').fill('2026-11-20');page.locator('[data-action=save-publish]').click();page.wait_for_function('document.querySelector("#toast").textContent.includes("已保存")')
  page.reload();page.wait_for_selector('#agent-chip');open_item();assert page.locator('#pub-date').input_value()=='2026-11-20';assert stored()['publish']['date']=='2026-11-20'
  passed('successful retry survives page refresh')
  # Edit dialog stays open with entered values; its retry submits the same input.
  page.locator('[data-action=edit-item]').click();page.locator('#edit-author').fill('保留输入的达人')
  page.evaluate('''()=>{window.restorePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){if(this.name==='items')throw new DOMException('full','QuotaExceededError');return restorePut.apply(this,a)}}''')
  page.locator('[data-action=save-item-edit]').click();page.wait_for_selector('[data-save-error]');assert page.locator('#edit-author').input_value()=='保留输入的达人';assert stored()['author']=='合成达人'
  assert page.locator('[data-save-error]').inner_text()=='未保存，浏览器空间不足。'
  assert page.locator('#toast.show').count()==0
  page.screenshot(path=str(OUT/'dialog-failure-input-retained.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(OUT/'dialog-failure-mobile.png'),full_page=True);page.set_viewport_size({'width':1440,'height':1000})
  page.evaluate('()=>{IDBObjectStore.prototype.put=restorePut;}');page.locator('[data-action=save-item-edit]').click();page.wait_for_function('!document.querySelector("#edit-author")');assert stored()['author']=='保留输入的达人'
  passed('edit dialog keeps input and retries successfully')
  atomic=page.evaluate('''async()=>{
   const probe=window.storageProbe,t={id:'atomic-task',itemId:'synthetic-item',projectId:'A',cells:[{id:'p',current:'original'}]};await probe.seed([['tasks',t]]);
   const doc=probe.lists().tasks.find(x=>x.id===t.id),it=probe.lists().items.find(x=>x.id===doc.itemId);
   const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){if(this.name==='items')throw new DOMException('full','QuotaExceededError');return put.apply(this,a);};
   doc.cells[0].current='unsaved';it.author='unsaved author';let failed=false;
   try{await probe.saveTask(doc);}catch(e){failed=e.code==='LOCAL_SAVE_FAILED';}finally{IDBObjectStore.prototype.put=put;}
   const persisted=await new Promise(r=>{const q=probe.db().transaction('tasks').objectStore('tasks').get(t.id);q.onsuccess=()=>r(q.result)});
   const rollback={failed,memory:doc.cells[0].current,stored:persisted.cells[0].current,author:it.author};
   doc.cells[0].current='retried';it.author='retried author';await probe.saveTask(doc);
   const saved=await new Promise(r=>{const tx=probe.db().transaction(['tasks','items']),a=tx.objectStore('tasks').get(t.id),b=tx.objectStore('items').get(it.id);tx.oncomplete=()=>r({text:a.result.cells[0].current,author:b.result.author})});
   return {rollback,saved};
  }''')
  assert atomic=={'rollback':{'failed':True,'memory':'original','stored':'original','author':'保留输入的达人'},'saved':{'text':'retried','author':'retried author'}},atomic
  passed('task and item commit atomically; a failure in the second store rolls back both, successful retry commits both')
  assert not errors,errors
  (OUT/'result.json').write_text(json.dumps({'passed':True,'checks':checks,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8');ctx.close();browser.close()
finally:server.shutdown();server.server_close()
