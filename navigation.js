(() => {
  // Beim Öffnen oben beginnen, auch nach mobilen Wiederherstellungen.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const startAtTop = () => { if (location.hash) { const target = document.getElementById(location.hash.slice(1)); if (target) target.scrollIntoView({block:'start'}); } else window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); };
  window.addEventListener('pageshow', () => {
    startAtTop();
    window.requestAnimationFrame(startAtTop);
  });
  // Kopfzeile fest oben fixieren. Ein Platzhalter gleicher Höhe hält den Inhalt an seinem Platz;
  // Position und Breite werden aus dem normalen Layout übernommen, damit sie zu jeder Seite passen.
  const head = document.querySelector('body.simple-home .masthead');
  if (head) {
    const spacer = document.createElement('div'); spacer.className = 'masthead-spacer'; spacer.setAttribute('aria-hidden', 'true');
    head.before(spacer);
    const pin = () => {
      head.classList.remove('is-pinned'); head.style.left = head.style.width = ''; spacer.style.height = '0px';
      const box = head.getBoundingClientRect(), css = getComputedStyle(head);
      spacer.style.height = `${box.height}px`; spacer.style.marginTop = css.marginTop; spacer.style.marginBottom = css.marginBottom;
      head.style.left = `${box.left}px`; head.style.width = `${box.width}px`;
      head.classList.add('is-pinned');
    };
    pin();
    window.addEventListener('resize', pin);
    window.addEventListener('load', pin);
    // Höhe kann sich ändern (z. B. wenn „Zur Bestellung“ erscheint).
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (head.classList.contains('is-pinned')) spacer.style.height = `${head.offsetHeight}px`; }).observe(head);
  }

  const help = document.getElementById('design-hilfe');
  if (!help) return;
  document.querySelectorAll('[data-open-help]').forEach(link => {
    link.addEventListener('click', () => { help.open = true; });
  });
})();

(() => {
  // Read the persistent order independently on every page, even if the
  // design-transfer module is not loaded on that particular page.
  async function hasSavedOrder(){
    if(window.ShirtboxDesignTransfer?.load){
      const saved=await window.ShirtboxDesignTransfer.load();
      return !!(saved?.blobs?.length || saved?.blob);
    }
    if(!window.indexedDB)return false;
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(!settled){settled=true;resolve(value);}};
      try{
        const request=indexedDB.open('shirtbox-design-transfer',1);
        request.onupgradeneeded=()=>{};
        request.onerror=()=>finish(false);
        request.onsuccess=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains('designs')){db.close();finish(false);return;}
          const tx=db.transaction('designs','readonly');
          const get=tx.objectStore('designs').get('latest');
          get.onsuccess=()=>{const data=get.result;finish(!!(data?.blobs?.length||data?.blob));};
          get.onerror=()=>finish(false);
          tx.oncomplete=tx.onabort=()=>db.close();
        };
      }catch{finish(false);}
    });
  }
  let sequence=0;
  async function updateOrderLink(){
    const nav=document.querySelector('.masthead nav');if(!nav)return;
    const current=++sequence;
    let has=false;
    try{has=await hasSavedOrder();}catch{}
    if(current!==sequence)return;
    document.querySelectorAll('.mobile-order-shortcut').forEach(el=>{el.hidden=!has;el.setAttribute('aria-hidden',String(!has));});
    let link=nav.querySelector('.order-return-link');
    if(has&&!link){
      link=document.createElement('a');link.href='bestellen.html#bestellen';
      link.className='order-return-link';link.textContent='🛒 Zur Bestellung';
      nav.append(link);
    }
    if(!has&&link)link.remove();
  }
  window.ShirtboxRefreshOrderLink=updateOrderLink;
  window.addEventListener('pageshow',updateOrderLink);
  window.addEventListener('focus',updateOrderLink);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateOrderLink();});
  document.addEventListener('DOMContentLoaded',updateOrderLink);
  updateOrderLink();
})();

(() => {
  // Hintergrund: Werkzeuge von Grafikern und KI tauchen abwechselnd hauchdünn auf und verblassen wieder (Aussehen in marke.css).
  // Liegt hinter allem und fängt keine Klicks ab. Die ältere Seite "Eigenes Bild" hat einen deckenden Hintergrund und bleibt aussen vor.
  if (document.body.classList.contains('simple-home')) return;
  const ICONS = [
    '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.6 7.6"/><circle cx="11" cy="11" r="2"/>', // Zeichenfeder
    '<path d="M9.1 11.9l8-8a2.9 2.9 0 1 1 4 4l-8 8.1"/><path d="M7.1 14.9c-1.7 0-3 1.4-3 3 0 1.3-2.5 1.5-2 2 1.1 1.1 2.5 2 4 2 2.2 0 4-1.8 4-4a3 3 0 0 0-3-3z"/>', // Pinsel
    '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/>', // Bleistift
    '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="M14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/>', // Lineal
    '<path d="M2 22l1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>', // Pipette
    '<path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-1.5a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/><circle cx="17" cy="11" r="1"/>', // Farbpalette
    '<path d="M12 2L2 7l10 5 10-5-10-5Z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>', // Ebenen
    '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>', // Zuschneiden
    '<path d="M21.6 3.6l-1.3-1.3a1.2 1.2 0 0 0-1.7 0L2.4 18.6a1.2 1.2 0 0 0 0 1.7l1.3 1.3a1.2 1.2 0 0 0 1.7 0L21.6 5.4a1.2 1.2 0 0 0 0-1.7Z"/><path d="M14 7l3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>', // Zauberstab
    '<path d="M4 4l7 17 2.5-7.4L21 11z"/><path d="M13.5 13.6L19 19"/>', // Mauszeiger
    '<path d="M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="M5 11l9 9"/>', // Radiergummi
    '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>', // Text-Werkzeug
    '<path d="M4 18C8 6 16 6 20 18"/><path d="M4 18L9 8M20 18L15 8"/><rect x="2.5" y="16.5" width="3" height="3"/><rect x="18.5" y="16.5" width="3" height="3"/><circle cx="9" cy="8" r="1.3"/><circle cx="15" cy="8" r="1.3"/>', // Vektorkurve
    '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/><path d="M19 2v4M21 4h-4M5 17v4M7 19H3"/>', // KI-Funken
    '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>', // Chip
    '<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6.8l3.2 4M7 17.2l3.2-4M13.8 10.8L17 6.8M13.8 13.2l3.2 4M7 6h10M7 18h10"/>' // Neuronales Netz
  ];
  // Sportarten passend zu den Anlässen: fliegen abwechselnd mit den Werkzeugen von hinten heran.
  const SPORTS = [
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M13.5 10.5L21 3M18 3h3v3"/>', // Darts
    '<circle cx="12" cy="12" r="10"/><path d="M12 7l4 3-1.5 5h-5L8 10z"/><path d="M12 7V2M16 10l4.6-1.8M14.5 15l3 4.2M9.5 15l-3 4.2M8 10L3.4 8.2"/>', // Fussball
    '<path d="M10 2.5c-1.4 0-1.9 1.5-1.9 2.9 0 1.2.6 2 .6 3S6.5 11 6.5 15c0 3.4 1.4 5.8 1.9 6.5h3.2c.5-.7 1.9-3.1 1.9-6.5 0-4-2.2-5.6-2.2-6.6s.6-1.8.6-3c0-1.4-.5-2.9-1.9-2.9z"/><path d="M8.6 7.6h2.8"/><circle cx="18" cy="17.5" r="4"/><circle cx="17" cy="16.3" r=".5"/><circle cx="18.8" cy="16" r=".5"/>', // Kegeln
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2v20"/><path d="M5.6 4.3C8.5 7 8.5 17 5.6 19.7M18.4 4.3C15.5 7 15.5 17 18.4 19.7"/>', // Basketball
    '<circle cx="12" cy="12" r="10"/><path d="M4 6.5c4 2.2 12 2.2 16 0M4 17.5c4-2.2 12-2.2 16 0M12 2c-3 5-3 15 0 20"/>', // Handball
    '<circle cx="12" cy="12" r="10"/><path d="M12 12c0-4 2.2-7.7 6.2-9.4M12 12c-3.5 2-7.8 2.2-10 .2M12 12c3.5 2 5.7 5.6 5.8 9.3"/>', // Volleyball
    '<path d="M5 2l8 16c.4.8 1 1 2 1h6"/><ellipse cx="7" cy="20" rx="4" ry="1.5"/>', // Eishockey
    '<circle cx="9" cy="9" r="6.5"/><path d="M13.6 13.6L21 21"/><path d="M4 7h10M3 10h12M4.5 13h9M7 3v12M11 3v12"/><circle cx="19.5" cy="4.5" r="2"/>', // Tennis
    '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>', // Pokal
    '<path d="M7 2l3 6M17 2l-3 6"/><circle cx="12" cy="15" r="6"/><path d="M12 12l.9 1.9 2.1.2-1.6 1.4.5 2.1-1.9-1.1-1.9 1.1.5-2.1-1.6-1.4 2.1-.2z"/>' // Medaille
  ];
  const COLORS = ['#ffffff', '#ffb48f', '#a9bdff'];
  const layer = document.createElement('div'); layer.className = 'sb-tools'; layer.setAttribute('aria-hidden', 'true');
  document.body.prepend(layer);
  let last = '', sport = false;
  function spawn(still) {
    sport = !sport;
    const list = sport ? SPORTS : ICONS;
    let i; do i = Math.floor(Math.random() * list.length); while (`${sport}${i}` === last); last = `${sport}${i}`;
    const el = document.createElement('span'), size = Math.round((sport ? 56 : 48) + Math.random() * 72);
    const x = 2 + Math.random() * 90, y = 6 + Math.random() * 82;
    el.innerHTML = `<svg viewBox="0 0 24 24">${list[i]}</svg>`;
    // Sportgeräte fliegen von der Bildmitte nach aussen, als kämen sie aus der Tiefe auf einen zu.
    el.style.cssText = `left:${x.toFixed(1)}vw;top:${y.toFixed(1)}vh;width:${size}px;height:${size}px;color:${COLORS[i % COLORS.length]};--r:${(Math.random() * 40 - 20).toFixed(1)}deg;--dx:${((50 - x) * .6).toFixed(1)}vw;--dy:${((50 - y) * .6).toFixed(1)}vh`;
    if (sport) el.classList.add('is-fly');
    if (still) el.classList.add('is-still'); else setTimeout(() => el.remove(), 9500);
    layer.append(el);
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { for (let n = 0; n < 8; n++) spawn(true); return; }
  spawn(); setTimeout(spawn, 900);
  setInterval(() => { if (!document.hidden) spawn(); }, 1800);
})();
