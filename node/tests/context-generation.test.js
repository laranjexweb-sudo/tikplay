const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { createContextGenerator } = require('../lib/context-generation');

function child() {
  const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); return proc;
}

test('persistent accounting includes failed billed responses and unknown interrupted costs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'tikplay-context-'));
  const db = new Database(path.join(dir,'test.db'));
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-only-key';
  const proc = child(), events = [];
  let spawnArgs;
  try {
    const generator = createContextGenerator({db,pythonBin:'python',
      spawnProcess:(...args)=>{spawnArgs=args;return proc;},log:(id,e)=>events.push(e)});
    const start = generator.start(1,{limit:2,interval_min:0,regenerate:false});
    assert.equal(start.started,true);
    assert.ok(fs.existsSync(spawnArgs[1][1]), 'worker path exists');
    assert.equal(spawnArgs[2].windowsHide,true);
    assert.equal(generator.start(1,{}).started,false);
    db.prepare('INSERT INTO context_generation_attempts(id,run_id,target,model,status,created_at,cost_usd,prompt_tokens,completion_tokens) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('a',start.run_id,'teste','model','failed','now',.004,100,20);
    db.prepare('INSERT INTO context_generation_attempts(id,run_id,target,model,status,created_at) VALUES(?,?,?,?,?,?)')
      .run('b',start.run_id,'outro','model','pending','now');
    const json = JSON.stringify({run_id:start.run_id,event:'attempt.failed',code:'INVALID_RESPONSE'})+'\n';
    proc.stdout.emit('data',Buffer.from(json.slice(0,17)));
    proc.stdout.emit('data',Buffer.from(json.slice(17)));
    assert.equal(events.filter(e=>e.event==='contexts.attempt.failed').length,1);
    assert.equal(generator.status().consumption.known_cost_usd,.004);
    assert.equal(generator.status().consumption.unknown_cost_requests,1);
    generator.stop();
    assert.equal(generator.status().status,'stopping');
    proc.emit('close',1);
    assert.equal(generator.status().status,'stopped');
    assert.equal(generator.status().running,false);
    const reopened = createContextGenerator({db,pythonBin:'python'});
    assert.equal(reopened.status().totals.known_cost_usd,.004);
    assert.equal(reopened.status().attempts.find(a=>a.id==='b').status,'interrupted');
    assert.ok(!JSON.stringify(events).includes('test-only-key'));
    assert.ok(!JSON.stringify(events).includes('outro'));
  } finally {
    if(oldKey===undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY=oldKey;
    db.close(); fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('admin endpoints reject ordinary users and malformed generation requests', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'tikplay-context-routes-'));
  const db = new Database(path.join(dir,'test.db'));
  const express = require('express');
  const app = express(); app.use(express.json());
  const auth = require('../auth');
  const adminToken = auth.signToken({id:1,role:'admin'});
  const userToken = auth.signToken({id:2,role:'user'});
  let spawned = 0;
  require('../routes/auth')(app,{db:{db},auth,getTenant:()=>({}),PYTHON_BIN:'python',
    contextLog:()=>{},contextSpawn:()=>{spawned++;return child();}});
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const route of ['/api/admin/generate-contexts/status','/api/admin/generate-contexts','/api/admin/generate-contexts/stop']) {
      const method=route.endsWith('status')?'GET':'POST';
      assert.equal((await fetch(base+route,{method})).status,401);
      assert.equal((await fetch(base+route,{method,headers:{Authorization:`Bearer ${userToken}`}})).status,403);
    }
    const response=await fetch(base+'/api/admin/generate-contexts',{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${adminToken}`},body:JSON.stringify({limit:-1,interval_min:0})});
    assert.equal(response.status,400); assert.equal(spawned,0);
    const status=await (await fetch(base+'/api/admin/generate-contexts/status',{headers:{Authorization:`Bearer ${adminToken}`}})).json();
    assert.equal(status.totals.requests,0);
  } finally { await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(dir,{recursive:true,force:true}); }
});

test('real updated Python worker reports progress, durable costs and operational events without paid network', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'tikplay-context-worker-'));
  const dbFile = path.join(dir,'test.db');
  const db = new Database(dbFile);
  db.exec('CREATE TABLE contextos(alvo TEXT PRIMARY KEY,gerado_em TEXT,ranking TEXT)');
  const oldKey=process.env.OPENROUTER_API_KEY;
  const oldDb=process.env.DB_PATH;
  process.env.DB_PATH=dbFile;
  const logsDb=require('../db');
  const actorId=logsDb.createUser({email:'context-admin@test.local',name:'Admin',password_hash:'fixture',role:'admin'});
  process.env.OPENROUTER_API_KEY='fixture-no-network';
  // The real worker and manager run; only NLP and external API are fixtures.
  const fixture=`
import sys,types,runpy,json
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1]).parent))
import context_generation as cg
original=cg.attempt
def response(target,words,*_):
    return {'usage':{'cost':0.003,'prompt_tokens':120,'completion_tokens':80},'choices':[{'message':{'content':json.dumps({'words':words[:80]})}}]}
cg.attempt=lambda *args: original(*args,request=response)
doc=types.SimpleNamespace(has_vector=True,similarity=lambda _:0.5)
sys.modules['similarity']=types.SimpleNamespace(nlp=types.SimpleNamespace(pipe=lambda words:(doc for _ in words)))
runpy.run_path(sys.argv[1],run_name='__main__')
`;
  const pyDefault='C:\\Users\\djlar\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
  const python=process.env.PYTHON_BIN || (fs.existsSync(pyDefault)?pyDefault:'python');
  const events=[];
  let proc;
  try {
    const generator=createContextGenerator({db,pythonBin:python,log:(id,entry)=>{
      events.push(entry);
      logsDb.appendLogEntry(id,null,{...entry,ts:Date.now(),details:JSON.stringify(entry.details)});
    },
      spawnProcess:(bin,args,options)=>{proc=spawn(bin,['-u','-c',fixture,args[1]],options);return proc;}});
    generator.start(actorId,{limit:1,interval_min:0,regenerate:false});
    await new Promise((resolve,reject)=>{proc.on('close',resolve);proc.on('error',reject);});
    const result=generator.status();
    assert.equal(result.status,'completed');assert.equal(result.done,1);
    assert.equal(result.consumption.known_cost_usd,.003);
    assert.equal(result.consumption.succeeded,1);
    assert.equal(result.consumption.unknown_cost_requests,0);
    assert.ok(events.some(e=>e.event==='contexts.attempt.completed'&&e.details.attempt_id));
    assert.ok(events.some(e=>e.event==='contexts.run.completed'));
    const storedLogs=logsDb.getLogEntries({tenantId:actorId,limit:100});
    assert.ok(storedLogs.some(e=>e.event==='contexts.run.completed'));
    assert.ok(storedLogs.every(e=>e.category==='diagnostic'&&e.level==='info'));
    const ranked=JSON.parse(db.prepare('SELECT ranking FROM contextos').get().ranking);
    assert.ok(ranked.length>50);assert.equal(new Set(ranked.map(x=>x.palavra)).size,ranked.length);
    const reopened=createContextGenerator({db,pythonBin:python});
    assert.equal(reopened.status().totals.known_cost_usd,.003);
  } finally {
    if(oldKey===undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY=oldKey;
    if(oldDb===undefined) delete process.env.DB_PATH; else process.env.DB_PATH=oldDb;
    logsDb.db.close();
    db.close();fs.rmSync(dir,{recursive:true,force:true});
  }
});
