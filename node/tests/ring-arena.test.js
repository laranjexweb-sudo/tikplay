const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const { createRingArenaService, normalizeConfig, speedMultiplier, WORLD } = require('../lib/ring-arena');

function harness({featureEnabled=()=>true}={}) {
  const database = new Database(':memory:');
  database.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, status TEXT, room_code TEXT);');
  database.prepare('INSERT INTO users(id,status,room_code) VALUES(7,\'active\',\'room-seven\'),(8,\'active\',\'room-eight\')').run();
  let timestamp = 100000;
  let seed = 17;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const timers = new Map(); let timerId = 0;
  const tenants = new Map([[7,{id:7,browserClients:[]}],[8,{id:8,browserClients:[]}]]);
  const logs = [], broadcasts = [];
  const engine = createRingArenaService({
    database,
    getTenant:id=>tenants.get(id),
    getUserByRoomCode:room=>room==='room-seven'?{id:7,status:'active'}:room==='room-eight'?{id:8,status:'active'}:null,
    getRoomCode:id=>id===7?'room-seven':'room-eight',
    isFeatureEnabled:featureEnabled,
    broadcastToClients:(clients,message)=>{broadcasts.push({clients,message});return clients.length;},
    broadcastLog:(tenant,item)=>logs.push({tenant_id:tenant.id,...item}),
    now:()=>timestamp,random,
    setIntervalFn:fn=>{const id=++timerId;timers.set(id,fn);return {id,unref(){}};},
    clearIntervalFn:handle=>timers.delete(handle?.id),
  });
  return {database,engine,logs,broadcasts,tenants,timers,advance:ms=>{timestamp+=ms;},time:()=>timestamp};
}
function interaction(type,userId,meta,eventId){return {type,user_id:userId,username:userId,nickname:`Nome ${userId}`,avatar:'',event_id:eventId,room_id:'room-seven',value:0,meta:JSON.stringify(meta)};}

test('normaliza limites da arena e curva suave de velocidade',()=>{
  const config=normalizeConfig({round_seconds:5,starting_energy:-1,max_players:100,arena_radius:1000});
  assert.equal(config.round_seconds,30);assert.equal(config.starting_energy,100);assert.equal(config.max_players,48);assert.equal(config.arena_radius,WORLD.radius);
  assert.equal(normalizeConfig({arena_radius:472}).arena_radius,WORLD.radius);assert.equal(normalizeConfig({arena_radius:440}).arena_radius,440);
  assert.equal(speedMultiplier(1000,1000),1);assert.ok(Math.abs(speedMultiplier(500,1000)-.6)<1e-10);assert.equal(speedMultiplier(0,1000),.2);
});

test('spawns do jogo ficam dentro da arena, não se sobrepõem e rebateram no limite',()=>{
  const h=harness(),engine=h.engine;engine._test.createMatch(7,{demo:true,duration:60});
  const first=engine._test.simulateJoin(7,{user_id:'mock-a',nickname:'A'}).player;
  const second=engine._test.simulateJoin(7,{user_id:'mock-b',nickname:'B'}).player;
  assert.ok(Math.hypot(first.x-WORLD.cx,first.y-WORLD.cy)+first.radius<=WORLD.radius+1);
  assert.ok(Math.hypot(second.x-WORLD.cx,second.y-WORLD.cy)+second.radius<=WORLD.radius+1);
  assert.ok(Math.hypot(first.x-second.x,first.y-second.y)>=first.radius+second.radius);
  const game=engine._test.matches.get(7),player=game.players.get('mock-a');
  player.x=WORLD.cx+game.config.arena_radius-player.radius+25;player.y=WORLD.cy;player.vx=100;player.vy=0;
  assert.equal(engine._test.reflectBoundary(game,player),true);assert.ok(player.x-WORLD.cx+player.radius<=game.config.arena_radius+1);assert.ok(player.vx<0);
  h.engine.shutdown();h.database.close();
});

test('colisões separam jogadores, rebatem e removem energia',()=>{
  const h=harness(),engine=h.engine;engine._test.createMatch(7,{demo:true,duration:60});
  const one=engine._test.simulateJoin(7,{user_id:'mock-a'}).player, two=engine._test.simulateJoin(7,{user_id:'mock-b'}).player;
  const game=engine._test.matches.get(7),a=game.players.get(one.id),b=game.players.get(two.id);
  a.x=WORLD.cx-35;a.y=WORLD.cy;a.vx=80;a.vy=0;b.x=WORLD.cx+35;b.y=WORLD.cy;b.vx=-80;b.vy=0;
  const energy=a.energy+b.energy;assert.equal(engine._test.collide(game,a,b),true);
  assert.ok(a.energy+b.energy<energy);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=a.radius+b.radius-1);assert.equal(a.last_impact_at,h.time());assert.equal(b.last_impact_at,h.time());
  h.engine.shutdown();h.database.close();
});

test('comando entra, seleciona anel e presentes desbloqueiam e recuperam energia por espectador',()=>{
  const h=harness(),engine=h.engine;
  const config=engine._test.readConfig(7);config.join_mode='command';config.rings=config.rings.map(r=>r.id==='galaxy'?{...r,price:500}:r);config.gift_rules=[{gift_id:'rose-1',gift_name:'Rosa',energy_gain:200}];engine._test.saveConfig(7,config);
  config.rings=config.rings.map(r=>r.id==='silver'?{...r,price:0}:r);engine._test.saveConfig(7,config);
  assert.equal(engine._test.isUnlocked(7,'viewer-1','silver'),true);
  engine._test.createMatch(7,{demo:false,duration:60});
  assert.equal(engine.handleInteraction(h.tenants.get(7),interaction('comment','viewer-1',{text:'!entrar'},'entry-1')),true);
  const player=engine._test.matches.get(7).players.get('viewer-1');player.energy=300;
  assert.equal(engine.handleInteraction(h.tenants.get(7),interaction('comment','viewer-1',{text:'!anel galaxy'},'ring-1')),true);
  const gift=interaction('gift','viewer-1',{gift_id:'rose-1',gift_name:'Rosa',repeat_count:1},'gift-1');gift.value=600;
  assert.equal(engine.handleInteraction(h.tenants.get(7),gift),true);
  assert.equal(engine._test.isUnlocked(7,'viewer-1','galaxy'),true);assert.equal(player.ring_id,'galaxy');assert.equal(player.energy,500);
  const after=player.energy;assert.equal(engine.handleInteraction(h.tenants.get(7),gift),false);assert.equal(player.energy,after);
  assert.equal(engine._test.isUnlocked(8,'viewer-1','galaxy'),false);
  assert.ok(h.logs.some(item=>item.event==='ring_arena.ring.unlocked'));
  assert.ok(!h.logs.some(item=>JSON.stringify(item).includes('!anel galaxy')));
  h.engine.shutdown();h.database.close();
});

test('encerra por sobrevivência e tempo e grava snapshot do vencedor',()=>{
  const h=harness(),engine=h.engine;engine._test.createMatch(7,{demo:true,duration:30});
  engine._test.simulateJoin(7,{user_id:'winner',nickname:'Vencedor'});engine._test.simulateJoin(7,{user_id:'out',nickname:'Eliminado'});
  const game=engine._test.matches.get(7);game.players.get('out').alive=false;engine._test.tick(7);
  assert.equal(engine.stateFor(7).winner.nickname,'Vencedor');
  assert.equal(h.database.prepare('SELECT place FROM ring_arena_match_players WHERE match_id=? AND viewer_id=?').get(game.id,'winner').place,1);
  engine._test.createMatch(7,{demo:true,duration:30});engine._test.simulateJoin(7,{user_id:'timed',nickname:'Tempo'});h.advance(31000);engine._test.tick(7);
  assert.equal(engine.stateFor(7).winner.nickname,'Tempo');assert.equal(engine.stateFor(7).winner.cause,'time_limit');
  h.engine.shutdown();h.database.close();
});

test('rotas autenticadas expõem estado da conta e projeção pública não divulga ID estável',async()=>{
  const h=harness(),app=express();app.use(express.json());
  const auth={requireAuth:(req,res,next)=>{req.user={id:7,role:'user'};next();}};
  h.engine.registerRoutes(app,{auth,requireFeature:key=>{assert.equal(key,'ring_arena');return(_req,_res,next)=>next();},liveOnline:()=>false});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const state=await fetch(base+'/api/ring-arena/state',{headers:{Authorization:'Bearer test'}}).then(r=>r.json());
    assert.equal(state.state.room_code,'room-seven');
    const blocked=await fetch(base+'/api/ring-arena/start',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({})});
    assert.equal(blocked.status,409);
    h.engine._test.createMatch(7,{demo:true});h.engine._test.simulateJoin(7,{user_id:'private-id',nickname:'Público'});
    const pub=await fetch(base+'/api/ring-arena/public/room-seven').then(r=>r.json());
    assert.equal(Object.hasOwn(pub.players[0],'id'),false);assert.equal(pub.players[0].nickname,'Público');
    assert.equal(pub.entry.command,'!entrar');
  }finally{await new Promise(resolve=>server.close(resolve));h.engine.shutdown();h.database.close();}
});

test('conta sem a Arena habilitada não processa interações nem publica a sala',()=>{
  const h=harness({featureEnabled:()=>false});
  h.engine._test.createMatch(7,{demo:true,duration:60});
  assert.equal(h.engine.handleInteraction(h.tenants.get(7),interaction('comment','viewer',{text:'!entrar'},'disabled-entry')),false);
  assert.equal(h.engine._test.matches.get(7).players.size,0);
  assert.equal(h.engine.publicState('room-seven'),null);
  assert.equal(h.engine.roomForPublicCode('room-seven'),null);
  h.engine.shutdown();h.database.close();
});

test('modo de teste simula presente, compra o anel e limpa perfis fictícios ao encerrar',()=>{
  const h=harness(),engine=h.engine;const config=engine._test.readConfig(7);config.rings=config.rings.map(r=>r.id==='silver'?{...r,price:100}:r);engine._test.saveConfig(7,config);
  engine._test.createMatch(7,{demo:true,duration:60});
  const player=engine._test.simulateJoin(7,{nickname:'Teste'}).player;
  const gift=engine._test.simulateGift(7,player.id,{gift_id:'mock-gift',gift_name:'Presente',diamonds:100,ring_id:'silver'});
  assert.equal(gift.ring_unlocked,true);assert.equal(engine._test.matches.get(7).players.get(player.id).ring_id,'silver');
  engine._test.finish(7,null,'manual_stop');
  assert.equal(h.database.prepare('SELECT 1 FROM ring_arena_viewers WHERE tenant_id=7 AND viewer_id LIKE \'mock-%\'').get(),undefined);
  h.engine.shutdown();h.database.close();
});

test('equipamento visual de teste atualiza o estado público e só aceita participantes fictícios em demo',()=>{
  const h=harness(),engine=h.engine;engine._test.createMatch(7,{demo:true,duration:60});
  const player=engine._test.simulateJoin(7,{nickname:'Teste Galaxy'}).player;
  assert.deepEqual(engine._test.simulateEquipRing(7,player.id,'galaxy'),{success:true,ring_id:'galaxy'});
  assert.equal(engine._test.matches.get(7).players.get(player.id).ring_id,'galaxy');
  assert.equal(engine.publicState('room-seven').players[0].ring_id,'galaxy');
  assert.equal(engine._test.simulateEquipRing(7,'viewer-real','galaxy').code,'TEST_PLAYER_NOT_ACTIVE');
  engine._test.createMatch(8,{demo:false,duration:60});
  assert.equal(engine._test.simulateEquipRing(8,'mock-viewer','galaxy').code,'TEST_MATCH_REQUIRED');
  h.engine.shutdown();h.database.close();
});
