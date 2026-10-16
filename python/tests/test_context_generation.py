import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import context_generation as cg


class GenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.conn = sqlite3.connect(Path(self.temp.name) / 'test.db')
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        self.conn.executescript((cg.ROOT / 'node/lib/context-generation.sql').read_text())
        self.conn.execute('CREATE TABLE contextos(alvo TEXT PRIMARY KEY,gerado_em TEXT,ranking TEXT)')
        self.words = [f'palavra{i}' for i in range(100)]
        self.payload = {'id': 'request-1', 'usage': {'cost': 0.003, 'prompt_tokens': 100, 'completion_tokens': 80},
                        'choices': [{'message': {'content': json.dumps({'words': self.words[:80]})}}]}

    def call(self):
        return cg.attempt(self.conn, 'run-1', 'alvo', self.words, {}, 'fake-key',
                          request=lambda *_: self.payload)

    def test_valid_response_is_saved_with_metadata_and_exact_top50(self):
        self.assertIsNone(self.call())
        ranked = json.loads(self.conn.execute('SELECT ranking FROM contextos').fetchone()[0])
        self.assertEqual([r['palavra'] for r in ranked], self.words)
        self.assertEqual(self.conn.execute('SELECT top_count FROM generated_context_metadata').fetchone()[0], 50)
        self.assertEqual(self.conn.execute('SELECT cost_usd FROM context_generation_attempts').fetchone()[0], .003)

    def test_short_billed_response_is_saved_and_completed_from_local_ranking(self):
        self.call()
        self.payload['choices'][0]['message']['content'] = json.dumps({'words': ['palavra1'] * 80})
        self.assertIsNone(self.call())
        rows = self.conn.execute('SELECT status,cost_usd FROM context_generation_attempts').fetchall()
        self.assertEqual([(r[0],r[1]) for r in rows], [('success',.003), ('success',.003)])
        self.assertEqual(len(json.loads(self.conn.execute('SELECT ranking FROM contextos').fetchone()[0])),100)
        attempt=self.conn.execute('SELECT ai_count,local_fill_count FROM context_generation_attempts ORDER BY rowid DESC LIMIT 1').fetchone()
        self.assertEqual(tuple(attempt),(1,49))

    def test_absent_cost_is_unknown_not_zero(self):
        self.payload['usage'] = {}
        self.call()
        self.assertIsNone(self.conn.execute('SELECT cost_usd FROM context_generation_attempts').fetchone()[0])

    def test_game_reads_only_matching_metadata_from_persisted_database(self):
        import db
        self.call()
        with patch.object(db,'DB_PATH',str(Path(self.temp.name) / 'test.db')):
            self.assertIsNotNone(db.get_generated_context('alvo',cg.pool_version()))
            self.assertIsNone(db.get_generated_context('alvo','outdated-dictionary'))
            self.assertIsNone(db.get_generated_context('unknown',cg.pool_version()))

    def test_network_failure_is_durable_and_not_retried(self):
        network = Mock(side_effect=TimeoutError('sensitive-content'))
        self.assertEqual(cg.attempt(self.conn,'run','alvo',self.words,{},'secret',request=network), 'TimeoutError')
        network.assert_called_once()
        row = self.conn.execute('SELECT status,cost_usd,error_code FROM context_generation_attempts').fetchone()
        self.assertEqual(tuple(row), ('failed', None, 'TimeoutError'))

    def test_out_of_vocabulary_candidates_are_ignored_and_local_ranking_fills(self):
        self.payload['choices'][0]['message']['content'] = json.dumps({'words': self.words[:79]+['inventada']})
        self.assertIsNone(self.call())
        attempt=self.conn.execute('SELECT ai_count,local_fill_count FROM context_generation_attempts').fetchone()
        self.assertEqual(tuple(attempt),(50,0))

    def test_request_limits_candidate_dictionary_to_top_300(self):
        response = Mock()
        response.read.return_value = json.dumps(self.payload).encode()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        words = [f'palavra{i}' for i in range(1000)]
        with patch.object(cg.urllib.request,'urlopen',return_value=response) as network:
            cg.request_neighbors('alvo',words,'fake-key')
        sent = json.loads(network.call_args.args[0].data)
        allowed = sent['response_format']['json_schema']['schema']['properties']['words']['items']['enum']
        self.assertEqual(set(allowed),set(words[:300]))

    def test_counts_and_local_completion_are_preserved_for_short_billed_response(self):
        self.payload['choices'][0]['message']['content'] = json.dumps({'words':['palavra1']*12})
        self.assertIsNone(self.call())
        row=self.conn.execute('SELECT received_count,unique_count,ai_count,local_fill_count,cost_usd FROM context_generation_attempts').fetchone()
        self.assertEqual(tuple(row),(12,1,1,49,.003))

    def test_worker_saves_then_resumes_without_a_second_paid_request(self):
        import generate_openrouter_contextos as worker
        pool = json.loads((cg.ROOT / 'python/words.json').read_text(encoding='utf8'))
        candidates = list(dict.fromkeys(w for w in pool if w.isalpha() and cg.norm(w) != 'abelha'))[:80]
        response = {'usage': {'cost': .004}, 'choices':[{'message':{'content':json.dumps({'words':candidates})}}]}
        network = Mock(return_value=response)
        def counted_attempt(*args):
            return cg.attempt(*args, request=network)
        doc = SimpleNamespace(has_vector=True,similarity=lambda _: .5)
        fake_nlp = SimpleNamespace(pipe=lambda words: (doc for _ in words))
        db_path = str(Path(self.temp.name) / 'test.db')
        self.conn.commit()
        with patch.dict(os.environ,{'CONTEXT_RUN_ID':'worker-run','DB_PATH':db_path,'OPENROUTER_API_KEY':'fake-key'}), \
                patch.dict(sys.modules,{'similarity':SimpleNamespace(nlp=fake_nlp)}), \
                patch.object(worker,'attempt',side_effect=counted_attempt), patch('builtins.print'):
            for run_id in ('worker-run','resume-run'):
                os.environ['CONTEXT_RUN_ID']=run_id
                self.conn.execute('INSERT INTO context_generation_runs(id,actor_id,model,status,created_at,config) VALUES(?,?,?,?,?,?)',
                                  (run_id,1,cg.MODEL,'running',cg.now(),json.dumps({'limit':1,'interval_min':0,'regenerate':False})))
                self.conn.commit()
                self.assertEqual(worker.main(),0)
        network.assert_called_once()
        self.assertEqual(self.conn.execute("SELECT skipped FROM context_generation_runs WHERE id='resume-run'").fetchone()[0],1)
        self.assertEqual(self.conn.execute("SELECT status FROM context_generation_runs WHERE id='worker-run'").fetchone()[0],'completed')

    def test_worker_stops_after_two_consecutive_failures(self):
        import generate_openrouter_contextos as worker
        run_id='failed-batch'
        self.conn.execute('INSERT INTO context_generation_runs(id,actor_id,model,status,created_at,config) VALUES(?,?,?,?,?,?)',
                          (run_id,1,cg.MODEL,'running',cg.now(),json.dumps({'limit':10,'interval_min':0,'regenerate':True})))
        self.conn.commit()
        doc=SimpleNamespace(has_vector=True,similarity=lambda _: .5)
        with patch.dict(os.environ,{'CONTEXT_RUN_ID':run_id,'DB_PATH':str(Path(self.temp.name)/'test.db'),'OPENROUTER_API_KEY':'fake'}), \
                patch.dict(sys.modules,{'similarity':SimpleNamespace(nlp=SimpleNamespace(pipe=lambda words:(doc for _ in words)))}), \
                patch.object(worker,'attempt') as attempted, patch('builtins.print'):
            def failure(*_):
                self.conn.execute('INSERT INTO context_generation_attempts(id,run_id,target,model,status,created_at) VALUES(?,?,?,?,?,?)',
                                  (str(attempted.call_count),run_id,'teste',cg.MODEL,'failed',cg.now()))
                self.conn.commit()
                return 'INSUFFICIENT_UNIQUE_WORDS'
            attempted.side_effect=failure
            self.assertEqual(worker.main(),0)
            self.assertEqual(attempted.call_count,2)
        run=self.conn.execute('SELECT status,done,errors FROM context_generation_runs WHERE id=?',(run_id,)).fetchone()
        self.assertEqual(tuple(run),('failed',2,2))


class HybridGameTests(unittest.TestCase):
    def setUp(self):
        from jogos import palavra
        self.module = palavra
        self.game = palavra.JogoContexto.__new__(palavra.JogoContexto)
        self.game.secret_word = 'alvo'
        self.game._pool_version = 'version'
        self.words = [f'palavra{i}' for i in range(100)]
        self.game.norm_to_word = {w: w for w in self.words}
        self.game.norm_to_word['alvo'] = 'alvo'
        def local():
            self.game.all_scored = self.words
            self.game.all_scored_sims = [1-i/100 for i in range(100)]
            self.game._all_scored_neg_sims = [-v for v in self.game.all_scored_sims]
            self.game._word_index = {w:i for i,w in enumerate(self.words)}
            self.game.hint_pool = self.words[:]
        self.game._build_local_hint_pool = local

    def test_hybrid_is_snapshot_and_does_not_mutate_local_cache(self):
        selected = list(reversed(self.words))
        with patch.object(self.module.db, 'get_generated_context', return_value={
                'ranking': [{'palavra':w} for w in selected]}):
            self.game._build_hint_pool()
        self.assertEqual(self.game._compute_rank('alvo'),1)
        self.assertEqual(self.game._compute_rank('palavra99'),2)
        self.assertEqual(self.game._compute_rank('palavra50'),51)
        self.assertEqual(self.words[0],'palavra0')
        self.assertEqual(self.game.hint_pool[:50],selected[:50])
        # High cosine similarity for an external guess cannot take a curated slot.
        doc = SimpleNamespace(has_vector=True, similarity=lambda _:1.0)
        with patch.object(self.module,'nlp',return_value=doc):
            self.assertGreaterEqual(self.game._compute_rank('externa'),52)

    def test_legacy_or_corrupt_context_keeps_local_order(self):
        for result in (None, {'ranking':[{'palavra':'fora-do-dicionario'}]}):
            with patch.object(self.module.db,'get_generated_context',return_value=result):
                self.game._build_hint_pool()
            self.assertFalse(self.game._hybrid_ranking)
            self.assertEqual(self.game.all_scored,self.words)


if __name__ == '__main__':
    unittest.main()
