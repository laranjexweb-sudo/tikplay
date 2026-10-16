import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'experiments'))
from contexto_hibrido import merge_ranking


class HybridExperimentTests(unittest.TestCase):
    def test_merge_preserves_secret_and_local_tail_order(self):
        local = [f'palavra{i}' for i in range(100)]
        selected = list(reversed(local[30:80]))
        merged = merge_ranking('alvo', selected, local)
        self.assertEqual(merged[0], 'alvo')
        self.assertEqual(merged[1:51], selected)
        self.assertEqual(merged[51:], local[:30] + local[80:])
        self.assertEqual(len(set(merged)), 101)

    def test_rejects_duplicates_even_with_accents(self):
        words = [f'palavra{i}' for i in range(48)] + ['agua', 'água']
        with self.assertRaisesRegex(ValueError, 'INVALID_TOP_50'):
            merge_ranking('alvo', words, words)

    def test_rejects_secret_and_invented_words(self):
        words = [f'palavra{i}' for i in range(50)]
        with self.assertRaisesRegex(ValueError, 'INVALID_TOP_50'):
            merge_ranking(words[0], words, words)
        with self.assertRaisesRegex(ValueError, 'OUT_OF_VOCABULARY'):
            merge_ranking('alvo', words, words[:-1])


if __name__ == '__main__':
    unittest.main()
