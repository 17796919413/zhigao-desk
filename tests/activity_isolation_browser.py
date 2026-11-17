"""Real Edge, synthetic data, isolated DB and blocked connector; no business writes."""
from pathlib import Path
import os,json,functools,http.server,threading,traceback,platform
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/agent.js':
   data=((ROOT/'agent.js').read_text(encoding='utf-8')+'\nwindow.agentProbe=tools;').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  if self.path.split('?')[0]=='/app.js':
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.probe={state:()=>({tasks,items,settings,batches,libraryImports}),persist:commitWorkbench,render,db:()=>db,dbOp,project,loadFile,actions,update:commitAgentProject};').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
checks=[];errors=[];environment={'system':platform.platform(),'python':platform.python_version(),'mode':'isolated Edge; synthetic data; no real Feishu'}
def passed(name):checks.append(name);print('PASS '+name,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);environment['browser']=browser.version
  context=browser.new_context(viewport={'width':1440,'height':1000});context.route('http://127.0.0.1:47821/**',lambda r:r.abort())
  context.add_init_script("""if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-agent-v1','off');localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'audit',projects:[{id:'audit',name:'合成品牌',date:'original',status:'active',selectedActivity:'a',activities:[{id:'a',name:'秋季测试',notes:'秋季笔记'},{id:'b',name:'冬季测试',notes:'冬季笔记'}],rules:[],library:[{id:'la',title:'秋季资料',kind:'Brief',text:'秋季要求',activityId:'a'},{id:'lb',title:'冬季资料',kind:'Brief',text:'冬季要求',activityId:'b'}],notes:'原有活动笔记'}]}));localStorage.setItem('seed','1')}""")
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe && !!probe.db()')
  page.evaluate("""async()=>{const p=probe.project();const records=[];for(const [id,activityId,state] of [['a1','a','review'],['a2','a','passed'],['a3','a','review'],['b1','b','review']]){const it={id:'i'+id,projectId:p.id,activityId,author:'同名达人',platform:'其他',kind:'图文',title:id,created:'2026-11-16',updated:'2026-11-16',publish:{status:'待排期'}};const t={id,itemId:it.id,projectId:p.id,activityId,projectName:p.name,filename:id+'.txt',author:it.author,kind:it.kind,platform:it.platform,stage:'初稿',fmt:'text',created:it.created,updated:it.updated,ruleDate:'original',cells:[{id:'c',original:'完整合成稿件',current:'完整合成稿件'}],flow:{state,round:1,submissions:state==='passed'?[{round:1,fp:'brand-original'}]:[],feedback:[],log:[],...(state==='passed'?{passedAt:'original',passedFp:'brand-original'}:{})},findings:[],rules:[]};if(id!=='a3')t.ai={at:'original',changes:[],warnings:[],assurance:{complete:true,projectRevision:'original'},coverage:{complete:true},archive:{state:'saved',paths:['already-archived']}};records.push(['items',it],['tasks',t]);}await probe.persist(records);probe.render();}""")
  assert page.locator('.wb-row').count()==3
  page.locator('[data-page="history"]').first.click();assert page.locator('.wb-row').count()==3
  page.locator('[aria-label="当前活动"]').select_option('b');page.locator('[data-page="history"]').first.click();assert page.locator('.wb-row').count()==1
  passed('历史内容任务默认按当前活动过滤，同名达人不串稿')
  page.locator('[aria-label="当前活动"]').select_option('a');page.locator('[data-page="rules"]').first.click()
  page.locator('.note-box summary').click();assert page.locator('#project-notes').input_value()=='秋季笔记'
  page.locator('#project-notes').fill('秋季新的完整要求');page.locator('[data-action=save-notes]').click()
  state=page.evaluate('probe.state()');p=state['settings']['projects'][0]
  assert p['notes']=='原有活动笔记';assert p['activities'][1]['notes']=='冬季笔记'
  assert page.locator('#library-count').inner_text().strip()=='/ 1 份'
  passed('笔记读取与保存锁定活动，资料计数按活动展示')
  page.locator('[data-page="home"]').first.click()
  assert '需复核' in page.locator('[data-doc-id=a1] .wb-state').inner_text()
  assert '已交品牌' in page.locator('[data-doc-id=a2] .wb-state').inner_text()
  assert '待按新依据审核' in page.locator('[data-doc-id=a3] .wb-state').inner_text()
  assert '决定重新审核' in page.locator('[data-doc-id=a2]').inner_text()
  assert page.locator('[data-doc-id=a2] [data-batch-doc]').count()==0
  assert page.locator('[data-doc-id=a1] .wb-saved').inner_text()=='已自动归档'
  page.wait_for_function("!document.querySelector('#toast').classList.contains('show')")
  page.screenshot(path=str(OUT/'basis-impact-desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'basis-impact-narrow.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  page.set_viewport_size({'width':1440,'height':1000})
  page.locator('[aria-label="当前活动"]').select_option('b');assert page.locator('[data-doc-id=b1] .wb-state').inner_text().startswith('已审稿')
  passed('三类依据更新提示清楚，归档不当成交付，其他活动已审状态不变')
  page.locator('[aria-label="当前活动"]').select_option('a')
  page.evaluate("""()=>{const f=new File(['迟到的稿件'], 'late.txt',{type:'text/plain'});f.text=()=>new Promise(r=>window.releaseLate=()=>r('迟到的稿件'));window.lateUpload=probe.loadFile(f);}""")
  page.wait_for_function('!!window.releaseLate');page.locator('[aria-label="当前活动"]').select_option('b');page.evaluate('releaseLate()');page.evaluate('lateUpload')
  assert len(page.evaluate('probe.state().tasks'))==4
  pending=page.evaluate("async()=> (await probe.dbOp('getAll',undefined,'integrations')).filter(r=>r.kind==='pending-upload'&&r.name==='late.txt')")
  assert len(pending)==1 and pending[0]['activityId']=='a' and pending[0]['projectId']=='audit'
  assert pending[0]['status'] in ['choice','failed'] and not pending[0].get('docId')
  assert page.locator('[data-upload-id]').count()==0
  page.locator('[aria-label="当前活动"]').select_option('a');assert page.locator('[data-upload-id]').count()==1
  assert 'late.txt' in page.locator('[data-upload-id]').inner_text()
  passed('旧上传入口解析中切活动，迟到稿保留在原活动待确认队列，不新增错误活动稿件且可恢复')
  page.locator('[aria-label="当前活动"]').select_option('a');page.locator('[data-page="rules"]').first.click()
  def upload(text):
   page.locator('#lib-input').set_input_files({'name':'合成更新资料.txt','mimeType':'text/plain','buffer':text.encode()})
  upload('原始资料完整内容');page.wait_for_function("probe.state().libraryImports.some(r=>r.status==='saved')")
  first=page.evaluate("probe.project().library.find(d=>d.title==='合成更新资料')")
  upload('第二版完整原文');page.wait_for_function("probe.state().libraryImports.some(r=>r.status==='conflict')")
  page.locator('[data-action=lib-import-update]').click();page.wait_for_function("probe.state().libraryImports.filter(r=>r.status==='saved').length===2")
  second=page.evaluate("probe.project().library.find(d=>d.title==='合成更新资料')")
  assert first['id']==second['id'];assert first['ingestion']['assetKey']!=second['ingestion']['assetKey'];assert 'history' not in second
  assert page.evaluate("key=>probe.dbOp('get',key,'media')",first['ingestion']['assetKey']) is None
  assert page.evaluate("async key=>(await probe.dbOp('get',key,'media')).file.extractedText",second['ingestion']['assetKey'])=='第二版完整原文'
  upload('第三版完整原文');page.wait_for_function("probe.state().libraryImports.some(r=>r.status==='conflict')")
  page.locator('[data-action=lib-import-update]').click();page.wait_for_function("probe.state().libraryImports.filter(r=>r.status==='saved').length===3")
  third=page.evaluate("probe.project().library.find(d=>d.title==='合成更新资料')")
  assert third['id']==first['id'];assert page.evaluate("key=>probe.dbOp('get',key,'media')",second['ingestion']['assetKey']) is None
  upload('故障注入新原文');page.wait_for_function("probe.state().libraryImports.some(r=>r.status==='conflict')")
  page.evaluate("()=>{window.restoreStorage=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='zhigao-settings-v1')throw new DOMException('test quota','QuotaExceededError');return restoreStorage.call(this,k,v)}}")
  page.locator('[data-action=lib-import-update]').click();page.wait_for_function("probe.state().libraryImports.some(r=>r.status==='failed')")
  page.evaluate('()=>{Storage.prototype.setItem=restoreStorage;}')
  assert page.evaluate("probe.project().library.find(d=>d.title==='合成更新资料').ingestion.assetKey")==third['ingestion']['assetKey']
  assert page.evaluate("async key=>(await probe.dbOp('get',key,'media')).file.extractedText",third['ingestion']['assetKey'])=='第三版完整原文'
  passed('新原件已写入后模拟设置存储失败，旧资料仍可回读且未被切换')
  page.screenshot(path=str(OUT/'library-replacement.png'),full_page=True)
  page.reload();page.wait_for_function('!!window.probe && !!probe.db()');assert page.evaluate("probe.project().library.find(d=>d.title==='合成更新资料').ingestion.assetKey")==third['ingestion']['assetKey']
  passed('真实IndexedDB连续替换、完整正文回读和旧缓存删除，刷新仍为最新资料')
  prior=page.evaluate("agentProbe.zhigao_get_project({sections:['expected']}).expected")
  assert prior['activityId']=='a'
  assert page.evaluate("async()=>{try{await agentProbe.zhigao_update_project({notes:'缺活动身份'});return 'unexpected';}catch(e){return e.code;}}")=='ACTIVITY_REQUIRED'
  page.locator('[aria-label="当前活动"]').select_option('b')
  assert page.evaluate("async expected=>{try{await agentProbe.zhigao_update_project({notes:'迟到的旧活动笔记',expected});return 'unexpected';}catch(e){return e.code;}}",prior)=='ACTIVITY_MISMATCH'
  assert page.evaluate("probe.project().activities.find(a=>a.id==='b').notes")=='冬季笔记'
  page.locator('[aria-label="当前活动"]').select_option('a')
  assert page.evaluate("async expected=>(await agentProbe.zhigao_update_project({notes:'活动身份回传正确',expected})).ok",prior)
  passed('真实网页工具接口要求活动身份，跨活动expected拒绝，同活动回写成功')
  assert not errors,errors;browser.close()
except Exception:
 errors.append(traceback.format_exc());print(errors[-1],flush=True)
finally:
 server.shutdown();server.server_close();(OUT/'result.json').write_text(json.dumps({'checks':checks,'errors':errors,'environment':environment,'passed':not errors},ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(1 if errors else 0)
