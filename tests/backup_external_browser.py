"""Manual-assisted native Edge directory test. Never grants permissions for the user."""
from pathlib import Path
import functools, hashlib, http.server, json, os, threading, time, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['ZHIGAO_VERIFY_OUT']).resolve()
OUT.mkdir(parents=True, exist_ok=False)
SOURCE = Path(os.environ['ZHIGAO_EXTERNAL_SOURCE']).resolve() if os.environ.get('ZHIGAO_EXTERNAL_SOURCE') else None
SOURCE_STATE = json.loads((SOURCE / 'progress.json').read_text(encoding='utf-8')) if SOURCE else None
SANDBOX = Path(SOURCE_STATE['directory']) if SOURCE else OUT / '外部目录-仅合成验收'
if not SOURCE:
    SANDBOX.mkdir()
SENTINEL = '知稿合成测试目录，请勿放入业务资料。'
if not SOURCE:
    (SANDBOX / '测试目录说明.txt').write_text(SENTINEL, encoding='utf-8')
checks, errors = [], []
phase = None

def report(next_phase, **extra):
    global phase
    phase = next_phase
    value = {'phase': phase, 'checks': checks, 'errors': errors, 'directory': str(SANDBOX), 'origin': origin, **extra}
    (OUT / 'progress.json').write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(value, ensure_ascii=False), flush=True)

def passed(name):
    checks.append(name)
    report(phase)

class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args):
        pass
    def do_GET(self):
        if self.path.split('?')[0] == '/app.js':
            probe = '''
window.externalProbe={
 db:()=>db,state:()=>({settings,tasks,items}),backups:()=>projectBackups,show:next=>{page=next;render();},
 folder:()=>folders.get('external-p'),permission:()=>folderState(folders.get('external-p')),
 setup:async()=>{
  settings={selected:'external-p',projects:[{id:'external-p',name:'外部目录合成验收',status:'active',selectedActivity:'a',activities:[{id:'a',name:'秋季活动'},{id:'b',name:'冬季活动'}],rules:[],library:[]}]};
  localStorage.setItem('zhigao-settings-v1',JSON.stringify(settings));
  const rows=[];
  for(const id of ['a','b']){
   const it={id:'external-i'+id,projectId:'external-p',activityId:id,kind:'图文',author:'合成达人',platform:'小红书',title:'内容'+id};
   const t={id:'external-d'+id,itemId:it.id,projectId:'external-p',activityId:id,projectName:'外部目录合成验收',fmt:'text',kind:'图文',author:'合成达人',platform:'小红书',stage:'初稿',filename:'合成稿件'+id+'.txt',cells:[{id:'c',original:'合成原文'+id,current:'合成原文'+id}],flow:{state:'review',round:2},rounds:[{id:'old'+id,filename:'旧轮.txt',buffer:new TextEncoder().encode('旧轮原文'+id).buffer,cells:[],flow:{state:'passed',round:1}}],brandFeedback:[{id:'f'+id,round:2,text:'合成本轮反馈'}],rules:[],findings:[]};
   rows.push(['items',it],['tasks',t]);
  }
  await commitWorkbench(rows);page='rules';render();
 },
 edit:async text=>{const t=tasks.find(t=>t.id==='external-da');await commitWorkbench([['tasks',{...t,cells:[{...t.cells[0],current:text}]}]]);},
 verify:async()=>{const m=await import('./project-backup.js'),found=await m.discoverProjectBackups(folders.get('external-p')),r=await m.readProjectBackup(found.find(x=>x.projectId==='external-p').directory);return{docs:r.data.docs.length,items:r.data.items.length,current:r.data.docs.find(t=>t.id==='external-da').cells[0].current,old:new TextDecoder().decode(r.data.docs[0].rounds[0].buffer),feedback:r.data.docs[0].brandFeedback[0].text};}
};
'''
            data = ((ROOT / 'app.js').read_text(encoding='utf-8') + probe).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

http.server.ThreadingHTTPServer.request_queue_size = 128
http.server.ThreadingHTTPServer.daemon_threads = True
source_origin = os.environ.get('ZHIGAO_EXTERNAL_ORIGIN') or (json.loads((SOURCE / 'result.json').read_text(encoding='utf-8')).get('origin') if SOURCE else None)
source_port = int(source_origin.rsplit(':', 1)[1]) if source_origin else 0
server = http.server.ThreadingHTTPServer(('127.0.0.1', source_port), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
browser_version = None
native_granted = False
revocation_tested = False
restore_tested = False

def wait_native(page, condition, waiting_phase, message):
    report(waiting_phase, origin=origin, browser=browser_version, message=message)
    deadline = time.monotonic() + int(os.environ.get('ZHIGAO_MANUAL_TIMEOUT', '900'))
    while not page.evaluate(condition):
        if (OUT / 'stop-requested.txt').exists() or time.monotonic() >= deadline:
            raise RuntimeError('本人操作尚未完成；超时不是同意或通过。')
        page.wait_for_timeout(700)

def disk_hashes():
    return {str(p.relative_to(SANDBOX)): hashlib.sha256(p.read_bytes()).hexdigest() for p in SANDBOX.rglob('*') if p.is_file() and p.relative_to(SANDBOX).parts[0].startswith('知稿项目备份-')}

try:
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(str((SOURCE or OUT) / 'isolated-edge-profile'), channel='msedge', headless=False, viewport={'width': 1440, 'height': 1000})
        browser_version = context.browser.version if context.browser else None
        context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
        page = context.pages[0] if context.pages else context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(origin)
        page.wait_for_function('!!window.externalProbe && !!externalProbe.db()')
        if SOURCE:
            assert page.evaluate("externalProbe.state().settings.projects.some(p=>p.id==='external-p')")
            page.evaluate("externalProbe.show('rules')")
        else:
            page.evaluate('externalProbe.setup()')
        page.screenshot(path=str(OUT / 'before-directory-desktop.png'), full_page=True)
        if not SOURCE:
            page.locator('[data-action=folder-pick]').click()
        report('waiting-native-directory', origin=origin, browser=browser_version, message='请本人在隔离Edge选择指定合成测试目录，并确认浏览器的编辑授权。测试不会自动确认权限。')
        deadline = time.monotonic() + int(os.environ.get('ZHIGAO_MANUAL_TIMEOUT', '900'))
        while not page.evaluate("!!externalProbe.folder() && externalProbe.permission().then(x=>x==='granted')"):
            if (OUT / 'stop-requested.txt').exists():
                report('blocked-native-directory', reason='本人目录选择尚未完成；保留可重跑验收入口。')
                break
            if time.monotonic() >= deadline:
                report('blocked-native-directory', reason='未观察到实际目录授权；超时不是同意或通过。')
                break
            page.wait_for_timeout(700)
        else:
            selected = page.evaluate("async()=>({name:externalProbe.folder().name,sentinel:await(await(await externalProbe.folder().getFileHandle('测试目录说明.txt')).getFile()).text(),permission:await externalProbe.permission()})")
            assert selected['name'] == SANDBOX.name and selected['sentinel'] == SENTINEL and selected['permission'] == 'granted', selected
            native_granted = True
            passed('通过正常选择本地文件夹入口取得真实外部目录读写授权，未替换句柄或权限API')
            page.wait_for_function("JSON.parse(localStorage.getItem('zhigao-backup-status-v1')||'{}')['external-p']?.state==='saved'", timeout=30000)
            observed = page.evaluate('externalProbe.verify()')
            assert observed['docs'] == 2 and observed['items'] == 2 and observed['old'].startswith('旧轮原文') and observed['feedback'] == '合成本轮反馈', observed
            manifests = list(SANDBOX.glob('知稿项目备份-*/latest.json'))
            assert len(manifests) == 1
            committed = json.loads(manifests[0].read_text(encoding='utf-8'))
            assert committed['payload']['projectId'] == 'external-p'
            passed('浏览器直接写入Windows外部目录，Python独立回读索引；双活动旧轮与反馈完整')
            page.evaluate("externalProbe.edit('外部目录修改后')")
            saved = page.evaluate("externalProbe.backups().run('external-p')")
            assert saved['state'] == 'saved', saved
            assert page.evaluate('externalProbe.verify()')['current'] == '外部目录修改后'
            page.screenshot(path=str(OUT / 'external-saved-desktop.png'), full_page=True)
            passed('记录变化自动备份后原生目录回读正确，仅一个已提交最新索引')
            if os.environ.get('ZHIGAO_TEST_NATIVE_REVOKE') == '1':
                wait_native(page, "async()=>!!externalProbe.folder()&&await externalProbe.permission()!=='granted'", 'waiting-native-revocation', '请本人通过Edge地址栏的文件访问图标移除本测试目录权限。知稿的“取消关联”仅删除项目关联，不能代替该操作。')
                before = manifests[0].read_bytes()
                page.evaluate("externalProbe.edit('实际权限失效后的待保存内容')")
                denied = page.evaluate("externalProbe.backups().run('external-p')")
                assert denied['state'] == 'stale'
                assert page.locator('[data-action=folder-grant]').count() == 1
                assert manifests[0].read_bytes() == before
                revocation_tested = True
                page.screenshot(path=str(OUT / 'native-permission-denied.png'), full_page=True)
                passed('本人实际撤销Edge目录权限后备份标未更新、出现原有重授入口且磁盘最新索引保持')
                wait_native(page, "async()=>await externalProbe.permission()==='granted'", 'waiting-native-regrant', '请点击知稿原有“重新授权”，本人确认Edge的编辑权限。')
                page.wait_for_function("async()=>{await externalProbe.backups().run('external-p');return(await externalProbe.verify()).current==='实际权限失效后的待保存内容';}", timeout=30000)
                passed('本人重授真实外部目录后自动补存原任务，Windows磁盘备份回读为待保存内容')
            page.reload()
            page.wait_for_function('!!window.externalProbe && !!externalProbe.db()')
            reopened = page.evaluate('externalProbe.permission()')
            if reopened == 'granted':
                assert page.evaluate('externalProbe.verify()')['current'] == ('实际权限失效后的待保存内容' if revocation_tested else '外部目录修改后')
                passed('刷新后IndexedDB原生目录句柄仍可读取已提交备份')
            else:
                assert reopened in ('prompt', 'denied')
                assert page.locator('[data-action=folder-grant]').count() == 1
                passed('刷新后实际权限需重授时显示现有重新授权入口，未伪报可写')
            page.set_viewport_size({'width': 390, 'height': 844})
            page.screenshot(path=str(OUT / 'external-saved-narrow.png'), full_page=True)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            assert not errors, errors
            disk_files = [{'path': str(p.relative_to(SANDBOX)), 'size': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in SANDBOX.rglob('*') if p.is_file()]
            (OUT / 'external-files.json').write_text(json.dumps(disk_files, ensure_ascii=False, indent=2), encoding='utf-8')
            if os.environ.get('ZHIGAO_TEST_EXTERNAL_RESTORE') == '1':
                page.evaluate("externalProbe.backups().run('external-p')")
                source_hashes = disk_hashes()
                context.close()
                context = pw.chromium.launch_persistent_context(str(OUT / 'restore-edge-profile'), channel='msedge', headless=False, viewport={'width': 1440, 'height': 1000})
                context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
                page = context.pages[0] if context.pages else context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin)
                page.wait_for_function('!!window.externalProbe && !!externalProbe.db()')
                assert not page.evaluate('externalProbe.state().tasks.length')
                page.evaluate("externalProbe.show('rules')")
                page.locator('[data-action=folder-pick]').click()
                wait_native(page, "!!document.querySelector('[data-action=backup-restore-confirm]')", 'waiting-native-restore-directory', '这是全新的隔离Edge配置。请本人选同一个合成测试目录并授权；出现“发现项目备份”后测试会继续。')
                page.screenshot(path=str(OUT / 'native-restore-choice.png'), full_page=True)
                page.locator('[data-action=backup-restore-confirm]').click()
                page.wait_for_function("externalProbe.state().tasks.length===2&&document.querySelector('#toast').textContent.includes('项目已恢复')", timeout=30000)
                restored_id = page.evaluate('externalProbe.state().settings.selected')
                assert restored_id != 'external-p'
                saved = page.evaluate('id=>externalProbe.backups().run(id)', restored_id)
                assert saved['state'] == 'saved', saved
                assert disk_hashes().items() >= source_hashes.items()
                assert all(disk_hashes().get(key) == value for key, value in source_hashes.items())
                restored = page.evaluate("async id=>{const m=await import('./project-backup.js'),root=(await new Promise((ok,no)=>{const q=externalProbe.db().transaction('folders').objectStore('folders').get(id);q.onsuccess=()=>ok(q.result.handle);q.onerror=()=>no(q.error)})),dir=await root.getDirectoryHandle(await m.backupDirectoryName(id)),r=await m.readProjectBackup(dir);let original=0;for(const d of r.data.docs){if(d.originalSaved){let sub=root;const parts=d.originalSaved.split('/');for(const p of parts.slice(0,-1))sub=await sub.getDirectoryHandle(p);const text=await(await(await sub.getFileHandle(parts.at(-1))).getFile()).text();if(text.startsWith('合成原文'))original++;}}return{docs:r.data.docs.length,original,round:r.data.docs[0].flow.round,old:new TextDecoder().decode(r.data.docs[0].rounds[0].buffer),artifacts:r.data.artifacts.length};}", restored_id)
                assert restored['docs'] == 2 and restored['original'] == 2 and restored['round'] == 2 and restored['old'].startswith('旧轮原文') and restored['artifacts'] >= 2, restored
                restore_tested = True
                passed('独立Edge进程及全新配置从真实外部目录恢复为新项目，原件逐份重开、旧轮与反馈保留，源备份逐文件摘要保持')
                page.set_viewport_size({'width': 390, 'height': 844})
                page.screenshot(path=str(OUT / 'native-restored-narrow.png'), full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            report('complete', browser=browser_version)
        context.close()
except Exception:
    errors.append(traceback.format_exc())
    report('failed')
finally:
    server.shutdown()
    server.server_close()
    (OUT / 'result.json').write_text(json.dumps({'ok': phase == 'complete' and not errors, 'phase': phase, 'checks': checks, 'errors': errors, 'browser': browser_version, 'origin': origin, 'nativeDirectoryGranted': native_granted, 'permissionRevocationTested': revocation_tested, 'nativeIndependentRestore': restore_tested, 'realRemoteWrites': 0}, ensure_ascii=False, indent=2), encoding='utf-8')
raise SystemExit(1 if errors else 0)
