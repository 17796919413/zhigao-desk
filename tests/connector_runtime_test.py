"""Isolated process/HTTP regression tests; no real credentials, browser data or Feishu writes."""
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'zhigao-connector.mjs').read_text(encoding='utf-8')
NODE = shutil.which('node')
ORIGIN = 'https://17796919413.github.io'


def legacy_source():
    revision = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--fixed-strings', '--grep=Release 知稿 1.7.0:'], cwd=ROOT, text=True, encoding='utf-8').strip()
    assert revision, 'The 1.7.0 release must be present in repository history'
    return subprocess.check_output(['git', 'show', revision+':zhigao-connector.mjs'], cwd=ROOT, text=True, encoding='utf-8')


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='zhigao-runtime-')
        self.home = Path(self.temp.name)
        self.script = self.home / '.zhigao' / 'zhigao-connector.mjs'
        self.script.parent.mkdir()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.cli = self.home / 'fake-cli.mjs'
        self.cli.write_text("setTimeout(()=>console.log(JSON.stringify({identity:'user',verified:true,identities:{user:{status:'ready',tokenStatus:'valid'}}})),Number(process.env.FAKE_DELAY||0));", encoding='utf-8')
        self.env = {**os.environ, 'ZHIGAO_PORT': str(self.port), 'ZHIGAO_LARK_CLI': str(self.cli), 'ZHIGAO_AUTO_UPDATE': '0', 'ZHIGAO_REGISTER_URI': '0'}
        self.processes = []
        self.extra_pids = set()

    def tearDown(self):
        # Track and stop only subprocesses started by this test on its random private port.
        for process in self.processes:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=8)
            for pipe in (process.stdin, process.stdout, process.stderr):
                if pipe:
                    pipe.close()
        for pid in self.extra_pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except OSError:
                pass
        for _ in range(20):
            try:
                self.temp.cleanup()
                break
            except PermissionError:
                time.sleep(.1)

    def write(self, source=SOURCE, version=None):
        if version:
            source = source.replace("const VERSION = '1.8.2'", f"const VERSION = '{version}'")
        self.script.write_text(source.replace('os.homedir()', json.dumps(str(self.home))), encoding='utf-8')

    def start(self, *args, name=None):
        p = subprocess.Popen([NODE, str(self.script), *args], env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        self.processes.append(p)
        if name:
            p.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': name}, 'protocolVersion': '2025-06-18'}}) + '\n')
            p.stdin.flush()
        return p

    def request(self, route, data=None, auth=False, origin=None, secret=None, timeout=15):
        headers = {}
        if auth:
            headers['x-zhigao-secret'] = secret or (self.script.parent / 'hub-secret').read_text().strip()
        if origin:
            headers['Origin'] = origin
        payload = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(f'http://127.0.0.1:{self.port}{route}', data=payload, headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def health(self):
        try:
            return self.request('/health', timeout=1)[1]
        except (OSError, ValueError):
            return None

    def wait_health(self, predicate, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            h = self.health()
            if h and predicate(h):
                return h
            time.sleep(.08)
        self.fail(f'Health condition timed out: {self.health()}')

    def cli_command(self, *args):
        p = subprocess.run([NODE, str(self.script), *args], env=self.env, capture_output=True, text=True, encoding='utf-8', timeout=35)
        result = json.loads(p.stdout)
        h = self.health()
        if h and h.get('pid') and h['pid'] not in {p.pid for p in self.processes}:
            self.extra_pids.add(h['pid'])
        return p.returncode, result

    def old_hub(self):
        self.write(version='1.8.0')
        p = self.start('hub')
        self.wait_health(lambda h: h['version'] == '1.8.0')
        self.write()
        return p

    def test_idle_upgrade_and_feishu_status(self):
        old = self.old_hub()
        self.start(name='new-client')
        h = self.wait_health(lambda h: h['version'] == '1.8.2')
        self.assertIn('new-client', h['clients'])
        old.wait(timeout=6)
        status, body = self.request('/page/feishu', {'action': 'status'}, origin=ORIGIN)
        self.assertEqual(status, 200)
        self.assertEqual(body['data']['state'], 'ready')
        _, report = self.cli_command('doctor', '--verify-feishu', '--json')
        self.assertEqual(report['connector']['runtimeState'], 'current')
        self.assertEqual(report['feishu']['state'], 'ready')

    def test_pending_review_is_preserved_and_upgrade_retries(self):
        self.old_hub()
        self.request('/page/poll', {'pageId': 'fixture', 'hello': True}, origin=ORIGIN)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            call = pool.submit(self.request, '/agent/call', {'name': 'zhigao_status', 'args': {}, 'client': 'existing-client'}, True)
            self.wait_health(lambda h: h['busy'])
            self.start(name='new-client')
            time.sleep(.7)
            self.assertEqual(self.health()['version'], '1.8.0')
            self.assertFalse(call.done())
            _, poll = self.request('/page/poll', {'pageId': 'fixture'}, origin=ORIGIN)
            self.assertEqual(len(poll['calls']), 1)
            self.request('/page/result', {'id': poll['calls'][0]['id'], 'result': {'preserved': True}}, origin=ORIGIN)
            self.assertEqual(call.result()[1], {'result': {'preserved': True}})
        self.wait_health(lambda h: h['version'] == '1.8.2', timeout=9)

    def test_feishu_inflight_blocks_repair(self):
        self.env['FAKE_DELAY'] = '1800'
        self.old_hub()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            call = pool.submit(self.request, '/page/feishu', {'action': 'status'}, False, ORIGIN)
            self.wait_health(lambda h: h['busy'])
            code, report = self.cli_command('repair', '--json')
            self.assertEqual(code, 1)
            self.assertEqual(report['state'], 'waiting_for_idle')
            self.assertEqual(self.health()['version'], '1.8.0')
            self.assertEqual(call.result()[1]['data']['state'], 'ready')
        code, report = self.cli_command('repair', '--json')
        self.assertEqual(code, 0)
        self.assertEqual(report['state'], 'restarted')

    def test_handoff_auth_downgrade_and_uninstalled_version_rejected(self):
        self.old_hub()
        status, _ = self.request('/agent/handoff', {'version': '1.8.2'}, True, secret='wrong-secret')
        self.assertEqual(status, 403)
        status, _ = self.request('/agent/handoff', {'version': '1.8.2'}, True, ORIGIN)
        self.assertEqual(status, 403)
        for version in ('1.7.0', '1.8.0', '9.0.0', 'invalid'):
            status, _ = self.request('/agent/handoff', {'version': version}, True)
            self.assertEqual(status, 409)
        self.assertEqual(self.health()['version'], '1.8.0')

    def test_simultaneous_new_clients_elect_one_hub(self):
        self.old_hub()
        self.start(name='client-a')
        self.start(name='client-b')
        h = self.wait_health(lambda h: h['version'] == '1.8.2' and {'client-a', 'client-b'} <= set(h['clients']))
        self.assertIn(h['pid'], {p.pid for p in self.processes})

    def test_workbuddy_probe_lists_tools_without_claiming_hub(self):
        self.write()
        p = self.start(name='workbuddy-mcp-probe:custom-mcp:zhigao')
        self.assertEqual(json.loads(p.stdout.readline())['id'], 1)
        p.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}) + '\n')
        p.stdin.flush()
        reply = json.loads(p.stdout.readline())
        self.assertIn('zhigao_setup_status', {t['name'] for t in reply['result']['tools']})
        time.sleep(.2)
        self.assertIsNone(self.health())
        p.stdin.close()
        p.wait(timeout=4)

    @unittest.skipUnless(os.name == 'nt', 'Windows legacy process identity check')
    def test_real_legacy_170_requires_explicit_scoped_restart(self):
        legacy = legacy_source()
        self.write(legacy)
        old = self.start('hub')
        self.wait_health(lambda h: h['version'] == '1.7.0')
        self.assertEqual(self.request('/page/feishu', {'action': 'status'}, origin=ORIGIN)[0], 400)
        self.write()
        _, report = self.cli_command('doctor', '--json')
        self.assertEqual(report['connector']['runtimeState'], 'legacy_restart_required')
        for args in [('repair', '--json'), ('repair', '--restart-legacy', '--json')]:
            code, report = self.cli_command(*args)
            self.assertEqual(code, 1)
            self.assertTrue(report['canRestart'])
            self.assertEqual(report['pid'], old.pid)
            self.assertIsNone(old.poll())
        code, report = self.cli_command('repair', '--restart-legacy', '--confirm-idle', '--json')
        self.assertEqual(code, 0, report)
        self.assertEqual(report['runningVersion'], '1.8.2')
        old.wait(timeout=5)
        self.assertEqual(self.request('/page/feishu', {'action': 'status'}, origin=ORIGIN)[0], 200)

    def test_newer_runtime_is_never_downgraded(self):
        self.write(version='1.9.0')
        self.start('hub')
        self.wait_health(lambda h: h['version'] == '1.9.0')
        self.write()
        self.start(name='older-client')
        code, report = self.cli_command('repair', '--json')
        self.assertEqual(code, 0)
        self.assertEqual(report['state'], 'current')
        self.assertEqual(self.health()['version'], '1.9.0')

    def test_setup_handoffs_without_rewriting_existing_client_config(self):
        self.old_hub()
        config = self.home / '.workbuddy' / 'mcp.json'
        config.parent.mkdir()
        config.write_text(json.dumps({'mcpServers': {'zhigao': {'type': 'stdio', 'command': NODE, 'args': [str(self.script)]}, 'other': {'command': 'preserve-me'}}}), encoding='utf-8')
        before = config.read_bytes()
        code, result = self.cli_command('setup', '--client', 'workbuddy', '--json')
        self.assertEqual(code, 0, result)
        self.assertEqual(result['runtime']['state'], 'restarted')
        self.assertEqual(config.read_bytes(), before)
        self.assertEqual(self.health()['version'], '1.8.2')

    @unittest.skipUnless(os.name == 'nt', 'Windows legacy process identity check')
    def test_legacy_mcp_owner_is_never_force_stopped(self):
        legacy = legacy_source()
        self.write(legacy)
        old = self.start(name='legacy-client-with-active-session')
        self.wait_health(lambda h: h['version'] == '1.7.0')
        self.write()
        code, result = self.cli_command('repair', '--restart-legacy', '--confirm-idle', '--json')
        self.assertEqual(code, 1)
        self.assertFalse(result['canRestart'])
        self.assertIsNone(old.poll())
        self.assertEqual(self.health()['version'], '1.7.0')


if __name__ == '__main__':
    unittest.main(verbosity=2)
