// ShirtBOX Gestalter: Stichwort, Text und Foto -> KI-Design, beliebig viele T-Shirts auswählen und bestellen.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('studio-form'); if (!form) return;
  const API = 'https://black-snow-2fdf.r-n.workers.dev';
  const TEMPLATE = 'anleitung/polo-api-vorlage.jpg';
  const DAILY_KEY = 'shirtbox_surprise_count_v1', DAILY_MAX = 5, MAX_PHOTO = 5 * 1024 * 1024;

  const keyword = $('studio-keyword'), shirtText = $('studio-text'), photo = $('studio-photo'), rights = $('studio-rights');
  const surprise = $('studio-surprise'), quota = $('studio-quota'), error = $('studio-error');
  const photoBox = $('studio-photo-box'), photoName = $('studio-photo-name'), photoThumb = $('studio-photo-thumb'), photoRemove = $('studio-photo-remove');
  const stage = document.querySelector('.studio-stage'), picture = $('studio-image'), loader = $('studio-loader'), status = $('studio-status');
  const editRow = $('studio-edit'), editInput = $('studio-edit-input'), editButton = $('studio-edit-button');
  const list = $('studio-designs'), count = $('studio-count'), orderBar = $('studio-order'), total = $('studio-total'), orderButton = $('studio-order-button'), another = $('studio-another');

  const designs = []; let active = -1, busy = false, editingOrder = false;

  // Tageslimit für neue Designs (Änderungen sind frei).
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function used() { try { const v = JSON.parse(localStorage.getItem(DAILY_KEY) || '{}'); return v.date === today() ? Math.min(DAILY_MAX, Number(v.count) || 0) : 0; } catch { return 0; } }
  function consume() { try { localStorage.setItem(DAILY_KEY, JSON.stringify({date: today(), count: used() + 1})); } catch {} }
  const left = () => DAILY_MAX - used();

  const fail = text => { error.textContent = text; error.hidden = !text; };
  const say = text => { status.textContent = text; };
  const ready = () => designs.filter(d => d.blob);
  const chosen = () => editingOrder ? ready() : ready().filter(d => d.selected);

  function render() {
    const d = designs[active];
    picture.src = d?.url || TEMPLATE;
    picture.alt = d ? `Design ${active + 1}: Vorderseite und Rückseite` : 'Weisse Polo-Vorlage, Vorderseite und Rückseite';
    editRow.hidden = !d;
    list.replaceChildren();
    designs.forEach((item, i) => {
      const card = document.createElement('div'); card.className = 'studio-card'; card.classList.toggle('is-active', i === active); card.classList.toggle('is-selected', item.selected || editingOrder);
      const view = document.createElement('button'); view.type = 'button'; view.className = 'studio-card-view'; view.setAttribute('aria-pressed', String(i === active)); view.setAttribute('aria-label', `Design ${i + 1} ansehen`);
      const img = document.createElement('img'); img.src = item.url; img.alt = ''; view.append(img);
      view.addEventListener('click', () => { if (busy) return; active = i; render(); });
      const pick = document.createElement('label'); pick.className = 'studio-card-pick';
      const box = document.createElement('input'); box.type = 'checkbox'; box.checked = item.selected || editingOrder; box.disabled = editingOrder || busy;
      box.addEventListener('change', () => { item.selected = box.checked; render(); });
      pick.append(box, document.createTextNode(` Design ${i + 1}`));
      card.append(view, pick); list.append(card);
    });
    const n = ready().length, c = chosen().length;
    count.textContent = n ? `${n} Design${n === 1 ? '' : 's'}` : '';
    orderBar.hidden = !n;
    total.textContent = c ? `${c} T-Shirt${c === 1 ? '' : 's'} ausgewählt · ab ${window.ShirtboxOrder.money(window.ShirtboxOrder.totalForQuantity(c))}` : 'Kein T-Shirt ausgewählt';
    orderButton.textContent = editingOrder ? 'Zurück zur Bestellung →' : c > 1 ? `${c} T-Shirts zur Bestellung →` : 'T-Shirt zur Bestellung →';
    controls();
  }

  function controls() {
    const none = left() <= 0;
    surprise.disabled = busy || none;
    surprise.textContent = designs.length ? '✨ Weiteres T-Shirt designen' : '✨ T-Shirt designen';
    quota.textContent = none ? `Heute sind alle ${DAILY_MAX} KI-Designs aufgebraucht – morgen wieder. Änderungen sind weiterhin möglich.` : `Noch ${left()} von ${DAILY_MAX} KI-Designs heute · Änderungen zählen nicht dazu`;
    editButton.disabled = busy || !editInput.value.trim();
    orderButton.disabled = busy || !chosen().length;
    another.disabled = busy;
    stage.classList.toggle('is-empty', !designs.length && !busy);
    loader.hidden = !busy; form.setAttribute('aria-busy', String(busy));
  }

  // Foto-Auswahl mit Vorschau.
  photo.addEventListener('change', () => {
    fail('');
    const file = photo.files[0];
    if (file && file.size > MAX_PHOTO) { photo.value = ''; fail('Das Foto darf maximal 5 MB gross sein.'); }
    else if (file && !/^image\/(jpeg|png|webp)$/.test(file.type)) { photo.value = ''; fail('Bitte ein JPG-, PNG- oder WebP-Foto wählen.'); }
    const current = photo.files[0];
    photoBox.classList.toggle('has-photo', !!current);
    photoName.textContent = current ? current.name : 'Foto hochladen';
    if (photoThumb.src) URL.revokeObjectURL(photoThumb.src);
    photoThumb.src = current ? URL.createObjectURL(current) : '';
    photoRemove.hidden = !current;
  });
  photoRemove.addEventListener('click', () => { photo.value = ''; photo.dispatchEvent(new Event('change')); });

  async function withPhoto(file) {
    const base = await createImageBitmap(await (await fetch(TEMPLATE)).blob()), pic = await createImageBitmap(file);
    const canvas = document.createElement('canvas'); canvas.width = base.width; canvas.height = base.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(base, 0, 0);
    const half = canvas.width / 2, scale = Math.min(half * .48 / pic.width, canvas.height * .40 / pic.height);
    const w = pic.width * scale, h = pic.height * scale;
    ctx.drawImage(pic, (half - w) / 2, canvas.height * .36, w, h); base.close(); pic.close();
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('Das Foto konnte nicht verarbeitet werden.')), 'image/jpeg', .9));
  }

  // Designstile der fünf Knöpfe: kurze Kundenwahl -> ausführliche Gestaltungsanweisung.
  const STYLES = {
    modern: {label: 'Modern', brief: 'MODERN – klare geometrische Formen, dynamische Linien und Flächen, kräftige Farbverläufe, zeitgemässes Grafikdesign wie bei aktuellen Profi-Teamtrikots.'},
    realistisch: {label: 'Realistisch', brief: 'REALISTISCH – fotorealistische Darstellung mit natürlichem Licht, Tiefe, feinen Details und echten Texturen; das Motiv wirkt wie ein hochwertiges Foto, nahtlos ins Shirt übergehend.'},
    comic: {label: 'Comic', brief: 'COMIC – ausdrucksstarker Comic- und Cartoon-Stil mit kräftigen schwarzen Konturen, flächigen leuchtenden Farben, Halbtonpunkten, Action-Effekten und viel Energie.'},
    retro: {label: 'Retro', brief: 'RETRO – Vintage-Look der 70er bis 90er Jahre mit warmen, leicht verblassten Farben, Streifen, Sonnenuntergangs-Verläufen und nostalgischer Anmutung.'},
    sportlich: {label: 'Sportlich', brief: 'SPORTLICH – energiegeladenes Profi-Trikot-Design mit Speed-Linien, Pinselstrichen, Kontrastfarben und starkem Bewegungseindruck.'},
    minimal: {label: 'Minimal', brief: 'MINIMAL – reduziertes, cleanes Design mit viel ruhiger Fläche, wenigen klaren Formen, feinen Linien und höchstens zwei bis drei Farben.'},
    graffiti: {label: 'Graffiti', brief: 'GRAFFITI – urbaner Street-Art-Look mit Spraydosen-Effekten, Farbspritzern, Tropfen, kräftigen Neonfarben und wildem, lebendigem Stil.'},
    elegant: {label: 'Elegant', brief: 'ELEGANT – edles, hochwertiges Design mit dunklen oder gedeckten Grundfarben, feinen Ornamenten oder Linien und goldenen bzw. silbernen Akzenten.'}
  };
  const RANDOM_STYLES = ['hochwertig und stimmig, natürliche Farben', 'hochwertig sportlich, dezente Farben', 'realistische Illustration, elegante Details', 'modern und klar, authentische Texturen'];
  let styleChoice = '';

  // Hilft der Kundeneingabe nach: ergänzt Aufbau, Farben, Schrift und Druckqualität zu einem vollständigen Briefing.
  function surprisePrompt(word, text, hasPhoto) {
    let p = 'Gestalte als erfahrener Designer ein hochwertiges, rundum bedrucktes 360-Grad-Sportpolo auf der Vorlage (links Vorderseite, rechts Rückseite) mit zusammenhängendem Design über Vorderseite, Rückseite, Kragen und Ärmel. ';
    const wish = word ? `Kundenwunsch: "${word}". Treu umsetzen und fehlende Details (Farben, Motive, Muster, Komposition) professionell ergänzen. Diese Beschreibung NICHT als Schrift drucken. ` : '';
    if (hasPhoto) p += `Das hochgeladene Foto ist die verbindliche Referenz für das Hauptmotiv (Person, Tier oder Objekt): gut erkennbar übernehmen, freistellen und harmonisch integrieren, nicht ersetzen. ${wish}`;
    else if (word) p += wish;
    else if (text) p += 'Entwickle ein ausdrucksstarkes Motiv, das inhaltlich zum Schriftzug passt. ';
    else p += 'Entwickle ein ausdrucksstarkes, überraschendes Motiv, das zum gewählten Stil passt. ';
    p += `Designstil: ${STYLES[styleChoice]?.brief || RANDOM_STYLES[Math.floor(Math.random() * RANDOM_STYLES.length)]} `;
    p += 'Aufbau: Vorderseite mit klarem Blickfang auf Brusthöhe, Rückseite mit dem grössten Hauptmotiv, Ärmel und Kragen mit passenden Akzenten oder Mustern, die alles verbinden. Höchstens 3–4 harmonische Hauptfarben mit gutem Kontrast. ';
    p += text ? `Schriftzug: genau "${text}" – Buchstabe für Buchstabe korrekt, gut lesbar und sichtbar platziert (z. B. gross auf der Rückseite oder auf der Brust). Keine weiteren Wörter. ` : 'Keine Schriftzüge oder Wörter auf das Shirt setzen, ausser sie sind Teil des Fotos. ';
    return p + `Keine rechteckige Foto-Auflage, keine Marken-Logos, keine Wasserzeichen. Polo-Form, Perspektive und Vorlage beibehalten. Druckfertige, professionelle Qualität. Variante ${Date.now()}`;
  }

  // Stil-Knöpfe: einer aktiv, erneuter Klick hebt die Auswahl auf.
  const styleButtons = [...document.querySelectorAll('#studio-styles [data-style]')];
  styleButtons.forEach(button => button.addEventListener('click', () => {
    styleChoice = styleChoice === button.dataset.style ? '' : button.dataset.style;
    styleButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.style === styleChoice)));
  }));

  async function request(prompt, image) {
    const body = new FormData(); body.set('prompt', prompt.slice(0, 2000)); body.set('mode', image ? 'edit' : 'new');
    if (image) body.set('image', image, 'shirtbox.jpg');
    const response = await fetch(`${API}/generate`, {method: 'POST', body, signal: AbortSignal.timeout(195000)});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(result.error || 'Die Bildgestaltung ist momentan nicht verfügbar.');
    const b64 = result.data?.[0]?.b64_json; if (typeof b64 !== 'string' || !b64) throw Error('Es wurde kein Bild zurückgegeben.');
    const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], {type: 'image/jpeg'});
  }

  async function run(task) {
    busy = true; fail(''); say(''); render();
    stage.scrollIntoView({behavior: 'smooth', block: 'center'});
    try { await task(); }
    catch (e) { fail(['TimeoutError', 'AbortError'].includes(e.name) ? 'Die Anfrage dauert zu lange. Bitte später erneut versuchen.' : e.message === 'Failed to fetch' ? 'Die Bildgestaltung ist nicht erreichbar. Bitte später erneut versuchen.' : e.message); }
    finally { busy = false; render(); }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    const word = keyword.value.trim(), text = shirtText.value.trim(), file = photo.files[0];
    if (!word && !text && !file && !styleChoice) { fail('Bitte wählen Sie einen Stil, beschreiben Sie Ihr Design, geben Sie einen Text ein oder laden Sie ein Foto hoch.'); keyword.focus(); return; }
    if (!rights.checked) { fail('Bitte bestätigen Sie Ihre Inhalts- und Bildrechte.'); rights.closest('label').classList.add('attention'); rights.focus(); return; }
    if (left() <= 0) return;
    run(async () => {
      const blob = await request(surprisePrompt(word, text, !!file), file ? await withPhoto(file) : null);
      consume();
      const summary = [styleChoice && `Stil: ${STYLES[styleChoice].label}`, word && `Design: ${word}`, text && `Text: ${text}`, file && 'mit eigenem Foto'].filter(Boolean).join(' · ');
      designs.push({blob, url: URL.createObjectURL(blob), prompt: `KI-Design – ${summary}`, selected: true, number: editingOrder ? Math.max(0, ...designs.map(d => d.number || 0)) + 1 : null});
      active = designs.length - 1;
      say(`Design ${active + 1} ist fertig. Sie können es unten noch ändern oder direkt bestellen.`);
    });
  });

  // Weiteres T-Shirt: Eingaben leeren und zurück zum Formular.
  another.addEventListener('click', () => {
    if (busy) return;
    keyword.value = ''; shirtText.value = ''; photo.value = ''; photo.dispatchEvent(new Event('change'));
    fail(''); say('');
    form.scrollIntoView({behavior: 'smooth', block: 'start'});
    keyword.focus({preventScroll: true});
  });
  rights.addEventListener('change', () => { rights.closest('label').classList.remove('attention'); if (rights.checked && error.textContent.includes('Bildrechte')) fail(''); });

  editInput.addEventListener('input', controls);
  editInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editButton.click(); } });
  editButton.addEventListener('click', () => {
    const d = designs[active], change = editInput.value.trim();
    if (busy || !d || !change) return;
    run(async () => {
      const blob = await request(`Bisheriges Shirt und Gestaltung beibehalten. Ändere nur Folgendes: ${change}\nErhalte alle anderen Merkmale.`, d.blob);
      URL.revokeObjectURL(d.url); d.blob = blob; d.url = URL.createObjectURL(blob);
      d.prompt = `${d.prompt}\nÄnderung: ${change}`.slice(-1500); editInput.value = '';
      say(`Design ${active + 1} wurde angepasst. Weitere Änderungen sind jederzeit möglich.`);
    });
  });

  orderButton.addEventListener('click', async () => {
    const picked = chosen(); if (busy || !picked.length) return;
    const items = picked.map(d => ({blob: d.blob, number: d.number, prompt: d.prompt, originals: [], placement: ''}));
    busy = true; controls();
    try {
      const previous = (await window.ShirtboxDesignTransfer.load())?.blobs || [];
      let saved;
      if (editingOrder) {
        saved = previous.slice();
        for (const item of items) { const at = saved.findIndex((e, i) => (e.number || i + 1) === item.number); if (at >= 0) saved[at] = item; else saved.push(item); }
      } else {
        let next = Math.max(0, ...previous.map((e, i) => Number(e.number || i + 1) || 0));
        saved = [...previous, ...items.map(item => ({...item, number: ++next}))];
      }
      await window.ShirtboxDesignTransfer.save(saved);
      location.href = 'bestellen.html#bestellen';
    } catch { fail('Ihre Designs konnten nicht gespeichert werden. Bitte die Speicherung im Browser erlauben und erneut versuchen.'); busy = false; controls(); }
  });

  // Aus der Bestellung zurück: gespeicherte Designs zum Weiterbearbeiten laden.
  async function restore() {
    const number = new URLSearchParams(location.search).get('weiterbearbeiten');
    if (!number || !window.ShirtboxDesignTransfer?.load) return;
    try {
      const items = (await window.ShirtboxDesignTransfer.load())?.blobs || [];
      const index = items.findIndex((x, i) => String(x.number || i + 1) === number);
      if (index < 0) throw Error();
      items.forEach((e, i) => { const blob = e.blob || e; if (blob instanceof Blob) designs.push({blob, url: URL.createObjectURL(blob), prompt: e.prompt || '', selected: true, number: e.number || i + 1}); });
      editingOrder = true; active = designs.findIndex(d => String(d.number) === number);
      say('Ihr Design wurde geladen. Beschreiben Sie unten die gewünschte Änderung.');
      render(); editInput.focus({preventScroll: true});
    } catch { fail('Das gespeicherte Design konnte nicht geladen werden.'); }
  }

  render(); restore();
})();
