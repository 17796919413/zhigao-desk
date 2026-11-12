"""Synthetic failure/race checks. No connector, user folders or real Feishu calls."""
import functools, http.server, json, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['ZHIGAO_VERIFY_OUT']) / 'resilience'
OUT.mkdir(parents=True, exist_ok=True)
http.server.ThreadingHTTPServer.request_queue_size = 128
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
checks, errors, pending = [], [], []
def passed(name):
    checks.append(name)
    print('PASS ' + name, flush=True)
def reply(route, title='当前审核表', status=200):
    data = {'ok': True, 'data': {'title': title, 'revision': title, 'sheets': [{'sheetId': 's', 'name': '合作内容', 'headers': ['达人', '发布平台', '合作产品', '大纲'], 'rows': [['合成达人', '小红书', title, '']], 'rowStart': 2}]}}
    if status != 200: data = {'ok': False, 'code': 'TEST_ERROR', 'error': f'隔离测试 HTTP {status}，请重试'}
    route.fulfill(status=status, content_type='application/json', body=json.dumps(data, ensure_ascii=False))
try:
 with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('http://127.0.0.1:47821/**', lambda r: r.abort())
    context.route('**/page/feishu', lambda r: pending.append(r))
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(origin)
    page.wait_for_selector('#agent-chip')
    projects = [{'id': p, 'name': '隔离品牌' + p, 'status': 'active', 'notes': '', 'rules': [], 'library': [], 'feishu': {'reviewTableVersion': 2, 'source': None, 'refined': None, 'sheets': []}} for p in ['A', 'B']]
    page.evaluate("p=>{localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'A',projects:p}));}", projects)
    page.reload()
    page.locator('.navbtn[data-page=feishu]').click()
    def state(): return page.evaluate("JSON.parse(localStorage.getItem('zhigao-settings-v1'))")
    def wait_read():
        for _ in range(100):
            if pending: return pending.pop(0)
            page.wait_for_timeout(30)
        raise AssertionError('No isolated read request')
    def save(token):
        page.locator('#fs-url-refined').fill('https://example.feishu.cn/sheets/' + token)
        page.locator('[data-action=fs-save-link]').click()
        return wait_read()
    first = save('TableA')
    second = save('TableB')
    reply(second, '新链接内容')
    page.wait_for_function("document.querySelector('.review-table')?.textContent.includes('新链接内容')")
    reply(first, '迟到旧内容', 403)
    page.wait_for_timeout(150)
    assert '迟到旧内容' not in page.locator('.content').inner_text()
    assert not page.locator('.table-notice.error').count()
    assert state()['projects'][0]['feishu']['liveMeta']['title'] == '新链接内容'
    passed('换链接后旧失败响应不会覆盖新表内容或错误提示')

    first = save('TableB')
    second = save('TableB')
    reply(second, '较新读取')
    page.wait_for_function("document.querySelector('.review-table')?.textContent.includes('较新读取')")
    reply(first, '过期读取')
    page.wait_for_timeout(150)
    assert state()['projects'][0]['feishu']['liveMeta']['title'] == '较新读取'
    passed('同链接并行读取乱序返回时只接受最新请求')

    def switch(brand):
        page.locator('.navbtn[data-page=rules]').click()
        page.locator('[data-setting=project]').select_option(brand)
        page.locator('.navbtn[data-page=feishu]').click()
    switch('B')
    r = save('TableB'); reply(r, '品牌B内容')
    page.wait_for_function("document.querySelector('.review-table')?.textContent.includes('品牌B内容')")
    switch('A')
    page.locator('[data-action=fs-live-read-all]').click(); r = wait_read()
    switch('B')
    reply(r, '跨品牌迟到内容')
    page.wait_for_timeout(150)
    assert [p['feishu']['liveMeta']['title'] for p in state()['projects']] == ['较新读取', '品牌B内容']
    passed('两个品牌共用链接时，切换品牌后旧请求不串入任何品牌')

    page.evaluate("""()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(window.__quota&&k==='zhigao-settings-v1')throw new DOMException('模拟配额不足','QuotaExceededError');return set.call(this,k,v);};window.__quota=true;}""")
    before = state()
    page.locator('[data-action=fs-live-read-all]').click(); reply(wait_read(), '不可持久化新内容')
    page.wait_for_selector('.table-notice.error')
    assert state() == before
    assert '不可持久化新内容' not in page.locator('.review-table').inner_text()
    page.evaluate('window.__quota=false')
    passed('表格存储失败保留原快照，内存与磁盘一致并显示失败')
    for status in [403, 429, 500]:
        page.locator('[data-action=fs-live-read-all]').click(); reply(wait_read(), status=status)
        page.wait_for_function('s=>document.querySelector(".table-notice.error")?.textContent.includes(String(s))', arg=status)
        assert '品牌B内容' in page.locator('.review-table').inner_text()
    page.locator('[data-action=fs-live-read-all]').click(); reply(wait_read(), '网络恢复内容')
    page.wait_for_function("document.querySelector('.review-table')?.textContent.includes('网络恢复内容')")
    assert not page.locator('.table-notice.error').count()
    passed('权限错误、限流、服务错误保留快照，恢复读取后清除错误')

    page.locator('.navbtn[data-page=rules]').click()
    def upload(name, text):
        page.locator('#lib-input').set_input_files({'name': name, 'mimeType': 'text/plain', 'buffer': text.encode()})
    def count(n): page.wait_for_function('n=>document.querySelectorAll(".asset-row").length===n', arg=n)
    def media_count():
        return page.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});const n=await new Promise(r=>{const q=db.transaction('media').objectStore('media').count();q.onsuccess=()=>r(q.result)});db.close();return n;}""")
    upload('空文件.txt', '')
    page.wait_for_function("document.querySelector('#library-imports').textContent.includes('文件为空')")
    assert not page.locator('.asset-row').count()
    upload('同名资料.txt', '原始全文')
    count(1)
    upload('同名资料.txt', '更新全文')
    page.wait_for_selector('[data-action=lib-import-update]')
    page.evaluate("()=>{const b=document.querySelector('[data-action=lib-import-update]');b.click();b.click();}")
    page.wait_for_function("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[1].library[0].text==='更新全文'")
    d = state()['projects'][1]['library'][0]
    assert len(d['history']) == 1 and d['history'][0]['text'] == '原始全文'
    assert len(state()['projects'][1]['library']) == 1
    passed('空文件拒绝；同名更新重复点击只保存一次并保留旧版本')

    before = state(); originals = media_count()
    page.evaluate('window.__quota=true')
    upload('失败资料.txt', '存储故障资料')
    page.wait_for_function("document.querySelector('#library-imports').textContent.includes('保存失败')")
    assert state() == before and media_count() == originals
    page.evaluate('window.__quota=false')
    passed('导入正文索引存储失败时回收本次数据库原件，不出现虚假成功')

    page.evaluate("""()=>{const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async function(a,b){if(new TextDecoder().decode(b)==='延迟新资料'){window.__digestHeld=true;await new Promise(r=>window.__releaseDigest=r);}return digest(a,b);};}""")
    upload('延迟资料.txt', '延迟新资料')
    page.wait_for_function('window.__digestHeld===true')
    row = page.locator('.asset-row').filter(has_text='同名资料')
    row.locator('summary').click()
    row.locator('[data-lib-title]').fill('用户刚修改的标题')
    row.locator('[data-action=lib-quick-save]').click()
    page.wait_for_function("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[1].library[0].title==='用户刚修改的标题'")
    page.evaluate('window.__releaseDigest()')
    page.wait_for_function("document.querySelector('#library-imports').textContent.includes('保存期间品牌资料已变化')")
    assert len(state()['projects'][1]['library']) == 1
    assert state()['projects'][1]['library'][0]['title'] == '用户刚修改的标题'
    passed('导入等待期间的资料修改不会被旧保存结果覆盖')

    name = '很长的中文资料标题🌿' * 12 + '.pptx'
    upload(name, '非合法压缩文件')
    count(2)
    bad = page.locator('.asset-row').filter(has_text=name)
    assert bad.locator('.tag').inner_text() == '需处理'
    assert '文件结构不完整或已损坏' in bad.inner_text()
    with page.expect_download() as downloaded: bad.locator('[data-action=lib-download]').click()
    assert Path(downloaded.value.path()).read_bytes() == '非合法压缩文件'.encode()
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT / 'long-name-mobile.png'), full_page=True)
    page.set_viewport_size({'width': 1440, 'height': 1000})
    passed('损坏PPTX保留可下载原件且阻断审核；超长中文与emoji文件名手机不溢出')

    page.evaluate('window.showDirectoryPicker=async()=>await navigator.storage.getDirectory()')
    page.locator('[data-action=folder-pick]').click()
    page.wait_for_function('document.querySelector(".folder-card").textContent.includes("已连接")')
    upload('外部原件.txt', '原件初始内容'); count(3)
    page.evaluate("""async()=>{const d=JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects[1].library.find(d=>d.title==='外部原件'),db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)}),f=await new Promise(r=>{const q=db.transaction('media').objectStore('media').get(d.ingestion.assetKey);q.onsuccess=()=>r(q.result.file)}),w=await f.fileHandle.createWritable();await w.write('外部修改后的不同长度原件');await w.close();db.close();window.__externalName=f.fileHandle.name;}""")
    page.locator('.asset-row').filter(has_text='外部原件').locator('[data-action=lib-download]').click()
    page.wait_for_function("document.querySelector('.modal')?.textContent.includes('本地品牌原件已变化')")
    page.locator('.modal [data-action=close-modal]').first.click()
    page.evaluate("async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('品牌资料原件');await dir.removeEntry(window.__externalName);}")
    page.locator('.asset-row').filter(has_text='外部原件').locator('[data-action=lib-download]').click()
    page.wait_for_selector('.modal .error')
    assert page.locator('.modal .error').inner_text()
    page.locator('.modal [data-action=close-modal]').first.click()
    assert len(state()['projects'][1]['library']) == 3
    passed('磁盘原件被修改或删除时明确报错，资料记录不被静默删除')

    # More than one write batch: an uncertain first response must stop later writes.
    page.evaluate("""async()=>{const s=JSON.parse(localStorage.getItem('zhigao-settings-v1')),p=s.projects[1],sheet=p.feishu.sheets.find(s=>s.live),{rowKey}=await import('/feishu.js');sheet.rows=Array.from({length:25},(_,i)=>['批量达人'+i,'小红书','产品','']);window.__batchSheet=sheet;localStorage.setItem('zhigao-settings-v1',JSON.stringify(s));const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});await new Promise((r,j)=>{const tx=db.transaction(['items','tasks'],'readwrite');for(let i=0;i<25;i++){const id='batch-'+i;tx.objectStore('items').put({id,projectId:p.id,author:'批量达人'+i,platform:'小红书',title:'产品',kind:'图文',feishu:{sheetId:sheet.id,key:rowKey(sheet,i)}});tx.objectStore('tasks').put({id:'doc-'+i,itemId:id,projectId:p.id,filename:id+'.txt',fmt:'text',stage:'大纲',cells:[{id:'p',current:'合成稿'}],updated:'2026-11-12',ai:{changes:[],needsSupplement:false},flow:{state:'review',round:1,feedback:[]}});}tx.oncomplete=r;tx.onerror=()=>j(tx.error)});db.close();}""")
    page.reload();page.locator('.navbtn[data-page=feishu]').click()
    page.locator('[data-action=fs-live-prepare-write]').click()
    assert '25 个单元格' in page.locator('.modal').inner_text()
    page.locator('[data-action=fs-write-confirm]').click()
    request=wait_read(); body=json.loads(request.request.post_data)
    assert body['action']=='write' and len(body['writes'])==20
    reply(request,status=500)
    refresh=wait_read();assert json.loads(refresh.request.post_data)['action']=='readAll'
    reply(refresh,'中断后回读')
    page.wait_for_function("document.querySelector('.table-notice.error')?.textContent.includes('已停止后续批次')")
    assert not pending
    passed('25格分批同步首批响应失败后停止余下批次，先回读核对且不自动重试写入')

    # Restore a 25-row source to exercise changing the link mid-write.
    page.locator('[data-action=fs-live-read-all]').click(); request=wait_read()
    rows=[['批量达人'+str(i),'小红书','产品',''] for i in range(25)]
    request.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'data':{'title':'批量审核表','revision':'batch2','sheets':[{'sheetId':'s','name':'合作内容','headers':['达人','发布平台','合作产品','大纲'],'rows':rows,'rowStart':2}]}},ensure_ascii=False))
    page.wait_for_function("document.querySelectorAll('.review-table tbody tr').length===25")
    page.locator('[data-action=fs-live-prepare-write]').click();page.locator('[data-action=fs-write-confirm]').click()
    request=wait_read();assert json.loads(request.request.post_data)['action']=='write'
    changed=save('TableC');reply(changed,'新表不受旧同步影响')
    page.wait_for_function("document.querySelector('.review-table')?.textContent.includes('新表不受旧同步影响')")
    request.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'data':{'results':[{'status':'written'} for _ in range(20)]}}))
    page.wait_for_function("document.querySelector('#toast').textContent.includes('后续批次已停止')")
    assert not pending and state()['projects'][1]['feishu']['liveMeta']['title']=='新表不受旧同步影响'
    passed('同步期间换链接只收尾已发出的首批，后续批次停止且不污染新表状态')
    assert not errors, errors
    (OUT / 'result.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'boundary': 'Same host isolated Edge; synthetic Feishu responses, quota failure and OPFS folder.'}, ensure_ascii=False, indent=2), encoding='utf-8')
    browser.close()
finally:
    server.shutdown(); server.server_close()
