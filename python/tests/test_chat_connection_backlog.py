import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tiktoklive_handler import TikTokLiveHandler


class ChatConnectionBacklogTests(unittest.IsolatedAsyncioTestCase):
    async def test_connection_requests_no_historical_comments(self):
        handler = TikTokLiveHandler('streamer')
        handler.log_cb = lambda *_: None
        with patch('tiktoklive_handler.TikTokLiveClient') as client_class:
            client_class.return_value.start = AsyncMock(side_effect=asyncio.CancelledError)
            with self.assertRaises(asyncio.CancelledError):
                await handler.run()
            self.assertEqual(client_class.call_args.kwargs['ws_kwargs'],
                             {'base_uri_params': {'history_comment_count': '0'}})
            client_class.return_value.start.assert_awaited_once_with(process_connect_events=False)

    async def test_comment_boundary_and_disconnected_state(self):
        callback = AsyncMock()
        handler = TikTokLiveHandler('streamer', on_comment=callback)
        handler._meta_for = lambda *_: {}
        event = SimpleNamespace(common=SimpleNamespace(create_time=99),
                                user=None, comment='teste')
        await handler._on_comment(event)
        callback.assert_not_awaited()
        handler._connected = True
        handler._connected_at = 100.5
        for timestamp in (96, 99, 100):
            event.common.create_time = timestamp
            await handler._on_comment(event)
        callback.assert_not_awaited()
        event.common.create_time = 101
        await handler._on_comment(event)
        callback.assert_awaited_once()
        # A margem histórica dos outros eventos continua igual.
        event.common.create_time = 99
        self.assertFalse(handler._is_backlog(event))

    async def test_reconnection_updates_boundary(self):
        callback = AsyncMock()
        handler = TikTokLiveHandler('streamer', on_comment=callback)
        handler.log_cb = lambda *_: None
        handler._meta_for = lambda *_: {}
        event = SimpleNamespace(common=SimpleNamespace(create_time=110),
                                user=None, comment='teste')
        with patch('tiktoklive_handler.time.time', return_value=100):
            await handler._on_connect(SimpleNamespace(room_id=1))
        await handler._on_comment(event)
        callback.assert_awaited_once()
        callback.reset_mock()
        await handler._on_disconnect(None)
        with patch('tiktoklive_handler.time.time', return_value=120):
            await handler._on_connect(SimpleNamespace(room_id=1))
        await handler._on_comment(event)
        callback.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
