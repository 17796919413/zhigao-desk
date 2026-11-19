"""Fresh browser, isolated HTTP fixtures; never talks to the user's real connector."""
from pathlib import Path
import functools
import http.server
import json
import os
import re
import sys
import threading
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('ZHIGAO_VERIFY_OUT') or os.environ.get('ZHIGAO_UPDATE_VERIFY_OUT',str(ROOT.parent / '_verify' / 'connector-updates-20261110')))
OUT.mkdir(parents=True, exist_ok=True)
web_version = re.search(r"WEB_VERSION='(\d+\.\d+\.\d+)'", (ROOT / 'connector-updates.js').read_text(encoding='utf-8')).group(1)
major, minor, patch = map(int, web_version.split('.'))
future_web_version = f'{major}.{minor}.{patch + 1}'


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
checks = []
errors = []
calls = []
fixture = {'mode': 'offline', 'busy': False, 'installed': '1.8.1', 'remote': '1.9.0', 'remote_failure': False}


def ok(name):
    checks.append(name)
    print('PASS ' + name, flush=True)


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))

        def local(route):
            if route.request.url.endswith('/health'):
                return route.fulfill(json={'app': 'zhigao', 'version': '1.8.1'})
            assert route.request.url.startswith('http://127.0.0.1:47821/page/update'), route.request.url
            action = json.loads(route.request.post_data)['action']
            calls.append(action)
            if fixture['mode'] == 'offline':
                return route.abort()
            if fixture['mode'] == 'legacy':
                return route.fulfill(status=404, json={'error': 'not found'})
            if action == 'apply' and not fixture['busy']:
                fixture['installed'] = '1.9.0'
            state = 'waiting_for_idle' if fixture['busy'] and action in ['apply', 'status'] else 'current' if fixture['installed'] == '1.9.0' else 'available'
            return route.fulfill(json={'ok': True, 'data': {'state': state, 'installedVersion': fixture['installed'], 'runningVersion': fixture.get('running',fixture['installed']), 'latestVersion': '1.9.0', 'canUpdate': fixture['installed'] != '1.9.0'}})

        def manifest(route):
            if fixture['remote_failure']:
                return route.abort()
            return route.fulfill(json={'name': 'zhigao', 'version': fixture['remote']})

        page.route('http://127.0.0.1:47821/**', local)
        page.route('**/setup-manifest.json?*', manifest)
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.locator('#agent-chip').click()
        check = page.locator('[data-action=connect-update-check]')
        assert check.is_visible() and check.is_enabled()
        assert page.locator('.connect-update').count() == 0
        assert page.locator('.connect-row').count() == 3
        page.screenshot(path=str(OUT / 'desktop-default.png'))
        ok('默认只增加检查更新按钮，保留原三项连接；未连接AI也可点击')

        check.click()
        page.get_by_text('未能读取本机版本。请打开 AI 客户端，将上方接入指令发给它。', exact=True).wait_for()
        assert page.get_by_role('button',name='启动连接器').count()==0 and page.get_by_role('button',name='安装 / 升级').count()==0
        page.screenshot(path=str(OUT/'desktop-offline.png'))
        assert '最新 1.9.0' in page.locator('.connect-update').inner_text()
        assert '未读取' in page.locator('.connect-update').inner_text()
        assert page.locator('[data-action=connect-update-apply]').count() == 0
        ok('离线能查线上新版，本机明确未读取，不误报已是最新')

        fixture['mode'] = 'legacy'
        check.click()
        page.get_by_text('当前连接器不支持网页升级。请将上方接入指令发给 AI 完成升级。', exact=True).wait_for()
        ok('旧版无升级接口时走 AI，不提供无效升级按钮')

        fixture['mode'] = 'ready'
        check.click()
        page.locator('[data-action=connect-update-apply]').wait_for()
        assert page.locator('[data-status=ai]').inner_text() == '未连接'
        assert page.get_by_role('button',name='升级到 1.9.0',exact=True).is_visible()
        page.screenshot(path=str(OUT / 'desktop-update.png'))
        ok('AI未连接时显示本机和目标版本，并可点击升级')

        page.locator('[data-action=connect-update-apply]').click()
        page.get_by_text('连接器已是最新版本。', exact=True).wait_for()
        assert page.locator('[data-status=ai]').inner_text() == '未连接'
        assert calls.count('apply') == 1
        ok('更新成功刷新版本，不擅自连接AI或操作业务资料')
        for running in [None,'1.8.1']:
            fixture['running']=running
            check.click()
            page.wait_for_function("!document.querySelector('[data-update-status]').textContent.includes('正在检查')")
            assert '已是最新' not in page.locator('.connect-update').inner_text()
        del fixture['running']
        ok('运行版本缺失或落后时不报已是最新')

        fixture['installed'] = '1.8.1'
        fixture['busy'] = True
        check.click()
        page.locator('[data-action=connect-update-apply]').click()
        page.get_by_text('正在处理任务，完成后自动更新。', exact=True).wait_for()
        fixture['busy'] = False
        fixture['installed'] = '1.9.0'
        page.get_by_text('连接器已是最新版本。', exact=True).wait_for(timeout=10000)
        ok('忙碌时等待，后台完成后面板自动刷新')

        fixture['remote_failure'] = True
        check.click()
        page.get_by_text('无法获取最新版本，请检查网络后重试。', exact=True).wait_for()
        ok('网络失败不会误报版本最新')

        fixture['remote_failure'] = False
        fixture['remote'] = future_web_version
        check.click()
        page.locator('[data-action=connect-update-refresh]').wait_for()
        assert page.locator('[data-action=connect-update-apply]').is_visible()
        assert '已是最新' not in page.locator('.connect-update').inner_text()
        ok('网页版本落后提供刷新入口；远端与本机检查不一致时不误报最新')

        fixture['remote'] = '1.9.0'
        fixture['installed'] = '1.8.1'
        check.click()
        page.locator('[data-action=connect-update-apply]').wait_for()
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path=str(OUT / 'mobile-update.png'))
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert page.locator('[data-action=connect-update-check]').is_visible()
        assert page.locator('.modal-footer').bounding_box()['y'] < 844
        ok('手机更新面板无横向溢出，检查和完成按钮可达')
        assert not errors, errors
        ok('页面无JavaScript异常')
        browser.close()
finally:
    server.shutdown()
    server.server_close()

(OUT / 'browser-result.json').write_text(json.dumps({'checks': checks, 'passed': len(checks), 'pageErrors': errors, 'requests': calls}, ensure_ascii=False, indent=2), encoding='utf-8')
