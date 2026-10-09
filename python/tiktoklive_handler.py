import asyncio
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
)


class TikTokLiveHandler:
    """Motor de conexao TikTok usando a biblioteca TikTokLive (conexao direta).

    Interface compativel com o TikToolsHandler (mesmos callbacks, status, room_id).
    A `api_key` e aceitada na assinatura apenas para manter compatibilidade,
    pois o TikTokLive nao exige chave.
    """

    def __init__(self, username: str, api_key: str = "", on_comment=None, on_gift=None, on_like=None, on_join=None):
        self.username = username
        self.api_key = api_key
        self.on_comment_cb = on_comment
        self.on_gift_cb = on_gift
        self.on_like_cb = on_like
        self.on_join_cb = on_join
        self.log_cb = None
        self._room_id = None
        self._connected = False
        self.client = None
        self._last_like_total = {}
        self._connected_at = None

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
        return {
            "follow_role": getattr(user, "follow_role", None) if hasattr(user, "follow_role") else (1 if getattr(user, "is_follower", False) else None),
            "is_subscriber": getattr(user, "is_subscriber", False) or getattr(user, "subscribed", False),
            "is_follower": getattr(user, "is_follower", False) or getattr(user, "follow_info", None) is not None,
            "badges": list(getattr(user, "badges", None) or []),
            "user_id": str(getattr(user, "id", None) or ""),
        }

    @staticmethod
    def _event_create_time(event) -> int:
        common = getattr(event, "common", None)
        return int(getattr(common, "create_time", 0) or 0)

    def _is_backlog(self, event) -> bool:
        """Descarta eventos criados antes da conexao (backlog reenviado pelo
        WebSocket/cursor), mantendo margem para o handshake."""
        if not self._connected_at:
            return False
        ct = self._event_create_time(event)
        if not ct:
            return False
        return ct < self._connected_at - 5

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
        rid = getattr(event, "room_id", None)
        if not rid:
            conn = getattr(event, "conn", None)
            rid = getattr(conn, "room_id", None) if conn else None
        self._room_id = str(rid or "").strip() or None
        self._emit_status("connected")
        self.log(f"[TikTokLive] Conectado a @{self.username}" + (f" (room {self._room_id})" if self._room_id else ""))

    async def _on_disconnect(self, event: DisconnectEvent):
        self._connected = False
        self._emit_status("disconnected")
        self.log(f"[TikTokLive] Desconectado de @{self.username}")

    async def _on_comment(self, event: CommentEvent):
        if not self.on_comment_cb:
            return
        if self._is_backlog(event):
            return
        user = getattr(event, "user", None)
        await self.on_comment_cb(
            user=self._display_name(user),
            nickname=self._nickname(user),
            avatar=self._avatar(user),
            text=str(getattr(event, "comment", "") or getattr(event, "content", "")),
            user_meta=self._user_meta(user),
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
        await self.on_gift_cb(
            user=self._display_name(user),
            nickname=self._nickname(user),
            avatar=self._avatar(user),
            gift_name=gift_name,
            gift_id=gift_id,
            diamond_count=diamond_count,
            repeat_count=repeat_count,
            user_meta=self._user_meta(user),
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
        await self.on_like_cb(
            user=self._display_name(user),
            nickname=self._nickname(user),
            avatar=self._avatar(user),
            like_count=like_count,
            user_meta=self._user_meta(user),
        )

    async def _on_join(self, event: JoinEvent):
        if not self.on_join_cb:
            return
        user = getattr(event, "user", None)
        await self.on_join_cb(
            user=self._display_name(user),
            nickname=self._nickname(user),
        )

    async def run(self):
        backoff = 5
        while True:
            self.log(f"[TikTokLive] Iniciando conexao com @{self.username}...")
            client = TikTokLiveClient(unique_id=self.username)
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
            client.add_listener(CommentEvent, self._on_comment)
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
                self.log(f"[TikTokLive] ERRO: {type(e).__name__}: {e}")
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
