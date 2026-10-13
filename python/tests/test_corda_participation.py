import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from corda import CordaEngine

class ParticipationTests(unittest.TestCase):
    def setUp(self):
        self.now=0
        self.events=[]
        self.game=CordaEngine(lambda kind,data:self.events.append((kind,data)),lambda:self.now)

    def test_preparation_accepts_teams_without_points(self):
        self.game.start({"start_delay_s":10})
        self.game.join("u","azul")
        self.assertTrue(self.game.state()["preparing"])
        self.assertFalse(self.game.like("u",20))
        self.assertFalse(self.game.comment("u","oi"))
        self.now=10;self.game.tick()
        self.assertTrue(self.game.round_active)
        self.assertEqual(self.game.state()["time_remaining"],180)
        self.assertEqual(self.game.teams["u"],"flavio")

    def test_comments_cooldown_and_mixed_teams(self):
        self.game.start();self.game.join("u","azul")
        self.game.comment("u","oi");self.game.comment("u","oi")
        self.assertEqual(self.game.taps["flavio"],1)
        self.now=2;self.game.comment("u","azul vermelho")
        self.assertEqual(self.game.taps["flavio"],1)
        self.game.comment("u","azul")
        self.assertEqual(self.game.taps["flavio"],2)
        self.game.comment("outsider","oi")
        self.assertEqual(self.game.taps["flavio"],2)

    def test_share_bonus_and_boost_expiry(self):
        self.game.start({"share_enabled":True,"share_boost_s":30})
        self.game.join("u","vermelho")
        self.game.share("u",nickname="Pessoa");self.game.share("u")
        self.assertEqual(self.game.taps["lula"],3)
        self.game.like("u",10)
        self.assertEqual(self.game.taps["lula"],23)
        self.game.comment("u","oi")
        self.assertEqual(self.game.taps["lula"],24)
        self.now=31;self.game.like("u",10)
        self.assertEqual(self.game.taps["lula"],34)
        self.assertEqual(sum(k=="corda_share" for k,d in self.events),1)

    def test_round_preparation_preserves_members_clears_boost(self):
        self.game.start({"round_countdown_s":3,"share_enabled":True})
        self.game.join("u","azul");self.game.share("u")
        self.game.finish("flavio");self.now=6;self.game.tick()
        self.assertTrue(self.game.state()["preparing"])
        self.assertEqual(self.game.taps["flavio"],0)
        self.assertFalse(self.game.boosts)
        self.assertEqual(self.game.teams["u"],"flavio")
        self.game.stop();self.now=20;self.game.tick()
        self.assertFalse(self.game.round_active)

    def test_share_disabled_by_default(self):
        self.game.start();self.game.join("u","azul")
        self.assertFalse(self.game.share("u"))
        self.assertEqual(self.game.taps["flavio"],0)

    def test_target_increase_preserves_balance(self):
        self.game.start();self.game.taps["flavio"]=350
        self.game.update_target(1000)
        self.assertEqual(self.game.taps["flavio"],350)
        self.assertEqual(self.game.force["flavio"],0)

    def test_target_decrease_rewards_once_each_and_resets(self):
        self.game.start();self.game.taps.update(flavio=350,lula=200)
        self.game.update_target(200)
        self.assertEqual(self.game.taps,{"flavio":0,"lula":0})
        self.assertEqual(self.game.force,{"flavio":5,"lula":5})
        self.assertFalse(self.game.update_target(200))
        self.assertEqual(self.game.force,{"flavio":5,"lula":5})

    def test_target_preserves_nonqualifying_team(self):
        self.game.start();self.game.taps.update(flavio=490,lula=90)
        self.game.update_target(100)
        self.assertEqual(self.game.taps,{"flavio":0,"lula":90})
        self.assertEqual(self.game.force["flavio"],5)

    def test_target_during_result_does_not_reward(self):
        self.game.start();self.game.taps["flavio"]=350
        self.game.finish("flavio");self.game.update_target(100)
        self.assertEqual(self.game.force["flavio"],0)

    def test_infinite_rounds_never_end_match(self):
        self.game.start({"best_of":0})
        self.game.join("u","azul")
        for n in range(6):
            self.game.finish("flavio")
            self.assertIsNone(self.game.match_winner)
            self.now+=6;self.game.tick()
            self.assertTrue(self.game.round_active)
        self.assertEqual(self.game.wins["flavio"],6)
        self.assertEqual(self.game.teams["u"],"flavio")

    def test_marked_gift_triggers_impact_without_changing_force(self):
        self.game.start({"gifts":[{"gift_id":"rose","side":"flavio","pull":True}]})
        self.game.gift("rose","Rose",1,1,"u")
        event=[d for k,d in self.events if k=="corda_pull"][-1]
        self.assertTrue(event["impulse"])
        self.assertEqual(event["force"],0.5)
