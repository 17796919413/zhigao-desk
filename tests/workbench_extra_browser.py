from pathlib import Path
import functools,http.server,threading,subprocess,os,socket,time,json,urllib.request
from playwright.sync_api import sync_playwright
http.server.ThreadingHTTPServer.request_queue_size=128
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('ZHIGAO_VERIFY_OUT',str(ROOT.parent/'_verify'/'workbench-feedback-20261111')));OUT.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
backend=f'http://127.0.0.1:{port}';log=(OUT/'extra-connector.log').open('w',encoding='utf-8')
env={**os.environ,'ZHIGAO_PORT':str(port),'ZHIGAO_AUTO_UPDATE':'0','ZHIGAO_ORIGINS':origin}
home=OUT/'isolated-home';home.mkdir(exist_ok=True)
connector=OUT/'test-connector.mjs';connector.write_text((ROOT/'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()',json.dumps(str(home))),encoding='utf-8')
process=subprocess.Popen(['node',str(connector),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
try:
 for _ in range(60):
  try:
   urllib.request.urlopen(backend+'/health',timeout=1).close();break
  except Exception:time.sleep(.1)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True)
  a=browser.new_context();b=browser.new_context()
  for ctx in [a,b]:ctx.route('http://127.0.0.1:47821/**',lambda route:route.continue_(url=backend+route.request.url.split('47821',1)[1]))
  p=a.new_page();p.goto(origin);p.wait_for_function("document.querySelector('#agent-chip')?.textContent.includes('等待 AI')")
  checks=p.evaluate("async()=>await (await import('/tests/project_cleanup_browser.mjs')).run()")
  q=b.new_page();q.goto(origin);q.wait_for_function("document.querySelector('#agent-chip')?.textContent.includes('其他标签页')")
  checks.append('两个独立浏览器会话不能抢占同一本机连接器')
  p.close();q.wait_for_function("document.querySelector('#agent-chip')?.textContent.includes('等待 AI')",timeout=25000)
  checks.append('关闭原连接页面后另一个浏览器自动接通')
  q.reload();q.wait_for_function("document.querySelector('#agent-chip')?.textContent.includes('等待 AI')",timeout=25000)
  checks.append('刷新页面后连接自动恢复，关闭释放不会误断其他页面')
  # Large textual documents are parsed fully even past the former 100k cutoff.
  q.locator('.navbtn[data-page=rules]').click();q.locator('[data-action=new-project]').click();q.locator('#new-project-name').fill('大正文测试');q.locator('[data-action=create-project]').click();q.wait_for_selector('[data-action=edit-project]');q.locator('.navbtn[data-page=home]').click()
  content='大正文内容。'*20000
  q.locator('#file-input').set_input_files({'name':'大正文.txt','mimeType':'text/plain','buffer':content.encode()});q.wait_for_selector('.wb-row',timeout=30000)
  chars=q.evaluate('''async()=>{const db=await new Promise(r=>{const x=indexedDB.open('zhigao-desk',6);x.onsuccess=()=>r(x.result)});const rows=await new Promise(r=>{const x=db.transaction('tasks').objectStore('tasks').getAll();x.onsuccess=()=>r(x.result)});db.close();return rows[0].cells.map(c=>c.current).join('').length}''')
  assert chars==len(content);checks.append('12万字稿件上传、解析和存储全文完整，无静默截断')
  browser.close()
 (OUT/'extra-result.json').write_text(json.dumps({'count':len(checks),'checks':checks},ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(checks,ensure_ascii=False),flush=True)
finally:
 process.terminate();process.wait(timeout=10);server.shutdown();log.close()
