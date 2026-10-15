import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from service_common import bind_session_id, emit, reset_session_id


class LogEmissionTests(unittest.TestCase):
    def capture(self, callback):
        original = sys.stdout
        output = io.StringIO()
        sys.stdout = output
        try:
            callback()
            return json.loads(output.getvalue().strip())
        finally:
            sys.stdout = original

    def test_structured_event_preserves_metadata_and_session(self):
        token = bind_session_id("session-3dicas")
        try:
            message = self.capture(lambda: emit(17, "log", {
                "text": "[3 Dicas] Rodada iniciada.",
                "category": "game",
                "level": "info",
                "game": "tres",
                "event": "tres.round.started",
                "trace_id": "trace-1",
            }))
        finally:
            reset_session_id(token)

        self.assertEqual(message["source"], "python")
        self.assertEqual(message["session_id"], "session-3dicas")
        self.assertEqual(message["category"], "game")
        self.assertEqual(message["game"], "tres")
        self.assertEqual(message["event"], "tres.round.started")
        self.assertEqual(message["trace_id"], "trace-1")

    def test_legacy_string_is_tagged_with_python_source(self):
        message = self.capture(lambda: emit(17, "log", "[3 Dicas] Jogo parado."))
        self.assertEqual(message["text"], "[3 Dicas] Jogo parado.")
        self.assertEqual(message["source"], "python")


if __name__ == "__main__":
    unittest.main()
