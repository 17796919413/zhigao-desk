"""Explicit live acceptance on the disposable CP25 sheet; never a business sheet.

Requires ZHIGAO_GRID_LIVE=1, ZHIGAO_LIVE_STATE (setup receipt), and a new
ZHIGAO_VERIFY_OUT. Uses the current connector copy and an isolated Edge profile.
"""
from pathlib import Path
import functools
import http.server
import json
import os
import socket
import shutil
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

assert os.environ.get('ZHIGAO_GRID_LIVE') == '1'
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['ZHIGAO_VERIFY_OUT'])
OUT.mkdir(parents=True, exist_ok=False)
STATE = json.loads(Path(os.environ['ZHIGAO_LIVE_STATE']).read_text(encoding='utf-8'))
URL = 'https://scnplp5q8x3t.feishu.cn/sheets/RdEzsaU5NhFpKStfQ3xcGgHdnab'
assert STATE['url'] == URL and STATE['title'] == '知稿关键验收-1117-CP25'
SID = STATE['sheetId']
CLI = Path(os.environ['APPDATA']) / 'npm/node_modules/@larksuite/cli/bin/lark-cli.exe'
checks, errors, requests, snapshots = [], [], [], {}
RESUME = Path(os.environ['ZHIGAO_LIVE_RESUME']) if os.environ.get('ZHIGAO_LIVE_RESUME') else None
RESUME_FINISH = os.environ.get('ZHIGAO_LIVE_RESUME_STAGE') == 'structure-finish'
connector = None
log = (OUT / 'connector.log').open('w', encoding='utf-8')


def cli(args):
    proc = subprocess.run([str(CLI), *args, '--as', 'user', '--format', 'json'], capture_output=True, text=True, encoding='utf-8', timeout=90)
    result = json.loads(proc.stdout if proc.returncode == 0 else proc.stderr)
    assert proc.returncode == 0 and result.get('ok') is True, result.get('error')
    return result['data']


def snapshot(name):
    book = cli(['sheets', '+workbook-info', '--url', URL])
    meta = next(s for s in book['sheets'] if s['sheet_id'] == SID)
    assert meta['sheet_name'] == STATE['title']
    end = chr(64 + meta['column_count']) + str(meta['row_count'])
    cells = cli(['sheets', '+cells-get', '--url', URL, '--sheet-id', SID, '--range', 'A1:' + end, '--include', 'value,formula,style'])
    raw = cli(['api','GET',f'/open-apis/sheets/v2/spreadsheets/RdEzsaU5NhFpKStfQ3xcGgHdnab/values/{SID}!A1:{end}', '--params', '{"valueRenderOption":"UnformattedValue"}'])
    assert raw['revision'] == cells['revision'], 'Snapshot changed during read'
    value = {'book': book, 'meta': meta, 'cells': cells, 'raw': raw['valueRange']}
    snapshots[name] = value
    (OUT / (name + '.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    return value


def grid(value):
    return {f'{col}{row}': block['cells'][i][j]
            for block in value['cells']['ranges']
            for i, row in enumerate(block['row_indices'])
            for j, col in enumerate(block['col_indices'])}


def raw_at(value, address):
    column = ord(address[0]) - 65
    row = int(address[1:]) - 1
    return value['raw']['values'][row][column]


def passed(text):
    checks.append(text)
    (OUT / 'progress.json').write_text(json.dumps({'checks': checks, 'requests': requests}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS ' + text, flush=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.split('?')[0] == '/app.js':
            addition = '''\nwindow.probe={db:()=>db,state:()=>({settings,tasks,items}),persist:commitWorkbench,render,workbench,project,grid:sourceGrid};'''
            data = ((ROOT / 'app.js').read_text(encoding='utf-8') + addition).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


http.server.ThreadingHTTPServer.request_queue_size = 128
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{server.server_port}'
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    PORT = sock.getsockname()[1]


def backend(body):
    assert body.get('url') == URL and body.get('sheetId', SID) == SID
    assert body.get('action') in ['read', 'readAll', 'write', 'gridRead', 'gridImages', 'gridFloating', 'gridWrite', 'gridStructure', 'gridRecover', 'gridResolve']
    body = dict(body, sheetId=SID)
    aggregate = body['action'] == 'readAll'
    if aggregate:
        body['action'] = 'read'
    if body['action'] == 'write':
        assert len(body['writes']) == 1 and body['writes'][0]['field'] == 'outline'
        assert body['writes'][0]['key']['author'] in ['同名达人', '已通过达人']
    if body['action'] == 'gridWrite':
        assert body['address'] in ['B6', 'J10']
    if body['action'] == 'gridStructure':
        # Only our new blank row/column may be removed; all other content stays.
        assert (body['dimension'], body['position'], body['count']) in [('row', 2, 1), ('column', 5, 1)]
    requests.append({'action': body['action'], 'sheetId': SID, 'address': body.get('address'),
                     'kind': body.get('kind'), 'dimension': body.get('dimension'),
                     'position': body.get('position')})
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}/page/feishu', json.dumps(body, ensure_ascii=False).encode(), {'Origin': ORIGIN, 'Content-Type': 'text/plain'})
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            code, data = response.status, response.read()
    except urllib.error.HTTPError as error:
        code, data = error.code, error.read()
    if aggregate and code == 200:
        result = json.loads(data)
        if result.get('ok'):
            sheet = result['data']
            result['data'] = {'title': sheet['title'], 'revision': sheet['revision'], 'sheets': [sheet], 'identity': sheet['identity']}
            data = json.dumps(result, ensure_ascii=False).encode()
    return code, data


try:
    current = snapshot('resume-current' if RESUME else 'before')
    baseline = Path(os.environ['ZHIGAO_LIVE_BASELINE']) if os.environ.get('ZHIGAO_LIVE_BASELINE') else RESUME / 'before.json' if RESUME else None
    before = json.loads(baseline.read_text(encoding='utf-8')) if baseline else current
    (OUT / 'before.json').write_text(json.dumps(before, ensure_ascii=False, indent=2), encoding='utf-8')
    assert before['meta']['row_count'] == 12 and before['meta']['column_count'] == 10
    cells_before = grid(before)
    assert not cells_before['E2'].get('value') and not cells_before['E3'].get('value')
    assert cells_before['E4']['value'] == '品牌通过'
    home = OUT / 'isolated-home'
    if RESUME:
        shutil.copytree(RESUME / 'isolated-home', home)
        previous = json.loads((RESUME / 'progress.json').read_text(encoding='utf-8'))
        assert len(previous['checks']) == (6 if RESUME_FINISH else 3), 'Unexpected resume phase.'
        if not RESUME_FINISH:
            assert {k for k in grid(before) if grid(before)[k] != grid(current)[k]} <= {'E2', 'B6', 'C6', 'J10'}
        else:
            assert current['meta']['row_count'] == 13 and current['meta']['column_count'] == 11
        checks.extend(previous['checks'])
    else:
        home.mkdir()
    copy = OUT / 'zhigao-connector.mjs'
    copy.write_text((ROOT / 'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()', json.dumps(str(home))), encoding='utf-8')
    env = dict(os.environ, ZHIGAO_PORT=str(PORT), ZHIGAO_ORIGINS=ORIGIN, ZHIGAO_AUTO_UPDATE='0', ZHIGAO_REGISTER_URI='0')
    connector = subprocess.Popen(['node', str(copy), 'hub'], env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    for _ in range(100):
        try:
            with socket.create_connection(('127.0.0.1', PORT), timeout=.2):
                break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError('Isolated connector did not start')

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        seed = {'selected': 'p', 'projects': [{'id': 'p', 'name': '关键流程合成验收', 'date': 'basis', 'status': 'active',
                 'selectedActivity': 'a', 'activities': [{'id': 'a', 'name': '秋季活动', 'notes': ''}, {'id': 'b', 'name': '冬季活动', 'notes': ''}],
                 'rules': [], 'library': [], 'feishu': {'reviewTableVersion': 2, 'sheets': [], 'refined': {'url': URL, 'sheet': SID}}}]}
        context.add_init_script("if(!localStorage.getItem('critical-seeded')){localStorage.setItem('zhigao-settings-v1'," + json.dumps(json.dumps(seed, ensure_ascii=False)) + ");localStorage.setItem('critical-seeded','1');localStorage.setItem('zhigao-agent-v1','off')}")

        def route(request):
            if request.request.url.endswith('/page/feishu'):
                code, data = backend(request.request.post_data_json)
                request.fulfill(status=code, body=data, content_type='application/json')
            else:
                request.abort()

        context.route('http://127.0.0.1:47821/**', route)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(ORIGIN)
        page.wait_for_function('!!window.probe && !!probe.db()')
        page.evaluate('''async()=>{
          const records=[];
          for(const [id,activityId,author,title,complete] of [
            ['a','a','同名达人','同款内容',true],['b','b','同名达人','同款内容',true],
            ['approved','a','已通过达人','已确认内容',true],['partial','a','未审完达人','未完内容',false]]){
            const it={id:'i'+id,projectId:'p',activityId,author,platform:'小红书',title,kind:'图文',created:'2026-11-17',updated:'2026-11-17',publish:{date:'2099-01-01',status:'已发布'}};
            const t={id,itemId:it.id,projectId:'p',activityId,projectName:'关键流程合成验收',filename:id+'.txt',author,platform:it.platform,kind:it.kind,stage:'大纲',fmt:'text',created:'2026-11-17',updated:'2026-11-17',ruleDate:'basis',
              cells:[{id:'c',original:'合成正文',current:'合成正文'}],flow:{state:'review',round:1,feedback:[],submissions:[],log:[]},findings:[],rules:[],
              ai:{at:'review-'+id,changes:Array.from({length:id==='b'?2:1},(_,n)=>({cellId:'c',original:'合成',replacement:'合成',reason:'测试'+n})),warnings:[],assurance:{complete,projectRevision:'basis'},coverage:{complete},archive:{state:'saved',paths:['synthetic']}}};
            records.push(['items',it],['tasks',t]);
          }await probe.persist(records);probe.render();}''')
        if RESUME_FINISH:
            page.evaluate("""async()=>{const t=probe.state().tasks.find(t=>t.id==='b');await probe.persist([['tasks',{...t,ai:{...t.ai,at:'review-b-final',changes:[...t.ai.changes,{cellId:'c',original:'合成',replacement:'合成',reason:'恢复后的第三处测试修改'}]}}]]);probe.render()}""")

        def sync(doc='a', expected='saved'):
            old = page.evaluate('(id)=>probe.state().tasks.find(t=>t.id===id).feishuSync?.at', doc)
            page.locator(f'[data-action=wb-sync][data-id="{doc}"]').click()
            page.wait_for_function('([id,old])=>{const s=probe.state().tasks.find(t=>t.id===id)?.feishuSync;return s&&s.at!==old}', arg=[doc, old], timeout=90000)
            result = page.evaluate('(id)=>probe.state().tasks.find(t=>t.id===id).feishuSync', doc)
            assert result['state'] == expected, result

        a = grid(before)
        if not RESUME:
            sync()
            first = snapshot('first-sync')
            b = grid(first)
            assert [k for k in a if a[k] != b[k]] == ['E2']
            assert b['E2']['value'] == 'AI已审 · 1处修改'
            passed('真实单稿同步：120格仅E2变化，档期、发布、品牌反馈和其他活动保持')
            sync()
            page.reload()
            page.wait_for_function('!!window.probe && !!probe.db()')
            page.wait_for_selector('[data-action=wb-sync][data-id=a]')
            sync()
            repeated = snapshot('repeated-sync')
            assert repeated['book']['revision'] == first['book']['revision']
            passed('刷新后重复同步不重复写入，真实云表revision保持')

            before_attempt = len([r for r in requests if r['action'] == 'write'])
            sync('approved', expected='failed')
            assert len([r for r in requests if r['action'] == 'write']) == before_attempt
            page.locator('[data-action=wb-sync][data-id=partial]').click()
            page.wait_for_function("document.querySelector('#modal-root').textContent.includes('尚未审完')")
            page.locator('[data-action=close-modal]').last.click()
            assert snapshot('protected')['book']['revision'] == first['book']['revision']
            passed('已有品牌通过及未审完稿件均不写入，真实表保持原状态')

        page.locator('[data-page=feishu]').first.click()
        page.wait_for_selector('[data-grid-cell=J10]', timeout=90000)

        def edit(address, text):
            page.locator(f'[data-grid-cell={address}]').dblclick()
            page.locator('[data-grid-input]').fill(text)
            page.locator('[data-grid-input]').press('Enter')
            page.wait_for_function("document.querySelector('[data-grid-status]')?.textContent==='已保存'", timeout=90000)

        if not RESUME_FINISH:
            if grid(current)['J10'].get('value') != 'CP25 自动保存核验':
                edit('J10', 'CP25 自动保存核验')
            if raw_at(current, 'B6') != 13.5:
                edit('B6', '13.5')
            edited = snapshot('edited')
            e = grid(edited)
            assert raw_at(edited, 'B6') == 13.5
            assert e['C6']['formula'] == '=B6+1' and raw_at(edited, 'C6') == 14.5
            assert raw_at(edited, 'D6') == '001' and raw_at(edited, 'E6') is False
            passed('真实自动保存及回读：数字类型、关联公式重算、前导零文本和布尔保持')

        def structure(dimension, position, kind='insert'):
            page.locator(f'[data-grid-dimension={dimension}][data-grid-index="{position}"]').click()
            page.locator('.grid-structure-dialog select').select_option(kind)
            page.locator('.grid-structure-dialog input').fill('1')
            assert page.locator('[data-structure-preview]').inner_text()
            page.locator('[data-structure-submit]').click()
            page.wait_for_function("!Object.keys(localStorage).some(k=>k.startsWith('zhigao-grid-structure:')) && document.querySelector('[data-grid-status]')?.textContent==='行列已更新'", timeout=90000)

        if not RESUME_FINISH:
            structure('row', 2)
            structure('column', 5)
        shifted = snapshot('shifted')
        s = grid(shifted)
        assert shifted['meta']['row_count'] == 13 and shifted['meta']['column_count'] == 11
        assert s['F3']['value'] == 'AI已审 · 1处修改'
        assert s['F4'].get('value') == 'AI已审 · 2处修改' if RESUME_FINISH else not s['F4'].get('value')
        assert s['C7']['formula'] == '=B7+1' and raw_at(shifted, 'C7') == 14.5
        if not RESUME_FINISH:
            passed('真实插行插列：数据、阶段列和公式引用按源表移动')
        page.locator('[data-page=home]').first.click()
        page.locator('[aria-label="当前活动"]').select_option('b')
        sync('b')
        winter = snapshot('winter-sync')
        w = grid(winter)
        assert w['F4']['value'] == ('AI已审 · 3处修改' if RESUME_FINISH else 'AI已审 · 2处修改')
        assert [k for k in s if s[k] != w[k]] == ['F4']
        if not RESUME_FINISH:
            passed('插行插列后真实重新定位同名达人另一活动，143格仅F4变化')

        page.locator('[data-page=feishu]').first.click()
        page.wait_for_selector('[data-grid-cell=K10]', timeout=90000)
        page.wait_for_function("!document.querySelector('[data-grid-refresh]').disabled", timeout=90000)
        # Delete only the blank row and column created above in this disposable sheet.
        assert all(not w[f'E{row}'].get('value') and not w[f'E{row}'].get('formula') for row in range(1,14))
        assert all(not w[f'{col}2'].get('value') and not w[f'{col}2'].get('formula') for col in 'ABCDEFGHIJK')
        structure('column', 5, 'delete')
        structure('row', 2, 'delete')
        final = snapshot('final')
        f = grid(final)
        assert final['meta']['row_count'] == 12 and final['meta']['column_count'] == 10
        expected = {'E2', 'E3', 'B6', 'C6', 'J10'}
        changed = {k for k in a if a[k] != f[k]}
        assert changed == expected, changed
        for key in a:
            assert a[key].get('cell_styles') == f[key].get('cell_styles'), key
        for old in before['book']['sheets']:
            if old['sheet_id'] != SID:
                assert next(x for x in final['book']['sheets'] if x['sheet_id'] == old['sheet_id']) == old
        passed('删除本批新增空行空列后结构恢复：120格仅5个预期变化，原样式及其他子表元数据保持')
        page.screenshot(path=str(OUT / 'critical-desktop.png'), full_page=True)
        page.set_viewport_size({'width':390, 'height':844})
        page.screenshot(path=str(OUT / 'critical-narrow.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert not errors, errors
        passed('真实Edge桌面和390px窄屏渲染通过，无页面溢出或脚本错误')
        (OUT / 'result.json').write_text(json.dumps({'ok':True, 'checks':checks, 'errors':errors, 'requests':requests, 'live':True, 'sheetId':SID, 'browser':browser.version, 'initialRevision':before['book']['revision'], 'finalRevision':final['book']['revision'], 'changedCells':sorted(changed)}, ensure_ascii=False, indent=2), encoding='utf-8')
        browser.close()
except Exception:
    (OUT / 'failure.json').write_text(json.dumps({'ok':False, 'checks':checks, 'errors':errors, 'requests':requests, 'traceback':traceback.format_exc()}, ensure_ascii=False, indent=2), encoding='utf-8')
    raise
finally:
    server.shutdown()
    if connector:
        connector.terminate()
        connector.wait(timeout=10)
    log.close()
