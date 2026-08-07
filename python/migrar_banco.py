# -*- coding: utf-8 -*-
"""Migra os dados dos arquivos JSON por tenant + bancos antigos para o banco unificado (node/data.db)."""
import os
import json
import sqlite3
import sys
import shutil
import db

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(BASE)
NODE_DATA = os.path.join(PROJECT, "node", "data")
CONTEXTOS = os.path.join(BASE, "contextos")
OLD_GAME_DB = os.path.join(BASE, "game.db")

db.init_db()
conn = db._conn()
cur = conn.cursor()


def norm_time(t):
    if not t:
        return None
    return str(t).replace("T", " ").split(".")[0]


stats = {"games": 0, "history": 0, "settings": 0, "gift": 0, "contextos": 0, "players": 0}

for tid in sorted(os.listdir(NODE_DATA)):
    tdir = os.path.join(NODE_DATA, tid)
    if not os.path.isdir(tdir):
        continue

    hp = os.path.join(tdir, "history.json")
    if os.path.exists(hp):
        try:
            data = json.load(open(hp, encoding="utf-8"))
        except Exception:
            data = {}
        for g in data.get("games", []):
            pt = norm_time(g.get("time"))
            exists = cur.execute(
                "SELECT 1 FROM games WHERE tenant_id=? AND secret_word=? AND winner=? AND played_at=?",
                (tid, g.get("word"), g.get("winner"), pt),
            ).fetchone()
            if exists:
                continue
            cur.execute(
                """INSERT INTO games (tenant_id, secret_word, winner, winner_nickname, winner_avatar, total_guesses, played_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (tid, g.get("word"), g.get("winner"), g.get("nickname"), g.get("avatar"), g.get("guesses"), pt),
            )
            stats["games"] += 1
        cur.execute(
            """INSERT INTO tenant_history (tenant_id, last_id, played_words) VALUES (?,?,?)
               ON CONFLICT(tenant_id) DO UPDATE SET last_id=excluded.last_id, played_words=excluded.played_words""",
            (tid, data.get("last_id", 0), json.dumps(data.get("played", []), ensure_ascii=False)),
        )
        stats["history"] += 1

    gp = os.path.join(tdir, "gift-config.json")
    if os.path.exists(gp):
        try:
            gc = json.load(open(gp, encoding="utf-8"))
        except Exception:
            gc = {}
        cur.execute(
            """INSERT INTO tenant_gift_config (tenant_id, hint_gifts, riddle_gifts) VALUES (?,?,?)
               ON CONFLICT(tenant_id) DO UPDATE SET hint_gifts=excluded.hint_gifts, riddle_gifts=excluded.riddle_gifts""",
            (tid, json.dumps(gc.get("hint_gifts", []), ensure_ascii=False), json.dumps(gc.get("riddle_gifts", []), ensure_ascii=False)),
        )
        stats["gift"] += 1

    sp = os.path.join(tdir, "settings.json")
    if os.path.exists(sp):
        try:
            s = json.load(open(sp, encoding="utf-8"))
        except Exception:
            s = {}
        cur.execute(
            """INSERT INTO tenant_settings (tenant_id, apenas_seguidores, apenas_heart_me, pct_dica, pct_charada, tts_rate, tts_voice, chat_narr_enabled, chat_narr_mode)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(tenant_id) DO UPDATE SET apenas_seguidores=excluded.apenas_seguidores, apenas_heart_me=excluded.apenas_heart_me,
                   pct_dica=excluded.pct_dica, pct_charada=excluded.pct_charada, tts_rate=excluded.tts_rate, tts_voice=excluded.tts_voice,
                   chat_narr_enabled=excluded.chat_narr_enabled, chat_narr_mode=excluded.chat_narr_mode""",
            (
                tid,
                1 if s.get("apenas_seguidores") else 0,
                1 if s.get("apenas_heart_me") else 0,
                s.get("pct_dica", 70),
                s.get("pct_charada", 30),
                s.get("tts_rate", 1.0),
                s.get("tts_voice", ""),
                1 if s.get("chat_narr_enabled") else 0,
                s.get("chat_narr_mode", "all"),
            ),
        )
        stats["settings"] += 1

if os.path.isdir(CONTEXTOS):
    for f in sorted(os.listdir(CONTEXTOS)):
        if not f.endswith(".json") or f == "_manifest.json":
            continue
        try:
            data = json.load(open(os.path.join(CONTEXTOS, f), encoding="utf-8"))
        except Exception:
            continue
        if "ranking" not in data:
            continue
        cur.execute(
            """INSERT INTO contextos (alvo, gerado_em, ranking) VALUES (?,?,?)
               ON CONFLICT(alvo) DO UPDATE SET gerado_em=excluded.gerado_em, ranking=excluded.ranking""",
            (data.get("alvo", f[:-5]), data.get("gerado_em"), json.dumps(data.get("ranking", []), ensure_ascii=False)),
        )
        stats["contextos"] += 1

if os.path.exists(OLD_GAME_DB):
    oc = sqlite3.connect(OLD_GAME_DB)
    try:
        try:
            rows = oc.execute("SELECT username, nickname, avatar, total_guesses, total_wins FROM users").fetchall()
        except sqlite3.Error:
            rows = []
        for u, n, a, tg, tw in rows:
            cur.execute(
                """INSERT INTO players (username, nickname, avatar, total_guesses, total_wins) VALUES (?,?,?,?,?)
                   ON CONFLICT(username) DO UPDATE SET nickname=excluded.nickname, avatar=excluded.avatar,
                       total_guesses=MAX(total_guesses, excluded.total_guesses), total_wins=MAX(total_wins, excluded.total_wins)""",
                (u, n, a, tg, tw),
            )
            stats["players"] += 1
    finally:
        oc.close()

conn.commit()
conn.close()
print(json.dumps(stats, ensure_ascii=False))

backup_dir = os.path.join(NODE_DATA, "_legacy_backup")
moved = 0
if os.path.isdir(NODE_DATA):
    for tid in sorted(os.listdir(NODE_DATA)):
        tdir = os.path.join(NODE_DATA, tid)
        if not os.path.isdir(tdir) or tid.startswith("_"):
            continue
        for f in os.listdir(tdir):
            if f.endswith(".json"):
                os.makedirs(os.path.join(backup_dir, tid), exist_ok=True)
                shutil.move(os.path.join(tdir, f), os.path.join(backup_dir, tid, f))
                moved += 1
print(json.dumps({"moved_legacy_json": moved}))
