const params = new URLSearchParams(location.search);
const token = params.get('tk') || localStorage.getItem('token');
const root = document.querySelector('[data-fountain]');
const demo = params.get('demo') === '1';
const heartSvg = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 29 3 16C-5 7 7-3 16 6c9-9 21 1 13 10Z"/></svg>';
let closing = false;
let demoTimer;

function random(min, max) { return min + Math.random() * (max - min); }
function addParticle(kind, item, x, options = {}) {
  const particle = document.createElement('span');
  particle.className = `fountain-particle fountain-${kind}`;
  particle.style.setProperty('--particle-x', `${x}%`);
  particle.style.setProperty('--particle-size', kind === 'avatar' ? '2.75rem' : `${random(1.15, 1.9)}rem`);
  particle.style.setProperty('--particle-duration', `${random(4.4, 6.6)}s`);
  particle.style.setProperty('--particle-drift', `${random(-9, 9)}vw`);
  if (kind === 'heart') {
    particle.style.setProperty('--particle-color', options.color || (Math.random() > .42 ? 'var(--tp-pink)' : 'var(--tp-purple)'));
    particle.innerHTML = heartSvg;
  } else {
    const label = String(item.nickname || item.user || '?').trim();
    particle.setAttribute('aria-label', label);
    const imageUrl = safeAvatar(item.avatar);
    if (imageUrl) {
      const image = new Image();
      image.alt = '';
      image.src = imageUrl;
      image.onerror = () => { particle.textContent = label.slice(0, 1).toUpperCase(); };
      particle.append(image);
    } else {
      particle.textContent = label.slice(0, 1).toUpperCase();
    }
  }
  root.append(particle);
  particle.addEventListener('animationend', () => particle.remove(), { once: true });
  window.setTimeout(() => particle.remove(), 8000);
}
function safeAvatar(value) {
  if (!value) return '';
  try {
    const url = new URL(value, location.origin);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function burst(item, amount) {
  const x = random(12, 88);
  addParticle('avatar', item, x);
  const heartCount = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(amount))));
  for (let index = 0; index < heartCount; index += 1) {
    window.setTimeout(() => addParticle('heart', item, Math.max(4, Math.min(96, x + random(-10, 10)))), index * 90);
  }
}
function connect() {
  if (!token) return;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/browser?token=${encodeURIComponent(token)}`);
  socket.onmessage = event => {
    try {
      const message = JSON.parse(event.data);
      if (message.type !== 'likes_activity') return;
      const activity = message.activity || message;
      const amount = Math.max(1, Number(activity.like_count ?? activity.count) || 1);
      burst(activity, amount);
    } catch { /* ignora mensagens de outros módulos */ }
  };
  socket.onclose = event => {
    if (event.code === 1008 || closing) return;
    window.setTimeout(connect, 3000);
  };
  window.addEventListener('pagehide', () => { closing = true; socket.close(); }, { once: true });
}
if (demo) {
  const samples = [
    { user: 'preview-a', nickname: 'Ana' },
    { user: 'preview-b', nickname: 'Bruno' },
    { user: 'preview-c', nickname: 'Carla' }
  ];
  demoTimer = window.setInterval(() => burst(samples[Math.floor(Math.random() * samples.length)], Math.ceil(random(1, 12))), 620);
} else {
  connect();
}
window.addEventListener('pagehide', () => window.clearInterval(demoTimer), { once: true });
