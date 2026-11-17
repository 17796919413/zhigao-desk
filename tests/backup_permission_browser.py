"""Edge/IndexedDB/OPFS regression. Permission responses are explicitly synthetic."""
from pathlib import Path
import functools, http.server, json, os, threading, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['ZHIGAO_VERIFY_OUT'])
OUT.mkdir(parents=True, exist_ok=False)
PROBE = r'''
window.probe={db:()=>db,state:()=>({settings,tasks,items}),backups:()=>projectBackups,
 actions,folders,folderStates,connectBackupFolder,refreshFolderStates,
 initialize:async()=>{
  settings={selected:'permissions-p',projects:[{id:'permissions-p',name:'权限合成验收',status:'active',rules:[],library:[]}]};
  localStorage.setItem('zhigao-settings-v1',JSON.stringify(settings));
  await commitWorkbench([['items',{id:'permissions-i',projectId:'permissions-p',activityId:'legacy',kind:'图文',author:'合成达人',platform:'小红书',title:'合成内容'}],['tasks',{id:'permissions-d',itemId:'permissions-i',projectId:'permissions-p',activityId:'legacy',projectName:'权限合成验收',fmt:'text',stage:'初稿',filename:'合成原文.txt',cells:[{id:'c',original:'原文',current:'原文'}],flow:{state:'review',round:1},rules:[],findings:[]}]]);
  page='home';render();
 },
 root:async()=>{const h=await navigator.storage.getDirectory();Object.defineProperties(h,{queryPermission:{value:async()=>window.syntheticPermission||'granted'},requestPermission:{value:async()=>{window.permissionRequests=(window.permissionRequests||0)+1;window.syntheticPermission='granted';return'granted';}}});return h;},
 edit:async text=>{const t=tasks.find(t=>t.id==='permissions-d');await commitWorkbench([['tasks',{...t,cells:[{...t.cells[0],current:text}]}]]);},
 manifest:async()=>{const m=await import('./project-backup.js'),dir=await folders.get('permissions-p').getDirectoryHandle(await m.backupDirectoryName('permissions-p'));return(await(await dir.getFileHandle('latest.json')).getFile()).text();},
 read:async()=>{const m=await import('./project-backup.js'),dir=await folders.get('permissions-p').getDirectoryHandle(await m.backupDirectoryName('permissions-p'));return(await m.readProjectBackup(dir)).data.docs[0].cells[0].current;}
};
'''
class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args):
        pass
    def do_GET(self):
        if self.path.split('?')[0] == '/app.js':
            body = ((ROOT / 'app.js').read_text(encoding='utf-8') + PROBE).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

http.server.ThreadingHTTPServer.request_queue_size = 128
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
checks, errors = [], []
def passed(name):
    checks.append(name)
    print('PASS ' + name, flush=True)
    (OUT / 'progress.json').write_text(json.dumps({'checks': checks, 'errors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}')
        page.wait_for_function('!!window.probe && !!probe.db()')
        page.evaluate('probe.initialize()')
        page.evaluate("async()=>probe.connectBackupFolder('permissions-p',await probe.root())")
        assert page.evaluate("probe.backups().run('permissions-p')")['state'] == 'saved'
        baseline = page.evaluate('probe.manifest()')
        passed('初始备份确实写入并回读；权限模拟只包住OPFS根句柄')
        page.evaluate("async()=>{window.syntheticPermission='denied';await probe.edit('失去权限后的修改');}")
        result = page.evaluate("probe.backups().run('permissions-p')")
        observed = page.evaluate("()=>({state:probe.folderStates.get('permissions-p'),grant:!!document.querySelector('[data-action=folder-grant]'),pick:!!document.querySelector('[data-action=folder-pick]'),requests:window.permissionRequests||0,status:document.querySelector('[data-backup-status]')?.textContent})")
        (OUT / 'permission-observed.json').write_text(json.dumps({'result': result, 'observed': observed}, ensure_ascii=False, indent=2), encoding='utf-8')
        page.screenshot(path=str(OUT / 'denied-desktop.png'), full_page=True)
        assert result['state'] == 'stale' and observed['state'] == 'denied' and observed['grant'] and not observed['pick'], observed
        assert observed['requests'] == 0 and observed['status'] == '备份未更新', observed
        assert page.evaluate('probe.manifest()') == baseline
        passed('权限失效及时切换现有授权并补存入口，不弹后台授权，不覆盖最后可用备份')
        page.locator('[data-action=folder-grant]').click()
        page.wait_for_function("probe.folderStates.get('permissions-p')==='granted'&&document.querySelector('[data-action=folder-pick]')")
        assert page.evaluate("probe.backups().run('permissions-p')")['state'] == 'saved'
        assert page.evaluate('probe.read()') == '失去权限后的修改'
        assert page.evaluate('window.permissionRequests') == 1
        passed('点击原有授权入口后续办原件与自动备份，待保存内容完整且仅申请一次')
        page.locator('[data-page=rules]').first.click()
        page.locator('.note-box summary').click()
        note = page.locator('#project-notes')
        note.fill('尚未保存的笔记必须保持')
        page.evaluate("()=>{window.noteBefore=document.querySelector('#project-notes');window.noteBefore.setSelectionRange(3,7);window.syntheticPermission='denied';}")
        assert page.evaluate("probe.backups().run('permissions-p')")['state'] == 'stale'
        assert note.input_value() == '尚未保存的笔记必须保持'
        assert page.evaluate("window.noteBefore===document.querySelector('#project-notes')&&noteBefore.selectionStart===3&&noteBefore.selectionEnd===7")
        assert page.locator('.folder-card [data-action=folder-grant]').count() == 1
        page.screenshot(path=str(OUT / 'dirty-note-denied.png'), full_page=True)
        passed('品牌页仅刷新目录控件，未保存笔记的原DOM、文字与选择范围保持')
        page.locator('[data-action=new-project]').click()
        name = page.locator('#project-name')
        if not name.count():
            name = page.locator('#modal-root input').first
        name.fill('弹窗未保存输入')
        page.evaluate("()=>{window.syntheticPermission='granted';window.modalInput=document.querySelector('#modal-root input');}")
        assert page.evaluate("probe.backups().run('permissions-p')")['state'] == 'saved'
        assert name.input_value() == '弹窗未保存输入'
        assert page.evaluate("window.modalInput===document.querySelector('#modal-root input')")
        passed('目录状态变化不重绘其他弹窗或清除用户输入')
        page.locator('[data-action=close-modal]').last.click()
        page.locator('[data-page=home]').first.click()
        page.evaluate("()=>{window.syntheticPermission='prompt';}")
        page.evaluate("probe.backups().run('permissions-p')")
        assert page.locator('[data-action=folder-grant]').count() == 1
        assert page.evaluate('window.permissionRequests') == 1
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path=str(OUT / 'prompt-narrow.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        passed('需要重授与拒绝状态都保留既有入口，390px页面无横向溢出')
        page.evaluate("async()=>{await probe.edit('恢复焦点后应自动备份');window.syntheticPermission='granted';window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));}")
        page.wait_for_function("probe.folderStates.get('permissions-p')==='granted'&&JSON.parse(localStorage.getItem('zhigao-backup-status-v1'))['permissions-p'].state==='saved'", timeout=30000)
        page.wait_for_function("async()=>await probe.read()==='恢复焦点后应自动备份'", timeout=30000)
        assert page.evaluate('window.permissionRequests') == 1
        passed('返回页面只查询权限，已由本人恢复权限时自动续办并备份，不重复申请')
        before_interrupt = page.evaluate('probe.manifest()')
        page.evaluate("""async()=>{await probe.edit('写入中断后待补存');window.originalWritable=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=function(...args){if(this.name==='staging.json'){window.syntheticPermission='denied';return Promise.reject(new DOMException('synthetic mid-write permission revocation','NotAllowedError'));}return window.originalWritable.apply(this,args);};}""")
        interrupted = page.evaluate("probe.backups().run('permissions-p')")
        page.evaluate('()=>{FileSystemFileHandle.prototype.createWritable=window.originalWritable;}')
        assert interrupted['state'] == 'stale' and page.evaluate("probe.folderStates.get('permissions-p')") == 'denied'
        assert page.locator('[data-action=folder-grant]').count() == 1
        assert page.evaluate('probe.manifest()') == before_interrupt
        passed('写入过程中权限失效也更新现有入口，暂存失败保留上份完整备份')
        page.locator('[data-action=folder-grant]').click()
        assert page.evaluate("probe.backups().run('permissions-p')")['state'] == 'saved'
        page.evaluate("""()=>{const current=probe.folders.get('permissions-p');window.goodRoot=current;const slow={queryPermission:()=>new Promise(resolve=>window.permissionReply=resolve)};probe.folders.set('permissions-p',slow);window.oldCheck=probe.backups().run('permissions-p');}""")
        page.wait_for_function('!!window.permissionReply')
        page.evaluate("()=>{probe.folders.set('permissions-p',window.goodRoot);probe.folderStates.set('permissions-p','granted');window.permissionReply('denied');}")
        page.evaluate('window.oldCheck')
        assert page.evaluate("probe.folderStates.get('permissions-p')") == 'granted'
        assert page.locator('[data-action=folder-grant]').count() == 0
        assert page.evaluate("probe.backups().run('permissions-p')")['state'] == 'saved'
        passed('更换句柄后旧权限查询迟到不能把新目录标为失效，当前备份仍可继续')
        assert not errors, errors
        (OUT / 'result.json').write_text(json.dumps({'ok': True, 'checks': checks, 'errors': errors, 'browser': browser.version, 'permissionResponses': 'synthetic', 'storage': 'real IndexedDB/OPFS', 'nativePermissionRevocation': False, 'realRemoteWrites': 0}, ensure_ascii=False, indent=2), encoding='utf-8')
        browser.close()
except Exception:
    (OUT / 'failure.json').write_text(json.dumps({'ok': False, 'checks': checks, 'errors': errors, 'traceback': traceback.format_exc()}, ensure_ascii=False, indent=2), encoding='utf-8')
    raise
finally:
    server.shutdown()
    server.server_close()
