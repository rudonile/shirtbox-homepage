// Newsletter-Seite: Anmeldung (Double-Opt-in) sowie Bestätigen/Abmelden über den Link aus der E-Mail.
// Bestätigen und Abmelden brauchen einen Klick, damit Virenscanner in Postfächern nichts automatisch auslösen.
(() => {
  const API = 'https://shirtbox-email.r-n.workers.dev/newsletter';
  const $ = id => document.getElementById(id);
  const post = async (path, body) => {
    const res = await fetch(`${API}/${path}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(20000)});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(data.error || 'Das hat leider nicht geklappt. Bitte später erneut versuchen.');
    return data;
  };
  const show = (el, text, good) => { el.hidden = false; el.textContent = text; el.className = 'nl-msg ' + (good ? 'good' : 'bad'); };

  const params = new URLSearchParams(location.search);
  const token = params.get('bestaetigen') || params.get('abmelden');
  if (token) {
    const confirm = params.has('bestaetigen');
    $('nl-anmelden').hidden = true; $('nl-link').hidden = false;
    $('nl-link-title').textContent = confirm ? 'Anmeldung bestätigen' : 'Newsletter abbestellen';
    $('nl-link-text').textContent = confirm ? 'Bitte bestätige mit einem Klick, dass du den ShirtBOX-Newsletter erhalten möchtest.' : 'Schade, dass du gehst. Mit einem Klick erhältst du keine Newsletter mehr von uns.';
    const button = $('nl-link-button');
    button.textContent = confirm ? 'Ja, Newsletter erhalten' : 'Jetzt abmelden';
    if (!confirm) button.classList.add('ghost');
    const texts = {
      bestaetigt: ['Vielen Dank! Deine Anmeldung ist bestätigt. Du erhältst ab sofort unseren Newsletter.', true],
      bereits: [confirm ? 'Deine Anmeldung war bereits bestätigt.' : 'Du warst bereits abgemeldet.', true],
      abgemeldet: ['Du wurdest abgemeldet und erhältst keine Newsletter mehr. Du kannst dich jederzeit wieder anmelden.', true],
      abgelaufen: ['Dieser Bestätigungslink ist abgelaufen. Bitte melde dich erneut an.', false],
      unbekannt: ['Dieser Link ist ungültig oder wurde bereits verwendet.', false]
    };
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const {status} = await post(confirm ? 'bestaetigen' : 'abmelden', {token});
        const [text, good] = texts[status] || texts.unbekannt;
        show($('nl-link-msg'), text, good);
        if (good) button.hidden = true; else button.disabled = false;
      } catch (e) { show($('nl-link-msg'), e.message, false); button.disabled = false; }
    });
    return;
  }

  $('nl-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('nl-msg'), button = $('nl-submit'), email = $('nl-email').value.trim(), vorname = $('nl-vorname').value.trim();
    // Fehlende Angabe: hinscrollen und orange pulsierend markieren (window.sbMissing aus navigation.js).
    const missing = (field, focus) => { if (window.sbMissing) window.sbMissing(field, focus); else focus?.focus(); };
    if (!vorname) { show(msg, 'Bitte gib deinen Vornamen ein.', false); missing($('nl-vorname'), $('nl-vorname')); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { show(msg, 'Bitte gib eine gültige E-Mail-Adresse ein.', false); missing($('nl-email'), $('nl-email')); return; }
    const turnstile = window.turnstile?.getResponse() || '';
    if (!turnstile) { show(msg, 'Bitte warte kurz, bis die Sicherheitsprüfung abgeschlossen ist.', false); missing(document.querySelector('#nl-form .cf-turnstile') || msg); return; }
    button.disabled = true;
    try {
      const {status} = await post('anmelden', {email, vorname, nachname: $('nl-nachname').value.trim(), website: $('nl-website').value, turnstile});
      show(msg, status === 'bereits' ? 'Du bist bereits angemeldet – vielen Dank!' : 'Fast geschafft! Wir haben dir eine E-Mail geschickt. Bitte klicke auf den Link darin, um die Anmeldung zu bestätigen.', true);
      $('nl-form').querySelectorAll('input').forEach(i => i.disabled = true);
      button.hidden = true;
    } catch (err) { show(msg, err.message, false); button.disabled = false; window.turnstile?.reset(); }
  });
})();
