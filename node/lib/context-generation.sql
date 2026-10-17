CREATE TABLE IF NOT EXISTS context_generation_runs (
  id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL, model TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, ended_at TEXT,
  total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
  current TEXT NOT NULL DEFAULT '', stop_requested INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL, last_error TEXT
);
CREATE TABLE IF NOT EXISTS context_generation_attempts (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, target TEXT NOT NULL,
  model TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
  duration_ms INTEGER, prompt_tokens INTEGER, completion_tokens INTEGER,
  cost_usd REAL, provider_id TEXT, error_code TEXT,
  received_count INTEGER, unique_count INTEGER,
  ai_count INTEGER, local_fill_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_context_attempt_run ON context_generation_attempts(run_id);
CREATE INDEX IF NOT EXISTS idx_context_attempt_created ON context_generation_attempts(created_at DESC);
CREATE TABLE IF NOT EXISTS generated_context_metadata (
  target TEXT PRIMARY KEY, pool_version TEXT NOT NULL, model TEXT NOT NULL,
  method_version TEXT NOT NULL, top_count INTEGER NOT NULL,
  created_at TEXT NOT NULL, run_id TEXT NOT NULL
);
