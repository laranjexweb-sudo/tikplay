"""CORDA: posição autoritativa, força em fila e rodadas independentes do Duelo."""
import math
import re
import time
import unicodedata

SIDES = ("flavio", "lula")
DEFAULTS = {"best_of": 3, "round_time_s": 180, "result_delay_s": 6,
            "coin_force": 0.5, "tap_target": 500, "tap_force": 5,
            "pull_speed": 60, "impulse_threshold": 25, "gifts": [],
            "start_delay_s": 0, "round_countdown_s": 0, "comment_force": 1, "comment_cooldown_s": 2, "comments_enabled": True, "share_enabled": False, "share_force": 3, "share_boost_s": 30,
            "show_team_balloons": True, "show_like_bubbles": True}


def norm(value):
    return "".join(c for c in unicodedata.normalize("NFD", str(value or "").lower().strip())
                   if unicodedata.category(c) != "Mn")


def number(value, default, low, high):
    try:
        result = float(value)
        return max(low, min(high, result)) if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


class CordaEngine:
    def __init__(self, emit_cb=None, clock=None):
        self.emit = emit_cb or (lambda kind, payload: None)
        self.clock = clock or time.monotonic
        self.config = dict(DEFAULTS)
        self.active = False
        self.round_id = 0
        self.revision = 0
        self.prepares_at = 0
        self.comment_last = {}
        self.share_last = {}
        self.boosts = {}
        self.teams = {}
        self.team_counts = dict.fromkeys(SIDES, 0)
        self.wins = dict.fromkeys(SIDES, 0)
        self.taps = dict.fromkeys(SIDES, 0)
        self.force = dict.fromkeys(SIDES, 0)
        self.position = self.pending = 0.0
        self.winner = self.match_winner = None
        self.round_active = False
        self.ends_at = self.next_at = 0
        self.last_tick = self.clock()
        self.last_second = None

    def set_config(self, config):
        config = config if isinstance(config, dict) else {}
        out = dict(DEFAULTS)
        out["best_of"] = 0 if config.get("best_of") == 0 else 5 if config.get("best_of") == 5 else 3
        for key, low, high in (("round_time_s", 30, 900), ("result_delay_s", 3, 30),
                              ("coin_force", .01, 10), ("tap_target", 10, 100000),
                              ("tap_force", .1, 30), ("pull_speed", 10, 120),
                              ("impulse_threshold", 1, 100), ("start_delay_s",0,60), ("round_countdown_s",0,15), ("comment_force",0,100), ("comment_cooldown_s",1,60), ("share_force",0,100), ("share_boost_s",0,300)):
            out[key] = number(config.get(key), DEFAULTS[key], low, high)
        gifts = []
        for gift in (config.get("gifts") or [])[:100]:
            if not isinstance(gift, dict) or gift.get("side") not in SIDES:
                continue
            gift_id = str(gift.get("gift_id") or "").strip()[:80]
            name = str(gift.get("gift_name") or "").strip()[:100]
            if gift_id or name:
                gifts.append({"side": gift["side"], "gift_id": gift_id, "gift_name": name,
                              "enabled": gift.get("enabled") is not False, "pull": gift.get("pull") is True})
        out["gifts"] = gifts
        for key in ("show_team_balloons", "show_like_bubbles"):
            out[key] = config.get(key) is not False
        out["comments_enabled"] = config.get("comments_enabled") is not False
        out["share_enabled"] = config.get("share_enabled") is True
        self.config = out

    def start(self, config=None):
        if config is not None:
            self.set_config(config)
        self.active = True
        self.teams.clear()
        self.team_counts = dict.fromkeys(SIDES, 0)
        self.wins = dict.fromkeys(SIDES, 0)
        self.match_winner = None
        self.comment_last.clear()
        self.share_last.clear()
        self.boosts.clear()
        self._new_round(self.config["start_delay_s"])

    def _new_round(self, delay=0):
        self.comment_last.clear()
        self.boosts.clear()
        self.round_id += 1
        self.position = self.pending = 0.0
        self.winner = None
        self.prepares_at = self.clock() + delay if delay else 0
        self.round_active = not bool(delay)
        self.taps = dict.fromkeys(SIDES, 0)
        self.force = dict.fromkeys(SIDES, 0)
        self.last_tick = self.clock()
        self.ends_at = self.last_tick + delay + self.config["round_time_s"]
        self.next_at = 0
        self.last_second = None
        self.publish()

    def stop(self):
        self.active = self.round_active = False
        self.prepares_at = 0
        self.pending = 0
        self.next_at = 0
        self.publish()

    def ready(self):
        if self.active and self.round_active and self.clock() >= self.ends_at:
            self.finish()
        return self.active and self.round_active and not self.match_winner

    def join(self, uid, text, username="", nickname="", avatar=""):
        if not self.active or self.match_winner or not uid:
            return None
        words = set(re.findall(r"[a-z0-9]+", norm(text)))
        blue = bool(words & {"flavio", "bolsonaro", "azul", "22"})
        red = bool(words & {"lula", "vermelho", "13"})
        if not blue and not red:
            return None
        side = "flavio" if blue else "lula"
        old = self.teams.get(uid)
        if old != side:
            if old:
                self.team_counts[old] -= 1
            self.teams[uid] = side
            self.team_counts[side] += 1
            self.emit("corda_team", {"user": uid, "user_id": uid, "side": side,
                                     "unique_id": username or uid, "nickname": nickname or username or uid,
                                     "avatar_url": avatar or "", "previous_side": old,
                                     "round_id": self.round_id})
            self.publish()
        return side

    def add_force(self, side, amount, source="test", user="", combo=1, impulse=False):
        if side not in SIDES or not self.ready():
            return False
        amount = number(amount, 0, 0, 1000000)
        if not amount:
            return False
        self.force[side] += amount
        self.pending += (-1 if side == "flavio" else 1) * amount
        self.emit("corda_pull", {"side": side, "receiver": "lula" if side == "flavio" else "flavio",
                                  "force": amount, "source": source, "user": user,
                                  "impulse": impulse or source == "tap" or combo > 10 or amount >= self.config["impulse_threshold"],
                                  "combo": combo,
                                  "round_id": self.round_id})
        self.publish()
        return True

    def gift(self, gift_id, gift_name, coins, repeat, uid, username="", nickname="", avatar=""):
        if not self.ready():
            return False
        # ID tem prioridade; nomes são fallback apenas para cadastros sem ID.
        matches = [g for g in self.config["gifts"] if g["enabled"] and
                   ((g["gift_id"] and str(gift_id) == g["gift_id"]) or
                    (not g["gift_id"] and norm(gift_name) == norm(g["gift_name"])))]
        sides = {g["side"] for g in matches}
        side = next(iter(sides)) if len(sides) == 1 else None
        if not side:
            return False
        amount = number(coins, 0, 0, 1000000) * number(repeat, 1, 1, 100000) * self.config["coin_force"]
        combo = number(repeat, 1, 1, 100000)
        marked = any(g.get("pull") for g in matches)
        accepted = self.add_force(side, amount, "gift", uid, combo=combo, impulse=marked)
        if accepted and (marked or combo > 10 or amount >= self.config["impulse_threshold"]):
            self.emit("corda_gift_pull", {"side": side, "user_id": uid, "unique_id": username,
                      "nickname": nickname or username or uid, "avatar_url": avatar,
                      "round_id": self.round_id})
        return accepted

    def update_target(self, target):
        target = int(number(target, self.config["tap_target"], 10, 100000))
        if target == self.config["tap_target"]:
            return False
        eligible = self.ready()
        self.config = {**self.config, "tap_target": target}
        rewarded = [side for side in SIDES if eligible and self.taps[side] >= target]
        # Zera todos os elegíveis antes de publicar: alteração atômica no motor.
        for side in rewarded:
            self.taps[side] = 0
        self.emit("corda_target_updated", {"target": target, "rewarded": rewarded, "round_id": self.round_id})
        for side in rewarded:
            self.add_force(side, self.config["tap_force"], "tap", "streamer")
        self.publish()
        return True

    def comment(self, uid, text):
        if not self.ready() or uid not in self.teams or not self.config["comments_enabled"] or not str(text).strip():
            return False
        words = set(re.findall(r"[a-z0-9]+", norm(text)))
        if words & {"azul", "22", "bolsonaro", "flavio"} and words & {"vermelho", "13", "lula"}:
            return False
        now = self.clock()
        if now - self.comment_last.get(uid, -float("inf")) < self.config["comment_cooldown_s"]:
            return False
        self.comment_last[uid] = now
        return self.like(uid, self.config["comment_force"], multiply=False)

    def share(self, uid, username="", nickname="", avatar=""):
        if not self.ready() or uid not in self.teams or not self.config["share_enabled"]:
            return False
        now = self.clock()
        if now - self.share_last.get(uid, -float("inf")) < 30:
            return False
        self.share_last[uid] = now
        self.boosts[uid] = now + self.config["share_boost_s"]
        self.emit("corda_share", {"side": self.teams[uid], "nickname": nickname or username,
                  "user_id": uid, "avatar_url": avatar, "force": self.config["share_force"], "round_id": self.round_id})
        return self.like(uid, self.config["share_force"], multiply=False)

    def like(self, uid, count, avatar="", username="", nickname="", multiply=True):
        if not self.ready() or uid not in self.teams:
            return False
        side = self.teams[uid]
        delta = int(number(count, 0, 0, 1000000))
        if multiply and self.boosts.get(uid, 0) > self.clock():
            delta *= 2
        if not delta:
            return False
        self.emit("corda_tap_avatar_burst", {"side": side, "user_id": uid,
                                           "unique_id": username or uid, "nickname": nickname or username or uid,
                                           "avatar_url": avatar or "", "delta": delta,
                                           "round_id": self.round_id})
        self.taps[side] += delta
        batches = int(self.taps[side] // self.config["tap_target"])
        self.taps[side] %= self.config["tap_target"]
        if batches:
            return self.add_force(side, batches * self.config["tap_force"], "tap", uid)
        self.publish()
        return False

    def finish(self, winner=None):
        if not self.round_active:
            return
        if winner is None:
            winner = "flavio" if self.position < -.01 else "lula" if self.position > .01 else None
        self.round_active = False
        self.winner = winner
        self.pending = 0
        if winner:
            self.wins[winner] += 1
            if self.config["best_of"] != 0 and self.wins[winner] >= self.config["best_of"] // 2 + 1:
                self.match_winner = winner
        self.next_at = 0 if self.match_winner else self.clock() + self.config["result_delay_s"]
        self.publish()

    def tick(self):
        now = self.clock()
        dt = max(0, min(.25, now - self.last_tick))
        self.last_tick = now
        if not self.active:
            return
        if self.prepares_at:
            second = math.ceil(self.prepares_at - now)
            if now >= self.prepares_at:
                self.prepares_at = 0
                self.round_active = True
                self.last_second = None
                self.publish()
            elif second != self.last_second:
                self.last_second = second
                self.publish()
            return
        if not self.round_active:
            if self.next_at and now >= self.next_at:
                self._new_round(self.config["round_countdown_s"])
            return
        if now >= self.ends_at:
            self.finish()
            return
        step = max(-self.config["pull_speed"] * dt, min(self.config["pull_speed"] * dt, self.pending))
        self.pending -= step
        if abs(self.pending) < 1e-8:
            self.pending = 0
        self.position = max(-100, min(100, self.position + step))
        if abs(self.position) >= 100 - 1e-8:
            self.position = -100 if self.position < 0 else 100
            self.finish("flavio" if self.position < 0 else "lula")
            return
        second = math.ceil(self.ends_at - now)
        if step or second != self.last_second:
            self.last_second = second
            self.publish()

    def state(self):
        now = self.clock()
        return {"type": "corda_state", "active": self.active, "round_active": self.round_active,
                "preparing": bool(self.prepares_at), "starts_in": max(0, math.ceil(self.prepares_at-now)) if self.prepares_at else 0,
                "position": round(self.position, 3), "pending_force": round(self.pending, 3),
                "wins": dict(self.wins), "winner": self.winner, "match_winner": self.match_winner,
                "round_id": self.round_id, "revision": self.revision, "taps": dict(self.taps),
                "team_counts": dict(self.team_counts),
                "force": dict(self.force), "config": self.config,
                "time_remaining": max(0, math.ceil(self.ends_at - now)) if self.round_active else 0,
                "next_round_in": max(0, math.ceil(self.next_at - now)) if self.next_at else 0}

    def publish(self):
        self.revision += 1
        self.emit("corda_state", self.state())
