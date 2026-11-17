"""Edge/IndexedDB/OPFS: archive files and ownership across historical reviews.

Synthetic records only. No external directory grant or real connector is used.
"""
from pathlib import Path
import base64, functools, hashlib, http.server, json, os, platform, threading, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['ZHIGAO_VERIFY_OUT'])
OUT.mkdir(parents=True, exist_ok=False)
PROBE = r'''
window.probe={db:()=>db,state:()=>({settings,tasks,items,batches}),persist:commitWorkbench,
 backups:()=>projectBackups,capture:captureProjectBackup,chooseBackupFolder,
 initialize:async seed=>{settings=seed;localStorage.setItem('zhigao-settings-v1',JSON.stringify(seed));page='home';render();},
 connect:async id=>connectBackupFolder(id,await navigator.storage.getDirectory())};
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
environment = {'system':platform.platform(), 'python':platform.python_version(), 'mode':'real Edge/IndexedDB/OPFS; synthetic historical archives'}


def passed(name):
    checks.append(name)
    print('PASS ' + name, flush=True)
    (OUT / 'progress.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')


INSPECT = r'''async projectId=>{
 const root=await navigator.storage.getDirectory(),docs=probe.state().tasks.filter(d=>d.projectId===projectId),rows=[];
 const walk=async(node,recordPath,doc)=>{
  for(const ref of node.restoredOutputs||[]){let dir=root;const parts=ref.path.split('/');for(const p of parts.slice(0,-1))dir=await dir.getDirectoryHandle(p);const file=await(await dir.getFileHandle(parts.at(-1))).getFile();rows.push({author:doc.author,activityId:doc.activityId,recordPath,sourcePath:ref.sourcePath,text:await file.text()});}
  for(const key of ['rounds','aiHistory'])for(const [index,child]of(node[key]||[]).entries())await walk(child,[...recordPath,key,index],doc);
 };for(const doc of docs)await walk(doc,[],doc);
 return {rows,rounds:await Promise.all(docs.map(async d=>({activityId:d.activityId,current:d.cells[0].current,round:d.flow.round,old:d.rounds[0]?.flow.state,feedback:d.rounds[0]?.brandFeedback?.[0]?.text,feedbackBytes:d.rounds[0]?.brandFeedback?.[0]?.originalAsset?.buffer?await new Blob([d.rounds[0].brandFeedback[0].originalAsset.buffer]).text():null}))),history:docs.find(d=>d.activityId==='a').aiHistory.map(h=>({at:h.at,summary:h.summary,paths:h.archive?.paths||[],state:h.archive?.state}))};
}'''

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        environment['browser'] = browser.version
        source = browser.new_context(viewport={'width':1440,'height':1000})
        source.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
        page = source.new_page()
        page.on('pageerror', lambda e:errors.append(str(e)))
        page.goto(origin)
        page.wait_for_function('!!window.probe&&!!probe.db()')
        expected = page.evaluate(r'''async()=>{
         const {newFlow}=await import('./model.js'),root=await navigator.storage.getDirectory();
         const p={id:'p',name:'历史结果合成品牌',status:'active',date:'basis',selectedActivity:'a',activities:[{id:'a',name:'秋季'},{id:'b',name:'冬季'}],rules:[],library:[{id:'l',activityId:'*',title:'共用资料',ingestion:{assetKey:'library',format:'text'}}]};
         await probe.initialize({selected:'p',projects:[p]});
         const files={'当前/手动稿.txt':'当前手动稿','历史/首审修改稿.txt':'首审修改稿','历史/首审意见.html':'首审意见','历史/复审修改稿.txt':'复审修改稿','旧轮/原件.txt':'第一轮原件','旧轮/修改稿.txt':'第一轮修改稿','旧轮/审稿意见.html':'第一轮历史意见','嵌套/更早意见.html':'更早意见','共用/意见.html':'两个活动各自保留的同一文件'};
         for(const [path,text]of Object.entries(files)){let dir=root;const parts=path.split('/');for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name,{create:true});const h=await dir.getFileHandle(parts.at(-1),{create:true}),w=await h.createWritable();await w.write(text);await w.close();}
         const item=id=>({id:'i'+id,projectId:p.id,activityId:id,kind:'视频',author:'同名合成达人',platform:'抖音',title:'同名内容'});
         const doc=id=>({id:'d'+id,itemId:'i'+id,projectId:p.id,activityId:id,projectName:p.name,kind:'视频',author:'同名合成达人',platform:'抖音',stage:'脚本',fmt:'text',filename:id+'第三轮.txt',buffer:new TextEncoder().encode(id+'第三轮原件').buffer,cells:[{id:'p1',address:'第1段',original:id+'第三轮原文',current:id+'第三轮原文'}],flow:newFlow(3),rules:[],findings:[],saved:[{path:'共用/意见.html'}],rounds:[],aiHistory:[]});
         const a=doc('a'),b=doc('b');a.saved.push({path:'当前/手动稿.txt'});
         a.aiHistory=[{at:'first-review',summary:'保留首审结论',changes:[],saved:{path:'历史/首审修改稿.txt'},archive:{state:'saved',output:'历史/首审修改稿.txt',notes:'历史/首审意见.html',paths:['历史/首审修改稿.txt','历史/首审意见.html']}},{at:'second-review',summary:'保留复审结论',changes:[],saved:{path:'历史/复审修改稿.txt'},archive:{state:'saved',paths:[]}}];
         a.rounds=[{id:'old',projectId:p.id,itemId:'ia',activityId:'a',fmt:'text',filename:'第一轮.txt',buffer:new TextEncoder().encode('第一轮原件').buffer,cells:[],flow:{...newFlow(1),state:'passed'},originalSaved:'旧轮/原件.txt',saved:[{path:'旧轮/修改稿.txt'}],brandFeedback:[{id:'feedback',projectId:p.id,docId:'old',round:1,text:'只作用旧轮',originalAsset:{fmt:'text',buffer:new TextEncoder().encode('旧轮反馈附件').buffer}}],aiHistory:[{at:'old-review',summary:'旧轮历史结论',saved:{path:'旧轮/审稿意见.html'}}],rounds:[{filename:'更早稿.txt',fmt:'text',buffer:new TextEncoder().encode('更早原文').buffer,cells:[],saved:[{path:'嵌套/更早意见.html'}]}]}];
         await probe.persist([['items',item('a')],['items',item('b')],['tasks',a],['tasks',b],['media',{id:'library',file:{fmt:'text',filename:'共用资料.txt',originalFile:new File(['共用资料原文'],'共用资料.txt')}}]]);
         await probe.connect('p');
         const refs=[{activityId:'a',recordPath:[],sourcePath:'共用/意见.html'},{activityId:'a',recordPath:[],sourcePath:'当前/手动稿.txt'},{activityId:'a',recordPath:['aiHistory',0],sourcePath:'历史/首审修改稿.txt'},{activityId:'a',recordPath:['aiHistory',0],sourcePath:'历史/首审意见.html'},{activityId:'a',recordPath:['aiHistory',1],sourcePath:'历史/复审修改稿.txt'},{activityId:'a',recordPath:['rounds',0],sourcePath:'旧轮/原件.txt'},{activityId:'a',recordPath:['rounds',0],sourcePath:'旧轮/修改稿.txt'},{activityId:'a',recordPath:['rounds',0,'aiHistory',0],sourcePath:'旧轮/审稿意见.html'},{activityId:'a',recordPath:['rounds',0,'rounds',0],sourcePath:'嵌套/更早意见.html'},{activityId:'b',recordPath:[],sourcePath:'共用/意见.html'}];
         for(const d of probe.state().tasks){files[d.originalSaved]=d.activityId+'第三轮原件';refs.push({activityId:d.activityId,recordPath:[],sourcePath:d.originalSaved});}
         return {files,refs};
        }''')
        manifest = page.evaluate("async()=>{const data=await probe.capture('p');return data.artifacts.map(a=>({docId:a.docId,path:a.path,recordPath:a.recordPath||[]}));}")
        (OUT/'captured-artifacts.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        expected_paths=set(expected['files'])
        assert {a['path'] for a in manifest}==expected_paths, {'missing':sorted(expected_paths-{a['path'] for a in manifest}),'actual':manifest}
        assert len(manifest)==len(expected['refs']), manifest
        passed('自动备份收齐首审、复审、嵌套旧轮与当前归档，按原所属记录保留引用')
        status = page.evaluate("probe.backups().run('p')")
        assert status['state']=='saved',status
        transfer = page.evaluate(r'''async()=>{const rows=[],root=await navigator.storage.getDirectory();const walk=async(dir,parts)=>{for await(const [name,h]of dir.entries()){if(!parts.length&&!name.startsWith('知稿项目备份-'))continue;if(h.kind==='directory')await walk(h,[...parts,name]);else{const u=new Uint8Array(await(await h.getFile()).arrayBuffer());let s='';for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode(...u.subarray(i,i+32768));rows.push({parts:[...parts,name],b64:btoa(s)});}}};await walk(root,[]);return rows;}''')
        original_hashes=[{'parts':r['parts'],'sha256':hashlib.sha256(base64.b64decode(r['b64'])).hexdigest()} for r in transfer]
        source.close()
        fresh=browser.new_context(viewport={'width':1440,'height':1000})
        fresh.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
        restored=fresh.new_page()
        restored.on('pageerror',lambda e:errors.append(str(e)))
        restored.goto(origin)
        restored.wait_for_function('!!window.probe&&!!probe.db()')
        restored.evaluate("seed=>probe.initialize(seed)",{'selected':'local','projects':[{'id':'local','name':'已有项目保留','status':'active','rules':[],'library':[]}]})
        restored.evaluate(r'''async rows=>{const root=await navigator.storage.getDirectory();for(const row of rows){let dir=root;for(const name of row.parts.slice(0,-1))dir=await dir.getDirectoryHandle(name,{create:true});const h=await dir.getFileHandle(row.parts.at(-1),{create:true}),w=await h.createWritable();await w.write(Uint8Array.from(atob(row.b64),c=>c.charCodeAt(0)));await w.close();}await probe.chooseBackupFolder('local',root);}''',transfer)
        restored.screenshot(path=str(OUT/'restore-desktop.png'),full_page=True)
        restored.evaluate(r'''()=>{const remove=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(key){if(this.name==='integrations'&&String(key).startsWith('restored-output:'))throw Error('synthetic cleanup interruption');return remove.call(this,key);};}''')
        restored.locator('[data-action=backup-restore-confirm]').click()
        restored.wait_for_function("probe.state().settings.projects.length===2&&document.querySelector('#toast').textContent.includes('项目已恢复')",timeout=30000)
        copy_id=restored.evaluate('probe.state().settings.selected')
        observed=restored.evaluate(INSPECT,copy_id)
        (OUT/'restored-relationships.json').write_text(json.dumps(observed,ensure_ascii=False,indent=2),encoding='utf-8')
        actual_refs=[{k:r[k] for k in ['activityId','recordPath','sourcePath']} for r in observed['rows']]
        canonical=lambda rows: sorted(json.dumps(r,ensure_ascii=False,sort_keys=True) for r in rows)
        assert canonical(actual_refs)==canonical(expected['refs']),actual_refs
        for row in observed['rows']:
            assert row['text']==expected['files'][row['sourcePath']],row
        passed('只复制备份目录即可恢复全部历史文件，实际重开内容且无跨活动或跨轮次挂接')
        old=next(r for r in observed['rounds'] if r['activityId']=='a')
        assert old['old']=='passed' and old['feedback']=='只作用旧轮' and old['feedbackBytes']=='旧轮反馈附件',old
        assert [h['summary'] for h in observed['history']]==['保留首审结论','保留复审结论']
        assert all(h['state']=='saved' and h['paths'] for h in observed['history']),observed['history']
        passed('品牌通过、原轮反馈及附件、首审复审结论保留，历史归档只指向恢复所得文件')
        result=restored.evaluate('id=>probe.backups().run(id)',copy_id)
        assert result['state']=='saved',result
        receipts=restored.evaluate("async()=>new Promise((ok,no)=>{const q=probe.db().transaction('integrations').objectStore('integrations').getAll();q.onsuccess=()=>ok(q.result.filter(r=>r.kind==='restored-output').map(r=>r.status));q.onerror=()=>no(q.error);})")
        assert len(receipts)==len(expected['refs']) and all(s=='saved' for s in receipts),receipts
        passed('注入恢复回执清理中断，已落地文件与完成标记一起保存，后续备份不重复收录')
        round_trip=restored.evaluate("""async id=>{const {discoverProjectBackups,readProjectBackup}=await import('./project-backup.js'),root=await navigator.storage.getDirectory(),entry=(await discoverProjectBackups(root)).find(x=>x.projectId===id),data=(await readProjectBackup(entry.directory)).data;return {count:data.artifacts.length,refs:data.artifacts.map(a=>({docId:a.docId,recordPath:a.recordPath||[],path:a.path})),library:await data.libraryAssets[0].file.originalFile.text()};}""",copy_id)
        assert round_trip['count']==len(expected['refs']) and round_trip['library']=='共用资料原文',round_trip
        passed('恢复副本再次自动备份可完整回读，不再访问旧机器的历史路径')
        restored.reload()
        restored.wait_for_function('!!window.probe&&!!probe.db()&&probe.state().tasks.length===2')
        refreshed=restored.evaluate(INSPECT,copy_id)
        assert canonical(refreshed['rows'])==canonical(observed['rows'])
        passed('刷新后各历史文件及所属关系持久保持，已有项目仍保留')
        restored.evaluate("async id=>probe.chooseBackupFolder(id,await navigator.storage.getDirectory())",copy_id)
        choices=restored.locator('#backup-restore-choice option').evaluate_all('(options)=>options.map(o=>({value:o.value,text:o.textContent}))')
        choice=next(o for o in choices if '恢复副本' in o['text'])
        restored.locator('#backup-restore-choice').select_option(choice['value'])
        restored.locator('[data-action=backup-restore-confirm]').click()
        restored.wait_for_function("probe.state().settings.projects.length===3&&document.querySelector('#toast').textContent.includes('项目已恢复')",timeout=30000)
        second_id=restored.evaluate('probe.state().settings.selected')
        second=restored.evaluate(INSPECT,second_id)
        assert len(second['rows'])==len(expected['refs'])
        assert canonical([{'activityId':r['activityId'],'recordPath':r['recordPath'],'text':r['text']} for r in second['rows']])==canonical([{'activityId':r['activityId'],'recordPath':r['recordPath'],'text':r['text']} for r in observed['rows']])
        assert restored.evaluate('id=>probe.backups().run(id)',second_id)['state']=='saved'
        passed('连续恢复始终另建项目，第二次副本仍保留原轮与历史审核的文件关系')
        stable=restored.evaluate(r'''async entries=>{const root=await navigator.storage.getDirectory();for(const row of entries){let dir=root;for(const name of row.parts.slice(0,-1))dir=await dir.getDirectoryHandle(name);const bytes=await(await(await dir.getFileHandle(row.parts.at(-1))).getFile()).arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(hash!==row.sha256)return false;}return true;}''',original_hashes)
        assert stable
        passed('两次恢复与自动备份后，源备份所有文件逐份SHA-256保持')
        restored.evaluate("async id=>probe.chooseBackupFolder(id,await navigator.storage.getDirectory())",second_id)
        choices=restored.locator('#backup-restore-choice option').evaluate_all('(options)=>options.map(o=>({value:o.value,text:o.textContent}))')
        source_choice=next(o for o in choices if '恢复副本' not in o['text'])
        restored.locator('#backup-restore-choice').select_option(source_choice['value'])
        restored.evaluate(r'''()=>{const put=IDBObjectStore.prototype.put;window.interruptRestore=true;IDBObjectStore.prototype.put=function(value,...args){if(window.interruptRestore&&this.name==='integrations'&&value.kind==='restored-output'&&value.status==='saved'){window.interruptRestore=false;throw Error('synthetic restore transaction interrupted');}return put.call(this,value,...args);};}''')
        restored.locator('[data-action=backup-restore-confirm]').click()
        restored.wait_for_function("probe.state().settings.projects.length===4&&document.querySelector('#modal-root').textContent.includes('synthetic restore transaction interrupted')")
        interrupted_id=restored.evaluate('probe.state().settings.selected')
        interrupted=restored.evaluate("""async id=>{const q=await new Promise((ok,no)=>{const r=probe.db().transaction('integrations').objectStore('integrations').getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});return {outputs:probe.state().tasks.filter(d=>d.projectId===id).flatMap(d=>d.restoredOutputs||[]).length,rows:q.filter(r=>r.kind==='restored-output'&&r.projectId===id).map(r=>({status:r.status,path:r.savedPath}))};}""",interrupted_id)
        assert interrupted['outputs']==0 and len(interrupted['rows'])==len(expected['refs'])
        assert all(r.get('status')!='saved' for r in interrupted['rows'])
        saved_before=next(r['path'] for r in interrupted['rows'] if r.get('path'))
        passed('注入恢复事务中断时，记录关联和完成标记一起回滚，已写文件路径保留供续办')
        restored.reload()
        restored.wait_for_function('!!window.probe&&!!probe.db()&&probe.state().tasks.length===6')
        resumed=restored.evaluate(INSPECT,interrupted_id)
        assert len(resumed['rows'])==len(expected['refs']),resumed
        file_state=restored.evaluate("""async arg=>{const docs=probe.state().tasks.filter(d=>d.projectId===arg.id),refs=[];const walk=(d,activityId)=>{refs.push(...(d.restoredOutputs||[]).map(r=>({...r,activityId})));for(const key of ['rounds','aiHistory'])for(const c of d[key]||[])walk(c,activityId);};docs.forEach(d=>walk(d,d.activityId));const owner=refs.find(r=>r.path===arg.path);let dir=await navigator.storage.getDirectory();for(const part of arg.path.split('/').slice(0,-1))dir=await dir.getDirectoryHandle(part);let count=0;for await(const h of dir.values())if(h.kind==='file')count++;return {reused:!!owner,activityId:owner?.activityId,filesInDocument:count};}""",{'id':interrupted_id,'path':saved_before})
        expected_file_count=sum(ref['activityId']==file_state.get('activityId') for ref in expected['refs'])
        assert expected_file_count>0 and file_state=={'reused':True,'activityId':file_state['activityId'],'filesInDocument':expected_file_count},file_state
        pending=restored.evaluate("async id=>new Promise((ok,no)=>{const q=probe.db().transaction('integrations').objectStore('integrations').getAll();q.onsuccess=()=>ok(q.result.filter(r=>r.kind==='restored-output'&&r.projectId===id).length);q.onerror=()=>no(q.error);})",interrupted_id)
        assert pending==0
        assert restored.evaluate('id=>probe.backups().run(id)',interrupted_id)['state']=='saved'
        passed('重开后自动续办未完成恢复，复用已写文件且不重复归档原件，完成回执可清理')
        restored.set_viewport_size({'width':390,'height':844})
        restored.screenshot(path=str(OUT/'restored-narrow.png'),full_page=True)
        assert restored.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert not errors,errors
        passed('桌面及390px画面无新增步骤、横向溢出或脚本错误')
        (OUT/'result.json').write_text(json.dumps({'ok':True,'checks':checks,'errors':errors,'environment':environment,'realFeishuWrites':0,'externalDirectoryGrant':False,'archiveFiles':len(expected_paths),'archiveReferences':len(expected['refs'])},ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()
except Exception:
    (OUT/'failure.json').write_text(json.dumps({'ok':False,'checks':checks,'errors':errors,'environment':environment,'traceback':traceback.format_exc()},ensure_ascii=False,indent=2),encoding='utf-8')
    raise
finally:
    server.shutdown()
