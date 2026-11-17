"""Local isolated activity/batch UI integration. Never contacts real Feishu."""
from pathlib import Path
import os,json,functools,http.server,threading,traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/app.js':
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.probe={state:()=>({tasks,items,settings,batches}),persist:commitWorkbench,render,db:()=>db};').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
checks=[];errors=[]
def passed(name):checks.append(name);print('PASS '+name,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000})
  context.route('http://127.0.0.1:47821/**',lambda r:r.abort())
  context.add_init_script("if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-agent-v1','off');localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'audit',projects:[{id:'audit',name:'合成品牌',status:'active',rules:[],library:[],notes:''}]}));localStorage.setItem('seed','1')}")
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe')
  assert page.locator('[aria-label="当前活动"]').input_value()=='legacy'
  page.locator('[data-action=new-activity]').click();page.locator('#activity-name').fill('秋季测试');page.locator('[data-action=create-activity]').click()
  page.wait_for_function("probe.state().settings.projects[0].activities?.length===1")
  activity=page.locator('[aria-label="当前活动"]').input_value();assert activity!='legacy'
  files=[{'name':f'【合成达人{i}】小红书图文大纲.txt','mimeType':'text/plain','buffer':f'第{i}份合成原稿'.encode()} for i in range(10)]
  page.locator('#file-input').set_input_files(files);page.wait_for_function('probe.state().tasks.length===10')
  assert page.locator('[data-batch-doc]').count()==10
  assert all(t['activityId']==activity for t in page.evaluate('probe.state().tasks'))
  passed('10份上传归属当前活动，默认全部选中')
  page.locator('[data-batch-doc]').first.uncheck()
  page.evaluate("()=>{navigator.clipboard.writeText=async value=>{window.copied=value}}")
  page.locator('[data-action=wb-copy]').click();page.wait_for_function('probe.state().batches.length===1')
  batch=page.evaluate('probe.state().batches[0]');assert len(batch['entries'])==9;assert batch['activityId']==activity
  passed('取消1份后固定批次仅含所选9份')
  page.screenshot(path=str(OUT/'activity-batch-desktop.png'),full_page=True)
  page.locator('[aria-label="当前活动"]').select_option('legacy');assert page.locator('.wb-row').count()==0
  page.locator('#file-input').set_input_files(files[0]);page.wait_for_function('probe.state().tasks.length===11')
  assert len(page.evaluate('probe.state().items'))==11
  passed('跨活动同名达人不合并；旧活动保留独立稿件')
  page.locator('[aria-label="当前活动"]').select_option(activity);assert page.locator('.wb-row').count()==10
  page.reload();page.wait_for_function('!!window.probe');assert page.locator('[aria-label="当前活动"]').input_value()==activity
  page.wait_for_function('document.querySelectorAll(".wb-row").length===10')
  passed('活动选择及稿件持久化，刷新后恢复')
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'activity-batch-narrow.png'),full_page=True)
  assert not errors,errors
  browser.close()
except Exception:
 errors.append(traceback.format_exc());print(errors[-1],flush=True)
finally:
 server.shutdown();server.server_close();(OUT/'result.json').write_text(json.dumps({'checks':checks,'errors':errors,'passed':not errors},ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(1 if errors else 0)
