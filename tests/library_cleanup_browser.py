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
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.probe={state:()=>({tasks,items,settings,batches,libraryImports}),persist:commitWorkbench,render,db:()=>db,dbOp,project,loadFile,actions,update:commitAgentProject,cleanup:flushLibraryCleanup};').encode()
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
  context.add_init_script("""if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-agent-v1','off');localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'p',projects:[{id:'p',name:'清理验收合成品牌',date:'v1',status:'active',selectedActivity:'a',activities:[{id:'a',name:'秋季'},{id:'b',name:'冬季'}],rules:[],library:[{id:'l',activityId:'a',title:'原件测试',kind:'Brief',text:'旧正文',ingestion:{assetKey:'old',blockers:[]},history:[{text:'更早正文',ingestion:{assetKey:'shared-old'}}]}]},{id:'other',name:'共用原件保护',rules:[],library:[{id:'shared',title:'共用资料',text:'共用',kind:'Brief',ingestion:{assetKey:'shared-old'}}]}]}));localStorage.setItem('seed','1');}""")
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe && !!probe.db()')
  page.evaluate("""async()=>{
   for(const id of ['old','shared-old','new'])await probe.dbOp('put',{id,file:{fmt:'text',filename:id+'.txt',originalFile:new File([id],id+'.txt'),extractedText:id}},'media');
   for(const [id,activityId] of [['d','a'],['other-doc','b']]){const t={id,projectId:'p',activityId,itemId:'i'+id,fmt:'text',filename:id+'.txt',stage:'初稿',platform:'其他',kind:'图文',cells:[{id:'c',original:'原稿',current:'原稿'}],findings:[],flow:{state:'passed',round:2,passedAt:'已通过',submissions:[{round:2}],feedback:[]},rounds:[{id:'old-round',cells:[{original:'旧稿'}]}],ai:{changes:[],assurance:{complete:true,projectRevision:'v1'},sourceChecks:[{quote:'历史审核引用'}]}};await probe.persist([['items',{id:t.itemId,projectId:'p',activityId,title:id,author:'合成达人',kind:'图文'}],['tasks',t]]);await probe.dbOp('put',{id:'review-checkpoint:'+id,kind:'review-checkpoint',projectId:'p',docId:id,entry:{docId:id,status:'reviewing',savedChecks:{quote:'旧依据'},basisRef:{projectId:'p',activityId},media:{assets:[{libraryAssetKey:'old'}]}}},'integrations');}
   await probe.dbOp('put',{id:'batch',projectId:'p',activityId:'a',entries:[{docId:'d',status:'reviewing',reviewToken:'old-token',savedChecks:{quote:'旧依据'},media:{assets:[]}},{docId:'d',status:'pending',coverage:{complete:true},assuranceComplete:true,savedChecks:{quote:'旧依据'},submissionResult:{ok:true}}]},'batches');
   await probe.dbOp('put',{id:'review-knowledge:p',kind:'review-knowledge',projectId:'p',data:{text:'旧编译全文'}},'integrations');
   window.originalTask=JSON.stringify(await probe.dbOp('get','d'));window.originalOther=JSON.stringify(await probe.dbOp('get','review-checkpoint:other-doc','integrations'));
   window.nativeTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readwrite'&&Array.isArray(stores)&&stores.includes('media')&&stores.includes('batches'))throw Error('合成清理故障');return nativeTransaction.call(this,stores,mode,...rest)};
   const old=probe.project().library[0];probe.update({library:[{...old,text:'新正文',ingestion:{assetKey:'new',blockers:[]}}]});
  }""")
  page.locator('[data-page=rules]').first.click();page.wait_for_function("document.querySelector('#library-cleanup-notice').textContent.includes('尚未完成')")
  page.evaluate("async()=>{try{await probe.cleanup()}catch(e){return e.message}}")
  assert len(page.evaluate('probe.state().settings.libraryCleanup'))==1
  assert page.evaluate("async()=>!!(await probe.dbOp('get','old','media'))")
  page.screenshot(path=str(OUT/'cleanup-pending-desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'cleanup-pending-narrow.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.set_viewport_size({'width':1440,'height':1000})
  passed('清理失败持久保留队列和原件，桌面与窄屏显示可重试状态')
  original_task=page.evaluate('originalTask');original_other=page.evaluate('originalOther')
  page.reload();page.wait_for_function('!!window.probe && !!probe.db()');page.wait_for_function('!probe.state().settings.libraryCleanup?.length')
  assert page.evaluate("key=>probe.dbOp('get',key,'media')",'old') is None
  for key in ['new','shared-old']:assert page.evaluate("async key=>!!(await probe.dbOp('get',key,'media'))",key)
  assert page.evaluate("key=>probe.dbOp('get',key,'integrations')",'review-checkpoint:d') is None
  assert page.evaluate("key=>probe.dbOp('get',key,'integrations')",'review-knowledge:p') is None
  assert page.evaluate("async()=>JSON.stringify(await probe.dbOp('get','d'))")==original_task
  assert page.evaluate("async()=>JSON.stringify(await probe.dbOp('get','review-checkpoint:other-doc','integrations'))")==original_other
  batch=page.evaluate("()=>probe.dbOp('get','batch','batches')")
  assert batch['entries'][0]['status']=='interrupted';assert batch['entries'][0]['errorCode']=='BASIS_CHANGED'
  assert 'savedChecks' not in batch['entries'][1];assert batch['entries'][1]['assuranceComplete'];assert batch['entries'][1]['submissionResult']=={'ok':True}
  passed('刷新自动重试删除旧原件与临时依据，保留共享原件、其他活动、旧轮次和品牌通过记录')
  # Simulate acknowledgement failure after the IDB transaction; replay must protect fresh leases.
  page.evaluate("""async()=>{
   window.nativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='zhigao-settings-v1'&&!JSON.parse(v).libraryCleanup?.length)throw Error('合成队列确认失败');return nativeSet.call(this,k,v)};
   const old=probe.project().library[0];probe.update({library:[{...old,text:'再更新正文'}]});
   const p=probe.project(),entry={docId:'d',projectRevision:p.activityRevisions.a,status:'reviewing',reviewToken:'new-token',savedChecks:{quote:'最新依据'}};
   await probe.dbOp('put',{id:'fresh',projectId:'p',activityId:'a',entries:[entry]},'batches');
   await probe.dbOp('put',{id:'review-checkpoint:d',kind:'review-checkpoint',projectId:'p',docId:'d',entry},'integrations');
   try{await probe.cleanup()}catch{};
  }""")
  assert len(page.evaluate('probe.state().settings.libraryCleanup'))==1
  page.evaluate("()=>{Storage.prototype.setItem=nativeSet}");page.evaluate('probe.cleanup()')
  assert page.evaluate("async()=>(await probe.dbOp('get','fresh','batches')).entries[0].reviewToken")=='new-token'
  assert page.evaluate("async()=>(await probe.dbOp('get','review-checkpoint:d','integrations')).entry.reviewToken")=='new-token'
  passed('清理已提交但队列确认失败可重放，新依据的审核凭据不会被误清除')
  page.evaluate("""async()=>{
   const {purgeLibraryReferences}=await import('./library-cleanup.js');await probe.dbOp('put',{id:'rollback-old',file:{extractedText:'rollback'}},'media');
   const snapshot=structuredClone(probe.state().settings);snapshot.libraryCleanup=[{id:'rollback',projectId:'p',activityIds:['a'],assetKeys:['rollback-old']}];let calls=0;
   try{await purgeLibraryReferences(probe.db(),snapshot,{guard:()=>{if(++calls===2)throw Error('合成并发变化')}});throw Error('unexpected commit')}catch(e){if(e.message!=='合成并发变化')throw e;}
   if(!(await probe.dbOp('get','rollback-old','media')))throw Error('事务未回滚');await probe.dbOp('delete','rollback-old','media');
  }""")
  passed('清理事务末尾检测到并发变化时，全部删除回滚')
  result=page.evaluate("""async()=>{
   const {makeBundle,readBundle}=await import('./bundle.js');const p=probe.project();
   const libraryAssets=await probe.dbOp('getAll',undefined,'media');
   const blob=await makeBundle({projects:[p],items:[],docs:[],media:[],libraryAssets});
   const zip=await JSZip.loadAsync(await blob.arrayBuffer()),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
   const restored=await readBundle(await blob.arrayBuffer());
   return {assets:manifest.libraryAssets.map(a=>a.id),files:Object.keys(zip.files),restored:restored.projects[0].library[0].text,history:manifest.projects[0].library[0].history||null};
  }""")
  assert result['assets']==['new'];assert not any('shared-old' in name for name in result['files']);assert result['history'] is None;assert result['restored']=='再更新正文'
  (OUT/'bundle-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
  passed('真实ZIP生成与独立读取只包含当前资料原件，残留缓存不进入备份')
  review=page.evaluate("""async()=>{
   const t=structuredClone(probe.state().tasks.find(t=>t.id==='d'));t.id='resume-doc';t.itemId='resume-item';t.ai=null;t.rounds=[];delete t.revision;t.flow={state:'review',round:1,submissions:[],feedback:[],log:[]};
   await probe.persist([['items',{id:t.itemId,projectId:'p',activityId:'a',author:'续审达人',title:'续审测试',kind:'图文'}],['tasks',t]]);
   const first=await agentProbe.zhigao_get_review_brief({docId:t.id});
   await agentProbe.zhigao_record_review_checks({docId:t.id,reviewToken:first.reviewToken,basis:first.basis,checks:{reviewedIds:['c']}});
   const old=probe.project().library[0];probe.update({library:[{...old,text:'用于续审的最新正文'}]});
   const second=await agentProbe.zhigao_get_review_brief({docId:t.id,retry:true});
   let rejected=false;try{await agentProbe.zhigao_read_review_context({docId:t.id,reviewToken:first.reviewToken,section:'sources'})}catch{rejected=true}
   const pages=[];for(const [section,meta] of Object.entries(second.context))if(meta.required){let cursor;do{const page=await agentProbe.zhigao_read_review_context({docId:t.id,reviewToken:second.reviewToken,section,cursor});pages.push(page);cursor=page.nextCursor}while(cursor)}
   return {rejected,changed:first.reviewToken!==second.reviewToken,resume:second.resume,pages:JSON.stringify(pages)};
  }""")
  assert review['rejected'] and review['changed'];assert not review['resume']['restored'];assert '用于续审的最新正文' in review['pages'];assert '再更新正文' not in review['pages']
  passed('网页真实审稿工具在替换后重领完整新依据，旧凭据失效且旧核对记录不恢复')
  page.locator('[data-page=rules]').first.click();page.screenshot(path=str(OUT/'cleanup-recovered.png'),full_page=True)
  assert not page.evaluate('probe.state().settings.libraryCleanup.length')
  assert page.evaluate('probe.state().settings.connectorCleanup.length')>0
  assert page.locator('[data-action=lib-cleanup-retry]').count()==0
  assert not page.locator('#library-cleanup-notice').inner_text()
  # Pause startup deterministically and navigate while database restoration is pending.
  startup= context.new_page();startup.on('pageerror',lambda e:errors.append(str(e)))
  delayed=(ROOT/'app.js').read_text(encoding='utf-8').replace('db=await openDB();','await new Promise(resolve=>window.releaseStartup=resolve);db=await openDB();',1)
  startup.route('**/app.js',lambda route:route.fulfill(status=200,content_type='text/javascript',body=delayed))
  startup.goto(origin,wait_until='commit');startup.wait_for_function('!!window.releaseStartup')
  startup.locator('[data-page=feishu]').first.click();startup.evaluate('releaseStartup()')
  startup.wait_for_function("!document.querySelector('#toast').textContent.includes('当前浏览器不能保存历史')")
  assert not startup.locator('.modal .error').count(),startup.locator('.modal').inner_text()
  passed('数据库恢复尚未完成时立即打开审核表，界面状态已初始化且不产生假存储故障')
  assert not errors,errors;browser.close()
except Exception:
 errors.append(traceback.format_exc());print(errors[-1],flush=True)
finally:
 server.shutdown();server.server_close();(OUT/'result.json').write_text(json.dumps({'checks':checks,'errors':errors,'environment':environment,'passed':not errors},ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(1 if errors else 0)
