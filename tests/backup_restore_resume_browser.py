"""Real Edge/IndexedDB/OPFS; synthetic backup collision and upload resumption.

This does not grant external-directory access or contact a real connector.
"""
from pathlib import Path
import functools, http.server, json, os, platform, threading, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['ZHIGAO_VERIFY_OUT'])
OUT.mkdir(parents=True, exist_ok=False)
PROBE = r'''
window.probe={db:()=>db,state:()=>({settings,tasks,items,batches}),persist:commitWorkbench,
 backups:()=>projectBackups,chooseBackupFolder,
 protected:async()=>({project:JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects.find(p=>p.id==='p'),tasks:(await readRecords(db,'tasks')).filter(t=>t.projectId==='p'),items:(await readRecords(db,'items')).filter(i=>i.projectId==='p')}),
 initialize:async seed=>{settings=seed;localStorage.setItem('zhigao-settings-v1',JSON.stringify(seed));page='home';render();}};
'''

class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args):
        pass
    def do_GET(self):
        if self.path.split('?')[0] == '/app.js':
            body = ((ROOT / 'app.js').read_text(encoding='utf-8') + PROBE).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

http.server.ThreadingHTTPServer.request_queue_size = 128
http.server.ThreadingHTTPServer.daemon_threads = True
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
checks, errors = [], []
environment = {'system':platform.platform(), 'python':platform.python_version(), 'mode':'real Edge; isolated IndexedDB/OPFS; synthetic files; no external-directory grant'}

def passed(name):
    checks.append(name)
    print('PASS ' + name, flush=True)
    (OUT / 'progress.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        environment['browser'] = browser.version
        context = browser.new_context(viewport={'width':1440,'height':1000})
        context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
        context.route('http://127.0.0.1:47821/**', lambda route:route.abort())
        page = context.new_page()
        page.on('pageerror', lambda e:errors.append(str(e)))
        page.goto(origin)
        page.wait_for_function('!!window.probe && !!probe.db()')
        page.evaluate(r'''async()=>{
            const {newFlow}=await import('./model.js');
            const existing={id:'p',name:'本机已有项目',status:'active',date:'local',selectedActivity:'a',activities:[{id:'a',name:'秋季'}],rules:[],library:[]};
            await probe.initialize({selected:'p',projects:[existing]});
            const localItem={id:'i',projectId:'p',activityId:'a',kind:'视频',author:'本机达人',platform:'抖音',title:'本机内容'};
            const localDoc={id:'d',itemId:'i',projectId:'p',activityId:'a',projectName:existing.name,kind:'视频',author:'本机达人',platform:'抖音',stage:'脚本',fmt:'text',filename:'本机保留.txt',cells:[{id:'p1',address:'第1段',current:'本机已有原文',original:'本机已有原文'}],flow:newFlow(1),rules:[],findings:[]};
            await probe.persist([['items',localItem],['tasks',localDoc],['tasks',{...localDoc,id:'old',stage:'大纲',filename:'本机旧稿.txt'}]]);
            window.protectedBefore=await probe.protected();
            const item={id:'i',projectId:'p',activityId:'a',kind:'视频',author:'合成达人',platform:'抖音',title:'合成内容',revision:7};
            const doc={id:'d',itemId:'i',projectId:'p',activityId:'a',projectName:'备份品牌',kind:'视频',author:'合成达人',platform:'抖音',stage:'脚本',fmt:'text',filename:'第二轮原稿.txt',cells:[{id:'p1',address:'第1段',current:'第二轮原文',original:'第二轮原文'}],flow:newFlow(2),rules:[],findings:[],
                rounds:[{id:'old',itemId:'i',projectId:'p',activityId:'a',kind:'视频',fmt:'text',buffer:new TextEncoder().encode('第一轮原件').buffer,cells:[],flow:{...newFlow(1),state:'passed'},brandFeedback:[{docId:'old',projectId:'p',text:'原轮次反馈'}]}]};
            const pending=(id,name)=>({id:'upload:'+id,uploadId:id,kind:'pending-upload',projectId:'p',activityId:'a',status:'failed',name,file:new File(['恢复后新版原文'],name,{type:'text/plain'}),target:{itemId:'i',stage:'脚本',newRound:true},error:'处理中断'});
            const confirm=pending('confirm','已填归属的新版.txt');confirm.choices=[structuredClone(item)];confirm.draft={target:'0',author:item.author,platform:item.platform,kind:item.kind,stage:'脚本',title:item.title};
            const snapshot={projects:[{...existing,name:'备份品牌'}],items:[item],docs:[doc],batches:[],integrations:[pending('retry','【合成达人】抖音视频脚本v4.txt'),confirm],media:[],libraryAssets:[],artifacts:[{docId:'d',path:'旧目录/审稿意见.html',blob:new Blob(['可恢复的历史意见单'])}]};
            const {saveProjectBackup}=await import('./project-backup.js'),root=await navigator.storage.getDirectory();
            await saveProjectBackup(root,snapshot);
            await probe.chooseBackupFolder('p',root);
        }''')
        page.wait_for_selector('[data-action=backup-restore-confirm]')
        page.screenshot(path=str(OUT / 'restore-collision-choice.png'), full_page=True)
        page.locator('[data-action=backup-restore-confirm]').click()
        page.wait_for_function("probe.state().settings.projects.length===2&&document.querySelector('#toast').textContent.includes('项目已恢复')",timeout=30000)
        restored_id = page.evaluate('probe.state().settings.selected')
        assert restored_id != 'p'
        protected = page.evaluate('async()=>({before:protectedBefore,after:await probe.protected()})')
        (OUT / 'protected-records.json').write_text(json.dumps(protected,ensure_ascii=False,indent=2),encoding='utf-8')
        assert protected['before']==protected['after']
        passed('相同品牌、任务与稿件ID冲突时另存副本，本机已有项目与正文保持原样')
        result = page.evaluate(r'''()=>{
            const p=probe.state().settings.selected,d=probe.state().tasks.find(t=>t.projectId===p),r=d.rounds[0];
            return {taskId:d.id,itemId:d.itemId,roundId:r.id,roundItemId:r.itemId,roundProjectId:r.projectId,feedbackId:r.brandFeedback[0].docId,state:r.flow.state};
        }''')
        assert result['roundItemId']==result['itemId'] and result['roundProjectId']==restored_id
        assert result['roundId']!='old' and result['feedbackId']==result['roundId'] and result['state']=='passed'
        passed('历史轮次及反馈引用恢复后的正确身份，保留原品牌通过事实')
        page.wait_for_function('document.querySelectorAll("[data-upload-id]").length===2')
        page.screenshot(path=str(OUT / 'restored-pending-desktop.png'), full_page=True)
        page.reload()
        page.wait_for_function('!!window.probe&&!!probe.db()&&document.querySelectorAll("[data-upload-id]").length===2')
        pending = page.evaluate(r'''async()=>{
            const rows=await new Promise((ok,no)=>{const q=probe.db().transaction('integrations').objectStore('integrations').getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});
            return rows.filter(r=>r.kind==='pending-upload').map(r=>({projectId:r.projectId,itemId:r.target?.itemId,hasFile:r.file instanceof File}));
        }''')
        assert all(r['projectId']==restored_id and r['itemId']==result['itemId'] and r['hasFile'] for r in pending)
        passed('刷新后未完成上传原件、表单与指定内容任务保持恢复副本的身份')
        page.locator('[data-upload-id]').filter(has_text='已填归属的新版.txt').locator('[data-action=wb-upload-assign]').click()
        page.wait_for_function("probe.state().tasks.filter(t=>t.projectId===probe.state().settings.selected).length===2")
        assert page.evaluate("probe.state().tasks.filter(t=>t.projectId===probe.state().settings.selected).some(t=>t.flow.round===3)")
        passed('已填写归属的上传从原确认入口接续第三轮，不另建内容任务')
        page.locator('[data-upload-id]').filter(has_text='【合成达人】抖音视频脚本v4.txt').locator('[data-action=wb-upload-retry]').click()
        page.wait_for_function("probe.state().tasks.filter(t=>t.projectId===probe.state().settings.selected).length===3",timeout=15000)
        resumed = page.evaluate("probe.state().tasks.filter(t=>t.projectId===probe.state().settings.selected).map(t=>({round:t.flow.round,itemId:t.itemId,current:t.cells[0].current}))")
        assert sorted(r['round'] for r in resumed)==[2,3,4] and len({r['itemId'] for r in resumed})==1
        page.wait_for_function('!document.querySelector("[data-upload-id]")', timeout=15000)
        assert not page.locator('[data-upload-id]').count()
        assert page.evaluate("async()=>new Promise((ok,no)=>{const q=probe.db().transaction('integrations').objectStore('integrations').getAll();q.onsuccess=()=>ok(q.result.every(r=>r.kind!=='pending-upload'||r.status==='saved'));q.onerror=()=>no(q.error);})")
        passed('未解析上传从重新读取入口真实解析并接续第四轮，原第二轮保持')
        backup=page.evaluate('id=>probe.backups().run(id)',restored_id)
        assert backup['state']=='saved',backup
        restored_files=page.evaluate(r'''async()=>{
            const {discoverProjectBackups,readProjectBackup}=await import('./project-backup.js'),root=await navigator.storage.getDirectory();
            const found=await discoverProjectBackups(root),entry=found.find(e=>e.projectId===probe.state().settings.selected),data=(await readProjectBackup(entry.directory)).data;
            return {docs:data.docs.length,rounds:data.docs.map(d=>d.flow.round).sort(),pending:data.integrations.filter(r=>r.kind==='pending-upload').length,artifact:await data.artifacts.find(a=>a.path.endsWith('审稿意见.html')).blob.text(),old:await new Blob([data.docs.find(d=>d.rounds.length).rounds[0].buffer]).text()};
        }''')
        assert restored_files=={'docs':3,'rounds':[2,3,4],'pending':0,'artifact':'可恢复的历史意见单','old':'第一轮原件'},restored_files
        passed('续办后最新完整备份可再读，含所有轮次、历史原件与意见单，已完成上传退出待办')
        page.reload()
        page.wait_for_function("!!window.probe&&!!probe.db()&&probe.state().tasks.length===5")
        assert not page.locator('[data-upload-id]').count()
        assert page.evaluate("probe.state().tasks.filter(t=>t.projectId==='p').every(t=>t.cells[0].current==='本机已有原文')")
        passed('续办后再次刷新不重复入库，本机原项目继续保持')
        page.screenshot(path=str(OUT / 'resumed-desktop.png'),full_page=True)
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(OUT / 'resumed-narrow.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1') and not errors,errors
        passed('桌面与390px恢复续办页面无横向溢出和脚本错误')
        page.set_viewport_size({'width':1440,'height':1000})
        page.evaluate(r'''async()=>{
            const {newFlow}=await import('./model.js'),{saveProjectBackup}=await import('./project-backup.js'),{deleteContentRecords}=await import('./content-delete.js');
            const p={id:'deleted-brand',name:'删后恢复合成品牌',date:'v1',status:'active',rules:[],library:[]};
            await probe.initialize({...probe.state().settings,selected:p.id,projects:[...probe.state().settings.projects,p]});
            const i={id:'deleted-item',projectId:p.id,activityId:'legacy',author:'已删达人',platform:'小红书',kind:'图文',title:'已删内容'},d={id:'deleted-doc',itemId:i.id,projectId:p.id,activityId:'legacy',projectName:p.name,author:i.author,platform:i.platform,kind:i.kind,fmt:'text',stage:'大纲',filename:'删除前稿件.txt',cells:[{id:'p1',address:'第1段',current:'删除前已备份的原文',original:'删除前已备份的原文'}],flow:newFlow(1),rules:[],findings:[]};
            const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('删后恢复合成目录',{create:true});
            await saveProjectBackup(directory,{projects:[p],items:[i],docs:[d],batches:[],integrations:[],media:[],libraryAssets:[],artifacts:[]});
            await probe.persist([['items',i],['tasks',d]]);
            await deleteContentRecords(probe.db(),{docIds:[d.id],itemId:i.id});
        }''')
        page.reload()
        page.wait_for_function("!!window.probe&&!!probe.db()&&probe.state().settings.selected==='deleted-brand'&&!probe.state().tasks.some(t=>t.id==='deleted-doc')")
        page.evaluate("async()=>{const root=await navigator.storage.getDirectory();await probe.chooseBackupFolder('deleted-brand',await root.getDirectoryHandle('删后恢复合成目录'))}")
        page.locator('[data-action=backup-restore-confirm]').click()
        page.wait_for_function("probe.state().settings.selected!=='deleted-brand'&&document.querySelector('#toast').textContent.includes('项目已恢复')",timeout=15000)
        deleted_copy=page.evaluate("()=>{const d=probe.state().tasks.find(t=>t.projectId===probe.state().settings.selected);return {id:d.id,itemId:d.itemId,text:d.cells[0].current}}")
        assert deleted_copy['id']!='deleted-doc' and deleted_copy['itemId']!='deleted-item'
        assert deleted_copy['text']=='删除前已备份的原文'
        passed('实际执行合成稿件删除后，备份从原入口恢复成功并生成新稿件和任务身份')
        tombstones=page.evaluate("async()=>new Promise((ok,no)=>{const q=probe.db().transaction('integrations').objectStore('integrations').getAll();q.onsuccess=()=>ok(q.result.filter(r=>r.kind==='deleted-record').map(r=>r.id));q.onerror=()=>no(q.error)})")
        assert 'deleted-record:tasks:deleted-doc' in tombstones and 'deleted-record:items:deleted-item' in tombstones
        assert not page.evaluate("probe.state().tasks.some(t=>t.id==='deleted-doc')||probe.state().items.some(i=>i.id==='deleted-item')")
        assert not errors,errors
        page.screenshot(path=str(OUT / 'restored-after-delete.png'),full_page=True)
        passed('删除标记继续保留，原删除身份未被复活，既有写入保护仍生效')
        (OUT / 'result.json').write_text(json.dumps({'ok':True,'checks':checks,'errors':errors,'environment':environment,'realFeishuWrites':0,'externalDirectoryGrant':False},ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()
except Exception:
    (OUT / 'failure.json').write_text(json.dumps({'ok':False,'checks':checks,'errors':errors,'traceback':traceback.format_exc(),'environment':environment},ensure_ascii=False,indent=2),encoding='utf-8')
    raise
finally:
    server.shutdown()
