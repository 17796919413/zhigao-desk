"""Synthetic, isolated environment faults; never touches installed connector or clients."""
import concurrent.futures
import http.server
import json
import os
from pathlib import Path
import socket
import threading
import time
import unittest
import connector_runtime_test as rt


class EnvironmentTests(unittest.TestCase):
    setUp = rt.RuntimeTests.setUp
    tearDown = rt.RuntimeTests.tearDown
    write = rt.RuntimeTests.write
    start = rt.RuntimeTests.start
    request = rt.RuntimeTests.request
    health = rt.RuntimeTests.health
    wait_health = rt.RuntimeTests.wait_health
    cli_command = rt.RuntimeTests.cli_command

    def boot(self, source=rt.SOURCE):
        self.write(source)
        self.start('hub')
        self.wait_health(lambda h: h['app'] == 'zhigao')
        self.request('/page/poll', {'pageId': 'old', 'hello': True}, origin=rt.ORIGIN)

    def dispatch(self, pool, name='zhigao_status'):
        call = pool.submit(self.request, '/agent/call', {'name': name}, True)
        self.wait_health(lambda h: h['queue'] == 1)
        _, response = self.request('/page/poll', {'pageId': 'old'}, origin=rt.ORIGIN)
        call_id = response['calls'][0]['id']
        self.request('/page/started', {'pageId': 'old', 'id': call_id}, origin=rt.ORIGIN)
        return call, call_id

    def test_stale_executing_page_cannot_be_replaced(self):
        source = rt.SOURCE.replace('< 40000', '< 120').replace('pageStale:120000', 'pageStale:120')
        self.boot(source)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            call, call_id = self.dispatch(pool)
            time.sleep(.18)
            status, response = self.request('/page/poll', {'pageId': 'new', 'hello': True}, origin=rt.ORIGIN)
            # Release our fixture even when the assertion fails.
            self.request('/page/result', {'pageId': 'old', 'id': call_id, 'result': {}}, origin=rt.ORIGIN)
            self.assertEqual(status, 409, response)
            self.assertEqual(response['code'], 'PAGE_IN_USE')

    def test_delayed_retired_page_cannot_steal_idle_session(self):
        source = rt.SOURCE.replace('< 40000', '< 120').replace('pageStale:120000', 'pageStale:120')
        self.boot(source)
        time.sleep(.18)
        self.request('/page/poll', {'pageId': 'new', 'hello': True}, origin=rt.ORIGIN)
        time.sleep(.18)
        status, response = self.request('/page/poll', {'pageId': 'old', 'hello': True}, origin=rt.ORIGIN)
        self.assertEqual(status, 409, response)
        self.assertEqual(response['code'], 'PAGE_SESSION_CHANGED')

    def test_forwarding_response_loss_never_reexecutes_write(self):
        self.write()
        calls = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.respond({'app': 'zhigao', 'version': '9.0.0'})

            def respond(self, value):
                data = json.dumps(value).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if self.path == '/agent/call':
                    calls.append(body['name'])
                    if len(calls) == 1:
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                        return
                    return self.respond({'result': {'duplicateWrite': True}})
                self.respond({'ok': True})

        server = http.server.ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        process = self.start(name='isolated-response-loss')
        process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                                      'params': {'name': 'zhigao_submit_feedback_items', 'arguments': {}}}) + '\n')
        process.stdin.flush()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            response = json.loads(pool.submit(process.stdout.readline).result(timeout=8))
        self.assertEqual(calls, ['zhigao_submit_feedback_items'])
        self.assertTrue(response['result']['isError'], response)
        self.assertIn('CALL_TRANSPORT_UNCERTAIN', json.dumps(response))

    def test_foreign_port_is_reported_by_doctor(self):
        self.write()

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"app":"unrelated"}')

        server = http.server.ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        _, report = self.cli_command('doctor', '--json')
        self.assertEqual(report['connector']['runtimeState'], 'foreign_listener')

    def test_page_declared_tool_support_checked_before_queue(self):
        self.boot()
        self.request('/page/poll', {'pageId': 'old', 'hello': True, 'version': '1.11.0',
                                   'tools': ['zhigao_status']}, origin=rt.ORIGIN)
        _, result = self.request('/agent/call', {'name': 'zhigao_read_review_assets'}, True, timeout=3)
        self.assertEqual(result['code'], 'PAGE_TOOL_UNSUPPORTED')
        self.assertEqual(self.health()['queue'], 0)

    def timed_boot(self):
        source = rt.SOURCE.replace('execution:180000', 'execution:700').replace('progressGrace:60000', 'progressGrace:350').replace('maxExecution:240000', 'maxExecution:1200').replace('total:270000', 'total:1500').replace('tick:1000', 'tick:20')
        self.boot(source)

    def progress(self, call_id, sequence):
        return self.request('/page/progress', {'pageId': 'old', 'id': call_id,
                            'progress': {'sequence': sequence, 'stage': 'asset-rendered'}}, origin=rt.ORIGIN)

    def test_real_progress_allows_slow_completion(self):
        self.timed_boot()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            call, call_id = self.dispatch(pool)
            time.sleep(.5)
            self.progress(call_id, 1)
            time.sleep(.25)
            self.progress(call_id, 2)
            self.assertFalse(call.done())
            self.request('/page/result', {'pageId': 'old', 'id': call_id, 'result': {'ok': True}}, origin=rt.ORIGIN)
            self.assertTrue(call.result()[1]['result']['ok'])

    def test_heartbeat_without_progress_does_not_extend_execution(self):
        self.timed_boot()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            call, call_id = self.dispatch(pool)
            started = time.monotonic()
            while not call.done() and time.monotonic() - started < 2:
                self.request('/page/heartbeat', {'pageId': 'old'}, origin=rt.ORIGIN)
                time.sleep(.08)
            error = call.result(timeout=1)[1]
            self.assertEqual(error['code'], 'CALL_EXECUTION_TIMEOUT')
            self.assertIsNone(error['details']['progress'])
            self.assertLess(time.monotonic() - started, 1.1)

    def test_progress_replay_does_not_extend_deadline(self):
        self.timed_boot()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            call, call_id = self.dispatch(pool)
            self.progress(call_id, 1)
            started = time.monotonic()
            while not call.done() and time.monotonic() - started < 2:
                self.progress(call_id, 1)
                time.sleep(.1)
            error = call.result(timeout=1)[1]
            self.assertEqual(error['code'], 'CALL_EXECUTION_TIMEOUT')
            self.assertEqual(error['details']['limitMs'], 700)

    def test_continuous_progress_still_has_hard_limit(self):
        self.timed_boot()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            call, call_id = self.dispatch(pool)
            sequence = 0
            started = time.monotonic()
            while not call.done() and time.monotonic() - started < 3:
                sequence += 1
                self.progress(call_id, sequence)
                time.sleep(.08)
            error = call.result(timeout=1)[1]
            self.assertEqual(error['code'], 'CALL_EXECUTION_TIMEOUT')
            self.assertEqual(error['details']['limitMs'], 1200)
            self.assertTrue(error['details']['mayStillRun'])
            self.assertLess(time.monotonic() - started, 1.6)

    def test_busy_doctor_does_not_queue_abandoned_browser_request(self):
        self.boot()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            call, call_id = self.dispatch(pool)
            _, report = self.cli_command('doctor', '--json')
            self.assertEqual(report['browser']['state'], 'busy')
            self.assertEqual(self.health()['queue'], 0)
            self.request('/page/result', {'pageId': 'old', 'id': call_id, 'result': {}}, origin=rt.ORIGIN)
            call.result()

    def test_fresh_home_chinese_spaces_without_cli_or_private_runtime(self):
        fresh = self.home / '全新 用户 directory'
        fresh.mkdir()
        self.write()
        self.script.write_text(rt.SOURCE.replace('os.homedir()', json.dumps(str(fresh))), encoding='utf-8')
        self.env['PATH'] = ''
        self.env['APPDATA'] = str(fresh / 'AppData' / 'Roaming')
        self.env['LOCALAPPDATA'] = str(fresh / 'AppData' / 'Local')
        self.env.pop('ZHIGAO_LARK_CLI', None)
        _, before = self.cli_command('doctor', '--json')
        self.assertEqual(before['connector']['state'], 'not_installed')
        self.assertEqual(before['feishu']['state'], 'missing')
        self.assertEqual(before['environment']['installation']['state'], 'available')
        self.assertFalse((fresh / '.zhigao').exists(), 'doctor must not create directories')
        code, installed = self.cli_command('setup', '--client', 'manual', '--json')
        self.assertEqual(code, 0, installed)
        self.assertEqual(Path(installed['mcp']['args'][0]), fresh / '.zhigao' / 'zhigao-connector.mjs')
        self.assertEqual(installed['mcp']['command'], rt.NODE)
        self.assertEqual(installed['runtime']['state'], 'not_running')

    def test_path_conflict_is_actionable_and_preserves_file(self):
        fresh = self.home / 'conflict'
        fresh.mkdir()
        blocker = fresh / '.zhigao'
        blocker.write_text('preserve fixture', encoding='utf-8')
        self.write(rt.SOURCE.replace('os.homedir()', json.dumps(str(fresh))))
        _, report = self.cli_command('doctor', '--json')
        self.assertEqual(report['environment']['installation']['state'], 'path_conflict')
        code, report = self.cli_command('setup', '--client', 'manual', '--json')
        self.assertEqual(code, 1)
        self.assertEqual(report['code'], 'INSTALL_PATH_CONFLICT')
        self.assertEqual(blocker.read_text(encoding='utf-8'), 'preserve fixture')

    def test_permission_and_full_disk_faults_return_specific_errors(self):
        for code, expected in [('EACCES', 'INSTALL_PERMISSION'), ('ENOSPC', 'INSTALL_STORAGE_FULL')]:
            source = rt.SOURCE.replace("const SELF =", "const originalMkdir=fs.mkdirSync;fs.mkdirSync=(p,...args)=>{if(p===HOME)throw Object.assign(Error('injected'),{code:'"+code+"'});return originalMkdir(p,...args);};\nconst SELF =")
            self.write(source)
            status, result = self.cli_command('setup', '--client', 'manual', '--json')
            self.assertEqual(status, 1)
            self.assertEqual(result['code'], expected)

    def test_old_page_without_capabilities_keeps_single_tool_path(self):
        self.boot()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            call, call_id = self.dispatch(pool, 'zhigao_read_review_asset')
            self.request('/page/result', {'id': call_id, 'result': {'legacy': True}}, origin=rt.ORIGIN)
            self.assertTrue(call.result()[1]['result']['legacy'])

    def test_lower_node_version_reports_requirement(self):
        # Simulated version branch; this does not claim execution on actual Node 16.
        self.write(rt.SOURCE.replace("Number(process.versions.node.split('.')[0])<18", '16<18'))
        code, result = self.cli_command('doctor', '--json')
        self.assertEqual(code, 1)
        self.assertEqual(result['code'], 'NODE_VERSION_UNSUPPORTED')


if __name__ == '__main__':
    unittest.main(verbosity=2)
