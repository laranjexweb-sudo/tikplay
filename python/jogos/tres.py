"""Jogo 3 Pontinhos - motor isolado (extraido de game.py, Fase A-3).

Sem mudanca de comportamento. Dependencias: emit_cb, palavra_provider,
GIFT_PT_MAP/strip_accents (service_common), get_catalog (gifts_catalog) e stdlib.
"""
import asyncio
import json
import random
import re
import time
import uuid

from service_common import GIFT_PT_MAP, strip_accents
from gifts_catalog import get_catalog


TRES_STAGE_TIMES = {1: 120, 2: 60, 3: 30}
TRES_STAGE_POINTS = {1: 30, 2: 20, 3: 10}
TRES_PAUSE_AFTER_END = 10  # pausa entre rodadas
TRES_COUNTDOWN = 5         # cronômetro pré-jogo (dicas ocultas)


class TresPontinhos:
    """Motor do Jogo dos 3 Pontinhos. Orquestrado pelo GameSession."""

    def __init__(self, tenant_id, emit_cb=None, palavra_provider=None):
        self.tenant_id = tenant_id
        self._emit_cb = emit_cb or (lambda type_, payload: None)
        # palavra_provider() -> (palavra, dicas) usado no auto-reinício da rodada
        self._palavra_provider = palavra_provider
        self.active = False
        self.round_id = 0
        self.phase = "idle"          # idle | countdown | play | pause
        self.countdown_remaining = 0
        self.pause_remaining = 0
        self.palavra = ""
        self.dicas = []
        self.stage = 0
        self.stage_remaining = 0
        self.paused = False
        self.finished = False
        self.timeout = False
        self.winner = None
        self.size_revealed = False
        self.first_letter_revealed = False
        self.supporter_users = set()
        self.gift_config = {"size": "", "letter": "", "ticket": ""}
        # Tempos e pontos configuráveis por rodada
        self.stage_times = dict(TRES_STAGE_TIMES)
        self.stage_points = dict(TRES_STAGE_POINTS)
        self.task = None
        self._last_emit = 0
        self._last_wrong_emit = 0
        self.wrong_guess_count = 0
        self.trace_id = None

    def _emit(self, type_, payload):
        self._emit_cb(type_, payload)

    def _emit_log(self, event, text, level="info", **details):
        self._emit("log", {
            "text": str(text),
            "category": "error" if level in ("error", "critical") else "game",
            "level": level,
            "game": "tres",
            "event": f"tres.{event}",
            "source": "python",
            "game_id": str(self.round_id) if self.round_id else None,
            "trace_id": self.trace_id,
            "code": details.pop("code", None),
            "duration_ms": details.pop("duration_ms", None),
            "details": details or None,
        })

    # -------------------------------------------------------------
    # Configuração (presentes A/B/C por nome)
    # -------------------------------------------------------------
    def set_gift_config(self, config: dict):
        if not isinstance(config, dict):
            return
        self.gift_config = {
            "size": str(config.get("size") or ""),
            "letter": str(config.get("letter") or ""),
            "ticket": str(config.get("ticket") or ""),
        }
        # Tempos e pontos configuráveis (listas de 3 inteiros)
        times = config.get("stage_times")
        if isinstance(times, list) and len(times) >= 3:
            self.stage_times = {1: int(times[0]), 2: int(times[1]), 3: int(times[2])}
        points = config.get("stage_points")
        if isinstance(points, list) and len(points) >= 3:
            self.stage_points = {1: int(points[0]), 2: int(points[1]), 3: int(points[2])}

    def _norm(self, s: str) -> str:
        return strip_accents(str(s or "")).strip()

    # -------------------------------------------------------------
    # Controle de rodada
    # -------------------------------------------------------------
    def start(self, palavra: str, dicas: list, trace_id=None):
        self.active = True
        self.paused = False
        self.finished = False
        self.timeout = False
        self.round_id += 1
        self.palavra = str(palavra or "").strip()
        self.dicas = [str(d or "").strip() for d in (dicas or [])][:3]
        while len(self.dicas) < 3:
            self.dicas.append("Dica vinda a seguir...")
        # Capitaliza a primeira letra de cada dica
        self.dicas = [d[0].upper() + d[1:] if d else d for d in self.dicas]
        self.phase = "countdown"
        self.countdown_remaining = TRES_COUNTDOWN
        self.stage = 0
        self.stage_remaining = 0
        self.winner = None
        self.wrong_guess_count = 0
        self.trace_id = str(trace_id or "") or None
        self.size_revealed = False
        self.first_letter_revealed = False
        self.supporter_users = set()
        self._emit("tres_state", self.state(public=False))
        self._emit_log(
            "round.started",
            f"[3 Dicas] Rodada {self.round_id} iniciada; dica 1 em {TRES_COUNTDOWN}s.",
            countdown_seconds=TRES_COUNTDOWN,
            clue_count=len(self.dicas),
        )
        if not self.task:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            self.task = loop.create_task(self._loop())

    def stop(self):
        self.active = False
        self.finished = False
        self.timeout = False
        if self.task:
            self.task.cancel()
            self.task = None
        self._emit("tres_state", self.state(public=False))
        self._emit_log("game.stopped", "[3 Dicas] Jogo parado.", round_id=self.round_id)

    def pause(self):
        self.paused = True
        self._emit("tres_state", self.state(public=False))
        self._emit_log("game.paused", "[3 Dicas] Jogo pausado.", phase=self.phase, stage=self.stage)

    def resume(self):
        self.paused = False
        self._emit("tres_state", self.state(public=False))
        self._emit_log("game.resumed", "[3 Dicas] Jogo retomado.", phase=self.phase, stage=self.stage)

    def reset(self, trace_id=None):
        if trace_id:
            self.trace_id = str(trace_id)
        self.stop()
        self.round_id = 0
        self.palavra = ""
        self.dicas = []
        self.stage = 0
        self.stage_remaining = 0
        self.wrong_guess_count = 0
        if trace_id:
            self.trace_id = str(trace_id)
        self._emit("tres_state", self.state(public=False))
        self._emit_log("round.reset", "[3 Dicas] Estado da rodada resetado.")

    # -------------------------------------------------------------
    # Palpite
    # -------------------------------------------------------------
    def guess(self, user, nickname, avatar, text) -> dict:
        if not self.active or self.finished or self.paused or self.phase != "play":
            return None
        # Palpite de palavra única (frase com espaço não é palpite — padrão Palavra Secreta)
        if re.search(r"\s", text):
            return None
        # Remove emojis, pontuação e dígitos (padrão Palavra Secreta)
        cleaned = re.sub(r"[^\w]", "", text, flags=re.UNICODE)
        cleaned = re.sub(r"\d+", "", cleaned)
        norm_guess = strip_accents(cleaned)
        if not norm_guess or len(norm_guess) < 2:
            return None
        if norm_guess != self._norm(self.palavra):
            self.wrong_guess_count += 1
            # Aviso de palpite errado (anti-spam: throttle ~0.8s)
            now = time.time()
            if now - self._last_wrong_emit > 0.8:
                self._last_wrong_emit = now
                self._emit("tres_wrong_guess", {
                    "user": user,
                    "nickname": nickname or user,
                    "avatar": avatar or "",
                    "text": text,
                })
            return None
        mult = 2 if user in self.supporter_users else 1
        pontos = self.stage_points[self.stage] * mult
        self.finished = True
        self.phase = "pause"
        self.pause_remaining = TRES_PAUSE_AFTER_END
        self.winner = {
            "user": user,
            "nickname": nickname or user,
            "avatar": avatar or "",
            "pontos": pontos,
            "multiplicador": mult == 2,
            "stage": self.stage,
            "palavra": self.palavra,
        }
        self._emit("tres_winner", self.winner)
        self._emit("tres_state", self.state(public=False))
        self._emit_log(
            "round.won",
            f"[3 Dicas] @{user} acertou na Dica {self.stage} ({pontos} pts{' 2x' if mult == 2 else ''}).",
            user=user,
            stage=self.stage,
            points=pontos,
            multiplier=mult,
            wrong_guess_count=self.wrong_guess_count,
        )
        return self.winner

    # -------------------------------------------------------------
    # Gifts (monetização)
    # -------------------------------------------------------------
    def _gift_aliases(self, name: str) -> set:
        """Conjunto de nomes aceitos (EN e PT) para um gift configurado."""
        if not name:
            return set()
        base = self._norm(name)
        aliases = {base}
        # Se base é EN, traduz para PT (ex: "rose" -> "Rosa")
        pt = self._norm(GIFT_PT_MAP.get(base.lower(), ""))
        if pt:
            aliases.add(pt)
        # Se base é PT, encontra o EN correspondente (ex: "Rosa" -> "rose")
        for en, pt_full in GIFT_PT_MAP.items():
            if self._norm(pt_full) == base:
                aliases.add(self._norm(en))
                break
        return aliases

    def _gift_matches(self, incoming_norm: str, configured: str, incoming_id: str = None) -> bool:
        """Match de gift ID-first (catálogo) com fallback por nome EN ou PT."""
        cat = get_catalog()
        if cat is not None and incoming_id and configured:
            row = cat.resolve_ref(configured)
            if row and row.get("id"):
                return str(incoming_id).strip() == str(row["id"])
        return bool(configured) and incoming_norm in self._gift_aliases(configured)

    def process_gift(self, user, nickname, avatar, gift_name, gift_id=None, repeat=1):
        if not self.active or self.finished:
            return
        # Apoiador: qualquer gift na rodada vale multiplicador 2x
        is_new_supporter = user not in self.supporter_users
        self.supporter_users.add(user)
        if is_new_supporter:
            # Evento apenas visual (faixa de apoiadores na tela) — não altera pontuação/regras
            self._emit("tres_supporter", {"user": user, "nickname": nickname or user, "avatar": avatar or ""})
        n = self._norm(gift_name)
        cfg = self.gift_config
        if self._gift_matches(n, cfg.get("size"), gift_id) and not self.size_revealed:
            self.size_revealed = True
            self._emit("tres_reveal_size", {"user": user, "nickname": nickname or user, "len": len(self.palavra)})
            self._emit_log("gift.revealed_size", f"[3 Dicas] @{user} revelou o tamanho da palavra.", user=user,
                           word_length=len(self.palavra))
        elif self._gift_matches(n, cfg.get("letter"), gift_id) and self.size_revealed and not self.first_letter_revealed:
            self.first_letter_revealed = True
            self._emit("tres_reveal_letter", {"user": user, "nickname": nickname or user, "letter": self.palavra[0] if self.palavra else "", "palavra_len": len(self.palavra)})
            self._emit_log("gift.revealed_first_letter", f"[3 Dicas] @{user} revelou a primeira letra.",
                           user=user, word_length=len(self.palavra))
        elif self._gift_matches(n, cfg.get("letter"), gift_id) and not self.size_revealed:
            self._emit_log("gift.ignored", f"[3 Dicas] Presente da primeira letra ignorado: revele o tamanho antes.",
                           user=user, reason="size_not_revealed")

    # -------------------------------------------------------------
    # Loop asyncio (1s)
    # -------------------------------------------------------------
    async def _loop(self):
        try:
            while True:
                await asyncio.sleep(1)
                if not self.active or self.paused:
                    continue
                if self.phase == "pause":
                    self._tick_pause()
                elif not self.finished:
                    self._tick_timer()
        except asyncio.CancelledError:
            raise

    def _tick_pause(self):
        # Pausa entre rodadas (10s) — depois inicia a próxima automaticamente
        self.pause_remaining -= 1
        self._emit("tres_tick", {"phase": "pause", "remaining": self.pause_remaining})
        if self.pause_remaining <= 0:
            self.phase = "idle"
            if self._palavra_provider:
                loop = asyncio.get_running_loop()
                loop.create_task(self._autostart())

    async def _autostart(self):
        """Gera nova palavra/dicas e inicia a próxima rodada automaticamente."""
        try:
            if not self._palavra_provider:
                return
            trace_id = uuid.uuid4().hex
            res = self._palavra_provider(trace_id)
            if asyncio.iscoroutine(res):
                res = await res
            palavra, dicas = res
            if palavra:
                self.start(palavra, dicas, trace_id=trace_id)
                self._emit_log("round.auto_started", "[3 Dicas] Próxima rodada iniciada automaticamente.",
                               round_id=self.round_id)
            else:
                self._emit_log("round.auto_start_rejected", "[3 Dicas] Rodada automática não iniciada: palavra indisponível.",
                               level="warning", code="TRES_WORD_UNAVAILABLE")
        except Exception as e:
            self._emit_log("round.auto_start_failed", "[3 Dicas] Falha ao preparar a próxima rodada.",
                           level="error", code="TRES_AUTO_START_FAILED", error_type=type(e).__name__)

    def _tick_timer(self):
        # Fase countdown: espera antes de revelar a Dica 1
        if self.phase == "countdown":
            self.countdown_remaining -= 1
            self._emit("tres_tick", {"phase": "countdown", "remaining": self.countdown_remaining})
            if self.countdown_remaining <= 0:
                self.phase = "play"
                self.stage = 1
                self.stage_remaining = self.stage_times[1]
                self.wrong_guess_count = 0
                self._emit("tres_state", self.state(public=False))
                self._emit("tres_dica", {"stage": 1, "dica": self.dicas[0], "remaining": self.stage_remaining, "points": self.stage_points[1]})
                self._emit_log("clue.revealed", f"[3 Dicas] Dica 1 liberada ({self.stage_times[1]}s, {self.stage_points[1]} pts).",
                               stage=1, seconds=self.stage_times[1], points=self.stage_points[1])
            return
        self.stage_remaining -= 1
        # Tick visual a cada segundo (cronômetro fluido)
        self._emit("tres_tick", {"phase": "play", "stage": self.stage, "remaining": self.stage_remaining})
        if self.stage_remaining <= 0:
            if self.stage < 3:
                previous_stage = self.stage
                wrong_guess_count = self.wrong_guess_count
                self.stage += 1
                self.stage_remaining = self.stage_times[self.stage]
                self.wrong_guess_count = 0
                self._emit("tres_dica", {"stage": self.stage, "dica": self.dicas[self.stage - 1], "remaining": self.stage_remaining, "points": self.stage_points[self.stage]})
                self._emit_log("clue.revealed", f"[3 Dicas] Dica {self.stage} liberada ({self.stage_times[self.stage]}s, {self.stage_points[self.stage]} pts).",
                               stage=self.stage, previous_stage=previous_stage,
                               seconds=self.stage_times[self.stage], points=self.stage_points[self.stage],
                               wrong_guess_count=wrong_guess_count)
            else:
                # Tempo esgotado coletivamente
                wrong_guess_count = self.wrong_guess_count
                self.timeout = True
                self.finished = True
                self.phase = "pause"
                self.pause_remaining = TRES_PAUSE_AFTER_END
                self._emit("tres_timeout", {"palavra": self.palavra})
                self._emit("tres_state", self.state(public=False))
                self._emit_log("round.timed_out", "[3 Dicas] Tempo esgotado; rodada encerrada.",
                               stage=self.stage, wrong_guess_count=wrong_guess_count,
                               word_length=len(self.palavra))

    # -------------------------------------------------------------
    # Estado público
    # -------------------------------------------------------------
    def state(self, public=False):
        first = self.palavra[0] if (self.palavra and self.first_letter_revealed) else ""
        # O tamanho da palavra só aparece quando revelado (presente A/B) ou no fim
        len_visible = self.size_revealed or self.first_letter_revealed or self.finished
        return {
            "active": self.active,
            "round_id": self.round_id,
            "phase": self.phase,
            "countdown_remaining": self.countdown_remaining,
            "pause_remaining": self.pause_remaining,
            "stage": self.stage,
            "stage_remaining": self.stage_remaining,
            "stage_time": self.stage_times.get(self.stage, 0),
            "stage_points": self.stage_points.get(self.stage, 0),
            "paused": self.paused,
            "finished": self.finished,
            "timeout": self.timeout,
            "palavra": self.palavra if not public else (self.palavra if self.finished else None),
            "palavra_len": len(self.palavra) if len_visible else 0,
            "first_letter": first,
            "size_revealed": self.size_revealed,
            "first_letter_revealed": self.first_letter_revealed,
            "dicas": self.dicas,
            "winner": self.winner,
            "gift_config": self.gift_config,
            "stage_times": list(self.stage_times.values()),
            "stage_points": list(self.stage_points.values()),
        }
