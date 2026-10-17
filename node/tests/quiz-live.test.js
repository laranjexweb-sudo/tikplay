const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const express = require("express");
const auth = require("../auth");
const { createQuizService } = require("../lib/quiz-live");
const math = require("../lib/quiz-math");

function setup({ requestNarration } = {}) {
  const database = new Database(":memory:");
  database.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, room_code TEXT UNIQUE, status TEXT DEFAULT 'active')");
  database.prepare("INSERT INTO users(id,room_code,status) VALUES(1,'room-one','active'),(2,'room-two','active')").run();
  let currentTime = Date.UTC(2026, 9, 17, 12);
  let nextTimerId = 1;
  const timers = new Map();
  const tenant = { id: 1, currentStatus: { state: "connected" }, currentRoomId: "live-one", logClients: [] };
  const logs = [];
  const service = createQuizService({
    database,
    getTenant: id => id === 1 ? tenant : { id, currentStatus: { state: "connected" }, logClients: [] },
    getUserByRoomCode: roomCode => database.prepare("SELECT * FROM users WHERE room_code=?").get(roomCode),
    requestNarration,
    broadcastToClients: () => {},
    broadcastLog: (_tenant, event) => logs.push(event),
    now: () => currentTime,
    setTimer: (callback, delay) => { const id = nextTimerId++; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  return { database, service, logs, tenant, timers, setTime: value => { currentTime = value; }, close: () => database.close() };
}

test("gera deterministicamente questões para todos os conteúdos matemáticos", () => {
  for (const [content] of math.CONTENTS) {
    for (const difficulty of ["facil", "medio", "dificil"]) {
      const options = { seed: `${content}-${difficulty}`, difficulty, contents: [content], mode: "alternativas" };
      const first = math.generateQuestion(options);
      assert.deepEqual(math.generateQuestion(options), first);
      assert.equal(first.theme, "matematica");
      assert.deepEqual(Object.keys(first.options).sort(), ["A", "B", "C", "D"]);
      assert.equal(new Set(Object.values(first.options)).size, 4);
      assert.ok(["A", "B", "C", "D"].includes(first.answer));
      assert.ok(Number.isFinite(Number(first.answer_value.replace(",", "."))));
    }
  }
});

test("isola configurações por streamer e rejeita cálculo fora do tema matemática", () => {
  const ctx = setup();
  try {
    const saved = ctx.service._test.saveConfig(1, { themes: ["historia"], difficulty: "facil", question_count: 1 });
    assert.deepEqual(saved.themes, ["historia"]);
    assert.deepEqual(ctx.service._test.configFor(2).themes, []);
    const invalid = ctx.service._test.saveConfig(1, { themes: ["historia"], response_mode: "calculo" });
    assert.throws(() => ctx.service._test.pickQuestions(1, "room-one", invalid), { code: "CALCULATION_MATH_ONLY" });
  } finally { ctx.close(); }
});

test("não expõe o gabarito público; aceita uma resposta por pessoa e contabiliza pontos uma vez", () => {
  const ctx = setup();
  try {
    ctx.service._test.saveConfig(1, { themes: ["historia"], difficulty: "misto", response_mode: "alternativas", question_count: 1, question_time: 20, narrate: false });
    const state = ctx.service._test.startMatch(1, "room-one", "live-one", "trace-start");
    assert.equal(state.state, "question_active");
    const selectedQuestion = ctx.database.prepare("SELECT question_id FROM quiz_rounds WHERE match_id=?").get(state.match_id);
    assert.ok(selectedQuestion.question_id);
    assert.equal(ctx.service._test.questionUsage(1, selectedQuestion.question_id).total, 1);
    assert.equal(ctx.service._test.questionUsage(2, selectedQuestion.question_id).total, 0);
    const listed = ctx.service._test.listQuestions(1, { theme: "historia" });
    assert.equal(listed.items.find(item => item.id === selectedQuestion.question_id).usage_count, 1);
    const publicState = ctx.service.publicState("room-one");
    assert.equal(publicState.question.correct_answer, undefined);
    assert.equal(publicState.question.answer, undefined);

    const answer = state.question.correct_answer;
    const interaction = { type: "comment", room_id: "live-one", user_id: "tiktok-1", username: "viewer", nickname: "Viewer", event_id: "evt-1", meta: { text: answer.toLowerCase() } };
    assert.equal(ctx.service.handleInteraction(ctx.tenant, { ...interaction, room_id: "another-live", event_id: "evt-wrong-room" }), false);
    assert.equal(ctx.service.handleInteraction(ctx.tenant, interaction), true);
    assert.equal(ctx.service.handleInteraction(ctx.tenant, interaction), false);
    assert.equal(ctx.service.handleInteraction(ctx.tenant, { ...interaction, event_id: "evt-2" }), false);

    assert.equal(ctx.service._test.reveal(1, "trace-reveal"), true);
    const revealed = ctx.service.publicState("room-one");
    assert.equal(revealed.question.revealed, true);
    assert.equal(revealed.question.answer, answer);
    const response = ctx.database.prepare("SELECT * FROM quiz_responses WHERE match_id=?").get(state.match_id);
    assert.equal(response.is_correct, 1);
    assert.equal(response.speed_bonus, 30);

    assert.equal(ctx.service._test.requestNext(1), true);
    assert.equal(ctx.service.stateFor(1).state, "finished");
    assert.equal(ctx.service.stateFor(1).all_ranking[0].score, 130);
    assert.equal(ctx.service._test.historyDetail(2, state.match_id), null);
    assert.equal(ctx.service.stateFor(2).all_ranking.length, 0);
    assert.equal(ctx.service.stateFor(1).weekly_ranking[0].score, 130);
    assert.ok(ctx.logs.some(log => log.event === "quiz.match.started" && log.trace_id === "trace-start"));
  } finally { ctx.close(); }
});

test("a janela de respostas respeita o relógio e uma sala só consulta sua própria conta", () => {
  const ctx = setup();
  try {
    ctx.service._test.saveConfig(1, { themes: ["historia"], question_count: 1, question_time: 10 });
    const state = ctx.service._test.startMatch(1, "room-one", "live-one");
    assert.equal(ctx.service.publicState("room-two").match_id, null);
    ctx.setTime(state.question.deadline + 1);
    assert.equal(ctx.service.handleInteraction(ctx.tenant, { type: "comment", room_id: "live-one", user_id: "late", event_id: "late-1", meta: { text: state.question.correct_answer } }), false);
    assert.equal(ctx.service.stateFor(1).state, "finished");
    assert.equal(ctx.service.publicState("room-one").question.revealed, true);
  } finally { ctx.close(); }
});

test("restaura o prazo de uma pergunta ativa depois que o serviço é recriado", () => {
  const ctx = setup();
  try {
    ctx.service._test.saveConfig(1, { themes: ["historia"], question_count: 1, question_time: 20 });
    const state = ctx.service._test.startMatch(1, "room-one", "live-one");
    const recoveredTimers=[];
    const recovered=createQuizService({
      database:ctx.database,
      getTenant:id=>id===1?ctx.tenant:null,
      getUserByRoomCode:roomCode=>ctx.database.prepare("SELECT * FROM users WHERE room_code=?").get(roomCode),
      broadcastToClients:()=>{}, now:()=>state.question.opened_at,
      setTimer:(callback,delay)=>{recoveredTimers.push({callback,delay});return recoveredTimers.length;},clearTimer:()=>{},
    });
    recovered.recoverTimers();
    assert.ok(recoveredTimers.some(timer=>timer.delay===state.question.deadline-state.question.opened_at));
  } finally { ctx.close(); }
});

test("a narração reutiliza o TTS padrão e só abre o cronômetro após a fonte confirmar o áudio", () => {
  let request;
  const ctx = setup({ requestNarration: data => { request = data; return true; } });
  try {
    ctx.service._test.saveConfig(1, { themes: ["historia"], question_count: 1, question_time: 10, narrate: true });
    const state = ctx.service._test.startMatch(1, "room-one", "live-one");
    assert.equal(state.state, "preparing");
    assert.equal(request.matchId, state.match_id);
    assert.match(request.text, /A\./);
    assert.equal(ctx.service.publicState("room-one").question.narration_url, undefined);
    assert.equal(ctx.service.narrationReady(1, state.match_id, 1, "/tts-audio/1/quiz-test.mp3", "trace-tts", 321), true);
    assert.equal(ctx.service.publicState("room-one").question.narration_url, "/tts-audio/1/quiz-test.mp3");
    assert.equal(ctx.service.narrationFinished("room-two", state.match_id, 1), false);
    assert.equal(ctx.service.narrationFinished("room-one", state.match_id, 1), true);
    assert.equal(ctx.service.stateFor(1).state, "question_active");
    assert.ok(ctx.logs.some(log => log.event === "quiz.narration.completed" && log.trace_id === "trace-tts"));
  } finally { ctx.close(); }
});

test("o avanço e encerramento registram o ranking semanal de forma idempotente", () => {
  const ctx = setup();
  try {
    ctx.service._test.saveConfig(1, { themes: ["historia"], question_count: 1, question_time: 20 });
    const state = ctx.service._test.startMatch(1, "room-one", "live-one");
    ctx.service.handleInteraction(ctx.tenant, { type: "comment", room_id: "live-one", user_id: "tiktok-2", username: "viewer2", event_id: "evt-correct", meta: { text: state.question.correct_answer } });
    ctx.service._test.reveal(1);
    ctx.service._test.requestNext(1);
    assert.equal(ctx.service.stateFor(1).weekly_ranking[0].score, 130);
    const match = ctx.database.prepare("SELECT * FROM quiz_matches WHERE id=?").get(state.match_id);
    ctx.service._test.finalizeWeekly(match);
    assert.equal(ctx.service.stateFor(1).weekly_ranking[0].score, 130);
  } finally { ctx.close(); }
});

test("separa catálogo global e perguntas particulares, com filtros de origem e isolamento por dono", () => {
  const ctx=setup();
  try {
    ctx.service._test.saveConfig(1,{themes:["historia"],difficulty:"facil",question_count:1,question_source:"streamer"});
    assert.throws(()=>ctx.service._test.pickQuestions(1,"room-one",ctx.service._test.configFor(1)),{code:"INSUFFICIENT_QUESTIONS"});
    const privateId=ctx.service._test.saveQuestion(1,{theme:"historia",difficulty:"facil",prompt:"Pergunta privada exclusiva?",options:{A:"Uma",B:"Duas",C:"Três",D:"Quatro"},answer:"A"});
    const global=ctx.service._test.listGlobalQuestions({page:1,page_size:100});
    assert.ok(global.items.length>0);
    assert.ok(global.items.every(row=>row.scope==="global"&&row.tenant_id===null));
    assert.ok(!ctx.service._test.listQuestions(2).items.some(row=>row.id===privateId));
    assert.ok(ctx.service._test.listQuestions(1,{search:"Pergunta privada exclusiva"}).items.some(row=>row.id===privateId&&row.editable));
    ctx.service._test.saveConfig(1,{themes:["historia"],difficulty:"facil",question_count:1,question_source:"streamer"});
    const selected=ctx.service._test.pickQuestions(1,"room-one",ctx.service._test.configFor(1));
    assert.equal(selected.length,1);
    assert.equal(selected[0].prompt,"Pergunta privada exclusiva?");
    ctx.service._test.saveConfig(1,{themes:["historia"],difficulty:"facil",question_count:1,question_source:"global"});
    const selectedGlobal=ctx.service._test.pickQuestions(1,"room-one",ctx.service._test.configFor(1));
    assert.equal(selectedGlobal.length,1);
    assert.notEqual(selectedGlobal[0].prompt,"Pergunta privada exclusiva?");
    const privateMathId=ctx.service._test.saveQuestion(1,{theme:"matematica",difficulty:"facil",prompt:"Quanto é cinco mais três?",options:{A:"7",B:"8",C:"9",D:"10"},answer:"B"});
    ctx.service._test.saveConfig(1,{themes:["matematica"],difficulty:"facil",question_count:1,question_source:"streamer"});
    assert.equal(ctx.service._test.pickQuestions(1,"room-one",ctx.service._test.configFor(1))[0].question_id,privateMathId);
    ctx.service._test.saveConfig(1,{themes:["historia"],difficulty:"facil",question_count:1,question_source:"streamer",narrate:false});
    const match=ctx.service._test.startMatch(1,"room-one","live-one");
    const round=ctx.database.prepare("SELECT prompt FROM quiz_rounds WHERE match_id=? AND question_no=1").get(match.match_id);
    ctx.service._test.saveQuestion(1,{theme:"historia",difficulty:"facil",prompt:"Pergunta privada editada depois?",options:{A:"Uma",B:"Duas",C:"Três",D:"Quatro"},answer:"A"},privateId);
    assert.equal(ctx.database.prepare("SELECT prompt FROM quiz_rounds WHERE match_id=? AND question_no=1").get(match.match_id).prompt,round.prompt);
  } finally {ctx.close();}
});

test("importação tem prévia, valida campos, detecta duplicadas e nunca altera perguntas existentes",()=>{
  const ctx=setup();
  try {
    const line="historia|facil|Quem proclamou a Independência do Brasil?|Dom Pedro I|Dom Pedro II|Tiradentes|Getúlio Vargas|A|A declaração ocorreu em 1822.";
    const preview=ctx.service._test.importQuestions(1,`${line}\n${line}\nhistoria|facil|linha incompleta`);
    assert.equal(preview.valid_count,1);
    assert.equal(preview.duplicate_count,1);
    assert.equal(preview.invalid_count,1);
    const committed=ctx.service._test.importQuestions(1,`${line}\n${line}`,[1]);
    assert.equal(committed.created,1);
    assert.equal(committed.duplicate_count,1);
    const after=ctx.service._test.parseImportQuestions(line,1);
    assert.equal(after[0].status,"duplicate");
    assert.equal(ctx.service._test.listQuestions(1,{search:"Quem proclamou"}).total,1);
  } finally {ctx.close();}
});

test("temas mantêm IDs e bloqueiam duplicatas sem considerar acentos, caixa e espaços",()=>{
  const ctx=setup();
  try {
    const id=ctx.service._test.saveTheme({label:"  Cultura   Pop  "});
    assert.equal(id,"cultura-pop");
    assert.throws(()=>ctx.service._test.saveTheme({label:"cultura pop"}),/equivalente/);
    ctx.service._test.saveTheme({label:"Cultura Popular",status:"active"},id);
    assert.equal(ctx.service._test.listThemes().find(theme=>theme.id===id).label,"Cultura Popular");
  } finally {ctx.close();}
});

test("rotas de catálogo global exigem Super Admin e streamers recebem apenas gabarito oculto",async()=>{
  const ctx=setup(),app=express();app.use(express.json());
  ctx.service.registerRoutes(app,{auth,requireFeature:()=>((_req,_res,next)=>next())});
  const server=app.listen(0),base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,token,options={})=>fetch(`${base}${path}`,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${token}`,...(options.body?{"Content-Type":"application/json"}:{})}});
  try {
    const streamer=auth.signToken({id:1,role:"user"}),admin=auth.signToken({id:99,role:"admin"});
    assert.equal((await request("/api/admin/quiz-live/questions",streamer)).status,403);
    const foreignId=ctx.service._test.saveQuestion(2,{theme:"historia",difficulty:"medio",prompt:"Pergunta privada da outra conta?",options:{A:"Uma",B:"Duas",C:"Três",D:"Quatro"},answer:"A"});
    const foreignRead=await (await request("/api/quiz-live/questions?search=Pergunta%20privada%20da%20outra",streamer)).json();
    assert.ok(!foreignRead.items.some(row=>row.id===foreignId));
    assert.equal((await request(`/api/quiz-live/questions/${foreignId}`,streamer,{method:"DELETE"})).status,404);
    const created=await request("/api/admin/quiz-live/questions",admin,{method:"POST",body:JSON.stringify({theme:"historia",difficulty:"medio",prompt:"Qual cidade foi capital do Brasil?",options:{A:"Rio de Janeiro",B:"Brasília",C:"Salvador",D:"Recife"},answer:"A",explanation:"Antes da mudança, o Rio foi capital."})});
    assert.equal(created.status,201);
    const {id}=await created.json();
    const publicList=await (await request("/api/quiz-live/questions?search=Qual%20cidade",streamer)).json();
    const publicQuestion=publicList.items.find(row=>row.id===id);
    assert.ok(publicQuestion);
    assert.equal(publicQuestion.answer,undefined);
    assert.equal(publicQuestion.editable,false);
    const deniedEdit=await request(`/api/quiz-live/questions/${id}`,streamer,{method:"PUT",body:JSON.stringify({})});
    assert.equal(deniedEdit.status,400);
    const adminList=await (await request("/api/admin/quiz-live/questions?search=Qual%20cidade",admin)).json();
    assert.equal(adminList.items.find(row=>row.id===id).answer,"A");
    const importLine="ciencias|facil|Qual é o planeta mais próximo do Sol?|Vênus|Mercúrio|Terra|Marte|B|Mercúrio é o planeta mais próximo do Sol.";
    const preview=await (await request("/api/admin/quiz-live/questions/import/preview",admin,{method:"POST",body:JSON.stringify({text:importLine})})).json();
    assert.equal(preview.valid_count,1);
    const imported=await (await request("/api/admin/quiz-live/questions/import",admin,{method:"POST",body:JSON.stringify({text:importLine,accept_lines:[1]})})).json();
    assert.equal(imported.created,1);
    assert.ok(ctx.service._test.listGlobalQuestions({search:"planeta mais próximo do Sol"}).items.length>0);
  } finally {await new Promise(resolve=>server.close(resolve));ctx.close();}
});
