"""Real Edge, real app and extracted connector write pipeline; synthetic remote table."""
from pathlib import Path
import os,json,functools,http.server,threading,traceback,subprocess,urllib.request,urllib.error
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
assert os.environ.get('ZHIGAO_GRID_LIVE')!='1'
log=(OUT/'server.log').open('w',encoding='utf-8');env=dict(os.environ,ZHIGAO_VERIFY_OUT=str(OUT/'journal'),ZHIGAO_SYNC_SERVER='1')
node=subprocess.Popen(['node','tests/feishu_sync_fixture.mjs'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8');port=json.loads(node.stdout.readline())['port']
def post(endpoint,data):
 req=urllib.request.Request(f'http://127.0.0.1:{port}{endpoint}',json.dumps(data).encode(),{'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def control(**kw):return json.loads(post('/control',kw)[1])['data']
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/app.js':
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'''\nwindow.probe={db:()=>db,state:()=>({settings,tasks,items}),persist:commitWorkbench,render,actions,workbench,project,update:commitAgentProject,
    reset:async seed=>{await new Promise((ok,no)=>{const tx=db.transaction(['tasks','items'],'readwrite');tx.objectStore('tasks').clear();tx.objectStore('items').clear();tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});savedRecords.clear();settings=seed;localStorage.setItem('zhigao-settings-v1',JSON.stringify(seed));tasks=[];items=[];fsLive=null;fsPendingWrites=null;page='home';render();}};''').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
checks=[];errors=[];requests=[];hooks={}
def passed(s):checks.append(s);print('PASS '+s,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000})
  context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
  def route(r):
   if r.request.url.endswith('/page/feishu'):
    body=r.request.post_data_json;requests.append(body);code,data=post('/grid',body)
    if body['action']=='write' and hooks.get('after_write'):page.evaluate(hooks.pop('after_write'))
    r.fulfill(status=code,body=data,content_type='application/json')
   else:r.abort()
  context.route('http://127.0.0.1:47821/**',route)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe && !!probe.db()')
  seed={'selected':'p','projects':[{'id':'p','name':'活动同步验收品牌','date':'basis','status':'active','selectedActivity':'a','activities':[{'id':'a','name':'秋季活动','notes':''},{'id':'b','name':'冬季活动','notes':''}],'rules':[],'library':[],'feishu':{'reviewTableVersion':2,'sheets':[],'refined':{'url':'https://example.feishu.cn/sheets/book'}}}]}
  def reset():
   control(reset=True);page.evaluate('seed=>probe.reset(seed)',seed)
   page.evaluate("""async()=>{const records=[];for(const id of ['a','b']){const it={id:'i'+id,projectId:'p',activityId:id,author:'同名达人',platform:'小红书',title:'同款内容',kind:'图文',created:'2026-11-17',updated:'2026-11-17',publish:{date:'2099-01-01',status:'已发布'}};
   const t={id,itemId:it.id,projectId:'p',activityId:id,projectName:'活动同步验收品牌',filename:id+'活动稿.txt',author:it.author,platform:it.platform,kind:it.kind,stage:'大纲',fmt:'text',created:'2026-11-17',updated:'2026-11-17',ruleDate:'basis',cells:[{id:'c',original:'合成正文',current:'合成正文'}],flow:{state:'review',round:1,feedback:[],submissions:[],log:[]},findings:[],rules:[],ai:{at:'review-'+id,changes:Array.from({length:id==='a'?1:2},(_,n)=>({cellId:'c',original:'合成',replacement:'合成',reason:'测试'+n})),warnings:[],assurance:{complete:true,projectRevision:'basis'},coverage:{complete:true},archive:{state:'saved',paths:['synthetic']}}};records.push(['items',it],['tasks',t]);}await probe.persist(records);probe.render();}""")
  def sync(id='a',expected='saved'):
   old=page.evaluate('(id)=>probe.state().tasks.find(t=>t.id===id).feishuSync?.at',id)
   page.locator(f'[data-action=wb-sync][data-id="{id}"]').click()
   page.wait_for_function("([id,old])=>{const s=probe.state().tasks.find(t=>t.id===id)?.feishuSync;return s&&s.at!==old}",arg=[id,old],timeout=30000)
   result=page.evaluate('(id)=>probe.state().tasks.find(t=>t.id===id).feishuSync',id);assert result['state']==expected,result
   return result
  reset();page.evaluate("""async()=>{const i=probe.state().items.find(i=>i.id==='ia');await probe.persist([['items',{...i,feishu:{sheetId:'old-sheet',key:'同名达人|小红书|同款内容'}}]])}""")
  page.locator('[data-action=wb-match]').click();page.wait_for_function("probe.state().items.find(i=>i.id==='ia').feishu.key.includes('activity:')")
  assert '秋季活动' in page.evaluate("probe.state().items.find(i=>i.id==='ia').feishu.key");assert not control()['writes'];passed('匹配稿件可更新旧三字段绑定，按当前活动关联且不写远端')
  reset();before=control()['rows'];sync();after=control()['rows'];diff=[(i,j) for i in range(2) for j in range(len(before[i])) if before[i][j]!=after[i][j]]
  assert diff==[(0,4)],diff;assert after[0][4]=='AI已审 · 1处修改';assert control()['writes'][0]['cell']=='E2'
  page.locator('[aria-label="当前活动"]').select_option('b');sync('b');assert control()['rows'][1][4]=='AI已审 · 2处修改'
  assert [(w['cell'],w['sheetId']) for w in control()['writes']]==[('E2','s'),('E3','s')]
  for i in range(2):
   for j in range(len(before[i])):
    if j!=4:assert control()['rows'][i][j]==before[i][j]
  passed('同达人同标题按活动分别同步，完整表差异只含两个目标阶段格')
  page.screenshot(path=str(OUT/'sync-desktop.png'),full_page=True);sync('b');assert len(control()['writes'])==2
  page.reload();page.wait_for_function('!!window.probe && !!probe.db()');page.wait_for_selector('[data-action=wb-sync][data-id=b]');sync('b');assert len(control()['writes'])==2
  passed('同步结果刷新持久，重复同步不重写、不改档期发布或反馈')
  reset();control(insertBeforeWrite=True);sync();assert control()['writes'][0]['cell']=='E3';assert control()['rows'][2][4]==''
  passed('网页读取后原表插行，实际连接器重新定位当前活动行')
  reset();state=control();cols=[3,0,1,2,5,6,7,8,9,4];control(headers=[state['headers'][i] for i in cols],rows=[[r[i] for i in cols] for r in state['rows']]);sync();assert control()['writes'][0]['cell']=='J2'
  passed('活动和阶段列换位置后重新识别，只写新阶段地址')
  reset();state=control();control(rows=[state['rows'][0],state['rows'][0],state['rows'][1]]);result=sync(expected='failed');assert '多条' in result['message'];assert not control()['writes']
  reset();state=control();control(headers=[*state['headers'],'活动名称'],rows=[[*r,r[3]] for r in state['rows']]);result=sync(expected='failed');assert '活动列' in result['message'];assert not control()['writes']
  reset();state=control();state['rows'][0][3]='';control(rows=state['rows']);sync(expected='failed');assert not control()['writes']
  reset();state=control();state['rows'][0][2]='另一篇内容';control(rows=state['rows']);sync(expected='failed');assert not control()['writes']
  passed('同活动重复记录、重复活动列、活动空白及不同内容标题均拒绝同步')
  reset();state=control();control(headers=[h for i,h in enumerate(state['headers']) if i!=3],rows=[[x for i,x in enumerate(r) if i!=3] for r in state['rows']]);sync(expected='failed');assert not control()['writes']
  passed('没有活动列的跨活动同名记录继续拒绝猜测')
  reset();control(changeActivity=True);sync(expected='failed');assert not control()['writes'];passed('写前回读发现活动变化，实际写入管线拒绝派发')
  reset();control(lost=True);result=sync(expected='failed');assert '待确认' in result['message'];assert len(control()['writes'])==1
  sync();assert len(control()['writes'])==1;passed('远端响应丢失不报成功，再次核对不重复写入')
  reset();control(emptyResult=True);sync(expected='failed');assert len(control()['writes'])==1;passed('返回空结果不能冒充同步成功')
  reset();control(readDelay=400)
  page.evaluate("""()=>{document.querySelector('[data-action=wb-sync][data-id=a]').click();setTimeout(()=>{const s=document.querySelector('[aria-label="当前活动"]');s.value='b';s.dispatchEvent(new Event('change',{bubbles:true}));},50)}""")
  page.wait_for_function("probe.state().tasks.find(t=>t.id==='a').feishuSync?.state==='failed'");assert not control(readDelay=0)['writes'];assert page.locator('[aria-label="当前活动"]').input_value()=='b'
  passed('等待读表时切活动，原同步停止且不污染新活动界面')
  reset();control(readDelay=400)
  page.evaluate("""()=>{document.querySelector('[data-action=wb-sync][data-id=a]').click();setTimeout(async()=>{const t=probe.state().tasks.find(t=>t.id==='a');await probe.persist([['tasks',{...t,ai:{...t.ai,at:'new-result',changes:[]},fullReviewPending:true,notes:'新结果必须保留'}]]);},50)}""")
  page.wait_for_function("probe.state().tasks.find(t=>t.id==='a').feishuSync?.state==='failed'");assert not control(readDelay=0)['writes'];t=page.evaluate("probe.state().tasks.find(t=>t.id==='a')");assert t['ai']['at']=='new-result' and t['notes']=='新结果必须保留' and t['fullReviewPending']
  passed('等待读表时审核结果变化，不写飞书且失败回写不覆盖新稿件状态')
  reset();control(readDelay=400)
  page.evaluate("""()=>{document.querySelector('[data-action=wb-sync][data-id=a]').click();setTimeout(async()=>{const t=probe.state().tasks.find(t=>t.id==='a');await probe.persist([['tasks',{...t,id:'a-new',revision:undefined,filename:'新一轮.txt',flow:{...t.flow,round:2},ai:null}]]);},50)}""")
  page.wait_for_function("probe.state().tasks.find(t=>t.id==='a').feishuSync?.state==='failed'");assert not control(readDelay=0)['writes'];passed('等待期间收到新一轮，旧稿不会同步进度')
  reset();page.evaluate("""async()=>{const t=probe.state().tasks.find(t=>t.id==='a');await probe.persist([['tasks',{...t,ai:{...t.ai,needsSupplement:true}}]]);probe.render()}""")
  page.locator('[data-action=wb-sync][data-id=a]').click();page.wait_for_function("document.querySelector('#modal-root').textContent.includes('尚未审完')");assert not control()['writes'];page.locator('[data-action=close-modal]').last.click();passed('未完整审核的稿件不进入同步写入')
  reset();page.evaluate("""async()=>{const t=probe.state().tasks.find(t=>t.id==='a');await probe.persist([['tasks',{...t,ai:{...t.ai,coverage:{complete:false}}}]]);probe.render()}""")
  page.locator('[data-action=wb-sync][data-id=a]').click();page.wait_for_function("document.querySelector('#modal-root').textContent.includes('尚未审完')");assert not control()['writes'];page.locator('[data-action=close-modal]').last.click();passed('覆盖检查明确未完成时也拒绝同步，即使assurance误标完成')
  reset();control(readDelay=400)
  page.evaluate("""()=>{document.querySelector('[data-action=wb-sync][data-id=a]').click();setTimeout(()=>{const p=probe.project();p.activityRevisions={a:'new-basis'};localStorage.setItem('zhigao-settings-v1',JSON.stringify(probe.state().settings));},50)}""")
  page.wait_for_function("probe.state().tasks.find(t=>t.id==='a').feishuSync?.state==='failed'");assert not control(readDelay=0)['writes'];passed('等待读取时活动依据更新，旧审核不再同步')
  reset();hooks['after_write']="""async()=>{const t=probe.state().tasks.find(t=>t.id==='a');await probe.persist([['tasks',{...t,ai:{...t.ai,at:'new-after-write',changes:[]},notes:'新审核结果保留'}]])}"""
  sync(expected='failed');t=page.evaluate("probe.state().tasks.find(t=>t.id==='a')");assert len(control()['writes'])==1 and t['ai']['at']=='new-after-write' and t['notes']=='新审核结果保留' and t['feishuSync']['reviewAt']=='review-a'
  passed('写入成功后新审核到达，旧响应不将新审核标为已同步或回滚新结果')
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'sync-narrow.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not errors,errors
  passed('桌面与390px窄屏状态实际渲染，无页面溢出或脚本错误')
  (OUT/'requests.json').write_text(json.dumps(requests,ensure_ascii=False,indent=2),encoding='utf-8');(OUT/'result.json').write_text(json.dumps({'ok':True,'checks':checks,'errors':errors,'live':False,'browser':browser.version},ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
except Exception:
 (OUT/'failure.json').write_text(json.dumps({'ok':False,'checks':checks,'errors':errors,'traceback':traceback.format_exc()},ensure_ascii=False,indent=2),encoding='utf-8');raise
finally:server.shutdown();node.terminate();node.wait(timeout=10);log.close()
