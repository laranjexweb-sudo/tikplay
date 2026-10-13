// Servidor REAL com daemon de fixture: DB temporário, sem live e sem APIs externas.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'tikplay-corda-preview-'));
process.env.DB_PATH = path.join(tmp,'test.db');
process.env.PORT = process.env.CORDA_TEST_PORT || '3112';
process.env.JWT_SECRET = 'corda-local-test-secret';
const db = require('../db'), auth = require('../auth');
// O painel legado espera esta coluna, presente nos bancos existentes, mas ausente
// no bootstrap de banco vazio. Completar somente a fixture, sem mudar produção.
const fixtureDB = new (require('better-sqlite3'))(process.env.DB_PATH);
if (!fixtureDB.prepare('PRAGMA table_info(tenant_gift_config)').all().some(c=>c.name==='tres_gifts')) {
  fixtureDB.exec("ALTER TABLE tenant_gift_config ADD COLUMN tres_gifts TEXT DEFAULT '{}'");
}
fixtureDB.close();
const id = db.createUser({email:'corda-test@localhost.invalid',name:'Teste CORDA',password_hash:auth.hashPassword('local-test-only'),role:'admin'});
db.getGifts = () => [{id:'test-blue',name:'Blue fixture',name_pt:'Presente azul de teste',diamond_count:1},
  {id:'test-red',name:'Red fixture',name_pt:'Presente vermelho de teste',diamond_count:10}];
db.saveCordaConfig(id,{gifts:[{side:'flavio',gift_id:'test-blue',gift_name:'Blue fixture'},
  {side:'lula',gift_id:'test-red',gift_name:'Red fixture'}]});
class PreviewDaemon {
  constructor(options) {this.options=options;}
  start() {
    this.proc=spawn(this.options.pythonBin,['-u',path.join(__dirname,'../../python/tests/corda_preview_daemon.py')],{env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let buffer='';this.proc.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(line.trim())this.options.onMessage(JSON.parse(line));});
    this.proc.stderr.on('data',chunk=>process.stderr.write(chunk));
  }
  send(cmd) { if(!this.proc?.stdin.writable)return false;this.proc.stdin.write(JSON.stringify(cmd)+'\n');return true; }
  kill() {this.proc?.kill();}
}
const daemonPath=require.resolve('../lib/daemon');require.cache[daemonPath]={id:daemonPath,filename:daemonPath,loaded:true,exports:PreviewDaemon};
require('../server');
const {getTenant}=require('../lib/ws');
const tenant=getTenant(id);tenant.sessionStarted=true;tenant.currentStatus={state:'connected'};
fs.writeFileSync(path.join(tmp,'auth.json'),JSON.stringify({id,token:auth.signToken({id,role:'admin'})}));
console.log('CORDA_TEST_DIR='+tmp);
