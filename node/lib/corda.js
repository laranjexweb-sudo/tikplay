// Configuração e rotas isoladas. CORDA compartilha a permissão de Duelo.
const DEFAULTS = Object.freeze({ best_of: 3, round_time_s: 180, result_delay_s: 6,
  coin_force: 0.5, tap_target: 500, tap_force: 5, pull_speed: 60,
  impulse_threshold: 25, gifts: [], show_team_balloons: true, show_like_bubbles: true,
  score_x:50, score_y:5, score_scale:.82, music_enabled:false,music_volume:.5,sfx_enabled:true,sfx_volume:.7 });
const LAYOUT_KEYS = ['score_x','score_y','score_scale','music_enabled','music_volume','sfx_enabled','sfx_volume'];
function layout(config) {const normalized=normalize(config);return Object.fromEntries(LAYOUT_KEYS.map(key=>[key,normalized[key]]));}
function normalize(raw = {}) {
  const config = { ...DEFAULTS };
  config.best_of = Number(raw.best_of) === 5 ? 5 : 3;
  for (const [key, min, max] of [['round_time_s',30,900],['result_delay_s',3,30],
    ['coin_force',.01,10],['tap_target',10,100000],['tap_force',.1,30],
    ['pull_speed',10,120],['impulse_threshold',1,100],['score_x',0,100],['score_y',0,85],['score_scale',.4,1.1],['music_volume',0,1],['sfx_volume',0,1]]) {
    const value = raw[key] === null || raw[key] === '' ? NaN : Number(raw[key]);
    config[key] = Number.isFinite(value) ? Math.min(max, Math.max(min,value)) : DEFAULTS[key];
  }
  config.tap_target = Math.round(config.tap_target);
  for (const key of ['show_team_balloons','show_like_bubbles']) config[key] = raw[key] !== false;
  config.music_enabled=raw.music_enabled===true;config.sfx_enabled=raw.sfx_enabled!==false;
  config.gifts = (Array.isArray(raw.gifts) ? raw.gifts : []).slice(0,100)
    .filter(g => g && ['flavio','lula'].includes(g.side))
    .map(g => ({ side:g.side, gift_id:String(g.gift_id || '').trim().slice(0,80),
      gift_name:String(g.gift_name || '').trim().slice(0,100), enabled:g.enabled !== false }))
    .filter(g => g.gift_id || g.gift_name);
  const seen = new Map();
  for (const gift of config.gifts.filter(g => g.enabled)) {
    const key = gift.gift_id ? 'id:' + gift.gift_id : 'name:' + gift.gift_name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if (seen.has(key)) throw new Error('Cada presente deve ter apenas um cadastro e uma equipe.');
    seen.set(key, gift.side);
  }
  return config;
}
function initial(config) {
  return { type:'corda_state', active:false, round_active:false, position:0,
    wins:{flavio:0,lula:0}, taps:{flavio:0,lula:0}, force:{flavio:0,lula:0}, team_counts:{flavio:0,lula:0},
    winner:null, match_winner:null, round_id:0, revision:0, time_remaining:0, config:normalize(config) };
}
function register(app, deps) {
  const { db, auth, requireFeature, getTenant, daemonSend, liveOnline, broadcastToClients } = deps;
  const guard = [auth.requireAuth, requireFeature('duelo')];
  app.get('/api/corda/config', ...guard, (req,res) => res.json({success:true,config:normalize(db.getCordaConfig(req.user.id))}));
  app.get('/api/corda/state', ...guard, (req,res) => res.json({success:true,state:getTenant(req.user.id).cordaState || initial(db.getCordaConfig(req.user.id))}));
  app.post('/api/corda/config', ...guard, (req,res) => {
    if (getTenant(req.user.id).cordaState?.active) return res.status(409).json({success:false,error:'Pare o CORDA antes de alterar suas regras.'});
    try {
      const config = normalize({ ...db.getCordaConfig(req.user.id), ...(req.body?.config || {}) });
      db.saveCordaConfig(req.user.id,config);
      const tenant=getTenant(req.user.id);tenant.cordaLayout=layout(config);
      if(tenant.cordaState) tenant.cordaState={...tenant.cordaState,config};
      broadcastToClients?.(tenant.browserClients || [],tenant.cordaState || initial(config));
      res.json({success:true,config});
    } catch (err) { res.status(400).json({success:false,error:err.message}); }
  });
  app.post('/api/corda/layout', ...guard, (req,res) => {
    try {
      const changes=Object.fromEntries(LAYOUT_KEYS.filter(key=>Object.hasOwn(req.body?.layout || {},key)).map(key=>[key,req.body.layout[key]]));
      const config=normalize({...db.getCordaConfig(req.user.id),...changes});
      db.saveCordaConfig(req.user.id,config);
      const tenant=getTenant(req.user.id);tenant.cordaLayout=layout(config);
      if(tenant.cordaState) tenant.cordaState.config={...tenant.cordaState.config,...tenant.cordaLayout};
      broadcastToClients?.(tenant.browserClients || [],{type:'corda_layout',layout:tenant.cordaLayout});
      res.json({success:true,layout:tenant.cordaLayout});
    } catch(err) {res.status(400).json({success:false,error:err.message});}
  });
  for (const action of ['start','stop','new-match','test']) {
    app.post('/api/corda/' + action, ...guard, (req,res) => {
      const tenant = getTenant(req.user.id);
      if (action !== 'stop' && !liveOnline(tenant)) return res.status(409).json({success:false,error:'Conecte a live antes de iniciar ou testar o CORDA.'});
      if (action === 'test' && (!tenant.cordaState?.active || !tenant.cordaState?.round_active)) return res.status(409).json({success:false,error:'Inicie uma rodada antes do teste.'});
      const config = normalize(db.getCordaConfig(req.user.id));
      if (['start','new-match'].includes(action) &&
          !['flavio','lula'].every(side => config.gifts.some(g => g.enabled && g.side === side))) {
        return res.status(400).json({success:false,error:'Cadastre um presente para cada equipe.'});
      }
      const side = req.body?.side;
      if (action === 'test' && !['flavio','lula'].includes(side)) return res.status(400).json({success:false,error:'Equipe inválida.'});
      const rawForce = Number(req.body?.force);
      const force = Number.isFinite(rawForce) ? Math.max(1,Math.min(100,rawForce)) : 25;
      const ok = daemonSend({cmd:'corda_' + action.replace('-','_'),tenant_id:req.user.id,config,side,force});
      if (!ok) return res.status(503).json({success:false,error:'Serviço Python indisponível.'});
      res.json({success:true});
    });
  }
}
module.exports = { DEFAULTS, normalize, initial, register, layout };
