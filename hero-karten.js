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

  // Anlässe: Das letzte Wort rollt nach oben weg, das nächste kommt von unten; die Breite gleitet mit.
  // Deutscher Text genügt – language.js übersetzt neue Texte im englischen Modus (vor dem nächsten Frame) automatisch.
  const roll = document.querySelector('.occ-roll');
  const occasions = ['Darts-Teams', 'Fussballvereine', 'Kegelclubs', 'Basketball-Teams', 'Handball-Teams', 'Turniere', 'Geburtstage', 'Polterabende', 'Firmenevents', 'Familien', 'Geschenke'];
  let nextOccasion = 1;
  function rollOccasion() {
    if (document.hidden || !roll) return;
    const old = roll.querySelector('.occ-word:not(.is-out)'), word = document.createElement('span');
    word.className = 'occ-word is-in';
    word.textContent = occasions[nextOccasion++ % occasions.length];
    roll.style.width = `${roll.offsetWidth}px`;
    old.classList.add('is-out');
    roll.append(word);
    // Kurz warten, bis language.js das neue Wort ggf. übersetzt hat; offsetWidth misst die richtige Breite und startet die Bewegung.
    setTimeout(() => {
      roll.style.width = `${word.offsetWidth}px`;
      word.classList.remove('is-in');
      setTimeout(() => { old.remove(); roll.style.width = ''; }, 650);
    }, 30);
  }
  setInterval(rollOccasion, 2600);
})();
