const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'tikplay-corda-'));
process.env.DB_PATH = path.join(tmp,'test.db');
const express = require('express');
const auth = require('../auth');
const db = require('../db');
const corda = require('../lib/corda');
const tenants = new Map();
const getTenant = id => { if(!tenants.has(id)) tenants.set(id,{});return tenants.get(id); };
const calls = [];
let available = true;
const app = express();app.use(express.json());
corda.register(app,{db,auth,getTenant,liveOnline:t=>!!t.online,
  requireFeature:name=>(req,res,next)=>{assert.equal(name,'duelo');if(req.user.id===3)return res.status(403).json({success:false});next();},
  daemonSend:cmd=>{calls.push(cmd);return available;}});
async function run() {
  assert.equal(corda.normalize({coin_force:'bad'}).coin_force,.5);
  assert.equal(corda.normalize({coin_force:Infinity}).coin_force,.5);
  assert.equal(corda.normalize({round_time_s:1}).round_time_s,30);
  assert.throws(()=>corda.normalize({gifts:[{side:'flavio',gift_id:'1'},{side:'lula',gift_id:'1'}]}));
  for(const page of ['corda.html','control-panel.html']) {
    const html=fs.readFileSync(path.join(__dirname,'../public',page),'utf8');
    for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1],{filename:page});
  }
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(route,body,id=1)=>{const r=await fetch(base+'/api/corda/'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(id?{Authorization:'Bearer '+auth.signToken({id,role:'user'})}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  try {
    assert.equal((await request('config',undefined,0)).status,401);
    assert.equal((await request('config',undefined,3)).status,403);
    const config={coin_force:.75,gifts:[{side:'flavio',gift_id:'blue',gift_name:'Azul teste'},{side:'lula',gift_id:'red',gift_name:'Vermelho teste'}]};
    assert.equal((await request('config',{config})).status,200);
    assert.equal(db.getCordaConfig(1).coin_force,.75);
    assert.equal((await request('config',undefined,2)).data.config.gifts.length,0);
    assert.equal((await request('config',{config:{round_time_s:120}})).data.config.coin_force,.75);
    assert.equal((await request('start',{})).status,409);
    getTenant(1).online=true;
    assert.equal((await request('start',{})).status,200);
    assert.equal(calls.at(-1).cmd,'corda_start');assert.equal(calls.at(-1).tenant_id,1);
    getTenant(1).cordaState={...corda.initial(db.getCordaConfig(1)),active:true,round_active:true,position:-20};
    assert.equal((await request('state')).data.state.position,-20);
    assert.equal((await request('config',{config:{coin_force:1}})).status,409);
    const commandsBeforeLayout=calls.length;
    const moved=await request('layout',{layout:{score_x:35,score_y:12,score_scale:.6,coin_force:999}});
    assert.equal(moved.status,200);assert.equal(moved.data.layout.score_scale,.6);
    assert.equal(db.getCordaConfig(1).score_y,12);assert.equal(db.getCordaConfig(1).coin_force,.75);
    assert.equal(getTenant(1).cordaState.position,-20);assert.equal(calls.length,commandsBeforeLayout);
    assert.equal((await request('layout',{layout:{score_scale:100}})).data.layout.score_scale,1.1);
    assert.equal((await request('test',{side:'wrong'})).status,400);
    assert.equal((await request('test',{side:'flavio',force:25})).status,200);
    assert.equal(calls.at(-1).force,25);
    getTenant(1).cordaState.round_active=false;
    assert.equal((await request('test',{side:'flavio'})).status,409);
    available=false;assert.equal((await request('stop',{})).status,503);
    available=true;assert.equal((await request('stop',{})).status,200);
    getTenant(2).online=true;assert.equal((await request('start',{},2)).status,400);
    console.log('CORDA: API, autenticação, isolamento, persistência, validação e scripts inline OK. Banco temporário: '+tmp);
  } finally {server.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
