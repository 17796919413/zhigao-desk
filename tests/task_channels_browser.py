"""Real Edge, stdio MCP, original Office conversion; synthetic Feishu identity only."""
from pathlib import Path
import functools,http.server,threading,json,os,time,subprocess,socket,urllib.request,shutil
from playwright.sync_api import sync_playwright
from mcp_client_fixture import MCP
from synthetic_fixtures import png_bytes

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('ZHIGAO_VERIFY_OUT',ROOT.parent/'_verify'/'task-channels-20261112'/'browser'));OUT.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def do_GET(self):
  # Bind literal endpoints and the agent's template-literal port to the isolated hub.
  file=Path(self.translate_path(self.path.split('?',1)[0]))
  if file.suffix in ['.js','.mjs'] and file.is_file():
   data=file.read_bytes().replace(b'http://127.0.0.1:47821',backend.encode()).replace(b'AGENT_PORT=47821',('AGENT_PORT='+str(port)).encode())
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
http.server.ThreadingHTTPServer.daemon_threads=True
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
backend=f'http://127.0.0.1:{port}';home=OUT/'isolated-home';home.mkdir(exist_ok=True)
connector=OUT/'zhigao-connector.mjs';connector.write_text((ROOT/'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()',json.dumps(str(home))),encoding='utf-8')
for name in ['media-runtime.mjs','media-worker.py']:shutil.copyfile(ROOT/name,OUT/name)
fake=OUT/'synthetic-lark.mjs';fake.write_text('''import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),ok=data=>console.log(JSON.stringify({ok:true,identity:'user',data}));
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(args.map((x,i)=>args[i-1]==='--device-code'?'REDACTED':x))+'\\n');
if(args[0]==='auth'&&args[1]==='status')console.log(JSON.stringify({identity:'user',verified:fs.existsSync(path.join(root,'authorized')),identities:{user:{status:'ready',tokenStatus:fs.existsSync(path.join(root,'authorized'))?'valid':'invalid'}}}));
else if(args[0]==='auth'&&args[1]==='qrcode'){fs.copyFileSync(path.join(root,'qr.png'),path.resolve(args[args.indexOf('--output')+1]));ok({});}
else if(args[0]==='auth'&&args[1]==='login'){if(args.includes('--device-code')){fs.writeFileSync(path.join(root,'authorized'),'synthetic');ok({});}else ok({device_code:'SYNTHETIC_PRIVATE_DEVICE_CODE',verification_url:'https://accounts.feishu.cn/synthetic-test-only',expires_in:600});}
else if(args.includes('+workbook-info'))ok({title:'合成执行表',token:'TestOnly',sheets:[{sheet_id:'S1',resource_type:'sheet',sheet_name:'【确认】生活执行list',title:'【确认】生活执行list',is_hidden:false}]});
else if(args.includes('+table-get'))ok({sheets:[{sheet_id:'S1',range:'A1:E2',columns:['达人','发布平台','合作产品','合作形式','内容负责人'],data:[['达人','发布平台','合作产品','合作形式','内容负责人'],['合成达人','小红书','星河杯','图文','小周']]}]});
else {console.error(JSON.stringify({ok:false,error:{message:'Unexpected synthetic command'}}));process.exit(2);}
''',encoding='utf-8')
(OUT/'qr.png').write_bytes(png_bytes())
if (OUT/'authorized').exists():(OUT/'authorized').unlink()
if (OUT/'calls.jsonl').exists():(OUT/'calls.jsonl').unlink()
source=OUT/'合成旧文件.txt';source.write_text('Synthetic brand capacity is 300 mL. Complete original retained.',encoding='utf-8')
office=shutil.which('soffice');assert office,'This real conversion test requires existing LibreOffice'
converted=OUT/'fixtures';converted.mkdir(exist_ok=True)
subprocess.run([office,'-env:UserInstallation='+ (OUT/'fixture-profile').as_uri(),'--headless','--convert-to','doc:MS Word 97','--outdir',str(converted),str(source)],check=True,timeout=60,capture_output=True)
legacy=converted/'合成旧文件.doc';assert legacy.read_bytes()[:8]==bytes.fromhex('d0cf11e0a1b11ae1')
csv=OUT/'合成表格.csv';csv.write_text('Product,Capacity\nSynthetic cup,300 mL\n',encoding='utf-8')
fodp=OUT/'合成演示.fodp';fodp.write_text('''<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation"><office:body><office:presentation><draw:page draw:name="Page1"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="8cm"><draw:text-box><text:p>Synthetic slide capacity 300 mL.</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document>''',encoding='utf-8')
for src,fmt in [(csv,'xls:MS Excel 97'),(fodp,'ppt:MS PowerPoint 97')]:
 subprocess.run([office,'-env:UserInstallation='+(OUT/'fixture-profile').as_uri(),'--headless','--convert-to',fmt,'--outdir',str(converted),str(src)],check=True,timeout=60,capture_output=True)
drafts=[legacy,converted/'合成表格.xls',converted/'合成演示.ppt']
assert all(p.read_bytes()[:8]==bytes.fromhex('d0cf11e0a1b11ae1') for p in drafts)
env={**os.environ,'ZHIGAO_PORT':str(port),'ZHIGAO_AUTO_UPDATE':'0','ZHIGAO_REGISTER_URI':'0','ZHIGAO_ORIGINS':origin,'ZHIGAO_LARK_CLI':str(fake),'ZHIGAO_MEDIA_HOME':os.environ.get('ZHIGAO_TEST_MEDIA_HOME',str(ROOT.parent/'_verify'/'assurance-20261110'/'fresh-runtime'))}
log=(OUT/'connector.log').open('w',encoding='utf-8');process=subprocess.Popen(['node',str(connector),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
checks=[];errors=[];client=None
def passed(label):checks.append(label);print('PASS '+label,flush=True)
try:
 for _ in range(100):
  try:
   with urllib.request.urlopen(backend+'/health',timeout=1) as r:
    if json.load(r).get('app')=='zhigao':break
  except Exception:time.sleep(.1)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000})
  page=context.new_page();page.on('requestfailed',lambda r:print('REQUESTFAILED '+r.url+' '+str(r.failure),flush=True));page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGEERROR '+str(e),flush=True)));page.goto(origin);page.wait_for_selector('#agent-chip')
  projects=[{'id':'A','name':'星河 · 隔离测试','status':'active','notes':'','rules':[],'library':[],'feishu':{'sheets':[],'source':None,'refined':{'url':'https://example.feishu.cn/sheets/TestOnly'}}},{'id':'B','name':'另一合成品牌','status':'active','notes':'','rules':[],'library':[]}]
  page.evaluate('(projects)=>localStorage.setItem("zhigao-settings-v1",JSON.stringify({selected:"A",projects}))',projects);page.reload();page.wait_for_timeout(1200);print('RELOAD '+page.locator('body').inner_text()[:600],flush=True);page.wait_for_selector('#agent-chip')
  page.evaluate("async()=>{(await import('/agent.js')).startAgent()}")
  client=MCP(connector,env,log,page)
  def call(name,args=None):
   try:value=client.call(name,args or {})
   except Exception:
    print('DIAGNOSTIC '+json.dumps(page.evaluate("async()=>{const m=await import('/agent.js');return {state:m.agent.state,log:m.agent.log,error:m.agent.error}}"),ensure_ascii=False),flush=True)
    raise
   assert not value.get('isError'),value
   return json.loads(next(x['text'] for x in value['content'] if x['type']=='text'))
  def resumed(task_id):
   call('zhigao_resume_task',{'taskId':task_id})
   for _ in range(240):
    state=call('zhigao_task_status',{'taskId':task_id})
    if state['state'] not in ['preparing','verifying','resuming']:return state
    page.wait_for_timeout(500)
   raise TimeoutError('Task continuation deadline')
  page.wait_for_function("import('/agent.js').then(m=>m.agent.state==='online')",timeout=15000)
  print('CONNECTED '+str(bool(client.page)),flush=True)
  assert call('zhigao_status')['connected']
  toolnames=[x['name'] for x in client.rpc('tools/list',{})['tools']]
  assert all('zhigao_'+x in toolnames for x in ['plan_task','confirm_task','task_status','resume_task','cancel_task'])
  passed('真实 stdio MCP 公布共享任务工具；单文件连接器可直接加载内置模块')
  page.locator('.navbtn[data-page=rules]').click();page.locator('#lib-input').set_input_files(str(legacy));page.wait_for_selector('.asset-row')
  library=page.evaluate('JSON.parse(localStorage.getItem("zhigao-settings-v1")).projects[0].library');lid=library[0]['id']
  automatic=call('zhigao_prepare_library_assets',{'libraryId':lid});assert automatic['preparation']['state'] in ['preparing','verifying','resuming'],automatic
  def waited(task_id,seconds=240):
   deadline=time.monotonic()+seconds
   while time.monotonic()<deadline:
    value=call('zhigao_task_status',{'taskId':task_id})
    if value['state'] not in ['preparing','verifying','resuming']:return value
    page.wait_for_timeout(500)
   raise TimeoutError('Automatic task preparation deadline')
  result=waited(automatic['preparation']['taskId']);assert result['state']=='continued',result
  assert page.locator('[data-action=lib-channel]').count()==0
  stored=page.evaluate('JSON.parse(localStorage.getItem("zhigao-settings-v1")).projects[0].library[0]')
  assert stored['ingestion']['state']=='ready' and stored['ingestion']['conversion']['format']=='docx',stored
  assert '300 mL' in stored['text']
  with page.expect_download() as download:page.locator('[data-action=lib-download]').click()
  assert Path(download.value.path()).read_bytes()==legacy.read_bytes()
  passed('真实旧版 DOC 转 DOCX，重新解析并回接原品牌；原件下载字节完全保留')
  page.locator('[data-action=lib-preview]').click();page.wait_for_selector('.modal');page.screenshot(path=str(OUT/'converted-preview.png'),full_page=True);page.locator('[data-action=close-modal]').first.click()
  packaged=page.evaluate('''async()=>{const p=JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[0],db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)}),all=await new Promise(r=>{const q=db.transaction('media').objectStore('media').getAll();q.onsuccess=()=>r(q.result)}),{makeBundle,readBundle}=await import('/bundle.js'),{materializeLibraryFile}=await import('/library-assets.js'),blob=await makeBundle({projects:[p],items:[],docs:[],media:[],libraryAssets:all}),restored=(await readBundle(blob)).libraryAssets[0].file,m=await materializeLibraryFile(restored);return {format:m.fmt,bytes:m.buffer.byteLength,original:restored.originalFile.size,job:restored.conversion.jobId}}''')
  assert packaged['format']=='docx' and packaged['bytes']>32 and packaged['original']==legacy.stat().st_size and not packaged.get('job')
  passed('交接包独立保存转换副本并校验双摘要，不传递本机转换凭据')
  fsauto=call('zhigao_extract_feishu');fsplan=fsauto['preparation'];assert fsplan['state']=='awaiting_confirmation',fsauto
  assert not (OUT/'authorized').exists()
  call('zhigao_confirm_task',{'taskId':fsplan['taskId'],'revision':fsplan['revision'],'decision':'approve'})
  for _ in range(80):
   status=call('zhigao_task_status',{'taskId':fsplan['taskId']})
   if status['state']=='waiting_for_user':break
   assert status['state'] not in ['failed','uncertain'],status
   page.wait_for_timeout(100)
  assert status['userAction']['kind']=='feishu-login',status
  assert 'SYNTHETIC_PRIVATE_DEVICE_CODE' not in json.dumps(status) and not (OUT/'authorized').exists()
  done=resumed(fsplan['taskId']);assert done['state']=='continued',done
  calls=[json.loads(x) for x in (OUT/'calls.jsonl').read_text().splitlines()]
  assert any('+workbook-info' in x for x in calls) and any('+table-get' in x for x in calls)
  assert not any(any(word in x for word in ['+cells-set','+workbook-create']) for x in calls)
  passed('飞书隔离认证：确认后给出二维码，显式续接完成设备码授权，实际回读目标表并续办提炼；无云端写入')
  (OUT/'authorized').unlink()
  page.locator('.navbtn[data-page=feishu]').click();page.locator('[data-action=fs-live-read-all]').click()
  page.wait_for_selector('[data-action=task-approve]');page.locator('[data-action=task-approve]').click()
  page.wait_for_selector('#task-preparation-panel a');page.locator('[data-action=task-resume]').click()
  page.wait_for_function("document.querySelector('#task-preparation-panel .connect-intro')?.textContent==='已继续'",timeout=60000)
  assert page.evaluate('JSON.parse(localStorage.getItem("zhigao-settings-v1")).projects[0].feishu.sheets.length')>0
  page.locator('[data-action=close-modal]').first.click()
  passed('原有网页读表按钮发现缺授权并接回同一表；只保存本地读取结果，不创建云端文档')
  denied=call('zhigao_plan_task',{'operation':'archive','projectId':'A'});assert denied['state']=='waiting_for_user' and denied['requirements'][0]['id']=='archive'
  passed('目录权限单独识别为用户手势，不能用安装或一句配置确认替代')
  page.locator('.navbtn[data-page=home]').click();page.locator('#file-input').set_input_files({'name':'合成待审大纲.txt','mimeType':'text/plain','buffer':b'Synthetic draft capacity 300 mL.'});page.wait_for_selector('.wb-row');doc=page.locator('.wb-row').first.get_attribute('data-doc-id')
  no_visual=call('zhigao_plan_task',{'operation':'review','projectId':'A','docId':doc});assert no_visual['state']=='waiting_for_user',no_visual
  assert any(r['code']=='CLIENT_CAPABILITY' for r in no_visual['requirements'] if 'code' in r)
  ready=call('zhigao_plan_task',{'operation':'review','projectId':'A','docId':doc,'clientCapabilities':{'images':True,'audio':True}});assert ready['state']=='ready',ready
  continued=resumed(ready['taskId']);assert continued['next']['tool']=='zhigao_get_review_brief',continued
  brief=call('zhigao_get_review_brief',{'docId':doc});assert brief['reviewToken']
  passed('客户端看图能力未声明时不冒称可审；已声明后续接原稿并取得真实审稿凭据')
  def gate_refresh(phase):
   # Hold a real response at an exact boundary; resuming alone spans both phases.
   page.evaluate('''phase=>{const original=window.fetch;window.__refreshGate=null;
    window.fetch=async(input,options)=>{const url=String(input),body=options?.body?JSON.parse(options.body):{};
     if(phase==='original'&&url.endsWith('/page/result')&&body.result?.reviewToken){
      window.__refreshGate={phase,docId:body.result.docId};return new Promise(()=>{});
     }
     const response=await original(input,options);
     if(phase==='preparation'&&url.endsWith('/page/office')&&body.action==='begin'){
      const result=await response.clone().json();window.__refreshGate={phase,jobId:result.data.jobId};return new Promise(()=>{});
     }
     return response;
    };
   }''',phase)
  def refresh_at_gate(task_id,phase):
   page.wait_for_function('window.__refreshGate!==null',timeout=180000)
   saved=json.loads((home/'.zhigao'/'task-runtime'/'tasks'/(task_id+'.json')).read_text(encoding='utf-8'))
   assert saved['state']=='resuming' and saved['resumeCheckpoint']==phase,saved
   gate=page.evaluate('window.__refreshGate')
   page.reload();page.wait_for_selector('#agent-chip');page.evaluate("async()=>{(await import('/agent.js')).startAgent()}")
   page.wait_for_function("import('/agent.js').then(m=>['online','waiting'].includes(m.agent.state))")
   return gate
  for sourcefile in drafts:
   page.locator('.navbtn[data-page=home]').click();page.locator('#file-input').set_input_files(str(sourcefile))
   row=page.locator('.wb-row').filter(has=page.locator('h3',has_text=sourcefile.name));row.wait_for();did=row.get_attribute('data-doc-id')
   assert row.locator('[data-action=draft-channel],[data-action=draft-original],[data-action=draft-converted]').count()==0
   batch=call('zhigao_create_review_batch',{'docIds':[did]});assert batch['entries'][0]['status']=='queued',batch
   if sourcefile.suffix=='.doc':gate_refresh('preparation')
   automatic=call('zhigao_get_review_brief',{'docId':did,'batchId':batch['id']});assert 'preparation' in automatic,automatic
   if sourcefile.suffix=='.doc':
    prep_gate=refresh_at_gate(automatic['preparation']['taskId'],'preparation')
   done=waited(automatic['preparation']['taskId']);assert done['state']=='continued',done
   assert done['result']['originalResult']['reviewToken']
   assert done['result']['originalResult']['batchId']==batch['id']
   page.reload();page.wait_for_selector('#agent-chip');page.evaluate("async()=>{(await import('/agent.js')).startAgent()}")
   page.wait_for_function("import('/agent.js').then(m=>m.agent.state==='online')")
   row=page.locator('.wb-row[data-doc-id="'+did+'"]');row.wait_for()
   assert row.locator('h3').inner_text()==sourcefile.name
   assert row.locator('[data-action=draft-original],[data-action=draft-converted]').count()==0
   restored=page.evaluate('''async(id)=>{const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)}),d=await new Promise(r=>{const q=db.transaction('tasks').objectStore('tasks').get(id);q.onsuccess=()=>r(q.result)}),p=JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[0],{makeBundle,readBundle}=await import('/bundle.js');p.library=[];const b=await makeBundle({projects:[p],items:[],docs:[d],media:[]}),restored=(await readBundle(b)).docs[0];return {fmt:restored.fmt,source:restored.officeOriginal.buffer.byteLength,converted:restored.buffer.byteLength,job:restored.officeConversion.jobId,blockers:restored.officeConversion.blockers};}''',did)
   assert restored['source']==sourcefile.stat().st_size and restored['converted']>32 and not restored.get('job')
   if sourcefile.suffix=='.doc':
    assert done['result']['originalResult']['docId']==did
    conversion_job=page.evaluate('''async id=>{const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const q=db.transaction('tasks').objectStore('tasks').get(id);q.onsuccess=()=>r(q.result.officeConversion.jobId)})}''',did)
    assert conversion_job==prep_gate['jobId']
    passed('准备阶段精确刷新：同一任务复用同一转换作业，返回原批次的真实审稿凭据')
   passed('真实 '+sourcefile.suffix.upper()+' 正常审稿调用自动处理格式并返回审稿凭据；刷新保留原文件名，无转换按钮，后台交接校验通过')
  page.locator('#file-input').set_input_files({'name':'合成结果未回传.doc','mimeType':'application/msword','buffer':legacy.read_bytes()})
  row=page.locator('.wb-row').filter(has=page.locator('h3',has_text='合成结果未回传.doc'));row.wait_for();unknown_doc=row.get_attribute('data-doc-id')
  gate_refresh('original')
  automatic=call('zhigao_get_review_brief',{'docId':unknown_doc});unknown_task=automatic['preparation']['taskId']
  refresh_at_gate(unknown_task,'original')
  uncertain=waited(unknown_task);assert uncertain['state']=='uncertain' and uncertain['error']['code']=='PAGE_SESSION_CHANGED',uncertain
  retried=call('zhigao_get_review_brief',{'docId':unknown_doc});assert retried['preparation']['taskId']==unknown_task and retried['preparation']['state']=='uncertain',retried
  recovered=call('zhigao_recover_task',{'taskId':unknown_task});assert recovered['recovery']['safe'] is False and recovered['recovery']['requiresUserReview'],recovered
  assert call('zhigao_resume_task',{'taskId':unknown_task})['state']=='uncertain'
  assert call('zhigao_cancel_task',{'taskId':unknown_task})['state']=='uncertain'
  assert call('zhigao_get_review_brief',{'docId':unknown_doc})['preparation']['taskId']==unknown_task
  passed('原调用已生成凭据但结果未回传时刷新：保持结果不明；原入口重试、recover与resume均不能盲目重复执行')
  page.screenshot(path=str(OUT/'drafts-desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'drafts-mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  if os.environ.get('ZHIGAO_TEST_MEDIA_HOME'):
   page.set_viewport_size({'width':1440,'height':1000})
   video=ROOT.parent/'_verify'/'assurance-20261110'/'fixtures'/'full-review-test.mp4'
   initial=call('zhigao_video_runtime_status');expect_missing=os.environ.get('ZHIGAO_TEST_MEDIA_MODE','missing')=='missing'
   assert initial['ready'] is not expect_missing,initial
   (OUT/'media-before.json').write_text(json.dumps(initial,ensure_ascii=False,indent=2),encoding='utf-8')
   page.locator('#file-input').set_input_files(str(video));row=page.locator('.wb-row').filter(has=page.locator('h3',has_text=video.name));row.wait_for();vid=row.get_attribute('data-doc-id')
   automatic=call('zhigao_get_review_brief',{'docId':vid});plan=automatic['preparation']
   if expect_missing:
    assert plan['state']=='awaiting_confirmation',automatic
    call('zhigao_confirm_task',{'taskId':plan['taskId'],'revision':plan['revision'],'decision':'approve'})
   else:assert plan['state'] in ['preparing','verifying','resuming'],automatic
   deadline=time.monotonic()+900
   while time.monotonic()<deadline:
    state=call('zhigao_task_status',{'taskId':plan['taskId']})
    assert state['state'] not in ['failed','uncertain','waiting_for_user'],state
    if state['state']=='continued':break
    page.wait_for_timeout(1500)
   assert state['state']=='continued',state
   assert state['result']['originalResult']['reviewToken']
   deadline=time.monotonic()+300
   while time.monotonic()<deadline:
    video_state=call('zhigao_get_video_review_status',{'docId':vid})
    if video_state['state']=='complete':break
    assert video_state['state']!='failed',video_state
    page.wait_for_timeout(1000)
   assert video_state['state']=='complete',video_state
   final=call('zhigao_video_runtime_status');assert final['ready'] and final['privateRuntime']
   (OUT/'media-after.json').write_text(json.dumps({'runtime':final,'video':video_state,'semanticReview':'pending-agent-review'},ensure_ascii=False,indent=2),encoding='utf-8')
   passed(('真实缺媒体依赖的私有环境：检测缺项、确认、安装、回读' if expect_missing else '已准备好的私有环境：正常入口自动复用')+'、续办并完成合成视频处理；复用已有模型')
  assert not errors,errors
  (OUT/'result.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'screenshots':[p.name for p in OUT.glob('*.png')],'limits':['Feishu uses isolated CLI fixture; no real account login','Office reuses installed LibreOffice; fresh private install tested separately']},ensure_ascii=False,indent=2),encoding='utf-8')
  context.close();browser.close()
finally:
 if client:client.close()
 process.terminate();process.wait(timeout=15);server.shutdown();log.close()
