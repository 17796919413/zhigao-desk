"""Real Edge renders synthetic source-sheet PNGs; no cloud or personal profile."""
from pathlib import Path
import os, json, functools, http.server, threading, traceback, subprocess, urllib.request, urllib.error, io, time
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT'])
OUT.mkdir(parents=True,exist_ok=False)
log=(OUT/'server.log').open('w',encoding='utf-8')
node=subprocess.Popen(['node','tests/grid_images_server.mjs'],cwd=ROOT,env=dict(os.environ,ZHIGAO_VERIFY_OUT=str(OUT/'journal')),stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8')
port=json.loads(node.stdout.readline())['port']

def post(endpoint,body):
 req=urllib.request.Request(f'http://127.0.0.1:{port}{endpoint}',json.dumps(body).encode(),{'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=20) as response:return response.status,response.read()
 except urllib.error.HTTPError as e:return e.code,e.read()

def control(**body):return json.loads(post('/control',body)[1])['data']

colors={'red':'#d15442','blue':'#3d69a7','green':'#3b8968','purple':'#865baa','wide':'#c99637','last':'#457e92'}
pngs={}
for name,color in colors.items():
 picture=Image.new('RGB',(240,120),color)
 draw=ImageDraw.Draw(picture);draw.rectangle((10,10,229,109),outline='white',width=3);draw.text((32,48),'SOURCE IMAGE / '+name.upper(),fill='white')
 data=io.BytesIO();picture.save(data,format='PNG');pngs[name]=data.getvalue()
 (OUT/f'fixture-{name}.png').write_bytes(pngs[name])

class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass

http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
checks,errors,requests,pending,measurements=[],[],[],[],[]
held={'value':True,'second':True}

def passed(text):checks.append(text);print('PASS '+text,flush=True)

try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True)
  version=browser.version
  context=browser.new_context(viewport={'width':1440,'height':1000})
  url='https://synthetic.feishu.cn/sheets/book'
  seed={'selected':'p','projects':[{'id':'p','name':'原表图片验收品牌','status':'active','rules':[],'library':[],'feishu':{'reviewTableVersion':2,'sheets':[],'refined':{'url':url,'sheet':'s'}}}]}
  context.add_init_script("if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-settings-v1',"+json.dumps(json.dumps(seed,ensure_ascii=False))+");localStorage.setItem('seed','1');localStorage.setItem('zhigao-agent-v1','off');}")
  def fulfill(route,body):
   code,response=post('/grid',body);route.fulfill(status=code,body=response,content_type='application/json')
  def route_api(route):
   if not route.request.url.endswith('/page/feishu'):route.abort();return
   body=route.request.post_data_json;requests.append(body)
   if body['action']=='gridImages' and (held['value'] or held['second'] and sum(r['action']=='gridImages' for r in requests)==2):pending.append((route,body));return
   fulfill(route,body)
  context.route('http://127.0.0.1:47821/**',route_api)
  def route_image(route):
   name=route.request.url.split('/')[-1].split('.')[0]
   if name in pngs:route.fulfill(status=200,body=pngs[name],content_type='image/png')
   else:route.fulfill(status=404,body='missing',content_type='text/plain')
  context.route('https://images.synthetic.test/**',route_image)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}')
  page.locator('[data-page=feishu]').first.click();page.wait_for_selector('.source-grid')
  def wait_pending():
   limit=time.monotonic()+15
   while not pending and time.monotonic()<limit:page.wait_for_timeout(25)
   assert pending,'Image request must be pending'
  def release():
   held['value']=False
   for route,body in list(pending):fulfill(route,body)
   pending.clear()
  def loaded(address):
   page.wait_for_function("a=>{const i=document.querySelector('[data-grid-cell=\"'+a+'\"] img');return i&&i.complete&&i.naturalWidth===240}",arg=address)
  def saved():
   page.wait_for_function("()=>{const s=document.querySelector('[data-grid-status]').textContent;return s==='已保存'||s.includes('未完成')}")
   assert page.locator('[data-grid-status]').inner_text()=='已保存',page.locator('[data-grid-status]').inner_text()
  def geometry():
   return page.locator('[data-grid-cell=B3]').evaluate('e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height]')
  wait_pending()
  assert page.locator('[data-grid-cell=A3]').inner_text()=='原表配图'
  assert page.locator('[data-grid-cell=B3]').get_attribute('data-grid-editable')=='false'
  assert page.locator('[data-grid-cell=B3] img').count()==0
  passed('图片请求未完成时文字与原表可读，图片格保持只读')
  page.locator('[data-grid-cell=F6]').dblclick()
  editor=page.locator('[data-grid-input]');editor.fill('输入等待回图');editor.evaluate('e=>e.setSelectionRange(2,6)')
  before=geometry();position=page.locator('.source-grid-scroll').evaluate('e=>[e.scrollLeft,e.scrollTop]')
  release();loaded('B3');loaded('D3');wait_pending()
  page.wait_for_function("()=>{const p=document.querySelector('[data-grid-cell=D6] .grid-image-placeholder');return p&&p.textContent.includes('未加载')}")
  first_image=page.locator('[data-grid-cell=B3] img').element_handle()
  held['second']=False;release();loaded('B9')
  assert first_image.evaluate('e=>e.isConnected'),'A later image batch must preserve the image already displayed'
  assert editor.input_value()=='输入等待回图'
  assert editor.evaluate('e=>[e.selectionStart,e.selectionEnd,document.activeElement===e]')==[2,6,True]
  assert page.locator('.source-grid-scroll').evaluate('e=>[e.scrollLeft,e.scrollTop]')==position
  assert geometry()==before
  pixels=Image.open(io.BytesIO(page.locator('[data-grid-cell=B3] img').screenshot())).convert('RGB')
  assert sum(1 for pixel in pixels.getdata() if pixel[0]>160 and pixel[1]<120 and pixel[2]<120)>pixels.width*pixels.height//3
  measurements.append({'before':before,'after':geometry(),'scroll':position})
  assert '图片前说明' in page.locator('[data-grid-cell=D3]').inner_text() and '图片后说明' in page.locator('[data-grid-cell=D3]').inner_text()
  passed('真实PNG完成解码，富文本前后说明、格尺寸、输入焦点、选区和滚动位置保持')
  page.wait_for_function("()=>!document.querySelector('.source-grid').textContent.includes('图片加载中')")
  state=control();assert state['writes']==0
  assert all(len(tokens)<=5 for tokens in state['requests'])
  assert sum(tokens.count('red') for tokens in state['requests'])==1
  assert not any('last' in tokens for tokens in state['requests'])
  for address in ['B6','D6','F9']:assert '图片未加载' in page.locator(f'[data-grid-cell={address}]').inner_text()
  passed('缺图、404和非法链接各自在原格提示；重复图片去重，未读取其他分页图片')
  editor.press('Enter');saved();loaded('B3')
  state=control();assert state['writes']==1 and state['rows']['F6']['rawValue']=='输入等待回图'
  page.locator('[data-grid-cell=B3]').focus();page.keyboard.press('Enter');assert page.locator('[data-grid-input]').count()==0
  page.locator('.source-grid-scroll').evaluate('e=>{e.scrollTop=0;e.scrollLeft=0}')
  page.screenshot(path=str(OUT/'images-desktop.png'),full_page=True)
  passed('其他单元格照常自动保存，图片不进入编辑框或被写回')
  page.locator('[data-grid-next]').click();page.wait_for_selector('[data-grid-cell=B44]');loaded('A39');loaded('H70')
  assert page.locator('[data-grid-cell=A39]').first.get_attribute('data-grid-position')=='A41'
  passed('翻页后补读原始合并起点图片，并读取该页后段图片')
  control(mode='denied');page.locator('[data-grid-refresh]').click()
  page.wait_for_function("()=>document.querySelector('[data-grid-cell=A39]').textContent.includes('图片未加载')")
  assert page.locator('.task-panel-overlay:visible').count()==0
  page.locator('[data-grid-cell=D44]').dblclick();page.locator('[data-grid-input]').fill('图片不可用时仍可编辑');page.locator('[data-grid-input]').press('Enter');saved()
  assert control()['rows']['D44']['rawValue']=='图片不可用时仍可编辑'
  page.screenshot(path=str(OUT/'images-denied.png'),full_page=True)
  passed('图片无权限只影响图片格，正文可保存且不弹出新授权步骤')
  control(mode='ready');held['value']=True;page.locator('[data-grid-refresh]').click();wait_pending()
  page.locator('[data-grid-sheet]').select_option('other')
  page.wait_for_function("()=>document.querySelector('[data-grid-sheet]').value==='other'&&document.querySelector('.table-pagination').textContent.includes('8 行')")
  with page.expect_request_finished(lambda request:request.url.endswith('/page/feishu') and request.post_data_json.get('action')=='gridImages'):
   release()
  page.evaluate('()=>new Promise(requestAnimationFrame)')
  assert page.locator('[data-grid-image]').count()==0
  assert page.locator('[data-grid-sheet]').input_value()=='other'
  passed('切换子表后迟到图片响应不插入新表')
  page.locator('[data-grid-sheet]').select_option('s');loaded('B3');loaded('D3')
  page.set_viewport_size({'width':390,'height':844})
  page.locator('.source-grid-scroll').evaluate('e=>{e.scrollTop=0;e.scrollLeft=0}')
  page.screenshot(path=str(OUT/'images-narrow.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  assert page.locator('[data-grid-cell=B3] img').evaluate('e=>Math.abs(e.getBoundingClientRect().width/e.getBoundingClientRect().height)>0')
  stored=page.evaluate('JSON.stringify({...localStorage})')
  assert 'images.synthetic.test' not in stored
  assert not errors,errors
  passed('390px窄屏不横向溢出，临时图片链接不写入localStorage，页面无异常')
  browser.close()
 result={'ok':True,'checks':checks,'edge':version,'syntheticRemote':True,'actualPNGDecode':True,'realFeishuWrites':0,'requests':requests,'measurements':measurements,'pageErrors':errors}
 (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
except Exception as e:
 (OUT/'result.json').write_text(json.dumps({'ok':False,'checks':checks,'error':str(e),'trace':traceback.format_exc(),'requests':requests,'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
 raise
finally:
 node.terminate();node.wait(timeout=10);log.close();server.shutdown();server.server_close()
