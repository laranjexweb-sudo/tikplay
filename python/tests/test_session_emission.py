import asyncio
import io
import json
import sys
import unittest

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
from service_common import (
    bind_session_id,
    clear_active_session_id,
    emit,
    reset_session_id,
    set_active_session_id,
)


class SessionEmissionTests(unittest.TestCase):
    def capture(self, callback):
        old = sys.stdout
        out = io.StringIO()
        sys.stdout = out
        try:
            callback()
            return json.loads(out.getvalue().strip())
        finally:
            sys.stdout = old

    def test_context_session_id_is_attached(self):
        token = bind_session_id("session-A")
        try:
            msg = self.capture(lambda: emit(1, "status", {"state": "connected"}))
        finally:
            reset_session_id(token)
        self.assertEqual(msg["session_id"], "session-A")

    def test_child_async_task_inherits_session_context(self):
        async def run():
            out = io.StringIO()
            old = sys.stdout
            sys.stdout = out
            token = bind_session_id("session-child")
            async def child():
                emit(2, "game", {"type": "guess"})
            try:
                task = asyncio.create_task(child())
                reset_session_id(token)
                await task
                return json.loads(out.getvalue().strip())
            finally:
                sys.stdout = old
        msg = asyncio.run(run())
        self.assertEqual(msg["session_id"], "session-child")

    def test_active_session_fallback_for_command_processor(self):
        set_active_session_id(3, "session-current")
        try:
            msg = self.capture(lambda: emit(3, "game", {"type": "likes_ranking"}))
            self.assertEqual(msg["session_id"], "session-current")
            # Limpar com uma geração antiga não pode apagar a atual.
            clear_active_session_id(3, "session-old")
            still_current = self.capture(lambda: emit(3, "status", {"state": "waiting"}))
            self.assertEqual(still_current["session_id"], "session-current")
            clear_active_session_id(3, "session-current")
            no_session = self.capture(lambda: emit(3, "log", "global"))
            self.assertNotIn("session_id", no_session)
        finally:
            clear_active_session_id(3)


if __name__ == "__main__":
    unittest.main()
