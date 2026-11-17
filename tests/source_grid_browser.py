"""Real Edge + actual grid runtime; isolated browser and journals. Synthetic by default."""
from pathlib import Path
import os,json,functools,http.server,threading,traceback,subprocess,urllib.request,urllib.error
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
live=os.environ.get('ZHIGAO_GRID_LIVE')=='1';url='https://scnplp5q8x3t.feishu.cn/sheets/RdEzsaU5NhFpKStfQ3xcGgHdnab';sid='ez1Kvd' if live else 's'
log=(OUT/'server.log').open('w',encoding='utf-8');env=dict(os.environ,ZHIGAO_VERIFY_OUT=str(OUT/'journal'))
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
  seed={'selected':'p','projects':[{'id':'p','name':'合成验收品牌','status':'active','rules':[],'library':[],'feishu':{'reviewTableVersion':2,'sheets':[],'refined':{'url':url,'sheet':sid}}}]}
  context.add_init_script("if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-settings-v1',"+json.dumps(json.dumps(seed,ensure_ascii=False))+ ");localStorage.setItem('seed','1');localStorage.setItem('zhigao-agent-v1','off');}")
  def route(r):
   if r.request.url.endswith('/page/feishu'):
    code,body=post('/grid',r.request.post_data_json);r.fulfill(status=code,body=body,content_type='application/json')
   else:r.abort()
  context.route('http://127.0.0.1:47821/**',route)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click();page.wait_for_selector('.source-grid',timeout=90000)
  assert page.locator('.source-grid thead th').count()==9
  assert page.locator('[data-grid-cell=A1]').get_attribute('colspan')=='8'
  assert page.locator('.source-grid tbody tr').count()==40
  assert page.locator('[data-grid-cell=F3]').inner_text() in ['001','002']
  initial_b=int(page.locator('[data-grid-cell=B3]').inner_text());initial_e=page.locator('[data-grid-cell=E3]').inner_text();initial_f=page.locator('[data-grid-cell=F3]').inner_text()
  assert page.locator('[data-grid-cell=C3]').inner_text()==str(initial_b+1)
  assert page.locator('[data-grid-cell=G3] a').get_attribute('href')=='https://open.feishu.cn'
  assert page.locator('[data-grid-cell=A3]').evaluate('el=>getComputedStyle(el).color')=='rgb(36, 89, 166)'
  assert page.locator('[data-grid-cell=H3]').evaluate('el=>Math.round(el.getBoundingClientRect().width)')==300
  assert page.locator('[data-grid-cell=A3]').evaluate('el=>Math.round(el.getBoundingClientRect().height)')==65
  passed('按原行列显示合并、颜色、宽列、行高、公式结果、链接、编号与空行，不插入进度列')
  def edit(address,text):
   page.locator(f'[data-grid-cell={address}]').dblclick();page.locator('[data-grid-input]').fill(text);page.locator('[data-grid-input]').press('Enter')
  def saved():
   page.wait_for_function("(()=>{const s=document.querySelector('[data-grid-status]').textContent;return s==='已保存'||s.includes('保存未完成')})()",timeout=90000)
   status=page.locator('[data-grid-status]').inner_text()
   if status!='已保存':
    (OUT/'draft-debug.json').write_text(json.dumps(page.evaluate("()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('zhigao-grid-drafts')))"),ensure_ascii=False,indent=2),encoding='utf-8')
   assert status=='已保存',status
  before_live=None
  if live:
   before_live=[]
   for start in [1,41,81]:before_live.append(json.loads(post('/grid',{'action':'gridRead','url':url,'sheetId':sid,'startRow':start,'pageSize':40})[1])['data'])
   (OUT/'before.json').write_text(json.dumps(before_live,ensure_ascii=False,indent=2),encoding='utf-8')
  target_b=str(initial_b+4);target_e='FALSE' if initial_e=='TRUE' else 'TRUE';target_f='002' if initial_f=='001' else '001'
  edit('B3',target_b);saved();assert page.locator('[data-grid-cell=B3]').inner_text()==target_b
  edit('E3',target_e);saved();assert page.locator('[data-grid-cell=E3]').inner_text()==target_e
  edit('F3',target_f);saved();assert page.locator('[data-grid-cell=F3]').inner_text()==target_f
  passed('编辑离开后自动保存数字、布尔和前导零文本，写后回读才显示已保存')
  if live:
   after_live=[]
   for start in [1,41,81]:after_live.append(json.loads(post('/grid',{'action':'gridRead','url':url,'sheetId':sid,'startRow':start,'pageSize':40})[1])['data'])
   (OUT/'after.json').write_text(json.dumps(after_live,ensure_ascii=False,indent=2),encoding='utf-8')
   def cells(snapshots):return {col+str(row):block['cells'][i][j] for snapshot in snapshots for block in snapshot['ranges'] for i,row in enumerate(block['row_indices']) for j,col in enumerate(block['col_indices'])}
   before_cells=cells(before_live);after_cells=cells(after_live)
   changed=[k for k in before_cells if before_cells[k]!=after_cells[k]];assert set(changed)=={'B3','C3','E3','F3'},changed
   assert after_cells['B3']['rawValue']==int(target_b);assert after_cells['E3']['rawValue']==(target_e=='TRUE');assert after_cells['F3']['rawValue']==target_f
   assert after_cells['C3']['formula']==before_cells['C3']['formula']=='=B3+1';assert after_cells['C3']['rawValue']==int(target_b)+1
   for k in changed:assert before_cells[k].get('cell_styles')==after_cells[k].get('cell_styles')
   passed('真实表85行8列前后对比：仅三格输入和关联公式结果变化，类型、样式及其他676格保持')
  if not live:
   control(lost=True);before=control()['writes'];edit('A5','响应丢失仍保留');page.wait_for_function("document.querySelector('[data-grid-status]').textContent.includes('保存未完成')")
   assert control()['writes']==before+1
   page.reload();page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click();saved();assert control()['writes']==before+1
   passed('写入已提交但响应丢失，刷新后恢复同操作结果，不重写')
   control(bump=True);before=control()['writes'];edit('A5','外部修改后待确认');page.wait_for_selector('[data-grid-retry]');assert control()['writes']==before
   page.on('dialog',lambda d:d.accept());page.locator('[data-grid-retry]').click();saved();assert control()['writes']==before+1
   passed('外部版本变化保留输入，明确核对目标格后才重试')
   page.locator('[data-grid-cell=A5]').dblclick();page.locator('[data-grid-input]').fill('刷新时未离开编辑格');page.reload();page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click();saved();assert page.locator('[data-grid-cell=A5]').inner_text()=='刷新时未离开编辑格'
   passed('编辑中刷新仍能恢复草稿并保存')
   page.locator('[data-grid-next]').click();page.wait_for_selector('[data-grid-cell=A41]');page.locator('[data-grid-next]').click();page.wait_for_selector('[data-grid-cell=A81]');assert page.locator('.source-grid tbody tr').count()==5
   page.locator('[data-grid-sheet]').select_option('other');page.wait_for_selector('[data-grid-cell=A1]');page.wait_for_function("document.querySelector('[data-grid-cell=A1]').textContent==='其他表不受影响'")
   assert page.locator('.source-grid thead th').count()==4
   passed('分页覆盖末行，切换子表后显示正确内容及列数')
   page.locator('[data-grid-sheet]').select_option(sid);page.wait_for_selector('[data-grid-cell=H3]')
   page.evaluate("()=>{window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('zhigao-grid-drafts'))throw Error('配额不足');return realSet.call(this,k,v)}}")
   before=control()['writes'];page.locator('[data-grid-cell=A5]').dblclick();page.locator('[data-grid-input]').fill('写入存储故障');page.locator('[data-grid-input]').press('Enter');assert page.locator('[data-grid-input]').input_value()=='写入存储故障';assert control()['writes']==before
   page.evaluate('()=>{Storage.prototype.setItem=realSet}');page.locator('[data-grid-input]').press('Enter');saved()
   passed('草稿存储失败保持编辑内容且不向云表写入，恢复后成功')
   before=control(delay=700)['writes']
   page.evaluate("""()=>{const change=text=>{document.querySelector('[data-grid-cell=A5]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const el=document.querySelector('[data-grid-input]');el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));};change('第一版');setTimeout(()=>change('保存途中输入的最终版'),400);}""")
   saved();assert page.locator('[data-grid-cell=A5]').inner_text()=='保存途中输入的最终版';assert control(delay=0)['writes']==before+2
   passed('同格保存途中继续输入，旧响应不覆盖新输入，最终版自动接续保存')
   control(delay=700)
   page.evaluate("""()=>{const td=document.querySelector('[data-grid-cell=A5]');td.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));let el=document.querySelector('[data-grid-input]');el.value='磁盘故障前提交';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));setTimeout(()=>{document.querySelector('[data-grid-cell=A5]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('zhigao-grid-drafts'))throw Error('配额不足');return realSet.call(this,k,v)};el=document.querySelector('[data-grid-input]');el.value='配额故障时的新输入';el.dispatchEvent(new Event('input',{bubbles:true}));},400);}""")
   page.wait_for_function("document.querySelector('[data-grid-status]').textContent.includes('输入尚未保存')");page.wait_for_timeout(1100)
   assert page.locator('[data-grid-input]').input_value()=='配额故障时的新输入'
   page.evaluate('()=>{Storage.prototype.setItem=realSet}');control(delay=0);page.locator('[data-grid-input]').press('Enter');saved();assert page.locator('[data-grid-cell=A5]').inner_text()=='配额故障时的新输入'
   passed('保存响应到达时发生草稿配额故障，保留当前输入，存储恢复后完成保存')
   control(readDelay=600)
   page.evaluate("""()=>{document.querySelector('[data-grid-refresh]').click();setTimeout(()=>{const el=document.querySelector('[data-grid-sheet]');el.value='other';el.dispatchEvent(new Event('change',{bubbles:true}));},100)}""")
   page.wait_for_function("document.querySelector('[data-grid-cell=A1]')?.textContent==='其他表不受影响'")
   assert page.locator('[data-grid-sheet]').input_value()=='other';control(readDelay=0)
   passed('刷新响应迟到时切换子表，旧响应不会覆盖当前子表')
   page.locator('[data-grid-sheet]').select_option(sid);page.wait_for_selector('[data-grid-cell=H3]')
  if not live:
   page.locator('[data-page=home]').first.click();newest=control(bump=True)
   page.evaluate("([url,revision])=>{probe.state().settings.projects[0].feishu.liveMeta={url,revision}}",[url,newest['rev']])
   page.locator('[data-page=feishu]').first.click()
   page.wait_for_function("!document.querySelector('[data-grid-refresh]').disabled")
   before=control()['writes'];edit('A5','同步后返回审核表继续编辑');saved();assert control()['writes']==before+1
   passed('同步获得新版本后返回审核表自动刷新，直接编辑无需手动刷新')
  page.evaluate('window.getSelection().removeAllRanges()');page.screenshot(path=str(OUT/'grid-desktop.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'grid-narrow.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not errors,errors
  passed('真实 Edge 桌面及390px窄屏渲染，无页面横向溢出或脚本错误')
  (OUT/'result.json').write_text(json.dumps({'ok':True,'checks':checks,'errors':errors,'live':live,'browser':browser.version,'writes':control()['writes']},ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
except Exception:
 (OUT/'failure.json').write_text(json.dumps({'ok':False,'checks':checks,'errors':errors,'traceback':traceback.format_exc()},ensure_ascii=False,indent=2),encoding='utf-8');raise
finally:server.shutdown();node.terminate();node.wait(timeout=10);log.close()
