"""Real isolated Edge/MCP, synthetic scan PDF, slowed rendering and lifecycle faults.

Timings are accelerated fixtures. CPU throttling and CDP freeze are simulations,
not evidence from another computer or an actual Windows sleep/minimize cycle.
"""
from pathlib import Path
import functools
import http.server
import json
import os
import socket
import subprocess
import threading
import time
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright
from mcp_client_fixture import MCP
from synthetic_fixtures import pdf_bytes

http.server.ThreadingHTTPServer.request_queue_size=128
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('ZHIGAO_VERIFY_OUT', str(ROOT.parent / '_verify' / 'environment-reliability-20261112'))) / 'environment-browser'
OUT.mkdir(parents=True, exist_ok=True)
PDF = pdf_bytes(3, mixed=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        route = self.path.split('?', 1)[0]
        if route == '/__fixture/mixed.pdf':
            data, mime = PDF, 'application/pdf'
        elif route == '/media-review.js':
            data = (ROOT / 'media-review.js').read_text(encoding='utf-8').replace(
                'export async function readReviewAsset(task,asset,options={}){',
                'export async function readReviewAsset(task,asset,options={}){await new Promise(r=>setTimeout(r,600));').encode()
            mime = 'text/javascript'
        elif route == '/agent.js':
            data = (ROOT / 'agent.js').read_text(encoding='utf-8').replace('setInterval(beat,10000)', 'setInterval(beat,100)').encode()
            mime = 'text/javascript'
        else:
            return super().do_GET()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
backend = f'http://127.0.0.1:{port}'
home = OUT / '空白 用户目录'
home.mkdir(exist_ok=True)
connector = OUT / 'test-connector.mjs'
source = (ROOT / 'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()', json.dumps(str(home)))
# Keep the base deadline below the three injected 600ms waits, while allowing
# real throttled rendering to finish between progress events on a loaded host.
# Production deadlines are unchanged; separate connector tests exercise stalls.
source = source.replace('execution:180000', 'execution:1400').replace('progressGrace:60000', 'progressGrace:3000').replace('maxExecution:240000', 'maxExecution:6000').replace('total:270000', 'total:7000').replace('pageStale:120000', 'pageStale:1000').replace('tick:1000', 'tick:30')
connector.write_text(source, encoding='utf-8')
env = {**os.environ, 'ZHIGAO_PORT': str(port), 'ZHIGAO_AUTO_UPDATE': '0', 'ZHIGAO_REGISTER_URI': '0', 'ZHIGAO_ORIGINS': origin}
log = (OUT / 'connector.log').open('w', encoding='utf-8')
process = subprocess.Popen(['node', str(connector), 'hub'], env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
client = None
checks, errors, progress, console, failures, responses = [], [], [], [], [], []


def passed(name):
    checks.append(name)
    print('PASS ' + name, flush=True)


def health():
    with urllib.request.urlopen(backend + '/health', timeout=2) as response:
        return json.load(response)


try:
    for _ in range(80):
        try:
            if health().get('app') == 'zhigao':
                break
        except OSError:
            time.sleep(.1)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        context.route('http://127.0.0.1:47821/**', lambda r: r.continue_(url=backend + r.request.url.split('47821', 1)[1]))
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: console.append({'type':message.type,'text':message.text[:500]}))
        page.on('requestfailed', lambda request: failures.append({'url':request.url,'failure':request.failure}))
        page.on('response', lambda response: responses.append({'url':response.url,'status':response.status,'contentType':response.headers.get('content-type')}))
        page.on('request', lambda request: progress.append(json.loads(request.post_data)['progress']) if request.url.endswith('/page/progress') else None)
        page.goto(origin)
        page.wait_for_selector('#agent-chip')
        client = MCP(connector, env, log, page)

        def call(name, args=None):
            result = client.call(name, args or {})
            assert not result.get('isError'), result
            return json.loads(result['content'][0]['text'])

        def connected():
            page.wait_for_function("async()=>['online','waiting'].includes((await import('/agent.js')).agent.state)", timeout=15000)

        assert call('zhigao_status')['connected']
        page.evaluate('''async()=>{
          const parsed=await(await import('/library-import.js')).parseLibraryFile(new File([await(await fetch('/__fixture/mixed.pdf')).arrayBuffer()],'mixed.pdf',{type:'application/pdf'}));
          const {originalAsset,...d}=parsed;d.id='pdf';d.ingestion.assetKey='fixture-original';
          const p={id:'fixture',name:'隔离跨环境验证',status:'active',notes:'',rules:[],library:[d]};
          localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:p.id,projects:[p]}));
          const t={id:'draft',itemId:'item',projectId:p.id,projectName:p.name,filename:'合成稿.txt',author:'合成作者',kind:'图文',platform:'其他',stage:'初稿',fmt:'text',cells:[{id:'p',current:'Synthetic manuscript.',original:'Synthetic manuscript.'}],flow:{state:'review',round:1,feedback:[]},created:new Date().toISOString(),updated:new Date().toISOString(),rules:[],findings:[]};
          const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk',6);q.onsuccess=()=>r(q.result)});
          await new Promise((resolve,reject)=>{const tx=db.transaction(['tasks','items','media'],'readwrite');tx.objectStore('tasks').put(t);tx.objectStore('items').put({id:'item',projectId:p.id,author:t.author,kind:t.kind,platform:t.platform,title:'合成稿',created:t.created,updated:t.updated,publish:{status:'待排期'}});tx.objectStore('media').put({id:'fixture-original',file:originalAsset});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
        }''')
        page.reload()
        try:page.wait_for_selector('.wb-row')
        except Exception:
            page.screenshot(path=str(OUT / 'reload-failure.png'),full_page=True)
            print('RELOAD_DIAGNOSTIC '+json.dumps({'errors':errors,'body':page.locator('body').inner_text()[:2500],'settings':page.evaluate("localStorage.getItem('zhigao-settings-v1')")},ensure_ascii=False),flush=True)
            raise
        connected()
        brief = call('zhigao_get_review_brief', {'docId': 'draft'})
        args = {'docId': 'draft', 'reviewToken': brief['reviewToken']}
        assets = call('zhigao_read_review_context', {**args, 'section': 'assets'})['items']
        assert len(assets) == 3
        cdp = context.new_cdp_session(page)
        cdp.send('Performance.enable')
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        started = time.monotonic()
        native = client.call('zhigao_read_review_assets', {**args, 'assetIds': [a['id'] for a in assets]})
        elapsed = round(time.monotonic() - started, 3)
        assert not native.get('isError'), native
        images = [c for c in native['content'] if c['type'] == 'image']
        assert len(images) == 3 and elapsed > 1.4
        rows = [json.loads(c['text']) for c in native['content'] if c['type'] == 'text'][1:]
        assert [r['assetId'] for r in rows] == [a['id'] for a in assets] and all(r['receipt'] for r in rows)
        assert any(p['stage'] == 'asset-rendered' for p in progress)
        metrics = {m['name']: m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
        passed('4x CPU throttle plus 600ms per asset: progress allows all 3 original pages beyond base deadline')
        page.evaluate('''images=>{const panel=document.createElement('div');panel.id='fixture-pages';panel.style='position:fixed;inset:0;z-index:999999;background:#e9edf1;display:flex;gap:12px;padding:18px';for(const image of images){const img=document.createElement('img');img.src='data:image/png;base64,'+image.data;img.style='width:32%;object-fit:contain';panel.append(img);}document.body.append(panel);}''', images)
        page.wait_for_function("[...document.querySelectorAll('#fixture-pages img')].every(i=>i.complete&&i.naturalWidth>0)")
        page.screenshot(path=str(OUT / 'scan-mixed-pages.png'))
        page.evaluate("document.querySelector('#fixture-pages').remove()")
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})

        page.reload()
        try:page.wait_for_selector('.wb-row')
        except Exception:
            page.screenshot(path=str(OUT / 'resume-failure.png'),full_page=True)
            print('RESUME_DIAGNOSTIC '+json.dumps({'errors':errors,'body':page.locator('body').inner_text()[:2500],'settings':page.evaluate("localStorage.getItem('zhigao-settings-v1')")},ensure_ascii=False),flush=True)
            raise
        connected()
        fresh = call('zhigao_get_review_brief', {'docId': 'draft', 'retry': True})
        assert fresh['resume']['restored'] and fresh['resume']['readAssets'] == 3
        passed('mixed PDF receipts and context resume after actual browser reload')

        for _ in range(8):
            page.reload()
            try:page.wait_for_selector('.wb-row',timeout=10000)
            except Exception:
                page.screenshot(path=str(OUT / 'repeat-reload-failure.png'),full_page=True)
                print('REPEAT_RELOAD_DIAGNOSTIC '+json.dumps({'errors':errors,'body':page.locator('body').inner_text()[:2500],'console':console[-20:],'failures':failures[-30:],'responses':responses[-60:],'html':page.content()[:2000]},ensure_ascii=False),flush=True)
                raise
        passed('8 consecutive reloads retain the synthetic manuscript')

        page.route('**/video.js',lambda route:route.abort('connectionrefused'))
        page.reload()
        page.get_by_role('heading',name='页面未能加载').wait_for()
        page.screenshot(path=str(OUT/'network-load-error.png'),full_page=True)
        page.unroute('**/video.js')
        # Rendering the manuscript is independent of the new page's handshake.
        # Hold that handshake to verify we really wait for connection readiness.
        page.add_init_script("""(()=>{const fetch=window.fetch;window.fetch=async function(url,options){if(String(url).endsWith('/page/poll')&&!window.__connectionReleased){window.__connectionHeld=true;await new Promise(r=>window.__releaseConnection=()=>{window.__connectionReleased=true;r();});}return fetch.call(this,url,options);};})();""")
        page.get_by_role('button',name='刷新重试').click()
        page.wait_for_selector('.wb-row')
        page.wait_for_function('window.__connectionHeld===true')
        assert page.evaluate("async()=>['connecting','reconnecting'].includes((await import('/agent.js')).agent.state)")
        page.evaluate('window.__releaseConnection()')
        connected()
        restored=call('zhigao_get_review_brief',{'docId':'draft','retry':True})
        assert restored['resume']['restored'] and restored['resume']['readAssets']==3
        passed('blocked script shows actionable load error; retry restores manuscript and receipts')

        context.set_offline(True)
        page.wait_for_timeout(350)
        context.set_offline(False)
        page.wait_for_timeout(3300)
        assert call('zhigao_status')['connected']
        passed('offline/online event reconnects without resetting browser state')

        # Hold one completed result, freeze the page beyond the scaled stale bound,
        # then attempt takeover from a different browser session.
        page.evaluate('''()=>{const f=window.fetch;window.fetch=async function(url,options){if(String(url).endsWith('/page/result')&&!window.__held){window.__held=true;await new Promise(r=>window.__release=r);}return f.call(this,url,options);};}''')
        client.n += 1
        request_id = client.n
        client.p.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': request_id, 'method': 'tools/call', 'params': {'name': 'zhigao_status', 'arguments': {}}}) + '\n')
        client.p.stdin.flush()
        page.wait_for_function('window.__held===true')
        cdp.send('Page.setWebLifecycleState', {'state': 'frozen'})
        page.wait_for_timeout(1300)
        req = urllib.request.Request(backend + '/page/poll', data=json.dumps({'pageId': 'other-browser', 'hello': True}).encode(), headers={'Origin': origin})
        try:
            urllib.request.urlopen(req, timeout=2)
            raise AssertionError('Frozen executing page was replaced')
        except urllib.error.HTTPError as error:
            assert error.code == 409 and json.load(error)['code'] == 'PAGE_IN_USE'
        cdp.send('Page.setWebLifecycleState', {'state': 'active'})
        page.evaluate('window.__release()')
        # The original request may have timed out while frozen. Completion must
        # release the busy guard, not execute its operation again.
        page.wait_for_timeout(500)
        assert health()['active'] is None
        assert call('zhigao_status')['connected']
        passed('CDP freeze beyond stale bound preserves exclusive owner; thaw accepts late completion and reconnects')

        giant = page.evaluate('''async raw=>{
          const {renderPdfPage}=await import('/pdf.js');const original=document.createElement.bind(document);let allocated=false;
          document.createElement=(tag,...args)=>{if(tag==='canvas'){allocated=true;throw Error('TEST_ALLOCATION_BLOCKED');}return original(tag,...args);};
          try{await renderPdfPage(new Uint8Array(raw).buffer,1);return {unexpected:true};}
          catch(e){return {code:e.code,message:e.message,allocated};}
          finally{document.createElement=original;}
        }''', list(pdf_bytes(1, oversized=True)))
        assert giant.get('code') == 'PDF_CANVAS_LIMIT' and not giant['allocated'], giant
        passed('oversized page is rejected before canvas allocation, without lowering resolution or skipping silently')
        page.screenshot(path=str(OUT / 'desktop.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path=str(OUT / 'mobile.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2')
        passed('desktop/mobile layout rendered; 390px has no horizontal overflow')
        assert not errors, errors
        result = {'count': len(checks), 'checks': checks, 'elapsedSeconds': elapsed, 'progressEvents': len(progress),
                  'jsHeapUsedAfterBatch': metrics.get('JSHeapUsedSize'), 'browser': browser.version, 'pageErrors': errors,
                  'boundary': 'One Windows host, isolated Edge headless profile; accelerated deadlines, synthetic scanned/mixed PDF, 4x CPU throttle and CDP freeze. Heap measurement is not total browser/worker/canvas peak memory. No real WorkBuddy, other device, OS sleep or minimized-window certification.'}
        (OUT / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(result), flush=True)
        client.close()
        client = None
        browser.close()
finally:
    if client:
        client.close()
    process.terminate()
    process.wait(timeout=10)
    server.shutdown()
    server.server_close()
    log.close()
