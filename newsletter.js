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
    $('nl-link-text').textContent = confirm ? 'Bitte bestätigen Sie mit einem Klick, dass Sie den ShirtBOX-Newsletter erhalten möchten.' : 'Schade, dass Sie gehen. Mit einem Klick erhalten Sie keine Newsletter mehr von uns.';
    const button = $('nl-link-button');
    button.textContent = confirm ? 'Ja, Newsletter erhalten' : 'Jetzt abmelden';
    if (!confirm) button.classList.add('ghost');
    const texts = {
      bestaetigt: ['Vielen Dank! Ihre Anmeldung ist bestätigt. Sie erhalten ab sofort unseren Newsletter.', true],
      bereits: [confirm ? 'Ihre Anmeldung war bereits bestätigt.' : 'Sie waren bereits abgemeldet.', true],
      abgemeldet: ['Sie wurden abgemeldet und erhalten keine Newsletter mehr. Sie können sich jederzeit wieder anmelden.', true],
      abgelaufen: ['Dieser Bestätigungslink ist abgelaufen. Bitte melden Sie sich erneut an.', false],
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
    if (!vorname) { show(msg, 'Bitte geben Sie Ihren Vornamen ein.', false); $('nl-vorname').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { show(msg, 'Bitte geben Sie eine gültige E-Mail-Adresse ein.', false); $('nl-email').focus(); return; }
    const turnstile = window.turnstile?.getResponse() || '';
    if (!turnstile) { show(msg, 'Bitte warten Sie kurz, bis die Sicherheitsprüfung abgeschlossen ist.', false); return; }
    button.disabled = true;
    try {
      const {status} = await post('anmelden', {email, vorname, nachname: $('nl-nachname').value.trim(), website: $('nl-website').value, turnstile});
      show(msg, status === 'bereits' ? 'Sie sind bereits angemeldet – vielen Dank!' : 'Fast geschafft! Wir haben Ihnen eine E-Mail geschickt. Bitte klicken Sie auf den Link darin, um die Anmeldung zu bestätigen.', true);
      $('nl-form').querySelectorAll('input').forEach(i => i.disabled = true);
      button.hidden = true;
    } catch (err) { show(msg, err.message, false); button.disabled = false; window.turnstile?.reset(); }
  });
})();
