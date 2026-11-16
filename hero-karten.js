// Startseite: alle bisherigen Beispiele plus sechs neue Motive.
// Gemischte Durchläufe, keine gleichzeitig gleichen Bilder und kein fester Kartenturnus.
(() => {
  const cards = [...document.querySelectorAll('.hx-stage .hx-card')];
  if (cards.length < 2) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pool = [
    ...['treff-nix', 'bubeler', 'portner', 'zafarkom', 'mike-johnson', 'hoenes', 'wickler'].map(name => `bilder/${name}-vorschau.webp?v=20261024`),
    'bilder/beispiel-bierberge.png?v=20261116-quadrat-2',
    'bilder/beispiel-elefant.jpg?v=20261116-quadrat-2',
    'bilder/beispiel-wikinger.png?v=20261116-quadrat-2',
    'bilder/beispiel-gentle.png?v=20261116-quadrat-2',
    'bilder/beispiel-engel.png?v=20261116-quadrat-2',
    'bilder/beispiel-einhorn.png?v=20261116-quadrat-2'
  ];
  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  const unavailable = new Set(), loaded = new Map();
  let remaining = shuffle(pool), cardTurns = [], lastCard = null, busy = false;
  const shown = () => cards.map(card => card.querySelector('img').getAttribute('src'));
  function take(excluded) {
    if (!remaining.length) remaining = shuffle(pool.filter(src => !unavailable.has(src)));
    const index = remaining.findIndex(src => !excluded.includes(src) && !unavailable.has(src));
    return index < 0 ? null : remaining.splice(index, 1)[0];
  }
  function load(src) {
    if (!loaded.has(src)) loaded.set(src, new Promise(resolve => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(true);
      image.onerror = () => { unavailable.add(src); resolve(false); };
      image.src = src;
    }));
    return loaded.get(src);
  }
  function show(card, src) {
    const image = card.querySelector('img');
    image.src = src;
    // Originalbilder vollständig zeigen, ohne quadratischen Beschnitt.
    image.style.objectFit = 'contain';
  }
  function nextCard() {
    if (!cardTurns.length) {
      cardTurns = shuffle(cards);
      if (cardTurns[0] === lastCard) [cardTurns[0], cardTurns[1]] = [cardTurns[1], cardTurns[0]];
    }
    lastCard = cardTurns.shift();
    return lastCard;
  }
  async function flip() {
    if (busy || document.hidden || reduced.matches) return;
    busy = true;
    try {
      const src = take(shown());
      if (!src || !await load(src)) return;
      if (document.hidden || reduced.matches) { remaining.unshift(src); return; }
      const card = nextCard();
      card.classList.add('is-flipping');
      await new Promise(resolve => setTimeout(resolve, 420));
      show(card, src);
      requestAnimationFrame(() => card.classList.remove('is-flipping'));
    } finally { busy = false; }
  }
  async function start() {
    // Auch die drei Startbilder sind bei jedem Seitenaufruf neu gemischt.
    for (const card of cards) {
      const src = take(shown());
      if (src && await load(src)) show(card, src);
    }
    setInterval(flip, 3400);
  }
  start();
})();

// Anlässe-Karussell: bestehendes Verhalten beibehalten.
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
