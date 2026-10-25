// Startseite: Die drei Shirt-Karten drehen sich nacheinander um und decken jeweils ein anderes Beispiel-Shirt auf.
// Das leichte Schweben (CSS) bleibt erhalten; bei "Bewegung reduzieren" bleiben die Karten ruhig.
(() => {
  const cards = [...document.querySelectorAll('.hx-stage .hx-card')];
  if (cards.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const pool = ['treff-nix', 'bubeler', 'portner', 'zafarkom', 'mike-johnson', 'hoenes', 'wickler'].map(name => `bilder/${name}-vorschau.webp?v=20261024`);
  const shown = () => cards.map(card => card.querySelector('img').getAttribute('src'));
  let turn = 0, next = 0;
  // Vorladen, damit beim Umdrehen nie ein leeres Bild erscheint.
  pool.forEach(src => { const img = new Image(); img.decoding = 'async'; img.src = src; });
  function pick() {
    const visible = shown();
    for (let i = 0; i < pool.length; i++) { const src = pool[(next + i) % pool.length]; if (!visible.includes(src)) { next = (next + i + 1) % pool.length; return src; } }
    return null;
  }
  function flip() {
    if (document.hidden) return;
    const card = cards[[2, 0, 1][turn++ % 3]], img = card.querySelector('img'), src = pick();
    if (!src) return;
    card.classList.add('is-flipping');
    setTimeout(() => {
      const done = () => requestAnimationFrame(() => card.classList.remove('is-flipping'));
      img.addEventListener('load', done, {once: true}); img.addEventListener('error', done, {once: true});
      img.src = src;
      if (img.complete) done();
    }, 420);
  }
  setInterval(flip, 3400);
})();

// Anlässe-Karussell: Die Reihe gleitet um einen Namen weiter, der Name in der Mitte wird gross (Klassen siehe home.css).
// Danach wandert der erste Name unsichtbar ans Ende – so läuft das Karussell endlos. Bei "Bewegung reduzieren" steht es still.
(() => {
  const track = document.querySelector('.occ-track');
  if (!track) return;
  const box = track.parentElement;
  let pos = 2;
  function mark() {
    [...track.children].forEach((li, i) => {
      li.classList.toggle('is-active', i === pos); li.classList.toggle('is-left', i < pos); li.classList.toggle('is-right', i > pos);
    });
  }
  function center(animate) {
    const li = track.children[pos];
    if (!animate) track.style.transition = 'none';
    track.style.transform = `translateX(${box.clientWidth / 2 - li.offsetLeft - li.offsetWidth / 2}px)`;
    if (!animate) { void track.offsetWidth; track.style.transition = ''; }
  }
  mark(); center(false);
  addEventListener('resize', () => center(false));
  if (document.fonts) document.fonts.ready.then(() => center(false));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setInterval(() => {
    if (document.hidden) return;
    pos++; mark(); center(true);
    setTimeout(() => { track.append(track.firstElementChild); pos--; mark(); center(false); }, 800);
  }, 2400);
})();
