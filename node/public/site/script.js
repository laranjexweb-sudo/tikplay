const button = document.getElementById('menuButton');
const nav = document.getElementById('nav');
button?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  button.setAttribute('aria-expanded', String(open));
});
nav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
  nav.classList.remove('open');
  button?.setAttribute('aria-expanded', 'false');
}));

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

document.querySelectorAll('details').forEach(item => {
  item.addEventListener('toggle', () => {
    if (item.open) {
      document.querySelectorAll('details').forEach(other => {
        if (other !== item) other.open = false;
      });
    }
  });
});
