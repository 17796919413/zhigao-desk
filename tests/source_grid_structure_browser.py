"""Isolated Edge and actual grid runtime. All row/column writes are synthetic."""
from pathlib import Path
import os,json,functools,http.server,threading,traceback,subprocess,urllib.request,urllib.error
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
assert os.environ.get('ZHIGAO_GRID_LIVE')!='1','Structure fixture must remain synthetic'
url='https://scnplp5q8x3t.feishu.cn/sheets/RdEzsaU5NhFpKStfQ3xcGgHdnab'
log=(OUT/'server.log').open('w',encoding='utf-8');env=dict(os.environ,ZHIGAO_VERIFY_OUT=str(OUT/'journal'),ZHIGAO_GRID_LIVE='0')
node=subprocess.Popen(['node','tests/grid_test_server.mjs'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8');port=json.loads(node.stdout.readline())['port']
def post(endpoint,data):
 req=urllib.request.Request(f'http://127.0.0.1:{port}{endpoint}',json.dumps(data).encode(),{'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=90) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def control(**kw):return json.loads(post('/control',kw)[1])
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/app.js':
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.probe={db:()=>db,state:()=>({settings}),render,grid:sourceGrid};').encode();self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
checks=[];errors=[]
def passed(s):checks.append(s);print('PASS '+s,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000})
  seed={'selected':'p','projects':[{'id':'p','name':'合成验收品牌','status':'active','rules':[],'library':[],'feishu':{'reviewTableVersion':2,'sheets':[{'id':'old','remoteId':'s','liveId':'s','live':True,'sourceUrl':url,'headers':['达人'],'rows':[['合成甲']],'map':{'author':0}}],'refined':{'url':url,'sheet':'s'}}}]}
  context.add_init_script("if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-settings-v1',"+json.dumps(json.dumps(seed,ensure_ascii=False))+");localStorage.setItem('seed','1');localStorage.setItem('zhigao-agent-v1','off');}")
  def route(r):
   if r.request.url.endswith('/page/feishu'):
    code,body=post('/grid',r.request.post_data_json);r.fulfill(status=code,body=body,content_type='application/json')
   else:r.abort()
  context.route('http://127.0.0.1:47821/**',route)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  def ready(p=page):
   p.goto(origin);p.wait_for_function('!!window.probe && !!probe.db()');p.locator('[data-page=feishu]').first.click();p.wait_for_selector('.source-grid',timeout=30000)
  ready()
  def open_op(dimension,position,kind='insert',count=1,p=page):
   p.locator(f'[data-grid-dimension={dimension}][data-grid-index="{position}"]').click();p.locator('.grid-structure-dialog select').select_option(kind);p.locator('.grid-structure-dialog input').fill(str(count))
  def done(p=page):
   p.wait_for_function("!Object.keys(localStorage).some(k=>k.startsWith('zhigao-grid-structure:')) && document.querySelector('[data-grid-status]')?.textContent==='行列已更新'",timeout=30000)
  def submit():page.locator('[data-structure-submit]').click();done()
  open_op('row',5,count=2);page.screenshot(path=str(OUT/'insert-desktop.png'),full_page=True);submit()
  assert control()['sheets'][0]['row_count']==87
  assert page.locator('[data-grid-cell=A7]').inner_text()=='空行之后'
  assert page.evaluate('probe.state().settings.projects[0].feishu.sheets[0].stale')
  assert page.evaluate("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[0].feishu.sheets[0].stale")
  passed('插入两行移位正确，旧行映射及同步缓存持久失效')
  open_op('column',2,count=2);submit();assert control()['sheets'][0]['column_count']==10
  assert page.locator('[data-grid-cell=D3]').inner_text()=='7'
  assert page.locator('[data-grid-cell=H3]').inner_text()=='001'
  open_op('column',2,'delete',2);assert 'B–C 列' in page.locator('[data-structure-preview]').inner_text();before=control()['writes']
  page.locator('[data-structure-cancel]').click();assert control()['writes']==before
  open_op('column',2,'delete',2);submit();assert control()['sheets'][0]['column_count']==8
  assert page.locator('[data-grid-cell=F3]').inner_text()=='001'
  passed('插列及删列保持相邻数据定位，删除明确范围，取消不写入')
  open_op('row',5,'delete',2);submit();assert page.locator('[data-grid-cell=A5]').inner_text()=='空行之后'
  page.locator('[data-grid-cell=F3]').dblclick();page.locator('[data-grid-input]').fill('003');page.locator('[data-grid-input]').press('Enter');page.wait_for_function("document.querySelector('[data-grid-status]').textContent==='已保存'")
  assert control()['store']['s']['F3']['rawValue']=='003';assert control()['store']['s']['B3']['rawValue']==7
  passed('删行后编辑使用新坐标，文本编号和数值类型保持')
  control(lost=True);open_op('row',7);page.locator('[data-structure-submit]').click();page.wait_for_selector('[data-grid-structure-recover]');before=control()['writes']
  ready();done();assert control()['writes']==before
  passed('页面响应丢失后刷新恢复已成功结构操作，不重复插入')
  control(readbackFail=True);open_op('column',3);page.locator('[data-structure-submit]').click();page.wait_for_selector('[data-grid-structure-recover]');before=control()['writes']
  ready();done();assert control()['writes']==before
  passed('后端有回执但回读中断，刷新只读核验恢复')
  control(structureLost=True);open_op('row',9);page.locator('[data-structure-submit]').click();page.wait_for_selector('[data-grid-structure-recover]');before=control()['writes']
  ready();page.wait_for_function("document.querySelector('[data-grid-status]')?.textContent.includes('未收到')")
  assert page.locator('[data-grid-dimension=row]').first.is_disabled()
  page.locator('[data-grid-cell=A5]').dblclick();assert page.locator('[data-grid-input]').count()==0
  page.locator('[data-grid-structure-recover]').click();page.wait_for_selector('[data-structure-resolve]');page.screenshot(path=str(OUT/'uncertain-desktop.png'),full_page=True)
  page.locator('[data-structure-cancel]').click();assert page.locator('[data-grid-structure-recover]').count()==1
  page.locator('[data-grid-structure-recover]').click();page.wait_for_selector('[data-structure-resolve]');control(bump=True);page.locator('[data-structure-resolve]').click();page.wait_for_function("document.querySelector('[data-grid-status]').textContent.includes('源表版本已变化')")
  page.locator('[data-grid-structure-recover]').click();page.wait_for_selector('[data-structure-resolve]');page.locator('[data-structure-resolve]').click()
  page.wait_for_function("document.querySelector('[data-grid-status]').textContent==='已按核对后的原表继续'");assert control()['writes']==before
  passed('无回执刷新仍待核对，阻止编辑；取消不放行，核对期间版本变化拒绝，确认不重做')
  page.evaluate("""()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('zhigao-grid-structure:'))throw Error('合成配额不足');return originalSet.call(this,k,v)}}""")
  before=control()['writes'];open_op('row',5);page.locator('[data-structure-submit]').click();page.wait_for_function("document.querySelector('[data-grid-status]').textContent.includes('配额不足')");assert control()['writes']==before
  page.evaluate('()=>{Storage.prototype.setItem=originalSet}');passed('操作记录无法持久化时不派发结构写入')
  draft_key='zhigao-grid-drafts:p:'+url
  page.evaluate("([k])=>localStorage.setItem(k,JSON.stringify({'s!A3':{sheetId:'s',address:'A3',text:'保留输入',error:'待处理'}}))",[draft_key]);open_op('row',5);page.locator('[data-structure-submit]').click();page.wait_for_function("document.querySelector('[data-grid-status]').textContent.includes('请先保存')");assert control()['writes']==before
  page.evaluate('(k)=>localStorage.removeItem(k)',draft_key);page.locator('[data-grid-refresh]').click();page.wait_for_function("!document.querySelector('[data-grid-refresh]').disabled")
  passed('已有待保存输入时禁止增删，不自动迁移含糊地址')
  open_op('row',5);control(bump=True);page.locator('[data-structure-submit]').click();page.wait_for_selector('[data-grid-structure-recover]');assert control()['writes']==before
  ready();page.wait_for_function("document.querySelector('[data-grid-status]').textContent.includes('未执行')");assert control()['writes']==before
  passed('陈旧快照不写入，重启确认未派发后允许重新选择')
  # Dispatch two submissions in one JS task; the shared lock and pending record
  # must permit only one mutation, including while switching sheets.
  open_op('row',5);control(delay=500)
  page.evaluate("""()=>{const f=document.querySelector('.grid-structure-dialog form');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));setTimeout(()=>{const s=document.querySelector('[data-grid-sheet]');s.value='other';s.dispatchEvent(new Event('change',{bubbles:true}));},50)}""")
  page.wait_for_function("document.querySelector('[data-grid-cell=A1]')?.textContent==='其他表不受影响'")
  page.wait_for_function("!Object.keys(localStorage).some(k=>k.startsWith('zhigao-grid-structure:'))")
  assert control(delay=0)['writes']==before+1;assert page.locator('[data-grid-sheet]').input_value()=='other'
  passed('连续提交只写一次，操作期间切表不让旧结果覆盖当前子表')
  page.locator('[data-grid-sheet]').select_option('s');page.wait_for_selector('[data-grid-cell=H3]')
  second=context.new_page();second.on('pageerror',lambda e:errors.append(str(e)));ready(second)
  open_op('row',6,p=second);open_op('row',6);before=control()['writes'];control(delay=200)
  page.locator('[data-structure-submit]').click();done()
  second.locator('[data-structure-submit]').click();second.wait_for_selector('[data-grid-structure-recover]');assert control(delay=0)['writes']==before+1
  second.locator('[data-grid-structure-recover]').click();second.wait_for_function("document.querySelector('[data-grid-status]').textContent.includes('未执行')")
  page.wait_for_function("!document.querySelector('[data-grid-refresh]').disabled && !document.querySelector('[data-grid-dimension=row]').disabled")
  assert control()['writes']==before+1;second.close();passed('双标签共用操作锁和记录，陈旧弹窗不会再次插入，核对后两页恢复')
  open_op('row',1,'delete',control()['sheets'][0]['row_count']);assert page.locator('[data-structure-submit]').is_disabled()
  page.locator('.grid-structure-dialog input').fill('0');assert page.locator('[data-structure-submit]').is_disabled();page.locator('.grid-structure-dialog input').press('Escape');assert page.locator('dialog').count()==0
  passed('前端禁止零数量和整表删除，键盘可关闭操作窗口')
  page.locator('[data-grid-next]').click();page.wait_for_selector('[data-grid-dimension=row][data-grid-index="41"]');page.locator('[data-grid-next]').click();page.wait_for_selector('[data-grid-dimension=row][data-grid-index="81"]')
  open_op('row',81,'delete',control()['sheets'][0]['row_count']-80);submit()
  assert control()['sheets'][0]['row_count']==80;assert page.locator('[data-grid-dimension=row][data-grid-index="1"]').count()==1;assert page.locator('[data-grid-prev]').is_disabled()
  passed('末页全部删除后回到有效首屏，不留下越界分页')
  page.set_viewport_size({'width':390,'height':844});open_op('column',2,'delete',2);page.screenshot(path=str(OUT/'delete-narrow.png'),full_page=True)
  assert 'B–C 列' in page.locator('[data-structure-preview]').inner_text();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  box=page.locator('dialog').bounding_box();assert box['x']>=0 and box['x']+box['width']<=390
  page.locator('[data-structure-cancel]').click();page.screenshot(path=str(OUT/'grid-narrow.png'),full_page=True)
  assert not errors,errors;passed('桌面和390px窄屏实际渲染，操作弹窗可见且无横向溢出或脚本错误')
  (OUT/'result.json').write_text(json.dumps({'ok':True,'checks':checks,'errors':errors,'live':False,'browser':browser.version,'writes':control()['writes']},ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
except Exception:
 (OUT/'failure.json').write_text(json.dumps({'ok':False,'checks':checks,'errors':errors,'traceback':traceback.format_exc()},ensure_ascii=False,indent=2),encoding='utf-8');raise
finally:server.shutdown();node.terminate();node.wait(timeout=10);log.close()
