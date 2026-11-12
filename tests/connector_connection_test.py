"""Interrupted local HTTP streams must not wedge client registration or replay tools."""
import http.server
import json
import queue
import socket
import threading
import time
import unittest
import connector_runtime_test as rt


class ConnectionTests(unittest.TestCase):
    setUp = rt.RuntimeTests.setUp
    tearDown = rt.RuntimeTests.tearDown
    write = rt.RuntimeTests.write
    start = rt.RuntimeTests.start

    def endpoint(self, broken_route, trickle=False):
        self.requests = []
        self.cut = threading.Event()
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def response(self, data):
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                self.response({'app': 'zhigao', 'version': '99.0.0'})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.requests.append((self.path, body))
                if self.path == broken_route and not owner.cut.is_set():
                    owner.cut.set()
                    self.close_connection = True
                    self.send_response(200)
                    self.send_header('Content-Length', '200')
                    self.end_headers()
                    self.wfile.write(b'{')
                    self.wfile.flush()
                    if trickle:
                        try:
                            for _ in range(80):
                                self.wfile.write(b' ')
                                self.wfile.flush()
                                time.sleep(.1)
                        except OSError:
                            return
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                else:
                    self.response({'ok': True, 'result': {}})

        server = http.server.ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def test_interrupted_hello_recovers_without_restarting_client(self):
        self.write()
        self.endpoint('/agent/hello')
        process = self.start(name='idle-connection-fixture')
        self.assertTrue(self.cut.wait(3))
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and len(self.requests) < 2:
            time.sleep(.1)
        self.assertIsNone(process.poll())
        self.assertGreaterEqual(sum(p == '/agent/hello' for p, _ in self.requests), 2,
                                'Registration stayed pending after a truncated response')

    def test_interrupted_tool_body_returns_uncertainty_without_replay(self):
        self.write()
        self.endpoint('/agent/call')
        process = self.start(name='tool-connection-fixture')
        replies = queue.Queue()
        def read():
            for line in process.stdout:
                replies.put(json.loads(line))
        threading.Thread(target=read, daemon=True).start()
        process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                                       'params': {'name': 'zhigao_submit_feedback_items', 'arguments': {}}}) + '\n')
        process.stdin.flush()
        response = replies.get(timeout=5)
        self.assertTrue(response['result']['isError'])
        self.assertIn('CALL_TRANSPORT_UNCERTAIN', json.dumps(response))
        self.assertEqual(sum(p == '/agent/call' for p, _ in self.requests), 1)

    def test_trickling_hello_has_total_deadline(self):
        self.write()
        self.endpoint('/agent/hello', trickle=True)
        process = self.start(name='slow-registration-fixture')
        self.assertTrue(self.cut.wait(3))
        deadline = time.monotonic() + 7
        while time.monotonic() < deadline and len(self.requests) < 2:
            time.sleep(.1)
        self.assertIsNone(process.poll())
        self.assertGreaterEqual(sum(p == '/agent/hello' for p, _ in self.requests), 2,
                                'Continuously arriving bytes must not prevent recovery')


if __name__ == '__main__':
    unittest.main(verbosity=2)
