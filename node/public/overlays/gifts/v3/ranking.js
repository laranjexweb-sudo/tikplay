(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get('tk') || localStorage.getItem('token');
  const demo = params.get('demo') === '1';
  const position = document.querySelector('[data-gift-position]');
  const rows = document.querySelector('[data-gift-rows]');
  const state = { roomId: params.get('room') || '', count: 10, socket: null, closing: false, refreshTimer: 0 };

  function applyLayout(layout = {}) {
    const previewWithoutConfig = demo && Object.keys(layout).length === 0;
    const x = previewWithoutConfig ? 0 : Math.max(0, Math.min(100, Number(layout.x ?? params.get('x')) || 0));
    const y = previewWithoutConfig ? 0 : Math.max(0, Math.min(100, Number(layout.y ?? params.get('y')) || 0));
    const scale = previewWithoutConfig ? 1 : Math.max(.5, Math.min(2, Number(layout.scale ?? params.get('scale')) || 1));
    state.count = previewWithoutConfig ? 4 : Math.max(1, Math.min(10, Number.parseInt(layout.count ?? params.get('count'), 10) || 10));
    position.style.left = `${x}%`;
    position.style.top = `${y}%`;
    position.style.transform = `scale(${scale})`;
    render(state.ranking || []);
  }

  function avatarNode(item, index, isPodium) {
    const container = document.createElement('span');
    container.className = isPodium ? 'gift-avatar-frame' : 'plain-avatar';
    const fallback = document.createElement('span');
    fallback.className = 'avatar avatar-fallback';
    fallback.textContent = String(item.nickname || item.username || item.user_id || '?').trim().slice(0, 1).toUpperCase();
    const src = item.avatar || item.avatar_url || item.profile_picture;
    if (src) {
      const image = new Image();
      image.className = 'avatar';
      image.alt = '';
      image.src = src;
      image.onerror = () => image.replaceWith(fallback);
      container.append(image);
    } else container.append(fallback);
    if (isPodium) {
      const frame = new Image();
      frame.className = 'metal-frame';
      frame.src = `assets/0${index + 1}-ranking.png`;
      frame.alt = '';
      container.append(frame);
    }
    return container;
  }

  function render(source) {
    state.ranking = Array.isArray(source) ? source : [];
    rows.replaceChildren();
    const items = state.ranking.slice(0, state.count);
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'gift-empty';
      empty.textContent = demo ? 'Prévia do ranking' : (state.roomId ? 'Aguardando diamantes' : 'Aguardando live');
      rows.append(empty);
      return;
    }
    items.forEach((item, index) => {
      const row = document.createElement('li');
      row.className = `row${index < 3 ? ` rank-${index + 1}` : ''}`;
      row.append(avatarNode(item, index, index < 3));
      const details = document.createElement('span');
      details.className = 'details';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.nickname || item.user || item.username || item.user_id || 'Usuário';
      name.title = name.textContent;
      details.append(name);
      const total = document.createElement('span');
      total.className = 'total-wrap';
      total.setAttribute('aria-label', 'Moedas');
      const coin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      coin.classList.add('coin-icon');
      coin.setAttribute('viewBox', '0 0 24 24');
      coin.setAttribute('aria-hidden', 'true');
      coin.style.setProperty('--coin-duration', `${3.5 + Math.random() * 3}s`);
      coin.style.setProperty('--coin-delay', `${Math.random() * 3}s`);
      const rim = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      rim.setAttribute('cx', '12');
      rim.setAttribute('cy', '12');
      rim.setAttribute('r', '9.25');
      rim.setAttribute('fill', 'none');
      rim.setAttribute('stroke', 'currentColor');
      rim.setAttribute('stroke-width', '2');
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      mark.setAttribute('d', 'M15.5 8.5c-.7-.8-1.8-1.2-3.3-1.2-1.8 0-3 .8-3 2s1.2 1.8 3 2.2 3 1 3 2.3-1.2 2.2-3.2 2.2c-1.4 0-2.6-.5-3.4-1.4M12 5.8v12.4');
      mark.setAttribute('fill', 'none');
      mark.setAttribute('stroke', 'currentColor');
      mark.setAttribute('stroke-linecap', 'round');
      mark.setAttribute('stroke-width', '1.7');
      coin.append(rim, mark);
      const amount = document.createElement('strong');
      amount.className = 'total';
      amount.textContent = Math.max(0, Number(item.value_sum ?? item.diamonds) || 0).toLocaleString('pt-BR');
      total.append(coin, amount);
      details.append(total);
      row.append(details);
      rows.append(row);
    });
  }

  async function api(path) {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function refreshRanking(roomId = state.roomId) {
    if (!roomId || !token) { render([]); return; }
    const count = demo ? 4 : state.count;
    const query = new URLSearchParams({ room_id: roomId, type: 'gift', limit: String(count) });
    const eventsQuery = new URLSearchParams({ room_id: roomId, type: 'gift', limit: '200' });
    const [rankingData, eventData] = await Promise.all([
      api(`/api/reports/ranking?${query}`),
      api(`/api/reports/events?${eventsQuery}`),
    ]);
    const identities = new Map();
    for (const event of eventData.events || []) {
      if (event.user_id != null) identities.set(String(event.user_id), event);
      if (event.username) identities.set(String(event.username).toLowerCase(), event);
    }
    const ranking = (rankingData.ranking || []).map(entry => {
      const identity = identities.get(String(entry.user_id)) || {};
      return { ...identity, user_id: entry.user_id, username: identity.username || identity.user || '', nickname: identity.nickname || identity.user || identity.username || entry.user_id, value_sum: entry.value_sum };
    });
    render(ranking);
  }

  async function loadLayout() {
    if (demo || !token) return;
    try {
      const data = await api('/api/gift-ranking/layout');
      if (!data.success || !data.configured) return;
      const previousCount = state.count;
      applyLayout(data.layout);
      if (state.count !== previousCount) await refreshRanking();
    } catch {}
  }

  async function loadSnapshot() {
    if (!token) return;
    try {
      const snapshot = await api('/api/game-state');
      const nextRoom = String(snapshot.last_status?.room_id || state.roomId || '');
      if (nextRoom !== state.roomId) state.roomId = nextRoom;
      await refreshRanking(state.roomId);
    } catch {}
  }

  function connect() {
    if (!token || state.closing) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/browser?token=${encodeURIComponent(token)}`);
    state.socket = socket;
    socket.onopen = loadSnapshot;
    socket.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'gift_ranking_layout') {
          const previousCount = state.count;
          applyLayout(message.layout);
          if (state.count !== previousCount) refreshRanking().catch(() => {});
        } else if (message.type === 'status') {
          const nextRoom = String(message.room_id || '');
          if (nextRoom !== state.roomId) {
            state.roomId = nextRoom;
            render([]);
            refreshRanking(nextRoom).catch(() => {});
          }
        } else if (message.type === 'gift_event') {
          clearTimeout(state.refreshTimer);
          state.refreshTimer = setTimeout(() => refreshRanking().catch(() => {}), 500);
        }
      } catch {}
    };
    socket.onclose = event => {
      if (event.code === 1008) { renderMessage('LINK EXPIRADO · GERE OUTRO NO PAINEL'); return; }
      if (!state.closing) setTimeout(connect, 3000);
    };
  }

  function renderMessage(message) {
    rows.replaceChildren();
    const empty = document.createElement('li');
    empty.className = 'gift-empty';
    empty.textContent = message;
    rows.append(empty);
  }

  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.data?.type === 'gift-ranking-preview-config') applyLayout(event.data.layout);
  });
  window.addEventListener('pagehide', () => { state.closing = true; state.socket?.close(); }, { once: true });

  if (demo) {
    document.body.classList.add('demo-preview');
    state.ranking = [
      { nickname: 'DragonMasterBR', username: 'dragonmasterbr', value_sum: 25400 },
      { nickname: 'ShadowKnight', username: 'shadowknight', value_sum: 18900 },
      { nickname: 'InfernalMage', username: 'infernal_mage', value_sum: 15320 },
      { nickname: 'ElvenRider', username: 'elvenrider', value_sum: 12840 },
    ];
    applyLayout({ count: 4 });
  } else {
    applyLayout();
    if (!token) renderMessage('LINK INVÁLIDO · GERE O LINK NO PAINEL');
    else { loadLayout().finally(() => loadSnapshot().finally(connect)); setInterval(() => refreshRanking().catch(() => {}), 10000); }
  }
})();
