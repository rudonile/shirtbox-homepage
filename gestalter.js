// ShirtBOX Gestalter: Beschreibung und Foto -> KI-Design, beliebig viele T-Shirts auswählen und bestellen.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('studio-form'); if (!form) return;
  const API = 'https://black-snow-2fdf.r-n.workers.dev';
  const MAX_PHOTO = 5 * 1024 * 1024;
  // Obergrenze des live laufenden Workers (black-snow-2fdf): Anfragen über 2000 Zeichen lehnt er ab
  // („3 bis 2000 Zeichen“). Darum bauen surprisePrompt() und die Änderungsanfrage ihre Anweisung so, dass sie hineinpasst.
  const MAX_PROMPT = 2000;
  const TOO_LONG = 'Ihre Beschreibung ist zu lang. Bitte kürzer fassen (etwa 800 Zeichen).';
  // Hängt Zusatzregeln nur an, wenn noch Platz ist – der Worker wiederholt die wichtigsten Regeln ohnehin selbst.
  const fit = (core, ...extras) => { let p = core; for (const x of extras) if ((p + ' ' + x).length <= MAX_PROMPT) p += ' ' + x; if (p.length > MAX_PROMPT) throw Error(TOO_LONG); return p; };
  // Shirt-Modelle: leere Vorlage (links vorne, rechts hinten) und Schnittbeschreibung für die KI.
  // Vorlagen *-vorlage-3x2.jpg (1536×1024, gleiches Format wie das KI-Ergebnis): In den alten *-api-vorlage.jpg (1536×1228)
  // berührten sich die inneren Ärmel in der Bildmitte und die äusseren lagen fast am Bildrand – die KI übernahm das als
  // spitz zusammenlaufende Ärmel und Stoffbrücken. Neu: 96 px Abstand, gleichmässiges Grau, freigestellt ohne Säume
  // (erstellt mit _einrichtung/vorlagen-3x2-erstellen.ps1). Die alten Dateien bleiben für andere Seiten bestehen.
  const MODELS = {
    polo: {label: 'Polo-Shirt', template: 'anleitung/polo-vorlage-3x2.jpg?v=20261116', cut: 'Sportpolo mit Polo-Kragen und Knopfleiste'},
    zip: {label: 'Zip-Shirt', template: 'anleitung/zip-vorlage-3x2.jpg?v=20261116', cut: 'Sport-Jersey mit niedrigem Stehkragen und kurzem Reissverschluss vorne (kein Polo-Kragen, keine Knöpfe)'},
    tshirt: {label: 'T-Shirt', template: 'anleitung/tshirt-vorlage-3x2.jpg?v=20261116', cut: 'Klassisches Rundhals-T-Shirt mit regulärer Passform (kein Polo-Kragen, keine Knopfleiste, kein Reissverschluss)'},
    oversize: {label: 'Oversize T-Shirt', template: 'anleitung/oversize-vorlage-3x2.jpg?v=20261116', cut: 'Weites Oversize-Rundhals-T-Shirt mit überschnittenen Schultern und weitem geradem Schnitt (kein Polo-Kragen, keine Knopfleiste)'}
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
  // Fehlende Angabe: hinscrollen und deutlich markieren (window.sbMissing aus navigation.js).
  const en = () => document.documentElement.lang === 'en';
  const missing = (el, focus, text) => { if (window.sbMissing) window.sbMissing(el, focus, text); else { el?.scrollIntoView({behavior: 'smooth', block: 'center'}); focus?.focus({preventScroll: true}); } };
  const say = text => { status.textContent = text; };
  const ready = () => designs.filter(d => d.blob);
  const chosen = () => editingOrder ? ready() : ready().filter(d => d.selected);

  function render() {
    const d = designs[active];
    picture.src = d?.url || TEMPLATE();
    picture.alt = d ? `Design ${active + 1}: Vorderseite und Rückseite` : `Weisse ${MODELS[model]?.label || 'Polo-Shirt'}-Vorlage, Vorderseite und Rückseite`;
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
      // Über dem Bild: „Bild weiter bearbeiten“ – holt das Design nach oben in die Vorschau und führt zum Änderungsfeld.
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'studio-card-edit'; edit.disabled = busy;
      edit.textContent = '✎ Bild weiter bearbeiten'; edit.setAttribute('aria-label', `Design ${i + 1} weiter bearbeiten`);
      edit.addEventListener('click', () => editDesign(i));
      card.append(edit, view);
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
    // Ohne Designs keine leere Sammel-Box unter der Vorschau (Element bleibt erhalten, nur unsichtbar).
    collection.hidden = !designs.length;
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
    // Ohne Eingabe bzw. ohne gewähltes Shirt bleiben die Knöpfe anklickbar (nur grau dargestellt): Ein Klick zeigt dann,
    // was noch fehlt, statt einfach nichts zu tun.
    editButton.disabled = busy; editButton.setAttribute('aria-disabled', String(!editInput.value.trim() && dict?.field !== editInput));
    orderButton.disabled = busy; orderButton.setAttribute('aria-disabled', String(!chosen().length));
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
  const FATAL = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'];
  // Handy/Tablet: Android-Chrome und iOS-Safari liefern im Dauer-Modus (continuous) oft gar keinen Text.
  // Dort wird darum Satz für Satz erkannt und nach jedem Satz automatisch weiter zugehört.
  const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || matchMedia('(pointer: coarse)').matches;
  // Testmodus: Adresse mit ?sprachtest öffnen – dann zeigt die Statuszeile, was der Browser meldet.
  const DEBUG = /[?&]sprachtest\b/.test(location.search);
  let debugLog = [];
  const trace = (d, text) => { if (!DEBUG) return; debugLog = [...debugLog.slice(-7), text]; d.report('Sprachtest (' + (MOBILE ? 'Handy' : 'Computer') + '): ' + debugLog.join(' → ')); };
  // dict = laufendes Diktat {button, field, report, changed, show, session, base, want, quiet, error, done}
  let dict = null;
  function endDictation(d, text) {
    if (dict !== d) return;
    clearTimeout(d.watchdog);
    dict = null; d.show(false);
    if (text) d.report(text);
    d.done?.();
  }
  function stopDictation() {
    const d = dict; if (!d) return;
    d.want = false; const s = d.session; d.session = null;
    try { s?.abort(); } catch {}
    endDictation(d);
  }
  function finishDictation() {
    const d = dict; if (!d) return Promise.resolve();
    d.want = false;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (dict === d) { const s = d.session; d.session = null; try { s?.abort(); } catch {} endDictation(d); }
        resolve();
      }, 1500);
      d.done = () => { clearTimeout(timer); resolve(); };
      if (!d.session) { endDictation(d); return; }
      try { d.session.stop(); } catch { d.session = null; endDictation(d); }
    });
  }
  function listen(d) {
    const session = new Recognition(), field = d.field;
    d.session = session;
    d.base = field.value.trim();
    d.lastFinal = ''; d.heard = false; d.started = false;
    session.lang = 'de-DE';
    // iOS Safari does not reliably support continuous speech recognition.
    // Do not restart automatically on iOS: subsequent starts require a fresh user gesture.
    session.continuous = !MOBILE;
    session.interimResults = true; session.maxAlternatives = 1;
    const armWatchdog = () => {
      clearTimeout(d.watchdog);
      d.watchdog = setTimeout(() => {
        if (dict !== d || d.session !== session || !d.want) return;
        d.want = false; d.error = 'Keine Antwort vom Sprachdienst. Bitte das Mikrofon Ihrer Tastatur verwenden oder erneut versuchen.';
        try { session.abort(); } catch {}
        endDictation(d, d.error);
      }, 12000);
    };
    session.onstart = () => {
      if (d.session !== session) return;
      d.started = true; d.show(true);
      trace(d, 'start');
      if (!DEBUG) d.report(d.hint);
      armWatchdog();
    };
    session.onaudiostart = () => trace(d, 'Mikrofon an');
    session.onspeechstart = () => { trace(d, 'Sprache erkannt'); armWatchdog(); };
    session.onnomatch = () => trace(d, 'nicht verstanden');
    session.onresult = event => {
      if (d.session !== session) return;
      trace(d, 'Text'); armWatchdog();
      let final = '', interim = '';
      for (const result of event.results) {
        if (!result[0]) continue;
        (result.isFinal ? (final += result[0].transcript + ' ') : (interim += result[0].transcript + ' '));
      }
      if (final.trim() || interim.trim()) d.heard = true;
      d.lastFinal = final.trim();
      field.value = [d.base, final.trim(), interim.trim()].filter(Boolean).join(' ');
      field.scrollTop = field.scrollHeight; d.changed();
    };
    session.onerror = event => {
      if (d.session !== session) return;
      trace(d, 'Fehler ' + event.error);
      d.want = false;
      d.error = SPEECH_ERRORS[event.error] || (event.error === 'language-not-supported'
        ? 'Diese Sprache wird vom Browser nicht unterstützt. Bitte das Mikrofon Ihrer Tastatur verwenden.'
        : 'Die Spracherkennung konnte nicht gestartet werden. Bitte das Mikrofon Ihrer Tastatur verwenden.');
      // On some iOS versions onend is not delivered after an error.
      setTimeout(() => { if (dict === d && d.session === session) endDictation(d, d.error); }, 400);
    };
    session.onend = () => {
      if (d.session !== session) return;
      trace(d, 'Ende'); clearTimeout(d.watchdog);
      // Keep only confirmed words; never delete existing text on a failed attempt.
      field.value = [d.base, d.lastFinal].filter(Boolean).join(' ');
      d.changed();
      d.session = null;
      if (dict !== d) return;
      endDictation(d, d.error || (d.heard
        ? 'Diktat beendet. Prüfen Sie den Text – zum Weitersprechen den Mund antippen.'
        : 'Keine Sprache erkannt. Bitte erneut antippen oder das Mikrofon Ihrer Tastatur verwenden.'));
    };
    session.start();
  }
  function dictation(button, field, report, changed, hint) {
    const box = field.parentElement, label = button.querySelector('span'), idle = label.textContent;
    const show = on => {
      box.classList.toggle('is-listening', on); button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
      label.textContent = on ? 'Stopp' : idle;
      field.readOnly = on; controls();
    };
    button.addEventListener('click', () => {
      // Auf Mobilgeraeten oeffnen beide Symbole nur die Systemtastatur.
      // Diktieren wird ausschliesslich ueber das Mikrofon der Tastatur gestartet.
      if (MOBILE) { stopDictation(); field.focus(); return; }
      if (dict?.button === button) { finishDictation(); return; }
      stopDictation(); stopTour(); if (field === keyword) robotStop();
      if (document.activeElement === field) field.blur();
      const d = {button, field, report, changed, show, hint, want: true, error: '', start: field.value.trim()};
      debugLog = []; dict = d;
      report('Mikrofon wird gestartet …');
      // Must be invoked synchronously inside the user tap on Safari.
      try { listen(d); }
      catch { endDictation(d, 'Die Spracheingabe konnte nicht gestartet werden. Bitte das Mikrofon Ihrer Tastatur verwenden.'); }
    });
  }
  const speakButton = field => field.parentElement.querySelector('.studio-icon-btn[data-act=speak]');
  if (!Recognition || !window.isSecureContext) {
    if (!MOBILE) speakButton(keyword).hidden = speakButton(editInput).hidden = true;
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

  const CENTER_LAYOUT = 'STANDARDPOSITION: Alle Hauptmotive, Tabellen, Listen, Zahlen und Schriftzüge horizontal MITTIG auf der jeweils gewünschten Shirt-Seite ausrichten, ausser der Kunde verlangt ausdrücklich links, rechts oder eine andere Position. Tabellen und Zahlenkolonnen vollständig und mit grosszügigem Sicherheitsabstand zu Seitennähten und Achseln setzen. Nie Buchstaben oder Zahlen um die Seitenkante wickeln oder am Rand abschneiden; bei Platzmangel das gesamte Motiv proportional verkleinern. Shirt-Schnitt und Achselkonturen exakt nach Vorlage, keine zusätzlichen Spitzen, Dreiecke oder Ausstülpungen unter den Ärmeln. Bei Rundhals-T-Shirts und Oversize-T-Shirts niemals einen Polo-Kragen, eine Knopfleiste oder ein weiteres Shirt hinter den beiden Ansichten darstellen. Zwischen Vorder- und Rückseite dürfen keine Stoffreste, zusätzlichen Ärmel oder Bildfragmente erscheinen.';

  // Kompakte Fassung von CENTER_LAYOUT, die immer mitgeht (Schnitt-Treue ist für alle vier Modelle Pflicht).
  // Pflichtsatz bei JEDER Generierung (Neu-Entwurf und Änderung) – steht immer im Kern der Anfrage, nie nur als optionaler Zusatz.
  const FORM_RULE = 'Die ursprüngliche Kleidungsform und Silhouette beibehalten; nur Farben und Aufdruck gestalten. Keine zusätzlichen Stoffteile, veränderten Ärmel oder verformten Nähte erzeugen.';
  // Bewusst knapp (Worker-Grenze 2000 Zeichen, sonst bleibt zu wenig Platz für den Kundenwunsch).
  const SHAPE_RULE = FORM_RULE + ' Keine Stoffdreiecke; die Shirts berühren sich nicht, der graue Hintergrund dazwischen bleibt leer. Motive mittig, nichts am Rand abschneiden.';
  // Zusatz, der per fit() angehängt wird, solange Platz ist.
  const QUALITY_RULE = 'Natürlich gerundete Schultern, saubere Kragen und Ärmelsäume wie in der Vorlage. Gleichmässiger neutralgrauer Studiohintergrund, saubere Kanten ohne helle oder dunkle Ränder.';

  // Hilft der Kundeneingabe nach: ergänzt Aufbau, Farben, Schrift und Druckqualität zu einem vollständigen Briefing.
  // Ein eigenes Textfeld gibt es nicht mehr: Schriftzüge nennt die Kundschaft direkt in der Beschreibung.
  // Bewusst kompakt: Der live Worker nimmt höchstens 2000 Zeichen an (siehe MAX_PROMPT). Die ausführliche Randregel (INSIDE)
  // kommt nur dazu, wenn noch Platz ist – der Worker schickt dieselbe Regel ohnehin in seinen eigenen Anweisungen mit.
  function surprisePrompt(word, hasPhoto) {
    const cut = MODELS[model].cut;
    let p = `Rundum bedrucktes 360-Grad-${cut} auf der Vorlage (links vorne, rechts hinten): EIN zusammenhängendes Design über Vorderseite, Rückseite, Kragen und Ärmel. `;
    // Foto-Regel: das Foto erscheint genau einmal und originalgetreu; die übrigen Flächen setzen nur Farben und Muster fort.
    if (hasPhoto) p += 'Das hochgeladene Foto (vorne auf der Vorlage) ist das Hauptmotiv: originalgetreu übernehmen – Gesichter, Personen und Logos nicht verändern oder neu zeichnen –, sauber freistellen und harmonisch einbetten. Es erscheint GENAU EINMAL (vorne oder wo der Kundenwunsch es nennt), keine Wiederholung auf Rückseite oder Ärmeln. Rückseite, Ärmel und Kragen führen Farben, Muster und Effekte nahtlos fort. ';
    if (word) p += `Kundenwunsch: "${word}". Treu umsetzen, fehlende Details professionell ergänzen. `;
    else if (!hasPhoto) p += 'Entwickle ein ausdrucksstarkes, überraschendes Motiv. ';
    p += `Stil: ${(STYLES[styleChoice]?.brief || RANDOM_STYLES[Math.floor(Math.random() * RANDOM_STYLES.length)]).replace(/\.$/, '')}. `;
    if (!hasPhoto) p += 'Vorderseite mit Blickfang auf Brusthöhe, Rückseite mit dem grössten Hauptmotiv, Ärmel und Kragen mit passenden Akzenten. ';
    p += 'Höchstens 3–4 harmonische Farben. ';
    // Kurze Pflichtregel; die ausführliche CENTER_LAYOUT-Regel kommt unten per fit() dazu, wenn noch Platz ist.
    // (Fest eingebaut sprengte sie mit Foto + Beschreibung immer die 2000-Zeichen-Grenze des Workers.)
    p += SHAPE_RULE + ' ';
    p += word ? 'Schrift nur, wenn der Kundenwunsch ausdrücklich einen Schriftzug nennt – dann Buchstabe für Buchstabe korrekt, gut lesbar, an der genannten Stelle (sonst hinten). Die Beschreibung selbst nicht als Text drucken. ' : 'Keine Schriftzüge ausser im Foto. ';
    p += `Alles bleibt innerhalb der Shirt-Umrisse, grauer Hintergrund leer. Keine rechteckige Foto-Auflage, keine Marken-Logos, keine Wasserzeichen. Druckfertige Qualität. Variante ${Date.now()}`;
    return fit(p, QUALITY_RULE, CENTER_LAYOUT, INSIDE);
  }

  // Modell-Knöpfe: genau eines muss vor dem Generieren gewählt sein.
  const modelField = $('studio-model-field'), modelButtons = [...document.querySelectorAll('#studio-models [data-model]')];
  modelButtons.forEach(button => button.addEventListener('click', () => {
    if (busy) return;
    model = button.dataset.model;
    hoveredModel = null;
    modelButtons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    if (modelField.classList.contains('attention')) fail('');
    modelField.classList.remove('attention');
    if (active < 0) render(); else steps();
    tour();
  }));

  // Maus-Vorschau ohne Auswahl: Klick fixiert das Modell dauerhaft.
  // Bereits generierte Designs bleiben bei Hover unverändert.
  let hoveredModel = null;
  function updateModelPreview() {
    if (busy || active >= 0) return;
    const key = hoveredModel || model || 'polo';
    picture.src = MODELS[key].template;
    picture.alt = `${MODELS[key].label}: Vorderseite und Rückseite`;
  }
  modelButtons.forEach(button => {
    button.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      hoveredModel = button.dataset.model;
      updateModelPreview();
    });
    button.addEventListener('pointerleave', () => {
      hoveredModel = null;
      updateModelPreview();
    });
    button.addEventListener('focus', () => {
      hoveredModel = button.dataset.model;
      updateModelPreview();
    });
    button.addEventListener('blur', () => {
      hoveredModel = null;
      updateModelPreview();
    });
  });

  // Nur Touch (Smartphone/Tablet): Antippen öffnet zuerst eine grosse Vorschau mit ✓ (auswählen) und ✕ (abbrechen).
  // Maus, Stift und Tastatur behalten die bisherige Sofort-Auswahl. Die bestehende Klick-Logik oben bleibt unverändert:
  // Erst ✓ löst über passThrough einen normalen Klick auf den Modell-Knopf aus.
  (() => {
    const modelsBox = $('studio-models');
    if (!modelsBox || typeof HTMLDialogElement !== 'function' || !HTMLDialogElement.prototype.showModal) return;
    const dlg = document.createElement('dialog');
    dlg.className = 'studio-model-sheet';
    dlg.id = 'studio-model-sheet';
    dlg.setAttribute('aria-labelledby', 'studio-model-sheet-title');
    dlg.innerHTML = '<div class="studio-model-sheet-body"><p class="studio-model-sheet-title" id="studio-model-sheet-title"></p>'
      + '<div class="studio-model-sheet-pic"><img id="studio-model-sheet-img" alt=""/></div>'
      + '<div class="studio-model-sheet-actions"><button type="button" class="studio-model-sheet-ok" data-sheet="ok">✓</button>'
      + '<button type="button" class="studio-model-sheet-no" data-sheet="no">✕</button></div></div>';
    document.body.appendChild(dlg);
    const sheetImg = dlg.querySelector('img'), sheetTitle = dlg.querySelector('.studio-model-sheet-title');
    const okBtn = dlg.querySelector('[data-sheet="ok"]'), noBtn = dlg.querySelector('[data-sheet="no"]');
    let pending = null, opener = null, passThrough = false, lastPointer = '', lastPointerAt = 0, openedAt = 0;

    // Reine Touch-Geräte (Handy/Tablet ohne Maus): immer mit Bestätigung.
    const touchOnly = () => matchMedia('(hover: none) and (pointer: coarse)').matches;
    // Art der letzten Berührung merken. touchstart zusätzlich, weil manche Browser (v. a. iPhone-Safari)
    // beim Klick selbst pointerType „mouse“ oder gar nichts melden.
    const note = type => { lastPointer = type; lastPointerAt = Date.now(); };
    modelsBox.addEventListener('touchstart', () => note('touch'), {capture: true, passive: true});
    modelsBox.addEventListener('pointerdown', e => { if (e.pointerType) note(e.pointerType); }, true);
    modelsBox.addEventListener('mousedown', () => { if (Date.now() - lastPointerAt > 800) note('mouse'); }, true);
    // Capture-Phase: läuft vor dem Auswahl-Listener am Knopf und hält ihn bei Touch an.
    modelsBox.addEventListener('click', e => {
      const button = e.target.closest('[data-model]');
      if (!button || passThrough) return;
      const recent = Date.now() - lastPointerAt < 1500 ? lastPointer : '';
      const isTouch = recent === 'touch' || e.pointerType === 'touch' || (recent !== 'mouse' && recent !== 'pen' && touchOnly());
      if (!isTouch) return; // Maus/Stift/Tastatur am Computer: unverändert sofort auswählen
      e.preventDefault();
      e.stopImmediatePropagation();
      if (busy || dlg.open) return;
      openSheet(button);
    }, true);

    function openSheet(button) {
      pending = button.dataset.model;
      opener = button;
      const m = MODELS[pending];
      sheetImg.src = m.template;
      sheetImg.alt = `${m.label}: ${en() ? 'front and back' : 'Vorderseite und Rückseite'}`;
      sheetTitle.textContent = button.querySelector('span')?.firstChild?.textContent?.trim() || m.label;
      okBtn.setAttribute('aria-label', en() ? `Choose ${m.label}` : `${m.label} auswählen`);
      noBtn.setAttribute('aria-label', en() ? 'Cancel, back to overview' : 'Abbrechen, zurück zur Übersicht');
      openedAt = Date.now();
      document.documentElement.classList.add('studio-sheet-open');
      dlg.showModal();
      noBtn.focus({preventScroll: true});
    }
    function closeSheet(confirm) {
      if (!dlg.open) return;
      const key = pending, button = opener;
      pending = null; opener = null;
      dlg.close();
      document.documentElement.classList.remove('studio-sheet-open');
      if (!button) return;
      button.focus({preventScroll: true});
      if (confirm && key && !busy) {
        passThrough = true;
        try { button.click(); } finally { passThrough = false; } // bestehende Auswahlfunktion
      }
      // Fokus darf die Hauptvorschau nicht auf ein nur angesehenes Modell umstellen.
      hoveredModel = null;
      updateModelPreview();
    }
    // Schutz vor Geister-Klick direkt nach dem Öffnen (derselbe Finger-Tipp).
    const guard = () => Date.now() - openedAt < 350;
    okBtn.addEventListener('click', e => { e.stopPropagation(); if (!guard()) closeSheet(true); });
    noBtn.addEventListener('click', e => { e.stopPropagation(); if (!guard()) closeSheet(false); });
    dlg.addEventListener('cancel', e => { e.preventDefault(); closeSheet(false); }); // Escape
    dlg.addEventListener('click', e => { if (e.target === dlg && !guard()) closeSheet(false); }); // Tipp auf abgedunkelten Rand
    dlg.addEventListener('close', () => document.documentElement.classList.remove('studio-sheet-open'));
    // Gerät quer gedreht: Vorschau schliessen (ohne Auswahl), damit der Hinweis „Bitte drehen“ aus navigation.js sichtbar ist –
    // ein offenes Dialogfenster läge sonst darüber.
    const rotated = () => setTimeout(() => { if (dlg.open && document.documentElement.classList.contains('sb-landscape')) closeSheet(false); }, 150);
    window.addEventListener('resize', rotated);
    window.addEventListener('orientationchange', rotated);
  })();

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
      // Nicht wegscrollen, solange navigation.js gerade „Jetzt hier weiter“ zeigt (Rückweg nach einer fehlenden Angabe).
      if (i < parts.length && !document.querySelector('.sb-next')) el.scrollIntoView({behavior: 'smooth', block: 'nearest'});
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
  // Statt des Worts „unten“ (EN: „below“) zeigt Shirti klein Tastatur und Mund mit Pfeil nach unten –
  // dieselben Zeichen wie im Eingabefeld darunter. Die unsichtbare Vorlage (Vorlesen, Übersetzung) behält das Wort.
  const robotTools = document.createElement('span');
  robotTools.className = 'studio-robot-tools'; robotTools.setAttribute('aria-hidden', 'true');
  keyword.parentElement.querySelectorAll('.studio-icon-btn svg').forEach(svg => robotTools.append(svg.cloneNode(true)));
  robotTools.append(Object.assign(document.createElement('i'), {textContent: '↓'}));
  function setHead(head, n) {
    const m = /\b(unten|below)\b/i.exec(head);
    if (!m || n <= m.index) { typedHead.textContent = head.slice(0, n); return; }
    // Während das Wort „getippt“ würde, bleiben die Zeichen schon stehen; danach geht der Satz normal weiter.
    typedHead.replaceChildren(head.slice(0, m.index), robotTools, head.slice(m.index + m[0].length, Math.max(n, m.index + m[0].length)));
  }
  function robotType() {
    clearTimeout(robotTimer);
    const [head, tail] = robotText();
    if (robotDone || matchMedia('(prefers-reduced-motion: reduce)').matches) { setHead(head, head.length); typedTail.textContent = tail; robot.classList.remove('is-typing'); return; }
    let n = 0; typedHead.textContent = typedTail.textContent = ''; robot.classList.add('is-typing');
    const step = () => {
      n++; setHead(head, n); typedTail.textContent = n > head.length ? tail.slice(0, n - head.length) : '';
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

  // Druckdateien muessen aus diesem Haupt-Designer kommen (nicht nur aus dem alten Bildgenerator).
  // Ein Druckmotiv ist eine eigene, flache Grafik, nicht die Shirt-Vorschau.
  async function generatePrintSides(d) {
    if (d.sidePrints?.front instanceof Blob && d.sidePrints?.back instanceof Blob) return;
    const result = {};
    for (const side of ['front', 'back']) {
      say(`Separates Druckmotiv ${side === 'front' ? 'Vorderseite' : 'Rueckseite'} wird erstellt ...`);
      const form = new FormData();
      form.set('mode', 'print');
      form.set('side', side);
      form.set('prompt', (d.prompt || 'Originalentwurf').slice(0, MAX_PROMPT));
      form.set('image', d.blob, 'shirtbox-vorschau.' + (d.blob.type === 'image/png' ? 'png' : 'jpg'));
      const response = await fetch(`${API}/generate`, {method:'POST', body:form, signal:AbortSignal.timeout(195000)});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || `Druckmotiv ${side} konnte nicht erzeugt werden (HTTP ${response.status}).`);
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw Error(`Druckmotiv ${side}: Bildgenerator hat keine Bilddatei geliefert.`);
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      const png = bytes.length > 24 && bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71;
      if (!png) throw Error(`Druckmotiv ${side}: Der Bildgenerator liefert kein PNG. Bitte Worker-Ausgabeformat pruefen.`);
      result[side] = new Blob([bytes], {type:'image/png'});
    }
    d.sidePrints = result;
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
  // Sicherheitsnetz, schonende Fassung (20261116). Die frühere Fassung schnitt jedes Bild hart entlang des Vorlagen-Umrisses aus
  // und legte einen fremden Grauverlauf dahinter. Weicht die KI-Form nur leicht ab, entstanden dadurch doppelte/kantige Konturen
  // an Schultern und Kragen, abgeschnittene Ärmelecken und graue Säume. Jetzt:
  //  – Die eigenen Kanten, Schatten und der Stoff der KI bleiben unangetastet: Ersetzt wird nur, was mehr als R Rasterpixel
  //    (≈18 px) ausserhalb des ausgerichteten Vorlagen-Umrisses liegt (Stoffbrücken zwischen den Ansichten, überstehende Motive).
  //  – Ersatz ist der geglättete EIGENE Hintergrund des KI-Bildes (kein fremder Verlauf → keine Farbsprünge), weicher Übergang.
  //  – Liegt nichts ausserhalb, bleibt das KI-Bild unverändert (Vorschau = Original). Passt der Umriss nicht sicher, ebenfalls.
  async function keepInside(blob, modelKey) {
    try {
      const src = MODELS[modelKey]?.template || MODELS.polo.template;
      const [shirt, tpl] = await Promise.all([createImageBitmap(blob), fetch(src).then(r => r.blob()).then(b => createImageBitmap(b))]);
      const W = shirt.width, H = shirt.height, TW = tpl.width, TH = tpl.height;
      const ow = 256, oh = Math.round(H * ow / W), tw = 256, th = Math.round(TH * tw / TW);
      const data = pixels(shirt, ow, oh);
      const out = silhouette(data, ow, oh), small = silhouette(pixels(tpl, tw, th), tw, th);
      tpl.close(); twoShirts(small, tw, th);
      // Nur eingreifen, wenn der Hintergrund noch grau wie in der Vorlage ist und beide Umrisse sehr gut passen.
      const sameBack = Math.hypot(...out.color.map((v, i) => v - small.color[i])) < 40 && out.calm > .9;
      const fits = sameBack ? [0, 1].map(half => align(out, ow, oh, small, tw, th, half)) : [];
      if (!sameBack || fits.some(f => !f || f.score < .85)) { shirt.close(); return blob; }
      // inside = ausgerichteter Vorlagen-Umriss je Bildhälfte; keep = derselbe Umriss um R Rasterpixel (≈18 px) erweitert.
      const R = 3, N = ow * oh, inside = new Uint8Array(N), keep = new Uint8Array(N);
      const grow = (src, dst, r, x0, x1) => { for (let i = 0; i < N; i++) { if (!src[i]) continue; const x = i % ow, y = (i - x) / ow;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy;
          if (dx * dx + dy * dy <= r * r && xx >= x0 && xx < x1 && yy >= 0 && yy < oh) dst[yy * ow + xx] = 1; } } };
      fits.forEach((f, half) => {
        const x0 = half * ow / 2, x1 = x0 + ow / 2, tx0 = half * tw / 2, tx1 = tx0 + tw / 2, part = new Uint8Array(N);
        for (let y = 0; y < oh; y++) for (let x = x0; x < x1; x++) {
          const u = Math.round((x - f.tx) / f.s), v = Math.round((y - f.ty) / f.s);
          if (u >= tx0 && u < tx1 && v >= 0 && v < th && small[v * tw + u]) part[y * ow + x] = inside[y * ow + x] = 1;
        }
        grow(part, keep, R, x0, x1);
      });
      // Deutlich überstehende Teile (ausserhalb von keep) gruppieren; Kleinstreste (< 6 Rasterpixel) ignorieren.
      const far = new Uint8Array(N); for (let i = 0; i < N; i++) far[i] = out[i] && !keep[i] ? 1 : 0;
      const lab = new Int32Array(N), stack = []; let removedCells = 0;
      const remove = new Uint8Array(N);
      for (let s = 0; s < N; s++) {
        if (!far[s] || lab[s]) continue;
        const comp = []; lab[s] = 1; stack.push(s);
        while (stack.length) { const i = stack.pop(), x = i % ow; comp.push(i);
          for (const j of [x > 0 ? i - 1 : -1, x < ow - 1 ? i + 1 : -1, i - ow, i + ow]) if (j >= 0 && j < N && far[j] && !lab[j]) { lab[j] = 1; stack.push(j); } }
        if (comp.length >= 6) { for (const i of comp) remove[i] = 1; removedCells += comp.length; }
      }
      if (!removedCells) { shirt.close(); return blob; }
      // Den Ansatz des Überstands (zwischen Shirt-Kante und keep-Grenze) mitnehmen – sonst bleiben Stummel stehen.
      // Nur Überstand-Pixel ausserhalb des Vorlagen-Umrisses, nie Stoff innerhalb.
      const reach = new Uint8Array(N); grow(remove, reach, R + 1, 0, ow);
      for (let i = 0; i < N; i++) if (reach[i] && out[i] && !inside[i]) remove[i] = 1;
      // Eine Rasterzelle Reserve (nur ausserhalb des Umrisses), damit keine geglätteten Ränder als Geisterkontur stehen bleiben.
      const pad = new Uint8Array(N); grow(remove, pad, 1, 0, ow);
      for (let i = 0; i < N; i++) if (pad[i] && !inside[i]) remove[i] = 1;
      for (let i = 0; i < N; i++) keep[i] = remove[i] ? 0 : 1;
      // Eigener Hintergrund des KI-Bildes, grob gerastert; Zellen unter den Shirts aus den Nachbarn aufgefüllt.
      const GX = 32, GY = Math.max(2, Math.round(GX * oh / ow)), sum = new Float64Array(GX * GY * 3), cnt = new Uint32Array(GX * GY);
      const near = new Uint8Array(N); grow(out, near, 2, 0, ow); // Randpixel (Kanten, Schatten) nicht als Hintergrund werten
      for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
        const i = y * ow + x; if (near[i]) continue;
        const c = Math.min(GY - 1, Math.floor(y * GY / oh)) * GX + Math.min(GX - 1, Math.floor(x * GX / ow));
        sum[c * 3] += data[i * 4]; sum[c * 3 + 1] += data[i * 4 + 1]; sum[c * 3 + 2] += data[i * 4 + 2]; cnt[c]++;
      }
      const filled = Uint8Array.from(cnt, n => n ? 1 : 0);
      for (let c = 0; c < cnt.length; c++) if (cnt[c]) for (let k = 0; k < 3; k++) sum[c * 3 + k] /= cnt[c];
      for (let pass = 0, missing = true; missing && pass < 64; pass++) {
        missing = false; const next = filled.slice();
        for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
          const c = gy * GX + gx; if (filled[c]) continue;
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = gx + dx, yy = gy + dy; if (xx < 0 || yy < 0 || xx >= GX || yy >= GY) continue;
            const e = yy * GX + xx; if (!filled[e]) continue;
            r += sum[e * 3]; g += sum[e * 3 + 1]; b += sum[e * 3 + 2]; n++;
          }
          if (n) { sum[c * 3] = r / n; sum[c * 3 + 1] = g / n; sum[c * 3 + 2] = b / n; next[c] = 1; } else missing = true;
        }
        filled.set(next);
      }
      const bgSmall = canvasOf(GX, GY), gx2 = bgSmall.getContext('2d'), gimg = gx2.createImageData(GX, GY);
      for (let c = 0; c < GX * GY; c++) { gimg.data[c * 4] = sum[c * 3]; gimg.data[c * 4 + 1] = sum[c * 3 + 1]; gimg.data[c * 4 + 2] = sum[c * 3 + 2]; gimg.data[c * 4 + 3] = 255; }
      gx2.putImageData(gimg, 0, 0);
      const maskSmall = canvasOf(ow, oh), mx = maskSmall.getContext('2d'), mimg = mx.createImageData(ow, oh);
      for (let i = 0; i < keep.length; i++) if (keep[i]) mimg.data[i * 4 + 3] = 255;
      mx.putImageData(mimg, 0, 0);
      // Maske glatt hochskalieren und danach scharf ziehen: glatte Schnittlinie ohne Treppen, Übergang nur ≈1–2 px (keine Unschärfe).
      const maskFull = canvasOf(W, H), mf = maskFull.getContext('2d', {willReadFrequently: true});
      mf.imageSmoothingEnabled = true; mf.imageSmoothingQuality = 'high'; mf.drawImage(maskSmall, 0, 0, W, H);
      const md = mf.getImageData(0, 0, W, H);
      for (let i = 3; i < md.data.length; i += 4) md.data[i] = Math.max(0, Math.min(255, (md.data[i] - 128) * 4 + 128));
      mf.putImageData(md, 0, 0);
      const result = canvasOf(W, H), rx = result.getContext('2d'), front = canvasOf(W, H), fx = front.getContext('2d');
      rx.imageSmoothingEnabled = true; rx.imageSmoothingQuality = 'high';
      rx.drawImage(bgSmall, 0, 0, W, H);
      fx.drawImage(shirt, 0, 0); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(maskFull, 0, 0);
      rx.drawImage(front, 0, 0); shirt.close();
      // Verlustfrei speichern: keine zusätzliche JPG-Kompression des Designs.
      return await new Promise(resolve => result.toBlob(b => resolve(b || blob), 'image/png'));
    } catch { return blob; }
  }

  // Ergebnis-Ansicht: Ab „T-Shirt designen“ sind Überschrift und Formular weg (Handy, iPad und Computer) –
  // das Shirt steht oben, darunter Änderungen / weiteres Shirt, darunter die Bestellung. Zurück nur über „Weiteres T-Shirt designen“.
  const studio = form.closest('.studio');
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
    if (studio.classList.contains('is-result')) { window.scrollTo({top: 0, behavior: 'smooth'}); return; }
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
    catch (e) {
      const text = ['TimeoutError', 'AbortError'].includes(e.name) ? 'Die Anfrage dauert zu lange. Bitte später erneut versuchen.' : e.message === 'Failed to fetch' ? 'Die Bildgestaltung ist nicht erreichbar. Bitte später erneut versuchen.' : e.message;
      fail(text);
      // In der Ergebnis-Ansicht ist das Formular ausgeblendet – Fehler beim Ändern dann direkt unter dem Änderungsfeld zeigen.
      if (designs[active]) editStatus.textContent = text;
    }
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
    if (!model) { fail('Bitte wählen Sie zuerst ein Shirt-Modell.'); modelField.classList.add('attention'); missing(modelField, modelButtons[0], en() ? '👇 Please pick a shirt' : '👇 Bitte ein Shirt anklicken'); return; }
    if (!word && !file && !styleChoice) { fail('Bitte beschreiben Sie Ihr Design oder laden Sie ein Foto hoch.'); missing(keyword.parentElement, null,en() ? '👇 Describe your shirt here' : '👇 Hier Ihr Shirt beschreiben'); return; }
    if (!rights.checked) { fail('Bitte bestätigen Sie Ihre Inhalts- und Bildrechte.'); rights.closest('label').classList.add('attention'); missing(rights.closest('label'), rights, en() ? '👇 Please tick this box' : '👇 Bitte Häkchen setzen'); return; }
    // Ab dem Klick nur noch das Shirt zeigen (auch Computer/iPad quer): Die linke Seite mit Modell, Idee und Knopf
    // verschwindet, damit niemand aus Versehen dort ein neues Shirt startet. Klappt es nicht, kommt das Formular samt Fehler zurück.
    let made = false;
    showResult(true);
    // Nur beim Erstellen über „T-Shirt designen“ (nicht bei Änderungen): Fusszeile (WhatsApp, Newsletter …) weg,
    // unter dem Shirt „Deine Idee wird jetzt verwirklicht“. Ist das Shirt fertig, ist alles wieder wie vorher.
    document.body.classList.add('is-generating');
    await run(async () => {
      // Alle Modelle (auch Polo) schicken ihre leere 3:2-Vorlage mit – so gilt immer die saubere Vorlage,
      // unabhängig davon, welche Vorlage der Bild-Worker selbst laden würde.
      const blob = await keepInside(await request(surprisePrompt(word, !!file), file ? await withPhoto(file) : await template()), model);
      const summary = [`Modell: ${MODELS[model].label}`, styleChoice && `Stil: ${STYLES[styleChoice].label}`, word && `Design: ${word}`, file && 'mit eigenem Foto'].filter(Boolean).join(' · ');
      designs.push({blob, url: URL.createObjectURL(blob), prompt: `KI-Design – ${summary}`, model, selected: true, number: editingOrder ? Math.max(0, ...designs.map(d => d.number || 0)) + 1 : null});
      active = designs.length - 1; startOver = false; made = true;
      say(`Design ${active + 1} ist fertig. Sie können es unten noch ändern oder direkt bestellen.`);
    });
    document.body.classList.remove('is-generating');
    if (!made) { showResult(false); error.scrollIntoView({behavior: 'smooth', block: 'center'}); }
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

  // „Bild weiter bearbeiten“ auf einer Karte: dieses Design oben zeigen (auch aus „Weiteres T-Shirt designen“ heraus)
  // und zum Änderungsfeld scrollen, das kurz aufleuchtet.
  function editDesign(i) {
    if (busy || !designs[i]) return;
    stopDictation(); stopTour();
    active = i; startOver = false; showResult(true); editStatus.textContent = ''; fail('');
    say(`Design ${i + 1}: Beschreiben Sie unten, was geändert werden soll.`);
    render();
    requestAnimationFrame(() => {
      editRow.scrollIntoView({behavior: 'smooth', block: 'center'});
      editRow.classList.remove('is-called'); void editRow.offsetWidth; editRow.classList.add('is-called');
    });
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
    if (!d || !change) {
      if (!change && spoke) editStatus.textContent = 'Keine Sprache erkannt. Bitte nochmals den Mund antippen und sprechen.';
      if (d && !change) missing(editInput.parentElement, null,en() ? '👇 Describe your changes here' : '👇 Hier die Änderung beschreiben');
      return;
    }
    editStatus.textContent = '';
    run(async () => {
      const cut = MODELS[d.model]?.cut;
      const blob = await keepInside(await request(fit(`Bisheriges Shirt und Gestaltung beibehalten${cut ? ` (Schnitt: ${cut})` : ''}. Ändere nur Folgendes: ${change}\nErhalte alle anderen Merkmale. ${SHAPE_RULE}`, QUALITY_RULE, CENTER_LAYOUT, INSIDE), d.blob), d.model);
      URL.revokeObjectURL(d.url); d.blob = blob; d.url = URL.createObjectURL(blob); d.edited = true;
      d.prompt = `${d.prompt}\nÄnderung: ${change}`.slice(-1500); d.sidePrints = null; editInput.value = '';
      say(`Design ${active + 1} wurde angepasst. Weitere Änderungen sind jederzeit möglich.`);
    });
  });

  orderButton.addEventListener('click', async () => {
    const picked = chosen(); if (busy) return;
    if (!picked.length) { missing(collection, list.querySelector('.studio-card-pick'), en() ? '👇 Please add a shirt to the cart' : '👇 Bitte ein T-Shirt „In den Warenkorb“ legen'); return; }
    // Aus der Bestellung geladene Designs: unverändert → Eintrag 1:1 zurück (inkl. Originalbilder und Platzierung);
    // geändert → neues Bild, aber Originalbilder und Platzierung bleiben für den Druck dabei.
    const items = picked.map(d => d.entry && !d.edited ? d.entry
      : {...(d.entry || {}), blob: d.blob, number: d.number, prompt: d.prompt, originals: d.entry?.originals || [], placement: d.entry?.placement || ''});
    busy = true; controls();
    try {
      // Vorder- und Rueckseite werden beim Bestellen direkt aus dem Shirt-Bild geschnitten
      // (weisser-hintergrund.js). Keine zusaetzlichen KI-Aufrufe mehr -> sofort zur Bestellung.
      const itemsWithPrints = items.map(item => ({...item, sidePrints: null, uploadOnly:false}));
      const previous = (await window.ShirtboxDesignTransfer.load())?.blobs || [];
      let saved;
      if (editingOrder) {
        saved = previous.slice();
        for (const item of itemsWithPrints) { const at = saved.findIndex((e, i) => (e.number || i + 1) === item.number); if (at >= 0) saved[at] = item; else saved.push(item); }
      } else {
        let next = Math.max(0, ...previous.map((e, i) => Number(e.number || i + 1) || 0));
        saved = [...previous, ...itemsWithPrints.map(item => ({...item, number: ++next}))];
      }
      await window.ShirtboxDesignTransfer.save(saved);
      location.href = 'bestellen.html#bestellen';
    } catch (e) { fail(e?.message || 'Druckmotive konnten nicht gespeichert werden.'); busy = false; controls(); }
  });

  // Aus der Bestellung zurück: gespeicherte Designs zum Weiterbearbeiten laden.
  async function restore() {
    const number = new URLSearchParams(location.search).get('weiterbearbeiten');
    if (!number || !window.ShirtboxDesignTransfer?.load) return;
    try {
      const items = (await window.ShirtboxDesignTransfer.load())?.blobs || [];
      const index = items.findIndex((x, i) => String(x.number || i + 1) === number);
      if (index < 0) throw Error();
      items.forEach((e, i) => { const blob = e.blob || e; if (blob instanceof Blob) designs.push({blob, url: URL.createObjectURL(blob), prompt: e.prompt || '', model: /Modell: Oversize T-Shirt/.test(e.prompt || '') ? 'oversize' : /Modell: T-Shirt/.test(e.prompt || '') ? 'tshirt' : /Modell: Zip-Shirt/.test(e.prompt || '') ? 'zip' : 'polo', selected: true, sidePrints: e.sidePrints || null, number: e.number || i + 1, entry: e.blob ? e : {blob: e, number: i + 1}}); });
      editingOrder = true; showResult(true); active = designs.findIndex(d => String(d.number) === number);
      say('Ihr Design wurde geladen. Beschreiben Sie unten die gewünschte Änderung.');
      // Bewusst kein automatischer Cursor im Änderungsfeld: Sonst sind „Antippen & schreiben / sprechen“ versteckt,
      // bis man woanders hintippt. Die beiden Zeichen sollen sofort sichtbar sein.
      render();
    } catch { fail('Das gespeicherte Design konnte nicht geladen werden.'); }
  }

  render(); restore();
})();
