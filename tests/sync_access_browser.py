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
   if file.name=='app.js':data+='\nwindow.probe={grid:sourceGrid,db:()=>db,settings:()=>settings,tasks:()=>tasks,persist:commitWorkbench,workbench,render,project};'
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
  def authorize():
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
   page.wait_for_function("document.querySelector('#task-preparation-panel .connect-intro')?.textContent==='已继续'",timeout=30000)
   page.locator('[data-action=close-modal]').first.click()
  authorize();page.wait_for_selector('[data-grid-cell=B2]')
  passed('实际连接器登录准备后读取合成表')
  headers=['达人','发布平台','内容标题','活动','大纲','脚本','初稿','发布状态']
  values=['合成甲','小红书','合成内容','原有活动','','/','','待发布']
  def seed():
   v={'revision':1,'rows':4,'writes':0,'sync':True,'cells':{chr(65+j)+str(i+1):x for i,row in enumerate([headers,values]) for j,x in enumerate(row)}}
   table.write_text(json.dumps(v),encoding='utf-8')
   page.evaluate("""async()=>{for(const key of Object.keys(localStorage))if(key.startsWith('zhigao-sync-access:'))localStorage.removeItem(key);const p=probe.project();p.date='basis';p.feishu.sheets=[];
    const it={id:'item',projectId:'A',activityId:'legacy',author:'合成甲',platform:'小红书',title:'合成内容',kind:'图文',created:'2026-11-17',updated:'2026-11-17'};
    const t={feishuSync:null,id:'doc',itemId:'item',projectId:'A',activityId:'legacy',projectName:p.name,filename:'合成稿.txt',author:it.author,platform:it.platform,kind:it.kind,stage:'大纲',fmt:'text',created:'2026-11-17',updated:'2026-11-17',ruleDate:'basis',cells:[{id:'c',original:'正文',current:'正文'}],flow:{state:'review',round:1,feedback:[],submissions:[],log:[]},findings:[],rules:[],ai:{at:crypto.randomUUID(),changes:[{cellId:'c',original:'文',replacement:'稿',reason:'合成'}],warnings:[],assurance:{complete:true,projectRevision:'basis'},coverage:{complete:true},archive:{state:'saved',paths:['synthetic']}}};
    await probe.persist([['items',it],['tasks',t]]);localStorage.setItem('zhigao-settings-v1',JSON.stringify(probe.settings()));probe.render();}""")
   page.locator('[data-page=home]').first.click()
  def sync():page.locator('[data-action=wb-sync][data-id=doc]').click()
  def saved():page.wait_for_function("probe.tasks().find(t=>t.id==='doc').feishuSync?.state==='saved'",timeout=30000)
  seed();before=state()['cells'];expire();sync();authorize();saved()
  assert state()['writes']==1 and [a for a in before if before[a]!=state()['cells'][a]]==['E2']
  passed('单稿同步读表前登录过期：原稿续办，只改变当前阶段格')
  seed();v=state();v['writeScope']=True;table.write_text(json.dumps(v),encoding='utf-8');sync();page.wait_for_selector('[data-action=task-approve]')
  ticket=page.evaluate("JSON.parse(localStorage.getItem('zhigao-sync-access:doc'))")
  assert ticket['docId']=='doc' and '正文' not in json.dumps(ticket,ensure_ascii=False)
  page.screenshot(path=str(OUT/'sync-permission-desktop.png'),full_page=True)
  page.reload();page.wait_for_function('!!window.probe && !!probe.db()');authorize();saved()
  assert state()['writes']==1 and state()['cells']['E2']=='AI已审 · 1处修改'
  assert page.evaluate("localStorage.getItem('zhigao-sync-access:doc')")==None
  passed('单稿同步缺写scope并刷新：同任务恢复，明确拒绝意图不阻塞，只写一次')
  # A late grant cannot apply to a new review result.
  seed();expire();sync();page.wait_for_selector('[data-action=task-approve]');ticket=page.evaluate("JSON.parse(localStorage.getItem('zhigao-sync-access:doc'))")
  boundary=page.evaluate('''async id=>{const results=[],p=probe.project(),t=probe.tasks().find(t=>t.id==='doc');
   const changes=[['activity',()=>{p.activities=[{id:'other',name:'另一活动'}];p.selectedActivity='other'},()=>{p.selectedActivity='legacy'}],['url',()=>{p.feishu.refined.url+='changed'},()=>{p.feishu.refined.url=p.feishu.refined.url.replace(/changed$/,'')}],['basis',()=>{p.date='changed'},()=>{p.date='basis'}],['ended',()=>{p.status='ended'},()=>{p.status='active'}],['coverage',()=>{t.ai.coverage.complete=false},()=>{t.ai.coverage.complete=true}],['ownership',()=>{t.projectId='B'},()=>{t.projectId='A'}]];
   for(const [name,change,restore] of changes){change();try{await probe.workbench.resumeSyncAccess(id);results.push(name+':WRONG')}catch{results.push(name+':blocked')}finally{restore()}}
   return results}''',ticket['id'])
  assert len(boundary)==6 and all(x.endswith(':blocked') for x in boundary) and state()['writes']==0
  passed('原续办在活动、链接、依据、项目结束、覆盖缺口或稿件归属变化时全部阻断')
  page.evaluate("""async()=>{const t=probe.tasks().find(t=>t.id==='doc');await probe.persist([['tasks',{...t,ai:{...t.ai,at:'new-review'}}]])}""")
  result=page.evaluate("async id=>{try{await probe.workbench.resumeSyncAccess(id);return 'wrong'}catch(e){return e.code}}",ticket['id'])
  assert result=='TASK_CHANGED' and state()['writes']==0
  page.locator('[data-action=close-modal]').first.click();(OUT/'authorized').write_text('synthetic')
  passed('准备期间出现新审核结果，拒绝旧同步且保留新结果')
  seed();expire();sync();page.wait_for_selector('[data-action=task-approve]');ticket=page.evaluate("JSON.parse(localStorage.getItem('zhigao-sync-access:doc'))")
  page.locator('[data-action=close-modal]').first.click();page.evaluate("()=>{probe.settings().selected='B';probe.render()}")
  result=page.evaluate("async id=>{try{await probe.workbench.resumeSyncAccess(id);return 'wrong'}catch(e){return 'blocked'}}",ticket['id'])
  assert result=='blocked' and state()['writes']==0
  page.evaluate("()=>{probe.settings().selected='A';probe.render()}");(OUT/'authorized').write_text('synthetic')
  passed('准备期间切换品牌，旧单稿同步不跨品牌执行')
  seed();v=state();v['lost']=True;table.write_text(json.dumps(v),encoding='utf-8');sync()
  page.wait_for_function("probe.tasks().find(t=>t.id==='doc').feishuSync?.state==='failed'",timeout=30000)
  assert state()['writes']==1 and page.locator('#task-preparation-panel').count()==0
  v=state();v['lost']=False;table.write_text(json.dumps(v),encoding='utf-8');sync();saved();assert state()['writes']==1
  passed('单稿写入响应丢失保持结果不明，核对后恢复，不触发授权重放')
  page.screenshot(path=str(OUT/'sync-desktop.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'sync-narrow.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth') and not errors,errors
  (OUT/'result.json').write_text(json.dumps({'ok':True,'checks':checks,'errors':errors,'browser':browser.version,'realFeishuWrites':0,'boundary':'Actual Edge, copied connector HTTP/MCP and persistent task/write journals; synthetic CLI and table'},ensure_ascii=False,indent=2),encoding='utf-8')
  browser.close()
except Exception:
 (OUT/'failure.txt').write_text(traceback.format_exc(),encoding='utf-8')
 try:page.screenshot(path=str(OUT/'failure.png'),full_page=True)
 except Exception:pass
 raise
finally:
 if client:client.close()
 process.terminate();process.wait(timeout=15);server.shutdown();server.server_close();log.close()
