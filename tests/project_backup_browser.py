"""Real Edge OPFS, real app scheduling/import transaction; synthetic project files."""
from pathlib import Path
import os,json,functools,http.server,threading,traceback,hashlib,base64
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/app.js':
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'''\nwindow.probe={db:()=>db,state:()=>({settings,tasks,items,batches}),persist:commitWorkbench,render,actions,project,backups:()=>projectBackups,restoreUploads:()=>workbench.restoreUploads(),connectBackupFolder,chooseBackupFolder,restorePickedBackup,
    initialize:async seed=>{settings=seed;localStorage.setItem('zhigao-settings-v1',JSON.stringify(seed));page='home';render();},
    directory:async()=>{const root=await navigator.storage.getDirectory();const wrap=h=>{if(h.kind==='directory'){const gd=h.getDirectoryHandle.bind(h),gf=h.getFileHandle.bind(h),entries=h.entries.bind(h);Object.defineProperties(h,{queryPermission:{value:async()=>window.backupDenied?'denied':'granted'},getDirectoryHandle:{value:async(n,o)=>wrap(await gd(n,o))},getFileHandle:{value:async(n,o)=>wrap(await gf(n,o))},entries:{value:async function*(){for await(const [n,x]of entries())yield[n,wrap(x)]}}});}else{const cw=h.createWritable.bind(h);Object.defineProperty(h,'createWritable',{value:async()=>{const w=await cw();return{write:async d=>{if(window.backupFail&&h.name==='staging.json')throw Error('synthetic disk full');return w.write(d)},close:()=>w.close(),abort:()=>w.abort()}}});}return h;};return wrap(root);},
    connect:async id=>{const h=await probe.directory();folders.set(id,h);folderStates.set(id,'granted');projectBackups.mark(id);render();},
    clear:async()=>{projectBackups.dispose();await new Promise((ok,no)=>{const tx=db.transaction(['tasks','items','batches','integrations','media','folders'],'readwrite');for(const s of ['tasks','items','batches','integrations','media','folders'])tx.objectStore(s).clear();tx.oncomplete=ok;tx.onerror=()=>no(tx.error)});settings={selected:'local',projects:[{id:'local',name:'已有项目保留',status:'active',rules:[],library:[]}]};localStorage.setItem('zhigao-settings-v1',JSON.stringify(settings));tasks=[];items=[];batches=[];savedRecords.clear();folders.clear();backupBinaryFiles.clear();page='home';render();}};''').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
http.server.ThreadingHTTPServer.daemon_threads=True
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
checks=[];errors=[]
def passed(s):checks.append(s);print('PASS '+s,flush=True);(OUT/'progress.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000});context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe && !!probe.db()')
  seed={'selected':'p','projects':[{'id':'p','name':'自动备份验收品牌','date':'basis','status':'active','selectedActivity':'a','activities':[{'id':'a','name':'秋季活动','notes':'秋季专属'},{'id':'b','name':'冬季活动','notes':'冬季专属'}],'rules':[],'library':[{'id':'lib','activityId':'a','title':'新资料','kind':'Brief','ingestion':{'assetKey':'brand-original','format':'text'}}],'feishu':{'reviewTableVersion':2,'sheets':[],'refined':{'url':'https://example.feishu.cn/sheets/book'}}}]}
  page.evaluate('seed=>probe.initialize(seed)',seed)
  page.evaluate("""async()=>{const records=[];for(const id of ['a','b']){const it={id:'i'+id,projectId:'p',activityId:id,kind:'视频',author:'达人'+id,platform:'抖音',title:'内容'+id};const t={id:'d'+id,itemId:it.id,projectId:'p',activityId:id,projectName:'自动备份验收品牌',fmt:id==='a'?'text':'video',kind:'视频',stage:'脚本',filename:id==='a'?'稿件.txt':'视频.mp4',cells:[{id:'c',original:'原文',current:'原文'}],flow:{state:'review',round:2},rounds:[{id:'old'+id,filename:'第一轮.txt',buffer:new TextEncoder().encode('上一轮原文').buffer,cells:[],flow:{state:'passed',round:1}}],brandFeedback:[{id:'f'+id,text:'本轮反馈'}],rules:[],findings:[]};records.push(['items',it],['tasks',t]);}await probe.persist(records);
    await new Promise((ok,no)=>{const tx=probe.db().transaction(['media','batches','integrations'],'readwrite');tx.objectStore('media').put({id:'db',blob:new Blob([new Uint8Array(5*1024*1024)])});tx.objectStore('media').put({id:'brand-original',file:{fmt:'text',filename:'品牌.txt',originalFile:new File(['当前品牌资料'],'品牌.txt')}});tx.objectStore('batches').put({id:'batch',projectId:'p',activityId:'a',entries:[{docId:'da',status:'reviewing',reviewToken:'must-not-restore',sessionId:'must-not-restore',savedChecks:{text:[{id:'tail',status:'checked'}]}}]});tx.objectStore('integrations').put({id:'upload:u1',uploadId:'u1',kind:'pending-upload',projectId:'p',activityId:'a',status:'choice',name:'待归属.txt',file:new File(['pending'],'待归属.txt'),draft:{target:'new',author:'未确认达人',platform:'',kind:'图文',stage:'初稿',title:''},choices:[]});tx.oncomplete=ok;tx.onerror=()=>no(tx.error)});
    const root=await navigator.storage.getDirectory(),h=await root.getFileHandle('原审稿意见.html',{create:true}),w=await h.createWritable();await w.write('归档意见单内容');await w.close();const t=probe.state().tasks.find(t=>t.id==='da');await probe.persist([['tasks',{...t,saved:[{path:'原审稿意见.html'}]}]]);
    probe.state().batches.push({id:'batch',projectId:'p',activityId:'a',entries:[{docId:'da',status:'reviewing',reviewToken:'must-not-restore',sessionId:'must-not-restore',savedChecks:{text:[{id:'tail',status:'checked'}]}}]});await probe.connect('p');}""")
  page.wait_for_function("JSON.parse(localStorage.getItem('zhigao-backup-status-v1')||'{}').p?.state==='saved'",timeout=30000)
  first=page.evaluate("JSON.parse(localStorage.getItem('zhigao-backup-status-v1')).p")
  assert first['stats']['sourceBytes']>5*1024*1024;passed('真实浏览器自动调度，OPFS写入多活动、多轮次、视频、反馈与待确认原件')
  page.screenshot(path=str(OUT/'backup-desktop.png'),full_page=True)
  result=page.evaluate("""async()=>{const t=probe.state().tasks.find(t=>t.id==='da');await probe.persist([['tasks',{...t,cells:[{...t.cells[0],current:'修改后'}]}]]);return probe.backups().run('p')}""")
  assert result['state']=='saved' and result['stats']['sourceBytes']<10000 and result['stats']['writtenBytes']==0,result
  passed('编辑文字后的备份复用5MiB视频块，不重新读写媒体')
  other=context.new_page();other.goto(origin);other.wait_for_function('!!window.probe && !!probe.db()')
  other.evaluate("""async()=>{const t=probe.state().tasks.find(t=>t.id==='da');await probe.persist([['tasks',{...t,cells:[{...t.cells[0],current:'另一页的修改'}]}]])}""")
  result=page.evaluate("probe.backups().run('p')");assert result['state']=='saved',result
  actual=page.evaluate("""async()=>{const m=await import('./project-backup.js'),found=await m.discoverProjectBackups(await probe.directory()),r=await m.readProjectBackup(found[0].directory);return r.data.docs.find(d=>d.id==='da').cells[0].current}""")
  assert actual=='另一页的修改';other.close();passed('另一标签保存后按数据库已提交记录备份，不用旧标签的内存覆盖最新内容')
  page.evaluate('()=>{window.backupFail=true}');result=page.evaluate("probe.backups().run('p')");assert result['state']=='stale'
  assert page.locator('[data-backup-status]').inner_text()=='备份未更新';page.screenshot(path=str(OUT/'backup-failed.png'),full_page=True)
  page.evaluate('()=>{window.backupFail=false}');result=page.evaluate("probe.backups().run('p')");assert result['state']=='saved'
  passed('注入写入磁盘满后显示未更新，恢复权限与存储后可重试')
  page.evaluate('()=>{window.backupDenied=true}');result=page.evaluate("probe.backups().run('p')");assert result['state']=='stale';page.evaluate('()=>{window.backupDenied=false}')
  passed('授权失效不会弹后台权限请求或显示保存成功')
  snapshot=page.evaluate("""async()=>{const m=await import('./project-backup.js'),root=await probe.directory(),found=await m.discoverProjectBackups(root),r=await m.readProjectBackup(found[0].directory);window.backupTransfer=[];const copy=async(d,parts)=>{for await(const [name,h]of d.entries()){if(!parts.length&&!name.startsWith('知稿项目备份-'))continue;if(h.kind==='directory')await copy(h,[...parts,name]);else{const f=await h.getFile(),u=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode(...u.subarray(i,i+32768));window.backupTransfer.push({parts:[...parts,name],b64:btoa(s)});}}};await copy(root,[]);return {docs:r.data.docs.length,round:r.data.docs[0].flow.round,feedback:r.data.docs[0].brandFeedback[0].text,token:r.data.batches[0].entries[0].reviewToken||null}}""")
  assert snapshot=={'docs':2,'round':2,'feedback':'本轮反馈','token':None}
  transfer=page.evaluate('backupTransfer');fresh=browser.new_context(viewport={'width':1440,'height':1000});fresh.add_init_script("localStorage.setItem('zhigao-agent-v1','off')");restored=fresh.new_page();restored.on('pageerror',lambda e:errors.append(str(e)));restored.goto(origin);restored.wait_for_function('!!window.probe && !!probe.db()')
  restored.evaluate("seed=>probe.initialize(seed)",{'selected':'local','projects':[{'id':'local','name':'已有项目保留','status':'active','rules':[],'library':[]}]})
  restored.evaluate("""async files=>{const root=await navigator.storage.getDirectory();for(const entry of files){let dir=root;for(const p of entry.parts.slice(0,-1))dir=await dir.getDirectoryHandle(p,{create:true});const h=await dir.getFileHandle(entry.parts.at(-1),{create:true}),w=await h.createWritable();await w.write(Uint8Array.from(atob(entry.b64),c=>c.charCodeAt(0)));await w.close();}await probe.chooseBackupFolder('local',await probe.directory());}""",transfer)
  restored.wait_for_selector('[data-action=backup-restore-confirm]');restored.screenshot(path=str(OUT/'restore-desktop.png'),full_page=True)
  restored.evaluate("""()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='tasks')throw new DOMException('synthetic restore quota','QuotaExceededError');return window.originalPut.apply(this,args)}}""")
  restored.locator('[data-action=backup-restore-confirm]').click();restored.wait_for_function("document.querySelector('#modal-root').textContent.includes('synthetic restore quota')")
  assert restored.evaluate("probe.state().settings.projects.length===1&&probe.state().settings.projects[0].id==='local'&&probe.state().tasks.length===0")
  restored.evaluate("()=>{IDBObjectStore.prototype.put=window.originalPut}");restored.locator('[data-action=close-modal]').last.click();restored.evaluate("async()=>probe.chooseBackupFolder('local',await probe.directory())")
  passed('恢复写入事务配额失败时回滚，已有项目与记录保持完整')
  restored.locator('[data-action=backup-restore-confirm]').click()
  restored.wait_for_function("probe.state().settings.projects.some(p=>p.id!=='local'&&p.id!=='p')&&probe.state().tasks.length===2&&document.querySelector('#toast').textContent.includes('项目已恢复')",timeout=30000)
  assert restored.locator('#modal-root .modal').count()==0
  rows=restored.evaluate("()=>({projects:probe.state().settings.projects.map(p=>p.id),items:probe.state().items.length,docs:probe.state().tasks.map(t=>({id:t.id,current:t.cells[0].current,round:t.flow.round,feedback:t.brandFeedback[0].text})),batches:probe.state().batches})")
  assert len(rows['projects'])==2 and rows['projects'][0]=='local' and rows['projects'][1] not in ['local','p'] and rows['items']==2 and rows['docs'][0]['round']==2
  assert rows['batches'][0]['entries'][0]['status']=='interrupted' and 'reviewToken' not in rows['batches'][0]['entries'][0]
  assert any(d['current']=='另一页的修改' for d in rows['docs']);passed('全新浏览器数据从复制备份真实恢复，已有项目保留，原轮次与待办恢复且旧凭据失效')
  result=restored.evaluate('id=>probe.backups().run(id)',rows['projects'][1]);assert result['state']=='saved',result
  original=[{'parts':x['parts'],'sha256':hashlib.sha256(base64.b64decode(x['b64'])).hexdigest()} for x in transfer]
  isolated=restored.evaluate("""async entries=>{const m=await import('./project-backup.js'),root=await probe.directory(),found=await m.discoverProjectBackups(root),source=found.find(x=>x.projectId==='p');let rejected;try{await m.saveProjectBackup(root,(await m.readProjectBackup(source.directory)).data);}catch(e){rejected=e.message;}for(const entry of entries){let dir=root;for(const part of entry.parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);const bytes=await(await(await dir.getFileHandle(entry.parts.at(-1))).getFile()).arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==entry.sha256)throw Error('源备份已变化：'+entry.parts.join('/'));}return{rejected,projects:found.map(x=>x.projectId)};}""",original)
  assert '其他浏览器' in isolated['rejected'] and 'p' in isolated['projects'] and rows['projects'][1] in isolated['projects'],isolated
  passed('异配置拒绝接管源项目，恢复副本自动备份到独立目录，源备份逐文件摘要保持')
  output=restored.evaluate("""async()=>{const t=probe.state().tasks.find(t=>t.id==='da'),p=t.restoredOutputs[0].path.split('/');let d=await navigator.storage.getDirectory();for(const part of p.slice(0,-1))d=await d.getDirectoryHandle(part);return(await(await d.getFileHandle(p.at(-1))).getFile()).text()}""")
  assert output=='归档意见单内容';passed('只复制备份目录也能恢复归档输出文件，实际重开内容一致')
  restored.evaluate('async()=>{await probe.restoreUploads();await probe.restoreUploads()}');assert restored.locator('[data-upload-id]').count()==1
  pending=restored.evaluate("""async()=>new Promise((ok,no)=>{const q=probe.db().transaction('integrations').objectStore('integrations').getAll();q.onsuccess=async()=>{const row=q.result.find(r=>r.kind==='pending-upload');ok({id:row.id,uploadId:row.uploadId,text:await row.file.text(),target:row.draft.target})};q.onerror=()=>no(q.error)})""")
  assert pending['id']=='upload:'+pending['uploadId'] and pending['text']=='pending' and pending['target']=='new';passed('待确认上传原件与表单完整，多次恢复不重复列出')
  restored.set_viewport_size({'width':390,'height':844});restored.screenshot(path=str(OUT/'restored-narrow.png'),full_page=True);assert restored.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  assert not errors,errors;passed('桌面与390px恢复画面无横向溢出或脚本错误')
  (OUT/'result.json').write_text(json.dumps({'ok':True,'checks':checks,'browser':browser.version,'errors':errors,'live':False,'freshBrowserContext':True,'transferBytes':sum(len(x['b64'])*3//4 for x in transfer)},ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
except Exception:
 (OUT/'failure.json').write_text(json.dumps({'ok':False,'checks':checks,'errors':errors,'traceback':traceback.format_exc()},ensure_ascii=False,indent=2),encoding='utf-8');raise
finally:server.shutdown()
