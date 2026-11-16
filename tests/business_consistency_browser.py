"""Synthetic UI regression; app probe is served only by this isolated test server."""
from pathlib import Path
import os,json,functools,http.server,threading,traceback,io,zipfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/app.js':
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.probe={state:()=>({tasks,items,settings}),persist:commitWorkbench,local:persistLocal,applyBundle,render,db:()=>db,videoNotesHtml,fsLiveWrites,createBatch:createUIReviewBatch};').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
results=[]
READ="""async s=>await new Promise((ok,no)=>{const r=probe.db().transaction(s).objectStore(s).getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})"""
def fresh(browser):
 c=browser.new_context(viewport={'width':1440,'height':1000});c.route('http://127.0.0.1:47821/**',lambda r:r.abort())
 c.add_init_script("if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-agent-v1','off');localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'audit',projects:[{id:'audit',name:'合成测试',status:'active',rules:[],library:[],notes:''}]}));localStorage.setItem('seed','1')}")
 p=c.new_page();p.goto(origin);p.wait_for_function('!!window.probe');return c,p
def upload(p,name='【合成达人】小红书图文大纲v1.txt',text='合成原稿'):
 n=p.locator('.wb-row').count();p.locator('#file-input').set_input_files({'name':name,'mimeType':'text/plain','buffer':text.encode()});p.wait_for_function('(n)=>document.querySelectorAll(".wb-row").length===n',arg=n+1)
def bundle():
 return {'kind':'zhigao-bundle','version':1,'created':'2026-11-13','projects':[{'id':'transfer','name':'合成导入品牌','rules':[],'library':[],'notes':''}],
 'items':[{'id':'ti','projectId':'transfer','author':'合成达人','platform':'小红书','kind':'视频','title':'视频反馈','created':'2026-11-13','updated':'2026-11-13','publish':{'status':'待排期'}}],
 'docs':[{'id':'td','itemId':'ti','projectId':'transfer','projectName':'合成导入品牌','author':'合成达人','platform':'小红书','kind':'视频','stage':'初稿','filename':'合成视频.mp4','fmt':'video','duration':1,'size':1,'width':1,'height':1,'cells':[],'base':{},'findings':[],'created':'2026-11-13','updated':'2026-11-13','remarks':[],'flow':{'state':'review','round':1,'log':[],'feedback':[],'submissions':[]}}], 'media':[]}
def package(m):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w') as z:z.writestr('manifest.json',json.dumps(m,ensure_ascii=False))
 return b.getvalue()
def run(name,fn,browser):
 if os.environ.get('ZHIGAO_TEST_IDS') and name not in os.environ['ZHIGAO_TEST_IDS'].split(','):return
 c,p=fresh(browser);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 try:
  fn(c,p);assert not errors,errors;results.append({'id':name,'passed':True})
 except Exception:results.append({'id':name,'passed':False,'error':traceback.format_exc()})
 finally:
  print(('PASS ' if results[-1]['passed'] else 'FAIL ')+name,flush=True);c.close();(OUT/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
def feedback_conflict(c,p):
 upload(p);q=c.new_page();q.goto(origin);q.wait_for_function('!!window.probe')
 for page,text in [(p,'甲已保存的反馈'),(q,'乙尚待保存的反馈')]:
  page.locator('.wb-feedback summary').click();page.locator('[data-feedback-text]').fill(text);page.locator('[data-action=wb-feedback-save]').click()
  page.wait_for_function('document.querySelector(".wb-feedback-entry") || document.querySelector("#toast.show")')
 rows=p.evaluate(READ,'tasks');texts=[f['text'] for f in rows[0].get('brandFeedback',[])]
 assert '甲已保存的反馈' in texts,texts
 if len(texts)!=2:assert q.locator('[data-feedback-text]').input_value()=='乙尚待保存的反馈';assert '变化' in q.locator('#toast').inner_text() or '更新' in q.locator('#toast').inner_text()
 q.screenshot(path=str(OUT/'feedback-conflict.png'),full_page=True)
def deletion(c,p):
 upload(p);q=c.new_page();q.goto(origin);q.wait_for_function('!!window.probe');q.locator('.wb-meta summary').click();q.locator('[data-action=open-task]').click()
 p.locator('[data-action=delete-task]').click();p.locator('[data-action=confirm-delete]').click();p.wait_for_function('!document.querySelector(".wb-row")')
 q.locator('[data-action=flow-ready]').click();q.locator('[data-action=flow-confirm]').click();q.wait_for_timeout(200)
 assert not q.evaluate(READ,'tasks');assert not q.evaluate(READ,'items')
def import_failure(c,p,mode):
 p.evaluate("""mode=>{window.put=IDBObjectStore.prototype.put;window.set=Storage.prototype.setItem;if(mode==='settings')Storage.prototype.setItem=function(k,v){if(k==='zhigao-settings-v1')throw new DOMException('test','QuotaExceededError');return set.call(this,k,v)};else IDBObjectStore.prototype.put=function(v,...a){if(this.name==='tasks')throw new DOMException('test','QuotaExceededError');return put.call(this,v,...a)}}""",mode)
 p.locator('#bundle-input').set_input_files({'name':'测试.zip','mimeType':'application/zip','buffer':package(bundle())});p.locator('[data-action=import-bundle-confirm]').click();p.wait_for_timeout(300)
 assert not p.evaluate(READ,'tasks');assert not p.evaluate(READ,'items');assert 'transfer' not in p.evaluate("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects.map(p=>p.id)")
 assert '已导入' not in p.locator('#toast').inner_text()
 p.evaluate('()=>{Storage.prototype.setItem=set;IDBObjectStore.prototype.put=put}')
 p.locator('[data-action=import-bundle-confirm]').click();p.wait_for_function('probe.state().tasks.length===1')
 p.reload();p.wait_for_function('!!window.probe');assert len(p.evaluate(READ,'tasks'))==1;assert len(p.evaluate(READ,'items'))==1
def injection(c,p):
 m=bundle();m['docs'][0]['remarks']=[{'id':'n','status':'open','t':0,'cat':'画面','text':'测试','shot':'x" onerror="document.body.dataset.auditXss=1" data-x="'}]
 p.locator('#bundle-input').set_input_files({'name':'测试.zip','mimeType':'application/zip','buffer':package(m)});p.wait_for_timeout(250)
 assert not p.locator('[data-action=import-bundle-confirm]').count(),'malformed image should fail preflight'
 assert not p.evaluate(READ,'tasks')
 html=p.evaluate('(t)=>probe.videoNotesHtml(t)',m['docs'][0]);assert 'onerror=' not in html
def batch_current(c,p):
 upload(p);upload(p,'【合成达人】小红书图文大纲v2.txt','新版')
 out=p.evaluate('async()=>{await probe.createBatch();return await new Promise(r=>{const q=probe.db().transaction("batches").objectStore("batches").getAll();q.onsuccess=()=>r(q.result)})}')
 assert len(out[-1]['entries'])==1,out;assert out[-1]['entries'][0]['round']==2
def scope(c,p):
 upload(p);upload(p,'【合成达人】小红书图文初稿.txt','初稿')
 p.evaluate("""async()=>{const t=probe.state().tasks.find(t=>t.stage==='大纲');await probe.persist([['tasks',{...t,ai:{at:'2026',needsSupplement:false,changes:[],assurance:{complete:true,projectRevision:''}}}]]);probe.render()}""")
 row=p.locator('.wb-row').filter(has=p.get_by_role('heading',name='【合成达人】小红书图文初稿.txt',exact=True));row.locator('.wb-meta summary').click();row.locator('[data-wb-field=platform]').select_option('抖音');row.locator('[data-action=wb-save-meta]').click();p.wait_for_timeout(200)
 old=next(t for t in p.evaluate(READ,'tasks') if t['stage']=='大纲');assert old['platform']=='小红书' or old.get('fullReviewPending'),old
 p.screenshot(path=str(OUT/'scope-desktop.png'),full_page=True);p.set_viewport_size({'width':390,'height':844});assert p.evaluate('document.documentElement.scrollWidth<=innerWidth');p.screenshot(path=str(OUT/'scope-mobile.png'),full_page=True)
def draft(c,p):
 upload(p);p.locator('.wb-feedback summary').click();p.locator('[data-feedback-text]').fill('尚未提交的反馈')
 q=c.new_page();q.goto(origin);q.wait_for_function('!!window.probe');q.evaluate("()=>{const s=JSON.parse(localStorage.getItem('zhigao-settings-v1'));s.projects[0].name='其他标签页改名';localStorage.setItem('zhigao-settings-v1',JSON.stringify(s))}");p.wait_for_timeout(250)
 assert p.locator('[data-feedback-text]').input_value()=='尚未提交的反馈'
def excel(c,p):
 r=p.evaluate("""async()=>{const z=new JSZip();z.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="产品参数" sheetId="1" r:id="rId1"/></sheets></workbook>');z.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');z.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>容量</t></is></c><c r="B1"><v>999</v></c><c r="C1" t="str"><f>"宣传语"</f><v>宣传语</v></c><c r="D1"><f>1+1</f></c></row></sheetData></worksheet>');const buffer=await z.generateAsync({type:'arraybuffer'});const m=await import('/xlsx.js'),a=await import('/media-review.js');return {cells:m.workbookCells(await m.readWorkbook(buffer)),inventory:await a.inspectReviewMedia({fmt:'xlsx',buffer})}}""")
 cells={v['address']:v for v in r['cells']};assert cells['B1']['current']=='999';assert cells['C1']['current']=='宣传语';assert cells['C1'].get('note');assert r['inventory']['blockers'],r
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(channel='msedge',headless=True)
  for name,fn in [('R01',feedback_conflict),('R02',deletion),('R03-settings',lambda c,p:import_failure(c,p,'settings')),('R03-db',lambda c,p:import_failure(c,p,'db')),('R08',injection),('R09',batch_current),('R07',scope),('R10',draft),('R04',excel)]:run(name,fn,b)
  b.close()
finally:server.shutdown();server.server_close()
if any(not r['passed'] for r in results):raise SystemExit(1)
