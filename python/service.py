import asyncio
import json
import os
import re
import sys
import threading
import time
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
import db
import tts

TTS_AUDIO_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "node", "public", "tts-audio")
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://painel.tikplay.com.br")

_gifts_sync_running = False


from service_common import DEFAULT_SETTINGS, normalize_settings, get_rank_color, emit


async def generate_openrouter_riddle(secret_word: str, words: list) -> str:
    api_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    words_str = ", ".join(words)
    if api_key:
        try:
            import urllib.request
            req_body = json.dumps({
                "model": "openai/gpt-4o-mini",
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
                "temperature": 0.7,
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


async def generate_tres_dicas(secret_word: str) -> list:
    """Gera 3 dicas progressivas (difícil → fácil) para a palavra secreta.

    Retorna uma lista de 3 strings. Fallback textual caso a API falhe.
    """
    api_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    fallback = [
        "Ixi, a inteligência artificial foi lá tratar das cabras...",
        "O sistema deu uma cochilada ouvindo moda de viola...",
        f"Rodada brinde para os rápidos! A palavra é: {secret_word.upper()}"
    ]
    if not api_key:
        return fallback
    import urllib.request
    root_norm = strip_accents(secret_word).lower()
    root_len = max(3, len(root_norm) - 2)
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
                        return dicas[:3]
        except Exception:
            continue
    return fallback


class GameSession:
    def __init__(self, tenant_id, username, api_key, history_path, gift_tags, engine="tiktools"):
        self.tenant_id = tenant_id
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
        )
        self.handler._emit_status = self.emit_status
        self.handler.log_cb = lambda text: emit(self.tenant_id, "log", text)
        self.queue = asyncio.create_task if False else asyncio.Queue()
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

    def _track_levels(self, user, nickname, avatar, user_meta, room_id=None):
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
        if prev is not None and prev[0] == g and prev[1] == f:
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
            "ts": int(time.time() * 1000),
        })

    def _rate_value(self) -> float:
        try:
            return float(self.settings.get("tts_rate") or 1.0)
        except (TypeError, ValueError):
            return 1.0

    async def _tts_url(self, text: str) -> str:
        """Gera áudio da charada com o motor Edge e retorna a URL pública (Edge-only)."""
        if not text:
            return None
        voice_key = str(self.settings.get("tts_voice") or tts.VOICE_EDGE_ANTONIO)
        audio_dir = os.path.join(TTS_AUDIO_ROOT, str(self.tenant_id))
        try:
            audio_path = await asyncio.to_thread(tts.synthesize_edge, text, audio_dir, voice_key, self._rate_value())
            if not audio_path:
                # Edge e flaky: tenta mais uma vez (1ª falha pode ser transitoria)
                await asyncio.sleep(0.8)
                audio_path = await asyncio.to_thread(tts.synthesize_edge, text, audio_dir, voice_key, self._rate_value())
        except Exception as e:
            self._throttled_log("tts_err", f"[TTS] erro ao sintetizar '{voice_key}': {type(e).__name__}: {e}", game="tts", level="err")
            return None
        if not audio_path:
            motivo = getattr(tts, "EDGE_LAST_ERROR", "") or ""
            suffix = f" | motivo: {motivo}" if motivo else ""
            self._throttled_log("tts_noaudio", f"[TTS] sem áudio (Edge falhou) para: '{text[:40]}'{suffix}", game="tts", level="warn", secs=5.0)
            return None
        return f"/tts-audio/{self.tenant_id}/{os.path.basename(audio_path)}"

    async def _narrate_riddle_async(self, stage, riddle_text):
        """Gera o áudio da charada em background (não trava a liberação na live)
        e emite 'riddle_audio' quando o mp3 fica pronto."""
        try:
            audio_url = await self._tts_url(riddle_text)
        except Exception as e:
            emit(self.tenant_id, "log", f"[TTS] erro ao gerar audio em background: {type(e).__name__}: {e}", game="tts", level="err")
            return
        if audio_url:
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

    def _throttled_log(self, key, text, game="sistema", level="info", secs=2.0):
        """Log estruturado com throttle por chave (evita flood no diagnóstico)."""
        now = time.time()
        last = getattr(self, "_log_last", {})
        if now - last.get(key, -999) < secs:
            return
        last[key] = now
        self._log_last = last
        emit(self.tenant_id, "log", {"text": text, "game": game, "level": level})

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
            emit(self.tenant_id, "log", f"[Duelo] Erro ao processar TAP: {e}")

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
            emit(self.tenant_id, "log", f"[Duelo] Erro ao registrar equipe: {e}")

    async def on_share(self, user, nickname, avatar, user_meta=None, room_id=None, event_id=None):
        self._ensure_room(room_id)
        self._track_levels(user, nickname, avatar, user_meta, room_id)
        self._emit_interaction("share", user, nickname, avatar, event_id=event_id, room_id=room_id,
                               user_id=self._stable_uid(user, user_meta))
        allowed, _ = self._check_access(user_meta)
        if allowed:
            self.corda.share(self._stable_uid(user, user_meta), user, nickname, avatar)

    async def on_follow(self, user, nickname, avatar, user_meta=None, room_id=None, event_id=None):
        self._ensure_room(room_id)
        self._track_levels(user, nickname, avatar, user_meta, room_id)
        self._emit_interaction("follow", user, nickname, avatar, event_id=event_id, room_id=room_id,
                               user_id=self._stable_uid(user, user_meta))
        emit(self.tenant_id, "log", f"[Follow] @{user} começou a seguir")

    async def on_like(self, user, nickname, avatar, like_count, user_meta=None, room_id=None, event_id=None):
        self._ensure_room(room_id)
        self._track_levels(user, nickname, avatar, user_meta, room_id)
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
        best_rank = 1000
        if self.game.guesses:
            best_rank = min(g["rank"] for g in self.game.guesses)
        import math
        target_rank = best_rank - max(1, math.floor(best_rank * 0.1))
        emit(self.tenant_id, "game", {"type": "tap_meta_reached", "ready": False, "blocked": False})
        emit(self.tenant_id, "log", "[Tap] Meta atingida! Liberando prêmio...")
        await self._dispatch_reward(
            user="meta_tap",
            nickname="Meta de Tap",
            avatar="",
            gift=None,
            target_rank=target_rank,
            source="tap",
        )

    def build_likes_ranking(self, limit: int = 5) -> list:
        return sorted(self.likes.values(), key=lambda e: -e["likes"])[:limit]

    def emit_status(self, state, extra=None):
        status = {"state": state, "user": self.username}
        if self.handler._room_id:
            status["room_id"] = self.handler._room_id
        if extra:
            status.update(extra)
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
            emit(self.tenant_id, "log", payload)
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

    async def _tres_next_round(self):
        """Provider do auto-reinício: sorteia nova palavra e gera novas dicas."""
        palavra = self._pick_tres_word()
        if not palavra:
            return None, None
        self._mark_tres_played(palavra)
        try:
            dicas = await generate_tres_dicas(palavra)
        except Exception:
            dicas = []
        if not dicas or len(dicas) < 3:
            dicas = [f"Palavra com {len(palavra)} letras", "É uma palavra comum", "Última dica!"]
        return palavra, dicas

    async def start_game(self, hint_gifts=None, riddle_gifts=None, size_gift=None, letter_gift=None):
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
        emit(self.tenant_id, "log", "[Jogo] Preparando próxima partida…")
        emit(self.tenant_id, "game", {"type": "game_preparing"})
        try:
            await asyncio.to_thread(self.game._build_hint_pool)
        except Exception:
            pass
        self.game._pool_ready = bool(self.game.all_scored and self.game.hint_pool)
        if not self.game._pool_ready:
            emit(self.tenant_id, "log", "[Jogo] [!] Não foi possível preparar o ranking de dicas — usando fallback simples", game="palavra", level="err")
        self._preparing = False
        active_gift = self.game.get_active_gift()
        emit(self.tenant_id, "log", f"[Jogo] Palavra secreta: {self.game.secret_word}")
        prefix = self._command_prefix()
        if prefix:
            emit(self.tenant_id, "log", f"[Jogo] Prefixo: '{prefix}' - chute {prefix}palavra no chat")
        else:
            emit(self.tenant_id, "log", "[Jogo] Sem prefixo - todo comentário do chat vira palpite")
        emit(self.tenant_id, "log", f"[Jogo] Dicas liberadas por gifts: {', '.join(self.game.hint_gifts)}")
        if self.game.riddle_gifts:
            emit(self.tenant_id, "log", f"[Jogo] Presente revelador (Final Boss): {', '.join(self.game.riddle_gifts)}")
        if self.game.size_gift:
            emit(self.tenant_id, "log", f"[Jogo] Presente de tamanho: {self.game.size_gift} — tamanho oculto até ser enviado")
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

    async def on_member(self, user, nickname, room_id=None, event_id=None):
        """Um espectador entrou na live (JoinEvent — apenas motor TikTokLive)."""
        self._ensure_room(room_id)
        self._emit_interaction("join", user, nickname, "", event_id=event_id, room_id=room_id)
        if self.vpet.active and self.vpet.state.get("assistant_mode"):
            self.vpet.greet_member(nickname or user)

    async def on_comment(self, user, nickname, avatar, text, user_meta=None, room_id=None, event_id=None):
        self._ensure_room(room_id)
        self._track_levels(user, nickname, avatar, user_meta, room_id)
        raw = text.strip()
        self._throttled_log("chat_arrival", f"[Chat] {user}: {raw}"[:130], game="chat", level="chat", secs=1.0)
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
            self._throttled_log("tres_capture", "[Chat] capturado pelo 3 Dicas (jogo ativo) — outros jogos não recebem", game="tres", level="warn", secs=2.0)
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
                        emit(self.tenant_id, "log", f"[Bichinho] Streamer falou: \"{texto}\"")
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
            self._throttled_log("palavra_nopartida", "[Palavra] comentário ignorado: jogo sem partida ativa ou finalizado", game="palavra", level="info", secs=2.0)
            return
        if self._preparing:
            self._throttled_log("palavra_preparing", "[Palavra] Preparando próxima partida… palpites aguardam", game="palavra", level="warn", secs=3.0)
            return
        prefix = self._command_prefix()
        if prefix and not raw.startswith(prefix):
            self._throttled_log("palavra_prefix", f"[Palavra] palpite ignorado: exige prefixo '{prefix}' no início do comentário", game="palavra", level="warn", secs=2.0)
            return

        body = raw[len(prefix):].strip() if prefix else raw.strip()
        if not body:
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
            emit(self.tenant_id, "game", {
                "type": "guess_rejected",
                "user": final_user,
                "nickname": final_nickname,
                "word": word,
                "reason": reason,
            })
            emit(self.tenant_id, "log", f"[Access] @{final_user} bloqueado ({reason}): '{word}' não subiu")
            return

        db.record_guess(final_user, final_nickname, final_avatar)

        result = self.game.process_guess(final_user, word, nickname=final_nickname, avatar=final_avatar)
        if result is None:
            return
        if result.get("duplicate"):
            emit(self.tenant_id, "game", {
                "type": "guess_duplicate",
                "word": result["word"],
                "rank": result["rank"],
                "user": final_user,
                "nickname": final_nickname,
            })
            emit(self.tenant_id, "log", f"[Guess] {final_user}: '{result['word']}' já foi chutada (#duplicata)")
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
        emit(self.tenant_id, "log", f"[Guess] {final_user}: {result['word']} -> #{result['rank']}")
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
                "post_game_summary": self.game.build_post_game_summary(100),
            })
            self._emit_interaction("winner", final_user, final_nickname, final_avatar, value=1,
                                   room_id=room_id, meta={"word": self.game.secret_word})
            emit(self.tenant_id, "log", f"[FIM] Vencedor: {final_user}! Palavra: {self.game.secret_word}")
            self._schedule_auto_next_game()

    async def on_gift(self, user, nickname, avatar, gift_name, diamond_count, repeat_count=1, user_meta=None, gift_id="", room_id=None, event_id=None):
        self._ensure_room(room_id)
        self._track_levels(user, nickname, avatar, user_meta, room_id)
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
        # Diagnóstico do gift cru (id/nome/moedas): ajuda a desambiguar gifts com o
        # MESMO nome e preços diferentes (ex.: dois "Heart", 1 e 10 moedas). Throttle
        # por id para não floodar o log.
        self._throttled_log(
            f"gift_diag_{gift_id or gift_name}",
            f"[Gift][diag] name='{gift_name}' id='{gift_id}' moedas={int(diamond_count or 0)}",
            game="chat", level="chat", secs=10.0,
        )
        combo_str = f" x{repeat_count}" if repeat_count > 1 else ""
        emit(self.tenant_id, "log", f"[Gift] {user} enviou '{gift_name}'{combo_str} ({diamond_count} diamantes)")

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
                emit(self.tenant_id, "log", f"[3 Dicas] @{user} liberou o chat! (Passe Livre)")

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
            emit(self.tenant_id, "log", f"[Access] @{user} bloqueado ({reason}): gift ignorado na BATALHA")
            return
        self.battle.add_coins(user, nickname, avatar, int(diamond_count or 0) * max(1, repeat_count))
        if not self.game.secret_word or self.game.finished:
            emit(self.tenant_id, "log", "[Gift] Nenhum jogo ativo ou já finalizado, ignorando gift")
            return

        # Presente de tamanho: revela o nº de letras da palavra secreta
        size_res = self.game.process_gift(user, gift_name, int(diamond_count or 0), nickname=nickname, avatar=avatar, gift_id=gift_id)
        if size_res and size_res.get("size_revealed"):
            emit(self.tenant_id, "game", {
                "type": "size_revealed",
                "user": user,
                "nickname": nickname or user,
                "avatar": avatar or "",
                "secret_length": size_res.get("secret_length", 0),
            })
            emit(self.tenant_id, "log", f"[Jogo] @{user} revelou o TAMANHO da palavra ({size_res.get('secret_length', 0)} letras)")
            return
        if size_res and size_res.get("first_letter_revealed"):
            emit(self.tenant_id, "game", {
                "type": "letter_revealed",
                "user": user,
                "nickname": nickname or user,
                "avatar": avatar or "",
                "first_letter": size_res.get("first_letter", ""),
                "secret_length": size_res.get("secret_length", 0),
            })
            emit(self.tenant_id, "log", f"[Jogo] @{user} revelou a PRIMEIRA LETRA ('{size_res.get('first_letter', '')}')")
            return

        active_gift = self.game.get_active_gift()
        if not active_gift:
            emit(self.tenant_id, "log", "[Gift] Nenhum presente ativo configurado")
            return

        # Match ID-first (catálogo) com fallback por nome/PT — aceita tanto o ID quanto o nome.
        is_active = bool(self.game._gift_ref_match(gift_id, gift_name, active_gift))
        is_final_boss = bool(getattr(self.game, "is_final_boss", False))
        if is_final_boss:
            if not is_active:
                emit(self.tenant_id, "log", f"[Gift] {gift_name} recebido, mas o presente revelador exigido é {active_gift}")
                return
        else:
            if not is_active and not self.game.is_gift_recently_active(gift_name, 5):
                emit(self.tenant_id, "log", f"[Gift] {gift_name} recebido, mas o presente ativo exigido é {active_gift}")
                return
            if not is_active:
                emit(self.tenant_id, "log", f"[Gift] {gift_name} aceito (presente recente da roleta)")

        # -------------------------------------------------------------
        # Scenario A: Final Boss Active
        # -------------------------------------------------------------
        if is_final_boss:
            emit(self.tenant_id, "log", f"[Final Boss] {user} enviou o presente de revelação {active_gift}! Vitória decretada!")
            
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
                "post_game_summary": self.game.build_post_game_summary(100),
            })
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
        emit(self.tenant_id, "log", f"[Roleta] Presente {active_gift} x{loop_n} aceito. Alvo Rank #{target_rank} (Dica {pct_dica}%/Charada {pct_charada}%)")

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
            )
            if choice == "riddle":
                riddle_done_in_combo = True

    async def _dispatch_reward(self, user, nickname, avatar, gift, target_rank, choice=None, allow_riddle=True, source="roleta"):
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

        if choice == "riddle" and allow_riddle:
            riddle_res = self.game.process_riddle_gift(user, gift, force=True)
            if riddle_res:
                stage = riddle_res["stage"]
                cluster_words = self.game.hint_cluster(target_rank)

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
                emit(self.tenant_id, "log", f"[{source}] Charada do Estágio {stage} usando cluster: {', '.join(cluster_words)}...")

                riddle_text = await generate_openrouter_riddle(self.game.secret_word, cluster_words)
                asyncio.create_task(self._narrate_riddle_async(stage, riddle_text))

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
                emit(self.tenant_id, "log", f"[{source}] Estagio {stage} liberado! Charada: \"{riddle_text}\"")
                return

        # choice == "hint" (ou charada convertida em dica pelo limite de 1 por combo)
        picked = self.game.pick_hint_word(target_rank)
        if picked is None:
            if protect:
                emit(self.tenant_id, "log", f"[{source}] Sem dica válida na zona protegida (não pode revelar rank 1-2 nem piorar o melhor rank)")
            else:
                emit(self.tenant_id, "log", f"[{source}] Sem novas dicas no pool")
            return

        best_word, hint_rank = picked
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
        emit(self.tenant_id, "log", f"[{source}] Dica revelada: {best_word} (#{hint_rank})")
        self._emit_interaction("hint", user, nickname, avatar, value=int(hint_rank),
                               meta={"word": best_word, "rank": int(hint_rank), "source": source})

    async def end_game(self):
        if not self.game.secret_word or self.game.finished:
            return
        payload = self.game.finalize_game(room_id=self._live_room_id())
        if payload:
            emit(self.tenant_id, "game", payload)
            emit(self.tenant_id, "log", f"[FIM] Partida encerrada manualmente pelo streamer. Palavra: {self.game.secret_word}")

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
                self._throttled_log("stop_" + name, f"[Chat] captura única: {name} encerrado ao iniciar outro jogo", game=name, level="info")

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
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            emit(self.tenant_id, "log", f"[Jogo] Erro ao auto-iniciar partida: {e}")

    async def manual_hint(self):
        if not self.game.secret_word or self.game.finished:
            emit(self.tenant_id, "log", "[Manual] Nenhuma partida ativa para dar dica")
            return
        if self._preparing:
            emit(self.tenant_id, "log", "[Manual] Preparando próxima partida… aguarde a liberação")
            return
        best_rank = 1000
        if self.game.guesses:
            best_rank = min(g["rank"] for g in self.game.guesses)
        import math
        target_rank = best_rank - max(1, math.floor(best_rank * 0.1))
        picked = self.game.pick_hint_word(target_rank)
        if picked is None:
            if self.game._hint_protected():
                emit(self.tenant_id, "log", "[Manual] Sem dica válida na zona protegida (não pode revelar rank 1-2 nem piorar o melhor rank)")
            else:
                emit(self.tenant_id, "log", "[Manual] Sem novas dicas no pool")
            return
        best_word, hint_rank = picked
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
        emit(self.tenant_id, "log", f"[Manual] Dica inserida: {best_word} (#{hint_rank})")

    async def manual_riddle(self):
        if not self.game.secret_word or self.game.finished:
            emit(self.tenant_id, "log", "[Manual] Nenhuma partida ativa para gerar charada")
            return
        if self._preparing:
            emit(self.tenant_id, "log", "[Manual] Preparando próxima partida… aguarde a liberação")
            return
        best_rank = 1000
        if self.game.guesses:
            best_rank = min(g["rank"] for g in self.game.guesses)
        import math
        target_rank = best_rank - max(1, math.floor(best_rank * 0.1))
        riddle_res = self.game.process_riddle_gift("streamer", None, force=True)
        if not riddle_res:
            emit(self.tenant_id, "log", "[Manual] Falha ao iniciar charada")
            return
        stage = riddle_res["stage"]
        cluster_words = self.game.hint_cluster(target_rank)
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
        emit(self.tenant_id, "log", f"[Manual] Gerando charada do Estágio {stage} usando cluster: {', '.join(cluster_words)}...")
        riddle_text = await generate_openrouter_riddle(self.game.secret_word, cluster_words)
        asyncio.create_task(self._narrate_riddle_async(stage, riddle_text))
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
        emit(self.tenant_id, "log", f"[Manual] Estagio {stage} liberado! Charada: \"{riddle_text}\"")

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
            emit(self.tenant_id, "log", f"[CacaPalavras] {w['finder_nickname']} acertou '{w['text']}' ({w['start']}:{w['end']})")

    async def _command_loop(self):
        while True:
            cmd = await self.queue.get()
            c = cmd.get("cmd")
            if c == "new_game":
                self._stop_other_chat_games()
                await self.start_game(
                    hint_gifts=cmd.get("hint_gifts"),
                    riddle_gifts=cmd.get("riddle_gifts"),
                    size_gift=cmd.get("size_gift") or "",
                    letter_gift=cmd.get("letter_gift") or "",
                )
            elif c == "end_game":
                await self.end_game()
            elif c == "manual_hint":
                await self.manual_hint()
            elif c == "manual_riddle":
                await self.manual_riddle()
            elif c == "caca_start":
                await self.end_game()
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
                if not palavra:
                    palavra = self._pick_tres_word()
                if palavra:
                    self._mark_tres_played(palavra)
                    if not dicas or len(dicas) < 3:
                        dicas = await generate_tres_dicas(palavra)
                    await self.end_game()
                    self._stop_other_chat_games(keep="tres")
                    self.tres.start(palavra, dicas)
                    emit(self.tenant_id, "game", {"type": "tres_weekly", "weekly": db.get_tres_weekly(self.tenant_id, 10)})
                else:
                    emit(self.tenant_id, "log", "[3 Dicas] Sem palavra disponível")
            elif c == "tres_stop":
                self.tres.stop()
                emit(self.tenant_id, "game", {"type": "tres_state", **self.tres.state(public=False)})
            elif c == "tres_pause":
                self.tres.pause()
                emit(self.tenant_id, "game", {"type": "tres_state", **self.tres.state(public=False)})
            elif c == "tres_resume":
                self.tres.resume()
                emit(self.tenant_id, "game", {"type": "tres_state", **self.tres.state(public=False)})
            elif c == "tres_reset":
                self.tres.reset()
                emit(self.tenant_id, "game", {"type": "tres_state", **self.tres.state(public=False)})
            elif c == "tres_config":
                self.tres.set_gift_config(cmd.get("config") or {})
                emit(self.tenant_id, "log", "[3 Dicas] Configuração de presentes atualizada")
            elif c == "vpet_start":
                await self.end_game()
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
        emit(self.tenant_id, "log", f"[Main] Aguardando @{self.username} ficar ao vivo e o comando 'new_game'...")
        handler_task = asyncio.create_task(self.handler.run())
        cmd_task = asyncio.create_task(self._command_loop())
        self._likes_loop_task = asyncio.create_task(self._likes_loop())
        self._vpet_task = asyncio.create_task(self.vpet.run())
        self._corda_task = asyncio.create_task(self._corda_loop())
        try:
            await asyncio.wait({handler_task, cmd_task}, return_when=asyncio.FIRST_COMPLETED)
        except asyncio.CancelledError:
            raise
        finally:
            for t in (handler_task, cmd_task):
                t.cancel()
            try:
                await asyncio.wait({handler_task, cmd_task}, timeout=5)
            except asyncio.CancelledError:
                pass
            self.corda.stop()
            if self._corda_task:
                self._corda_task.cancel()
                try:
                    await self._corda_task
                except asyncio.CancelledError:
                    pass
                self._corda_task = None
            self.battle.stop()
            if self._vpet_task:
                self._vpet_task.cancel()
                try:
                    await self._vpet_task
                except (Exception, asyncio.CancelledError):
                    pass
                self._vpet_task = None
            for loop_task in (self._likes_loop_task,):
                if loop_task:
                    loop_task.cancel()
                    try:
                        await loop_task
                    except (Exception, asyncio.CancelledError):
                        pass
            if self.game and self.game.secret_word and not self.game.finished:
                payload = self.game.finalize_game(room_id=self._live_room_id())
                if payload:
                    emit(self.tenant_id, "game", payload)
                    emit(self.tenant_id, "log", f"[FIM] Partida encerrada devido a desconexão. Palavra: {self.game.secret_word}")
            emit(self.tenant_id, "log", f"[Main] Sessao do tenant {self.tenant_id} encerrada")
            emit(self.tenant_id, "status", {"state": "offline"})


sessions = {}
gift_tags = JogoContexto.load_default_gift_tags()


async def stop_session_task(tid):
    s = sessions.pop(tid, None)
    if s and s.task:
        s.task.cancel()
        try:
            await s.task
        except (Exception, asyncio.CancelledError):
            pass


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
        emit(tid, "log", f"[Gifts] Falha na sincronização: {type(e).__name__}: {e}")
        emit(tid, "gifts_synced", {"error": str(e)})
    finally:
        _gifts_sync_running = False


async def process_commands(queue):
    while True:
        cmd = await queue.get()
        c = cmd.get("cmd")
        if c == "shutdown":
            break
        tid = cmd.get("tenant_id")
        if not tid:
            continue

        if c == "start":
            if tid in sessions:
                await stop_session_task(tid)
            session = GameSession(
                tenant_id=tid,
                username=str(cmd.get("username", "")).lstrip("@"),
                api_key=str(cmd.get("api_key", "")),
                history_path=cmd.get("history_path"),
                gift_tags=gift_tags,
                engine=str(cmd.get("engine", "tiktools") or "tiktools"),
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
            emit(tid, "log", f"[Service] Sessao iniciada para @{session.username} (motor {session.engine}) — voz={session.settings.get('tts_voice') or 'padrao'} {session.settings.get('tts_rate', 1.0)}x")

        elif c == "stop":
            await stop_session_task(tid)
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
                emit(tid, "log", f"[Batalha] Rodada iniciada ({duration}s) - Top1 de Tap e Top1 de Moeda!")
            else:
                emit(tid, "log", "[Batalha] Sessao nao ativa (conecte a live primeiro)")

        elif c == "battle_stop":
            s = sessions.get(tid)
            if s:
                await s.battle.end_round()
                emit(tid, "log", "[Batalha] Rodada finalizada")
            else:
                emit(tid, "log", "[Batalha] Sessao nao ativa")

        elif c == "new_game":
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit(tid, "log", "[Service] new_game ignorado: sessao nao ativa")

        elif c == "end_game":
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit(tid, "log", "[Service] end_game ignorado: sessao nao ativa")

        elif c in ("manual_hint", "manual_riddle"):
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit(tid, "log", f"[Service] {c} ignorado: sessao nao ativa")

        elif c in ("caca_start", "caca_stop", "caca_reveal"):
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit(tid, "log", f"[Service] {c} ignorado: sessao nao ativa")

        elif c in ("tres_start", "tres_stop", "tres_pause", "tres_resume", "tres_reset", "tres_config"):
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit(tid, "log", f"[Service] {c} ignorado: sessao nao ativa")

        elif c in ("corda_start", "corda_stop", "corda_new_match", "corda_test", "corda_target", "duelo_start", "duelo_stop", "duelo_config", "duelo_reset_round", "duelo_new_match"):
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit(tid, "log", f"[Service] {c} ignorado: sessao nao ativa")

        elif c in ("vpet_start", "vpet_stop", "vpet_battle_start", "vpet_assistant_mode"):
            s = sessions.get(tid)
            if s:
                s.queue.put_nowait(cmd)
            else:
                emit(tid, "log", f"[Service] {c} ignorado: sessao nao ativa")

        elif c == "caca_config":
            s = sessions.get(tid)
            if s:
                s.caca_prefix = str(cmd.get("prefix") or "").strip()
                emit(tid, "log", f"[Service] Caça Palavras configurado — prefixo: '{s.caca_prefix or '(nenhum)'}'")
            else:
                emit(tid, "log", "[Service] caca_config ignorado: sessao nao ativa")

        elif c == "update_gift_config":
            s = sessions.get(tid)
            if s:
                s.game.hint_gifts = cmd.get("hint_gifts") or []
                s.game.riddle_gifts = cmd.get("riddle_gifts") or []
                if "size_gift" in cmd:
                    s.game.size_gift = str(cmd.get("size_gift") or "")
                if "letter_gift" in cmd:
                    s.game.letter_gift = str(cmd.get("letter_gift") or "")
                emit(tid, "log", f"[Service] Gifts atualizados — Dicas: {', '.join(s.game.hint_gifts)} | Presente revelador: {', '.join(s.game.riddle_gifts)}" + (f" | Tamanho: {s.game.size_gift}" if s.game.size_gift else "") + (f" | 1ª letra: {s.game.letter_gift}" if s.game.letter_gift else ""))
            else:
                emit(tid, "log", "[Service] update_gift_config ignorado: sessao nao ativa")

        elif c == "update_settings":
            s = sessions.get(tid)
            if s:
                s.settings = normalize_settings(cmd.get("settings"))
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
                emit(tid, "log",
                     f"[Service] Preferências atualizadas — Boss: {'sim' if s.settings['boss_mode'] else 'nao'} | "
                     f"Seguidores: {'sim' if s.settings['apenas_seguidores'] else 'nao'} | "
                     f"Heart-me: {'sim' if s.settings['apenas_heart_me'] else 'nao'} | "
                     f"Dicas: {s.settings['pct_dica']}% / Charadas: {s.settings['pct_charada']}% | Meta de tap: {s.tap_meta_total}")
            else:
                emit(tid, "log", "[Service] update_settings ignorado: sessao nao ativa")

        elif c == "tts_test":
            text = cmd.get("text") or "Olá! Esta é a voz para as charadas do jogo Contexto."
            rate = cmd.get("rate")
            if not isinstance(rate, (int, float)):
                rate = 1.0
            voice_key = str(cmd.get("voice") or tts.VOICE_EDGE_ANTONIO)
            emit(tid, "log", {"text": f"[TTS] teste de voz '{voice_key}' (rate {rate})", "game": "tts", "level": "info"})
            audio_dir = os.path.join(TTS_AUDIO_ROOT, str(tid))
            audio_path = await asyncio.to_thread(tts.synthesize_edge, text, audio_dir, voice_key, float(rate))
            if audio_path:
                emit(tid, "tts_test_ready", f"/tts-audio/{tid}/{os.path.basename(audio_path)}")
                emit(tid, "log", {"text": f"[TTS] áudio de teste gerado: /tts-audio/{tid}/{os.path.basename(audio_path)}", "game": "tts", "level": "ok"})
            else:
                emit(tid, "log", {"text": "[TTS] Falha ao gerar áudio de teste (edge indisponível)", "game": "tts", "level": "err"})

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
