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
import shutil
import subprocess
import threading
import time
import traceback
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
if not os.environ.get('ZHIGAO_SESSION_FIXTURES_DIR'):
    # These cases model standalone MCP clients. Do not attach their synthetic
    # clientInfo names to the real Codex instance running this test harness.
    # application_session_matrix separately tests the unmodified OS discovery.
    source=source.replace('me.owner=await discoverClientOwner(me.name);','me.owner=null;')
script.write_text(source if REAL_IDLE else source.replace('}, 25000)', '}, 600)').replace('pageStale:120000', 'pageStale:2500')
                  .replace('now - c.seen > 90000', 'now - c.seen > 10000')
                  .replace('}, 5000).unref();', '}, 200).unref();'), encoding='utf-8')
env = {**os.environ, 'ZHIGAO_PORT': str(port), 'ZHIGAO_AUTO_UPDATE': '0', 'ZHIGAO_REGISTER_URI': '0', 'ZHIGAO_ORIGINS': origin}
log = (OUT / 'connector.log').open('w', encoding='utf-8')
env.update(ZHIGAO_LARK_CLI=str(ROOT/'tests/grid_access_lark.mjs'), ZHIGAO_ACCESS_FIXTURE=str(home))
(home/'table.json').write_text('{}')
(home/'authorized').touch()
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
      const u=String(args[0]);if((u.endsWith('/page/poll')||u.endsWith('/page/heartbeat'))&&dropPoll)throw new TypeError('newer request failed');
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
    assert '连接中断' in page.locator('[data-status="ai"]').inner_text()
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
    # Takeover can finish between two page heartbeats. Require recovery and
    # the correct listener, not an observable transient amber frame.
    deadline=time.monotonic()+12
    while time.monotonic()<deadline:
        try:
            if health()['pid']==client.p.pid:
                break
        except OSError:
            pass
        page.wait_for_timeout(100)
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


def independent_browser_handoff(page):
    assert not client.call('zhigao_status').get('isError')
    page.wait_for_function('a.agent.verification?.at')
    other=page.context.browser.new_context()
    other.route('http://127.0.0.1:47821/**', lambda r: r.continue_(url=backend+r.request.url.split('47821',1)[1]))
    try:
        tab=other.new_page();tab.goto(origin);tab.evaluate("async()=>window.a=await import('/agent.js')")
        tab.wait_for_function("a.agent.state==='other-tab'")
        tab.get_by_role('button',name='连接与授权',exact=True).click()
        tab.get_by_role('button',name='在此浏览器接入',exact=True).click()
        tab.wait_for_function('a.agent.verification?.at');page.wait_for_function("a.agent.state==='other-tab'")
        client.page=tab
        result=json.loads(client.call('zhigao_status')['content'][0]['text'])
        assert result['invitationPage']==tab.evaluate("async()=>(await import('/connection-status.js')).invitationPage")
        tab.screenshot(path=str(OUT/'handoff.png'))
    finally:
        other.close();client.page=page


def invitation_and_verified_project(page):
    # Initialized MCP/heartbeats alone must not count as successful project access.
    assert '等待接入' in page.locator('#agent-chip').inner_text()
    page.get_by_role('button', name='连接与授权', exact=True).click()
    button = page.get_by_role('button', name='复制接入指令', exact=True)
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
    assert page.evaluate('(async()=>{const {verifiedConnection}=await import("/connection-status.js");return verifiedConnection(a.agent,"another-project-id")})()') is True
    page.screenshot(path=str(OUT/'onboarding-verified.png'),full_page=True)
    # A real successful call stays verified across refresh while that client is live.
    page.reload();page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    online(page)
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')", timeout=5000)
    page.get_by_role('button', name='连接与授权', exact=True).click()
    assert page.locator('[data-status="ai"]').inner_text() == 'AI 可用'
    page.wait_for_function("document.querySelector('[data-status=feishu]')?.textContent==='已登录'")
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
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')")
    page.reload();page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    online(page)
    assert 'AI 可用' in page.locator('#agent-chip').inner_text()
    assert client.call('zhigao_status', {'project':original}).get('isError')
    assert 'AI 可用' in page.locator('#agent-chip').inner_text()
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
    assert '等待接入' in page.locator('#agent-chip').inner_text()


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
    page.wait_for_function('a.agent.verification?.at')
    previous_at=page.evaluate('a.agent.verification.at')
    client.close();client=None
    page.wait_for_function("a.agent.state==='waiting'", timeout=8000)
    client=MCP(script,env,log,page)
    online(page)
    page.reload();page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    online(page)
    # A new application session cannot reuse the former session's green light.
    page.wait_for_timeout(3000)
    assert '等待接入' in page.locator('#agent-chip').inner_text()
    assert not client.call('zhigao_status').get('isError')
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')", timeout=8000)
    page.wait_for_function('(previous)=>a.agent.verification?.at>previous',arg=previous_at,timeout=8000)


def stale_verification_ack(page):
    global client
    assert not client.call('zhigao_status').get('isError')
    page.evaluate('''()=>{const original=window.fetch;window.fetch=async(url,init)=>{
      const response=await original(url,init);
      if(String(url).endsWith('/page/result')&&!window.releaseStatusAck){
        return new Promise(resolve=>window.releaseStatusAck=()=>resolve(response));
      }return response;
    }}''')
    assert not client.call('zhigao_status').get('isError')
    page.wait_for_function("typeof window.releaseStatusAck==='function'")
    client.close();client=None
    page.wait_for_function("a.agent.state==='waiting'")
    client=MCP(script,env,log,page);online(page)
    assert '等待接入' in page.locator('#agent-chip').inner_text()
    page.evaluate('releaseStatusAck()');page.wait_for_timeout(500)
    assert '等待接入' in page.locator('#agent-chip').inner_text(), 'old status acknowledgement revived an exited AI session'


def verification_hub_replacement(page):
    global client, hub
    assert not client.call('zhigao_status').get('isError')
    page.wait_for_function('a.agent.verification?.at')
    previous_at=page.evaluate('a.agent.verification.at')
    hub.terminate(); hub.wait(timeout=10)
    hub = subprocess.Popen(['node', str(script), 'hub'], env=env, stdout=log, stderr=log,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    page.reload(); page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')", timeout=12000)
    assert page.evaluate('a.agent.verification.at')==previous_at


def verification_idle_refresh(page):
    assert not client.call('zhigao_status').get('isError')
    page.wait_for_timeout(95000 if REAL_IDLE else 2800)
    page.reload(); page.wait_for_selector('#agent-chip')
    page.evaluate("async()=>window.a=await import('/agent.js')")
    page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')", timeout=15000)
    page.get_by_role('button', name='连接与授权', exact=True).click()
    page.screenshot(path=str(OUT/'idle-refresh-verified.png'),full_page=True)


def idle_surviving_client(page):
    assert not client.call('zhigao_status').get('isError')
    # Read the acknowledged proof, not the page's optimistic progress event.
    page.wait_for_timeout(10500 if REAL_IDLE else 400)
    original=page.evaluate('a.agent.verification.at')
    other=MCP(script,env,log,page,name='isolated-review-test')
    try:
        assert not other.call('zhigao_status').get('isError')
        page.wait_for_function('t=>a.agent.verification?.at>t',arg=original)
    finally:
        other.close()
    page.wait_for_timeout(95000 if REAL_IDLE else 3000)
    assert page.evaluate('a.agent.verification?.at')==original, 'still-online client lost its own verification'
    page.reload();page.wait_for_function("document.querySelector('#agent-chip')?.textContent.includes('AI 可用')")


def automatic_feishu_status(page):
    def assert_status(label):
        page.get_by_role('button',name='连接与授权',exact=True).click()
        page.wait_for_function("label=>document.querySelector('[data-status=feishu]')?.textContent===label",arg=label,timeout=6000)
    assert_status('已登录')
    (home/'authorized').unlink()
    try:
        page.reload();assert_status('待登录飞书')
        page.screenshot(path=str(OUT/'expired-feishu.png'))
    finally:
        (home/'authorized').touch()
    page.reload();assert_status('已登录')


class OwnerMCP(MCP):
    def close(self):
        if self.p.poll() is None:
            self.rpc('fixture/close',{})
            self.p.wait(timeout=15)


def feishu_stale_response_and_wake(page):
    page.get_by_role('button',name='连接与授权',exact=True).click()
    page.wait_for_function("document.querySelector('[data-status=feishu]')?.textContent==='已登录'")
    calls=(home/'calls.jsonl').read_text().count('\n')
    page.wait_for_timeout(800)
    assert (home/'calls.jsonl').read_text().count('\n')==calls, 'heartbeats must not flood auth checks'
    page.evaluate('''()=>{const original=window.fetch;window.fetch=async(url,init)=>{
      const response=await original(url,init);
      if(String(url).endsWith('/page/feishu')&&!window.releaseFeishu){
        return new Promise(resolve=>window.releaseFeishu=()=>resolve(response));
      }return response;
    }}''')
    page.locator('[data-action="connect-check"]').click()
    page.wait_for_function("typeof window.releaseFeishu==='function'")
    (home/'authorized').unlink()
    try:
        result=client.call('zhigao_setup_status',{'verifyFeishu':True})
        assert not result.get('isError'),result
        page.evaluate('releaseFeishu()')
        page.wait_for_function("document.querySelector('[data-status=feishu]')?.textContent==='待登录飞书'")
        page.wait_for_timeout(500)
        assert page.locator('[data-status=feishu]').inner_text()=='待登录飞书'
    finally:
        (home/'authorized').touch()
    page.evaluate('''()=>{const now=Date.now;Date.now=()=>now()+300001;window.dispatchEvent(new Event('focus'))}''')
    page.wait_for_function("document.querySelector('[data-status=feishu]')?.textContent==='已登录'")


def application_session_matrix(page):
    global client, hub
    fixture_dir=Path(os.environ['ZHIGAO_SESSION_FIXTURES_DIR'])
    evidence=[]
    for name,exe in [('codex-mcp-client','codex.exe'),('Claude Code','claude.exe'),('WorkBuddy','WorkBuddy.exe'),('DeepSeek Harness','dsh.exe')]:
        page.evaluate('a.stopAgent()');client.close()
        command=[str(fixture_dir/exe),shutil.which('node'),str(script)]
        wire_name='zhigao'
        client=OwnerMCP(script,env,log,page,name=wire_name,command=command)
        print(json.dumps({'application':name,'stage':'native owner initialized'},ensure_ascii=False),flush=True)
        page.evaluate('void a.startAgent()');online(page)
        assert '等待接入' in page.locator('#agent-chip').inner_text()
        assert not client.call('zhigao_status').get('isError')
        page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')")
        proof=page.evaluate('a.agent.verification.at')
        page.locator('.navbtn[data-page="rules"]').click()
        page.locator('[data-action="new-project"]').click()
        page.locator('#new-project-name').fill(name+' 合成品牌')
        page.locator('[data-action="create-project"]').click()
        assert 'AI 可用' in page.locator('#agent-chip').inner_text()
        # No MCP heartbeat at all. The independently verified application owner
        # remains alive beyond the old connector's expiry threshold.
        client.rpc('fixture/stop',{})
        page.wait_for_timeout(95000 if REAL_IDLE else 3000)
        assert page.evaluate('a.agent.verification.at')==proof
        # The hub may restart while the AI is alive and between MCP calls.
        hub.terminate();hub.wait(timeout=10)
        hub=subprocess.Popen(['node',str(script),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        page.reload();page.wait_for_selector('#agent-chip');page.evaluate("async()=>window.a=await import('/agent.js')")
        page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')",timeout=12000)
        assert page.evaluate('a.agent.verification.at')==proof
        client.rpc('fixture/start',{})
        client.rpc('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':wire_name,'version':'fixture'}})
        page.wait_for_timeout(500)
        assert page.evaluate('a.agent.verification.at')==proof
        page.get_by_role('button',name='连接与授权',exact=True).click()
        page.wait_for_function("document.querySelector('[data-status=feishu]')?.textContent==='已登录'")
        page.screenshot(path=str(OUT/(exe+'-session-retained.png')))
        client.close()
        page.wait_for_function("a.agent.state==='waiting'",timeout=25000 if REAL_IDLE else 8000)
        assert 'AI 可用' not in page.locator('#agent-chip').inner_text()
        # Same app name, new PID/start time: a copied browser marker cannot grant
        # a new session permission, even after a refresh and several heartbeats.
        client=OwnerMCP(script,env,log,page,name=wire_name,command=command)
        online(page);page.reload();page.wait_for_selector('#agent-chip')
        page.evaluate("async()=>window.a=await import('/agent.js')");online(page)
        page.wait_for_timeout(3000)
        assert '等待接入' in page.locator('#agent-chip').inner_text()
        assert not client.call('zhigao_status').get('isError')
        page.wait_for_function("document.querySelector('#agent-chip').textContent.includes('AI 可用')")
        evidence.append({'client':name,'brandSwitch':True,'refresh':True,'childRestart':True,'hubRestartWithoutChild':True,'appExitRevokes':True,'sameNameRestartRequiresConnect':True,'idleSeconds':95 if REAL_IDLE else 3,'kind':'synthetic native owner + real MCP protocol, not installed app UI'})
        print(json.dumps({'application':name,'stage':'lifecycle passed'},ensure_ascii=False),flush=True)
    (OUT/'application-matrix.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
    client.close();client=MCP(script,env,log,page)


def invitation_recovery_matrix(page):
    global client
    for name in ['codex-mcp-client','Claude Code','WorkBuddy','DeepSeek Harness']:
        page.evaluate('a.stopAgent()');client.close()
        page.reload();page.wait_for_selector('#agent-chip');page.evaluate("async()=>window.a=await import('/agent.js')")
        assert page.evaluate('a.agent.state')=='off'
        page.get_by_role('button',name='连接与授权',exact=True).click()
        page.evaluate("()=>{navigator.clipboard.writeText=async()=>{throw Error('test manual copy')}}")
        page.get_by_role('button',name='复制接入指令',exact=True).click()
        invitation=page.locator('#connect-invitation').input_value()
        assert 'AI 可用' not in page.locator('[data-status=ai]').inner_text()
        client=MCP(script,env,log,page,name=name);online(page)
        result=client.call('zhigao_status');assert not result.get('isError'),result
        payload=json.loads(result['content'][0]['text']);assert payload['invitationPage'] in invitation
        page.wait_for_function("document.querySelector('[data-status=ai]').textContent==='AI 可用'")
        assert name in page.locator('[data-connection=ai] .connect-copy').inner_text()
        assert page.evaluate("document.activeElement.id==='connect-invitation' && document.activeElement.selectionEnd>0")
    page.screenshot(path=str(OUT/'invitation-recovered.png'))
    client.close();client=MCP(script,env,log,page)


def simultaneous_clients(page):
    # Both protocol clients report the same generic name; no OS owner is known.
    global client
    client.close();client=MCP(script,env,log,page,name='zhigao')
    second=MCP(script,env,log,page,name='zhigao')
    try:
        wrong=second.call('zhigao_status',{'invitationPage':'obsolete-page'})
        assert wrong.get('isError') and 'INVITATION_PAGE_MISMATCH' in str(wrong)
        assert not page.evaluate('a.agent.verification')
        assert not client.call('zhigao_status').get('isError')
        page.wait_for_function('!!a.agent.verification')
        client.close()
        page.wait_for_function("a.agent.state==='online'&&!a.agent.verification",timeout=20000)
        actual=page.evaluate("async()=>(await import('/connection-status.js')).invitationPage")
        assert not second.call('zhigao_status',{'invitationPage':actual}).get('isError')
        page.wait_for_function('!!a.agent.verification')
    finally:
        second.close();client=MCP(script,env,log,page,name='AI')
    assert not client.call('zhigao_status').get('isError')
    page.wait_for_function("a.agent.verification?.client==='AI'")


def first_review_after_idle(page):
    def call(name, args):
        r=client.call('zhigao_'+name,args)
        assert not r.get('isError'),r
        return json.loads(r['content'][0]['text'])
    # Seed a single text manuscript in this temporary browser only.
    page.evaluate('''async()=>{const p={id:'candidate',name:'合成测试',rules:[],library:[{id:'brief',kind:'Brief',title:'测试要求',text:'删除相邻重复词。',active:true}]},now=new Date().toISOString();localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:p.id,projects:[p]}));const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk');q.onsuccess=()=>r(q.result)});await new Promise((r,j)=>{const tx=db.transaction(['tasks','items'],'readwrite');tx.objectStore('items').put({id:'item',projectId:p.id,title:'合成稿',created:now,publish:{status:'待排期'}});tx.objectStore('tasks').put({id:'draft',itemId:'item',projectId:p.id,filename:'合成稿.txt',fmt:'text',stage:'初稿',cells:[{id:'p',current:'测试测试完成。',original:'测试测试完成。'}],flow:{state:'review',round:1,feedback:[]},rules:[],findings:[],created:now,updated:now});tx.oncomplete=r;tx.onerror=()=>j(tx.error)});db.close()}''')
    page.reload();page.wait_for_selector('.wb-row')
    page.evaluate("async()=>window.a=await import('/agent.js')");online(page)
    original=page.evaluate("async()=>(await import('/connection-status.js')).invitationPage")
    assert call('status',{'project':'candidate','invitationPage':original})=={'connected':True,'currentProjectId':'candidate','invitationPage':original,'message':'已连接知稿，可以开始审稿。'}
    page.wait_for_timeout(95000 if REAL_IDLE else 3100)
    page.reload();page.wait_for_function("document.querySelector('#agent-chip')?.textContent.includes('AI 可用')")
    brief=call('get_review_brief',{'docId':'draft'});args={'docId':'draft','reviewToken':brief['reviewToken']}
    sources=[]
    for section,meta in brief['context'].items():
        if meta['required'] and not meta.get('complete'):
            cursor=meta.get('nextCursor')
            while True:
                rows=call('read_review_context',{**args,'section':section,**({'cursor':cursor} if cursor else {})});cursor=rows['nextCursor']
                if section=='sources':sources.extend(rows['items'])
                if not cursor:break
    result={'snapshot':brief['snapshot'],'basis':brief['basis'],'reviewedIds':['p'],'ruleChecks':[],'sourceChecks':[],'mediaChecks':[],'warnings':[], 'changes':[{'id':'p','original':'测试测试完成。','revised':'测试完成。','reason':'删除重复的测试二字'}]}
    assert len(sources)==1 and sources[0]['text']=='删除相邻重复词。',sources
    result['sourceChecks']=[{'id':sources[0]['id'],'status':'checked','application':'applies','quote':sources[0]['text'],'reason':'稿件开头连续出现两次测试，按要求保留一次。','evidence':[{'blockId':'p','quote':'测试测试完成。'}]}]
    saved=call('submit_review',{**args,'result':result});assert saved['assurance']['complete'],saved
    page.reload();page.wait_for_selector('.wb-row')
    change=page.evaluate('''async()=>{const db=await new Promise(r=>{const q=indexedDB.open('zhigao-desk');q.onsuccess=()=>r(q.result)});try{return await new Promise(r=>{const q=db.transaction('tasks').objectStore('tasks').get('draft');q.onsuccess=()=>r(q.result.ai.changes[0])})}finally{db.close()}}''')
    assert change['revised']=='测试完成。' and change['status']=='pending',change


CASES = [idle_surviving_client, automatic_feishu_status, feishu_stale_response_and_wake, invitation_recovery_matrix,invitation_and_verified_project, activity_toolbar_removed, verification_project_scope, verification_explicit_disconnect, verification_network_recovery,
         wake_no_false_disconnect, stale_heartbeat_failure, stale_heartbeat_success, stale_session_rejection, manual_retry_interrupts_backoff,
         stopped_poll_cannot_reconnect, restored_page_session, multiple_tabs, independent_browser_handoff,
         outage_and_recovery, suspended_transport_and_resume, verification_client_replacement, stale_verification_ack, verification_hub_replacement, verification_idle_refresh, hub_exit_and_client_takeover]
if not os.environ.get('ZHIGAO_SESSION_FIXTURES_DIR'):
    CASES.extend([simultaneous_clients,first_review_after_idle])
if os.environ.get('ZHIGAO_SESSION_FIXTURES_DIR'):
    CASES.insert(0,application_session_matrix)
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
                result = {'name': case.__name__, 'passed': False, 'error': str(error), 'traceback':traceback.format_exc(), 'pageErrors': errors,
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
