"""Isolated native MCP heartbeat, resume and 100-page PDF benchmark."""
from pathlib import Path
import functools,http.server,threading,subprocess,os,socket,time,json,urllib.request
from playwright.sync_api import sync_playwright
from mcp_client_fixture import MCP

http.server.ThreadingHTTPServer.request_queue_size=128
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('ZHIGAO_VERIFY_OUT',str(ROOT.parent/'_verify'/'workbuddy-performance-20261112')))
OUT.mkdir(parents=True,exist_ok=True)
from synthetic_fixtures import pdf_bytes
PDF=pdf_bytes(100)
BASELINE='fb0c5b2b1748bf957b6bd7bf364c5444d56060d4'  # Verified 1.11.0, stable after a new release commit.
baseline={}
for name in ['review-service.js','review-context.js','review-assurance.js','media-review.js','pdf.js']:
 baseline[name]=subprocess.check_output(['git','show',BASELINE+':'+name],cwd=ROOT)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  key=self.path.split('?',1)[0]
  if key=='/__fixture/hundred-pages.pdf':data=PDF;kind='application/pdf'
  elif key.startswith('/baseline/'):
   name=key.removeprefix('/baseline/');target=(ROOT/name).resolve()
   if ROOT not in target.parents or not target.is_file():self.send_error(404);return
   data=baseline.get(name,target.read_bytes());kind='text/javascript' if target.suffix in ['.js','.mjs'] else self.guess_type(name)
  else:return super().do_GET()
  self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
backend=f'http://127.0.0.1:{port}'
home=OUT/'isolated-home';home.mkdir(exist_ok=True)
connector=OUT/'test-connector.mjs';connector.write_text((ROOT/'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()',json.dumps(str(home))),encoding='utf-8')
env={**os.environ,'ZHIGAO_PORT':str(port),'ZHIGAO_AUTO_UPDATE':'0','ZHIGAO_ORIGINS':origin,'ZHIGAO_REGISTER_URI':'0','ZHIGAO_DEBUG':'1'}
log=(OUT/'connector.log').open('w',encoding='utf-8');client=None;checks=[];errors=[]
process=subprocess.Popen(['node',str(connector),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
def passed(name):checks.append(name);print('PASS '+name,flush=True)
try:
 for _ in range(100):
  try:
   with urllib.request.urlopen(backend+'/health',timeout=1) as r:
    if json.load(r).get('app')=='zhigao':break
  except Exception:time.sleep(.1)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000})
  context.route('http://127.0.0.1:47821/**',lambda route:route.continue_(url=backend+route.request.url.split('47821',1)[1]))
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_selector('#agent-chip')
  client=MCP(connector,env,log,page)
  def call(name,args=None):
   result=client.call(name,args or {});assert not result.get('isError'),result
   return json.loads(next(c['text'] for c in result['content'] if c['type']=='text'))
  assert call('zhigao_status')['connected'];passed('isolated native MCP connects')
  page.evaluate('''()=>{const original=window.fetch;let delay=true;window.fetch=async function(url,opts){if(delay&&String(url).endsWith('/page/result')){delay=false;await new Promise(r=>setTimeout(r,45000));}return original.call(this,url,opts);};setTimeout(async()=>{window.__busyHealth=await(await original('http://127.0.0.1:47821/health')).json();},43000);}''')
  started=time.monotonic();assert call('zhigao_status')['connected'];health=page.evaluate('window.__busyHealth');assert health['page'] is True and health['active'],health
  passed('45-second tool wait keeps page alive beyond old 40-second cutoff')
  heartbeat_seconds=round(time.monotonic()-started,2)
  # Seed a synthetic persisted PDF and manuscript, never the real profile.
  page.evaluate('''async()=>{const parsed=await(await import('/library-import.js')).parseLibraryFile(new File([await(await fetch('/__fixture/hundred-pages.pdf')).arrayBuffer()],'test.pdf',{type:'application/pdf'}));const {originalAsset,...d}=parsed;d.id='pdf';d.ingestion.assetKey='pdf-original';const p={id:'test',name:'隔离性能测试',status:'active',notes:'',rules:[],library:[d]};localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:p.id,projects:[p]}));const t={id:'draft',itemId:'item',projectId:p.id,projectName:p.name,filename:'合成稿.txt',author:'合成作者',kind:'图文',platform:'其他',stage:'初稿',fmt:'text',cells:[{id:'p',current:'Synthetic manuscript.',original:'Synthetic manuscript.'}],flow:{state:'review',round:1,feedback:[]},created:new Date().toISOString(),updated:new Date().toISOString(),rules:[],findings:[]};const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});await new Promise((resolve,reject)=>{const tx=db.transaction(['tasks','items','media'],'readwrite');tx.objectStore('tasks').put(t);tx.objectStore('items').put({id:'item',projectId:p.id,author:t.author,kind:t.kind,platform:t.platform,title:'合成稿',created:t.created,updated:t.updated,publish:{status:'待排期'}});tx.objectStore('media').put({id:'pdf-original',file:originalAsset});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();}''')
  page.reload();page.wait_for_selector('.wb-row');page.wait_for_function("document.querySelector('#agent-chip')?.textContent?.includes('已连接')",timeout=50000);brief=call('zhigao_get_review_brief',{'docId':'draft'});args={'docId':'draft','reviewToken':brief['reviewToken']}
  assets=call('zhigao_read_review_context',{**args,'section':'assets'})['items'];ids=[a['id'] for a in assets[:4]]
  native=client.call('zhigao_read_review_assets',{**args,'assetIds':ids});assert not native.get('isError'),native
  assert len([c for c in native['content'] if c['type']=='image'])==4
  receipt_rows=[json.loads(c['text']) for c in native['content'] if c['type']=='text'][1:];assert {x['assetId'] for x in receipt_rows}==set(ids)
  passed('batch MCP carries four native images and correctly paired receipts')
  page.reload();page.wait_for_selector('.wb-row');page.wait_for_function("document.querySelector('#agent-chip')?.textContent?.includes('已连接')",timeout=50000);fresh=call('zhigao_get_review_brief',{'docId':'draft','retry':True});assert fresh['resume']['restored'] and fresh['resume']['readAssets']==4
  assert fresh['context']['assets']['read']==len(assets);passed('real browser reload resumes persisted read progress and receipts')
  page.screenshot(path=str(OUT/'desktop.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2');page.set_viewport_size({'width':1440,'height':1000})
  baseline_result=page.evaluate("async()=>await(await import('/tests/review_performance_browser.mjs')).benchmark('/baseline')");page.locator('#pdf-preview').screenshot(path=str(OUT/'baseline-page.png'));page.evaluate("document.querySelector('#pdf-preview').remove()")
  print('BASELINE '+json.dumps(baseline_result),flush=True)
  improved=page.evaluate("async()=>await(await import('/tests/review_performance_browser.mjs')).benchmark('')");page.locator('#pdf-preview').screenshot(path=str(OUT/'optimized-page.png'))
  assert improved['calls']==25 and baseline_result['calls']==100
  assert improved['cache']['opens']==1 and improved['cache']['renders']==100
  passed('100-page full-image benchmark: 25 batches, one PDF open, all pages rendered')
  print('OPTIMIZED '+json.dumps(improved),flush=True)
  assert not errors,errors
  result={'checks':checks,'count':len(checks),'pageErrors':errors,'heartbeatWaitSeconds':heartbeat_seconds,'baseline':baseline_result,'optimized':improved,'timeRatio':round(baseline_result['elapsedMs']/max(improved['elapsedMs'],1),2),'boundary':'Synthetic text PDF, same browser. Excludes model reasoning/network latency and does not predict real brand PDF throughput.'}
  (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');client.close();client=None;browser.close()
finally:
 if client:client.close()
 process.terminate();process.wait(timeout=10);server.shutdown();log.close()
