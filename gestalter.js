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
  // Fehlende Angabe: hinscrollen und deutlich markieren (window.sbMissing aus navigation.js).
  const en = () => document.documentElement.lang === 'en';
  const missing = (el, focus, text, then) => { if (window.sbMissing) window.sbMissing(el, focus, text, then); else { el?.scrollIntoView({behavior: 'smooth', block: 'center'}); focus?.focus({preventScroll: true}); } };
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
    const n = ready().length, c = chosen().length;
    if (count) count.textContent = n ? `${n} Design${n === 1 ? '' : 's'}` : '';
    // Ohne Designs gibt es keinen leeren Platzhalter-Bereich mehr – der Bereich erscheint erst mit dem ersten Design.
    collection.hidden = !designs.length;
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
    markStarted();
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
    d.lastFinal = ''; d.lastText = ''; d.heard = false; d.started = false;
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
      d.lastText = [final.trim(), interim.trim()].filter(Boolean).join(' ');
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
      // Handy/iPad: Safari (iPhone/iPad) und teils Android-Chrome markieren das Ergebnis nie als „final“ und beenden
      // trotzdem – früher wurde der erkannte Text dann wieder gelöscht. Darum das zuletzt Erkannte behalten.
      field.value = [d.base, d.lastFinal || d.lastText].filter(Boolean).join(' ');
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

  const CENTER_LAYOUT = 'STANDARDPOSITION: Alle Hauptmotive, Tabellen, Listen, Zahlen und Schriftzüge horizontal MITTIG auf der jeweils gewünschten Shirt-Seite ausrichten, ausser der Kunde verlangt ausdrücklich links, rechts oder eine andere Position. Tabellen und Zahlenkolonnen vollständig und mit grosszügigem Sicherheitsabstand zu Seitennähten und Achseln setzen. Nie Buchstaben oder Zahlen um die Seitenkante wickeln oder am Rand abschneiden; bei Platzmangel das gesamte Motiv proportional verkleinern. Shirt-Schnitt und Achselkonturen exakt nach Vorlage, keine zusätzlichen Spitzen, Dreiecke oder Ausstülpungen unter den Ärmeln.';

  // Hilft der Kundeneingabe nach: ergänzt Aufbau, Farben, Schrift und Druckqualität zu einem vollständigen Briefing.
  // Ein eigenes Textfeld gibt es nicht mehr: Schriftzüge nennt die Kundschaft direkt in der Beschreibung.
  // Bewusst kompakt: Der live Worker nimmt höchstens 2000 Zeichen an (siehe MAX_PROMPT). Die ausführliche Randregel (INSIDE)
  // kommt nur dazu, wenn noch Platz ist – der Worker schickt dieselbe Regel ohnehin in seinen eigenen Anweisungen mit.
  // printed = Kundentexte, die die Software selbst exakt setzt (shirt-form.js). Die KI zeichnet sie NICHT, sondern
  // lässt an diesen Stellen eine ruhige Fläche frei; im Kundenwunsch stehen dafür nur Platzhalter [Schriftzug 1] usw.
  function surprisePrompt(word, hasPhoto, printed = []) {
    const cut = MODELS[model].cut;
    let p = `Rundum bedrucktes 360-Grad-${cut} auf der Vorlage (links vorne, rechts hinten): EIN zusammenhängendes Design über Vorderseite, Rückseite, Kragen und Ärmel. `;
    // Foto-Regel: das Foto erscheint genau einmal und originalgetreu; die übrigen Flächen setzen nur Farben und Muster fort.
    if (hasPhoto) p += 'Das hochgeladene Foto (vorne auf der Vorlage) ist das Hauptmotiv: originalgetreu übernehmen – Gesichter, Personen und Logos nicht verändern oder neu zeichnen –, sauber freistellen und harmonisch einbetten. Es erscheint GENAU EINMAL (vorne oder wo der Kundenwunsch es nennt), keine Wiederholung auf Rückseite oder Ärmeln. Rückseite, Ärmel und Kragen führen Farben, Muster und Effekte nahtlos fort. ';
    if (word) p += `Kundenwunsch: "${word}". Treu umsetzen, fehlende Details professionell ergänzen. `;
    else if (!hasPhoto) p += 'Entwickle ein ausdrucksstarkes, überraschendes Motiv. ';
    p += `Stil: ${(STYLES[styleChoice]?.brief || RANDOM_STYLES[Math.floor(Math.random() * RANDOM_STYLES.length)]).replace(/\.$/, '')}. `;
    if (!hasPhoto) p += 'Vorderseite mit Blickfang auf Brusthöhe, Rückseite mit dem grössten Hauptmotiv, Ärmel und Kragen mit passenden Akzenten. ';
    p += 'Höchstens 3–4 harmonische Farben. ';
    p += CENTER_LAYOUT + ' ';
    if (printed.length) {
      const areas = [...new Set(printed.map(t => window.ShirtboxForm.areaName(t)))].join(' und ');
      p += `Die Platzhalter [Schriftzug …] setzt ShirtBOX nachträglich als echte Schrift ein: KEINE Buchstaben, Wörter oder Zahlen ins Design zeichnen (auch keine Platzhalter). Auf ${areas} eine ruhige, einheitliche Fläche mit gutem Kontrast ohne Figuren oder Gesichter frei lassen. `;
    } else p += word ? 'Schrift nur, wenn der Kundenwunsch ausdrücklich einen Schriftzug nennt – dann Buchstabe für Buchstabe korrekt, gut lesbar, an der genannten Stelle (sonst hinten). Die Beschreibung selbst nicht als Text drucken. ' : 'Keine Schriftzüge ausser im Foto. ';
    p += `Alles bleibt innerhalb der Shirt-Umrisse, grauer Hintergrund leer. Keine rechteckige Foto-Auflage, keine Marken-Logos, keine Wasserzeichen. Schnitt und Perspektive der Vorlage beibehalten, druckfertige Qualität. Variante ${Date.now()}`;
    return fit(p, INSIDE);
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
    if (needModel) setTimeout(afterModel, 500);
  }));

  // „T-Shirt designen“ ohne Shirt-Modell gedrückt → oben gelb markiert. Ist das Shirt dann angeklickt, geht es
  // automatisch wieder nach unten zum nächsten Schritt: Fehlt noch die Idee, führt die Tour (unten) dorthin;
  // fehlt das Häkchen, wird es markiert; ist alles da, leuchtet „T-Shirt designen“ mit „Jetzt hier weiter“.
  let needModel = false;
  function afterModel() {
    if (!needModel || busy || !model) return;
    needModel = false;
    if (!hasIdea()) { if (!tourTimer) idea.scrollIntoView({behavior: 'smooth', block: 'center'}); return; }
    if (!rights.checked) {
      rights.closest('label').classList.add('attention');
      missing(rights.closest('label'), rights, en() ? '👇 Please tick this box' : '👇 Bitte Häkchen setzen', surprise);
      return;
    }
    if (window.sbNext) window.sbNext(surprise); else surprise.scrollIntoView({behavior: 'smooth', block: 'center'});
  }

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
    const parts = [keyword, photoBox].filter(Boolean);
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
  // Der Roboter mit Sprechblase ist aus dem Formular entfernt (Kundenwunsch 02.11.2026): Das Eingabefeld steht direkt da.
  // robotType/robotStop bleiben als leere Funktionen, weil Diktat und "Weiteres T-Shirt designen" sie aufrufen.
  let robotDone = true;
  function robotType() {}
  function robotStop() {}
  ['pointerdown', 'focus'].forEach(type => keyword.addEventListener(type, robotStop)); keyword.addEventListener('input', () => { if (keyword.value.trim()) stopTour(); });
  // Orange Pfeil über dem Eingabefeld: weg, sobald man ins Feld tippt, schreibt oder diktiert;
  // wieder da, wenn das Feld leer ist und man woanders hintippt. (Auch über steps() nach jedem Diktat-Wort.)
  function markStarted() { keyword.closest('.sub-idea')?.classList.toggle('is-started', document.activeElement === keyword || !!keyword.value.trim() || keyword.parentElement.classList.contains('is-listening')); }
  ['pointerdown', 'focus', 'blur', 'input'].forEach(type => keyword.addEventListener(type, () => setTimeout(markStarted)));

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

  // Form und Druckflächen bestimmt die Software (shirt-form.js): Das KI-Design wird auf die feste Vorlage übertragen,
  // Kundentexte werden exakt als echte Schrift gesetzt und geprüft. Ohne shirt-form.js bleibt das KI-Bild unverändert.
  const shape = (blob, modelKey, options) => window.ShirtboxForm
    ? window.ShirtboxForm.fit(blob, MODELS[modelKey]?.template || MODELS.polo.template, options)
    : Promise.resolve({blob, layouts: [], locked: false});

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
  // Höhe der festen Kopfzeile (--sb-head) und der unten angehefteten Fusszeile (--sb-foot) für die mitlaufende
  // Shirt-Vorschau in der Ergebnis-Ansicht. Bewusst ausserhalb des ResizeObservers (sonst Warnung „ResizeObserver loop“).
  function measureBars() {
    const headHeight = `${document.querySelector('.masthead')?.offsetHeight || 0}px`;
    if (document.documentElement.style.getPropertyValue('--sb-head') !== headHeight) document.documentElement.style.setProperty('--sb-head', headHeight);
    // Unten angeheftete Fusszeile (Computer) ebenfalls abziehen, damit nichts dahinter verschwindet.
    const footEl = document.querySelector('.site-footer');
    const footHeight = `${footEl && ['sticky', 'fixed'].includes(getComputedStyle(footEl).position) && footEl.offsetHeight ? footEl.offsetHeight : 0}px`;
    if (document.documentElement.style.getPropertyValue('--sb-foot') !== footHeight) document.documentElement.style.setProperty('--sb-foot', footHeight);
    // Überschrift + Schritte über dem Formular: Die Shirt-Vorschau der ersten Seite wird so gross, wie der Rest erlaubt.
    const studioHead = document.querySelector('.studio-head');
    const studioHeadHeight = `${studioHead && studioHead.offsetHeight ? Math.round(studioHead.offsetHeight + parseFloat(getComputedStyle(studioHead).marginBottom) + parseFloat(getComputedStyle(studioHead.parentElement).paddingTop)) : 0}px`;
    if (document.documentElement.style.getPropertyValue('--sb-studio-head') !== studioHeadHeight) document.documentElement.style.setProperty('--sb-studio-head', studioHeadHeight);
  }
  measureBars(); window.addEventListener('resize', measureBars); window.addEventListener('load', measureBars);
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

  // Handy/iPad hoch: Während das Shirt gestaltet wird, steht das Bild mit der Sanduhr senkrecht mittig im
  // sichtbaren Bereich unter der Kopfzeile (nicht ganz oben). Die rechte Seite wird dafür so hoch wie der Rest des Bildschirms.
  // Ab 760 px Breite (iPad hoch, Tablets, Computer) ist die Ergebnis-Ansicht zweispaltig: links Bedienung, rechts das Shirt.
  // Darunter (Handy) eine Spalte – nur dort wird das Shirt beim Gestalten senkrecht mittig gestellt.
  const twoCol = matchMedia('(min-width: 760px)');
  function centerWhileGenerating() {
    if (twoCol.matches || !document.body.classList.contains('is-generating')) { stage.style.removeProperty('min-height'); return; }
    const top = stage.getBoundingClientRect().top + window.scrollY;
    stage.style.minHeight = `${Math.max(0, Math.round((probe.offsetHeight || window.innerHeight) - top - 12))}px`;
  }
  window.addEventListener('resize', centerWhileGenerating); twoCol.addEventListener('change', centerWhileGenerating);

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
      // Der Bild-Worker nimmt nur Anfragen von freigegebenen Adressen an (shirtbox.ch …). Lokale Testversion (Doppelklick)
      // oder eine nicht freigegebene Test-Adresse werden blockiert – dann klar sagen, woran es liegt, statt „später erneut“.
      const blocked = location.protocol === 'file:' || /^(localhost|127\.|192\.168\.)/.test(location.hostname) || /raspy-firefly/.test(location.hostname);
      const unreachable = blocked ? 'Die Bildgestaltung funktioniert nur auf shirtbox.ch – diese Test-Adresse ist beim Bild-Dienst nicht freigeschaltet.' : 'Die Bildgestaltung ist nicht erreichbar. Bitte später erneut versuchen.';
      const text = ['TimeoutError', 'AbortError'].includes(e.name) ? 'Die Anfrage dauert zu lange. Bitte später erneut versuchen.' : /Failed to fetch|Load failed|NetworkError/.test(e.message) ? unreachable : e.message;
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
    if (!model) { fail('Bitte wählen Sie zuerst ein Shirt-Modell (Polo-Shirt oder Zip-Shirt).'); modelField.classList.add('attention'); needModel = true; missing(modelField, modelButtons[0], en() ? '👇 Please pick a shirt' : '👇 Bitte ein Shirt anklicken', afterModel); return; }
    if (!word && !file && !styleChoice) { fail('Bitte beschreiben Sie Ihr Design oder laden Sie ein Foto hoch.'); missing(keyword.parentElement, null,en() ? '👇 Describe your shirt here' : '👇 Hier Ihr Shirt beschreiben'); return; }
    if (!rights.checked) { fail('Bitte bestätigen Sie Ihre Inhalts- und Bildrechte.'); rights.closest('label').classList.add('attention'); missing(rights.closest('label'), rights, en() ? '👇 Please tick this box' : '👇 Bitte Häkchen setzen'); return; }
    // Ab dem Klick nur noch das Shirt zeigen (auch Computer/iPad quer): Die linke Seite mit Modell, Idee und Knopf
    // verschwindet, damit niemand aus Versehen dort ein neues Shirt startet. Klappt es nicht, kommt das Formular samt Fehler zurück.
    let made = false;
    showResult(true);
    // Nur beim Erstellen über „T-Shirt designen“ (nicht bei Änderungen): Fusszeile (WhatsApp, Newsletter …) weg,
    // unter dem Shirt „Deine Idee wird jetzt verwirklicht“. Ist das Shirt fertig, ist alles wieder wie vorher.
    document.body.classList.add('is-generating'); centerWhileGenerating();
    await run(async () => {
      // Das Polo-Shirt holt der Worker selbst; alle anderen Modelle schicken ihre leere Vorlage mit.
      // Kundentexte in Anführungszeichen (oder nach „Text:“) setzt die Software exakt – die KI bekommt nur Platzhalter.
      const own = window.ShirtboxForm ? window.ShirtboxForm.extractTexts(word) : {texts: [], prompt: word};
      const result = await shape(await request(surprisePrompt(own.prompt, !!file, own.texts), file ? await withPhoto(file) : model === 'polo' ? null : await template()), model, {texts: own.texts});
      const blob = result.blob, layouts = result.layouts;
      const summary = [`Modell: ${MODELS[model].label}`, styleChoice && `Stil: ${STYLES[styleChoice].label}`, word && `Design: ${word}`, file && 'mit eigenem Foto'].filter(Boolean).join(' · ');
      designs.push({blob, layouts, url: URL.createObjectURL(blob), prompt: `KI-Design – ${summary}`, model, selected: true, number: editingOrder ? Math.max(0, ...designs.map(d => d.number || 0)) + 1 : null});
      active = designs.length - 1; startOver = false; made = true;
      say(`Design ${active + 1} ist fertig. Sie können es im Änderungsfeld noch ändern oder direkt bestellen.`);
    });
    document.body.classList.remove('is-generating'); centerWhileGenerating();
    if (!made) { showResult(false); error.scrollIntoView({behavior: 'smooth', block: 'center'}); }
  });

  // Weiteres T-Shirt: alle Eingaben (Modell, Stil, Beschreibung, Foto) zurücksetzen und oben bei Schritt 1 neu beginnen.
  // Die fertigen Designs bleiben unten in „Ihre T-Shirts“ erhalten.
  another.addEventListener('click', () => { if (!busy) startNew(); });
  function startNew() {
    model = ''; needModel = false; modelButtons.forEach(b => b.setAttribute('aria-pressed', 'false'));
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
    say(`Design ${i + 1}: Beschreiben Sie im Änderungsfeld, was geändert werden soll.`);
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
      // Texte bei Änderungen: Neue Texte in Anführungszeichen setzt wieder die Software. Betrifft die Änderung keine
      // Schrift, werden die bisher gesetzten Schriftzüge danach identisch (Ort, Grösse, Farbe) neu aufgedruckt.
      const own = window.ShirtboxForm ? window.ShirtboxForm.extractTexts(change) : {texts: [], prompt: change};
      const aboutText = own.texts.length || /\b(text\w*|schrift\w*|aufschrift|beschriftung|buchstab\w*|wort|wörter|name|namen|slogan)\b/i.test(change);
      const keepLayouts = !aboutText && d.layouts?.length ? d.layouts : [];
      let ask = `Bisheriges Shirt und Gestaltung beibehalten${cut ? ` (Schnitt: ${cut})` : ''}. Ändere nur Folgendes: ${own.prompt}\nErhalte alle anderen Merkmale.`;
      if (own.texts.length) ask += ` Die Platzhalter [Schriftzug …] setzt ShirtBOX selbst als Schrift ein – nicht zeichnen; auf ${[...new Set(own.texts.map(t => window.ShirtboxForm.areaName(t)))].join(' und ')} vorhandene Schrift entfernen und eine ruhige Fläche lassen.`;
      else if (keepLayouts.length) ask += ' Vorhandene Schriftzüge exakt unverändert lassen.';
      const result = await shape(await request(fit(ask, CENTER_LAYOUT, INSIDE), d.blob), d.model, {texts: own.texts, layouts: keepLayouts});
      const blob = result.blob; d.layouts = result.layouts;
      URL.revokeObjectURL(d.url); d.blob = blob; d.url = URL.createObjectURL(blob); d.edited = true;
      d.prompt = `${d.prompt}\nÄnderung: ${change}`.slice(-1500); editInput.value = '';
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
      items.forEach((e, i) => { const blob = e.blob || e; if (blob instanceof Blob) designs.push({blob, url: URL.createObjectURL(blob), prompt: e.prompt || '', model: /Modell: Zip-Shirt/.test(e.prompt || '') ? 'zip' : 'polo', selected: true, number: e.number || i + 1, entry: e.blob ? e : {blob: e, number: i + 1}}); });
      editingOrder = true; showResult(true); active = designs.findIndex(d => String(d.number) === number);
      say('Ihr Design wurde geladen. Beschreiben Sie im Änderungsfeld die gewünschte Änderung.');
      // Bewusst kein automatischer Cursor im Änderungsfeld: Sonst sind „Antippen & schreiben / sprechen“ versteckt,
      // bis man woanders hintippt. Die beiden Zeichen sollen sofort sichtbar sein.
      render();
    } catch { fail('Das gespeicherte Design konnte nicht geladen werden.'); }
  }

  render(); restore();
})();
