import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import service


class QuizNarrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_configured_shared_voice_and_emits_audio_url(self):
        tenant_id = 71342
        service.sessions[tenant_id] = SimpleNamespace(settings={"tts_voice": "edge_antonio", "tts_rate": 1.4})
        self.addCleanup(service.sessions.pop, tenant_id, None)
        with patch.object(service.asyncio, "to_thread", new=AsyncMock(return_value="C:/audio/quiz-test.mp3")) as synthesize, \
             patch.object(service, "emit") as emit, \
             patch.object(service, "emit_service_log") as log:
            await service._synthesize_quiz_narration({
                "tenant_id": tenant_id, "match_id": "match-1", "question_no": 2,
                "text": "Quanto é dois mais dois?", "trace_id": "trace-1",
            })

        synthesize.assert_awaited_once_with(
            service.tts.synthesize_edge, "Quanto é dois mais dois?",
            os.path.join(service.TTS_AUDIO_ROOT, str(tenant_id)), "edge_antonio", 1.4,
        )
        event_type, payload = emit.call_args.args[1:]
        self.assertEqual(event_type, "quiz_narration_ready")
        self.assertEqual(payload["match_id"], "match-1")
        self.assertEqual(payload["question_no"], 2)
        self.assertEqual(payload["url"], f"/tts-audio/{tenant_id}/quiz-test.mp3")
        self.assertEqual(payload["trace_id"], "trace-1")
        log.assert_not_called()

    async def test_synthesis_failure_emits_safe_failure_code(self):
        tenant_id = 71343
        with patch.object(service.asyncio, "to_thread", new=AsyncMock(side_effect=RuntimeError("private details"))), \
             patch.object(service, "emit") as emit, \
             patch.object(service, "emit_service_log") as log:
            await service._synthesize_quiz_narration({
                "tenant_id": tenant_id, "match_id": "match-2", "question_no": 1,
                "text": "Pergunta de teste", "trace_id": "trace-2",
            })

        event_type, payload = emit.call_args.args[1:]
        self.assertEqual(event_type, "quiz_narration_failed")
        self.assertEqual(payload["code"], "TTS_SYNTHESIS_FAILED")
        self.assertNotIn("private details", str(payload))
        self.assertEqual(log.call_args.kwargs["details"]["error_type"], "RuntimeError")


if __name__ == "__main__":
    unittest.main()
