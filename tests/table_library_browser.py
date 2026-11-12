"""Isolated synthetic tables and brand files; no real Feishu writes or user profile access."""
from pathlib import Path
import functools,http.server,threading,json,os,io,zipfile,time,subprocess,socket,urllib.request,shutil
from playwright.sync_api import sync_playwright
from synthetic_fixtures import png_bytes,pdf_bytes
from mcp_client_fixture import MCP
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('ZHIGAO_VERIFY_OUT',ROOT.parent/'_verify'/'table-library-20261112'/'browser'));OUT.mkdir(parents=True,exist_ok=True)
def zipped(files):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w') as z:
  for k,v in files.items():z.writestr(k,v)
 return b.getvalue()
PPT=zipped({'ppt/slides/slide1.xml':'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>合成品牌：星河杯容量300毫升。</a:t></a:r></a:p></p:sld>', 'ppt/notesSlides/notesSlide1.xml':'<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>备注要求：保留自然口吻。</a:t></a:r></a:p></p:notes>', 'ppt/media/image1.png':png_bytes()})
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  file=Path(self.translate_path(self.path.split('?',1)[0]))
  if file.suffix in ['.js','.mjs'] and file.is_file():
   data=file.read_bytes().replace(b'http://127.0.0.1:47821',backend.encode()).replace(b'AGENT_PORT=47821',('AGENT_PORT='+str(port)).encode())
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
backend=f'http://127.0.0.1:{port}'
home=OUT/'isolated-home';home.mkdir(exist_ok=True)
connector=OUT/'zhigao-connector.mjs';connector.write_text((ROOT/'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()',json.dumps(str(home))),encoding='utf-8')
for name in ['media-runtime.mjs','media-worker.py']:shutil.copyfile(ROOT/name,OUT/name)
env={**os.environ,'ZHIGAO_PORT':str(port),'ZHIGAO_AUTO_UPDATE':'0','ZHIGAO_ORIGINS':origin,'ZHIGAO_MEDIA_HOME':str(ROOT.parent/'_verify'/'assurance-20261110'/'fresh-runtime')}
log=(OUT/'connector.log').open('w',encoding='utf-8');process=subprocess.Popen(['node',str(connector),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
checks=[];errors=[];client=None
def passed(s):checks.append(s);print('PASS '+s,flush=True)
try:
 for _ in range(100):
  try:
   with urllib.request.urlopen(backend+'/health',timeout=1) as r:
    if json.load(r).get('app')=='zhigao':break
  except Exception:time.sleep(.1)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000})
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_selector('#agent-chip')
  page.evaluate("async()=>{(await import('/agent.js')).stopAgent();}")
  headers=['达人','达人类型','合作产品','发布平台','内容负责人','发布档期','大纲','脚本','初稿','品牌方反馈']
  rows=[[f'合成达人{i+1}','生活方式','星河杯','小红书','小林','2026-11-20','','/','',''] for i in range(76)]
  rows[0][0]='测试达人';rows[2][9]='品牌原话：请核对容量，不改真实体验。'
  url='https://example.feishu.cn/sheets/ReviewTableToken'
  sheets=[{'sheetId':'sheetA','name':'图文合作','headers':headers,'rows':rows,'rowStart':2,'range':'A1:J77'},{'sheetId':'sheetB','name':'视频合作','headers':headers,'rows':[['视频达人','测评','星河杯','抖音','小周','','','','','']],'rowStart':2}]
  writes=[]
  def feishu(route):
   b=json.loads(route.request.post_data or '{}')
   if b['action']=='readAll':data={'sheets':sheets,'title':'星河 · 内容审核表','revision':'r1','identity':'synthetic'}
   elif b['action']=='write':
    writes.extend(b['writes']);data={'results':[{'status':'written'} for _ in b['writes']]}
    for w in b['writes']:
     for sheet in sheets:
      if sheet['sheetId']==b['sheetId']:
       for row in sheet['rows']:
        if row[0]==w['key']['author']:row[w['column']]=w['value']
   else:data={}
   route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'data':data},ensure_ascii=False))
  context.route('**/page/feishu',feishu)
  projects=[{'id':'test','name':'星河 · 合成验收品牌','status':'active','notes':'','rules':[],'library':[], 'feishu':{'source':{'url':'https://example.feishu.cn/sheets/OldSource'},'refined':{'url':url},'sheets':[]}}]
  page.evaluate('(p)=>localStorage.setItem("zhigao-settings-v1",JSON.stringify({selected:"test",projects:p}))',projects)
  page.reload();page.wait_for_selector('[data-page=feishu]');page.locator('[data-page=feishu]').click()
  assert page.locator('.review-link').count()==1 and page.locator('iframe').count()==0
  assert not any(x in page.locator('.content').inner_text() for x in ['原始资料表','精炼审核表','从原始表提取任务','已读取的子表'])
  page.locator('[data-action=fs-show-table]').click();page.wait_for_selector('.review-table tbody tr')
  assert page.locator('.review-table tbody tr').count()==50
  page.locator('[data-action=table-next]').click();assert page.locator('.review-table tbody tr').count()==26
  page.locator('#review-table-search').fill('合成达人76');assert page.locator('.review-table tbody tr').count()==1 and '合成达人76' in page.locator('.review-table tbody').inner_text()
  page.locator('#review-table-search').fill('');page.locator('#fs-preview-sheet').select_option(label='视频合作 · 1 行');assert page.locator('.review-table tbody tr').count()==1
  page.locator('#fs-preview-sheet').select_option(label='图文合作 · 76 行')
  saved=page.evaluate('JSON.parse(localStorage.getItem("zhigao-settings-v1"))');assert saved['projects'][0]['feishu']['legacyLinks']['source']['url'].endswith('OldSource')
  passed('双链接安全迁移为单审核表；原生表格、搜索、子表、全部行分页可用，无嵌入网页')
  page.screenshot(path=str(OUT/'table-desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'table-mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.set_viewport_size({'width':1440,'height':1000})
  page.locator('.navbtn[data-page=rules]').click()
  longtext='完整资料正文。'*30000+'末尾唯一标记：材料没有截断。'
  page.locator('#lib-input').set_input_files([{'name':'产品资料.pptx','mimeType':'application/vnd.openxmlformats-officedocument.presentationml.presentation','buffer':PPT},{'name':'产品手册.pdf','mimeType':'application/pdf','buffer':pdf_bytes(2)},{'name':'大正文.txt','mimeType':'text/plain','buffer':longtext.encode()},{'name':'旧版演示.ppt','mimeType':'application/vnd.ms-powerpoint','buffer':b'synthetic legacy file'},{'name':'其他设计文件.psd','mimeType':'application/octet-stream','buffer':b'synthetic asset'}])
  page.wait_for_function('document.querySelectorAll(".asset-row").length===5',timeout=60000)
  assert page.locator('.asset-row').filter(has_text='旧版演示').locator('.tag').inner_text()=='需处理'
  stored=page.evaluate('JSON.parse(localStorage.getItem("zhigao-settings-v1")).projects[0].library');large=next(d for d in stored if d['title']=='大正文');assert len(large['text'])<=500 and large['ingestion']['textLength']==len(longtext)
  page.locator('.asset-row').filter(has_text='产品资料.pptx').locator('[data-action=lib-preview]').click();page.wait_for_selector('.library-image-list img');assert '备注要求' in page.locator('.modal').inner_text();page.screenshot(path=str(OUT/'ppt-preview.png'),full_page=True);page.locator('[data-action=close-modal]').first.click()
  page.locator('.asset-row').filter(has_text='产品手册').locator('[data-action=lib-preview]').click();page.wait_for_selector('#library-preview-image');page.locator('#library-preview-page').fill('2');page.locator('#library-preview-page').dispatch_event('change');page.wait_for_function('document.querySelector("#library-preview-image").alt==="PDF 第 2 页"');page.screenshot(path=str(OUT/'pdf-preview.png'),full_page=True);page.locator('[data-action=close-modal]').first.click()
  page.locator('.asset-row').filter(has_text='产品手册').locator('[data-action=lib-preview]').click();page.wait_for_selector('#library-preview-image')
  assert page.evaluate("document.querySelector('.modal-footer').getBoundingClientRect().bottom<=innerHeight")
  page.screenshot(path=str(OUT/'pdf-preview-controls.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844})
  assert page.evaluate("document.querySelector('.modal-footer').getBoundingClientRect().bottom<=innerHeight")
  page.screenshot(path=str(OUT/'pdf-preview-mobile.png'),full_page=True)
  page.set_viewport_size({'width':1440,'height':1000});page.locator('[data-action=close-modal]').first.click()
  with page.expect_download() as dl:page.locator('.asset-row').filter(has_text='产品资料.pptx').locator('[data-action=lib-download]').click()
  assert Path(dl.value.path()).read_bytes()==PPT
  passed('PPTX正文备注图片、PDF逐页预览、任意格式保留原件；超过20万字完整保存且原件下载字节一致')
  page.reload();page.wait_for_selector('[data-page=rules]');page.locator('.navbtn[data-page=rules]').click();assert page.locator('.asset-row').count()==5
  page.screenshot(path=str(OUT/'library-desktop.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'library-mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.set_viewport_size({'width':1440,'height':1000})
  passed('品牌资料刷新后保留；审核表与资料库桌面和390px手机无页面溢出')
  # Unsupported active sources must block completion; later disable them explicitly for the valid-source read checks.
  page.locator('.navbtn[data-page=home]').click()
  page.locator('#file-input').set_input_files({'name':'【测试达人】图文大纲.txt','mimeType':'text/plain','buffer':'星河杯容量300毫升。'.encode()});page.wait_for_selector('.wb-row');doc_id=page.locator('.wb-row').first.get_attribute('data-doc-id')
  page.evaluate("async()=>{(await import('/agent.js')).startAgent();}")
  client=MCP(connector,env,log,page)
  def raw(name,args=None):return client.call(name,args or {})
  def call(name,args=None):
   result=raw(name,args);assert not result.get('isError'),result
   value=json.loads(next(c['text'] for c in result['content'] if c['type']=='text'))
   if 'preparation' in value:
    state=value['preparation'];deadline=time.monotonic()+240
    while state['state'] in ['preparing','verifying','resuming'] and time.monotonic()<deadline:
     page.wait_for_timeout(500);state=call('zhigao_task_status',{'taskId':state['taskId']})
    assert state['state']=='continued',state
    return state['result'].get('originalResult',state['result'])
   return value
  page.wait_for_function("import('/agent.js').then(m=>m.agent.state==='online')",timeout=15000)
  assert call('zhigao_status')['connected']
  blocked=raw('zhigao_get_review_brief',{'docId':doc_id});assert not blocked.get('isError'),blocked
  blocked=json.loads(next(c['text'] for c in blocked['content'] if c['type']=='text'))
  assert blocked['preparation']['state']=='waiting_for_user' and not blocked.get('reviewToken'),blocked
  assert any(r.get('code')=='SOURCE_UNSUPPORTED' for r in blocked['preparation']['requirements'])
  # These deliberately invalid synthetic files were included to assert blocking.
  # Explicitly exclude them only after that assertion to test the valid sources.
  page.locator('.navbtn[data-page=rules]').click()
  for title in ['旧版演示','其他设计文件']:page.locator('.asset-row').filter(has_text=title).locator('[data-action=lib-toggle]').click()
  assert page.locator('.asset-row').count()==5
  passed('不支持的启用资料在准备阶段明确阻断，保留原件且不给完整审稿凭据')
  brief=call('zhigao_get_review_brief',{'docId':doc_id})
  def section(brief,name):
   cursor=None;out=[]
   while True:
    args={'docId':doc_id,'reviewToken':brief['reviewToken'],'section':name}
    if cursor:args['cursor']=cursor
    v=call('zhigao_read_review_context',args);out+=v['items'];cursor=v['nextCursor']
    if not cursor:return out
  assets=section(brief,'assets');assert len(assets)==3
  for a in assets:
   result=raw('zhigao_read_review_asset',{'docId':doc_id,'reviewToken':brief['reviewToken'],'assetId':a['id']});assert not result.get('isError'),result;assert any(c['type']=='image' for c in result['content'])
  source=page.evaluate("async()=>{const p=JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[0],db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});const load=id=>new Promise(r=>{const q=db.transaction('media').objectStore('media').get(id);q.onsuccess=()=>r(q.result?.file)});const m=await import('/library-assets.js');return (await m.hydrateLibraryProject(p,load)).library.find(d=>d.title==='大正文').text;}")
  assert source==longtext
  passed('真实 MCP 按品牌资料素材清单返回 PPT 内嵌图与全部 PDF 页面；完整正文还原不截断')
  page.locator('.navbtn[data-page=rules]').click()
  page.locator('.asset-row').filter(has_text='大正文').locator('[data-action=lib-toggle]').click()
  video=ROOT.parent/'_verify'/'assurance-20261110'/'fixtures'/'full-review-test.mp4'
  page.locator('#lib-input').set_input_files(str(video));page.wait_for_function('document.querySelectorAll(".asset-row").length===6')
  material=next(d for d in call('zhigao_get_project')['libraryEntries'] if d['ingestion'].get('format')=='video');library_id=material['id']
  runtime=call('zhigao_video_runtime_status');assert runtime['ready'],runtime
  prepared=call('zhigao_prepare_library_assets',{'libraryId':library_id});assert prepared['materials'][0]['state'] in ['uploading','processing','complete']
  deadline=time.monotonic()+180
  while time.monotonic()<deadline:
   status=call('zhigao_get_library_asset_status',{'libraryId':library_id})
   if status['state']=='complete':break
   assert status['state'] not in ['failed','interrupted'],status
   page.wait_for_timeout(1500)
  assert status['state']=='complete',status
  brief=call('zhigao_get_review_brief',{'docId':doc_id,'retry':True});assets=section(brief,'assets');va=[a for a in assets if a.get('libraryId')==library_id];assert va and any(a['type']=='prepared-video-frame' for a in va) and any(a['type']=='prepared-video-audio' for a in va)
  for kind in ['prepared-video-frame','prepared-video-audio']:
   a=next(a for a in va if a['type']==kind);result=raw('zhigao_read_review_asset',{'docId':doc_id,'reviewToken':brief['reviewToken'],'assetId':a['id']});assert not result.get('isError'),result;assert any(c['type']==('image' if kind.endswith('frame') else 'audio') for c in result['content']),result
  assert not section(brief,'media')[0]['blockers']
  passed('真实本机视频完整准备，经新增 MCP 工具读取品牌视频画面及原声音频，原件绑定正确')
  # Synthetic completed AI advice, used only to verify synchronization UI and the confirmation boundary.
  page.evaluate("""async id=>{const s=JSON.parse(localStorage.getItem('zhigao-settings-v1')),sheet=s.projects[0].feishu.sheets.find(s=>s.liveId==='sheetA'),db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});const read=(store,key)=>new Promise(r=>{const q=db.transaction(store).objectStore(store).get(key);q.onsuccess=()=>r(q.result)});const t=await read('tasks',id),it=await read('items',t.itemId),{rowKey}=await import('/feishu.js');Object.assign(it,{author:'测试达人',platform:'小红书',title:'星河杯',kind:'图文',feishu:{sheetId:sheet.id,key:rowKey(sheet,0)}});Object.assign(t,{stage:'大纲',ai:{changes:[],needsSupplement:false}});await new Promise((r,j)=>{const tx=db.transaction(['tasks','items'],'readwrite');tx.objectStore('tasks').put(t);tx.objectStore('items').put(it);tx.oncomplete=r;tx.onerror=()=>j(tx.error)});}""",doc_id)
  page.reload();page.wait_for_selector('.wb-row');page.locator('.navbtn[data-page=feishu]').click();page.locator('[data-action=fs-ai-sync]').click();page.wait_for_selector('[data-action=fs-write-confirm]')
  assert not writes and 'AI已审' in page.locator('.modal').inner_text()
  page.locator('[data-action=fs-write-confirm]').click();page.wait_for_function('document.querySelector(".table-notice") && document.querySelector(".content").textContent.includes("最近同步：成功")')
  assert any(w['value']=='AI已审 · 0处修改 · 待复核' for w in writes)
  page.screenshot(path=str(OUT/'table-sync.png'),full_page=True)
  passed('AI同步入口真实读取差异；页面确认前零写入，确认后写入正确单元格并回读更新原生表格（飞书API使用隔离夹具）')
  page.locator('[data-action=fs-remove-link]').click();page.locator('[data-action=fs-remove-confirm]').click();page.wait_for_function('!document.querySelector(".review-table")');page.reload();page.wait_for_selector('.navbtn[data-page=feishu]');page.locator('.navbtn[data-page=feishu]').click();assert page.locator('#fs-url-refined').input_value()==''
  passed('移除审核表解绑本地任务，刷新后旧双链接不会自动恢复')
  # Real browser file streams and handles in an isolated OPFS folder, without opening a user's folder picker.
  page.locator('.navbtn[data-page=rules]').click();page.evaluate('window.showDirectoryPicker=async()=>await navigator.storage.getDirectory()');page.locator('[data-action=folder-pick]').click();page.wait_for_function('document.querySelector(".folder-card").textContent.includes("已连接")')
  payload=b'stream-preserved-original'*1024
  page.locator('#lib-input').set_input_files({'name':'流式原件.bin','mimeType':'application/octet-stream','buffer':payload});page.wait_for_function('document.querySelectorAll(".asset-row").length===7')
  streamed=page.evaluate("""async()=>{const d=JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[0].library.find(x=>x.title==='流式原件'),db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)}),rec=await new Promise(r=>{const q=db.transaction('media').objectStore('media').get(d.ingestion.assetKey);q.onsuccess=()=>r(q.result)});return {handle:!!rec.file.fileHandle,blob:!!rec.file.originalFile,text:await (await rec.file.fileHandle.getFile()).text()}}""")
  assert streamed['handle'] and not streamed['blob'] and streamed['text']==payload.decode()
  with page.expect_download() as dl:page.locator('.asset-row').filter(has_text='流式原件.bin').locator('[data-action=lib-download]').click()
  assert Path(dl.value.path()).read_bytes()==payload
  passed('已授权目录使用真实浏览器文件流写原件，数据库仅存句柄；回读和下载字节一致（隔离OPFS模拟授权目录）')
  bundle_check=page.evaluate("""async()=>{const p=JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[0],db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)}),all=await new Promise(r=>{const q=db.transaction('media').objectStore('media').getAll();q.onsuccess=()=>r(q.result)}),{makeBundle,readBundle}=await import('/bundle.js'),blob=await makeBundle({projects:[p],items:[],docs:[],media:[],libraryAssets:all.filter(a=>p.library.some(d=>d.ingestion.assetKey===a.id))}),b=await readBundle(blob);return {count:b.libraryAssets.length,pending:b.projects[0].library.find(d=>d.ingestion.format==='video').ingestion.state,hasText:b.libraryAssets.some(a=>a.file.extractedText?.endsWith('末尾唯一标记：材料没有截断。'))}}""")
  assert bundle_check=={'count':7,'pending':'pending','hasText':True},bundle_check
  passed('交接包包含全部格式原件与完整正文；异机视频恢复为待准备，不能复用本机处理凭据')
  reparsed=page.evaluate("""async()=>{const {makeBundle,readBundle}=await import('/bundle.js'),{parseLibraryFile}=await import('/library-import.js'),file=new File(['交接后可重新解析的原文'],'交接原件.txt'),blob=await makeBundle({projects:[],items:[],docs:[],media:[],libraryAssets:[{id:'retry',file:{filename:file.name,fmt:'text',originalFile:file}}]}),restored=(await readBundle(blob)).libraryAssets[0].file.originalFile,parsed=await parseLibraryFile(restored);return {name:restored.name,text:parsed.text,format:parsed.ingestion.format,state:parsed.ingestion.state};}""")
  assert reparsed=={'name':'交接原件.txt','text':'交接后可重新解析的原文','format':'text','state':'ready'},reparsed
  passed('交接包还原原件文件名，重新解析可识别格式并保留全文')
  assert not errors,errors
  (OUT/'result.json').write_text(json.dumps({'checks':checks,'errors':errors,'videoStatus':status,'screenshots':[p.name for p in OUT.glob('*.png')]},ensure_ascii=False,indent=2),encoding='utf-8')
  context.close();browser.close()
finally:
 if client:client.close()
 process.terminate();process.wait(timeout=15);server.shutdown();log.close()
