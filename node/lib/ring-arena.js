const crypto = require("crypto");

const LEGACY_DEFAULT_ARENA_RADIUS = 472;
const WORLD = Object.freeze({ width: 1080, height: 1920, cx: 540, cy: 960, radius: 500 });
const DEFAULT_RINGS = Object.freeze([
  { id: "bronze", name: "Bronze", price: 0, active: true, rarity: "Comum", bonusType: "speed", bonusValue: 0 },
  { id: "silver", name: "Prata", price: 150, active: true, rarity: "Incomum", bonusType: "speed", bonusValue: 0.03 },
  { id: "gold", name: "Ouro", price: 500, active: true, rarity: "Rara", bonusType: "all", bonusValue: 0.03 },
  { id: "galaxy", name: "Galaxy", price: 1000, active: true, rarity: "Épica", bonusType: "speed", bonusValue: 0.05 },
  { id: "fire", name: "Fogo", price: 700, active: true, rarity: "Rara", bonusType: "damage", bonusValue: 0.05 },
  { id: "ice", name: "Gelo", price: 700, active: true, rarity: "Rara", bonusType: "resilience", bonusValue: 0.05 },
  { id: "nature", name: "Natureza", price: 700, active: true, rarity: "Rara", bonusType: "recovery", bonusValue: 0.05 },
  { id: "crystal", name: "Cristal", price: 900, active: true, rarity: "Épica", bonusType: "resilience", bonusValue: 0.07 },
  { id: "arcane", name: "Arcano", price: 1200, active: true, rarity: "Épica", bonusType: "damage", bonusValue: 0.07 },
  { id: "shadow", name: "Sombra", price: 1600, active: true, rarity: "Lendária", bonusType: "speed", bonusValue: 0.08 },
]);
const DEFAULTS = Object.freeze({
  join_mode: "command", join_command: "!entrar", round_seconds: 240,
  starting_energy: 1000, max_players: 24, overcharge: false, overcharge_limit: 1.5,
  base_speed: 112, damage_multiplier: 1, arena_radius: WORLD.radius,
  gift_rules: [], rings: DEFAULT_RINGS,
});
const BONUS_TYPES = new Set(["speed", "damage", "resilience", "recovery", "all"]);
const JOIN_MODES = new Set(["command", "comment", "gift", "manual"]);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function safeText(value, max = 100) { return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max); }
function normalizeId(value) { return safeText(value, 80).toLowerCase().replace(/[^a-z0-9_-]/g, ""); }
function normalizeConfig(input = {}, fallback = DEFAULTS) {
  const raw = input && typeof input === "object" ? input : {};
  const ringsInput = Array.isArray(raw.rings) ? raw.rings : fallback.rings;
  const seenRings = new Set();
  const rings = ringsInput.slice(0, 30).map(item => {
    const id = normalizeId(item?.id);
    if (!id || seenRings.has(id)) return null;
    seenRings.add(id);
    const bonusType = BONUS_TYPES.has(item.bonusType) ? item.bonusType : "speed";
    return { id, name: safeText(item.name, 40) || id, price: Math.round(clamp(item.price, 0, 1000000, 0)),
      active: item.active !== false, rarity: safeText(item.rarity, 24) || "Comum", bonusType,
      bonusValue: clamp(item.bonusValue, 0, 0.1, 0), image: "" };
  }).filter(Boolean);
  if (!rings.some(item => item.active && item.price === 0)) {
    rings.unshift({ ...DEFAULT_RINGS[0] });
  }
  const giftsInput = Array.isArray(raw.gift_rules) ? raw.gift_rules : fallback.gift_rules;
  const gifts = giftsInput.slice(0, 100).map(item => ({
    gift_id: safeText(item?.gift_id, 80), gift_name: safeText(item?.gift_name, 100),
    energy_gain: Math.round(clamp(item?.energy_gain, 0, 1000000, 0)),
  })).filter(item => item.gift_id || item.gift_name);
  return {
    join_mode: JOIN_MODES.has(raw.join_mode) ? raw.join_mode : fallback.join_mode,
    join_command: safeText(raw.join_command, 32) || fallback.join_command,
    round_seconds: Math.round(clamp(raw.round_seconds, 30, 1800, fallback.round_seconds)),
    starting_energy: Math.round(clamp(raw.starting_energy, 100, 1000000, fallback.starting_energy)),
    max_players: Math.round(clamp(raw.max_players, 2, 48, fallback.max_players)),
    overcharge: raw.overcharge === true,
    overcharge_limit: clamp(raw.overcharge_limit, 1, 3, fallback.overcharge_limit),
    base_speed: clamp(raw.base_speed, 40, 240, fallback.base_speed),
    damage_multiplier: clamp(raw.damage_multiplier, 0.2, 3, fallback.damage_multiplier),
    // 472 was the original default, not a user-adjustable setting. Promote
    // existing saved defaults to the art-matched radius while preserving custom values.
    arena_radius: clamp(Number(raw.arena_radius) === LEGACY_DEFAULT_ARENA_RADIUS ? WORLD.radius : raw.arena_radius, 390, WORLD.radius, fallback.arena_radius),
    gift_rules: gifts, rings,
  };
}

function speedMultiplier(energy, maxEnergy) {
  return 0.2 + 0.8 * Math.max(0, Math.min(1, energy / Math.max(1, maxEnergy)));
}

function ensureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ring_arena_configs (
      tenant_id INTEGER PRIMARY KEY REFERENCES users(id), config TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ring_arena_viewers (
      tenant_id INTEGER NOT NULL REFERENCES users(id), viewer_id TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', selected_ring_id TEXT NOT NULL DEFAULT 'bronze',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,viewer_id)
    );
    CREATE TABLE IF NOT EXISTS ring_arena_collection (
      tenant_id INTEGER NOT NULL REFERENCES users(id), viewer_id TEXT NOT NULL, ring_id TEXT NOT NULL,
      unlocked_at INTEGER, diamond_progress INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
      PRIMARY KEY(tenant_id,viewer_id,ring_id)
    );
    CREATE TABLE IF NOT EXISTS ring_arena_matches (
      id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES users(id), state TEXT NOT NULL,
      config_snapshot TEXT NOT NULL, winner_viewer_id TEXT NOT NULL DEFAULT '', winner_nickname TEXT NOT NULL DEFAULT '',
      joined_count INTEGER NOT NULL DEFAULT 0, elimination_count INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL, ended_at INTEGER, duration_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ring_arena_matches_tenant ON ring_arena_matches(tenant_id,started_at DESC);
    CREATE TABLE IF NOT EXISTS ring_arena_match_players (
      match_id TEXT NOT NULL REFERENCES ring_arena_matches(id) ON DELETE CASCADE, viewer_id TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '', nickname TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '',
      ring_id TEXT NOT NULL DEFAULT 'bronze', final_energy REAL NOT NULL DEFAULT 0, eliminations INTEGER NOT NULL DEFAULT 0,
      place INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(match_id,viewer_id)
    );
  `);
}

function createRingArenaService({ database, getTenant, getUserByRoomCode, getRoomCode = () => "", isFeatureEnabled = () => true, broadcastToClients, broadcastLog = null,
  now = () => Date.now(), random = Math.random, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  ensureSchema(database);
  database.prepare("DELETE FROM ring_arena_collection WHERE viewer_id LIKE 'mock-%'").run();
  database.prepare("DELETE FROM ring_arena_viewers WHERE viewer_id LIKE 'mock-%'").run();
  const matches = new Map();
  const publicClients = new Map();
  const recentEvents = new Map();
  const collisionSummaryAt = new Map();
  const defaultConfig = normalizeConfig({});

  const readConfig = tenantId => {
    const row = database.prepare("SELECT config FROM ring_arena_configs WHERE tenant_id=?").get(tenantId);
    if (!row) return normalizeConfig(defaultConfig);
    try { return normalizeConfig(JSON.parse(row.config), defaultConfig); } catch { return normalizeConfig(defaultConfig); }
  };
  const saveConfig = (tenantId, raw) => {
    const config = normalizeConfig(raw, readConfig(tenantId));
    database.prepare(`INSERT INTO ring_arena_configs(tenant_id,config,updated_at) VALUES(?,?,?)
      ON CONFLICT(tenant_id) DO UPDATE SET config=excluded.config,updated_at=excluded.updated_at`)
      .run(tenantId, JSON.stringify(config), now());
    return config;
  };
  function emitLog(tenantId, event, options = {}) {
    if (!broadcastLog) return;
    const tenant = getTenant(tenantId);
    const { level = "info", category = "game", message = event, code = null, trace_id = null,
      game_id = matches.get(tenantId)?.id || null, details = {} } = options;
    broadcastLog(tenant, { category, level, event, message, source: "node", game: "ring_arena",
      trace_id, game_id, code, details });
  }
  const safeViewerId = interaction => safeText(interaction.user_id || interaction.username, 160);
  const viewerRow = (tenantId, viewerId) => database.prepare(`SELECT * FROM ring_arena_viewers WHERE tenant_id=? AND viewer_id=?`).get(tenantId, viewerId);
  function ensureViewer(tenantId, interaction) {
    const viewerId = safeViewerId(interaction);
    if (!viewerId) return null;
    const timestamp = now();
    const username = safeText(interaction.username, 80), nickname = safeText(interaction.nickname || interaction.username, 80);
    const avatar = safeText(interaction.avatar, 500);
    database.prepare(`INSERT INTO ring_arena_viewers(tenant_id,viewer_id,username,nickname,avatar,selected_ring_id,created_at,updated_at)
      VALUES(?,?,?,?,?,'bronze',?,?) ON CONFLICT(tenant_id,viewer_id) DO UPDATE SET
      username=CASE WHEN excluded.username<>'' THEN excluded.username ELSE username END,
      nickname=CASE WHEN excluded.nickname<>'' THEN excluded.nickname ELSE nickname END,
      avatar=CASE WHEN excluded.avatar<>'' THEN excluded.avatar ELSE avatar END,updated_at=excluded.updated_at`)
      .run(tenantId, viewerId, username, nickname, avatar, timestamp, timestamp);
    ensureOwnedRing(tenantId, viewerId, "bronze");
    return { id: viewerId, username, nickname: nickname || username || "Participante", avatar };
  }
  function ensureOwnedRing(tenantId, viewerId, ringId) {
    const timestamp = now();
    database.prepare(`INSERT OR IGNORE INTO ring_arena_collection(tenant_id,viewer_id,ring_id,unlocked_at,diamond_progress,updated_at)
      VALUES(?,?,?, ?,0,?)`).run(tenantId, viewerId, ringId, ringId === "bronze" ? timestamp : null, timestamp);
  }
  function isUnlocked(tenantId, viewerId, ringId) {
    const ring=findRing(tenantId,ringId);
    return ring?.price===0 || Boolean(database.prepare(`SELECT unlocked_at FROM ring_arena_collection
      WHERE tenant_id=? AND viewer_id=? AND ring_id=? AND unlocked_at IS NOT NULL`).get(tenantId, viewerId, ringId));
  }
  function progressFor(tenantId, viewerId, ringId) {
    return Number(database.prepare(`SELECT diamond_progress FROM ring_arena_collection WHERE tenant_id=? AND viewer_id=? AND ring_id=?`)
      .get(tenantId, viewerId, ringId)?.diamond_progress || 0);
  }
  function ringsFor(tenantId) { return readConfig(tenantId).rings; }
  function findRing(tenantId, id) { return ringsFor(tenantId).find(ring => ring.id === id && ring.active) || null; }
  function playerFromViewer(game, viewer) { return game.players.get(viewer.id); }
  function setPlayerRing(tenantId, viewerId, ringId) {
    const viewer = viewerRow(tenantId, viewerId);
    if (!viewer) return false;
    database.prepare("UPDATE ring_arena_viewers SET selected_ring_id=?,updated_at=? WHERE tenant_id=? AND viewer_id=?")
      .run(ringId, now(), tenantId, viewerId);
    const game = matches.get(tenantId), player = game?.players.get(viewerId);
    if (player && player.alive) player.ring_id = ringId;
    if (game) publishState(tenantId);
    emitLog(tenantId, "ring_arena.ring.equipped", { game_id: game?.id, details: { ring_id: ringId, active_player: Boolean(player?.alive) } });
    return true;
  }
  function createMatch(tenantId, { demo = false, duration, traceId = crypto.randomUUID() } = {}) {
    const existing = matches.get(tenantId);
    if (existing?.active) {
      const error = new Error("Já existe uma partida da Arena em andamento."); error.code = "MATCH_ALREADY_ACTIVE"; throw error;
    }
    const config = readConfig(tenantId), startedAt = now();
    const durationSeconds = Math.round(clamp(duration, 30, 1800, config.round_seconds));
    const id = crypto.randomUUID();
    const game = { id, tenantId, config, demo, active: true, startedAt,
      endsAt: startedAt + durationSeconds * 1000,
      players: new Map(), collisions: 0, totalJoined: 0, eliminations: 0,
      frameAt: startedAt, changed: true, timer: null, recentFloaters: [], winner: null };
    database.prepare(`INSERT INTO ring_arena_matches(id,tenant_id,state,config_snapshot,started_at)
      VALUES(?,?, 'active', ?, ?)`).run(id, tenantId, JSON.stringify(config), startedAt);
    matches.set(tenantId, game);
    game.timer = setIntervalFn(() => tick(tenantId), 50);
    if (game.timer?.unref) game.timer.unref();
    publishState(tenantId);
    emitLog(tenantId, "ring_arena.match.started", { game_id: id, trace_id: traceId,
      details: { demo, duration_seconds: Math.floor((game.endsAt - startedAt) / 1000), max_players: config.max_players } });
    return publicStateFor(tenantId);
  }
  function chooseSpawn(game, radius) {
    const limit = game.config.arena_radius - radius - 5;
    for (let attempt = 0; attempt < 120; attempt++) {
      const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * limit;
      const x = WORLD.cx + Math.cos(angle) * distance, y = WORLD.cy + Math.sin(angle) * distance;
      const safe = [...game.players.values()].filter(item => item.alive).every(item => Math.hypot(item.x - x, item.y - y) >= item.radius + radius + 6);
      if (safe) return { x, y };
    }
    return null;
  }
  function joinPlayer(tenantId, interaction, { source = "chat", mock = false } = {}) {
    const game = matches.get(tenantId);
    if (!game?.active) return { success: false, code: "MATCH_NOT_ACTIVE" };
    const viewer = ensureViewer(tenantId, interaction);
    if (!viewer?.id) return { success: false, code: "VIEWER_ID_MISSING" };
    const old = game.players.get(viewer.id);
    if (old?.alive) {
      old.nickname = viewer.nickname || old.nickname; old.avatar = viewer.avatar || old.avatar;
      return { success: true, existing: true };
    }
    if (old && !old.alive) return { success: false, code: "PLAYER_ELIMINATED" };
    const activePlayers = [...game.players.values()].filter(item => item.alive).length;
    if (activePlayers >= game.config.max_players) return { success: false, code: "ARENA_FULL" };
    const ring = viewer.selected_ring_id || viewerRow(tenantId, viewer.id)?.selected_ring_id || "bronze";
    const ringId = isUnlocked(tenantId, viewer.id, ring) && findRing(tenantId, ring) ? ring : "bronze";
    const radius = 48, spawn = chooseSpawn(game, radius);
    if (!spawn) return { success: false, code: "NO_SPAWN_SPACE" };
    const angle = random() * Math.PI * 2, velocity = game.config.base_speed * (0.55 + random() * 0.45);
    const player = { id: viewer.id, username: viewer.username || viewer.id.slice(0, 32), nickname: viewer.nickname || viewer.username || "Participante",
      avatar: viewer.avatar || "", x: spawn.x, y: spawn.y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity,
      radius, energy: game.config.starting_energy, maxEnergy: game.config.starting_energy, ring_id: ringId,
      alive: true, eliminations: 0, joinedAt: now(), lastDirectionAt: now(), nextDirectionAt: now() + 1200 + random() * 1800,
      flash: "join", last_impact_at: 0, mock };
    game.players.set(player.id, player); game.totalJoined++; game.changed = true;
    game.recentFloaters.push({ id: crypto.randomUUID(), x: player.x, y: player.y, text: `+ ${player.nickname}`, kind: "join", until: now() + 1600 });
    persistMatchCounts(game);
    emitLog(tenantId, "ring_arena.player.joined", { game_id: game.id, details: { source, player_count: activePlayers + 1 } });
    publishState(tenantId);
    return { success: true, player: sanitizePlayer(player) };
  }
  function persistMatchCounts(game) {
    database.prepare("UPDATE ring_arena_matches SET joined_count=?,elimination_count=? WHERE id=?")
      .run(game.totalJoined, game.eliminations, game.id);
  }
  function sanitizePlayer(player) {
    return { id: player.id, username: player.username, nickname: player.nickname, avatar: player.avatar,
      x: player.x, y: player.y, radius: player.radius, energy: Math.max(0, player.energy), max_energy: player.maxEnergy,
      speed_ratio: speedMultiplier(player.energy, player.maxEnergy), ring_id: player.ring_id, alive: player.alive,
      eliminations: player.eliminations, flash: player.flash || "", last_impact_at: player.last_impact_at || 0 };
  }
  function publicStateFor(tenantId) {
    const game = matches.get(tenantId), config = readConfig(tenantId);
    if (!game) return { type: "ring_arena_state", active: false, phase: "idle", players: [], alive_count: 0,
      ranking: [], winner: null, round_seconds: config.round_seconds, remaining_seconds: 0,
      entry: { mode: config.join_mode, command: config.join_command },
      arena: WORLD, rings: config.rings.filter(item => item.active).map(({ id, name, rarity, bonusType, bonusValue, price }) => ({ id, name, rarity, bonusType, bonusValue, price })) };
    const all = [...game.players.values()];
    const alive = all.filter(item => item.alive);
    const ranking = alive.sort((a,b) => b.energy-a.energy).slice(0,5).map((item,index) => ({ place:index+1,nickname:item.nickname,avatar:item.avatar,energy:Math.ceil(item.energy),ring_id:item.ring_id }));
    return { type: "ring_arena_state", match_id: game.id, active: game.active, phase: game.active ? "playing" : "finished",
      demo: game.demo, started_at: game.startedAt, round_seconds: Math.round((game.endsAt-game.startedAt)/1000),
      remaining_seconds: game.active ? Math.max(0,Math.ceil((game.endsAt-now())/1000)) : 0,
      players: all.filter(item => item.alive).map(sanitizePlayer), alive_count: alive.length,
      joined_count: game.totalJoined, eliminated_count: game.eliminations, collisions: game.collisions,
      ranking, winner: game.winner, floaters: game.recentFloaters.filter(item => item.until > now()), arena: WORLD,
      entry: { mode: game.config.join_mode, command: game.config.join_command },
      rings: config.rings.filter(item => item.active).map(({ id, name, rarity, bonusType, bonusValue, price }) => ({ id, name, rarity, bonusType, bonusValue, price })) };
  }
  function publishState(tenantId) {
    const state = publicStateFor(tenantId), tenant = getTenant(tenantId);
    broadcastToClients(tenant?.browserClients || [], state);
    const clients = publicClients.get(tenantId) || [];
    broadcastToClients(clients, publicProjection(state));
  }
  function publicProjection(state) {
    return { ...state, players:(state.players||[]).map(({id,...player})=>player),
      winner:state.winner?(({id,...winner})=>winner)(state.winner):null };
  }
  function reflectBoundary(game, player) {
    const dx = player.x-WORLD.cx, dy=player.y-WORLD.cy, distance=Math.hypot(dx,dy);
    const maxDistance=game.config.arena_radius-player.radius;
    if(distance<=maxDistance) return false;
    const nx=dx/(distance||1),ny=dy/(distance||1);
    player.x=WORLD.cx+nx*maxDistance; player.y=WORLD.cy+ny*maxDistance;
    const outward=player.vx*nx+player.vy*ny;
    if(outward>0){player.vx-=(1.8*outward)*nx;player.vy-=(1.8*outward)*ny;}
    player.flash="wall";return true;
  }
  function collide(game, a, b) {
    if(!a.alive||!b.alive)return false;
    let dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy),min=a.radius+b.radius;
    if(dist>=min)return false;
    if(dist<0.001){const angle=random()*Math.PI*2;dx=Math.cos(angle);dy=Math.sin(angle);dist=1;}
    const nx=dx/dist,ny=dy/dist,overlap=min-dist;
    a.x-=nx*overlap*.5;a.y-=ny*overlap*.5;b.x+=nx*overlap*.5;b.y+=ny*overlap*.5;
    const rvx=b.vx-a.vx,rvy=b.vy-a.vy,closing=rvx*nx+rvy*ny;
    if(closing<0){const impulse=-(1+0.88)*closing/2;a.vx-=impulse*nx;a.vy-=impulse*ny;b.vx+=impulse*nx;b.vy+=impulse*ny;}
    const impact=Math.max(0,Math.abs(closing));
    const ringA=findRing(game.tenantId,a.ring_id),ringB=findRing(game.tenantId,b.ring_id);
    const baseDamage=Math.min(game.config.starting_energy*.15,Math.max(3,2+impact*.045*game.config.damage_multiplier));
    const damageA=ringA&&(ringA.bonusType==="damage"||ringA.bonusType==="all")?ringA.bonusValue:0;
    const damageB=ringB&&(ringB.bonusType==="damage"||ringB.bonusType==="all")?ringB.bonusValue:0;
    const damageToA=baseDamage*(1-(ringA?.bonusType==="resilience"||ringA?.bonusType==="all"?ringA.bonusValue:0))*(1+damageB);
    const damageToB=baseDamage*(1-(ringB?.bonusType==="resilience"||ringB?.bonusType==="all"?ringB.bonusValue:0))*(1+damageA);
    a.energy=Math.max(0,a.energy-damageToA);b.energy=Math.max(0,b.energy-damageToB);
    reflectBoundary(game,a);reflectBoundary(game,b);
    a.flash="hit";b.flash="hit";a.last_impact_at=b.last_impact_at=now();game.collisions++;game.changed=true;
    if(a.energy<=0)eliminate(game,a,"collision");if(b.energy<=0)eliminate(game,b,"collision");
    return true;
  }
  function eliminate(game, player, cause) {
    if(!player.alive)return;
    player.alive=false;player.energy=0;player.eliminatedAt=now();player.eliminations++;
    game.eliminations++;game.changed=true;
    game.recentFloaters.push({id:crypto.randomUUID(),x:player.x,y:player.y,text:"ELIMINADO",kind:"elimination",until:now()+1800});
    emitLog(game.tenantId,"ring_arena.player.eliminated",{game_id:game.id,details:{alive_count:[...game.players.values()].filter(item=>item.alive).length,cause}});
  }
  function tick(tenantId) {
    const game=matches.get(tenantId);if(!game?.active)return;
    const timestamp=now(),dt=Math.min(.1,Math.max(.001,(timestamp-game.frameAt)/1000));game.frameAt=timestamp;
    const alive=[...game.players.values()].filter(item=>item.alive);
    for(const player of alive){
      if(timestamp>=player.nextDirectionAt){
        const current=Math.atan2(player.vy,player.vx),turn=(random()-.5)*.8,angle=current+turn;
        const ring=findRing(tenantId,player.ring_id),bonus=ring&&(ring.bonusType==="speed"||ring.bonusType==="all")?ring.bonusValue:0;
        const speed=game.config.base_speed*speedMultiplier(player.energy,player.maxEnergy)*(1+bonus);
        player.vx=Math.cos(angle)*speed;player.vy=Math.sin(angle)*speed;player.nextDirectionAt=timestamp+1000+random()*2200;
      }
      const speed=speedMultiplier(player.energy,player.maxEnergy),mag=Math.hypot(player.vx,player.vy)||1,target=game.config.base_speed*speed;
      const ring=findRing(tenantId,player.ring_id),bonus=ring&&(ring.bonusType==="speed"||ring.bonusType==="all")?ring.bonusValue:0;
      const scale=target*(1+bonus)/mag;player.vx*=scale;player.vy*=scale;
      player.x+=player.vx*dt;player.y+=player.vy*dt;reflectBoundary(game,player);
      if(player.flash && player.flash!=="hit")player.flash="";
    }
    let collisionCount=0;
    const active=[...game.players.values()].filter(item=>item.alive);
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++)if(collide(game,active[i],active[j]))collisionCount++;
    if(collisionCount){
      game.lastCollisionSummary=(game.lastCollisionSummary||0)+collisionCount;
      if(timestamp-(collisionSummaryAt.get(tenantId)||0)>=10000){
        collisionSummaryAt.set(tenantId,timestamp);emitLog(tenantId,"ring_arena.collision.summary",{category:"diagnostic",level:"debug",game_id:game.id,
          details:{collision_count:game.lastCollisionSummary,alive_count:[...game.players.values()].filter(item=>item.alive).length}});
        game.lastCollisionSummary=0;
      }
    }
    game.recentFloaters=game.recentFloaters.filter(item=>item.until>timestamp);
    const remaining=[...game.players.values()].filter(item=>item.alive);
    if(game.totalJoined>=2&&remaining.length<=1){finish(tenantId,remaining[0]||null,"last_survivor");return;}
    if(timestamp>=game.endsAt){
      const winner=remaining.sort((a,b)=>b.energy-a.energy)[0]||null;
      finish(tenantId,winner,"time_limit");return;
    }
    // 20Hz state updates; no per-tick log events.
    publishState(tenantId);
  }
  function finish(tenantId, winner, cause) {
    const game=matches.get(tenantId);if(!game?.active)return;
    game.active=false;game.winner=winner?{id:winner.id,nickname:winner.nickname,avatar:winner.avatar,energy:Math.ceil(winner.energy),ring_id:winner.ring_id,cause}:null;
    if(game.timer)clearIntervalFn(game.timer);game.timer=null;
    const all=[...game.players.values()].sort((a,b)=>b.energy-a.energy),ended=now(),duration=ended-game.startedAt;
    const transaction=database.transaction(()=>{
      database.prepare(`UPDATE ring_arena_matches SET state=?,winner_viewer_id=?,winner_nickname=?,joined_count=?,elimination_count=?,ended_at=?,duration_ms=? WHERE id=?`)
        .run(cause, winner?.id||"", winner?.nickname||"",game.totalJoined,game.eliminations,ended,duration,game.id);
      const save=database.prepare(`INSERT OR REPLACE INTO ring_arena_match_players(match_id,viewer_id,username,nickname,avatar,ring_id,final_energy,eliminations,place)
        VALUES(?,?,?,?,?,?,?,?,?)`);
      all.forEach((player,index)=>save.run(game.id,player.id,player.username,player.nickname,player.avatar,player.ring_id,Math.max(0,player.energy),player.eliminations,index+1));
    });
    try{transaction.immediate();}catch(error){emitLog(tenantId,"ring_arena.persistence.failed",{category:"error",level:"error",game_id:game.id,code:"MATCH_SNAPSHOT_FAILED",message:"Não foi possível salvar o resultado da Arena.",details:{error_type:error.name||"Error"}});}
    database.prepare("DELETE FROM ring_arena_collection WHERE tenant_id=? AND viewer_id LIKE 'mock-%'").run(tenantId);
    database.prepare("DELETE FROM ring_arena_viewers WHERE tenant_id=? AND viewer_id LIKE 'mock-%'").run(tenantId);
    persistMatchCounts(game);publishState(tenantId);
    emitLog(tenantId,cause==="time_limit"?"ring_arena.match.timed_out":"ring_arena.match.finished",{
      game_id:game.id,details:{cause,duration_ms:duration,joined_count:game.totalJoined,elimination_count:game.eliminations}});
  }
  function addEnergy(tenantId, viewerId, amount, { reason="gift", nickname="", avatar="" }={}) {
    const game=matches.get(tenantId),player=game?.players.get(viewerId);
    if(!game?.active||!player?.alive)return {success:false,code:"PLAYER_NOT_ACTIVE"};
    const ring=findRing(tenantId,player.ring_id),bonus=ring&&(ring.bonusType==="recovery"||ring.bonusType==="all")?ring.bonusValue:0;
    const gain=Math.max(0,Number(amount)||0)*(1+bonus),cap=game.config.starting_energy*(game.config.overcharge?game.config.overcharge_limit:1);
    const actual=Math.max(0,Math.min(cap-player.energy,gain));player.energy+=actual;player.flash="gift";game.changed=true;
    if(nickname)player.nickname=safeText(nickname,80);if(avatar)player.avatar=safeText(avatar,500);
    if(actual>0)game.recentFloaters.push({id:crypto.randomUUID(),x:player.x,y:player.y,text:`+${Math.round(actual)}`,kind:"gift",until:now()+1500});
    return {success:actual>0,amount:Math.round(actual),reason};
  }
  function findGiftRule(config, giftId, giftName) {
    const id=String(giftId||"").trim(),name=String(giftName||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    return config.gift_rules.find(item=>(id&&item.gift_id===id)||(!item.gift_id&&name&&item.gift_name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()===name));
  }
  function processGift(tenantId, interaction, meta) {
    const viewer=ensureViewer(tenantId,interaction);if(!viewer)return {success:false,code:"VIEWER_ID_MISSING"};
    const config=readConfig(tenantId),giftId=String(meta.gift_id||""),giftName=String(meta.gift_name||""),diamonds=Math.max(0,Math.floor(Number(interaction.value)||0));
    let game=matches.get(tenantId);
    if(!game?.active&&config.join_mode==="gift"){
      const joined=joinPlayer(tenantId,interaction,{source:"gift"});
      if(joined.success)game=matches.get(tenantId);
    }
    const ringId=viewerRow(tenantId,viewer.id)?.selected_ring_id||"bronze";
    const ring=findRing(tenantId,ringId);let unlockedNow=false,progressed=false,progress=0;
    if(ring&&ring.price>0&&!isUnlocked(tenantId,viewer.id,ring.id)&&diamonds>0){
      ensureOwnedRing(tenantId,viewer.id,ring.id);
      const before=progressFor(tenantId,viewer.id,ring.id),after=before+diamonds;
      const complete=after>=ring.price;
      database.prepare(`UPDATE ring_arena_collection SET diamond_progress=?,unlocked_at=CASE WHEN ? THEN ? ELSE unlocked_at END,updated_at=?
        WHERE tenant_id=? AND viewer_id=? AND ring_id=?`).run(complete?after-ring.price:after,complete?1:0,complete?now():null,now(),tenantId,viewer.id,ring.id);
      progress=complete?after-ring.price:after;unlockedNow=complete;progressed=true;
      emitLog(tenantId,complete?"ring_arena.ring.unlocked":"ring_arena.ring.progressed",{details:{ring_id:ring.id,diamonds,progress,price:ring.price}});
      if(complete)setPlayerRing(tenantId,viewer.id,ring.id);
    }
    let energy={success:false,code:"PLAYER_NOT_ACTIVE"};
    const rule=findGiftRule(config,giftId,giftName);
    if(rule&&rule.energy_gain>0){energy=addEnergy(tenantId,viewer.id,rule.energy_gain*Math.max(1,Number(meta.repeat_count)||1),{nickname:viewer.nickname,avatar:viewer.avatar});
      if(energy.success)emitLog(tenantId,"ring_arena.gift.applied",{details:{gift_id:giftId,energy_gain:energy.amount,ring_unlocked:unlockedNow}});}
    if(game?.active)publishState(tenantId);
    return {success:energy.success||unlockedNow||progressed,energy_gain:energy.amount||0,ring_unlocked:unlockedNow,ring_id:ring?.id||null,progress};
  }
  function parseMeta(value) { if(value&&typeof value==="object")return value;try{return JSON.parse(String(value||"{}"));}catch{return {};}}
  function handleInteraction(tenant, interaction = {}) {
    if(!tenant||!interaction||!isFeatureEnabled(tenant.id))return false;
    if(matches.get(tenant.id)?.demo)return false;
    const eventId=safeText(interaction.event_id,200),cache=recentEvents.get(tenant.id)||new Set();
    if(eventId&&cache.has(eventId))return false;
    if(eventId){cache.add(eventId);if(cache.size>3000)cache.delete(cache.values().next().value);recentEvents.set(tenant.id,cache);}
    const meta=parseMeta(interaction.meta),config=readConfig(tenant.id),viewerId=safeViewerId(interaction);
    if(interaction.type==="comment"){
      const text=safeText(meta.text,200),command=text.match(/^!anel\s+([a-z0-9_-]{1,40})$/i);
      if(command&&viewerId){
        const ring=findRing(tenant.id,normalizeId(command[1]));
        if(!ring){emitLog(tenant.id,"ring_arena.ring.selection_rejected",{category:"notice",level:"warning",code:"RING_NOT_FOUND",details:{}});return false;}
        const viewer=ensureViewer(tenant.id,interaction),owned=isUnlocked(tenant.id,viewer.id,ring.id);
        database.prepare("UPDATE ring_arena_viewers SET selected_ring_id=?,updated_at=? WHERE tenant_id=? AND viewer_id=?")
          .run(ring.id,now(),tenant.id,viewer.id);
        if(owned)setPlayerRing(tenant.id,viewer.id,ring.id);
        const game=matches.get(tenant.id);
        if(game){game.recentFloaters.push({id:crypto.randomUUID(),x:WORLD.cx,y:WORLD.cy-120,text:owned?`${viewer.nickname}: ${ring.name}`:`${viewer.nickname}: ${ring.name} · ${progressFor(tenant.id,viewer.id,ring.id)}/${ring.price} ♦`,kind:owned?"ring":"progress",until:now()+2400});publishState(tenant.id);}
        emitLog(tenant.id,owned?"ring_arena.ring.equipped":"ring_arena.ring.selection_started",{details:{ring_id:ring.id,unlocked:owned}});
        return true;
      }
      if(config.join_mode==="command"&&text.toLowerCase()===config.join_command.toLowerCase()){
        const result=joinPlayer(tenant.id,interaction,{source:"chat_command"});if(!result.success)emitLog(tenant.id,"ring_arena.player.join_rejected",{category:"notice",level:"warning",code:result.code,details:{source:"chat_command"}});return result.success;
      }
      if(config.join_mode==="comment"&&text&&!text.startsWith("!")){
        const result=joinPlayer(tenant.id,interaction,{source:"comment"});if(!result.success&&result.code!=="MATCH_NOT_ACTIVE")emitLog(tenant.id,"ring_arena.player.join_rejected",{category:"notice",level:"warning",code:result.code,details:{source:"comment"}});return result.success;
      }
      return false;
    }
    if(interaction.type==="gift"){
      const result=processGift(tenant.id,interaction,meta);
      if(!result.success&&result.code)emitLog(tenant.id,"ring_arena.gift.ignored",{category:"notice",level:"info",code:result.code,details:{gift_id:String(meta.gift_id||"").slice(0,80)}});
      return result.success;
    }
    return false;
  }
  function simulateJoin(tenantId, raw = {}) {
    return joinPlayer(tenantId,{user_id:raw.user_id||`mock-${crypto.randomUUID()}`,username:raw.username||"viewer_demo",
      nickname:raw.nickname||`Espectador ${Math.floor(random()*999)+1}`,avatar:raw.avatar||""},{source:"panel_test",mock:true});
  }
  function simulateEquipRing(tenantId, viewerId, ringId) {
    const game=matches.get(tenantId),viewerKey=String(viewerId||""),ring=findRing(tenantId,normalizeId(ringId));
    if(!game?.active||!game.demo)return {success:false,code:"TEST_MATCH_REQUIRED"};
    if(!viewerKey.startsWith("mock-")||!game.players.get(viewerKey)?.alive)return {success:false,code:"TEST_PLAYER_NOT_ACTIVE"};
    if(!ring)return {success:false,code:"RING_NOT_FOUND"};
    setPlayerRing(tenantId,viewerKey,ring.id);
    return {success:true,ring_id:ring.id};
  }
  function simulateGift(tenantId, viewerId, { gift_id="mock-rose",gift_name="Rosa",diamonds=1,repeat_count=1,ring_id="" }={}) {
    const viewer=viewerRow(tenantId,String(viewerId));
    if(!viewer)return {success:false,code:"PLAYER_NOT_FOUND"};
    if(ring_id){
      const ring=findRing(tenantId,normalizeId(ring_id));
      if(!ring)return {success:false,code:"RING_NOT_FOUND"};
      database.prepare("UPDATE ring_arena_viewers SET selected_ring_id=?,updated_at=? WHERE tenant_id=? AND viewer_id=?")
        .run(ring.id,now(),tenantId,String(viewerId));
    }
    const meta={gift_id,gift_name,repeat_count},interaction={user_id:String(viewerId),username:viewer.username,nickname:viewer.nickname,avatar:viewer.avatar,
      value:Math.max(1,Math.floor(Number(diamonds)||1))*Math.max(1,Math.floor(Number(repeat_count)||1))};
    const result=processGift(tenantId,interaction,meta);
    emitLog(tenantId,"ring_arena.control.gift_simulated",{details:{gift_id,diamonds:interaction.value,ring_id:ring_id||viewer.selected_ring_id,
      energy_gain:result.energy_gain,ring_unlocked:result.ring_unlocked}});
    return {...result,rule_found:Boolean(findGiftRule(readConfig(tenantId),gift_id,gift_name))};
  }
  function simulateImpact(tenantId, viewerId, amount = 100) {
    const game=matches.get(tenantId),player=game?.players.get(String(viewerId));
    if(!game?.active||!player?.alive)return {success:false,code:"PLAYER_NOT_ACTIVE"};
    player.energy=Math.max(0,player.energy-clamp(amount,1,player.maxEnergy,100));player.flash="hit";player.last_impact_at=now();
    if(player.energy<=0)eliminate(game,player,"panel_test");
    emitLog(tenantId,"ring_arena.control.impact_simulated",{details:{energy_damage:Math.round(amount)}});publishState(tenantId);return {success:true};
  }
  function stop(tenantId, traceId = crypto.randomUUID()) {
    const game=matches.get(tenantId);if(!game?.active)return false;
    const winner=[...game.players.values()].filter(item=>item.alive).sort((a,b)=>b.energy-a.energy)[0]||null;
    finish(tenantId,winner,"manual_stop");emitLog(tenantId,"ring_arena.control.stopped",{game_id:game.id,trace_id:traceId});return true;
  }
  function stateFor(tenantId) { return { ...publicStateFor(tenantId), config:readConfig(tenantId), recent:recentMatches(tenantId), room_code:getRoomCode(tenantId) || "" }; }
  function recentMatches(tenantId) {
    return database.prepare(`SELECT id,state,winner_nickname,joined_count,elimination_count,started_at,ended_at,duration_ms
      FROM ring_arena_matches WHERE tenant_id=? ORDER BY started_at DESC LIMIT 10`).all(tenantId);
  }
  function ownedFor(tenantId, viewerId) {
    return database.prepare(`SELECT ring_id,unlocked_at,diamond_progress FROM ring_arena_collection WHERE tenant_id=? AND viewer_id=?`).all(tenantId,viewerId);
  }
  function publicState(roomCode) {
    const user=getUserByRoomCode(String(roomCode||""));
    return user?.status==="active"&&isFeatureEnabled(user.id)?publicProjection(publicStateFor(user.id)):null;
  }
  function roomForPublicCode(roomCode) { const user=getUserByRoomCode(String(roomCode||""));return user?.status==="active"&&isFeatureEnabled(user.id)?user:null; }
  function attachPublic(roomCode,ws) {
    const user=roomForPublicCode(roomCode);if(!user)return false;
    const clients=publicClients.get(user.id)||[];clients.push(ws);publicClients.set(user.id,clients);
    ws.send(JSON.stringify(publicProjection(publicStateFor(user.id))));
    ws.once("close",()=>{const index=clients.indexOf(ws);if(index>=0)clients.splice(index,1);if(!clients.length)publicClients.delete(user.id);});
    return true;
  }
  function registerRoutes(app,{auth,requireFeature,liveOnline}){
    const guard=[auth.requireAuth,requireFeature("ring_arena")];
    app.get("/api/ring-arena/config",...guard,(req,res)=>res.set("Cache-Control","no-store").json({success:true,config:readConfig(req.user.id)}));
    app.post("/api/ring-arena/config",...guard,(req,res)=>{
      const traceId=crypto.randomUUID();
      try{const config=saveConfig(req.user.id,req.body||{});emitLog(req.user.id,"ring_arena.config.saved",{trace_id:traceId,details:{join_mode:config.join_mode,ring_count:config.rings.length,gift_rule_count:config.gift_rules.length}});res.json({success:true,config,trace_id:traceId});}
      catch(error){emitLog(req.user.id,"ring_arena.config.failed",{category:"error",level:"error",trace_id:traceId,code:"CONFIG_SAVE_FAILED",message:"Não foi possível salvar as regras da Arena.",details:{error_type:error.name||"Error"}});res.status(400).json({success:false,error:"Não foi possível salvar as regras da Arena."});}
    });
    app.get("/api/ring-arena/state",...guard,(req,res)=>res.set("Cache-Control","no-store").json({success:true,state:stateFor(req.user.id),live_connected:liveOnline(getTenant(req.user.id))}));
    app.post("/api/ring-arena/start",...guard,(req,res)=>{
      const traceId=crypto.randomUUID(),demo=req.body?.demo===true,tenant=getTenant(req.user.id);
      emitLog(req.user.id,"ring_arena.match.start.requested",{trace_id:traceId,details:{demo}});
      if(!demo&&!liveOnline(tenant)){emitLog(req.user.id,"ring_arena.match.start.rejected",{category:"notice",level:"warning",trace_id:traceId,code:"LIVE_DISCONNECTED",message:"A partida não iniciou porque a live não está conectada."});return res.status(409).json({success:false,error:"Conecte a live antes de iniciar a partida.",code:"LIVE_DISCONNECTED"});}
      try{res.json({success:true,state:createMatch(req.user.id,{demo,duration:req.body?.duration,traceId})});}
      catch(error){const expected=error.code==="MATCH_ALREADY_ACTIVE";emitLog(req.user.id,expected?"ring_arena.match.start.rejected":"ring_arena.match.start.failed",{category:expected?"notice":"error",level:expected?"warning":"error",trace_id:traceId,code:error.code||"START_FAILED",message:expected?error.message:"Não foi possível iniciar a Arena."});res.status(expected?409:500).json({success:false,error:expected?error.message:"Não foi possível iniciar a Arena.",code:error.code||"START_FAILED"});}
    });
    app.post("/api/ring-arena/stop",...guard,(req,res)=>{const ok=stop(req.user.id);return ok?res.json({success:true,state:stateFor(req.user.id)}):res.status(409).json({success:false,error:"Não há partida ativa."});});
    app.post("/api/ring-arena/test/join",...guard,(req,res)=>{
      const result=simulateJoin(req.user.id,req.body||{});if(!result.success)return res.status(409).json({success:false,error:result.code});
      emitLog(req.user.id,"ring_arena.control.player_simulated",{details:{player_count:stateFor(req.user.id).alive_count}});res.json({success:true,state:stateFor(req.user.id)});
    });
    app.post("/api/ring-arena/test/equip",...guard,(req,res)=>{
      const result=simulateEquipRing(req.user.id,safeText(req.body?.viewer_id,160),safeText(req.body?.ring_id,80));
      return res.status(result.success?200:409).json({...result,state:stateFor(req.user.id)});
    });
    app.post("/api/ring-arena/test/gift",...guard,(req,res)=>{
      const viewerId=safeText(req.body?.viewer_id,160),result=simulateGift(req.user.id,viewerId,{gift_id:safeText(req.body?.gift_id,80),gift_name:safeText(req.body?.gift_name,100),diamonds:clamp(req.body?.diamonds,1,100000,1),repeat_count:clamp(req.body?.repeat_count,1,100,1),ring_id:safeText(req.body?.ring_id,80)});
      return res.status(result.success?200:409).json({success:result.success,...result,state:stateFor(req.user.id)});
    });
    app.post("/api/ring-arena/test/impact",...guard,(req,res)=>{
      const result=simulateImpact(req.user.id,safeText(req.body?.viewer_id,160),req.body?.damage);
      return res.status(result.success?200:409).json({success:result.success,...result,state:stateFor(req.user.id)});
    });
    app.get("/api/ring-arena/public/:room",(req,res)=>{
      const state=publicState(req.params.room);return state?res.set("Cache-Control","no-store").json(publicProjection(state)):res.status(404).json({success:false,error:"Sala não encontrada."});
    });
    app.get("/api/ring-arena/collection/:viewer",...guard,(req,res)=>{
      const viewerId=safeText(req.params.viewer,160);return res.json({success:true,collection:ownedFor(req.user.id,viewerId)});
    });
  }
  function shutdown(){for(const game of matches.values())if(game.timer)clearIntervalFn(game.timer);}
  return { registerRoutes, handleInteraction, stateFor, publicState, roomForPublicCode, attachPublic, shutdown,
    _test:{readConfig,saveConfig,createMatch,joinPlayer,tick,finish,reflectBoundary,collide,speedMultiplier,addEnergy,processGift,simulateJoin,simulateEquipRing,simulateGift,simulateImpact,isUnlocked,progressFor,matches,ensureSchema} };
}

module.exports={createRingArenaService,normalizeConfig,speedMultiplier,ensureSchema,DEFAULTS,DEFAULT_RINGS,WORLD};
