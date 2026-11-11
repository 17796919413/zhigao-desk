"""Synthetic UI + real stdio MCP checks; never uses the user's browser profile."""
from pathlib import Path
import functools,http.server,threading,subprocess,os,socket,time,json,urllib.request,zipfile,io
from playwright.sync_api import sync_playwright
from mcp_client_fixture import MCP

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'_verify'/'workbench-feedback-20261111';OUT.mkdir(parents=True,exist_ok=True)
FIX=ROOT.parent/'_verify'/'assurance-20261110'/'fixtures'
def zip_bytes(files):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w') as z:
  for name,value in files.items():z.writestr(name,value)
 return b.getvalue()
PNG=(FIX/'normal.png').read_bytes()
PPT=zip_bytes({'ppt/slides/slide1.xml':'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>品牌原话：开头先介绍产品。</a:t></a:r></a:p></p:sld>',
 'ppt/notesSlides/notesSlide1.xml':'<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>备注：保留作者表达。</a:t></a:r></a:p></p:notes>',
 'ppt/slides/_rels/slide1.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>', 'ppt/media/image1.png':PNG})
DOCX=zip_bytes({'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word品牌反馈：不要修改真实体验。</w:t></w:r></w:p></w:body></w:document>',
 'word/comments.xml':'<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0"><w:p><w:r><w:t>批注：增加使用场景。</w:t></w:r></w:p></w:comment></w:comments>'})
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
backend=f'http://127.0.0.1:{port}'
env={**os.environ,'ZHIGAO_PORT':str(port),'ZHIGAO_AUTO_UPDATE':'0','ZHIGAO_ORIGINS':origin}
log=(OUT/'connector.log').open('w',encoding='utf-8')
process=subprocess.Popen(['node',str(ROOT/'zhigao-connector.mjs'),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
checks=[];errors=[];client=None
def passed(text):checks.append(text);print('PASS '+text,flush=True)
try:
 for _ in range(100):
  try:
   with urllib.request.urlopen(backend+'/health',timeout=1) as r:
    if json.load(r).get('app')=='zhigao':break
  except Exception:time.sleep(.1)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True)
  context=browser.new_context(viewport={'width':1440,'height':1100})
  context.route('http://127.0.0.1:47821/**',lambda route:route.continue_(url=backend+route.request.url.split('47821',1)[1]))
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(origin);page.wait_for_selector('#agent-chip');page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('等待 AI')")
  client=MCP(ROOT/'zhigao-connector.mjs',env,log,page)
  def raw(name,args=None):return client.call(name,args or {})
  def call(name,args=None):
   result=raw(name,args)
   assert not result.get('isError'),result
   return json.loads(next(c['text'] for c in result['content'] if c['type']=='text'))
  assert call('zhigao_status')['connected']
  page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('已连接')")
  passed('普通网址首次打开自动接通，真实 MCP 状态调用与网页在线标识一致')
  second=context.new_page();second.goto(origin);second.wait_for_function("document.querySelector('#agent-chip').textContent.includes('其他标签页')")
  second.close();passed('同浏览器第二标签页不会抢占连接')
  page.evaluate("async()=>{const m=await import('/agent.js');m.stopAgent();}")
  page.reload();page.wait_for_selector('#agent-chip');page.wait_for_timeout(2700)
  assert page.evaluate("localStorage.getItem('zhigao-agent-v1')")=='off'
  assert '未连接' in page.locator('#agent-chip').inner_text();passed('用户主动断开后刷新保持断开')
  projects=[{'id':'A','name':'合成品牌甲','status':'active','notes':'只做必要修改。','library':[{'id':'lib-a','title':'甲品牌依据','kind':'产品资料','text':'星河杯的容量为300毫升。'}],
   'rules':[{'id':'old','title':'旧口径','description':'过期口径','enabled':True,'type':'custom'},{'id':'new','title':'最新口径','description':'保持产品名准确','enabled':True,'type':'custom','supersedes':['old']} ]},
   {'id':'B','name':'合成品牌乙','status':'active','notes':'乙品牌独立笔记','rules':[],'library':[]}]
  page.evaluate('(projects)=>localStorage.setItem("zhigao-settings-v1",JSON.stringify({selected:"A",projects}))',projects)
  page.reload();page.wait_for_selector('.wb-list')
  page.evaluate("()=>{import('/agent.js').then(m=>m.startAgent());}")
  page.locator('#file-input').set_input_files({'name':'【同一达人】图文大纲.txt','mimeType':'text/plain','buffer':'星河杯的容量为300毫升。'.encode()})
  page.wait_for_selector('.wb-row');row=page.locator('.wb-row').first;doc_id=row.get_attribute('data-doc-id')
  row.locator('.wb-feedback summary').click();row.locator('[data-feedback-text]').fill('品牌方要求：先讲实际使用场景。');row.locator('[data-action=wb-feedback-save]').click()
  page.wait_for_selector('.wb-feedback-entry');assert '1 条' in page.locator('.wb-feedback summary').inner_text()
  page.locator('[data-feedback-files]').set_input_files([
   {'name':'截图.png','mimeType':'image/png','buffer':PNG},
   {'name':'品牌反馈.docx','mimeType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','buffer':DOCX},
   {'name':'品牌反馈.pptx','mimeType':'application/vnd.openxmlformats-officedocument.presentationml.presentation','buffer':PPT},
   {'name':'品牌反馈.pdf','mimeType':'application/pdf','buffer':(FIX/'two-pages.pdf').read_bytes()}])
  page.wait_for_function("document.querySelectorAll('.wb-feedback-entry').length===5",timeout=60000)
  assert '批注：增加使用场景' in page.locator('.wb-feedback').inner_text()
  assert '备注：保留作者表达' in page.locator('.wb-feedback').inner_text()
  passed('专属反馈文字、截图、Word正文批注、PPTX文字备注内嵌图、PDF添加成功')
  page.screenshot(path=str(OUT/'feedback-desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'feedback-mobile.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.set_viewport_size({'width':1440,'height':1100})
  page.reload();page.wait_for_selector('.wb-row');page.locator('.wb-feedback summary').click();assert page.locator('.wb-feedback-entry').count()==5
  passed('反馈和附件刷新后保留；手机页面无横向溢出')
  brief=call('zhigao_get_review_brief',{'docId':doc_id})
  def section(brief,name):
   cursor=None;rows=[]
   while True:
    args={'docId':doc_id,'reviewToken':brief['reviewToken'],'section':name}
    if cursor:args['cursor']=cursor
    part=call('zhigao_read_review_context',args);rows+=part['items'];cursor=part['nextCursor']
    if not cursor:return rows
  sources=section(brief,'sources');assets=section(brief,'assets')
  assert any('先讲实际使用场景' in s['text'] for s in sources)
  assert len([a for a in assets if a.get('feedbackId')])==4
  for a in assets:
   response=raw('zhigao_read_review_asset',{'docId':doc_id,'reviewToken':brief['reviewToken'],'assetId':a['id']})
   assert not response.get('isError'),response
   assert any(c['type']=='image' for c in response['content'])
  passed('真实 MCP 获取专属反馈全文，并原生读取截图、PPT内嵌图和PDF所有页面')
  check_source=next(s for s in sources if '先讲实际使用场景' in s['text'])
  call('zhigao_record_review_checks',{'docId':doc_id,'reviewToken':brief['reviewToken'],'basis':brief['basis'],'checks':{'sourceChecks':[{'id':check_source['id'],'quote':check_source['text'],'reason':'合成旧检查'}]}})
  page.locator('.wb-feedback-entry').first.locator('[data-action=wb-feedback-delete]').click()
  page.wait_for_function("document.querySelectorAll('.wb-feedback-entry').length===4")
  stale=raw('zhigao_read_review_context',{'docId':doc_id,'reviewToken':brief['reviewToken'],'section':'sources'})
  assert stale.get('isError') and 'BASIS_CHANGED' in str(stale)
  new=call('zhigao_get_review_brief',{'docId':doc_id,'retry':True})
  assert '先讲实际使用场景' not in str(section(new,'sources'))+str(section(new,'previousChecks'))
  passed('删除反馈立即阻断旧凭据；重领资料与历史检查不再带回已删原话')
  page.locator('.wb-feedback-entry').first.locator('[data-action=wb-feedback-edit]').click();page.locator('#feedback-edit-text').fill('截图补充：保留自然口吻。');page.locator('[data-action=wb-feedback-update]').click()
  page.wait_for_function("document.querySelector('.wb-feedback-entry').textContent.includes('保留自然口吻')");passed('反馈可编辑，保留原始附件')
  # Same creator and stage, different uploaded document: feedback must not copy.
  page.locator('#file-input').set_input_files({'name':'【同一达人】图文大纲v2.txt','mimeType':'text/plain','buffer':'星河杯新一轮稿件。'.encode()})
  page.wait_for_function("document.querySelectorAll('.wb-row').length===2")
  newer=page.locator('.wb-row').first;new_id=newer.get_attribute('data-doc-id');assert new_id!=doc_id
  assert newer.locator('.wb-feedback-entry').count()==0
  newer_brief=call('zhigao_get_review_brief',{'docId':new_id})
  check=call('zhigao_read_review_context',{'docId':new_id,'reviewToken':newer_brief['reviewToken'],'section':'sources'})
  assert not any(s['kind']=='feedback' for s in check['items']);passed('同达人新版稿件不继承另一份稿件的临时反馈')
  page.locator('#file-input').set_input_files({'name':'超过15MB.png','mimeType':'image/png','buffer':PNG+b'\0'*(16*1024*1024)})
  page.wait_for_function("document.querySelectorAll('.wb-row').length===3",timeout=60000);passed('16MiB稿件通过真实上传、解析与保存')
  page.locator('.navbtn[data-page=rules]').click();page.locator('[data-action=edit-project]').click();page.locator('#edit-project-name').fill('合成品牌甲改名');page.locator('[data-action=save-project-name]').click()
  assert page.locator('[data-setting=project]').input_value()=='A'
  page.wait_for_function("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[0].name==='合成品牌甲改名'")
  page.locator('[data-action=delete-rule][data-id=new]').click();page.locator('[data-action=confirm-delete-rule]').click()
  page.wait_for_function("!document.querySelector('[data-action=delete-rule][data-id=new]')")
  rules=page.evaluate("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[0].rules")
  assert len(rules)==1 and rules[0]['enabled']==False
  passed('品牌项目改名持久化；删除最新规则不会复活被替代旧规则')
  page.screenshot(path=str(OUT/'brand-desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'brand-mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.set_viewport_size({'width':1440,'height':1100})
  page.locator('[data-action=lib-del]').click();page.locator('[data-action=lib-del-confirm]').click();page.wait_for_function("!document.querySelector('[data-action=lib-del]')")
  assert not call('zhigao_get_project',{'sections':['libraryEntries']})['libraryEntries'];passed('删除品牌资料后Agent重新读取为空')
  # Prove a settings write failure does not claim deletion.
  page.evaluate("()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='zhigao-settings-v1')throw new DOMException('full','QuotaExceededError');return window.originalSet.call(this,k,v)};}")
  page.locator('[data-action=delete-project]').click();page.locator('[data-action=confirm-delete-project]').click();page.wait_for_timeout(200)
  assert len(page.evaluate("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects"))==2
  page.evaluate('()=>{Storage.prototype.setItem=window.originalSet;}');page.locator('[data-action=close-modal]').first.click();passed('设置写入失败不执行项目删除')
  page.evaluate('''async()=>{const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});await new Promise((resolve,reject)=>{const tx=db.transaction(['tasks','items','media','batches','integrations','folders'],'readwrite');for(const s of ['tasks','items','media','batches','integrations','folders'])tx.objectStore(s).put({id:s==='folders'?'B':'brand-B-'+s,projectId:'B'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();}''')
  page.locator('[data-action=delete-project]').click();page.locator('[data-action=confirm-delete-project]').click()
  page.wait_for_function("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects.length===1")
  page.wait_for_function("!document.querySelector('#modal-root .modal')")
  state=page.evaluate('''async()=>{const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});const out={};for(const s of ['tasks','items','media','batches','integrations','folders'])out[s]=await new Promise(r=>{const q=db.transaction(s).objectStore(s).getAll();q.onsuccess=()=>r(q.result.map(x=>({id:x.id,projectId:x.projectId})))});db.close();return out;}''')
  assert all(len(rows)==1 and rows[0]['projectId']=='B' for rows in state.values()),state
  assert call('zhigao_status')['currentProject']=='合成品牌乙'
  denied=raw('zhigao_get_review_brief',{'docId':doc_id});assert denied.get('isError')
  passed('删除品牌原子清理六类数据库记录；另一品牌不变；旧稿不能再审')
  page.locator('[data-action=delete-project]').click();page.locator('[data-action=confirm-delete-project]').click();page.wait_for_selector('h1:text("还没有品牌项目")');page.reload();page.wait_for_selector('h1:text("还没有品牌项目")')
  assert page.evaluate("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects.length")==0
  passed('删除最后一个品牌后刷新保持空白，不恢复默认品牌')
  assert not errors,errors
  client.close();client=None;browser.close()
 (OUT/'result.json').write_text(json.dumps({'checks':checks,'count':len(checks),'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
finally:
 if client:client.close()
 process.terminate();process.wait(timeout=10);server.shutdown();log.close()
