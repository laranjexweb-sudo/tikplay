import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service
from service_common import clear_active_session_id, set_active_session_id


class FakeSession:
    def __init__(self, session_id):
        self.session_id = session_id
        self.queue = asyncio.Queue()
        self.task = None
        self.stopped = False

    async def run(self):
        cmd = await self.queue.get()
        self.stopped = cmd.get("cmd") == "stop"


class SessionLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        for tenant_id in (990001, 990002):
            await service.stop_session_task(tenant_id)
            clear_active_session_id(tenant_id)

    async def test_stop_is_cooperative_and_drains_session(self):
        tenant_id = 990001
        session = FakeSession("session-A")
        session.task = asyncio.create_task(session.run())
        service.sessions[tenant_id] = session
        set_active_session_id(tenant_id, session.session_id)

        stopped = await service.stop_session_task(tenant_id, "session-A")

        self.assertTrue(stopped)
        self.assertTrue(session.stopped)
        self.assertTrue(session.task.done())
        self.assertNotIn(tenant_id, service.sessions)

    async def test_stale_stop_does_not_stop_new_generation(self):
        tenant_id = 990002
        session = FakeSession("session-new")
        session.task = asyncio.create_task(session.run())
        service.sessions[tenant_id] = session
        set_active_session_id(tenant_id, session.session_id)

        stopped = await service.stop_session_task(tenant_id, "session-old")

        self.assertFalse(stopped)
        self.assertFalse(session.task.done())
        self.assertIs(service.sessions[tenant_id], session)

        # Limpeza cooperativa para o teardown.
        session.queue.put_nowait({"cmd": "stop"})
        await session.task
        service.sessions.pop(tenant_id, None)

    async def test_disconnect_stops_tres_timer(self):
        with patch("service.db.get_tenant_settings", return_value={}), patch("service.emit"):
            session = service.GameSession(
                tenant_id=990003,
                username="streamer",
                api_key="",
                history_path=None,
                gift_tags=[],
            )
            session.handler._connected = True
            session.tres.start("palavra", ["dica 1", "dica 2", "dica 3"])
            timer_task = session.tres.task

            session.emit_status("disconnected")
            await asyncio.sleep(0)

        self.assertFalse(session.tres.active)
        self.assertIsNone(session.tres.task)
        self.assertTrue(timer_task.cancelled())


if __name__ == "__main__":
    unittest.main()
