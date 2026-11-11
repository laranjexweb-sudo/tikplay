(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get('tk') || localStorage.getItem('token');
  const demo = params.get('demo') === '1';
  const artOnly = params.get('artOnly') === '1';
  const position = document.querySelector('[data-gift-position]');
  const portraits = [...document.querySelectorAll('[data-portrait]')];
  const slots = [...document.querySelectorAll('[data-slot]')];
  const state = { roomId: params.get('room') || '', ranking: [], socket: null, closing: false, refreshTimer: 0 };

  function applyLayout(layout = {}) {
    const previewWithoutConfig = demo && Object.keys(layout).length === 0;
    const x = previewWithoutConfig ? 0 : Math.max(0, Math.min(100, Number(layout.x ?? params.get('x')) || 0));
    const y = previewWithoutConfig ? 0 : Math.max(0, Math.min(100, Number(layout.y ?? params.get('y')) || 0));
    const scale = previewWithoutConfig ? 1 : Math.max(.5, Math.min(2, Number(layout.scale ?? params.get('scale')) || 1));
    position.style.left = `${x}%`;
    position.style.top = `${y}%`;
    position.style.transform = `scale(${scale})`;
    render(state.ranking);
  }

  function initials(value) {
    return String(value || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || '?';
  }

  function render(source) {
    state.ranking = Array.isArray(source) ? source : [];
    for (let index = 0; index < 6; index += 1) {
      const item = state.ranking[index];
      const portrait = portraits[index];
      const slot = slots[index];
      portrait.replaceChildren();
      if (!item) {
        portrait.hidden = true;
        slot.hidden = true;
        continue;
      }
      portrait.hidden = false;
      slot.hidden = false;
      const name = item.nickname || item.user || item.username || item.user_id || 'Usuário';
      const imageUrl = item.avatar || item.avatar_url || item.profile_picture;
      if (imageUrl) {
        const image = new Image();
        image.alt = '';
        image.src = imageUrl;
        image.onerror = () => { portrait.textContent = initials(name); };
        portrait.append(image);
      } else portrait.textContent = initials(name);

      const shownName = index === 2 ? Array.from(String(name)).slice(0, 9).join('') + (Array.from(String(name)).length > 9 ? '...' : '') : name;
      const info = document.createElement('span');
      info.className = 'info';
      const nameElement = document.createElement('span');
      nameElement.className = 'name';
      nameElement.textContent = shownName;
      const score = document.createElement('span');
      score.className = 'score';
      const coin = document.createElement('span');
      coin.className = 'coin';
      coin.setAttribute('aria-hidden', 'true');
      const amount = Math.max(0, Number(item.value_sum ?? item.diamonds) || 0).toLocaleString('pt-BR');
      score.append(coin, document.createTextNode(amount));
      info.append(nameElement, score);
      slot.replaceChildren(info);
    }
  }

  async function api(path) {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function refreshRanking(roomId = state.roomId) {
    if (!roomId || !token) { render([]); return; }
    const query = new URLSearchParams({ room_id: roomId, type: 'gift', limit: '6' });
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
    const ranking = (rankingData.ranking || []).slice(0, 6).map(entry => {
      const identity = identities.get(String(entry.user_id)) || {};
      return {
        ...identity,
        user_id: entry.user_id,
        username: identity.username || identity.user || '',
        nickname: identity.nickname || identity.user || identity.username || entry.user_id,
        value_sum: entry.value_sum,
      };
    });
    render(ranking);
  }

  async function loadLayout() {
    if (demo || !token) return;
    try {
      const data = await api('/api/gift-ranking/vertical-layout');
      if (data.success) applyLayout(data.layout || {});
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
        if (message.type === 'gift_ranking_vertical_layout') applyLayout(message.layout || {});
        else if (message.type === 'status') {
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
      if (event.code === 1008) { render([]); return; }
      if (!state.closing) setTimeout(connect, 3000);
    };
  }

  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.data?.type === 'gift-ranking-vertical-preview-config') applyLayout(event.data.layout || {});
  });
  window.addEventListener('pagehide', () => {
    state.closing = true;
    clearTimeout(state.refreshTimer);
    state.socket?.close();
  }, { once: true });

  if (demo) {
    document.body.classList.add('demo-preview');
    if (artOnly) document.body.classList.add('art-only-preview');
    else render([
      { nickname: 'Luna Gamer', value_sum: 12840 },
      { nickname: 'Rafa Plays', value_sum: 9730 },
      { nickname: 'Mika Santos', value_sum: 6480 },
      { nickname: 'João Clips', value_sum: 4210 },
      { nickname: 'Bia ao Vivo', value_sum: 2860 },
      { nickname: 'Nando BR', value_sum: 1540 },
    ]);
    applyLayout({});
  } else {
    applyLayout();
    if (!token) render([]);
    else {
      loadLayout().finally(() => loadSnapshot().finally(connect));
      setInterval(() => refreshRanking().catch(() => {}), 10000);
    }
  }
})();
