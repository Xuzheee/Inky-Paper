import importlib.util
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("inky_coach_test_api", Path(__file__).parents[1] / "dashboard" / "plugin_api.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.file = Path(self.temp.name) / "paper-agent-bridge.json"
        self.calls = []
        case = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                case.calls.append((self.path, dict(self.headers), body))
                status, result = case.response
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                if status == 307:
                    self.send_header("Location", f"http://127.0.0.1:{case.server.server_port}/redirected")
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.response = (200, {"data": {"batch": {"id": "example"}}})
        self.connection = {"app": "inky-paper", "protocolVersion": 1, "url": f"http://127.0.0.1:{self.server.server_port}", "token": "fixture-secret-never-returned"}
        self.file.write_text(json.dumps(self.connection), encoding="utf-8")
        self.user_file = self.file.with_name("paper-user-bridge.json")
        self.user_file.write_text(json.dumps({**self.connection, "capability":"user-adoption", "token":"fixture-user-click-token"}), encoding="utf-8")
        self.env = patch.dict(os.environ, {"INKY_PAPER_CONNECTION_FILE": str(self.file)})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def test_real_local_http_keeps_token_backend_only(self):
        result = api.get_batch("10000000-0000-4000-8000-000000000001")
        self.assertTrue(result["ok"])
        self.assertEqual(self.calls[0][0], "/get_plan_batch")
        self.assertEqual(self.calls[0][1]["Authorization"], "Bearer fixture-secret-never-returned")
        self.assertNotIn("Origin", self.calls[0][1])
        self.assertNotIn("fixture-secret", json.dumps(result))

    def test_adopt_preserves_request_and_order(self):
        payload = {"requestId": "same-request", "batchId": "batch", "expectedRevision": 1, "date": "2026-09-13", "cardIds": ["second", "first"], "cardOverrides": [{"cardId": "second", "text": "新动作"}]}
        api.adopt(payload)
        api.adopt(payload)
        self.assertEqual(self.calls[0][2], payload)
        self.assertEqual(self.calls[1][2], payload)
        self.assertEqual(self.calls[0][1]["Authorization"], "Bearer fixture-user-click-token")

    def test_adoption_does_not_fall_back_to_model_token(self):
        self.user_file.unlink()
        self.assertFalse(api.adopt({"requestId":"request"})["ok"])
        self.assertEqual(self.calls, [])

    def test_valid_large_chinese_card_batch_fits_bridge_limit(self):
        payload = {"requestId": "large-fixture", "batchId": "batch", "expectedRevision": 1, "date": "2026-09-13", "cardIds": [str(i) for i in range(30)], "cardOverrides": [{"cardId": str(i), "text": "动作" * 150, "expectedResult": "预期" * 1000} for i in range(30)]}
        self.assertTrue(api.adopt(payload)["ok"])
        self.assertEqual(self.calls[0][2], payload)
        before = len(self.calls)
        self.assertTrue(api.adopt({"cardOverrides": [{"expectedResult": "字" * 180000}]})["definitive"])
        self.assertEqual(len(self.calls), before)

    def test_known_conflict_is_definitive(self):
        self.response = (400, {"error": "CONFLICT: 步骤已经改变"})
        result = api.paper_request("adopt_plan_cards", {})
        self.assertFalse(result["ok"])
        self.assertTrue(result["definitive"])

    def test_redirect_is_not_followed_or_treated_as_saved(self):
        self.response = (307, {})
        result = api.paper_request("adopt_plan_cards", {})
        self.assertFalse(result["ok"])
        self.assertFalse(result["definitive"])
        self.assertEqual(len(self.calls), 1)

    def test_foreign_connection_and_arbitrary_actions_are_rejected(self):
        self.connection["url"] = "https://example.com/"
        self.file.write_text(json.dumps(self.connection), encoding="utf-8")
        self.assertFalse(api.paper_request("get_plan_batch", {})["ok"])
        self.assertFalse(api.paper_request("start_session", {})["ok"])
        self.assertEqual(self.calls, [])

    def test_invalid_identifier_and_extra_adopt_fields_are_rejected(self):
        self.assertTrue(api.get_batch("../other")["definitive"])
        self.assertTrue(api.adopt({"action": "start_session"})["definitive"])
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
