import json
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import elevenlabs_tts as provider


class AudioResponse:
    status = 200
    headers = {"Content-Type": "audio/mpeg"}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit):
        return b"ID3synthetic-audio"


class ElevenLabsTests(unittest.TestCase):
    @patch("elevenlabs_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_uppercases_first_letter_without_lowercasing_rest(self, network):
        for original, expected in (("olá NASA", "Olá NASA"),
                                   ("123 água no BRASIL", "123 Água no BRASIL"),
                                   ("Já está CERTO", "Já está CERTO")):
            with self.subTest(original=original):
                provider.synthesize(1, original, self.audio)
                self.assertEqual(json.loads(network.call_args.args[0].data)["text"], expected)
        count = network.call_count
        self.assertEqual(provider.synthesize(1, "Olá NASA", self.audio)[1], "CACHE_HIT")
        self.assertEqual(network.call_count, count)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = str(Path(self.temp.name) / "test.db")
        self.audio = str(Path(self.temp.name) / "audio")
        self.config = Path(self.temp.name) / "elevenlabs.json"
        self.env = patch.dict(os.environ, {"DB_PATH": self.db, "ELEVENLABS_API_KEY": "test-secret",
                                         "ELEVENLABS_CONFIG_PATH": str(self.config), "ELEVENLABS_MODEL_ID": ""})
        self.env.start()
        self.addCleanup(self.env.stop)
        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.executescript("""CREATE TABLE users(id INTEGER PRIMARY KEY,status TEXT);
                CREATE TABLE tenant_elevenlabs(tenant_id INTEGER PRIMARY KEY,enabled INTEGER,voice_id TEXT,monthly_limit INTEGER);
                CREATE TABLE elevenlabs_usage(tenant_id INTEGER,month TEXT,characters INTEGER DEFAULT 0,PRIMARY KEY(tenant_id,month));
                INSERT INTO users VALUES(1,'active'),(2,'active');
                INSERT INTO tenant_elevenlabs VALUES(1,1,'voice_one',10000),(2,0,'voice_two',10000);""")

    def usage(self):
        with closing(sqlite3.connect(self.db)) as conn:
            row = conn.execute("SELECT sum(characters) FROM elevenlabs_usage WHERE tenant_id=1").fetchone()
            return row[0] or 0

    def update(self, sql):
        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.execute(sql)

    @patch("elevenlabs_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_only_clean_spoken_text_is_sent_and_counted(self, network):
        provider.synthesize(1, "Olá [happy] :D 1️⃣ 😂 :heart: Brasil", self.audio)
        payload = json.loads(network.call_args.args[0].data)
        self.assertEqual(payload["text"], "Olá Brasil")
        self.assertEqual(self.usage(), len("Olá Brasil"))

    @patch("elevenlabs_tts.urllib.request.urlopen")
    def test_emote_only_messages_do_not_call_or_reserve_usage(self, network):
        for text in ("😂🔥", "[happy] [laugh]", ":D :) <3", "1️⃣"):
            self.assertIsNone(provider.synthesize(1, text, self.audio)[0])
        network.assert_not_called()
        self.assertEqual(self.usage(), 0)

    @patch("elevenlabs_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_v4_turbo_payload_omits_unsupported_speed_and_reuses_cache(self, network):
        provider.synthesize(1, "Olá Brasil", self.audio, 0.7)
        payload = json.loads(network.call_args.args[0].data)
        self.assertEqual(payload["model_id"], "eleven_v4_turbo")
        self.assertNotIn("voice_settings", payload)
        self.assertEqual(provider.synthesize(1, "Olá Brasil", self.audio, 1.2)[1], "CACHE_HIT")
        self.assertEqual(network.call_count, 1)

    @patch("elevenlabs_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_legacy_model_override_retains_speed(self, network):
        with patch.dict(os.environ, {"ELEVENLABS_MODEL_ID": "eleven_multilingual_v2"}):
            provider.synthesize(1, "Olá Brasil", self.audio, 1.1)
        payload = json.loads(network.call_args.args[0].data)
        self.assertEqual(payload["model_id"], "eleven_multilingual_v2")
        self.assertEqual(payload["voice_settings"]["speed"], 1.1)

    @patch("elevenlabs_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_admin_key_applies_without_restart_and_clear_overrides_environment(self, network):
        self.config.write_text(json.dumps({"api_key": "admin-secret"}), encoding="utf8")
        self.assertEqual(provider.synthesize(1, "Olá Brasil", self.audio)[1], "SYNTHESIZED")
        self.assertEqual(network.call_args.args[0].get_header("Xi-api-key"), "admin-secret")
        self.config.write_text(json.dumps({"api_key": ""}), encoding="utf8")
        self.assertEqual(provider.synthesize(1, "Olá Brasil", self.audio)[1], "NOT_CONFIGURED")
        self.assertEqual(network.call_count, 1)

    @patch("elevenlabs_tts.urllib.request.urlopen")
    def test_invalid_admin_config_fails_closed(self, network):
        self.config.write_text("{invalid", encoding="utf8")
        self.assertEqual(provider.synthesize(1, "Olá Brasil", self.audio)[1], "NOT_CONFIGURED")
        network.assert_not_called()

    @patch("elevenlabs_tts.urllib.request.urlopen")
    def test_global_key_removed_during_request_discards_audio(self, network):
        def respond(*args, **kwargs):
            self.config.write_text(json.dumps({"api_key": ""}), encoding="utf8")
            return AudioResponse()
        network.side_effect = respond
        self.assertEqual(provider.synthesize(1, "Olá Brasil", self.audio)[1], "ACCESS_CHANGED")
        self.assertFalse(Path(self.audio).exists())

    @patch("elevenlabs_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_synthesis_cache_and_isolation(self, network):
        path, code = provider.synthesize(1, "Olá Brasil", self.audio, 1.0)
        self.assertEqual(code, "SYNTHESIZED")
        self.assertTrue(Path(path).is_file())
        self.assertEqual(self.usage(), len("Olá Brasil"))
        request = network.call_args.args[0]
        self.assertIn("voice_one", request.full_url)
        self.assertEqual(json.loads(request.data)["text"], "Olá Brasil")
        self.assertEqual(provider.synthesize(1, "Olá Brasil", self.audio)[1], "CACHE_HIT")
        self.assertEqual(network.call_count, 1)
        self.assertEqual(provider.synthesize(2, "Olá Brasil", self.audio)[1], "NOT_SELECTED")
        self.update("UPDATE tenant_elevenlabs SET enabled=0 WHERE tenant_id=1")
        self.assertIsNone(provider.synthesize(1, "Olá Brasil", self.audio)[0])

    @patch("elevenlabs_tts.urllib.request.urlopen")
    def test_limit_prevents_upstream_call(self, network):
        self.update("UPDATE tenant_elevenlabs SET monthly_limit=3 WHERE tenant_id=1")
        self.assertEqual(provider.synthesize(1, "Olá Brasil", self.audio)[1], "LIMIT_REACHED")
        self.assertEqual(self.usage(), 0)
        network.assert_not_called()

    @patch("elevenlabs_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_long_messages_are_capped_before_synthesis_and_usage_reservation(self, network):
        text = "x" * 200
        path, code = provider.synthesize(1, text, self.audio)
        sent_text = json.loads(network.call_args.args[0].data)["text"]

        self.assertEqual(code, "SYNTHESIZED")
        self.assertTrue(Path(path).is_file())
        self.assertEqual(len(sent_text), 150)
        self.assertEqual(self.usage(), len(sent_text))

    @patch("elevenlabs_tts.urllib.request.urlopen", side_effect=TimeoutError("secret raw error"))
    def test_timeout_has_sanitized_error_and_reserved_usage(self, network):
        with self.assertRaisesRegex(provider.ProviderError, "^SYNTHESIS_FAILED$"):
            provider.synthesize(1, "Olá Brasil", self.audio)
        self.assertEqual(self.usage(), len("Olá Brasil"))

    @patch("elevenlabs_tts.urllib.request.urlopen")
    def test_revocation_during_request_discards_audio(self, network):
        def respond(*args, **kwargs):
            self.update("UPDATE tenant_elevenlabs SET enabled=0 WHERE tenant_id=1")
            return AudioResponse()
        network.side_effect = respond
        self.assertEqual(provider.synthesize(1, "Olá Brasil", self.audio)[1], "ACCESS_CHANGED")
        self.assertFalse(Path(self.audio).exists())

    @patch("elevenlabs_tts.urllib.request.urlopen")
    def test_missing_key_does_not_call_provider(self, network):
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""}):
            self.assertEqual(provider.synthesize(1, "Olá Brasil", self.audio)[1], "NOT_CONFIGURED")
        network.assert_not_called()

    @patch("elevenlabs_tts.urllib.request.urlopen")
    def test_non_audio_is_rejected(self, network):
        response = AudioResponse()
        response.headers = {"Content-Type": "application/json"}
        network.return_value = response
        with self.assertRaisesRegex(provider.ProviderError, "INVALID_AUDIO"):
            provider.synthesize(1, "Olá Brasil", self.audio)

    @patch("elevenlabs_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_concurrent_reservations_do_not_exceed_limit(self, network):
        self.update("UPDATE tenant_elevenlabs SET monthly_limit=30 WHERE tenant_id=1")
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda i: provider.synthesize(1, f"Mensagem {i}", self.audio), range(8)))
        self.assertLessEqual(self.usage(), 30)
        self.assertEqual(network.call_count, 3)
        self.assertEqual(sum(code == "LIMIT_REACHED" for _, code in results), 5)


if __name__ == "__main__":
    unittest.main()
