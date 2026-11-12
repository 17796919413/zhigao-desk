"""Pinned 1.11.0 modules versus current working tree, isolated homes/ports."""
import functools
import http.server
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import time
import urllib.request
import zipfile
from playwright.sync_api import sync_playwright
from mcp_client_fixture import MCP

http.server.ThreadingHTTPServer.request_queue_size=128
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('ZHIGAO_VERIFY_OUT', str(ROOT.parent / '_verify' / 'environment-reliability-20261112'))) / 'version-matrix'
OUT.mkdir(parents=True, exist_ok=True)
BASELINE = 'fb0c5b2b1748bf957b6bd7bf364c5444d56060d4'  # Verified 1.11.0, not the moving HEAD.
archive = zipfile.ZipFile(io.BytesIO(subprocess.check_output(['git', 'archive', '--format=zip', BASELINE], cwd=ROOT)))
old = {name: archive.read(name) for name in archive.namelist() if not name.endswith('/')}
old_version = '1.11.0'
assert f"const VERSION = '{old_version}'" in old['zhigao-connector.mjs'].decode(), 'Reassess compatibility baseline if the pinned reference changes'
results = []


def run(old_page, old_hub):
    name = ('old-web' if old_page else 'new-web') + '+' + ('old-hub' if old_hub else 'new-hub')
    target = OUT / name
    target.mkdir(exist_ok=True)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if not old_page:
                return super().do_GET()
            key = self.path.split('?', 1)[0].lstrip('/') or 'index.html'
            if key not in old:
                return self.send_error(404)
            data = old[key]
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript' if key.endswith(('.js', '.mjs')) else self.guess_type(key))
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
    home = target / 'empty-home'
    home.mkdir(exist_ok=True)
    hub_source = old['zhigao-connector.mjs'].decode() if old_hub else (ROOT / 'zhigao-connector.mjs').read_text(encoding='utf-8')
    hub_script = target / 'hub.mjs'
    hub_script.write_text(hub_source.replace('os.homedir()', json.dumps(str(home))), encoding='utf-8')
    script = target / 'client.mjs'
    script.write_text((ROOT / 'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()', json.dumps(str(home))), encoding='utf-8')
    env = {**os.environ, 'ZHIGAO_PORT': str(port), 'ZHIGAO_AUTO_UPDATE': '0', 'ZHIGAO_REGISTER_URI': '0', 'ZHIGAO_ORIGINS': origin}
    log = (target / 'connector.log').open('w', encoding='utf-8')
    process = subprocess.Popen(['node', str(hub_script), 'hub'], env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    client = None
    try:
        for _ in range(60):
            try:
                with urllib.request.urlopen(backend + '/health', timeout=1):
                    break
            except OSError:
                time.sleep(.1)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='msedge', headless=True)
            context = browser.new_context()
            context.route('http://127.0.0.1:47821/**', lambda r: r.continue_(url=backend + r.request.url.split('47821', 1)[1]))
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(origin)
            page.wait_for_selector('#agent-chip')
            client = MCP(script, env, log, page)
            response = client.call('zhigao_status')
            assert not response.get('isError'), response
            status = json.loads(response['content'][0]['text'])
            assert status['connected']
            if old_page:
                unsupported = client.call('zhigao_read_review_assets', {'docId': 'synthetic', 'reviewToken': 'fixture', 'assetIds': ['fixture']})
                assert unsupported.get('isError') and '刷新' in str(unsupported), unsupported
            page.screenshot(path=str(target / 'connected.png'))
            with urllib.request.urlopen(backend + '/health', timeout=1) as r:
                hub_health = json.load(r)
            assert hub_health['version'] == (old_version if old_hub else '1.12.2')
            assert not errors, errors
            result = {'case': name, 'passed': True, 'pageProtocol': status.get('protocolVersion'), 'runningVersion': hub_health['version'], 'pageErrors': errors}
            results.append(result)
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


run(True, False)
run(False, True)
(OUT / 'result.json').write_text(json.dumps({'count': len(results), 'cases': results, 'baseline': BASELINE, 'boundary': 'Pinned actual 1.11.0 versus current local source; synthetic stdio host, not real WorkBuddy.'}, ensure_ascii=False, indent=2), encoding='utf-8')
