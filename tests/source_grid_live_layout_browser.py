"""Opt-in, read-only real-cloud layout contract and visual regression."""
from pathlib import Path
import os,json,subprocess,threading,http.server,functools,urllib.request,urllib.error,traceback
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
if os.environ.get('ZHIGAO_GRID_LIVE')!='1': raise RuntimeError('Set ZHIGAO_GRID_LIVE=1 for the authorized CP7 worksheet')
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
URL='https://scnplp5q8x3t.feishu.cn/sheets/RdEzsaU5NhFpKStfQ3xcGgHdnab'
log=(OUT/'server.log').open('w',encoding='utf-8')
node=subprocess.Popen(['node',str(ROOT/'tests/grid_live_layout_server.mjs')],cwd=ROOT,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8',env=os.environ.copy())
port=json.loads(node.stdout.readline())['port']
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
checks=[];requests=[];responses=[];errors=[];measurements=[]
def passed(s):checks.append(s);print('PASS '+s,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);version=browser.version
  context=browser.new_context(viewport={'width':1440,'height':1000})
  seed={'selected':'cp24','projects':[{'id':'cp24','name':'原表真实布局验收','status':'active','rules':[],'library':[],'feishu':{'reviewTableVersion':2,'sheets':[],'refined':{'url':URL,'sheet':'ez1Kvd'}}}]}
  context.add_init_script("if(!localStorage.getItem('cp24-seed')){localStorage.setItem('zhigao-settings-v1',"+json.dumps(json.dumps(seed,ensure_ascii=False))+");localStorage.setItem('cp24-seed','1');localStorage.setItem('zhigao-agent-v1','off');}")
  def route_api(route):
   if not route.request.url.endswith('/page/feishu'):route.abort();return
   body=route.request.post_data_json
   if body['action'] not in ['gridRead','gridFloating','gridImages']:raise AssertionError('Unexpected mutation')
   req=urllib.request.Request(f'http://127.0.0.1:{port}',json.dumps(body).encode(),{'Content-Type':'application/json'})
   try:
    with urllib.request.urlopen(req,timeout=180) as r:status=r.status;data=r.read()
   except urllib.error.HTTPError as e:status=e.code;data=e.read()
   payload=json.loads(data);requests.append({'action':body['action'],'startRow':body.get('startRow'),'ok':payload.get('ok'),'code':payload.get('code')})
   if body['action']=='gridRead' and payload.get('ok'):
    d=payload['data'];responses.append({k:d.get(k) for k in ('startRow','endRow','revision','frozen','layout')})
   route.fulfill(status=status,body=data,content_type='application/json')
  context.route('http://127.0.0.1:47821/**',route_api)
  page=context.new_page();page.set_default_timeout(180000);page.on('pageerror',lambda e:errors.append(str(e)))
  def rect(s):return page.locator(s).first.evaluate('e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}')
  def scroll(x,y):page.locator('.source-grid-scroll').evaluate('(e,p)=>{e.scrollLeft=p[0];e.scrollTop=p[1]}',[x,y])
  def rows():return [int(n) for n in page.locator('.source-grid tbody th').all_inner_texts()]
  page.goto(f'http://127.0.0.1:{server.server_port}');page.locator('[data-page=feishu]').first.click();page.wait_for_selector('[data-grid-position=H3]')
  page.screenshot(path=str(OUT/'live-layout-initial.png'),full_page=True)
  assert responses[0]['frozen']=={'rows':2,'columns':2},responses[0]['frozen']
  assert 39 not in rows() and 38 in rows() and 40 in rows(),rows()
  assert page.locator('[data-grid-dimension=column][data-grid-index="2"]').count()==0
  assert page.locator('[data-grid-position=C40]').get_attribute('data-grid-cell')=='B39'
  assert page.locator('[data-grid-position=C40]').inner_text()=='CP24 跨页合并'
  passed('真实CLI冻结字段与零基隐藏行正确映射，隐藏起点的跨页合并保留原始B39')
  scroll(0,99999);page.screenshot(path=str(OUT/'live-layout-hidden.png'),full_page=True);scroll(0,0)
  assert page.locator('[data-grid-cell=A1]').count()==2
  frozen=rect('[data-grid-position=A1]');regular=rect('[data-grid-position=H20]')
  scroll(230,260);page.wait_for_timeout(80)
  assert abs(rect('[data-grid-position=A1]')['x']-frozen['x'])<1
  assert abs(rect('[data-grid-position=A1]')['y']-frozen['y'])<1
  assert abs(rect('[data-grid-position=H20]')['y']-regular['y']+260)<1
  measurements.append({'view':'desktop','frozen':rect('[data-grid-position=A1]'),'grid':rect('.source-grid-scroll')})
  page.screenshot(path=str(OUT/'live-layout-scrolled.png'),full_page=True)
  passed('真实冻结交点在横纵滚动时保持位置，普通行正常滚动')
  page.locator('[data-grid-next]').click();page.wait_for_selector('[data-grid-position=C41]')
  assert rows()[:3]==[1,2,41],rows()
  assert page.locator('[data-grid-position=C41]').get_attribute('data-grid-cell')=='B39'
  assert page.locator('[data-grid-position=C41]').inner_text()=='CP24 跨页合并'
  assert page.locator('[data-grid-position=C41]').get_attribute('rowspan')=='3'
  assert page.locator('[data-grid-position=C41]').get_attribute('colspan')=='2'
  assert page.locator('[data-grid-position=A1]').inner_text()=='知稿原表验收（合成数据）'
  page.screenshot(path=str(OUT/'live-layout-page2.png'),full_page=True)
  passed('真实第二页补读冻结表头和前页合并起点，行列跨度与原行号一致')
  page.wait_for_function("()=>{const i=document.querySelector('[data-grid-cell=H76] img');return i&&i.complete&&i.naturalWidth===240}")
  page.wait_for_function("()=>[...document.querySelectorAll('[data-grid-floating] img')].some(i=>i.complete&&i.naturalWidth===240)")
  page.locator('.source-grid-scroll').evaluate('e=>{e.scrollTop=e.scrollHeight;e.scrollLeft=e.scrollWidth}')
  page.screenshot(path=str(OUT/'live-layout-images.png'),full_page=True)
  passed('真实隐藏列与冻结布局下，原有单元格图片和浮图仍实际解码')
  page.set_viewport_size({'width':390,'height':844});scroll(400,160);page.wait_for_timeout(80)
  grid=rect('.source-grid-scroll');frozen=rect('[data-grid-position=A1]')
  assert abs(frozen['x']-grid['x']-44)<2,(grid,frozen)
  assert abs(frozen['y']-grid['y']-28)<2,(grid,frozen)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  measurements.append({'view':'narrow','grid':grid,'frozen':frozen})
  page.screenshot(path=str(OUT/'live-layout-narrow.png'),full_page=True)
  passed('390px窄屏仍在表内滚动，冻结交点定位正确且整页无横向溢出')
  assert not errors,errors
  assert not any(r['action'] not in ['gridRead','gridFloating','gridImages'] for r in requests)
  browser.close()
 result={'ok':True,'checks':checks,'edge':version,'realFeishu':True,'writes':0,'requests':requests,'responses':responses,'measurements':measurements,'pageErrors':errors}
except Exception:
 result={'ok':False,'checks':checks,'requests':requests,'responses':responses,'pageErrors':errors,'trace':traceback.format_exc()};raise
finally:
 (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 node.terminate();node.wait(timeout=10);log.close();server.shutdown();server.server_close()
