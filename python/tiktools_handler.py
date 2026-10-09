import asyncio
import json
import time

import httpx
import websockets


API_BASE = "https://api.tik.tools"
WS_BASE = "wss://api.tik.tools"

# Close codes documentados pelo Tik.Tools
STREAM_END_CODES = {4005, 4006, 4404, 4556}  # fim de stream / nao live

RATE_REPORT_INTERVAL = 60


async def check_live_status_tiktools(username: str, api_key: str, log_cb=None) -> dict:
    """Verifica se a live esta no ar via /webcast/live_status (primario).

    Retorna:
      {"live": True, "room_id": ...}   -> ao vivo
      {"live": False, "room_id": None} -> offline
      {"live": None, "room_id": None}  -> indeterminado (tentar conectar mesmo assim)
    """
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                f"{API_BASE}/webcast/live_status",
                params={"unique_id": username, "apiKey": api_key},
            )
            r.raise_for_status()
            data = r.json().get("data") or {}
            if data.get("is_live"):
                return {"live": True, "room_id": str(data.get("room_id")), "info": data}
            return {"live": False, "room_id": None}
        except Exception as e:
            msg = f"[TikTools] live_status falhou ({e}); tentando check_alive..."
            if log_cb:
                log_cb(msg)
            else:
                print(msg, flush=True)
        try:
            r = await client.get(
                f"{API_BASE}/webcast/check_alive",
                params={"unique_id": username, "apiKey": api_key},
            )
            r.raise_for_status()
            data = r.json()
            rooms = data.get("data") or []
            if rooms and rooms[0].get("alive"):
                return {"live": True, "room_id": str(rooms[0]["room_id"]), "info": rooms[0]}
            if data.get("action") == "resolve_required":
                return {"live": None, "room_id": None, "resolve": True}
            return {"live": False, "room_id": None}
        except Exception as e:
            return {"live": None, "room_id": None, "error": str(e)}


class TikToolsHandler:
    def __init__(self, username: str, api_key: str, on_comment=None, on_gift=None, on_like=None):
        self.username = username
        self.api_key = api_key
        self.on_comment_cb = on_comment
        self.on_gift_cb = on_gift
        self.on_like_cb = on_like
        self.log_cb = None
        self._room_id = None
        self._connected = False
        self._drops = 0
        self._status_task = None
        self._pending_gifts = {}
        self._emitted_gifts = {}
        self._gift_flush_task = None

    def log(self, text: str):
        if self.log_cb:
            self.log_cb(text)
        else:
            print(text, flush=True)

    @staticmethod
    def _avatar(user: dict) -> str:
        return (user or {}).get("profilePictureUrl") or ""

    @staticmethod
    def _display_name(user: dict) -> str:
        return (user or {}).get("uniqueId") or (user or {}).get("nickname") or "?"

    @staticmethod
    def _nickname(user: dict) -> str:
        return (user or {}).get("nickname") or (user or {}).get("uniqueId") or "?"

    @staticmethod
    def _user_meta(user: dict) -> dict:
        u = user or {}
        return {
            "follow_role": u.get("followRole"),
            "is_subscriber": u.get("isSubscriber"),
            "is_follower": u.get("isFollower"),
            "badges": u.get("badges") or [],
            "user_id": str(u.get("id") or u.get("userId") or ""),
        }

    def _emit_status(self, state: str, extra: dict = None):
        status = {"state": state, "user": self.username}
        if self._room_id:
            status["room_id"] = self._room_id
        if extra:
            status.update(extra)
        print(f"[STATUS] {json.dumps(status, ensure_ascii=False)}", flush=True)

    async def _handle_event(self, event: dict):
        etype = event.get("event", "")
        if etype == "roomInfo":
            return
        data = event.get("data") or {}
        user = data.get("user") or {}
        if etype in ("liveStatus", "roomUser", "status"):
            return
        if etype == "chat":
            if self.on_comment_cb:
                await self.on_comment_cb(
                    user=self._display_name(user),
                    nickname=self._nickname(user),
                    avatar=self._avatar(user),
                    text=data.get("comment", ""),
                    user_meta=self._user_meta(user),
                )

        elif etype == "gift":
            gift_name = data.get("giftName", "")
            gift_id = str(data.get("giftId") or "")
            diamond_count = int(data.get("diamondCount") or 0)
            repeat_count = max(1, int(data.get("repeatCount") or 1))
            repeat_end = bool(data.get("repeatEnd", True))
            uid = str(user.get("id") or user.get("userId") or self._display_name(user))
            gid = str(data.get("groupId") or "")
            key = (uid, gid) if gid else (uid, gift_name)

            # Processa apenas o frame final do combo, bufferizando frames intermediarios
            # para nao perder gifts caso o frame final se perca (queda/reconexao).
            if repeat_end:
                self._pending_gifts.pop(key, None)
                await self._emit_gift(user, gift_name, diamond_count, repeat_count, key, gift_id)
            else:
                prev = self._pending_gifts.get(key)
                if prev is None:
                    self._pending_gifts[key] = {
                        "user": user,
                        "gift_name": gift_name,
                        "gift_id": gift_id,
                        "diamond_count": diamond_count,
                        "repeat_count": repeat_count,
                        "ts": time.time(),
                    }
                else:
                    prev["repeat_count"] = max(prev["repeat_count"], repeat_count)
                    prev["diamond_count"] = diamond_count
                    prev["ts"] = time.time()

        elif etype == "like":
            like_count = int(data.get("likeCount") or 0)
            if like_count <= 0:
                return
            if self.on_like_cb:
                await self.on_like_cb(
                    user=self._display_name(user),
                    nickname=self._nickname(user),
                    avatar=self._avatar(user),
                    like_count=like_count,
                    user_meta=self._user_meta(user),
                )

    async def _emit_gift(self, user, gift_name, diamond_count, repeat_count, key, gift_id=""):
        now = time.time()
        self._emitted_gifts = {k: v for k, v in self._emitted_gifts.items() if now - v <= 12}
        if key in self._emitted_gifts:
            return
        self._emitted_gifts[key] = now
        if self.on_gift_cb:
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

    async def _flush_pending_gifts(self):
        while True:
            await asyncio.sleep(4)
            now = time.time()
            for key in list(self._pending_gifts.keys()):
                entry = self._pending_gifts[key]
                if now - entry["ts"] > 6:
                    self._pending_gifts.pop(key, None)
                    await self._emit_gift(
                        entry["user"],
                        entry["gift_name"],
                        entry["diamond_count"],
                        entry["repeat_count"],
                        key,
                        entry.get("gift_id", "") or "",
                    )

    async def _connect(self):
        uri = f"{WS_BASE}?uniqueId={self.username}&apiKey={self.api_key}"
        async with websockets.connect(uri, ping_interval=20, ping_timeout=20, close_timeout=10) as ws:
            self._connected = True
            self._emit_status("connected")
            self.log(f"[TikTools] Conectado a @{self.username}")
            async for raw in ws:
                try:
                    event = json.loads(raw)
                except Exception:
                    continue
                try:
                    await self._handle_event(event)
                except Exception as e:
                    self.log(f"[TikTools] Erro ao processar evento {event.get('event')}: {e}")

    async def _fetch_rate(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(
                    f"{API_BASE}/webcast/rate_limits",
                    params={"apiKey": self.api_key},
                )
                r.raise_for_status()
                return r.json().get("data", {})
        except Exception as e:
            return {"error": str(e)}

    async def _status_report_loop(self):
        while True:
            await asyncio.sleep(RATE_REPORT_INTERVAL)
            rate = await self._fetch_rate()
            if self._connected:
                self._emit_status("connected", {"rate": rate})
            else:
                self._emit_status("waiting", {"rate": rate})

    async def run(self):
        self._status_task = asyncio.create_task(self._status_report_loop())
        self._gift_flush_task = asyncio.create_task(self._flush_pending_gifts())
        try:
            backoff = 5
            while True:
                status = await check_live_status_tiktools(self.username, self.api_key, log_cb=self.log)
                live = status.get("live")

                if live is False:
                    self._room_id = None
                    self._emit_status("waiting")
                    msg = "nao esta ao vivo"
                    if status.get("error"):
                        msg += f" ({status['error']})"
                    self.log(f"[TikTools] @{self.username} {msg}. Verificando novamente em {backoff}s...")
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 60)
                    continue

                if live is True:
                    self._room_id = status.get("room_id")
                else:
                    self._room_id = None
                    self.log("[TikTools] Status indeterminado; tentando conectar mesmo assim...")
                backoff = 5

                try:
                    await self._connect()
                    self.log("[TikTools] Conexao encerrada")
                except asyncio.CancelledError:
                    raise
                except websockets.exceptions.ConnectionClosed as e:
                    code = getattr(e, "code", None)
                    reason = getattr(e, "reason", "")
                    self.log(f"[TikTools] Conexao fechada (codigo {code}): {reason}")
                    if code in STREAM_END_CODES:
                        backoff = 30
                    else:
                        # 1006 (queda anormal/transitória): reconecta rápido
                        backoff = 5
                        self._drops += 1
                        if self._drops == 3:
                            self.log("[TikTools] AVISO: múltiplas quedas consecutivas (conexão instável)")
                            self._drops = 0
                except Exception as e:
                    self.log(f"[TikTools] ERRO: {type(e).__name__}: {e}")
                    backoff = min(backoff * 2, 60)
                finally:
                    self._connected = False
                    self._emit_status("disconnected")

                print(f"[TikTools] Reconectando em {backoff}s...")
                await asyncio.sleep(backoff)
                if backoff >= 30:
                    backoff = 30
        finally:
            if self._status_task:
                self._status_task.cancel()
                try:
                    await self._status_task
                except Exception:
                    pass
            if self._gift_flush_task:
                self._gift_flush_task.cancel()
                try:
                    await self._gift_flush_task
                except Exception:
                    pass
