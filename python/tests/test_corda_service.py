"""Executa os callbacks reais de service.py sem iniciar NLP/TikTok/áudio."""
import ast
import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from corda import CordaEngine

source = ast.parse((ROOT / "service.py").read_text(encoding="utf-8"))
session = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == "GameSession")
methods = {"on_comment", "on_gift", "on_like", "_stable_uid", "_emit_duelo", "_command_loop"}
isolated = ast.Module(body=[ast.ClassDef(name="SessionCallbacks", bases=[], keywords=[],
    body=[node for node in session.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
          and node.name in methods], decorator_list=[])], type_ignores=[])
scope = {"asyncio": asyncio, "emit": lambda *args, **kwargs: None}
exec(compile(ast.fix_missing_locations(isolated), str(ROOT / "service.py"), "exec"), scope)


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.s = scope["SessionCallbacks"]()
        self.s.tenant_id = 1
        self.s.corda = CordaEngine(self.s._emit_duelo)
        self.config = {"gifts": [{"side": "flavio", "gift_id": "blue", "gift_name": "Rose"}]}
        self.s.corda.start(self.config)
        self.s._check_access = lambda meta: (not (meta or {}).get("blocked"), "filter")
        self.s._throttled_log = lambda *args, **kwargs: None
        self.s._duelo_comment_team = self.s._duelo_handle_tap = lambda *args, **kwargs: None
        self.s.tres = SimpleNamespace(active=False, gift_config={})
        self.s.caca = self.s.vpet = SimpleNamespace(active=False)
        self.s.duelo = SimpleNamespace(active=False, gifts=[])
        self.s.game = SimpleNamespace(secret_word="", finished=True)
        self.s.battle = SimpleNamespace(add_taps=lambda *args: None, add_coins=lambda *args: None)
        self.s.likes = {}

    async def test_comment_and_like_share_stable_user_id(self):
        await self.s.on_comment("display", "Name", "", "AZUL", {"userId": "stable"})
        await self.s.on_like("new-display", "Name", "", 500, {"userId": "stable"})
        self.assertEqual(self.s.corda.teams, {"stable": "flavio"})
        self.assertEqual(self.s.corda.pending, -5)

    async def test_received_gift_uses_coins_times_final_combo(self):
        await self.s.on_gift("display", "Name", "", "Rose", 10, 4, {"userId": "stable"}, "blue")
        self.assertEqual(self.s.corda.pending, -20)

    async def test_filters_block_comment_like_and_gift(self):
        meta = {"userId": "blocked", "blocked": True}
        await self.s.on_comment("u", "U", "", "azul", meta)
        await self.s.on_like("u", "U", "", 500, meta)
        await self.s.on_gift("u", "U", "", "Rose", 10, 1, meta, "blue")
        self.assertEqual(self.s.corda.teams, {})
        self.assertEqual(self.s.corda.pending, 0)

    async def test_real_command_loop_start_test_stop(self):
        self.s.queue = asyncio.Queue()
        for cmd in ({"cmd": "corda_start", "config": self.config},
                    {"cmd": "corda_test", "side": "lula", "force": 25},
                    {"cmd": "corda_stop"}, {"cmd": "stop"}):
            self.s.queue.put_nowait(cmd)
        await self.s._command_loop()
        self.assertFalse(self.s.corda.active)
        self.assertEqual(self.s.corda.force["lula"], 25)
        self.assertEqual(self.s.corda.pending, 0)

    async def test_word_game_tap_meta_still_increments(self):
        self.s.corda.stop()
        self.s.game = SimpleNamespace(secret_word="teste", finished=False, is_final_boss=False)
        self.s.tap_meta_current = 20
        await self.s.on_like("u", "U", "", 30)
        self.assertEqual(self.s.tap_meta_current, 50)

    async def test_word_game_final_boss_still_freezes_tap_meta(self):
        self.s.corda.stop()
        self.s.game = SimpleNamespace(secret_word="teste", finished=False, is_final_boss=True)
        self.s.tap_meta_current = 20
        await self.s.on_like("u", "U", "", 30)
        self.assertEqual(self.s.tap_meta_current, 20)


if __name__ == "__main__":
    unittest.main()
