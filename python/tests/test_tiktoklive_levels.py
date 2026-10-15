import sys
import asyncio
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tiktoklive_handler import TikTokLiveHandler


class TikTokLiveLevelMetadataTests(unittest.TestCase):
    def test_reads_current_tiktoklive_badge_level_properties(self):
        user = SimpleNamespace(
            id=42,
            unique_id="viewer",
            nickname="Viewer",
            gifter_level=18,
            member_level=27,
        )

        meta = TikTokLiveHandler._user_meta(user)

        self.assertEqual(meta["gifter_level"], 18)
        self.assertEqual(meta["fan_club_level"], 27)

    def test_keeps_legacy_nested_level_fields(self):
        user = SimpleNamespace(
            id=43,
            unique_id="legacy-viewer",
            nickname="Legacy Viewer",
            pay_grade=SimpleNamespace(level=12, grade_describe=""),
            fans_club=SimpleNamespace(data=SimpleNamespace(level=9, club_name="Fãs")),
        )

        meta = TikTokLiveHandler._user_meta(user)

        self.assertEqual(meta["gifter_level"], 12)
        self.assertEqual(meta["fan_club_level"], 9)
        self.assertEqual(meta["fan_club_name"], "Fãs")

    def test_reads_current_tiktoklive_fans_club_info(self):
        user = SimpleNamespace(
            id=44,
            unique_id="community-member",
            nickname="Community Member",
            fans_club_info=SimpleNamespace(fans_level=31, fans_club_name="Comunidade"),
        )

        meta = TikTokLiveHandler._user_meta(user)

        self.assertEqual(meta["fan_club_level"], 31)
        self.assertEqual(meta["fan_club_name"], "Comunidade")

    def test_emits_explicit_fan_level_upgrade_barrage(self):
        calls = []
        async def capture(**kwargs):
            calls.append(kwargs)

        handler = TikTokLiveHandler("streamer", on_level_up=capture)
        user = SimpleNamespace(
            id=45,
            unique_id="member-upgrade",
            nickname="Member Upgrade",
            fans_club_info=SimpleNamespace(fans_level=30, fans_club_name="Comunidade"),
        )
        event = SimpleNamespace(
            msg_type=10,  # BarrageMessageBarrageType.FANS_LEVEL_UPGRADE
            fans_level_param=SimpleNamespace(current_grade=30, user=user),
            common=SimpleNamespace(room_id=9876, msg_id=12345),
        )

        asyncio.run(handler._on_barrage(event))

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["axis"], "fanclub")
        self.assertEqual(calls[0]["level"], 30)
        self.assertEqual(calls[0]["user_meta"]["fan_club_level"], 30)
        self.assertEqual(calls[0]["room_id"], "9876")
        self.assertEqual(calls[0]["event_id"], "12345")

    def test_emits_explicit_gifter_level_upgrade_barrage(self):
        calls = []
        async def capture(**kwargs):
            calls.append(kwargs)

        handler = TikTokLiveHandler("streamer", on_level_up=capture)
        user = SimpleNamespace(id=47, unique_id="gifter-upgrade", nickname="Gifter Upgrade")
        event = SimpleNamespace(
            msg_type=8,  # BarrageMessageBarrageType.USER_UPGRADE
            user_grade_param=SimpleNamespace(current_grade=18, user=user),
            common=SimpleNamespace(room_id=9876, msg_id=12347),
        )

        asyncio.run(handler._on_barrage(event))

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["axis"], "gifter")
        self.assertEqual(calls[0]["level"], 18)
        self.assertEqual(calls[0]["user_meta"]["gifter_level"], 18)
        self.assertEqual(calls[0]["event_id"], "12347")

    def test_ignores_fan_level_entrance_barrage(self):
        calls = []
        handler = TikTokLiveHandler("streamer", on_level_up=lambda **kwargs: calls.append(kwargs))
        user = SimpleNamespace(id=46, unique_id="member", nickname="Member")
        event = SimpleNamespace(
            msg_type=11,  # BarrageMessageBarrageType.FANS_LEVEL_ENTRANCE (não é subida)
            fans_level_param=SimpleNamespace(current_grade=30, user=user),
            common=SimpleNamespace(room_id=9876, msg_id=12346),
        )

        asyncio.run(handler._on_barrage(event))

        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
