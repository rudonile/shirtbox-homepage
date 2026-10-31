// Shirti – der ShirtBOX-Helfer („Frag mich“) unten rechts auf jeder Seite.
// Regelbasiert (Wissensdatenbank + Stichworterkennung), keine KI und keine Serverkosten. Der Verlauf bleibt nur im Browser (localStorage).
// Später lässt sich eine echte KI anbinden: answer() ersetzen bzw. bei fehlendem Treffer eine API fragen.
(() => {
  'use strict';
  if (window.ShirtiLoaded) return; window.ShirtiLoaded = true;

  const WHATSAPP = 'https://wa.me/41764690100', MAIL = 'info@shirtbox.ch', STORE = 'shirti-verlauf-v1', MAX_HISTORY = 60;
  const link = (href, text) => `<a href="${href}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
  const DESIGNER = link('designhilfe.html', 'Shirt-Designer'), ORDER = link('bestellen.html', 'Bestellformular'), FAQ = link('faq.html', 'FAQs');
  const CONTACT = `${link(WHATSAPP, 'WhatsApp')} oder ${link('mailto:' + MAIL, MAIL)}`;
  const ROBOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2v2.3"/><circle cx="12" cy="2.3" r=".9"/><rect x="5" y="5.5" width="14" height="10" rx="3"/><circle class="shirti-eye" cx="9.2" cy="10" r="1.3"/><circle class="shirti-eye" cx="14.8" cy="10" r="1.3"/><path class="shirti-mouth" d="M9.6 13.1c1.5.8 3.3.8 4.8 0"/><path d="M3 9v3.5M21 9v3.5"/><path d="M8.5 15.5v2h7v-2"/><path d="M6.5 22c0-2.2 2.5-4 5.5-4s5.5 1.8 5.5 4"/></svg>';

  // ---------------------------------------------------------------------------------------------
  // Wissensdatenbank: nur Angaben, die so auf ShirtBOX.ch stehen (FAQ, Startseite, Designer, Bestellformular).
  // keys: Wortanfänge (ohne Umlaute, klein); ein Treffer zählt mit seinem Gewicht. ask: Vorschläge zum Antippen.
  const KB = [
    {id: 'gestalten', ask: 'Wie gestalte ich ein T-Shirt?', keys: {gestalt: 3, design: 2, mach: 2, erstell: 3, entwerf: 3, eigen: 1, wie: .5, shirt: 1, anfang: 2, start: 1, kreier: 3},
      a: `So gestaltest du dein Shirt im ${DESIGNER}:<ol><li>Shirt-Modell wählen: Polo-Shirt oder Zip-Shirt.</li><li>Ins grosse Feld schreiben oder sprechen, wie dein Shirt aussehen soll und was darauf stehen soll.</li><li>Optional ein eigenes Foto oder Logo hochladen.</li><li>Rechte bestätigen und auf „T-Shirt designen“ klicken.</li></ol>Nach 1 bis 3 Minuten erscheint dein Shirt. Entwürfe sind kostenlos und unverbindlich.`},
    {id: 'beschreibung', ask: 'Was soll ich ins Feld schreiben?', keys: {beschreib: 3, schreib: 2, feld: 2, text: 2, schrift: 3, name: 2, spruch: 3, farb: 2, motiv: 3, idee: 2, genau: 1, beispiel: 2, stehen: 2, drauf: 2},
      a: 'Schreib einfach alles, was dir wichtig ist – je genauer, desto besser:<ul><li><b>Aussehen:</b> Farben, Stil, Muster</li><li><b>Motiv:</b> was zu sehen sein soll und wo</li><li><b>Text:</b> was genau gedruckt wird und wo, am besten in Anführungszeichen, z. B. „FC Gretzenbach“ gross hinten</li></ul>Beispiel: <i>Sportlich in Rot und Weiss, vorne ein kleiner Fussball, hinten gross „FC Gretzenbach“ und darunter „Nico 10“.</i>'},
    {id: 'sprechen', ask: 'Kann ich meine Idee einsprechen?', keys: {sprech: 3, sprach: 3, einsprech: 4, rede: 3, reinred: 4, einred: 4, sag: 2, erzaehl: 3, diktier: 4, mikro: 4, mund: 3, stimm: 2},
      a: 'Ja! Tippe im Eingabefeld auf den <b>Mund</b> („Antippen & sprechen“) und erzähl einfach. Beim ersten Mal fragt dein Browser, ob er das Mikrofon benutzen darf – bitte „Erlauben“. Zum Beenden tippst du auf den roten Mund („Stopp“). Das geht auch im Feld für Änderungen.'},
    {id: 'foto', ask: 'Kann ich ein eigenes Foto hochladen?', keys: {foto: 4, bild: 3, logo: 4, hochlad: 4, upload: 4, eigen: 1, vereinslogo: 4, firmenlogo: 4, hund: 2, gesicht: 2},
      a: 'Ja. Im Designer tippst du auf „Eigenes Foto oder Logo hochladen“ – die KI baut es in dein Design ein. Erlaubt sind JPG, PNG oder WebP bis 5 MB. Du kannst Foto und Beschreibung kombinieren, z. B. „unser Vereinslogo vorne links auf der Brust“. Bitte nur Bilder verwenden, an denen du die Rechte hast.'},
    {id: 'aendern', ask: 'Kann ich mein Design noch ändern?', keys: {aender: 4, anpass: 4, bearbeit: 4, korrigier: 4, verbesser: 3, anders: 3, dunkler: 2, heller: 2, groesser: 2, kleiner: 2, nochmal: 2, weiterbearbeit: 4},
      a: 'Klar! Unter deinem fertigen Shirt steht „Sie wollen noch Änderungen anbringen?“. Schreib oder sprich dort, was anders werden soll (z. B. „Schriftzug grösser, Ärmel in Blau“) und tippe auf „Änderungen übernehmen“. Auch aus dem Bestellformular kannst du jedes Design jederzeit weiterbearbeiten.'},
    {id: 'mehrere', ask: 'Kann ich mehrere Designs machen?', keys: {mehrer: 4, weiter: 2, noch: 1, zweit: 2, ander: 1, viele: 2, zusaetzlich: 3, neu: 2},
      a: 'Ja, so viele du willst. Tippe unten bei „Ihre T-Shirts“ auf „Weiteres T-Shirt designen“. Alle fertigen Designs bleiben dort erhalten, und du kannst eines, mehrere oder alle bestellen.'},
    {id: 'grossansicht', ask: 'Wie sehe ich mein Design gross?', keys: {gross: 2, ansicht: 3, vergroesser: 4, anschau: 3, zoom: 4, vorschau: 3, sehen: 1},
      a: 'Tippe unten bei „Ihre T-Shirts“ auf ein Design (oder auf das grosse Vorschaubild) – dann öffnet es sich bildschirmfüllend. Schliessen kannst du es mit einem Tipp, dem ✕ oder der Esc-Taste.'},
    {id: 'bestellen', ask: 'Wie bestelle ich mein T-Shirt?', keys: {bestell: 4, kauf: 4, order: 3, abschliess: 3, absend: 3},
      a: `So bestellst du:<ol><li>Unter „Ihre T-Shirts“ die gewünschten Designs ankreuzen und auf „T-Shirt zur Bestellung“ tippen.</li><li>Im ${ORDER} je Design Grössen und Stückzahlen wählen.</li><li>Kontaktdaten und Lieferadresse eingeben, AGB akzeptieren.</li><li>Auf „Zahlungspflichtig bestellen“ tippen.</li></ol>Danach bezahlst du per TWINT und bekommst eine Bestätigungs-Mail.`},
    {id: 'warenkorb', ask: 'Wo finde ich meinen Warenkorb?', keys: {warenkorb: 5, korb: 4, cart: 4, ausgewaehlt: 2},
      a: `Dein Warenkorb ist bei ShirtBOX direkt das ${ORDER} („Zur Bestellung“ oben). Dorthin kommen deine ausgewählten Designs, wenn du im Designer auf „T-Shirt zur Bestellung“ tippst. Dort wählst du Grössen und Stückzahlen und siehst den Gesamtbetrag.`},
    {id: 'preis', ask: 'Was kostet ein Shirt?', keys: {kost: 4, preis: 4, chf: 4, franken: 4, teuer: 4, rabatt: 4, guenstig: 3, betrag: 2, geld: 2},
      a: 'Ein Shirt kostet <b>CHF 89.–</b>, jedes weitere Shirt derselben Bestellung <b>CHF 80.10</b> (10 % Rabatt) – immer inklusive Mehrwertsteuer und Versand. Beispiele: 2 Shirts CHF 169.10, 5 Shirts CHF 409.40. Die Entwürfe im Designer sind kostenlos.'},
    {id: 'zahlung', ask: 'Wie bezahle ich?', keys: {zahl: 4, bezahl: 4, twint: 5, rechnung: 3, karte: 2, ueberweis: 3},
      a: 'Nach dem Absenden bezahlst du den angezeigten Gesamtbetrag per <b>TWINT</b> an ShirtBOX, 079 915 48 24. Du bekommst eine Bestätigungs-Mail mit Betrag und Zahlungsangaben – sie bestätigt den Bestelleingang, nicht den Zahlungseingang.'},
    {id: 'lieferung', ask: 'Wie lange dauert die Lieferung?', keys: {liefer: 4, dauer: 3, lang: 2, wann: 3, komm: 2, erhalt: 2, bekomm: 2, versand: 3, ankomm: 3, post: 2, tage: 2, zeit: 2},
      a: 'Die Lieferzeit beträgt ca. <b>14 Tage</b> (± einige Tage), gerechnet ab Zahlungseingang und sobald alle nötigen Angaben vorliegen. Bei absehbaren Verzögerungen wirst du informiert. Der Versand ist im Preis inbegriffen.'},
    {id: 'groesse', ask: 'Welche Grösse soll ich wählen?', keys: {groess: 4, size: 4, xl: 3, passt: 3, masse: 3, tabelle: 3, klein: 1},
      a: 'Wähle im Bestellformular deine gewohnte Grösse von S bis 5XL. Über dem Auswahlfeld kannst du die Grössentabelle mit den Shirtmassen aufklappen. Da es asiatische Grössen sind, wird automatisch zwei Grössen grösser bestellt (z. B. S → L). Du kannst beliebig viele Grössen und Stückzahlen kombinieren.'},
    {id: 'modelle', ask: 'Welche Shirt-Modelle gibt es?', keys: {modell: 4, polo: 4, zip: 4, reissverschluss: 4, kragen: 3, schnitt: 3, art: 1},
      a: 'Es gibt zwei Modelle: das <b>Polo-Shirt</b> mit Kragen und Knopfleiste und das <b>Zip-Shirt</b> mit Stehkragen und kurzem Reissverschluss. Du wählst das Modell im Designer als ersten Schritt.'},
    {id: 'material', ask: 'Aus welchem Material ist das Shirt?', keys: {material: 5, stoff: 4, polytex: 5, gsm: 4, qualitaet: 3, druck: 2, sublimation: 4, atmungsaktiv: 3},
      a: 'Das Shirt besteht aus <b>GSM-Polytex</b> – atmungsaktiv und strapazierfähig, ideal für Sport, Freizeit und Vereine. Es wird im Full-Sublimationsdruck rundum bedruckt: Vorderseite, Rückseite, Ärmel und Kragen.'},
    {id: 'waschen', ask: 'Wie wasche ich das Shirt?', keys: {wasch: 5, waesch: 5, pfleg: 4, grad: 2, maschine: 3, trockn: 3},
      a: 'Bei maximal 30 °C waschen. Handwäsche wird empfohlen, alternativ der Schonwaschgang in der Maschine.'},
    {id: 'dauerdesign', ask: 'Wie lange dauert ein Entwurf?', keys: {entwurf: 3, minut: 3, generier: 3, warten: 3, laed: 2, laden: 1},
      a: 'Ein Entwurf dauert etwa 1 bis 3 Minuten. Während die KI arbeitet, siehst du eine Sanduhr auf der Shirt-Vorschau. Bitte die Seite in der Zeit offen lassen.'},
    {id: 'rueckgabe', ask: 'Kann ich meine Bestellung ändern oder zurückgeben?', keys: {rueckgab: 5, zurueck: 3, storn: 5, umtausch: 5, widerruf: 4, retour: 5, annull: 4},
      a: `Änderungs- oder Stornierungswünsche bitte so schnell wie möglich an ${link('mailto:' + MAIL, MAIL)}. Vor Produktionsbeginn wird geprüft, ob sie noch möglich sind. Nach Beginn der individuellen Anfertigung gibt es kein freiwilliges Rückgabe- oder Umtauschrecht bei Nichtgefallen, falscher Grösse oder eigenen Motiv- und Schreibfehlern. Gesetzliche Rechte bleiben bestehen – Details in den ${link('agb.html', 'AGB')}.`},
    {id: 'reklamation', ask: 'Was mache ich bei einem fehlerhaften Shirt?', keys: {fehler: 4, kaputt: 5, mangel: 5, reklam: 5, defekt: 5, beschaedig: 5, problem: 2},
      a: `Melde Material-, Verarbeitungs- oder Druckmängel bitte umgehend an ${link('mailto:' + MAIL, MAIL)} – am besten mit Bestelldaten, Beschreibung und Fotos. Bei berechtigten Reklamationen wird auf Kosten von ShirtBOX eine Lösung gesucht.`},
    {id: 'kontakt', ask: 'Wie erreiche ich ShirtBOX?', keys: {kontakt: 5, erreich: 4, whatsapp: 5, mail: 4, telefon: 3, anruf: 3, mensch: 3, hilfe: 2, frage: 1, impressum: 3},
      a: `Du erreichst ShirtBOX per ${CONTACT}. Weitere Angaben stehen im ${link('impressum.html', 'Impressum')}.`},
    {id: 'druckdatei', ask: 'Kann ich eine eigene Druckdatei schicken?', keys: {druckdatei: 5, datei: 3, vorhanden: 3, fertig: 2, vorlage: 3},
      a: `Die Bestellung übernimmt die Entwürfe aus dem ${DESIGNER}. Eine eigene Druckdatei kannst du nach Absprache per E-Mail an ${link('mailto:' + MAIL, MAIL)} senden. Bitte nur Inhalte verwenden, an denen du die nötigen Rechte hast.`},
    {id: 'newsletter', ask: 'Gibt es einen Newsletter?', keys: {newsletter: 5, aktion: 3, angebot: 3, neuigkeit: 4, abonnier: 4},
      a: `Ja – im ${link('newsletter.html', 'Newsletter')} erfährst du zuerst von neuen Shirt-Ideen, Aktionen und Angeboten. Höchstens ein- bis zweimal im Monat, kostenlos und jederzeit mit einem Klick abbestellbar.`},
    {id: 'ueberuns', ask: 'Wer steckt hinter ShirtBOX?', keys: {wer: 3, ueber: 2, team: 2, firma: 3, jerome: 5, rudi: 5, gruender: 4, steckt: 4},
      a: `Hinter ShirtBOX stehen Jérôme „The Flying Bull“ und Rudi „Treff Nix“ – zwei Freunde und Arbeitskollegen mit einer Leidenschaft für Darts. Ihre ganze Geschichte findest du unter ${link('ueber-uns.html', 'Über uns')}.`},
    {id: 'rechte', ask: 'Darf ich jedes Bild verwenden?', keys: {recht: 4, erlaubt: 3, copyright: 5, urheber: 5, marke: 3, verwend: 2},
      a: 'Bitte verwende nur Bilder und Inhalte, für die du die nötigen Nutzungs- und Bildrechte hast. Vor dem Erstellen bestätigst du das mit einem Häkchen. Fremde Markenlogos ergänzt die KI nicht von sich aus.'},
    {id: 'chat', ask: 'Was speicherst du von mir?', keys: {speicher: 4, daten: 4, datenschutz: 5, privat: 3, verlauf: 3},
      a: 'Ich speichere unser Gespräch nur in deinem Browser, damit du nicht jedes Mal von vorne beginnen musst – nichts davon geht an einen Server. Mit „Verlauf löschen“ unten im Chat ist alles weg. Bitte schreib mir keine persönlichen Daten.'},
    {id: 'wer', ask: 'Wer bist du?', keys: {du: 1, bist: 3, shirti: 5, roboter: 4, ki: 2, bot: 4},
      a: 'Ich bin Shirti, der kleine ShirtBOX-Helfer. Ich antworte mit vorbereiteten Antworten zu ShirtBOX – ich bin keine echte KI und kann mich auch mal irren. Bei kniffligen Fragen hilft dir das ShirtBOX-Team gerne persönlich weiter.'},
    {id: 'hallo', keys: {hallo: 5, hoi: 5, gruezi: 5, hi: 5, hey: 5, servus: 5, morgen: 2, tag: 1}, a: 'Hallo! 👋 Schön, dass du da bist. Was möchtest du wissen?'},
    {id: 'danke', keys: {danke: 5, merci: 5, super: 3, toll: 3, cool: 3, perfekt: 3}, a: 'Gern geschehen! 😊 Wenn du noch etwas wissen möchtest, frag einfach.'}
  ];
  const BY_ID = Object.fromEntries(KB.map(e => [e.id, e]));

  // Seitenerkennung: kurze Erklärung der aktuellen Seite und passende Vorschläge.
  const page = (location.pathname.split('/').pop() || 'index.html').replace(/\?.*$/, '') || 'index.html';
  function context() { return pageTexts()[page === 'designhilfe.html' && document.querySelector('#studio-designs .studio-card') ? 'designhilfe-fertig' : page] || pageTexts().other; }
  const pageById = id => Object.values(pageTexts()).find(p => p.id === id);
  function pageTexts() {
    return {
      'index.html': {id: 'p-start', a: `Willkommen bei ShirtBOX! Hier gestaltest du mit KI dein eigenes, rundum bedrucktes Shirt – ganz ohne Grafikkenntnisse. Im ${DESIGNER} beschreibst du deine Idee (oder lädst ein Foto hoch), nach wenigen Minuten siehst du dein Shirt und kannst es direkt bestellen. Ein Shirt kostet CHF 89.– inkl. MwSt. und Versand.`, asks: ['gestalten', 'preis', 'lieferung', 'bestellen']},
      'designhilfe-fertig': {id: 'p-designs', a: 'Hier siehst du deine erstellten T-Shirt-Designs. Tippe auf ein Design, um es gross anzuschauen. Du kannst es mit „Änderungen übernehmen“ weiterbearbeiten, mit „Weiteres T-Shirt designen“ ein neues machen oder die angekreuzten Designs mit „T-Shirt zur Bestellung“ bestellen.', asks: ['aendern', 'grossansicht', 'mehrere', 'bestellen']},
      'designhilfe.html': {id: 'p-designer', a: 'Hier kannst du dein eigenes T-Shirt mit künstlicher Intelligenz gestalten. Wähl zuerst Polo- oder Zip-Shirt. Dann beschreib im grossen Feld – tippen oder sprechen –, wie dein T-Shirt aussehen soll und was darauf stehen soll. Je genauer deine Beschreibung, desto besser wird dein Wunschdesign. Optional kannst du ein Foto oder Logo hochladen. Dann Rechte bestätigen und auf „T-Shirt designen“ tippen.', asks: ['beschreibung', 'sprechen', 'foto', 'aendern']},
      'bestellen.html': {id: 'p-order', a: 'Das ist das Bestellformular. Hier kontrollierst du deine übernommenen Shirts und wählst je Design Grössen und Stückzahlen. Danach gibst du Kontaktdaten und Lieferadresse ein, prüfst die Zusammenfassung, akzeptierst die AGB und tippst auf „Zahlungspflichtig bestellen“. Bezahlt wird anschliessend per TWINT.', asks: ['groesse', 'preis', 'zahlung', 'lieferung']},
      'danke.html': {id: 'p-thanks', a: 'Danke für deine Bestellung! 🎉 Die Bestätigung kommt per E-Mail. Jetzt nur noch den Gesamtbetrag per TWINT an ShirtBOX, 079 915 48 24, bezahlen. Nach Zahlungseingang wird dein Shirt angefertigt – in ca. 14 Tagen ist es bei dir.', asks: ['zahlung', 'lieferung', 'rueckgabe']},
      'faq.html': {id: 'p-faq', a: 'Hier findest du die häufigsten Fragen zu Preis, Material, Gestaltung, Bestellung, Zahlung und Lieferung. Du kannst sie aufklappen – oder mich direkt fragen.', asks: ['preis', 'groesse', 'lieferung', 'waschen']},
      'shirts-live.html': {id: 'p-live', a: 'Hier siehst du im Video, wie ein fertiges ShirtBOX-Shirt aussieht – rundum bedruckt, aus atmungsaktivem GSM-Polytex, waschbar bis 30 °C.', asks: ['material', 'gestalten', 'preis']},
      'ueber-uns.html': {id: 'p-about', a: 'Hier erzählen Jérôme und Rudi, wie ShirtBOX entstanden ist – mit viel Darts und einer kleinen Rivalität. 🎯', asks: ['gestalten', 'kontakt']},
      'newsletter.html': {id: 'p-news', a: 'Hier meldest du dich für den ShirtBOX-Newsletter an. Du bekommst zuerst eine E-Mail mit Bestätigungslink – erst danach kommen Newsletter, höchstens ein- bis zweimal im Monat.', asks: ['newsletter', 'gestalten']},
      'eigenes-bild.html': {id: 'p-own', a: 'Hier gestaltest du dein Shirt mit eigenen Bildern: je ein Bild für Vorderseite, Rückseite, linken und rechten Ärmel (PNG, JPG oder WebP, max. 2 MB pro Bild). Bereiche kannst du auch frei lassen.', asks: ['foto', 'bestellen', 'preis']},
      'agb.html': {id: 'p-agb', a: 'Hier stehen die Allgemeinen Geschäftsbedingungen von ShirtBOX. Bei Fragen dazu hilft dir das Team gerne persönlich weiter.', asks: ['rueckgabe', 'kontakt']},
      'impressum.html': {id: 'p-imprint', a: `Hier findest du das Impressum mit allen Kontaktangaben von ShirtBOX. Am schnellsten erreichst du uns per ${CONTACT}.`, asks: ['kontakt', 'gestalten']},
      other: {id: 'p-other', a: `Ich helfe dir gerne beim Gestalten und Bestellen deines Shirts. Starte am besten im ${DESIGNER}.`, asks: ['gestalten', 'bestellen', 'preis']}
    };
  }
  const GREETING = 'Hallo! 👋 Ich bin Shirti, dein ShirtBOX-Helfer. Ich erkläre dir gerne, wie du dein persönliches T-Shirt gestalten kannst. Du kannst mir auch jederzeit eine Frage stellen!';
  const UNKNOWN = `Das weiss ich leider noch nicht genau. Schau bitte in unsere ${FAQ} oder kontaktiere ShirtBOX direkt per ${CONTACT}.`;

  // Stichworterkennung: Text vereinfachen, Wortanfänge mit der Wissensdatenbank vergleichen, bestes Thema wählen.
  const simplify = s => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/t-shirt/g, 'shirt').replace(/[^a-z0-9 ]+/g, ' ');
  function answer(question) {
    const words = simplify(question).split(/\s+/).filter(Boolean);
    let best = null, bestScore = 0;
    for (const entry of KB) {
      let score = 0;
      for (const [key, weight] of Object.entries(entry.keys)) {
        if (words.some(w => key.length <= 3 ? w === key : w.startsWith(key) || (key.length >= 5 && w.includes(key)))) score += weight;
      }
      if (score > bestScore) { best = entry; bestScore = score; }
    }
    return bestScore >= 3 ? best.id : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Verlauf: Shirti-Nachrichten werden nur als Kennung gespeichert (kein HTML), Kundentexte als reiner Text.
  let history = [];
  try { history = JSON.parse(localStorage.getItem(STORE) || '[]').filter(m => m && (m.u || m.b)); } catch {}
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(history.slice(-MAX_HISTORY))); } catch {} };
  const botHtml = key => key === 'greeting' ? GREETING : key === 'unknown' ? UNKNOWN : key.startsWith('p-') ? pageById(key)?.a || '' : BY_ID[key]?.a || '';

  // Oberfläche
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'shirti.css?v=20261031-1'; document.head.append(css);
  const root = document.createElement('div'); root.className = 'shirti'; root.dataset.only = 'shirti'; // von language.js nicht übersetzen, aber in beiden Sprachen zeigen
  root.innerHTML = `
    <button class="shirti-launch" type="button" aria-expanded="false" aria-controls="shirti-panel"><span class="shirti-face">${ROBOT}</span><span class="shirti-label">Frag mich</span></button>
    <section class="shirti-panel" id="shirti-panel" role="dialog" aria-label="Shirti – dein ShirtBOX-Helfer" hidden>
      <header class="shirti-head"><span class="shirti-face">${ROBOT}</span><div><strong>Shirti</strong><small>Dein ShirtBOX-Helfer</small></div>
        <button class="shirti-voice" type="button" aria-pressed="false" title="Antworten vorlesen" aria-label="Antworten vorlesen"><svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path class="wave" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/></svg></button>
        <button class="shirti-close" type="button" aria-label="Chat schliessen">✕</button></header>
      <div class="shirti-log" aria-live="polite"></div>
      <div class="shirti-asks"></div>
      <form class="shirti-form"><input type="text" placeholder="Stell mir deine Frage …" aria-label="Deine Frage an Shirti" autocomplete="off" maxlength="300"/><button type="submit" aria-label="Senden"><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg></button></form>
      <p class="shirti-note">Vorbereitete Antworten, keine KI · <button type="button" class="shirti-clear">Verlauf löschen</button></p>
    </section>`;
  document.body.append(root);
  const $ = s => root.querySelector(s);
  const launch = $('.shirti-launch'), panel = $('.shirti-panel'), log = $('.shirti-log'), asks = $('.shirti-asks'), form = $('.shirti-form'), input = form.querySelector('input'), voice = $('.shirti-voice');

  // Über der fixen Fusszeile bleiben, damit nichts verdeckt wird.
  function place() {
    const footer = document.querySelector('.site-footer');
    const bottom = footer && ['sticky', 'fixed'].includes(getComputedStyle(footer).position) ? footer.offsetHeight : 0;
    root.style.setProperty('--shirti-bottom', `${bottom + 10}px`);
  }
  place(); addEventListener('resize', place);

  function bubble(m, animate) {
    const el = document.createElement('div');
    if (m.u) { el.className = 'shirti-msg is-user'; el.textContent = m.u; }
    else {
      const html = botHtml(m.b); if (!html) return null;
      el.className = 'shirti-msg is-bot'; el.innerHTML = html;
      if (speech) { const play = document.createElement('button'); play.type = 'button'; play.className = 'shirti-play'; play.title = 'Vorlesen'; play.setAttribute('aria-label', 'Diese Antwort vorlesen'); play.textContent = '▶'; play.addEventListener('click', () => speak(el)); el.append(play); }
    }
    if (animate) el.classList.add('is-new');
    log.append(el); log.scrollTop = log.scrollHeight;
    return el;
  }
  function suggestions(ids) {
    asks.replaceChildren(...ids.filter(id => BY_ID[id]?.ask).slice(0, 4).map(id => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = BY_ID[id].ask;
      b.addEventListener('click', () => ask(BY_ID[id].ask, id)); return b;
    }));
  }
  function add(m) {
    history.push(m); save();
    const el = bubble(m, true);
    if (el && m.b && voiceOn) speak(el);
  }
  // Shirti „tippt“ kurz, dann erscheint die Antwort.
  function reply(key, delay = 450) {
    const typing = document.createElement('div'); typing.className = 'shirti-msg is-bot is-typing'; typing.innerHTML = '<i></i><i></i><i></i>';
    log.append(typing); log.scrollTop = log.scrollHeight; root.classList.add('is-talking');
    setTimeout(() => { typing.remove(); root.classList.remove('is-talking'); add({b: key}); }, delay);
  }
  function ask(text, id) {
    add({u: text});
    const key = id || answer(text) || 'unknown';
    reply(key, 550);
    suggestions(key === 'unknown' ? context().asks : KB.filter(e => e.ask && e.id !== key).map(e => e.id).filter(x => context().asks.includes(x)).concat(['kontakt']));
  }

  function open() {
    panel.hidden = false; launch.setAttribute('aria-expanded', 'true'); root.classList.add('is-open');
    if (!log.childElementCount) history.forEach(m => bubble(m, false));
    const ctx = context();
    if (!history.length) add({b: 'greeting'});
    // Die aktuelle Seite erklären, sofern sie nicht schon die letzte Erklärung im Verlauf ist.
    const lastPage = [...history].reverse().find(m => m.b?.startsWith('p-'));
    if (lastPage?.b !== ctx.id) reply(ctx.id, history.length > 1 ? 350 : 700);
    suggestions(ctx.asks);
    setTimeout(() => { if (matchMedia('(min-width: 700px)').matches) input.focus({preventScroll: true}); }, 50);
  }
  function close() { panel.hidden = true; launch.setAttribute('aria-expanded', 'false'); root.classList.remove('is-open'); stopSpeaking(); launch.focus({preventScroll: true}); }
  launch.addEventListener('click', () => panel.hidden ? open() : close());
  $('.shirti-close').addEventListener('click', close);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });
  form.addEventListener('submit', e => { e.preventDefault(); const q = input.value.trim(); if (!q) return; input.value = ''; ask(q); });
  $('.shirti-clear').addEventListener('click', () => { history = []; save(); log.replaceChildren(); stopSpeaking(); add({b: 'greeting'}); reply(context().id, 500); suggestions(context().asks); });

  // ---------------------------------------------------------------------------------------------
  // Vorlesen mit der kostenlosen Sprachausgabe des Browsers – nur auf Wunsch (Lautsprecher-Knopf oder ▶ bei einer Antwort).
  const speech = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  let voiceOn = false, germanVoice = null;
  function pickVoice() {
    const voices = speechSynthesis.getVoices().filter(v => /^de(-|_|$)/i.test(v.lang));
    const rank = v => (/natural|neural|premium|enhanced|google/i.test(v.name) ? 0 : 2) + (/de-CH/i.test(v.lang) ? 0 : 1);
    germanVoice = voices.sort((a, b) => rank(a) - rank(b))[0] || null;
  }
  function stopSpeaking() { if (speech) speechSynthesis.cancel(); root.classList.remove('is-talking'); }
  function speak(el) {
    if (!speech) return;
    stopSpeaking();
    const copy = el.cloneNode(true); copy.querySelectorAll('.shirti-play').forEach(b => b.remove());
    copy.querySelectorAll('li').forEach(li => li.append('. '));
    const text = copy.textContent.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '').replace(/CHF ([\d.]+)\.–/g, '$1 Franken').replace(/CHF ([\d.]+)/g, '$1 Franken').replace(/\s+/g, ' ').trim();
    const u = new SpeechSynthesisUtterance(text); u.lang = germanVoice?.lang || 'de-DE'; if (germanVoice) u.voice = germanVoice; u.rate = 1; u.pitch = 1.05;
    u.onstart = () => root.classList.add('is-talking'); u.onend = u.onerror = () => root.classList.remove('is-talking');
    speechSynthesis.speak(u);
  }
  if (speech) {
    pickVoice(); speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
    voice.addEventListener('click', () => {
      voiceOn = !voiceOn; voice.setAttribute('aria-pressed', String(voiceOn));
      voice.setAttribute('aria-label', voiceOn ? 'Vorlesen ausschalten' : 'Antworten vorlesen'); voice.title = voice.getAttribute('aria-label');
      if (voiceOn) { const last = [...log.querySelectorAll('.shirti-msg.is-bot:not(.is-typing)')].pop(); if (last) speak(last); } else stopSpeaking();
    });
    addEventListener('pagehide', stopSpeaking);
  } else voice.hidden = true;
})();
