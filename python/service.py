import asyncio
import json
import math
import os
import re
import sys
import threading
import time
import uuid
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from game import JogoContexto, CacaPalavras, VPetEngine, TresPontinhos, strip_accents, GIFT_PT_MAP
from duelo import DueloEngine
from corda import CordaEngine
from batalha import BatalhaEngine
from tiktools_handler import TikToolsHandler
from tiktoklive_handler import TikTokLiveHandler
from contexto_public import handle_public_command
import db
import tts
import elevenlabs_tts

TTS_AUDIO_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "node", "public", "tts-audio")
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://painel.tikplay.com.br")
CHAT_NARRATION_QUEUE_SIZE = 10
CHAT_NARRATION_MAX_AGE_SECONDS = 10.0
CHAT_NARRATION_STATS_INTERVAL = 30.0
_elevenlabs_test_tasks = set()

_gifts_sync_running = False


from service_common import (
    DEFAULT_SETTINGS, normalize_settings, get_rank_color, emit,
    bind_session_id, reset_session_id, set_active_session_id, clear_active_session_id,
)


async def _test_elevenlabs_voice(tid, trace_id):
    try:
        audio_path, code = await asyncio.to_thread(
            elevenlabs_tts.synthesize, tid,
            "Prévia da voz adicional.",
            os.path.join(TTS_AUDIO_ROOT, str(tid)))
    except Exception:
        audio_path, code = None, "SYNTHESIS_FAILED"
    if audio_path:
        emit(tid, "tts_test_ready", f"/tts-audio/{tid}/{os.path.basename(audio_path)}")
    emit_service_log(tid, "diagnostic" if audio_path else "error", "debug" if audio_path else "error",
                     "tts.provider.completed" if audio_path else "tts.provider.failed",
                     "Prévia da voz adicional concluída." if audio_path else "Não foi possível gerar a prévia da voz adicional.",
                     game="tts", trace_id=trace_id, code=code, details={"operation": "test"})


async def generate_openrouter_riddle(secret_word: str, words: list) -> str:
    api_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    words_str = ", ".join(words)
    if api_key:
        try:
            import urllib.request
            req_body = json.dumps({
                "model": "openai/gpt-5.6-luna",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            f'Você é um mestre de charadas de um jogo de palavras estilo Contexto. A palavra secreta é "{secret_word}". '
                            f'Crie uma charada curta, em português do Brasil, de EXATAMENTE 2 frases, misteriosa e desafiadora, mas com solução justa. '
                            f'REGRAS OBRIGATÓRIAS: '
                            f'1) NUNCA escreva a palavra secreta nem sinônimos diretos dela no texto. '
                            f'2) NUNCA mencione a categoria/classe da palavra nem as características mais óbvias (ex.: se a secreta for "verão", não diga "estação", "calor" nem "praia" como resposta direta). '
                            f'3) NÃO termine perguntando diretamente o que é (evite "o que é?", "qual é a estação?", etc.); o enigma deve levar à resposta por dedução, não por definição. '
                            f'4) Use as palavras de pista abaixo de forma DISFARÇADA, como metáfora/analogia indireta, sem citá-las literalmente como dica óbvia. '
                            f'Palavras de pista: {words_str}.'
                        )
                    },
                    {
                        "role": "user",
                        "content": "Crie a charada agora para a live do TikTok sem citar a palavra secreta."
                    }
                ],
                "reasoning": {"effort": "none"},
                "max_tokens": 200
            }).encode("utf-8")
            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/chat/completions",
                data=req_body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": PUBLIC_BASE_URL,
                    "X-Title": "Jogo Contexto TikTok"
                },
                method="POST"
            )
            loop = asyncio.get_running_loop()
            with await loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=8)) as resp:
                res_data = json.loads(resp.read().decode("utf-8"))
                text = res_data["choices"][0]["message"]["content"].strip()
                if text:
                    return text
        except Exception:
            pass

    # fallback
    word_a = words[0] if len(words) > 0 else "mistério"
    word_b = words[1] if len(words) > 1 else "segredo"
    word_c = words[2] if len(words) > 2 else "charada"
    return f"Estou pensando em algo que tem relação com {word_a}, traz à mente {word_b} e se conecta com {word_c}. Você sabe o que é?"


async def generate_tres_dicas(secret_word: str, log_cb=None) -> list:
    """Gera 3 dicas progressivas (difícil → fácil) para a palavra secreta.

    Retorna uma lista de 3 strings. Fallback textual caso a API falhe.
    """
    started_at = time.perf_counter()

    def report(event, **details):
        if log_cb:
            try:
                log_cb(event, details)
            except Exception:
                pass

    api_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    fallback = [
        "Ixi, a inteligência artificial foi lá tratar das cabras...",
        "O sistema deu uma cochilada ouvindo moda de viola...",
        f"Rodada brinde para os rápidos! A palavra é: {secret_word.upper()}"
    ]
    if not api_key:
        report("generation.fallback", reason="api_key_unavailable", duration_ms=round((time.perf_counter() - started_at) * 1000))
        return fallback
    import urllib.request
    root_norm = strip_accents(secret_word).lower()
    root_len = max(3, len(root_norm) - 2)
    last_error_type = None
    for attempt in range(2):
        try:
            req_body = json.dumps({
                "model": "openai/gpt-4o-mini",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                        f'Você cria 3 dicas progressivas para um jogo de adivinhação estilo '
                        f'charada de programa de TV. A palavra secreta é "{secret_word}". '
                        f'REGRAS DE OURO:\n'
                        f'1. PROIBIÇÃO ABSOLUTA: NUNCA use a palavra secreta, partes dela, '
                        f'plurais, conjugações ou família lexical.\n'
                        f'2. ESTILO CHARADA: Nada de tom de dicionário ("É uma palavra que..."). '
                        f'Use frases curtas, misteriosas e lógicas. Zero poesia abstrata.\n'
                        f'3. DIVERSIDADE: Cada dica deve abordar um ângulo diferente da palavra. '
                        f'NÃO repita a mesma ideia ou o mesmo verbo principal '
                        f'(ex: se a palavra for "Pedágio", não use "pagar" em todas as dicas).\n'
                        f'4. Tamanho: MÁXIMO de 8 palavras por dica.\n'
                        f'PROGRESSÃO DE DIFICULDADE:\n'
                        f'- Dica 1 (DIFÍCIL, 30pts): Muito indireta. Foque em um detalhe visual, '
                        f'um som, um material, ou um contexto distante. NUNCA entregue a função '
                        f'principal aqui.\n'
                        f'- Dica 2 (MÉDIA, 20pts): Uma característica física marcante, quem costuma '
                        f'usar, ou uma consequência prática.\n'
                        f'- Dica 3 (FÁCIL, 10pts): A função principal da palavra, uma gíria ou um '
                        f'cenário do dia a dia onde ela se encaixa perfeitamente.\n'
                        f'EXEMPLOS PARA "PEDÁGIO":\n'
                        f'  D1: "Tem cancela e luz vermelha" (Contexto visual)\n'
                        f'  D2: "Faz a viagem de carro ficar mais cara" (Consequência prática)\n'
                        f'  D3: "Fica bem no meio da rodovia" (Localização clara)\n'
                        f'EXEMPLOS PARA "REINO":\n'
                        f'  D1: "Possui um trono muito valioso" (Associação de objetos)\n'
                        f'  D2: "Tem sempre um bobo da corte animando" (Associação de pessoas)\n'
                        f'  D3: "Território onde o monarca manda em tudo" (Quase óbvia)\n'
                        f'Resposta APENAS com JSON puro: {{"dicas": ["dica1", "dica2", "dica3"]}}'
                    )
                },
                    {"role": "user", "content": "Gere as 3 dicas agora."}
                ],
                "temperature": 0.7,
                "max_tokens": 300,
                "response_format": {"type": "json_object"},
            }).encode("utf-8")
            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/chat/completions",
                data=req_body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": PUBLIC_BASE_URL,
                    "X-Title": "Jogo 3 Dicas TikTok"
                },
                method="POST"
            )
            loop = asyncio.get_running_loop()
            with await loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=10)) as resp:
                res_data = json.loads(resp.read().decode("utf-8"))
                text = res_data["choices"][0]["message"]["content"].strip()
                parsed = json.loads(text)
                dicas = [str(d).strip() for d in parsed.get("dicas", [])]
                # Capitaliza a primeira letra de cada dica
                dicas = [d[0].upper() + d[1:] if d else d for d in dicas]
                if len(dicas) >= 3 and all(dicas):
                    # Reforço da regra de ouro: descarta se alguma dica contém a raiz/derivação
                    cleaned = [strip_accents(d).lower() for d in dicas]
                    used_root = any(root_norm[:root_len] in c for c in cleaned)
                    if not used_root:
                        report("generation.completed", attempts=attempt + 1,
                               duration_ms=round((time.perf_counter() - started_at) * 1000))
                        return dicas[:3]
        except Exception as exc:
            last_error_type = type(exc).__name__
            continue
    report("generation.fallback", reason=last_error_type or "invalid_provider_response",
           attempts=2, duration_ms=round((time.perf_counter() - started_at) * 1000))
    return fallback


class GameSession:
    def __init__(self, tenant_id, username, api_key, history_path, gift_tags, engine="tiktools", session_id=None, connect_trace_id=None):
        self.tenant_id = tenant_id
        self.session_id = str(session_id or uuid.uuid4().hex)
        self.connect_trace_id = str(connect_trace_id or "") or None
        self.shutdown_trace_id = None
        self.username = username
        self.api_key = api_key
        self.engine = engine or "tiktools"
        self.game = JogoContexto(tenant_id=tenant_id, gift_tags=gift_tags)
        self.battle = BatalhaEngine(tenant_id)
        self.caca = CacaPalavras()
        self.caca_prefix = ""
        self.vpet = VPetEngine(tenant_id, emit_cb=self._emit_vpet)
        self._vpet_task = None
        self.tres = TresPontinhos(tenant_id, emit_cb=self._emit_tres, palavra_provider=self._tres_next_round)
        self._tres_task = None
        self.corda = CordaEngine(emit_cb=self._emit_duelo)
        self._corda_task = None
        self.duelo = DueloEngine(tenant_id, emit_cb=self._emit_duelo)
        self._duelo_reset_task = None
        self._duelo_match_task = None
        self._duelo_timer_task = None
        self._duelo_round_result_task = None
        self._duelo_round_ends_at = 0
        # Passe Livre: usuários que enviaram o gift ingresso podem palpitar no 3 Pontinhos
        self._tres_allowed = set()
        HandlerCls = TikTokLiveHandler if self.engine == "tiktoklive" else TikToolsHandler
        self.handler = HandlerCls(
            username,
            api_key,
            on_comment=self.on_comment,
            on_gift=self.on_gift,
            on_like=self.on_like,
            on_share=self.on_share,
            on_join=self.on_member,
            on_follow=self.on_follow,
            on_level_up=self.on_level_up,
        )
        self.handler._emit_status = self.emit_status
        self.handler.log_cb = lambda text: emit(self.tenant_id, "log", text)
        self.queue = asyncio.create_task if False else asyncio.Queue()
        self._chat_narration_queue = asyncio.Queue(maxsize=CHAT_NARRATION_QUEUE_SIZE)
        self._chat_narration_task = None
        self._chat_narration_epoch = 0
        self._chat_narration_stats = {
            "received": 0,
            "filtered": 0,
            "queued": 0,
            "synthesized": 0,
            "synthesized_characters": 0,
            "synthesis_duration_ms": 0,
            "stale": 0,
            "failed": 0,
            "dropped": 0,
        }
        self._chat_narration_stats_at = time.monotonic()
        self._chat_narration_configs = set()
        self._chat_narration_overflow_at = 0.0
        self._chat_narration_error_at = 0.0
        self.task = None
        self.likes = {}
        self._likes_dirty = False
        self._likes_loop_task = None
        # Sala (live) atual — dados de curtidas/ranking são escopados por room_id.
        self.current_room_id = None
        # Últimos níveis vistos por (room_id, user) — dedupe de observações.
        self._viewer_levels = {}
        # Meta de tap (likes) da Palavra Secreta: enche barra e libera dica/charada
        self.tap_meta_current = 0
        self.tap_meta_total = 1000
        self.tap_meta_ready = False
        self._tap_meta_cooldown_until = 0
        self._preparing = False
        self._last_logged_status = None
        self.settings = dict(DEFAULT_SETTINGS)
        try:
            db_settings = db.get_tenant_settings(tenant_id)
            if isinstance(db_settings, dict) and db_settings:
                self.settings = normalize_settings(db_settings)
        except Exception:
            pass
        self._tap_meta_x2 = False
        self.game.boss_mode = bool(self.settings.get("boss_mode", True))

    @staticmethod
    def _is_follower(meta) -> bool:
        if not meta:
            return False
        if meta.get("is_follower") is True:
            return True
        try:
            return int(meta.get("follow_role") or 0) >= 1
        except (TypeError, ValueError):
            return False

    @staticmethod
    def _is_heartme(meta) -> bool:
        if not meta:
            return False
        if meta.get("is_subscriber") is True:
            return True
        for badge in meta.get("badges") or []:
            if isinstance(badge, dict):
                bname = str(badge.get("name") or "")
            else:
                bname = str(getattr(badge, "name", None) or "")
            name = bname.lower()
            if any(k in name for k in ("coracao", "coração", "heart", "fan", "sub", "membro")):
                return True
        return False

    def _check_access(self, meta) -> tuple:
        """Aplica os filtros de engajamento configurados.

        Retorna (permitido: bool, motivo: str).
        Sem filtros ativos => sempre permite.
        Com filtro ativo e dado ausente/indeterminado => bloqueia (fail-closed).
        """
        active = [f for f in ("apenas_seguidores", "apenas_heart_me") if self.settings.get(f)]
        if not active:
            return (True, "")
        if not meta:
            return (False, "sem_dados")
        checks = []
        for flag in active:
            label = "seguidor" if flag == "apenas_seguidores" else "heart-me"
            ok = self._is_follower(meta) if flag == "apenas_seguidores" else self._is_heartme(meta)
            if not ok:
                return (False, f"nao_{label}")
            checks.append(label)
        return (True, ",".join(checks))

    def _emit_interaction(self, type_, user, nickname, avatar, value=0, meta=None,
                          event_id=None, room_id=None, user_id=""):
        """Envia um evento normalizado de interacao para o Node persistir (em lote)."""
        payload = {
            "type": type_,
            "room_id": str(room_id or self.current_room_id or ""),
            "event_id": str(event_id or ""),
            "ts": int(time.time() * 1000),
            "user_id": str(user_id or self._stable_uid(user)),
            "username": str(user or ""),
            "nickname": str(nickname or user or ""),
            "avatar": str(avatar or ""),
            "value": int(value or 0),
        }
        if meta:
            payload["meta"] = meta
        emit(self.tenant_id, "interaction", payload)

    def _palavra_debug(self, event, **details):
        """Log estruturado do fluxo Palavra Secreta; nunca inclui palavra secreta,
        texto de charada ou comentário bruto."""
        self._log_event(
            category="diagnostic",
            level="debug",
            event="palavra." + str(event),
            message="[debug][Palavra] " + str(event),
            game="palavra",
            game_id=details.pop("game_id", None),
            trace_id=details.pop("trace_id", None),
            code=details.pop("code", None),
            duration_ms=details.pop("duration_ms", None),
            details=details,
        )

    def _log_event(self, category, level, event, message, game="", game_id=None,
                   trace_id=None, code=None, duration_ms=None, details=None):
        """Emite um evento de log com metadados persistíveis e sem payload bruto."""
        emit(self.tenant_id, "log", {
            "text": str(message or ""),
            "category": str(category or "system"),
            "level": str(level or "info"),
            "game": str(game or ""),
            "event": str(event or "legacy.message"),
            "source": "python",
            "game_id": str(game_id) if game_id is not None else None,
            "trace_id": str(trace_id) if trace_id else None,
            "code": str(code) if code else None,
            "duration_ms": duration_ms,
            "details": details if details else None,
        })

    def _ensure_room(self, room_id):
        """Detecta troca de sala. Nova sala => abre nova sessao de live e zera o
        ranking/acumulador de curtidas (dados sao por live). NAO encerra partidas."""
        rid = str(room_id or "").strip()
        if not rid or rid == self.current_room_id:
            return
        self.current_room_id = rid
        self.likes = {}
        self._viewer_levels = {}
        self._likes_dirty = True
        emit(self.tenant_id, "live_session", {
            "state": "start",
            "room_id": rid,
            "engine": self.engine,
            "username": self.username,
            "ts": int(time.time() * 1000),
        })
        # Publica ranking vazio imediatamente (a live anterior nao vaza).
        pub = self._tap_meta_public()
        emit(self.tenant_id, "game", {
            "type": "likes_ranking",
            "ranking": [],
            "tap_meta_current": pub["tap_meta_current"],
            "tap_meta_total": pub["tap_meta_total"],
            "tap_meta_ready": pub["tap_meta_ready"],
            "tap_meta_multiplier": pub["tap_meta_multiplier"],
        })
        emit(self.tenant_id, "log", f"[Live] Nova sala detectada ({rid}) — ranking de curtidas reiniciado")

    def _track_levels(self, user, nickname, avatar, user_meta, room_id=None, level_up_axis=None, event_id=None):
        """Observa os níveis do usuário (presenteador/fã-clube) e emite ao Node só
        quando há valor válido e mudou desde a última vista na sala. O Node decide
        se foi subida (Antes > Depois) e se deve animar."""
        if not user_meta:
            return
        try:
            g = int(user_meta.get("gifter_level") or 0)
        except (TypeError, ValueError):
            g = 0
        try:
            f = int(user_meta.get("fan_club_level") or 0)
        except (TypeError, ValueError):
            f = 0
        if g <= 0 and f <= 0:
            return
        rid = str(room_id or self.current_room_id or "")
        key = (rid, str(user or ""))
        prev = self._viewer_levels.get(key)
        if prev is not None and prev[0] == g and prev[1] == f and not level_up_axis:
            return
        self._viewer_levels[key] = (g, f)
        emit(self.tenant_id, "viewer_level", {
            "room_id": rid,
            "user_id": self._stable_uid(user, user_meta),
            "username": str(user or ""),
            "nickname": str(nickname or user or ""),
            "avatar": str(avatar or ""),
            "gifter_level": g or 0,
            "gifter_grade": str(user_meta.get("gifter_grade") or ""),
            "fan_club_level": f or 0,
            "fan_club_name": str(user_meta.get("fan_club_name") or ""),
            "level_up_axis": level_up_axis,
            "event_id": str(event_id or ""),
            "ts": int(time.time() * 1000),
        })

    async def on_level_up(self, user, nickname, avatar, user_meta=None, axis="fanclub", level=0, room_id=None, event_id=None):
        """Promoção explícita de nível (barrage do TikTokLive): presenteador ou fã-clube."""
        self._ensure_room(room_id)
        meta = dict(user_meta or {})
        key = "gifter_level" if axis == "gifter" else "fan_club_level"
        try:
            meta[key] = int(level or meta.get(key) or 0)
        except (TypeError, ValueError):
            meta[key] = 0
        if meta[key] <= 0:
            return
        self._track_levels(user, nickname, avatar, meta, room_id, level_up_axis=axis, event_id=event_id)

    def _rate_value(self) -> float:
        try:
            rate = float(self.settings.get("tts_rate", 1.0))
            return rate if math.isfinite(rate) else 1.0
        except (TypeError, ValueError):
            return 1.0

    def _tts_config_snapshot(self) -> dict:
        return {
            "voice_key": str(self.settings.get("tts_voice") or tts.VOICE_EDGE_ANTONIO),
            "rate": self._rate_value(),
        }

    def _record_chat_narration(self, key: str, amount: int = 1):
        stats = self._chat_narration_stats
        stats[key] = int(stats.get(key, 0)) + int(amount)
        now = time.monotonic()
        if now - self._chat_narration_stats_at < CHAT_NARRATION_STATS_INTERVAL:
            return
        self._flush_chat_narration_stats(now)

    def _flush_chat_narration_stats(self, now=None):
        now = time.monotonic() if now is None else now
        stats = self._chat_narration_stats
        summary = {name: value for name, value in stats.items() if value}
        if summary:
            self._log_event(
                "chat", "info", "chat.tts.batch", "Resumo agregado da narração do chat.",
                details={
                    **summary,
                    "window_ms": round((now - self._chat_narration_stats_at) * 1000),
                    "configurations": [
                        {"voice": voice, "rate": rate}
                        for voice, rate in sorted(self._chat_narration_configs)
                    ],
                    "queue_limit": CHAT_NARRATION_QUEUE_SIZE,
                },
            )
            self._chat_narration_stats = {name: 0 for name in stats}
            self._chat_narration_configs.clear()
        self._chat_narration_stats_at = now

    def _enqueue_chat_narration(self, user: str, text: str):
        if not self.settings.get("chat_narr_enabled"):
            return
        self._record_chat_narration("received")
        if str(user or "").lstrip("@").casefold() == str(self.username or "").lstrip("@").casefold():
            self._record_chat_narration("filtered")
            return

        cleaned = tts.prepare_chat_text(
            text,
            mode=self.settings.get("chat_narr_mode", "all"),
            marker=self.settings.get("chat_narr_char", "#"),
        )
        if not cleaned:
            self._record_chat_narration("filtered")
            return

        item = {
            "text": cleaned,
            "queued_at": time.monotonic(),
            "epoch": self._chat_narration_epoch,
            **self._tts_config_snapshot(),
        }
        try:
            self._chat_narration_queue.put_nowait(item)
            self._chat_narration_configs.add((item["voice_key"], item["rate"]))
            self._record_chat_narration("queued")
        except asyncio.QueueFull:
            self._record_chat_narration("dropped")
            now = time.monotonic()
            if now - self._chat_narration_overflow_at >= CHAT_NARRATION_STATS_INTERVAL:
                self._chat_narration_overflow_at = now
                self._log_event(
                    "chat", "warning", "chat.tts.queue_full",
                    "Fila de narração do chat cheia; novos comentários foram descartados.",
                    code="TTS_CHAT_QUEUE_FULL",
                    details={"queue_limit": CHAT_NARRATION_QUEUE_SIZE},
                )

    def _reset_chat_narration(self, enabled: bool):
        self._chat_narration_epoch += 1
        drained = 0
        while True:
            try:
                self._chat_narration_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            else:
                self._chat_narration_queue.task_done()
                drained += 1
        if drained:
            self._record_chat_narration("stale", drained)
        emit(self.tenant_id, "narrate", {"reset": True, "enabled": bool(enabled)})

    async def _chat_narration_worker(self):
        while True:
            item = await self._chat_narration_queue.get()
            synthesis_started = time.perf_counter()
            try:
                if (item["epoch"] != self._chat_narration_epoch
                        or not self.settings.get("chat_narr_enabled")
                        or time.monotonic() - item["queued_at"] > CHAT_NARRATION_MAX_AGE_SECONDS):
                    self._record_chat_narration("stale")
                    continue
                audio_url = await self._chat_tts_url(item)
                if audio_url:
                    age = time.monotonic() - item["queued_at"]
                    if (item["epoch"] != self._chat_narration_epoch
                            or not self.settings.get("chat_narr_enabled")
                            or age > CHAT_NARRATION_MAX_AGE_SECONDS):
                        self._record_chat_narration("stale")
                        continue
                    # Usa o caminho daemon → Node → clientes de log já existente.
                    emit(self.tenant_id, "narrate", {
                        "url": audio_url,
                        "expires_in_ms": max(0, round((CHAT_NARRATION_MAX_AGE_SECONDS - age) * 1000)),
                    })
                    self._record_chat_narration("synthesized")
                    self._record_chat_narration("synthesized_characters", len(item["text"]))
                    self._record_chat_narration(
                        "synthesis_duration_ms",
                        round((time.perf_counter() - synthesis_started) * 1000),
                    )
                else:
                    self._record_chat_narration("failed")
                    self._log_chat_narration_failure("EDGE_TTS_NO_AUDIO", item)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._record_chat_narration("failed")
                self._log_chat_narration_failure(type(exc).__name__, item)
            finally:
                self._chat_narration_queue.task_done()

    def _log_chat_narration_failure(self, reason: str, item: dict):
        now = time.monotonic()
        if now - self._chat_narration_error_at < 5.0:
            return
        self._chat_narration_error_at = now
        self._log_event(
            "error", "error", "chat.tts.failed",
            "Não foi possível gerar o áudio de um comentário.", game="chat",
            code="TTS_CHAT_SYNTHESIS_FAILED",
            details={
                "reason": str(reason)[:80],
                "voice": str(item.get("voice_key") or "")[:40],
                "rate": item.get("rate"),
            },
        )

    async def _chat_tts_url(self, item):
        try:
            path, code = await asyncio.to_thread(
                elevenlabs_tts.synthesize, self.tenant_id, item["text"],
                os.path.join(TTS_AUDIO_ROOT, str(self.tenant_id)), item["rate"])
            if path:
                self._record_chat_narration("elevenlabs_synthesized")
                return f"/tts-audio/{self.tenant_id}/{os.path.basename(path)}"
        except elevenlabs_tts.ProviderError as exc:
            code = str(exc)
        except Exception:
            code = "PROVIDER_UNAVAILABLE"
        if code not in ("NOT_CONFIGURED", "NOT_SELECTED", "NOT_AVAILABLE"):
            now = time.monotonic()
            if now - getattr(self, "_elevenlabs_failure_at", 0) >= 30:
                self._elevenlabs_failure_at = now
                self._log_event("notice", "warning", "tts.provider.fallback",
                                "Voz adicional indisponível; usando a voz padrão.",
                                code=code, details={"engine": "additional_voice"})
        return await self._tts_url(item["text"], voice_key=item["voice_key"], rate=item["rate"])

    async def _tts_url(self, text: str, voice_key: str = None, rate: float = None) -> str:
        """Gera áudio pelo Edge com voz/taxa explícitas e retorna sua URL pública."""
        if not text:
            return None
        cfg = self._tts_config_snapshot()
        voice_key = str(voice_key or cfg["voice_key"])
        rate = cfg["rate"] if rate is None else float(rate)
        audio_dir = os.path.join(TTS_AUDIO_ROOT, str(self.tenant_id))
        try:
            audio_path = await asyncio.to_thread(tts.synthesize_edge, text, audio_dir, voice_key, rate)
            if not audio_path:
                # Edge e flaky: tenta mais uma vez (1ª falha pode ser transitoria)
                await asyncio.sleep(0.8)
                audio_path = await asyncio.to_thread(tts.synthesize_edge, text, audio_dir, voice_key, rate)
        except Exception:
            return None
        if not audio_path:
            return None
        return f"/tts-audio/{self.tenant_id}/{os.path.basename(audio_path)}"

    async def _narrate_riddle_async(self, stage, riddle_text, trace_id=None, tts_config=None):
        """Gera o áudio da charada em background (não trava a liberação na live)
        e emite 'riddle_audio' quando o mp3 fica pronto."""
        config = dict(tts_config or self._tts_config_snapshot())
        started = time.perf_counter()
        self._palavra_debug(
            "riddle.tts_started", game_id=self.game.game_id, trace_id=trace_id,
            stage=stage, text_length=len(riddle_text or ""),
            voice=config.get("voice_key"), rate=config.get("rate"),
        )
        try:
            audio_url = await self._tts_url(
                riddle_text,
                voice_key=config.get("voice_key"),
                rate=config.get("rate"),
            )
        except Exception as e:
            audio_url = None
            error_type = type(e).__name__
        else:
            error_type = "EdgeUnavailable"
        duration_ms = round((time.perf_counter() - started) * 1000)
        if not audio_url:
            self._log_event(
                "error", "error", "tts.riddle_audio.failed",
                "Não foi possível gerar o áudio da charada.", game="palavra",
                game_id=getattr(self.game, "game_id", None), trace_id=trace_id,
                code="TTS_RIDDLE_SYNTHESIS_FAILED", duration_ms=duration_ms,
                details={"stage": stage, "error_type": error_type,
                         "voice": config.get("voice_key"), "rate": config.get("rate")},
            )
            return
        self._palavra_debug(
            "riddle.tts_completed", game_id=self.game.game_id, trace_id=trace_id,
            stage=stage, duration_ms=duration_ms,
            voice=config.get("voice_key"), rate=config.get("rate"),
        )
        emit(self.tenant_id, "game", {
            "type": "riddle_audio",
            "stage": stage,
            "audio_url": audio_url,
        })

    def _command_prefix(self) -> str:
        p = self.settings.get("command_prefix")
        if p is None:
            return "#"
        return str(p)

    def _throttled_log(self, key, text, game="sistema", level="info", secs=2.0,
                       event=None, trace_id=None, details=None):
        """Log estruturado com throttle por chave (evita flood no diagnóstico)."""
        now = time.time()
        last = getattr(self, "_log_last", {})
        if now - last.get(key, -999) < secs:
            return
        last[key] = now
        self._log_last = last
        game_id = str(game or "").strip().lower()
        if game_id in ("sistema", "system"):
            game_id = ""
        event_scope = game_id or "system"
        emit(self.tenant_id, "log", {
            "text": text,
            "game": game_id,
            "level": level,
            "event": event or f"{event_scope}.throttled",
            "source": "python",
            "trace_id": trace_id,
            "details": details or None,
        })

    def _stable_uid(self, user, user_meta=None):
        try:
            if user_meta:
                if hasattr(user_meta, "userId") and getattr(user_meta, "userId", None):
                    return str(getattr(user_meta, "userId"))
                if hasattr(user_meta, "uniqueId") and getattr(user_meta, "uniqueId", None):
                    return str(getattr(user_meta, "uniqueId"))
                if hasattr(user_meta, "secUid") and getattr(user_meta, "secUid", None):
                    return str(getattr(user_meta, "secUid"))
                if isinstance(user_meta, dict):
                    for k in ("userId", "user_id", "uniqueId", "unique_id", "secUid", "sec_uid", "id"):
                        v = user_meta.get(k)
                        if v:
                            return str(v)
        except Exception:
            pass
        return str(user or "")

    def _duelo_handle_tap(self, user, like_count, user_meta=None, avatar=""):
        if not (self.duelo.active and self.duelo._is_hp_new() and self.duelo.roundActive):
            return
        try:
            uid = self._stable_uid(user, user_meta)
            metas = self.duelo.add_tap(uid, like_count)
            if metas:
                emit(self.tenant_id, "log", f"[Duelo] META DE TAP! {metas} ataque(s) automático(s) disparado(s)")
            if self.duelo.active and self.duelo.roundActive and not self.duelo.winner:
                side = self.duelo.get_team(uid)
                if side and avatar:
                    emit(self.tenant_id, "game", {
                        "type": "duelo_tap_avatar_burst",
                        "side": side,
                        "user_id": uid,
                        "unique_id": user or "",
                        "avatar_url": str(avatar or ""),
                        "delta": int(like_count or 0),
                    })
            if self.duelo.winner and not self.duelo.roundActive and not self.duelo.final:
                delay = int(self.duelo.settings.get("reset_delay_s", 6) or 6)
                self._schedule_duelo_reset(delay)
                emit(self.tenant_id, "log", f"[Duelo] KO por meta — nova batalha em {delay}s")
        except Exception as e:
            self._log_event("error", "error", "duelo.tap.processing_failed",
                            "[Duelo] Falha ao processar o TAP.", game="duelo",
                            code="DUELO_TAP_PROCESSING_FAILED", details={"error_type": type(e).__name__})

    def _duelo_comment_team(self, user, raw, user_meta=None, avatar="", nickname=""):
        if not (self.duelo.active and self.duelo._is_hp_new()):
            return
        try:
            norm = strip_accents(raw or "").lower()
            words = set(re.findall(r"[a-z0-9]+", norm))
            if "flavio" in words or "bolsonaro" in words or "22" in words or "azul" in words:
                side = "flavio"
            elif "lula" in words or "13" in words or "vermelho" in words:
                side = "lula"
            else:
                return
            uid = self._stable_uid(user, user_meta)
            old = self.duelo.get_team(uid)
            if self.duelo.register_team(uid, side):
                emit(self.tenant_id, "log", f"[Duelo] @{user} escolheu equipe {side.upper()}" + (" (troca)" if old and old != side else ""))
                if old != side:
                    emit(self.tenant_id, "game", {
                        "type": "duelo_team_join",
                        "side": side,
                        "user_id": uid,
                        "unique_id": user or "",
                        "nickname": nickname or user or "",
                        "avatar_url": str(avatar or ""),
                    })
        except Exception as e:
            self._log_event("error", "error", "duelo.team_registration_failed",
                            "[Duelo] Falha ao registrar a equipe.", game="duelo",
                            code="DUELO_TEAM_REGISTRATION_FAILED", details={"error_type": type(e).__name__})

    async def on_share(self, user, nickname, avatar, user_meta=None, room_id=None, event_id=None):
        self._ensure_room(room_id)
        self._track_levels(user, nickname, avatar, user_meta, room_id, event_id=event_id)
        self._emit_interaction("share", user, nickname, avatar, event_id=event_id, room_id=room_id,
                               user_id=self._stable_uid(user, user_meta))
        allowed, _ = self._check_access(user_meta)
        if allowed:
            self.corda.share(self._stable_uid(user, user_meta), user, nickname, avatar)

    async def on_follow(self, user, nickname, avatar, user_meta=None, room_id=None, event_id=None):
        self._ensure_room(room_id)
        self._track_levels(user, nickname, avatar, user_meta, room_id, event_id=event_id)
        self._emit_interaction("follow", user, nickname, avatar, event_id=event_id, room_id=room_id,
                               user_id=self._stable_uid(user, user_meta))
        emit(self.tenant_id, "log", f"[Follow] @{user} começou a seguir")

    async def on_like(self, user, nickname, avatar, like_count, user_meta=None, room_id=None, event_id=None):
        self._ensure_room(room_id)
        self._track_levels(user, nickname, avatar, user_meta, room_id, event_id=event_id)
        # BICHINHO VIRTUAL: likes dão energia/atacam o boss (independe do filtro de tap)
        if self.vpet.active:
            self.vpet.on_like(user, nickname, avatar, like_count)
        # Atividade visual do overlay inclui todos os espectadores, mesmo quando
        # filtros de acesso bloqueiam os taps para a pontuação dos jogos.
        try:
            activity_count = max(0, int(like_count or 0))
        except (TypeError, ValueError):
            activity_count = 0
        if activity_count > 0:
            emit(self.tenant_id, "game", {
                "type": "likes_activity",
                "user": str(user or ""),
                "nickname": str(nickname or user or ""),
                "avatar": str(avatar or ""),
                "like_count": activity_count,
            })
            # Relatório: curtidas de todos os espectadores (engajamento da live).
            self._emit_interaction("like", user, nickname, avatar, value=activity_count,
                                   event_id=event_id, room_id=room_id,
                                   user_id=self._stable_uid(user, user_meta))
        allowed, reason = self._check_access(user_meta)
        if not allowed:
            emit(self.tenant_id, "log", f"[Access] @{user} bloqueado ({reason}): tap ignorado")
            return
        entry = self.likes.get(user)
        if entry is None:
            entry = {"user": user, "nickname": nickname, "avatar": avatar, "likes": 0}
            self.likes[user] = entry
        entry["likes"] += like_count
        if nickname:
            entry["nickname"] = nickname
        if avatar:
            entry["avatar"] = avatar
        self._likes_dirty = True
        self.battle.add_taps(user, nickname, avatar, like_count)
        self.corda.like(self._stable_uid(user, user_meta), like_count, avatar, user, nickname)
        self._duelo_handle_tap(user, like_count, user_meta, avatar)
        # Meta de tap da Palavra Secreta: durante o Final Boss ela fica CONGELADA
        # (não incrementa nem dispara ações da meta enquanto o Boss estiver ativo).
        if not self.game.finished and not getattr(self.game, "is_final_boss", False):
            self.tap_meta_current += int(like_count or 0)

    def _tap_meta_public(self) -> dict:
        """Estado da meta enviado à página pública.

        Durante o Final Boss a meta fica congelada (valor não avança) e é exibida
        como concluída (verde): tap_meta_ready = True mesmo que os taps ainda não
        tenham atingido o total. Prêmio devido (meta já atingida) fica retido até
        o fim do Boss, sem despachar nada enquanto ele estiver ativo.
        """
        return {
            "tap_meta_current": int(self.tap_meta_current or 0),
            "tap_meta_total": int(self.tap_meta_total or 1000),
            "tap_meta_ready": bool(self.tap_meta_ready) or bool(getattr(self.game, "is_final_boss", False)),
            "tap_meta_multiplier": 2 if getattr(self, "_tap_meta_x2", False) else 1,
        }

    def _apply_tap_meta_x2(self) -> bool:
        """Sem Modo Boss: ao chegar na zona que ativaria o Final Boss (melhor rank <= 3),
        a meta de tap DOBRA (x2) mantendo o progresso atual. Dispara uma única vez por partida."""
        if self._tap_meta_x2:
            return False
        if not self.game.secret_word or self.game.finished:
            return False
        if not self.game._hint_protected():
            return False
        base = int(self.settings.get("tap_meta", 1000) or 1000)
        self._tap_meta_x2 = True
        self.tap_meta_total = max(50, base * 2)
        self._likes_dirty = True
        emit(self.tenant_id, "game", {
            "type": "tap_meta_x2",
            "base": base,
            "total": self.tap_meta_total,
            "current": int(self.tap_meta_current or 0),
        })
        emit(self.tenant_id, "log", f"[Tap] Zona protegida (sem boss): meta de tap DOBROU para {self.tap_meta_total} (x2)")
        return True

    async def _likes_loop(self):
        while True:
            await asyncio.sleep(3)
            # Sem Modo Boss, ao entrar na zona protegida (rank <= 3) a meta dobra (x2).
            self._apply_tap_meta_x2()
            # Durante o Final Boss mantém a marcação "concluída" (verde) na página,
            # mesmo sem likes novos; sem boss, só emite quando houver mudanças.
            if not self._likes_dirty and not getattr(self.game, "is_final_boss", False):
                continue
            self._likes_dirty = False
            ranking = self.build_likes_ranking(5)
            pub = self._tap_meta_public()
            emit(self.tenant_id, "game", {
                "type": "likes_ranking",
                "ranking": ranking,
                "ranking_all": self.build_likes_ranking(10),
                "tap_meta_current": pub["tap_meta_current"],
                "tap_meta_total": pub["tap_meta_total"],
                "tap_meta_ready": pub["tap_meta_ready"],
                "tap_meta_multiplier": pub["tap_meta_multiplier"],
            })
            # Meta de tap: se atingiu, despacha dica/charada (respeitando Final Boss e cooldown)
            if self.game.secret_word and not self.game.finished:
                await self._check_tap_meta()

    async def _check_tap_meta(self):
        """Verifica a meta de tap.

        Sem Final Boss: ao atingir o total despacha o prêmio (dica/charada).
        Com Final Boss ativo: a meta fica congelada e nada é despachado; uma meta
        já atingida antes/ao entrar no Boss fica retida como prêmio pendente e
        só é despachada se o estado sair do Boss (não dispara no meio do Boss).
        """
        import time
        now = time.time()
        meta = int(self.tap_meta_total or 1000)
        boss = bool(getattr(self.game, "is_final_boss", False))

        if not boss:
            # Prêmio pendente retido durante o Boss (caminho sem Boss agora): despacha.
            if self.tap_meta_ready:
                self.tap_meta_ready = False
                self.tap_meta_current = 0
                await self._dispatch_tap_reward()
                return
            if self.tap_meta_current < meta:
                return
            if now < self._tap_meta_cooldown_until:
                return
            # Atingiu a meta (sem Boss)
            self.tap_meta_current = 0
            self._tap_meta_cooldown_until = now + 15
            await self._dispatch_tap_reward()
            return

        # Final Boss ativo: nada é despachado.
        if self.tap_meta_ready:
            return  # prêmio já pendente — evita re-emitir a cada tick
        if self.tap_meta_current >= meta:
            self.tap_meta_ready = True
            emit(self.tenant_id, "game", {
                "type": "tap_meta_reached",
                "ready": True,
                "blocked": True,
            })
            emit(self.tenant_id, "log", "[Tap] Meta atingida, mas o jogo está no Final Boss — dica aguardando...")

    async def _dispatch_tap_reward(self):
        """Prêmio da meta de tap: segue a porcentagem dica/charada da roleta."""
        if not self.game.secret_word or self.game.finished:
            return
        trace_id = uuid.uuid4().hex
        best_rank = 1000
        if self.game.guesses:
            best_rank = min(g["rank"] for g in self.game.guesses)
        import math
        target_rank = best_rank - max(1, math.floor(best_rank * 0.1))
        emit(self.tenant_id, "game", {"type": "tap_meta_reached", "ready": False, "blocked": False})
        self._log_event("game", "info", "palavra.tap_reward.dispatched",
                        "[Palavra] Meta de curtidas atingida; prêmio enviado à roleta.",
                        game="palavra", game_id=self.game.game_id, trace_id=trace_id,
                        details={"target_rank": target_rank})
        await self._dispatch_reward(
            user="meta_tap",
            nickname="Meta de Tap",
            avatar="",
            gift=None,
            target_rank=target_rank,
            source="tap",
            trace_id=trace_id,
        )

    def build_likes_ranking(self, limit: int = 5) -> list:
        return sorted(self.likes.values(), key=lambda e: -e["likes"])[:limit]

    def emit_status(self, state, extra=None):
        status = {"state": state, "user": self.username}
        if self.handler._room_id:
            status["room_id"] = self.handler._room_id
        if extra:
            status.update(extra)
        if state != self._last_logged_status:
            self._log_event("connection", "info", "connection.status.changed",
                            "Estado da conexão com a live alterado.", trace_id=self.connect_trace_id,
                            details={"from": self._last_logged_status, "to": state, "engine": self.engine})
            self._last_logged_status = state
        emit(self.tenant_id, "status", status)

    def _live_room_id(self) -> str:
        """Room id da live atual (usado no ranking da live)."""
        try:
            return str(getattr(self.handler, "_room_id", None) or "")
        except Exception:
            return ""

    def _emit_vpet(self, type_, payload):
        """Encaminha eventos do V-Pet para o node (game/browser) e logs."""
        if type_ == "log":
            emit(self.tenant_id, "log", payload)
        else:
            emit(self.tenant_id, "game", {"type": type_, **payload})

    def _emit_tres(self, type_, payload):
        """Encaminha eventos do Jogo dos 3 Pontinhos para o node (game/browser) e logs."""
        if type_ == "log":
            log_payload = dict(payload) if isinstance(payload, dict) else {"text": str(payload or "")}
            log_payload.setdefault("category", "game")
            log_payload.setdefault("level", "info")
            log_payload.setdefault("game", "tres")
            log_payload.setdefault("event", "tres.legacy.message")
            log_payload.setdefault("source", "python")
            emit(self.tenant_id, "log", log_payload)
        else:
            emit(self.tenant_id, "game", {"type": type_, **payload})

    async def _corda_loop(self):
        try:
            while True:
                self.corda.tick()
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            return

    def _emit_duelo(self, type_, payload):
        """Encaminha eventos do Duelo 1x1 para o node (game/browser)."""
        if type_ == "log":
            emit(self.tenant_id, "log", payload)
        else:
            emit(self.tenant_id, "game", {"type": type_, **payload})

    def _schedule_duelo_reset(self, delay):
        if self._duelo_reset_task:
            self._duelo_reset_task.cancel()
        self._duelo_reset_task = asyncio.ensure_future(self._duelo_auto_reset(delay))

    async def _duelo_auto_reset(self, delay):
        try:
            await asyncio.sleep(delay)
            if self.duelo.active and self.duelo.winner and not self.duelo.final and not self.duelo.roundActive:
                self.duelo.reset_round()
                emit(self.tenant_id, "game", {"type": "duelo_state", **self.duelo.state()})
        except asyncio.CancelledError:
            raise
        finally:
            self._duelo_reset_task = None

    def _cancel_duelo_match_restart(self):
        if self._duelo_match_task:
            self._duelo_match_task.cancel()
            self._duelo_match_task = None

    def _schedule_duelo_match_restart(self):
        self._cancel_duelo_match_restart()
        delay = int(self.duelo.settings.get("match_restart_delay_s", 8) or 8)
        self._duelo_match_task = asyncio.ensure_future(self._duelo_auto_match_restart(delay))

    async def _duelo_auto_match_restart(self, delay):
        try:
            await asyncio.sleep(delay)
            if self.duelo.active and self.duelo.final:
                self.duelo.reset_match()
                emit(self.tenant_id, "game", {"type": "duelo_state", **self.duelo.state()})
                emit(self.tenant_id, "log", "[Duelo] Nova partida iniciada (automática)")
        except asyncio.CancelledError:
            raise
        finally:
            self._duelo_match_task = None

    # ---- Modo 2 (timed): cronômetro autoritativo ----
    def _cancel_duelo_timed_tasks(self):
        if self._duelo_timer_task:
            self._duelo_timer_task.cancel()
            self._duelo_timer_task = None
        if self._duelo_round_result_task:
            self._duelo_round_result_task.cancel()
            self._duelo_round_result_task = None

    def _start_duelo_timer(self):
        self._cancel_duelo_timed_tasks()
        self._duelo_round_ends_at = time.time() + max(1, self.duelo.time_remaining or int(self.duelo.settings.get("round_time_s", 180) or 180))
        self._duelo_timer_task = asyncio.ensure_future(self._duelo_timer_loop())

    async def _duelo_timer_loop(self):
        try:
            while self.duelo.active and self.duelo._is_timed() and self.duelo.roundActive:
                now = time.time()
                rem = self._duelo_round_ends_at - now
                secs = max(0, int(rem) + (1 if rem > 0 and (rem % 1) > 0 else 0))
                if secs != self.duelo.time_remaining:
                    self.duelo.time_remaining = secs
                    emit(self.tenant_id, "game", {"type": "duelo_state", **self.duelo.state()})
                if rem <= 0:
                    break
                await asyncio.sleep(0.25)
            if self.duelo.active and self.duelo._is_timed() and self.duelo.roundActive and self.duelo.time_remaining <= 0:
                self.duelo.end_timed_round()
                emit(self.tenant_id, "game", {"type": "duelo_state", **self.duelo.state()})
                emit(self.tenant_id, "log", "[Duelo] Tempo da rodada esgotado — resultado")
                self._duelo_round_ends_at = 0
                self._schedule_duelo_timed_next_round(int(self.duelo.settings.get("round_result_delay_s", 8) or 8))
        except asyncio.CancelledError:
            raise
        finally:
            self._duelo_timer_task = None

    def _schedule_duelo_timed_next_round(self, delay):
        self._cancel_duelo_timed_tasks()
        self._duelo_round_result_task = asyncio.ensure_future(self._duelo_timed_next_round(delay))

    async def _duelo_timed_next_round(self, delay):
        try:
            await asyncio.sleep(delay)
            if self.duelo.active and self.duelo._is_timed() and not self.duelo.roundActive:
                self.duelo.reset_timed_round()
                emit(self.tenant_id, "game", {"type": "duelo_state", **self.duelo.state()})
                emit(self.tenant_id, "log", "[Duelo] Nova rodada iniciada")
                self._start_duelo_timer()
        except asyncio.CancelledError:
            raise
        finally:
            self._duelo_round_result_task = None

    def _emit_tres_weekly_refresh(self):
        """Emite o ranking semanal atualizado após um acerto."""
        try:
            import db as _db
            emit(self.tenant_id, "game", {"type": "tres_weekly", "weekly": _db.get_tres_weekly(self.tenant_id, 10)})
        except Exception:
            pass

    def _pick_tres_word(self) -> str:
        """Sorteia uma palavra para o 3 Pontinhos sem repetir (reusa played_words) e sem banidas."""
        if not self.game.word_pool:
            return ""
        try:
            banned = db.load_banned_words()
        except Exception:
            banned = getattr(self.game, "banned_words", set()) or set()
        disponiveis = [w for w in self.game.word_pool
                       if strip_accents(w) not in self.game.played_words and strip_accents(w) not in banned]
        if not disponiveis:
            self.game.played_words.clear()
            disponiveis = [w for w in self.game.word_pool if strip_accents(w) not in banned]
        if not disponiveis:
            disponiveis = self.game.word_pool[:]
        import random as _r
        return _r.choice(disponiveis)

    def _mark_tres_played(self, palavra: str):
        """Registra a palavra usada no 3 Pontinhos como já jogada e persiste."""
        if not palavra:
            return
        self.game.played_words.add(strip_accents(palavra))
        try:
            self.game._save_history()
        except Exception:
            pass

    async def _tres_next_round(self, trace_id=None):
        """Provider do auto-reinício: sorteia nova palavra e gera novas dicas."""
        next_round_id = int(getattr(self.tres, "round_id", 0) or 0) + 1
        started_at = time.perf_counter()
        self._log_event("diagnostic", "debug", "tres.round.preparation_started",
                        "[3 Dicas] Preparação da próxima rodada iniciada.", game="tres",
                        game_id=str(next_round_id), trace_id=trace_id,
                        details={"source": "auto_round"})
        palavra = self._pick_tres_word()
        if not palavra:
            self._log_event("notice", "warning", "tres.round.preparation_rejected",
                            "[3 Dicas] Não há palavra disponível para a próxima rodada.", game="tres",
                            game_id=str(next_round_id), trace_id=trace_id,
                            code="TRES_WORD_UNAVAILABLE")
            return None, None
        self._mark_tres_played(palavra)
        def log_generation(event, details):
            fallback = event.endswith("fallback")
            self._log_event(
                "notice" if fallback else "diagnostic",
                "warning" if fallback else "debug",
                "tres." + event,
                "[3 Dicas] Dicas geradas pelo fallback." if fallback else "[3 Dicas] Dicas geradas.",
                game="tres", game_id=str(next_round_id), trace_id=trace_id,
                duration_ms=details.get("duration_ms"),
                details={**details, "word_length": len(palavra), "source": "auto_round"},
            )
        dicas = await generate_tres_dicas(palavra, log_cb=log_generation)
        if not dicas or len(dicas) < 3:
            received_clue_count = len(dicas or [])
            dicas = [f"Palavra com {len(palavra)} letras", "É uma palavra comum", "Última dica!"]
            self._log_event("notice", "warning", "tres.round.clues_replaced",
                            "[3 Dicas] Conjunto de dicas incompleto; aplicado fallback simples.", game="tres",
                            game_id=str(next_round_id), trace_id=trace_id,
                            code="TRES_CLUES_INCOMPLETE", duration_ms=round((time.perf_counter() - started_at) * 1000),
                            details={"received_clue_count": received_clue_count, "word_length": len(palavra)})
        return palavra, dicas

    async def start_game(self, hint_gifts=None, riddle_gifts=None, size_gift=None, letter_gift=None, source="command", trace_id=None):
        previous_active = bool(self.game.secret_word and not self.game.finished)
        previous_game_id = getattr(self.game, "game_id", None)
        previous_guesses = len(getattr(self.game, "guesses", []) or [])
        started_at = time.perf_counter()
        self._palavra_debug(
            "start.begin",
            source=source,
            trace_id=trace_id,
            previous_game_id=previous_game_id,
            previous_status="running" if previous_active else ("finished" if getattr(self.game, "finished", False) else "idle"),
            previous_guess_count=previous_guesses,
            room_id=self.current_room_id or self._live_room_id() or None,
            hint_gifts=len(hint_gifts or []),
            riddle_gifts=len(riddle_gifts or []),
        )
        self.game.start_new_game(hint_gifts=hint_gifts, riddle_gifts=riddle_gifts, size_gift=size_gift, letter_gift=letter_gift, build_pool=False)
        # Meta de tap: zera a cada partida e aplica o valor configurado
        self.tap_meta_current = 0
        self.tap_meta_total = int(self.settings.get("tap_meta", 1000) or 1000)
        self.tap_meta_ready = False
        self._tap_meta_cooldown_until = 0
        self._tap_meta_x2 = False
        # Índice de proximidade: normalmente instantâneo (cache), mas a 1ª vez de uma
        # palavra nunca vista calcula similaridade do pool (~10-16s). Roda em thread
        # para NÃO travar a live; o jogo só é liberado quando o ranking fica pronto.
        self._preparing = True
        self._log_event("game", "info", "palavra.start.preparation_started",
                        "[Palavra] Preparando nova partida.", game="palavra",
                        game_id=self.game.game_id, trace_id=trace_id)
        emit(self.tenant_id, "game", {"type": "game_preparing"})
        try:
            await asyncio.to_thread(self.game._build_hint_pool)
        except Exception:
            pass
        self.game._pool_ready = bool(self.game.all_scored and self.game.hint_pool)
        self._palavra_debug(
            "start.pool_ready",
            game_id=self.game.game_id,
            trace_id=trace_id,
            pool_ready=self.game._pool_ready,
            scored_words=len(self.game.all_scored or []),
            hint_pool_size=len(self.game.hint_pool or []),
            elapsed_ms=round((time.perf_counter() - started_at) * 1000),
        )
        if not self.game._pool_ready:
            self._log_event("error", "error", "palavra.start.pool_fallback",
                            "[Palavra] Índice de proximidade indisponível; será usado o fallback simples.",
                            game="palavra", game_id=self.game.game_id, trace_id=trace_id,
                            code="PALAVRA_POOL_FALLBACK")
        self._preparing = False
        active_gift = self.game.get_active_gift()
        emit(self.tenant_id, "log", {"text": "[Jogo] Partida preparada.", "category": "game",
                                       "level": "info", "game": "palavra", "event": "palavra.game.prepared",
                                       "source": "python", "game_id": self.game.game_id,
                                       "trace_id": trace_id,
                                       "details": {"hint_gift_count": len(self.game.hint_gifts or []),
                                                   "riddle_gift_count": len(self.game.riddle_gifts or [])}})
        prefix = self._command_prefix()
        self._log_event("game", "info", "palavra.start.configuration_loaded",
                        "[Palavra] Configuração da partida aplicada.", game="palavra",
                        game_id=self.game.game_id, trace_id=trace_id,
                        details={"prefix_required": bool(prefix), "hint_gift_count": len(self.game.hint_gifts or []),
                                 "riddle_gift_count": len(self.game.riddle_gifts or []),
                                 "size_gift_configured": bool(self.game.size_gift),
                                 "letter_gift_configured": bool(self.game.letter_gift)})
        emit(self.tenant_id, "panel_word", self.game.secret_word)
        pub_tap = self._tap_meta_public()
        emit(self.tenant_id, "game", {
            "type": "game_start",
            "game_id": self.game.game_id,
            "secret_length": len(self.game.secret_word) if (self.game.size_revealed or not self.game.size_gift) else 0,
            "hint_gifts": self.game.hint_gifts,
            "riddle_gifts": self.game.riddle_gifts,
            "size_gift": self.game.size_gift,
            "size_revealed": self.game.size_revealed,
            "letter_gift": self.game.letter_gift,
            "first_letter_revealed": self.game.first_letter_revealed,
            "first_letter": self.game.secret_word[0] if (self.game.first_letter_revealed and self.game.secret_word) else "",
            "active_gift": active_gift,
            "tension_score": getattr(self.game, "tension_score", 0),
            "is_final_boss": getattr(self.game, "is_final_boss", False),
            "tap_meta_current": pub_tap["tap_meta_current"],
            "tap_meta_total": pub_tap["tap_meta_total"],
            "tap_meta_ready": pub_tap["tap_meta_ready"],
            "tap_meta_multiplier": pub_tap["tap_meta_multiplier"],
        })
        # Garante que os clientes recebam o estado zerado da meta imediatamente
        emit(self.tenant_id, "game", {
            "type": "likes_ranking",
            "ranking": self.build_likes_ranking(5),
            "ranking_all": self.build_likes_ranking(10),
            "tap_meta_current": pub_tap["tap_meta_current"],
            "tap_meta_total": pub_tap["tap_meta_total"],
            "tap_meta_ready": pub_tap["tap_meta_ready"],
            "tap_meta_multiplier": pub_tap["tap_meta_multiplier"],
        })
        self._palavra_debug(
            "start.game_started",
            game_id=self.game.game_id,
            trace_id=trace_id,
            status="running",
            active_gift=active_gift,
            hint_gifts=len(self.game.hint_gifts or []),
            riddle_gifts=len(self.game.riddle_gifts or []),
            secret_length=len(self.game.secret_word or ""),
        )

    @staticmethod
    def _match_vpet_command(raw: str):
        """Extrai um comando de chat do bichinho ('#chocar', '!alimentar', etc.)."""
        s = (raw or "").strip().lower()
        if not s:
            return None
        if s[0] in ("#", "!"):
            return s[1:].split()[0].strip()
        return None

    def _match_caca_command(self, raw: str):
        """Tenta extrair coordenadas de uma mensagem do chat.

        Retorna (start, end) se casar, ou None.
        Formatos aceitos (config via self.caca_format / self.caca_prefix):
          - "A1A4"   (sem prefixo, sem separador)
          - "A1:A4"  (com ':')
          - "A1 A4", "A1-A4", "A1,A4", "A1.A4", "A1/A4", "A1;A4"
          - com emoji/pontuacao ao redor: "B2F6 ⚡", "!b2 f6"
          - "cp A1A4" / "cp A1:A4"  (com prefixo)
        """
        s = raw.strip()
        prefix = getattr(self, "caca_prefix", "") or ""
        if prefix:
            if not s.lower().startswith(prefix.lower()):
                return None
            s = s[len(prefix):].strip()

        m = re.search(r"([A-Za-z]\d{1,2})\s*[:.,;/\-]?\s*([A-Za-z]\d{1,2})", s)
        if not m:
            return None
        return (m.group(1).upper(), m.group(2).upper())

    async def _process_caca_command(self, matched, user, nickname, avatar, user_meta):
        start, end = matched
        allowed, reason = self._check_access(user_meta)
        if not allowed:
            emit(self.tenant_id, "log", f"[CacaPalavras] @{user} bloqueado ({reason}): coordenadas ignoradas")
            return
        w = self.caca.find_word(start, end, finder=user, nickname=nickname or user, avatar=avatar or "")
        if w:
            db.record_caca_found(self.tenant_id, user, nickname or user, avatar or "", w["text"])
            self._emit_caca_found(w)
        else:
            emit(self.tenant_id, "log", f"[CacaPalavras] @{user} tentou {start}:{end} — não é uma palavra")
            emit(self.tenant_id, "game", {
                "type": "caca_miss",
                "start": start,
                "end": end,
                "user": user,
                "nickname": nickname or user,
            })

    async def on_member(self, user, nickname, user_meta=None, room_id=None, event_id=None):
        """Um espectador entrou na live (JoinEvent — apenas motor TikTokLive)."""
        self._ensure_room(room_id)
        self._track_levels(user, nickname, "", user_meta, room_id, event_id=event_id)
        self._emit_interaction("join", user, nickname, "", event_id=event_id, room_id=room_id)
        if self.vpet.active and self.vpet.state.get("assistant_mode"):
            self.vpet.greet_member(nickname or user)

    async def on_comment(self, user, nickname, avatar, text, user_meta=None, room_id=None, event_id=None):
        self._ensure_room(room_id)
        self._track_levels(user, nickname, avatar, user_meta, room_id, event_id=event_id)
        raw = text.strip()
        prefix = self._command_prefix()
        self._enqueue_chat_narration(user, raw)
        emit(self.tenant_id, "game", {
            "type": "chat",
            "user": user,
            "nickname": nickname or user,
            "avatar": avatar or "",
            "text": text,
        })
        if raw:
            self._emit_interaction("comment", user, nickname, avatar, event_id=event_id, room_id=room_id,
                                   user_id=self._stable_uid(user, user_meta), meta={"text": raw})
        allowed, _ = self._check_access(user_meta)
        if allowed:
            self.corda.join(self._stable_uid(user, user_meta), raw, user, nickname, avatar)
            self.corda.comment(self._stable_uid(user, user_meta), raw)
        self._duelo_comment_team(user, raw, user_meta, avatar, nickname or user)

        # ---------------------------------------------------------
        # 3 PONTINHOS: palpite de texto livre (captura exclusiva quando ativo)
        # ---------------------------------------------------------
        if self.tres.active and not self.tres.paused:
            # PASSE LIVRE: se o ingresso está configurado, só quem mandou o gift pode palpitar
            ticket = (self.tres.gift_config or {}).get("ticket") or ""
            if ticket and user not in self._tres_allowed:
                return
            # Filtro de spam p/ palpites errados: palavra única + sem emojis/dígitos
            guess_text = raw.strip()
            if re.search(r"\s", guess_text):
                return
            cleaned = re.sub(r"[^\w]", "", guess_text, flags=re.UNICODE)
            cleaned = re.sub(r"\d+", "", cleaned)
            norm_guess = strip_accents(cleaned)
            if len(norm_guess) < 2 or len(norm_guess) > 40 or not any(ch.isalnum() for ch in norm_guess):
                return
            res = self.tres.guess(user, nickname, avatar, guess_text)
            if res:
                try:
                    db.record_tres_hit(self.tenant_id, user, nickname or user, avatar or "",
                                       res.get("pontos", 0), bool(res.get("multiplicador")))
                except Exception:
                    pass
                self._emit_tres_weekly_refresh()
            # Sempre retorna quando o jogo está ativo: o chat é capturado pelo 3 Pontinhos
            self._throttled_log("tres_capture", "[3 Dicas] Captura de chat exclusiva ativa; demais jogos não recebem comentários.", game="tres", level="warn", secs=2.0)
            return

        # ---------------------------------------------------------
        # BICHINHO VIRTUAL: comandos de chat (!chocar, #alimentar, etc.)
        # ---------------------------------------------------------
        if self.vpet.active:
            # !falar <texto> — restrito ao streamer (dono da conta)
            falar_prefix = raw.strip().lower()
            if falar_prefix.startswith(("!falar", "#falar")):
                if (user or "").lower() == (self.username or "").lower():
                    texto = falar_prefix.split(None, 1)[1].strip() if len(falar_prefix.split(None, 1)) > 1 else ""
                    if texto:
                        self.vpet.speak(texto)
                        emit(self.tenant_id, "log", f"[Bichinho] Streamer enviou fala ao mascote ({len(texto)} caracteres).")
                else:
                    emit(self.tenant_id, "log", f"[Bichinho] @{user} tentou usar !falar (apenas o streamer)")
                return
            vpet_cmd = self._match_vpet_command(raw)
            if vpet_cmd is not None:
                self.vpet.handle_command(vpet_cmd, user, nickname)
                return

        # ---------------------------------------------------------
        # CAÇA PALAVRAS: detecta coordenadas (ex: A1A4 / A1:A4 / cp A1A4)
        # ---------------------------------------------------------
        if self.caca.active:
            matched = self._match_caca_command(raw)
            if matched is not None:
                await self._process_caca_command(matched, user, nickname, avatar, user_meta)
                return

        if not self.game.secret_word or self.game.finished:
            if prefix and raw.startswith(prefix):
                self._palavra_debug("guess.ignored", reason="no_active_game", game_id=getattr(self.game, "game_id", None), user=user, trace_id=event_id)
            return
        if self._preparing:
            if prefix and raw.startswith(prefix):
                self._palavra_debug("guess.ignored", reason="game_preparing", game_id=self.game.game_id, user=user, trace_id=event_id)
            self._throttled_log("palavra_preparing", "[Palavra] Preparando próxima partida… palpites aguardam", game="palavra", level="warn", secs=3.0)
            return
        if prefix and not raw.startswith(prefix):
            self._throttled_log("palavra_prefix", f"[Palavra] palpite ignorado: exige prefixo '{prefix}' no início do comentário", game="palavra", level="warn", secs=2.0)
            return

        body = raw[len(prefix):].strip() if prefix else raw.strip()
        if not body:
            self._palavra_debug("guess.ignored", reason="empty_command", game_id=self.game.game_id, user=user, trace_id=event_id)
            return

        target_user = None
        if "@" in body:
            parts = body.split("@", 1)
            raw_word_part = parts[0].strip()
            user_part = parts[1].strip().lstrip("@")
            if user_part:
                target_user = user_part
                body = raw_word_part
        else:
            body = body

        word = body.strip().lower()
        word = re.sub(r"\d+", "", word)
        if not word or len(word) < 2:
            self._palavra_debug("guess.ignored", reason="invalid_word", game_id=self.game.game_id,
                                user=user, input_length=len(body), trace_id=event_id)
            return

        final_user = target_user if target_user else user
        final_nickname = target_user if target_user else nickname
        final_avatar = avatar
        if target_user:
            rec = db.get_user_by_username(target_user)
            if rec:
                final_nickname = rec["nickname"] or target_user
                final_avatar = rec["avatar"] or ""
            else:
                final_nickname = target_user
                final_avatar = ""

        # Filtros de engajamento (seguiu o canal e/ou heart-me ativo)
        allowed, reason = self._check_access(user_meta)
        if not allowed:
            self._palavra_debug("guess.rejected", reason=reason, game_id=self.game.game_id,
                                user=final_user, guess_count=len(self.game.guesses or []), trace_id=event_id)
            emit(self.tenant_id, "game", {
                "type": "guess_rejected",
                "user": final_user,
                "nickname": final_nickname,
                "word": word,
                "reason": reason,
            })
            self._log_event("game", "warning", "palavra.guess.rejected",
                            f"[Palavra] Palpite bloqueado pelo filtro de acesso ({reason}).", game="palavra",
                            game_id=self.game.game_id, trace_id=event_id, code="PALAVRA_ACCESS_REJECTED",
                            details={"user": final_user, "reason": reason})
            return

        db.record_guess(final_user, final_nickname, final_avatar)

        previous_best_rank = min((int(g.get("rank", 1000)) for g in self.game.guesses), default=1000)
        result = self.game.process_guess(final_user, word, nickname=final_nickname, avatar=final_avatar)
        if result is None:
            self._palavra_debug("guess.no_result", game_id=self.game.game_id, user=final_user,
                                previous_best_rank=previous_best_rank, trace_id=event_id)
            return
        if result.get("duplicate"):
            self._palavra_debug("guess.duplicate", game_id=self.game.game_id, user=final_user,
                                rank=result.get("rank"), guess_count=len(self.game.guesses or []), trace_id=event_id)
            emit(self.tenant_id, "game", {
                "type": "guess_duplicate",
                "word": result["word"],
                "rank": result["rank"],
                "user": final_user,
                "nickname": final_nickname,
            })
            self._log_event("game", "info", "palavra.guess.duplicate",
                            f"[Palavra] Palpite duplicado (#{result['rank']}).", game="palavra",
                            game_id=self.game.game_id, trace_id=event_id,
                            details={"user": final_user, "rank": int(result["rank"])})
            return
        color = get_rank_color(result["rank"])
        active_gift = self.game.get_active_gift()
        emit(self.tenant_id, "game", {
            "type": "guess",
            "user": final_user,
            "nickname": final_nickname,
            "avatar": final_avatar,
            "word": result["word"],
            "rank": result["rank"],
            "color": color,
            "active_gift": active_gift,
            "tension_score": getattr(self.game, "tension_score", 0),
            "is_final_boss": getattr(self.game, "is_final_boss", False),
        })
        self._log_event("game", "info", "palavra.guess.accepted",
                        f"[Palavra] Palpite registrado no rank #{result['rank']}.", game="palavra",
                        game_id=self.game.game_id, trace_id=event_id,
                        details={"user": final_user, "rank": int(result["rank"])})
        current_best_rank = min((int(g.get("rank", 1000)) for g in self.game.guesses), default=1000)
        self._palavra_debug("guess.accepted", game_id=self.game.game_id, user=final_user,
                            rank=int(result["rank"]), previous_best_rank=previous_best_rank,
                            current_best_rank=current_best_rank, guess_count=len(self.game.guesses or []),
                            trace_id=event_id)
        # Relatório: palpite válido (não duplicado).
        self._emit_interaction("guess", final_user, final_nickname, final_avatar,
                               value=int(result["rank"]), event_id=event_id, room_id=room_id,
                               meta={"word": result["word"], "rank": int(result["rank"])})

        if result["rank"] == 1:
            self.game.save_result(winner=final_user, nickname=final_nickname, avatar=final_avatar, total_guesses=len(self.game.guesses), room_id=self._live_room_id())
            emit(self.tenant_id, "game", {
                "type": "game_over",
                "winner": final_user,
                "nickname": final_nickname,
                "avatar": final_avatar,
                "secret_word": self.game.secret_word,
                "total_guesses": len(self.game.guesses),
                "guesses": self.game.get_final_guesses(),
                "post_game_summary": self.game.build_post_game_summary(100),
            })
            self._palavra_debug("game.finished", game_id=self.game.game_id, cause="correct_guess",
                                winner=final_user, guess_count=len(self.game.guesses or []), trace_id=event_id)
            self._emit_interaction("winner", final_user, final_nickname, final_avatar, value=1,
                                   room_id=room_id, meta={"word": self.game.secret_word})
            self._log_event("game", "info", "palavra.game.finished",
                            f"[FIM] Vencedor: {final_user}.", game="palavra", game_id=self.game.game_id,
                            trace_id=event_id, code="PALAVRA_CORRECT_GUESS",
                            details={"winner": final_user, "cause": "correct_guess"})
            self._schedule_auto_next_game()

    async def on_gift(self, user, nickname, avatar, gift_name, diamond_count, repeat_count=1, user_meta=None, gift_id="", room_id=None, event_id=None):
        self._ensure_room(room_id)
        self._track_levels(user, nickname, avatar, user_meta, room_id, event_id=event_id)
        emit(self.tenant_id, "game", {
            "type": "gift_event",
            "user": user,
            "nickname": nickname or user,
            "avatar": avatar or "",
            "gift": gift_name,
            "gift_id": str(gift_id or ""),
            "diamond_count": int(diamond_count or 0),
            "repeat_count": repeat_count,
        })
        # Relatório: valor = diamantes totais do envio.
        self._emit_interaction(
            "gift", user, nickname, avatar,
            value=int(diamond_count or 0) * max(1, int(repeat_count or 1)),
            event_id=event_id, room_id=room_id,
            user_id=self._stable_uid(user, user_meta),
            meta={"gift_id": str(gift_id or ""), "gift_name": str(gift_name or ""),
                  "repeat_count": max(1, int(repeat_count or 1)), "diamonds": int(diamond_count or 0)},
        )
        combo_str = f" x{repeat_count}" if repeat_count > 1 else ""
        emit(self.tenant_id, "log", {
            "text": f"[Gift] Presente recebido{combo_str} ({int(diamond_count or 0)} diamantes).",
            "category": "notice", "level": "info", "event": "live.gift.received", "source": "python",
            "trace_id": event_id,
            "details": {"user": user, "gift_name": str(gift_name or ""), "gift_id": str(gift_id or ""),
                        "diamond_count": int(diamond_count or 0), "repeat_count": max(1, int(repeat_count or 1))},
        })

        # 3 PONTINHOS: presente revela tamanho/letra, faz palpite VIP ou marca apoiador
        if self.tres.active and not self.tres.finished:
            self.tres.process_gift(user, nickname, avatar, gift_name, gift_id=gift_id, repeat=repeat_count)

        # PASSE LIVRE: gift ingresso (ticket) libera o usuário para palpitar no 3 Pontinhos
        ticket = (self.tres.gift_config or {}).get("ticket") or ""
        if self.tres.active and ticket and self.tres._gift_matches(self.tres._norm(gift_name), ticket):
            if user not in self._tres_allowed:
                self._tres_allowed.add(user)
                emit(self.tenant_id, "game", {
                    "type": "tres_ticket",
                    "user": user,
                    "nickname": nickname or user,
                    "avatar": avatar or "",
                })
                emit(self.tenant_id, "log", {"text": f"[3 Dicas] @{user} liberou o chat (Passe Livre).",
                                              "category": "game", "level": "info", "game": "tres",
                                              "event": "tres.ticket.granted", "source": "python",
                                              "game_id": str(self.tres.round_id), "details": {"user": user}})

        # BICHINHO VIRTUAL: presente alimenta/choca/ataca o boss (não afeta o fluxo dos jogos)
        if self.vpet.active:
            self.vpet.on_gift(user, nickname, avatar, gift_name, int(diamond_count or 0), repeat_count)

        allowed, _ = self._check_access(user_meta)
        if allowed:
            self.corda.gift(gift_id, gift_name, diamond_count, repeat_count,
                            self._stable_uid(user, user_meta), user, nickname, avatar)

        # DUELO 1x1: presente cadastrado dispara golpe/escudo (módulo isolado, retrocompatível)
        duelo_would_match = False
        if self.duelo.gifts:
            duelo_would_match = any(
                g and g.get("active", True) and self.duelo._matches(g, gift_id, gift_name)
                for g in self.duelo.gifts
            )
        if duelo_would_match or self.duelo.active:
            if not self.duelo.active:
                emit(self.tenant_id, "log", f"[Duelo] Presente '{gift_name}' recebido, mas a ÁREA está INATIVA (clique em Ativar Área)")
            else:
                res = self.duelo.on_gift(gift_id, gift_name, repeat_count, user, nickname or user, coins=int(diamond_count or 0))
                if res == "round_end":
                    delay = int(self.duelo.settings.get("reset_delay_s", 6) or 6)
                    self._schedule_duelo_reset(delay)
                elif res == "match_end":
                    if self._duelo_reset_task:
                        self._duelo_reset_task.cancel()
                        self._duelo_reset_task = None
                    emit(self.tenant_id, "log", "[Duelo] Meta de votos atingida — VENCEDOR FINAL (nova partida automática em breve)")
                    self._schedule_duelo_match_restart()
                if res:
                    added = int(diamond_count or 0) * max(1, repeat_count)
                    emit(self.tenant_id, "log", f"[Duelo] @{user} presente '{gift_name}' x{max(1, repeat_count)} aplicado ({res}) +{added} votos")
                elif not duelo_would_match:
                    emit(self.tenant_id, "log", f"[Duelo] Presente '{gift_name}' NÃO cadastrado como golpe/escudo/apoio")

        allowed, reason = self._check_access(user_meta)
        if not allowed:
            if self.game.secret_word and not self.game.finished:
                self._palavra_debug("gift.ignored", game_id=self.game.game_id,
                                    reason="access_denied", access_reason=reason, user=user,
                                    trace_id=event_id)
            self._log_event("game", "warning", "batalha.gift.rejected",
                            f"[Batalha] Presente bloqueado pelo filtro de acesso ({reason}).", game="batalha",
                            trace_id=event_id, code="BATALHA_GIFT_ACCESS_REJECTED",
                            details={"user": user, "reason": reason})
            return
        self.battle.add_coins(user, nickname, avatar, int(diamond_count or 0) * max(1, repeat_count))
        if not self.game.secret_word or self.game.finished:
            self._log_event("notice", "info", "live.gift.ignored",
                            "Presente ignorado porque não há partida da Palavra ativa.", code="NO_ACTIVE_GAME",
                            trace_id=event_id, details={"user": user})
            return
        self._palavra_debug("gift.received", game_id=self.game.game_id, user=user,
                            gift_id=str(gift_id or ""), gift_name=str(gift_name or ""),
                            diamonds=int(diamond_count or 0), repeat_count=max(1, int(repeat_count or 1)),
                            guess_count=len(self.game.guesses or []), trace_id=event_id)

        # Presente de tamanho: revela o nº de letras da palavra secreta
        size_res = self.game.process_gift(user, gift_name, int(diamond_count or 0), nickname=nickname, avatar=avatar, gift_id=gift_id)
        if size_res and size_res.get("size_revealed"):
            self._palavra_debug("gift.revealed_size", game_id=self.game.game_id, user=user,
                                gift_id=str(gift_id or ""), secret_length=int(size_res.get("secret_length", 0)),
                                trace_id=event_id)
            emit(self.tenant_id, "game", {
                "type": "size_revealed",
                "user": user,
                "nickname": nickname or user,
                "avatar": avatar or "",
                "secret_length": size_res.get("secret_length", 0),
            })
            self._log_event("game", "info", "palavra.gift.revealed_size",
                            f"[Palavra] @{user} revelou o tamanho da palavra ({size_res.get('secret_length', 0)} letras).",
                            game="palavra", game_id=self.game.game_id, trace_id=event_id,
                            details={"user": user, "word_length": int(size_res.get("secret_length", 0))})
            return
        if size_res and size_res.get("first_letter_revealed"):
            self._palavra_debug("gift.revealed_first_letter", game_id=self.game.game_id, user=user,
                                gift_id=str(gift_id or ""), secret_length=int(size_res.get("secret_length", 0)),
                                trace_id=event_id)
            emit(self.tenant_id, "game", {
                "type": "letter_revealed",
                "user": user,
                "nickname": nickname or user,
                "avatar": avatar or "",
                "first_letter": size_res.get("first_letter", ""),
                "secret_length": size_res.get("secret_length", 0),
            })
            self._log_event("game", "info", "palavra.gift.revealed_first_letter",
                            f"[Palavra] @{user} revelou a primeira letra.", game="palavra",
                            game_id=self.game.game_id, trace_id=event_id,
                            details={"user": user, "word_length": int(size_res.get("secret_length", 0))})
            return

        active_gift = self.game.get_active_gift()
        if not active_gift:
            self._palavra_debug("gift.ignored", game_id=self.game.game_id, reason="no_active_gift",
                                gift_id=str(gift_id or ""), trace_id=event_id)
            self._log_event("game", "warning", "palavra.gift.ignored",
                            "Presente ignorado: não há presente ativo configurado.", game="palavra",
                            game_id=self.game.game_id, trace_id=event_id, code="PALAVRA_NO_ACTIVE_GIFT",
                            details={"gift_id": str(gift_id or "")})
            return

        # Match ID-first (catálogo) com fallback por nome/PT — aceita tanto o ID quanto o nome.
        is_active = bool(self.game._gift_ref_match(gift_id, gift_name, active_gift))
        is_final_boss = bool(getattr(self.game, "is_final_boss", False))
        if is_final_boss:
            if not is_active:
                self._palavra_debug("gift.ignored", game_id=self.game.game_id, reason="wrong_final_boss_gift",
                                    gift_id=str(gift_id or ""), gift_name=str(gift_name or ""), trace_id=event_id)
                self._log_event("game", "info", "palavra.gift.ignored",
                                "Presente não corresponde ao presente revelador ativo.", game="palavra",
                                game_id=self.game.game_id, trace_id=event_id, code="PALAVRA_GIFT_NOT_ACTIVE",
                                details={"gift_id": str(gift_id or ""), "reason": "wrong_final_boss_gift"})
                return
        else:
            if not is_active and not self.game.is_gift_recently_active(gift_name, 5):
                self._palavra_debug("gift.ignored", game_id=self.game.game_id, reason="gift_not_active",
                                    gift_id=str(gift_id or ""), gift_name=str(gift_name or ""), trace_id=event_id)
                self._log_event("game", "info", "palavra.gift.ignored",
                                "Presente não corresponde ao presente ativo.", game="palavra",
                                game_id=self.game.game_id, trace_id=event_id, code="PALAVRA_GIFT_NOT_ACTIVE",
                                details={"gift_id": str(gift_id or ""), "reason": "gift_not_active"})
                return
            if not is_active:
                self._log_event("game", "info", "palavra.gift.accepted_recent",
                                "Presente recente da roleta aceito.", game="palavra", game_id=self.game.game_id,
                                trace_id=event_id, details={"gift_id": str(gift_id or "")})

        # -------------------------------------------------------------
        # Scenario A: Final Boss Active
        # -------------------------------------------------------------
        if is_final_boss:
            emit(self.tenant_id, "log", f"[Final Boss] @{user} acionou a vitória instantânea.")
            
            self.game.finished = True
            self.game.winner = user
            self.game.winner_nickname = nickname or user
            self.game.winner_avatar = avatar or ""
            self.game.played_words.add(self.game.secret_word)
            self.game.save_result(winner=user, nickname=nickname or user, avatar=avatar or "", total_guesses=len(self.game.guesses), room_id=self._live_room_id())

            emit(self.tenant_id, "game", {
                "type": "game_over",
                "winner": user,
                "nickname": nickname or user,
                "avatar": avatar,
                "secret_word": self.game.secret_word,
                "total_guesses": len(self.game.guesses),
                "guesses": self.game.get_final_guesses(),
                "post_game_summary": self.game.build_post_game_summary(100),
            })
            self._palavra_debug("game.finished", game_id=self.game.game_id, cause="final_boss_gift",
                                winner=user, gift_id=str(gift_id or ""), guess_count=len(self.game.guesses or []),
                                trace_id=event_id)
            self._log_event("game", "info", "palavra.game.finished",
                            f"[Final Boss] @{user} encerrou a partida.", game="palavra", game_id=self.game.game_id,
                            trace_id=event_id, code="PALAVRA_FINAL_BOSS",
                            details={"winner": user, "cause": "final_boss_gift"})
            self._schedule_auto_next_game()
            return

        # -------------------------------------------------------------
        # Scenario B: Standard Roulette Drop
        # -------------------------------------------------------------
        best_rank = 1000
        if self.game.guesses:
            best_rank = min(g["rank"] for g in self.game.guesses)

        import math
        target_rank = best_rank - max(1, math.floor(best_rank * 0.1))

        import random
        pct_dica = int(self.settings.get("pct_dica", 70))
        pct_charada = int(self.settings.get("pct_charada", 30))
        loop_n = max(1, repeat_count)
        self._palavra_debug("gift.accepted", game_id=self.game.game_id, user=user,
                            gift_id=str(gift_id or ""), is_active=bool(is_active),
                            final_boss=False, repeat_count=loop_n,
                            hint_percent=pct_dica, riddle_percent=pct_charada, trace_id=event_id)
        self._log_event("game", "info", "palavra.reward.accepted",
                        f"[Palavra] Presente ativo aceito pela roleta (x{loop_n}).", game="palavra",
                        game_id=self.game.game_id, trace_id=event_id,
                        details={"target_rank": target_rank, "hint_percent": pct_dica,
                                 "riddle_percent": pct_charada, "repeat_count": loop_n})

        riddle_done_in_combo = False
        for _ in range(loop_n):
            if self.game.current_riddle_stage >= 3:
                choice = "hint"
            else:
                choice = random.choices(["hint", "riddle"], weights=[pct_dica, pct_charada], k=1)[0]
            await self._dispatch_reward(
                user=user, nickname=nickname, avatar=avatar,
                gift=active_gift, target_rank=target_rank,
                choice=choice,
                allow_riddle=not riddle_done_in_combo,
                trace_id=event_id,
            )
            if choice == "riddle":
                riddle_done_in_combo = True

    async def _dispatch_reward(self, user, nickname, avatar, gift, target_rank, choice=None, allow_riddle=True, source="roleta", trace_id=None):
        """Revela 1 palavra (dica) OU gera 1 charada, seguindo a porcentagem dica/charada.

        Reutilizado pela roleta de presentes e pela meta de tap.
        """
        if not self.game.secret_word or self.game.finished:
            return
        if self._preparing:
            self._throttled_log("reward_preparing", "[Palavra] Presente aguardando preparação da partida…", game="palavra", level="warn", secs=3.0)
            return
        if choice is None:
            pct_dica = int(self.settings.get("pct_dica", 70))
            pct_charada = int(self.settings.get("pct_charada", 30))
            if self.game.current_riddle_stage >= 3:
                choice = "hint"
            else:
                import random
                choice = random.choices(["hint", "riddle"], weights=[pct_dica, pct_charada], k=1)[0]

        protect = self.game._hint_protected()
        self._palavra_debug("reward.begin", source=source, game_id=self.game.game_id,
                            trace_id=trace_id,
                            choice=choice, target_rank=target_rank,
                            allow_riddle=bool(allow_riddle),
                            riddle_stage=self.game.current_riddle_stage,
                            guess_count=len(self.game.guesses or []),
                            gift_present=bool(gift))

        if choice == "riddle" and allow_riddle:
            riddle_res = self.game.process_riddle_gift(user, gift, force=True)
            if riddle_res:
                stage = riddle_res["stage"]
                cluster_words = self.game.hint_cluster(target_rank)
                riddle_trace_id = str(trace_id or uuid.uuid4().hex)
                riddle_tts_config = self._tts_config_snapshot()
                generation_started = time.perf_counter()
                self._palavra_debug("riddle.generation_started", source=source,
                                    game_id=self.game.game_id, stage=stage,
                                    trace_id=riddle_trace_id,
                                    target_rank=target_rank, clue_count=len(cluster_words))

                emit(self.tenant_id, "game", {
                    "type": "roulette_drop",
                    "reward_type": "riddle_started",
                    "stage": stage,
                    "user": user,
                    "nickname": nickname,
                    "avatar": avatar,
                    "gift": gift,
                    "active_gift": self.game.get_active_gift(),
                    "tension_score": getattr(self.game, "tension_score", 0),
                    "is_final_boss": getattr(self.game, "is_final_boss", False),
                })
                emit(self.tenant_id, "log", {"text": f"[{source}] Gerando charada do estágio {stage}.",
                                              "category": "game", "level": "info", "game": "palavra",
                                              "event": "palavra.riddle.generation_started", "source": "python",
                                              "trace_id": riddle_trace_id,
                                              "game_id": self.game.game_id,
                                              "details": {"stage": stage, "clue_candidate_count": len(cluster_words)}})

                try:
                    riddle_text = await generate_openrouter_riddle(self.game.secret_word, cluster_words)
                except Exception as exc:
                    self._palavra_debug("riddle.generation_failed", source=source,
                                        game_id=self.game.game_id, stage=stage,
                                        trace_id=riddle_trace_id,
                                        error_type=type(exc).__name__,
                                        generation_ms=round((time.perf_counter() - generation_started) * 1000))
                    self._log_event("error", "error", "palavra.riddle.generation_failed",
                                    "[Palavra] Não foi possível gerar a charada.", game="palavra",
                                    game_id=self.game.game_id, code="PALAVRA_RIDDLE_GENERATION_FAILED",
                                    duration_ms=round((time.perf_counter() - generation_started) * 1000),
                                    details={"stage": stage, "error_type": type(exc).__name__})
                    return
                asyncio.create_task(self._narrate_riddle_async(
                    stage, riddle_text, trace_id=riddle_trace_id, tts_config=riddle_tts_config
                ))
                self._palavra_debug("riddle.generated", source=source,
                                    game_id=self.game.game_id, stage=stage,
                                    trace_id=riddle_trace_id,
                                    text_length=len(riddle_text or ""),
                                    generation_ms=round((time.perf_counter() - generation_started) * 1000))

                emit(self.tenant_id, "game", {
                    "type": "roulette_drop",
                    "reward_type": "riddle_ready",
                    "stage": stage,
                    "user": user,
                    "nickname": nickname,
                    "avatar": avatar,
                    "gift": gift,
                    "text": riddle_text,
                    "audio_url": None,
                    "words": cluster_words,
                    "active_gift": self.game.get_active_gift(),
                    "tension_score": getattr(self.game, "tension_score", 0),
                    "is_final_boss": getattr(self.game, "is_final_boss", False),
                })
                emit(self.tenant_id, "log", f"[{source}] Charada do estágio {stage} liberada.")
                self._palavra_debug("riddle.ready_sent", source=source,
                                    game_id=self.game.game_id, stage=stage,
                                    trace_id=riddle_trace_id,
                                    text_length=len(riddle_text or ""))
                return

        # choice == "hint" (ou charada convertida em dica pelo limite de 1 por combo)
        picked = self.game.pick_hint_word(target_rank)
        if picked is None:
            self._palavra_debug("hint.ignored", source=source, reason="no_eligible_hint",
                                game_id=self.game.game_id, target_rank=target_rank,
                                protected=bool(protect), guess_count=len(self.game.guesses or []),
                                trace_id=trace_id)
            if protect:
                emit(self.tenant_id, "log", f"[{source}] Sem dica válida na zona protegida (não pode revelar rank 1-2 nem piorar o melhor rank)")
            else:
                emit(self.tenant_id, "log", f"[{source}] Sem novas dicas no pool")
            return

        best_word, hint_rank = picked
        previous_best_rank = min((int(g.get("rank", 1000)) for g in self.game.guesses), default=1000)
        self.game.hints_given.append(best_word)

        entry = {"user": user, "word": best_word, "rank": hint_rank, "is_hint": True, "gift": gift}
        if nickname:
            entry["nickname"] = nickname
        if avatar:
            entry["avatar"] = avatar
        self.game.guesses.append(entry)
        self.game.guesses.sort(key=lambda x: x["rank"])

        emit(self.tenant_id, "game", {
            "type": "roulette_drop",
            "reward_type": "hint",
            "user": user,
            "nickname": nickname,
            "avatar": avatar,
            "gift": gift,
            "hint_word": best_word,
            "hint_rank": hint_rank,
            "color": get_rank_color(hint_rank),
            "active_gift": self.game.get_active_gift(),
            "tension_score": getattr(self.game, "tension_score", 0),
            "is_final_boss": getattr(self.game, "is_final_boss", False),
        })
        emit(self.tenant_id, "log", f"[{source}] Dica revelada (#{hint_rank}).")
        current_best_rank = min((int(g.get("rank", 1000)) for g in self.game.guesses), default=1000)
        self._palavra_debug("hint.revealed", source=source, game_id=self.game.game_id,
                            rank=hint_rank, target_rank=target_rank,
                            trace_id=trace_id,
                            previous_best_rank=previous_best_rank, current_best_rank=current_best_rank,
                            guess_count=len(self.game.guesses), protected=bool(protect))
        self._emit_interaction("hint", user, nickname, avatar, value=int(hint_rank),
                               meta={"word": best_word, "rank": int(hint_rank), "source": source})

    async def end_game(self, cause="manual", trace_id=None):
        if not self.game.secret_word or self.game.finished:
            self._palavra_debug("end.noop", cause=cause, game_id=getattr(self.game, "game_id", None),
                                finished=bool(getattr(self.game, "finished", False)), trace_id=trace_id)
            return
        self._palavra_debug("end.begin", cause=cause, game_id=self.game.game_id,
                            guess_count=len(self.game.guesses or []),
                            room_id=self.current_room_id or self._live_room_id() or None,
                            trace_id=trace_id)
        payload = self.game.finalize_game(room_id=self._live_room_id())
        if payload:
            emit(self.tenant_id, "game", payload)
            self._palavra_debug("end.finished", cause=cause, game_id=self.game.game_id,
                                winner=payload.get("winner"), guess_count=len(self.game.guesses or []),
                                trace_id=trace_id)
            self._log_event("game", "info", "palavra.game.finished",
                            "[Palavra] Partida encerrada.", game="palavra", game_id=self.game.game_id,
                            trace_id=trace_id, details={"cause": cause, "winner": payload.get("winner"),
                                                        "guess_count": len(self.game.guesses or [])})

    def _stop_other_chat_games(self, keep=None):
        """Garante captura única de chat: desativa os demais jogos de captura (3 Dicas/Bichinho/Caça)."""
        for name in ("tres", "vpet", "caca"):
            if name == keep:
                continue
            eng = getattr(self, name, None)
            if eng and getattr(eng, "active", False):
                try:
                    eng.stop()
                except Exception:
                    pass
                self._throttled_log("stop_" + name, f"[Jogo] {name} encerrado para manter a captura exclusiva.", game=name, level="info")

    def _schedule_auto_next_game(self):
        """Agenda o auto-início da próxima partida da Palavra Secreta (se habilitado)."""
        if not self.settings.get("auto_round"):
            return
        pause = int(self.settings.get("auto_round_pause", 20) or 20)
        emit(self.tenant_id, "log", f"[Jogo] Próxima partida em {pause}s (auto-rodada)...")
        loop = asyncio.get_running_loop()
        loop.create_task(self._auto_start_next(pause))

    async def _auto_start_next(self, pause):
        try:
            await asyncio.sleep(pause)
            if not self.settings.get("auto_round"):
                return
            await self.start_game(
                hint_gifts=self.game.hint_gifts,
                riddle_gifts=self.game.riddle_gifts,
                size_gift=self.game.size_gift,
                letter_gift=self.game.letter_gift,
                source="auto_round",
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self._log_event("error", "error", "palavra.auto_round.failed",
                            "[Palavra] Não foi possível iniciar a próxima rodada automática.", game="palavra",
                            code="PALAVRA_AUTO_ROUND_FAILED", details={"error_type": type(e).__name__})

    async def manual_hint(self, trace_id=None):
        if not self.game.secret_word or self.game.finished:
            self._palavra_debug("hint.ignored", source="manual", reason="no_active_game",
                                game_id=getattr(self.game, "game_id", None), finished=bool(self.game.finished),
                                trace_id=trace_id)
            self._log_event("notice", "warning", "palavra.hint.rejected", "[Palavra] Não há partida ativa para dar uma dica.",
                            game="palavra", game_id=getattr(self.game, "game_id", None), trace_id=trace_id,
                            code="PALAVRA_NO_ACTIVE_GAME")
            return
        if self._preparing:
            self._palavra_debug("hint.ignored", source="manual", reason="game_preparing",
                                game_id=self.game.game_id, trace_id=trace_id)
            self._log_event("notice", "warning", "palavra.hint.rejected", "[Palavra] A partida ainda está sendo preparada.",
                            game="palavra", game_id=self.game.game_id, trace_id=trace_id,
                            code="PALAVRA_GAME_PREPARING")
            return
        best_rank = 1000
        if self.game.guesses:
            best_rank = min(g["rank"] for g in self.game.guesses)
        import math
        target_rank = best_rank - max(1, math.floor(best_rank * 0.1))
        picked = self.game.pick_hint_word(target_rank)
        if picked is None:
            self._palavra_debug("hint.ignored", source="manual", reason="no_eligible_hint",
                                game_id=self.game.game_id, target_rank=target_rank,
                                protected=bool(self.game._hint_protected()), trace_id=trace_id)
            if self.game._hint_protected():
                reason = "protected_zone"
            else:
                reason = "no_hint_available"
            self._log_event("notice", "warning", "palavra.hint.rejected", "[Palavra] Nenhuma dica elegível neste momento.",
                            game="palavra", game_id=self.game.game_id, trace_id=trace_id,
                            code="PALAVRA_HINT_UNAVAILABLE", details={"reason": reason, "target_rank": target_rank})
            return
        best_word, hint_rank = picked
        previous_best_rank = min((int(g.get("rank", 1000)) for g in self.game.guesses), default=1000)
        self.game.hints_given.append(best_word)
        entry = {"user": "streamer", "word": best_word, "rank": hint_rank, "is_hint": True}
        self.game.guesses.append(entry)
        self.game.guesses.sort(key=lambda x: x["rank"])
        emit(self.tenant_id, "game", {
            "type": "roulette_drop",
            "reward_type": "hint",
            "user": "streamer",
            "nickname": "Streamer",
            "avatar": "",
            "gift": None,
            "hint_word": best_word,
            "hint_rank": hint_rank,
            "color": get_rank_color(hint_rank),
            "active_gift": self.game.get_active_gift(),
            "tension_score": getattr(self.game, "tension_score", 0),
            "is_final_boss": getattr(self.game, "is_final_boss", False),
        })
        self._log_event("game", "info", "palavra.hint.revealed", f"[Palavra] Dica revelada (#{hint_rank}).",
                        game="palavra", game_id=self.game.game_id, trace_id=trace_id,
                        details={"rank": hint_rank, "target_rank": target_rank})
        current_best_rank = min((int(g.get("rank", 1000)) for g in self.game.guesses), default=1000)
        self._palavra_debug("hint.revealed", source="manual", game_id=self.game.game_id,
                            rank=hint_rank, target_rank=target_rank,
                            previous_best_rank=previous_best_rank, current_best_rank=current_best_rank,
                            guess_count=len(self.game.guesses), protected=bool(self.game._hint_protected()),
                            trace_id=trace_id)

    async def manual_riddle(self, trace_id=None):
        if not self.game.secret_word or self.game.finished:
            self._palavra_debug("riddle.ignored", source="manual", reason="no_active_game",
                                game_id=getattr(self.game, "game_id", None), finished=bool(self.game.finished),
                                trace_id=trace_id)
            self._log_event("notice", "warning", "palavra.riddle.rejected", "[Palavra] Não há partida ativa para gerar charada.",
                            game="palavra", game_id=getattr(self.game, "game_id", None), trace_id=trace_id,
                            code="PALAVRA_NO_ACTIVE_GAME")
            return
        if self._preparing:
            self._palavra_debug("riddle.ignored", source="manual", reason="game_preparing",
                                game_id=self.game.game_id, trace_id=trace_id)
            self._log_event("notice", "warning", "palavra.riddle.rejected", "[Palavra] A partida ainda está sendo preparada.",
                            game="palavra", game_id=self.game.game_id, trace_id=trace_id,
                            code="PALAVRA_GAME_PREPARING")
            return
        best_rank = 1000
        if self.game.guesses:
            best_rank = min(g["rank"] for g in self.game.guesses)
        import math
        target_rank = best_rank - max(1, math.floor(best_rank * 0.1))
        trace_id = str(trace_id or uuid.uuid4().hex)
        riddle_tts_config = self._tts_config_snapshot()
        generation_started = time.perf_counter()
        riddle_res = self.game.process_riddle_gift("streamer", None, force=True)
        if not riddle_res:
            self._palavra_debug("riddle.ignored", source="manual", reason="stage_unavailable",
                                game_id=self.game.game_id, current_stage=self.game.current_riddle_stage,
                                trace_id=trace_id)
            self._log_event("notice", "warning", "palavra.riddle.rejected", "[Palavra] Não há etapa de charada disponível.",
                            game="palavra", game_id=self.game.game_id, trace_id=trace_id,
                            code="PALAVRA_RIDDLE_STAGE_UNAVAILABLE",
                            details={"current_stage": self.game.current_riddle_stage})
            return
        stage = riddle_res["stage"]
        cluster_words = self.game.hint_cluster(target_rank)
        self._palavra_debug("riddle.generation_started", source="manual", game_id=self.game.game_id,
                            stage=stage, target_rank=target_rank, clue_count=len(cluster_words), trace_id=trace_id)
        emit(self.tenant_id, "game", {
            "type": "roulette_drop",
            "reward_type": "riddle_started",
            "stage": stage,
            "user": "streamer",
            "nickname": "Streamer",
            "avatar": "",
            "gift": None,
            "active_gift": self.game.get_active_gift(),
            "tension_score": getattr(self.game, "tension_score", 0),
            "is_final_boss": getattr(self.game, "is_final_boss", False),
        })
        self._log_event("game", "info", "palavra.riddle.generation_started",
                        f"[Palavra] Geração de charada do estágio {stage} iniciada.", game="palavra",
                        game_id=self.game.game_id, trace_id=trace_id,
                        details={"stage": stage, "clue_candidate_count": len(cluster_words)})
        try:
            riddle_text = await generate_openrouter_riddle(self.game.secret_word, cluster_words)
        except Exception as exc:
            self._palavra_debug("riddle.generation_failed", source="manual",
                                game_id=self.game.game_id, stage=stage,
                                trace_id=trace_id,
                                error_type=type(exc).__name__,
                                generation_ms=round((time.perf_counter() - generation_started) * 1000))
            self._log_event("error", "error", "palavra.riddle.generation_failed",
                            "[Palavra] Não foi possível gerar a charada.", game="palavra",
                            game_id=self.game.game_id, trace_id=trace_id,
                            code="PALAVRA_RIDDLE_GENERATION_FAILED",
                            duration_ms=round((time.perf_counter() - generation_started) * 1000),
                            details={"stage": stage, "error_type": type(exc).__name__})
            return
        asyncio.create_task(self._narrate_riddle_async(
            stage, riddle_text, trace_id=trace_id, tts_config=riddle_tts_config
        ))
        emit(self.tenant_id, "game", {
            "type": "roulette_drop",
            "reward_type": "riddle_ready",
            "stage": stage,
            "user": "streamer",
            "nickname": "Streamer",
            "avatar": "",
            "gift": None,
            "text": riddle_text,
            "audio_url": None,
            "words": cluster_words,
            "active_gift": self.game.get_active_gift(),
            "tension_score": getattr(self.game, "tension_score", 0),
            "is_final_boss": getattr(self.game, "is_final_boss", False),
        })
        self._log_event("game", "info", "palavra.riddle.ready",
                        f"[Palavra] Charada do estágio {stage} liberada.", game="palavra",
                        game_id=self.game.game_id, trace_id=trace_id,
                        details={"stage": stage, "text_length": len(riddle_text or "")})
        self._palavra_debug("riddle.generated", source="manual", game_id=self.game.game_id,
                            stage=stage, text_length=len(riddle_text or ""),
                            generation_ms=round((time.perf_counter() - generation_started) * 1000), trace_id=trace_id)
        self._palavra_debug("riddle.ready_sent", source="manual", game_id=self.game.game_id,
                            stage=stage, text_length=len(riddle_text or ""), trace_id=trace_id)

    def _emit_caca_found(self, w):
        emit(self.tenant_id, "game", {
            "type": "caca_word_found",
            "id": w["id"],
            "word": w["text"],
            "start": w["start"],
            "end": w["end"],
            "finder": w["finder"],
            "nickname": w["finder_nickname"],
            "avatar": w["finder_avatar"],
        })
        st = self.caca.state(public=False)
        emit(self.tenant_id, "game", {"type": "caca_state", **st})
        if st["finished"]:
            emit(self.tenant_id, "game", {"type": "caca_finished", "found_count": st["found_count"], "total": st["total"]})
            emit(self.tenant_id, "log", "[CacaPalavras] Todas as palavras encontradas! Jogo encerrado.")
        else:
            emit(self.tenant_id, "log", f"[CacaPalavras] {w['finder_nickname']} encontrou uma palavra ({w['start']}:{w['end']}).")

    async def _command_loop(self):
        while True:
            cmd = await self.queue.get()
            c = cmd.get("cmd")
            if c == "new_game":
                trace_id = str(cmd.get("trace_id") or "") or None
                self._palavra_debug(
                    "start.command_received",
                    source="panel",
                    trace_id=trace_id,
                    game_id=getattr(self.game, "game_id", None),
                    game_status="running" if self.game.secret_word and not self.game.finished else ("finished" if self.game.finished else "idle"),
                    guess_count=len(self.game.guesses or []),
                    room_id=self.current_room_id or self._live_room_id() or None,
                )
                self._stop_other_chat_games()
                await self.start_game(
                    hint_gifts=cmd.get("hint_gifts"),
                    riddle_gifts=cmd.get("riddle_gifts"),
                    size_gift=cmd.get("size_gift") or "",
                    letter_gift=cmd.get("letter_gift") or "",
                    source="panel",
                    trace_id=trace_id,
                )
            elif c == "end_game":
                await self.end_game(cause="panel", trace_id=cmd.get("trace_id"))
            elif c == "manual_hint":
                trace_id = cmd.get("trace_id")
                self._palavra_debug("hint.command_received", source="panel", game_id=getattr(self.game, "game_id", None), trace_id=trace_id)
                await self.manual_hint(trace_id=trace_id)
            elif c == "manual_riddle":
                trace_id = cmd.get("trace_id")
                self._palavra_debug("riddle.command_received", source="panel", game_id=getattr(self.game, "game_id", None), trace_id=trace_id)
                await self.manual_riddle(trace_id=trace_id)
            elif c == "caca_start":
                await self.end_game(cause="switch_to_caca")
                self._stop_other_chat_games(keep="caca")
                self.caca.start(word_pool=self.game.word_pool, count=int(cmd.get("count") or 10))
                emit(self.tenant_id, "game", {"type": "caca_state", **self.caca.state(public=False)})
                emit(self.tenant_id, "log", f"[CacaPalavras] Grade gerada com {len(self.caca.words)} palavras")
            elif c == "caca_stop":
                self.caca.stop()
                emit(self.tenant_id, "game", {"type": "caca_state", **self.caca.state(public=False)})
                emit(self.tenant_id, "log", "[CacaPalavras] Jogo encerrado")
            elif c == "caca_reveal":
                w = self.caca.find_word(
                    str(cmd.get("start") or ""),
                    str(cmd.get("end") or ""),
                    finder="streamer",
                    nickname="Streamer",
                    avatar="",
                )
                if w:
                    self._emit_caca_found(w)
            elif c in ("corda_start", "corda_new_match"):
                self.corda.start(cmd.get("config") or {})
                emit(self.tenant_id, "log", "[CORDA] Nova partida iniciada")
            elif c == "corda_stop":
                self.corda.stop()
                emit(self.tenant_id, "log", "[CORDA] Jogo parado")
            elif c == "corda_target":
                self.corda.update_target(cmd.get("tap_target"))
            elif c == "corda_test":
                self.corda.add_force(cmd.get("side"), cmd.get("force", 25), "test", "streamer")
            elif c == "duelo_start":
                self._cancel_duelo_match_restart()
                self._cancel_duelo_timed_tasks()
                self.duelo.start(gifts=cmd.get("gifts"), settings=cmd.get("settings"))
                emit(self.tenant_id, "game", {"type": "duelo_state", **self.duelo.state()})
                if self.duelo._is_timed():
                    self._start_duelo_timer()
                emit(self.tenant_id, "log", f"[Duelo] Área ativa (modo {self.duelo.mode}{'/' + str(self.duelo.settings.get('game_mode')) if self.duelo._is_timed() else ''}, presentes {len(self.duelo.gifts)})")
            elif c == "duelo_stop":
                self._cancel_duelo_match_restart()
                self._cancel_duelo_timed_tasks()
                self.duelo.stop()
                if self._duelo_reset_task:
                    self._duelo_reset_task.cancel()
                    self._duelo_reset_task = None
                emit(self.tenant_id, "game", {"type": "duelo_state", **self.duelo.state()})
                emit(self.tenant_id, "log", "[Duelo] Área parada")
            elif c == "duelo_config":
                self.duelo.set_config(gifts=cmd.get("gifts"), settings=cmd.get("settings"))
                emit(self.tenant_id, "log", f"[Duelo] Config de presentes atualizada ({len(self.duelo.gifts)})")
                if self.duelo.active:
                    if self.duelo._is_timed() and self.duelo.roundActive and self._duelo_timer_task is None:
                        # Garante o cronômetro ao trocar para o modo Tempo com a área já ativa.
                        if self.duelo.time_remaining <= 0 and not self.duelo.winner and not self.duelo.final:
                            self.duelo._reset_timed_clock()
                        self._start_duelo_timer()
                    if self._duelo_reset_task is not None and self.duelo.winner and not self.duelo.roundActive and not self.duelo.final:
                        # Delay alterado durante o resultado: reagenda a próxima batalha com o novo tempo.
                        self._schedule_duelo_reset(max(2, int(self.duelo.settings.get("reset_delay_s", 6) or 6)))
                    emit(self.tenant_id, "game", {"type": "duelo_state", **self.duelo.state()})
            elif c == "duelo_reset_round":
                self._cancel_duelo_match_restart()
                if self._duelo_reset_task:
                    self._duelo_reset_task.cancel()
                    self._duelo_reset_task = None
                self.duelo.reset_round()
                emit(self.tenant_id, "game", {"type": "duelo_state", **self.duelo.state()})
                emit(self.tenant_id, "log", f"[Duelo] Rodada reiniciada (hp {self.duelo.hp['flavio']}/{self.duelo.settings.get('hp_max')}, escudo {self.duelo.shield['flavio']}/{self.duelo.settings.get('shield_max')})")
            elif c == "duelo_new_match":
                self._cancel_duelo_match_restart()
                self._cancel_duelo_timed_tasks()
                if self._duelo_reset_task:
                    self._duelo_reset_task.cancel()
                    self._duelo_reset_task = None
                self.duelo.reset_match()
                emit(self.tenant_id, "game", {"type": "duelo_state", **self.duelo.state()})
                if self.duelo._is_timed():
                    self._start_duelo_timer()
                emit(self.tenant_id, "log", "[Duelo] Nova disputa iniciada (votos/debates zerados)")
            elif c == "tres_start":
                palavra = str(cmd.get("palavra") or "").strip()
                dicas = cmd.get("dicas") or []
                trace_id = str(cmd.get("trace_id") or "") or None
                next_round_id = int(getattr(self.tres, "round_id", 0) or 0) + 1
                preparation_started = time.perf_counter()
                self._log_event("game", "info", "tres.start.command_received",
                                "[3 Dicas] Solicitação de início recebida.", game="tres",
                                game_id=str(next_round_id), trace_id=trace_id,
                                details={"custom_word_supplied": bool(palavra), "custom_clues_supplied": len(dicas) >= 3})
                if not palavra:
                    palavra = self._pick_tres_word()
                if not palavra:
                    self._log_event("notice", "warning", "tres.start.rejected",
                                    "[3 Dicas] Não há palavra disponível para iniciar a rodada.", game="tres",
                                    game_id=str(next_round_id), trace_id=trace_id,
                                    code="TRES_WORD_UNAVAILABLE")
                    continue
                try:
                    self._mark_tres_played(palavra)
                    if not dicas or len(dicas) < 3:
                        def log_generation(event, details):
                            fallback = event.endswith("fallback")
                            self._log_event(
                                "notice" if fallback else "diagnostic",
                                "warning" if fallback else "debug",
                                "tres." + event,
                                "[3 Dicas] Dicas geradas com fallback." if fallback else "[3 Dicas] Dicas geradas.",
                                game="tres", game_id=str(next_round_id), trace_id=trace_id,
                                duration_ms=details.get("duration_ms"),
                                details={**details, "word_length": len(palavra)},
                            )
                        dicas = await generate_tres_dicas(palavra, log_cb=log_generation)
                    await self.end_game(cause="switch_to_tres")
                    self._stop_other_chat_games(keep="tres")
                    self.tres.start(palavra, dicas, trace_id=trace_id)
                    self._log_event("game", "info", "tres.start.accepted",
                                    "[3 Dicas] Rodada preparada e iniciada.", game="tres",
                                    game_id=str(self.tres.round_id), trace_id=trace_id,
                                    duration_ms=round((time.perf_counter() - preparation_started) * 1000),
                                    details={"word_length": len(palavra), "clue_count": len(dicas[:3])})
                    emit(self.tenant_id, "game", {"type": "tres_weekly", "weekly": db.get_tres_weekly(self.tenant_id, 10)})
                except Exception as exc:
                    self._log_event("error", "error", "tres.start.failed",
                                    "[3 Dicas] Não foi possível iniciar a rodada.", game="tres",
                                    game_id=str(next_round_id), trace_id=trace_id,
                                    code="TRES_START_FAILED",
                                    duration_ms=round((time.perf_counter() - preparation_started) * 1000),
                                    details={"error_type": type(exc).__name__})
            elif c == "tres_stop":
                self.tres.trace_id = str(cmd.get("trace_id") or self.tres.trace_id or "") or None
                self.tres.stop()
                emit(self.tenant_id, "game", {"type": "tres_state", **self.tres.state(public=False)})
            elif c == "tres_pause":
                self.tres.trace_id = str(cmd.get("trace_id") or self.tres.trace_id or "") or None
                self.tres.pause()
                emit(self.tenant_id, "game", {"type": "tres_state", **self.tres.state(public=False)})
            elif c == "tres_resume":
                self.tres.trace_id = str(cmd.get("trace_id") or self.tres.trace_id or "") or None
                self.tres.resume()
                emit(self.tenant_id, "game", {"type": "tres_state", **self.tres.state(public=False)})
            elif c == "tres_reset":
                self.tres.reset(trace_id=cmd.get("trace_id"))
                emit(self.tenant_id, "game", {"type": "tres_state", **self.tres.state(public=False)})
            elif c == "tres_config":
                self.tres.set_gift_config(cmd.get("config") or {})
                self._log_event("game", "info", "tres.config.updated",
                                "[3 Dicas] Configuração da rodada atualizada.", game="tres",
                                game_id=str(self.tres.round_id) if self.tres.round_id else None,
                                trace_id=cmd.get("trace_id"),
                                details={
                                    "size_gift_configured": bool(self.tres.gift_config.get("size")),
                                    "letter_gift_configured": bool(self.tres.gift_config.get("letter")),
                                    "ticket_configured": bool(self.tres.gift_config.get("ticket")),
                                    "stage_times": list(self.tres.stage_times.values()),
                                    "stage_points": list(self.tres.stage_points.values()),
                                })
            elif c == "vpet_start":
                await self.end_game(cause="switch_to_vpet")
                self._stop_other_chat_games(keep="vpet")
                self.vpet.start()
                emit(self.tenant_id, "game", {"type": "vpet_state", **self.vpet.public_state()})
            elif c == "vpet_stop":
                self.vpet.stop()
                emit(self.tenant_id, "game", {"type": "vpet_state", **self.vpet.public_state()})
                emit(self.tenant_id, "log", "[Bichinho] Mascote desativado")
            elif c == "vpet_battle_start":
                ok = self.vpet.start_battle(force=True)
                emit(self.tenant_id, "log", "[Bichinho] Boss forçado invocado!" if ok else "[Bichinho] Não foi possível invocar o boss")
            elif c == "vpet_assistant_mode":
                self.vpet.set_assistant_mode(bool(cmd.get("enabled")))
                emit(self.tenant_id, "game", {"type": "vpet_state", **self.vpet.public_state()})
            elif c == "stop":
                break

    async def run(self):
        session_context = bind_session_id(self.session_id)
        handler_task = None
        cmd_task = None
        narration_task = None
        cancelled = False
        try:
            self._log_event("connection", "info", "connection.session.waiting_live",
                            "Sessão do daemon aguardando a live ficar disponível.",
                            trace_id=self.connect_trace_id,
                            details={"engine": self.engine})
            handler_task = asyncio.create_task(self.handler.run())
            cmd_task = asyncio.create_task(self._command_loop())
            narration_task = asyncio.create_task(self._chat_narration_worker())
            self._chat_narration_task = narration_task
            self._likes_loop_task = asyncio.create_task(self._likes_loop())
            self._vpet_task = asyncio.create_task(self.vpet.run())
            self._corda_task = asyncio.create_task(self._corda_loop())
            await asyncio.wait({handler_task, cmd_task}, return_when=asyncio.FIRST_COMPLETED)
        except asyncio.CancelledError:
            cancelled = True
        finally:
            try:
                tasks = [t for t in (
                    handler_task, cmd_task, narration_task, self._likes_loop_task, self._vpet_task,
                    self._corda_task, self._tres_task, self._duelo_reset_task,
                    self._duelo_match_task, self._duelo_timer_task, self._duelo_round_result_task,
                ) if t is not None and not t.done()]
                for task in tasks:
                    task.cancel()
                if tasks:
                    done, pending = await asyncio.wait(tasks, timeout=5)
                    if pending:
                        self._log_event("diagnostic", "warning", "connection.session.tasks_pending",
                                        "Há tarefas de sessão pendentes durante o encerramento.",
                                        trace_id=self.shutdown_trace_id or self.connect_trace_id,
                                        code="SESSION_TASKS_PENDING", details={"pending_count": len(pending)})
                        for task in pending:
                            task.cancel()
                        try:
                            await asyncio.wait_for(asyncio.gather(*pending, return_exceptions=True), timeout=5)
                        except (asyncio.TimeoutError, asyncio.CancelledError):
                            self._log_event("notice", "warning", "connection.session.tasks_unconfirmed",
                                            "Algumas tarefas não confirmaram o encerramento.",
                                            trace_id=self.shutdown_trace_id or self.connect_trace_id,
                                            code="SESSION_TASKS_UNCONFIRMED")

                self._likes_loop_task = None
                self._chat_narration_task = None
                self._vpet_task = None
                self._corda_task = None
                self._tres_task = None
                self._duelo_reset_task = None
                self._duelo_match_task = None
                self._duelo_timer_task = None
                self._duelo_round_result_task = None
                self.corda.stop()
                self.battle.stop()
                if self.game and self.game.secret_word and not self.game.finished:
                    self._palavra_debug("end.begin", cause="session_disconnect", game_id=self.game.game_id,
                                        guess_count=len(self.game.guesses or []),
                                        room_id=self.current_room_id or self._live_room_id() or None,
                                        trace_id=self.shutdown_trace_id or self.connect_trace_id)
                    payload = self.game.finalize_game(room_id=self._live_room_id())
                    if payload:
                        emit(self.tenant_id, "game", payload)
                        self._palavra_debug("end.finished", cause="session_disconnect",
                                            game_id=self.game.game_id, winner=payload.get("winner"),
                                            guess_count=len(self.game.guesses or []),
                                            trace_id=self.shutdown_trace_id or self.connect_trace_id)
                        emit(self.tenant_id, "log", "[FIM] Partida encerrada devido à desconexão.")
                self._reset_chat_narration(False)
                self._flush_chat_narration_stats()
                self._log_event("connection", "info", "connection.session.ended",
                                "Sessão do daemon encerrada.",
                                trace_id=self.shutdown_trace_id or self.connect_trace_id,
                                details={"engine": self.engine})
                emit(self.tenant_id, "status", {"state": "offline"})
            finally:
                clear_active_session_id(self.tenant_id, self.session_id)
                reset_session_id(session_context)
        if cancelled:
            raise asyncio.CancelledError


sessions = {}
gift_tags = JogoContexto.load_default_gift_tags()


def emit_service_log(tenant_id, category, level, event, message, game="", trace_id=None, code=None, details=None):
    emit(tenant_id, "log", {
        "text": str(message or ""),
        "category": category,
        "level": level,
        "event": event,
        "source": "python",
        "game": game or "",
        "trace_id": trace_id or None,
        "code": code or None,
        "details": details or None,
    })


async def stop_session_task(tid, expected_session_id=None):
    s = sessions.get(tid)
    if not s:
        return False
    if expected_session_id and str(expected_session_id) != str(s.session_id):
        return False
    sessions.pop(tid, None)
    try:
        if s.task and not s.task.done():
            # Stop cooperativamente para que GameSession.run drene os handlers
            # filhos antes de permitir uma nova sessão para o mesmo tenant.
            try:
                s.queue.put_nowait({"cmd": "stop"})
            except Exception:
                pass
            done, _ = await asyncio.wait({s.task}, timeout=8)
            if not done:
                s.task.cancel()
                try:
                    await asyncio.wait_for(asyncio.gather(s.task, return_exceptions=True), timeout=5)
                except (Exception, asyncio.CancelledError, asyncio.TimeoutError):
                    pass
        return True
    finally:
        clear_active_session_id(tid, s.session_id)


async def _run_gifts_sync(tid):
    """Sincroniza o catálogo de gifts em background (não bloqueia o loop de comandos)."""
    global _gifts_sync_running
    if _gifts_sync_running:
        emit(tid, "log", "[Gifts] Sincronização já em andamento.")
        return
    _gifts_sync_running = True
    try:
        import sync_gifts as _sync
        emit(tid, "log", "[Gifts] Sincronizando catálogo de presentes com o TikTok...")
        result = await _sync.sync(username=None, download=True, log=lambda m: emit(tid, "log", m))
        # Recarrega o catálogo em memória (singleton) para o jogo resolver os novos
        # ids/gifts sem precisar reiniciar o daemon.
        try:
            import gifts_catalog as _catalog
            inst = _catalog.get_catalog()
            if inst:
                inst.refresh()
                emit(tid, "log", f"[Gifts] Catálogo em memória recarregado ({len(inst._rows)} gifts)")
        except Exception:
            pass
        emit(tid, "gifts_synced", result)
        emit(tid, "log", f"[Gifts] Catálogo atualizado: +{result.get('inserted', 0)} novos, "
                          f"{result.get('updated', 0)} atualizados, {result.get('unavailable', 0)} indisponíveis.")
    except Exception as e:
        emit(tid, "log", {"text": "[Gifts] Falha na sincronização do catálogo.", "category": "error",
                            "level": "error", "event": "gifts.sync.failed", "source": "python",
                            "code": "GIFTS_SYNC_FAILED", "details": {"error_type": type(e).__name__}})
        emit(tid, "gifts_synced", {"error": str(e)})
    finally:
        _gifts_sync_running = False


async def process_commands(queue):
    while True:
        cmd = await queue.get()
        c = cmd.get("cmd")
        if c == "shutdown":
            break
        # Comandos do jogo publico (site) nao tem tenant_id e nao usam sessao de live.
        if c and c.startswith("public_"):
            await handle_public_command(cmd)
            continue
        tid = cmd.get("tenant_id")
        if not tid:
            continue

        if c == "start":
            if tid in sessions:
                await stop_session_task(tid)
            session_id = str(cmd.get("session_id") or uuid.uuid4().hex)
            set_active_session_id(tid, session_id)
            session = GameSession(
                tenant_id=tid,
                username=str(cmd.get("username", "")).lstrip("@"),
                api_key=str(cmd.get("api_key", "")),
                history_path=cmd.get("history_path"),
                gift_tags=gift_tags,
                engine=str(cmd.get("engine", "tiktools") or "tiktools"),
                session_id=session_id,
                connect_trace_id=cmd.get("trace_id"),
            )
            settings = cmd.get("settings")
            if isinstance(settings, dict):
                session.settings = normalize_settings(settings)
            tres_gifts = cmd.get("tres_gifts")
            if isinstance(tres_gifts, dict):
                session.tres.set_gift_config(tres_gifts)
            caca_config = cmd.get("caca_config")
            if isinstance(caca_config, dict):
                session.caca_prefix = str(caca_config.get("prefix") or "").strip()
            sessions[tid] = session
            session.task = asyncio.create_task(session.run())
            emit(tid, "log", {"text": "Sessão do daemon iniciada.", "category": "connection", "level": "info",
                               "event": "connection.session.started", "source": "python",
                               "session_id": session.session_id, "trace_id": session.connect_trace_id,
                               "details": {"engine": session.engine,
                                           "tts_voice_configured": bool(session.settings.get("tts_voice")),
                                           "tts_rate": session.settings.get("tts_rate", 1.0)}})

        elif c == "stop":
            expected = cmd.get("session_id")
            existing_session = sessions.get(tid)
            if existing_session:
                existing_session.shutdown_trace_id = str(cmd.get("trace_id") or "") or None
            await stop_session_task(tid, expected)
            clear_active_session_id(tid, expected)
            s = sessions.get(tid)
            if s and getattr(s, "duelo", None):
                s.duelo.reset_teams()

        elif c == "sync_gifts":
            asyncio.create_task(_run_gifts_sync(tid))

        elif c == "battle_start":
            s = sessions.get(tid)
            duration = int(cmd.get("duration") or 180)
            if s:
                s.battle.start(duration, room_id=getattr(s.handler, "_room_id", None) or "")
                emit_service_log(tid, "game", "info", "batalha.round.started",
                                 "[Batalha] Rodada iniciada.", game="batalha",
                                 trace_id=cmd.get("trace_id"), details={"duration_seconds": duration})
            else:
                emit_service_log(tid, "notice", "warning", "batalha.start.rejected",
                                 "[Batalha] Sessão não ativa; conecte a live primeiro.", game="batalha",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE")

        elif c == "battle_stop":
            s = sessions.get(tid)
            if s:
                await s.battle.end_round()
                emit_service_log(tid, "game", "info", "batalha.round.stopped",
                                 "[Batalha] Rodada finalizada.", game="batalha", trace_id=cmd.get("trace_id"))
            else:
                emit_service_log(tid, "notice", "warning", "batalha.stop.rejected",
                                 "[Batalha] Sessão não ativa.", game="batalha",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE")

        elif c == "new_game":
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit_service_log(tid, "notice", "warning", "palavra.start.rejected",
                                 "[Palavra] Sessão não ativa para iniciar partida.", game="palavra",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE")

        elif c == "end_game":
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit_service_log(tid, "notice", "warning", "palavra.end.rejected",
                                 "[Palavra] Sessão não ativa para encerrar partida.", game="palavra",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE")

        elif c in ("manual_hint", "manual_riddle"):
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit_service_log(tid, "notice", "warning", f"palavra.{c}.rejected",
                                 "[Palavra] Sessão não ativa para executar a ação.", game="palavra",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE", details={"command": c})

        elif c in ("caca_start", "caca_stop", "caca_reveal"):
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit_service_log(tid, "notice", "warning", f"caca.{c.removeprefix('caca_')}.rejected",
                                 "[Caça Palavras] Sessão não ativa para executar a ação.", game="caca",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE", details={"command": c})

        elif c in ("tres_start", "tres_stop", "tres_pause", "tres_resume", "tres_reset", "tres_config"):
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit_service_log(tid, "notice", "warning", f"tres.{c.removeprefix('tres_')}.rejected",
                                 "[3 Dicas] Sessão não ativa para executar a ação.", game="tres",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE", details={"command": c})

        elif c in ("corda_start", "corda_stop", "corda_new_match", "corda_test", "corda_target", "duelo_start", "duelo_stop", "duelo_config", "duelo_reset_round", "duelo_new_match"):
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                target_game = "corda" if c.startswith("corda_") else "duelo"
                emit_service_log(tid, "notice", "warning", f"{target_game}.{c.split('_', 1)[-1]}.rejected",
                                 f"[{target_game.upper()}] Sessão não ativa para executar a ação.", game=target_game,
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE", details={"command": c})

        elif c in ("vpet_start", "vpet_stop", "vpet_battle_start", "vpet_assistant_mode"):
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit_service_log(tid, "notice", "warning", f"vpet.{c.removeprefix('vpet_')}.rejected",
                                 "[Bichinho] Sessão não ativa para executar a ação.", game="vpet",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE", details={"command": c})

        elif c == "caca_config":
            s = sessions.get(tid)
            if s:
                s.caca_prefix = str(cmd.get("prefix") or "").strip()
                emit_service_log(tid, "game", "info", "caca.config.applied",
                                 "[Caça Palavras] Configuração aplicada.", game="caca",
                                 trace_id=cmd.get("trace_id"), details={"prefix_enabled": bool(s.caca_prefix),
                                                                        "prefix_length": len(s.caca_prefix)})
            else:
                emit_service_log(tid, "notice", "warning", "caca.config.rejected",
                                 "[Caça Palavras] Configuração não aplicada: sessão não ativa.", game="caca",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE")

        elif c == "update_gift_config":
            s = sessions.get(tid)
            if s:
                s.game.hint_gifts = cmd.get("hint_gifts") or []
                s.game.riddle_gifts = cmd.get("riddle_gifts") or []
                if "size_gift" in cmd:
                    s.game.size_gift = str(cmd.get("size_gift") or "")
                if "letter_gift" in cmd:
                    s.game.letter_gift = str(cmd.get("letter_gift") or "")
                emit_service_log(tid, "game", "info", "palavra.gift_config.applied",
                                 "[Palavra] Configuração de presentes aplicada.", game="palavra",
                                 trace_id=cmd.get("trace_id"), details={
                                     "hint_gift_count": len(s.game.hint_gifts or []),
                                     "riddle_gift_count": len(s.game.riddle_gifts or []),
                                     "size_gift_configured": bool(s.game.size_gift),
                                     "letter_gift_configured": bool(s.game.letter_gift),
                                 })
            else:
                emit_service_log(tid, "notice", "warning", "palavra.gift_config.rejected",
                                 "[Palavra] Configuração de presentes não aplicada: sessão não ativa.", game="palavra",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE")

        elif c == "update_settings":
            s = sessions.get(tid)
            if s:
                previous_tts_settings = (
                    bool(s.settings.get("chat_narr_enabled")),
                    s.settings.get("chat_narr_mode", "all"),
                    s.settings.get("chat_narr_char", "#"),
                    s.settings.get("tts_voice", ""),
                    s.settings.get("tts_rate", 1.0),
                )
                s.settings = normalize_settings(cmd.get("settings"))
                current_tts_settings = (
                    bool(s.settings.get("chat_narr_enabled")),
                    s.settings.get("chat_narr_mode", "all"),
                    s.settings.get("chat_narr_char", "#"),
                    s.settings.get("tts_voice", ""),
                    s.settings.get("tts_rate", 1.0),
                )
                if previous_tts_settings != current_tts_settings:
                    s._reset_chat_narration(bool(s.settings.get("chat_narr_enabled")))
                s.game.boss_mode = bool(s.settings.get("boss_mode", True))
                # Meta de tap: aplica em runtime preservando o progresso atual
                s._tap_meta_x2 = False
                s.tap_meta_total = int(s.settings.get("tap_meta", 1000) or 1000)
                if s.game.secret_word and not s.game.finished:
                    s._apply_tap_meta_x2()
                    s_pub = s._tap_meta_public()
                    emit(tid, "game", {
                        "type": "likes_ranking",
                        "ranking": s.build_likes_ranking(5),
                        "ranking_all": s.build_likes_ranking(10),
                        "tap_meta_current": s_pub["tap_meta_current"],
                        "tap_meta_total": s_pub["tap_meta_total"],
                        "tap_meta_ready": s_pub["tap_meta_ready"],
                        "tap_meta_multiplier": s_pub["tap_meta_multiplier"],
                    })
                    await s._check_tap_meta()
                emit_service_log(tid, "game", "info", "palavra.settings.applied",
                                 "[Palavra] Preferências aplicadas à sessão.", game="palavra",
                                 trace_id=cmd.get("trace_id"), details={
                                     "boss_mode": bool(s.settings["boss_mode"]),
                                     "followers_only": bool(s.settings["apenas_seguidores"]),
                                     "heart_me_only": bool(s.settings["apenas_heart_me"]),
                                     "hint_percent": int(s.settings["pct_dica"]),
                                     "riddle_percent": int(s.settings["pct_charada"]),
                                     "tap_target": int(s.tap_meta_total),
                                 })
            else:
                emit_service_log(tid, "notice", "warning", "palavra.settings.rejected",
                                 "[Palavra] Preferências não aplicadas: sessão não ativa.", game="palavra",
                                 trace_id=cmd.get("trace_id"), code="SESSION_NOT_ACTIVE")

        elif c == "elevenlabs_test":
            trace_id = str(cmd.get("trace_id") or uuid.uuid4().hex)
            task = asyncio.create_task(_test_elevenlabs_voice(tid, trace_id))
            _elevenlabs_test_tasks.add(task)
            task.add_done_callback(_elevenlabs_test_tasks.discard)

        elif c == "tts_test":
            text = cmd.get("text") or "Olá! Esta é a voz para as charadas do jogo Contexto."
            rate = cmd.get("rate")
            if not isinstance(rate, (int, float)) or not math.isfinite(float(rate)):
                rate = 1.0
            voice_key = str(cmd.get("voice") or tts.VOICE_EDGE_ANTONIO)
            trace_id = str(cmd.get("trace_id") or uuid.uuid4().hex)
            test_started = time.perf_counter()
            emit_service_log(tid, "diagnostic", "debug", "tts.test.started",
                             "Teste de síntese de voz iniciado.", game="tts", trace_id=trace_id,
                             details={"voice": voice_key, "rate": float(rate)})
            audio_dir = os.path.join(TTS_AUDIO_ROOT, str(tid))
            try:
                audio_path = await asyncio.to_thread(tts.synthesize_edge, text, audio_dir, voice_key, float(rate))
            except Exception as exc:
                emit_service_log(tid, "error", "error", "tts.test.failed",
                                 "Não foi possível gerar o áudio de teste.", game="tts", trace_id=trace_id,
                                 code="TTS_TEST_SYNTHESIS_FAILED",
                                 details={"voice": voice_key, "rate": float(rate), "error_type": type(exc).__name__})
                continue
            if audio_path:
                emit(tid, "tts_test_ready", f"/tts-audio/{tid}/{os.path.basename(audio_path)}")
                emit_service_log(tid, "diagnostic", "debug", "tts.test.completed",
                                 "Áudio de teste sintetizado.", game="tts", trace_id=trace_id,
                                 details={"voice": voice_key, "rate": float(rate),
                                          "duration_ms": round((time.perf_counter() - test_started) * 1000)})
            else:
                emit_service_log(tid, "error", "error", "tts.test.failed",
                                 "Não foi possível gerar o áudio de teste.", game="tts", trace_id=trace_id,
                                 code="TTS_TEST_SYNTHESIS_FAILED",
                                 details={"voice": voice_key, "rate": float(rate),
                                          "reason": "EDGE_TTS_NO_AUDIO"})

    for tid in list(sessions.keys()):
        await stop_session_task(tid)


def stdin_reader(loop, queue):
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except Exception:
                continue
            asyncio.run_coroutine_threadsafe(queue.put(cmd), loop)
    finally:
        # Push shutdown command when sys.stdin closes (EOF)
        asyncio.run_coroutine_threadsafe(queue.put({"cmd": "shutdown"}), loop)


async def main():
    db.init_db()
    loop = asyncio.get_running_loop()
    cmd_queue = asyncio.Queue()
    reader = threading.Thread(target=stdin_reader, args=(loop, cmd_queue), daemon=True)
    reader.start()
    emit(None, "log", "[Service] Daemon Jogo Contexto iniciado")
    await process_commands(cmd_queue)
    emit(None, "log", "[Service] Daemon encerrado")


if __name__ == "__main__":
    asyncio.run(main())
