"""Jogo BATALHA — motor isolado (extraído de service.py, Fase A-2).

Sem mudança de comportamento: dependências são `emit` (service_common), `db` e stdlib.
Rodada de N segundos; Top1 de Tap (likes) e Top1 de Moeda (gifts).
"""
import asyncio
from datetime import datetime

import db
from service_common import emit


class BatalhaEngine:
    """Jogo BATALHA: rodada de N segundos; Top1 de Tap (likes) e Top1 de Moeda (gifts)."""

    def __init__(self, tenant_id):
        self.tenant_id = tenant_id
        self.active = False
        self.duration = 180
        self.remaining = 0
        self.started_at = None
        self.room_id = ""
        self.accum = {}
        self.task = None
        self.last_action = None

    def _emit(self, type_, payload):
        emit(self.tenant_id, "game", {"type": type_, **payload})

    def _fmt_entry(self, item):
        if not item:
            return None
        u, d = item
        return {"user": u, "nickname": d.get("nickname") or u, "avatar": d.get("avatar") or "", "taps": d["taps"], "coins": d["coins"]}

    def _leaders(self):
        tap_entries = [(u, d) for u, d in self.accum.items() if d["taps"] > 0]
        coin_entries = [(u, d) for u, d in self.accum.items() if d["coins"] > 0]
        top_tap = max(tap_entries, key=lambda kv: kv[1]["taps"], default=None)
        top_coin = max(coin_entries, key=lambda kv: kv[1]["coins"], default=None)
        return {"tap": self._fmt_entry(top_tap), "coin": self._fmt_entry(top_coin)}

    def _top_list(self, limit=8):
        taps = sorted([d for d in self.accum.items() if d[1]["taps"] > 0], key=lambda kv: -kv[1]["taps"])[:limit]
        coins = sorted([d for d in self.accum.items() if d[1]["coins"] > 0], key=lambda kv: -kv[1]["coins"])[:limit]

        def _fmt(items):
            return [{"user": u, "nickname": d.get("nickname") or u, "avatar": d.get("avatar") or "", "taps": d["taps"], "coins": d["coins"]} for u, d in items]

        return {"taps": _fmt(taps), "coins": _fmt(coins)}

    def start(self, duration=180, room_id=""):
        self.stop()
        self.room_id = room_id or ""
        self.duration = max(10, int(duration) or 180)
        self.remaining = self.duration
        self.started_at = datetime.now().isoformat()
        self.accum = {}
        self.active = True
        self.last_action = None
        self._emit("battle_state", {"active": True, "duration": self.duration, "remaining": self.remaining, "leaders": None, "room_id": self.room_id})
        self.task = asyncio.create_task(self._loop())

    async def _loop(self):
        while self.active and self.remaining > 0:
            self.remaining -= 1
            self._emit("battle_tick", {"remaining": self.remaining, "duration": self.duration, "leaders": self._leaders(), "ranking": self._top_list()})
            if self.remaining <= 0:
                await self.end_round()
                return
            await asyncio.sleep(1)

    def add_taps(self, user, nickname, avatar, count):
        if not self.active or not user or count <= 0:
            return
        d = self.accum.setdefault(user, {"nickname": nickname or user, "avatar": avatar or "", "taps": 0, "coins": 0})
        if nickname:
            d["nickname"] = nickname
        if avatar:
            d["avatar"] = avatar
        d["taps"] += count
        self.last_action = {"user": user, "nickname": d["nickname"], "avatar": d["avatar"], "type": "tap", "count": count}
        self._emit("battle_action", self.last_action)

    def add_coins(self, user, nickname, avatar, count):
        if not self.active or not user or count <= 0:
            return
        d = self.accum.setdefault(user, {"nickname": nickname or user, "avatar": avatar or "", "taps": 0, "coins": 0})
        if nickname:
            d["nickname"] = nickname
        if avatar:
            d["avatar"] = avatar
        d["coins"] += count
        self.last_action = {"user": user, "nickname": d["nickname"], "avatar": d["avatar"], "type": "coin", "count": count}
        self._emit("battle_action", self.last_action)

    async def end_round(self):
        if not self.active:
            return
        self.active = False
        leaders = self._leaders()
        if leaders["tap"]:
            leaders["tap"]["taps"] = max(d["taps"] for d in self.accum.values())
        if leaders["coin"]:
            leaders["coin"]["coins"] = max(d["coins"] for d in self.accum.values())
        self._emit("battle_round_end", {"tap": leaders["tap"], "coin": leaders["coin"]})
        try:
            db.battle_save_round(self.tenant_id, self.started_at, datetime.now().isoformat(), self.duration, leaders["tap"], leaders["coin"], self.accum, self.room_id)
        except Exception:
            pass
        self._emit("battle_ranking", self._top_list(8))
        try:
            self._emit("battle_weekly", db.battle_load_weekly_winners(self.tenant_id, 5))
        except Exception:
            pass
        self._emit("battle_state", {"active": False, "duration": self.duration, "remaining": 0, "leaders": leaders})

    def stop(self):
        if self.task:
            self.task.cancel()
            self.task = None
        self.active = False

    def state(self):
        return {
            "active": self.active,
            "duration": self.duration,
            "remaining": self.remaining,
            "leaders": self._leaders(),
            "last_action": self.last_action,
        }