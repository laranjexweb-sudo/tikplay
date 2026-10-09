"""Duelo 1x1 — motor autoritativo (modos HP e Votos, com Escudo).

O Python é a fonte de verdade de HP, escudo, votos e vencedor da rodada.
O frontend apenas anima e exibe o que recebe por `duelo_attack` / `duelo_shield` /
`duelo_state`. Detalhes de animação não vivem aqui (para não contaminar os outros jogos).
"""

try:
    from typing import Optional
except ImportError:
    pass

DEFAULT_SETTINGS = {
    "mode": "hp",                 # 'hp' | 'votes'
    "hp_start": 100,
    "shield_start": 100,
    "shield_max": 200,
    "dmg_punch": 10,
    "dmg_kick": 15,
    "dmg_uppercut": 20,
    "reset_delay_s": 6,
    "max_votes": 0,               # 0 = sem limite
    "shield_gift_amount": 15,     # fallback quando o presente de escudo não define seus pontos
}


class DueloEngine:
    VALID_CHARACTERS = ("flavio", "lula")
    VALID_ACTIONS = ("punch", "kick", "uppercut")

    def __init__(self, tenant_id=None, emit_cb=None):
        self.tenant_id = tenant_id
        self.emit_cb = emit_cb or (lambda type_, payload: None)
        self.active = False
        self.gifts = []
        self.settings = dict(DEFAULT_SETTINGS)
        self.mode = "hp"
        self.hp = {"flavio": 100, "lula": 100}
        self.shield = {"flavio": 100, "lula": 100}
        self.votes = {"flavio": 0, "lula": 0}
        self.roundActive = True
        self.winner = None
        self.final = False

    def _emit(self, type_, payload):
        self.emit_cb(type_, payload)

    # ---------------- Config ----------------
    def set_config(self, gifts=None, settings=None):
        if gifts is not None:
            self.gifts = list(gifts or [])
        if isinstance(settings, dict):
            s = dict(DEFAULT_SETTINGS)
            for k, v in settings.items():
                if k in s:
                    s[k] = v
            self.settings = s
            self.mode = s["mode"] if s["mode"] in ("hp", "votes") else "hp"

    def _reset_hp_shield(self):
        self.hp = {"flavio": int(self.settings.get("hp_start", 100) or 100),
                   "lula": int(self.settings.get("hp_start", 100) or 100)}
        self.shield = {"flavio": int(self.settings.get("shield_start", 100) or 100),
                       "lula": int(self.settings.get("shield_start", 100) or 100)}

    def start(self, gifts=None, settings=None):
        if gifts is not None or settings is not None:
            self.set_config(gifts, settings)
        self.active = True
        self.final = False
        self.winner = None
        self.roundActive = True
        self._reset_hp_shield()

    def stop(self):
        self.active = False

    def reset_round(self):
        """Reseta HP/escudo e volta a rodada. NÃO mexe nos votos."""
        self.roundActive = True
        self.winner = None
        self.final = False
        self._reset_hp_shield()

    def reset_match(self):
        """Nova disputa: zera votos e remove vencedor final."""
        self.final = False
        self.votes = {"flavio": 0, "lula": 0}
        self.reset_round()

    def state(self):
        return {
            "mode": self.mode,
            "hp": dict(self.hp),
            "shield": dict(self.shield),
            "votes": dict(self.votes),
            "hp_max": int(self.settings.get("hp_start", 100) or 100),
            "shield_max": int(self.settings.get("shield_max", 200) or 200),
            "winner": self.winner,
            "roundActive": self.roundActive,
            "final": self.final,
            "active": self.active,
        }

    # ---------------- Gift match ----------------
    def _norm(self, s):
        return str(s or "").strip().lower()

    def _matches(self, gift, gift_id, gift_name):
        if not gift:
            return False
        gi = self._norm(gift.get("gift_id") or "")
        if gift_id and gi and gi == self._norm(gift_id):
            return True
        cn = self._norm(gift.get("name") or "")
        return bool(cn and cn == self._norm(gift_name))

    @staticmethod
    def _combo_mult(combo):
        if combo >= 100:
            return 5
        if combo >= 50:
            return 4
        if combo >= 20:
            return 3
        if combo >= 5:
            return 2
        return 1

    def _apply_damage(self, defender, dmg):
        """Escudo absorve antes do HP. HP/escudo nunca ficam negativos."""
        sh = self.shield[defender]
        absorbed = min(sh, dmg)
        self.shield[defender] = max(0, sh - absorbed)
        self.hp[defender] = max(0, self.hp[defender] - (dmg - absorbed))

    # ---------------- Gift ----------------
    def on_gift(self, gift_id="", gift_name="", combo=1, user=None, nickname=None):
        # Durante banner de vitória / rodada pausada, ignora todos os gifts do Duelo.
        if not self.active or not self.roundActive or self.winner:
            return None

        match = None
        for g in self.gifts:
            if g and g.get("active", True) and self._matches(g, gift_id, gift_name):
                match = g
                break
        if not match:
            return None

        gtype = self._norm(match.get("type") or "")
        char = self._norm(match.get("character") or "")
        combo = max(1, int(combo or 1))

        # ----- Presente de ESCUDO -----
        if gtype == "escudo":
            if char not in self.VALID_CHARACTERS:
                return None
            points = int(match.get("shield") or 0)
            if points <= 0:
                points = max(1, int(self.settings.get("shield_gift_amount", 15) or 15))
            new_sh = min(int(self.settings.get("shield_max", 200) or 200), self.shield[char] + points)
            self.shield[char] = new_sh
            self._emit("duelo_shield", {
                "fighter": char,
                "shield": self.shield[char],
                "points": points,
                "user": user or "",
                "nickname": nickname or user or "",
            })
            self._emit("duelo_state", self.state())
            return "shield"

        # ----- Presente de GOLPE -----
        action = self._norm(match.get("action") or "")
        if char not in self.VALID_CHARACTERS or action not in self.VALID_ACTIONS:
            return None
        base = int(match.get("damage") or 0)
        if base <= 0:
            base = int(self.settings.get("dmg_" + action, 10) or 10)
        dmg = base * self._combo_mult(combo)
        defender = "lula" if char == "flavio" else "flavio"
        self._apply_damage(defender, dmg)

        audio = str(match.get("audio") or "")
        self._emit("duelo_attack", {
            "attacker": char,
            "action": action,
            "combo": combo,
            "damage": dmg,
            "audio_url": f"/duelo-audio/{self.tenant_id}/{audio}" if audio else "",
            "gift_id": str(match.get("gift_id") or ""),
            "gift": str(match.get("name") or gift_name or ""),
            "user": user or "",
            "nickname": nickname or user or "",
        })

        if self.hp[defender] <= 0:
            self.roundActive = False
            self.winner = char
            if self.mode == "votes":
                self.votes[char] += 1
            max_votes = int(self.settings.get("max_votes", 0) or 0)
            self.final = bool(max_votes and self.votes[char] >= max_votes)
            self._emit("duelo_round_end", {
                "winner": char,
                "mode": self.mode,
                "votes": dict(self.votes),
                "final": self.final,
            })
            self._emit("duelo_state", self.state())
            return "match_end" if self.final else "round_end"

        self._emit("duelo_state", self.state())
        return "attack"