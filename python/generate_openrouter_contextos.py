"""Admin worker. Run is created by Node; stdout contains safe progress only."""
import json
import os
import sys
import time

from context_generation import ROOT, MODEL, METHOD, attempt, connect, norm, now, pool_version

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def main():
    run_id = os.environ['CONTEXT_RUN_ID']
    key = os.environ.get('OPENROUTER_API_KEY') or os.environ.get('OPENAI_API_KEY') or ''
    conn = connect()
    try:
        run = conn.execute('SELECT * FROM context_generation_runs WHERE id=?', (run_id,)).fetchone()
        config = json.loads(run['config'])
        if not key:
            raise RuntimeError('OPENROUTER_KEY_MISSING')
        from similarity import nlp
        from db import get_word_catalog
        pool = get_word_catalog()
        pool = list({norm(w): w for w in pool if isinstance(w, str) and w.isalpha()}.values())
        docs = dict(zip(pool, nlp.pipe(pool)))
        canonical = {norm(w): w for w in pool}
        raw_targets = (ROOT / '1000_palavras_seguras_contexto.txt').read_text(encoding='utf-8').split(',')
        targets = list(dict.fromkeys(canonical[norm(w)] for w in raw_targets if norm(w) in canonical))
        # The legacy target list repeats entries; complete with the game pool.
        targets = list(dict.fromkeys(targets + pool))
        try:
            banned = {norm(row[0]) for row in conn.execute('SELECT word FROM banned_words')}
        except Exception:
            banned = set()
        targets = [w for w in targets if norm(w) not in banned]
        if config['limit']:
            targets = targets[:config['limit']]
        with conn:
            conn.execute('UPDATE context_generation_runs SET total=? WHERE id=?', (len(targets), run_id))
        consecutive_errors = 0
        failed_batch = False
        for index, target in enumerate(targets):
            if conn.execute('SELECT stop_requested FROM context_generation_runs WHERE id=?', (run_id,)).fetchone()[0]:
                break
            with conn:
                conn.execute('UPDATE context_generation_runs SET current=? WHERE id=?', (target, run_id))
            print(json.dumps({'event': 'progress', 'run_id': run_id}), flush=True)
            existing = conn.execute('SELECT 1 FROM generated_context_metadata m JOIN contextos c ON c.alvo=m.target WHERE m.target=? AND m.pool_version=? AND m.method_version=? AND m.model=? AND m.top_count=50',
                                    (norm(target), pool_version(), METHOD, MODEL)).fetchone()
            error = None
            attempt_id = None
            if existing and not config['regenerate']:
                with conn:
                    conn.execute('UPDATE context_generation_runs SET skipped=skipped+1 WHERE id=?', (run_id,))
            else:
                target_doc = docs[target]
                if not target_doc.has_vector:
                    error = 'TARGET_NO_VECTOR'
                else:
                    scored = sorted(((w, float(doc.similarity(target_doc)) if doc.has_vector else -1.0)
                                     for w, doc in docs.items() if norm(w) != norm(target)), key=lambda x: -x[1])
                    error = attempt(conn, run_id, target, [w for w, _ in scored],
                                    {norm(w): s for w, s in scored}, key)
                    attempt_id = conn.execute('SELECT id FROM context_generation_attempts WHERE run_id=? ORDER BY rowid DESC LIMIT 1', (run_id,)).fetchone()[0]
            with conn:
                conn.execute('UPDATE context_generation_runs SET done=done+1,errors=errors+?,last_error=? WHERE id=?',
                             (int(bool(error)), error, run_id))
            print(json.dumps({'event': 'attempt.failed' if error else 'attempt.completed', 'run_id': run_id,
                              'code': error, 'attempt_id': attempt_id}), flush=True)
            consecutive_errors = consecutive_errors + 1 if error else 0
            if consecutive_errors >= 2:
                failed_batch = True
                break  # Stop paid failure cascades; no retry or model switch.
            # Interruptible delay; no paid retry.
            deadline = time.monotonic() + config['interval_min'] * 60
            while index < len(targets)-1 and time.monotonic() < deadline:
                if conn.execute('SELECT stop_requested FROM context_generation_runs WHERE id=?', (run_id,)).fetchone()[0]:
                    break
                time.sleep(min(0.25, max(0, deadline-time.monotonic())))
        stop = conn.execute('SELECT stop_requested FROM context_generation_runs WHERE id=?', (run_id,)).fetchone()[0]
        with conn:
            conn.execute('UPDATE context_generation_runs SET status=?,ended_at=?,current=? WHERE id=?',
                         ('stopped' if stop else 'failed' if failed_batch else 'completed', now(), '', run_id))
    except Exception as exc:
        with conn:
            conn.execute('UPDATE context_generation_runs SET status=?,ended_at=?,last_error=? WHERE id=?',
                         ('failed', now(), type(exc).__name__, run_id))
        print(json.dumps({'event': 'run.failed', 'run_id': run_id, 'code': type(exc).__name__}), flush=True)
        return 1
    finally:
        conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
