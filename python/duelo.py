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
    "hp_start": 100,              # valor inicial de HP da rodada
    "hp_max": 100,                # escala da barra de HP
    "shield_start": 100,
    "shield_max": 200,
    "dmg_punch": 10,
    "dmg_kick": 15,
    "dmg_uppercut": 20,
    "reset_delay_s": 6,
    "match_restart_delay_s": 8,   # tempo após o VENCEDOR FINAL para nova partida automática
    "vote_target": 0,             # meta de VOTOS (0 = ilimitado) → VENCEDOR FINAL
    "supporters": {},             # apoios especiais: {nikolas: {...}, ...}
    "shield_gift_amount": 15,     # pontos padrão do presente de escudo
}

DEFAULT_ACTION_AUDIO = {
    "punch": "/duelo-audio/_system/soco-novo.mp3",
    "kick": "/duelo-audio/_system/chute-novo.mp3",
    "uppercut": "/duelo-audio/_system/levantada-novo.mp3",
}

DEFAULT_SHIELD_AUDIO = "/duelo-audio/_system/escudo-padrao.mp3"


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
        self.debate_wins = {"flavio": 0, "lula": 0}
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
        hp = self.settings.get("hp_start")
        self.hp = {"flavio": int(hp) if hp is not None else 100,
                   "lula": int(hp) if hp is not None else 100}
        sh = self.settings.get("shield_start")
        self.shield = {"flavio": int(sh) if sh is not None else 100,
                       "lula": int(sh) if sh is not None else 100}

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
        """Nova disputa: zera votos e debate_wins e remove vencedor final."""
        self.final = False
        self.votes = {"flavio": 0, "lula": 0}
        self.debate_wins = {"flavio": 0, "lula": 0}
        self.reset_round()

    def state(self):
        return {
            "mode": self.mode,
            "hp": dict(self.hp),
            "shield": dict(self.shield),
            "votes": dict(self.votes),
            "debate_wins": dict(self.debate_wins),
            "hp_max": int(self.settings.get("hp_max", 100) or 100),
            "shield_max": int(self.settings.get("shield_max", 200) or 200),
            "vote_target": int(self.settings.get("vote_target", 0) or 0),
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
    def _click_audio(self, match, gtype, action):
        """Áudio do presente, com override opcional: padrão do sistema caso contrário."""
        own = str(match.get("audio") or "").strip()
        if own:
            return f"/duelo-audio/{self.tenant_id}/{own}"
        if gtype == "escudo":
            return DEFAULT_SHIELD_AUDIO
        if gtype == "golpe":
            return DEFAULT_ACTION_AUDIO.get(action, "")
        return ""

    def _check_meta(self, char):
        """Encerra a disputa pela MAIORIA ABSOLUTA da meta (vote_target).

        Regra: vence quem atingir floor(vote_target/2) + 1 votos.
        Se vote_target == 0 (SEM LIMITE), não há final automático.
        """
        target = int(self.settings.get("vote_target", 0) or 0)
        threshold = (target // 2) + 1 if target > 0 else 0
        if threshold > 0 and (self.votes.get(char, 0) or 0) >= threshold and not self.final:
            self.roundActive = False
            self.winner = char
            self.final = True
            self._emit("duelo_match_end", {
                "winner": char,
                "votes": dict(self.votes),
                "target": target,
                "majority": threshold,
                "final": True,
            })
            self._emit("duelo_state", self.state())
            return "match_end"
        return None

    # ---- Apoios especiais ----
    def _resolve_supporter(self, gift_id="", gift_name=""):
        """Retorna (key, cfg) do apoio especial que casa com o presente, ou None."""
        supporters = self.settings.get("supporters") or {}
        if not isinstance(supporters, dict):
            return None
        for key, s in supporters.items():
            if not isinstance(s, dict) or not s.get("enabled", True):
                continue
            side = self._norm(s.get("side") or "")
            if side not in self.VALID_CHARACTERS:
                continue
            sid = str(s.get("gift_id") or "").strip()
            sname = str(s.get("gift_name") or "").strip()
            hit = bool(sid and gift_id and self._norm(sid) == self._norm(gift_id))
            if not hit and sname:
                hit = self._norm(sname) == self._norm(gift_name)
            if hit:
                return (key, s)
        return None

    def on_gift(self, gift_id="", gift_name="", combo=1, user=None, nickname=None, coins=0):
        # Durante banner de vitória / rodada pausada / disputa final, ignora todos os gifts.
        if not self.active or not self.roundActive or self.winner:
            return None

        # ----- APOIO ESPECIAL (prioridade de match; soma votos + causa dano) -----
        sup = self._resolve_supporter(gift_id, gift_name)
        if sup:
            key, cfg = sup
            combo = max(1, int(combo or 1))
            char = self._norm(cfg.get("side") or "")
            defender = "lula" if char == "flavio" else "flavio"
            added = int(coins or 0) * combo
            if added > 0:
                self.votes[char] = (self.votes.get(char, 0) or 0) + added
            base = max(1, int(cfg.get("damage") or 0))
            dmg = base * combo
            sh_before = self.shield[defender]
            self._apply_damage(defender, dmg)
            absorbed = min(int(sh_before), dmg)
            hp_damage = dmg - absorbed
            own = str(cfg.get("audio") or "").strip()
            audio_url = f"/duelo-audio/{self.tenant_id}/{own}" if own else ""
            self._emit("duelo_support_attack", {
                "supporter": key,
                "side": char,
                "gift_id": str(gift_id or ""),
                "gift_name": str(cfg.get("gift_name") or gift_name or ""),
                "damage": base,
                "combo": combo,
                "final_damage": dmg,
                "absorbed": absorbed,
                "hp_damage": hp_damage,
                "added_votes": added,
                "target": defender,
                "audio_url": audio_url,
                "user": user or "",
                "nickname": nickname or user or "",
            })
            ko = self.hp[defender] <= 0
            if ko:
                self.roundActive = False
                self.winner = char
                self.debate_wins[char] = (self.debate_wins.get(char, 0) or 0) + 1
                self._emit("duelo_round_end", {"winner": char, "votes": dict(self.votes), "final": False})
            result = self._check_meta(char)
            if result:
                return result
            self._emit("duelo_state", self.state())
            return ("round_end" if ko else "support_attack")

        match = None
        for g in self.gifts:
            if g and g.get("active", True) and self._matches(g, gift_id, gift_name):
                match = g
                break
        if not match:
            return None

        gtype = self._norm(match.get("type") or "")
        if gtype in ("apoio", "support", "vote"):
            gtype = "apoio"
        elif gtype in ("escudo", "shield"):
            gtype = "escudo"
        else:
            gtype = "golpe"
        char = self._norm(match.get("character") or "")
        if char not in self.VALID_CHARACTERS:
            return None
        combo = max(1, int(combo or 1))

        # ----- VOTOS: todo presente soma moedas × quantidade -----
        added = int(coins or 0) * combo
        if added > 0:
            self.votes[char] = (self.votes.get(char, 0) or 0) + added
        self._emit("duelo_vote", {
            "character": char,
            "added": added,
            "combo": combo,
            "coins": int(coins or 0),
            "votes": dict(self.votes),
            "user": user or "",
            "nickname": nickname or user or "",
        })

        # ----- APOIO: só votos, não influencia o debate -----
        if gtype == "apoio":
            result = self._check_meta(char)
            if result:
                return result
            self._emit("duelo_state", self.state())
            return "support"

        # ----- ESCUDO -----
        if gtype == "escudo":
            points = int(match.get("shield") or 0)
            if points <= 0:
                points = max(1, int(self.settings.get("shield_gift_amount", 15) or 15))
            new_sh = min(int(self.settings.get("shield_max", 200) or 200), self.shield[char] + points)
            self.shield[char] = new_sh
            self._emit("duelo_shield", {
                "fighter": char,
                "shield": self.shield[char],
                "points": points,
                "added_votes": added,
                "audio_url": self._click_audio(match, gtype, ""),
                "user": user or "",
                "nickname": nickname or user or "",
            })
            result = self._check_meta(char)
            if result:
                return result
            self._emit("duelo_state", self.state())
            return "shield"

        # ----- GOLPE -----
        action = self._norm(match.get("action") or "")
        if action not in self.VALID_ACTIONS:
            return None
        base = int(match.get("damage") or 0)
        if base <= 0:
            base = int(self.settings.get("dmg_" + action, 10) or 10)
        dmg = base * combo
        defender = "lula" if char == "flavio" else "flavio"
        sh_before = self.shield[defender]
        self._apply_damage(defender, dmg)
        absorbed = min(int(sh_before), dmg)
        hp_damage = dmg - absorbed

        self._emit("duelo_attack", {
            "attacker": char,
            "defender": defender,
            "action": action,
            "combo": combo,
            "base_damage": base,
            "damage": dmg,
            "absorbed": absorbed,
            "hp_damage": hp_damage,
            "added_votes": added,
            "audio_url": self._click_audio(match, gtype, action),
            "gift_id": str(match.get("gift_id") or ""),
            "gift": str(match.get("name") or gift_name or ""),
            "user": user or "",
            "nickname": nickname or user or "",
        })

        ko = self.hp[defender] <= 0
        if ko:
            self.roundActive = False
            self.winner = char
            self.debate_wins[char] = (self.debate_wins.get(char, 0) or 0) + 1
            self._emit("duelo_round_end", {
                "winner": char,
                "votes": dict(self.votes),
                "final": False,
            })

        result = self._check_meta(char)
        if result:
            return result

        self._emit("duelo_state", self.state())
        return ("round_end" if ko else "attack")