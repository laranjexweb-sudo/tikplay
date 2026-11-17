import asyncio
import socket
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tiktoklive_handler import TikTokLiveHandler


class TikTokLiveConnectionDiagnosticsTests(unittest.IsolatedAsyncioTestCase):
    def test_error_details_classify_timeout_without_serializing_message(self):
        error = TimeoutError("private URL and token must never be logged")
        details = TikTokLiveHandler._connection_error_details(error)
        self.assertEqual(details["failure_family"], "timeout")
        self.assertEqual(details["error_type"], "TimeoutError")
        self.assertNotIn("private URL", str(details))
        self.assertNotIn("token", str(details))

    def test_error_details_include_only_safe_websocket_metadata(self):
        error = RuntimeError("response body may contain secrets")
        error.rcvd = SimpleNamespace(code=1011, reason="private upstream text")
        details = TikTokLiveHandler._connection_error_details(error)
        self.assertEqual(details["failure_family"], "websocket_closed")
        self.assertEqual(details["websocket_close_code"], 1011)
        self.assertNotIn("private upstream text", str(details))

    def test_error_details_classify_wrapped_dns_cause(self):
        error = RuntimeError("request failed")
        error.__cause__ = socket.gaierror(-2, "private resolver detail")
        details = TikTokLiveHandler._connection_error_details(error)
        self.assertEqual(details["failure_family"], "dns")
        self.assertEqual(details["cause_type"], "gaierror")
        self.assertEqual(details["network_errno"], -2)
        self.assertNotIn("private resolver detail", str(details))

    async def test_failed_attempt_emits_failure_and_retry_diagnostics_without_exception_text(self):
        logs = []
        handler = TikTokLiveHandler("streamer")
        handler.log_cb = logs.append
        client = SimpleNamespace(
            start=AsyncMock(side_effect=RuntimeError("sensitive response content")),
            disconnect=AsyncMock(),
            add_listener=lambda *_: None,
            parse_error_ignorelist=[],
        )
        with patch("tiktoklive_handler.TikTokLiveClient", return_value=client), \
             patch("tiktoklive_handler.asyncio.sleep", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                await handler.run()

        failure = next(item for item in logs if isinstance(item, dict)
                       and item.get("event") == "tiktoklive.connection.failed")
        retry = next(item for item in logs if isinstance(item, dict)
                     and item.get("event") == "tiktoklive.connection.retry_scheduled")
        self.assertEqual(failure["details"]["failure_family"], "client_or_protocol")
        self.assertEqual(failure["details"]["phase"], "client_start")
        self.assertEqual(failure["details"]["retry_seconds"], 5)
        self.assertEqual(retry["details"]["reason"], "connection_failed")
        self.assertNotIn("sensitive response content", str(logs))


if __name__ == "__main__":
    unittest.main()
