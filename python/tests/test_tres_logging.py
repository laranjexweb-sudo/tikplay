import asyncio
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jogos.tres import TresPontinhos


class TresLoggingTests(unittest.TestCase):
    def setUp(self):
        self.emitted = []
        self.engine = TresPontinhos(tenant_id=901, emit_cb=lambda type_, payload: self.emitted.append((type_, payload)))
        # Prevent the engine from scheduling its timer loop in these direct state-transition tests.
        self.engine.task = True

    def logs(self):
        return [payload for type_, payload in self.emitted if type_ == "log"]

    def test_start_and_clue_logs_are_structured_without_clue_text(self):
        secret = "girassol reservado"
        clue = "pista reservada de teste"
        self.engine.start(secret, [clue, "segunda pista", "terceira pista"], trace_id="trace-tres-start")

        start_log = self.logs()[-1]
        self.assertEqual(start_log["category"], "game")
        self.assertEqual(start_log["game"], "tres")
        self.assertEqual(start_log["event"], "tres.round.started")
        self.assertEqual(start_log["trace_id"], "trace-tres-start")
        self.assertNotIn(secret, start_log["text"])
        self.assertNotIn(clue, start_log["text"])

        self.engine.countdown_remaining = 1
        self.engine._tick_timer()
        clue_log = self.logs()[-1]
        self.assertEqual(clue_log["event"], "tres.clue.revealed")
        self.assertEqual(clue_log["details"]["stage"], 1)
        self.assertNotIn(clue, clue_log["text"])

    def test_winner_log_reports_outcome_without_answer(self):
        secret = "respostanãoregistrada"
        self.engine.active = True
        self.engine.phase = "play"
        self.engine.stage = 2
        self.engine.start(secret, ["uma pista", "outra pista", "última pista"], trace_id="trace-tres-win")
        self.engine.phase = "play"
        self.engine.stage = 2
        self.engine.guess("viewer", "Viewer", "", secret)

        winner_log = [row for row in self.logs() if row.get("event") == "tres.round.won"][-1]
        self.assertEqual(winner_log["category"], "game")
        self.assertEqual(winner_log["details"]["stage"], 2)
        self.assertEqual(winner_log["trace_id"], "trace-tres-win")
        self.assertNotIn(secret, winner_log["text"])

    def test_timeout_log_does_not_disclose_answer(self):
        secret = "resposta escondida"
        self.engine.palavra = secret
        self.engine.active = True
        self.engine.finished = False
        self.engine.phase = "play"
        self.engine.stage = 3
        self.engine.stage_remaining = 1
        self.engine._tick_timer()

        timeout_log = [row for row in self.logs() if row.get("event") == "tres.round.timed_out"][-1]
        self.assertEqual(timeout_log["category"], "game")
        self.assertEqual(timeout_log["details"]["stage"], 3)
        self.assertNotIn(secret, timeout_log["text"])

    def test_gift_reveal_logs_do_not_include_the_letter(self):
        secret = "respostareservada"
        self.engine.active = True
        self.engine.round_id = 9
        self.engine.palavra = secret
        self.engine.gift_config = {"size": "Rose", "letter": "Finger Heart", "ticket": ""}
        with patch("jogos.tres.get_catalog", return_value=None):
            self.engine.process_gift("viewer", "Viewer", "", "Rose")
            self.engine.process_gift("viewer", "Viewer", "", "Finger Heart")

        events = [row for row in self.logs() if row.get("event") in (
            "tres.gift.revealed_size", "tres.gift.revealed_first_letter")]
        self.assertEqual([row["event"] for row in events], ["tres.gift.revealed_size", "tres.gift.revealed_first_letter"])
        self.assertTrue(all(row["category"] == "game" for row in events))
        self.assertTrue(all(secret not in row["text"] for row in events))
        self.assertTrue(all("first_letter" not in (row.get("details") or {}) for row in events))

    def test_auto_round_failure_is_logged_without_exception_text(self):
        async def broken_provider(_trace_id):
            raise RuntimeError("private generated response")

        self.engine.active = True
        self.engine._palavra_provider = broken_provider
        asyncio.run(self.engine._autostart())
        failure = [row for row in self.logs() if row.get("event") == "tres.round.auto_start_failed"][-1]
        self.assertEqual(failure["category"], "error")
        self.assertEqual(failure["code"], "TRES_AUTO_START_FAILED")
        self.assertNotIn("private generated response", repr(failure))

    def test_auto_round_does_not_call_provider_when_live_is_disconnected(self):
        calls = []

        async def provider(_trace_id):
            calls.append(True)
            return "palavra", ["dica 1", "dica 2", "dica 3"]

        self.engine.active = True
        self.engine._palavra_provider = provider
        self.engine._can_autostart = lambda: False
        asyncio.run(self.engine._autostart())

        self.assertEqual(calls, [])
        rejected = [row for row in self.logs() if row.get("event") == "tres.round.auto_start_rejected"][-1]
        self.assertEqual(rejected["code"], "TRES_SESSION_INACTIVE")

    def test_auto_round_is_not_started_if_live_disconnects_during_preparation(self):
        connected = True

        async def provider(_trace_id):
            nonlocal connected
            connected = False
            return "palavra", ["dica 1", "dica 2", "dica 3"]

        self.engine.active = True
        self.engine._palavra_provider = provider
        self.engine._can_autostart = lambda: connected
        asyncio.run(self.engine._autostart())

        self.assertEqual(self.engine.round_id, 0)
        rejected = [row for row in self.logs() if row.get("event") == "tres.round.auto_start_rejected"][-1]
        self.assertEqual(rejected["code"], "TRES_SESSION_INACTIVE")


if __name__ == "__main__":
    unittest.main()
