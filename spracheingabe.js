(() => {
  'use strict';
  const button = document.getElementById('ai-speech');
  if (!button) return;
  const form = document.getElementById('ai-design-form');
  const prompt = document.getElementById('ai-design-prompt');
  const status = document.getElementById('ai-speech-status');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition || !window.isSecureContext) {
    button.disabled = true; button.dataset.unsupported = 'true';
    status.textContent = 'Spracheingabe ist in diesem Browser nicht verfügbar. Nutzen Sie die Diktierfunktion Ihrer Tastatur oder schreiben Sie Ihre Idee.';
    return;
  }
  let recognition = null, base = '', committed = '', error = false, finishTimer = null;
  function active(value) {
    form.dataset.dictating = String(value);
    button.setAttribute('aria-pressed', String(value));
    button.textContent = value ? '■ Diktat beenden' : '🎙 Idee einsprechen';
    prompt.readOnly = value;
    form.querySelectorAll('[data-design-example]').forEach(el => el.disabled = value);
    form.dispatchEvent(new Event('dictationchange'));
  }
  function clearFinishTimer() {
    if (finishTimer !== null) clearTimeout(finishTimer);
    finishTimer = null;
  }
  function cancel() {
    clearFinishTimer();
    const old = recognition; recognition = null;
    try { if (old) old.abort(); } catch { /* Always restore the controls. */ }
    active(false);
  }
  function awaitEnd(session) {
    clearFinishTimer();
    finishTimer = setTimeout(() => {
      if (recognition !== session) return;
      prompt.value = committed;
      cancel();
      if (!error) status.textContent = 'Die Spracheingabe wurde beendet. Prüfen Sie den übernommenen Text. Sie können erneut einsprechen.';
    }, 5000);
  }
  function stop() {
    const session = recognition;
    if (!session) return;
    button.disabled = true;
    awaitEnd(session);
    try { session.stop(); }
    catch {
      prompt.value = committed;
      cancel();
      status.textContent = 'Die Spracheingabe wurde unterbrochen. Ihr bestätigter Text bleibt erhalten. Sie können erneut einsprechen.';
    }
  }
  button.addEventListener('click', () => {
    if (recognition) { stop(); return; }
    base = prompt.value.trim(); committed = base; error = false;
    const session = new Recognition(); recognition = session;
    session.lang = 'de-DE'; session.continuous = true; session.interimResults = true;
    session.onstart = () => { if (recognition === session) status.textContent = 'Ich höre zu … Beschreiben Sie Ihr Shirt.'; };
    session.onresult = event => {
      if (recognition !== session) return;
      let final = '', interim = '';
      for (const result of event.results) {
        if (result.isFinal) final += result[0].transcript + ' ';
        else interim += result[0].transcript + ' ';
      }
      committed = [base, final.trim()].filter(Boolean).join(' ').slice(0, prompt.maxLength);
      prompt.value = [base, final.trim(), interim.trim()].filter(Boolean).join(' ').slice(0, prompt.maxLength);
      prompt.dispatchEvent(new Event('input', {bubbles: true}));
    };
    session.onerror = event => {
      if (recognition !== session) return;
      error = true;
      awaitEnd(session);
      const messages = {
        'not-allowed': 'Bitte erlauben Sie den Mikrofonzugriff im Browser, um Ihre Idee einzusprechen.',
        'service-not-allowed': 'Der Sprachdienst ist in diesem Browser nicht verfügbar. Bitte nutzen Sie die Diktierfunktion Ihrer Tastatur.',
        'audio-capture': 'Kein Mikrofon gefunden. Bitte prüfen Sie Ihr Mikrofon.',
        'no-speech': 'Keine Sprache erkannt. Klicken Sie auf „Idee einsprechen“ und versuchen Sie es nochmals.',
        'network': 'Die Spracherkennung ist nicht erreichbar. Bitte prüfen Sie Ihre Internetverbindung.'
      };
      status.textContent = messages[event.error] || 'Die Spracheingabe wurde unterbrochen. Sie können den Text bearbeiten oder erneut diktieren.';
    };
    session.onend = () => {
      if (recognition !== session) return;
      clearFinishTimer();
      recognition = null; prompt.value = committed; active(false);
      if (!error) status.textContent = committed !== base ? 'Diktat eingefügt. Prüfen Sie den Text und erstellen oder ändern Sie Ihren Entwurf.' : 'Diktat beendet. Sie können erneut einsprechen oder Ihre Idee schreiben.';
    };
    active(true); status.textContent = 'Mikrofon wird gestartet …';
    try { session.start(); }
    catch { cancel(); status.textContent = 'Die Spracheingabe konnte nicht gestartet werden. Bitte versuchen Sie es erneut.'; }
  });
  document.getElementById('ai-reset').addEventListener('click', () => { cancel(); status.textContent = ''; });
  window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden && recognition) stop(); });
})();
