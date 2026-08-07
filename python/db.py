import sqlite3
import os
import json
import time

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "node", "data.db")


def _conn():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db():
    conn = _conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS players (
      username TEXT PRIMARY KEY,
      nickname TEXT,
      avatar TEXT,
      total_guesses INTEGER DEFAULT 0,
      total_wins INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS games (
      game_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      secret_word TEXT,
      winner TEXT,
      winner_nickname TEXT,
      winner_avatar TEXT,
      total_guesses INTEGER,
      played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      room_id TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS tenant_history (
      tenant_id INTEGER PRIMARY KEY,
      last_id INTEGER DEFAULT 0,
      played_words TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id INTEGER PRIMARY KEY,
      apenas_seguidores INTEGER DEFAULT 0,
      apenas_heart_me INTEGER DEFAULT 0,
      pct_dica INTEGER DEFAULT 70,
      pct_charada INTEGER DEFAULT 30,
      tts_rate REAL DEFAULT 1.0,
      tts_voice TEXT DEFAULT '',
      chat_narr_enabled INTEGER DEFAULT 0,
      chat_narr_mode TEXT DEFAULT 'all',
      chat_narr_char TEXT DEFAULT '#',
      command_prefix TEXT DEFAULT '#'
    );
    CREATE TABLE IF NOT EXISTS tenant_gift_config (
      tenant_id INTEGER PRIMARY KEY,
      hint_gifts TEXT DEFAULT '[]',
      riddle_gifts TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS contextos (
      alvo TEXT PRIMARY KEY,
      gerado_em TEXT,
      ranking TEXT
    );
    CREATE TABLE IF NOT EXISTS batalha_players (
      tenant_id INTEGER,
      username TEXT,
      nickname TEXT,
      avatar TEXT,
      tap_wins INTEGER DEFAULT 0,
      coin_wins INTEGER DEFAULT 0,
      total_taps INTEGER DEFAULT 0,
      total_coins INTEGER DEFAULT 0,
      PRIMARY KEY (tenant_id, username)
    );
    CREATE TABLE IF NOT EXISTS batalha_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      room_id TEXT DEFAULT '',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      duration_s INTEGER,
      winner_tap_user TEXT,
      winner_tap_nickname TEXT,
      winner_tap_avatar TEXT,
      winner_coin_user TEXT,
      winner_coin_nickname TEXT,
      winner_coin_avatar TEXT,
      total_taps INTEGER DEFAULT 0,
      total_coins INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS batalha_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER,
      tenant_id INTEGER,
      room_id TEXT DEFAULT '',
      username TEXT,
      nickname TEXT,
      avatar TEXT,
      taps INTEGER DEFAULT 0,
      coins INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS vpet_state (
      tenant_id INTEGER PRIMARY KEY,
      state TEXT NOT NULL,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tres_acertos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username TEXT,
      nickname TEXT,
      avatar TEXT,
      pontos INTEGER DEFAULT 0,
      usou_multiplicador INTEGER DEFAULT 0,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    conn.commit()
    try:
        conn.execute("ALTER TABLE games ADD COLUMN room_id TEXT DEFAULT ''")
        conn.commit()
    except Exception:
        pass
    conn.close()


def record_guess(username, nickname, avatar):
    if not username:
        return
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO players (username, nickname, avatar, total_guesses)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(username) DO UPDATE SET
            nickname = excluded.nickname,
            avatar = excluded.avatar,
            total_guesses = total_guesses + 1
    """, (username, nickname, avatar))
    conn.commit()
    conn.close()


def get_user_by_username(username):
    if not username:
        return None
    conn = _conn()
    row = conn.execute("SELECT username, nickname, avatar FROM players WHERE username = ?", (username,)).fetchone()
    conn.close()
    if not row:
        return None
    return {"username": row[0], "nickname": row[1], "avatar": row[2]}


def record_game(secret_word, winner, nickname, avatar, total_guesses, tenant_id=None, room_id=""):
    """Registra TODA partida finalizada (incluindo fim manual com winner='Ninguém')."""
    conn = _conn()
    cur = conn.cursor()
    if winner and winner not in ("Ninguém", "Sem Vencedor"):
        cur.execute("""
            INSERT INTO players (username, nickname, avatar, total_wins)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(username) DO UPDATE SET
                nickname = excluded.nickname,
                avatar = excluded.avatar,
                total_wins = total_wins + 1
        """, (winner, nickname, avatar))
    cur.execute("""
        INSERT INTO games (tenant_id, secret_word, winner, winner_nickname, winner_avatar, total_guesses, room_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (tenant_id, secret_word, winner, nickname, avatar, total_guesses, room_id))
    conn.commit()
    conn.close()


def save_tenant_history(tenant_id, last_id, played_words):
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO tenant_history (tenant_id, last_id, played_words)
        VALUES (?, ?, ?)
        ON CONFLICT(tenant_id) DO UPDATE SET last_id = excluded.last_id, played_words = excluded.played_words
    """, (tenant_id, last_id, json.dumps(played_words, ensure_ascii=False)))
    conn.commit()
    conn.close()


def load_tenant_history(tenant_id):
    conn = _conn()
    row = conn.execute("SELECT last_id, played_words FROM tenant_history WHERE tenant_id = ?", (tenant_id,)).fetchone()
    conn.close()
    if not row:
        return {"last_id": 0, "played_words": []}
    try:
        pw = json.loads(row[1])
    except Exception:
        pw = []
    return {"last_id": row[0], "played_words": pw}


def save_contexto(alvo, gerado_em, ranking):
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO contextos (alvo, gerado_em, ranking)
        VALUES (?, ?, ?)
        ON CONFLICT(alvo) DO UPDATE SET gerado_em = excluded.gerado_em, ranking = excluded.ranking
    """, (alvo, gerado_em, json.dumps(ranking, ensure_ascii=False)))
    conn.commit()
    conn.close()


def list_contextos():
    conn = _conn()
    rows = conn.execute("SELECT alvo, gerado_em FROM contextos ORDER BY alvo").fetchall()
    conn.close()
    return [{"alvo": r[0], "gerado_em": r[1]} for r in rows]


# ---------------- BATALHA ----------------

def battle_save_round(tenant_id, started_at, ended_at, duration_s, winner_tap, winner_coin, interactions, room_id=""):
    """Grava a rodada + interacoes + atualiza players (totais e vitorias)."""
    conn = _conn()
    cur = conn.cursor()
    wt = winner_tap or {}
    wc = winner_coin or {}
    cur.execute("""
        INSERT INTO batalha_rounds (tenant_id, room_id, started_at, ended_at, duration_s,
            winner_tap_user, winner_tap_nickname, winner_tap_avatar,
            winner_coin_user, winner_coin_nickname, winner_coin_avatar,
            total_taps, total_coins)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        tenant_id, room_id, started_at, ended_at, duration_s,
        wt.get("user"), wt.get("nickname"), wt.get("avatar"),
        wc.get("user"), wc.get("nickname"), wc.get("avatar"),
        wt.get("taps", 0), wc.get("coins", 0),
    ))
    round_id = cur.lastrowid
    for u, d in interactions.items():
        cur.execute("""
            INSERT INTO batalha_interactions (round_id, tenant_id, room_id, username, nickname, avatar, taps, coins)
            VALUES (?,?,?,?,?,?,?,?)
        """, (round_id, tenant_id, room_id, u, d.get("nickname"), d.get("avatar"), d.get("taps", 0), d.get("coins", 0)))
        cur.execute("""
            INSERT INTO batalha_players (tenant_id, username, nickname, avatar, total_taps, total_coins)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(tenant_id, username) DO UPDATE SET
                nickname = excluded.nickname,
                avatar = excluded.avatar,
                total_taps = total_taps + excluded.total_taps,
                total_coins = total_coins + excluded.total_coins
        """, (tenant_id, u, d.get("nickname"), d.get("avatar"), d.get("taps", 0), d.get("coins", 0)))
    # vitorias
    if wt.get("user"):
        cur.execute("""
            INSERT INTO batalha_players (tenant_id, username, nickname, avatar, tap_wins)
            VALUES (?,?,?,?,1)
            ON CONFLICT(tenant_id, username) DO UPDATE SET
                nickname = excluded.nickname, avatar = excluded.avatar, tap_wins = tap_wins + 1
        """, (tenant_id, wt["user"], wt.get("nickname"), wt.get("avatar")))
    if wc.get("user"):
        cur.execute("""
            INSERT INTO batalha_players (tenant_id, username, nickname, avatar, coin_wins)
            VALUES (?,?,?,?,1)
            ON CONFLICT(tenant_id, username) DO UPDATE SET
                nickname = excluded.nickname, avatar = excluded.avatar, coin_wins = coin_wins + 1
        """, (tenant_id, wc["user"], wc.get("nickname"), wc.get("avatar")))
    conn.commit()
    conn.close()
    return round_id


def battle_load_players(tenant_id, limit=8):
    conn = _conn()
    rows = conn.execute(
        "SELECT username, nickname, avatar, tap_wins, coin_wins, total_taps, total_coins FROM batalha_players WHERE tenant_id = ?",
        (tenant_id,),
    ).fetchall()
    conn.close()
    def _fmt(r):
        return {"user": r[0], "nickname": r[1], "avatar": r[2], "tap_wins": r[3], "coin_wins": r[4], "taps": r[5], "coins": r[6]}
    data = [_fmt(r) for r in rows]
    taps = sorted([x for x in data if x["taps"] > 0], key=lambda x: -x["taps"])[:limit]
    coins = sorted([x for x in data if x["coins"] > 0], key=lambda x: -x["coins"])[:limit]
    return {"taps": taps, "coins": coins}


def battle_load_weekly_winners(tenant_id, limit=5):
    """Ranking semanal (segunda a domingo, hora local): vitorias + total acumulado por categoria."""
    from datetime import datetime, timedelta
    now = datetime.now()
    start = now - timedelta(days=now.weekday())
    start_iso = start.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    conn = _conn()
    tap_wins = {}
    for u, n, a, c in conn.execute(
        "SELECT winner_tap_user, winner_tap_nickname, winner_tap_avatar, COUNT(*) FROM batalha_rounds "
        "WHERE tenant_id=? AND started_at>=? AND winner_tap_user IS NOT NULL GROUP BY winner_tap_user",
        (tenant_id, start_iso),
    ):
        tap_wins[u] = {"nickname": n, "avatar": a, "wins": c}
    coin_wins = {}
    for u, n, a, c in conn.execute(
        "SELECT winner_coin_user, winner_coin_nickname, winner_coin_avatar, COUNT(*) FROM batalha_rounds "
        "WHERE tenant_id=? AND started_at>=? AND winner_coin_user IS NOT NULL GROUP BY winner_coin_user",
        (tenant_id, start_iso),
    ):
        coin_wins[u] = {"nickname": n, "avatar": a, "wins": c}
    totals = {}
    for u, n, a, taps, coins in conn.execute(
        "SELECT i.username, i.nickname, i.avatar, SUM(i.taps), SUM(i.coins) "
        "FROM batalha_interactions i JOIN batalha_rounds r ON r.id=i.round_id "
        "WHERE i.tenant_id=? AND r.started_at>=? GROUP BY i.username",
        (tenant_id, start_iso),
    ):
        totals[u] = {"nickname": n, "avatar": a, "taps": taps or 0, "coins": coins or 0}
    conn.close()

    def _merge(wins, total_key):
        out = []
        for u, w in wins.items():
            t = totals.get(u, {})
            out.append({
                "user": u,
                "nickname": w.get("nickname") or t.get("nickname") or u,
                "avatar": w.get("avatar") or t.get("avatar") or "",
                "wins": w["wins"],
                "total": t.get(total_key, 0),
            })
        out.sort(key=lambda x: (-x["wins"], -x["total"]))
        return out[:limit]

    return {"taps": _merge(tap_wins, "taps"), "coins": _merge(coin_wins, "coins")}


def battle_reset(tenant_id):
    conn = _conn()
    cur = conn.cursor()
    for t in ("batalha_interactions", "batalha_rounds", "batalha_players"):
        cur.execute(f"DELETE FROM {t} WHERE tenant_id = ?", (tenant_id,))
    conn.commit()
    conn.close()


def record_caca_found(tenant_id, username, nickname, avatar, palavra):
    conn = _conn()
    conn.execute(
        "INSERT INTO caca_palavras_encontradas (tenant_id, username, nickname, avatar, palavra) VALUES (?,?,?,?,?)",
        (tenant_id, username, nickname or username, avatar or "", palavra or ""),
    )
    conn.commit()
    conn.close()


def load_vpet(tenant_id):
    conn = _conn()
    try:
        row = conn.execute(
            "SELECT state FROM vpet_state WHERE tenant_id = ?", (tenant_id,)
        ).fetchone()
    finally:
        conn.close()
    if not row or not row[0]:
        return None
    try:
        return json.loads(row[0])
    except Exception:
        return None


def save_vpet(tenant_id, state):
    conn = _conn()
    try:
        conn.execute(
            "INSERT INTO vpet_state (tenant_id, state, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(tenant_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at",
            (tenant_id, json.dumps(state, ensure_ascii=False), int(time.time())),
        )
        conn.commit()
    finally:
        conn.close()


def record_tres_hit(tenant_id, username, nickname, avatar, pontos, usou_multiplicador=False):
    conn = _conn()
    try:
        conn.execute(
            "INSERT INTO tres_acertos (tenant_id, username, nickname, avatar, pontos, usou_multiplicador) "
            "VALUES (?,?,?,?,?,?)",
            (tenant_id, username or "", nickname or username or "", avatar or "", int(pontos or 0), 1 if usou_multiplicador else 0),
        )
        conn.commit()
    finally:
        conn.close()


def get_tres_weekly(tenant_id, limit=10):
    """Ranking semanal do Jogo dos 3 Pontinhos (segunda-feira 00:00 local)."""
    from datetime import datetime, timedelta
    now = datetime.now()
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    start_iso = monday.strftime("%Y-%m-%d %H:%M:%S")
    conn = _conn()
    try:
        rows = conn.execute(
            "SELECT username, nickname, avatar, SUM(pontos) AS pts, COUNT(*) AS acertos "
            "FROM tres_acertos WHERE tenant_id = ? AND criado_em >= ? "
            "GROUP BY username ORDER BY pts DESC LIMIT ?",
            (tenant_id, start_iso, limit or 10),
        ).fetchall()
    finally:
        conn.close()
    return [
        {"user": r[0], "nickname": r[1] or r[0], "avatar": r[2] or "", "pontos": r[3] or 0, "acertos": r[4] or 0}
        for r in rows
    ]
