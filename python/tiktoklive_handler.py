import asyncio
import os
import time

from TikTokLive import TikTokLiveClient
from TikTokLive.client.errors import UserOfflineError
from TikTokLive.events import (
    ConnectEvent,
    DisconnectEvent,
    CommentEvent,
    GiftEvent,
    LikeEvent,
    JoinEvent,
    ShareEvent,
    FollowEvent,
    BarrageEvent,
    LiveEndEvent,
)
from TikTokLiveProto.v3.webcast.im import BarrageMessageBarrageType


class TikTokLiveHandler:
    """Motor de conexao TikTok usando a biblioteca TikTokLive (conexao direta).

    Interface compativel com o TikToolsHandler (mesmos callbacks, status, room_id).
    A `api_key` e aceitada na assinatura apenas para manter compatibilidade,
    pois o TikTokLive nao exige chave.
    """

    def __init__(self, username: str, api_key: str = "", on_comment=None, on_gift=None, on_like=None, on_join=None, on_share=None, on_follow=None, on_level_up=None):
        self.username = username
        self.api_key = api_key
        self.on_comment_cb = on_comment
        self.on_gift_cb = on_gift
        self.on_like_cb = on_like
        self.on_join_cb = on_join
        self.on_share_cb = on_share
        self.on_follow_cb = on_follow
        self.on_level_up_cb = on_level_up
        self.log_cb = None
        self._room_id = None
        self._connected = False
        self.client = None
        self._last_like_total = {}
        self._connected_at = None
        self._diag_last = {}
        self._live_session_initialized = False
        self._live_ended = False
        self.on_live_start_cb = None
        self.on_live_end_cb = None

    def log(self, text: str):
        if self.log_cb:
            self.log_cb(text)
        else:
            print(text, flush=True)

    @staticmethod
    def _avatar(user) -> str:
        if user is None:
            return ""
        for attr in ("avatar_large", "avatar_medium", "avatar_thumb", "avatar_jpg", "profile_picture", "avatar_url"):
            v = getattr(user, attr, None)
            if not v:
                continue
            if hasattr(v, "url_list") and getattr(v, "url_list", None):
                return str(v.url_list[0])
            if isinstance(v, str):
                return v
        return ""

    @staticmethod
    def _display_name(user) -> str:
        if user is None:
            return "?"
        return str(getattr(user, "unique_id", None) or getattr(user, "display_id", None) or getattr(user, "nickname", None) or getattr(user, "uniqueId", None) or "?")

    @staticmethod
    def _nickname(user) -> str:
        if user is None:
            return "?"
        return str(getattr(user, "nickname", None) or getattr(user, "unique_id", None) or getattr(user, "display_id", None) or "?")

    @staticmethod
    def _user_meta(user) -> dict:
        if user is None:
            return {}

        def deep(obj, *attrs):
            cur = obj
            for a in attrs:
                if cur is None:
                    return None
                cur = getattr(cur, a, None)
            return cur

        def first_level(*values):
            for value in values:
                try:
                    level = int(value)
                except (TypeError, ValueError):
                    continue
                if level > 0:
                    return level
            return 0

        def first_int(*values):
            for value in values:
                if value is None:
                    continue
                try:
                    return int(value)
                except (TypeError, ValueError):
                    continue
            return None

        def fan_status(value):
            if value is None:
                return None
            name = str(getattr(value, "name", "") or value).strip().lower()
            if name in ("active", "1"):
                return "active"
            if name in ("inactive", "2"):
                return "inactive"
            if name in ("not_joined", "not joined", "notjoined", "0"):
                return "not_joined"
            return None

        # v3: fans_club.prefer_data é dict[int, FansClubData] — pega o maior nível.
        prefer = deep(user, "fans_club", "prefer_data")
        prefer_level = 0
        prefer_name = ""
        if isinstance(prefer, dict):
            for v in prefer.values():
                try:
                    lv = int(getattr(v, "level", 0) or 0)
                except (TypeError, ValueError):
                    lv = 0
                if lv > prefer_level:
                    prefer_level = lv
                    prefer_name = str(getattr(v, "club_name", "") or "")

        fan_level = first_level(
            deep(user, "fans_club", "data", "level"),
            prefer_level,
            deep(user, "fans_club_info", "fans_level"),
            getattr(user, "member_level", None),
            getattr(user, "member_rank", None),
        )
        fan_name = (
            deep(user, "fans_club", "data", "club_name")
            or prefer_name
            or deep(user, "fans_club_info", "fans_club_name")
            or ""
        )

        # TikTokLive v3 expõe o status atual do fã-clube no FansClubData.
        # `is_sleeping` é o fallback do FansClubInfo legado (membro pausado).
        fan_data = deep(user, "fans_club", "data")
        fan_status_value = fan_status(getattr(fan_data, "user_fans_club_status", None))
        if fan_status_value is None:
            preferred_statuses = [
                fan_status(getattr(item, "user_fans_club_status", None))
                for item in (prefer.values() if isinstance(prefer, dict) else [])
            ]
            known_statuses = {value for value in preferred_statuses if value is not None}
            if len(known_statuses) == 1:
                fan_status_value = known_statuses.pop()
        legacy_fan_info = getattr(user, "fans_club_info", None)
        legacy_heart_me_active = None
        if legacy_fan_info is not None:
            legacy_level = first_level(getattr(legacy_fan_info, "fans_level", None))
            if legacy_level > 0:
                legacy_heart_me_active = not bool(getattr(legacy_fan_info, "is_sleeping", False))
        if fan_status_value == "active":
            heart_me_active = True
        elif fan_status_value == "inactive":
            heart_me_active = False
        elif fan_status_value == "not_joined":
            # Enum zero pode ser o default do protobuf; se o objeto também
            # traz o status legado de membro, ele é evidência mais útil que
            # esse zero não informado.
            heart_me_active = legacy_heart_me_active if legacy_heart_me_active is not None else False
        else:
            heart_me_active = legacy_heart_me_active

        follow_status = first_int(
            deep(user, "follow_info", "follow_status"),
            # O FollowInfo aninhado é o campo canônico do protobuf. Em algumas
            # versões, `user.follow_status` pode existir como valor padrão (0)
            # mesmo quando `follow_info.follow_status` traz a relação atual.
            getattr(user, "follow_status", None),
        )
        direct_is_follower = getattr(user, "is_follower", None)
        is_follower = (
            follow_status in (1, 2) if follow_status is not None
            else bool(direct_is_follower) if direct_is_follower is not None
            else None
        )
        follow_role = first_int(getattr(user, "follow_role", None))
        if follow_role is None:
            follow_role = follow_status if follow_status is not None else (1 if is_follower else None)

        return {
            "follow_role": follow_role,
            "follow_status": follow_status,
            "is_subscriber": getattr(user, "is_subscriber", False) or getattr(user, "subscribed", False),
            "is_follower": is_follower,
            # Níveis: presenteador (pay_grade) e membro/fã-clube (fans_club no v3).
            "gifter_level": first_level(deep(user, "pay_grade", "level"), getattr(user, "gifter_level", None)),
            "gifter_grade": deep(user, "pay_grade", "grade_describe"),
            "fan_club_level": fan_level,
            "fan_club_name": fan_name,
            "fan_club_status": fan_status_value,
            "is_heart_me_active": heart_me_active,
            "badges": [
                {"name": str(getattr(b, "name", "") or ""), "level": getattr(b, "level", None)}
                for b in (getattr(user, "badges", None) or [])
                if b is not None
            ],
            "user_id": str(getattr(user, "id", None) or ""),
        }

    def _diag_log(self, key, text, secs=10.0):
        """Log de diagnóstico com throttle (temporário)."""
        if str(os.environ.get("TIKTOK_LEVEL_DIAGNOSTICS", "")).lower() not in ("1", "true", "yes"):
            return
        now = time.time()
        if now - self._diag_last.get(key, 0) < secs:
            return
        self._diag_last[key] = now
        self.log(text)

    def _meta_for(self, user, kind):
        """_user_meta + diagnóstico throttled dos níveis observados."""
        meta = self._user_meta(user)
        try:
            uid = str(getattr(user, "id", None) or self._display_name(user))
            self._diag_log(
                f"nivel_{kind}_{uid}",
                f"[nivel] {kind} @{self._display_name(user)} gifter={meta.get('gifter_level')} "
                f"fan={meta.get('fan_club_level')} club={meta.get('fan_club_name') or '-'}",
                secs=20.0,
            )
        except Exception:
            pass
        return meta

    @staticmethod
    def _event_create_time(event) -> int:
        common = getattr(event, "common", None)
        return int(getattr(common, "create_time", 0) or 0)

    @staticmethod
    def _event_ids(event):
        """(room_id, event_id) do envelope `common` do Webcast (pode ser ausente)."""
        common = getattr(event, "common", None)
        if common is None:
            return (None, None)
        rid = getattr(common, "room_id", None)
        mid = getattr(common, "msg_id", None)
        return (str(rid) if rid else None, str(mid) if mid else None)

    def _is_backlog(self, event, margin_seconds=5) -> bool:
        """Descarta eventos criados antes da conexao (backlog reenviado pelo
        WebSocket/cursor), mantendo margem para o handshake."""
        if not self._connected_at:
            return False
        ct = self._event_create_time(event)
        if not ct:
            return False
        return ct < self._connected_at - margin_seconds

    def _emit_status(self, state: str, extra: dict = None):
        status = {"state": state, "user": self.username}
        if self._room_id:
            status["room_id"] = self._room_id
        if extra:
            status.update(extra)
        # Mesmo contrato: o service espera emit_status(state, extra)
        self._emit_status_cb(status)

    def _emit_status_cb(self, status: dict):
        # Substituido pelo GameSession via handler._emit_status
        pass

    async def _on_connect(self, event: ConnectEvent):
        self._connected = True
        self._connected_at = time.time()
        previous_room_id = self._room_id
        ended_before_connect = self._live_ended
        rid = getattr(event, "room_id", None)
        if not rid:
            conn = getattr(event, "conn", None)
            rid = getattr(conn, "room_id", None) if conn else None
        new_rid = str(rid or "").strip() or None
        room_changed = bool(new_rid and new_rid != previous_room_id)
        # Só LiveEndEvent encerra a sessão. DisconnectEvent pode ser uma queda
        # transitória, então a reconexão à mesma sala mantém o baseline de likes.
        if new_rid and (room_changed or ended_before_connect):
            self._last_like_total = {}
        self._room_id = new_rid
        if new_rid and (not self._live_session_initialized or room_changed or ended_before_connect):
            force_new = bool(ended_before_connect and new_rid == previous_room_id)
            if self.on_live_start_cb:
                await self.on_live_start_cb(new_rid, force_new=force_new)
            self._live_session_initialized = True
        self._live_ended = False
        self._emit_status("connected")
        self.log(f"[TikTokLive] Conectado a @{self.username}" + (f" (room {self._room_id})" if self._room_id else ""))

    async def _on_disconnect(self, event: DisconnectEvent):
        self._connected = False
        self._emit_status("disconnected")
        self.log(f"[TikTokLive] Desconectado de @{self.username}")

    async def _on_live_end(self, event: LiveEndEvent):
        if self._live_ended:
            return
        self._live_ended = True
        self._connected = False
        if self.on_live_end_cb:
            await self.on_live_end_cb(self._room_id)
        self._emit_status("waiting")
        self.log(f"[TikTokLive] Live de @{self.username} encerrada")

    async def _on_comment(self, event: CommentEvent):
        if not self.on_comment_cb:
            return
        if not self._connected or self._is_backlog(event, margin_seconds=0):
            return
        user = getattr(event, "user", None)
        rid, mid = self._event_ids(event)
        await self.on_comment_cb(
            user=self._display_name(user),
            nickname=self._nickname(user),
            avatar=self._avatar(user),
            text=str(getattr(event, "comment", "") or getattr(event, "content", "")),
            user_meta=self._meta_for(user, "evt"),
            room_id=rid or self._room_id,
            event_id=mid,
        )

    async def _on_gift(self, event: GiftEvent):
        if not self.on_gift_cb:
            return
        if self._is_backlog(event):
            return
        user = getattr(event, "user", None)
        gift = getattr(event, "gift", None)
        gift_name = str(getattr(gift, "name", None) or "")
        gift_id = str(getattr(gift, "id", None) or "")
        diamond_count = int(getattr(gift, "diamond_count", 0) or 0)
        if gift is not None and diamond_count == 0:
            self.log(f"[TikTokLive] AVISO: gift '{gift_name}' sem diamond_count (dano mínimo será aplicado)")
        # Gifts com streak disparam multiplos eventos (repeat_count incrementando);
        # so o frame final (repeat_end=1 / streaking=False) deve ser processado.
        if bool(getattr(event, "streaking", False)):
            return
        repeat_count = max(1, int(getattr(event, "repeat_count", 1) or 1))
        rid, mid = self._event_ids(event)
        await self.on_gift_cb(
            user=self._display_name(user),
            nickname=self._nickname(user),
            avatar=self._avatar(user),
            gift_name=gift_name,
            gift_id=gift_id,
            diamond_count=diamond_count,
            repeat_count=repeat_count,
            user_meta=self._meta_for(user, "evt"),
            room_id=rid or self._room_id,
            event_id=mid,
        )

    async def _on_share(self, event):
        if self.on_share_cb and not self._is_backlog(event):
            user = getattr(event, "user", None)
            if user is not None:
                rid, mid = self._event_ids(event)
                await self.on_share_cb(user=self._display_name(user), nickname=self._nickname(user),
                                       avatar=self._avatar(user), user_meta=self._user_meta(user),
                                       room_id=rid or self._room_id, event_id=mid)

    async def _on_follow(self, event):
        if self.on_follow_cb and not self._is_backlog(event):
            user = getattr(event, "user", None)
            if user is not None:
                rid, mid = self._event_ids(event)
                await self.on_follow_cb(user=self._display_name(user), nickname=self._nickname(user),
                                        avatar=self._avatar(user), user_meta=self._user_meta(user),
                                        room_id=rid or self._room_id, event_id=mid)

    async def _on_barrage(self, event: BarrageEvent):
        msg_type = int(getattr(event, "msg_type", 0) or 0)
        flp = getattr(event, "fans_level_param", None)
        ugp = getattr(event, "user_grade_param", None)
        if msg_type in (4, 7, 8, 9, 10, 11, 13):  # subscribe/upgrades/entradas/galeria
            self._diag_log(
                f"barrage_{msg_type}",
                f"[nivel][barrage] type={msg_type} "
                f"fans_grade={getattr(flp, 'current_grade', None) if flp else None} "
                f"gifter_grade={getattr(ugp, 'current_grade', None) if ugp else None}",
                secs=10.0,
            )
        if not self.on_level_up_cb or self._is_backlog(event):
            return
        axis = None
        param = None
        if msg_type == int(BarrageMessageBarrageType.USER_UPGRADE):
            axis = "gifter"          # nível de presenteador (pay grade)
            param = getattr(event, "user_grade_param", None)
        elif msg_type == int(BarrageMessageBarrageType.FANS_LEVEL_UPGRADE):
            axis = "fanclub"         # nível de membro/fã-clube
            param = getattr(event, "fans_level_param", None)
        if axis is None:
            return
        level = int(getattr(param, "current_grade", 0) or 0) if param else 0
        user = (getattr(param, "user", None) if param else None) or getattr(event, "user", None)
        if level <= 0 or user is None:
            return
        rid, mid = self._event_ids(event)
        meta = self._meta_for(user, f"barrage_{axis}")
        meta["gifter_level" if axis == "gifter" else "fan_club_level"] = level
        await self.on_level_up_cb(
            user=self._display_name(user),
            nickname=self._nickname(user),
            avatar=self._avatar(user),
            user_meta=meta,
            axis=axis,
            level=level,
            room_id=rid or self._room_id,
            event_id=mid,
        )

    async def _on_like(self, event: LikeEvent):
        if not self.on_like_cb:
            return
        if self._is_backlog(event):
            return
        user = getattr(event, "user", None)
        count = int(getattr(event, "count", 0) or 0)
        total = int(getattr(event, "total", 0) or 0)
        # `count` e o numero de likes neste evento (incremento, igual ao likeCount
        # do TikTools). O TikTok agrega likes em rajadas e alguns frames chegam com
        # count=0; nesse caso usa-se o delta do `total` (monotonico por usuario)
        # para nao perder likes, sem jamais somar o total acumulado direto.
        like_count = count
        uid = str(getattr(user, "id", None) or self._display_name(user))
        last = self._last_like_total.get(uid, 0)
        if like_count <= 0:
            # Frame intermediario com count=0: usa delta do total (monotonico por
            # usuario). No primeiro contato apenas estabelece o baseline sem emitir,
            # para nao inflar a contagem no meio de uma sessao.
            if total > last:
                if last > 0:
                    like_count = total - last
                self._last_like_total[uid] = total
        elif total > last:
            self._last_like_total[uid] = total
        if like_count <= 0:
            return
        rid, mid = self._event_ids(event)
        await self.on_like_cb(
            user=self._display_name(user),
            nickname=self._nickname(user),
            avatar=self._avatar(user),
            like_count=like_count,
            user_meta=self._meta_for(user, "evt"),
            room_id=rid or self._room_id,
            event_id=mid,
        )

    async def _on_join(self, event: JoinEvent):
        if not self.on_join_cb:
            return
        user = getattr(event, "user", None)
        rid, mid = self._event_ids(event)
        await self.on_join_cb(
            user=self._display_name(user),
            nickname=self._nickname(user),
            user_meta=self._meta_for(user, "evt"),
            room_id=rid or self._room_id,
            event_id=mid,
        )

    async def run(self):
        backoff = 5
        while True:
            self.log(f"[TikTokLive] Iniciando conexao com @{self.username}...")
            client = TikTokLiveClient(
                unique_id=self.username,
                ws_kwargs={"base_uri_params": {"history_comment_count": "0"}},
            )
            self.client = client
            # Silencia bug de schema conhecido do TikTokLiveProto (WebcastLinkLayerMessage)
            try:
                ignore = getattr(client, "parse_error_ignorelist", None)
                if ignore is not None:
                    for token in ("HashtagNamespace",):
                        if token not in ignore:
                            ignore.append(token)
            except Exception:
                pass
            client.add_listener(ConnectEvent, self._on_connect)
            client.add_listener(DisconnectEvent, self._on_disconnect)
            client.add_listener(LiveEndEvent, self._on_live_end)
            client.add_listener(CommentEvent, self._on_comment)
            client.add_listener(ShareEvent, self._on_share)
            client.add_listener(FollowEvent, self._on_follow)
            client.add_listener(BarrageEvent, self._on_barrage)
            client.add_listener(GiftEvent, self._on_gift)
            client.add_listener(LikeEvent, self._on_like)
            client.add_listener(JoinEvent, self._on_join)
            try:
                # start() retorna a task interna sem bloquear; aguardamos ela.
                # process_connect_events=False descarta o chat/gifts/likes acumulados
                # dos ultimos instantes antes de conectar (evita ler coisa atrasada).
                task = await client.start(process_connect_events=False)
                await task
                self.log("[TikTokLive] Conexao encerrada")
                self._connected = False
                self._emit_status("waiting")
            except asyncio.CancelledError:
                try:
                    await client._ws.disconnect()
                except Exception:
                    pass
                raise
            except UserOfflineError:
                self._room_id = None
                self._connected = False
                self._emit_status("waiting")
                self.log(f"[TikTokLive] @{self.username} nao esta ao vivo. Verificando novamente em {backoff}s...")
            except Exception as e:
                self.log({
                    "text": "[TikTokLive] Falha na conexão com o provedor.",
                    "category": "error",
                    "level": "error",
                    "event": "tiktoklive.connection.failed",
                    "source": "python",
                    "code": "TIKTOKLIVE_CONNECTION_FAILED",
                    "details": {"error_type": type(e).__name__},
                })
                self._connected = False
                self._emit_status("waiting")
            finally:
                try:
                    await client.disconnect()
                except Exception:
                    pass
                self.client = None
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)
