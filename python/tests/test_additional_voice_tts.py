import json
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import additional_voice_tts as provider
import tts_credits


class AudioResponse:
    status = 200

    def __init__(self, body=b"ID3synthetic-mp3", content_type="audio/mpeg"):
        self.body = body
        self.headers = {"Content-Type": content_type}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit):
        return self.body[:limit]


class AdditionalVoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.database = str(Path(self.temp.name) / "voice.db")
        self.audio = str(Path(self.temp.name) / "audio")
        self.environment = patch.dict(os.environ, {"DB_PATH": self.database,
            "OPENROUTER_API_KEY": "router-test-secret", "OPENAI_API_KEY": ""})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.executescript("""CREATE TABLE users(id INTEGER PRIMARY KEY,status TEXT);
                CREATE TABLE tenant_elevenlabs(tenant_id INTEGER PRIMARY KEY,enabled INTEGER,voice_id TEXT,
                    monthly_limit INTEGER,model_id TEXT);
                CREATE TABLE elevenlabs_usage(tenant_id INTEGER,month TEXT,characters INTEGER DEFAULT 0,
                    PRIMARY KEY(tenant_id,month));
                CREATE TABLE additional_voice_models(model_id TEXT PRIMARY KEY,enabled INTEGER);
                CREATE TABLE additional_voice_options(model_id TEXT,voice_id TEXT,label TEXT,enabled INTEGER,
                    PRIMARY KEY(model_id,voice_id));
                INSERT INTO users VALUES(1,'active');
                INSERT INTO tenant_elevenlabs VALUES(1,1,'pf_dora',10000,'hexgrad/kokoro-82m');
                ALTER TABLE additional_voice_models ADD COLUMN credits_per_100_chars INTEGER NOT NULL DEFAULT 0;
                INSERT INTO additional_voice_models VALUES('hexgrad/kokoro-82m',1,1);
                INSERT INTO additional_voice_options VALUES('hexgrad/kokoro-82m','pf_dora','pf_dora',1);""")
            conn.executescript("""CREATE TABLE tts_credit_wallets(tenant_id INTEGER PRIMARY KEY,balance INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE tts_credit_ledger(id INTEGER PRIMARY KEY,tenant_id INTEGER,amount INTEGER,kind TEXT,
                    idempotency_key TEXT UNIQUE,model_id TEXT DEFAULT '',unit_count INTEGER DEFAULT 0,reference_id TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
                INSERT INTO tts_credit_wallets VALUES(1,1000,CURRENT_TIMESTAMP);""")

    def credits_spent(self):
        with closing(sqlite3.connect(self.database)) as conn:
            row = conn.execute("SELECT coalesce(-sum(amount),0) FROM tts_credit_ledger WHERE tenant_id=1 AND kind='usage'").fetchone()
            return row[0]

    def balance(self):
        with closing(sqlite3.connect(self.database)) as conn:
            return conn.execute("SELECT balance FROM tts_credit_wallets WHERE tenant_id=1").fetchone()[0]

    @patch("additional_voice_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_openrouter_model_sends_selected_voice_and_reuses_cache(self, network):
        path, code = provider.synthesize(1, "olá chat", self.audio)
        self.assertEqual(code, "SYNTHESIZED")
        self.assertTrue(Path(path).is_file())
        request = network.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload, {"model": "hexgrad/kokoro-82m", "input": "Olá chat",
            "voice": "pf_dora", "response_format": "mp3"})
        self.assertEqual(request.get_header("Authorization"), "Bearer router-test-secret")
        self.assertEqual(self.credits_spent(), 1)
        self.assertEqual(self.balance(), 999)
        self.assertEqual(provider.synthesize(1, "olá chat", self.audio)[1], "CACHE_HIT")
        self.assertEqual(network.call_count, 1)

    @patch("additional_voice_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_additional_voice_speaks_and_charges_up_to_150_characters(self, network):
        path, code = provider.synthesize(1, "x" * 200, self.audio)
        payload = json.loads(network.call_args.args[0].data)
        self.assertEqual(code, "SYNTHESIZED")
        self.assertTrue(Path(path).is_file())
        self.assertEqual(len(payload["input"]), 150)
        self.assertEqual(self.credits_spent(), 2)
        self.assertEqual(self.balance(), 998)

    @patch("additional_voice_tts.urllib.request.urlopen", return_value=AudioResponse(b"pcm-audio", "audio/pcm"))
    def test_gemini_receives_safe_emotion_instruction_separately_from_spoken_text(self, network):
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute("UPDATE tenant_elevenlabs SET model_id='google/gemini-3.8-flash-lite-tts',voice_id='Zephyr' WHERE tenant_id=1")
            conn.execute("INSERT INTO additional_voice_models VALUES('google/gemini-3.8-flash-lite-tts',1,2)")
            conn.execute("INSERT INTO additional_voice_options VALUES('google/gemini-3.8-flash-lite-tts','Zephyr','Zephyr',1)")
        path, code = provider.synthesize(1, "Eu tô doida pra ir embora", self.audio, emotion="gritando")
        self.assertEqual(code, "SYNTHESIZED")
        payload = json.loads(network.call_args.args[0].data)
        self.assertEqual(payload["input"], "Eu tô doida pra ir embora")
        self.assertEqual(payload["instructions"], "gritando com intensidade e urgência")
        self.assertEqual(payload["voice"], "Zephyr")
        self.assertEqual(payload["response_format"], "pcm")
        self.assertTrue(path.endswith(".wav"))
        self.assertEqual(Path(path).read_bytes()[:4], b"RIFF")
        self.assertNotIn("#grito", payload["input"])

    @patch("elevenlabs_tts.urllib.request.urlopen", return_value=AudioResponse())
    def test_elevenlabs_receives_audio_tag_without_charging_it_as_chat_text(self, network):
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute("UPDATE tenant_elevenlabs SET model_id='elevenlabs/eleven-v4-turbo',voice_id='inez' WHERE tenant_id=1")
            conn.execute("INSERT INTO additional_voice_models VALUES('elevenlabs/eleven-v4-turbo',1,1)")
            conn.execute("INSERT INTO additional_voice_options VALUES('elevenlabs/eleven-v4-turbo','inez','Inêz',1)")
        credentials = Path(self.temp.name) / "elevenlabs.json"
        credentials.write_text(json.dumps({"api_key": "eleven-test-secret"}), encoding="utf-8")
        os.environ["ELEVENLABS_CONFIG_PATH"] = str(credentials)
        self.addCleanup(os.environ.pop, "ELEVENLABS_CONFIG_PATH", None)
        path, code = provider.synthesize(1, "Eu tô doida pra ir embora", self.audio, emotion="grito")
        self.assertEqual(code, "SYNTHESIZED")
        payload = json.loads(network.call_args.args[0].data)
        self.assertEqual(payload["text"], "[shouts] Eu tô doida pra ir embora")
        self.assertEqual(self.credits_spent(), 1)

    @patch("additional_voice_tts.urllib.request.urlopen", return_value=AudioResponse(b"pcm-data", "audio/pcm"))
    def test_pcm_result_is_wrapped_as_playable_wav(self, network):
        path, code = provider.synthesize(1, "olá", self.audio)
        self.assertEqual(code, "SYNTHESIZED")
        self.assertTrue(path.endswith(".wav"))
        self.assertEqual(Path(path).read_bytes()[:4], b"RIFF")

    @patch("additional_voice_tts.urllib.request.urlopen")
    def test_model_disable_and_empty_wallet_block_paid_request(self, network):
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute("UPDATE additional_voice_models SET enabled=0")
        self.assertEqual(provider.synthesize(1, "olá", self.audio)[1], "ACCESS_CHANGED")
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute("UPDATE additional_voice_models SET enabled=1")
            conn.execute("UPDATE tts_credit_wallets SET balance=0 WHERE tenant_id=1")
        self.assertEqual(provider.synthesize(1, "olá", self.audio)[1], "INSUFFICIENT_CREDITS")
        network.assert_not_called()
        self.assertEqual(self.credits_spent(), 0)

    def test_model_tariffs_scale_per_hundred_characters(self):
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute("INSERT INTO additional_voice_models VALUES('google/gemini-test',1,2)")
        self.assertEqual(tts_credits.charge(1, "hexgrad/kokoro-82m", 250), (3, "CHARGED"))
        self.assertEqual(tts_credits.charge(1, "google/gemini-test", 250), (5, "CHARGED"))
        self.assertEqual(self.balance(), 992)


if __name__ == "__main__":
    unittest.main()
