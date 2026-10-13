import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from corda import CordaEngine


class CordaTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.events = []
        self.game = CordaEngine(lambda kind, data: self.events.append((kind, data)), lambda: self.now)
        self.config = {"gifts": [{"side": "flavio", "gift_id": "blue", "gift_name": "Rosa"},
                                 {"side": "lula", "gift_id": "red", "gift_name": "Sorvete"}]}
        self.game.start(self.config)

    def advance(self, seconds):
        for _ in range(round(seconds * 10)):
            self.now += .1
            self.game.tick()

    def test_coin_combo_and_gradual_movement(self):
        self.assertTrue(self.game.gift("blue", "Other language", 10, 3, "u"))
        self.assertEqual(self.game.pending, -15)
        self.assertEqual(self.game.position, 0)
        self.advance(.1)
        self.assertAlmostEqual(self.game.position, -6)
        self.advance(.3)
        self.assertAlmostEqual(self.game.position, -15)

    def test_large_gift_preserves_force_and_ends_once(self):
        self.game.gift("red", "Sorvete", 1000, 1, "u")
        self.assertEqual(self.game.force["lula"], 500)
        self.advance(2)
        self.assertEqual(self.game.position, 100)
        self.assertEqual(self.game.wins["lula"], 1)
        self.assertEqual(self.game.pending, 0)
        self.assertFalse(self.game.add_force("lula", 20))
        self.assertEqual(self.game.wins["lula"], 1)

    def test_comeback(self):
        self.game.add_force("lula", 90)
        self.advance(1.6)
        self.game.add_force("flavio", 100)
        self.advance(1.8)
        self.assertAlmostEqual(self.game.position, -10)
        self.assertTrue(self.game.round_active)

    def test_opposite_pending_forces_cancel(self):
        self.game.add_force("flavio", 50)
        self.game.add_force("lula", 30)
        self.advance(.4)
        self.assertAlmostEqual(self.game.position, -20)

    def test_team_switch_and_blue_priority_match_duelo(self):
        self.assertEqual(self.game.join("u", "azul vermelho"), "flavio")
        self.assertEqual(self.game.join("u", "FLÁVIO!"), "flavio")
        self.assertEqual(self.game.join("u", "lula"), "lula")
        self.assertEqual(self.game.team_counts, {"flavio": 0, "lula": 1})
        self.assertEqual(len([e for e in self.events if e[0] == "corda_team"]), 2)
        self.assertEqual(self.game.force["flavio"], 0)

    def test_team_join_event_contains_avatar_and_participant(self):
        self.game.join("stable", "azul", "username", "Nome", "https://example.invalid/avatar.png")
        event = next(data for kind, data in self.events if kind == "corda_team")
        self.assertEqual(event["user_id"], "stable")
        self.assertEqual(event["nickname"], "Nome")
        self.assertEqual(event["avatar_url"], "https://example.invalid/avatar.png")

    def test_like_event_contains_team_avatar_and_delta(self):
        self.game.join("u", "vermelho")
        self.game.like("u", 20, "https://example.invalid/avatar.png", "user", "Nome")
        event = next(data for kind, data in self.events if kind == "corda_tap_avatar_burst")
        self.assertEqual((event["side"], event["delta"], event["nickname"]), ("lula", 20, "Nome"))
        self.assertTrue(event["avatar_url"])

    def test_switch_moves_future_likes_to_new_team(self):
        self.game.join("u", "azul")
        self.game.like("u", 100)
        self.game.join("u", "vermelho")
        self.game.like("u", 20)
        self.assertEqual(self.game.taps, {"flavio": 100, "lula": 20})

    def test_unassigned_likes_do_not_move(self):
        self.assertFalse(self.game.like("unknown", 50000))
        self.assertEqual(self.game.pending, 0)

    def test_tap_batches_and_remainder(self):
        self.game.join("u", "13")
        self.game.like("u", 1200)
        self.assertEqual(self.game.pending, 10)
        self.assertEqual(self.game.taps["lula"], 200)

    def test_unknown_gift_and_wrong_id_do_not_match_by_name(self):
        self.assertFalse(self.game.gift("wrong", "Rosa", 5, 1, "u"))
        self.assertEqual(self.game.pending, 0)

    def test_name_only_gift_accepts_accents_case(self):
        self.game.set_config({"gifts": [{"side": "flavio", "gift_name": "Coração"}]})
        self.assertTrue(self.game.gift("", "CORACAO", 10, 1, "u"))

    def test_timeout_is_authoritative_at_event_boundary(self):
        self.game.add_force("flavio", 20)
        self.advance(.4)
        self.now = 180
        self.assertFalse(self.game.add_force("lula", 1000))
        self.assertEqual(self.game.winner, "flavio")

    def test_empty_timeout_is_draw(self):
        self.now = 180
        self.game.tick()
        self.assertIsNone(self.game.winner)
        self.assertEqual(sum(self.game.wins.values()), 0)

    def test_next_round_clears_force_preserves_teams_and_wins(self):
        self.game.join("u", "azul")
        self.game.add_force("flavio", 200)
        self.advance(2)
        self.assertFalse(self.game.like("u", 500))
        self.advance(6)
        self.assertTrue(self.game.round_active)
        self.assertEqual(self.game.position, 0)
        self.assertEqual(self.game.pending, 0)
        self.assertEqual(self.game.wins["flavio"], 1)
        self.assertEqual(self.game.teams["u"], "flavio")

    def test_best_of_three_stops_at_two_wins(self):
        self.game.add_force("flavio", 100)
        self.advance(8)
        self.game.add_force("flavio", 100)
        self.advance(2)
        self.assertEqual(self.game.match_winner, "flavio")
        self.advance(10)
        self.assertFalse(self.game.round_active)
        self.assertFalse(self.game.add_force("lula", 100))

    def test_new_match_resets_teams_and_score(self):
        self.game.join("u", "azul")
        self.game.add_force("flavio", 100)
        self.advance(2)
        self.game.start(self.config)
        self.assertEqual(self.game.teams, {})
        self.assertEqual(sum(self.game.wins.values()), 0)

    def test_stop_clears_queue_and_prevents_auto_restart(self):
        self.game.add_force("lula", 100)
        self.game.stop()
        self.advance(200)
        self.assertFalse(self.game.active)
        self.assertEqual(self.game.pending, 0)

    def test_invalid_numbers_do_not_contaminate_state(self):
        self.game.set_config({"coin_force": float("nan"), "pull_speed": -1})
        self.assertEqual(self.game.config["coin_force"], .5)
        self.assertEqual(self.game.config["pull_speed"], 10)
        self.assertFalse(self.game.add_force("flavio", float("inf")))


if __name__ == "__main__":
    unittest.main()
