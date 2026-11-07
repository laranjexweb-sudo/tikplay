import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service


class RecoveryGame:
    def __init__(self):
        self.guesses = []
        self.hints_given = []
        self.hint_gifts = []
        self.riddle_gifts = []
        self.secret_word = ""
        self.game_id = None
        self.finished = False

    def _build_hint_pool(self):
        self.all_scored = ["teste"]
        self.hint_pool = ["teste"]

    def get_active_gift(self):
        return "Rosa"


class GameRecoveryTests(unittest.IsolatedAsyncioTestCase):
    def make_session(self, checkpoint):
        session = object.__new__(service.GameSession)
        session.tenant_id = 990010
        session.game = RecoveryGame()
        session._pending_game_recovery = checkpoint
        session._log_event = lambda *args, **kwargs: None
        session.build_likes_ranking = lambda limit: []
        session._last_game_recovery_signature = None
        session.current_room_id = "room-a"
        session.tap_meta_current = 0
        session.tap_meta_total = 1000
        session.tap_meta_ready = False
        session._tap_meta_x2 = False
        return session

    async def test_restores_active_round_only_for_same_room(self):
        checkpoint = {
            "version": 1, "game_id": 42, "room_id": "room-a", "secret_word": "coração",
            "guesses": [{"user": "viewer", "word": "amor", "rank": 7}],
            "hints": ["afeto"], "hint_gifts": ["Rose"], "riddle_gifts": [],
            "size_gift": "", "size_revealed": False, "letter_gift": "",
            "first_letter_revealed": False, "tap_meta_current": 260,
            "tap_meta_total": 1000, "tap_meta_ready": False,
        }
        session = self.make_session(checkpoint)
        events = []
        with patch.object(service, "emit", side_effect=lambda *args: events.append(args)):
            await session._restore_pending_game_recovery("room-a")

        self.assertEqual(session.game.secret_word, "coração")
        self.assertEqual(session.game.game_id, 42)
        self.assertEqual(session.game.guesses[0]["word"], "amor")
        self.assertEqual(session.game.hints_given, ["afeto"])
        self.assertEqual(session.tap_meta_current, 260)
        replayed = [event[2].get("type") for event in events if event[1] == "game"]
        self.assertIn("game_start", replayed)
        self.assertIn("guess", replayed)
        self.assertIn("gift_hint", replayed)
        self.assertIn("game_recovery_checkpoint", replayed)

    async def test_discards_snapshot_when_room_changed(self):
        session = self.make_session({"version": 1, "room_id": "old-room", "game_id": 1,
                                     "secret_word": "segredo"})
        events = []
        with patch.object(service, "emit", side_effect=lambda *args: events.append(args)):
            await session._restore_pending_game_recovery("new-room")

        self.assertEqual(session.game.secret_word, "")
        self.assertIsNone(session._pending_game_recovery)
        self.assertTrue(any(event[1] == "game" and event[2].get("type") == "game_recovery_cleared"
                            for event in events))


if __name__ == "__main__":
    unittest.main()
