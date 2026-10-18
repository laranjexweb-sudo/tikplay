"""Verifica que os callbacks reais da live emitem apenas os eventos de ação esperados."""
import ast
import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
source = ast.parse((ROOT / "service.py").read_text(encoding="utf-8"))
session = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == "GameSession")
methods = {"on_follow", "on_share", "on_member"}
isolated = ast.Module(body=[ast.ClassDef(name="ActionCallbacks", bases=[], keywords=[],
    body=[node for node in session.body if isinstance(node, ast.AsyncFunctionDef) and node.name in methods],
    decorator_list=[])], type_ignores=[])
events = []
scope = {"emit": lambda tenant_id, type_, payload: events.append((tenant_id, type_, payload))}
exec(compile(ast.fix_missing_locations(isolated), str(ROOT / "service.py"), "exec"), scope)


class ActionAlertEventTests(unittest.IsolatedAsyncioTestCase):
    async def test_follow_share_and_gifter_join_emit_scoped_actions(self):
        events.clear()
        s = scope["ActionCallbacks"]()
        s.tenant_id = 23
        s._ensure_room = lambda *_args: None
        s._track_levels = lambda *_args, **_kwargs: None
        s._emit_interaction = lambda *_args, **_kwargs: None
        s._stable_uid = lambda user, *_args: user
        s._check_access = lambda _meta: (True, "")
        s.corda = SimpleNamespace(share=lambda *_args: None)
        s.vpet = SimpleNamespace(active=False, state={})

        await s.on_follow("viewer1", "Viewer One", "", {}, "room-1", "follow-1")
        await s.on_share("viewer2", "Viewer Two", "", {}, "room-1", "share-1")
        await s.on_member("viewer3", "Viewer Three", {"gifter_level": "34"}, "room-1", "join-1")

        action_events = [payload for tenant_id, kind, payload in events
                         if tenant_id == 23 and kind == "game" and payload.get("type") == "action_alert_event"]
        self.assertEqual([event["action"] for event in action_events], ["follow", "share", "gifter_join"])
        self.assertEqual(action_events[-1]["gifter_level"], 34)


if __name__ == "__main__":
    unittest.main()
