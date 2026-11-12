"""Publisher fixtures exercise real downloads, validation, idle updates and live MCP adoption."""
import concurrent.futures
import hashlib
import http.server
import json
import os
import subprocess
import threading
import time
import unittest
import uuid
import connector_runtime_test as rt


class UpdateTests(unittest.TestCase):
    setUp = rt.RuntimeTests.setUp
    tearDown = rt.RuntimeTests.tearDown
    write = rt.RuntimeTests.write
    start = rt.RuntimeTests.start
    request = rt.RuntimeTests.request
    health = rt.RuntimeTests.health
    wait_health = rt.RuntimeTests.wait_health

    def publisher(self, auto=False):
        case = self
        self.downloads = []
        self.remote_status = 200

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                case.downloads.append(self.path)
                body = json.dumps(case.manifest).encode() if self.path == '/setup-manifest.json' else case.payload
                self.send_response(case.remote_status)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.write()
        text = self.script.read_text(encoding='utf-8').replace("const SITE = 'https://17796919413.github.io/zhigao-desk/';", f"const SITE = 'http://127.0.0.1:{server.server_port}/';")
        self.script.write_text(text, encoding='utf-8')
        self.payload = text.replace("const VERSION = '1.12.2'", "const VERSION = '1.12.3'").encode()
        self.manifest = {'schemaVersion': 1, 'name': 'zhigao', 'version': '1.12.3', 'connector': './zhigao-connector.mjs', 'runtime': {'minimumMajor': 18}, 'autoUpdate': {'protocol': 1, 'sha256': hashlib.sha256(self.payload).hexdigest()}}
        if auto:
            self.env['ZHIGAO_AUTO_UPDATE'] = '1'

    def update(self, action):
        code, body = self.request('/page/update', {'action': action}, origin=rt.ORIGIN, timeout=25)
        self.assertEqual(code, 200, body)
        self.assertTrue(body['ok'], body)
        return body['data']

    def test_check_and_update_without_ai_or_browser_connection(self):
        self.publisher()
        p = self.start('hub')
        self.wait_health(lambda h: h['version'] == '1.12.2')
        original = self.script.read_bytes()
        result = self.update('check')
        self.assertEqual(result['state'], 'available')
        self.assertEqual(result['installedVersion'], '1.12.2')
        self.assertEqual(result['latestVersion'], '1.12.3')
        self.assertEqual(self.script.read_bytes(), original)
        self.assertEqual(result['checkIntervalHours'], 6)
        self.assertEqual(result['retryMinutes'], 15)
        result = self.update('apply')
        self.assertEqual(result['state'], 'current', result)
        h = self.wait_health(lambda h: h['version'] == '1.12.3')
        self.assertEqual(h['pid'], p.pid)
        self.assertEqual(h['clients'], [])
        self.assertFalse(h['page'])
        self.assertEqual(self.script.read_bytes(), self.payload)
        self.assertTrue(list(self.script.parent.glob('*.bak-zhigao-*')))

    def test_existing_mcp_session_uses_new_runtime_without_restart(self):
        self.publisher()
        p = self.start(name='existing-codex-session', capture_initialize=True)
        self.assertEqual(json.loads(p.stdout.readline())['id'], 1)
        self.wait_health(lambda h: h['version'] == '1.12.2')
        self.assertEqual(self.update('apply')['state'], 'current')
        event = json.loads(p.stdout.readline())
        self.assertEqual(event['method'], 'notifications/tools/list_changed')
        p.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': 7, 'method': 'tools/call', 'params': {'name': 'zhigao_setup_status', 'arguments': {}}})+'\n')
        p.stdin.flush()
        response = json.loads(p.stdout.readline())
        status = json.loads(response['result']['content'][0]['text'])
        self.assertEqual(response['id'], 7)
        self.assertEqual(status['version'], '1.12.3')
        self.assertEqual(status['connector']['state'], 'installed')
        self.assertIsNone(p.poll())

    def test_startup_auto_update_and_no_five_second_network_polling(self):
        self.publisher(auto=True)
        self.start('hub')
        self.wait_health(lambda h: h['version'] == '1.12.3', timeout=14)
        count = len(self.downloads)
        time.sleep(6)
        self.assertEqual(len(self.downloads), count)

    def test_busy_request_defers_update_then_completes(self):
        self.publisher(auto=True)
        self.env['FAKE_DELAY'] = '2500'
        self.start('hub')
        self.wait_health(lambda h: h['version'] == '1.12.2')
        with concurrent.futures.ThreadPoolExecutor() as pool:
            call = pool.submit(self.request, '/page/feishu', {'action': 'status'}, False, rt.ORIGIN)
            self.wait_health(lambda h: h['busy'])
            self.assertEqual(self.update('apply')['state'], 'waiting_for_idle')
            self.assertEqual(self.health()['version'], '1.12.2')
            self.assertEqual(call.result()[1]['data']['state'], 'ready')
        self.wait_health(lambda h: h['version'] == '1.12.3', timeout=12)

    def test_integrity_failure_retains_working_installation(self):
        self.publisher()
        self.manifest['autoUpdate']['sha256'] = '0' * 64
        self.start('hub')
        self.wait_health(lambda h: h['version'] == '1.12.2')
        before = self.script.read_bytes()
        result = self.update('apply')
        self.assertEqual(result['error'], 'UPDATE_INTEGRITY')
        self.assertEqual(self.script.read_bytes(), before)
        self.assertEqual(self.health()['version'], '1.12.2')

    def test_syntax_and_activation_errors_restore_old_version(self):
        self.publisher()
        self.start('hub')
        self.wait_health(lambda h: h['version'] == '1.12.2')
        before = self.script.read_bytes()
        valid = self.payload
        for suffix, error in [(b'\ninvalid syntax }', 'UPDATE_SYNTAX'), (b'\nthrow Error("fixture activation failure");', 'UPDATE_FAILED')]:
            self.payload = valid + suffix
            self.manifest['autoUpdate']['sha256'] = hashlib.sha256(self.payload).hexdigest()
            result = self.update('apply')
            self.assertEqual(result['error'], error, result)
            self.assertEqual(self.script.read_bytes(), before)
            self.assertEqual(self.health()['version'], '1.12.2')

    def test_network_error_and_untrusted_manifest_never_claim_current(self):
        self.publisher()
        self.start('hub')
        self.wait_health(lambda h: h['version'] == '1.12.2')
        self.remote_status = 503
        result = self.update('check')
        self.assertEqual(result['state'], 'error')
        self.assertEqual(result['error'], 'UPDATE_NETWORK')
        self.assertEqual(result['installedVersion'], '1.12.2')
        self.remote_status = 200
        self.manifest['connector'] = 'https://untrusted.example/other.mjs'
        self.assertEqual(self.update('apply')['error'], 'UPDATE_MANIFEST')
        self.assertNotIn('/zhigao-connector.mjs', self.downloads)

    def test_foreign_origin_cannot_trigger_updates(self):
        self.publisher()
        self.start('hub')
        self.wait_health(lambda h: h['version'] == '1.12.2')
        code, _ = self.request('/page/update', {'action': 'apply'}, origin='https://untrusted.example')
        self.assertEqual(code, 403)
        self.assertEqual(self.downloads, [])

    @unittest.skipUnless(os.name == 'nt', 'Windows protocol launcher')
    def test_native_launcher_handles_unicode_and_starts_without_ai(self):
        self.home = self.home / '中文 路径'
        self.home.mkdir()
        self.script = self.home / '.zhigao' / 'zhigao-connector.mjs'
        self.script.parent.mkdir()
        self.write()
        scheme = 'zhigao-smoke-' + uuid.uuid4().hex
        key = 'HKCU\\Software\\Classes\\' + scheme
        text = self.script.read_text(encoding='utf-8').replace('Classes\\\\zhigao-desk', 'Classes\\\\'+scheme)
        self.script.write_text(text, encoding='utf-8')
        self.env['ZHIGAO_REGISTER_URI'] = '1'
        try:
            p = subprocess.run([rt.NODE, str(self.script), 'setup', '--client', 'manual', '--json'], env=self.env, capture_output=True, text=True, encoding='utf-8', timeout=25)
            result = json.loads(p.stdout)
            self.assertEqual(result['launcher']['state'], 'registered', result)
            launcher = self.script.parent / 'open-connector.vbs'
            self.assertTrue(launcher.read_bytes().startswith(b'\xff\xfe'))
            self.assertNotIn('%1', launcher.read_text(encoding='utf-16'))
            subprocess.run([os.path.join(os.environ['SystemRoot'], 'System32', 'wscript.exe'), str(launcher)], env=self.env, timeout=10, check=True)
            h = self.wait_health(lambda h: h['version'] == '1.12.2', timeout=10)
            self.extra_pids.add(h['pid'])
            self.assertEqual(h['clients'], [])
            self.assertFalse(h['page'])
        finally:
            subprocess.run(['reg.exe', 'delete', key, '/f'], capture_output=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
