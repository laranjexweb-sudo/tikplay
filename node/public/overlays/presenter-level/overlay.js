(() => {
  const $ = id => document.getElementById(id);
  const overlay = $('overlay');
  const overlayMaster = $('overlayMaster');
  const avatar = $('avatar');
  const avatarFallback = $('avatarFallback');
  const username = $('username');
  const announcement = $('announcement');
  const eventBadgeLabel = $('eventBadgeLabel');
  const currentLevel = $('currentLevel');
  const miniCurrent = $('miniCurrent');
  const rangeLabel = $('rangeLabel');
  const roman = $('roman');
  const fromLabel = $('fromLabel');
  const toLabel = $('toLabel');
  const fromLevel = $('fromLevel');
  const toLevel = $('toLevel');
  const message = $('message');
  const progressBlock = $('progressBlock');
  const progressValue = $('progressValue');
  const progressGoal = $('progressGoal');
  const progressFill = $('progressFill');
  const gemOld = $('gemOld');
  const gemNew = $('gemNew');
  const footerText = $('footerText');
  const footerChip = $('footerChip');
  const trackProgress = $('trackProgress');
  const tierNodes = Array.from(document.querySelectorAll('.tier-node'));
  const params = new URLSearchParams(location.search);
  const previewMode = params.get('preview') === '1';
  const defaultLayout = { x: 50, y: 50, scale: 1 };
  let currentLayout = { ...defaultLayout };
  let activeAxis = 'gifter';
  const tierSets = {
    gifter: [
      { roman: 'I', range: 'Nível 1–9', min: 1 },
      { roman: 'II', range: 'Nível 10–19', min: 10 },
      { roman: 'III', range: 'Nível 20–29', min: 20 },
      { roman: 'IV', range: 'Nível 30–39', min: 30 },
      { roman: 'V', range: 'Nível 40–49', min: 40 },
      { roman: 'VI', range: 'Nível 50+', min: 50 }
    ],
    fanclub: [
      { roman: 'I', range: 'Capítulo I · Níveis 1–9', min: 1 },
      { roman: 'II', range: 'Capítulo II · Níveis 10–19', min: 10 },
      { roman: 'III', range: 'Capítulo III · Níveis 20–29', min: 20 },
      { roman: 'IV', range: 'Capítulo IV · Níveis 30–39', min: 30 },
      { roman: 'V', range: 'Capítulo V · Níveis 40–49', min: 40 },
      { roman: 'VI', range: 'Capítulo VI · Nível 50+', min: 50 }
    ]
  };
  const tiersFor = axis => tierSets[axis] || tierSets.gifter;
  const tierFor = (level, axis = activeAxis) => Math.min(5, tiersFor(axis).reduce((index, tier, current) => Number(level) >= tier.min ? current : index, 0));
  const gemMarkup = (tier, axis = activeAxis) => `<img src="assets/${axis === 'fanclub' ? `community/capitulo${tier + 1}` : `nivel${tier + 1}`}.png" alt="" aria-hidden="true">`;
  const initialPayload = {
    username: params.get('user') || 'PEU',
    avatar: params.get('avatar') || '',
    axis: params.get('axis') === 'fanclub' ? 'fanclub' : 'gifter',
    fromLevel: Number(params.get('from') || 23),
    toLevel: Number(params.get('to') || 24),
    progress: params.has('progress') ? Number(params.get('progress')) : null,
    goal: params.has('goal') ? Number(params.get('goal')) : null,
    message: params.get('message') || '',
    demo: params.get('demo') === '1'
  };
  const queue = [];
  let playing = false;
  let socket;
  let closing = false;

  function applyLayout(value = {}) {
    currentLayout = {
      x: Math.max(0, Math.min(100, Number(value.x ?? defaultLayout.x))),
      y: Math.max(0, Math.min(100, Number(value.y ?? defaultLayout.y))),
      scale: Math.max(.5, Math.min(2, Number(value.scale ?? defaultLayout.scale)))
    };
    const viewportFit = Math.min(1, innerWidth / 1040, innerHeight / 820);
    overlayMaster.style.left = `${currentLayout.x}%`;
    overlayMaster.style.top = `${currentLayout.y}%`;
    overlayMaster.style.transform = `translate(-50%,-50%) scale(${currentLayout.scale * viewportFit})`;
  }

  async function loadLayout() {
    const token = params.get('tk');
    if (!token || previewMode) return;
    try {
      const response = await fetch('/api/presenter-level/layout', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.success) applyLayout(data.layout);
    } catch {}
  }

  function initials(value) {
    return String(value || 'TP').replace(/^@/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'TP';
  }

  function paintTrack(activeTier, axis = activeAxis) {
    tierNodes.forEach((node, index) => {
      const tier = index + 1;
      node.classList.toggle('past', tier < activeTier);
      node.classList.toggle('current', tier === activeTier);
      node.classList.remove('reveal');
      node.querySelector('.node-gem').innerHTML = gemMarkup(index, axis);
    });
    trackProgress.style.width = `${((activeTier - 1) / 5) * 88}%`;
  }

  function paintTier(tier, updateTrack = true, axis = activeAxis) {
    const tierData = tiersFor(axis)[tier];
    document.body.className = `${axis === 'fanclub' ? 'community-mode' : 'gifter-mode'} tier-${tier + 1}`;
    overlay.classList.toggle('community-mode', axis === 'fanclub');
    roman.textContent = tierData.roman;
    rangeLabel.textContent = tierData.range;
    miniCurrent.innerHTML = gemMarkup(tier, axis);
    gemNew.innerHTML = gemMarkup(tier, axis);
    if (updateTrack) paintTrack(tier + 1, axis);
  }

  function apply(payload = {}, phase = 'complete') {
    const data = { ...initialPayload, ...payload };
    const axis = data.axis === 'fanclub' ? 'fanclub' : 'gifter';
    const isCommunity = axis === 'fanclub';
    const tiers = tiersFor(axis);
    activeAxis = axis;
    const oldTier = tierFor(data.fromLevel, axis);
    const newTier = tierFor(data.toLevel, axis);
    const tierChanged = oldTier !== newTier;
    overlay.classList.toggle('tier-change', tierChanged);
    overlay.classList.toggle('same-tier', !tierChanged);
    overlay.dataset.phase = phase;
    const beforeReveal = ['intro', 'announcement', 'expand', 'level-label', 'level', 'timeline'].includes(phase);
    paintTier(beforeReveal && tierChanged ? oldTier : newTier, phase !== 'timeline', axis);
    gemOld.innerHTML = gemMarkup(oldTier, axis);
    gemNew.innerHTML = gemMarkup(beforeReveal && tierChanged ? oldTier : newTier, axis);
    username.textContent = data.username || 'Usuário';
    announcement.textContent = isCommunity ? 'Subiu de nível na comunidade!' : 'Subiu de nível de presenteador!';
    eventBadgeLabel.textContent = isCommunity ? 'JORNADA DE FÃ' : 'SUBIDA DE NÍVEL';
    currentLevel.textContent = String(beforeReveal ? data.fromLevel : data.toLevel ?? '');
    fromLevel.textContent = String(data.fromLevel ?? '');
    toLevel.textContent = String(data.toLevel ?? '');
    fromLabel.textContent = 'NÍVEL ATUAL';
    toLabel.textContent = ['level-label', 'level', 'normal-tier', 'timeline', 'big-tier'].includes(phase)
      ? (isCommunity ? 'NÍVEL DA COMUNIDADE ALCANÇADO' : 'NÍVEL ALCANÇADO')
      : (isCommunity ? 'NOVO NÍVEL DA COMUNIDADE' : 'NOVO NÍVEL');
    message.textContent = phase === 'big-tier' && tierChanged
      ? (isCommunity ? 'NOVO CAPÍTULO DESBLOQUEADO' : 'NOVO TIER ALCANÇADO')
      : data.message || (isCommunity
        ? (tierChanged ? 'Novo capítulo da comunidade desbloqueado!' : 'Nível da comunidade atualizado.')
        : (tierChanged ? 'Novo emblema de presenteador desbloqueado!' : 'Nível de presenteador atualizado.'));
    footerText.textContent = isCommunity
      ? (tierChanged ? 'Novo capítulo da Jornada de Fã desbloqueado.' : 'Jornada de Fã atualizada.')
      : (tierChanged ? 'Novo emblema e energia desbloqueados.' : 'Nível de presenteador atualizado.');
    footerChip.textContent = isCommunity
      ? `CAPÍTULO ${tiers[newTier].roman}`
      : (tierChanged ? `${phase === 'big-tier' ? 'TIER DESBLOQUEADO' : 'NOVO EMBLEMA'} · ${tiers[newTier].roman}` : 'PRESENTEADOR');

    avatarFallback.textContent = initials(data.username);
    avatar.onload = () => { avatar.style.display = 'block'; avatarFallback.style.display = 'none'; };
    avatar.onerror = () => { avatar.style.display = 'none'; avatarFallback.style.display = 'grid'; };
    if (data.avatar) {
      if (avatar.getAttribute('src') !== data.avatar) avatar.src = data.avatar;
    } else {
      avatar.removeAttribute('src');
      avatar.style.display = 'none';
      avatarFallback.style.display = 'grid';
    }

    const hasProgress = Number.isFinite(Number(data.progress)) && Number.isFinite(Number(data.goal)) && Number(data.goal) > 0;
    progressBlock.style.display = hasProgress ? 'block' : 'none';
    if (hasProgress) {
      progressValue.textContent = Number(data.progress).toLocaleString('pt-BR');
      progressGoal.textContent = Number(data.goal).toLocaleString('pt-BR');
      requestAnimationFrame(() => { progressFill.style.width = `${Math.max(0, Math.min(100, Number(data.progress) / Number(data.goal) * 100))}%`; });
    } else {
      progressFill.style.width = '0%';
    }
  }

  function hide() {
    overlay.classList.remove('show');
    overlay.classList.add('hide');
  }

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function setTimelineStep(activeIndex) {
    tierNodes.forEach((node, index) => {
      node.classList.toggle('past', index < activeIndex);
      node.classList.toggle('current', index === activeIndex);
      node.classList.remove('reveal');
    });
    trackProgress.style.width = `${Math.max(0, (activeIndex / 5) * 88)}%`;
  }

  async function playTierEvolution(payload, newTier) {
    apply(payload, 'timeline');
    setTimelineStep(-1);
    await delay(550);
    for (let tier = 0; tier <= newTier; tier += 1) {
      if (closing) return;
      setTimelineStep(tier);
      await delay(420);
    }
    tierNodes[newTier].classList.add('reveal');
    await delay(1150);
    if (closing) return;
    apply(payload, 'big-tier');
    await delay(2900);
  }

  async function playLevelUp(payload) {
    const data = { ...initialPayload, ...payload };
    const axis = data.axis === 'fanclub' ? 'fanclub' : 'gifter';
    const oldTier = tierFor(data.fromLevel, axis);
    const newTier = tierFor(data.toLevel, axis);
    const tierChanged = oldTier !== newTier;

    overlay.classList.add('resetting');
    overlay.classList.remove('show', 'hide');
    overlay.dataset.phase = 'idle';
    void overlay.offsetWidth;
    apply(data, 'intro');
    void overlay.offsetWidth;
    overlay.classList.remove('resetting');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    await delay(1050);
    if (closing) return;
    apply(data, 'announcement');
    await delay(1200);
    if (closing) return;
    apply(data, 'expand');
    await delay(1150);
    if (closing) return;
    apply(data, 'level-label');
    await delay(500);
    if (closing) return;
    apply(data, 'level');
    await delay(tierChanged ? 2400 : 1300);
    if (closing) return;

    if (tierChanged) {
      await playTierEvolution(data, newTier);
    } else {
      apply(data, 'normal-tier');
      await delay(2800);
    }
    if (closing) return;
    hide();
    await delay(800);
  }

  async function playNext() {
    if (playing || !queue.length || closing) return;
    playing = true;
    try {
      while (queue.length && !closing) {
        await playLevelUp(queue.shift());
      }
    } finally {
      playing = false;
      if (queue.length && !closing) void playNext();
    }
  }

  function enqueue(payload) {
    queue.push(payload);
    void playNext();
  }

  function show(payload = {}) {
    enqueue(payload);
  }

  function handleMessage(event) {
    if (event.type === 'presenter_level_layout') {
      applyLayout(event.layout);
      return;
    }
    if (event.type !== 'level_up' || !['gifter', 'fanclub'].includes(event.axis)) return;
    const before = Number(event.before);
    const after = Number(event.after);
    if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) return;
    enqueue({
      username: event.nickname || event.user || 'Usuário',
      avatar: event.avatar || '',
      axis: event.axis,
      fromLevel: before,
      toLevel: after
    });
  }

  function connect() {
    const token = params.get('tk');
    if (!token || closing) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}/browser?token=${encodeURIComponent(token)}`);
    socket.onmessage = event => {
      try { handleMessage(JSON.parse(event.data)); } catch {}
    };
    socket.onclose = event => {
      if (closing || event.code === 1008) return;
      setTimeout(connect, 2500);
    };
  }

  window.TikPlayLevelUpV2 = { show, hide, apply, applyLayout };
  addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === 'tikplay:levelup-v2') enqueue(event.data.payload || {});
    if (event.data?.type === 'presenter-level-layout') applyLayout(event.data.layout);
  });
  addEventListener('resize', () => applyLayout(currentLayout));
  addEventListener('pagehide', () => {
    closing = true;
    queue.length = 0;
    socket?.close();
  }, { once: true });

  apply(initialPayload, 'idle');
  applyLayout();
  if (previewMode) {
    apply(initialPayload, 'big-tier');
    overlay.classList.add('preview');
  } else if (initialPayload.demo) enqueue(initialPayload);
  else void loadLayout().finally(connect);
})();
