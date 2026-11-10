"""Real HTTP downloads into connector-only isolated directories; no production install."""
import concurrent.futures
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'zhigao-connector.mjs').read_text(encoding='utf-8')
NAMES = ['media-runtime.mjs', 'media-worker.py']


class AddonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='zhigao-media-addons-')
        self.root = Path(self.temp.name)
        self.connector = self.root / 'zhigao-connector.mjs'
        self.payloads = {name: (ROOT / name).read_bytes() for name in NAMES}
        self.requests = []
        self.status = 200
        case = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                case.requests.append(self.path)
                body = json.dumps(case.manifest).encode() if self.path == '/setup-manifest.json' else case.payloads[self.path[1:]]
                self.send_response(case.status)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.publish()

    def publish(self, version='1.9.0'):
        files = {name: {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)} for name, data in self.payloads.items()}
        self.manifest = {'name': 'zhigao', 'version': version, 'media': {'version': version, 'protocol': 1, 'files': files}}
        text = SOURCE.replace("const SITE = 'https://17796919413.github.io/zhigao-desk/';", f"const SITE = 'http://127.0.0.1:{self.server.server_port}/';")
        text = re.sub(r"const VERSION = '[^']+';", f"const VERSION = '{version}';", text, count=1)
        text = re.sub(r'^const MEDIA_FILES = .*;$', 'const MEDIA_FILES = '+json.dumps(files)+';', text, count=1, flags=re.M)
        self.connector.write_text(text, encoding='utf-8', newline='\n')

    def ensure(self, success=True):
        script = "import {pathToFileURL} from 'node:url';const m=await import(pathToFileURL(process.argv[1]).href+'?test=1');await m.ensureMediaAddons();console.log('ready');"
        result = subprocess.run(['node', '--input-type=module', '-e', script, str(self.connector)], env={**os.environ, 'ZHIGAO_MEDIA_HOME': str(self.root / 'private-runtime'), 'ZHIGAO_AUTO_UPDATE': '0'}, capture_output=True, text=True, encoding='utf-8', timeout=30)
        self.assertEqual(result.returncode == 0, success, result.stderr)
        if success: self.assertEqual(result.stdout.strip(), "ready")
        return result

    def installed(self):
        return list((self.root / 'media-addons').glob('*/media-runtime.mjs'))

    def test_connector_only_downloads_real_helpers_and_reuses_offline(self):
        self.assertEqual([p.name for p in self.root.iterdir()], ['zhigao-connector.mjs'])
        self.ensure()
        self.assertEqual(len(self.installed()), 1)
        for name in NAMES:
            self.assertEqual((self.installed()[0].parent / name).read_bytes(), self.payloads[name])
        count = len(self.requests)
        self.status = 503
        self.ensure()
        self.assertEqual(len(self.requests), count)

    def test_wrong_hash_never_activates_partial_download(self):
        self.payloads['media-worker.py'] += b'\n# corrupted transport\n'
        self.ensure(False)
        self.assertFalse(self.installed())

    def test_wrong_version_or_contract_is_rejected(self):
        for change in ['version', 'digest', 'protocol']:
            with self.subTest(change=change):
                self.publish()
                if change == 'version':
                    self.manifest['version'] = '1.9.1'
                elif change == 'digest':
                    self.manifest['media']['files']['media-worker.py']['sha256'] = '0' * 64
                else:
                    self.manifest['media']['protocol'] = 2
                self.ensure(False)
                self.assertFalse(self.installed())
        self.assertNotIn('/media-worker.py', self.requests)

    def test_existing_old_helpers_are_preserved_and_not_loaded(self):
        for name in NAMES:
            (self.root / name).write_text('old helper must not run', encoding='utf-8')
        self.ensure()
        for name in NAMES:
            self.assertEqual((self.root / name).read_text(), 'old helper must not run')
        self.assertEqual(len(self.installed()), 1)

    def test_update_uses_new_immutable_directory(self):
        self.ensure()
        old = self.installed()[0]
        before = old.read_bytes()
        self.payloads['media-runtime.mjs'] += b'\n// next release fixture\n'
        self.publish('1.9.1')
        self.ensure()
        self.assertEqual(len(self.installed()), 2)
        self.assertEqual(old.read_bytes(), before)

    def test_concurrent_installers_converge(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda _: self.ensure(), range(3)))
        self.assertEqual(len(self.installed()), 1)
        self.assertFalse(list((self.root / 'media-addons').glob('.prepare-*')))

    def test_corrupt_cached_helper_is_not_reused(self):
        self.ensure()
        cached = self.installed()[0]
        cached.write_text('throw Error("must not import");', encoding='utf-8')
        self.ensure()
        directories = list((self.root / 'media-addons').iterdir())
        current = [p for p in directories if '.invalid-' not in p.name][0]
        self.assertEqual((current / 'media-runtime.mjs').read_bytes(), self.payloads['media-runtime.mjs'])
        self.assertTrue(any('.invalid-' in p.name for p in directories))

    def test_hash_valid_but_invalid_js_is_rejected(self):
        self.payloads['media-runtime.mjs'] += b'\ninvalid syntax }\n'
        self.publish()
        self.ensure(False)
        self.assertFalse(self.installed())

    def test_release_generator_binds_lf_bytes_and_is_idempotent(self):
        project = self.root / 'generator'
        (project / 'tools').mkdir(parents=True)
        for name in NAMES + ['zhigao-connector.mjs', 'connector-updates.js', 'setup-manifest.json']:
            shutil.copyfile(ROOT / name, project / name)
        shutil.copyfile(ROOT / 'tools' / 'prepare-update-manifest.mjs', project / 'tools' / 'prepare-update-manifest.mjs')
        for _ in range(2):
            result = subprocess.run(['node', str(project / 'tools' / 'prepare-update-manifest.mjs')], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            current = (project / 'setup-manifest.json').read_bytes()
            if _:
                self.assertEqual(current, previous)
            previous = current
        manifest = json.loads(current)
        for name in NAMES:
            data = (project / name).read_bytes()
            self.assertNotIn(b'\r\n', data)
            self.assertEqual(hashlib.sha256(data).hexdigest(), manifest['media']['files'][name]['sha256'])
        self.assertEqual(hashlib.sha256((project / 'zhigao-connector.mjs').read_bytes()).hexdigest(), manifest['autoUpdate']['sha256'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
