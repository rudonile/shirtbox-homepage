// ShirtBOX Gestalter: Beschreibung und Foto -> KI-Design, beliebig viele T-Shirts auswählen und bestellen.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('studio-form'); if (!form) return;
  const API = 'https://black-snow-2fdf.r-n.workers.dev';
  const MAX_PHOTO = 5 * 1024 * 1024;
  // Obergrenze des Bildmodells (32'000 Zeichen) – die Kundenbeschreibung selbst ist nicht begrenzt.
  const MAX_PROMPT = 30000;
  // Shirt-Modelle: leere Vorlage (links vorne, rechts hinten) und Schnittbeschreibung für die KI.
  const MODELS = {
    polo: {label: 'Polo-Shirt', template: 'anleitung/polo-api-vorlage.jpg', cut: 'Sportpolo mit Polo-Kragen und Knopfleiste'},
    zip: {label: 'Zip-Shirt', template: 'anleitung/zip-api-vorlage.jpg', cut: 'Sport-Jersey mit niedrigem Stehkragen und kurzem Reissverschluss vorne (kein Polo-Kragen, keine Knöpfe)'}
  };
  let model = '';
  const TEMPLATE = () => MODELS[model]?.template || MODELS.polo.template;

  const keyword = $('studio-keyword'), photo = $('studio-photo'), rights = $('studio-rights');
  const surprise = $('studio-surprise'), error = $('studio-error');
  const photoBox = $('studio-photo-box'), photoName = $('studio-photo-name'), photoThumb = $('studio-photo-thumb'), photoRemove = $('studio-photo-remove');
  const stage = document.querySelector('.studio-stage'), picture = $('studio-image'), loader = $('studio-loader'), status = $('studio-status');
  const editRow = $('studio-edit'), editInput = $('studio-edit-input'), editButton = $('studio-edit-button');
  const list = $('studio-designs'), count = $('studio-count'), orderBar = $('studio-order'), total = $('studio-total'), orderButton = $('studio-order-button'), another = $('studio-another');

  // startOver: nach „Weiteres T-Shirt designen“ beginnt die Schrittanzeige wieder bei 1, obwohl schon Designs da sind.
  const designs = []; let active = -1, busy = false, editingOrder = false, startOver = false;

  const fail = text => { error.textContent = text; error.hidden = !text; };
  const say = text => { status.textContent = text; };
  const ready = () => designs.filter(d => d.blob);
  const chosen = () => editingOrder ? ready() : ready().filter(d => d.selected);

  function render() {
    const d = designs[active];
    picture.src = d?.url || TEMPLATE();
    picture.alt = d ? `Design ${active + 1}: Vorderseite und Rückseite` : model === 'zip' ? 'Weisse Zip-Shirt-Vorlage, Vorderseite und Rückseite' : 'Weisse Polo-Vorlage, Vorderseite und Rückseite';
    editRow.hidden = !d;
    list.replaceChildren();
    designs.forEach((item, i) => {
      const card = document.createElement('div'); card.className = 'studio-card'; card.classList.toggle('is-active', i === active); card.classList.toggle('is-selected', item.selected || editingOrder);
      const view = document.createElement('button'); view.type = 'button'; view.className = 'studio-card-view'; view.setAttribute('aria-pressed', String(i === active)); view.setAttribute('aria-label', `Design ${i + 1} ansehen`);
      const img = document.createElement('img'); img.src = item.url; img.alt = ''; view.append(img);
      view.addEventListener('click', () => { if (busy) return; active = i; render(); zoom(i); });
      // Deutlich sichtbar, ob das Design bestellt wird: grüner Knopf „Im Warenkorb“ bzw. grauer Knopf „In den Warenkorb“.
      // Daneben der Papierkorb zum Löschen. Beim Weiterbearbeiten einer Bestellung bleiben alle Designs in der Bestellung.
      const inCart = item.selected || editingOrder;
      const head = document.createElement('div'); head.className = 'studio-card-head';
      const title = document.createElement('p'); title.className = 'studio-card-title'; title.textContent = `Design ${i + 1}`;
      head.append(title);
      card.append(view);
      // Kleiner roter Löschknopf oben rechts auf dem Bild.
      if (!editingOrder) {
        const del = document.createElement('button'); del.type = 'button'; del.className = 'studio-card-delete'; del.disabled = busy;
        del.textContent = '×'; del.title = 'Design löschen'; del.setAttribute('aria-label', `Design ${i + 1} löschen`);
        del.addEventListener('click', () => removeDesign(i));
        card.append(del);
      }
      const pick = document.createElement('button'); pick.type = 'button'; pick.className = 'studio-card-pick';
      pick.setAttribute('aria-pressed', String(inCart)); pick.disabled = editingOrder || busy;
      pick.textContent = inCart ? '✓ Im Warenkorb' : '+ In den Warenkorb';
      pick.addEventListener('click', () => { if (busy) return; item.selected = !item.selected; render(); });
      card.append(head, pick); list.append(card);
    });
    // „Weiteres T-Shirt designen“ als gleich grosse Karte direkt neben den Designs – bewusst getrennt von den Änderungen.
    if (designs.length) list.append(another);
    another.hidden = !designs.length;
    const n = ready().length, c = chosen().length;
    count.textContent = n ? `${n} Design${n === 1 ? '' : 's'}` : '';
    orderBar.hidden = !n;
    total.textContent = c ? `${c} T-Shirt${c === 1 ? '' : 's'} ausgewählt · ${window.ShirtboxOrder.money(window.ShirtboxOrder.totalForQuantity(c))}` : 'Kein T-Shirt ausgewählt';
    orderButton.textContent = editingOrder ? 'Zurück zur Bestellung →' : c > 1 ? `${c} T-Shirts zur Bestellung →` : 'T-Shirt zur Bestellung →';
    controls();
  }

  function controls() {
    surprise.disabled = busy;
    surprise.textContent = '✨ T-Shirt designen';
    // Während im Änderungsfeld diktiert wird, ist der Knopf schon aktiv – er beendet das Diktat und übernimmt den Text.
    editButton.disabled = busy || (!editInput.value.trim() && dict?.field !== editInput);
    orderButton.disabled = busy || !chosen().length;
    another.disabled = busy;
    stage.classList.toggle('is-empty', !designs.length && !busy);
    stage.classList.toggle('is-blank', active < 0 && !busy);
    loader.hidden = !busy; form.setAttribute('aria-busy', String(busy));
    steps();
  }

  // Schrittanzeige oben: erledigte Schritte mit Haken, der aktuelle leuchtet; das nächste Bedienelement pulsiert sanft.
  const stepItems = [...document.querySelectorAll('#studio-steps [data-step]')], idea = $('studio-idea'), go = $('studio-go'), collection = $('studio-collection');
  const hasIdea = () => !!(keyword.value.trim() || photo.files[0] || styleChoice);
  function steps() {
    const current = designs.length && !startOver ? 4 : !model ? 1 : hasIdea() ? 3 : 2;
    stepItems.forEach(item => {
      const n = Number(item.dataset.step);
      item.classList.toggle('is-done', n < current); item.classList.toggle('is-current', n === current);
      if (n === current) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    });
    modelField.classList.toggle('is-next', current === 1);
    idea.classList.toggle('is-next', current === 2);
    go.classList.toggle('is-next', current === 3 && !busy);
    collection.classList.toggle('is-next', current === 4 && !busy);
    surprise.classList.toggle('is-next', current === 3 && !busy);
    orderButton.classList.toggle('is-next', current === 4 && !busy && chosen().length > 0);
  }
  document.querySelectorAll('#studio-steps [data-goto]').forEach(button => button.addEventListener('click', () => {
    const target = $(button.dataset.goto);
    if (target && target.offsetParent) target.scrollIntoView({behavior: 'smooth', block: 'center'});
  }));
  keyword.addEventListener('input', () => steps());
  photo.addEventListener('change', () => steps());
  // Spracheingabe (Web Speech API, Deutsch) für die Beschreibung und das Änderungsfeld – immer nur ein Diktat gleichzeitig.
  // Gestartet wird über den Mund im Feld. Beenden ist nicht nötig: „T-Shirt designen“ bzw. „Änderungen übernehmen“
  // beenden das Diktat selbst, warten das letzte Wort ab und arbeiten dann mit dem vollständigen Text.
  // Safari/iPad beendet die Erkennung nach kurzen Sprechpausen von sich aus – dann hört sie automatisch weiter zu
  // (bis dreimal hintereinander nichts mehr erkannt wurde).
  // Ohne Unterstützung verschwindet der Mund, und ein Hinweis nennt die Diktierfunktion der Handy-Tastatur.
  const speechStatus = $('studio-speech-status'), editStatus = $('studio-edit-status');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hear = text => { speechStatus.textContent = text; };
  const SPEECH_ERRORS = {'not-allowed': 'Bitte erlauben Sie den Mikrofonzugriff im Browser.', 'service-not-allowed': 'Der Sprachdienst ist hier nicht verfügbar. Nutzen Sie das Mikrofon Ihrer Tastatur.',
    'audio-capture': 'Kein Mikrofon gefunden. Bitte prüfen Sie Ihr Mikrofon.', 'no-speech': 'Keine Sprache erkannt. Bitte nochmals den Mund antippen und sprechen.',
    'network': 'Die Spracherkennung ist nicht erreichbar. Bitte Internetverbindung prüfen.'};
  const FATAL = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network'];
  // dict = laufendes Diktat {button, field, report, changed, show, session, base, want, quiet, error, done}
  let dict = null;
  function endDictation(d, text) {
    if (dict !== d) return;
    dict = null; d.show(false);
    if (text) d.report(text);
    d.done?.();
  }
  // Sofort beenden (z. B. beim Wechsel ins andere Feld): der angezeigte Text bleibt stehen.
  function stopDictation() {
    const d = dict; if (!d) return;
    d.want = false; const s = d.session; d.session = null;
    try { s?.abort(); } catch {}
    endDictation(d);
  }
  // Sauber beenden und die letzten Wörter noch abwarten (höchstens 1,5 Sekunden).
  function finishDictation() {
    const d = dict; if (!d) return Promise.resolve();
    d.want = false;
    return new Promise(resolve => {
      const timer = setTimeout(() => { if (dict === d) { const s = d.session; d.session = null; try { s?.abort(); } catch {} endDictation(d); } resolve(); }, 1500);
      d.done = () => { clearTimeout(timer); resolve(); };
      if (!d.session) { endDictation(d); return; }
      try { d.session.stop(); } catch { d.session = null; endDictation(d); }
    });
  }
  function listen(d) {
    const session = new Recognition(), field = d.field;
    d.session = session; d.base = field.value.trim(); d.heard = false;
    session.lang = 'de-DE'; session.continuous = true; session.interimResults = true;
    session.onresult = event => {
      if (d.session !== session) return;
      let final = '', interim = '';
      for (const result of event.results) (result.isFinal ? (final += result[0].transcript + ' ') : (interim += result[0].transcript + ' '));
      if (final.trim() || interim.trim()) { d.heard = true; d.quiet = 0; }
      field.value = [d.base, final.trim(), interim.trim()].filter(Boolean).join(' ');
      field.scrollTop = field.scrollHeight; d.changed();
    };
    session.onerror = event => {
      if (d.session !== session) return;
      if (FATAL.includes(event.error)) { d.want = false; d.error = SPEECH_ERRORS[event.error]; }
    };
    session.onend = () => {
      if (d.session !== session) return;
      d.session = null;
      if (dict !== d) return;
      if (d.want) {
        d.quiet = d.heard ? 0 : d.quiet + 1;
        if (d.quiet < 3) { try { listen(d); return; } catch { d.session = null; } }
        endDictation(d, d.quiet >= 3 ? 'Diktat beendet. Prüfen Sie den Text – zum Weitersprechen den Mund antippen.' : 'Die Spracheingabe wurde unterbrochen. Bitte nochmals den Mund antippen.');
        return;
      }
      endDictation(d, d.error || '');
    };
    session.start();
  }
  function dictation(button, field, report, changed, hint) {
    const box = field.parentElement, label = button.querySelector('span'), idle = label.textContent;
    const show = on => {
      box.classList.toggle('is-listening', on); button.classList.toggle('is-on', on); button.setAttribute('aria-pressed', String(on));
      label.textContent = on ? 'Stopp' : idle; field.readOnly = on;
      controls();
    };
    button.addEventListener('click', () => {
      if (dict?.button === button) { finishDictation().then(() => report('Diktat beendet. Prüfen Sie den Text – zum Weitersprechen den Mund antippen.')); return; }
      stopDictation(); stopTour(); if (field === keyword) robotStop();
      // Offene Bildschirmtastatur schliessen – auf dem iPad blockiert sie sonst das Mikrofon.
      if (document.activeElement === field) field.blur();
      const d = {button, field, report, changed, show, want: true, quiet: 0, error: ''};
      dict = d; show(true); report(hint);
      // start() muss direkt im Antippen passieren (Safari), darum ohne Warten.
      try { listen(d); } catch { endDictation(d, 'Die Spracheingabe konnte nicht gestartet werden. Bitte nochmals versuchen.'); }
    });
  }
  const speakButton = field => field.parentElement.querySelector('.studio-icon-btn[data-act=speak]');
  if (!Recognition || !window.isSecureContext) {
    speakButton(keyword).hidden = speakButton(editInput).hidden = true;
    hear('Tipp: Sie können Ihre Idee auch mit dem Mikrofon Ihrer Handy-Tastatur einsprechen.');
  } else {
    dictation(speakButton(keyword), keyword, hear, () => { fail(''); steps(); }, 'Ich höre zu … Wenn Sie fertig sind, einfach auf „T-Shirt designen“ tippen.');
    dictation(speakButton(editInput), editInput, text => { editStatus.textContent = text; }, () => controls(), 'Ich höre zu … Wenn Sie fertig sind, einfach auf „Änderungen übernehmen“ tippen.');
  }
  window.addEventListener('pagehide', stopDictation);
  // Tastatur im leeren Feld: Klick setzt den Cursor ins Feld (auf dem Handy öffnet sich die Tastatur).
  for (const field of [keyword, editInput]) field.parentElement.querySelector('.studio-icon-btn[data-act=type]').addEventListener('click', () => field.focus());

  // Grossansicht: Klick auf ein Design unten (oder auf das Vorschaubild) zeigt es bildschirmfüllend. Schliessen per Klick, X oder Esc.
  const lightbox = $('studio-lightbox'), lightboxImg = $('studio-lightbox-img');
  function zoom(i) {
    const d = designs[i]; if (!d || !lightbox.showModal) return;
    lightboxImg.src = d.url; lightboxImg.alt = `Design ${i + 1}: Vorderseite und Rückseite`;
    lightbox.showModal();
  }
  lightbox.addEventListener('click', () => lightbox.close());
  picture.addEventListener('click', () => { if (active >= 0 && !busy) zoom(active); });

  // Foto-Auswahl mit Vorschau.
  // Zu grosses oder falsches Foto: nicht still verwerfen, sondern das Feld rot umranden und den Grund direkt darunter nennen.
  const photoError = $('studio-photo-error');
  const photoProblem = text => {
    photoBox.classList.toggle('is-error', !!text);
    photoError.textContent = text; photoError.hidden = !text;
    if (text) photoBox.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  };
  photo.addEventListener('change', () => {
    fail('');
    const file = photo.files[0];
    if (file && file.size > MAX_PHOTO) {
      photo.value = '';
      photoProblem(`Die maximale Grösse von 5 MB ist überschritten (Ihr Foto: ${(file.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB). Bitte ein kleineres Foto wählen.`);
    } else if (file && !/^image\/(jpeg|png|webp)$/.test(file.type)) {
      photo.value = '';
      photoProblem('Dieses Dateiformat geht leider nicht. Bitte ein JPG-, PNG- oder WebP-Foto wählen.');
    } else if (file) photoProblem('');
    const current = photo.files[0];
    photoBox.classList.toggle('has-photo', !!current);
    photoName.textContent = current ? current.name : 'Eigenes Foto oder Logo hochladen';
    if (photoThumb.src) URL.revokeObjectURL(photoThumb.src);
    photoThumb.src = current ? URL.createObjectURL(current) : '';
    photoRemove.hidden = !current;
    steps(); // nach der Prüfung neu: ein abgelehntes Foto zählt nicht als Idee
  });
  photoRemove.addEventListener('click', () => { photo.value = ''; photoProblem(''); photo.dispatchEvent(new Event('change')); });

  async function template() {
    const response = await fetch(TEMPLATE());
    if (!response.ok) throw Error('Die Shirt-Vorlage konnte nicht geladen werden.');
    return response.blob();
  }

  async function withPhoto(file) {
    const base = await createImageBitmap(await template()), pic = await createImageBitmap(file);
    const canvas = document.createElement('canvas'); canvas.width = base.width; canvas.height = base.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(base, 0, 0);
    const half = canvas.width / 2, scale = Math.min(half * .48 / pic.width, canvas.height * .40 / pic.height);
    const w = pic.width * scale, h = pic.height * scale;
    ctx.drawImage(pic, (half - w) / 2, canvas.height * .36, w, h); base.close(); pic.close();
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('Das Foto konnte nicht verarbeitet werden.')), 'image/jpeg', .9));
  }

  // Designstile (Knöpfe derzeit ausgeblendet – ohne Wahl gilt ein zufälliger RANDOM_STYLES-Stil).
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
  // Gilt für jeden Entwurf und jede Änderung: Das Design ist aufgedruckt und endet an der Shirt-Kante.
  const INSIDE = 'WICHTIG: Das gesamte Design liegt vollständig INNERHALB der Shirt-Umrisse, wie aufgedruckt. Motive, Figuren und Körperteile (z. B. Füsse, Hände, Köpfe, Flügel, Schwänze), Schriften, Flammen, Spritzer und Effekte dürfen nie über Kragen, Schultern, Ärmel, Seiten oder Saum hinausragen und nie in den Hintergrund reichen. Was nicht ganz hineinpasst, wird an der Shirt-Kante abgeschnitten oder kleiner dargestellt. Form, Grösse und Position beider Shirts exakt wie in der Vorlage; der graue Hintergrund bleibt leer und unverändert.';

  // Hilft der Kundeneingabe nach: ergänzt Aufbau, Farben, Schrift und Druckqualität zu einem vollständigen Briefing.
  // Ein eigenes Textfeld gibt es nicht mehr: Schriftzüge nennt die Kundschaft direkt in der Beschreibung.
  function surprisePrompt(word, hasPhoto) {
    let p = `Gestalte als erfahrener Designer ein hochwertiges, rundum bedrucktes 360-Grad-${MODELS[model].cut} auf der Vorlage (links Vorderseite, rechts Rückseite) mit zusammenhängendem Design über Vorderseite, Rückseite, Kragen und Ärmel. `;
    const wish = word ? `Kundenwunsch: "${word}". Treu umsetzen und fehlende Details (Farben, Motive, Muster, Komposition) professionell ergänzen. ` : '';
    // Foto-Regel: das Foto erscheint genau einmal und originalgetreu; die übrigen Flächen setzen nur Farben und Muster fort.
    if (hasPhoto) p += `Das hochgeladene Foto (auf der Vorlage vorne platziert) ist die verbindliche Referenz für das Hauptmotiv (Person, Tier, Logo oder Objekt): originalgetreu übernehmen – Gesichter, Personen und Logos NICHT verändern, nicht neu zeichnen, nicht ersetzen –, sauber freistellen und harmonisch ins Design einbetten. Das Fotomotiv erscheint auf dem ganzen Shirt GENAU EINMAL: standardmässig auf der Vorderseite, oder an der Stelle, die der Kundenwunsch ausdrücklich nennt. Keine Wiederholung, Spiegelung oder zweite Version der Person bzw. des Motivs auf Rückseite, Ärmeln oder Seiten. ${wish}`;
    else if (word) p += wish;
    else p += 'Entwickle ein ausdrucksstarkes, überraschendes Motiv, das zum gewählten Stil passt. ';
    p += `Designstil: ${STYLES[styleChoice]?.brief || RANDOM_STYLES[Math.floor(Math.random() * RANDOM_STYLES.length)]} `;
    p += hasPhoto
      ? 'Aufbau: EIN zusammenhängendes Design wie aus einem Guss, nicht zwei unabhängige Bilder. Die Rückseite ist die natürliche Fortsetzung der Vorderseite: dieselben Farben, Muster, Hintergrund-Elemente und Effekte laufen harmonisch weiter – ohne Personen oder Gesichter (ausser der Kundenwunsch verlangt sie ausdrücklich dort). Schultern, Ärmel, Seiten und Kragen verbinden Vorder- und Rückseite nahtlos; keine abgeschnittenen oder verzerrten Motive. Schriftzüge aus dem Kundenwunsch an der genannten Stelle (sonst gut lesbar auf der Rückseite). Höchstens 3–4 harmonische Hauptfarben mit gutem Kontrast. '
      : 'Aufbau: EIN zusammenhängendes Design wie aus einem Guss: Vorderseite mit klarem Blickfang auf Brusthöhe, Rückseite mit dem grössten Hauptmotiv, Ärmel, Seiten und Kragen mit passenden Akzenten oder Mustern, die alles nahtlos verbinden. Höchstens 3–4 harmonische Hauptfarben mit gutem Kontrast. ';
    p += word ? 'Schrift: Nur Texte drucken, die der Kundenwunsch ausdrücklich als Schriftzug nennt (z. B. in Anführungszeichen oder „mit Schriftzug …“) – genau so, Buchstabe für Buchstabe korrekt, gut lesbar und an der gewünschten Stelle. Die Beschreibung selbst NICHT als Schrift drucken; sonst keine weiteren Wörter. ' : 'Keine Schriftzüge oder Wörter auf das Shirt setzen, ausser sie sind Teil des Fotos. ';
    return p + INSIDE + ` Keine rechteckige Foto-Auflage, keine Marken-Logos, keine Wasserzeichen. Shirt-Schnitt (${MODELS[model].cut}), Perspektive und Vorlage beibehalten. Druckfertige, professionelle Qualität. Variante ${Date.now()}`;
  }

  // Modell-Knöpfe: genau eines muss vor dem Generieren gewählt sein.
  const modelField = $('studio-model-field'), modelButtons = [...document.querySelectorAll('#studio-models [data-model]')];
  modelButtons.forEach(button => button.addEventListener('click', () => {
    if (busy) return;
    model = button.dataset.model;
    modelButtons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    if (modelField.classList.contains('attention')) fail('');
    modelField.classList.remove('attention');
    if (active < 0) render(); else steps();
    tour();
  }));

  // Führung nach der ersten Modellwahl: Roboter mit Sprechblase, Foto-Feld und Eingabefeld
  // leuchten nacheinander je 2 Sekunden auf – immer wieder von vorne, bis man ins Eingabefeld klickt (oder dort etwas steht).
  // Nur in der ersten Runde scrollt die Seite mit; danach nicht mehr, damit niemand beim Scrollen gestört wird.
  let toured = false, tourTimer = null;
  function stopTour() {
    clearTimeout(tourTimer); tourTimer = null;
    document.querySelectorAll('#studio-idea .is-lit').forEach(el => el.classList.remove('is-lit'));
  }
  function tour() {
    if (toured || keyword.value.trim()) return;
    toured = true;
    const parts = [$('studio-guide'), photoBox, keyword].filter(Boolean);
    let i = 0;
    const next = () => {
      if (keyword.value.trim()) { stopTour(); return; }
      parts.forEach(p => p.classList.remove('is-lit'));
      const el = parts[i % parts.length]; el.classList.add('is-lit');
      if (i < parts.length) el.scrollIntoView({behavior: 'smooth', block: 'nearest'});
      i++; tourTimer = setTimeout(next, 2000);
    };
    tourTimer = setTimeout(next, 700);
  }
  ['pointerdown', 'focus'].forEach(type => keyword.addEventListener(type, stopTour));
  // Roboter „schreibt“ seine Nachricht Buchstabe für Buchstabe (sein Mund bewegt sich dabei), wartet und beginnt von vorne –
  // bis man ins Eingabefeld klickt; dann bleibt der ganze Text stehen. Text aus .studio-robot-source (von language.js übersetzbar).
  const robot = $('studio-guide'), robotSource = robot.querySelector('.studio-robot-source');
  const [typedHead, typedTail] = robot.querySelectorAll('.studio-robot-typed > strong, .studio-robot-typed > span');
  const robotText = () => [robotSource.querySelector('strong').textContent, ' ' + robotSource.querySelector('span').textContent];
  let robotTimer = null, robotDone = false;
  function robotType() {
    clearTimeout(robotTimer);
    const [head, tail] = robotText();
    if (robotDone || matchMedia('(prefers-reduced-motion: reduce)').matches) { typedHead.textContent = head; typedTail.textContent = tail; robot.classList.remove('is-typing'); return; }
    let n = 0; typedHead.textContent = typedTail.textContent = ''; robot.classList.add('is-typing');
    const step = () => {
      n++; typedHead.textContent = head.slice(0, n); typedTail.textContent = n > head.length ? tail.slice(0, n - head.length) : '';
      if (n < head.length + tail.length) robotTimer = setTimeout(step, 42);
      else { robot.classList.remove('is-typing'); robotTimer = setTimeout(robotType, 6000); }
    };
    robotTimer = setTimeout(step, 500);
  }
  function robotStop() { robotDone = true; robotType(); }
  robotType();
  ['pointerdown', 'focus'].forEach(type => keyword.addEventListener(type, robotStop)); keyword.addEventListener('input', () => { if (keyword.value.trim()) stopTour(); });

  // Stil-Knöpfe: einer aktiv, erneuter Klick hebt die Auswahl auf.
  const styleButtons = [...document.querySelectorAll('#studio-styles [data-style]')];
  styleButtons.forEach(button => button.addEventListener('click', () => {
    styleChoice = styleChoice === button.dataset.style ? '' : button.dataset.style;
    styleButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.style === styleChoice)));
    steps();
  }));

  async function request(prompt, image) {
    const body = new FormData(); body.set('prompt', prompt.slice(0, MAX_PROMPT)); body.set('mode', image ? 'edit' : 'new');
    if (image) body.set('image', image, image.type === 'image/png' ? 'shirtbox.png' : 'shirtbox.jpg');
    const response = await fetch(`${API}/generate`, {method: 'POST', body, signal: AbortSignal.timeout(195000)});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(result.error || 'Die Bildgestaltung ist momentan nicht verfügbar.');
    const b64 = result.data?.[0]?.b64_json; if (typeof b64 !== 'string' || !b64) throw Error('Es wurde kein Bild zurückgegeben.');
    const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Der Worker liefert verlustfreies PNG (ältere Worker-Versionen JPG) – Typ anhand der Datei erkennen.
    return new Blob([bytes], {type: bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg'});
  }

  // Sicherheitsnetz: Nichts darf ausserhalb der Shirts stehen (z. B. ein Fuss, der über den Saum ragt).
  // Der Umriss der leeren Vorlage wird auf jedes Shirt im KI-Bild ausgerichtet; alles ausserhalb wird durch den grauen Hintergrund ersetzt.
  // Passt der Umriss nicht sicher (KI hat die Form stark verändert), bleibt das Bild unverändert.
  const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const pixels = (img, w, h) => { const c = canvasOf(w, h), x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
  // 1 = Shirt, 0 = Hintergrund (vom Bildrand aus erreichbare, randfarbene Fläche).
  // Zusätzlich: Randfarbe und wie stark der Rand davon abweicht (für die Prüfung, ob der Hintergrund noch grau und ruhig ist).
  function silhouette(data, w, h) {
    let r = 0, g = 0, b = 0, n = 0;
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
    for (const i of border) { r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; n++; }
    r /= n; g /= n; b /= n;
    const bg = i => { const dr = data[i * 4] - r, dg = data[i * 4 + 1] - g, db = data[i * 4 + 2] - b; return dr * dr + dg * dg + db * db < 2025; };
    const m = new Uint8Array(w * h).fill(1), stack = [];
    const visit = i => { if (m[i] && bg(i)) { m[i] = 0; stack.push(i); } };
    for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop(), x = i % w;
      if (x > 0) visit(i - 1); if (x < w - 1) visit(i + 1); if (i >= w) visit(i - w); if (i < w * (h - 1)) visit(i + w);
    }
    m.color = [r, g, b]; m.calm = border.filter(i => !m[i]).length / border.length;
    return m;
  }
  // Vorlage: nur die zwei grössten zusammenhängenden Flächen (die beiden Shirts) behalten, helle Flecken im Hintergrund zählen nicht.
  function twoShirts(m, w, h) {
    const label = new Int32Array(w * h), sizes = [0], stack = [];
    for (let s = 0; s < m.length; s++) {
      if (!m[s] || label[s]) continue;
      const id = sizes.length; let n = 0; label[s] = id; stack.push(s);
      while (stack.length) {
        const i = stack.pop(), x = i % w; n++;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < m.length && m[j] && !label[j]) { label[j] = id; stack.push(j); }
      }
      sizes.push(n);
    }
    const keep = sizes.map((n, id) => [n, id]).slice(1).sort((a, b) => b[0] - a[0]).slice(0, 2).map(e => e[1]);
    for (let i = 0; i < m.length; i++) if (m[i] && !keep.includes(label[i])) m[i] = 0;
    return m;
  }
  // Ausrichtung pro Shirt (links/rechts): Schwerpunkt und Fläche als Start, dann Feinsuche nach der besten Überdeckung.
  function align(out, ow, oh, tpl, tw, th, half) {
    const ox0 = half * ow / 2, ox1 = ox0 + ow / 2, tx0 = half * tw / 2, tx1 = tx0 + tw / 2;
    const moments = (m, w, h, x0, x1) => { let a = 0, sx = 0, sy = 0; for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) if (m[y * w + x]) { a++; sx += x; sy += y; } return {a, cx: sx / a, cy: sy / a}; };
    const mo = moments(out, ow, oh, ox0, ox1), mt = moments(tpl, tw, th, tx0, tx1);
    if (!mo.a || !mt.a) return null;
    const iou = (s, tx, ty) => {
      let inter = 0, union = 0;
      for (let y = 0; y < oh; y++) for (let x = ox0; x < ox1; x++) {
        const u = Math.round((x - tx) / s), v = Math.round((y - ty) / s);
        const t = u >= tx0 && u < tx1 && v >= 0 && v < th && tpl[v * tw + u], o = out[y * ow + x];
        if (t && o) inter++; if (t || o) union++;
      }
      return union ? inter / union : 0;
    };
    const s0 = Math.sqrt(mo.a / mt.a);
    let best = {score: -1};
    for (let s = s0 * .94; s <= s0 * 1.061; s += s0 * .02) {
      const bx = mo.cx - s * mt.cx, by = mo.cy - s * mt.cy;
      for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) {
        const score = iou(s, bx + dx, by + dy);
        if (score > best.score) best = {score, s, tx: bx + dx, ty: by + dy};
      }
    }
    return best;
  }
  const templateMasks = {};
  async function keepInside(blob, modelKey) {
    try {
      const src = MODELS[modelKey]?.template || MODELS.polo.template;
      const [shirt, tpl] = await Promise.all([createImageBitmap(blob), fetch(src).then(r => r.blob()).then(b => createImageBitmap(b))]);
      const W = shirt.width, H = shirt.height, TW = tpl.width, TH = tpl.height;
      const ow = 256, oh = Math.round(H * ow / W), tw = 256, th = Math.round(TH * tw / TW);
      const out = silhouette(pixels(shirt, ow, oh), ow, oh), small = silhouette(pixels(tpl, tw, th), tw, th);
      twoShirts(small, tw, th);
      // Nur eingreifen, wenn der Hintergrund noch grau wie in der Vorlage ist und beide Umrisse sehr gut passen.
      const sameBack = Math.hypot(...out.color.map((v, i) => v - small.color[i])) < 40 && out.calm > .9;
      const fits = sameBack ? [0, 1].map(half => align(out, ow, oh, small, tw, th, half)) : [];
      if (!sameBack || fits.some(f => !f || f.score < .8)) { shirt.close(); tpl.close(); return blob; }
      // Vorlagen-Umriss in voller Grösse als Maske (einmal pro Modell).
      if (!templateMasks[src]) {
        const m = twoShirts(silhouette(pixels(tpl, TW, TH), TW, TH), TW, TH), c = canvasOf(TW, TH), x = c.getContext('2d'), img = x.createImageData(TW, TH);
        for (let i = 0; i < m.length; i++) if (m[i]) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = img.data[i * 4 + 3] = 255; }
        x.putImageData(img, 0, 0); templateMasks[src] = c;
      }
      const mask = canvasOf(W, H), mx = mask.getContext('2d'), back = canvasOf(W, H), bx = back.getContext('2d');
      // Hintergrund: grauer Verlauf wie in der Vorlage (Mitte zwischen den Shirts heller, Ecken dunkler) – ohne Shirts.
      const probe = canvasOf(TW, TH), px = probe.getContext('2d', {willReadFrequently: true}); px.drawImage(tpl, 0, 0);
      const rgb = d => `rgb(${d[0]},${d[1]},${d[2]})`, mid = px.getImageData(TW / 2 - 2, TH / 2, 4, 4).data, edge = px.getImageData(4, 4, 4, 4).data;
      const grad = bx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
      grad.addColorStop(0, rgb(mid)); grad.addColorStop(1, rgb(edge)); bx.fillStyle = grad; bx.fillRect(0, 0, W, H);
      const grow = Math.max(3, Math.round(W * .004)); // schmaler Rand, damit die Shirt-Kante selbst nie angeschnitten wird
      fits.forEach((f, half) => {
        const k = f.s * (W / ow) / (TW / tw), dx = f.tx * W / ow, dy = f.ty * H / oh;
        mx.save(); mx.beginPath(); mx.rect(half * W / 2, 0, W / 2, H); mx.clip(); mx.setTransform(k, 0, 0, k, dx, dy);
        for (let a = 0; a < 16; a++) mx.drawImage(templateMasks[src], Math.cos(a * Math.PI / 8) * grow / k, Math.sin(a * Math.PI / 8) * grow / k);
        mx.drawImage(templateMasks[src], 0, 0);
        mx.restore();
      });
      const front = canvasOf(W, H), fx = front.getContext('2d');
      fx.drawImage(shirt, 0, 0); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(mask, 0, 0);
      bx.drawImage(front, 0, 0); shirt.close(); tpl.close();
      // Verlustfrei speichern: keine zusätzliche JPG-Kompression des Designs.
      return await new Promise(resolve => back.toBlob(b => resolve(b || blob), 'image/png'));
    } catch { return blob; }
  }

  // Ergebnis-Ansicht: Sobald ein Shirt fertig ist, blendet das Handy (eine Spalte) Überschrift und Formular aus –
  // das Shirt steht oben, darunter Änderungen / weiteres Shirt, darunter die Bestellung. Zurück nur über „Weiteres T-Shirt designen“.
  const studio = form.closest('.studio'), oneColumn = matchMedia('(max-width: 900px)');
  const showResult = on => studio.classList.toggle('is-result', on);

  // Computer: rechte Seite senkrecht mittig zwischen Kopf- und Fusszeile festhalten (CSS position:sticky, Abstand hier berechnet).
  // Ist sie höher als der Bildschirm, bleibt sie oben unter der Kopfzeile stehen.
  // Höhe bewusst über 100svh (kleinster sichtbarer Bereich) gemessen: Auf dem iPad ändert sich innerHeight beim Scrollen
  // (Safari blendet die Adressleiste ein/aus) – sonst springt die Vorschau mit.
  const wide = matchMedia('(min-width: 901px)');
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:100vh;height:100svh;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  function placeStage() {
    if (!wide.matches) { stage.style.removeProperty('--stage-top'); stage.style.removeProperty('--stage-max'); return; }
    const head = document.querySelector('.masthead')?.offsetHeight || 0, footer = document.querySelector('.site-footer');
    const foot = footer && ['sticky', 'fixed'].includes(getComputedStyle(footer).position) ? footer.offsetHeight : 0;
    const room = Math.min(window.innerHeight, probe.offsetHeight || window.innerHeight) - head - foot;
    const max = Math.max(260, room - 24), top = `${Math.round(head + Math.max(12, (room - Math.min(stage.offsetHeight, max)) / 2))}px`;
    // Nur bei Änderung setzen – sonst meldet der ResizeObserver eine Endlosschleife.
    if (stage.style.getPropertyValue('--stage-max') !== `${max}px`) stage.style.setProperty('--stage-max', `${max}px`);
    if (stage.style.getPropertyValue('--stage-top') !== top) stage.style.setProperty('--stage-top', top);
  }
  new ResizeObserver(placeStage).observe(stage);
  window.addEventListener('resize', placeStage); wide.addEventListener('change', placeStage);

  // T-Shirt-Vorschau mittig in den sichtbaren Bereich unter der fixen Kopfzeile scrollen.
  function showPreview() {
    if (studio.classList.contains('is-result') && oneColumn.matches) { window.scrollTo({top: 0, behavior: 'smooth'}); return; }
    // Computer/iPad quer: rechte Seite in sich nach oben, damit das Shirt sichtbar ist.
    if (wide.matches && stage.scrollTop) stage.scrollTo({top: 0, behavior: 'smooth'});
    const figure = picture.closest('figure'); if (!figure) return;
    const top = document.querySelector('.masthead')?.getBoundingClientRect().bottom || 0;
    const bottom = window.innerHeight;
    const box = figure.getBoundingClientRect(), room = bottom - top;
    const target = box.height + 16 > room ? top + 8 : top + (room - box.height) / 2;
    window.scrollBy({top: box.top - target, behavior: 'smooth'});
  }

  async function run(task) {
    busy = true; fail(''); say(''); render();
    requestAnimationFrame(showPreview);
    try { await task(); }
    catch (e) { fail(['TimeoutError', 'AbortError'].includes(e.name) ? 'Die Anfrage dauert zu lange. Bitte später erneut versuchen.' : e.message === 'Failed to fetch' ? 'Die Bildgestaltung ist nicht erreichbar. Bitte später erneut versuchen.' : e.message); }
    finally { busy = false; render(); requestAnimationFrame(showPreview); }
  }

  // Läuft noch ein Diktat, wird es zuerst sauber beendet (letzte Wörter abwarten) – kein extra „Stopp“ nötig.
  let finishing = false;
  async function afterDictation() {
    if (!dict) return true;
    if (finishing) return false;
    finishing = true;
    try { await finishDictation(); } finally { finishing = false; }
    return !busy;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !(await afterDictation())) return;
    if (!speakButton(keyword).hidden) hear('');
    const word = keyword.value.trim(), file = photo.files[0];
    if (!model) { fail('Bitte wählen Sie zuerst ein Shirt-Modell (Polo-Shirt oder Zip-Shirt).'); modelField.classList.add('attention'); modelField.scrollIntoView({behavior: 'smooth', block: 'center'}); modelButtons[0].focus({preventScroll: true}); return; }
    if (!word && !file && !styleChoice) { fail('Bitte beschreiben Sie Ihr Design oder laden Sie ein Foto hoch.'); keyword.focus(); return; }
    if (!rights.checked) { fail('Bitte bestätigen Sie Ihre Inhalts- und Bildrechte.'); rights.closest('label').classList.add('attention'); rights.focus(); return; }
    run(async () => {
      // Das Polo-Shirt holt der Worker selbst; alle anderen Modelle schicken ihre leere Vorlage mit.
      const blob = await keepInside(await request(surprisePrompt(word, !!file), file ? await withPhoto(file) : model === 'polo' ? null : await template()), model);
      const summary = [`Modell: ${MODELS[model].label}`, styleChoice && `Stil: ${STYLES[styleChoice].label}`, word && `Design: ${word}`, file && 'mit eigenem Foto'].filter(Boolean).join(' · ');
      designs.push({blob, url: URL.createObjectURL(blob), prompt: `KI-Design – ${summary}`, model, selected: true, number: editingOrder ? Math.max(0, ...designs.map(d => d.number || 0)) + 1 : null});
      active = designs.length - 1; startOver = false; showResult(true);
      say(`Design ${active + 1} ist fertig. Sie können es unten noch ändern oder direkt bestellen.`);
    });
  });

  // Weiteres T-Shirt: alle Eingaben (Modell, Stil, Beschreibung, Foto) zurücksetzen und oben bei Schritt 1 neu beginnen.
  // Die fertigen Designs bleiben unten in „Ihre T-Shirts“ erhalten.
  another.addEventListener('click', () => { if (!busy) startNew(); });
  function startNew() {
    model = ''; modelButtons.forEach(b => b.setAttribute('aria-pressed', 'false'));
    styleChoice = ''; styleButtons.forEach(b => b.setAttribute('aria-pressed', 'false'));
    stopTour(); toured = false; robotDone = false; robotType();
    stopDictation(); if (!speakButton(keyword).hidden) hear(''); keyword.value = ''; photo.value = ''; photoProblem(''); photo.dispatchEvent(new Event('change'));
    editInput.value = '';
    fail(''); say('');
    // Vorschau wieder leer (Vorlage vorne/hinten) statt des letzten Designs.
    active = -1; startOver = true; showResult(false); render();
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  // Design löschen (Papierkorb auf der Karte). War es das letzte, beginnt man direkt mit einem neuen Shirt.
  function removeDesign(i) {
    const d = designs[i]; if (busy || !d) return;
    if (!confirm(document.documentElement.lang === 'en' ? `Really delete design ${i + 1}?` : `Design ${i + 1} wirklich löschen?`)) return;
    URL.revokeObjectURL(d.url); designs.splice(i, 1);
    if (!designs.length) { startNew(); return; }
    if (active > i || active >= designs.length) active--;
    say(''); render();
  }
  rights.addEventListener('change', () => { rights.closest('label').classList.remove('attention'); if (rights.checked && error.textContent.includes('Bildrechte')) fail(''); });

  editInput.addEventListener('input', controls);
  editInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editButton.click(); } });
  editButton.addEventListener('click', async () => {
    const spoke = dict?.field === editInput;
    if (busy || !designs[active] || !(await afterDictation())) return;
    const d = designs[active], change = editInput.value.trim();
    if (!d || !change) { if (!change && spoke) editStatus.textContent = 'Keine Sprache erkannt. Bitte nochmals den Mund antippen und sprechen.'; return; }
    editStatus.textContent = '';
    run(async () => {
      const cut = MODELS[d.model]?.cut;
      const blob = await keepInside(await request(`Bisheriges Shirt und Gestaltung beibehalten${cut ? ` (Schnitt: ${cut})` : ''}. Ändere nur Folgendes: ${change}\nErhalte alle anderen Merkmale. ${INSIDE}`, d.blob), d.model);
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
      items.forEach((e, i) => { const blob = e.blob || e; if (blob instanceof Blob) designs.push({blob, url: URL.createObjectURL(blob), prompt: e.prompt || '', model: /Modell: Zip-Shirt/.test(e.prompt || '') ? 'zip' : 'polo', selected: true, number: e.number || i + 1}); });
      editingOrder = true; showResult(true); active = designs.findIndex(d => String(d.number) === number);
      say('Ihr Design wurde geladen. Beschreiben Sie unten die gewünschte Änderung.');
      render(); editInput.focus({preventScroll: true});
    } catch { fail('Das gespeicherte Design konnte nicht geladen werden.'); }
  }

  render(); restore();
})();
