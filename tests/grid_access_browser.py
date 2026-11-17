"""Actual isolated Edge, connector HTTP, MCP task journal and grid; synthetic CLI/auth."""
from pathlib import Path
import functools,http.server,threading,json,os,time,subprocess,socket,urllib.request,shutil,traceback
from playwright.sync_api import sync_playwright
from mcp_client_fixture import MCP
from synthetic_fixtures import png_bytes
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
backend=f'http://127.0.0.1:{port}'
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  file=Path(self.translate_path(self.path.split('?',1)[0]))
  if file.suffix in ['.js','.mjs'] and file.is_file():
   data=file.read_text(encoding='utf-8').replace('http://127.0.0.1:47821',backend).replace('AGENT_PORT=47821','AGENT_PORT='+str(port))
   if file.name=='app.js':data+='\nwindow.probe={grid:sourceGrid,db:()=>db,settings:()=>settings,render,project};'
   b=data.encode();self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
http.server.ThreadingHTTPServer.daemon_threads=True
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
home=OUT/'isolated-home';home.mkdir()
connector=OUT/'zhigao-connector.mjs';connector.write_text((ROOT/'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()',json.dumps(str(home))),encoding='utf-8')
for name in ['media-runtime.mjs','media-worker.py','cache-cleanup.mjs']:shutil.copyfile(ROOT/name,OUT/name)
(OUT/'qr.png').write_bytes(png_bytes())
table=OUT/'table.json'
table.write_text(json.dumps({'revision':1,'rows':12,'writes':0,'cells':{'A1':'达人','B1':'数量','C1':'备注','A2':'合成甲','B2':7,'C2':'保留原文'}}),encoding='utf-8')
env={**os.environ,'ZHIGAO_PORT':str(port),'ZHIGAO_AUTO_UPDATE':'0','ZHIGAO_REGISTER_URI':'0','ZHIGAO_ORIGINS':origin,'ZHIGAO_ACCESS_FIXTURE':str(OUT),'ZHIGAO_LARK_CLI':str(ROOT/'tests/grid_access_lark.mjs')}
log=(OUT/'connector.log').open('w',encoding='utf-8')
process=subprocess.Popen(['node',str(connector),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
checks=[];errors=[];client=None
def passed(s):
 checks.append(s);print('PASS '+s,flush=True)
 (OUT/'progress.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
def state():return json.loads(table.read_text(encoding='utf-8'))
def expire():
 if (OUT/'authorized').exists():(OUT/'authorized').unlink()
def restart_connector():
 global process,client
 if client:client.close();client=None
 process.terminate();process.wait(timeout=15)
 process=subprocess.Popen(['node',str(connector),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
 for _ in range(100):
  try:
   with urllib.request.urlopen(backend+'/health',timeout=1) as r:
    if json.load(r).get('app')=='zhigao':break
  except Exception:page.wait_for_timeout(100)
 else:raise TimeoutError('Restarted isolated connector did not become healthy')
 client=MCP(connector,env,log,page)
try:
 for _ in range(100):
  try:
   with urllib.request.urlopen(backend+'/health',timeout=1) as r:
    if json.load(r).get('app')=='zhigao':break
  except Exception:time.sleep(.1)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000})
  url='https://example.feishu.cn/sheets/Synthetic'
  projects=[{'id':i,'name':'隔离品牌'+i,'status':'active','rules':[],'library':[],'feishu':{'reviewTableVersion':2,'sheets':[],'refined':{'url':url,'sheet':'s'}}} for i in ['A','B']]
  context.add_init_script("if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-settings-v1',"+json.dumps(json.dumps({'selected':'A','projects':projects},ensure_ascii=False))+");localStorage.setItem('seed','1');localStorage.setItem('zhigao-agent-v1','on');}")
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe && !!probe.db()')
  client=MCP(connector,env,log,page)
  def call(name,args):
   r=client.call(name,args);assert not r.get('isError'),r
   return json.loads(next(x['text'] for x in r['content'] if x['type']=='text'))
  page.locator('[data-page=feishu]').first.click()
  def authorize(expect_success=True):
   page.wait_for_selector('[data-action=task-approve]',timeout=20000)
   if not (OUT/'authorization-desktop.png').exists():
    page.screenshot(path=str(OUT/'authorization-desktop.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'authorization-narrow.png'),full_page=True);page.set_viewport_size({'width':1440,'height':1000})
   ticket=page.evaluate("JSON.parse(localStorage.getItem('zhigao-grid-access:'+probe.project().id+':'+probe.project().feishu.refined.url)||'null')")
   if ticket and ticket['action']!='gridRead':
    assert '继续刚才的表格操作' in page.locator('#task-preparation-panel').inner_text()
    if not (OUT/'write-authorization-narrow.png').exists():
     page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'write-authorization-narrow.png'),full_page=True);page.set_viewport_size({'width':1440,'height':1000})
   page.locator('[data-action=task-approve]').click()
   page.wait_for_selector('#task-preparation-panel a',timeout=20000)
   assert 'SYNTHETIC_PRIVATE' not in page.locator('body').inner_text()
   page.locator('[data-action=task-resume]').click()
   if expect_success:page.wait_for_function("document.querySelector('#task-preparation-panel .connect-intro')?.textContent==='已继续'",timeout=30000)
   else:page.wait_for_function("['准备未完成','结果待确认','准备中断'].includes(document.querySelector('#task-preparation-panel .connect-intro')?.textContent)",timeout=30000)
   page.locator('[data-action=close-modal]').first.click()
  authorize();page.wait_for_selector('[data-grid-cell=B2]');assert page.locator('[data-grid-cell=B2]').inner_text()=='7' and state()['writes']==0
  passed('新原表入口缺登录：真实准备面板、合成扫码授权、同表读取续办，零写入')
  def edit(value):
   page.locator('[data-grid-cell=C2]').dblclick();page.locator('[data-grid-input]').fill(value);page.locator('[data-grid-input]').press('Enter')
  v=state();v['scope']=True;table.write_text(json.dumps(v),encoding='utf-8');page.locator('[data-grid-refresh]').click();authorize();assert state()['writes']==0
  passed('读取权限缺失：按目标表所缺scope补授权后回读，不产生写入')
  expire();before=state()['writes'];edit('授权后保留输入');authorize()
  assert state()['writes']==before+1 and state()['cells']['C2']=='授权后保留输入'
  assert page.evaluate("Object.keys(JSON.parse(localStorage.getItem('zhigao-grid-drafts:A:'+probe.project().feishu.refined.url)||'{}')).length")==0
  passed('保存前登录过期：持久输入保留，授权后重新核对并只保存一次')
  expire();edit('刷新后仍续办');page.wait_for_selector('[data-action=task-approve]');page.reload();page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click();authorize()
  assert state()['cells']['C2']=='刷新后仍续办' and state()['writes']==before+2
  passed('准备期间刷新：同一待保存输入恢复，复用原准备任务且不重复写入')
  # Expire only at the mutation HTTP boundary, after the fresh read has succeeded.
  expired_write=[False]
  def expire_write(route):
   if route.request.post_data_json.get('action')=='gridWrite' and not expired_write[0]:expire();expired_write[0]=True
   route.continue_()
  page.route('**/page/feishu',expire_write);edit('写入派发前过期');authorize();page.unroute('**/page/feishu',expire_write)
  assert state()['cells']['C2']=='写入派发前过期' and state()['writes']==before+3
  passed('gridWrite派发前过期：恢复操作记录为未开始，重新读取后单次保存')
  expire();page.locator('[data-grid-dimension=row][data-grid-index="4"]').click();page.locator('[data-structure-submit]').click();authorize()
  assert state()['rows']==13 and state()['writes']==before+4
  passed('已确认插行在登录前失败：授权后保留同一范围和操作标识，只插入一次')
  v=state();v['writeScope']=True;table.write_text(json.dumps(v),encoding='utf-8');n=v['writes'];edit('补充写权限后保存');authorize()
  assert state()['writes']==n+1 and state()['cells']['C2']=='补充写权限后保存'
  calls=[json.loads(line) for line in (OUT/'calls.jsonl').read_text(encoding='utf-8').splitlines()]
  assert any('--scope' in a and a[a.index('--scope')+1]=='sheets:spreadsheet' for a in calls)
  passed('可读但不可写：明确缺scope拒绝不算未知，补充精确写权限后保存一次')
  v=state();v['writeScope']=True;table.write_text(json.dumps(v),encoding='utf-8');n=v['writes'];rows=v['rows']
  page.locator('[data-grid-dimension=row][data-grid-index="5"]').click();page.locator('[data-structure-submit]').click();page.wait_for_selector('[data-action=task-approve]');page.reload();page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click();authorize()
  assert state()['writes']==n+1 and state()['rows']==rows+1
  passed('插行缺写scope后刷新：恢复明确拒绝记录及已确认范围，只插入一次')
  # A real process restart removes the in-memory snapshot. The persisted proof
  # must continue exactly the confirmed range, without authorizing another table.
  expire();v=state();n=v['writes'];rows=v['rows']
  page.locator('[data-grid-dimension=row][data-grid-index="6"]').click();page.locator('[data-structure-submit]').click();page.wait_for_selector('[data-action=task-approve]')
  pending_key='zhigao-grid-structure:'+url
  pending=page.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',pending_key)
  assert pending['body']['position']==6
  restart_connector();page.reload();page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click();authorize()
  assert state()['writes']==n+1 and state()['rows']==rows+1
  assert page.evaluate('(k)=>localStorage.getItem(k)',pending_key) is None
  passed('插行登录准备期间真实重启连接器并刷新：同一确认范围恢复，只派发一次')
  v=state();v['writeScope']=True;table.write_text(json.dumps(v),encoding='utf-8');n=v['writes'];rows=v['rows']
  page.locator('[data-grid-dimension=row][data-grid-index="7"]').click();page.locator('[data-structure-submit]').click();page.wait_for_selector('[data-action=task-approve]')
  pending=page.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',pending_key)
  operation=pending['body']['operationId']
  journal=home/'.zhigao/grid-operations'/f'{operation}.json'
  assert json.loads(journal.read_text(encoding='utf-8'))['state']=='rejected-scope'
  restart_connector();page.reload();page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click();authorize()
  assert state()['writes']==n+1 and state()['rows']==rows+1
  assert json.loads(journal.read_text(encoding='utf-8'))['state']=='saved'
  assert page.evaluate('(k)=>localStorage.getItem(k)',pending_key) is None
  passed('插行明确缺写scope后真实重启连接器：持久拒绝记录恢复并只写一次')
  expire();v=state();n=v['writes'];rows=v['rows']
  page.locator('[data-grid-dimension=row][data-grid-index="8"]').click();page.locator('[data-structure-submit]').click();page.wait_for_selector('[data-action=task-approve]')
  v=state();v['revision']+=1;v['cells']['C2']='外部更新保留';table.write_text(json.dumps(v),encoding='utf-8')
  restart_connector();page.reload();page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click();authorize(expect_success=False)
  assert state()['writes']==n and state()['rows']==rows and state()['cells']['C2']=='外部更新保留'
  assert page.evaluate('(k)=>JSON.parse(localStorage.getItem(k)).body.position',pending_key)==8
  assert '源表版本已变化' in page.locator('[data-grid-status]').inner_text()
  page.screenshot(path=str(OUT/'restart-conflict-desktop.png'),full_page=True)
  page.locator('[data-grid-structure-recover]').click();page.wait_for_function('(k)=>localStorage.getItem(k)===null',arg=pending_key)
  assert state()['writes']==n
  assert page.evaluate('(k)=>localStorage.getItem(k)','zhigao-grid-access:A:'+url) is None
  passed('重启授权期间原表变化：旧范围保留并拒绝写入，核对未执行后重新选择')
  # A lost execution receipt must not be mistaken for a login failure. The
  # user can acknowledge a fresh view even if the process then restarts again.
  v=state();v['structureLost']=True;table.write_text(json.dumps(v),encoding='utf-8');n=v['writes'];rows=v['rows']
  page.locator('[data-grid-refresh]').click();page.wait_for_function("!document.querySelector('[data-grid-refresh]').disabled")
  page.locator('[data-grid-dimension=row][data-grid-index="9"]').click();page.locator('[data-structure-submit]').click()
  page.wait_for_function('(k)=>!!JSON.parse(localStorage.getItem(k)||"null")?.error',arg=pending_key)
  assert state()['writes']==n+1 and not state()['structureLost']
  pending=page.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',pending_key);operation=pending['body']['operationId']
  restart_connector();page.reload();page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click()
  page.wait_for_function("document.querySelector('[data-grid-status]')?.textContent.includes('未收到行列操作回执')")
  assert state()['writes']==n+1 and state()['rows']==rows+1
  page.locator('[data-grid-structure-recover]').click();page.wait_for_selector('[data-structure-resolve]')
  page.screenshot(path=str(OUT/'restart-uncertain-desktop.png'),full_page=True)
  restart_connector();page.locator('[data-structure-resolve]').click()
  page.wait_for_function('(k)=>localStorage.getItem(k)===null',arg=pending_key)
  assert state()['writes']==n+1 and state()['rows']==rows+1
  journal=home/'.zhigao/grid-operations'/f'{operation}.json'
  assert json.loads(journal.read_text(encoding='utf-8'))['state']=='acknowledged'
  passed('真实回执丢失后重启不重放；人工核对弹窗期间再次重启仍可只读确认')
  # Error classes which do not imply missing credentials must never open preparation.
  for code in ['FEISHU_ACCESS','FEISHU_RATE_LIMIT','FEISHU_NETWORK','GRID_UNCERTAIN']:
   page.route('**/page/feishu',lambda r:r.fulfill(status=400,content_type='application/json',body=json.dumps({'ok':False,'code':code,'error':code})))
   page.locator('[data-grid-refresh]').click();page.wait_for_function('c=>document.querySelector("[data-grid-status]").textContent.includes(c)',arg=code)
   assert page.locator('#task-preparation-panel').count()==0
   page.unroute('**/page/feishu')
  passed('权限拒绝、限流、网络和结果不明仅报原错误，不发起安装或重放')
  page.locator('[data-grid-refresh]').click();page.wait_for_function("!document.querySelector('[data-grid-refresh]').disabled")
  # A target change before granting access must not resume the old write.
  preserved_cell=state()['cells']['C2']
  expire();edit('不能跨品牌保存');page.wait_for_selector('[data-action=task-approve]')
  ticket=page.evaluate("JSON.parse(localStorage.getItem('zhigao-grid-access:A:'+probe.project().feishu.refined.url))")
  page.locator('[data-action=close-modal]').first.click()
  page.evaluate("()=>{probe.settings().selected='B';localStorage.setItem('zhigao-settings-v1',JSON.stringify(probe.settings()));probe.render()}")
  (OUT/'authorized').write_text('synthetic')
  result=page.evaluate("async id=>{try{await probe.grid.resumeAccess(id);return 'wrong'}catch(e){return e.code}}",ticket['id'])
  assert result=='TASK_CHANGED' and state()['cells']['C2']==preserved_cell
  passed('同链接切换品牌后旧续办被拒绝，原品牌输入保留且不写入新品牌')
  page.wait_for_timeout(500)
  if page.locator('[data-action=close-modal]').count():page.locator('[data-action=close-modal]').first.click()
  page.wait_for_function("!document.querySelector('[data-grid-refresh]').disabled && !!document.querySelector('[data-grid-cell=C2]')",timeout=20000)
  page.screenshot(path=str(OUT/'access-desktop.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(OUT/'access-narrow.png'),full_page=True)
  assert not errors,errors
  (OUT/'result.json').write_text(json.dumps({'ok':True,'checks':checks,'errors':errors,'browser':browser.version,'realFeishuWrites':0,'boundary':'Actual Edge + copied connector HTTP and MCP + task/grid runtime; synthetic lark CLI and authentication; no actual platform authentication'},ensure_ascii=False,indent=2),encoding='utf-8')
  browser.close()
except Exception:
 (OUT/'failure.txt').write_text(traceback.format_exc(),encoding='utf-8')
 try:page.screenshot(path=str(OUT/'failure.png'),full_page=True)
 except Exception:pass
 raise
finally:
 if client:client.close()
 process.terminate();process.wait(timeout=15);server.shutdown();server.server_close();log.close()
