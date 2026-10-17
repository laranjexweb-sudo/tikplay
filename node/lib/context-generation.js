const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const MODEL = 'anthropic/claude-haiku-5.5';
const METHOD = 'openrouter-top50-v1';

function createContextGenerator({ db, pythonBin, log = () => {}, spawnProcess = spawn }) {
  db.exec(fs.readFileSync(path.join(__dirname, 'context-generation.sql'), 'utf8'));
  const attemptColumns = new Set(db.prepare('PRAGMA table_info(context_generation_attempts)').all().map(c => c.name));
  for (const name of ['received_count', 'unique_count', 'ai_count', 'local_fill_count']) {
    if (!attemptColumns.has(name)) db.exec(`ALTER TABLE context_generation_attempts ADD COLUMN ${name} INTEGER`);
  }
  // Previous process cannot own a new worker. Keep unknown-cost attempts visible.
  db.prepare("UPDATE context_generation_runs SET status='interrupted',ended_at=? WHERE status IN ('running','stopping')")
    .run(new Date().toISOString());
  let active = null;
  db.prepare("UPDATE context_generation_attempts SET status='interrupted',error_code='WORKER_INTERRUPTED' WHERE status IN ('pending','received') AND run_id IN (SELECT id FROM context_generation_runs WHERE status='interrupted')").run();
  function emit(actor, runId, event, code, attemptId) {
    const failed = event.endsWith('failed');
    log(actor, { category: failed ? 'error' : event.endsWith('stopped') ? 'notice' : 'diagnostic',
      level: failed ? 'error' : event.endsWith('stopped') ? 'warning' : 'info', event,
      message: failed ? 'Falha na geração de contextos.' : 'Estado da geração de contextos atualizado.',
      source: 'node', trace_id: runId, code: code || undefined, details: { model: MODEL,
        ...(typeof attemptId === 'string' ? { attempt_id: attemptId.slice(0,64) } : {}) } });
  }
  const summary = (runId) => db.prepare(`SELECT COUNT(*) requests,
    COALESCE(SUM(status='success'),0) succeeded, COALESCE(SUM(status='failed'),0) failed,
    COALESCE(SUM(ai_count),0) ai_words, COALESCE(SUM(local_fill_count),0) local_words,
    COALESCE(SUM(local_fill_count>0),0) partially_completed,
    COALESCE(SUM(status='success' AND ai_count IS NULL),0) untracked_origin_requests,
    COALESCE(SUM(prompt_tokens),0) prompt_tokens, COALESCE(SUM(completion_tokens),0) completion_tokens,
    COALESCE(SUM(cost_usd),0) known_cost_usd, COALESCE(SUM(cost_usd IS NULL),0) unknown_cost_requests
    FROM context_generation_attempts ${runId ? 'WHERE run_id=?' : ''}`).get(...(runId ? [runId] : []));
  function coverage() {
    try {
      const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
      const words = db.prepare("SELECT word FROM word_catalog WHERE status='active'").all().map(row => row.word).filter(word => typeof word === 'string');
      const pool = [...new Set(words.map(normalize).filter(Boolean))].sort();
      const poolVersion = crypto.createHash('md5').update(JSON.stringify(pool), 'utf8').digest('hex');
      const banned = new Set(db.prepare('SELECT word FROM banned_words').all().map(row => normalize(row.word)));
      const targetWords = new Set(words.filter(word => /^\p{L}+$/u.test(word)).map(normalize).filter(word => word && !banned.has(word)));
      const generated = new Set(db.prepare(`SELECT m.target FROM generated_context_metadata m
        JOIN contextos c ON c.alvo=m.target WHERE m.pool_version=? AND m.method_version=? AND m.model=? AND m.top_count=50`)
        .all(poolVersion, METHOD, MODEL).map(row => normalize(row.target)));
      const total = targetWords.size;
      const completed = [...targetWords].filter(word => generated.has(word)).length;
      return { available: true, total, generated: completed, remaining: Math.max(0, total - completed),
        percent: total ? Math.round(completed / total * 100) : 0 };
    } catch (_) {
      return { available: false, total: 0, generated: 0, remaining: 0, percent: 0 };
    }
  }
  function status() {
    const runs = db.prepare('SELECT * FROM context_generation_runs ORDER BY rowid DESC LIMIT 20').all();
    const current = runs[0];
    return { success: true, model: MODEL, generator_version: 4,
      configured: !!(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY),
      running: !!active, finished: !!current && !active,
      done: current?.done || 0, total: current?.total || 0, current: current?.current || '',
      errors: current?.errors || 0, last_error: current?.last_error || null,
      started_at: current?.created_at || null, status: current?.status || 'idle',
      consumption: summary(current?.id), totals: summary(), coverage: coverage(),
      runs: runs.map(row => ({ ...row, config: JSON.parse(row.config), consumption: summary(row.id) })),
      attempts: current ? db.prepare('SELECT * FROM context_generation_attempts WHERE run_id=? ORDER BY rowid DESC LIMIT 100').all(current.id) : [],
      logs: [] };
  }
  function start(actorId, config) {
    if (active) return { started: false, reason: 'Já existe uma geração em execução.' };
    if (!(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY)) {
      return { started: false, reason: 'Chave OpenRouter não configurada no servidor.' };
    }
    const runId = crypto.randomUUID();
    db.prepare('INSERT INTO context_generation_runs(id,actor_id,model,status,created_at,config) VALUES(?,?,?,?,?,?)')
      .run(runId, actorId, MODEL, 'running', new Date().toISOString(), JSON.stringify(config));
    const script = path.resolve(__dirname, '..', '..', 'python', 'generate_openrouter_contextos.py');
    const file = db.name;
    let proc;
    try {
      proc = spawnProcess(pythonBin, ['-u', script], { windowsHide: true, cwd: path.dirname(script),
        env: { ...process.env, DB_PATH: file, CONTEXT_RUN_ID: runId,
          PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } });
    } catch (_) {
      db.prepare("UPDATE context_generation_runs SET status='failed',last_error='WORKER_START_FAILED',ended_at=? WHERE id=?")
        .run(new Date().toISOString(), runId);
      emit(actorId, runId, 'contexts.run.failed', 'WORKER_START_FAILED');
      return { started: false, reason: 'Não foi possível iniciar o gerador.' };
    }
    active = { proc, runId };
    emit(actorId, runId, 'contexts.run.started');
    let buffer = '', closed = false;
    const line = (value) => {
      try {
        const msg = JSON.parse(value);
        if (msg.run_id !== runId) return;
        if (msg.event === 'attempt.completed' || msg.event === 'attempt.failed')
          emit(actorId, runId, `contexts.${msg.event}`, msg.code, msg.attempt_id);
      } catch (_) { /* Never log raw stdout: it may contain provider text. */ }
    };
    proc.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 1024 * 1024) { buffer = ''; return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
      }
    });
    proc.stderr.on('data', () => {});
    function finish(code, error) {
      if (closed) return;
      closed = true;
      if (buffer.trim()) line(buffer);
      const run = db.prepare('SELECT status,stop_requested FROM context_generation_runs WHERE id=?').get(runId);
      if (['running', 'stopping'].includes(run.status)) {
        db.prepare('UPDATE context_generation_runs SET status=?,ended_at=?,last_error=? WHERE id=?')
          .run(run.stop_requested ? 'stopped' : 'failed', new Date().toISOString(),
            run.stop_requested ? null : error ? 'WORKER_START_FAILED' : `WORKER_EXIT_${code}`, runId);
      }
      db.prepare("UPDATE context_generation_attempts SET status='interrupted',error_code='WORKER_INTERRUPTED' WHERE run_id=? AND status IN ('pending','received')").run(runId);
      if (active?.runId === runId) active = null;
      const outcome = db.prepare('SELECT status FROM context_generation_runs WHERE id=?').get(runId).status;
      emit(actorId, runId, `contexts.run.${outcome === 'completed' ? 'completed' : outcome === 'stopped' ? 'stopped' : 'failed'}`);
    }
    proc.on('error', () => finish(null, true));
    proc.on('close', code => finish(code, false));
    return { started: true, run_id: runId };
  }
  function stop() {
    if (active) db.prepare("UPDATE context_generation_runs SET stop_requested=1,status='stopping' WHERE id=?").run(active.runId);
    return { success: true, message: 'Parada solicitada. A chamada em andamento será contabilizada antes de encerrar.' };
  }
  return { start, stop, status };
}

module.exports = { createContextGenerator, MODEL };
