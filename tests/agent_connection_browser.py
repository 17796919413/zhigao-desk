"""Real isolated Edge + MCP connection lifecycle regressions, synthetic data only.

Shortened poll/heartbeat/client-expiry intervals exercise races; not a multi-hour soak or OS sleep.
Set ZHIGAO_CONNECTION_BASELINE=1 to test the committed pre-fix frontend.
"""
import functools
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import time
import urllib.request
from playwright.sync_api import sync_playwright
from mcp_client_fixture import MCP

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['ZHIGAO_VERIFY_OUT']) / 'agent-connection'
OUT.mkdir(parents=True, exist_ok=True)
BASELINE = os.environ.get('ZHIGAO_CONNECTION_BASELINE') == '1'
REAL_IDLE = os.environ.get('ZHIGAO_CONNECTION_REAL_IDLE') == '1'
BASELINE_COMMIT = '0dc2713ecf8b3cd863b197c0700fd0698373dfbc'  # Published 1.12.1; HEAD changes after a release.
http.server.ThreadingHTTPServer.request_queue_size = 128
http.server.ThreadingHTTPServer.daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.split('?', 1)[0] == '/agent.js':
            source = subprocess.check_output(['git', 'show', BASELINE_COMMIT + ':agent.js'], cwd=ROOT).decode() if BASELINE else (ROOT / 'agent.js').read_text(encoding='utf-8')
            data = (source if REAL_IDLE else source.replace('setInterval(beat,10000)', 'setInterval(beat,150)')).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
backend = f'http://127.0.0.1:{port}'
home = OUT / 'isolated-home'
home.mkdir(exist_ok=True)
script = OUT / 'connector.mjs'
source = (ROOT / 'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()', json.dumps(str(home)))
script.write_text(source if REAL_IDLE else source.replace('}, 25000)', '}, 600)').replace('pageStale:120000', 'pageStale:2500')
                  .replace('now - c.seen > 90000', 'now - c.seen > 2000')
                  .replace('}, 5000).unref();', '}, 200).unref();'), encoding='utf-8')
env = {**os.environ, 'ZHIGAO_PORT': str(port), 'ZHIGAO_AUTO_UPDATE': '0', 'ZHIGAO_REGISTER_URI': '0', 'ZHIGAO_ORIGINS': origin}
log = (OUT / 'connector.log').open('w', encoding='utf-8')
hub = subprocess.Popen(['node', str(script), 'hub'], env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
client = None
results = []


def health():
    with urllib.request.urlopen(backend + '/health', timeout=3) as response:
        return json.load(response)


def online(page):
    page.wait_for_function("window.a.agent.state==='online'", timeout=12000)


def observe(page):
    page.evaluate("""()=>{window.states=[];new MutationObserver(()=>states.push(a.agent.state)).observe(document.querySelector('.top-tools'),{childList:true,subtree:true});}""")


def wake_no_false_disconnect(page):
    observe(page)
    page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow'))")
    page.wait_for_timeout(250)
    states = page.evaluate('states')
    assert not any(s in ['offline', 'reconnecting'] for s in states), states


def stale_heartbeat_failure(page):
    page.evaluate("""()=>{const f=window.fetch;window.polls=0;window.fetch=async(...args)=>{
      const u=String(args[0]);if(u.endsWith('/page/poll')){const r=await f(...args);polls++;return r;}
      if(u.endsWith('/page/heartbeat')&&!window.held){window.held=true;await f(...args);return new Promise((_,reject)=>window.rejectBeat=()=>reject(new TypeError('synthetic old heartbeat failure')));}
      return f(...args);
    };}""")
    page.wait_for_function('window.rejectBeat && polls>0')
    observe(page)
    page.evaluate('rejectBeat()')
    page.wait_for_timeout(30)
    assert page.evaluate('a.agent.state') == 'online', page.evaluate('states')


def stale_heartbeat_success(page):
    page.evaluate("""()=>{const f=window.fetch;window.dropPoll=false;window.fetch=async(...args)=>{
      const u=String(args[0]);if(u.endsWith('/page/poll')&&dropPoll)throw new TypeError('newer request failed');
      if(u.endsWith('/page/heartbeat')&&!window.held){window.held=true;const body=await(await f(...args)).json();return new Promise(resolve=>window.releaseBeat=()=>resolve({ok:true,json:async()=>body}));}
      return f(...args);
    };}""")
    page.wait_for_function("typeof window.releaseBeat==='function'")
    page.evaluate('dropPoll=true')
    page.wait_for_function("['offline','reconnecting'].includes(a.agent.state)")
    page.evaluate('releaseBeat()')
    page.wait_for_timeout(30)
    assert page.evaluate('a.agent.state') == 'reconnecting'


def stale_session_rejection(page):
    for code in ['PAGE_IN_USE', 'PAGE_SESSION_CHANGED']:
        page.evaluate("""code=>{const f=window.fetch;window.beats=0;window.fetch=async(...args)=>{
          const u=String(args[0]);const r=await f(...args);
          if(u.endsWith('/page/heartbeat'))beats++;
          if(u.endsWith('/page/poll')&&!window.releaseSession){return new Promise(resolve=>window.releaseSession=()=>resolve({ok:false,status:409,json:async()=>({code})}));}
          return r;
        };}""", code)
        page.wait_for_function("typeof window.releaseSession==='function' && beats>2")
        observe(page)
        page.evaluate('releaseSession()')
        page.wait_for_timeout(60)
        assert page.evaluate('states.every(s=>s==="online")'), page.evaluate('states')
        # Reload removes interception wrappers and resets only this synthetic page.
        page.reload()
        page.wait_for_selector('#agent-chip')
        page.evaluate("async()=>window.a=await import('/agent.js')")
        online(page)


def manual_retry_interrupts_backoff(page):
    page.evaluate("""()=>{const f=window.fetch;window.failTransport=true;window.polls=0;window.fetch=(...args)=>{
      if(/\/page\/(poll|heartbeat)$/.test(String(args[0]))&&failTransport)return Promise.reject(new TypeError('synthetic network outage'));
      if(String(args[0]).endsWith('/page/poll'))polls++;
      return f(...args);
    };window.dispatchEvent(new Event('online'));}""")
    page.wait_for_function("['offline','reconnecting'].includes(a.agent.state)")
    page.evaluate('failTransport=false; a.startAgent()')
    page.wait_for_function('polls>0', timeout=800)
    online(page)


def stopped_poll_cannot_reconnect(page):
    page.evaluate("""()=>{const f=window.fetch;window.pollTrace=[];window.fetch=async(...args)=>{
      const r=await f(...args);if(String(args[0]).endsWith('/page/poll')){pollTrace.push({held:!!window.held,status:r.status});if(!window.held){window.held=true;return new Promise(resolve=>window.releasePoll=()=>resolve(r));}}return r;
    };}""")
    page.wait_for_function("typeof window.releasePoll==='function'", timeout=5000)
    page.evaluate('a.stopAgent(); releasePoll()')
    page.wait_for_timeout(250)
    assert page.evaluate('a.agent.state') == 'off'
    assert page.evaluate("localStorage.getItem('zhigao-agent-v1')") == 'off'


def restored_page_session(page):
    page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))")
    page.wait_for_timeout(250)
    page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
    online(page)
    assert health()['page']


def outage_and_recovery(page):
    page.get_by_role('button', name='连接与授权', exact=True).click()
    page.context.set_offline(True)
    page.wait_for_function("a.agent.state==='reconnecting'", timeout=5000)
    page.screenshot(path=str(OUT / 'reconnecting.png'), full_page=True)
    page.wait_for_function("a.agent.state==='offline'", timeout=25000)
    assert '暂时无法连接' in page.locator('[data-status="ai"]').inner_text()
    assert '连接器未运行' not in page.locator('[data-connection="ai"] .connect-row-head').inner_text()
    assert health()['app'] == 'zhigao', 'The service remains running during a browser network failure'
    page.screenshot(path=str(OUT / 'offline.png'), full_page=True)
    page.context.set_offline(False)
    online(page)
    result = client.call('zhigao_status')
    assert not result.get('isError'), result
    assert json.loads(result['content'][0]['text'])['connected']
    page.screenshot(path=str(OUT / 'recovered.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(OUT / 'mobile.png'), full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2')


def suspended_transport_and_resume(page):
    # This Edge build acknowledges CDP freeze but keeps timers running, even on
    # a blank page. Explicitly suspend transport instead; never call it OS sleep.
    page.evaluate("""()=>{const f=window.fetch;window.paused=true;window.resumeRequests=[];window.fetch=async(...args)=>{
      if(paused&&/\/page\/(poll|heartbeat)$/.test(String(args[0])))await new Promise(resolve=>resumeRequests.push(resolve));
      return f(...args);
    };}""")
    page.wait_for_timeout(5000)
    assert not health()['page'], 'Scaled stale-page threshold must actually be exceeded'
    page.evaluate("paused=false;resumeRequests.forEach(r=>r());document.dispatchEvent(new Event('resume'))")
    online(page)
    page.wait_for_timeout(400)
    assert health()['page']
    result = client.call('zhigao_status')
    assert not result.get('isError'), result


def hub_exit_and_client_takeover(page):
    hub.terminate()
    hub.wait(timeout=10)
    page.wait_for_function("a.agent.state==='reconnecting'", timeout=2000)
    online(page)
    assert health()['pid'] == client.p.pid
    assert not client.call('zhigao_status').get('isError')


def multiple_tabs(page):
    other = page.context.new_page()
    other.goto(origin)
    other.wait_for_selector('#agent-chip')
    other.evaluate("async()=>window.a=await import('/agent.js')")
    other.wait_for_function("a.agent.state==='other-tab'")
    other.evaluate('a.startAgent()')
    page.wait_for_timeout(300)
    assert page.evaluate('a.agent.state') == 'online'
    assert other.evaluate('a.agent.state') == 'other-tab'
    page.evaluate('a.stopAgent()')
    online(other)
    other.evaluate('a.stopAgent()')
    other.close()


def invitation_and_verified_project(page):
    # Initialized MCP/heartbeats alone must not count as successful project access.
    assert '待验证' in page.locator('#agent-chip').inner_text()
    page.get_by_role('button', name='连接与授权', exact=True).click()
    button = page.get_by_role('button', name='复制网址和接入指令', exact=True)
    assert button.is_visible()
    page.evaluate("()=>{navigator.clipboard.writeText=async value=>window.copiedInvitation=value}")
    button.click()
    copied = page.evaluate('window.copiedInvitation')
    assert origin in copied and 'AGENT_SETUP.md' in copied and 'zhigao_status({project:' in copied
    assert not page.locator('#connect-cmd-connector').is_visible()
    page.screenshot(path=str(OUT/'onboarding-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(OUT/'onboarding-narrow.png'),full_page=True)
    assert page.evaluate("document.querySelector('#connections-body').scrollWidth<=document.querySelector('#connections-body').clientWidth")
    # Clipboard denial selects the actual instruction for manual copying.
    page.evaluate("()=>{navigator.clipboard.writeText=async()=>{throw Error('synthetic clipboard denied')}}")
    button.click()
    assert page.locator('#connect-invitation').is_visible()
    assert page.evaluate("document.querySelector('#connect-invitation').selectionEnd") > 0
    page.set_viewport_size({'width':1440,'height':1000})
    reply=client.call('zhigao_status', {'project':'wrong-project-id'})
    assert reply.get('isError')
    assert page.evaluate('a.agent.verification') is None
    reply=client.call('zhigao_status')
    assert not reply.get('isError'), reply
    payload=json.loads(reply['content'][0]['text'])
    assert payload['currentProjectId']
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')")
    assert page.evaluate('(async()=>{const {verifiedConnection}=await import("/connection-status.js");return verifiedConnection(a.agent,"wrong-project-id")})()') is False
    page.screenshot(path=str(OUT/'onboarding-verified.png'),full_page=True)
    # A real successful call stays verified across refresh while that client is live.
    page.reload();page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    online(page)
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')", timeout=5000)
    page.get_by_role('button', name='连接与授权', exact=True).click()
    assert page.locator('[data-status="ai"]').inner_text() == 'AI 可用'
    page.screenshot(path=str(OUT/'refresh-verified-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(OUT/'refresh-verified-narrow.png'),full_page=True)
    assert page.evaluate("document.querySelector('#connections-body').scrollWidth<=document.querySelector('#connections-body').clientWidth")
    page.set_viewport_size({'width':1440,'height':1000})


def activity_toolbar_removed(page):
    for tab in ['home', 'history', 'rules', 'feishu']:
        page.locator(f'[data-page="{tab}"]').click()
        assert page.locator('.activity-bar').count() == 0
        assert page.locator('[data-action="new-activity"]').count() == 0
    page.locator('[data-page="home"]').click()
    page.screenshot(path=str(OUT/'activity-removed-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(OUT/'activity-removed-narrow.png'),full_page=True)


def verification_project_scope(page):
    reply=client.call('zhigao_status')
    original=json.loads(reply['content'][0]['text'])['currentProjectId']
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')")
    page.locator('.navbtn[data-page="rules"]').click()
    page.locator('[data-action="new-project"]').click()
    page.locator('#new-project-name').fill('连接验证合成品牌乙')
    page.locator('[data-action="create-project"]').click()
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('待验证')")
    page.reload();page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    online(page)
    assert '待验证' in page.locator('#agent-chip').inner_text()
    assert client.call('zhigao_status', {'project':original}).get('isError')
    assert '待验证' in page.locator('#agent-chip').inner_text()
    page.locator('.navbtn[data-page="rules"]').click()
    page.locator('[data-setting="project"]').select_option(original)
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')")


def verification_explicit_disconnect(page):
    assert not client.call('zhigao_status').get('isError')
    page.evaluate('a.stopAgent()')
    page.wait_for_timeout(250)
    page.reload();page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    page.wait_for_timeout(350)
    assert page.evaluate('a.agent.state') == 'off'
    page.evaluate('void a.startAgent()')
    online(page)
    assert '待验证' in page.locator('#agent-chip').inner_text()


def verification_network_recovery(page):
    assert not client.call('zhigao_status').get('isError')
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')")
    page.context.set_offline(True)
    page.wait_for_function("a.agent.state==='reconnecting'")
    assert not page.evaluate("document.querySelector('#agent-chip').textContent.includes('AI 可用')")
    page.context.set_offline(False)
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')")


def verification_client_replacement(page):
    global client
    assert not client.call('zhigao_status').get('isError')
    client.close();client=None
    page.wait_for_function("a.agent.state==='waiting'", timeout=8000)
    client=MCP(script,env,log,page)
    online(page)
    page.reload();page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    online(page)
    # A new process must perform a fresh status round trip automatically; an old
    # proof alone must never be treated as verification of the new connection.
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')", timeout=8000)
    assert any(row['label'] == '查看状态' and row['ok'] for row in page.evaluate('a.agent.log'))


def verification_hub_replacement(page):
    global client, hub
    assert not client.call('zhigao_status').get('isError')
    client.close(); client = None
    hub.terminate(); hub.wait(timeout=10)
    page.wait_for_function("a.agent.state!=='online'", timeout=8000)
    hub = subprocess.Popen(['node', str(script), 'hub'], env=env, stdout=log, stderr=log,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    client = MCP(script, env, log, page)
    page.reload(); page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')", timeout=12000)
    assert any(row['label'] == '查看状态' and row['ok'] for row in page.evaluate('a.agent.log'))


def verification_idle_refresh(page):
    assert not client.call('zhigao_status').get('isError')
    page.wait_for_timeout(95000 if REAL_IDLE else 2800)
    page.reload(); page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')", timeout=15000)
    page.get_by_role('button', name='连接与授权', exact=True).click()
    page.screenshot(path=str(OUT/'idle-refresh-verified.png'),full_page=True)


CASES = [invitation_and_verified_project, activity_toolbar_removed, verification_project_scope, verification_explicit_disconnect, verification_network_recovery,
         wake_no_false_disconnect, stale_heartbeat_failure, stale_heartbeat_success, stale_session_rejection, manual_retry_interrupts_backoff,
         stopped_poll_cannot_reconnect, restored_page_session, multiple_tabs,
         outage_and_recovery, suspended_transport_and_resume, verification_client_replacement, verification_hub_replacement, verification_idle_refresh, hub_exit_and_client_takeover]
try:
    for _ in range(80):
        try:
            if health().get('app') == 'zhigao':
                break
        except OSError:
            time.sleep(.1)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        client = MCP(script, env, log)
        for case in CASES:
            if os.environ.get('ZHIGAO_CONNECTION_CASE') and case.__name__ != os.environ['ZHIGAO_CONNECTION_CASE']:
                continue
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            context.route('http://127.0.0.1:47821/**', lambda r: r.continue_(url=backend + r.request.url.split('47821', 1)[1]))
            page = context.new_page()
            errors = []; failed_requests=[]
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('requestfailed',lambda r:failed_requests.append({'url':r.url,'error':r.failure}))
            client.page = page
            try:
                page.goto(origin)
                page.wait_for_selector('#agent-chip')
                page.evaluate("async()=>window.a=await import('/agent.js')")
                online(page)
                case(page)
                assert not errors, errors
                result = {'name': case.__name__, 'passed': True}
            except Exception as error:
                page.screenshot(path=str(OUT / (case.__name__ + '-failure.png')), full_page=True)
                result = {'name': case.__name__, 'passed': False, 'error': str(error), 'pageErrors': errors,
                          'failedRequests':failed_requests,'diagnostic': page.evaluate("({state:window.a?.agent.state,held:!!window.held,releasePoll:typeof window.releasePoll,trace:window.pollTrace})")}
            finally:
                page.evaluate('window.a?.stopAgent()')
                page.wait_for_timeout(200)
                context.close()
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        client.close()
        client = None
        browser.close()
finally:
    if client:
        client.close()
    hub.terminate()
    hub.wait(timeout=10)
    server.shutdown()
    server.server_close()
    log.close()
    (OUT / 'result.json').write_text(json.dumps({'baseline': BASELINE, 'checks': results, 'passed': all(r['passed'] for r in results)}, ensure_ascii=False, indent=2), encoding='utf-8')
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
