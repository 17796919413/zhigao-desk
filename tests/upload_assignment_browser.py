"""Real Edge, synthetic data, isolated DB and blocked connector; no business writes."""
from pathlib import Path
import os,json,functools,http.server,threading,traceback,platform
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/agent.js':
   data=((ROOT/'agent.js').read_text(encoding='utf-8')+'\nwindow.agentProbe=tools;').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  if self.path.split('?')[0]=='/app.js':
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.probe={state:()=>({tasks,items,settings,batches,libraryImports}),persist:commitWorkbench,render,db:()=>db,dbOp,project,loadFile,actions,update:commitAgentProject,cleanup:flushLibraryCleanup,workbench,loadFile,setTask:id=>{task=tasks.find(t=>t.id===id)}};').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
checks=[];errors=[];environment={'system':platform.platform(),'python':platform.python_version(),'mode':'isolated Edge; synthetic data; no real Feishu'}
def passed(name):checks.append(name);print('PASS '+name,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);environment['browser']=browser.version
  context=browser.new_context(viewport={'width':1440,'height':1000});context.route('http://127.0.0.1:47821/**',lambda r:r.abort())
  context.add_init_script("""if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-agent-v1','off');localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'p',projects:[{id:'p',name:'上传验收品牌',date:'v1',status:'active',selectedActivity:'a',activities:[{id:'a',name:'秋季'},{id:'b',name:'冬季'}],rules:[],library:[]}]}));localStorage.setItem('seed','1');}""")
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe')
  def upload(name,text='合成原稿'):
   page.locator('#file-input').set_input_files({'name':name,'mimeType':'text/plain','buffer':text.encode()})
  files=[{'name':n,'mimeType':'text/plain','buffer':t.encode()} for n,t in [('未署名.txt','未标注平台或阶段'),('坏文件.bin','broken'),('【小乙】小红书图文大纲.txt','正文'),('待归属.txt','达人：小丙')]]
  page.locator('#file-input').set_input_files(files)
  page.wait_for_function("probe.state().tasks.length===1&&document.querySelectorAll('[data-upload-field=stage]').length===2&&document.querySelectorAll('[data-action=wb-upload-retry]').length===1")
  assert page.locator('[data-action=wb-copy]').is_enabled();assert page.locator('[data-batch-doc]').count()==1
  assert page.locator('[data-upload-field=platform]').first.input_value()==''
  assert page.locator('[data-upload-field=kind]').first.input_value()==''
  assert page.locator('[data-upload-field=stage]').first.input_value()==''
  passed('未知字段为空，两个待确认和一个失败件不阻断后续明确稿件或批审选择')
  first=page.locator('[data-upload-id]').filter(has_text='未署名.txt');first.locator('[data-upload-field=author]').fill('小甲');first.locator('[data-upload-field=title]').fill('需要人工确认的内容')
  page.locator('[data-action=wb-upload-confirm-all]').click();assert len(page.evaluate('probe.state().tasks'))==1
  assert '请填写平台' in page.locator('[data-upload-id]').filter(has_text='未署名.txt').inner_text()
  page.screenshot(path=str(OUT/'assignment-desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'assignment-narrow.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.set_viewport_size({'width':1440,'height':1000})
  page.reload();page.wait_for_function('!!window.probe');first=page.locator('[data-upload-id]').filter(has_text='未署名.txt');assert first.locator('[data-upload-field=author]').input_value()=='小甲';assert first.locator('[data-upload-field=title]').input_value()=='需要人工确认的内容'
  passed('缺字段不能确认；原件、归属表单和错误在刷新后恢复')
  for name,author in [('未署名.txt','小甲'),('待归属.txt','小丙')]:
   row=page.locator('[data-upload-id]').filter(has_text=name);row.locator('[data-upload-field=author]').fill(author);row.locator('[data-upload-field=platform]').select_option('其他');row.locator('[data-upload-field=kind]').select_option('图文');row.locator('[data-upload-field=stage]').select_option('初稿')
  page.locator('[data-action=wb-upload-confirm-all]').click();page.wait_for_function('probe.state().tasks.length===3');assert page.locator('[data-upload-field]').count()==0
  page.locator('[data-action=wb-upload-cancel]').click();page.wait_for_function('!document.querySelectorAll("[data-upload-id]").length')
  passed('集中确认两份稿件仅保存一次，取消失败上传移除待办原件')
  upload('【小乙】小红书图文大纲.txt','无版本号的新版');page.wait_for_selector('[data-action=wb-upload-assign]');assert len(page.evaluate('probe.state().tasks'))==3
  assert '第 2 轮' in page.locator('[data-upload-id]').inner_text();page.locator('[data-action=wb-upload-assign]').click();page.wait_for_function('probe.state().tasks.length===4')
  t=page.evaluate("probe.state().tasks.find(t=>t.author==='小乙'&&t.flow.round===2)");assert t
  old=page.evaluate("probe.state().tasks.find(t=>t.author==='小乙'&&t.flow.round===1)")
  page.evaluate("""async id=>{const t=structuredClone(probe.state().tasks.find(t=>t.id===id));t.ai={at:'历史结果',changes:[],warnings:[],assurance:{complete:true,projectRevision:'v1'}};t.flow.state='passed';t.flow.passedAt='历史通过';await probe.persist([['tasks',t]]);probe.setTask(id)}""",t['id'])
  before=page.evaluate("id=>JSON.stringify(probe.state().tasks.find(t=>t.id===id))",t['id'])
  page.evaluate("async()=>probe.loadFile(new File(['第三轮原稿'],'【小乙】小红书图文大纲.txt',{type:'text/plain'}),true)")
  page.wait_for_function('probe.state().tasks.length===5')
  assert page.evaluate("id=>JSON.stringify(probe.state().tasks.find(t=>t.id===id))",t['id'])==before
  assert page.evaluate("probe.state().tasks.filter(t=>t.author==='小乙').map(t=>t.flow.round).sort()")==[1,2,3]
  assert page.evaluate("probe.state().tasks.find(t=>t.author==='小乙'&&t.flow.round===3).ai") is None
  passed('无版号旧内容显式确认续轮；收到新版统一保存新记录，旧审核及品牌通过保持原样')
  # Delay parsing, switch activity, and restore the queued original after refresh.
  page.evaluate("""()=>{const f=new File(['迟到正文'],'【小丁】小红书图文大纲.txt');f.text=()=>new Promise(r=>window.releaseFile=()=>r('迟到正文'));window.uploading=probe.workbench.upload([f])}""")
  page.wait_for_function('!!window.releaseFile');page.locator('[aria-label=当前活动]').select_option('b');page.evaluate('releaseFile()');page.evaluate('uploading');assert len(page.evaluate('probe.state().tasks'))==5
  page.locator('[aria-label=当前活动]').select_option('a');page.wait_for_selector('[data-action=wb-upload-assign]');assert '活动已切换' in page.locator('[data-upload-id]').inner_text()
  page.locator('[data-action=wb-upload-assign]').click();page.wait_for_function('probe.state().tasks.length===6');assert page.evaluate("probe.state().tasks.find(t=>t.author==='小丁').activityId")=='a'
  passed('解析中切活动保留原归属并等待确认，迟到文件不进入错误活动')
  # Inject a transaction abort to ensure original and form remain retryable.
  upload('失败重试.txt');page.wait_for_selector('[data-action=wb-upload-assign]')
  row=page.locator('[data-upload-id]');row.locator('[data-upload-field=author]').fill('小戊');row.locator('[data-upload-field=platform]').select_option('抖音');row.locator('[data-upload-field=kind]').select_option('视频');row.locator('[data-upload-field=stage]').select_option('脚本')
  page.evaluate("""()=>{window.nativePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,...a){if(this.name==='tasks'&&v.author==='小戊'){throw Error('合成落库失败')}return nativePut.call(this,v,...a)}}""")
  page.locator('[data-action=wb-upload-assign]').click();page.wait_for_function("document.querySelector('[data-upload-id]').textContent.includes('合成落库失败')")
  assert len(page.evaluate('probe.state().tasks'))==6
  page.evaluate('()=>{IDBObjectStore.prototype.put=nativePut}');page.locator('[data-action=wb-upload-assign]').click();page.wait_for_function('probe.state().tasks.length===7')
  page.reload();page.wait_for_function('!!window.probe');assert len(page.evaluate('probe.state().tasks'))==7;assert page.locator('[data-upload-id]').count()==0
  passed('稿件与上传完成标记同事务提交，失败保留原件和输入，重试不重复落库')
  upload('跨页待确认.txt');page.wait_for_selector('[data-action=wb-upload-assign]')
  row=page.locator('[data-upload-id]');row.locator('[data-upload-field=author]').fill('小己');row.locator('[data-upload-field=platform]').select_option('其他');row.locator('[data-upload-field=kind]').select_option('图文');row.locator('[data-upload-field=stage]').select_option('初稿')
  # Persist the final field before opening the second tab.
  page.evaluate("async()=>{await probe.workbench.upload([])}")
  second=context.new_page();second.on('pageerror',lambda e:errors.append(str(e)));second.goto(origin);second.wait_for_function('!!window.probe');second.wait_for_selector('[data-action=wb-upload-assign]')
  page.locator('[data-action=wb-upload-assign]').click();page.wait_for_function('probe.state().tasks.length===8')
  second.locator('[data-upload-field=title]').fill('迟到标题');second.locator('[data-action=wb-upload-assign]').click();second.wait_for_function("document.querySelector('[data-upload-id]').textContent.includes('另一页面')")
  second.reload();second.wait_for_function('!!window.probe');assert len(second.evaluate('probe.state().tasks'))==8;assert second.locator('[data-upload-id]').count()==0;second.close()
  passed('双标签页恢复同一上传，迟到输入和重复确认不能再次创建稿件')
  assert not errors,errors;browser.close()
except Exception:
 errors.append(traceback.format_exc());print(errors[-1],flush=True)
finally:
 server.shutdown();server.server_close();(OUT/'result.json').write_text(json.dumps({'checks':checks,'errors':errors,'environment':environment,'passed':not errors},ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(1 if errors else 0)
