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

    async def test_live_end_resets_only_after_confirmed_new_connection(self):
        handler = TikTokLiveHandler('streamer')
        starts = []
        ends = []

        async def on_start(room_id, force_new=False):
            starts.append((room_id, force_new))

        async def on_end(room_id):
            ends.append(room_id)

        handler.on_live_start_cb = on_start
        handler.on_live_end_cb = on_end

        await handler._on_connect(SimpleNamespace(room_id=123))
        handler._last_like_total['viewer'] = 25
        await handler._on_disconnect(None)
        await handler._on_connect(SimpleNamespace(room_id=123))
        self.assertEqual(starts, [('123', False)])
        self.assertEqual(handler._last_like_total['viewer'], 25)

        await handler._on_live_end(None)
        self.assertEqual(ends, ['123'])
        await handler._on_disconnect(None)
        await handler._on_connect(SimpleNamespace(room_id=123))
        self.assertEqual(starts, [('123', False), ('123', True)])
        self.assertEqual(handler._last_like_total, {})

    async def test_new_room_resets_session_without_live_end(self):
        handler = TikTokLiveHandler('streamer')
        starts = []
        handler.on_live_start_cb = AsyncMock(side_effect=lambda room_id, force_new=False:
                                             starts.append((room_id, force_new)))
        await handler._on_connect(SimpleNamespace(room_id=123))
        await handler._on_disconnect(None)
        await handler._on_connect(SimpleNamespace(room_id=456))
        self.assertEqual(starts, [('123', False), ('456', False)])


if __name__ == '__main__':
    unittest.main()
