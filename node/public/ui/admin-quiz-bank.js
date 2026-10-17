(() => {
  const host = document.getElementById('adminQuizBankApp');
  if (!host) return;
  const token = () => localStorage.getItem('token') || localStorage.getItem('auth_token') || localStorage.getItem('jwt') || '';
  const state = { page: 1, pages: 1, rows: [], themes: [], preview: null, loading: false };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => Number(value || 0).toLocaleString('pt-BR');
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token()}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    const data = await response.json().catch(() => ({ success: false, error: 'Resposta inválida do servidor.' }));
    if (response.status === 401) { localStorage.removeItem('token'); location.href = '/login'; throw new Error('Sessão expirada.'); }
    if (!response.ok || data.success === false) throw new Error(data.error || `Falha HTTP ${response.status}`);
    return data;
  }
  host.innerHTML = `<header class="tp-admin-section-heading"><div><span class="tp-quiz-admin-eyebrow">QUIZ LIVE · CATÁLOGO OFICIAL</span><h2 id="adminQuizBankTitle">Banco global de perguntas</h2><p>Gerencie perguntas e temas oficiais disponíveis para todos os streamers.</p></div><button class="btn btn-nb btn-dark" type="button" data-refresh>Atualizar</button></header>
    <div class="tp-quiz-admin-notice" data-notice role="status" aria-live="polite"></div>
    <div class="tp-quiz-admin-stats" data-stats></div>
    <div class="tp-quiz-admin-layout"><section class="tp-quiz-admin-panel"><header><div><h3>Catálogo global</h3><p>Somente perguntas ativas entram no sorteio.</p></div><button class="btn btn-nb btn-success" type="button" data-new>+ Nova pergunta</button></header>
      <form class="tp-quiz-admin-editor" data-editor hidden><input type="hidden" name="id"><div class="tp-quiz-admin-fields"><label>Tema<select name="theme" required></select></label><label>Dificuldade<select name="difficulty"><option value="facil">Fácil</option><option value="medio">Média</option><option value="dificil">Difícil</option></select></label><label>Status<select name="status"><option value="active">Ativa</option><option value="inactive">Desativada</option></select></label><label class="wide">Pergunta<textarea name="prompt" minlength="8" maxlength="500" required></textarea></label><label>Alternativa A<input name="A" maxlength="180" required></label><label>Alternativa B<input name="B" maxlength="180" required></label><label>Alternativa C<input name="C" maxlength="180" required></label><label>Alternativa D<input name="D" maxlength="180" required></label><label>Resposta correta<select name="answer"><option>A</option><option>B</option><option>C</option><option>D</option></select></label><label>Tempo recomendado<input name="recommended_time" type="number" min="10" max="60" value="20"></label><label class="wide">Explicação<textarea name="explanation" maxlength="500" rows="2"></textarea></label></div><div class="tp-quiz-admin-actions"><button class="btn btn-nb btn-success">Salvar pergunta</button><button class="btn btn-nb btn-dark" type="button" data-cancel>Cancelar</button></div></form>
      <div class="tp-quiz-admin-filters"><label>Buscar<input data-filter="search" type="search" placeholder="Enunciado"></label><label>Tema<select data-filter="theme"></select></label><label>Dificuldade<select data-filter="difficulty"><option value="">Todas</option><option value="facil">Fácil</option><option value="medio">Média</option><option value="dificil">Difícil</option></select></label><label>Tipo<select data-filter="mode"><option value="">Todos</option><option value="alternativas">Alternativas A–D</option><option value="calculo">Cálculo</option></select></label><label>Status<select data-filter="status"><option value="">Todos</option><option value="active">Ativas</option><option value="inactive">Desativadas</option></select></label></div>
      <div class="table-responsive"><table class="table align-middle tp-admin-table"><thead><tr><th>Pergunta</th><th>Tema</th><th>Dificuldade</th><th>Tipo</th><th>Usos</th><th>Status</th><th>Ações</th></tr></thead><tbody data-rows><tr><td colspan="7">Carregando catálogo…</td></tr></tbody></table></div>
      <div class="tp-quiz-admin-pagination"><button class="btn btn-nb btn-dark" data-prev>Anterior</button><span data-page>Página —</span><button class="btn btn-nb btn-dark" data-next>Próxima</button></div>
    </section>
    <aside class="tp-quiz-admin-side"><section class="tp-quiz-admin-panel"><header><div><h3>Temas globais</h3><p>Nomes são comparados sem acentos, caixa ou espaços repetidos.</p></div></header><form class="tp-quiz-admin-theme-form" data-theme-form><label>Novo tema<input name="label" minlength="3" maxlength="80" required placeholder="Ex.: Literatura"></label><button class="btn btn-nb btn-success">Adicionar tema</button></form><div class="tp-quiz-admin-theme-list" data-themes></div></section>
    <section class="tp-quiz-admin-panel"><header><div><h3>Importação em lote</h3><p>Uma pergunta por linha. A importação só grava após conferir a prévia.</p></div></header><p class="tp-quiz-admin-format"><code>tema|dificuldade|pergunta|A|B|C|D|resposta|explicação</code></p><textarea data-import rows="5" placeholder="historia|facil|Pergunta?|Opção A|Opção B|Opção C|Opção D|A|Explicação"></textarea><button class="btn btn-nb btn-dark" type="button" data-preview>Validar e mostrar prévia</button><div data-preview-host></div></section></aside></div>`;

  const $ = selector => host.querySelector(selector), notice = (text, error = false) => { const node=$('[data-notice]');node.textContent=text||'';node.classList.toggle('is-error',error); };
  function themeOptions(selected = '') { return state.themes.filter(item => item.status === 'active' || item.id === selected).map(item => `<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${esc(item.label)}${item.status==='inactive'?' (inativo)':''}</option>`).join(''); }
  function renderStats(stats = {}) {
    $('[data-stats]').innerHTML = `<article><small>Total de perguntas</small><strong>${fmt(stats.total)}</strong></article><article><small>Ativas</small><strong>${fmt(stats.active)}</strong></article><article class="wide"><small>Por tema</small><span>${(stats.themes||[]).map(item=>`${esc(item.label)} <b>${fmt(item.count)}</b>`).join(' · ')||'—'}</span></article><article class="wide"><small>Por dificuldade</small><span>${(stats.difficulties||[]).map(item=>`${esc(({facil:'Fácil',medio:'Média',dificil:'Difícil'})[item.difficulty]||item.difficulty)} <b>${fmt(item.count)}</b>`).join(' · ')||'—'}</span></article>`;
  }
  function renderThemes() {
    const options='<option value="">Todos os temas</option>'+themeOptions();
    $('[data-filter="theme"]').innerHTML=options;
    $('[data-editor] [name="theme"]').innerHTML=themeOptions();
    $('[data-themes]').innerHTML=state.themes.map(theme=>`<article><span><b>${esc(theme.label)}</b><small>${esc(theme.id)} · ${theme.status==='active'?'Ativo':'Inativo'}</small></span><div><button type="button" class="btn btn-nb btn-dark" data-theme-edit="${esc(theme.id)}">Renomear</button><button type="button" class="btn btn-nb ${theme.status==='active'?'btn-danger':'btn-success'}" data-theme-toggle="${esc(theme.id)}" data-status="${theme.status}">${theme.status==='active'?'Desativar':'Ativar'}</button></div></article>`).join('');
  }
  function renderRows(data) {
    state.rows=data.items||[];state.pages=Math.max(1,data.pages||1);state.page=data.page||1;renderStats(data.stats||{});renderThemes();
    $('[data-page]').textContent=`Página ${state.page} de ${state.pages} · ${fmt(data.total)} perguntas`;
    $('[data-prev]').disabled=state.page<=1;$('[data-next]').disabled=state.page>=state.pages;
    $('[data-rows]').innerHTML=state.rows.length?state.rows.map(row=>`<tr><td><details><summary>${esc(row.prompt)}</summary><div class="tp-quiz-admin-question-detail"><p>${Object.entries(row.options||{}).map(([key,value])=>`<span><b>${esc(key)}.</b> ${esc(value)}</span>`).join(' · ')}</p><p><b>Gabarito:</b> ${esc(row.answer)} · ${(row.options||{})[row.answer]||''}</p><p>${esc(row.explanation||'Sem explicação cadastrada.')}</p><small>Último uso: ${row.last_used_at?new Date(Number(row.last_used_at)).toLocaleString('pt-BR'):'Nunca'}</small></div></details></td><td>${esc(state.themes.find(theme=>theme.id===row.theme)?.label||row.theme)}</td><td>${esc(({facil:'Fácil',medio:'Média',dificil:'Difícil'})[row.difficulty]||row.difficulty)}</td><td>${row.mode==='calculo'?'Cálculo':'Alternativas'}</td><td>${fmt(row.usage_count)}</td><td><span class="tp-quiz-admin-status ${row.status}">${row.status==='active'?'Ativa':'Desativada'}</span></td><td><div class="tp-quiz-admin-row-actions"><button type="button" class="btn btn-nb btn-dark" data-edit="${Number(row.id)}">Editar</button><button type="button" class="btn btn-nb ${row.status==='active'?'btn-danger':'btn-success'}" data-toggle="${Number(row.id)}">${row.status==='active'?'Desativar':'Ativar'}</button></div></td></tr>`).join(''):'<tr><td colspan="7">Nenhuma pergunta encontrada.</td></tr>';
  }
  async function load(page=1) {
    if(state.loading)return;state.loading=true;state.page=page;
    const params=new URLSearchParams({page:String(page),page_size:'25'});
    for(const key of ['search','theme','difficulty','mode','status']){const value=$(`[data-filter="${key}"]`).value.trim();if(value)params.set(key,value);}
    try{const [questions,themes]=await Promise.all([api(`/api/admin/quiz-live/questions?${params}`),api('/api/admin/quiz-live/themes')]);state.themes=themes.themes||[];renderRows(questions);}
    catch(error){notice(error.message,true);$('[data-rows]').innerHTML=`<tr><td colspan="7">${esc(error.message)}</td></tr>`;}
    finally{state.loading=false;}
  }
  function openEditor(row=null) {
    const form=$('[data-editor]');form.hidden=false;form.reset();form.elements.theme.innerHTML=themeOptions(row?.theme||'');form.elements.id.value=row?.id||'';form.elements.status.value=row?.status||'active';form.elements.recommended_time.value=row?.recommended_time||20;
    if(row){form.elements.theme.value=row.theme;form.elements.difficulty.value=row.difficulty;form.elements.prompt.value=row.prompt;form.elements.answer.value=row.answer;form.elements.explanation.value=row.explanation||'';for(const key of ['A','B','C','D'])form.elements[key].value=row.options?.[key]||'';}
    form.scrollIntoView({behavior:'smooth',block:'center'});
  }
  function renderImportPreview() {
    const target=$('[data-preview-host]');if(!state.preview){target.innerHTML='';return;}
    const valid=state.preview.filter(row=>row.status==='valid').length,duplicates=state.preview.filter(row=>row.status==='duplicate').length,invalid=state.preview.filter(row=>row.status==='invalid').length;
    target.innerHTML=`<p class="tp-quiz-admin-preview-summary">${valid} prontas · ${duplicates} duplicadas · ${invalid} inválidas</p><div class="tp-quiz-admin-preview-list">${state.preview.map(row=>`<label data-kind="${row.status}"><input type="checkbox" value="${row.line}" ${row.status==='valid'?'checked':''} ${row.status!=='valid'?'disabled':''}><span><b>Linha ${row.line} · ${row.status==='valid'?'Pronta':row.status==='duplicate'?'Duplicada':'Inválida'}</b><small>${esc(row.message)}${row.question?` · ${esc(row.question.prompt)}`:''}</small></span></label>`).join('')}</div><button type="button" class="btn btn-nb btn-success" data-import-commit ${valid?'':'disabled'}>Adicionar selecionadas</button>`;
  }
  host.addEventListener('submit',async event=>{
    if(event.target.matches('[data-editor]')){event.preventDefault();const form=event.target,payload={theme:form.elements.theme.value,difficulty:form.elements.difficulty.value,prompt:form.elements.prompt.value,options:{A:form.elements.A.value,B:form.elements.B.value,C:form.elements.C.value,D:form.elements.D.value},answer:form.elements.answer.value,explanation:form.elements.explanation.value,recommended_time:Number(form.elements.recommended_time.value),status:form.elements.status.value};const id=form.elements.id.value;try{await api(id?`/api/admin/quiz-live/questions/${id}`:'/api/admin/quiz-live/questions',{method:id?'PUT':'POST',body:JSON.stringify(payload)});notice(id?'Pergunta global atualizada.':'Pergunta adicionada ao catálogo global.');form.hidden=true;await load(state.page);}catch(error){notice(error.message,true);}}
    if(event.target.matches('[data-theme-form]')){event.preventDefault();try{await api('/api/admin/quiz-live/themes',{method:'POST',body:JSON.stringify({label:event.target.elements.label.value})});event.target.reset();notice('Tema global adicionado.');await load(state.page);}catch(error){notice(error.message,true);}}
  });
  host.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    try{
      if(button.matches('[data-refresh]'))await load(state.page);
      else if(button.matches('[data-new]'))openEditor();
      else if(button.matches('[data-cancel]'))$('[data-editor]').hidden=true;
      else if(button.matches('[data-prev]'))load(state.page-1);
      else if(button.matches('[data-next]'))load(state.page+1);
      else if(button.matches('[data-edit]'))openEditor(state.rows.find(row=>row.id===Number(button.dataset.edit)));
      else if(button.matches('[data-toggle]')){const row=state.rows.find(item=>item.id===Number(button.dataset.toggle));if(row.status==='active')await api(`/api/admin/quiz-live/questions/${row.id}`,{method:'DELETE'});else await api(`/api/admin/quiz-live/questions/${row.id}`,{method:'PUT',body:JSON.stringify({...row,status:'active'})});notice('Status da pergunta atualizado.');await load(state.page);}
      else if(button.matches('[data-theme-edit]')){const theme=state.themes.find(item=>item.id===button.dataset.themeEdit),label=prompt('Novo nome do tema (o identificador será preservado):',theme?.label||'');if(label?.trim()){await api(`/api/admin/quiz-live/themes/${encodeURIComponent(theme.id)}`,{method:'PUT',body:JSON.stringify({label,status:theme.status})});notice('Tema renomeado.');await load(state.page);}}
      else if(button.matches('[data-theme-toggle]')){const theme=state.themes.find(item=>item.id===button.dataset.themeToggle),status=theme.status==='active'?'inactive':'active';await api(`/api/admin/quiz-live/themes/${encodeURIComponent(theme.id)}`,{method:'PUT',body:JSON.stringify({label:theme.label,status})});notice('Status do tema atualizado.');await load(state.page);}
      else if(button.matches('[data-preview]')){const data=await api('/api/admin/quiz-live/questions/import/preview',{method:'POST',body:JSON.stringify({text:$('[data-import]').value})});state.preview=data.preview||[];renderImportPreview();notice('Confira linhas válidas e duplicadas antes de adicionar.');}
      else if(button.matches('[data-import-commit]')){const lines=[...host.querySelectorAll('[data-preview-host] input[type="checkbox"]:checked')].map(input=>Number(input.value));if(!lines.length){notice('Selecione ao menos uma linha válida para adicionar.',true);return;}const data=await api('/api/admin/quiz-live/questions/import',{method:'POST',body:JSON.stringify({text:$('[data-import]').value,accept_lines:lines})});notice(`${data.created} perguntas adicionadas · ${data.duplicate_count} duplicadas · ${data.invalid_count} inválidas.`);state.preview=null;renderImportPreview();await load(1);}
    }catch(error){notice(error.message,true);}
  });
  let searchTimer;host.addEventListener('input',event=>{if(event.target.matches('[data-filter="search"]')){clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(1),250);}});
  host.addEventListener('change',event=>{if(event.target.matches('[data-filter]:not([data-filter="search"])'))load(1);});
  window.addEventListener('hashchange',()=>{if(location.hash==='#adminQuizBank')load(1);});
  if(location.hash==='#adminQuizBank')load(1);
})();
