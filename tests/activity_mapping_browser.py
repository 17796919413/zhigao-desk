"""Isolated Edge and actual app/connector sync pipeline; synthetic remote only."""
from pathlib import Path
import os,json,functools,http.server,threading,traceback,subprocess,urllib.request,urllib.error
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
assert os.environ.get('ZHIGAO_GRID_LIVE')!='1'
log=(OUT/'server.log').open('w',encoding='utf-8')
env=dict(os.environ,ZHIGAO_VERIFY_OUT=str(OUT/'journal'),ZHIGAO_SYNC_SERVER='1')
node=subprocess.Popen(['node','tests/feishu_sync_fixture.mjs'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8')
port=json.loads(node.stdout.readline())['port']
def post(data):
 req=urllib.request.Request(f'http://127.0.0.1:{port}/grid',json.dumps(data).encode(),{'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def control(**kw):
 req=urllib.request.Request(f'http://127.0.0.1:{port}/control',json.dumps(kw).encode(),{'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)['data']

class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/app.js':
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'''\nwindow.probe={db:()=>db,state:()=>({settings,tasks,items}),persist:commitWorkbench,render,actions,workbench,project,
    reset:async seed=>{await new Promise((ok,no)=>{const tx=db.transaction(['tasks','items'],'readwrite');tx.objectStore('tasks').clear();tx.objectStore('items').clear();tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});savedRecords.clear();settings=seed;localStorage.setItem('zhigao-settings-v1',JSON.stringify(seed));tasks=[];items=[];fsLive=null;fsPendingWrites=null;fsActivityDraft=null;closeModal();page='home';render();}};''').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
http.server.ThreadingHTTPServer.daemon_threads=True
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
checks=[];errors=[];requests=[];hooks={}
def passed(s):
 checks.append(s);print('PASS '+s,flush=True)
 (OUT/'progress.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True)
  context=browser.new_context(viewport={'width':1440,'height':1000})
  context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
  def route(r):
   if r.request.url.endswith('/page/feishu'):
    body=r.request.post_data_json;requests.append(body);code,data=post(body)
    if body['action']=='readAll' and hooks.get('after_read'):page.evaluate(hooks.pop('after_read'))
    r.fulfill(status=code,body=data,content_type='application/json')
   else:r.abort()
  context.route('http://127.0.0.1:47821/**',route)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(origin);page.wait_for_function('!!window.probe && !!probe.db()')
  seed={'selected':'p','projects':[{'id':'p','name':'自定义活动列验收品牌','date':'basis','status':'active','selectedActivity':'a','activities':[{'id':'a','name':'秋季活动','notes':''},{'id':'b','name':'冬季活动','notes':''}],'rules':[],'library':[],'feishu':{'reviewTableVersion':2,'sheets':[],'refined':{'url':'https://example.feishu.cn/sheets/book'}}}]}
  def reset(custom=True):
   control(reset=True);page.evaluate('seed=>probe.reset(seed)',seed)
   page.evaluate("""async()=>{const records=[];for(const id of ['a','b']){const it={id:'i'+id,projectId:'p',activityId:id,author:'同名达人',platform:'小红书',title:'同款内容',kind:'图文',created:'2026-11-17',updated:'2026-11-17',publish:{date:'2099-01-01',status:'已发布'}};
    const t={id,itemId:it.id,projectId:'p',activityId:id,projectName:'自定义活动列验收品牌',filename:id+'活动稿.txt',author:it.author,platform:it.platform,kind:it.kind,stage:'大纲',fmt:'text',created:'2026-11-17',updated:'2026-11-17',ruleDate:'basis',cells:[{id:'c',original:'合成正文',current:'合成正文'}],flow:{state:'review',round:1,feedback:[],submissions:[],log:[]},findings:[],rules:[],ai:{at:'review-'+id,changes:Array.from({length:id==='a'?1:2},(_,n)=>({cellId:'c',original:'合成',replacement:'合成',reason:'测试'+n})),warnings:[],assurance:{complete:true,projectRevision:'basis'},coverage:{complete:true},archive:{state:'saved',paths:['synthetic']}}};records.push(['items',it],['tasks',t]);}await probe.persist(records);probe.render();}""")
   if custom:
    state=control();headers=state['headers'];headers[3]='营销项目';control(headers=headers)
  def open_choice():
   page.locator('[data-action=wb-match]').click();page.wait_for_selector('[data-activity-column]')
  def close_choice():page.locator('[data-action=close-modal]').last.click()
  def choose(value='3'):
   page.locator('[data-activity-column]').select_option(value)
   page.locator('[data-action=fs-activity-map-confirm]').click()
   page.wait_for_function("!document.querySelector('[data-activity-column]')")
  def sync(id='a',expected='saved'):
   old=page.evaluate('(id)=>probe.state().tasks.find(t=>t.id===id).feishuSync?.at',id)
   page.locator(f'[data-action=wb-sync][data-id="{id}"]').click()
   page.wait_for_function("([id,old])=>{const s=probe.state().tasks.find(t=>t.id===id)?.feishuSync;return s&&s.at!==old}",arg=[id,old])
   result=page.evaluate('(id)=>probe.state().tasks.find(t=>t.id===id).feishuSync',id);assert result['state']==expected,result
   return result
  def no_mapping():return page.evaluate("!probe.project().feishu.sheets.some(s=>s.activityMapping)")
  reset(False);page.locator('[data-action=wb-match]').click()
  page.wait_for_function("probe.state().items.find(i=>i.id==='ia').feishu?.key.includes('activity:')")
  assert page.locator('[data-activity-column]').count()==0 and not control()['writes']
  passed('固定活动表头正常匹配，不增加弹窗和操作步骤')
  reset();open_choice();assert page.locator('[data-activity-column]').input_value()==''
  assert not control()['writes'] and page.evaluate('probe.state().items.every(i=>!i.feishu)')
  assert page.locator('[data-activity-column] option[value="0"]').count()==0
  page.screenshot(path=str(OUT/'activity-choice-desktop.png'),full_page=True)
  close_choice();assert no_mapping() and not control()['writes'];passed('自定义列歧义仅打开必要选择；没有默认猜列，取消不保存或写远端')
  open_choice();page.locator('[data-action=fs-activity-map-confirm]').click()
  page.wait_for_function("document.querySelector('[data-save-error]')?.textContent.includes('请选择活动')")
  assert page.locator('[data-activity-column]').count()==1 and no_mapping();choose()
  assert page.evaluate("probe.project().feishu.sheets.find(s=>s.remoteId==='s').activityMapping.header")=='营销项目'
  assert not control()['writes'];passed('未选列不能保存；明确选列只保存本机对应关系并匹配当前稿件')
  before=control()['rows'];sync();page.locator('[aria-label="当前活动"]').select_option('b');sync('b')
  after=control()['rows'];diff=[(i,j) for i in range(len(before)) for j in range(len(before[i])) if before[i][j]!=after[i][j]]
  assert diff==[(0,4),(1,4)],diff
  assert requests[-2]['action']=='write' or any(r['action']=='write' and r['writes'][0].get('activityMapping')=={'header':'营销项目','column':3} for r in requests)
  passed('两活动同名同标题分别同步，完整表差异只有各自当前阶段格')
  page.reload();page.wait_for_function('!!window.probe && !!probe.db()')
  page.wait_for_selector('[data-action=wb-match]');page.locator('[data-action=wb-match]').click()
  page.wait_for_function("document.querySelector('#toast').textContent.includes('已匹配')")
  assert page.locator('[data-activity-column]').count()==0;sync('b');assert len(control()['writes'])==2
  passed('刷新保存的自定义活动列仍有效，再次匹配无需重选且同步不重复写')
  state=control();cols=[3,0,1,2,5,6,7,8,9,4]
  rows=[[r[i] for i in cols] for r in state['rows']];rows[0][9]=''
  control(headers=[state['headers'][i] for i in cols],rows=rows)
  page.locator('[aria-label="当前活动"]').select_option('a');sync();assert control()['writes'][-1]['cell']=='J2'
  assert page.evaluate("probe.project().feishu.sheets.find(s=>s.remoteId==='s').map.activity")==0
  passed('原表活动列和阶段列移动后按表头恢复，只写新的阶段地址')
  state=control();state['headers'][0]='新营销项目';control(headers=state['headers'])
  count=len(control()['writes']);result=sync(expected='failed');assert '活动列' in result['message'] and len(control()['writes'])==count
  open_choice();choose('0');assert page.evaluate("probe.project().feishu.sheets.find(s=>s.remoteId==='s').activityMapping.header")=='新营销项目'
  passed('所选列改名后先阻断同步，经匹配入口重选后恢复')
  reset();open_choice();page.locator('[data-activity-column]').select_option('3')
  state=control();state['headers'][3]='确认期间换表头';control(headers=state['headers'])
  page.locator('[data-action=fs-activity-map-confirm]').click();page.wait_for_function("document.querySelector('[data-save-error]')?.textContent.includes('表头已变化')")
  assert no_mapping() and not control()['writes'];close_choice();passed('选择弹窗期间远端换表头，保存拒绝旧列号')
  reset();open_choice();page.locator('[data-activity-column]').select_option('3')
  page.evaluate("()=>{const s=document.querySelector('[aria-label=\"当前活动\"]');s.value='b';s.dispatchEvent(new Event('change',{bubbles:true}))}")
  page.locator('[data-action=fs-activity-map-confirm]').click();page.wait_for_function("document.querySelector('[data-save-error]')?.textContent.includes('活动')")
  assert no_mapping() and not control()['writes'];close_choice();passed('切活动后旧弹窗不能保存到当前活动或触发同步')
  reset();open_choice();page.locator('[data-activity-column]').select_option('3')
  page.evaluate("""()=>{window.restoreSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='zhigao-settings-v1'&&JSON.parse(v).projects.some(p=>p.feishu?.sheets.some(s=>s.activityMapping)))throw new DOMException('synthetic quota','QuotaExceededError');return window.restoreSetItem.call(this,k,v)}}""")
  page.locator('[data-action=fs-activity-map-confirm]').click();page.wait_for_function("document.querySelector('[data-save-error]')?.textContent.includes('未保存')")
  assert no_mapping() and not control()['writes'];assert page.evaluate("!JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[0].feishu.sheets.some(s=>s.activityMapping)")
  page.evaluate('()=>{Storage.prototype.setItem=window.restoreSetItem}');close_choice();passed('保存映射配额失败时不污染内存或假报成功，原表保持')
  reset();open_choice();page.locator('[data-activity-column]').select_option('3')
  hooks['after_read']="""()=>{const p=probe.project();p.feishu.refined.url='https://example.feishu.cn/sheets/changed';localStorage.setItem('zhigao-settings-v1',JSON.stringify(probe.state().settings))}"""
  page.locator('[data-action=fs-activity-map-confirm]').click();page.wait_for_function("document.querySelector('[data-save-error]')?.textContent.includes('审核表已变化')")
  assert no_mapping() and not control()['writes'];close_choice();passed('确认回读期间换链接，迟到响应不能保存旧表映射')
  reset();open_choice();choose();control(readDelay=250)
  hooks['after_read']="""()=>{const s=probe.project().feishu.sheets.find(s=>s.remoteId==='s');s.activityMapping={header:'另一活动列'};localStorage.setItem('zhigao-settings-v1',JSON.stringify(probe.state().settings))}"""
  result=sync(expected='failed');assert not control(readDelay=0)['writes'];assert '变化' in result['message']
  passed('同步读表期间映射变化使原同步签名失效，不写旧选择对应的稿件')
  reset();open_choice();second=context.new_page();second.goto(origin);second.wait_for_function('!!window.probe && !!probe.db()')
  second.evaluate("()=>{const s=probe.state().settings;s.projects[0].feishu.sheets[0].map.activity=1;localStorage.setItem('zhigao-settings-v1',JSON.stringify(s))}")
  page.locator('[data-activity-column]').select_option('3');page.locator('[data-action=fs-activity-map-confirm]').click()
  page.wait_for_function("document.querySelector('[data-save-error]')?.textContent.includes('已变化')")
  assert no_mapping() and not control()['writes'];second.close();close_choice();passed('另一标签更新设置后拒绝旧弹窗覆盖，保持并发数据')
  reset();open_choice();page.set_viewport_size({'width':390,'height':844})
  page.screenshot(path=str(OUT/'activity-choice-narrow.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  assert page.evaluate("()=>{const r=document.querySelector('[data-activity-column]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}")
  choose();sync();page.screenshot(path=str(OUT/'activity-sync-narrow.png'),full_page=True)
  assert not errors,errors;passed('桌面及390px窄屏选择与保存实际渲染，无横向溢出或脚本错误')
  (OUT/'requests.json').write_text(json.dumps(requests,ensure_ascii=False,indent=2),encoding='utf-8')
  (OUT/'result.json').write_text(json.dumps({'ok':True,'checks':checks,'errors':errors,'live':False,'browser':browser.version,'pipeline':'extracted actual connector, synthetic remote'},ensure_ascii=False,indent=2),encoding='utf-8')
  browser.close()
except Exception:
 (OUT/'failure.json').write_text(json.dumps({'ok':False,'checks':checks,'errors':errors,'traceback':traceback.format_exc()},ensure_ascii=False,indent=2),encoding='utf-8');raise
finally:
 server.shutdown();node.terminate();node.wait(timeout=10);log.close()
