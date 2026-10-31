// ShirtBOX Verwaltung – Oberfläche (ohne Fremdbibliotheken). Alle Daten kommen von /api/… desselben Workers.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const content = $('content');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const money = new Intl.NumberFormat('de-CH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const chf = r => `CHF ${money.format((Number(r) || 0) / 100)}`;
  const chfShort = r => { const v = (Number(r) || 0) / 100; return v >= 1000 ? `${new Intl.NumberFormat('de-CH', {maximumFractionDigits: 1}).format(v / 1000)}k` : String(Math.round(v)); };
  const dateFmt = new Intl.DateTimeFormat('de-CH', {timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric'});
  const timeFmt = new Intl.DateTimeFormat('de-CH', {timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
  const date = iso => iso ? dateFmt.format(new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)) : '–';
  const time = iso => iso ? timeFmt.format(new Date(iso)) : '–';
  const kNr = id => `K-${10000 + Number(id)}`;
  const STATUS = {neu: ['Neu', 'info'], bearbeitung: ['In Bearbeitung', 'warn'], produziert: ['Produziert', 'accent'], versendet: ['Versendet', 'info'], abgeschlossen: ['Abgeschlossen', 'good'], storniert: ['Storniert', 'bad']};
  const ZAHLUNG = {offen: ['Offen', 'warn'], teilweise: ['Teilweise bezahlt', 'info'], bezahlt: ['Bezahlt', 'good'], rueckerstattet: ['Rückerstattet', 'bad']};
  const ABO = {aktiv: ['Aktiv', 'good'], ausstehend: ['Bestätigung ausstehend', 'warn'], abgemeldet: ['Abgemeldet', ''], unzustellbar: ['Unzustellbar', 'bad'], beschwerde: ['Spam-Beschwerde', 'bad']};
  const NL = {entwurf: ['Entwurf', ''], versand: ['Wird versendet', 'warn'], versendet: ['Versendet', 'good']};
  const EMPF = {wartend: 'Wartet', gesendet: 'Gesendet', zugestellt: 'Zugestellt', fehler: 'Fehler', unzustellbar: 'Unzustellbar', beschwerde: 'Spam-Beschwerde', uebersprungen: 'Übersprungen'};
  const badge = (map, key) => { const [label, cls] = map[key] || [key || '–', '']; return `<span class="badge ${cls}">${esc(label)}</span>`; };
  const options = (map, selected) => Object.entries(map).map(([k, [label]]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const LINKS = [['Startseite', 'https://shirtbox.ch/'], ['Shirt erstellen (KI-Designer)', 'https://shirtbox.ch/designhilfe.html'], ['Shirts live', 'https://shirtbox.ch/shirts-live.html'], ['Bestellen', 'https://shirtbox.ch/bestellen.html'], ['FAQs', 'https://shirtbox.ch/faq.html'], ['Über uns', 'https://shirtbox.ch/ueber-uns.html']];

  // ---- Server-Anfragen ----
  async function api(path, {method = 'GET', body, raw} = {}) {
    const opts = {method, credentials: 'same-origin', headers: {'X-ShirtBOX': '1'}};
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(path, opts);
    if (res.status === 401 && path !== '/api/login') { showLogin('Ihre Sitzung ist abgelaufen. Bitte erneut anmelden.'); throw Error('abgemeldet'); }
    if (raw) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(data.error || `Fehler ${res.status}`);
    activity();
    return data;
  }
  function toast(text, bad) { const t = $('toast'); t.textContent = text; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => t.hidden = true, 3800); }
  const failed = e => { if (e.message !== 'abgemeldet') toast(e.message, true); };

  // Bestätigungsdialog. Gibt true zurück, wenn bestätigt.
  function confirmDialog(bodyHtml, okLabel = 'OK', danger = false, check) {
    return new Promise(resolve => {
      const dialog = $('dialog');
      $('dialog-body').innerHTML = bodyHtml;
      $('dialog-actions').innerHTML = `<button class="btn" value="nein" type="submit">Abbrechen</button><button class="btn ${danger ? 'btn-danger' : 'btn-main'}" value="ja" type="submit" id="dialog-ok">${esc(okLabel)}</button>`;
      const ok = $('dialog-ok');
      ok.disabled = !!check;
      $('dialog-body').oninput = check ? () => { ok.disabled = !check(); } : null;
      dialog.onclose = () => resolve(dialog.returnValue === 'ja');
      dialog.returnValue = '';
      dialog.showModal();
    });
  }

  // ---- Anmeldung und automatische Abmeldung bei Inaktivität ----
  let timeoutMin = 30, lastActivity = Date.now(), idleTimer = null;
  function activity() { lastActivity = Date.now(); }
  ['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(e => addEventListener(e, activity, {passive: true}));
  function startIdleWatch() {
    clearInterval(idleTimer);
    idleTimer = setInterval(async () => {
      if ($('app').hidden) return;
      const idle = Date.now() - lastActivity;
      if (idle > timeoutMin * 60000) { await fetch('/api/logout', {method: 'POST', headers: {'X-ShirtBOX': '1'}}).catch(() => {}); showLogin('Aus Sicherheitsgründen wurden Sie nach ' + timeoutMin + ' Minuten ohne Aktivität abgemeldet.'); }
      else if (idle > timeoutMin * 60000 - 120000) toast('Sie werden in Kürze automatisch abgemeldet. Klicken Sie irgendwo, um angemeldet zu bleiben.');
      else if (idle < 60000 && Date.now() - (startIdleWatch.ping || 0) > 4 * 60000) { startIdleWatch.ping = Date.now(); fetch('/api/sitzung', {headers: {'X-ShirtBOX': '1'}}).catch(() => {}); }
    }, 30000);
  }
  function showLogin(message) {
    $('app').hidden = true; $('login').hidden = false; content.innerHTML = '';
    const err = $('login-fehler'); err.hidden = !message; err.textContent = message || '';
    err.style.background = message && message.startsWith('Aus Sicherheits') ? '#e8eefc' : ''; err.style.color = message && message.startsWith('Aus Sicherheits') ? '#2f5bd3' : '';
    $('login-passwort').value = ''; $('login-code').value = ''; setTimeout(() => $('login-passwort').focus(), 50);
  }
  function showApp() { $('login').hidden = true; $('app').hidden = false; lastActivity = Date.now(); startIdleWatch(); render(); }
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('button'); btn.disabled = true;
    try {
      const data = await api('/api/login', {method: 'POST', body: {passwort: $('login-passwort').value, code: $('login-code').value}});
      timeoutMin = data.timeout || 30; showApp();
    } catch (err) { const box = $('login-fehler'); box.hidden = false; box.style.background = ''; box.style.color = ''; box.textContent = err.message; }
    btn.disabled = false;
  });
  $('logout').addEventListener('click', async () => { await api('/api/logout', {method: 'POST'}).catch(() => {}); showLogin('Sie wurden abgemeldet.'); });
  $('menu-btn').addEventListener('click', () => { const open = $('side').classList.toggle('open'); $('menu-btn').setAttribute('aria-expanded', open); });
  $('menu').addEventListener('click', () => $('side').classList.remove('open'));
  // Klickbare Tabellenzeilen (keine Inline-Skripte wegen Sicherheitsrichtlinie).
  content.addEventListener('click', e => {
    if (e.target.closest('a, button, input, select, textarea')) { if (e.target.closest('[data-reload]')) location.reload(); return; }
    const row = e.target.closest('[data-href]'); if (row) location.hash = row.dataset.href;
  });

  // ---- Navigation ----
  const TITLES = {dashboard: 'Dashboard', kunden: 'Kunden', bestellungen: 'Bestellungen', umsatz: 'Umsatz', newsletter: 'Newsletter', 'newsletter-erstellen': 'Newsletter erstellen', einstellungen: 'Einstellungen'};
  addEventListener('hashchange', render);
  let renderId = 0;
  async function render() {
    if ($('app').hidden) return;
    const [view = 'dashboard', id] = location.hash.replace(/^#\/?/, '').split('/');
    const page = PAGES[view] ? view : 'dashboard';
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === page));
    $('topbar-title').textContent = TITLES[page]; document.title = `${TITLES[page]} · ShirtBOX Verwaltung`;
    const mine = ++renderId;
    content.innerHTML = '<p class="loading">Wird geladen …</p>';
    try { const html = await PAGES[page](id); if (mine === renderId && typeof html === 'string') { content.innerHTML = html; while (AFTER.length) AFTER.shift()(); } }
    catch (e) { if (mine === renderId && e.message !== 'abgemeldet') content.innerHTML = `<div class="card"><h2>Das hat nicht geklappt</h2><p class="error">${esc(e.message)}</p><button class="btn" data-reload>Neu laden</button></div>`; }
    AFTER.length = 0;
    window.scrollTo(0, 0);
  }
  const AFTER = []; // Funktionen, die nach dem Einfügen des HTML laufen (Ereignisse binden)
  const after = fn => AFTER.push(fn);
  const kpi = (label, value, note, cls = '') => `<div class="kpi ${cls}"><span>${esc(label)}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ''}</div>`;
  const pager = (total, seite, size = 50) => total > size ? `<div class="pager"><span>${total} Einträge · Seite ${seite} von ${Math.ceil(total / size)}</span><span class="actions">${seite > 1 ? '<button class="btn btn-small" data-page="-1">← Zurück</button>' : ''}${seite * size < total ? '<button class="btn btn-small" data-page="1">Weiter →</button>' : ''}</span></div>` : `<div class="pager"><span>${total} Einträge</span></div>`;
  // Filter einmal pro Seitenaufbau binden, Blättern nach jedem Neuladen der Liste.
  function bindFilters(state, reload) {
    content.querySelectorAll('[data-filter]').forEach(el => el.addEventListener(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', () => {
      clearTimeout(bindFilters.t); bindFilters.t = setTimeout(() => { state[el.dataset.filter] = el.value; state.seite = 1; reload().catch(failed); }, el.type === 'search' ? 300 : 0);
    }));
  }
  function bindPager(box, state, reload) {
    box.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { state.seite += Number(b.dataset.page); reload().catch(failed); }));
  }
  const query = state => new URLSearchParams(Object.entries(state).filter(([, v]) => v !== '' && v != null)).toString();

  // ---- Diagramm: Umsatz pro Tag oder Monat (eine Reihe) ----
  function chart(el, verlauf) {
    const points = verlauf.punkte, monthly = verlauf.zeitraum === '12m';
    const draw = () => {
      const W = Math.max(280, el.clientWidth), H = 260, padL = 46, padB = 26, padT = 12, innerW = W - padL - 6, innerH = H - padB - padT;
      const max = Math.max(...points.map(p => p.summe), 0);
      const stepRaw = (max || 10000) / 4, mag = Math.pow(10, Math.floor(Math.log10(stepRaw))), step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= stepRaw);
      const top = step * 4, slot = innerW / points.length, bw = Math.max(3, Math.min(34, slot - 4));
      const y = v => padT + innerH - (v / top) * innerH;
      const label = p => monthly ? new Intl.DateTimeFormat('de-CH', {month: 'short', year: '2-digit', timeZone: 'UTC'}).format(new Date(p.periode + '-01T12:00:00Z')) : date(p.periode).slice(0, 5);
      const every = Math.ceil(points.length / Math.max(2, Math.floor(innerW / 56)));
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Umsatzentwicklung">`;
      for (let i = 0; i <= 4; i++) { const v = step * i, yy = y(v); svg += `<line class="grid-line" x1="${padL}" x2="${W - 6}" y1="${yy}" y2="${yy}"/><text class="axis" x="${padL - 8}" y="${yy + 4}" text-anchor="end">${chfShort(v)}</text>`; }
      points.forEach((p, i) => {
        const x = padL + slot * i + (slot - bw) / 2, h = Math.max(0, padT + innerH - y(p.summe)), r = Math.min(4, bw / 2, h);
        if (h > 0) svg += `<path class="bar" data-i="${i}" d="M${x},${padT + innerH} V${y(p.summe) + r} Q${x},${y(p.summe)} ${x + r},${y(p.summe)} H${x + bw - r} Q${x + bw},${y(p.summe)} ${x + bw},${y(p.summe) + r} V${padT + innerH} Z"/>`;
        if (i % every === 0 || i === points.length - 1) svg += `<text class="axis" x="${padL + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(label(p))}</text>`;
        svg += `<rect class="hit" data-i="${i}" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${innerH}"/>`;
      });
      svg += `<line x1="${padL}" x2="${W - 6}" y1="${padT + innerH}" y2="${padT + innerH}" stroke="#c9c3b6"/></svg><div class="chart-tip" hidden></div>`;
      el.innerHTML = svg;
      const tip = el.querySelector('.chart-tip');
      el.querySelectorAll('.hit').forEach(hit => {
        const show = () => {
          const i = Number(hit.dataset.i), p = points[i];
          el.querySelectorAll('.bar').forEach(b => b.classList.toggle('on', b.dataset.i === hit.dataset.i));
          tip.innerHTML = `${esc(monthly ? label(p) : date(p.periode))}<b>${chf(p.summe)}</b>${p.anzahl} Bestellung${p.anzahl === 1 ? '' : 'en'}`;
          tip.style.left = `${Math.min(W - 70, Math.max(70, padL + slot * i + slot / 2))}px`; tip.style.top = `${Math.max(40, y(p.summe) - 8)}px`; tip.hidden = false;
        };
        hit.addEventListener('pointerenter', show); hit.addEventListener('click', show);
      });
    };
    el.addEventListener('pointerleave', () => { const tip = el.querySelector('.chart-tip'); if (tip) tip.hidden = true; el.querySelectorAll('.bar.on').forEach(b => b.classList.remove('on')); });
    el._w = el.clientWidth; draw();
    const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } if (Math.abs(el.clientWidth - el._w) > 8) { el._w = el.clientWidth; draw(); } });
    ro.observe(el);
  }
  const chartTable = verlauf => `<details class="table-view"><summary>Werte als Tabelle anzeigen</summary><div class="table-wrap"><table><thead><tr><th>${verlauf.zeitraum === '12m' ? 'Monat' : 'Tag'}</th><th class="num">Bestellungen</th><th class="num">Betrag</th></tr></thead><tbody>${verlauf.punkte.slice().reverse().map(p => `<tr><td>${esc(verlauf.zeitraum === '12m' ? p.periode.split('-').reverse().join('.') : date(p.periode))}</td><td class="num">${p.anzahl}</td><td class="num">${chf(p.summe)}</td></tr>`).join('')}</tbody></table></div></details>`;

  // ---- Seiten ----
  const PAGES = {};

  PAGES.dashboard = async () => {
    const d = await api('/api/dashboard'), b = d.bestellungen, u = d.umsatz;
    after(() => chart($('chart'), d.verlauf));
    return `<div class="page-head"><div><h1>Dashboard</h1><p class="muted">Stand ${time(new Date().toISOString())} · alle Beträge in CHF inkl. MwSt. und Versand</p></div></div>
      <div class="grid kpis">
        ${kpi('Bestellungen heute', b.heute)}${kpi('Diese Woche', b.woche)}${kpi('Diesen Monat', b.monat)}${kpi('Bestellungen total', b.total, b.storniert ? `${b.storniert} storniert (nicht gezählt)` : '')}
        ${kpi('Umsatz heute', chf(u.heute))}${kpi('Umsatz diese Woche', chf(u.woche))}${kpi('Umsatz diesen Monat', chf(u.monat))}${kpi('Gesamtumsatz', chf(u.total), 'Bestellwert', 'highlight')}
        ${kpi('Offene Zahlungen', b.offen, '<a href="#/bestellungen/?zahlung=offen">ansehen</a>')}${kpi('Bezahlte Bestellungen', b.bezahlt, chf(u.bezahlt) + ' erhalten')}${kpi('Verkaufte T-Shirts', d.shirts)}${kpi('Ø Bestellwert', chf(u.durchschnitt))}
      </div>
      <div class="grid kpis" style="margin-top:12px">
        ${kpi('In Arbeit', b.in_arbeit, 'Neu, in Bearbeitung, produziert')}${kpi('Kunden', d.kunden)}${kpi('Newsletter-Abonnenten', d.abonnenten, d.ausstehend ? `${d.ausstehend} warten auf Bestätigung` : '')}${kpi('Abgemeldet', d.abgemeldet)}
      </div>
      <div class="card"><h2>Umsatz der letzten 30 Tage <a class="btn btn-small" href="#/umsatz">Mehr Auswertungen</a></h2><div class="chart" id="chart"></div>${chartTable(d.verlauf)}</div>
      <div class="card"><h2>Neueste Bestellungen <a class="btn btn-small" href="#/bestellungen">Alle Bestellungen</a></h2>
        ${d.neueste.length ? `<div class="table-wrap"><table><thead><tr><th>Bestellung</th><th>Kunde</th><th class="hide-mobile">Datum</th><th class="num">Betrag</th><th>Status</th><th>Zahlung</th></tr></thead><tbody>
        ${d.neueste.map(o => `<tr class="click" data-href="#/bestellungen/${o.id}"><td><b>${esc(o.bestellnummer)}</b></td><td>${esc(o.vorname)} ${esc(o.nachname)}</td><td class="hide-mobile">${time(o.erstellt)}</td><td class="num">${chf(o.total_rappen)}</td><td>${badge(STATUS, o.status)}</td><td>${badge(ZAHLUNG, o.zahlung)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Noch keine Bestellungen gespeichert. Neue Bestellungen erscheinen hier automatisch.</p>'}
      </div>`;
  };

  // Kunden
  const customerState = {q: '', seite: 1};
  PAGES.kunden = async id => {
    if (id) return customerDetail(id);
    const load = async () => {
      const d = await api('/api/kunden?' + query(customerState));
      $('kunden-liste').innerHTML = d.kunden.length ? `<div class="table-wrap"><table><thead><tr><th>Nr.</th><th>Name</th><th class="hide-mobile">E-Mail</th><th class="hide-mobile">Ort</th><th class="num">Bestellungen</th><th class="num">Umsatz</th><th class="hide-mobile">Newsletter</th></tr></thead><tbody>
        ${d.kunden.map(k => `<tr class="click" data-href="#/kunden/${k.id}"><td>${kNr(k.id)}</td><td><b>${esc(k.vorname)} ${esc(k.nachname)}</b></td><td class="hide-mobile">${esc(k.email)}</td><td class="hide-mobile">${esc(k.plz)} ${esc(k.ort)}</td><td class="num">${k.bestellungen}</td><td class="num">${chf(k.umsatz)}</td><td class="hide-mobile">${k.newsletter ? badge(ABO, k.newsletter) : '<span class="muted">–</span>'}</td></tr>`).join('')}
        </tbody></table></div>${pager(d.total, customerState.seite)}` : '<p class="empty">Keine Kunden gefunden.</p>';
      bindPager($('kunden-liste'), customerState, load);
    };
    after(() => { bindFilters(customerState, load); load().catch(failed); });
    return `<div class="page-head"><div><h1>Kunden</h1><p class="muted">Jede E-Mail-Adresse ist ein Kunde – auch bei mehreren Bestellungen.</p></div><div class="actions"><a class="btn" href="/api/export/kunden.csv">⬇ Excel/CSV-Export</a></div></div>
      <div class="card"><div class="filters"><label class="grow">Suchen<input type="search" data-filter="q" value="${esc(customerState.q)}" placeholder="Name, E-Mail, Ort, PLZ oder Kundennummer"></label></div><div id="kunden-liste"><p class="loading">Wird geladen …</p></div></div>`;
  };

  async function customerDetail(id) {
    const d = await api('/api/kunden/' + id), k = d.kunde;
    after(() => {
      $('del-kunde').addEventListener('click', async () => {
        const ok = await confirmDialog(`<h2>Kunde löschen?</h2><p>Alle Daten von <b>${esc(k.vorname)} ${esc(k.nachname)}</b> werden endgültig gelöscht – inklusive ${d.bestellungen.length} Bestellung(en) und Designbildern.</p>
          <p class="error" style="background:#fff4d6;color:#7a5200">Achtung Aufbewahrungspflicht: Geschäftsunterlagen (z. B. Bestellungen und Zahlungen) müssen in der Schweiz grundsätzlich 10 Jahre aufbewahrt werden. Löschen Sie nur, wenn keine Pflicht mehr besteht – oder bewahren Sie vorher einen Beleg ausserhalb auf.</p>
          <label style="margin-top:12px"><input type="checkbox" id="del-nl" style="width:auto;min-height:0;margin-right:6px">Auch Newsletter-Daten dieser E-Mail-Adresse löschen</label>
          <label style="margin-top:12px">Zur Bestätigung <b>LÖSCHEN</b> eingeben<input id="del-wort" autocomplete="off"></label>`, 'Endgültig löschen', true, () => $('del-wort').value.trim() === 'LÖSCHEN');
        if (!ok) return;
        try { await api('/api/kunden/' + id, {method: 'DELETE', body: {bestaetigung: 'LÖSCHEN', newsletter: $('del-nl')?.checked}}); toast('Kunde gelöscht.'); location.hash = '#/kunden'; } catch (e) { failed(e); }
      });
    });
    const nl = d.newsletter;
    return `<div class="page-head"><div><a href="#/kunden" class="no-print">← Alle Kunden</a><h1>${esc(k.vorname)} ${esc(k.nachname)}</h1><p class="muted">${kNr(k.id)} · Kunde seit ${date(k.erste_bestellung)}</p></div>
      <div class="actions no-print"><a class="btn" href="mailto:${esc(k.email)}">✉️ E-Mail</a>${k.telefon ? `<a class="btn" href="https://wa.me/${esc(k.telefon.replace(/\D/g, ''))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}<a class="btn" href="/api/kunden/${k.id}/auskunft">⬇ Datenauskunft</a><button class="btn btn-danger" id="del-kunde">Löschen</button></div></div>
      <div class="grid two">
        <div class="card"><h2>Kontakt und Adresse</h2><dl class="facts"><dt>E-Mail</dt><dd>${esc(k.email)}</dd><dt>Telefon</dt><dd>${esc(k.telefon || '–')}</dd><dt>Adresse</dt><dd>${esc(k.strasse)}<br>${esc(k.plz)} ${esc(k.ort)}<br>${esc(k.land)}</dd><dt>Erste Bestellung</dt><dd>${time(k.erste_bestellung)}</dd></dl></div>
        <div class="card"><h2>Newsletter</h2>${nl ? `<dl class="facts"><dt>Status</dt><dd>${badge(ABO, nl.status)}</dd><dt>Angemeldet</dt><dd>${time(nl.angemeldet)}</dd><dt>Bestätigt</dt><dd>${time(nl.einwilligung_zeit)}</dd><dt>Herkunft</dt><dd>${esc(nl.einwilligung_quelle || '–')}</dd>${nl.abgemeldet ? `<dt>Abgemeldet</dt><dd>${time(nl.abgemeldet)}</dd>` : ''}</dl>` : '<p class="muted">Kein Newsletter-Abo. Kunden erhalten nur dann Newsletter, wenn sie selbst zustimmen und bestätigen.</p>'}</div>
      </div>
      <div class="card"><h2>Bestellungen (${d.bestellungen.length})</h2><div class="table-wrap"><table><thead><tr><th>Bestellung</th><th>Datum</th><th class="num">Shirts</th><th class="num">Betrag</th><th>Status</th><th>Zahlung</th></tr></thead><tbody>
        ${d.bestellungen.map(o => `<tr class="click" data-href="#/bestellungen/${o.id}"><td><b>${esc(o.bestellnummer)}</b></td><td>${time(o.erstellt)}</td><td class="num">${o.anzahl}</td><td class="num">${chf(o.total_rappen)}</td><td>${badge(STATUS, o.status)}</td><td>${badge(ZAHLUNG, o.zahlung)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  // Bestellungen
  const orderState = {q: '', status: '', zahlung: '', von: '', bis: '', sort: 'neu', seite: 1};
  PAGES.bestellungen = async id => {
    if (id && /^\d+$/.test(id)) return orderDetail(id);
    if (id && id.startsWith('?')) { const p = new URLSearchParams(id); for (const k of ['status', 'zahlung']) if (p.has(k)) orderState[k] = p.get(k); }
    const load = async () => {
      const d = await api('/api/bestellungen?' + query(orderState));
      $('bestell-liste').innerHTML = d.bestellungen.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Bestellung</th><th>Kunde</th><th class="hide-mobile">Datum</th><th class="num">Shirts</th><th class="num">Betrag</th><th>Status</th><th>Zahlung</th></tr></thead><tbody>
        ${d.bestellungen.map(o => `<tr class="click" data-href="#/bestellungen/${o.id}"><td>${o.bild ? `<img class="thumb" loading="lazy" src="/api/bild?k=${encodeURIComponent(o.bild)}" alt="">` : ''}</td><td><b>${esc(o.bestellnummer)}</b></td><td>${esc(o.vorname)} ${esc(o.nachname)}<br><span class="muted small">${esc(o.ort)}</span></td><td class="hide-mobile">${time(o.erstellt)}</td><td class="num">${o.anzahl}</td><td class="num">${chf(o.total_rappen)}</td><td>${badge(STATUS, o.status)}</td><td>${badge(ZAHLUNG, o.zahlung)}</td></tr>`).join('')}
        </tbody></table></div>${pager(d.total, orderState.seite)}<p class="muted small">Summe der gefilterten Bestellungen: <b>${chf(d.summe)}</b></p>` : '<p class="empty">Keine Bestellungen gefunden.</p>';
      bindPager($('bestell-liste'), orderState, load);
    };
    after(() => { bindFilters(orderState, load); load().catch(failed); });
    return `<div class="page-head"><div><h1>Bestellungen</h1><p class="muted">Anklicken zum Öffnen, Status ändern und Drucken.</p></div><div class="actions"><a class="btn" href="/api/export/bestellungen.csv">⬇ Excel/CSV-Export</a></div></div>
      <div class="card"><div class="filters">
        <label class="grow">Suchen<input type="search" data-filter="q" value="${esc(orderState.q)}" placeholder="Bestellnummer, Name, E-Mail oder Ort"></label>
        <label>Status<select data-filter="status"><option value="">Alle</option><option value="offen"${orderState.status === 'offen' ? ' selected' : ''}>Alle offenen (in Arbeit)</option>${options(STATUS, orderState.status)}</select></label>
        <label>Zahlung<select data-filter="zahlung"><option value="">Alle</option>${options(ZAHLUNG, orderState.zahlung)}</select></label>
        <label>Von<input type="date" data-filter="von" value="${esc(orderState.von)}"></label>
        <label>Bis<input type="date" data-filter="bis" value="${esc(orderState.bis)}"></label>
        <label>Sortierung<select data-filter="sort"><option value="neu"${orderState.sort === 'neu' ? ' selected' : ''}>Neueste zuerst</option><option value="alt"${orderState.sort === 'alt' ? ' selected' : ''}>Älteste zuerst</option><option value="betrag"${orderState.sort === 'betrag' ? ' selected' : ''}>Höchster Betrag</option></select></label>
      </div><div id="bestell-liste"><p class="loading">Wird geladen …</p></div></div>`;
  };

  async function orderDetail(id) {
    const d = await api('/api/bestellungen/' + id), o = d.bestellung, a = o.lieferadresse || {};
    const img = key => `/api/bild?k=${encodeURIComponent(key)}`;
    after(() => {
      const save = async body => { try { await api('/api/bestellungen/' + id, {method: 'PATCH', body}); toast('Gespeichert.'); } catch (e) { failed(e); } };
      $('o-status').addEventListener('change', e => save({status: e.target.value}).then(() => $('o-status-badge').innerHTML = badge(STATUS, e.target.value)));
      // Zahlung: Der Server bucht die passende Zahlung in der Buchhaltung und meldet den tatsächlichen Stand zurück.
      $('o-zahlung').addEventListener('change', async e => {
        try { const r = await api('/api/bestellungen/' + id, {method: 'PATCH', body: {zahlung: e.target.value}}); e.target.value = o.zahlung = r.zahlung; $('o-zahlung-badge').innerHTML = badge(ZAHLUNG, r.zahlung); toast(r.hinweis || 'Gespeichert – Zahlung in der Buchhaltung erfasst.'); }
        catch (err) { failed(err); e.target.value = o.zahlung; }
      });
      $('o-notiz-save').addEventListener('click', () => save({notiz: $('o-notiz').value}));
      $('o-print').addEventListener('click', () => window.print());
    });
    const digits = (o.telefon || '').replace(/\D/g, '');
    return `<div class="page-head"><div><a href="#/bestellungen" class="no-print">← Alle Bestellungen</a><h1>Bestellung ${esc(o.bestellnummer)}</h1><p class="muted">${time(o.erstellt)} · <span id="o-status-badge">${badge(STATUS, o.status)}</span> <span id="o-zahlung-badge">${badge(ZAHLUNG, o.zahlung)}</span></p></div>
      <div class="actions no-print"><button class="btn btn-dark" id="o-print">🖨 Drucken</button><a class="btn" href="mailto:${esc(o.email)}?subject=${encodeURIComponent('Ihre ShirtBOX-Bestellung ' + o.bestellnummer)}">✉️ Kunde anschreiben</a>${digits ? `<a class="btn" href="https://wa.me/${digits}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}</div></div>
      <div class="grid two">
        <div class="card no-print"><h2>Status</h2><div class="status-row"><label>Bestellstatus<select id="o-status">${options(STATUS, o.status)}</select></label><label>Zahlung<select id="o-zahlung">${options(ZAHLUNG, o.zahlung)}</select></label></div>
          ${o.bezahlt_am ? `<p class="muted small">Als bezahlt markiert am ${date(o.bezahlt_am)}</p>` : ''}
          <label style="margin-top:12px">Interne Notiz<textarea id="o-notiz" rows="3" placeholder="z. B. TWINT erhalten am …, beim Lieferanten bestellt am …">${esc(o.notiz || '')}</textarea></label><button class="btn btn-small" id="o-notiz-save" style="margin-top:8px">Notiz speichern</button></div>
        <div class="card"><h2>Kunde</h2><dl class="facts"><dt>Name</dt><dd><a href="#/kunden/${o.kunde_id}">${esc(o.vorname)} ${esc(o.nachname)}</a> (${kNr(o.kunde_id)})</dd><dt>E-Mail</dt><dd>${esc(o.email)}</dd><dt>Telefon</dt><dd>${esc(o.telefon || '–')}</dd>
          <dt>Lieferadresse</dt><dd>${esc(a.vorname)} ${esc(a.nachname)}<br>${esc(a.strasse)}<br>${esc(a.plz)} ${esc(a.ort)}<br>${esc(a.land)}</dd></dl></div>
      </div>
      <div class="card"><h2>Bestellte T-Shirts</h2>
        ${d.designs.map(x => `<div class="design"><div>${x.bild_vorschau ? `<img src="${img(x.bild_vorschau)}" alt="Design ${x.design_nr}: Vorder- und Rückseite">` : '<p class="empty">Kein Vorschaubild gespeichert</p>'}<p class="muted small">Vorderseite links, Rückseite rechts</p></div>
          <div><h3>Design ${x.design_nr}</h3><dl class="facts"><dt>Farbe</dt><dd>${esc(x.farbe || '–')}</dd><dt>Stückzahl</dt><dd>${x.anzahl}</dd><dt>Einzelpreis</dt><dd>${chf(x.einzelpreis_rappen)}${x.anzahl > 1 ? ` · weitere ${chf(8010)}` : ''}</dd><dt>Summe</dt><dd>${chf(x.summe_rappen)}</dd><dt>Bildrechte</dt><dd>${x.rechte ? '✓ bestätigt' : '⚠ nicht bestätigt'}</dd></dl>
          <table style="margin-top:10px"><thead><tr><th>Grösse Kunde</th><th>Beim Lieferanten</th><th class="num">Stück</th></tr></thead><tbody>${x.groessen.map(g => `<tr><td>${esc(g.groesse)}</td><td><b>${esc(g.bestellgroesse)}</b></td><td class="num">${g.anzahl}×</td></tr>`).join('')}</tbody></table>
          <p class="no-print" style="margin:10px 0 0">${x.bild_druck ? `<a class="btn btn-small" href="${img(x.bild_druck)}" download>⬇ Druckdatei</a> ` : '<span class="badge bad">Druckdatei fehlt</span> '}${x.bilder_original.map((k, i) => `<a class="btn btn-small" href="${img(k)}" download>⬇ Original ${i + 1}</a>`).join(' ')}</p>
          ${x.details ? `<pre>${esc(x.details)}</pre>` : ''}</div></div>`).join('')}
        <table style="margin-top:12px"><tbody><tr><td>Versand</td><td class="num">${o.versand_rappen ? chf(o.versand_rappen) : 'inklusive'}</td></tr><tr><td><b>Total (${o.anzahl} Shirt${o.anzahl === 1 ? '' : 's'})</b></td><td class="num"><b>${chf(o.total_rappen)}</b></td></tr></tbody></table>
        <p class="muted small">Bezahlung per TWINT · ${esc(o.agb ? 'AGB akzeptiert (' + o.agb + ')' : 'AGB-Zustimmung nicht gespeichert')}</p>
      </div>`;
  }

  // Umsatz
  const revState = {zeitraum: '30t', art: 'bestellwert'};
  PAGES.umsatz = async () => {
    const d = await api('/api/umsatz?' + query(revState)), s = d.summen;
    after(() => {
      chart($('chart'), d);
      content.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => { revState[b.dataset.seg] = b.dataset.value; render(); }));
    });
    const seg = (key, value, label) => `<button type="button" data-seg="${key}" data-value="${value}" class="${revState[key] === value ? 'on' : ''}">${label}</button>`;
    return `<div class="page-head"><div><h1>Umsatz</h1><p class="muted">Bestellwert = alle nicht stornierten Bestellungen. Bezahlt = als „Bezahlt“ markiert. Alle Beträge in CHF.</p></div></div>
      <div class="grid kpis">${kpi('Bestellwert', chf(s.bestellwert), revState.zeitraum === '12m' ? 'letzte 12 Monate' : 'letzte 30 Tage', 'highlight')}${kpi('Tatsächlich bezahlt', chf(s.bezahlt))}${kpi('Noch offen', chf(s.offen))}${kpi('Rückerstattet', chf(s.rueckerstattet))}</div>
      <div class="card"><h2>Umsatzentwicklung <span class="actions"><span class="seg">${seg('zeitraum', '30t', '30 Tage')}${seg('zeitraum', '12m', '12 Monate')}</span><span class="seg">${seg('art', 'bestellwert', 'Bestellwert')}${seg('art', 'bezahlt', 'Bezahlt')}</span></span></h2>
        <p class="muted small">${revState.art === 'bezahlt' ? 'Nach Datum der Zahlungsbestätigung.' : 'Nach Bestelldatum.'} Fahren Sie über einen Balken für Details.</p><div class="chart" id="chart"></div>${chartTable(d)}</div>`;
  };

  // Newsletter: Abonnenten und versendete Newsletter
  const subState = {q: '', status: '', seite: 1};
  PAGES.newsletter = async id => {
    if (id) return newsletterDetail(id);
    const [list] = await Promise.all([api('/api/newsletter')]);
    const load = async () => {
      const d = await api('/api/abonnenten?' + query(subState)), z = d.zahlen;
      $('abo-zahlen').innerHTML = `${kpi('Aktive Abonnenten', Number(z.aktiv) || 0, 'erhalten Newsletter', 'highlight')}${kpi('Warten auf Bestätigung', Number(z.ausstehend) || 0)}${kpi('Abgemeldet', Number(z.abgemeldet) || 0)}${kpi('Unzustellbar', Number(z.unzustellbar) || 0)}`;
      $('abo-liste').innerHTML = d.abonnenten.length ? `<div class="table-wrap"><table><thead><tr><th>E-Mail</th><th>Name</th><th>Status</th><th class="hide-mobile">Angemeldet</th><th class="hide-mobile">Einwilligung</th><th></th></tr></thead><tbody>
        ${d.abonnenten.map(a => `<tr><td>${esc(a.email)}${a.kunde_id ? ` <a class="small" href="#/kunden/${a.kunde_id}">Kunde</a>` : ''}</td><td>${esc([a.vorname, a.nachname].filter(Boolean).join(' ') || '–')}</td><td>${badge(ABO, a.status)}${a.abgemeldet ? `<br><span class="muted small">${date(a.abgemeldet)}</span>` : ''}</td><td class="hide-mobile">${time(a.angemeldet)}</td><td class="hide-mobile small">${a.einwilligung_zeit ? `bestätigt ${time(a.einwilligung_zeit)}<br>` : ''}<span class="muted">${esc(a.einwilligung_quelle || '')}</span></td>
          <td class="num">${['aktiv', 'ausstehend'].includes(a.status) ? `<button class="btn btn-small" data-abmelden="${a.id}">Abmelden</button> ` : ''}<button class="btn btn-small btn-danger" data-loeschen="${a.id}" title="Löschen">✕</button></td></tr>`).join('')}
        </tbody></table></div>${pager(d.total, subState.seite)}` : '<p class="empty">Keine Abonnenten gefunden.</p>';
      bindPager($('abo-liste'), subState, load);
      content.querySelectorAll('[data-abmelden]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmDialog('<h2>Abonnent abmelden?</h2><p>Diese Person erhält danach keine Newsletter mehr. Die Abmeldung wird gespeichert.</p>', 'Abmelden')) return;
        try { await api('/api/abonnenten/' + b.dataset.abmelden, {method: 'PATCH', body: {status: 'abgemeldet'}}); toast('Abgemeldet.'); load(); } catch (e) { failed(e); }
      }));
      content.querySelectorAll('[data-loeschen]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmDialog('<h2>Abonnent löschen?</h2><p>Der Eintrag und der Nachweis der Einwilligung werden endgültig gelöscht. Tipp: Für eine Abmeldung reicht „Abmelden“ – dann bleibt dokumentiert, dass die Person keine Werbung mehr möchte.</p>', 'Endgültig löschen', true)) return;
        try { await api('/api/abonnenten/' + b.dataset.loeschen, {method: 'DELETE'}); toast('Gelöscht.'); load(); } catch (e) { failed(e); }
      }));
    };
    after(() => { bindFilters(subState, load); load().catch(failed); });
    return `<div class="page-head"><div><h1>Newsletter</h1><p class="muted">Nur Personen, die selbst zugestimmt und per E-Mail bestätigt haben (Double-Opt-in), erhalten Newsletter.</p></div><div class="actions"><a class="btn" href="/api/export/abonnenten.csv">⬇ Excel/CSV-Export</a><a class="btn btn-main" href="#/newsletter-erstellen">✏️ Newsletter erstellen</a></div></div>
      <div class="grid kpis" id="abo-zahlen"></div>
      <div class="card"><h2>Versendete Newsletter und Entwürfe</h2>${list.newsletter.length ? `<div class="table-wrap"><table><thead><tr><th>Betreff</th><th>Status</th><th class="hide-mobile">Datum</th><th class="num">Empfänger</th><th class="num">Gesendet</th><th class="num hide-mobile">Zugestellt</th><th class="num">Fehler</th></tr></thead><tbody>
        ${list.newsletter.map(n => `<tr class="click" data-href="${n.status === 'entwurf' ? '#/newsletter-erstellen/' : '#/newsletter/'}${n.id}"><td><b>${esc(n.betreff)}</b></td><td>${badge(NL, n.status)}${Number(n.wartend) ? `<br><span class="muted small">${n.wartend} warten</span>` : ''}</td><td class="hide-mobile">${time(n.versand_start || n.geaendert)}</td><td class="num">${n.empfaenger || '–'}</td><td class="num">${Number(n.gesendet) || 0}</td><td class="num hide-mobile">${Number(n.zugestellt) || 0}</td><td class="num">${Number(n.fehler) || 0}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Noch kein Newsletter erstellt.</p>'}</div>
      <div class="card"><h2>Abonnenten</h2><div class="filters"><label class="grow">Suchen<input type="search" data-filter="q" value="${esc(subState.q)}" placeholder="E-Mail oder Name"></label><label>Status<select data-filter="status"><option value="">Alle</option>${options(ABO, subState.status)}</select></label></div><div id="abo-liste"><p class="loading">Wird geladen …</p></div></div>`;
  };

  async function newsletterDetail(id) {
    const d = await api('/api/newsletter/' + id), n = d.newsletter, s = d.statistik || {};
    after(() => {
      $('nl-kopie').addEventListener('click', async () => { try { const r = await api(`/api/newsletter/${id}/kopie`, {method: 'POST'}); location.hash = '#/newsletter-erstellen/' + r.id; } catch (e) { failed(e); } });
      api('/api/newsletter/vorschau', {method: 'POST', body: {betreff: n.betreff, inhalt: n.inhalt}}).then(r => $('nl-frame').srcdoc = r.html).catch(failed);
    });
    return `<div class="page-head"><div><a href="#/newsletter">← Newsletter</a><h1>${esc(n.betreff)}</h1><p class="muted">${badge(NL, n.status)} · Versand gestartet ${time(n.versand_start)}${n.versand_ende ? ` · abgeschlossen ${time(n.versand_ende)}` : ''}</p></div><div class="actions"><button class="btn" id="nl-kopie">Als Vorlage für neuen Newsletter</button></div></div>
      <div class="grid kpis">${kpi('Empfänger', n.empfaenger)}${kpi('Gesendet', Number(s.gesendet) || 0)}${kpi('Zugestellt', Number(s.zugestellt) || 0, 'laut Resend')}${kpi('Nicht zugestellt / Fehler', Number(s.fehler) || 0)}${Number(s.wartend) ? kpi('Warten auf Versand', s.wartend, 'wird automatisch fortgesetzt') : ''}${Number(s.uebersprungen) ? kpi('Übersprungen', s.uebersprungen, 'vorher abgemeldet') : ''}</div>
      ${Number(s.wartend) ? '<div class="card"><p>⏳ Wegen der Versandlimits von Resend wird der Newsletter in Etappen verschickt. Der Rest folgt automatisch alle 15 Minuten bzw. am nächsten Tag.</p></div>' : ''}
      <div class="card"><h2>Nicht zugestellte E-Mails</h2>${d.probleme.length ? `<div class="table-wrap"><table><thead><tr><th>E-Mail</th><th>Status</th><th>Grund</th></tr></thead><tbody>${d.probleme.map(p => `<tr><td>${esc(p.email)}</td><td><span class="badge bad">${esc(EMPF[p.status] || p.status)}</span></td><td class="small">${esc(p.fehler || '–')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Keine Zustellprobleme gemeldet.</p>'}</div>
      <div class="card preview"><h2>So sah der Newsletter aus</h2><iframe id="nl-frame" title="Newsletter-Ansicht" sandbox=""></iframe></div>`;
  }

  // Newsletter erstellen
  const BLOCK_NAMES = {ueberschrift: 'Überschrift', text: 'Text', bild: 'Bild', angebot: 'Angebot / Aktion', button: 'Button mit Link', trenner: 'Trennlinie'};
  const NEW_CONTENT = () => ({vorschau: 'Neuigkeiten und Aktionen von ShirtBOX', bloecke: [
    {typ: 'ueberschrift', text: 'Hallo {{vorname}}!'},
    {typ: 'text', text: 'Hier steht Ihr Newsletter-Text.\n\nTipp: **fett** schreiben Sie mit zwei Sternchen, einen Link mit [Linktext](https://shirtbox.ch).'},
    {typ: 'button', text: 'Jetzt Shirt designen', link: 'https://shirtbox.ch/designhilfe.html'}]});
  PAGES['newsletter-erstellen'] = async id => {
    let n = {betreff: '', inhalt: NEW_CONTENT(), status: 'entwurf'};
    if (id) { const d = await api('/api/newsletter/' + id); n = d.newsletter; if (n.status !== 'entwurf') { location.hash = '#/newsletter/' + id; return; } }
    let current = id ? Number(id) : null, dirty = false;
    const linkSelect = cls => `<select class="${cls}"><option value="">Seite wählen …</option>${LINKS.map(([l, u]) => `<option value="${u}">${esc(l)}</option>`).join('')}</select>`;
    const blockHtml = (b, i) => {
      const f = (key, label, type = 'text', ph = '') => `<label>${label}${type === 'area' ? `<textarea data-k="${key}" rows="${key === 'text' ? 6 : 3}" placeholder="${esc(ph)}">${esc(b[key] || '')}</textarea>` : `<input data-k="${key}" type="${type}" value="${esc(b[key] || '')}" placeholder="${esc(ph)}">`}</label>`;
      let body = '';
      if (b.typ === 'ueberschrift') body = f('text', 'Überschrift', 'text', 'z. B. Hallo {{vorname}}!');
      if (b.typ === 'text') body = f('text', 'Text', 'area') + '<p class="hint">Leerzeile = neuer Absatz · **fett** · [Linktext](https://…) · {{vorname}} = Vorname des Empfängers</p>';
      if (b.typ === 'bild') body = `<label>Bild hochladen<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-upload="url"></label>${b.url ? `<img class="mini" src="${esc(b.url)}" alt="">` : ''}${f('url', 'oder Bildadresse', 'url', 'https://…')}${f('alt', 'Bildbeschreibung', 'text', 'z. B. Neues Fussball-Shirt')}<div class="row">${f('link', 'Link beim Anklicken (optional)', 'url', 'https://shirtbox.ch/…')}<label>Schnellwahl${linkSelect('pick-link')}</label></div>`;
      if (b.typ === 'angebot') body = `${f('titel', 'Titel', 'text', 'z. B. 10 % auf alle Vereins-Shirts')}${f('text', 'Beschreibung', 'area')}<div class="row">${f('preis', 'Preis', 'text', 'z. B. CHF 79.–')}${f('alterpreis', 'Alter Preis (durchgestrichen)', 'text', 'z. B. CHF 89.–')}</div>
        <label>Bild hochladen (optional)<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-upload="bild"></label>${b.bild ? `<img class="mini" src="${esc(b.bild)}" alt="">` : ''}<div class="row">${f('button', 'Button-Text', 'text', 'z. B. Jetzt bestellen')}${f('link', 'Link', 'url', 'https://shirtbox.ch/…')}</div><label>Schnellwahl Link${linkSelect('pick-link')}</label>`;
      if (b.typ === 'button') body = `<div class="row">${f('text', 'Button-Text', 'text', 'z. B. Jetzt Shirt designen')}${f('link', 'Link', 'url', 'https://shirtbox.ch/…')}</div><label>Schnellwahl Link${linkSelect('pick-link')}</label>`;
      if (b.typ === 'trenner') body = '<p class="hint">Eine feine Linie zwischen zwei Abschnitten.</p>';
      return `<div class="block" data-i="${i}"><div class="block-head">${esc(BLOCK_NAMES[b.typ])}<span class="block-tools"><button type="button" data-move="-1" title="Nach oben">↑</button><button type="button" data-move="1" title="Nach unten">↓</button><button type="button" data-del title="Entfernen">✕</button></span></div>${body}</div>`;
    };
    const content2 = n.inhalt;
    const drawBlocks = () => {
      $('blocks').innerHTML = content2.bloecke.map(blockHtml).join('') || '<p class="empty">Noch keine Inhalte. Fügen Sie unten Bausteine hinzu.</p>';
      $('blocks').querySelectorAll('.block').forEach(el => {
        const b = content2.bloecke[Number(el.dataset.i)];
        el.querySelectorAll('[data-k]').forEach(input => input.addEventListener('input', () => { b[input.dataset.k] = input.value; changed(); }));
        el.querySelectorAll('.pick-link').forEach(sel => sel.addEventListener('change', () => { if (!sel.value) return; b.link = sel.value; el.querySelector('[data-k="link"]').value = sel.value; sel.value = ''; changed(); }));
        el.querySelectorAll('[data-upload]').forEach(input => input.addEventListener('change', async () => {
          const file = input.files[0]; if (!file) return;
          const form = new FormData(); form.append('bild', file);
          try { toast('Bild wird hochgeladen …'); const r = await api('/api/bild', {method: 'POST', body: form}); b[input.dataset.upload] = r.url; drawBlocks(); changed(); toast('Bild hinzugefügt.'); } catch (e) { failed(e); }
        }));
        el.querySelector('[data-del]').addEventListener('click', () => { content2.bloecke.splice(Number(el.dataset.i), 1); drawBlocks(); changed(); });
        el.querySelectorAll('[data-move]').forEach(btn => btn.addEventListener('click', () => {
          const i = Number(el.dataset.i), j = i + Number(btn.dataset.move);
          if (j < 0 || j >= content2.bloecke.length) return;
          [content2.bloecke[i], content2.bloecke[j]] = [content2.bloecke[j], content2.bloecke[i]]; drawBlocks(); changed();
        }));
      });
    };
    let previewTimer;
    const preview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => api('/api/newsletter/vorschau', {method: 'POST', body: {betreff: $('nl-betreff').value, inhalt: content2}}).then(r => { const fr = $('nl-frame'); if (fr) fr.srcdoc = r.html; }).catch(failed), 450); };
    // Automatisches Speichern 3 Sekunden nach der letzten Änderung (sobald ein Betreff da ist).
    let autosave, saving = null;
    const changed = () => {
      dirty = true; $('nl-saved').textContent = 'Ungespeicherte Änderungen'; preview();
      clearTimeout(autosave); autosave = setTimeout(() => { if ($('nl-betreff')?.value.trim() && dirty) save(true).catch(() => {}); }, 3000);
    };
    const save = async quiet => {
      if (saving) await saving.catch(() => {});
      saving = (async () => {
        const body = {betreff: $('nl-betreff').value, inhalt: content2};
        const r = current ? await api('/api/newsletter/' + current, {method: 'PUT', body}) : await api('/api/newsletter', {method: 'POST', body});
        if (!current) { current = r.id; history.replaceState(null, '', '#/newsletter-erstellen/' + r.id); }
        dirty = false;
        const label = $('nl-saved'); if (label) label.textContent = 'Gespeichert ' + new Intl.DateTimeFormat('de-CH', {hour: '2-digit', minute: '2-digit'}).format(new Date());
        if (!quiet) toast('Entwurf gespeichert.');
      })();
      try { await saving; } finally { saving = null; }
    };
    after(() => {
      drawBlocks(); preview();
      $('nl-betreff').addEventListener('input', changed);
      $('nl-vorschau').addEventListener('input', e => { content2.vorschau = e.target.value; changed(); });
      content.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { content2.bloecke.push({typ: b.dataset.add}); drawBlocks(); changed(); $('blocks').lastElementChild?.scrollIntoView({behavior: 'smooth', block: 'center'}); }));
      $('nl-save').addEventListener('click', () => save().catch(failed));
      $('nl-test').addEventListener('click', async () => { try { await save(true); const r = await api(`/api/newsletter/${current}/test`, {method: 'POST'}); toast('Test-E-Mail gesendet an ' + r.an); } catch (e) { failed(e); } });
      $('nl-delete').addEventListener('click', async () => {
        if (!current) { location.hash = '#/newsletter'; return; }
        if (!await confirmDialog('<h2>Entwurf löschen?</h2><p>Der Entwurf wird endgültig gelöscht.</p>', 'Löschen', true)) return;
        try { await api('/api/newsletter/' + current, {method: 'DELETE'}); dirty = false; toast('Entwurf gelöscht.'); location.hash = '#/newsletter'; } catch (e) { failed(e); }
      });
      $('nl-send').addEventListener('click', async () => {
        try {
          if (!$('nl-betreff').value.trim()) throw Error('Bitte zuerst einen Betreff eingeben.');
          await save(true);
          const info = await api(`/api/newsletter/${current}/versandinfo`);
          if (!info.empfaenger) throw Error('Es gibt noch keine bestätigten Newsletter-Empfänger.');
          const freeToday = Math.max(0, Math.min(info.tageslimit - info.heute, info.monatslimit - info.monat));
          const days = freeToday >= info.empfaenger ? 0 : Math.ceil((info.empfaenger - freeToday) / Math.max(1, info.tageslimit));
          const ok = await confirmDialog(`<h2>Newsletter jetzt versenden?</h2><p>Betreff: <b>${esc($('nl-betreff').value)}</b></p>
            <p style="font-size:18px">Empfänger: <b>${info.empfaenger}</b> bestätigte Abonnent${info.empfaenger === 1 ? '' : 'en'}</p>
            ${days ? `<p class="error" style="background:#fff4d6;color:#7a5200">Wegen Ihres Versandlimits (${info.tageslimit} pro Tag) wird in Etappen verschickt: heute ${freeToday}, der Rest automatisch in ca. ${days} weiteren Tag${days === 1 ? '' : 'en'}.</p>` : ''}
            <p class="muted">Haben Sie vorher eine Test-E-Mail angeschaut? Der Versand kann nicht rückgängig gemacht werden.</p>`, `An ${info.empfaenger} Empfänger senden`);
          if (!ok) return;
          await api(`/api/newsletter/${current}/senden`, {method: 'POST', body: {empfaenger: info.empfaenger}});
          dirty = false; toast('Der Versand wurde gestartet.'); location.hash = '#/newsletter/' + current;
        } catch (e) { failed(e); }
      });
      window.onbeforeunload = () => dirty && $('nl-betreff') ? 'Ungespeicherte Änderungen' : undefined;
    });
    return `<div class="page-head"><div><a href="#/newsletter">← Newsletter</a><h1>Newsletter erstellen</h1><p class="muted"><span id="nl-saved">${current ? 'Entwurf' : 'Neuer Entwurf'}</span></p></div>
      <div class="actions"><button class="btn" id="nl-save">💾 Entwurf speichern</button><button class="btn" id="nl-test">✉️ Test-E-Mail an mich</button></div></div>
      <div class="editor"><div>
        <div class="card"><label>Betreff *<input id="nl-betreff" maxlength="200" value="${esc(n.betreff)}" placeholder="z. B. Neu: Shirts für Ihren Verein"></label>
          <label style="margin-top:12px">Vorschautext <span class="muted">(erscheint im Postfach neben dem Betreff)</span><input id="nl-vorschau" maxlength="200" value="${esc(n.inhalt.vorschau || '')}"></label></div>
        <div class="card"><h2>Inhalt</h2><div id="blocks"></div>
          <p class="muted small" style="margin:10px 0 4px">Baustein hinzufügen:</p>
          <div class="add-blocks">${Object.entries(BLOCK_NAMES).map(([k, l]) => `<button class="btn btn-small" type="button" data-add="${k}">+ ${l}</button>`).join('')}</div>
          <p class="hint">Logo, Kontakt, Absenderangaben und der Abmeldelink werden automatisch in jeden Newsletter eingefügt.</p></div>
        <div class="send-box"><h2>Versenden</h2><p class="small">Geht nur an bestätigte Abonnenten. Vor dem Versand sehen Sie die Anzahl Empfänger und müssen bestätigen.</p>
          <div class="actions"><button class="btn btn-main" id="nl-send">📨 Newsletter jetzt versenden</button><button class="btn btn-danger" id="nl-delete">Entwurf löschen</button></div></div>
      </div>
      <div class="card preview"><h2>Vorschau</h2><iframe id="nl-frame" title="Newsletter-Vorschau" sandbox=""></iframe></div></div>`;
  };

  // Einstellungen
  PAGES.einstellungen = async () => {
    const d = await api('/api/einstellungen'), e = d.einstellungen, s = d.status;
    const check = (good, label, note) => `<div class="check">${good ? '<span class="badge good">✓ OK</span>' : '<span class="badge bad">✕ Fehlt</span>'}<span><b>${label}</b>${note ? `<br><span class="muted small">${note}</span>` : ''}</span></div>`;
    after(() => $('settings-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const body = Object.fromEntries([...new FormData(ev.target).entries()]);
      try { await api('/api/einstellungen', {method: 'PUT', body}); timeoutMin = Number(body.timeout) || timeoutMin; toast('Einstellungen gespeichert.'); } catch (err) { failed(err); }
    }));
    const field = (name, label, type = 'text', note = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(e[name])}" required>${note ? `<span class="hint">${note}</span>` : ''}</label>`;
    return `<div class="page-head"><div><h1>Einstellungen</h1><p class="muted">Version ${esc(s.version)}</p></div></div>
      <div class="grid two">
        <form class="card" id="settings-form"><h2>Newsletter und Sicherheit</h2><div class="grid">
          ${field('test_email', 'Test-E-Mails gehen an', 'email')}
          ${field('absender_name', 'Absendername')}
          ${field('absender_email', 'Absenderadresse', 'email', 'Muss zur in Resend bestätigten Domain shirtbox.ch gehören.')}
          ${field('antwort_email', 'Antworten gehen an', 'email')}
          ${field('adresse', 'Absenderangaben in der Fusszeile', 'text', 'Pflichtangabe: Name und Postadresse.')}
          <div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${field('tageslimit', 'Max. Newsletter-Mails pro Tag', 'number')}${field('monatslimit', 'Max. pro Monat', 'number')}</div>
          <p class="hint" style="margin-top:-4px">Resend Gratis: 100 Mails/Tag und 3000/Monat insgesamt – inklusive Bestellmails. Deshalb Standard 80/2500. Mit Resend Pro z. B. 5000/50000 eintragen.</p>
          ${field('timeout', 'Automatisch abmelden nach (Minuten ohne Aktivität)', 'number')}
          <button class="btn btn-main" type="submit">Speichern</button></div></form>
        <div class="card"><h2>Systemprüfung</h2>
          ${check(s.datenbank, 'Datenbank (D1)')}${check(s.bilder, 'Bildspeicher (R2)', 'für Designbilder und Newsletter-Bilder')}${check(s.resend, 'Resend-Schlüssel', 'für Test- und Newsletter-Versand')}
          ${check(s.access, 'Cloudflare Access', s.access ? 'Zusätzlicher Schutz vor der Anmeldeseite ist aktiv.' : 'Empfohlen: ACCESS_TEAM_DOMAIN und ACCESS_AUD eintragen.')}
          ${check(!!s.letzter_lauf, 'Automatischer Versand (Cron)', s.letzter_lauf ? 'Zuletzt gelaufen: ' + time(s.letzter_lauf) : 'Cron-Trigger */15 * * * * einrichten.')}
          <p class="small" style="margin-top:12px">Newsletter-Mails heute: <b>${s.heute_gesendet}</b> von ${s.tageslimit} · diesen Monat: <b>${s.monat_gesendet}</b> von ${s.monatslimit}</p></div>
      </div>
      <div class="grid two">
        <div class="card"><h2>Daten exportieren</h2><p class="muted small">CSV-Dateien öffnen sich direkt in Excel. Bitte sicher aufbewahren – sie enthalten Personendaten.</p><div class="actions"><a class="btn" href="/api/export/kunden.csv">⬇ Kunden</a><a class="btn" href="/api/export/bestellungen.csv">⬇ Bestellungen</a><a class="btn" href="/api/export/abonnenten.csv">⬇ Newsletter-Abonnenten</a></div>
          <h3 style="margin-top:18px">Datensicherung</h3><p class="small muted">Cloudflare D1 sichert die Datenbank automatisch und kann sie bis zu 30 Tage zurück wiederherstellen („Time Travel“). Zusätzlich empfehlen wir, monatlich die drei Exporte herunterzuladen.</p></div>
        <div class="card"><h2>Protokoll</h2><p class="muted small">Letzte Aktionen (ohne Kundendaten).</p><div class="table-wrap"><table><tbody>${d.protokoll.map(p => `<tr><td class="small" style="white-space:nowrap">${time(p.zeit)}</td><td class="small">${esc(p.aktion)}</td></tr>`).join('') || '<tr><td class="muted">Noch keine Einträge.</td></tr>'}</tbody></table></div></div>
      </div>`;
  };

  // Bausteine für die Buchhaltung (buchhaltung.js wird von bauen.ps1 direkt dahinter angehängt und läuft vor dem ersten Seitenaufbau).
  window.ShirtboxAdmin = {PAGES, TITLES, api, esc, chf, money, date, time, kpi, badge, options, pager, bindFilters, bindPager, query, after, toast, failed, confirmDialog, render, content, $, STATUS, ZAHLUNG};

  // ---- Start ----
  fetch('/api/sitzung', {headers: {'X-ShirtBOX': '1'}, credentials: 'same-origin'}).then(r => r.json().then(d => ({ok: r.ok, d}))).then(({ok, d}) => {
    if (!ok) { showLogin(d.error); return; }
    timeoutMin = d.timeout || 30;
    if (d.angemeldet) showApp(); else showLogin();
  }).catch(() => showLogin('Der Server ist nicht erreichbar.'));
})();
