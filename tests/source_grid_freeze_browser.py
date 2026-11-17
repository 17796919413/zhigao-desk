"""Frozen rows/columns through real Edge and the actual grid runtime; synthetic only."""
from pathlib import Path
import os, json, functools, http.server, threading, traceback, subprocess, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
log=(OUT/'server.log').open('w',encoding='utf-8')
env=dict(os.environ,ZHIGAO_VERIFY_OUT=str(OUT/'journal'),ZHIGAO_GRID_FREEZE='1',ZHIGAO_GRID_LIVE='0')
node=subprocess.Popen(['node','tests/grid_test_server.mjs'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8')
port=json.loads(node.stdout.readline())['port'];url='https://synthetic.feishu.cn/sheets/book'

def post(endpoint,data):
    req=urllib.request.Request(f'http://127.0.0.1:{port}{endpoint}',json.dumps(data).encode(),{'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=30) as r:return r.status,r.read()
    except urllib.error.HTTPError as e:return e.code,e.read()

def control(**kw):return json.loads(post('/control',kw)[1])

class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def do_GET(self):
        if self.path.split('?')[0]=='/app.js':
            data=((ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.probe={db:()=>db};').encode()
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        super().do_GET()

http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
checks=[];errors=[];requests=[];measurements=[];page=None
def passed(s):checks.append(s);print('PASS '+s,flush=True)

try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000})
        seed={'selected':'p','projects':[{'id':'p','name':'冻结区域验收品牌','status':'active','rules':[],'library':[],'feishu':{'reviewTableVersion':2,'sheets':[],'refined':{'url':url,'sheet':'s'}}}]}
        context.add_init_script("if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-settings-v1',"+json.dumps(json.dumps(seed,ensure_ascii=False))+");localStorage.setItem('seed','1');localStorage.setItem('zhigao-agent-v1','off');}")
        def route(r):
            if r.request.url.endswith('/page/feishu'):
                body=r.request.post_data_json;requests.append(body);code,response=post('/grid',body);r.fulfill(status=code,body=response,content_type='application/json')
            else:r.abort()
        context.route('http://127.0.0.1:47821/**',route)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        def loaded():
            page.wait_for_function('!!window.probe && !!probe.db()');page.locator('[data-page=feishu]').first.click();page.wait_for_selector('.source-grid')
        def saved():page.wait_for_function("document.querySelector('[data-grid-status]').textContent==='已保存'",timeout=30000)
        def refreshed():
            page.locator('[data-grid-refresh]').click();page.wait_for_function("!document.querySelector('[data-grid-refresh]').disabled")
        def rect(selector):return page.locator(selector).first.evaluate('e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}')
        def scroll(x,y):
            page.locator('.source-grid-scroll').evaluate('(e,p)=>{e.scrollLeft=p[0];e.scrollTop=p[1]}',[x,y]);page.wait_for_timeout(60)
        def visible_rows():return [int(x) for x in page.locator('.source-grid tbody th').all_inner_texts()]
        page.goto(f'http://127.0.0.1:{server.server_port}');loaded()
        assert page.locator('[data-grid-cell=B3]').count()==4
        assert page.locator('[data-grid-cell=B3]').evaluate_all('es=>es.map(e=>e.dataset.gridPosition)')==['B3','D3','B4','D4']
        full_height=page.locator('[data-grid-position=B3] .source-cell').evaluate('e=>e.style.height')
        assert full_height=='144px',full_height
        assert '2' not in page.locator('.source-grid tbody th').all_inner_texts()
        assert page.locator('[data-grid-position=B3]').evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(228, 238, 232)'
        page.screenshot(path=str(OUT/'frozen-initial-desktop.png'),full_page=True)
        passed('冻结行列尊重隐藏行列和源色，交界合并分为四个裁切片段，内容几何保留')
        y=rect('[data-grid-position=B3]')['y'];ordinary=rect('[data-grid-position=H20]')['y'];scroll(0,350)
        assert abs(rect('[data-grid-position=B3]')['y']-y)<1
        assert abs(rect('[data-grid-position=H20]')['y']-ordinary+350)<1
        assert page.locator('[data-grid-freeze-note]').is_hidden()
        measurements.append({'view':'desktop-scrolled','grid':rect('.source-grid-scroll'),'frozen':rect('[data-grid-position=B3]')})
        page.screenshot(path=str(OUT/'frozen-desktop.png'),full_page=True)
        passed('纵向滚动时冻结行固定，普通行按滚动量移动，表头与交界层级正确')
        scroll(0,0);before=control()['store']
        page.locator('[data-grid-position=D4]').dblclick();assert page.locator('[data-grid-input]').count()==1
        assert page.locator('[data-grid-input]').get_attribute('data-grid-position')=='D4'
        page.locator('[data-grid-input]').fill('交界片段仍写原始B3');page.locator('[data-grid-input]').press('Enter');saved()
        after=control()['store'];changed=[k for k in set(before['s'])|set(after['s']) if before['s'].get(k)!=after['s'].get(k)]
        assert changed==['B3'] and before['other']==after['other']
        passed('编辑非冻结合并片段只有一个输入框，保存仅改变原始B3')
        page.locator('[data-grid-next]').click();page.wait_for_selector('[data-grid-cell=B44]')
        rows=visible_rows();assert rows[:4]==[1,3,41,43] and len(rows)==len(set(rows))==41,rows
        assert page.locator('[data-grid-position=B3] .source-cell').evaluate('e=>e.style.height')==full_height
        assert page.locator('[data-grid-position=B3]').inner_text()=='交界片段仍写原始B3'
        assert page.locator('[data-grid-position=B3]').get_attribute('rowspan')=='1'
        passed('第二页补读冻结表头及完整合并布局，原行号不重复，跨页前后裁切高度一致')
        before=control()['writes'];page.locator('[data-grid-position=B3]').dblclick();page.locator('[data-grid-input]').fill('第二页更新冻结原格');page.locator('[data-grid-input]').press('Enter');saved()
        assert control()['writes']==before+1 and control()['store']['s']['B3']['rawValue']=='第二页更新冻结原格'
        assert [r for r in requests if r['action']=='gridWrite'][-1]['address']=='B3'
        passed('后续页冻结表头允许编辑，仍写回第一页的真实B3')
        page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(80);scroll(400,250)
        grid=rect('.source-grid-scroll');frozen=rect('[data-grid-position=B3]')
        assert abs(frozen['x']-grid['x']-44)<1,(grid,frozen)
        assert abs(frozen['y']-grid['y']-55)<1,(grid,frozen)
        assert page.locator('[data-grid-freeze-note]').is_hidden()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        measurements.append({'view':'narrow-scrolled','grid':grid,'frozen':frozen})
        page.screenshot(path=str(OUT/'frozen-narrow.png'),full_page=True)
        passed('390px窄屏同时横纵滚动，冻结行列交点保持，正文仍有可滚动区域')
        control(frozenRows=62,frozenCols=7);refreshed()
        page.wait_for_selector('.grid-unpin-rows.grid-unpin-cols')
        assert page.locator('[data-grid-freeze-note]').is_visible()
        rows=visible_rows();assert rows[0]==1 and rows[-1]==80 and len(rows)==76 and len(set(rows))==len(rows),rows
        scroll(500,500);page.screenshot(path=str(OUT/'oversized-freeze-narrow.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        passed('冻结范围大于视窗时完整保留行列并允许滚动，提示实际降级，未遮住全部正文')
        control(frozenRows=3,frozenCols=7);refreshed();page.wait_for_selector('.grid-unpin-cols')
        page.set_viewport_size({'width':1440,'height':1000});page.wait_for_function("!document.querySelector('.source-grid-scroll').classList.contains('grid-unpin-cols')")
        assert page.locator('[data-grid-freeze-note]').is_hidden()
        page.set_viewport_size({'width':390,'height':844});page.wait_for_selector('.grid-unpin-cols');assert page.locator('[data-grid-freeze-note]').is_visible()
        passed('调整窗口尺寸自动恢复或解除超宽固定列，不需重读或改变源表冻结设置')
        control(frozenRows=3,frozenCols=3);refreshed();page.wait_for_function("!document.querySelector('.source-grid-scroll').classList.contains('grid-unpin-rows') && !document.querySelector('.source-grid-scroll').classList.contains('grid-unpin-cols')")
        control(frozenChanged=True);refreshed();assert '读取冻结区域期间原表已变化' in page.locator('[data-grid-status]').inner_text()
        refreshed();assert '已变化' not in page.locator('[data-grid-status]').inner_text()
        passed('补读冻结区期间版本变化拒绝混合快照，重新刷新后恢复正常冻结')
        page.locator('[data-grid-sheet]').select_option('other');page.wait_for_function("document.querySelector('[data-grid-cell=A1]')?.textContent==='其他表不受影响'")
        assert page.locator('td.grid-frozen-row,td.grid-frozen-col').count()==0 and page.locator('[data-grid-freeze-note]').is_hidden()
        passed('切换到无冻结子表后清除固定区域和降级提示')
        assert not errors,errors
        (OUT/'result.json').write_text(json.dumps({'ok':True,'checks':checks,'browser':browser.version,'live':False,'errors':errors,'measurements':measurements,'requests':requests,'writes':control()['writes']},ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()
except Exception:
    (OUT/'failure.json').write_text(json.dumps({'ok':False,'checks':checks,'errors':errors,'traceback':traceback.format_exc()},ensure_ascii=False,indent=2),encoding='utf-8');raise
finally:server.shutdown();node.terminate();node.wait(timeout=10);log.close()
