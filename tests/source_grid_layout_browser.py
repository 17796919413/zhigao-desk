"""Merged-cell pagination and scroll preservation through real Edge and runtime.

Synthetic only: no CLI, cloud writes, installed connector, or personal browser.
"""
from pathlib import Path
import os, json, functools, http.server, threading, traceback, subprocess, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['ZHIGAO_VERIFY_OUT'])
OUT.mkdir(parents=True, exist_ok=False)
log = (OUT/'server.log').open('w', encoding='utf-8')
env = dict(os.environ, ZHIGAO_VERIFY_OUT=str(OUT/'journal'), ZHIGAO_GRID_LAYOUT='1', ZHIGAO_GRID_LIVE='0')
node = subprocess.Popen(['node', 'tests/grid_test_server.mjs'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=log, text=True, encoding='utf-8')
port = json.loads(node.stdout.readline())['port']
url = 'https://synthetic.feishu.cn/sheets/book'

def post(endpoint, data):
    req = urllib.request.Request(f'http://127.0.0.1:{port}{endpoint}', json.dumps(data).encode(), {'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()

def control(**kw): return json.loads(post('/control', kw)[1])

class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path.split('?')[0] == '/app.js':
            data = ((ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.probe={db:()=>db};').encode()
            self.send_response(200); self.send_header('Content-Type','text/javascript'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data); return
        super().do_GET()

http.server.ThreadingHTTPServer.request_queue_size = 128
server = http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
checks, errors, requests, measurements = [], [], [], []
def passed(s): checks.append(s); print('PASS '+s,flush=True)

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge',headless=True)
        context = browser.new_context(viewport={'width':1440,'height':1000})
        seed = {'selected':'p','projects':[{'id':'p','name':'合并区域验收品牌','status':'active','rules':[],'library':[],'feishu':{'reviewTableVersion':2,'sheets':[],'refined':{'url':url,'sheet':'s'}}}]}
        context.add_init_script("if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-settings-v1',"+json.dumps(json.dumps(seed,ensure_ascii=False))+");localStorage.setItem('seed','1');localStorage.setItem('zhigao-agent-v1','off');}")
        def route(r):
            if r.request.url.endswith('/page/feishu'):
                body=r.request.post_data_json; requests.append(body)
                code,response=post('/grid',body);r.fulfill(status=code,body=response,content_type='application/json')
            else:r.abort()
        context.route('http://127.0.0.1:47821/**',route)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        def loaded():
            page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click();page.wait_for_selector('.source-grid')
        def saved():
            page.wait_for_function("document.querySelector('[data-grid-status]').textContent==='已保存'",timeout=30000)
        def edit(address,text):
            page.locator(f'[data-grid-cell={address}]').dblclick();page.locator('[data-grid-input]').fill(text);page.locator('[data-grid-input]').press('Enter')
        def next_page():
            page.locator('[data-grid-next]').click();page.wait_for_selector('[data-grid-cell=B44]')
        def scroll_position():
            return page.locator('.source-grid-scroll').evaluate('e=>[e.scrollLeft,e.scrollTop]')
        def geometry():
            return page.evaluate("""()=>{const cells=[...document.querySelectorAll('[data-grid-cell]')];return cells.map(e=>({address:e.dataset.gridCell,position:e.dataset.gridPosition,rowspan:e.rowSpan,colspan:e.colSpan,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));}""")
        page.goto(f'http://127.0.0.1:{server.server_port}');loaded()
        assert page.locator('.source-grid thead th').all_inner_texts()==['','B','C','D','E','F','G','H']
        assert page.locator('.source-grid tbody tr').count()==38
        anchor=page.locator('[data-grid-cell=A8]')
        assert anchor.get_attribute('data-grid-position')=='B9'
        assert anchor.get_attribute('rowspan')=='2' and anchor.get_attribute('colspan')=='2'
        assert anchor.inner_text()=='隐藏起点仍可见'
        assert anchor.evaluate('e=>getComputedStyle(e).color')=='rgb(36, 89, 166)'
        assert page.locator('[data-grid-cell=A15]').count()==0
        assert page.locator('[data-grid-cell=A1]').get_attribute('colspan')=='7'
        g=geometry();measurements.append({'view':'page1','cells':g})
        merged=next(x for x in g if x['address']=='A8');neighbor=next(x for x in g if x['address']=='D9')
        assert abs(merged['width']-210)<1 and abs(merged['height']-54)<1
        assert abs(merged['x']+merged['width']-neighbor['x'])<1
        assert abs(merged['y']-neighbor['y'])<1
        passed('隐藏行列和隐藏合并起点保留内容、颜色及地址，合并跨度和相邻格位置正确')
        edit('A8','隐藏起点更新');saved();state=control()
        assert state['store']['s']['A8']['rawValue']=='隐藏起点更新'
        assert 'B9' not in state['store']['s']
        passed('编辑隐藏起点的可见区域，只写原始A8，不创建B9内容')
        page.screenshot(path=str(OUT/'hidden-desktop.png'),full_page=True)
        next_page()
        anchor=page.locator('[data-grid-cell=A39]')
        assert anchor.get_attribute('data-grid-position')=='B41'
        assert anchor.get_attribute('rowspan')=='2' and anchor.get_attribute('colspan')=='2'
        assert anchor.inner_text()=='跨页合并正文'
        assert page.locator('[data-grid-cell=D39] a').inner_text()=='合并链接'
        assert page.locator('[data-grid-cell=D39]').get_attribute('data-grid-editable')=='false'
        page.locator('[data-grid-cell=D39]').focus();page.keyboard.press('Enter');assert page.locator('[data-grid-input]').count()==0
        assert page.locator('.source-grid tbody tr').count()==39
        measurements.append({'view':'page2','cells':geometry()})
        passed('跨页补读起点正文和富文本链接，隐藏行不占合并跨度，富文本仍只读')
        before=control()['store'];edit('A39','跨页编辑保存到A39');saved();after=control()['store']
        changed=[k for k in set(before['s'])|set(after['s']) if before['s'].get(k)!=after['s'].get(k)]
        assert changed==['A39'] and before['other']==after['other']
        assert [r for r in requests if r['action']=='gridWrite'][-1]['address']=='A39'
        passed('第二页编辑仅更新原始A39，其他单元格与另一子表保持')
        page.screenshot(path=str(OUT/'cross-page-desktop.png'),full_page=True)
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(OUT/'cross-page-narrow.png'),full_page=True)
        page.locator('[data-grid-cell=H65]').scroll_into_view_if_needed();before=scroll_position();assert before[0]>0 and before[1]>0
        page.locator('[data-grid-cell=H65]').dblclick();assert scroll_position()==before
        page.locator('[data-grid-input]').fill('保持滚动位置的修改');page.locator('[data-grid-input]').press('Enter');assert scroll_position()==before
        saved();assert scroll_position()==before
        page.screenshot(path=str(OUT/'scroll-preserved-narrow.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        passed('390px窄屏横纵滚动后编辑、离开及保存回读均保持滚动位置，页面无横向溢出')
        page.locator('[data-grid-next]').click();page.wait_for_selector('[data-grid-cell=B81]');assert scroll_position()==[0,0]
        page.locator('[data-grid-prev]').click();page.wait_for_selector('[data-grid-cell=B44]');assert scroll_position()==[0,0]
        passed('翻页重置新页滚动位置，不继承旧页的深处位置')
        before=control(lost=True)['writes'];edit('A39','响应丢失后恢复A39')
        page.wait_for_function("document.querySelector('[data-grid-status]').textContent.includes('保存未完成')")
        assert control()['writes']==before+1
        page.reload();loaded();saved();assert control()['writes']==before+1
        next_page();assert page.locator('[data-grid-cell=A39]').inner_text()=='响应丢失后恢复A39'
        passed('跨页合并编辑响应丢失后刷新，只读恢复同操作，不重复写入')
        control(anchorChanged=True);page.locator('[data-grid-refresh]').click()
        page.wait_for_function("document.querySelector('[data-grid-status]').textContent.includes('读取合并区域期间原表已变化')")
        page.locator('[data-grid-refresh]').click();page.wait_for_function("!document.querySelector('[data-grid-refresh]').disabled && !document.querySelector('[data-grid-status]').textContent.includes('已变化')")
        assert page.locator('[data-grid-cell=A39]').inner_text()=='响应丢失后恢复A39'
        passed('补读起点发生版本变化时拒绝混合快照，重新刷新后正确恢复')
        assert not errors,errors
        result={'ok':True,'checks':checks,'browser':browser.version,'live':False,'errors':errors,'writes':control()['writes'],'measurements':measurements,'requests':requests}
        (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()
except Exception:
    (OUT/'failure.json').write_text(json.dumps({'ok':False,'checks':checks,'errors':errors,'traceback':traceback.format_exc()},ensure_ascii=False,indent=2),encoding='utf-8');raise
finally:
    server.shutdown();node.terminate();node.wait(timeout=10);log.close()
