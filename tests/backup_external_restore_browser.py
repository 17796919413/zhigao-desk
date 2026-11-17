"""Restore an explicitly selected synthetic external backup in a fresh Edge profile.

The human completes the native directory chooser and browser permission prompt.
No permission API, file handle, IndexedDB, or on-disk backup is replaced.
"""
from pathlib import Path
import functools, hashlib, http.server, json, os, threading, time, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['ZHIGAO_VERIFY_OUT']).resolve()
OUT.mkdir(parents=True, exist_ok=False)
SOURCE = Path(os.environ['ZHIGAO_EXTERNAL_DIRECTORY']).resolve()
assert (SOURCE / '测试目录说明.txt').read_text(encoding='utf-8') == '知稿合成测试目录，请勿放入业务资料。'
SOURCE_HASHES = {str(p.relative_to(SOURCE)): hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCE.rglob('*') if p.is_file()}
SOURCE_MANIFESTS = [json.loads(p.read_text(encoding='utf-8')) for p in SOURCE.glob('知稿项目备份-*/latest.json')]
assert len(SOURCE_MANIFESTS) == 1 and SOURCE_MANIFESTS[0]['payload']['projectId'] == 'external-p'
(OUT / 'source-before.json').write_text(json.dumps(SOURCE_HASHES, ensure_ascii=False, indent=2), encoding='utf-8')
PROBE = r'''
window.externalRestore={db:()=>db,state:()=>({settings,tasks,items}),folder:id=>folders.get(id),backups:()=>projectBackups,
 showRules:()=>{page='rules';render();},
 baseline:()=>{page='rules';render();settings=migrateReviewTable(settings).settings;localStorage.setItem('zhigao-settings-v1',JSON.stringify(settings));return settings.projects;}};
'''
class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args):
        pass
    def do_GET(self):
        if self.path.split('?')[0] == '/app.js':
            data = ((ROOT / 'app.js').read_text(encoding='utf-8') + PROBE).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

http.server.ThreadingHTTPServer.request_queue_size = 128
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
checks, errors = [], []
browser_version = None
phase = 'starting'
def report(next_phase, **extra):
    global phase
    phase = next_phase
    value = {'phase': phase, 'directory': str(SOURCE), 'origin': origin, 'checks': checks, 'errors': errors, **extra}
    (OUT / 'progress.json').write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(value, ensure_ascii=False), flush=True)
def passed(name):
    checks.append(name)
    report(phase)

try:
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(str(OUT / 'fresh-edge-profile'), channel='msedge', headless=False, viewport={'width': 1440, 'height': 1000})
        browser_version = context.browser.version
        context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
        page = context.pages[0] if context.pages else context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(origin)
        page.wait_for_function('!!window.externalRestore && !!externalRestore.db()')
        assert not page.evaluate('externalRestore.state().tasks.length')
        original_projects = page.evaluate('externalRestore.baseline()')
        (OUT / 'existing-projects-before.json').write_text(json.dumps(original_projects, ensure_ascii=False, indent=2), encoding='utf-8')
        passed('全新Edge配置没有旧浏览器记录，实际磁盘源备份与所有文件摘要独立读取')
        page.evaluate('externalRestore.showRules()')
        page.locator('[data-action=folder-pick]').click()
        report('waiting-native-directory', message='请本人在Windows目录选择框选中给定合成目录并允许编辑。其余恢复步骤由测试完成。')
        deadline = time.monotonic() + int(os.environ.get('ZHIGAO_MANUAL_TIMEOUT', '900'))
        while not page.locator('[data-action=backup-restore-confirm]').count():
            if time.monotonic() >= deadline:
                raise RuntimeError('本人尚未完成目录选择，未声称实际恢复通过。')
            page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / 'restore-choice-desktop.png'), full_page=True)
        passed('本人正常选择真实外部目录，原生权限授权后发现原项目备份')
        page.locator('[data-action=backup-restore-confirm]').click()
        page.wait_for_function("externalRestore.state().tasks.length===2&&document.querySelector('#toast').textContent.includes('项目已恢复')", timeout=30000)
        restored_id = page.evaluate('externalRestore.state().settings.selected')
        assert restored_id != 'external-p'
        projects = page.evaluate('externalRestore.state().settings.projects')
        (OUT / 'projects-after-restore.json').write_text(json.dumps(projects, ensure_ascii=False, indent=2), encoding='utf-8')
        assert [p for p in projects if p['id'] != restored_id] == original_projects
        passed('恢复为独立新项目，原本配置保留，两个活动及两份稿件真实导入IndexedDB')
        saved = page.evaluate('id=>externalRestore.backups().run(id)', restored_id)
        assert saved['state'] == 'saved', saved
        details = page.evaluate("""async id=>{
 const m=await import('./project-backup.js'),root=externalRestore.folder(id),dir=await root.getDirectoryHandle(await m.backupDirectoryName(id)),r=await m.readProjectBackup(dir),original=[];
 for(const d of r.data.docs){let sub=root;const parts=d.originalSaved.split('/');for(const p of parts.slice(0,-1))sub=await sub.getDirectoryHandle(p);original.push(await(await(await sub.getFileHandle(parts.at(-1))).getFile()).text());}
 return{projectId:r.projectId,activities:r.data.projects[0].activities.length,docs:r.data.docs.map(d=>({round:d.flow.round,current:d.cells[0].current,old:new TextDecoder().decode(d.rounds[0].buffer),feedback:d.brandFeedback[0].text,oldState:d.rounds[0].flow.state})),original,artifacts:r.data.artifacts.length};
}""", restored_id)
        assert details['activities'] == 2 and len(details['docs']) == 2 and details['projectId'] == restored_id
        assert all(d['round'] == 2 and d['old'].startswith('旧轮原文') and d['feedback'] == '合成本轮反馈' and d['oldState'] == 'passed' for d in details['docs'])
        assert sorted(details['original']) == ['合成原文a', '合成原文b'] and details['artifacts'] >= 2
        (OUT / 'restored-details.json').write_text(json.dumps(details, ensure_ascii=False, indent=2), encoding='utf-8')
        passed('恢复原件逐份从Windows外部目录重开，保留第二轮、旧轮品牌通过事实及本轮反馈')
        assert saved['path'] in [p.name for p in SOURCE.iterdir() if p.is_dir()]
        after = {str(p.relative_to(SOURCE)): hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCE.rglob('*') if p.is_file()}
        assert all(after.get(name) == value for name, value in SOURCE_HASHES.items())
        (OUT / 'source-after.json').write_text(json.dumps(after, ensure_ascii=False, indent=2), encoding='utf-8')
        passed('恢复副本自动备份到新目录；源备份及原归档逐文件SHA-256保持')
        page.screenshot(path=str(OUT / 'restored-desktop.png'), full_page=True)
        page.reload()
        page.wait_for_function('!!window.externalRestore && !!externalRestore.db() && externalRestore.state().tasks.length===2')
        assert page.evaluate('externalRestore.state().settings.selected') == restored_id
        assert page.evaluate('async id=>externalRestore.folder(id).queryPermission({mode:"readwrite"})', restored_id) == 'granted'
        assert page.evaluate('id=>externalRestore.backups().run(id)', restored_id)['state'] == 'saved'
        passed('新配置刷新后目录句柄与独立项目持久保持，自动备份可继续')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path=str(OUT / 'restored-narrow.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert not errors, errors
        passed('实际桌面与390px恢复页面无横向溢出或脚本错误')
        report('complete')
        context.close()
except Exception:
    errors.append(traceback.format_exc())
    report('failed')
finally:
    server.shutdown()
    server.server_close()
    (OUT / 'result.json').write_text(json.dumps({'ok': phase == 'complete' and not errors, 'checks': checks, 'errors': errors, 'browser': browser_version, 'source': str(SOURCE), 'nativeDirectory': True, 'freshBrowserProcessAndProfile': True, 'modelReview': 'synthetic', 'realRemoteWrites': 0}, ensure_ascii=False, indent=2), encoding='utf-8')
raise SystemExit(1 if errors else 0)
