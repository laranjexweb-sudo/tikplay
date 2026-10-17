const crypto = require("crypto");
const seedQuestions = require("./quiz-question-bank.json");
const math = require("./quiz-math");

const THEMES = Object.freeze([
  ["geral", "Conhecimentos gerais"], ["matematica", "Matemática"], ["historia", "História"],
  ["geografia", "Geografia"], ["ciencias", "Ciências"], ["tecnologia", "Tecnologia"],
  ["filmes", "Filmes e séries"], ["musica", "Música"], ["esportes", "Esportes"],
  ["logica", "Raciocínio lógico"], ["curiosidades", "Curiosidades"],
]);
const THEME_IDS = new Set(THEMES.map(item => item[0]));
const DIFFICULTIES = new Set(["facil", "medio", "dificil", "misto"]);
const DEFAULTS = Object.freeze({
  themes: [], difficulty: "misto", response_mode: "alternativas", question_source: "all", question_count: 10,
  question_time: 20, pause_seconds: 5, auto_advance: true, narrate: false,
  narrate_options: true, show_ranking: true, speed_bonus: true,
  math_contents: math.CONTENTS.map(item => item[0]),
  safe_margins: { top: 12, bottom: 18, left: 5, right: 5 },
});
const ACTIVE_STATES = new Set(["question_active", "paused", "answers_closed", "interval"]);

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function parseJson(text, fallback) { try { return JSON.parse(text); } catch { return fallback; } }
function normalizeNumeric(value) {
  let text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!/^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return null;
  if (text.includes(",") && text.includes(".")) return null;
  text = text.replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
function weekStart(timestamp) {
  const date = new Date(timestamp);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}
function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function ensureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS quiz_settings (
      tenant_id INTEGER PRIMARY KEY,
      config TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      scope TEXT NOT NULL DEFAULT 'streamer',
      owner_user_id INTEGER,
      theme TEXT NOT NULL,
      subtheme TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'alternativas',
      prompt TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '{}',
      answer TEXT NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      tolerance REAL NOT NULL DEFAULT 0,
      recommended_time INTEGER NOT NULL DEFAULT 20,
      status TEXT NOT NULL DEFAULT 'active',
      origin TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_questions_tenant_theme
      ON quiz_questions(tenant_id, theme, difficulty, status);
    CREATE TABLE IF NOT EXISTS quiz_themes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      normalized_label TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_question_usage (
      tenant_id INTEGER NOT NULL,
      room_code TEXT NOT NULL,
      question_id INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      PRIMARY KEY(tenant_id, room_code, question_id)
    );
    CREATE TABLE IF NOT EXISTS quiz_question_usage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      room_code TEXT NOT NULL,
      question_id INTEGER NOT NULL,
      match_id TEXT NOT NULL,
      question_no INTEGER NOT NULL,
      used_at INTEGER NOT NULL,
      UNIQUE(match_id, question_no, question_id)
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_question_usage_history_tenant
      ON quiz_question_usage_history(tenant_id, question_id, used_at DESC);
    CREATE TABLE IF NOT EXISTS quiz_matches (
      id TEXT PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      room_code TEXT NOT NULL,
      live_room_id TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL,
      config TEXT NOT NULL,
      question_count INTEGER NOT NULL,
      current_question_no INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_matches_tenant_time
      ON quiz_matches(tenant_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quiz_matches_room_state
      ON quiz_matches(room_code, state, started_at DESC);
    CREATE TABLE IF NOT EXISTS quiz_rounds (
      match_id TEXT NOT NULL,
      question_no INTEGER NOT NULL,
      question_id INTEGER,
      theme TEXT NOT NULL,
      subtheme TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL,
      mode TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '{}',
      answer TEXT NOT NULL,
      answer_value TEXT NOT NULL DEFAULT '',
      explanation TEXT NOT NULL DEFAULT '',
      tolerance REAL NOT NULL DEFAULT 0,
      state TEXT NOT NULL,
      opens_at INTEGER,
      narration_url TEXT NOT NULL DEFAULT '',
      opened_at INTEGER,
      deadline INTEGER,
      closed_at INTEGER,
      PRIMARY KEY(match_id, question_no)
    );
    CREATE TABLE IF NOT EXISTS quiz_players (
      match_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      response_ms INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(match_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS quiz_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      question_no INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      event_id TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      answer TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      is_correct INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      speed_bonus INTEGER NOT NULL DEFAULT 0,
      streak_bonus INTEGER NOT NULL DEFAULT 0,
      UNIQUE(match_id, question_no, user_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_response_event
      ON quiz_responses(match_id, event_id) WHERE event_id <> '';
    CREATE INDEX IF NOT EXISTS idx_quiz_response_question
      ON quiz_responses(match_id, question_no, received_at, id);
    CREATE TABLE IF NOT EXISTS quiz_weekly_scores (
      tenant_id INTEGER NOT NULL,
      week_start TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      response_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(tenant_id, week_start, user_id)
    );
    CREATE TABLE IF NOT EXISTS quiz_weekly_applied (
      match_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY(match_id, user_id)
    );
  `);
  try { database.exec("ALTER TABLE quiz_rounds ADD COLUMN opens_at INTEGER"); } catch {}
  try { database.exec("ALTER TABLE quiz_rounds ADD COLUMN narration_url TEXT NOT NULL DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE quiz_questions ADD COLUMN scope TEXT NOT NULL DEFAULT 'streamer'"); } catch {}
  try { database.exec("ALTER TABLE quiz_questions ADD COLUMN owner_user_id INTEGER"); } catch {}
  database.exec("UPDATE quiz_questions SET scope=CASE WHEN tenant_id IS NULL THEN 'global' ELSE 'streamer' END, owner_user_id=tenant_id");
  const themeInsert = database.prepare(`INSERT OR IGNORE INTO quiz_themes(id,label,normalized_label,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)`);
  const normalizeThemeLabel = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim().replace(/\s+/g, " ");
  const seedThemes = database.transaction(() => {
    const timestamp = Date.now();
    for (const [id,label] of THEMES) themeInsert.run(id,label,normalizeThemeLabel(label),timestamp,timestamp);
  });
  seedThemes();
  const insert = database.prepare(`INSERT INTO quiz_questions
    (tenant_id,scope,owner_user_id,theme,subtheme,difficulty,mode,prompt,options,answer,explanation,tolerance,recommended_time,status,origin,created_at,updated_at)
    SELECT NULL,'global',NULL,@theme,'',@difficulty,'alternativas',@prompt,@options,@answer,@explanation,0,20,'active','builtin',@now,@now
    WHERE NOT EXISTS (SELECT 1 FROM quiz_questions WHERE scope='global' AND prompt=@prompt)`);
  const seed = database.transaction(() => {
    const now = Date.now();
    for (const question of seedQuestions) insert.run({ ...question, options: JSON.stringify(question.options), now });
  });
  seed();
}

function normalizeConfig(input = {}, fallback = DEFAULTS, allowedThemeIds = THEME_IDS) {
  const themes = Array.isArray(input.themes) ? [...new Set(input.themes.filter(id => allowedThemeIds.has(id)))] : fallback.themes;
  const safe = input.safe_margins && typeof input.safe_margins === "object" ? input.safe_margins : fallback.safe_margins;
  const contents = Array.isArray(input.math_contents)
    ? [...new Set(input.math_contents.filter(id => math.CONTENTS.some(([key]) => key === id)))]
    : fallback.math_contents;
  return {
    themes,
    difficulty: DIFFICULTIES.has(input.difficulty) ? input.difficulty : fallback.difficulty,
    response_mode: ["alternativas", "calculo"].includes(input.response_mode) ? input.response_mode : fallback.response_mode,
    question_source: ["all", "global", "streamer"].includes(input.question_source) ? input.question_source : (fallback.question_source || "all"),
    question_count: clampInt(input.question_count, 1, 100, fallback.question_count),
    question_time: clampInt(input.question_time, 10, 60, fallback.question_time),
    pause_seconds: clampInt(input.pause_seconds, 0, 300, fallback.pause_seconds),
    auto_advance: typeof input.auto_advance === "boolean" ? input.auto_advance : fallback.auto_advance,
    narrate: typeof input.narrate === "boolean" ? input.narrate : fallback.narrate,
    narrate_options: typeof input.narrate_options === "boolean" ? input.narrate_options : fallback.narrate_options,
    show_ranking: typeof input.show_ranking === "boolean" ? input.show_ranking : fallback.show_ranking,
    speed_bonus: typeof input.speed_bonus === "boolean" ? input.speed_bonus : fallback.speed_bonus,
    math_contents: contents.length ? contents : fallback.math_contents,
    safe_margins: {
      top: clampInt(safe.top, 0, 40, fallback.safe_margins.top),
      bottom: clampInt(safe.bottom, 0, 40, fallback.safe_margins.bottom),
      left: clampInt(safe.left, 0, 25, fallback.safe_margins.left),
      right: clampInt(safe.right, 0, 25, fallback.safe_margins.right),
    },
  };
}

function createQuizService({ database, getTenant, getUserByRoomCode, getNarrationConfig = () => ({}), requestNarration = null, broadcastToClients, broadcastLog = null, auditLog = null, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  ensureSchema(database);
  const publicClients = new Map();
  const timers = new Map();
  const dirtyBroadcasts = new Map();

  function log(tenantId, event, { level = "info", message = "", code = null, trace_id = null, game_id = null, details = {} } = {}) {
    const tenant = getTenant(tenantId);
    if (tenant && broadcastLog) broadcastLog(tenant, { category: level === "error" ? "error" : level === "warning" ? "notice" : "game",
      level, event, game: "quiz", source: "node", message, text: message, code, trace_id, game_id,
      session_id: tenant.activeDaemonSessionId || null, details });
  }
  const normalizeLabel = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim().replace(/\s+/g, " ");
  const normalizePrompt = value => normalizeLabel(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  function listThemes(activeOnly = false) {
    return database.prepare(`SELECT id,label,status FROM quiz_themes ${activeOnly ? "WHERE status='active'" : ""} ORDER BY label COLLATE NOCASE,id`).all();
  }
  function themeMap(activeOnly = true) {
    return new Map(listThemes(activeOnly).flatMap(theme => [[theme.id,theme.id],[normalizeLabel(theme.id),theme.id],[normalizeLabel(theme.label),theme.id]]));
  }
  function themeIds(activeOnly = true) { return new Set(listThemes(activeOnly).map(theme => theme.id)); }
  function themeByInput(value, includeInactive = false) {
    const key = normalizeLabel(value), themes = listThemes(!includeInactive);
    return themes.find(theme => theme.id === String(value || "").trim() || normalizeLabel(theme.id) === key || normalizeLabel(theme.label) === key) || null;
  }
  function audit(event, actorId, details = {}, level = "info", code = null) {
    if (!auditLog) return;
    auditLog({ category: level === "error" ? "error" : level === "warning" ? "notice" : "game", level, event,
      game: "quiz", source: "node", message: event, code, trace_id: crypto.randomUUID(),
      details: { actor_id: Number(actorId) || null, ...details } });
  }
  function configFor(tenantId) {
    const row = database.prepare("SELECT config FROM quiz_settings WHERE tenant_id=?").get(tenantId);
    return normalizeConfig(parseJson(row && row.config, {}), DEFAULTS, themeIds());
  }
  function saveConfig(tenantId, input) {
    const previous = configFor(tenantId);
    const next = normalizeConfig(input, previous, themeIds());
    database.prepare(`INSERT INTO quiz_settings(tenant_id,config,updated_at) VALUES(?,?,?)
      ON CONFLICT(tenant_id) DO UPDATE SET config=excluded.config,updated_at=excluded.updated_at`)
      .run(tenantId, JSON.stringify(next), now());
    return next;
  }
  function currentMatch(tenantId) {
    return database.prepare(`SELECT * FROM quiz_matches WHERE tenant_id=? AND state IN ('preparing','question_active','paused','answers_closed','interval')
      ORDER BY started_at DESC LIMIT 1`).get(tenantId) || null;
  }
  function matchById(matchId, tenantId) {
    return database.prepare("SELECT * FROM quiz_matches WHERE id=? AND tenant_id=?").get(matchId, tenantId) || null;
  }
  function roundByNo(matchId, questionNo) {
    return database.prepare("SELECT * FROM quiz_rounds WHERE match_id=? AND question_no=?").get(matchId, questionNo) || null;
  }
  function rowsToRanking(rows) {
    return rows.map(row => ({ user_id: row.user_id, username: row.username, nickname: row.nickname || row.username,
      avatar: row.avatar || "", score: Number(row.score) || 0, correct_count: Number(row.correct_count) || 0,
      response_ms: Number(row.response_ms) || 0 })).sort((a,b) => b.score-a.score || b.correct_count-a.correct_count || a.response_ms-b.response_ms || a.user_id.localeCompare(b.user_id));
  }
  function playerRows(matchId) {
    return rowsToRanking(database.prepare("SELECT * FROM quiz_players WHERE match_id=?").all(matchId));
  }
  function weeklyRanking(tenantId, limit = 20) {
    return rowsToRanking(database.prepare(`SELECT user_id,username,nickname,avatar,score,correct_count,response_ms
      FROM quiz_weekly_scores WHERE tenant_id=? AND week_start=? ORDER BY score DESC,correct_count DESC,response_ms ASC,user_id ASC LIMIT ?`)
      .all(tenantId, weekStart(now()), clampInt(limit, 1, 100, 20)));
  }
  function currentRound(match) { return match ? roundByNo(match.id, match.current_question_no) : null; }
  function responseSummary(match, round, isPublic) {
    if (!round) return { count: 0, participants: 0, by_option: {}, latest: [] };
    const rows = database.prepare("SELECT * FROM quiz_responses WHERE match_id=? AND question_no=? ORDER BY received_at,id").all(match.id, round.question_no);
    const byOption = {};
    for (const row of rows) byOption[row.answer] = (byOption[row.answer] || 0) + 1;
    return { count: rows.length, participants: new Set(rows.map(row => row.user_id)).size,
      correct: isPublic ? undefined : rows.filter(row => row.is_correct).length,
      by_option: isPublic ? {} : byOption,
      latest: isPublic ? [] : rows.slice(-12).reverse().map(row => ({ nickname: row.nickname || row.username,
        username: row.username, answer: row.answer, correct: !!row.is_correct, received_at: row.received_at,
        points: row.points + row.speed_bonus + row.streak_bonus })) };
  }
  function statePayload(tenantId, isPublic = false, roomCode = "") {
    const match = isPublic
      ? database.prepare("SELECT * FROM quiz_matches WHERE room_code=? ORDER BY started_at DESC LIMIT 1").get(roomCode)
      : currentMatch(tenantId) || database.prepare("SELECT * FROM quiz_matches WHERE tenant_id=? ORDER BY started_at DESC LIMIT 1").get(tenantId);
    if (!match) return { type: "quiz_state", state: "waiting", match_id: null, ...(isPublic ? {} : { config: configFor(tenantId), live_connected: getTenant(tenantId)?.currentStatus?.state === "connected", all_ranking: [], weekly_ranking: weeklyRanking(tenantId) }) };
    const config = parseJson(match.config, DEFAULTS);
    const round = currentRound(match);
    let question = null;
    if (round) {
      const reveal = !!round.closed_at;
      const answerCounts = responseSummary(match, round, isPublic);
      question = {
        number: round.question_no, total: match.question_count, theme: round.theme, subtheme: round.subtheme,
        difficulty: round.difficulty, mode: round.mode, prompt: round.prompt, options: parseJson(round.options, {}),
        opens_at: round.opens_at, opened_at: round.opened_at, deadline: round.deadline,
        remaining_ms: match.state === "paused" ? (config.remaining_ms || 0) : match.state === "preparing" ? 0 : Math.max(0, Number(round.deadline || 0) - now()),
        answers_received: answerCounts.count, participants: answerCounts.participants,
        ...(isPublic ? (match.state === "preparing" && round.narration_url ? { narration_url: round.narration_url } : {}) : { correct_answer: round.answer, answer_value: round.answer_value, correct_count: answerCounts.correct, answer_counts: answerCounts.by_option, latest_answers: answerCounts.latest }),
        revealed: reveal,
        ...(reveal ? { answer: round.answer, answer_value: round.answer_value, explanation: round.explanation } : {}),
      };
    }
    const ranking = playerRows(match.id);
    const topRanking = config.show_ranking && (match.state === "finished" || match.state === "answers_closed" || match.state === "interval")
      ? ranking.slice(0, isPublic ? 3 : 100) : [];
    return {
      type: "quiz_state", state: match.state, match_id: match.id, started_at: match.started_at, ended_at: match.ended_at,
      question_count: match.question_count, current_question_no: match.current_question_no,
      question, participant_count: ranking.length, ranking: topRanking,
      ...(isPublic ? { config: { show_ranking: !!config.show_ranking, safe_margins: config.safe_margins, narrate: !!config.narrate, narrate_options: !!config.narrate_options, question_time: config.question_time } }
        : { config, all_ranking: ranking, weekly_ranking: weeklyRanking(tenantId), live_connected: getTenant(tenantId)?.currentStatus?.state === "connected" }),
    };
  }
  function sendPublic(roomCode, payload) {
    const user = getUserByRoomCode(roomCode);
    if (!user) return;
    const clients = publicClients.get(user.id) || [];
    const data = JSON.stringify(payload);
    for (let index = clients.length - 1; index >= 0; index--) {
      try { if (clients[index].readyState === 1) clients[index].send(data); else clients.splice(index, 1); }
      catch { clients.splice(index, 1); }
    }
  }
  function emitState(tenantId) {
    const match = currentMatch(tenantId) || database.prepare("SELECT * FROM quiz_matches WHERE tenant_id=? ORDER BY started_at DESC LIMIT 1").get(tenantId);
    const state = statePayload(tenantId, false);
    const tenant = getTenant(tenantId);
    if (tenant) broadcastToClients(tenant.logClients, { type: "quiz_update", state });
    if (match) sendPublic(match.room_code, statePayload(tenantId, true, match.room_code));
  }
  function schedule(match, deadline, callback) {
    const existing = timers.get(match.id);
    if (existing) clearTimer(existing);
    const delay = Math.max(0, Math.min(2147480000, Number(deadline) - now()));
    timers.set(match.id, setTimer(() => { timers.delete(match.id); callback(); }, delay));
  }
  function cancelTimer(matchId) {
    const timer = timers.get(matchId);
    if (timer) clearTimer(timer);
    timers.delete(matchId);
  }
  function finalizeWeekly(match) {
    const scores = database.prepare("SELECT * FROM quiz_players WHERE match_id=?").all(match.id);
    const week = weekStart(match.started_at);
    const apply = database.transaction(() => {
      const insertEvent = database.prepare("INSERT OR IGNORE INTO quiz_weekly_applied(match_id,user_id) VALUES(?,?)");
      const upsert = database.prepare(`INSERT INTO quiz_weekly_scores
        (tenant_id,week_start,user_id,username,nickname,avatar,score,correct_count,response_ms) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(tenant_id,week_start,user_id) DO UPDATE SET username=excluded.username,nickname=excluded.nickname,avatar=excluded.avatar,
        score=quiz_weekly_scores.score+excluded.score,correct_count=quiz_weekly_scores.correct_count+excluded.correct_count,
        response_ms=quiz_weekly_scores.response_ms+excluded.response_ms`);
      for (const player of scores) if (insertEvent.run(match.id, player.user_id).changes) {
        upsert.run(match.tenant_id, week, player.user_id, player.username, player.nickname, player.avatar, player.score, player.correct_count, player.response_ms);
      }
    });
    apply();
  }
  function closeQuestion(tenantId, matchId, { reveal = true, autoAdvance = false, traceId = null } = {}) {
    const match = matchById(matchId, tenantId);
    if (!match || match.state !== "question_active") return false;
    const round = currentRound(match);
    if (!round || round.closed_at) return false;
    const config = parseJson(match.config, DEFAULTS);
    const responses = database.prepare("SELECT * FROM quiz_responses WHERE match_id=? AND question_no=? ORDER BY received_at,id").all(match.id, round.question_no);
    const winners = responses.filter(item => item.is_correct).slice(0, 3);
    const speedPoints = [30, 20, 10];
    const updates = database.transaction(() => {
      const updatePlayer = database.prepare(`INSERT INTO quiz_players(match_id,user_id,username,nickname,avatar,score,correct_count,response_ms,streak)
        VALUES(?,?,?,?,?,0,0,0,0) ON CONFLICT(match_id,user_id) DO NOTHING`);
      const player = database.prepare("SELECT * FROM quiz_players WHERE match_id=? AND user_id=?");
      const applyResponse = database.prepare(`UPDATE quiz_players SET username=?,nickname=?,avatar=?,score=score+?,correct_count=correct_count+?,response_ms=response_ms+?,streak=? WHERE match_id=? AND user_id=?`);
      const responsePoints = database.prepare("UPDATE quiz_responses SET speed_bonus=?,streak_bonus=? WHERE id=?");
      for (const [index, response] of responses.entries()) {
        updatePlayer.run(match.id, response.user_id, response.username, response.nickname, response.avatar);
        const existing = player.get(match.id, response.user_id);
        const streak = response.is_correct ? existing.streak + 1 : 0;
        const speed = response.is_correct && config.speed_bonus ? (speedPoints[winners.findIndex(item => item.id === response.id)] || 0) : 0;
        const streakBonus = response.is_correct && streak === 3 ? 50 : 0;
        responsePoints.run(speed, streakBonus, response.id);
        const elapsed = response.is_correct ? Math.max(0, response.received_at - Number(round.opened_at || response.received_at)) : 0;
        applyResponse.run(response.username, response.nickname, response.avatar, response.is_correct ? 100 + speed + streakBonus : 0,
          response.is_correct ? 1 : 0, elapsed, streak, match.id, response.user_id);
      }
      const closedAt = now();
      database.prepare("UPDATE quiz_rounds SET state=?,closed_at=? WHERE match_id=? AND question_no=?")
        .run(reveal ? "revealed" : "closed", closedAt, match.id, round.question_no);
      let nextState = "answers_closed";
      if (round.question_no >= match.question_count && autoAdvance) nextState = "finished";
      else if (autoAdvance) nextState = "interval";
      database.prepare("UPDATE quiz_matches SET state=?,ended_at=?,updated_at=? WHERE id=?")
        .run(nextState, nextState === "finished" ? closedAt : null, closedAt, match.id);
      return nextState;
    });
    const state = updates();
    cancelTimer(match.id);
    const latest = matchById(match.id, tenantId);
    if (state === "finished") {
      finalizeWeekly(latest);
      log(tenantId, "quiz.match.finished", { game_id: match.id, trace_id: traceId, message: "Partida do Quiz finalizada.", details: { questions: match.question_count, participants: playerRows(match.id).length } });
    } else if (state === "interval" && config.auto_advance) {
      schedule(latest, now() + config.pause_seconds * 1000, () => openNextQuestion(tenantId, match.id));
    }
    const roundResponses = database.prepare("SELECT COUNT(*) count,COALESCE(SUM(is_correct),0) correct FROM quiz_responses WHERE match_id=? AND question_no=?").get(match.id, round.question_no);
    log(tenantId, reveal ? "quiz.question.closed" : "quiz.question.closed", { game_id: match.id, trace_id: traceId,
      message: "Período de respostas encerrado.", details: { question_no: round.question_no, responses: roundResponses.count, correct: roundResponses.correct } });
    emitState(tenantId);
    return true;
  }
  function openQuestion(tenantId, matchId, questionNo, activate = false) {
    const match = matchById(matchId, tenantId);
    const round = match && roundByNo(match.id, questionNo);
    if (!match || !round || match.state === "finished") return false;
    const config = parseJson(match.config, DEFAULTS);
    if (round.state === "waiting" && round.question_id) {
      const openedAt=now();
      database.prepare(`INSERT INTO quiz_question_usage(tenant_id,room_code,question_id,last_used_at) VALUES(?,?,?,?)
        ON CONFLICT(tenant_id,room_code,question_id) DO UPDATE SET last_used_at=excluded.last_used_at`)
        .run(tenantId,match.room_code,round.question_id,openedAt);
      database.prepare(`INSERT OR IGNORE INTO quiz_question_usage_history
        (tenant_id,room_code,question_id,match_id,question_no,used_at) VALUES(?,?,?,?,?,?)`)
        .run(tenantId,match.room_code,round.question_id,match.id,questionNo,openedAt);
    }
    if (!activate && config.narrate) {
      const labels = Object.entries(parseJson(round.options, {})).map(([key,value])=>`${key}. ${value}`).join(". ");
      const text = `${round.prompt} ${config.narrate_options ? labels : ""}`.trim();
      const words = text.split(/\s+/).filter(Boolean).length;
      const estimatedDuration = Math.max(1800,Math.min(30000,Math.ceil(words/2.8*1000)+450));
      const fallbackAt = now()+60000;
      database.prepare("UPDATE quiz_rounds SET state='preparing',opens_at=?,narration_url='',opened_at=NULL,deadline=NULL WHERE match_id=? AND question_no=?").run(fallbackAt,match.id,questionNo);
      database.prepare("UPDATE quiz_matches SET state='preparing',current_question_no=?,updated_at=? WHERE id=?").run(questionNo,now(),match.id);
      const traceId=crypto.randomUUID();
      log(tenantId,"quiz.narration.requested",{trace_id:traceId,game_id:match.id,message:"Narração da pergunta solicitada ao serviço de voz padrão.",details:{question_no:questionNo,characters:text.length}});
      schedule(matchById(match.id,tenantId),fallbackAt,()=>openQuestion(tenantId,match.id,questionNo,true));
      emitState(tenantId);
      if (requestNarration) {
        try {
          const accepted=requestNarration({tenantId,matchId:match.id,questionNo,text,traceId});
          if (!accepted) narrationFailed(tenantId,match.id,questionNo,traceId,estimatedDuration,"TTS_UNAVAILABLE");
        } catch { narrationFailed(tenantId,match.id,questionNo,traceId,estimatedDuration,"TTS_REQUEST_FAILED"); }
      } else {
        const opensAt=now()+estimatedDuration;
        database.prepare("UPDATE quiz_rounds SET opens_at=? WHERE match_id=? AND question_no=?").run(opensAt,match.id,questionNo);
        schedule(matchById(match.id,tenantId),opensAt,()=>openQuestion(tenantId,match.id,questionNo,true));
      }
      return true;
    }
    const started = now(), deadline = started + parseJson(match.config, DEFAULTS).question_time * 1000;
    const apply = database.transaction(() => {
      database.prepare("UPDATE quiz_rounds SET state='question_active',opened_at=?,deadline=?,closed_at=NULL WHERE match_id=? AND question_no=?").run(started, deadline, match.id, questionNo);
      database.prepare("UPDATE quiz_matches SET state='question_active',current_question_no=?,updated_at=? WHERE id=?").run(questionNo, started, match.id);
    });
    apply();
    const latest = matchById(match.id, tenantId);
    schedule(latest, deadline, () => closeQuestion(tenantId, match.id, { reveal: true, autoAdvance: true }));
    log(tenantId, "quiz.question.opened", { game_id: match.id, message: "Pergunta do Quiz aberta para respostas.", details: { question_no: questionNo, mode: round.mode, theme: round.theme, duration_seconds: Math.round((deadline - started) / 1000) } });
    emitState(tenantId);
    return true;
  }
  function narrationFailed(tenantId,matchId,questionNo,traceId,duration=5000,code="TTS_SYNTHESIS_FAILED") {
    const match=matchById(matchId,tenantId),round=match&&roundByNo(match.id,questionNo);
    if(!match||match.state!=="preparing"||!round||round.state!=="preparing")return false;
    const delay=Math.max(1800,Math.min(30000,Number(duration)||5000)),opensAt=now()+delay;
    database.prepare("UPDATE quiz_rounds SET opens_at=? WHERE match_id=? AND question_no=?").run(opensAt,match.id,questionNo);
    log(tenantId,"quiz.narration.failed",{level:"warning",trace_id:traceId,game_id:match.id,code,message:"A voz padrão não gerou a pergunta; o Quiz continuará sem narração.",details:{question_no:questionNo}});
    schedule(match,opensAt,()=>openQuestion(tenantId,match.id,questionNo,true));emitState(tenantId);return true;
  }
  function narrationReady(tenantId,matchId,questionNo,url,traceId=null,synthesisDuration=0) {
    const match=matchById(matchId,tenantId),round=match&&roundByNo(match.id,questionNo),safeUrl=String(url||"");
    if(!match||match.state!=="preparing"||!round||round.state!=="preparing"||!new RegExp(`^/tts-audio/${tenantId}/[A-Za-z0-9_.-]+\\.mp3$`).test(safeUrl))return false;
    const config=parseJson(match.config,DEFAULTS),labels=Object.entries(parseJson(round.options,{})).map(([key,value])=>`${key}. ${value}`).join(". ");
    const settings=getNarrationConfig(tenantId)||{},rate=Math.max(.5,Math.min(2,Number(settings.rate)||1));
    const words=`${round.prompt} ${config.narrate_options?labels:""}`.trim().split(/\s+/).filter(Boolean).length;
    const duration=Math.max(1800,Math.min(60000,Math.ceil(words/2.8/rate*1000)+600)),opensAt=now()+60000;
    database.prepare("UPDATE quiz_rounds SET narration_url=?,opens_at=? WHERE match_id=? AND question_no=?").run(safeUrl,opensAt,match.id,questionNo);
    log(tenantId,"quiz.narration.completed",{trace_id:traceId,game_id:match.id,message:"Áudio da pergunta gerado pela voz padrão.",details:{question_no:questionNo,duration_ms:Math.max(0,Number(synthesisDuration)||0),playback_estimate_ms:duration}});
    schedule(match,opensAt,()=>openQuestion(tenantId,match.id,questionNo,true));emitState(tenantId);return true;
  }
  function narrationFinished(roomCode,matchId,questionNo) {
    const user=getUserByRoomCode(String(roomCode||"")),match=user&&matchById(matchId,user.id),round=match&&roundByNo(match.id,questionNo);
    if(!user||user.status!=="active"||!match||match.room_code!==roomCode||match.state!=="preparing"||!round||round.state!=="preparing"||!round.narration_url)return false;
    cancelTimer(match.id);
    return openQuestion(user.id,match.id,questionNo,true);
  }
  function openNextQuestion(tenantId, matchId) {
    const match = matchById(matchId, tenantId);
    if (!match || match.state === "finished") return false;
    const nextNo = match.current_question_no + 1;
    if (nextNo > match.question_count) {
      const ended = now();
      database.prepare("UPDATE quiz_matches SET state='finished',ended_at=?,updated_at=? WHERE id=?").run(ended, ended, match.id);
      finalizeWeekly(matchById(match.id, tenantId));
      log(tenantId, "quiz.match.finished", { game_id: match.id, message: "Partida do Quiz finalizada.", details: { questions: match.question_count, participants: playerRows(match.id).length } });
      emitState(tenantId);
      return true;
    }
    return openQuestion(tenantId, match.id, nextNo);
  }
  function closeAndMaybeFinish(tenantId, match) {
    const finalQuestion = match.current_question_no >= match.question_count;
    const config = parseJson(match.config, DEFAULTS);
    if (finalQuestion) {
      const ended = now();
      database.prepare("UPDATE quiz_matches SET state='finished',ended_at=?,updated_at=? WHERE id=?").run(ended, ended, match.id);
      finalizeWeekly(matchById(match.id, tenantId));
      cancelTimer(match.id);
      log(tenantId, "quiz.match.finished", { game_id: match.id, message: "Partida do Quiz finalizada.", details: { questions: match.question_count, participants: playerRows(match.id).length } });
      emitState(tenantId);
      return true;
    }
    if (config.auto_advance) {
      database.prepare("UPDATE quiz_matches SET state='interval',updated_at=? WHERE id=?").run(now(), match.id);
      schedule(match, now() + config.pause_seconds * 1000, () => openNextQuestion(tenantId, match.id));
    }
    emitState(tenantId);
    return true;
  }
  function pickQuestions(tenantId, roomCode, config) {
    const themes = config.themes.length ? config.themes : listThemes(true).map(item => item.id);
    const source = ["all","global","streamer"].includes(config.question_source) ? config.question_source : "all";
    if (config.response_mode === "calculo" && themes.some(theme => theme !== "matematica")) {
      const error = new Error("Cálculo direto está disponível quando somente Matemática estiver selecionada."); error.code = "CALCULATION_MATH_ONLY"; throw error;
    }
    const selected = [];
    // O gerador matemático integrado representa o catálogo global. No modo
    // "somente minhas perguntas", Matemática deve vir do banco privado.
    if (themes.includes("matematica") && source !== "streamer") {
      const otherThemes = themes.filter(theme => theme !== "matematica");
      const mathCount = config.response_mode === "calculo" || !otherThemes.length ? config.question_count : Math.max(1, Math.ceil(config.question_count / themes.length));
      for (let i = 0; i < mathCount; i++) {
        const difficulty = config.difficulty === "misto" ? ["facil", "medio", "dificil"][i % 3] : config.difficulty;
        selected.push(math.generateQuestion({ seed: `${crypto.randomUUID()}:${i}`, difficulty, contents: config.math_contents, mode: config.response_mode }));
      }
    }
    const bankThemes = source === "streamer" ? themes : themes.filter(theme => theme !== "matematica");
    if (bankThemes.length) {
      const themeMarks = bankThemes.map(() => "?").join(",");
      let diffClause = "";
      if (config.difficulty !== "misto") diffClause = "AND q.difficulty=?";
      const rows = database.prepare(`SELECT q.* FROM quiz_questions q
        LEFT JOIN quiz_question_usage u ON u.tenant_id=? AND u.room_code=? AND u.question_id=q.id
        WHERE q.status='active' AND q.theme IN (${themeMarks}) AND q.mode='alternativas' ${diffClause}
          AND (q.scope='global' OR (q.scope='streamer' AND q.owner_user_id=?))
          AND (?='all' OR (?='global' AND q.scope='global') OR (?='streamer' AND q.scope='streamer'))
          AND (u.last_used_at IS NULL OR u.last_used_at < ?)
        ORDER BY q.id`).all(tenantId, roomCode, ...bankThemes,
          ...(config.difficulty !== "misto" ? [config.difficulty] : []), tenantId,
          source,source,source,now() - 30 * 86400000);
      const eligible = shuffle(rows);
      const needed = Math.max(0, config.question_count - selected.length);
      for (const row of eligible.slice(0, needed)) selected.push({ question_id: row.id, theme: row.theme, subtheme: row.subtheme,
        difficulty: row.difficulty, mode: row.mode, prompt: row.prompt, options: parseJson(row.options, {}), answer: row.answer,
        answer_value: row.mode === "calculo" ? row.answer : "", explanation: row.explanation, tolerance: row.tolerance, origin: row.origin });
    }
    if (selected.length < config.question_count && themes.includes("matematica") && source !== "streamer") {
      while (selected.length < config.question_count) {
        const i = selected.length;
        const difficulty = config.difficulty === "misto" ? ["facil", "medio", "dificil"][i % 3] : config.difficulty;
        selected.push(math.generateQuestion({ seed: `${crypto.randomUUID()}:${i}:extra`, difficulty, contents: config.math_contents, mode: config.response_mode }));
      }
    }
    if (selected.length < config.question_count) {
      const error = new Error("Há poucas perguntas para esse tema e dificuldade. Adicione perguntas ou amplie os filtros.");
      error.code = "INSUFFICIENT_QUESTIONS"; error.available = selected.length; error.requested = config.question_count; error.source = source; throw error;
    }
    return shuffle(selected).slice(0, config.question_count);
  }
  function startMatch(tenantId, roomCode, liveRoomId = "", traceId = null) {
    const existing = currentMatch(tenantId);
    if (existing) { const error = new Error("Já existe uma partida do Quiz em andamento."); error.code = "MATCH_ALREADY_ACTIVE"; throw error; }
    const config = configFor(tenantId);
    const questions = pickQuestions(tenantId, roomCode, config);
    const matchId = crypto.randomUUID(), started = now();
    const persist = database.transaction(() => {
      database.prepare(`INSERT INTO quiz_matches(id,tenant_id,room_code,live_room_id,state,config,question_count,current_question_no,started_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(matchId, tenantId, roomCode, liveRoomId, "preparing", JSON.stringify(config), questions.length, 0, started, started);
      const insertRound = database.prepare(`INSERT INTO quiz_rounds(match_id,question_no,question_id,theme,subtheme,difficulty,mode,prompt,options,answer,answer_value,explanation,tolerance,state)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'waiting')`);
      for (const [index, question] of questions.entries()) {
        insertRound.run(matchId,index+1,question.question_id || null,question.theme,question.subtheme || "",question.difficulty,question.mode,question.prompt,
          JSON.stringify(question.options || {}),String(question.answer),String(question.answer_value || ""),String(question.explanation || ""),Number(question.tolerance)||0);
      }
      database.prepare("UPDATE quiz_matches SET state='interval',updated_at=? WHERE id=?").run(now(),matchId);
    });
    persist();
    const match = matchById(matchId, tenantId);
    log(tenantId, "quiz.match.started", { game_id: matchId, trace_id: traceId, message: "Partida do Quiz iniciada.", details: { themes: config.themes.length ? config.themes : ["misto"], difficulty: config.difficulty, question_source:config.question_source, question_count: questions.length } });
    openQuestion(tenantId, matchId, 1);
    return statePayload(tenantId, false);
  }
  function normalizeResponse(round, raw) {
    const text = String(raw || "").trim().replace(/^[\s!?.,;:]+|[\s!?.,;:]+$/g, "");
    if (round.mode === "alternativas") {
      const key = text.toUpperCase().replace(/\)$/g, "");
      return /^[ABCD]$/.test(key) ? key : null;
    }
    const value = normalizeNumeric(text);
    return value == null ? null : String(value);
  }
  function isCorrect(round, answer) {
    if (answer == null) return false;
    if (round.mode === "alternativas") return answer === round.answer;
    const actual = Number(answer), expected = normalizeNumeric(round.answer_value || round.answer);
    return expected != null && Math.abs(actual - expected) <= Math.max(0, Number(round.tolerance) || 0);
  }
  function handleInteraction(tenant, interaction) {
    if (!interaction || interaction.type !== "comment") return false;
    const match = currentMatch(tenant.id);
    if (!match || match.state !== "question_active") return false;
    if (match.live_room_id && String(interaction.room_id || "") !== match.live_room_id) return false;
    const round = currentRound(match);
    if (!round || now() >= Number(round.deadline || 0)) { closeQuestion(tenant.id, match.id, { reveal: true, autoAdvance: true }); return false; }
    const userId = String(interaction.user_id || interaction.username || "").trim().slice(0, 160);
    if (!userId) return false;
    const answer = normalizeResponse(round, interaction.meta && interaction.meta.text);
    if (answer == null) return false;
    const receivedAt = now();
    try {
      const result = database.prepare(`INSERT INTO quiz_responses(match_id,question_no,user_id,event_id,username,nickname,avatar,answer,received_at,is_correct)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(match.id, round.question_no, userId, String(interaction.event_id || "").slice(0, 200),
        String(interaction.username || "").slice(0, 100), String(interaction.nickname || interaction.username || "").slice(0, 100),
        String(interaction.avatar || "").slice(0, 500), answer, receivedAt, isCorrect(round, answer) ? 1 : 0);
      if (!result.changes) return false;
      database.prepare(`INSERT INTO quiz_players(match_id,user_id,username,nickname,avatar) VALUES(?,?,?,?,?)
        ON CONFLICT(match_id,user_id) DO UPDATE SET username=excluded.username,nickname=excluded.nickname,avatar=excluded.avatar`)
        .run(match.id,userId,String(interaction.username || "").slice(0,100),String(interaction.nickname || interaction.username || "").slice(0,100),String(interaction.avatar || "").slice(0,500));
      queueState(tenant.id, match.room_code);
      return true;
    } catch (error) {
      if (/UNIQUE/.test(String(error && error.message))) return false;
      log(tenant.id, "quiz.persistence.failed", { level: "error", game_id: match.id, code: "ANSWER_SAVE_FAILED", message: "Não foi possível registrar uma resposta do Quiz.", details: { stage: "answer" } });
      return false;
    }
  }
  function queueState(tenantId, roomCode) {
    if (dirtyBroadcasts.has(tenantId)) return;
    dirtyBroadcasts.set(tenantId, setTimer(() => { dirtyBroadcasts.delete(tenantId); emitState(tenantId); }, 250));
  }
  function stateFor(tenantId) { return statePayload(tenantId, false); }
  function publicState(roomCode) {
    const user = getUserByRoomCode(roomCode);
    return user?.status === "active" ? statePayload(user.id, true, roomCode) : null;
  }
  function attachPublic(roomCode, ws) {
    const user = getUserByRoomCode(roomCode);
    if (!user || user.status !== "active") return false;
    const clients = publicClients.get(user.id) || [];
    clients.push(ws); publicClients.set(user.id, clients);
    ws.send(JSON.stringify(publicState(roomCode)));
    ws.once("close", () => {
      const index = clients.indexOf(ws); if (index >= 0) clients.splice(index,1);
      if (!clients.length) publicClients.delete(user.id);
    });
    return true;
  }
  function requestNext(tenantId, traceId = null) {
    const match = currentMatch(tenantId);
    if (!match || !["answers_closed","interval"].includes(match.state)) return false;
    cancelTimer(match.id);
    if (match.state === "interval") {
      database.prepare("UPDATE quiz_matches SET state='answers_closed' WHERE id=?").run(match.id);
    }
    return openNextQuestion(tenantId, match.id, traceId);
  }
  function pause(tenantId, traceId = null) {
    const match = currentMatch(tenantId);
    if (!match || match.state !== "question_active") return false;
    const round = currentRound(match), remaining = Math.max(0, Number(round.deadline) - now());
    const config = parseJson(match.config, DEFAULTS); config.remaining_ms = remaining;
    database.prepare("UPDATE quiz_matches SET state='paused',config=?,updated_at=? WHERE id=?").run(JSON.stringify(config),now(),match.id);
    cancelTimer(match.id);
    log(tenantId,"quiz.match.paused",{game_id:match.id,trace_id:traceId,message:"Partida do Quiz pausada.",details:{question_no:round.question_no}});
    emitState(tenantId); return true;
  }
  function resume(tenantId, traceId = null) {
    const match = currentMatch(tenantId);
    if (!match || match.state !== "paused") return false;
    const round = currentRound(match), config = parseJson(match.config, DEFAULTS);
    const remaining = Math.max(1000, Number(config.remaining_ms) || 1000), deadline = now() + remaining;
    delete config.remaining_ms;
    database.prepare("UPDATE quiz_matches SET state='question_active',config=?,updated_at=? WHERE id=?").run(JSON.stringify(config),now(),match.id);
    database.prepare("UPDATE quiz_rounds SET deadline=? WHERE match_id=? AND question_no=?").run(deadline,match.id,round.question_no);
    schedule(matchById(match.id,tenantId),deadline,()=>closeQuestion(tenantId,match.id,{reveal:true,autoAdvance:true}));
    log(tenantId,"quiz.match.resumed",{game_id:match.id,trace_id:traceId,message:"Partida do Quiz retomada.",details:{question_no:round.question_no,remaining_ms:remaining}});
    emitState(tenantId); return true;
  }
  function reveal(tenantId, traceId = null) {
    const match = currentMatch(tenantId);
    if (!match || match.state !== "question_active") return false;
    log(tenantId,"quiz.answer.revealed",{game_id:match.id,trace_id:traceId,message:"Gabarito revelado e respostas encerradas.",details:{question_no:match.current_question_no}});
    return closeQuestion(tenantId,match.id,{reveal:true,autoAdvance:false,traceId});
  }
  function stop(tenantId, traceId = null) {
    const match = currentMatch(tenantId);
    if (!match) return false;
    if (match.state === "question_active") closeQuestion(tenantId,match.id,{reveal:true,autoAdvance:false,traceId});
    const final = matchById(match.id,tenantId);
    if (!final) return false;
    const ended = now();
    database.prepare("UPDATE quiz_matches SET state='finished',ended_at=?,updated_at=? WHERE id=?").run(ended,ended,match.id);
    cancelTimer(match.id); finalizeWeekly(matchById(match.id,tenantId));
    log(tenantId,"quiz.match.finished",{game_id:match.id,trace_id:traceId,message:"Partida do Quiz encerrada pelo streamer.",details:{questions_completed:match.current_question_no,participants:playerRows(match.id).length}});
    emitState(tenantId); return true;
  }
  function listQuestions(tenantId, filters = {}) {
    const page = clampInt(filters.page,1,100000,1), size = clampInt(filters.page_size,1,100,25);
    const where = ["(scope='global' OR (scope='streamer' AND owner_user_id=?))"], params = [tenantId];
    if (themeIds(false).has(filters.theme)) { where.push("theme=?"); params.push(filters.theme); }
    if (["facil","medio","dificil"].includes(filters.difficulty)) { where.push("difficulty=?"); params.push(filters.difficulty); }
    if (["alternativas","calculo"].includes(filters.mode)) { where.push("mode=?"); params.push(filters.mode); }
    if (["global","streamer"].includes(filters.scope)) { where.push("scope=?"); params.push(filters.scope); }
    if (["active","inactive"].includes(filters.status)) { where.push("status=?"); params.push(filters.status); }
    if (typeof filters.search === "string" && filters.search.trim()) { where.push("prompt LIKE ?"); params.push(`%${filters.search.trim().slice(0,80)}%`); }
    const clause = where.join(" AND ");
    const total = database.prepare(`SELECT COUNT(*) n FROM quiz_questions WHERE ${clause}`).get(...params).n;
    const rows = database.prepare(`SELECT q.id,q.tenant_id,q.theme,q.subtheme,q.difficulty,q.mode,q.prompt,q.options,q.answer,q.explanation,q.tolerance,q.recommended_time,q.status,q.origin,q.created_at,q.updated_at,
        q.scope,q.owner_user_id,
        (SELECT COUNT(*) FROM quiz_question_usage_history h WHERE h.question_id=q.id AND (q.scope='global' OR h.tenant_id=?)) AS usage_count,
        (SELECT MAX(used_at) FROM quiz_question_usage_history h WHERE h.question_id=q.id AND (q.scope='global' OR h.tenant_id=?)) AS last_used_at
      FROM quiz_questions q WHERE ${clause} ORDER BY CASE WHEN q.scope='global' THEN 0 ELSE 1 END,q.theme,q.difficulty,q.id LIMIT ? OFFSET ?`)
      .all(tenantId,tenantId,...params,size,(page-1)*size).map(row => ({...row, options:parseJson(row.options,{}),answer:row.scope==='global'?undefined:row.answer, explanation:row.scope==='global'?undefined:row.explanation, editable:row.scope==='streamer'&&row.owner_user_id===tenantId}));
    return {items:rows,total,page,page_size:size,pages:Math.ceil(total/size)};
  }
  function questionUsage(tenantId, questionId) {
    const question=database.prepare("SELECT id FROM quiz_questions WHERE id=? AND (scope='global' OR (scope='streamer' AND owner_user_id=?))").get(questionId,tenantId);
    if(!question)return null;
    const items=database.prepare(`SELECT question_no,used_at,match_id FROM quiz_question_usage_history
      WHERE tenant_id=? AND question_id=? ORDER BY used_at DESC,id DESC LIMIT 50`).all(tenantId,questionId);
    const total=database.prepare("SELECT COUNT(*) AS count FROM quiz_question_usage_history WHERE tenant_id=? AND question_id=?").get(tenantId,questionId).count;
    return {items,total};
  }
  function validateQuestion(input = {}) {
    const resolvedTheme = themeByInput(input.theme);
    const theme = resolvedTheme?.id || "";
    const difficulty = String(input.difficulty || "");
    const prompt = String(input.prompt || "").trim();
    const options = input.options && typeof input.options === "object" ? input.options : {};
    const answer = String(input.answer || "").trim().toUpperCase();
    if (!resolvedTheme) throw new Error("Escolha um tema global ativo.");
    if (!["facil","medio","dificil"].includes(difficulty)) throw new Error("Escolha uma dificuldade válida.");
    if (prompt.length < 8 || prompt.length > 500) throw new Error("A pergunta precisa ter entre 8 e 500 caracteres.");
    if (!["A","B","C","D"].includes(answer)) throw new Error("A resposta correta precisa ser A, B, C ou D.");
    const clean = {};
    for (const key of ["A","B","C","D"]) {
      const value = String(options[key] || "").trim();
      if (!value || value.length > 180) throw new Error("Preencha as quatro alternativas (até 180 caracteres cada).");
      clean[key] = value;
    }
    if (new Set(Object.values(clean).map(value => value.toLocaleLowerCase("pt-BR"))).size < 4) throw new Error("As alternativas precisam ser diferentes.");
    const explanation = String(input.explanation || "").trim().slice(0,500);
    const tolerance = Math.max(0,Math.min(1000000,Number(input.tolerance)||0));
    return {theme,difficulty,prompt,options:clean,answer,explanation,tolerance,recommended_time:clampInt(input.recommended_time,10,60,20)};
  }
  function saveQuestion(tenantId, input, id = null) {
    const question = validateQuestion(input), timestamp = now();
    const duplicate=database.prepare("SELECT id FROM quiz_questions WHERE scope='streamer' AND owner_user_id=? AND lower(prompt)=lower(?) AND id<>COALESCE(?,0) LIMIT 1").get(tenantId,question.prompt,id);
    if(duplicate)throw new Error(`Possível duplicação da sua pergunta #${duplicate.id}.`);
    if (id) {
      const result = database.prepare(`UPDATE quiz_questions SET theme=?,difficulty=?,prompt=?,options=?,answer=?,explanation=?,tolerance=?,recommended_time=?,status=?,updated_at=?
        WHERE id=? AND scope='streamer' AND owner_user_id=?`).run(question.theme,question.difficulty,question.prompt,JSON.stringify(question.options),question.answer,
        question.explanation,question.tolerance,question.recommended_time,input.status==="inactive"?"inactive":"active",timestamp,id,tenantId);
      if (!result.changes) throw new Error("Pergunta não encontrada ou sem permissão para edição.");
      return id;
    }
    const result = database.prepare(`INSERT INTO quiz_questions(tenant_id,scope,owner_user_id,theme,difficulty,prompt,options,answer,explanation,tolerance,recommended_time,status,origin,created_at,updated_at)
      VALUES(?,'streamer',?,?,?,?,?,?,?,?,?,?,'manual',?,?)`).run(tenantId,tenantId,question.theme,question.difficulty,question.prompt,JSON.stringify(question.options),question.answer,
      question.explanation,question.tolerance,question.recommended_time,input.status==="inactive"?"inactive":"active",timestamp,timestamp);
    return result.lastInsertRowid;
  }
  function parseImportQuestions(text, target) {
    const lines = String(text || "").split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if (!lines.length || lines.length > 2000) throw new Error("Cole entre 1 e 2.000 perguntas.");
    const global = target === "global";
    const existing = new Set(database.prepare("SELECT prompt FROM quiz_questions WHERE scope=? AND (scope='global' OR owner_user_id=?)").all(global?"global":"streamer",global?0:target).map(row=>normalizePrompt(row.prompt)));
    const seen = new Set();
    return lines.map((line,index)=>{
      const cells=line.split("|").map(value=>value.trim());
      if(cells.length!==9)return {line:index+1,status:"invalid",message:`Esperados 9 campos; recebidos ${cells.length}.`};
      try{
        const [theme,difficulty,prompt,a,b,c,d,answer,explanation]=cells;
        const resolvedTheme=themeByInput(theme);
        if(!resolvedTheme)throw new Error("Tema global não encontrado ou inativo.");
        const question=validateQuestion({theme:resolvedTheme.id,difficulty,prompt,options:{A:a,B:b,C:c,D:d},answer,explanation});
        const normalized=normalizePrompt(question.prompt);
        if(existing.has(normalized)||seen.has(normalized))return {line:index+1,status:"duplicate",message:seen.has(normalized)?"Pergunta repetida nesta importação.":"Pergunta já existe neste banco."};
        seen.add(normalized);
        return {line:index+1,status:"valid",message:"Pronta para adicionar.",question};
      }catch(error){return {line:index+1,status:"invalid",message:error.message||"Linha inválida."};}
    });
  }
  function importQuestions(target, text, acceptedLines = []) {
    const preview=parseImportQuestions(text,target), accepted=new Set(acceptedLines.map(Number));
    if(!accepted.size) return {preview,valid_count:preview.filter(row=>row.status==="valid").length,duplicate_count:preview.filter(row=>row.status==="duplicate").length,invalid_count:preview.filter(row=>row.status==="invalid").length};
    const created=[];
    const global=target==="global", ownerId=global?null:Number(target);
    const transaction=database.transaction(()=>{
      for(const row of preview){
        if(row.status!=="valid"||!accepted.has(row.line))continue;
        const question=row.question,timestamp=now();
        const dup=database.prepare("SELECT id FROM quiz_questions WHERE scope=? AND (scope='global' OR owner_user_id=?) AND prompt=? COLLATE NOCASE LIMIT 1").get(global?"global":"streamer",global?0:ownerId,question.prompt);
        if(dup)continue;
        if(global){
          const result=database.prepare(`INSERT INTO quiz_questions(tenant_id,scope,owner_user_id,theme,difficulty,mode,prompt,options,answer,explanation,tolerance,recommended_time,status,origin,created_at,updated_at)
            VALUES(NULL,'global',NULL,?,?,'alternativas',?,?,?,?,?,?,'active','admin_import',?,?)`).run(question.theme,question.difficulty,question.prompt,JSON.stringify(question.options),question.answer,question.explanation,question.tolerance,question.recommended_time,timestamp,timestamp);
          created.push(Number(result.lastInsertRowid));
        }else created.push(Number(saveQuestion(ownerId,question)));
      }
    });
    transaction();
    return {created:created.length,duplicate_count:preview.filter(row=>row.status==="duplicate").length,invalid_count:preview.filter(row=>row.status==="invalid").length,
      skipped_count:preview.filter(row=>row.status==="valid"&&!accepted.has(row.line)).length,added_ids:created};
  }
  function globalQuestionStats() {
    const total=database.prepare("SELECT COUNT(*) AS count FROM quiz_questions WHERE scope='global'").get().count;
    const active=database.prepare("SELECT COUNT(*) AS count FROM quiz_questions WHERE scope='global' AND status='active'").get().count;
    const themes=database.prepare(`SELECT q.theme,COALESCE(t.label,q.theme) label,COUNT(*) count FROM quiz_questions q LEFT JOIN quiz_themes t ON t.id=q.theme
      WHERE q.scope='global' GROUP BY q.theme ORDER BY label COLLATE NOCASE`).all();
    const difficulties=database.prepare("SELECT difficulty,COUNT(*) count FROM quiz_questions WHERE scope='global' GROUP BY difficulty ORDER BY difficulty").all();
    return {total:Number(total),active:Number(active),themes,difficulties,theme_catalog:listThemes()};
  }
  function listGlobalQuestions(filters={}) {
    const page=clampInt(filters.page,1,100000,1),size=clampInt(filters.page_size,1,100,25),where=["scope='global'"],params=[];
    if(themeIds(false).has(filters.theme)){where.push("theme=?");params.push(filters.theme);}
    if(["facil","medio","dificil"].includes(filters.difficulty)){where.push("difficulty=?");params.push(filters.difficulty);}
    if(["alternativas","calculo"].includes(filters.mode)){where.push("mode=?");params.push(filters.mode);}
    if(["active","inactive"].includes(filters.status)){where.push("status=?");params.push(filters.status);}
    if(typeof filters.search==="string"&&filters.search.trim()){where.push("prompt LIKE ?");params.push(`%${filters.search.trim().slice(0,80)}%`);}
    const clause=where.join(" AND "),total=Number(database.prepare(`SELECT COUNT(*) count FROM quiz_questions WHERE ${clause}`).get(...params).count);
    const items=database.prepare(`SELECT q.*,(SELECT COUNT(*) FROM quiz_question_usage_history h WHERE h.question_id=q.id) usage_count,
      (SELECT MAX(used_at) FROM quiz_question_usage_history h WHERE h.question_id=q.id) last_used_at
      FROM quiz_questions q WHERE ${clause} ORDER BY q.theme,q.difficulty,q.id LIMIT ? OFFSET ?`)
      .all(...params,size,(page-1)*size).map(row=>({...row,options:parseJson(row.options,{})}));
    return {items,total,page,page_size:size,pages:Math.ceil(total/size),stats:globalQuestionStats()};
  }
  function saveGlobalQuestion(input,id=null) {
    const question=validateQuestion(input),timestamp=now();
    const duplicate=database.prepare("SELECT id,prompt FROM quiz_questions WHERE scope='global' AND id<>COALESCE(?,0)").all(id)
      .find(row=>normalizePrompt(row.prompt)===normalizePrompt(question.prompt));
    if(duplicate)throw new Error(`Possível duplicação da pergunta global #${duplicate.id}.`);
    if(id){
      const result=database.prepare(`UPDATE quiz_questions SET theme=?,difficulty=?,mode='alternativas',prompt=?,options=?,answer=?,explanation=?,tolerance=?,recommended_time=?,status=?,origin='admin',updated_at=?
        WHERE id=? AND scope='global' AND tenant_id IS NULL`).run(question.theme,question.difficulty,question.prompt,JSON.stringify(question.options),question.answer,question.explanation,
        question.tolerance,question.recommended_time,input.status==="inactive"?"inactive":"active",timestamp,id);
      if(!result.changes)throw new Error("Pergunta global não encontrada.");
      return Number(id);
    }
    const result=database.prepare(`INSERT INTO quiz_questions(tenant_id,scope,owner_user_id,theme,difficulty,mode,prompt,options,answer,explanation,tolerance,recommended_time,status,origin,created_at,updated_at)
      VALUES(NULL,'global',NULL,?,?,'alternativas',?,?,?,?,?,?,'active','admin',?,?)`).run(question.theme,question.difficulty,question.prompt,JSON.stringify(question.options),question.answer,
      question.explanation,question.tolerance,question.recommended_time,timestamp,timestamp);
    return Number(result.lastInsertRowid);
  }
  function saveTheme(input={},id=null) {
    const label=String(input.label||"").trim().replace(/\s+/g," ");
    if(label.length<3||label.length>80)throw new Error("O tema precisa ter entre 3 e 80 caracteres.");
    const normalized=normalizeLabel(label),duplicate=database.prepare("SELECT id FROM quiz_themes WHERE normalized_label=? AND id<>COALESCE(?, '')").get(normalized,id);
    if(duplicate)throw new Error("Já existe um tema equivalente, desconsiderando acentos e maiúsculas.");
    const timestamp=now();
    if(id){
      const result=database.prepare("UPDATE quiz_themes SET label=?,normalized_label=?,status=?,updated_at=? WHERE id=?")
        .run(label,normalized,input.status==="inactive"?"inactive":"active",timestamp,id);
      if(!result.changes)throw new Error("Tema não encontrado.");
      return id;
    }
    let slug=normalizeLabel(label).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"tema";
    if(slug==="matematica")throw new Error("Matemática é um tema reservado do gerador integrado.");
    const base=slug;let suffix=2;while(database.prepare("SELECT 1 FROM quiz_themes WHERE id=?").get(slug))slug=`${base}-${suffix++}`;
    database.prepare("INSERT INTO quiz_themes(id,label,normalized_label,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(slug,label,normalized,timestamp,timestamp);
    return slug;
  }
  function history(tenantId, page = 1, pageSize = 10) {
    const size = clampInt(pageSize,1,50,10), currentPage = clampInt(page,1,100000,1);
    const total = database.prepare("SELECT COUNT(*) n FROM quiz_matches WHERE tenant_id=? AND state='finished'").get(tenantId).n;
    const items = database.prepare("SELECT * FROM quiz_matches WHERE tenant_id=? AND state='finished' ORDER BY ended_at DESC LIMIT ? OFFSET ?")
      .all(tenantId,size,(currentPage-1)*size).map(match => {
        const config = parseJson(match.config,DEFAULTS), ranking = playerRows(match.id);
        const themes = database.prepare("SELECT theme,COUNT(*) count FROM quiz_rounds WHERE match_id=? GROUP BY theme ORDER BY theme").all(match.id);
        return {id:match.id,started_at:match.started_at,ended_at:match.ended_at,duration_ms:Math.max(0,match.ended_at-match.started_at),
          question_count:match.question_count,participants:ranking.length,winner:ranking[0]||null,top_ranking:ranking.slice(0,3),themes,difficulty:config.difficulty};
      });
    return {items,total,page:currentPage,page_size:size,pages:Math.ceil(total/size)};
  }
  function historyDetail(tenantId, matchId) {
    const match = matchById(matchId,tenantId);
    if (!match || match.state !== "finished") return null;
    const rounds = database.prepare("SELECT question_no,theme,subtheme,difficulty,mode,prompt,options,answer,answer_value,explanation,opened_at,deadline,closed_at FROM quiz_rounds WHERE match_id=? ORDER BY question_no").all(match.id)
      .map(round=>({...round,options:parseJson(round.options,{}),responses:database.prepare("SELECT nickname,username,answer,is_correct,points,speed_bonus,streak_bonus,received_at FROM quiz_responses WHERE match_id=? AND question_no=? ORDER BY received_at,id").all(match.id,round.question_no)}));
    return {match:{id:match.id,started_at:match.started_at,ended_at:match.ended_at,state:match.state,question_count:match.question_count,config:parseJson(match.config,DEFAULTS)},ranking:playerRows(match.id),rounds};
  }
  function recoverTimers() {
    const preparing = database.prepare("SELECT * FROM quiz_matches WHERE state='preparing'").all();
    for (const match of preparing) {
      const round=currentRound(match);
      if(!round)continue;
      if(Number(round.opens_at||0)<=now())openQuestion(match.tenant_id,match.id,round.question_no,true);
      else schedule(match,round.opens_at,()=>openQuestion(match.tenant_id,match.id,round.question_no,true));
    }
    const active = database.prepare("SELECT * FROM quiz_matches WHERE state='question_active'").all();
    for (const match of active) {
      const round = currentRound(match);
      if (!round) continue;
      if (Number(round.deadline) <= now()) {
        log(match.tenant_id,"quiz.timer.recovered",{level:"info",game_id:match.id,message:"Tempo de pergunta recuperado após reinício; período encerrado.",details:{question_no:round.question_no,remaining_ms:0}});
        closeQuestion(match.tenant_id,match.id,{reveal:true,autoAdvance:true});
      } else schedule(match,round.deadline,()=>closeQuestion(match.tenant_id,match.id,{reveal:true,autoAdvance:true}));
    }
    const intervals = database.prepare("SELECT * FROM quiz_matches WHERE state='interval'").all();
    for (const match of intervals) {
      const config = parseJson(match.config,DEFAULTS), round = currentRound(match), deadline = (round?.closed_at || match.updated_at) + config.pause_seconds * 1000;
      schedule(match,deadline,()=>openNextQuestion(match.tenant_id,match.id));
    }
  }

  function registerRoutes(expressApp, { auth, requireFeature: featureMiddleware = (_req,_res,next)=>next() } = {}) {
    const guard = [auth.requireAuth, featureMiddleware("quiz")];
    expressApp.get("/api/quiz-live/config", ...guard, (req,res)=>res.json({success:true,config:configFor(req.user.id),themes:listThemes(true),math_contents:math.CONTENTS}));
    expressApp.put("/api/quiz-live/config", ...guard, (req,res)=>{
      const traceId=crypto.randomUUID();
      try { const config=saveConfig(req.user.id,req.body||{}); log(req.user.id,"quiz.config.saved",{trace_id:traceId,message:"Configurações do Quiz salvas.",details:{themes:config.themes.length,difficulty:config.difficulty,question_source:config.question_source,question_count:config.question_count}}); res.json({success:true,config,trace_id:traceId}); }
      catch { log(req.user.id,"quiz.config.failed",{level:"error",trace_id:traceId,code:"CONFIG_SAVE_FAILED",message:"Não foi possível salvar as configurações do Quiz."}); res.status(500).json({success:false,error:"Não foi possível salvar as configurações."}); }
    });
    expressApp.post("/api/quiz-live/availability", ...guard, (req,res)=>{
      try {
        const current=configFor(req.user.id),config=normalizeConfig({...current,...(req.body||{})},current,themeIds());
        const user=database.prepare("SELECT room_code FROM users WHERE id=?").get(req.user.id);
        const questions=pickQuestions(req.user.id,user?.room_code||"",config);
        res.json({success:true,sufficient:true,available:questions.length,requested:config.question_count,source:config.question_source});
      } catch(error) {
        if(error.code==="INSUFFICIENT_QUESTIONS")return res.json({success:true,sufficient:false,available:Number(error.available)||0,requested:Number(error.requested)||0,source:error.source||"all",message:error.message});
        res.status(400).json({success:false,error:error.message||"Não foi possível validar o banco selecionado."});
      }
    });
    expressApp.get("/api/quiz-live/state", ...guard, (req,res)=>res.json({success:true,...stateFor(req.user.id)}));
    expressApp.post("/api/quiz-live/start", ...guard, (req,res)=>{
      const user=getUserByRoomCode && database.prepare("SELECT room_code FROM users WHERE id=?").get(req.user.id);
      const roomCode=user?.room_code;
      const tenant=getTenant(req.user.id), traceId=crypto.randomUUID();
      log(req.user.id,"quiz.match.start.requested",{trace_id:traceId,message:"Solicitação para iniciar uma partida do Quiz.",details:{}});
      if (!tenant?.currentStatus || tenant.currentStatus.state!=="connected") {
        log(req.user.id,"quiz.match.start.rejected",{level:"warning",trace_id:traceId,code:"LIVE_DISCONNECTED",message:"A partida não iniciou porque a live não está conectada."});
        return res.status(409).json({success:false,error:"Conecte a TikTok Live antes de iniciar a partida.",code:"LIVE_DISCONNECTED"});
      }
      try { const state=startMatch(req.user.id,roomCode,tenant.currentRoomId||"",traceId); res.json({success:true,state,trace_id:traceId}); }
      catch(error) {
        const expected=["INSUFFICIENT_QUESTIONS","MATCH_ALREADY_ACTIVE","CALCULATION_MATH_ONLY"].includes(error.code);
        const code=error.code||(expected?"START_INVALID":"START_FAILED"), status=error.code==="INSUFFICIENT_QUESTIONS"?409:expected?400:500;
        log(req.user.id,expected?"quiz.match.start.rejected":"quiz.match.start.failed",{level:expected?"warning":"error",trace_id:traceId,code,
          message:expected?error.message:"Não foi possível iniciar a partida do Quiz.",details:expected?{available:error.available,requested:error.requested}:{stage:"start_match",error_type:error.name||"Error"}});
        res.status(status).json({success:false,error:expected?error.message:"Não foi possível iniciar a partida. Tente novamente.",code,...(expected?{available:error.available,requested:error.requested}:{})});
      }
    });
    expressApp.post("/api/quiz-live/:action", ...guard, (req,res)=>{
      const traceId=crypto.randomUUID(), actions={pause:()=>pause(req.user.id,traceId),resume:()=>resume(req.user.id,traceId),next:()=>requestNext(req.user.id,traceId),reveal:()=>reveal(req.user.id,traceId),stop:()=>stop(req.user.id,traceId)};
      const action=actions[req.params.action];
      if (!action) return res.status(404).json({success:false,error:"Ação do Quiz não encontrada."});
      const changed=action();
      if (!changed) {
        log(req.user.id,"quiz.action.rejected",{level:"warning",trace_id:traceId,code:"INVALID_GAME_STATE",message:"A ação do Quiz foi rejeitada pelo estado atual da partida.",details:{action:req.params.action}});
        return res.status(409).json({success:false,error:"A partida não está no estado necessário para essa ação.",code:"INVALID_GAME_STATE"});
      }
      res.json({success:true,state:stateFor(req.user.id),trace_id:traceId});
    });
    expressApp.get("/api/quiz-live/questions", ...guard, (req,res)=>res.json({success:true,...listQuestions(req.user.id,req.query)}));
    expressApp.get("/api/quiz-live/questions/:id/usage", ...guard, (req,res)=>{
      const usage=questionUsage(req.user.id,clampInt(req.params.id,1,Number.MAX_SAFE_INTEGER,0));
      return usage?res.json({success:true,...usage}):res.status(404).json({success:false,error:"Pergunta não encontrada."});
    });
    expressApp.post("/api/quiz-live/questions", ...guard, (req,res)=>{
      const traceId=crypto.randomUUID();
      try { const id=saveQuestion(req.user.id,req.body||{}); log(req.user.id,"quiz.question.saved",{trace_id:traceId,message:"Pergunta adicionada ao banco do Quiz.",details:{question_id:id,theme:req.body.theme,difficulty:req.body.difficulty}}); res.json({success:true,id,trace_id:traceId}); }
      catch(error) { log(req.user.id,"quiz.question.rejected",{level:"warning",trace_id:traceId,code:"QUESTION_INVALID",message:"Pergunta rejeitada por validação.",details:{}}); res.status(400).json({success:false,error:error.message}); }
    });
    expressApp.put("/api/quiz-live/questions/:id", ...guard, (req,res)=>{
      try { saveQuestion(req.user.id,req.body||{},clampInt(req.params.id,1,Number.MAX_SAFE_INTEGER,0)); res.json({success:true}); }
      catch(error) { res.status(400).json({success:false,error:error.message}); }
    });
    expressApp.delete("/api/quiz-live/questions/:id", ...guard, (req,res)=>{
      const result=database.prepare("UPDATE quiz_questions SET status='inactive',updated_at=? WHERE id=? AND scope='streamer' AND owner_user_id=?").run(now(),clampInt(req.params.id,1,Number.MAX_SAFE_INTEGER,0),req.user.id);
      if (!result.changes) return res.status(404).json({success:false,error:"Pergunta não encontrada ou pertence ao catálogo compartilhado."});
      res.json({success:true});
    });
    expressApp.post("/api/quiz-live/questions/import/preview", ...guard, (req,res)=>{
      try { const result=importQuestions(req.user.id,req.body?.text); log(req.user.id,"quiz.question.import.previewed",{trace_id:crypto.randomUUID(),message:"Prévia de importação do banco particular gerada.",details:{valid:result.valid_count,duplicates:result.duplicate_count,invalid:result.invalid_count}}); res.json({success:true,...result}); }
      catch(error) { res.status(400).json({success:false,error:error.message}); }
    });
    expressApp.post("/api/quiz-live/questions/import", ...guard, (req,res)=>{
      if(!Array.isArray(req.body?.accept_lines))return res.status(400).json({success:false,error:"Confira a prévia e selecione as linhas que deseja adicionar."});
      try { const result=importQuestions(req.user.id,req.body?.text,req.body.accept_lines); log(req.user.id,"quiz.question.imported",{trace_id:crypto.randomUUID(),message:"Importação do banco particular concluída.",details:{created:result.created,duplicates:result.duplicate_count,invalid:result.invalid_count,skipped:result.skipped_count}}); res.json({success:true,...result}); }
      catch(error) { res.status(400).json({success:false,error:error.message}); }
    });
    expressApp.get("/api/admin/quiz-live/questions", auth.requireAdmin, (req,res)=>res.json({success:true,...listGlobalQuestions(req.query)}));
    expressApp.post("/api/admin/quiz-live/questions/import/preview", auth.requireAdmin, (req,res)=>{
      try{const result=importQuestions("global",req.body?.text);res.json({success:true,...result});}
      catch(error){res.status(400).json({success:false,error:error.message});}
    });
    expressApp.post("/api/admin/quiz-live/questions/import", auth.requireAdmin, (req,res)=>{
      if(!Array.isArray(req.body?.accept_lines))return res.status(400).json({success:false,error:"Revise a prévia e selecione as perguntas que deseja adicionar."});
      try{const result=importQuestions("global",req.body?.text,req.body.accept_lines);audit("quiz.catalog.questions.imported",req.user.id,{created:result.created,duplicates:result.duplicate_count,invalid:result.invalid_count,skipped:result.skipped_count});res.json({success:true,...result});}
      catch(error){res.status(400).json({success:false,error:error.message});}
    });
    expressApp.post("/api/admin/quiz-live/questions", auth.requireAdmin, (req,res)=>{
      try{const id=saveGlobalQuestion(req.body||{});audit("quiz.catalog.question.saved",req.user.id,{question_id:id,theme:req.body?.theme});res.status(201).json({success:true,id});}
      catch(error){res.status(/duplic/i.test(error.message)?409:400).json({success:false,error:error.message});}
    });
    expressApp.put("/api/admin/quiz-live/questions/:id", auth.requireAdmin, (req,res)=>{
      try{const id=saveGlobalQuestion(req.body||{},clampInt(req.params.id,1,Number.MAX_SAFE_INTEGER,0));audit("quiz.catalog.question.saved",req.user.id,{question_id:id,theme:req.body?.theme});res.json({success:true,id});}
      catch(error){res.status(/duplic/i.test(error.message)?409:400).json({success:false,error:error.message});}
    });
    expressApp.delete("/api/admin/quiz-live/questions/:id", auth.requireAdmin, (req,res)=>{
      const id=clampInt(req.params.id,1,Number.MAX_SAFE_INTEGER,0),result=database.prepare("UPDATE quiz_questions SET status='inactive',updated_at=? WHERE id=? AND scope='global' AND tenant_id IS NULL").run(now(),id);
      if(!result.changes)return res.status(404).json({success:false,error:"Pergunta global não encontrada."});
      audit("quiz.catalog.question.disabled",req.user.id,{question_id:id});res.json({success:true});
    });
    expressApp.get("/api/admin/quiz-live/themes", auth.requireAdmin, (_req,res)=>res.json({success:true,themes:listThemes(),stats:globalQuestionStats()}));
    expressApp.post("/api/admin/quiz-live/themes", auth.requireAdmin, (req,res)=>{
      try{const id=saveTheme(req.body||{});audit("quiz.catalog.theme.saved",req.user.id,{theme_id:id});res.status(201).json({success:true,id,themes:listThemes()});}
      catch(error){res.status(409).json({success:false,error:error.message});}
    });
    expressApp.put("/api/admin/quiz-live/themes/:id", auth.requireAdmin, (req,res)=>{
      try{const id=saveTheme(req.body||{},String(req.params.id||""));audit(req.body?.status==="inactive"?"quiz.catalog.theme.disabled":"quiz.catalog.theme.saved",req.user.id,{theme_id:id});res.json({success:true,id,themes:listThemes()});}
      catch(error){res.status(400).json({success:false,error:error.message});}
    });
    expressApp.get("/api/quiz-live/weekly", ...guard, (req,res)=>res.json({success:true,week_start:weekStart(now()),ranking:weeklyRanking(req.user.id,100)}));
    expressApp.get("/api/quiz-live/history", ...guard, (req,res)=>res.json({success:true,...history(req.user.id,req.query.page,req.query.page_size)}));
    expressApp.get("/api/quiz-live/history/:id", ...guard, (req,res)=>{
      const detail=historyDetail(req.user.id,req.params.id);
      return detail?res.json({success:true,...detail}):res.status(404).json({success:false,error:"Partida não encontrada."});
    });
    expressApp.get("/api/quiz-live/public/:room", (req,res)=>{
      const state=publicState(String(req.params.room||""));
      return state?res.json(state):res.status(404).json({success:false,error:"Sala não encontrada."});
    });
  }
  function roomForPublicCode(roomCode) { return getUserByRoomCode(String(roomCode||"")); }
  return { registerRoutes, handleInteraction, stateFor, publicState, attachPublic, roomForPublicCode, recoverTimers, narrationReady, narrationFailed, narrationFinished, themes:listThemes(true), defaults:DEFAULTS,
    _test: { configFor, saveConfig, startMatch, pickQuestions, closeQuestion, openQuestion, requestNext, pause, resume, reveal, stop, listQuestions, listGlobalQuestions, globalQuestionStats, questionUsage, saveQuestion, saveGlobalQuestion, saveTheme, listThemes, parseImportQuestions, importQuestions, historyDetail, finalizeWeekly, narrationReady, narrationFailed, narrationFinished, ensureSchema, timers } };
}

module.exports = { createQuizService, ensureSchema, normalizeConfig, normalizeNumeric, THEMES, DEFAULTS };
