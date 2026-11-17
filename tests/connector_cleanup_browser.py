"""Real Edge + stdio MCP + LibreOffice; only isolated synthetic files and caches."""
from pathlib import Path
import os,json,functools,http.server,threading,subprocess,socket,shutil,time,traceback,platform,uuid
from playwright.sync_api import sync_playwright
from mcp_client_fixture import MCP

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
backend=f'http://127.0.0.1:{port}'
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def do_GET(self):
  file=Path(self.translate_path(self.path.split('?',1)[0]))
  if file.suffix in ['.js','.mjs'] and file.is_file():
   data=file.read_text(encoding='utf-8').replace('http://127.0.0.1:47821',backend).replace('AGENT_PORT=47821','AGENT_PORT='+str(port))
   if file.name=='app.js':data+='\nwindow.probe={state:()=>({settings,tasks}),db:()=>db,dbOp,project,update:commitAgentProject,cleanup:flushLibraryCleanup,remote:flushConnectorCleanup,render};'
   if file.name=='agent.js':data+='\nwindow.agentProbe=tools;'
   data=data.encode();self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
http.server.ThreadingHTTPServer.daemon_threads=True
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
home=OUT/'isolated-home';home.mkdir()
connector=OUT/'zhigao-connector.mjs';connector.write_text((ROOT/'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()',json.dumps(str(home))),encoding='utf-8')
for name in ['media-runtime.mjs','media-worker.py','cache-cleanup.mjs']:shutil.copyfile(ROOT/name,OUT/name)
office=shutil.which('soffice');assert office,'Existing LibreOffice required; do not install'
for n in [1,2]:
 folder=OUT/f'fixture-{n}';folder.mkdir();text=folder/'合成产品资料.txt';text.write_text(f'Synthetic product version {n}: capacity {n*300} mL.',encoding='utf-8')
 subprocess.run([office,'-env:UserInstallation='+(OUT/'office-profile').as_uri(),'--headless','--convert-to','doc:MS Word 97','--outdir',str(folder),str(text)],check=True,timeout=60,capture_output=True)
env={**os.environ,'ZHIGAO_PORT':str(port),'ZHIGAO_ORIGINS':origin,'ZHIGAO_AUTO_UPDATE':'0','ZHIGAO_REGISTER_URI':'0','ZHIGAO_MEDIA_HOME':str(OUT/'isolated-media')}
log=(OUT/'connector.log').open('w',encoding='utf-8');process=subprocess.Popen(['node',str(connector),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
checks=[];errors=[];client=None;environment={'system':platform.platform(),'python':platform.python_version(),'mode':'real Edge/stdio MCP/LibreOffice; synthetic files; no real Feishu or user cache'}
def passed(name):checks.append(name);print('PASS '+name,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);environment['browser']=browser.version
  context=browser.new_context(viewport={'width':1440,'height':1000})
  context.add_init_script("""if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'p',projects:[{id:'p',name:'缓存清理 · 合成验收',status:'active',selectedActivity:'a',activities:[{id:'a',name:'秋季'},{id:'b',name:'冬季'}],rules:[],library:[]}]}));localStorage.setItem('seed','1');}""")
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe&&!!probe.db()')
  page.evaluate("async()=>{const m=await import('/agent.js');window.connection=m.agent;m.startAgent()}")
  client=MCP(connector,env,log,page)
  page.wait_for_function("connection.state==='online'",timeout=20000)
  def call(name,args=None):
   value=client.call(name,args or {});assert not value.get('isError'),value
   return json.loads(next(x['text'] for x in value['content'] if x['type']=='text'))
  assert call('zhigao_status',{'project':'p'})['connected']
  def prepared(lid):
   result=call('zhigao_prepare_library_assets',{'libraryId':lid});task=result['preparation']['taskId'];deadline=time.monotonic()+150
   while time.monotonic()<deadline:
    result=call('zhigao_task_status',{'taskId':task})
    if result['state'] not in ['preparing','verifying','resuming']:break
    page.wait_for_timeout(200)
   assert result['state']=='continued',result
   return task
  page.locator('[data-page=rules]').first.click();page.locator('#lib-input').set_input_files(str(OUT/'fixture-1'/'合成产品资料.doc'))
  page.wait_for_function('probe.project().library.length===1');old=page.evaluate('probe.project().library[0]');old_task=prepared(old['id'])
  stored=page.evaluate('probe.project().library[0]');assert '300 mL' in stored['text'];job=stored['ingestion']['conversion']['jobId']
  cache_root=home/'.zhigao'/'task-runtime'/'conversions';old_dir=cache_root/job;assert old_dir.exists(),str(old_dir)
  old_key=stored['ingestion']['assetKey']
  page.evaluate('probe.remote()')
  assert call('zhigao_task_status',{'taskId':old_task})['state']=='continued'
  passed('真实MCP自动转换旧版DOC，网页原件/副本与连接器准备任务完整落盘')
  context.route(backend+'/page/library-cleanup',lambda route:route.abort())
  page.locator('#lib-input').set_input_files(str(OUT/'fixture-2'/'合成产品资料.doc'));page.wait_for_selector('[data-action=lib-import-update]');page.locator('[data-action=lib-import-update]').click()
  page.wait_for_function('probe.state().settings.connectorCleanup?.length>0');page.evaluate('probe.cleanup()')
  assert page.evaluate("key=>probe.dbOp('get',key,'media')",old_key) is None
  assert old_dir.exists();queue=page.evaluate('probe.state().settings.connectorCleanup');assert queue[0]['sources'][0]['sourceHash']==stored['ingestion']['conversion']['sourceHash']
  error=page.evaluate('async()=>{try{await probe.remote()}catch(e){return e.message}}');assert '待清理' in error
  passed('替换先持久保存旧缓存身份，断线时浏览器清理完成但连接器队列不虚报完成')
  page.reload();page.wait_for_function('!!window.probe&&!!probe.db()');page.locator('[data-page=rules]').first.click()
  assert len(page.evaluate('probe.state().settings.connectorCleanup'))==1
  page.screenshot(path=str(OUT/'pending-desktop.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'pending-narrow.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.set_viewport_size({'width':1440,'height':1000})
  assert not page.locator('#library-cleanup-notice').inner_text()
  assert page.locator('[data-action=lib-cleanup-retry]').count()==0
  passed('刷新恢复后台待清理队列，桌面与390px窄屏不增加缓存按钮或审计说明')
  # A media job is a control-plane fixture, not a semantic/video processing claim.
  media_id=str(uuid.uuid4());media_dir=OUT/'isolated-media'/'jobs'/media_id;media_dir.mkdir(parents=True)
  (media_dir/'meta.json').write_text(json.dumps({'id':media_id,'token':'synthetic','projectId':'p','docId':'media-lib','revision':'media-r1','libraryAssetKey':'media-old','state':'processing'}),encoding='utf-8')
  (media_dir/'source.media').write_bytes(b'SYNTHETIC MEDIA');(media_dir/'report.json').write_text('SYNTHETIC OLD TRANSCRIPT',encoding='utf-8')
  page.evaluate("""async()=>{await probe.dbOp('put',{id:'media-old',file:{fmt:'video',filename:'synthetic.mp4',originalFile:new File(['synthetic'],'synthetic.mp4'),mediaRevision:'media-r1',extractedText:'合成旧视频'}},'media');probe.update({activityId:'a',library:[{activityId:'a',title:'合成视频资料',kind:'其他',text:'合成旧视频',ingestion:{assetKey:'media-old',format:'video',filename:'synthetic.mp4',blockers:[]}}]});probe.update({activityId:'a',library:[{id:probe.project().library.find(d=>d.title==='合成视频资料').id,activityId:'a',title:'合成视频资料',kind:'其他',text:'新版文本资料',ingestion:{format:'text',blockers:[]}}]});await probe.cleanup();}""")
  context.unroute(backend+'/page/library-cleanup')
  page.wait_for_function('!probe.state().settings.connectorCleanup.length',timeout=45000);assert not old_dir.exists();assert not media_dir.exists()
  old_status=call('zhigao_task_status',{'taskId':old_task});assert old_status['state']=='cancelled';assert 'result' not in old_status
  passed('重连后定时自动通过真实HTTP清理Office及合成媒体缓存，旧准备结果不再经MCP返回')
  new_task=prepared(old['id']);assert new_task!=old_task
  current=page.evaluate("probe.project().library.find(d=>d.id===%s)"%json.dumps(old['id']));assert '600 mL' in current['text'];new_dir=cache_root/current['ingestion']['conversion']['jobId'];assert new_dir.exists()
  page.evaluate('probe.remote()');assert call('zhigao_task_status',{'taskId':new_task})['state']=='continued';assert new_dir.exists()
  passed('新原件重新准备成功，清理重放不删除新转换和新任务结果')
  page.locator('[data-page=rules]').first.click();page.screenshot(path=str(OUT/'recovered.png'),full_page=True)
  assert not errors,errors
  (OUT/'result.json').write_text(json.dumps({'passed':True,'checks':checks,'errors':errors,'environment':environment,'oldJob':job,'oldTask':old_task,'newTask':new_task,'visuals':['pending-desktop.png','pending-narrow.png','recovered.png']},ensure_ascii=False,indent=2),encoding='utf-8')
  client.close();client=None;browser.close()
except Exception as e:
 (OUT/'result.json').write_text(json.dumps({'passed':False,'checks':checks,'errors':errors,'error':str(e),'traceback':traceback.format_exc(),'environment':environment},ensure_ascii=False,indent=2),encoding='utf-8');raise
finally:
 if client:client.close()
 process.terminate();process.wait(timeout=15);log.close();server.shutdown()
