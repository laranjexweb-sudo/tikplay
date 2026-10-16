import asyncio
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import service
import tts


class ChatNarrationTextTests(unittest.TestCase):
    def test_tiktok_emote_codes_are_removed_without_speaking_their_names(self):
        self.assertEqual(tts.prepare_chat_text("Olá [happy] [facewithrollingeyes] :heart: Brasil"), "Olá Brasil")

    def test_ascii_emoticons_and_keycaps_are_not_spoken(self):
        self.assertEqual(tts.prepare_chat_text("Oi:) :D <3<3 XD T_T 1️⃣ 2️⃣ Brasil"), "Oi Brasil")

    def test_only_emotes_or_punctuation_produces_no_speech(self):
        for text in ("😂🔥❤️", "[happy][laugh]", ":) :D <3", "1️⃣ 2️⃣", "... !!!", r"¯\_(ツ)_/¯"):
            with self.subTest(text=text):
                self.assertEqual(tts.prepare_chat_text(text), "")

    def test_unicode_normalization_preserves_portuguese_accents(self):
        self.assertEqual(tts.prepare_chat_text("Corac\u0327a\u0303o 10:30 (Brasil)"), "Coração 10:30 (Brasil)")

    def test_cleaning_removes_emojis_and_preserves_portuguese_text(self):
        self.assertEqual(tts.prepare_chat_text("Olá 😄, coração!"), "Olá , coração!")

    def test_only_mode_removes_prefix_before_synthesis(self):
        self.assertEqual(tts.prepare_chat_text("!Olá 👋", mode="only", marker="!"), "Olá")

    def test_exclude_mode_skips_prefixed_comments(self):
        self.assertEqual(tts.prepare_chat_text("#palpite", mode="exclude", marker="#"), "")

    def test_only_mode_skips_comments_without_prefix(self):
        self.assertEqual(tts.prepare_chat_text("Olá", mode="only", marker="#"), "")

    def test_long_chat_text_is_limited(self):
        result = tts.prepare_chat_text("palavra " * 100, max_len=40)
        self.assertLessEqual(len(result), 40)


class ChatNarrationRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_chat_uses_additional_voice_without_changing_riddle_voice(self):
        session = self._session()
        session._tts_url = AsyncMock(return_value="/edge.mp3")
        item = {"text": "Olá", "voice_key": "edge_francisca", "rate": 1.0}
        with patch.object(service.elevenlabs_tts, "synthesize", return_value=("C:/audio/eleven_test.mp3", "SYNTHESIZED")):
            self.assertTrue((await session._chat_tts_url(item)).endswith("/eleven_test.mp3"))
        session._tts_url.assert_not_called()
        self.assertEqual(session._tts_config_snapshot()["voice_key"], "edge_francisca")

    async def test_additional_voice_failure_falls_back_to_shared_voice(self):
        session = self._session()
        session._tts_url = AsyncMock(return_value="/edge.mp3")
        session._log_event = Mock()
        item = {"text": "Olá", "voice_key": "edge_francisca", "rate": 1.0}
        with patch.object(service.elevenlabs_tts, "synthesize", side_effect=service.elevenlabs_tts.ProviderError("SYNTHESIS_FAILED")):
            self.assertEqual(await session._chat_tts_url(item), "/edge.mp3")
        session._tts_url.assert_awaited_once_with("Olá", voice_key="edge_francisca", rate=1.0)
        self.assertEqual(session._log_event.call_args.args[2], "tts.provider.fallback")

    async def test_additional_voice_test_emits_audio_and_structured_completion(self):
        with patch.object(service.elevenlabs_tts, "synthesize", return_value=("C:/audio/eleven_test.mp3", "SYNTHESIZED")), \
                patch.object(service, "emit") as emitted, patch.object(service, "emit_service_log") as logged:
            await service._test_elevenlabs_voice(98231, "test-trace")
        emitted.assert_called_once_with(98231, "tts_test_ready", "/tts-audio/98231/eleven_test.mp3")
        self.assertEqual(logged.call_args.args[3], "tts.provider.completed")
        self.assertEqual(logged.call_args.kwargs["trace_id"], "test-trace")

    def _session(self, queue_size=2):
        session = service.GameSession.__new__(service.GameSession)
        session.tenant_id = 98231
        session.username = "tikplay"
        session.settings = {
            "chat_narr_enabled": True,
            "chat_narr_mode": "all",
            "chat_narr_char": "#",
            "tts_voice": "edge_francisca",
            "tts_rate": 1.4,
        }
        session._chat_narration_queue = asyncio.Queue(maxsize=queue_size)
        session._chat_narration_stats = {
            "received": 0, "filtered": 0, "queued": 0,
            "synthesized": 0, "failed": 0, "dropped": 0,
        }
        session._chat_narration_stats_at = time.monotonic()
        session._chat_narration_configs = set()
        session._chat_narration_epoch = 0
        session._chat_narration_overflow_at = time.monotonic()
        session._chat_narration_error_at = time.monotonic()
        session._log_event = Mock()
        return session

    async def test_enqueue_applies_filter_and_snapshots_shared_tts_preferences(self):
        session = self._session()
        session.settings["chat_narr_mode"] = "exclude"

        session._enqueue_chat_narration("viewer1", "#palpite")
        session._enqueue_chat_narration("viewer2", "Olá 👋")

        self.assertEqual(session._chat_narration_queue.qsize(), 1)
        item = session._chat_narration_queue.get_nowait()
        self.assertEqual(item["text"], "Olá")
        self.assertEqual(item["voice_key"], "edge_francisca")
        self.assertEqual(item["rate"], 1.4)
        self.assertEqual(item["epoch"], 0)

    async def test_streamer_comment_is_not_queued(self):
        session = self._session()
        session._enqueue_chat_narration("@TikPlay", "Mensagem do próprio canal")
        self.assertEqual(session._chat_narration_queue.qsize(), 0)

    async def test_queue_is_bounded_and_counts_dropped_comments(self):
        session = self._session(queue_size=1)
        session._chat_narration_overflow_at = time.monotonic() - 31
        session._enqueue_chat_narration("viewer1", "primeiro")
        session._enqueue_chat_narration("viewer2", "segundo")

        self.assertEqual(session._chat_narration_queue.qsize(), 1)
        self.assertEqual(session._chat_narration_stats["dropped"], 1)
        session._log_event.assert_called_once()
        self.assertEqual(session._log_event.call_args.args[2], "chat.tts.queue_full")

    async def test_reset_clears_pending_chat_and_notifies_panel(self):
        session = self._session()
        session._enqueue_chat_narration("viewer1", "mensagem antiga")
        with patch.object(service, "emit") as emit_mock:
            session._reset_chat_narration(True)

        self.assertEqual(session._chat_narration_queue.qsize(), 0)
        self.assertEqual(session._chat_narration_epoch, 1)
        emit_mock.assert_called_once_with(98231, "narrate", {"reset": True, "enabled": True})

    async def test_enabling_chat_narration_resets_the_existing_queue(self):
        session = self._session()
        session.settings["chat_narr_enabled"] = False
        session._enqueue_chat_narration("viewer1", "mensagem antes de ativar")
        self.assertEqual(session._chat_narration_queue.qsize(), 0)
        session._chat_narration_queue.put_nowait({
            "text": "mensagem antiga", "voice_key": "edge_francisca", "rate": 1.4,
            "queued_at": time.monotonic(), "epoch": 0,
        })
        session.game = SimpleNamespace(secret_word="", finished=True, boss_mode=True)
        session._tap_meta_x2 = False
        session.tap_meta_total = 1000
        session.session_id = "chat-tts-test-session"
        session.task = None
        previous_sessions = dict(service.sessions)
        service.sessions[98231] = session
        commands = asyncio.Queue()
        commands.put_nowait({"cmd": "update_settings", "tenant_id": 98231,
                             "settings": {"chat_narr_enabled": True}})
        commands.put_nowait({"cmd": "shutdown"})
        try:
            with patch.object(service, "emit") as emit_mock:
                await service.process_commands(commands)
        finally:
            service.sessions.clear()
            service.sessions.update(previous_sessions)

        self.assertTrue(session.settings["chat_narr_enabled"])
        self.assertEqual(session._chat_narration_queue.qsize(), 0)
        self.assertEqual(session._chat_narration_epoch, 1)
        self.assertTrue(any(
            call.args[1] == "narrate" and call.args[2].get("reset") is True
            for call in emit_mock.call_args_list
        ))

    async def test_worker_skips_expired_chat_without_synthesizing(self):
        session = self._session()
        session._enqueue_chat_narration("viewer1", "mensagem velha")
        session._chat_narration_queue._queue[0]["queued_at"] -= service.CHAT_NARRATION_MAX_AGE_SECONDS + 1
        task = asyncio.create_task(session._chat_narration_worker())
        try:
            with patch.object(session, "_tts_url", new=AsyncMock()) as synthesize:
                await asyncio.wait_for(session._chat_narration_queue.join(), timeout=1)
                synthesize.assert_not_awaited()
                self.assertEqual(session._chat_narration_stats["stale"], 1)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_worker_uses_shared_edge_tts_and_emits_existing_narrate_event(self):
        session = self._session()
        session._enqueue_chat_narration("viewer1", "Olá chat")
        task = asyncio.create_task(session._chat_narration_worker())
        try:
            with patch.object(session, "_tts_url", new=AsyncMock(return_value="/tts-audio/98231/test.mp3")):
                with patch.object(service, "emit") as emit_mock:
                    await asyncio.wait_for(session._chat_narration_queue.join(), timeout=1)
                    await asyncio.sleep(0)
                    emit_mock.assert_called_once()
                    event = emit_mock.call_args.args[2]
                    self.assertEqual(emit_mock.call_args.args[1], "narrate")
                    self.assertEqual(event["url"], "/tts-audio/98231/test.mp3")
                    self.assertGreater(event["expires_in_ms"], 0)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_batch_log_aggregates_counts_without_comment_content(self):
        session = self._session()
        session._chat_narration_stats_at = time.monotonic() - 31
        session._chat_narration_configs.add(("edge_francisca", 1.4))
        session._record_chat_narration("queued")

        session._log_event.assert_called_once()
        args = session._log_event.call_args.args
        self.assertEqual(args[:3], ("chat", "info", "chat.tts.batch"))
        details = session._log_event.call_args.kwargs["details"]
        self.assertEqual(details["queued"], 1)
        self.assertEqual(details["configurations"], [{"voice": "edge_francisca", "rate": 1.4}])
        self.assertNotIn("text", details)

    async def test_riddle_uses_voice_and_rate_snapshot(self):
        session = self._session()
        session.game = SimpleNamespace(game_id="game-1")
        session._palavra_debug = Mock()
        config = {"voice_key": "edge_antonio", "rate": 1.7}

        with patch.object(service.asyncio, "to_thread", new=AsyncMock(return_value="C:/audio/riddle.mp3")) as synthesize:
            with patch.object(service, "emit") as emit_mock:
                await session._narrate_riddle_async(2, "Texto da charada", trace_id="trace-1", tts_config=config)

        args = synthesize.await_args.args
        self.assertEqual(args[-2:], ("edge_antonio", 1.7))
        emit_mock.assert_called_once()
        self.assertEqual(emit_mock.call_args.args[1], "game")
        self.assertEqual(emit_mock.call_args.args[2]["type"], "riddle_audio")

    async def test_tts_test_command_returns_audio_url_for_panel_playback(self):
        commands = asyncio.Queue()
        commands.put_nowait({
            "cmd": "tts_test", "tenant_id": 98231,
            "voice": "edge_francisca", "rate": 1.6,
        })
        commands.put_nowait({"cmd": "shutdown"})
        previous_sessions = dict(service.sessions)
        service.sessions.clear()
        try:
            with patch.object(service.tts, "synthesize_edge", return_value="C:/audio/voice-test.mp3") as synthesize:
                with patch.object(service, "emit") as emit_mock:
                    await service.process_commands(commands)
        finally:
            service.sessions.clear()
            service.sessions.update(previous_sessions)

        self.assertEqual(synthesize.call_args.args[-2:], ("edge_francisca", 1.6))
        self.assertTrue(any(call.args[1] == "tts_test_ready" for call in emit_mock.call_args_list))
        self.assertTrue(any(
            call.args[1] == "log" and call.args[2].get("event") == "tts.test.completed"
            for call in emit_mock.call_args_list
        ))


class EdgeRateTests(unittest.TestCase):
    def test_audio_cache_keeps_only_the_newest_files(self):
        with tempfile.TemporaryDirectory() as audio_dir:
            paths = [Path(audio_dir, f"{index}.mp3") for index in range(4)]
            for index, path in enumerate(paths):
                path.write_bytes(b"mp3")
                os.utime(path, (index, index))

            self.assertEqual(tts._prune_audio_cache(audio_dir, max_files=2), 2)
            self.assertEqual([path.exists() for path in paths], [False, False, True, True])

    def test_configured_multiplier_maps_to_edge_rate(self):
        self.assertEqual(tts._edge_rate_str(0.5), "-50%")
        self.assertEqual(tts._edge_rate_str(1.0), "+0%")
        self.assertEqual(tts._edge_rate_str(1.5), "+50%")
        self.assertEqual(tts._edge_rate_str(2.0), "+100%")

    def test_invalid_rate_falls_back_to_normal_speed(self):
        self.assertEqual(tts._edge_rate_str(float("nan")), "+0%")

    def test_synthesizer_receives_the_configured_edge_rate(self):
        observed = []

        class FakeCommunicate:
            def __init__(self, text, voice, rate):
                observed.append((text, voice, rate))
                self.path = None

            async def save(self, path):
                self.path = path
                Path(path).write_bytes(b"mp3")

        fake_edge = SimpleNamespace(Communicate=FakeCommunicate)
        with tempfile.TemporaryDirectory() as audio_dir:
            with patch.object(tts, "edge_tts", fake_edge), patch.object(tts, "EDGE_AVAILABLE", True):
                for configured, expected in ((0.5, "-50%"), (1.0, "+0%"), (1.5, "+50%"), (2.0, "+100%")):
                    path = tts.synthesize_edge("Teste de velocidade", audio_dir, "edge_antonio", configured)
                    self.assertTrue(Path(path).exists())
                    self.assertEqual(observed[-1][2], expected)


if __name__ == "__main__":
    unittest.main()
