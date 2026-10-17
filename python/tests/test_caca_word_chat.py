"""Regressões do formato simples de palpite do Caça Palavras."""
import ast
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from jogos.caca import CacaPalavras
from service_common import strip_accents

source = ast.parse((ROOT / "service.py").read_text(encoding="utf-8"))
session = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == "GameSession")
method_names = {"_match_caca_word", "_match_caca_command", "_match_caca_input"}
methods = [node for node in session.body if isinstance(node, ast.FunctionDef) and node.name in method_names]
isolated = ast.Module(body=[ast.ClassDef(name="CacaMatcher", bases=[], keywords=[], body=methods, decorator_list=[])], type_ignores=[])
scope = {"re": re, "strip_accents": strip_accents}
exec(compile(ast.fix_missing_locations(isolated), str(ROOT / "service.py"), "exec"), scope)


def make_game():
    game = CacaPalavras()
    game.active = True
    game.words = [{
        "id": 1, "text": "CORAÇÃO", "found": False, "finder": "",
        "finder_nickname": "", "finder_avatar": "",
    }]
    return game


class CacaWordChatTests(unittest.TestCase):
    def setUp(self):
        self.game = make_game()
        self.matcher = scope["CacaMatcher"]()
        self.matcher.caca = self.game
        self.matcher.caca_prefix = "cp"
        self.matcher.caca_answer_mode = "both"

    def test_matches_exact_word_without_accent_and_with_surrounding_symbols(self):
        self.assertEqual(self.matcher._match_caca_word("✨ coracao! ❤️"), "CORAÇÃO")

    def test_prefix_is_optional_but_supported(self):
        self.assertEqual(self.matcher._match_caca_word("cp coração"), "CORAÇÃO")
        self.assertEqual(self.matcher._match_caca_word("coração"), "CORAÇÃO")

    def test_does_not_treat_sentences_or_other_comments_as_guesses(self):
        self.assertIsNone(self.matcher._match_caca_word("eu achei coração"))
        self.assertIsNone(self.matcher._match_caca_word("oi pessoal!"))

    def test_found_word_is_claimed_once_and_keeps_display_spelling(self):
        found = self.game.find_word_text("coracao", finder="viewer", nickname="Viewer")
        self.assertEqual(found["text"], "CORAÇÃO")
        self.assertEqual(found["finder"], "viewer")
        self.assertIsNone(self.game.try_word_text("coração"))

    def test_text_guess_requires_active_round(self):
        self.game.active = False
        self.assertIsNone(self.game.try_word_text("coração"))

    def test_mode_controls_accepted_chat_format(self):
        self.matcher.caca_answer_mode = "word"
        self.assertEqual(self.matcher._match_caca_input("coração"), ("word", "CORAÇÃO"))
        self.assertIsNone(self.matcher._match_caca_input("A1:A4"))

        self.matcher.caca_answer_mode = "coordinates"
        self.assertIsNone(self.matcher._match_caca_input("coração"))
        self.assertEqual(self.matcher._match_caca_input("cp A1:A4"), ("coordinates", ("A1", "A4")))

    def test_both_mode_accepts_either_format(self):
        self.assertEqual(self.matcher._match_caca_input("coração"), ("word", "CORAÇÃO"))
        self.assertEqual(self.matcher._match_caca_input("cp A1:A4"), ("coordinates", ("A1", "A4")))


if __name__ == "__main__":
    unittest.main()
