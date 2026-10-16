import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jogos.palavra import JogoContexto


class GameFinalPayloadTests(unittest.TestCase):
    def test_finalized_game_contains_complete_colored_guess_snapshot(self):
        game = JogoContexto.__new__(JogoContexto)
        game.secret_word = "segredo"
        game.finished = False
        game.game_id = 7
        game.size_gift = ""
        game.size_revealed = False
        game.letter_gift = ""
        game.first_letter_revealed = False
        game.hints_given = []
        game.guesses = [
            {"user": "viewer1", "word": "segredo", "rank": 1},
            {"user": "viewer2", "word": "pista", "rank": 42},
        ]
        game.save_result = lambda **_kwargs: None
        game.build_post_game_summary = lambda _limit: {"palavras": []}

        event = game.finalize_game()

        self.assertEqual(event["guesses"][0]["color"], "green")
        self.assertEqual(event["guesses"][1]["color"], "lime")
        self.assertEqual([guess["word"] for guess in event["guesses"]], ["segredo", "pista"])

        game.finished = True
        game.winner = "viewer1"
        game.build_post_game_summary = lambda _limit: {"palavras": []}
        state = game.get_state()
        self.assertEqual(len(state["guesses"]), 2)
        self.assertEqual(state["guesses"][0]["color"], "green")


if __name__ == "__main__":
    unittest.main()
