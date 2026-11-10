from pathlib import Path
import functools,http.server,threading,subprocess,os,socket,time,json,sys,urllib.request
from playwright.sync_api import sync_playwright
from mcp_client_fixture import MCP
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parents[1];PRIOR=ROOT.parent/'_verify'/'assurance-20261110';OUT=Path(os.environ.get('ZHIGAO_VERIFY_OUT',str(PRIOR)));FIX=PRIOR/'fixtures';OUT.mkdir(exist_ok=True,parents=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.startswith('/__fixture/'):
   name=self.path.split('/')[-1]
   if name not in ['normal.png','single-frame.png','tail.png','full-review-test.mp4','two-pages.pdf']:self.send_error(404);return
   data=(FIX/name).read_bytes();self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();backend=f'http://127.0.0.1:{port}'
env={**os.environ,'ZHIGAO_AUTO_UPDATE':'0','ZHIGAO_PORT':str(port),'ZHIGAO_ORIGINS':origin,'ZHIGAO_MEDIA_HOME':str(PRIOR/'fresh-runtime')}
log=(OUT/'media-backend.log').open('w',encoding='utf-8');process=subprocess.Popen(['node',str(ROOT/'zhigao-connector.mjs'),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
try:
 for _ in range(100):
  try:
   with urllib.request.urlopen(backend+'/health',timeout=1) as r:
    if json.load(r).get('app')=='zhigao':break
  except Exception:time.sleep(.1)
 with sync_playwright() as pw:
  reuse=os.environ.get('ZHIGAO_REUSE_PREPARED')=='1'
  saved=json.loads((OUT/'fixture-state.json').read_text(encoding='utf-8')) if reuse else None
  if saved:
   for item in saved['origins']: item['origin']=origin
  browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000},storage_state=saved);context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
  page=context.new_page();errors=[];page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGE_ERROR: '+str(e),flush=True)));page.route('http://127.0.0.1:47821/**',lambda route:route.continue_(url=backend+route.request.url.split('47821',1)[1]))
  page.goto(origin);page.wait_for_selector('#app .sidebar')
  result=json.loads((OUT/'browser-functional-result.json').read_text(encoding='utf-8')) if reuse else page.evaluate("async()=>await (await import('/tests/review_media_browser.mjs')).run()")
  print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
  (OUT/'browser-functional-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
  if not reuse:
   page.evaluate("""async()=>{const f=window.__reviewFixture;localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:f.projects[0].id,projects:f.projects}));const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('zhigao-desk',6);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction(['tasks','items','media'],'readwrite');for(const t of f.tasks){tx.objectStore('tasks').put(t);if(t.fmt==='video')tx.objectStore('media').put({id:t.id,blob:t.originalFile});}for(const i of f.items)tx.objectStore('items').put(i);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();}""")
  if not reuse: context.storage_state(path=str(OUT/'fixture-state.json'),indexed_db=True)
  page.reload();page.wait_for_selector('.wb-row');page.locator('[data-action=wb-detail]').first.click();page.screenshot(path=str(OUT/'desktop-review.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'mobile-review.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'),'Mobile horizontal overflow'
  page.set_viewport_size({'width':1440,'height':1000});page.locator('.navbtn[data-page=rules]').click();page.locator('#lib-input').set_input_files({'name':'品牌图片资料.png','mimeType':'image/png','buffer':(FIX/'normal.png').read_bytes()});page.locator('.lib-row h3').filter(has_text='品牌图片资料').wait_for(timeout=30000);page.screenshot(path=str(OUT/'brand-reference.png'),full_page=True)
  assert all(text not in page.locator('body').inner_text() for text in ['原件素材','必须读取所附原件','不能凭此占位文字','资料保存在本机浏览器。多人协作'])
  stored=page.evaluate("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[0].library.find(x=>x.title==='品牌图片资料')");assert stored['ingestion']['assetKey'];result['uiChecks']=['desktop render','mobile no overflow','image brand source persisted with original']
  client=MCP(ROOT/'zhigao-connector.mjs',env,log,page)
  try:
   tools=client.rpc('tools/list',{})['tools'];names=[t['name'] for t in tools];assert all(n in names for n in ['zhigao_video_runtime_status','zhigao_setup_video_runtime','zhigao_prepare_video_review','zhigao_get_video_review_status','zhigao_read_review_asset'])
   ready=json.loads(client.call('zhigao_video_runtime_status')['content'][0]['text']);assert ready['ready']
   installed=json.loads(client.call('zhigao_setup_video_runtime')['content'][0]['text']);assert installed['state']=='ready'
   page.evaluate("()=>{import('/agent.js').then(m=>m.startAgent());return true;}")
   connected=json.loads(client.call('zhigao_status')['content'][0]['text']);assert connected.get('currentProject')=='隔离测试品牌 A',connected
   tasks=json.loads(client.call('zhigao_list_tasks')['content'][0]['text']);video=next(d for t in tasks for d in t['documents'] if d['format']=='video')
   brief=json.loads(client.call('zhigao_get_review_brief',{'docId':video['docId'],'rereview':True})['content'][0]['text']);assert brief.get('media'),brief
   audio=next(a for a in brief['media']['assets'] if a['type']=='prepared-video-audio');audio_response=client.call('zhigao_read_review_asset',{'docId':video['docId'],'reviewToken':brief['reviewToken'],'assetId':audio['id']});assert audio_response['content'][1]['type']=='audio'
   first=brief['media']['assets'][0];image=client.call('zhigao_read_review_asset',{'docId':video['docId'],'reviewToken':brief['reviewToken'],'assetId':first['id']});assert image['content'][1]['type']=='image'
   partial=json.loads(client.call('zhigao_submit_review',{'docId':video['docId'],'reviewToken':brief['reviewToken'],'dryRun':True,'result':{'snapshot':brief['snapshot'],'basis':brief['basis'],'reviewedIds':[b['id'] for b in brief['blocks']]}})['content'][0]['text']);assert partial['needsSupplement']
   denied=client.call('zhigao_get_project',{'project':'另一个品牌'});assert denied['isError']
   result['mcpChecks']=['native MCP tools registered','runtime doctor ready','setup reuses existing runtime','actual page connected','video brief through MCP','native image content through MCP','native audio content through MCP','incomplete native submission blocked','cross-brand project read blocked']
  finally:client.close()
  page.locator('.navbtn[data-page=home]').click()
  detail_button=page.locator(f'.wb-row[data-doc-id="{video["docId"]}"] [data-action=wb-detail]')
  if detail_button.get_attribute("aria-expanded")!="true":detail_button.click()
  page.screenshot(path=str(OUT/'video-review.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2')
  page.screenshot(path=str(OUT/'video-review-mobile.png'),full_page=True)
  report_html=page.evaluate("""async id=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('zhigao-desk',6);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const t=await new Promise((resolve,reject)=>{const r=db.transaction('tasks','readonly').objectStore('tasks').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();const p=JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects.find(p=>p.id===t.projectId);return (await import('/review-summary.js')).reviewReportHtml(t,p);}""",video['docId'])
  assert '原文件未修改' in report_html and '未发现问题' not in report_html
  (OUT/'readonly-review-report.html').write_text(report_html,encoding='utf-8')
  report_page=context.new_page();report_page.set_viewport_size({'width':1100,'height':1000});report_page.set_content(report_html);report_page.screenshot(path=str(OUT/'readonly-review-report.png'),full_page=True);report_page.close()
  result['uiChecks']+=['existing video detail remains concise','video details mobile no overflow','read-only report preserves warnings and completion boundary']
  assert page.locator('.review-coverage').count()==0
  assert all(text not in page.locator('body').inner_text() for text in ['覆盖已核对','查看逐项证据','本次资料版本','视频准备：'])
  result['uiChecks']+=['no new audit panels or defensive workflow copy']
  assert 'undefined' not in page.locator('body').inner_text()
  assert '逐帧解码位置' not in page.locator('body').inner_text()
  result['reusedPreparedFixture']=reuse
  result['pageErrors']=errors;assert not errors,errors
  (OUT/'browser-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
finally:
 process.terminate();process.wait(timeout=15);log.close();server.shutdown()
