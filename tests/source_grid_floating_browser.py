"""Real Edge with synthetic floating image API; no user profile or cloud writes."""
from pathlib import Path
import os, json, functools, http.server, threading, traceback, subprocess, urllib.request, urllib.error, io, time
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
log=(OUT/'server.log').open('w',encoding='utf-8')
node=subprocess.Popen(['node','tests/grid_images_server.mjs'],cwd=ROOT,env=dict(os.environ,ZHIGAO_VERIFY_OUT=str(OUT/'journal'),ZHIGAO_GRID_FLOATING='1'),stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8')
port=json.loads(node.stdout.readline())['port']
def post(endpoint,body):
 request=urllib.request.Request(f'http://127.0.0.1:{port}{endpoint}',json.dumps(body).encode(),{'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(request,timeout=30) as response:return response.status,response.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def control(**body):return json.loads(post('/control',body)[1])['data']

colors={'red':'#d15442','blue':'#3d69a7','green':'#3b8968','purple':'#865baa','wide':'#c99637','last':'#457e92'}
pngs={}
for name,color in colors.items():
 picture=Image.new('RGB',(240,120),color);draw=ImageDraw.Draw(picture)
 draw.rectangle((3,3,236,116),outline='white',width=2)
 draw.line((0,0,239,119),fill='black',width=3);draw.line((239,0,0,119),fill='black',width=3)
 draw.text((55,45),'SOURCE '+name.upper(),fill='white')
 data=io.BytesIO();picture.save(data,format='PNG');pngs[name]=data.getvalue()
 (OUT/(name+'.png')).write_bytes(pngs[name])
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
checks,errors,requests,pending,measurements=[],[],[],[],[]
held={'value':True}
def passed(text):checks.append(text);print('PASS '+text,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);version=browser.version
  context=browser.new_context(viewport={'width':1440,'height':1000})
  url='https://synthetic.feishu.cn/sheets/book'
  seed={'selected':'p','projects':[{'id':'p','name':'浮动图片验收品牌','status':'active','rules':[],'library':[],'feishu':{'reviewTableVersion':2,'sheets':[],'refined':{'url':url,'sheet':'s'}}}]}
  context.add_init_script("if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-settings-v1',"+json.dumps(json.dumps(seed,ensure_ascii=False))+");localStorage.setItem('seed','1');localStorage.setItem('zhigao-agent-v1','off');}")
  def fulfill(route,body):
   code,response=post('/grid',body);route.fulfill(status=code,body=response,content_type='application/json')
  def route_api(route):
   if not route.request.url.endswith('/page/feishu'):route.abort();return
   body=route.request.post_data_json;requests.append(body)
   if body['action']=='gridFloating' and held['value']:pending.append((route,body));return
   fulfill(route,body)
  context.route('http://127.0.0.1:47821/**',route_api)
  def route_image(route):
   name=route.request.url.split('/')[-1].split('.')[0]
   route.fulfill(status=200 if name in pngs else 404,body=pngs.get(name,b'missing'),content_type='image/png')
  context.route('https://images.synthetic.test/**',route_image)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}');page.locator('[data-page=feishu]').first.click()
  def wait_pending():
   limit=time.monotonic()+15
   while not pending and time.monotonic()<limit:page.wait_for_timeout(25)
   assert pending,'Floating request not queued'
  def release():
   held['value']=False
   for route,body in list(pending):fulfill(route,body)
   pending.clear()
  def floats_loaded():page.wait_for_function("()=>[...document.querySelectorAll('[data-grid-floating] img')].some(i=>i.complete&&i.naturalWidth===240)")
  def saved():page.wait_for_function("()=>document.querySelector('[data-grid-status]').textContent==='已保存'")
  def measures():
   return page.locator('[data-grid-floating="float:banner"]').evaluate_all("nodes=>nodes.map(e=>{const b=e.getBoundingClientRect(),t=e.parentElement.getBoundingClientRect(),i=e.querySelector('.grid-float-image').getBoundingClientRect();return {cell:e.parentElement.dataset.gridPosition,x:b.x-t.x,y:b.y-t.y,w:b.width,h:b.height,iw:i.width,ih:i.height}})")
  wait_pending();page.wait_for_function("()=>{const i=document.querySelector('[data-grid-cell=B3] img');return i&&i.complete}")
  page.wait_for_function("()=>[...document.querySelectorAll('[data-grid-image] img')].every(i=>i.complete)")
  page.locator('[data-grid-cell=F6]').scroll_into_view_if_needed()
  page.locator('[data-grid-cell=F6]').dblclick();editor=page.locator('[data-grid-input]')
  editor.fill('浮图返回时保留输入');editor.evaluate('e=>e.setSelectionRange(2,5)')
  original=page.locator('[data-grid-cell=B3] img').element_handle()
  position=page.locator('.source-grid-scroll').evaluate('e=>[e.scrollLeft,e.scrollTop]')
  release();floats_loaded()
  assert original.evaluate('e=>e.isConnected')
  assert editor.input_value()=='浮图返回时保留输入'
  assert editor.evaluate('e=>[e.selectionStart,e.selectionEnd,document.activeElement===e]')==[2,5,True]
  assert page.locator('.source-grid-scroll').evaluate('e=>[e.scrollLeft,e.scrollTop]')==position
  passed('浮图迟到只加入图片分片，已显示图片、输入、选区及滚动保持')
  parts=measures();assert len(parts)>=4,parts
  assert all(p['iw']==280 and p['ih']==95 and p['x']>=0 and p['y']>=0 for p in parts),parts
  measurements.append({'firstPage':parts})
  state=control();assert all(len(x)<=5 for x in state['requests'])
  assert sum(x.count('red') for x in state['requests'])==1
  assert sum(x.count('wide') for x in state['requests'])==1
  passed('真实PNG解码，跨冻结分片保持280×95原尺寸并复用嵌图下载')
  editor.press('Enter');saved();floats_loaded()
  assert control()['rows']['F6']['rawValue']=='浮图返回时保留输入'
  page.locator('.source-grid-scroll').evaluate('e=>{e.scrollTop=0;e.scrollLeft=0}')
  page.screenshot(path=str(OUT/'floating-desktop.png'),full_page=True)
  fixed=page.locator('[data-grid-position=A1] [data-grid-floating="float:banner"]')
  before=fixed.bounding_box();page.locator('.source-grid-scroll').evaluate('e=>{e.scrollTop=160;e.scrollLeft=100}')
  after=fixed.bounding_box();assert abs(before['x']-after['x'])<1 and abs(before['y']-after['y'])<1
  page.screenshot(path=str(OUT/'floating-scrolled.png'),full_page=True)
  passed('冻结交界图片随各自窗格滚动，普通格仍自动保存')
  page.locator('[data-grid-next]').click();page.wait_for_selector('[data-grid-position=D44]');floats_loaded()
  page.wait_for_selector('[data-grid-floating="float:page"] img')
  assert page.locator('[data-grid-floating="float:missing"]').count()==0
  page.locator('.source-grid-scroll').evaluate('e=>{e.scrollTop=0;e.scrollLeft=0}')
  page.screenshot(path=str(OUT/'floating-page2.png'),full_page=True)
  passed('下一页保留前页锚点延伸的图片，未相交图片不显示')
  control(hidden=True);page.locator('[data-grid-refresh]').click()
  page.wait_for_function("()=>!document.querySelector('[data-grid-refresh]').disabled")
  floats_loaded()
  assert page.locator('[data-grid-position=B44]').count()==0
  assert page.locator('[data-grid-dimension=row][data-grid-index="42"]').count()==0
  assert page.locator('[data-grid-floating="float:page"]').count()>0
  page.screenshot(path=str(OUT/'floating-hidden.png'),full_page=True)
  passed('隐藏行列与非零冻结同时存在时，跨页图片仍在当前可见网格内')
  control(mode='float-denied');page.locator('[data-grid-refresh]').click()
  page.get_by_text('浮动图片未加载，刷新表格重试。',exact=True).wait_for()
  page.locator('[data-grid-position=F44]').dblclick()
  assert page.locator('[data-grid-floating-error]').is_visible(),'Image failure status must survive entry into an editor'
  page.locator('[data-grid-input]').fill('浮图失权仍可保存');page.locator('[data-grid-input]').press('Enter');saved()
  assert control()['rows']['F44']['rawValue']=='浮图失权仍可保存'
  assert page.locator('.task-panel-overlay:visible').count()==0
  passed('浮图失权只给简短状态，普通格可保存且不新增授权步骤')
  control(mode='ready',hidden=False);held['value']=True;page.locator('[data-grid-refresh]').click();wait_pending()
  page.locator('[data-grid-sheet]').select_option('other')
  page.wait_for_function("()=>document.querySelector('[data-grid-sheet]').value==='other'&&document.querySelector('.table-pagination').textContent.includes('8 行')")
  release();page.wait_for_timeout(100)
  assert page.locator('[data-grid-floating]').count()==0
  passed('切换子表后迟到浮图结果丢弃')
  page.locator('[data-grid-sheet]').select_option('s');floats_loaded()
  page.set_viewport_size({'width':390,'height':844});page.locator('.source-grid-scroll').evaluate('e=>{e.scrollTop=0;e.scrollLeft=0}')
  page.screenshot(path=str(OUT/'floating-narrow.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  assert 'images.synthetic.test' not in page.evaluate('JSON.stringify({...localStorage})')
  assert not errors,errors
  passed('390px不撑宽整页，临时图片链接不落本地存储')
  browser.close()
 (OUT/'result.json').write_text(json.dumps({'ok':True,'checks':checks,'edge':version,'actualPNGDecode':True,'syntheticRemote':True,'requests':requests,'measurements':measurements,'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
except Exception:
 (OUT/'result.json').write_text(json.dumps({'ok':False,'checks':checks,'trace':traceback.format_exc(),'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8');raise
finally:
 node.terminate();node.wait(timeout=10);log.close();server.shutdown();server.server_close()
