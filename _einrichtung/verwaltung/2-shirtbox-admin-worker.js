// ShirtBOX Verwaltungszentrale – Worker "shirtbox-admin" auf admin.shirtbox.ch.
// Diese Datei wird von bauen.ps1 zu ../2-shirtbox-admin-worker.js zusammengesetzt (mit Oberfläche und Datenbank-Schema).
// Bindings: D1 DB (shirtbox-verwaltung), R2 BILDER (shirtbox-bilder).
// Secrets: RESEND_API_KEY, ADMIN_PASSWORD, ADMIN_TOTP_SECRET.
// Variablen (empfohlen): ACCESS_TEAM_DOMAIN (z. B. shirtbox.cloudflareaccess.com), ACCESS_AUD (Application Audience Tag).
// Cron-Trigger: */15 * * * *  (setzt den Newsletter-Versand in Etappen fort).

const ADMIN_HTML = "<!doctype html>\n<html lang=\"de-CH\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"robots\" content=\"noindex, nofollow\">\n<meta name=\"theme-color\" content=\"#131c30\">\n<title>ShirtBOX Verwaltung</title>\n<link rel=\"icon\" href=\"https://shirtbox.ch/shirtbox-icon.svg\" type=\"image/svg+xml\">\n<link rel=\"stylesheet\" href=\"/app.css\">\n</head>\n<body>\n<div id=\"login\" class=\"login\" hidden>\n  <form id=\"login-form\" class=\"login-card\" autocomplete=\"on\">\n    <div class=\"brand\"><img src=\"https://shirtbox.ch/shirtbox-icon.svg\" alt=\"\" width=\"44\" height=\"44\"><span>shirt<b>box</b><small>.ch</small></span></div>\n    <h1>Verwaltung</h1>\n    <p class=\"muted\">Nur für ShirtBOX. Bitte Passwort und den 6-stelligen Code aus Ihrer Authenticator-App eingeben.</p>\n    <label>Passwort<input id=\"login-passwort\" type=\"password\" autocomplete=\"current-password\" required></label>\n    <label>Code aus der App<input id=\"login-code\" inputmode=\"numeric\" autocomplete=\"one-time-code\" pattern=\"[0-9 ]{6,7}\" maxlength=\"7\" required placeholder=\"123 456\"></label>\n    <button class=\"btn btn-main\" type=\"submit\">Anmelden</button>\n    <p id=\"login-fehler\" class=\"error\" role=\"alert\" hidden></p>\n  </form>\n</div>\n\n<div id=\"app\" class=\"app\" hidden>\n  <aside class=\"side\" id=\"side\">\n    <div class=\"brand\"><img src=\"https://shirtbox.ch/shirtbox-icon.svg\" alt=\"\" width=\"36\" height=\"36\"><span>shirt<b>box</b><small>.ch</small></span></div>\n    <nav id=\"menu\" aria-label=\"Verwaltung\">\n      <a href=\"#/dashboard\" data-nav=\"dashboard\"><i>📊</i>Dashboard</a>\n      <a href=\"#/kunden\" data-nav=\"kunden\"><i>👥</i>Kunden</a>\n      <a href=\"#/bestellungen\" data-nav=\"bestellungen\"><i>📦</i>Bestellungen</a>\n      <a href=\"#/umsatz\" data-nav=\"umsatz\"><i>💰</i>Umsatz</a>\n      <a href=\"#/newsletter\" data-nav=\"newsletter\"><i>📬</i>Newsletter</a>\n      <a href=\"#/newsletter-erstellen\" data-nav=\"newsletter-erstellen\"><i>✏️</i>Newsletter erstellen</a>\n      <p class=\"nav-group\">Buchhaltung</p>\n      <a href=\"#/bh-uebersicht\" data-nav=\"bh-uebersicht\"><i>📒</i>Übersicht</a>\n      <a class=\"sub\" href=\"#/bh-einnahmen\" data-nav=\"bh-einnahmen\"><i>⬇</i>Einnahmen</a>\n      <a class=\"sub\" href=\"#/bh-ausgaben\" data-nav=\"bh-ausgaben\"><i>⬆</i>Ausgaben</a>\n      <a class=\"sub\" href=\"#/bh-rechnungen\" data-nav=\"bh-rechnungen\"><i>🧾</i>Rechnungen</a>\n      <a class=\"sub\" href=\"#/bh-belege\" data-nav=\"bh-belege\"><i>📎</i>Belege</a>\n      <a class=\"sub\" href=\"#/bh-zahlungen\" data-nav=\"bh-zahlungen\"><i>💳</i>Zahlungen</a>\n      <a class=\"sub\" href=\"#/bh-lieferanten\" data-nav=\"bh-lieferanten\"><i>🏭</i>Lieferanten</a>\n      <a class=\"sub\" href=\"#/bh-auswertungen\" data-nav=\"bh-auswertungen\"><i>📈</i>Auswertungen</a>\n      <a class=\"sub\" href=\"#/bh-einstellungen\" data-nav=\"bh-einstellungen\"><i>🔧</i>Einstellungen</a>\n      <p class=\"nav-group\">System</p>\n      <a href=\"#/einstellungen\" data-nav=\"einstellungen\"><i>⚙️</i>Einstellungen</a>\n    </nav>\n    <button class=\"logout\" id=\"logout\" type=\"button\">Abmelden</button>\n  </aside>\n  <header class=\"topbar\">\n    <button class=\"menu-btn\" id=\"menu-btn\" type=\"button\" aria-controls=\"side\" aria-expanded=\"false\">☰ Menü</button>\n    <span class=\"topbar-title\" id=\"topbar-title\">Dashboard</span>\n  </header>\n  <main class=\"content\" id=\"content\" tabindex=\"-1\"></main>\n</div>\n\n<div class=\"toast\" id=\"toast\" role=\"status\" aria-live=\"polite\" hidden></div>\n<dialog id=\"dialog\" class=\"dialog\"><form method=\"dialog\" id=\"dialog-form\"><div id=\"dialog-body\"></div><div class=\"dialog-actions\" id=\"dialog-actions\"></div></form></dialog>\n<script src=\"/app.js\"></script>\n</body>\n</html>\n";
const ADMIN_JS = "// ShirtBOX Verwaltung – Oberfläche (ohne Fremdbibliotheken). Alle Daten kommen von /api/… desselben Workers.\n(() => {\n  'use strict';\n  const $ = id => document.getElementById(id);\n  const content = $('content');\n  const esc = v => String(v ?? '').replace(/[&<>\"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;'}[c]));\n  const money = new Intl.NumberFormat('de-CH', {minimumFractionDigits: 2, maximumFractionDigits: 2});\n  const chf = r => `CHF ${money.format((Number(r) || 0) / 100)}`;\n  const chfShort = r => { const v = (Number(r) || 0) / 100; return v >= 1000 ? `${new Intl.NumberFormat('de-CH', {maximumFractionDigits: 1}).format(v / 1000)}k` : String(Math.round(v)); };\n  const dateFmt = new Intl.DateTimeFormat('de-CH', {timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric'});\n  const timeFmt = new Intl.DateTimeFormat('de-CH', {timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});\n  const date = iso => iso ? dateFmt.format(new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)) : '–';\n  const time = iso => iso ? timeFmt.format(new Date(iso)) : '–';\n  const kNr = id => `K-${10000 + Number(id)}`;\n  const STATUS = {neu: ['Neu', 'info'], bearbeitung: ['In Bearbeitung', 'warn'], produziert: ['Produziert', 'accent'], versendet: ['Versendet', 'info'], abgeschlossen: ['Abgeschlossen', 'good'], storniert: ['Storniert', 'bad']};\n  const ZAHLUNG = {offen: ['Offen', 'warn'], teilweise: ['Teilweise bezahlt', 'info'], bezahlt: ['Bezahlt', 'good'], rueckerstattet: ['Rückerstattet', 'bad']};\n  const ABO = {aktiv: ['Aktiv', 'good'], ausstehend: ['Bestätigung ausstehend', 'warn'], abgemeldet: ['Abgemeldet', ''], unzustellbar: ['Unzustellbar', 'bad'], beschwerde: ['Spam-Beschwerde', 'bad']};\n  const NL = {entwurf: ['Entwurf', ''], versand: ['Wird versendet', 'warn'], versendet: ['Versendet', 'good']};\n  const EMPF = {wartend: 'Wartet', gesendet: 'Gesendet', zugestellt: 'Zugestellt', fehler: 'Fehler', unzustellbar: 'Unzustellbar', beschwerde: 'Spam-Beschwerde', uebersprungen: 'Übersprungen'};\n  const badge = (map, key) => { const [label, cls] = map[key] || [key || '–', '']; return `<span class=\"badge ${cls}\">${esc(label)}</span>`; };\n  const options = (map, selected) => Object.entries(map).map(([k, [label]]) => `<option value=\"${k}\"${k === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');\n  const LINKS = [['Startseite', 'https://shirtbox.ch/'], ['Shirt erstellen (KI-Designer)', 'https://shirtbox.ch/designhilfe.html'], ['Shirts live', 'https://shirtbox.ch/shirts-live.html'], ['Bestellen', 'https://shirtbox.ch/bestellen.html'], ['FAQs', 'https://shirtbox.ch/faq.html'], ['Über uns', 'https://shirtbox.ch/ueber-uns.html']];\n\n  // ---- Server-Anfragen ----\n  async function api(path, {method = 'GET', body, raw} = {}) {\n    const opts = {method, credentials: 'same-origin', headers: {'X-ShirtBOX': '1'}};\n    if (body instanceof FormData) opts.body = body;\n    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }\n    const res = await fetch(path, opts);\n    if (res.status === 401 && path !== '/api/login') { showLogin('Ihre Sitzung ist abgelaufen. Bitte erneut anmelden.'); throw Error('abgemeldet'); }\n    if (raw) return res;\n    const data = await res.json().catch(() => ({}));\n    if (!res.ok) throw Error(data.error || `Fehler ${res.status}`);\n    activity();\n    return data;\n  }\n  function toast(text, bad) { const t = $('toast'); t.textContent = text; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => t.hidden = true, 3800); }\n  const failed = e => { if (e.message !== 'abgemeldet') toast(e.message, true); };\n\n  // Bestätigungsdialog. Gibt true zurück, wenn bestätigt.\n  function confirmDialog(bodyHtml, okLabel = 'OK', danger = false, check) {\n    return new Promise(resolve => {\n      const dialog = $('dialog');\n      $('dialog-body').innerHTML = bodyHtml;\n      $('dialog-actions').innerHTML = `<button class=\"btn\" value=\"nein\" type=\"submit\">Abbrechen</button><button class=\"btn ${danger ? 'btn-danger' : 'btn-main'}\" value=\"ja\" type=\"submit\" id=\"dialog-ok\">${esc(okLabel)}</button>`;\n      const ok = $('dialog-ok');\n      ok.disabled = !!check;\n      $('dialog-body').oninput = check ? () => { ok.disabled = !check(); } : null;\n      dialog.onclose = () => resolve(dialog.returnValue === 'ja');\n      dialog.returnValue = '';\n      dialog.showModal();\n    });\n  }\n\n  // ---- Anmeldung und automatische Abmeldung bei Inaktivität ----\n  let timeoutMin = 30, lastActivity = Date.now(), idleTimer = null;\n  function activity() { lastActivity = Date.now(); }\n  ['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(e => addEventListener(e, activity, {passive: true}));\n  function startIdleWatch() {\n    clearInterval(idleTimer);\n    idleTimer = setInterval(async () => {\n      if ($('app').hidden) return;\n      const idle = Date.now() - lastActivity;\n      if (idle > timeoutMin * 60000) { await fetch('/api/logout', {method: 'POST', headers: {'X-ShirtBOX': '1'}}).catch(() => {}); showLogin('Aus Sicherheitsgründen wurden Sie nach ' + timeoutMin + ' Minuten ohne Aktivität abgemeldet.'); }\n      else if (idle > timeoutMin * 60000 - 120000) toast('Sie werden in Kürze automatisch abgemeldet. Klicken Sie irgendwo, um angemeldet zu bleiben.');\n      else if (idle < 60000 && Date.now() - (startIdleWatch.ping || 0) > 4 * 60000) { startIdleWatch.ping = Date.now(); fetch('/api/sitzung', {headers: {'X-ShirtBOX': '1'}}).catch(() => {}); }\n    }, 30000);\n  }\n  function showLogin(message) {\n    $('app').hidden = true; $('login').hidden = false; content.innerHTML = '';\n    const err = $('login-fehler'); err.hidden = !message; err.textContent = message || '';\n    err.style.background = message && message.startsWith('Aus Sicherheits') ? '#e8eefc' : ''; err.style.color = message && message.startsWith('Aus Sicherheits') ? '#2f5bd3' : '';\n    $('login-passwort').value = ''; $('login-code').value = ''; setTimeout(() => $('login-passwort').focus(), 50);\n  }\n  function showApp() { $('login').hidden = true; $('app').hidden = false; lastActivity = Date.now(); startIdleWatch(); render(); }\n  $('login-form').addEventListener('submit', async e => {\n    e.preventDefault();\n    const btn = e.submitter || e.target.querySelector('button'); btn.disabled = true;\n    try {\n      const data = await api('/api/login', {method: 'POST', body: {passwort: $('login-passwort').value, code: $('login-code').value}});\n      timeoutMin = data.timeout || 30; showApp();\n    } catch (err) { const box = $('login-fehler'); box.hidden = false; box.style.background = ''; box.style.color = ''; box.textContent = err.message; }\n    btn.disabled = false;\n  });\n  $('logout').addEventListener('click', async () => { await api('/api/logout', {method: 'POST'}).catch(() => {}); showLogin('Sie wurden abgemeldet.'); });\n  $('menu-btn').addEventListener('click', () => { const open = $('side').classList.toggle('open'); $('menu-btn').setAttribute('aria-expanded', open); });\n  $('menu').addEventListener('click', () => $('side').classList.remove('open'));\n  // Klickbare Tabellenzeilen (keine Inline-Skripte wegen Sicherheitsrichtlinie).\n  content.addEventListener('click', e => {\n    if (e.target.closest('a, button, input, select, textarea')) { if (e.target.closest('[data-reload]')) location.reload(); return; }\n    const row = e.target.closest('[data-href]'); if (row) location.hash = row.dataset.href;\n  });\n\n  // ---- Navigation ----\n  const TITLES = {dashboard: 'Dashboard', kunden: 'Kunden', bestellungen: 'Bestellungen', umsatz: 'Umsatz', newsletter: 'Newsletter', 'newsletter-erstellen': 'Newsletter erstellen', einstellungen: 'Einstellungen'};\n  addEventListener('hashchange', render);\n  let renderId = 0;\n  async function render() {\n    if ($('app').hidden) return;\n    const [view = 'dashboard', id] = location.hash.replace(/^#\\/?/, '').split('/');\n    const page = PAGES[view] ? view : 'dashboard';\n    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === page));\n    $('topbar-title').textContent = TITLES[page]; document.title = `${TITLES[page]} · ShirtBOX Verwaltung`;\n    const mine = ++renderId;\n    content.innerHTML = '<p class=\"loading\">Wird geladen …</p>';\n    try { const html = await PAGES[page](id); if (mine === renderId && typeof html === 'string') { content.innerHTML = html; while (AFTER.length) AFTER.shift()(); } }\n    catch (e) { if (mine === renderId && e.message !== 'abgemeldet') content.innerHTML = `<div class=\"card\"><h2>Das hat nicht geklappt</h2><p class=\"error\">${esc(e.message)}</p><button class=\"btn\" data-reload>Neu laden</button></div>`; }\n    AFTER.length = 0;\n    window.scrollTo(0, 0);\n  }\n  const AFTER = []; // Funktionen, die nach dem Einfügen des HTML laufen (Ereignisse binden)\n  const after = fn => AFTER.push(fn);\n  const kpi = (label, value, note, cls = '') => `<div class=\"kpi ${cls}\"><span>${esc(label)}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ''}</div>`;\n  const pager = (total, seite, size = 50) => total > size ? `<div class=\"pager\"><span>${total} Einträge · Seite ${seite} von ${Math.ceil(total / size)}</span><span class=\"actions\">${seite > 1 ? '<button class=\"btn btn-small\" data-page=\"-1\">← Zurück</button>' : ''}${seite * size < total ? '<button class=\"btn btn-small\" data-page=\"1\">Weiter →</button>' : ''}</span></div>` : `<div class=\"pager\"><span>${total} Einträge</span></div>`;\n  // Filter einmal pro Seitenaufbau binden, Blättern nach jedem Neuladen der Liste.\n  function bindFilters(state, reload) {\n    content.querySelectorAll('[data-filter]').forEach(el => el.addEventListener(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', () => {\n      clearTimeout(bindFilters.t); bindFilters.t = setTimeout(() => { state[el.dataset.filter] = el.value; state.seite = 1; reload().catch(failed); }, el.type === 'search' ? 300 : 0);\n    }));\n  }\n  function bindPager(box, state, reload) {\n    box.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { state.seite += Number(b.dataset.page); reload().catch(failed); }));\n  }\n  const query = state => new URLSearchParams(Object.entries(state).filter(([, v]) => v !== '' && v != null)).toString();\n\n  // ---- Diagramm: Umsatz pro Tag oder Monat (eine Reihe) ----\n  function chart(el, verlauf) {\n    const points = verlauf.punkte, monthly = verlauf.zeitraum === '12m';\n    const draw = () => {\n      const W = Math.max(280, el.clientWidth), H = 260, padL = 46, padB = 26, padT = 12, innerW = W - padL - 6, innerH = H - padB - padT;\n      const max = Math.max(...points.map(p => p.summe), 0);\n      const stepRaw = (max || 10000) / 4, mag = Math.pow(10, Math.floor(Math.log10(stepRaw))), step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= stepRaw);\n      const top = step * 4, slot = innerW / points.length, bw = Math.max(3, Math.min(34, slot - 4));\n      const y = v => padT + innerH - (v / top) * innerH;\n      const label = p => monthly ? new Intl.DateTimeFormat('de-CH', {month: 'short', year: '2-digit', timeZone: 'UTC'}).format(new Date(p.periode + '-01T12:00:00Z')) : date(p.periode).slice(0, 5);\n      const every = Math.ceil(points.length / Math.max(2, Math.floor(innerW / 56)));\n      let svg = `<svg viewBox=\"0 0 ${W} ${H}\" role=\"img\" aria-label=\"Umsatzentwicklung\">`;\n      for (let i = 0; i <= 4; i++) { const v = step * i, yy = y(v); svg += `<line class=\"grid-line\" x1=\"${padL}\" x2=\"${W - 6}\" y1=\"${yy}\" y2=\"${yy}\"/><text class=\"axis\" x=\"${padL - 8}\" y=\"${yy + 4}\" text-anchor=\"end\">${chfShort(v)}</text>`; }\n      points.forEach((p, i) => {\n        const x = padL + slot * i + (slot - bw) / 2, h = Math.max(0, padT + innerH - y(p.summe)), r = Math.min(4, bw / 2, h);\n        if (h > 0) svg += `<path class=\"bar\" data-i=\"${i}\" d=\"M${x},${padT + innerH} V${y(p.summe) + r} Q${x},${y(p.summe)} ${x + r},${y(p.summe)} H${x + bw - r} Q${x + bw},${y(p.summe)} ${x + bw},${y(p.summe) + r} V${padT + innerH} Z\"/>`;\n        if (i % every === 0 || i === points.length - 1) svg += `<text class=\"axis\" x=\"${padL + slot * i + slot / 2}\" y=\"${H - 6}\" text-anchor=\"middle\">${esc(label(p))}</text>`;\n        svg += `<rect class=\"hit\" data-i=\"${i}\" x=\"${padL + slot * i}\" y=\"${padT}\" width=\"${slot}\" height=\"${innerH}\"/>`;\n      });\n      svg += `<line x1=\"${padL}\" x2=\"${W - 6}\" y1=\"${padT + innerH}\" y2=\"${padT + innerH}\" stroke=\"#c9c3b6\"/></svg><div class=\"chart-tip\" hidden></div>`;\n      el.innerHTML = svg;\n      const tip = el.querySelector('.chart-tip');\n      el.querySelectorAll('.hit').forEach(hit => {\n        const show = () => {\n          const i = Number(hit.dataset.i), p = points[i];\n          el.querySelectorAll('.bar').forEach(b => b.classList.toggle('on', b.dataset.i === hit.dataset.i));\n          tip.innerHTML = `${esc(monthly ? label(p) : date(p.periode))}<b>${chf(p.summe)}</b>${p.anzahl} Bestellung${p.anzahl === 1 ? '' : 'en'}`;\n          tip.style.left = `${Math.min(W - 70, Math.max(70, padL + slot * i + slot / 2))}px`; tip.style.top = `${Math.max(40, y(p.summe) - 8)}px`; tip.hidden = false;\n        };\n        hit.addEventListener('pointerenter', show); hit.addEventListener('click', show);\n      });\n    };\n    el.addEventListener('pointerleave', () => { const tip = el.querySelector('.chart-tip'); if (tip) tip.hidden = true; el.querySelectorAll('.bar.on').forEach(b => b.classList.remove('on')); });\n    el._w = el.clientWidth; draw();\n    const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } if (Math.abs(el.clientWidth - el._w) > 8) { el._w = el.clientWidth; draw(); } });\n    ro.observe(el);\n  }\n  const chartTable = verlauf => `<details class=\"table-view\"><summary>Werte als Tabelle anzeigen</summary><div class=\"table-wrap\"><table><thead><tr><th>${verlauf.zeitraum === '12m' ? 'Monat' : 'Tag'}</th><th class=\"num\">Bestellungen</th><th class=\"num\">Betrag</th></tr></thead><tbody>${verlauf.punkte.slice().reverse().map(p => `<tr><td>${esc(verlauf.zeitraum === '12m' ? p.periode.split('-').reverse().join('.') : date(p.periode))}</td><td class=\"num\">${p.anzahl}</td><td class=\"num\">${chf(p.summe)}</td></tr>`).join('')}</tbody></table></div></details>`;\n\n  // ---- Seiten ----\n  const PAGES = {};\n\n  PAGES.dashboard = async () => {\n    const d = await api('/api/dashboard'), b = d.bestellungen, u = d.umsatz;\n    after(() => chart($('chart'), d.verlauf));\n    return `<div class=\"page-head\"><div><h1>Dashboard</h1><p class=\"muted\">Stand ${time(new Date().toISOString())} · alle Beträge in CHF inkl. MwSt. und Versand</p></div></div>\n      <div class=\"grid kpis\">\n        ${kpi('Bestellungen heute', b.heute)}${kpi('Diese Woche', b.woche)}${kpi('Diesen Monat', b.monat)}${kpi('Bestellungen total', b.total, b.storniert ? `${b.storniert} storniert (nicht gezählt)` : '')}\n        ${kpi('Umsatz heute', chf(u.heute))}${kpi('Umsatz diese Woche', chf(u.woche))}${kpi('Umsatz diesen Monat', chf(u.monat))}${kpi('Gesamtumsatz', chf(u.total), 'Bestellwert', 'highlight')}\n        ${kpi('Offene Zahlungen', b.offen, '<a href=\"#/bestellungen/?zahlung=offen\">ansehen</a>')}${kpi('Bezahlte Bestellungen', b.bezahlt, chf(u.bezahlt) + ' erhalten')}${kpi('Verkaufte T-Shirts', d.shirts)}${kpi('Ø Bestellwert', chf(u.durchschnitt))}\n      </div>\n      <div class=\"grid kpis\" style=\"margin-top:12px\">\n        ${kpi('In Arbeit', b.in_arbeit, 'Neu, in Bearbeitung, produziert')}${kpi('Kunden', d.kunden)}${kpi('Newsletter-Abonnenten', d.abonnenten, d.ausstehend ? `${d.ausstehend} warten auf Bestätigung` : '')}${kpi('Abgemeldet', d.abgemeldet)}\n      </div>\n      <div class=\"card\"><h2>Umsatz der letzten 30 Tage <a class=\"btn btn-small\" href=\"#/umsatz\">Mehr Auswertungen</a></h2><div class=\"chart\" id=\"chart\"></div>${chartTable(d.verlauf)}</div>\n      <div class=\"card\"><h2>Neueste Bestellungen <a class=\"btn btn-small\" href=\"#/bestellungen\">Alle Bestellungen</a></h2>\n        ${d.neueste.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Bestellung</th><th>Kunde</th><th class=\"hide-mobile\">Datum</th><th class=\"num\">Betrag</th><th>Status</th><th>Zahlung</th></tr></thead><tbody>\n        ${d.neueste.map(o => `<tr class=\"click\" data-href=\"#/bestellungen/${o.id}\"><td><b>${esc(o.bestellnummer)}</b></td><td>${esc(o.vorname)} ${esc(o.nachname)}</td><td class=\"hide-mobile\">${time(o.erstellt)}</td><td class=\"num\">${chf(o.total_rappen)}</td><td>${badge(STATUS, o.status)}</td><td>${badge(ZAHLUNG, o.zahlung)}</td></tr>`).join('')}\n        </tbody></table></div>` : '<p class=\"empty\">Noch keine Bestellungen gespeichert. Neue Bestellungen erscheinen hier automatisch.</p>'}\n      </div>`;\n  };\n\n  // Kunden\n  const customerState = {q: '', seite: 1};\n  PAGES.kunden = async id => {\n    if (id) return customerDetail(id);\n    const load = async () => {\n      const d = await api('/api/kunden?' + query(customerState));\n      $('kunden-liste').innerHTML = d.kunden.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Nr.</th><th>Name</th><th class=\"hide-mobile\">E-Mail</th><th class=\"hide-mobile\">Ort</th><th class=\"num\">Bestellungen</th><th class=\"num\">Umsatz</th><th class=\"hide-mobile\">Newsletter</th></tr></thead><tbody>\n        ${d.kunden.map(k => `<tr class=\"click\" data-href=\"#/kunden/${k.id}\"><td>${kNr(k.id)}</td><td><b>${esc(k.vorname)} ${esc(k.nachname)}</b></td><td class=\"hide-mobile\">${esc(k.email)}</td><td class=\"hide-mobile\">${esc(k.plz)} ${esc(k.ort)}</td><td class=\"num\">${k.bestellungen}</td><td class=\"num\">${chf(k.umsatz)}</td><td class=\"hide-mobile\">${k.newsletter ? badge(ABO, k.newsletter) : '<span class=\"muted\">–</span>'}</td></tr>`).join('')}\n        </tbody></table></div>${pager(d.total, customerState.seite)}` : '<p class=\"empty\">Keine Kunden gefunden.</p>';\n      bindPager($('kunden-liste'), customerState, load);\n    };\n    after(() => { bindFilters(customerState, load); load().catch(failed); });\n    return `<div class=\"page-head\"><div><h1>Kunden</h1><p class=\"muted\">Jede E-Mail-Adresse ist ein Kunde – auch bei mehreren Bestellungen.</p></div><div class=\"actions\"><a class=\"btn\" href=\"/api/export/kunden.csv\">⬇ Excel/CSV-Export</a></div></div>\n      <div class=\"card\"><div class=\"filters\"><label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(customerState.q)}\" placeholder=\"Name, E-Mail, Ort, PLZ oder Kundennummer\"></label></div><div id=\"kunden-liste\"><p class=\"loading\">Wird geladen …</p></div></div>`;\n  };\n\n  async function customerDetail(id) {\n    const d = await api('/api/kunden/' + id), k = d.kunde;\n    after(() => {\n      $('del-kunde').addEventListener('click', async () => {\n        const ok = await confirmDialog(`<h2>Kunde löschen?</h2><p>Alle Daten von <b>${esc(k.vorname)} ${esc(k.nachname)}</b> werden endgültig gelöscht – inklusive ${d.bestellungen.length} Bestellung(en) und Designbildern.</p>\n          <p class=\"error\" style=\"background:#fff4d6;color:#7a5200\">Achtung Aufbewahrungspflicht: Geschäftsunterlagen (z. B. Bestellungen und Zahlungen) müssen in der Schweiz grundsätzlich 10 Jahre aufbewahrt werden. Löschen Sie nur, wenn keine Pflicht mehr besteht – oder bewahren Sie vorher einen Beleg ausserhalb auf.</p>\n          <label style=\"margin-top:12px\"><input type=\"checkbox\" id=\"del-nl\" style=\"width:auto;min-height:0;margin-right:6px\">Auch Newsletter-Daten dieser E-Mail-Adresse löschen</label>\n          <label style=\"margin-top:12px\">Zur Bestätigung <b>LÖSCHEN</b> eingeben<input id=\"del-wort\" autocomplete=\"off\"></label>`, 'Endgültig löschen', true, () => $('del-wort').value.trim() === 'LÖSCHEN');\n        if (!ok) return;\n        try { await api('/api/kunden/' + id, {method: 'DELETE', body: {bestaetigung: 'LÖSCHEN', newsletter: $('del-nl')?.checked}}); toast('Kunde gelöscht.'); location.hash = '#/kunden'; } catch (e) { failed(e); }\n      });\n    });\n    const nl = d.newsletter;\n    return `<div class=\"page-head\"><div><a href=\"#/kunden\" class=\"no-print\">← Alle Kunden</a><h1>${esc(k.vorname)} ${esc(k.nachname)}</h1><p class=\"muted\">${kNr(k.id)} · Kunde seit ${date(k.erste_bestellung)}</p></div>\n      <div class=\"actions no-print\"><a class=\"btn\" href=\"mailto:${esc(k.email)}\">✉️ E-Mail</a>${k.telefon ? `<a class=\"btn\" href=\"https://wa.me/${esc(k.telefon.replace(/\\D/g, ''))}\" target=\"_blank\" rel=\"noopener\">💬 WhatsApp</a>` : ''}<a class=\"btn\" href=\"/api/kunden/${k.id}/auskunft\">⬇ Datenauskunft</a><button class=\"btn btn-danger\" id=\"del-kunde\">Löschen</button></div></div>\n      <div class=\"grid two\">\n        <div class=\"card\"><h2>Kontakt und Adresse</h2><dl class=\"facts\"><dt>E-Mail</dt><dd>${esc(k.email)}</dd><dt>Telefon</dt><dd>${esc(k.telefon || '–')}</dd><dt>Adresse</dt><dd>${esc(k.strasse)}<br>${esc(k.plz)} ${esc(k.ort)}<br>${esc(k.land)}</dd><dt>Erste Bestellung</dt><dd>${time(k.erste_bestellung)}</dd></dl></div>\n        <div class=\"card\"><h2>Newsletter</h2>${nl ? `<dl class=\"facts\"><dt>Status</dt><dd>${badge(ABO, nl.status)}</dd><dt>Angemeldet</dt><dd>${time(nl.angemeldet)}</dd><dt>Bestätigt</dt><dd>${time(nl.einwilligung_zeit)}</dd><dt>Herkunft</dt><dd>${esc(nl.einwilligung_quelle || '–')}</dd>${nl.abgemeldet ? `<dt>Abgemeldet</dt><dd>${time(nl.abgemeldet)}</dd>` : ''}</dl>` : '<p class=\"muted\">Kein Newsletter-Abo. Kunden erhalten nur dann Newsletter, wenn sie selbst zustimmen und bestätigen.</p>'}</div>\n      </div>\n      <div class=\"card\"><h2>Bestellungen (${d.bestellungen.length})</h2><div class=\"table-wrap\"><table><thead><tr><th>Bestellung</th><th>Datum</th><th class=\"num\">Shirts</th><th class=\"num\">Betrag</th><th>Status</th><th>Zahlung</th></tr></thead><tbody>\n        ${d.bestellungen.map(o => `<tr class=\"click\" data-href=\"#/bestellungen/${o.id}\"><td><b>${esc(o.bestellnummer)}</b></td><td>${time(o.erstellt)}</td><td class=\"num\">${o.anzahl}</td><td class=\"num\">${chf(o.total_rappen)}</td><td>${badge(STATUS, o.status)}</td><td>${badge(ZAHLUNG, o.zahlung)}</td></tr>`).join('')}\n      </tbody></table></div></div>`;\n  }\n\n  // Bestellungen\n  const orderState = {q: '', status: '', zahlung: '', von: '', bis: '', sort: 'neu', seite: 1};\n  PAGES.bestellungen = async id => {\n    if (id && /^\\d+$/.test(id)) return orderDetail(id);\n    if (id && id.startsWith('?')) { const p = new URLSearchParams(id); for (const k of ['status', 'zahlung']) if (p.has(k)) orderState[k] = p.get(k); }\n    const load = async () => {\n      const d = await api('/api/bestellungen?' + query(orderState));\n      $('bestell-liste').innerHTML = d.bestellungen.length ? `<div class=\"table-wrap\"><table><thead><tr><th></th><th>Bestellung</th><th>Kunde</th><th class=\"hide-mobile\">Datum</th><th class=\"num\">Shirts</th><th class=\"num\">Betrag</th><th>Status</th><th>Zahlung</th></tr></thead><tbody>\n        ${d.bestellungen.map(o => `<tr class=\"click\" data-href=\"#/bestellungen/${o.id}\"><td>${o.bild ? `<img class=\"thumb\" loading=\"lazy\" src=\"/api/bild?k=${encodeURIComponent(o.bild)}\" alt=\"\">` : ''}</td><td><b>${esc(o.bestellnummer)}</b></td><td>${esc(o.vorname)} ${esc(o.nachname)}<br><span class=\"muted small\">${esc(o.ort)}</span></td><td class=\"hide-mobile\">${time(o.erstellt)}</td><td class=\"num\">${o.anzahl}</td><td class=\"num\">${chf(o.total_rappen)}</td><td>${badge(STATUS, o.status)}</td><td>${badge(ZAHLUNG, o.zahlung)}</td></tr>`).join('')}\n        </tbody></table></div>${pager(d.total, orderState.seite)}<p class=\"muted small\">Summe der gefilterten Bestellungen: <b>${chf(d.summe)}</b></p>` : '<p class=\"empty\">Keine Bestellungen gefunden.</p>';\n      bindPager($('bestell-liste'), orderState, load);\n    };\n    after(() => { bindFilters(orderState, load); load().catch(failed); });\n    return `<div class=\"page-head\"><div><h1>Bestellungen</h1><p class=\"muted\">Anklicken zum Öffnen, Status ändern und Drucken.</p></div><div class=\"actions\"><a class=\"btn\" href=\"/api/export/bestellungen.csv\">⬇ Excel/CSV-Export</a></div></div>\n      <div class=\"card\"><div class=\"filters\">\n        <label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(orderState.q)}\" placeholder=\"Bestellnummer, Name, E-Mail oder Ort\"></label>\n        <label>Status<select data-filter=\"status\"><option value=\"\">Alle</option><option value=\"offen\"${orderState.status === 'offen' ? ' selected' : ''}>Alle offenen (in Arbeit)</option>${options(STATUS, orderState.status)}</select></label>\n        <label>Zahlung<select data-filter=\"zahlung\"><option value=\"\">Alle</option>${options(ZAHLUNG, orderState.zahlung)}</select></label>\n        <label>Von<input type=\"date\" data-filter=\"von\" value=\"${esc(orderState.von)}\"></label>\n        <label>Bis<input type=\"date\" data-filter=\"bis\" value=\"${esc(orderState.bis)}\"></label>\n        <label>Sortierung<select data-filter=\"sort\"><option value=\"neu\"${orderState.sort === 'neu' ? ' selected' : ''}>Neueste zuerst</option><option value=\"alt\"${orderState.sort === 'alt' ? ' selected' : ''}>Älteste zuerst</option><option value=\"betrag\"${orderState.sort === 'betrag' ? ' selected' : ''}>Höchster Betrag</option></select></label>\n      </div><div id=\"bestell-liste\"><p class=\"loading\">Wird geladen …</p></div></div>`;\n  };\n\n  async function orderDetail(id) {\n    const d = await api('/api/bestellungen/' + id), o = d.bestellung, a = o.lieferadresse || {};\n    const img = key => `/api/bild?k=${encodeURIComponent(key)}`;\n    after(() => {\n      const save = async body => { try { await api('/api/bestellungen/' + id, {method: 'PATCH', body}); toast('Gespeichert.'); } catch (e) { failed(e); } };\n      $('o-status').addEventListener('change', e => save({status: e.target.value}).then(() => $('o-status-badge').innerHTML = badge(STATUS, e.target.value)));\n      // Zahlung: Der Server bucht die passende Zahlung in der Buchhaltung und meldet den tatsächlichen Stand zurück.\n      $('o-zahlung').addEventListener('change', async e => {\n        try { const r = await api('/api/bestellungen/' + id, {method: 'PATCH', body: {zahlung: e.target.value}}); e.target.value = o.zahlung = r.zahlung; $('o-zahlung-badge').innerHTML = badge(ZAHLUNG, r.zahlung); toast(r.hinweis || 'Gespeichert – Zahlung in der Buchhaltung erfasst.'); }\n        catch (err) { failed(err); e.target.value = o.zahlung; }\n      });\n      $('o-notiz-save').addEventListener('click', () => save({notiz: $('o-notiz').value}));\n      $('o-print').addEventListener('click', () => window.print());\n    });\n    const digits = (o.telefon || '').replace(/\\D/g, '');\n    return `<div class=\"page-head\"><div><a href=\"#/bestellungen\" class=\"no-print\">← Alle Bestellungen</a><h1>Bestellung ${esc(o.bestellnummer)}</h1><p class=\"muted\">${time(o.erstellt)} · <span id=\"o-status-badge\">${badge(STATUS, o.status)}</span> <span id=\"o-zahlung-badge\">${badge(ZAHLUNG, o.zahlung)}</span></p></div>\n      <div class=\"actions no-print\"><button class=\"btn btn-dark\" id=\"o-print\">🖨 Drucken</button><a class=\"btn\" href=\"mailto:${esc(o.email)}?subject=${encodeURIComponent('Ihre ShirtBOX-Bestellung ' + o.bestellnummer)}\">✉️ Kunde anschreiben</a>${digits ? `<a class=\"btn\" href=\"https://wa.me/${digits}\" target=\"_blank\" rel=\"noopener\">💬 WhatsApp</a>` : ''}</div></div>\n      <div class=\"grid two\">\n        <div class=\"card no-print\"><h2>Status</h2><div class=\"status-row\"><label>Bestellstatus<select id=\"o-status\">${options(STATUS, o.status)}</select></label><label>Zahlung<select id=\"o-zahlung\">${options(ZAHLUNG, o.zahlung)}</select></label></div>\n          ${o.bezahlt_am ? `<p class=\"muted small\">Als bezahlt markiert am ${date(o.bezahlt_am)}</p>` : ''}\n          <label style=\"margin-top:12px\">Interne Notiz<textarea id=\"o-notiz\" rows=\"3\" placeholder=\"z. B. TWINT erhalten am …, beim Lieferanten bestellt am …\">${esc(o.notiz || '')}</textarea></label><button class=\"btn btn-small\" id=\"o-notiz-save\" style=\"margin-top:8px\">Notiz speichern</button></div>\n        <div class=\"card\"><h2>Kunde</h2><dl class=\"facts\"><dt>Name</dt><dd><a href=\"#/kunden/${o.kunde_id}\">${esc(o.vorname)} ${esc(o.nachname)}</a> (${kNr(o.kunde_id)})</dd><dt>E-Mail</dt><dd>${esc(o.email)}</dd><dt>Telefon</dt><dd>${esc(o.telefon || '–')}</dd>\n          <dt>Lieferadresse</dt><dd>${esc(a.vorname)} ${esc(a.nachname)}<br>${esc(a.strasse)}<br>${esc(a.plz)} ${esc(a.ort)}<br>${esc(a.land)}</dd></dl></div>\n      </div>\n      <div class=\"card\"><h2>Bestellte T-Shirts</h2>\n        ${d.designs.map(x => `<div class=\"design\"><div>${x.bild_vorschau ? `<img src=\"${img(x.bild_vorschau)}\" alt=\"Design ${x.design_nr}: Vorder- und Rückseite\">` : '<p class=\"empty\">Kein Vorschaubild gespeichert</p>'}<p class=\"muted small\">Vorderseite links, Rückseite rechts</p></div>\n          <div><h3>Design ${x.design_nr}</h3><dl class=\"facts\"><dt>Farbe</dt><dd>${esc(x.farbe || '–')}</dd><dt>Stückzahl</dt><dd>${x.anzahl}</dd><dt>Einzelpreis</dt><dd>${chf(x.einzelpreis_rappen)}${x.anzahl > 1 ? ` · weitere ${chf(8010)}` : ''}</dd><dt>Summe</dt><dd>${chf(x.summe_rappen)}</dd><dt>Bildrechte</dt><dd>${x.rechte ? '✓ bestätigt' : '⚠ nicht bestätigt'}</dd></dl>\n          <table style=\"margin-top:10px\"><thead><tr><th>Grösse Kunde</th><th>Beim Lieferanten</th><th class=\"num\">Stück</th></tr></thead><tbody>${x.groessen.map(g => `<tr><td>${esc(g.groesse)}</td><td><b>${esc(g.bestellgroesse)}</b></td><td class=\"num\">${g.anzahl}×</td></tr>`).join('')}</tbody></table>\n          <p class=\"no-print\" style=\"margin:10px 0 0\">${x.bild_druck ? `<a class=\"btn btn-small\" href=\"${img(x.bild_druck)}\" download>⬇ Druckdatei</a> ` : '<span class=\"badge bad\">Druckdatei fehlt</span> '}${x.bilder_original.map((k, i) => `<a class=\"btn btn-small\" href=\"${img(k)}\" download>⬇ Original ${i + 1}</a>`).join(' ')}</p>\n          ${x.details ? `<pre>${esc(x.details)}</pre>` : ''}</div></div>`).join('')}\n        <table style=\"margin-top:12px\"><tbody><tr><td>Versand</td><td class=\"num\">${o.versand_rappen ? chf(o.versand_rappen) : 'inklusive'}</td></tr><tr><td><b>Total (${o.anzahl} Shirt${o.anzahl === 1 ? '' : 's'})</b></td><td class=\"num\"><b>${chf(o.total_rappen)}</b></td></tr></tbody></table>\n        <p class=\"muted small\">Bezahlung per TWINT · ${esc(o.agb ? 'AGB akzeptiert (' + o.agb + ')' : 'AGB-Zustimmung nicht gespeichert')}</p>\n      </div>`;\n  }\n\n  // Umsatz\n  const revState = {zeitraum: '30t', art: 'bestellwert'};\n  PAGES.umsatz = async () => {\n    const d = await api('/api/umsatz?' + query(revState)), s = d.summen;\n    after(() => {\n      chart($('chart'), d);\n      content.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => { revState[b.dataset.seg] = b.dataset.value; render(); }));\n    });\n    const seg = (key, value, label) => `<button type=\"button\" data-seg=\"${key}\" data-value=\"${value}\" class=\"${revState[key] === value ? 'on' : ''}\">${label}</button>`;\n    return `<div class=\"page-head\"><div><h1>Umsatz</h1><p class=\"muted\">Bestellwert = alle nicht stornierten Bestellungen. Bezahlt = als „Bezahlt“ markiert. Alle Beträge in CHF.</p></div></div>\n      <div class=\"grid kpis\">${kpi('Bestellwert', chf(s.bestellwert), revState.zeitraum === '12m' ? 'letzte 12 Monate' : 'letzte 30 Tage', 'highlight')}${kpi('Tatsächlich bezahlt', chf(s.bezahlt))}${kpi('Noch offen', chf(s.offen))}${kpi('Rückerstattet', chf(s.rueckerstattet))}</div>\n      <div class=\"card\"><h2>Umsatzentwicklung <span class=\"actions\"><span class=\"seg\">${seg('zeitraum', '30t', '30 Tage')}${seg('zeitraum', '12m', '12 Monate')}</span><span class=\"seg\">${seg('art', 'bestellwert', 'Bestellwert')}${seg('art', 'bezahlt', 'Bezahlt')}</span></span></h2>\n        <p class=\"muted small\">${revState.art === 'bezahlt' ? 'Nach Datum der Zahlungsbestätigung.' : 'Nach Bestelldatum.'} Fahren Sie über einen Balken für Details.</p><div class=\"chart\" id=\"chart\"></div>${chartTable(d)}</div>`;\n  };\n\n  // Newsletter: Abonnenten und versendete Newsletter\n  const subState = {q: '', status: '', seite: 1};\n  PAGES.newsletter = async id => {\n    if (id) return newsletterDetail(id);\n    const [list] = await Promise.all([api('/api/newsletter')]);\n    const load = async () => {\n      const d = await api('/api/abonnenten?' + query(subState)), z = d.zahlen;\n      $('abo-zahlen').innerHTML = `${kpi('Aktive Abonnenten', Number(z.aktiv) || 0, 'erhalten Newsletter', 'highlight')}${kpi('Warten auf Bestätigung', Number(z.ausstehend) || 0)}${kpi('Abgemeldet', Number(z.abgemeldet) || 0)}${kpi('Unzustellbar', Number(z.unzustellbar) || 0)}`;\n      $('abo-liste').innerHTML = d.abonnenten.length ? `<div class=\"table-wrap\"><table><thead><tr><th>E-Mail</th><th>Name</th><th>Status</th><th class=\"hide-mobile\">Angemeldet</th><th class=\"hide-mobile\">Einwilligung</th><th></th></tr></thead><tbody>\n        ${d.abonnenten.map(a => `<tr><td>${esc(a.email)}${a.kunde_id ? ` <a class=\"small\" href=\"#/kunden/${a.kunde_id}\">Kunde</a>` : ''}</td><td>${esc([a.vorname, a.nachname].filter(Boolean).join(' ') || '–')}</td><td>${badge(ABO, a.status)}${a.abgemeldet ? `<br><span class=\"muted small\">${date(a.abgemeldet)}</span>` : ''}</td><td class=\"hide-mobile\">${time(a.angemeldet)}</td><td class=\"hide-mobile small\">${a.einwilligung_zeit ? `bestätigt ${time(a.einwilligung_zeit)}<br>` : ''}<span class=\"muted\">${esc(a.einwilligung_quelle || '')}</span></td>\n          <td class=\"num\">${['aktiv', 'ausstehend'].includes(a.status) ? `<button class=\"btn btn-small\" data-abmelden=\"${a.id}\">Abmelden</button> ` : ''}<button class=\"btn btn-small btn-danger\" data-loeschen=\"${a.id}\" title=\"Löschen\">✕</button></td></tr>`).join('')}\n        </tbody></table></div>${pager(d.total, subState.seite)}` : '<p class=\"empty\">Keine Abonnenten gefunden.</p>';\n      bindPager($('abo-liste'), subState, load);\n      content.querySelectorAll('[data-abmelden]').forEach(b => b.addEventListener('click', async () => {\n        if (!await confirmDialog('<h2>Abonnent abmelden?</h2><p>Diese Person erhält danach keine Newsletter mehr. Die Abmeldung wird gespeichert.</p>', 'Abmelden')) return;\n        try { await api('/api/abonnenten/' + b.dataset.abmelden, {method: 'PATCH', body: {status: 'abgemeldet'}}); toast('Abgemeldet.'); load(); } catch (e) { failed(e); }\n      }));\n      content.querySelectorAll('[data-loeschen]').forEach(b => b.addEventListener('click', async () => {\n        if (!await confirmDialog('<h2>Abonnent löschen?</h2><p>Der Eintrag und der Nachweis der Einwilligung werden endgültig gelöscht. Tipp: Für eine Abmeldung reicht „Abmelden“ – dann bleibt dokumentiert, dass die Person keine Werbung mehr möchte.</p>', 'Endgültig löschen', true)) return;\n        try { await api('/api/abonnenten/' + b.dataset.loeschen, {method: 'DELETE'}); toast('Gelöscht.'); load(); } catch (e) { failed(e); }\n      }));\n    };\n    after(() => { bindFilters(subState, load); load().catch(failed); });\n    return `<div class=\"page-head\"><div><h1>Newsletter</h1><p class=\"muted\">Nur Personen, die selbst zugestimmt und per E-Mail bestätigt haben (Double-Opt-in), erhalten Newsletter.</p></div><div class=\"actions\"><a class=\"btn\" href=\"/api/export/abonnenten.csv\">⬇ Excel/CSV-Export</a><a class=\"btn btn-main\" href=\"#/newsletter-erstellen\">✏️ Newsletter erstellen</a></div></div>\n      <div class=\"grid kpis\" id=\"abo-zahlen\"></div>\n      <div class=\"card\"><h2>Versendete Newsletter und Entwürfe</h2>${list.newsletter.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Betreff</th><th>Status</th><th class=\"hide-mobile\">Datum</th><th class=\"num\">Empfänger</th><th class=\"num\">Gesendet</th><th class=\"num hide-mobile\">Zugestellt</th><th class=\"num\">Fehler</th></tr></thead><tbody>\n        ${list.newsletter.map(n => `<tr class=\"click\" data-href=\"${n.status === 'entwurf' ? '#/newsletter-erstellen/' : '#/newsletter/'}${n.id}\"><td><b>${esc(n.betreff)}</b></td><td>${badge(NL, n.status)}${Number(n.wartend) ? `<br><span class=\"muted small\">${n.wartend} warten</span>` : ''}</td><td class=\"hide-mobile\">${time(n.versand_start || n.geaendert)}</td><td class=\"num\">${n.empfaenger || '–'}</td><td class=\"num\">${Number(n.gesendet) || 0}</td><td class=\"num hide-mobile\">${Number(n.zugestellt) || 0}</td><td class=\"num\">${Number(n.fehler) || 0}</td></tr>`).join('')}\n        </tbody></table></div>` : '<p class=\"empty\">Noch kein Newsletter erstellt.</p>'}</div>\n      <div class=\"card\"><h2>Abonnenten</h2><div class=\"filters\"><label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(subState.q)}\" placeholder=\"E-Mail oder Name\"></label><label>Status<select data-filter=\"status\"><option value=\"\">Alle</option>${options(ABO, subState.status)}</select></label></div><div id=\"abo-liste\"><p class=\"loading\">Wird geladen …</p></div></div>`;\n  };\n\n  async function newsletterDetail(id) {\n    const d = await api('/api/newsletter/' + id), n = d.newsletter, s = d.statistik || {};\n    after(() => {\n      $('nl-kopie').addEventListener('click', async () => { try { const r = await api(`/api/newsletter/${id}/kopie`, {method: 'POST'}); location.hash = '#/newsletter-erstellen/' + r.id; } catch (e) { failed(e); } });\n      api('/api/newsletter/vorschau', {method: 'POST', body: {betreff: n.betreff, inhalt: n.inhalt}}).then(r => $('nl-frame').srcdoc = r.html).catch(failed);\n    });\n    return `<div class=\"page-head\"><div><a href=\"#/newsletter\">← Newsletter</a><h1>${esc(n.betreff)}</h1><p class=\"muted\">${badge(NL, n.status)} · Versand gestartet ${time(n.versand_start)}${n.versand_ende ? ` · abgeschlossen ${time(n.versand_ende)}` : ''}</p></div><div class=\"actions\"><button class=\"btn\" id=\"nl-kopie\">Als Vorlage für neuen Newsletter</button></div></div>\n      <div class=\"grid kpis\">${kpi('Empfänger', n.empfaenger)}${kpi('Gesendet', Number(s.gesendet) || 0)}${kpi('Zugestellt', Number(s.zugestellt) || 0, 'laut Resend')}${kpi('Nicht zugestellt / Fehler', Number(s.fehler) || 0)}${Number(s.wartend) ? kpi('Warten auf Versand', s.wartend, 'wird automatisch fortgesetzt') : ''}${Number(s.uebersprungen) ? kpi('Übersprungen', s.uebersprungen, 'vorher abgemeldet') : ''}</div>\n      ${Number(s.wartend) ? '<div class=\"card\"><p>⏳ Wegen der Versandlimits von Resend wird der Newsletter in Etappen verschickt. Der Rest folgt automatisch alle 15 Minuten bzw. am nächsten Tag.</p></div>' : ''}\n      <div class=\"card\"><h2>Nicht zugestellte E-Mails</h2>${d.probleme.length ? `<div class=\"table-wrap\"><table><thead><tr><th>E-Mail</th><th>Status</th><th>Grund</th></tr></thead><tbody>${d.probleme.map(p => `<tr><td>${esc(p.email)}</td><td><span class=\"badge bad\">${esc(EMPF[p.status] || p.status)}</span></td><td class=\"small\">${esc(p.fehler || '–')}</td></tr>`).join('')}</tbody></table></div>` : '<p class=\"muted\">Keine Zustellprobleme gemeldet.</p>'}</div>\n      <div class=\"card preview\"><h2>So sah der Newsletter aus</h2><iframe id=\"nl-frame\" title=\"Newsletter-Ansicht\" sandbox=\"\"></iframe></div>`;\n  }\n\n  // Newsletter erstellen\n  const BLOCK_NAMES = {ueberschrift: 'Überschrift', text: 'Text', bild: 'Bild', angebot: 'Angebot / Aktion', button: 'Button mit Link', trenner: 'Trennlinie'};\n  const NEW_CONTENT = () => ({vorschau: 'Neuigkeiten und Aktionen von ShirtBOX', bloecke: [\n    {typ: 'ueberschrift', text: 'Hallo {{vorname}}!'},\n    {typ: 'text', text: 'Hier steht Ihr Newsletter-Text.\\n\\nTipp: **fett** schreiben Sie mit zwei Sternchen, einen Link mit [Linktext](https://shirtbox.ch).'},\n    {typ: 'button', text: 'Jetzt Shirt designen', link: 'https://shirtbox.ch/designhilfe.html'}]});\n  PAGES['newsletter-erstellen'] = async id => {\n    let n = {betreff: '', inhalt: NEW_CONTENT(), status: 'entwurf'};\n    if (id) { const d = await api('/api/newsletter/' + id); n = d.newsletter; if (n.status !== 'entwurf') { location.hash = '#/newsletter/' + id; return; } }\n    let current = id ? Number(id) : null, dirty = false;\n    const linkSelect = cls => `<select class=\"${cls}\"><option value=\"\">Seite wählen …</option>${LINKS.map(([l, u]) => `<option value=\"${u}\">${esc(l)}</option>`).join('')}</select>`;\n    const blockHtml = (b, i) => {\n      const f = (key, label, type = 'text', ph = '') => `<label>${label}${type === 'area' ? `<textarea data-k=\"${key}\" rows=\"${key === 'text' ? 6 : 3}\" placeholder=\"${esc(ph)}\">${esc(b[key] || '')}</textarea>` : `<input data-k=\"${key}\" type=\"${type}\" value=\"${esc(b[key] || '')}\" placeholder=\"${esc(ph)}\">`}</label>`;\n      let body = '';\n      if (b.typ === 'ueberschrift') body = f('text', 'Überschrift', 'text', 'z. B. Hallo {{vorname}}!');\n      if (b.typ === 'text') body = f('text', 'Text', 'area') + '<p class=\"hint\">Leerzeile = neuer Absatz · **fett** · [Linktext](https://…) · {{vorname}} = Vorname des Empfängers</p>';\n      if (b.typ === 'bild') body = `<label>Bild hochladen<input type=\"file\" accept=\"image/jpeg,image/png,image/webp,image/gif\" data-upload=\"url\"></label>${b.url ? `<img class=\"mini\" src=\"${esc(b.url)}\" alt=\"\">` : ''}${f('url', 'oder Bildadresse', 'url', 'https://…')}${f('alt', 'Bildbeschreibung', 'text', 'z. B. Neues Fussball-Shirt')}<div class=\"row\">${f('link', 'Link beim Anklicken (optional)', 'url', 'https://shirtbox.ch/…')}<label>Schnellwahl${linkSelect('pick-link')}</label></div>`;\n      if (b.typ === 'angebot') body = `${f('titel', 'Titel', 'text', 'z. B. 10 % auf alle Vereins-Shirts')}${f('text', 'Beschreibung', 'area')}<div class=\"row\">${f('preis', 'Preis', 'text', 'z. B. CHF 79.–')}${f('alterpreis', 'Alter Preis (durchgestrichen)', 'text', 'z. B. CHF 89.–')}</div>\n        <label>Bild hochladen (optional)<input type=\"file\" accept=\"image/jpeg,image/png,image/webp,image/gif\" data-upload=\"bild\"></label>${b.bild ? `<img class=\"mini\" src=\"${esc(b.bild)}\" alt=\"\">` : ''}<div class=\"row\">${f('button', 'Button-Text', 'text', 'z. B. Jetzt bestellen')}${f('link', 'Link', 'url', 'https://shirtbox.ch/…')}</div><label>Schnellwahl Link${linkSelect('pick-link')}</label>`;\n      if (b.typ === 'button') body = `<div class=\"row\">${f('text', 'Button-Text', 'text', 'z. B. Jetzt Shirt designen')}${f('link', 'Link', 'url', 'https://shirtbox.ch/…')}</div><label>Schnellwahl Link${linkSelect('pick-link')}</label>`;\n      if (b.typ === 'trenner') body = '<p class=\"hint\">Eine feine Linie zwischen zwei Abschnitten.</p>';\n      return `<div class=\"block\" data-i=\"${i}\"><div class=\"block-head\">${esc(BLOCK_NAMES[b.typ])}<span class=\"block-tools\"><button type=\"button\" data-move=\"-1\" title=\"Nach oben\">↑</button><button type=\"button\" data-move=\"1\" title=\"Nach unten\">↓</button><button type=\"button\" data-del title=\"Entfernen\">✕</button></span></div>${body}</div>`;\n    };\n    const content2 = n.inhalt;\n    const drawBlocks = () => {\n      $('blocks').innerHTML = content2.bloecke.map(blockHtml).join('') || '<p class=\"empty\">Noch keine Inhalte. Fügen Sie unten Bausteine hinzu.</p>';\n      $('blocks').querySelectorAll('.block').forEach(el => {\n        const b = content2.bloecke[Number(el.dataset.i)];\n        el.querySelectorAll('[data-k]').forEach(input => input.addEventListener('input', () => { b[input.dataset.k] = input.value; changed(); }));\n        el.querySelectorAll('.pick-link').forEach(sel => sel.addEventListener('change', () => { if (!sel.value) return; b.link = sel.value; el.querySelector('[data-k=\"link\"]').value = sel.value; sel.value = ''; changed(); }));\n        el.querySelectorAll('[data-upload]').forEach(input => input.addEventListener('change', async () => {\n          const file = input.files[0]; if (!file) return;\n          const form = new FormData(); form.append('bild', file);\n          try { toast('Bild wird hochgeladen …'); const r = await api('/api/bild', {method: 'POST', body: form}); b[input.dataset.upload] = r.url; drawBlocks(); changed(); toast('Bild hinzugefügt.'); } catch (e) { failed(e); }\n        }));\n        el.querySelector('[data-del]').addEventListener('click', () => { content2.bloecke.splice(Number(el.dataset.i), 1); drawBlocks(); changed(); });\n        el.querySelectorAll('[data-move]').forEach(btn => btn.addEventListener('click', () => {\n          const i = Number(el.dataset.i), j = i + Number(btn.dataset.move);\n          if (j < 0 || j >= content2.bloecke.length) return;\n          [content2.bloecke[i], content2.bloecke[j]] = [content2.bloecke[j], content2.bloecke[i]]; drawBlocks(); changed();\n        }));\n      });\n    };\n    let previewTimer;\n    const preview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => api('/api/newsletter/vorschau', {method: 'POST', body: {betreff: $('nl-betreff').value, inhalt: content2}}).then(r => { const fr = $('nl-frame'); if (fr) fr.srcdoc = r.html; }).catch(failed), 450); };\n    // Automatisches Speichern 3 Sekunden nach der letzten Änderung (sobald ein Betreff da ist).\n    let autosave, saving = null;\n    const changed = () => {\n      dirty = true; $('nl-saved').textContent = 'Ungespeicherte Änderungen'; preview();\n      clearTimeout(autosave); autosave = setTimeout(() => { if ($('nl-betreff')?.value.trim() && dirty) save(true).catch(() => {}); }, 3000);\n    };\n    const save = async quiet => {\n      if (saving) await saving.catch(() => {});\n      saving = (async () => {\n        const body = {betreff: $('nl-betreff').value, inhalt: content2};\n        const r = current ? await api('/api/newsletter/' + current, {method: 'PUT', body}) : await api('/api/newsletter', {method: 'POST', body});\n        if (!current) { current = r.id; history.replaceState(null, '', '#/newsletter-erstellen/' + r.id); }\n        dirty = false;\n        const label = $('nl-saved'); if (label) label.textContent = 'Gespeichert ' + new Intl.DateTimeFormat('de-CH', {hour: '2-digit', minute: '2-digit'}).format(new Date());\n        if (!quiet) toast('Entwurf gespeichert.');\n      })();\n      try { await saving; } finally { saving = null; }\n    };\n    after(() => {\n      drawBlocks(); preview();\n      $('nl-betreff').addEventListener('input', changed);\n      $('nl-vorschau').addEventListener('input', e => { content2.vorschau = e.target.value; changed(); });\n      content.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { content2.bloecke.push({typ: b.dataset.add}); drawBlocks(); changed(); $('blocks').lastElementChild?.scrollIntoView({behavior: 'smooth', block: 'center'}); }));\n      $('nl-save').addEventListener('click', () => save().catch(failed));\n      $('nl-test').addEventListener('click', async () => { try { await save(true); const r = await api(`/api/newsletter/${current}/test`, {method: 'POST'}); toast('Test-E-Mail gesendet an ' + r.an); } catch (e) { failed(e); } });\n      $('nl-delete').addEventListener('click', async () => {\n        if (!current) { location.hash = '#/newsletter'; return; }\n        if (!await confirmDialog('<h2>Entwurf löschen?</h2><p>Der Entwurf wird endgültig gelöscht.</p>', 'Löschen', true)) return;\n        try { await api('/api/newsletter/' + current, {method: 'DELETE'}); dirty = false; toast('Entwurf gelöscht.'); location.hash = '#/newsletter'; } catch (e) { failed(e); }\n      });\n      $('nl-send').addEventListener('click', async () => {\n        try {\n          if (!$('nl-betreff').value.trim()) throw Error('Bitte zuerst einen Betreff eingeben.');\n          await save(true);\n          const info = await api(`/api/newsletter/${current}/versandinfo`);\n          if (!info.empfaenger) throw Error('Es gibt noch keine bestätigten Newsletter-Empfänger.');\n          const freeToday = Math.max(0, Math.min(info.tageslimit - info.heute, info.monatslimit - info.monat));\n          const days = freeToday >= info.empfaenger ? 0 : Math.ceil((info.empfaenger - freeToday) / Math.max(1, info.tageslimit));\n          const ok = await confirmDialog(`<h2>Newsletter jetzt versenden?</h2><p>Betreff: <b>${esc($('nl-betreff').value)}</b></p>\n            <p style=\"font-size:18px\">Empfänger: <b>${info.empfaenger}</b> bestätigte Abonnent${info.empfaenger === 1 ? '' : 'en'}</p>\n            ${days ? `<p class=\"error\" style=\"background:#fff4d6;color:#7a5200\">Wegen Ihres Versandlimits (${info.tageslimit} pro Tag) wird in Etappen verschickt: heute ${freeToday}, der Rest automatisch in ca. ${days} weiteren Tag${days === 1 ? '' : 'en'}.</p>` : ''}\n            <p class=\"muted\">Haben Sie vorher eine Test-E-Mail angeschaut? Der Versand kann nicht rückgängig gemacht werden.</p>`, `An ${info.empfaenger} Empfänger senden`);\n          if (!ok) return;\n          await api(`/api/newsletter/${current}/senden`, {method: 'POST', body: {empfaenger: info.empfaenger}});\n          dirty = false; toast('Der Versand wurde gestartet.'); location.hash = '#/newsletter/' + current;\n        } catch (e) { failed(e); }\n      });\n      window.onbeforeunload = () => dirty && $('nl-betreff') ? 'Ungespeicherte Änderungen' : undefined;\n    });\n    return `<div class=\"page-head\"><div><a href=\"#/newsletter\">← Newsletter</a><h1>Newsletter erstellen</h1><p class=\"muted\"><span id=\"nl-saved\">${current ? 'Entwurf' : 'Neuer Entwurf'}</span></p></div>\n      <div class=\"actions\"><button class=\"btn\" id=\"nl-save\">💾 Entwurf speichern</button><button class=\"btn\" id=\"nl-test\">✉️ Test-E-Mail an mich</button></div></div>\n      <div class=\"editor\"><div>\n        <div class=\"card\"><label>Betreff *<input id=\"nl-betreff\" maxlength=\"200\" value=\"${esc(n.betreff)}\" placeholder=\"z. B. Neu: Shirts für Ihren Verein\"></label>\n          <label style=\"margin-top:12px\">Vorschautext <span class=\"muted\">(erscheint im Postfach neben dem Betreff)</span><input id=\"nl-vorschau\" maxlength=\"200\" value=\"${esc(n.inhalt.vorschau || '')}\"></label></div>\n        <div class=\"card\"><h2>Inhalt</h2><div id=\"blocks\"></div>\n          <p class=\"muted small\" style=\"margin:10px 0 4px\">Baustein hinzufügen:</p>\n          <div class=\"add-blocks\">${Object.entries(BLOCK_NAMES).map(([k, l]) => `<button class=\"btn btn-small\" type=\"button\" data-add=\"${k}\">+ ${l}</button>`).join('')}</div>\n          <p class=\"hint\">Logo, Kontakt, Absenderangaben und der Abmeldelink werden automatisch in jeden Newsletter eingefügt.</p></div>\n        <div class=\"send-box\"><h2>Versenden</h2><p class=\"small\">Geht nur an bestätigte Abonnenten. Vor dem Versand sehen Sie die Anzahl Empfänger und müssen bestätigen.</p>\n          <div class=\"actions\"><button class=\"btn btn-main\" id=\"nl-send\">📨 Newsletter jetzt versenden</button><button class=\"btn btn-danger\" id=\"nl-delete\">Entwurf löschen</button></div></div>\n      </div>\n      <div class=\"card preview\"><h2>Vorschau</h2><iframe id=\"nl-frame\" title=\"Newsletter-Vorschau\" sandbox=\"\"></iframe></div></div>`;\n  };\n\n  // Einstellungen\n  PAGES.einstellungen = async () => {\n    const d = await api('/api/einstellungen'), e = d.einstellungen, s = d.status;\n    const check = (good, label, note) => `<div class=\"check\">${good ? '<span class=\"badge good\">✓ OK</span>' : '<span class=\"badge bad\">✕ Fehlt</span>'}<span><b>${label}</b>${note ? `<br><span class=\"muted small\">${note}</span>` : ''}</span></div>`;\n    after(() => $('settings-form').addEventListener('submit', async ev => {\n      ev.preventDefault();\n      const body = Object.fromEntries([...new FormData(ev.target).entries()]);\n      try { await api('/api/einstellungen', {method: 'PUT', body}); timeoutMin = Number(body.timeout) || timeoutMin; toast('Einstellungen gespeichert.'); } catch (err) { failed(err); }\n    }));\n    const field = (name, label, type = 'text', note = '') => `<label>${label}<input name=\"${name}\" type=\"${type}\" value=\"${esc(e[name])}\" required>${note ? `<span class=\"hint\">${note}</span>` : ''}</label>`;\n    return `<div class=\"page-head\"><div><h1>Einstellungen</h1><p class=\"muted\">Version ${esc(s.version)}</p></div></div>\n      <div class=\"grid two\">\n        <form class=\"card\" id=\"settings-form\"><h2>Newsletter und Sicherheit</h2><div class=\"grid\">\n          ${field('test_email', 'Test-E-Mails gehen an', 'email')}\n          ${field('absender_name', 'Absendername')}\n          ${field('absender_email', 'Absenderadresse', 'email', 'Muss zur in Resend bestätigten Domain shirtbox.ch gehören.')}\n          ${field('antwort_email', 'Antworten gehen an', 'email')}\n          ${field('adresse', 'Absenderangaben in der Fusszeile', 'text', 'Pflichtangabe: Name und Postadresse.')}\n          <div class=\"row\" style=\"display:grid;grid-template-columns:1fr 1fr;gap:8px\">${field('tageslimit', 'Max. Newsletter-Mails pro Tag', 'number')}${field('monatslimit', 'Max. pro Monat', 'number')}</div>\n          <p class=\"hint\" style=\"margin-top:-4px\">Resend Gratis: 100 Mails/Tag und 3000/Monat insgesamt – inklusive Bestellmails. Deshalb Standard 80/2500. Mit Resend Pro z. B. 5000/50000 eintragen.</p>\n          ${field('timeout', 'Automatisch abmelden nach (Minuten ohne Aktivität)', 'number')}\n          <button class=\"btn btn-main\" type=\"submit\">Speichern</button></div></form>\n        <div class=\"card\"><h2>Systemprüfung</h2>\n          ${check(s.datenbank, 'Datenbank (D1)')}${check(s.bilder, 'Bildspeicher (R2)', 'für Designbilder und Newsletter-Bilder')}${check(s.resend, 'Resend-Schlüssel', 'für Test- und Newsletter-Versand')}\n          ${check(s.access, 'Cloudflare Access', s.access ? 'Zusätzlicher Schutz vor der Anmeldeseite ist aktiv.' : 'Empfohlen: ACCESS_TEAM_DOMAIN und ACCESS_AUD eintragen.')}\n          ${check(!!s.letzter_lauf, 'Automatischer Versand (Cron)', s.letzter_lauf ? 'Zuletzt gelaufen: ' + time(s.letzter_lauf) : 'Cron-Trigger */15 * * * * einrichten.')}\n          <p class=\"small\" style=\"margin-top:12px\">Newsletter-Mails heute: <b>${s.heute_gesendet}</b> von ${s.tageslimit} · diesen Monat: <b>${s.monat_gesendet}</b> von ${s.monatslimit}</p></div>\n      </div>\n      <div class=\"grid two\">\n        <div class=\"card\"><h2>Daten exportieren</h2><p class=\"muted small\">CSV-Dateien öffnen sich direkt in Excel. Bitte sicher aufbewahren – sie enthalten Personendaten.</p><div class=\"actions\"><a class=\"btn\" href=\"/api/export/kunden.csv\">⬇ Kunden</a><a class=\"btn\" href=\"/api/export/bestellungen.csv\">⬇ Bestellungen</a><a class=\"btn\" href=\"/api/export/abonnenten.csv\">⬇ Newsletter-Abonnenten</a></div>\n          <h3 style=\"margin-top:18px\">Datensicherung</h3><p class=\"small muted\">Cloudflare D1 sichert die Datenbank automatisch und kann sie bis zu 30 Tage zurück wiederherstellen („Time Travel“). Zusätzlich empfehlen wir, monatlich die drei Exporte herunterzuladen.</p></div>\n        <div class=\"card\"><h2>Protokoll</h2><p class=\"muted small\">Letzte Aktionen (ohne Kundendaten).</p><div class=\"table-wrap\"><table><tbody>${d.protokoll.map(p => `<tr><td class=\"small\" style=\"white-space:nowrap\">${time(p.zeit)}</td><td class=\"small\">${esc(p.aktion)}</td></tr>`).join('') || '<tr><td class=\"muted\">Noch keine Einträge.</td></tr>'}</tbody></table></div></div>\n      </div>`;\n  };\n\n  // Bausteine für die Buchhaltung (buchhaltung.js wird von bauen.ps1 direkt dahinter angehängt und läuft vor dem ersten Seitenaufbau).\n  window.ShirtboxAdmin = {PAGES, TITLES, api, esc, chf, money, date, time, kpi, badge, options, pager, bindFilters, bindPager, query, after, toast, failed, confirmDialog, render, content, $, STATUS, ZAHLUNG};\n\n  // ---- Start ----\n  fetch('/api/sitzung', {headers: {'X-ShirtBOX': '1'}, credentials: 'same-origin'}).then(r => r.json().then(d => ({ok: r.ok, d}))).then(({ok, d}) => {\n    if (!ok) { showLogin(d.error); return; }\n    timeoutMin = d.timeout || 30;\n    if (d.angemeldet) showApp(); else showLogin();\n  }).catch(() => showLogin('Der Server ist nicht erreichbar.'));\n})();\n\n// ShirtBOX Verwaltung – Buchhaltung (vereinfachte Einnahmen-/Ausgabenrechnung). Nutzt die Bausteine aus admin.js (window.ShirtboxAdmin).\n(() => {\n  'use strict';\n  const A = window.ShirtboxAdmin; if (!A) return;\n  const {PAGES, TITLES, api, esc, chf, date, time, kpi, badge, pager, bindFilters, bindPager, query, after, toast, failed, confirmDialog, render, content, $, STATUS, ZAHLUNG} = A;\n  const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Zurich'}).format(new Date());\n  const amount = r => ((Number(r) || 0) / 100).toFixed(2); // für Eingabefelder\n  const ZAHLUNGSARTEN = ['TWINT', 'Banküberweisung', 'Bar', 'Kreditkarte', 'Sonstige'];\n  const ZUSTAND = {offen: ['Offen', 'warn'], teilweise: ['Teilweise bezahlt', 'info'], bezahlt: ['Bezahlt', 'good'], ueberfaellig: ['Überfällig', 'bad'], rueckerstattet: ['Rückerstattet', 'bad'], storniert: ['Storniert', ''], gutschrift: ['Gutschrift', 'accent'], gebucht: ['Gebucht', 'good']};\n  const KOSTEN = {textilien: 'T-Shirts (Einkauf)', druck: 'Druck', verpackung: 'Verpackung', versand: 'Versand', gebuehren: 'Zahlungsgebühren', sonstiges: 'Weitere direkte Kosten'};\n  const opt = (list, sel) => list.map(([v, l]) => `<option value=\"${esc(v)}\"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');\n  const SIMPLE = '<p class=\"bh-note\">Vereinfachte Einnahmen-/Ausgabenrechnung (OR 957 Abs. 2) – keine doppelte Buchhaltung mit Kontenplan, Bilanz und Erfolgsrechnung. Alle Beträge in CHF.</p>';\n\n  // Navigation: eigene Seiten, Titel und aktiver Menüpunkt (die Untermenü-Links tragen data-nav).\n  Object.assign(TITLES, {'bh-uebersicht': 'Buchhaltung · Übersicht', 'bh-einnahmen': 'Buchhaltung · Einnahmen', 'bh-ausgaben': 'Buchhaltung · Ausgaben', 'bh-rechnungen': 'Buchhaltung · Rechnungen',\n    'bh-belege': 'Buchhaltung · Belege', 'bh-zahlungen': 'Buchhaltung · Zahlungen', 'bh-lieferanten': 'Buchhaltung · Lieferanten', 'bh-auswertungen': 'Buchhaltung · Auswertungen', 'bh-einstellungen': 'Buchhaltung · Einstellungen'});\n  const quick = `<div class=\"actions bh-quick no-print\"><button class=\"btn btn-main\" data-quick=\"einnahme\">＋ Neue Einnahme</button><button class=\"btn btn-main\" data-quick=\"ausgabe\">＋ Neue Ausgabe</button><button class=\"btn\" data-quick=\"beleg\">⬆ Beleg hochladen</button><a class=\"btn\" href=\"#/bh-rechnungen/neu\">🧾 Rechnung erstellen</a><a class=\"btn\" href=\"#/bh-auswertungen\">⬇ Bericht exportieren</a></div>`;\n  content.addEventListener('click', e => {\n    const q = e.target.closest('[data-quick]'); if (!q) return;\n    if (q.dataset.quick === 'ausgabe') expenseForm(null, render);\n    if (q.dataset.quick === 'einnahme') incomeForm(null, render);\n    if (q.dataset.quick === 'beleg') uploadOnly(render);\n  });\n\n  // ---- Formular-Dialog: bleibt bei Fehlern offen und zeigt die Meldung direkt im Dialog ----\n  function formDialog(title, body, okLabel, save, wide) {\n    return new Promise(resolve => {\n      const dialog = $('dialog');\n      dialog.classList.toggle('wide', !!wide);\n      $('dialog-body').innerHTML = `<h2>${esc(title)}</h2>${body}<p class=\"error\" id=\"bh-dialog-error\" hidden></p>`;\n      $('dialog-body').oninput = null;\n      $('dialog-actions').innerHTML = `<button class=\"btn\" value=\"nein\" type=\"submit\" formnovalidate>Abbrechen</button>${okLabel ? `<button class=\"btn btn-main\" type=\"button\" id=\"bh-dialog-save\">${esc(okLabel)}</button>` : ''}`;\n      dialog.onclose = () => { dialog.classList.remove('wide'); resolve(dialog.returnValue === 'ja'); };\n      dialog.returnValue = '';\n      const btn = $('bh-dialog-save');\n      btn?.addEventListener('click', async () => {\n        btn.disabled = true; const err = $('bh-dialog-error'); err.hidden = true;\n        try { await save(); dialog.close('ja'); }\n        catch (e) { if (e.message !== 'abgemeldet') { err.textContent = e.message; err.hidden = false; } }\n        btn.disabled = false;\n      });\n      dialog.showModal();\n    });\n  }\n  const val = id => ($(id)?.value ?? '').trim();\n  async function lists() {\n    const [e, l] = await Promise.all([api('/api/bh/einstellungen'), api('/api/bh/lieferanten')]);\n    return {s: e.einstellungen, kat: e.kategorien, lief: l.lieferanten};\n  }\n  // Beleg-Feld in Formularen: lädt sofort hoch und merkt sich die Belegnummer.\n  const receiptField = (current, name) => `<div class=\"bh-receipt\"><input type=\"hidden\" id=\"f-beleg\" value=\"${esc(current || '')}\"><span id=\"f-beleg-name\" class=\"small\">${current ? `📎 ${esc(name || 'Beleg B-' + String(current).padStart(5, '0'))}` : 'Kein Beleg verknüpft'}</span>\n    <label class=\"btn btn-small\">⬆ Beleg hochladen<input type=\"file\" id=\"f-beleg-datei\" accept=\"application/pdf,image/jpeg,image/png\" hidden></label>${current ? '<button type=\"button\" class=\"btn btn-small\" id=\"f-beleg-weg\">Lösen</button>' : ''}</div><p class=\"hint\">PDF, JPG oder PNG, höchstens 10 MB.</p>`;\n  function bindReceipt() {\n    $('f-beleg-datei')?.addEventListener('change', async e => {\n      const file = e.target.files[0]; if (!file) return;\n      if (file.size > 10 * 1024 * 1024) { $('f-beleg-name').textContent = '⚠ Die maximale Grösse von 10 MB ist überschritten.'; return; }\n      $('f-beleg-name').textContent = 'Wird hochgeladen …';\n      try { const r = await upload(file); $('f-beleg').value = r.id; $('f-beleg-name').textContent = `📎 ${r.dateiname} (${r.ref})${r.doppelt ? ' – war schon vorhanden, wurde verknüpft' : ''}`; }\n      catch (err) { $('f-beleg-name').textContent = '⚠ ' + err.message; }\n    });\n    $('f-beleg-weg')?.addEventListener('click', () => { $('f-beleg').value = ''; $('f-beleg-name').textContent = 'Kein Beleg verknüpft'; });\n  }\n  async function upload(file, notiz) { const form = new FormData(); form.append('datei', file); if (notiz) form.append('notiz', notiz); return api('/api/bh/belege', {method: 'POST', body: form}); }\n  function uploadOnly(done) {\n    formDialog('Beleg hochladen', `<label>Datei (PDF, JPG oder PNG, höchstens 10 MB)<input type=\"file\" id=\"u-datei\" accept=\"application/pdf,image/jpeg,image/png\"></label><label>Notiz (optional)<input id=\"u-notiz\" placeholder=\"z. B. Quittung Post Versand\"></label>\n      <p class=\"hint\">Tipp: Belege für Ausgaben lädst du am einfachsten direkt beim Erfassen der Ausgabe hoch – dann sind sie gleich verknüpft.</p>`, 'Hochladen', async () => {\n      const file = $('u-datei').files[0]; if (!file) throw Error('Bitte eine Datei wählen.');\n      if (file.size > 10 * 1024 * 1024) throw Error('Die maximale Grösse von 10 MB ist überschritten.');\n      const r = await upload(file, val('u-notiz')); toast(r.doppelt ? `Dieser Beleg war schon vorhanden (${r.ref}).` : `Beleg ${r.ref} gespeichert.`);\n    }).then(ok => ok && done && done());\n  }\n  function stornoDialog(what, url, done) {\n    formDialog(`${what} stornieren?`, `<p>Die Buchung bleibt zur Nachvollziehbarkeit erhalten, zählt aber nicht mehr. Für eine Korrektur danach einfach neu erfassen.</p><label>Grund (Pflicht)<input id=\"s-grund\" placeholder=\"z. B. Doppelt erfasst, falscher Betrag\"></label>`, 'Stornieren', async () => {\n      if (!val('s-grund')) throw Error('Bitte einen Grund angeben.');\n      await api(url, {method: 'POST', body: {grund: val('s-grund')}}); toast('Storniert.');\n    }).then(ok => ok && done());\n  }\n\n  // ---- Diagramm: Einnahmen und Ausgaben pro Monat (zwei Reihen) ----\n  function chart2(el, punkte) {\n    const draw = () => {\n      const W = Math.max(280, el.clientWidth), H = 260, padL = 50, padB = 26, padT = 12, innerW = W - padL - 6, innerH = H - padB - padT;\n      const max = Math.max(...punkte.flatMap(p => [p.einnahmen, p.ausgaben]), 0), stepRaw = (max || 10000) / 4, mag = Math.pow(10, Math.floor(Math.log10(stepRaw)));\n      const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= stepRaw), top = step * 4, slot = innerW / punkte.length, bw = Math.max(3, Math.min(16, slot / 2 - 3));\n      const y = v => padT + innerH - (v / top) * innerH, short = v => { v /= 100; return v >= 1000 ? `${(v / 1000).toLocaleString('de-CH', {maximumFractionDigits: 1})}k` : String(Math.round(v)); };\n      const label = p => new Intl.DateTimeFormat('de-CH', {month: 'short', timeZone: 'UTC'}).format(new Date(p.periode + '-01T12:00:00Z'));\n      let svg = `<svg viewBox=\"0 0 ${W} ${H}\" role=\"img\" aria-label=\"Einnahmen und Ausgaben der letzten zwölf Monate\">`;\n      for (let i = 0; i <= 4; i++) svg += `<line class=\"grid-line\" x1=\"${padL}\" x2=\"${W - 6}\" y1=\"${y(step * i)}\" y2=\"${y(step * i)}\"/><text class=\"axis\" x=\"${padL - 8}\" y=\"${y(step * i) + 4}\" text-anchor=\"end\">${short(step * i)}</text>`;\n      punkte.forEach((p, i) => {\n        const x = padL + slot * i + slot / 2;\n        for (const [k, cls, dx] of [['einnahmen', 'bar', -bw - 1], ['ausgaben', 'bar bar-out', 1]]) {\n          const h = Math.max(0, padT + innerH - y(p[k])); if (h > 0) svg += `<rect class=\"${cls}\" x=\"${x + dx}\" y=\"${y(p[k])}\" width=\"${bw}\" height=\"${h}\" rx=\"2\"><title>${label(p)}: ${k === 'einnahmen' ? 'Einnahmen' : 'Ausgaben'} ${chf(p[k])}</title></rect>`;\n        }\n        if (punkte.length <= 12 || i % 2 === 0) svg += `<text class=\"axis\" x=\"${x}\" y=\"${H - 6}\" text-anchor=\"middle\">${esc(label(p))}</text>`;\n      });\n      el.innerHTML = svg + `<line x1=\"${padL}\" x2=\"${W - 6}\" y1=\"${padT + innerH}\" y2=\"${padT + innerH}\" stroke=\"#c9c3b6\"/></svg>`;\n    };\n    el._w = el.clientWidth; draw();\n    const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } if (Math.abs(el.clientWidth - el._w) > 8) { el._w = el.clientWidth; draw(); } });\n    ro.observe(el);\n  }\n  const bars = (rows, labelKey = 'name') => { const max = Math.max(...rows.map(r => Number(r.summe) || 0), 1); return rows.length ? `<div class=\"bh-bars\">${rows.map(r => `<div class=\"bh-bar\"><span>${esc(r[labelKey])}</span><i style=\"width:${Math.max(2, (Number(r.summe) || 0) / max * 100)}%\"></i><b>${chf(r.summe)}</b></div>`).join('')}</div>` : '<p class=\"empty\">Keine Daten im gewählten Zeitraum.</p>'; };\n\n  // ---- Übersicht ----\n  const ovState = {zeitraum: 'monat', von: '', bis: ''};\n  const PERIODS = {heute: 'Heute', woche: 'Diese Woche', monat: 'Dieser Monat', jahr: 'Dieses Geschäftsjahr', eigen: 'Zeitraum wählen'};\n  PAGES['bh-uebersicht'] = async () => {\n    const d = await api('/api/bh/uebersicht?' + query(ovState)), p = d.periode, m = d.monat, j = d.jahr;\n    after(() => {\n      chart2($('bh-chart'), d.verlauf);\n      content.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => { ovState.zeitraum = b.dataset.period; if (ovState.zeitraum !== 'eigen') render(); else $('bh-eigen').hidden = false; }));\n      $('bh-eigen-ok').addEventListener('click', () => { ovState.von = val('bh-von'); ovState.bis = val('bh-bis'); ovState.zeitraum = 'eigen'; render(); });\n    });\n    const sign = v => `<b class=\"${v < 0 ? 'neg' : 'pos'}\">${chf(v)}</b>`;\n    return `<div class=\"page-head\"><div><h1>Buchhaltung</h1>${SIMPLE}</div></div>${quick}\n      <div class=\"grid kpis\">\n        ${kpi('Einnahmen diesen Monat', chf(m.einnahmen), 'tatsächlich eingegangen')}${kpi('Ausgaben diesen Monat', chf(m.ausgaben))}${kpi('Ergebnis diesen Monat', sign(m.ergebnis), 'Einnahmen − Ausgaben', 'highlight')}\n        ${kpi('Offene Kundenzahlungen', chf(d.offen.summe), `${d.offen.anzahl} Bestellung${d.offen.anzahl === 1 ? '' : 'en'} · <a href=\"#/bh-zahlungen\">ansehen</a>`)}\n        ${kpi('Überfällig', chf(d.ueberfaellig.summe), `${d.ueberfaellig.anzahl} Bestellung${d.ueberfaellig.anzahl === 1 ? '' : 'en'}`, d.ueberfaellig.anzahl ? 'alert' : '')}\n        ${kpi('Bezahlte Bestellungen', p.bezahlte_bestellungen, PERIODS[d.zeitraum.zeitraum])}\n        ${kpi('Umsatz Geschäftsjahr', chf(j.umsatz), `Bestellwert seit ${date(d.gj_start)}`)}${kpi('Ergebnis Geschäftsjahr', sign(j.ergebnis), `Einnahmen ${chf(j.einnahmen)} − Ausgaben ${chf(j.ausgaben)}`)}\n      </div>\n      <div class=\"card\"><h2>Zeitraum <span class=\"seg\">${Object.entries(PERIODS).map(([k, l]) => `<button type=\"button\" data-period=\"${k}\" class=\"${d.zeitraum.zeitraum === k ? 'on' : ''}\">${l}</button>`).join('')}</span></h2>\n        <div class=\"filters\" id=\"bh-eigen\"${d.zeitraum.zeitraum === 'eigen' ? '' : ' hidden'}><label>Von<input type=\"date\" id=\"bh-von\" value=\"${esc(ovState.von)}\"></label><label>Bis<input type=\"date\" id=\"bh-bis\" value=\"${esc(ovState.bis)}\"></label><button class=\"btn\" id=\"bh-eigen-ok\" type=\"button\">Anzeigen</button></div>\n        <p class=\"muted small\">${date(d.zeitraum.von)} – ${date(d.zeitraum.bis)}</p>\n        <div class=\"grid kpis\">${kpi('Einnahmen', chf(p.einnahmen))}${kpi('Ausgaben', chf(p.ausgaben))}${kpi('Ergebnis', sign(p.ergebnis), '', 'highlight')}${kpi('Umsatz (Bestellwert)', chf(p.umsatz), 'nach Bestelldatum, nach Gutschriften')}</div></div>\n      <div class=\"grid two\">\n        <div class=\"card\"><h2>Einnahmen und Ausgaben – letzte 12 Monate</h2><p class=\"bh-legend\"><i class=\"in\"></i>Einnahmen <i class=\"out\"></i>Ausgaben</p><div class=\"chart\" id=\"bh-chart\"></div>\n          <details class=\"table-view\"><summary>Werte als Tabelle anzeigen</summary><div class=\"table-wrap\"><table><thead><tr><th>Monat</th><th class=\"num\">Einnahmen</th><th class=\"num\">Ausgaben</th><th class=\"num\">Ergebnis</th></tr></thead><tbody>${d.verlauf.slice().reverse().map(r => `<tr><td>${r.periode.split('-').reverse().join('.')}</td><td class=\"num\">${chf(r.einnahmen)}</td><td class=\"num\">${chf(r.ausgaben)}</td><td class=\"num\">${chf(r.einnahmen - r.ausgaben)}</td></tr>`).join('')}</tbody></table></div></details></div>\n        <div class=\"card\"><h2>Ausgaben nach Kategorie</h2><p class=\"muted small\">${PERIODS[d.zeitraum.zeitraum]}</p>${bars(d.kategorien)}</div>\n      </div>\n      ${d.ueberfaellig.liste.length ? `<div class=\"card\"><h2>Überfällige Zahlungen <a class=\"btn btn-small\" href=\"#/bh-zahlungen\">Alle Zahlungen</a></h2><div class=\"table-wrap\"><table><thead><tr><th>Bestellung</th><th>Kunde</th><th>Fällig seit</th><th class=\"num\">Offen</th></tr></thead><tbody>\n        ${d.ueberfaellig.liste.map(o => `<tr class=\"click\" data-href=\"#/bestellungen/${o.id}\"><td><b>${esc(o.bestellnummer)}</b></td><td>${esc(o.vorname)} ${esc(o.nachname)}</td><td>${date(o.faellig)}</td><td class=\"num\">${chf(o.offen)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}\n      ${Number(d.offene_ausgaben.n) ? `<div class=\"card\"><p>⏳ <b>${d.offene_ausgaben.n} Ausgabe${d.offene_ausgaben.n === 1 ? '' : 'n'}</b> noch nicht bezahlt (${chf(d.offene_ausgaben.summe)}). <a href=\"#/bh-ausgaben/?zahlung=offen\">Ansehen</a></p></div>` : ''}`;\n  };\n\n  // ---- Ausgaben ----\n  const exState = {q: '', von: '', bis: '', kategorie: '', lieferant: '', zahlung: '', storniert: '', seite: 1};\n  async function expenseForm(id, done) {\n    let s, kat, lief, cur;\n    try { [{s, kat, lief}, cur] = await Promise.all([lists(), id ? api('/api/bh/ausgaben/' + id) : null]); } catch (e) { failed(e); return; }\n    const a = cur?.ausgabe || {datum: today(), zahlung: 'bezahlt', zahlungsart: 'TWINT', mwst_satz: s.bh_mwst_standard, wiederkehrend: ''};\n    const pflichtig = s.bh_mwst_pflichtig === '1', saetze = ['0', ...s.bh_mwst_saetze.split(/,\\s*/)];\n    const body = `<div class=\"form-grid\">\n      <label>Datum<input type=\"date\" id=\"f-datum\" value=\"${esc(a.datum)}\" required></label>\n      <label>Betrag in CHF${pflichtig ? ' (brutto, inkl. MWST)' : ''}<input id=\"f-betrag\" inputmode=\"decimal\" value=\"${a.brutto_rappen ? amount(a.brutto_rappen) : ''}\" placeholder=\"z. B. 129.90\" required></label>\n      <label class=\"span\">Beschreibung<input id=\"f-beschreibung\" value=\"${esc(a.beschreibung || '')}\" placeholder=\"z. B. 50 Polo-Shirts Grösse M\" required></label>\n      <label>Kategorie<select id=\"f-kategorie\"><option value=\"\">Bitte wählen …</option>${opt(kat.filter(k => k.art === 'ausgabe' && (k.aktiv || k.id === a.kategorie_id)).map(k => [k.id, k.name]), a.kategorie_id)}</select></label>\n      <label>Lieferant<select id=\"f-lieferant\"><option value=\"\">– ohne –</option>${opt(lief.map(l => [l.id, l.name]), a.lieferant_id)}</select></label>\n      ${pflichtig ? `<label>MWST-Satz (Vorsteuer)<select id=\"f-mwst\">${opt(saetze.map(v => [v, v + ' %']), String(a.mwst_satz ?? s.bh_mwst_standard))}</select></label><p class=\"hint span\" id=\"f-mwst-info\"></p>` : ''}\n      <label>Zahlungsart<select id=\"f-zahlungsart\">${opt(ZAHLUNGSARTEN.map(z => [z, z]), a.zahlungsart)}</select></label>\n      <label>Zahlungsstatus<select id=\"f-zahlung\">${opt([['bezahlt', 'Bezahlt'], ['offen', 'Noch offen']], a.zahlung)}</select></label>\n      <label>Bezahlt am<input type=\"date\" id=\"f-bezahlt\" value=\"${esc(a.bezahlt_am || '')}\"></label>\n      ${a.vorlage_id ? '<p class=\"hint span\">Automatisch aus einer wiederkehrenden Ausgabe erfasst.</p>' : `<label>Wiederkehrend<select id=\"f-wiederkehrend\">${opt([['', 'Nein, einmalig'], ['monatlich', 'Jeden Monat'], ['jaehrlich', 'Jedes Jahr']], a.wiederkehrend)}</select></label>`}\n      <div class=\"span\">${receiptField(a.beleg_id, a.beleg_name)}</div>\n      <label class=\"span\">Interne Notiz<textarea id=\"f-notiz\" rows=\"2\">${esc(a.notiz || '')}</textarea></label></div>\n      ${pflichtig ? '' : '<p class=\"hint\">ShirtBOX ist nicht MWST-pflichtig – Beträge werden ohne Vorsteuer erfasst (in den Einstellungen umschaltbar).</p>'}`;\n    const done2 = formDialog(id ? `Ausgabe ${a.ref} bearbeiten` : 'Neue Ausgabe', body, 'Speichern', async () => {\n      const data = {datum: val('f-datum'), betrag: val('f-betrag'), beschreibung: val('f-beschreibung'), kategorie_id: val('f-kategorie'), lieferant_id: val('f-lieferant'), mwst_satz: pflichtig ? val('f-mwst') : '0',\n        zahlungsart: val('f-zahlungsart'), zahlung: val('f-zahlung'), bezahlt_am: val('f-bezahlt'), wiederkehrend: $('f-wiederkehrend') ? val('f-wiederkehrend') : '', beleg_id: val('f-beleg'), notiz: val('f-notiz')};\n      if (id) await api('/api/bh/ausgaben/' + id, {method: 'PUT', body: data}); else { const r = await api('/api/bh/ausgaben', {method: 'POST', body: data}); toast(`Ausgabe ${r.ref} gespeichert.`); }\n    }, true);\n    bindReceipt();\n    if (pflichtig) { const info = () => { const b = Number(val('f-betrag').replace(/[’'\\s]/g, '').replace(',', '.')) || 0, sz = Number(val('f-mwst')) || 0, m = Math.round(b * 100 * sz * 100 / (10000 + sz * 100)); $('f-mwst-info').textContent = `Netto ${chf(b * 100 - m)} · MWST ${chf(m)} · Brutto ${chf(b * 100)}`; }; $('f-betrag').addEventListener('input', info); $('f-mwst').addEventListener('change', info); info(); }\n    if ((await done2) && done) done();\n  }\n  PAGES['bh-ausgaben'] = async id => {\n    if (id && id.startsWith('?')) { const p = new URLSearchParams(id); for (const k of ['zahlung', 'lieferant', 'kategorie']) if (p.has(k)) exState[k] = p.get(k); }\n    const {kat, lief} = await lists();\n    const load = async () => {\n      const d = await api('/api/bh/ausgaben?' + query(exState));\n      $('bh-liste').innerHTML = (d.ausgaben.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Datum</th><th>Beleg-Nr.</th><th>Beschreibung</th><th class=\"hide-mobile\">Lieferant</th><th class=\"hide-mobile\">Kategorie</th><th class=\"num\">Betrag</th><th>Zahlung</th><th></th></tr></thead><tbody>\n        ${d.ausgaben.map(a => `<tr class=\"${a.storniert ? 'bh-storno' : ''}\"><td>${date(a.datum)}</td><td class=\"small\">${a.ref}${a.beleg_id ? ` <a href=\"#\" data-preview=\"${a.beleg_id}\" title=\"${esc(a.beleg_name || 'Beleg')}\">📎</a>` : ' <span class=\"muted\" title=\"Kein Beleg\">–</span>'}</td>\n          <td><b>${esc(a.beschreibung)}</b>${a.wiederkehrend ? ` <span class=\"badge info\">${a.wiederkehrend === 'monatlich' ? 'monatlich' : 'jährlich'}</span>` : ''}${a.storniert ? `<br><span class=\"small\">Storniert: ${esc(a.storno_grund)}</span>` : ''}</td>\n          <td class=\"hide-mobile\">${esc(a.lieferant || '–')}</td><td class=\"hide-mobile small\">${esc(a.kategorie)}</td><td class=\"num\">${chf(a.brutto_rappen)}${a.mwst_rappen ? `<br><span class=\"muted small\">MWST ${chf(a.mwst_rappen)}</span>` : ''}</td>\n          <td>${a.storniert ? badge(ZUSTAND, 'storniert') : badge(ZUSTAND, a.zahlung)}<br><span class=\"muted small\">${esc(a.zahlungsart || '')}</span></td>\n          <td class=\"num\">${a.storniert ? '' : `<button class=\"btn btn-small\" data-edit=\"${a.id}\">Bearbeiten</button> <button class=\"btn btn-small btn-danger\" data-storno=\"${a.id}\" title=\"Stornieren\">✕</button>`}</td></tr>`).join('')}\n        </tbody></table></div>${pager(d.total, exState.seite)}<p class=\"muted small\">Summe (ohne Stornos): <b>${chf(d.summe)}</b></p>` : '<p class=\"empty\">Keine Ausgaben gefunden. Mit „＋ Neue Ausgabe“ erfassen.</p>')\n        + (d.vorlagen ? `<p class=\"small\" style=\"margin-top:12px\">🔁 ${d.vorlagen} wiederkehrende Ausgabe(n) hinterlegt. <button class=\"btn btn-small\" id=\"bh-wk\">Für ${new Intl.DateTimeFormat('de-CH', {month: 'long', year: 'numeric'}).format(new Date())} erfassen</button></p>` : '');\n      bindPager($('bh-liste'), exState, load);\n      $('bh-liste').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => expenseForm(b.dataset.edit, load)));\n      $('bh-liste').querySelectorAll('[data-storno]').forEach(b => b.addEventListener('click', () => stornoDialog('Ausgabe', `/api/bh/ausgaben/${b.dataset.storno}/storno`, load)));\n      $('bh-wk')?.addEventListener('click', async () => { try { const r = await api('/api/bh/ausgaben/wiederkehrend', {method: 'POST', body: {monat: today().slice(0, 7)}}); toast(r.neu ? `${r.neu} Ausgabe(n) erfasst (Status: offen).` : 'Für diesen Monat ist schon alles erfasst.'); load(); } catch (e) { failed(e); } });\n    };\n    after(() => { bindFilters(exState, load); load().catch(failed); });\n    const exp = `/api/bh/export/ausgaben.csv?${query({von: exState.von, bis: exState.bis})}`;\n    return `<div class=\"page-head\"><div><h1>Ausgaben</h1><p class=\"muted\">Stornieren statt löschen: Stornierte Ausgaben bleiben sichtbar, zählen aber nicht.</p></div><div class=\"actions\"><a class=\"btn\" href=\"${exp}\">⬇ Excel/CSV</a><button class=\"btn btn-main\" data-quick=\"ausgabe\">＋ Neue Ausgabe</button></div></div>\n      <div class=\"card\"><div class=\"filters\">\n        <label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(exState.q)}\" placeholder=\"Beschreibung, Lieferant oder Notiz\"></label>\n        <label>Von<input type=\"date\" data-filter=\"von\" value=\"${esc(exState.von)}\"></label><label>Bis<input type=\"date\" data-filter=\"bis\" value=\"${esc(exState.bis)}\"></label>\n        <label>Kategorie<select data-filter=\"kategorie\"><option value=\"\">Alle</option>${opt(kat.filter(k => k.art === 'ausgabe').map(k => [k.id, k.name]), exState.kategorie)}</select></label>\n        <label>Lieferant<select data-filter=\"lieferant\"><option value=\"\">Alle</option>${opt(lief.map(l => [l.id, l.name]), exState.lieferant)}</select></label>\n        <label>Zahlung<select data-filter=\"zahlung\"><option value=\"\">Alle</option>${opt([['bezahlt', 'Bezahlt'], ['offen', 'Offen']], exState.zahlung)}</select></label>\n        <label>Stornierte<select data-filter=\"storniert\">${opt([['', 'ausblenden'], ['1', 'anzeigen']], exState.storniert)}</select></label>\n      </div><div id=\"bh-liste\"><p class=\"loading\">Wird geladen …</p></div></div>`;\n  };\n\n  // ---- Einnahmen ----\n  const inState = {q: '', von: '', bis: '', zahlungsart: '', quelle: '', storniert: '', seite: 1};\n  async function incomeForm(id, done, current) {\n    const {kat} = await lists().catch(e => { failed(e); return {}; }); if (!kat) return;\n    const e = current || {datum: today(), zahlungsart: 'TWINT'};\n    const body = `<p class=\"hint\">Zahlungen zu Bestellungen bitte unter <a href=\"#/bh-zahlungen\">Zahlungen</a> erfassen – sie erscheinen hier automatisch. Hier nur andere Einnahmen (z. B. Barverkauf am Turnier).</p><div class=\"form-grid\">\n      <label>Datum<input type=\"date\" id=\"f-datum\" value=\"${esc(e.datum)}\"></label><label>Betrag in CHF<input id=\"f-betrag\" inputmode=\"decimal\" value=\"${e.betrag_rappen ? amount(e.betrag_rappen) : ''}\" placeholder=\"z. B. 89.00\"></label>\n      <label class=\"span\">Beschreibung<input id=\"f-beschreibung\" value=\"${esc(e.beschreibung || '')}\"></label>\n      <label>Kunde (optional)<input id=\"f-kunde\" value=\"${esc(e.kunde || '')}\"></label>\n      <label>Kategorie<select id=\"f-kategorie\"><option value=\"\">Bitte wählen …</option>${opt(kat.filter(k => k.art === 'einnahme' && (k.aktiv || k.id === e.kategorie_id)).map(k => [k.id, k.name]), e.kategorie_id)}</select></label>\n      <label>Zahlungsart<select id=\"f-zahlungsart\">${opt(ZAHLUNGSARTEN.map(z => [z, z]), e.zahlungsart)}</select></label>\n      <label>Bestellnummer (optional)<input id=\"f-bestellung\" value=\"${esc(e.bestellnummer || '')}\" placeholder=\"SB-…\"></label>\n      <div class=\"span\">${receiptField(e.beleg_id, e.beleg_name)}</div><label class=\"span\">Interne Notiz<textarea id=\"f-notiz\" rows=\"2\">${esc(e.notiz || '')}</textarea></label></div>`;\n    const p = formDialog(id ? `Einnahme ${e.ref} bearbeiten` : 'Neue Einnahme', body, 'Speichern', async () => {\n      const data = {datum: val('f-datum'), betrag: val('f-betrag'), beschreibung: val('f-beschreibung'), kunde: val('f-kunde'), kategorie_id: val('f-kategorie'), zahlungsart: val('f-zahlungsart'), bestellnummer: val('f-bestellung'), beleg_id: val('f-beleg'), notiz: val('f-notiz')};\n      if (id) await api('/api/bh/einnahmen/' + id, {method: 'PUT', body: data}); else { const r = await api('/api/bh/einnahmen', {method: 'POST', body: data}); toast(`Einnahme ${r.ref} gespeichert.`); }\n    }, true);\n    bindReceipt();\n    if ((await p) && done) done();\n  }\n  PAGES['bh-einnahmen'] = async () => {\n    let rows = [];\n    const load = async () => {\n      const d = await api('/api/bh/einnahmen?' + query(inState)); rows = d.einnahmen;\n      $('bh-liste').innerHTML = rows.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Datum</th><th>Beleg-Nr.</th><th>Beschreibung</th><th class=\"hide-mobile\">Kunde</th><th class=\"hide-mobile\">Kategorie</th><th class=\"num\">Betrag</th>${d.einnahmen.some(x => x.mwst_rappen) ? '<th class=\"num hide-mobile\">MWST</th>' : ''}<th class=\"hide-mobile\">Zahlungsart</th><th>Status</th><th></th></tr></thead><tbody>\n        ${rows.map((x, i) => `<tr class=\"${x.status === 'storniert' ? 'bh-storno' : ''}\"><td>${date(x.datum)}</td><td class=\"small\">${x.ref}${x.beleg_id ? ` <a href=\"#\" data-preview=\"${x.beleg_id}\">📎</a>` : ''}</td>\n          <td><b>${esc(x.beschreibung)}</b>${x.quelle === 'bestellung' ? ` <a class=\"badge accent\" href=\"#/bestellungen/${x.bestellung_id}\" title=\"Automatisch aus der Bestellung übernommen\">🔗 aus Bestellung</a>` : ''}${x.storno_grund ? `<br><span class=\"small\">Storniert: ${esc(x.storno_grund)}</span>` : ''}</td>\n          <td class=\"hide-mobile\">${esc(x.kunde || '–')}</td><td class=\"hide-mobile small\">${esc(x.kategorie || '')}</td><td class=\"num\"><span class=\"${x.betrag_rappen < 0 ? 'neg' : ''}\">${chf(x.betrag_rappen)}</span></td>${d.einnahmen.some(r => r.mwst_rappen) ? `<td class=\"num hide-mobile\">${chf(x.mwst_rappen)}</td>` : ''}\n          <td class=\"hide-mobile\">${esc(x.zahlungsart || '')}</td><td>${badge(ZUSTAND, x.status)}</td>\n          <td class=\"num\">${x.quelle === 'manuell' && x.status !== 'storniert' ? `<button class=\"btn btn-small\" data-edit=\"${i}\">Bearbeiten</button> <button class=\"btn btn-small btn-danger\" data-storno=\"${x.id}\" title=\"Stornieren\">✕</button>` : x.quelle === 'bestellung' ? '<span class=\"muted small\">unter Zahlungen</span>' : ''}</td></tr>`).join('')}\n        </tbody></table></div>${pager(d.total, inState.seite)}<p class=\"muted small\">Summe (ohne Stornos): <b>${chf(d.summe)}</b></p>` : '<p class=\"empty\">Keine Einnahmen im gewählten Zeitraum.</p>';\n      bindPager($('bh-liste'), inState, load);\n      $('bh-liste').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { const x = rows[Number(b.dataset.edit)]; incomeForm(x.id, load, x); }));\n      $('bh-liste').querySelectorAll('[data-storno]').forEach(b => b.addEventListener('click', () => stornoDialog('Einnahme', `/api/bh/einnahmen/${b.dataset.storno}/storno`, load)));\n    };\n    after(() => { bindFilters(inState, load); load().catch(failed); });\n    return `<div class=\"page-head\"><div><h1>Einnahmen</h1><p class=\"muted\">Zahlungseingänge zu Bestellungen erscheinen automatisch (🔗) und sind hier schreibgeschützt – geändert werden sie unter Zahlungen.</p></div><div class=\"actions\"><a class=\"btn\" href=\"/api/bh/export/einnahmen.csv?${query({von: inState.von, bis: inState.bis})}\">⬇ Excel/CSV</a><button class=\"btn btn-main\" data-quick=\"einnahme\">＋ Neue Einnahme</button></div></div>\n      <div class=\"card\"><div class=\"filters\"><label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(inState.q)}\" placeholder=\"Beschreibung, Kunde, Bestellung oder Beleg-Nr.\"></label>\n        <label>Von<input type=\"date\" data-filter=\"von\" value=\"${esc(inState.von)}\"></label><label>Bis<input type=\"date\" data-filter=\"bis\" value=\"${esc(inState.bis)}\"></label>\n        <label>Zahlungsart<select data-filter=\"zahlungsart\"><option value=\"\">Alle</option>${opt(ZAHLUNGSARTEN.map(z => [z, z]), inState.zahlungsart)}</select></label>\n        <label>Herkunft<select data-filter=\"quelle\">${opt([['', 'Alle'], ['bestellung', 'Aus Bestellungen'], ['manuell', 'Manuell erfasst']], inState.quelle)}</select></label>\n        <label>Stornierte<select data-filter=\"storniert\">${opt([['', 'ausblenden'], ['1', 'anzeigen']], inState.storniert)}</select></label></div><div id=\"bh-liste\"><p class=\"loading\">Wird geladen …</p></div></div>`;\n  };\n\n  // ---- Zahlungen und offene Beträge ----\n  const payState = {status: 'offen', q: '', seite: 1};\n  function paymentForm(o, done, refund) {\n    formDialog(refund ? `Rückerstattung zu ${o.bestellnummer}` : `Zahlung zu ${o.bestellnummer} erfassen`, `<p class=\"muted small\">${esc(o.vorname)} ${esc(o.nachname)} · Total ${chf(o.total_rappen)} · bezahlt ${chf(o.bezahlt)} · offen <b>${chf(o.offen)}</b></p>\n      <div class=\"form-grid\"><label>Datum<input type=\"date\" id=\"f-datum\" value=\"${today()}\" max=\"${today()}\"></label><label>Betrag in CHF<input id=\"f-betrag\" inputmode=\"decimal\" value=\"${amount(refund ? o.bezahlt - o.erstattet : o.offen)}\"></label>\n      <label>Zahlungsart<select id=\"f-zahlungsart\">${opt(ZAHLUNGSARTEN.map(z => [z, z]), 'TWINT')}</select></label><label>Notiz (optional)<input id=\"f-notiz\" placeholder=\"${refund ? 'z. B. Reklamation, Teilrückerstattung' : 'z. B. TWINT-Mitteilung'}\"></label></div>\n      ${refund ? '' : '<p class=\"hint\">Weniger als der offene Betrag = Teilzahlung. Die Bestellung wird automatisch auf „Teilweise bezahlt“ bzw. „Bezahlt“ gesetzt.</p>'}`, refund ? 'Rückerstattung buchen' : 'Zahlung buchen', async () => {\n      const r = await api('/api/bh/zahlungen', {method: 'POST', body: {bestellung_id: o.id, datum: val('f-datum'), betrag: val('f-betrag'), zahlungsart: val('f-zahlungsart'), notiz: val('f-notiz'), art: refund ? 'rueckerstattung' : 'zahlung'}});\n      toast(`Gebucht – Bestellung jetzt: ${(ZAHLUNG[r.zahlung] || [r.zahlung])[0]}.`);\n    }).then(ok => ok && done());\n  }\n  PAGES['bh-zahlungen'] = async () => {\n    let list = [];\n    const load = async () => {\n      const d = await api('/api/bh/zahlungen?' + query(payState)); list = d.bestellungen;\n      $('bh-zahlen').innerHTML = `${kpi('Offen', chf(d.zahlen.offen_rappen), `${d.zahlen.offen} Bestellung(en)`, 'highlight')}${kpi('Überfällig', chf(d.zahlen.ueberfaellig_rappen), `${d.zahlen.ueberfaellig} Bestellung(en) · Frist ${d.frist} Tage`, d.zahlen.ueberfaellig ? 'alert' : '')}${kpi('Teilweise bezahlt', d.zahlen.teilweise)}`;\n      $('bh-uebernahme').innerHTML = d.ohne_buchung ? `<div class=\"card bh-warn\"><p>ℹ️ <b>${d.ohne_buchung} Bestellung(en)</b> sind als bezahlt bzw. rückerstattet markiert, haben aber noch keine Zahlungsbuchung (aus der Zeit vor der Buchhaltung). <button class=\"btn btn-small\" id=\"bh-uebernehmen\">Kontrolliert übernehmen</button></p></div>` : '';\n      $('bh-liste').innerHTML = list.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Bestellung</th><th>Kunde</th><th class=\"hide-mobile\">Datum</th><th class=\"num\">Total</th><th class=\"num\">Bezahlt</th><th class=\"num\">Offen</th><th>Status</th><th></th></tr></thead><tbody>\n        ${list.map((o, i) => `<tr><td><a href=\"#/bestellungen/${o.id}\"><b>${esc(o.bestellnummer)}</b></a>${o.rechnung_nr ? `<br><a class=\"small\" href=\"#/bh-rechnungen/${o.rechnung_id}\">${esc(o.rechnung_nr)}</a>` : ''}</td><td>${esc(o.vorname)} ${esc(o.nachname)}</td><td class=\"hide-mobile\">${date(o.datum)}<br><span class=\"muted small\">fällig ${date(o.faellig)}</span></td>\n          <td class=\"num\">${chf(o.total_rappen)}${o.gutgeschrieben ? `<br><span class=\"muted small\">Gutschrift −${chf(o.gutgeschrieben)}</span>` : ''}</td><td class=\"num\">${chf(o.bezahlt)}${o.erstattet ? `<br><span class=\"neg small\">−${chf(o.erstattet)} erstattet</span>` : ''}</td><td class=\"num\"><b>${chf(o.offen)}</b></td>\n          <td>${badge(ZUSTAND, o.ueberfaellig ? 'ueberfaellig' : o.zustand)}${o.status === 'storniert' ? '<br><span class=\"badge\">Bestellung storniert</span>' : ''}</td>\n          <td class=\"num\">${o.offen > 0 ? `<button class=\"btn btn-small btn-main\" data-pay=\"${i}\">Zahlung erfassen</button>` : ''} ${o.bezahlt - o.erstattet > 0 ? `<button class=\"btn btn-small\" data-refund=\"${i}\">Rückerstattung</button>` : ''}</td></tr>`).join('')}\n        </tbody></table></div>${pager(d.total, payState.seite)}` : '<p class=\"empty\">Keine Bestellungen in dieser Ansicht.</p>';\n      $('bh-buchungen').innerHTML = d.zahlungen.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Datum</th><th>Nr.</th><th>Bestellung</th><th class=\"num\">Betrag</th><th class=\"hide-mobile\">Art</th><th class=\"hide-mobile\">Notiz</th><th></th></tr></thead><tbody>\n        ${d.zahlungen.map(z => `<tr class=\"${z.storniert ? 'bh-storno' : ''}\"><td>${date(z.datum)}</td><td class=\"small\">${z.ref}</td><td><a href=\"#/bestellungen/${z.bestellung_id}\">${esc(z.bestellnummer)}</a></td><td class=\"num\"><span class=\"${z.betrag_rappen < 0 ? 'neg' : ''}\">${chf(z.betrag_rappen)}</span></td>\n          <td class=\"hide-mobile small\">${esc(z.zahlungsart || '')}${z.quelle !== 'manuell' ? ' · automatisch' : ''}</td><td class=\"hide-mobile small\">${esc(z.storniert ? 'Storniert: ' + (z.storno_grund || '') : z.notiz || '')}</td>\n          <td class=\"num\">${z.storniert ? '' : `<button class=\"btn btn-small btn-danger\" data-zstorno=\"${z.id}\" title=\"Stornieren\">✕</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class=\"empty\">Noch keine Zahlungen gebucht.</p>';\n      bindPager($('bh-liste'), payState, load);\n      content.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => paymentForm(list[Number(b.dataset.pay)], load)));\n      content.querySelectorAll('[data-refund]').forEach(b => b.addEventListener('click', () => paymentForm(list[Number(b.dataset.refund)], load, true)));\n      content.querySelectorAll('[data-zstorno]').forEach(b => b.addEventListener('click', () => stornoDialog('Zahlung', `/api/bh/zahlungen/${b.dataset.zstorno}/storno`, load)));\n      $('bh-uebernehmen')?.addEventListener('click', async () => {\n        if (!await confirmDialog(`<h2>Bisherige Zahlungen übernehmen?</h2><p>Für ${d.ohne_buchung} Bestellung(en) wird je eine Zahlung über den Bestellbetrag gebucht (Datum = „bezahlt am“). Bei rückerstatteten Bestellungen zusätzlich die Rückerstattung. Bereits gebuchte Bestellungen werden nicht doppelt erfasst.</p>`, 'Übernehmen')) return;\n        try { const r = await api('/api/bh/zahlungen/uebernehmen', {method: 'POST'}); toast(`${r.anzahl} Bestellung(en) übernommen.`); load(); } catch (e) { failed(e); }\n      });\n    };\n    after(() => { bindFilters(payState, load); load().catch(failed); });\n    return `<div class=\"page-head\"><div><h1>Zahlungen</h1><p class=\"muted\">Eine Bestellung gilt erst als bezahlt, wenn die Zahlung hier (oder in der Bestellung mit „Bezahlt“) gebucht ist.</p></div><div class=\"actions\"><a class=\"btn\" href=\"/api/bh/export/offene-posten.csv\">⬇ Offene Posten (CSV)</a></div></div>\n      <div class=\"grid kpis\" id=\"bh-zahlen\"></div><div id=\"bh-uebernahme\"></div>\n      <div class=\"card\"><div class=\"filters\"><label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(payState.q)}\" placeholder=\"Bestellnummer, Name oder E-Mail\"></label>\n        <label>Ansicht<select data-filter=\"status\">${opt([['offen', 'Offen (inkl. teilweise)'], ['ueberfaellig', 'Überfällig'], ['teilweise', 'Teilweise bezahlt'], ['bezahlt', 'Bezahlt'], ['rueckerstattet', 'Rückerstattet'], ['alle', 'Alle Bestellungen']], payState.status)}</select></label></div>\n        <div id=\"bh-liste\"><p class=\"loading\">Wird geladen …</p></div></div>\n      <div class=\"card\"><h2>Letzte Buchungen</h2><div id=\"bh-buchungen\"></div></div>`;\n  };\n\n  // ---- Rechnungen ----\n  const invState = {q: '', status: '', seite: 1};\n  PAGES['bh-rechnungen'] = async id => {\n    if (id === 'neu') return invoiceNew();\n    if (id && /^\\d+$/.test(id)) return invoiceDetail(id);\n    const load = async () => {\n      const d = await api('/api/bh/rechnungen?' + query(invState));\n      $('bh-liste').innerHTML = d.rechnungen.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Nummer</th><th>Datum</th><th>Kunde</th><th class=\"hide-mobile\">Bestellung</th><th class=\"num\">Betrag</th><th class=\"num hide-mobile\">Offen</th><th>Status</th></tr></thead><tbody>\n        ${d.rechnungen.map(r => `<tr class=\"click\" data-href=\"#/bh-rechnungen/${r.id}\"><td><b>${esc(r.nummer)}</b></td><td>${date(r.datum)}${r.art === 'rechnung' ? `<br><span class=\"muted small\">fällig ${date(r.faellig)}</span>` : ''}</td><td>${esc(r.kunde)}</td><td class=\"hide-mobile\">${esc(r.bestellnummer || '–')}</td>\n          <td class=\"num\">${r.art === 'gutschrift' ? '−' : ''}${chf(r.betrag_rappen)}</td><td class=\"num hide-mobile\">${r.offen_rappen ? chf(r.offen_rappen) : '–'}</td><td>${badge(ZUSTAND, r.zustand)}</td></tr>`).join('')}</tbody></table></div>${pager(d.total, invState.seite)}`\n        : '<p class=\"empty\">Noch keine Rechnungen. Mit „🧾 Rechnung erstellen“ für eine Bestellung erzeugen.</p>';\n      bindPager($('bh-liste'), invState, load);\n    };\n    after(() => { bindFilters(invState, load); load().catch(failed); });\n    return `<div class=\"page-head\"><div><h1>Rechnungen</h1><p class=\"muted\">Fortlaufende Nummern, die nie verändert werden. Falsche Rechnungen werden storniert, Teilrückerstattungen als Gutschrift erfasst.</p></div><div class=\"actions\"><a class=\"btn\" href=\"/api/bh/export/rechnungen.csv\">⬇ Excel/CSV</a><a class=\"btn btn-main\" href=\"#/bh-rechnungen/neu\">🧾 Rechnung erstellen</a></div></div>\n      <div class=\"card\"><div class=\"filters\"><label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(invState.q)}\" placeholder=\"Rechnungsnummer, Bestellung oder Kunde\"></label>\n        <label>Status<select data-filter=\"status\">${opt([['', 'Alle'], ['offen', 'Offen'], ['ueberfaellig', 'Überfällig'], ['teilweise', 'Teilweise bezahlt'], ['bezahlt', 'Bezahlt'], ['gutschrift', 'Gutschriften'], ['storniert', 'Storniert']], invState.status)}</select></label></div>\n        <div id=\"bh-liste\"><p class=\"loading\">Wird geladen …</p></div></div>`;\n  };\n  async function invoiceNew() {\n    const d = await api('/api/bh/rechnungen/kandidaten');\n    after(() => content.querySelectorAll('[data-create]').forEach(b => b.addEventListener('click', async () => {\n      b.disabled = true;\n      try { const r = await api('/api/bh/rechnungen', {method: 'POST', body: {bestellung_id: Number(b.dataset.create)}}); toast(r.vorhanden ? 'Für diese Bestellung gibt es schon eine Rechnung.' : `Rechnung ${r.nummer} erstellt.`); location.hash = '#/bh-rechnungen/' + r.id; }\n      catch (e) { failed(e); b.disabled = false; }\n    })));\n    return `<div class=\"page-head\"><div><a href=\"#/bh-rechnungen\">← Rechnungen</a><h1>Rechnung erstellen</h1><p class=\"muted\">Bestellung wählen – Positionen, Kunde und Betrag werden aus der Bestellung übernommen. Pro Bestellung gibt es genau eine Rechnung.</p></div></div>\n      <div class=\"card\">${d.bestellungen.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Bestellung</th><th>Kunde</th><th>Datum</th><th class=\"num\">Betrag</th><th></th></tr></thead><tbody>${d.bestellungen.map(o => `<tr><td><b>${esc(o.bestellnummer)}</b></td><td>${esc(o.vorname)} ${esc(o.nachname)}</td><td>${date(o.datum)}</td><td class=\"num\">${chf(o.total_rappen)}</td><td class=\"num\"><button class=\"btn btn-small btn-main\" data-create=\"${o.id}\">Rechnung erstellen</button></td></tr>`).join('')}</tbody></table></div>` : '<p class=\"empty\">Alle Bestellungen haben bereits eine Rechnung.</p>'}</div>`;\n  }\n  async function invoiceDetail(id) {\n    const d = await api('/api/bh/rechnungen/' + id), r = d.rechnung, x = r.daten, z = d.zahlung, gs = r.art === 'gutschrift';\n    after(() => {\n      $('inv-print').addEventListener('click', () => window.print());\n      $('inv-storno')?.addEventListener('click', () => stornoDialog(gs ? 'Gutschrift' : 'Rechnung', `/api/bh/rechnungen/${id}/storno`, render));\n      $('inv-gs')?.addEventListener('click', () => formDialog(`Gutschrift zu ${r.nummer}`, `<p class=\"hint\">Für Teilrückerstattungen, Rabatte im Nachhinein oder Reklamationen. Die Gutschrift reduziert den Umsatz und den offenen Betrag. Geld zurückzahlen: danach unter Zahlungen „Rückerstattung“ buchen.</p>\n        <div class=\"form-grid\"><label>Betrag in CHF<input id=\"f-betrag\" inputmode=\"decimal\"></label><label>Grund<input id=\"f-grund\" placeholder=\"z. B. Druckfehler Design 2\"></label></div>`, 'Gutschrift erstellen', async () => {\n        const g = await api(`/api/bh/rechnungen/${id}/gutschrift`, {method: 'POST', body: {betrag: val('f-betrag'), grund: val('f-grund')}}); toast(`Gutschrift ${g.nummer} erstellt.`); location.hash = '#/bh-rechnungen/' + g.id;\n      }));\n    });\n    const lines = x.positionen.map(p => `<tr><td>${esc(p.text)}</td><td class=\"num\">${p.menge}</td><td class=\"num\">${chf(p.betrag_rappen)}</td></tr>`).join('');\n    const status = r.storniert ? `<span class=\"badge\">Storniert: ${esc(r.storno_grund || '')}</span>` : gs ? badge(ZUSTAND, 'gutschrift') : z ? badge(ZUSTAND, z.ueberfaellig ? 'ueberfaellig' : z.zustand) : '';\n    return `<div class=\"page-head no-print\"><div><a href=\"#/bh-rechnungen\">← Rechnungen</a><h1>${gs ? 'Gutschrift' : 'Rechnung'} ${esc(r.nummer)}</h1><p class=\"muted\">${status}${r.bestellnummer ? ` · Bestellung <a href=\"#/bestellungen/${r.bestellung_id}\">${esc(r.bestellnummer)}</a>` : ''}${z && !gs ? ` · bezahlt ${chf(z.bezahlt)} · offen ${chf(z.offen)}` : ''}</p></div>\n      <div class=\"actions\"><button class=\"btn btn-dark\" id=\"inv-print\">🖨 Drucken / als PDF speichern</button>${!gs && !r.storniert ? '<button class=\"btn\" id=\"inv-gs\">Gutschrift erstellen</button>' : ''}${r.storniert ? '' : '<button class=\"btn btn-danger\" id=\"inv-storno\">Stornieren</button>'}</div></div>\n      ${d.gutschriften.length ? `<div class=\"card no-print\"><p class=\"small\">Gutschriften: ${d.gutschriften.map(g => `<a href=\"#/bh-rechnungen/${g.id}\">${esc(g.nummer)}</a> (${chf(g.betrag_rappen)}${g.storniert ? ', storniert' : ''})`).join(', ')}</p></div>` : ''}\n      <article class=\"invoice${r.storniert ? ' is-storno' : ''}\">\n        <header><div><img src=\"https://shirtbox.ch/shirtbox-icon.svg\" alt=\"\" width=\"44\" height=\"44\"><b>${esc(x.absender.firma)}</b><br>${x.absender.adresse.filter(l => l !== x.absender.firma).map(esc).join('<br>')}${x.absender.uid ? `<br>UID ${esc(x.absender.uid)}` : ''}${x.absender.mwst_nummer ? `<br>${esc(x.absender.mwst_nummer)} MWST` : ''}</div>\n          <div class=\"to\">${esc(x.empfaenger.name)}<br>${esc(x.empfaenger.strasse || '')}<br>${esc(x.empfaenger.ort || '')}${x.empfaenger.land && !/^(schweiz|ch)$/i.test(x.empfaenger.land) ? '<br>' + esc(x.empfaenger.land) : ''}</div></header>\n        <h2>${gs ? 'Gutschrift' : 'Rechnung'} ${esc(r.nummer)}</h2>\n        <dl class=\"facts\"><dt>Datum</dt><dd>${date(r.datum)}</dd>${r.bestellnummer ? `<dt>Bestellung</dt><dd>${esc(r.bestellnummer)}</dd>` : ''}<dt>Kundennummer</dt><dd>${esc(x.empfaenger.kundennummer)}</dd>${gs && r.bezug_nummer ? `<dt>Zu Rechnung</dt><dd>${esc(r.bezug_nummer)}</dd>` : ''}</dl>\n        <table><thead><tr><th>Beschreibung</th><th class=\"num\">Menge</th><th class=\"num\">Betrag</th></tr></thead><tbody>${lines}</tbody>\n          <tfoot><tr><td colspan=\"2\"><b>${gs ? 'Gutschrift total' : 'Total'}</b></td><td class=\"num\"><b>${chf(r.betrag_rappen)}</b></td></tr>${x.mwst ? `<tr><td colspan=\"2\">darin enthalten MWST ${x.mwst.satz} %</td><td class=\"num\">${chf(x.mwst.betrag_rappen)}</td></tr>` : ''}</tfoot></table>\n        <p>${x.mwst ? '' : 'Kein MWST-Ausweis (nicht mehrwertsteuerpflichtig). '}Alle Beträge in CHF.</p>\n        ${gs ? '<p>Der Betrag wird Ihnen gutgeschrieben bzw. zurückerstattet.</p>' : z && z.zustand === 'bezahlt' ? `<p><b>Bezahlt</b>${z.letzte_zahlung ? ` am ${date(z.letzte_zahlung)}` : ''} – vielen Dank!</p>`\n          : `<p>Zahlbar bis <b>${date(r.faellig)}</b> per TWINT an <b>${esc(x.twint)}</b> (Mitteilung: ${esc(r.bestellnummer || r.nummer)})${x.absender.iban ? ` oder per Überweisung auf IBAN <b>${esc(x.absender.iban.replace(/(.{4})/g, '$1 ').trim())}</b>${x.absender.bank ? ` (${esc(x.absender.bank)})` : ''}` : ''}.</p>`}\n        <footer>${esc(x.absender.firma)} · info@shirtbox.ch · shirtbox.ch</footer>\n      </article>`;\n  }\n\n  // ---- Belege ----\n  const recState = {q: '', archiv: '', seite: 1};\n  function preview(id) {\n    const url = `/api/bh/belege/${id}/datei`;\n    formDialog('Beleg', `<div class=\"bh-preview\" id=\"bh-preview\"><p class=\"loading\">Wird geladen …</p></div><p><a class=\"btn btn-small\" href=\"${url}?download=1\">⬇ Herunterladen</a> <a class=\"btn btn-small\" href=\"${url}\" target=\"_blank\" rel=\"noopener\">In neuem Tab öffnen</a></p>`, null, null, true);\n    fetch(url, {credentials: 'same-origin'}).then(r => r.ok ? r.headers.get('Content-Type') : Promise.reject()).then(type => {\n      $('bh-preview').innerHTML = type === 'application/pdf' ? `<iframe src=\"${url}\" title=\"Beleg-Vorschau\"></iframe>` : `<img src=\"${url}\" alt=\"Beleg\">`;\n    }).catch(() => { $('bh-preview').innerHTML = '<p class=\"error\">Der Beleg konnte nicht geladen werden.</p>'; });\n  }\n  content.addEventListener('click', e => { const a = e.target.closest('[data-preview]'); if (a) { e.preventDefault(); preview(a.dataset.preview); } });\n  PAGES['bh-belege'] = async () => {\n    const load = async () => {\n      const d = await api('/api/bh/belege?' + query(recState));\n      $('bh-liste').innerHTML = d.belege.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Nr.</th><th>Datei</th><th class=\"hide-mobile\">Hochgeladen</th><th>Verknüpft mit</th><th class=\"hide-mobile\">Notiz</th><th></th></tr></thead><tbody>\n        ${d.belege.map(b => { const links = [...b.ausgaben, ...b.einnahmen, ...b.rechnungen]; return `<tr><td class=\"small\">${b.ref}</td><td><a href=\"#\" data-preview=\"${b.id}\"><b>${esc(b.dateiname)}</b></a><br><span class=\"muted small\">${b.typ === 'application/pdf' ? 'PDF' : b.typ === 'image/png' ? 'PNG' : 'JPG'} · ${(b.groesse / 1024 / 1024).toFixed(1).replace('.', ',')} MB</span></td>\n          <td class=\"hide-mobile\">${time(b.hochgeladen)}</td><td class=\"small\">${links.length ? links.map(esc).join(', ') : '<span class=\"badge warn\">nicht verknüpft</span>'}</td><td class=\"hide-mobile small\">${esc(b.archiviert ? 'Archiviert: ' + (b.archiv_grund || '') : b.notiz || '')}</td>\n          <td class=\"num\">${b.archiviert || links.length ? '' : `<button class=\"btn btn-small\" data-archiv=\"${b.id}\">Archivieren</button>`}</td></tr>`; }).join('')}</tbody></table></div>${pager(d.total, recState.seite)}` : '<p class=\"empty\">Keine Belege.</p>';\n      bindPager($('bh-liste'), recState, load);\n      $('bh-liste').querySelectorAll('[data-archiv]').forEach(b => b.addEventListener('click', () => formDialog('Beleg archivieren?', '<p>Der Beleg wird ausgeblendet, aber nicht gelöscht (Aufbewahrungspflicht 10 Jahre). Nur nicht verknüpfte Belege können archiviert werden.</p><label>Grund<input id=\"s-grund\" placeholder=\"z. B. Falsche Datei hochgeladen\"></label>', 'Archivieren', async () => {\n        await api(`/api/bh/belege/${b.dataset.archiv}/archiv`, {method: 'POST', body: {grund: val('s-grund')}}); toast('Archiviert.');\n      }).then(ok => ok && load())));\n    };\n    after(() => { bindFilters(recState, load); load().catch(failed); });\n    return `<div class=\"page-head\"><div><h1>Belege</h1><p class=\"muted\">Privat gespeichert, nur nach Anmeldung sichtbar. Belege werden nie gelöscht – höchstens archiviert.</p></div><div class=\"actions\"><button class=\"btn btn-main\" data-quick=\"beleg\">⬆ Beleg hochladen</button></div></div>\n      <div class=\"card\"><div class=\"filters\"><label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(recState.q)}\" placeholder=\"Dateiname oder Notiz\"></label><label>Ansicht<select data-filter=\"archiv\">${opt([['', 'Aktive Belege'], ['1', 'Archiv']], recState.archiv)}</select></label></div>\n        <div id=\"bh-liste\"><p class=\"loading\">Wird geladen …</p></div></div>`;\n  };\n\n  // ---- Lieferanten ----\n  function supplierForm(l, done) {\n    l = l || {};\n    const f = (k, label, type = 'text', ph = '') => `<label${k === 'adresse' || k === 'notiz' ? ' class=\"span\"' : ''}>${label}${k === 'adresse' || k === 'notiz' ? `<textarea id=\"l-${k}\" rows=\"2\">${esc(l[k] || '')}</textarea>` : `<input id=\"l-${k}\" type=\"${type}\" value=\"${esc(l[k] || '')}\" placeholder=\"${esc(ph)}\">`}</label>`;\n    formDialog(l.id ? `${l.name} bearbeiten` : 'Neuer Lieferant', `<div class=\"form-grid\">${f('name', 'Firmenname')}${f('kontakt', 'Kontaktperson')}${f('email', 'E-Mail', 'email')}${f('telefon', 'Telefon', 'tel')}${f('website', 'Website', 'url', 'https://…')}${f('adresse', 'Adresse')}${f('notiz', 'Notizen')}</div>`, 'Speichern', async () => {\n      const body = Object.fromEntries(['name', 'kontakt', 'email', 'telefon', 'website', 'adresse', 'notiz'].map(k => [k, val('l-' + k)]));\n      if (l.id) await api('/api/bh/lieferanten/' + l.id, {method: 'PUT', body}); else await api('/api/bh/lieferanten', {method: 'POST', body});\n      toast('Lieferant gespeichert.');\n    }, true).then(ok => ok && done());\n  }\n  PAGES['bh-lieferanten'] = async id => {\n    if (id && /^\\d+$/.test(id)) {\n      const d = await api('/api/bh/lieferanten/' + id), l = d.lieferant;\n      after(() => $('l-edit').addEventListener('click', () => supplierForm(l, render)));\n      return `<div class=\"page-head\"><div><a href=\"#/bh-lieferanten\">← Lieferanten</a><h1>${esc(l.name)}</h1></div><div class=\"actions\"><button class=\"btn\" id=\"l-edit\">Bearbeiten</button><a class=\"btn\" href=\"#/bh-ausgaben/?lieferant=${l.id}\">Alle Ausgaben</a></div></div>\n        <div class=\"grid kpis\">${kpi('Ausgaben total', chf(d.summen.total), `${d.summen.anzahl} Buchung(en)`)}${kpi('Laufendes Geschäftsjahr', chf(d.summen.jahr), `seit ${date(d.gj_start)}`, 'highlight')}</div>\n        <div class=\"grid two\"><div class=\"card\"><h2>Kontakt</h2><dl class=\"facts\"><dt>Kontaktperson</dt><dd>${esc(l.kontakt || '–')}</dd><dt>E-Mail</dt><dd>${l.email ? `<a href=\"mailto:${esc(l.email)}\">${esc(l.email)}</a>` : '–'}</dd><dt>Telefon</dt><dd>${esc(l.telefon || '–')}</dd><dt>Adresse</dt><dd>${esc(l.adresse || '–').replace(/\\n/g, '<br>')}</dd><dt>Website</dt><dd>${l.website ? `<a href=\"${esc(l.website)}\" target=\"_blank\" rel=\"noopener\">${esc(l.website)}</a>` : '–'}</dd></dl>${l.notiz ? `<p class=\"small\">${esc(l.notiz)}</p>` : ''}</div>\n        <div class=\"card\"><h2>Letzte Ausgaben und Belege</h2>${d.ausgaben.length ? `<div class=\"table-wrap\"><table><tbody>${d.ausgaben.map(a => `<tr class=\"${a.storniert ? 'bh-storno' : ''}\"><td>${date(a.datum)}</td><td>${esc(a.beschreibung)}<br><span class=\"muted small\">${esc(a.kategorie || '')}</span></td><td class=\"num\">${chf(a.brutto_rappen)}</td><td>${a.beleg_id ? `<a href=\"#\" data-preview=\"${a.beleg_id}\">📎 Beleg</a>` : '<span class=\"muted small\">kein Beleg</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class=\"empty\">Noch keine Ausgaben.</p>'}</div></div>`;\n    }\n    const d = await api('/api/bh/lieferanten');\n    after(() => $('l-neu').addEventListener('click', () => supplierForm(null, render)));\n    return `<div class=\"page-head\"><div><h1>Lieferanten</h1></div><div class=\"actions\"><a class=\"btn\" href=\"/api/bh/export/lieferanten.csv\">⬇ Excel/CSV</a><button class=\"btn btn-main\" id=\"l-neu\">＋ Neuer Lieferant</button></div></div>\n      <div class=\"card\">${d.lieferanten.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Firma</th><th class=\"hide-mobile\">Kontakt</th><th class=\"num\">Ausgaben total</th><th class=\"num\">Geschäftsjahr</th><th class=\"hide-mobile\">Letzte Ausgabe</th></tr></thead><tbody>\n        ${d.lieferanten.map(l => `<tr class=\"click\" data-href=\"#/bh-lieferanten/${l.id}\"><td><b>${esc(l.name)}</b></td><td class=\"hide-mobile\">${esc(l.kontakt || '')}${l.email ? `<br><span class=\"muted small\">${esc(l.email)}</span>` : ''}</td><td class=\"num\">${chf(l.total)}</td><td class=\"num\">${chf(l.jahr)}</td><td class=\"hide-mobile\">${date(l.letzte)}</td></tr>`).join('')}</tbody></table></div>` : '<p class=\"empty\">Noch keine Lieferanten erfasst.</p>'}</div>`;\n  };\n\n  // ---- Auswertungen ----\n  const repState = {von: '', bis: ''};\n  PAGES['bh-auswertungen'] = async () => {\n    const d = await api('/api/bh/auswertungen?' + query(repState)), e = d.ergebnis;\n    if (!repState.von) { repState.von = d.von; repState.bis = d.bis; }\n    after(() => {\n      $('r-print').addEventListener('click', () => window.print());\n      $('r-ok').addEventListener('click', () => { repState.von = val('r-von'); repState.bis = val('r-bis'); render(); });\n      content.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { const y = Number(today().slice(0, 4)) - Number(b.dataset.range); repState.von = `${y}-01-01`; repState.bis = `${y}-12-31`; render(); }));\n    });\n    const qs = query({von: d.von, bis: d.bis}), mon = p => p.split('-').reverse().join('.');\n    const table = (head, rows) => rows.length ? `<div class=\"table-wrap\"><table><thead><tr>${head.map((h, i) => `<th${i ? ' class=\"num\"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class=\"num\"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class=\"empty\">Keine Daten im gewählten Zeitraum.</p>';\n    const missing = d.deckungsbeitrag.filter(o => !o.vollstaendig).length;\n    return `<div class=\"page-head\"><div><h1>Auswertungen</h1>${SIMPLE}</div><div class=\"actions no-print\"><button class=\"btn btn-dark\" id=\"r-print\" type=\"button\">🖨 Drucken / PDF</button></div></div>\n      <div class=\"card no-print\"><div class=\"filters\"><label>Von<input type=\"date\" id=\"r-von\" value=\"${esc(d.von)}\"></label><label>Bis<input type=\"date\" id=\"r-bis\" value=\"${esc(d.bis)}\"></label><button class=\"btn btn-main\" id=\"r-ok\" type=\"button\">Anzeigen</button>\n        <span class=\"seg\"><button type=\"button\" data-range=\"0\">Dieses Jahr</button><button type=\"button\" data-range=\"1\">Letztes Jahr</button></span></div>\n        <p class=\"small\"><b>Export für den Treuhänder:</b> <a class=\"btn btn-small\" href=\"/api/bh/export/journal.csv?${qs}\">⬇ Journal (alle Geldflüsse)</a> <a class=\"btn btn-small\" href=\"/api/bh/export/einnahmen.csv?${qs}\">⬇ Einnahmen</a> <a class=\"btn btn-small\" href=\"/api/bh/export/ausgaben.csv?${qs}\">⬇ Ausgaben</a> <a class=\"btn btn-small\" href=\"/api/bh/export/rechnungen.csv?${qs}\">⬇ Rechnungen</a> <a class=\"btn btn-small\" href=\"/api/bh/export/deckungsbeitrag.csv?${qs}\">⬇ Deckungsbeiträge</a> <a class=\"btn btn-small\" href=\"/api/bh/export/offene-posten.csv\">⬇ Offene Posten</a></p>\n        <p class=\"hint\">CSV-Dateien öffnen sich direkt in Excel. Als PDF: Seite drucken und „Als PDF speichern“ wählen.</p></div>\n      <p class=\"muted small\">${date(d.von)} – ${date(d.bis)}</p>\n      <div class=\"grid kpis\">${kpi('Einnahmen', chf(e.einnahmen))}${kpi('Ausgaben', chf(e.ausgaben))}${kpi('Ergebnis', chf(e.ergebnis), 'Einnahmen − Ausgaben', 'highlight')}${kpi('Umsatz (Bestellwert)', chf(e.umsatz))}</div>\n      <div class=\"grid two\">\n        <div class=\"card\"><h2>Umsatz pro Monat</h2>${table(['Monat', 'Bestellungen', 'Shirts', 'Umsatz'], d.umsatz_monat.map(r => [mon(r.periode), r.anzahl, r.shirts, chf(r.summe)]))}</div>\n        <div class=\"card\"><h2>Umsatz pro Jahr</h2>${table(['Jahr', 'Bestellungen', 'Shirts', 'Umsatz'], d.umsatz_jahr.map(r => [r.periode, r.anzahl, r.shirts, chf(r.summe)]))}\n          <h3 style=\"margin-top:16px\">Einnahmen nach Kategorie</h3>${bars(d.einnahmen_kategorie)}<p class=\"hint\">Umsatz nach Produkt (Polo/Zip) ist noch nicht möglich, weil das Shirt-Modell bei der Bestellung bisher nicht gespeichert wird.</p></div>\n        <div class=\"card\"><h2>Ausgaben pro Monat</h2>${table(['Monat', 'Buchungen', 'Ausgaben'], d.ausgaben_monat.map(r => [mon(r.periode), r.anzahl, chf(r.summe)]))}</div>\n        <div class=\"card\"><h2>Ausgaben nach Kategorie</h2>${bars(d.ausgaben_kategorie)}<h3 style=\"margin-top:16px\">Ausgaben nach Lieferant</h3>${bars(d.ausgaben_lieferant)}</div>\n      </div>\n      <div class=\"card\"><h2>Rentabilität: Deckungsbeitrag pro Bestellung</h2>\n        <p class=\"muted small\">Deckungsbeitrag = Nettoerlös − direkte Kosten der Bestellung. Das ist <b>nicht</b> der Unternehmensgewinn (dafür zählen auch Fixkosten wie Software, Werbung, Maschinen). ${missing ? `<span class=\"badge warn\">${missing} Bestellung(en) mit fehlenden Kosten – Werte dort unvollständig</span>` : ''}</p>\n        ${table(['Monat', 'Erlös netto', 'Direkte Kosten', 'Deckungsbeitrag', 'unvollständig'], d.deckungsbeitrag_monat.map(r => [mon(r.periode), chf(r.erloes), chf(r.kosten), chf(r.deckungsbeitrag), r.unvollstaendig || '–']))}\n        <h3 style=\"margin-top:16px\">Einzelne Bestellungen</h3>\n        ${d.deckungsbeitrag.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Bestellung</th><th class=\"hide-mobile\">Kunde</th><th class=\"num\">Erlös netto</th><th class=\"num\">Kosten</th><th class=\"num\">Deckungsbeitrag</th><th class=\"num\">Marge</th><th>Kosten</th></tr></thead><tbody>\n          ${d.deckungsbeitrag.map(o => `<tr class=\"click\" data-href=\"#/bestellungen/${o.id}\"><td><b>${esc(o.bestellnummer)}</b><br><span class=\"muted small\">${date(o.datum)} · ${o.anzahl} Shirt${o.anzahl === 1 ? '' : 's'}</span></td><td class=\"hide-mobile\">${esc(o.kunde)}</td><td class=\"num\">${chf(o.erloes_netto)}</td><td class=\"num\">${chf(o.kosten_summe)}</td>\n            <td class=\"num\"><b>${o.vollstaendig ? '' : '≈ '}${chf(o.deckungsbeitrag)}</b></td><td class=\"num\">${o.marge === null ? '–' : (o.vollstaendig ? '' : '≈ ') + o.marge.toLocaleString('de-CH') + ' %'}</td>\n            <td>${o.vollstaendig ? '<span class=\"badge good\">vollständig</span>' : `<span class=\"badge warn\" title=\"${esc(o.fehlt.map(a => KOSTEN[a]).join(', '))}\">fehlt: ${o.fehlt.length}</span>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class=\"empty\">Keine Bestellungen im Zeitraum.</p>'}</div>`;\n  };\n\n  // ---- Einstellungen ----\n  PAGES['bh-einstellungen'] = async () => {\n    const d = await api('/api/bh/einstellungen'), s = d.einstellungen;\n    const field = (k, label, hint = '', type = 'text', extra = '') => `<label>${label}<input id=\"s-${k}\" type=\"${type}\" value=\"${esc(s[k] ?? '')}\" ${extra}>${hint ? `<span class=\"hint\">${hint}</span>` : ''}</label>`;\n    const money = k => s[k] === '' ? '' : amount(s[k]);\n    after(() => {\n      $('bh-set').addEventListener('submit', async e => {\n        e.preventDefault();\n        const keys = ['bh_firma', 'bh_uid', 'bh_mwst_nummer', 'bh_mwst_saetze', 'bh_mwst_standard', 'bh_zahlungsfrist', 'bh_iban', 'bh_bank', 'bh_gj_beginn', 'bh_rechnung_praefix', 'bh_gutschrift_praefix', 'bh_gesperrt_bis', 'bh_std_textilien', 'bh_std_druck', 'bh_std_verpackung', 'bh_std_versand', 'bh_std_gebuehren_prozent'];\n        const body = Object.fromEntries(keys.map(k => [k, val('s-' + k)])); body.bh_mwst_pflichtig = $('s-bh_mwst_pflichtig').checked ? '1' : '0'; body.bh_preise = val('s-bh_preise');\n        try { await api('/api/bh/einstellungen', {method: 'PUT', body}); toast('Einstellungen gespeichert.'); } catch (err) { failed(err); }\n      });\n      $('k-neu').addEventListener('click', () => formDialog('Neue Kategorie', `<div class=\"form-grid\"><label>Art<select id=\"k-art\">${opt([['ausgabe', 'Ausgabe'], ['einnahme', 'Einnahme']], 'ausgabe')}</select></label><label>Name<input id=\"k-name\"></label></div>`, 'Anlegen', async () => {\n        await api('/api/bh/kategorien', {method: 'POST', body: {art: val('k-art'), name: val('k-name')}}); toast('Kategorie angelegt.');\n      }).then(ok => ok && render()));\n      content.querySelectorAll('[data-kat]').forEach(b => b.addEventListener('click', () => {\n        const k = d.kategorien.find(x => x.id === Number(b.dataset.kat));\n        formDialog('Kategorie bearbeiten', `<label>Name<input id=\"k-name\" value=\"${esc(k.name)}\"></label><label class=\"check-row\"><input type=\"checkbox\" id=\"k-aktiv\"${k.aktiv ? ' checked' : ''}> aktiv (in Formularen auswählbar)</label><p class=\"hint\">Kategorien werden nie gelöscht, damit alte Buchungen ihre Kategorie behalten – nicht mehr benötigte einfach deaktivieren.</p>`, 'Speichern', async () => {\n          await api('/api/bh/kategorien/' + k.id, {method: 'PATCH', body: {name: val('k-name'), aktiv: $('k-aktiv').checked}}); toast('Gespeichert.');\n        }).then(ok => ok && render());\n      }));\n    });\n    const kat = art => d.kategorien.filter(k => k.art === art).map(k => `<button type=\"button\" class=\"chip${k.aktiv ? '' : ' off'}\" data-kat=\"${k.id}\">${esc(k.name)}${k.aktiv ? '' : ' (inaktiv)'}</button>`).join('');\n    return `<div class=\"page-head\"><div><h1>Buchhaltung · Einstellungen</h1><p class=\"muted\">Firmenadresse und Absender werden aus den allgemeinen <a href=\"#/einstellungen\">Einstellungen</a> übernommen (Feld „Absenderangaben“) – keine doppelte Erfassung.</p></div></div>\n      <form id=\"bh-set\"><div class=\"grid two\">\n        <div class=\"card\"><h2>Firma und Rechnungen</h2>${field('bh_firma', 'Firmenname auf Rechnungen')}<p class=\"small muted\">Adresse: ${esc(s.adresse || '–')}</p>${field('bh_uid', 'UID (optional)', 'z. B. CHE-123.456.789')}\n          ${field('bh_iban', 'IBAN (optional)', 'Erscheint als zweite Zahlungsmöglichkeit auf Rechnungen.')}${field('bh_bank', 'Bank (optional)')}\n          <div class=\"form-grid\">${field('bh_rechnung_praefix', 'Präfix Rechnungen', 'RE-2026-0001')}${field('bh_gutschrift_praefix', 'Präfix Gutschriften', 'GS-2026-0001')}</div>\n          ${field('bh_zahlungsfrist', 'Zahlungsfrist in Tagen', 'Danach gelten offene Bestellungen und Rechnungen als überfällig.', 'number', 'min=\"0\" max=\"365\"')}\n          <label>Währung<input value=\"CHF\" disabled></label></div>\n        <div class=\"card\"><h2>MWST</h2><label class=\"check-row\"><input type=\"checkbox\" id=\"s-bh_mwst_pflichtig\"${s.bh_mwst_pflichtig === '1' ? ' checked' : ''}> ShirtBOX ist MWST-pflichtig</label>\n          <p class=\"hint\">Aktuell: ${s.bh_mwst_pflichtig === '1' ? 'pflichtig – MWST wird auf Rechnungen ausgewiesen und bei Ausgaben als Vorsteuer erfasst.' : 'nicht pflichtig (Pflicht ab CHF 100’000 Jahresumsatz). Rechnungen enthalten keinen MWST-Ausweis.'}</p>\n          ${field('bh_mwst_nummer', 'MWST-Nummer', 'z. B. CHE-123.456.789 MWST')}${field('bh_mwst_saetze', 'MWST-Sätze in %', 'Normalsatz 8.1, reduziert 2.6, Beherbergung 3.8')}${field('bh_mwst_standard', 'Standardsatz in %')}\n          <label>Preise<select id=\"s-bh_preise\">${opt([['brutto', 'Bruttopreise (inkl. MWST)'], ['netto', 'Nettopreise (zzgl. MWST)']], s.bh_preise)}</select></label>\n          <p class=\"hint\">Hinweis: Die MWST-Abrechnung (effektive Methode oder Saldosteuersatz) bitte mit dem Treuhänder abstimmen – diese Übersicht ersetzt keine MWST-Abrechnung.</p></div>\n        <div class=\"card\"><h2>Geschäftsjahr und Abschluss</h2><label>Beginn des Geschäftsjahres<select id=\"s-bh_gj_beginn\">${opt(Array.from({length: 12}, (_, i) => [String(i + 1), new Intl.DateTimeFormat('de-CH', {month: 'long'}).format(new Date(2026, i, 1))]), s.bh_gj_beginn)}</select></label>\n          ${field('bh_gesperrt_bis', 'Buchungen abgeschlossen bis', 'Nach dem Jahresabschluss setzen: Buchungen bis zu diesem Datum können dann nicht mehr geändert werden (nur noch Korrekturen mit neuem Datum).', 'date')}</div>\n        <div class=\"card\"><h2>Standardkosten für den Deckungsbeitrag</h2><p class=\"hint\">Werden mit einem Klick bei einer Bestellung eingesetzt, wenn dort noch keine Kosten erfasst sind. Leer = nicht verwenden.</p>\n          <div class=\"form-grid\"><label>T-Shirt-Einkauf pro Shirt (CHF)<input id=\"s-bh_std_textilien\" inputmode=\"decimal\" value=\"${money('bh_std_textilien')}\"></label><label>Druck pro Shirt (CHF)<input id=\"s-bh_std_druck\" inputmode=\"decimal\" value=\"${money('bh_std_druck')}\"></label>\n          <label>Verpackung pro Bestellung (CHF)<input id=\"s-bh_std_verpackung\" inputmode=\"decimal\" value=\"${money('bh_std_verpackung')}\"></label><label>Versand pro Bestellung (CHF)<input id=\"s-bh_std_versand\" inputmode=\"decimal\" value=\"${money('bh_std_versand')}\"></label>\n          <label>Zahlungsgebühren in % vom Betrag<input id=\"s-bh_std_gebuehren_prozent\" inputmode=\"decimal\" value=\"${esc(s.bh_std_gebuehren_prozent)}\" placeholder=\"z. B. 1.3\"></label></div></div>\n      </div><p><button class=\"btn btn-main\" type=\"submit\">Einstellungen speichern</button></p></form>\n      <div class=\"card\"><h2>Kategorien <button class=\"btn btn-small\" id=\"k-neu\" type=\"button\">＋ Neue Kategorie</button></h2><h3>Ausgaben</h3><div class=\"chips\">${kat('ausgabe')}</div><h3 style=\"margin-top:14px\">Einnahmen</h3><div class=\"chips\">${kat('einnahme')}</div><p class=\"hint\">Antippen zum Umbenennen oder Deaktivieren.</p></div>`;\n  };\n\n  // ---- Bestellung: Buchhaltungs-Karte (Zahlungen, Rechnung, Kosten und Deckungsbeitrag) ----\n  const origOrders = PAGES.bestellungen;\n  PAGES.bestellungen = async id => {\n    const html = await origOrders(id);\n    if (id && /^\\d+$/.test(id)) after(() => orderCard(id).catch(failed));\n    return html;\n  };\n  async function orderCard(id) {\n    const box = document.createElement('div'); box.className = 'card no-print'; box.id = 'bh-order';\n    const target = content.querySelector('.grid.two'); if (!target) return;\n    target.after(box);\n    const draw = async () => {\n      const [k, p] = await Promise.all([api(`/api/bh/kosten/${id}`), api(`/api/bh/zahlungen/${id}`)]), c = k.rechnung, o = p.bestellung;\n      const have = Object.fromEntries(k.kosten.map(x => [x.art, x]));\n      box.innerHTML = `<h2>Buchhaltung</h2><div class=\"grid two\">\n        <div><h3>Zahlungen</h3><p>${badge(ZUSTAND, o.ueberfaellig ? 'ueberfaellig' : o.zustand)} Total ${chf(o.total_rappen)} · bezahlt <b>${chf(o.bezahlt)}</b> · offen <b>${chf(o.offen)}</b>${o.erstattet ? ` · erstattet ${chf(o.erstattet)}` : ''}</p>\n          ${p.zahlungen.length ? `<table><tbody>${p.zahlungen.map(z => `<tr class=\"${z.storniert ? 'bh-storno' : ''}\"><td>${date(z.datum)}</td><td class=\"small\">${z.ref} · ${esc(z.zahlungsart || '')}</td><td class=\"num\">${chf(z.betrag_rappen)}</td></tr>`).join('')}</tbody></table>` : '<p class=\"muted small\">Noch keine Zahlung gebucht.</p>'}\n          <p class=\"actions\" style=\"margin-top:8px\">${o.offen > 0 ? '<button class=\"btn btn-small btn-main\" id=\"bo-pay\">Zahlung / Teilzahlung erfassen</button>' : ''}${o.rechnung_id ? `<a class=\"btn btn-small\" href=\"#/bh-rechnungen/${o.rechnung_id}\">🧾 Rechnung ${esc(o.rechnung_nr)}</a>` : o.status !== 'storniert' ? '<button class=\"btn btn-small\" id=\"bo-inv\">🧾 Rechnung erstellen</button>' : ''}</p></div>\n        <div><h3>Direkte Kosten und Deckungsbeitrag</h3><div class=\"form-grid\">${Object.entries(KOSTEN).map(([a, l]) => `<label>${l}${['textilien', 'druck', 'verpackung', 'versand', 'gebuehren'].includes(a) && !have[a] ? ' <span class=\"badge warn\">fehlt</span>' : ''}<input data-kost=\"${a}\" inputmode=\"decimal\" value=\"${have[a] ? amount(have[a].betrag_rappen) : ''}\" placeholder=\"0.00\"></label>`).join('')}</div>\n          <p class=\"actions\" style=\"margin-top:8px\"><button class=\"btn btn-small btn-main\" id=\"bo-save\">Kosten speichern</button><button class=\"btn btn-small\" id=\"bo-std\">Standardkosten einsetzen</button></p>\n          <dl class=\"facts\"><dt>Erlös${k.mwst_pflichtig ? ' netto' : ''}</dt><dd>${chf(c.erloes_netto)}</dd><dt>Direkte Kosten</dt><dd>${chf(c.kosten_summe)}</dd><dt>Deckungsbeitrag</dt><dd><b>${c.vollstaendig ? '' : '≈ '}${chf(c.deckungsbeitrag)}</b>${c.marge !== null ? ` (${c.vollstaendig ? '' : '≈ '}${c.marge.toLocaleString('de-CH')} %)` : ''}</dd></dl>\n          ${c.vollstaendig ? '' : `<p class=\"hint\">⚠ Unvollständig – es fehlen: ${c.fehlt.map(a => KOSTEN[a]).join(', ')}. Kosten von 0 bitte als 0.00 eintragen.</p>`}<p class=\"hint\">Nur zur Kalkulation – zählt nicht als Ausgabe (echte Einkäufe unter Ausgaben erfassen).</p></div></div>`;\n      $('bo-pay')?.addEventListener('click', () => paymentForm(o, () => render()));\n      $('bo-inv')?.addEventListener('click', async () => { try { const r = await api('/api/bh/rechnungen', {method: 'POST', body: {bestellung_id: Number(id)}}); toast(`Rechnung ${r.nummer || ''} erstellt.`); location.hash = '#/bh-rechnungen/' + r.id; } catch (e) { failed(e); } });\n      $('bo-save').addEventListener('click', async () => {\n        const kosten = {}; box.querySelectorAll('[data-kost]').forEach(i => { kosten[i.dataset.kost] = i.value.trim(); });\n        try { await api(`/api/bh/kosten/${id}`, {method: 'PUT', body: {kosten}}); toast('Kosten gespeichert.'); draw().catch(failed); } catch (e) { failed(e); }\n      });\n      $('bo-std').addEventListener('click', async () => { try { await api(`/api/bh/kosten/${id}/standard`, {method: 'POST'}); toast('Standardkosten eingesetzt.'); draw().catch(failed); } catch (e) { failed(e); } });\n    };\n    box.innerHTML = '<p class=\"loading\">Buchhaltung wird geladen …</p>';\n    await draw();\n  }\n})();\n";
const ADMIN_CSS = "/* ShirtBOX Verwaltung – dunkelblaue Navigation, helle Arbeitsfläche, Orange als Akzent. */\n:root{\n  --navy:#131c30;--navy-2:#1c2741;--navy-3:#2b3856;--paper:#f6f4ef;--card:#fff;--ink:#131c30;--ink-2:#465063;--ink-3:#7a8394;\n  --line:#e4e0d7;--line-2:#d3cec3;--accent:#ff5b2e;--accent-2:#e2481f;--accent-soft:#fff1ea;--fire:linear-gradient(100deg,#ff3d2e,#ff7a2b 55%,#ffb43a);\n  --good:#1f8a55;--good-soft:#e5f5ec;--warn:#a86a00;--warn-soft:#fff4d6;--bad:#c42b1c;--bad-soft:#fde8e6;--info:#2f5bd3;--info-soft:#e8eefc;\n  --radius:16px;--shadow:0 1px 2px #131c3014,0 6px 20px #131c300d;\n  --font:\"Segoe UI Variable Text\",\"Segoe UI\",system-ui,-apple-system,\"Helvetica Neue\",Arial,sans-serif;\n}\n*,*::before,*::after{box-sizing:border-box}\nhtml{-webkit-text-size-adjust:100%}\nbody{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 var(--font);-webkit-font-smoothing:antialiased}\n[hidden]{display:none!important}\na{color:var(--accent-2)}\nh1,h2,h3{margin:0 0 .4em;line-height:1.15;letter-spacing:-.02em}\nh1{font-size:clamp(24px,3vw,30px)}h2{font-size:19px}h3{font-size:16px}\n.muted{color:var(--ink-3)}.small{font-size:13px}\n.error{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:var(--bad-soft);color:var(--bad);font-weight:600}\ninput,select,textarea,button{font:inherit;color:inherit}\ninput,select,textarea{width:100%;min-height:42px;padding:9px 12px;border:1.5px solid var(--line-2);border-radius:10px;background:#fff}\ntextarea{min-height:110px;resize:vertical;line-height:1.5}\ninput:focus,select:focus,textarea:focus{outline:2px solid #ff5b2e55;border-color:var(--accent)}\nlabel{display:block;font-weight:650;font-size:14px}\nlabel>input,label>select,label>textarea{margin-top:5px;font-weight:400}\n.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;padding:0 16px;border:1.5px solid var(--line-2);border-radius:999px;background:#fff;color:var(--ink);font-weight:700;text-decoration:none;cursor:pointer;white-space:nowrap}\n.btn:hover{border-color:var(--ink)}\n.btn-main{border:0;background:var(--fire);color:var(--navy);box-shadow:0 6px 18px #ff5b2e40}\n.btn-main:hover{filter:brightness(1.05)}\n.btn-dark{border:0;background:var(--navy);color:#fff}\n.btn-danger{border-color:#f0b7b0;color:var(--bad)}\n.btn-danger:hover{border-color:var(--bad);background:var(--bad-soft)}\n.btn-small{min-height:34px;padding:0 12px;font-size:13.5px}\n.btn:disabled{opacity:.5;cursor:not-allowed}\n\n/* Anmeldung */\n.login{min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(900px 600px at 80% -10%,#ff5b2e33,transparent 70%),radial-gradient(900px 600px at 0% 110%,#4f7bff40,transparent 70%),var(--navy)}\n.login-card{width:min(400px,100%);padding:28px;border-radius:22px;background:#fff;box-shadow:0 30px 70px #0006}\n.login-card label{margin:14px 0}\n.login-card .btn{width:100%;margin-top:6px;min-height:50px;font-size:16px}\n.brand{display:flex;align-items:center;gap:10px;margin:0 0 16px;font-weight:900;font-size:21px;letter-spacing:-.04em}\n.brand img{border-radius:11px}.brand b{background:var(--fire);-webkit-background-clip:text;background-clip:text;color:transparent}.brand small{font-size:.62em;opacity:.55;font-weight:700}\n\n/* Gerüst */\n.app{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}\n.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:20px 14px;background:var(--navy);color:#e8ebf1;overflow-y:auto}\n.side .brand{color:#f4f1ea;padding:0 8px}\n.side nav{display:flex;flex-direction:column;gap:2px}\n.side nav a{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;color:#c4cbd8;font-weight:650;text-decoration:none}\n.side nav a i{font-style:normal;width:22px;text-align:center}\n.side nav a:hover{background:#ffffff12;color:#fff}\n.side nav a.active{background:#ffffff1c;color:#fff;box-shadow:inset 3px 0 0 var(--accent)}\n.logout{margin-top:auto;padding:10px 12px;border:1px solid #ffffff2b;border-radius:12px;background:transparent;color:#c4cbd8;font-weight:650;cursor:pointer}\n.logout:hover{background:#ffffff12;color:#fff}\n.topbar{display:none}\n.content{min-width:0;padding:28px clamp(16px,3vw,36px) 60px;outline:none}\n.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 20px}\n.page-head p{margin:2px 0 0}\n.actions{display:flex;gap:8px;flex-wrap:wrap}\n\n/* Karten und Kennzahlen */\n.card{padding:18px 20px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow)}\n.card+.card,.card+.grid,.grid+.card,.grid+.grid{margin-top:16px}\n.card h2{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}\n.grid{display:grid;gap:12px}\n.kpis{grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}\n.kpi{padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:var(--shadow)}\n.kpi span{display:block;color:var(--ink-3);font-size:12.5px;font-weight:650;text-transform:uppercase;letter-spacing:.05em}\n.kpi strong{display:block;margin-top:2px;font-size:clamp(18px,1.6vw,23px);letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}\n.kpi small{display:block;color:var(--ink-3);font-size:12.5px}\n.kpi.highlight{border-color:#ffd2bd;background:var(--accent-soft)}\n.two{grid-template-columns:repeat(2,minmax(0,1fr))}\n.three{grid-template-columns:repeat(3,minmax(0,1fr))}\n\n/* Tabellen */\n.table-wrap{overflow-x:auto;margin:0 -20px;padding:0 20px}\ntable{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}\nth{padding:9px 10px;border-bottom:2px solid var(--line);color:var(--ink-3);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;white-space:nowrap}\ntd{padding:10px;border-bottom:1px solid var(--line);vertical-align:middle}\ntr.click{cursor:pointer}tr.click:hover td{background:#faf8f4}\ntd.num,th.num{text-align:right;white-space:nowrap}\n.thumb{width:54px;height:36px;object-fit:cover;border-radius:6px;background:#747474;display:block}\n.empty{padding:26px;border:2px dashed var(--line);border-radius:14px;color:var(--ink-3);text-align:center}\n\n/* Filterzeile */\n.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:0 0 14px}\n.filters>*{flex:1 1 150px}\n.filters .grow{flex:3 1 240px}\n.filters label{font-size:12.5px;color:var(--ink-3)}\n.pager{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;color:var(--ink-3);font-size:13.5px}\n\n/* Status-Abzeichen: immer mit Text, nie nur Farbe. */\n.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:12.5px;font-weight:700;white-space:nowrap;background:#eef0f4;color:var(--ink-2)}\n.badge.good{background:var(--good-soft);color:var(--good)}.badge.warn{background:var(--warn-soft);color:var(--warn)}\n.badge.bad{background:var(--bad-soft);color:var(--bad)}.badge.info{background:var(--info-soft);color:var(--info)}.badge.accent{background:var(--accent-soft);color:var(--accent-2)}\n\n/* Details */\n.facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}\n.facts dt{color:var(--ink-3);font-size:13.5px}.facts dd{margin:0;font-weight:600;overflow-wrap:anywhere}\n.design{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:18px;padding:16px 0;border-top:1px solid var(--line)}\n.design:first-of-type{border-top:0}\n.design img{width:100%;border-radius:12px;background:#747474;display:block}\n.design pre{white-space:pre-wrap;font:12.5px/1.5 var(--font);margin:8px 0 0;padding:10px 12px;border-radius:10px;background:#f4f1ea;color:var(--ink-2)}\n.status-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n\n/* Diagramm: eine Reihe, Balken mit gerundeten Enden, Tooltip beim Darüberfahren. */\n.chart{position:relative}\n.chart svg{display:block;width:100%;height:260px;overflow:visible}\n.chart .bar{fill:#ff6a2b}.chart .bar:hover,.chart .bar.on{fill:#e2481f}\n.chart .hit{fill:transparent;cursor:crosshair}\n.chart .grid-line{stroke:#ece8df;stroke-width:1}\n.chart .axis{fill:var(--ink-3);font-size:11px}\n.chart-tip{position:absolute;pointer-events:none;padding:8px 10px;border-radius:10px;background:var(--navy);color:#fff;font-size:12.5px;line-height:1.35;white-space:nowrap;transform:translate(-50%,-100%);box-shadow:0 8px 20px #0003}\n.chart-tip b{display:block;font-size:14px}\n.seg{display:inline-flex;padding:3px;border-radius:999px;background:#eef0f4}\n.seg button{min-height:32px;padding:0 12px;border:0;border-radius:999px;background:transparent;font-size:13px;font-weight:700;color:var(--ink-2);cursor:pointer}\n.seg button.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px #0002}\ndetails.table-view{margin-top:10px}details.table-view summary{cursor:pointer;color:var(--ink-3);font-size:13px}\n\n/* Newsletter-Editor */\n.editor{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}\n.editor .preview{position:sticky;top:16px}\n.preview iframe{width:100%;height:calc(100vh - 140px);min-height:520px;border:1px solid var(--line);border-radius:14px;background:#ece8e0}\n.block{position:relative;margin:0 0 10px;padding:14px;border:1.5px solid var(--line);border-radius:14px;background:#fff}\n.block-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;font-weight:750;font-size:13.5px;color:var(--ink-2)}\n.block-tools{display:flex;gap:4px}\n.block-tools button{width:32px;height:32px;border:1px solid var(--line-2);border-radius:8px;background:#fff;cursor:pointer}\n.block-tools button:hover{border-color:var(--ink)}\n.block .row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}\n.block label{margin-top:8px}\n.block img.mini{max-width:160px;max-height:100px;border-radius:8px;display:block;margin-top:6px}\n.add-blocks{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 16px}\n.hint{margin:6px 0 0;color:var(--ink-3);font-size:12.5px}\n.send-box{margin-top:16px;padding:16px;border:2px solid #ffd2bd;border-radius:14px;background:var(--accent-soft)}\n.send-box .btn-main{min-height:52px;padding:0 26px;font-size:16px}\n\n/* Dialog und Meldung */\n.dialog{width:min(480px,calc(100vw - 32px));padding:0;border:0;border-radius:18px;box-shadow:0 30px 70px #0005}\n.dialog::backdrop{background:#131c30aa}\n#dialog-body{padding:22px 22px 6px}\n.dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:14px 22px 20px}\n.toast{position:fixed;left:50%;bottom:24px;z-index:50;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:12px 18px;border-radius:12px;background:var(--navy);color:#fff;font-weight:650;box-shadow:0 12px 30px #0004}\n.toast.bad{background:var(--bad)}\n.loading{padding:40px;color:var(--ink-3);text-align:center}\n.check{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}\n.check:last-child{border-bottom:0}\n\n@media(max-width:1100px){.editor{grid-template-columns:1fr}.editor .preview{position:static}.preview iframe{height:640px}}\n@media(max-width:860px){\n  .app{grid-template-columns:1fr}\n  .side{position:fixed;inset:0 auto 0 0;z-index:40;width:min(280px,84vw);transform:translateX(-100%);transition:transform .2s;box-shadow:20px 0 50px #0005}\n  .side.open{transform:none}\n  .topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--navy);color:#fff}\n  .menu-btn{min-height:40px;padding:0 14px;border:1px solid #ffffff33;border-radius:999px;background:transparent;color:#fff;font-weight:700;cursor:pointer}\n  .topbar-title{font-weight:750}\n  .content{padding:18px 16px 50px}\n  .two,.three,.design,.status-row{grid-template-columns:1fr}\n  .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .kpi strong{font-size:18px}\n  .card{padding:16px}\n  .table-wrap{margin:0 -16px;padding:0 16px}\n  .hide-mobile{display:none}\n}\n@media print{\n  body{background:#fff;font-size:12px}\n  .side,.topbar,.no-print,.toast{display:none!important}\n  .app{display:block}.content{padding:0}\n  .card{box-shadow:none;border:0;padding:0}\n  .design{break-inside:avoid;grid-template-columns:1.4fr 1fr}\n  a{color:inherit;text-decoration:none}\n}\n/* ===== Buchhaltung ===== */\n.side{overflow-y:auto}\n.side nav .nav-group{margin:14px 12px 4px;color:#7d889c;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}\n.side nav a.sub{padding-top:7px;padding-bottom:7px;padding-left:22px;font-size:14px}\n.bh-note{margin:4px 0 0;color:var(--ink-3);font-size:12.5px}\n.bh-quick{margin:0 0 14px}\n.kpi.alert{border-color:#f3b8b1;background:var(--bad-soft)}.kpi.alert strong{color:var(--bad)}\n.neg{color:var(--bad)}.pos{color:var(--good)}\ntr.bh-storno td{color:var(--ink-3);text-decoration:line-through;text-decoration-color:#c42b1c88}\ntr.bh-storno td .small,tr.bh-storno td button{text-decoration:none}\n.chart .bar-out{fill:#2f5bd3}.chart rect.bar:hover{opacity:.85}\n.bh-legend{display:flex;gap:14px;align-items:center;margin:0 0 6px;font-size:12.5px;color:var(--ink-2)}\n.bh-legend i{display:inline-block;width:12px;height:12px;margin-right:5px;border-radius:3px;vertical-align:-1px}.bh-legend .in{background:#ff6a2b}.bh-legend .out{background:#2f5bd3}\n.bh-bars{display:grid;gap:8px}\n.bh-bar{display:grid;grid-template-columns:minmax(110px,40%) 1fr auto;gap:10px;align-items:center;font-size:13.5px}\n.bh-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bh-bar i{display:block;height:12px;border-radius:999px;background:var(--fire)}.bh-bar b{font-variant-numeric:tabular-nums;white-space:nowrap}\n.bh-warn{background:var(--info-soft)}\n.dialog.wide{width:min(720px,calc(100vw - 24px))}\n.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px}\n.form-grid .span{grid-column:1/-1}\n.bh-receipt{display:flex;flex-wrap:wrap;gap:8px;align-items:center}\n.bh-preview iframe,.bh-preview img{display:block;width:100%;height:min(70vh,720px);border:1px solid var(--line);border-radius:10px;background:#fff;object-fit:contain}\n.chips{display:flex;flex-wrap:wrap;gap:6px}\n.chip{min-height:34px;padding:0 12px;border:1px solid var(--line-2);border-radius:999px;background:#fff;color:var(--ink);font-size:13.5px;font-weight:650;cursor:pointer}\n.chip.off{color:var(--ink-3);border-style:dashed}\n.check-row{display:flex;align-items:center;gap:8px;font-weight:650}.check-row input{width:auto;min-height:0}\n/* Rechnung: druckfertig (A4), Drucken → „Als PDF speichern“ */\n.invoice{max-width:800px;margin:0 auto;padding:44px 48px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);color:#131c30;font-size:14.5px;line-height:1.5}\n.invoice header{display:flex;justify-content:space-between;gap:24px;margin-bottom:36px}\n.invoice header img{display:block;margin-bottom:8px}\n.invoice header .to{min-width:220px;padding-top:56px}\n.invoice h2{margin:0 0 12px;font-size:24px}\n.invoice table{margin:18px 0}.invoice tfoot td{border-bottom:0;border-top:2px solid var(--ink)}\n.invoice footer{margin-top:36px;padding-top:12px;border-top:1px solid var(--line);color:var(--ink-3);font-size:12px}\n.invoice.is-storno{position:relative}.invoice.is-storno::after{content:\"STORNIERT\";position:absolute;top:40%;left:50%;translate:-50% -50%;rotate:-18deg;color:#c42b1c55;font-size:72px;font-weight:900;letter-spacing:.1em;pointer-events:none}\n@media(max-width:1100px){.seg{flex-wrap:wrap;border-radius:16px}.card h2 .seg{margin-top:6px}.form-grid{grid-template-columns:1fr}.invoice{padding:24px 20px}.invoice header{flex-direction:column}.invoice header .to{padding-top:0}.bh-bar{grid-template-columns:1fr auto}.bh-bar i{grid-column:1/-1;order:3}}\n@media print{.invoice{max-width:none;border:0;box-shadow:none;padding:0}.content{padding:0!important}}";
const SCHEMA = "-- ShirtBOX Verwaltung – Datenbank (Cloudflare D1, Name: shirtbox-verwaltung)\n-- Einmal komplett in der D1-Konsole ausführen. Mehrfaches Ausführen schadet nicht.\n-- Bereich 1: Kunden und Bestellungen. Bereich 2: Newsletter (getrennte Tabellen, nur per E-Mail verknüpfbar).\n\n-- ===== Bereich 1: Kunden und Bestellungen =====\nCREATE TABLE IF NOT EXISTS kunden (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- Kundennummer = K-(10000 + id)\n  email TEXT NOT NULL UNIQUE COLLATE NOCASE,\n  vorname TEXT NOT NULL,\n  nachname TEXT NOT NULL,\n  telefon TEXT,\n  strasse TEXT,\n  plz TEXT,\n  ort TEXT,\n  land TEXT,\n  erste_bestellung TEXT NOT NULL,                -- ISO-Zeitpunkt (UTC)\n  aktualisiert TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS bestellungen (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  bestellnummer TEXT NOT NULL UNIQUE,\n  client_id TEXT UNIQUE,                         -- Schutz gegen doppelte Speicherung\n  kunde_id INTEGER NOT NULL REFERENCES kunden(id),\n  erstellt TEXT NOT NULL,                        -- ISO-Zeitpunkt (UTC)\n  datum TEXT NOT NULL,                           -- Kalendertag in Zürich (JJJJ-MM-TT) für Auswertungen\n  anzahl INTEGER NOT NULL,\n  total_rappen INTEGER NOT NULL,\n  versand_rappen INTEGER NOT NULL DEFAULT 0,\n  status TEXT NOT NULL DEFAULT 'neu',            -- neu, bearbeitung, produziert, versendet, abgeschlossen, storniert\n  zahlung TEXT NOT NULL DEFAULT 'offen',         -- offen, bezahlt, rueckerstattet\n  bezahlt_am TEXT,\n  lieferadresse TEXT NOT NULL,                   -- Adresse zum Zeitpunkt der Bestellung (JSON)\n  notiz TEXT,\n  agb TEXT\n);\nCREATE INDEX IF NOT EXISTS bestellungen_kunde ON bestellungen(kunde_id);\nCREATE INDEX IF NOT EXISTS bestellungen_datum ON bestellungen(datum);\n\nCREATE TABLE IF NOT EXISTS bestell_designs (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id) ON DELETE CASCADE,\n  design_nr INTEGER NOT NULL,\n  anzahl INTEGER NOT NULL,\n  einzelpreis_rappen INTEGER NOT NULL,           -- Preis des ersten Shirts dieses Designs\n  summe_rappen INTEGER NOT NULL,\n  farbe TEXT,\n  details TEXT,                                  -- Platzierung / Gestaltungseinstellungen\n  bild_vorschau TEXT,                            -- R2-Schlüssel (Vorder- und Rückseite in einem Bild)\n  bild_druck TEXT,                               -- R2-Schlüssel der Druckdatei\n  bilder_original TEXT,                          -- JSON-Liste von R2-Schlüsseln\n  rechte INTEGER NOT NULL DEFAULT 0\n);\nCREATE INDEX IF NOT EXISTS bestell_designs_bestellung ON bestell_designs(bestellung_id);\n\nCREATE TABLE IF NOT EXISTS bestell_groessen (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  design_id INTEGER NOT NULL REFERENCES bestell_designs(id) ON DELETE CASCADE,\n  groesse TEXT NOT NULL,                         -- vom Kunden gewählt\n  bestellgroesse TEXT NOT NULL,                  -- beim Lieferanten (asiatisch, +2)\n  anzahl INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS bestell_groessen_design ON bestell_groessen(design_id);\n\n-- ===== Bereich 2: Newsletter =====\nCREATE TABLE IF NOT EXISTS abonnenten (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  email TEXT NOT NULL UNIQUE COLLATE NOCASE,     -- jede Adresse nur einmal\n  vorname TEXT,\n  nachname TEXT,\n  status TEXT NOT NULL DEFAULT 'ausstehend',     -- ausstehend, aktiv, abgemeldet, unzustellbar, beschwerde\n  angemeldet TEXT NOT NULL,                      -- Zeitpunkt der Anmeldung\n  einwilligung_zeit TEXT,                        -- Zeitpunkt der bestätigten Einwilligung (Double-Opt-in)\n  einwilligung_quelle TEXT,                      -- z. B. Startseite, Bestellung SB-…\n  einwilligung_text TEXT,                        -- exakter Wortlaut, dem zugestimmt wurde\n  bestaetigung_gesendet TEXT,\n  abgemeldet TEXT,\n  token TEXT NOT NULL UNIQUE                     -- geheimer Schlüssel für Bestätigungs- und Abmeldelink\n);\nCREATE INDEX IF NOT EXISTS abonnenten_status ON abonnenten(status);\n\nCREATE TABLE IF NOT EXISTS newsletter (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  betreff TEXT NOT NULL,\n  inhalt TEXT NOT NULL,                          -- JSON: Vorschautext und Blöcke\n  status TEXT NOT NULL DEFAULT 'entwurf',        -- entwurf, versand, versendet\n  erstellt TEXT NOT NULL,\n  geaendert TEXT NOT NULL,\n  versand_start TEXT,\n  versand_ende TEXT,\n  empfaenger INTEGER NOT NULL DEFAULT 0\n);\n\nCREATE TABLE IF NOT EXISTS newsletter_empfaenger (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  newsletter_id INTEGER NOT NULL REFERENCES newsletter(id) ON DELETE CASCADE,\n  abonnent_id INTEGER NOT NULL REFERENCES abonnenten(id) ON DELETE CASCADE,\n  status TEXT NOT NULL DEFAULT 'wartend',        -- wartend, gesendet, zugestellt, fehler, unzustellbar, beschwerde, uebersprungen\n  resend_id TEXT,\n  gesendet TEXT,\n  fehler TEXT,\n  UNIQUE(newsletter_id, abonnent_id)\n);\nCREATE INDEX IF NOT EXISTS newsletter_empfaenger_status ON newsletter_empfaenger(status);\nCREATE INDEX IF NOT EXISTS newsletter_empfaenger_resend ON newsletter_empfaenger(resend_id);\n\n-- ===== Verwaltung =====\nCREATE TABLE IF NOT EXISTS einstellungen (\n  schluessel TEXT PRIMARY KEY,\n  wert TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS anmeldeversuche (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  zeit TEXT NOT NULL,\n  erfolg INTEGER NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS protokoll (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  zeit TEXT NOT NULL,\n  aktion TEXT NOT NULL                           -- nur Aktionen, keine Kundendaten\n);\n\n-- ===== Bereich 3: Buchhaltung (vereinfachte Einnahmen-/Ausgabenrechnung) =====\n-- Nur neue Tabellen. Beträge in Rappen (ganze Zahlen). Nichts wird gelöscht: storniert = Zeitpunkt der Stornierung.\nCREATE TABLE IF NOT EXISTS bh_kategorien (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  art TEXT NOT NULL,                             -- ausgabe, einnahme\n  name TEXT NOT NULL,\n  aktiv INTEGER NOT NULL DEFAULT 1,\n  UNIQUE(art, name)\n);\nINSERT OR IGNORE INTO bh_kategorien (art, name) VALUES ('ausgabe', 'Textilien'), ('ausgabe', 'DTF-Druckmaterial'), ('ausgabe', 'Druckfolien und Verbrauchsmaterial'),\n  ('ausgabe', 'Verpackungsmaterial'), ('ausgabe', 'Versandkosten'), ('ausgabe', 'Software und Hosting'), ('ausgabe', 'Werbung und Marketing'),\n  ('ausgabe', 'Maschinen und Geräte'), ('ausgabe', 'Büromaterial'), ('ausgabe', 'Sonstige Betriebsausgaben'),\n  ('einnahme', 'Sonstige Verkäufe'), ('einnahme', 'Dienstleistungen'), ('einnahme', 'Sonstige Einnahmen');\n\nCREATE TABLE IF NOT EXISTS bh_lieferanten (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  kontakt TEXT, email TEXT, telefon TEXT, adresse TEXT, website TEXT, notiz TEXT,\n  erstellt TEXT NOT NULL,\n  geaendert TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS bh_belege (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- Belegreferenz B-00001\n  schluessel TEXT NOT NULL UNIQUE,               -- R2-Schlüssel belege/JJJJ/…\n  dateiname TEXT NOT NULL,\n  typ TEXT NOT NULL,\n  groesse INTEGER NOT NULL,\n  sha256 TEXT UNIQUE,                            -- gleiche Datei nur einmal\n  notiz TEXT,\n  hochgeladen TEXT NOT NULL,\n  archiviert TEXT,                               -- nie endgültig gelöscht, nur archiviert\n  archiv_grund TEXT\n);\n\nCREATE TABLE IF NOT EXISTS bh_ausgaben (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- Belegreferenz A-00001\n  datum TEXT NOT NULL,\n  lieferant_id INTEGER REFERENCES bh_lieferanten(id),\n  beschreibung TEXT NOT NULL,\n  kategorie_id INTEGER NOT NULL REFERENCES bh_kategorien(id),\n  netto_rappen INTEGER NOT NULL,\n  mwst_satz REAL NOT NULL DEFAULT 0,\n  mwst_rappen INTEGER NOT NULL DEFAULT 0,\n  brutto_rappen INTEGER NOT NULL,\n  zahlungsart TEXT,\n  zahlung TEXT NOT NULL DEFAULT 'bezahlt',       -- offen, bezahlt\n  bezahlt_am TEXT,\n  beleg_id INTEGER REFERENCES bh_belege(id),\n  wiederkehrend TEXT NOT NULL DEFAULT '',        -- '', monatlich, jaehrlich\n  vorlage_id INTEGER,                            -- automatisch erzeugt aus dieser wiederkehrenden Ausgabe\n  periode TEXT,                                  -- JJJJ-MM der automatischen Erfassung\n  notiz TEXT,\n  storniert TEXT,\n  storno_grund TEXT,\n  erstellt TEXT NOT NULL,\n  geaendert TEXT NOT NULL,\n  UNIQUE(vorlage_id, periode)\n);\nCREATE INDEX IF NOT EXISTS bh_ausgaben_datum ON bh_ausgaben(datum);\nCREATE INDEX IF NOT EXISTS bh_ausgaben_lieferant ON bh_ausgaben(lieferant_id);\n\nCREATE TABLE IF NOT EXISTS bh_einnahmen (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- nur manuelle Einnahmen (Bestellungen laufen über bh_zahlungen), Referenz E-00001\n  datum TEXT NOT NULL,\n  beschreibung TEXT NOT NULL,\n  kunde TEXT,\n  kategorie_id INTEGER NOT NULL REFERENCES bh_kategorien(id),\n  betrag_rappen INTEGER NOT NULL,\n  mwst_satz REAL NOT NULL DEFAULT 0,\n  mwst_rappen INTEGER NOT NULL DEFAULT 0,\n  zahlungsart TEXT,\n  beleg_id INTEGER REFERENCES bh_belege(id),\n  bestellung_id INTEGER REFERENCES bestellungen(id),\n  notiz TEXT,\n  storniert TEXT,\n  storno_grund TEXT,\n  erstellt TEXT NOT NULL,\n  geaendert TEXT NOT NULL\n);\nCREATE INDEX IF NOT EXISTS bh_einnahmen_datum ON bh_einnahmen(datum);\n\nCREATE TABLE IF NOT EXISTS bh_zahlungen (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- Zahlungseingänge und Rückerstattungen zu Bestellungen, Referenz Z-00001\n  bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id),\n  datum TEXT NOT NULL,\n  betrag_rappen INTEGER NOT NULL,                -- Rückerstattung negativ\n  art TEXT NOT NULL,                             -- zahlung, rueckerstattung\n  zahlungsart TEXT,\n  quelle TEXT NOT NULL DEFAULT 'manuell',        -- manuell, status (aus Bestellansicht), uebernahme\n  notiz TEXT,\n  storniert TEXT,\n  storno_grund TEXT,\n  erstellt TEXT NOT NULL\n);\nCREATE INDEX IF NOT EXISTS bh_zahlungen_bestellung ON bh_zahlungen(bestellung_id);\nCREATE INDEX IF NOT EXISTS bh_zahlungen_datum ON bh_zahlungen(datum);\n\nCREATE TABLE IF NOT EXISTS bh_kosten (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- direkte Kosten pro Bestellung (Kalkulation, nicht als Ausgabe gezählt)\n  bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id),\n  art TEXT NOT NULL,                             -- textilien, druck, verpackung, versand, gebuehren, sonstiges\n  betrag_rappen INTEGER NOT NULL,\n  notiz TEXT,\n  geaendert TEXT NOT NULL,\n  UNIQUE(bestellung_id, art)\n);\n\nCREATE TABLE IF NOT EXISTS bh_rechnungen (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  nummer TEXT NOT NULL UNIQUE,                   -- RE-2026-0001 bzw. GS-2026-0001, fortlaufend, nie verändert\n  art TEXT NOT NULL,                             -- rechnung, gutschrift\n  bestellung_id INTEGER REFERENCES bestellungen(id),\n  bezug_id INTEGER REFERENCES bh_rechnungen(id), -- Gutschrift: zugehörige Rechnung\n  datum TEXT NOT NULL,\n  faellig TEXT NOT NULL,\n  betrag_rappen INTEGER NOT NULL,\n  daten TEXT NOT NULL,                           -- festgehaltener Rechnungsinhalt (JSON)\n  beleg_id INTEGER REFERENCES bh_belege(id),\n  storniert TEXT,\n  storno_grund TEXT,\n  erstellt TEXT NOT NULL\n);\nCREATE UNIQUE INDEX IF NOT EXISTS bh_rechnung_je_bestellung ON bh_rechnungen(bestellung_id) WHERE art = 'rechnung' AND storniert IS NULL;\n";

const VERSION = '20261031-buchhaltung';
const PUBLIC_WORKER = 'https://shirtbox-email.r-n.workers.dev';
const SITE = 'https://shirtbox.ch';
const STATUS = ['neu', 'bearbeitung', 'produziert', 'versendet', 'abgeschlossen', 'storniert'];
const ZAHLUNG = ['offen', 'teilweise', 'bezahlt', 'rueckerstattet']; // „teilweise“ entsteht nur über Teilzahlungen in der Buchhaltung
const DEFAULTS = {
  test_email: 'r-n@gmx.ch', absender_name: 'ShirtBOX', absender_email: 'newsletter@shirtbox.ch', antwort_email: 'info@shirtbox.ch',
  adresse: 'ShirtBOX.ch · Rudi Nagl · Leinackerweg 19 · 5014 Gretzenbach · Schweiz', tageslimit: '80', monatslimit: '2500', timeout: '30'
};
const SECURITY = {'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Strict-Transport-Security': 'max-age=31536000', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {status, headers: {...SECURITY, 'Content-Type': 'application/json; charset=utf-8', ...extra}});
const fail = (status, error) => json({error}, status);
const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const nowIso = () => new Date().toISOString();
const zurichDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
const enc = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    try { return await handle(request, env, ctx); }
    catch (e) { console.error('Verwaltung Fehler', String(e?.message || e)); return fail(500, 'Interner Fehler. Bitte später erneut versuchen.'); }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await ensureSchema(env); await processQueue(env); await setSetting(env, 'letzter_lauf', nowIso());
        await env.DB.prepare('DELETE FROM anmeldeversuche WHERE zeit < ?').bind(new Date(Date.now() - 7 * 86400000).toISOString()).run();
      } catch (e) { console.error('Verwaltung Cron', String(e?.message || e)); }
    })());
  }
};

async function handle(request, env, ctx) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  // Schicht 1: Cloudflare Access (nur Ihre E-Mail-Adresse). Ist es eingerichtet, prüft der Worker zusätzlich dessen Ausweis.
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD && !(await verifyAccess(request, env))) return new Response('Kein Zugriff', {status: 403, headers: SECURITY});
  if (method === 'GET' && (path === '/' || path === '/index.html')) return new Response(ADMIN_HTML, {headers: {...SECURITY, 'Content-Type': 'text/html; charset=utf-8'}});
  if (method === 'GET' && path === '/app.js') return new Response(ADMIN_JS, {headers: {...SECURITY, 'Content-Type': 'text/javascript; charset=utf-8'}});
  if (method === 'GET' && path === '/app.css') return new Response(ADMIN_CSS, {headers: {...SECURITY, 'Content-Type': 'text/css; charset=utf-8'}});
  if (!path.startsWith('/api/')) return new Response('Nicht gefunden', {status: 404, headers: SECURITY});
  if (!env.DB) return fail(503, 'Die Datenbank ist noch nicht verbunden (Binding DB fehlt).');
  if (!env.ADMIN_PASSWORD || !env.ADMIN_TOTP_SECRET) return fail(503, 'Passwort oder Zwei-Faktor-Schlüssel sind noch nicht eingerichtet.');
  // Schutz gegen fremde Seiten: Änderungen nur mit eigenem Kopfzeilen-Merkmal (erzwingt gleiche Herkunft).
  if (method !== 'GET' && request.headers.get('X-ShirtBOX') !== '1') return fail(403, 'Ungültige Anfrage.');
  await ensureSchema(env);
  const settings = await getSettings(env);
  if (path === '/api/login' && method === 'POST') return login(request, env, settings);
  const session = await readSession(request, env, settings);
  if (path === '/api/sitzung') return json({angemeldet: !!session, timeout: Number(settings.timeout) || 30, version: VERSION}, 200, session ? {'Set-Cookie': await sessionCookie(env, session.start)} : {});
  if (!session) return fail(401, 'Bitte melden Sie sich an.');
  if (path === '/api/logout' && method === 'POST') return json({ok: true}, 200, {'Set-Cookie': 'sb_sitzung=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict'});
  const response = await route(request, env, ctx, url, settings);
  // Gleitende Sitzung: jede Aktion verlängert die Inaktivitätsfrist.
  if (!response.headers.has('Set-Cookie')) response.headers.set('Set-Cookie', await sessionCookie(env, session.start));
  return response;
}

async function route(request, env, ctx, url, settings) {
  const path = url.pathname, method = request.method, q = url.searchParams;
  const part = path.split('/').filter(Boolean); // ['api', 'kunden', '12', ...]
  const id = Number(part[2]);
  if (path === '/api/dashboard') return json(await dashboard(env));
  if (path === '/api/umsatz') return json(await revenue(env, q.get('zeitraum') === '12m' ? '12m' : '30t', q.get('art') === 'bezahlt' ? 'bezahlt' : 'bestellwert'));
  if (part[1] === 'kunden') {
    if (part.length === 2) return json(await customers(env, q));
    if (part[3] === 'auskunft') return customerExport(env, id);
    if (method === 'DELETE') return deleteCustomer(request, env, id);
    return customer(env, id);
  }
  if (part[1] === 'bestellungen') {
    if (part.length === 2) return json(await orders(env, q));
    if (method === 'PATCH') return updateOrder(request, env, id);
    return order(env, id);
  }
  if (part[1] === 'abonnenten') {
    if (part.length === 2) return json(await subscribers(env, q));
    if (method === 'PATCH') return updateSubscriber(request, env, id);
    if (method === 'DELETE') { await env.DB.prepare('DELETE FROM abonnenten WHERE id = ?').bind(id).run(); await log(env, `Abonnent #${id} gelöscht`); return json({ok: true}); }
  }
  if (part[1] === 'newsletter') return newsletterRoute(request, env, ctx, part, settings);
  if (part[1] === 'bh') return bhRoute(request, env, part, q);
  if (path === '/api/bild' && method === 'GET') return image(env, q.get('k') || '');
  if (path === '/api/bild' && method === 'POST') return uploadImage(request, env);
  if (part[1] === 'export') return exportCsv(env, part[2] || '');
  if (path === '/api/einstellungen') {
    if (method === 'PUT') return saveSettings(request, env);
    return json({einstellungen: settings, status: await systemStatus(env, settings), protokoll: (await env.DB.prepare('SELECT zeit, aktion FROM protokoll ORDER BY id DESC LIMIT 40').all()).results});
  }
  return fail(404, 'Nicht gefunden.');
}

// ---------------------------------------------------------------------------
// Datenbank-Schema: wird beim ersten Aufruf automatisch angelegt (idempotent).
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  // Alle Anweisungen sind wiederholbar (IF NOT EXISTS / INSERT OR IGNORE): fehlt die neueste Tabelle, wird nur Fehlendes ergänzt –
  // bestehende Tabellen und Daten bleiben unverändert.
  const exists = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bh_rechnungen'").first();
  if (!exists) {
    const statements = SCHEMA.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
    await env.DB.batch(statements.map(s => env.DB.prepare(s)));
  }
  schemaReady = true;
}

async function getSettings(env) {
  const rows = (await env.DB.prepare('SELECT schluessel, wert FROM einstellungen').all()).results;
  return {...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.schluessel, r.wert]))};
}
const setSetting = (env, key, value) => env.DB.prepare('INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert').bind(key, String(value)).run();
const log = (env, aktion) => env.DB.prepare('INSERT INTO protokoll (zeit, aktion) VALUES (?, ?)').bind(nowIso(), aktion).run();

async function saveSettings(request, env) {
  const data = await request.json().catch(() => ({}));
  const value = {};
  for (const key of ['test_email', 'absender_name', 'absender_email', 'antwort_email', 'adresse']) if (key in data) value[key] = clean(data[key], 300);
  for (const key of ['tageslimit', 'monatslimit', 'timeout']) if (key in data) {
    const n = Math.round(Number(data[key]));
    if (!Number.isFinite(n) || n < 1 || n > 1000000) return fail(400, 'Bitte gültige Zahlen eingeben.');
    value[key] = String(key === 'timeout' ? Math.min(240, Math.max(5, n)) : n);
  }
  for (const key of ['test_email', 'absender_email', 'antwort_email']) if (value[key] !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value[key])) return fail(400, 'Bitte gültige E-Mail-Adressen eingeben.');
  await env.DB.batch(Object.entries(value).map(([k, v]) => env.DB.prepare('INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert').bind(k, v)));
  await log(env, 'Einstellungen geändert');
  return json({ok: true});
}

async function systemStatus(env, settings) {
  const {today, month} = await sentCounts(env);
  let resend = false;
  if (env.RESEND_API_KEY) resend = true;
  return {
    version: VERSION, datenbank: true, bilder: !!env.BILDER, resend, access: !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD),
    letzter_lauf: settings.letzter_lauf || null, heute_gesendet: today, monat_gesendet: month,
    tageslimit: Number(settings.tageslimit), monatslimit: Number(settings.monatslimit)
  };
}

// ---------------------------------------------------------------------------
// Anmeldung: Passwort + 6-stelliger Code aus der Authenticator-App. Nach 5 Fehlversuchen 15 Minuten Sperre.
async function login(request, env, settings) {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const failed = (await env.DB.prepare('SELECT COUNT(*) AS n FROM anmeldeversuche WHERE erfolg = 0 AND zeit > ?').bind(since).first()).n;
  if (failed >= 5) return fail(429, 'Zu viele Fehlversuche. Bitte warten Sie 15 Minuten.');
  const data = await request.json().catch(() => ({}));
  const passwordOk = await safeEqual(String(data.passwort || ''), String(env.ADMIN_PASSWORD));
  const codeOk = await verifyTotp(String(env.ADMIN_TOTP_SECRET), String(data.code || '').replace(/\s/g, ''));
  await env.DB.prepare('INSERT INTO anmeldeversuche (zeit, erfolg) VALUES (?, ?)').bind(nowIso(), passwordOk && codeOk ? 1 : 0).run();
  if (!passwordOk || !codeOk) return fail(401, 'Passwort oder Code ist falsch.');
  await log(env, 'Anmeldung erfolgreich');
  return json({ok: true, timeout: Number(settings.timeout) || 30}, 200, {'Set-Cookie': await sessionCookie(env, Date.now())});
}

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', enc.encode(`${env.ADMIN_PASSWORD}|${env.ADMIN_TOTP_SECRET}|sitzung`), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
}
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function safeEqual(a, b) {
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const [x, y] = await Promise.all([crypto.subtle.sign('HMAC', key, enc.encode(a)), crypto.subtle.sign('HMAC', key, enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0 && a.length > 0;
}

async function sessionCookie(env, start) {
  const payload = `${start}.${Date.now()}`;
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload)));
  return `sb_sitzung=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
}

async function readSession(request, env, settings) {
  const cookie = (request.headers.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith('sb_sitzung='));
  if (!cookie) return null;
  const [start, last, sig] = cookie.slice(11).split('.');
  if (!start || !last || !sig) return null;
  const expected = b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(`${start}.${last}`)));
  if (!(await safeEqual(sig, expected))) return null;
  const timeout = (Number(settings.timeout) || 30) * 60000;
  if (Date.now() - Number(last) > timeout || Date.now() - Number(start) > 12 * 3600000) return null;
  return {start: Number(start)};
}

function base32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '', out = [];
  for (const ch of clean) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(out);
}

async function verifyTotp(secret, code) {
  if (!/^\d{6}$/.test(code)) return false;
  const key = await crypto.subtle.importKey('raw', base32(secret), {name: 'HMAC', hash: 'SHA-1'}, false, ['sign']);
  const step = Math.floor(Date.now() / 30000);
  for (const offset of [-1, 0, 1]) {
    const counter = new ArrayBuffer(8), view = new DataView(counter);
    view.setUint32(4, step + offset);
    const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter)), o = h[19] & 15;
    const value = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000;
    if (String(value).padStart(6, '0') === code) return true;
  }
  return false;
}

// Cloudflare-Access-Ausweis (JWT, RS256) gegen die öffentlichen Schlüssel des Teams prüfen.
let accessKeys = null, accessKeysAt = 0;
async function verifyAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  try {
    const [h, p, s] = token.split('.');
    const decode = part => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
    const header = decode(h), payload = decode(p);
    const team = String(env.ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!accessKeys || Date.now() - accessKeysAt > 3600000) {
      accessKeys = (await (await fetch(`https://${team}/cdn-cgi/access/certs`)).json()).keys; accessKeysAt = Date.now();
    }
    const jwk = accessKeys.find(k => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
    const signature = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, enc.encode(`${h}.${p}`));
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    return valid && aud.includes(String(env.ACCESS_AUD).trim()) && payload.exp * 1000 > Date.now() && payload.iss === `https://${team}`;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Dashboard und Umsatz. Stornierte Bestellungen zählen nicht zum Bestellwert.
function periodStarts() {
  const today = zurichDay();
  const d = new Date(`${today}T12:00:00Z`), weekday = (d.getUTCDay() + 6) % 7;
  const week = new Date(d.getTime() - weekday * 86400000).toISOString().slice(0, 10);
  return {today, week, month: today.slice(0, 8) + '01'};
}

async function dashboard(env) {
  const {today, week, month} = periodStarts();
  const row = await env.DB.prepare(`SELECT
      SUM(datum = ?1) AS heute, SUM(datum >= ?2) AS woche, SUM(datum >= ?3) AS monat, COUNT(*) AS total,
      SUM(CASE WHEN datum = ?1 THEN total_rappen END) AS umsatz_heute, SUM(CASE WHEN datum >= ?2 THEN total_rappen END) AS umsatz_woche,
      SUM(CASE WHEN datum >= ?3 THEN total_rappen END) AS umsatz_monat, SUM(total_rappen) AS umsatz_total,
      SUM(zahlung IN ('offen', 'teilweise')) AS offen, SUM(zahlung = 'bezahlt') AS bezahlt, SUM(anzahl) AS shirts,
      SUM(CASE WHEN zahlung = 'bezahlt' THEN total_rappen END) AS bezahlt_rappen
    FROM bestellungen WHERE status != 'storniert'`).bind(today, week, month).first();
  const extra = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM kunden) AS kunden,
      (SELECT COUNT(*) FROM abonnenten WHERE status = 'aktiv') AS abonnenten,
      (SELECT COUNT(*) FROM abonnenten WHERE status = 'ausstehend') AS ausstehend,
      (SELECT COUNT(*) FROM abonnenten WHERE status IN ('abgemeldet', 'beschwerde')) AS abgemeldet,
      (SELECT COUNT(*) FROM bestellungen WHERE status = 'storniert') AS storniert,
      (SELECT SUM(total_rappen) FROM bestellungen WHERE zahlung = 'rueckerstattet') AS rueckerstattet_rappen,
      (SELECT COUNT(*) FROM bestellungen WHERE status IN ('neu', 'bearbeitung', 'produziert')) AS in_arbeit`).first();
  const latest = (await env.DB.prepare(`SELECT b.id, b.bestellnummer, b.erstellt, b.total_rappen, b.anzahl, b.status, b.zahlung, k.vorname, k.nachname
    FROM bestellungen b JOIN kunden k ON k.id = b.kunde_id ORDER BY b.erstellt DESC, b.id DESC LIMIT 6`).all()).results;
  const n = v => Number(v) || 0;
  return {
    bestellungen: {heute: n(row.heute), woche: n(row.woche), monat: n(row.monat), total: n(row.total), offen: n(row.offen), bezahlt: n(row.bezahlt), storniert: n(extra.storniert), in_arbeit: n(extra.in_arbeit)},
    umsatz: {heute: n(row.umsatz_heute), woche: n(row.umsatz_woche), monat: n(row.umsatz_monat), total: n(row.umsatz_total), bezahlt: n(row.bezahlt_rappen), rueckerstattet: n(extra.rueckerstattet_rappen),
      durchschnitt: n(row.total) ? Math.round(n(row.umsatz_total) / n(row.total)) : 0},
    shirts: n(row.shirts), kunden: n(extra.kunden), abonnenten: n(extra.abonnenten), ausstehend: n(extra.ausstehend), abgemeldet: n(extra.abgemeldet),
    neueste: latest, verlauf: await revenue(env, '30t', 'bestellwert')
  };
}

async function revenue(env, range, art) {
  const today = zurichDay(), labels = [];
  if (range === '12m') {
    const [y, m] = today.split('-').map(Number);
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); labels.push(d.toISOString().slice(0, 7)); }
  } else {
    const base = new Date(`${today}T12:00:00Z`).getTime();
    for (let i = 29; i >= 0; i--) labels.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  }
  const len = range === '12m' ? 7 : 10, column = art === 'bezahlt' ? 'bezahlt_am' : 'datum';
  const where = art === 'bezahlt' ? "zahlung = 'bezahlt' AND bezahlt_am IS NOT NULL" : "status != 'storniert'";
  const rows = (await env.DB.prepare(`SELECT substr(${column}, 1, ${len}) AS periode, SUM(total_rappen) AS summe, COUNT(*) AS anzahl FROM bestellungen
    WHERE ${where} AND ${column} >= ? GROUP BY periode`).bind(labels[0]).all()).results;
  const map = Object.fromEntries(rows.map(r => [r.periode, r]));
  const totals = await env.DB.prepare(`SELECT SUM(CASE WHEN status != 'storniert' THEN total_rappen END) AS bestellwert,
      SUM(CASE WHEN zahlung = 'bezahlt' THEN total_rappen END) AS bezahlt, SUM(CASE WHEN zahlung = 'rueckerstattet' THEN total_rappen END) AS rueckerstattet,
      SUM(CASE WHEN zahlung IN ('offen', 'teilweise') AND status != 'storniert' THEN total_rappen END) AS offen FROM bestellungen WHERE datum >= ?`).bind(range === '12m' ? labels[0] + '-01' : labels[0]).first();
  return {zeitraum: range, art, punkte: labels.map(p => ({periode: p, summe: Number(map[p]?.summe) || 0, anzahl: Number(map[p]?.anzahl) || 0})),
    summen: {bestellwert: Number(totals.bestellwert) || 0, bezahlt: Number(totals.bezahlt) || 0, rueckerstattet: Number(totals.rueckerstattet) || 0, offen: Number(totals.offen) || 0}};
}

// ---------------------------------------------------------------------------
// Kunden
const like = value => `%${String(value || '').replace(/[%_\\]/g, m => '\\' + m)}%`;
const page = q => Math.max(0, (Number(q.get('seite')) || 1) - 1);

async function customers(env, q) {
  const search = clean(q.get('q') || '', 100), offset = page(q) * 50;
  const where = search ? "WHERE k.vorname || ' ' || k.nachname LIKE ?1 ESCAPE '\\' OR k.email LIKE ?1 ESCAPE '\\' OR k.ort LIKE ?1 ESCAPE '\\' OR k.plz LIKE ?1 ESCAPE '\\' OR ('K-' || (10000 + k.id)) LIKE ?1 ESCAPE '\\'" : '';
  const sql = `SELECT k.*, COUNT(b.id) AS bestellungen, SUM(CASE WHEN b.status != 'storniert' THEN b.total_rappen END) AS umsatz, MAX(b.erstellt) AS letzte,
      (SELECT status FROM abonnenten a WHERE a.email = k.email) AS newsletter
    FROM kunden k LEFT JOIN bestellungen b ON b.kunde_id = k.id ${where} GROUP BY k.id ORDER BY k.id DESC LIMIT 50 OFFSET ${offset}`;
  const stmt = env.DB.prepare(sql), count = env.DB.prepare(`SELECT COUNT(*) AS n FROM kunden k ${where}`);
  const [list, total] = search ? await Promise.all([stmt.bind(like(search)).all(), count.bind(like(search)).first()]) : await Promise.all([stmt.all(), count.first()]);
  return {kunden: list.results, total: total.n};
}

async function customer(env, id) {
  const k = await env.DB.prepare('SELECT * FROM kunden WHERE id = ?').bind(id).first();
  if (!k) return fail(404, 'Kunde nicht gefunden.');
  const list = (await env.DB.prepare('SELECT id, bestellnummer, erstellt, anzahl, total_rappen, status, zahlung FROM bestellungen WHERE kunde_id = ? ORDER BY erstellt DESC, id DESC').bind(id).all()).results;
  const abo = await env.DB.prepare('SELECT id, status, angemeldet, einwilligung_zeit, einwilligung_quelle, abgemeldet FROM abonnenten WHERE email = ?').bind(k.email).first();
  return json({kunde: k, bestellungen: list, newsletter: abo || null});
}

async function customerExport(env, id) {
  const k = await env.DB.prepare('SELECT * FROM kunden WHERE id = ?').bind(id).first();
  if (!k) return fail(404, 'Kunde nicht gefunden.');
  const list = (await env.DB.prepare('SELECT * FROM bestellungen WHERE kunde_id = ? ORDER BY id').bind(id).all()).results;
  for (const b of list) {
    b.designs = (await env.DB.prepare('SELECT design_nr, anzahl, summe_rappen, details FROM bestell_designs WHERE bestellung_id = ?').bind(b.id).all()).results;
    delete b.client_id;
  }
  const abo = await env.DB.prepare('SELECT email, vorname, nachname, status, angemeldet, einwilligung_zeit, einwilligung_quelle, einwilligung_text, abgemeldet FROM abonnenten WHERE email = ?').bind(k.email).first();
  await log(env, `Datenauskunft K-${10000 + id} erstellt`);
  const body = JSON.stringify({erstellt: nowIso(), verantwortlich: 'ShirtBOX.ch, Leinackerweg 19, 5014 Gretzenbach', kunde: k, bestellungen: list, newsletter: abo || null}, null, 2);
  return new Response(body, {headers: {...SECURITY, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="datenauskunft-K-${10000 + id}.json"`}});
}

async function deleteCustomer(request, env, id) {
  const data = await request.json().catch(() => ({}));
  if (data.bestaetigung !== 'LÖSCHEN') return fail(400, 'Bitte zur Bestätigung LÖSCHEN eingeben.');
  const k = await env.DB.prepare('SELECT email FROM kunden WHERE id = ?').bind(id).first();
  if (!k) return fail(404, 'Kunde nicht gefunden.');
  // Buchhaltung: Zahlungen und Rechnungen sind Geschäftsunterlagen (10 Jahre Aufbewahrungspflicht) und werden nie mitgelöscht.
  const booked = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM bh_zahlungen WHERE bestellung_id IN (SELECT id FROM bestellungen WHERE kunde_id = ?1))
      + (SELECT COUNT(*) FROM bh_rechnungen WHERE bestellung_id IN (SELECT id FROM bestellungen WHERE kunde_id = ?1))
      + (SELECT COUNT(*) FROM bh_einnahmen WHERE bestellung_id IN (SELECT id FROM bestellungen WHERE kunde_id = ?1)) AS n`).bind(id).first();
  if (booked.n) return fail(409, 'Zu diesem Kunden gibt es gebuchte Zahlungen oder Rechnungen. Diese Geschäftsunterlagen müssen 10 Jahre aufbewahrt werden – der Kunde kann deshalb nicht gelöscht werden.');
  const designs = (await env.DB.prepare('SELECT d.bild_vorschau, d.bild_druck, d.bilder_original FROM bestell_designs d JOIN bestellungen b ON b.id = d.bestellung_id WHERE b.kunde_id = ?').bind(id).all()).results;
  const keys = designs.flatMap(d => [d.bild_vorschau, d.bild_druck, ...JSON.parse(d.bilder_original || '[]')]).filter(Boolean);
  if (env.BILDER && keys.length) for (let i = 0; i < keys.length; i += 1000) await env.BILDER.delete(keys.slice(i, i + 1000));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bh_kosten WHERE bestellung_id IN (SELECT id FROM bestellungen WHERE kunde_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM bestell_groessen WHERE design_id IN (SELECT d.id FROM bestell_designs d JOIN bestellungen b ON b.id = d.bestellung_id WHERE b.kunde_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM bestell_designs WHERE bestellung_id IN (SELECT id FROM bestellungen WHERE kunde_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM bestellungen WHERE kunde_id = ?').bind(id),
    env.DB.prepare('DELETE FROM kunden WHERE id = ?').bind(id),
    ...(data.newsletter ? [env.DB.prepare('DELETE FROM abonnenten WHERE email = ?').bind(k.email)] : [])
  ]);
  await log(env, `Kunde K-${10000 + id} gelöscht`);
  return json({ok: true});
}

// ---------------------------------------------------------------------------
// Bestellungen
async function orders(env, q) {
  const where = [], args = [];
  const search = clean(q.get('q') || '', 100);
  if (search) { args.push(like(search)); const n = args.length; where.push(`(b.bestellnummer LIKE ?${n} ESCAPE '\\' OR k.vorname || ' ' || k.nachname LIKE ?${n} ESCAPE '\\' OR k.email LIKE ?${n} ESCAPE '\\' OR k.ort LIKE ?${n} ESCAPE '\\')`); }
  if (STATUS.includes(q.get('status'))) { args.push(q.get('status')); where.push(`b.status = ?${args.length}`); }
  if (q.get('status') === 'offen') where.push("b.status IN ('neu', 'bearbeitung', 'produziert')");
  if (ZAHLUNG.includes(q.get('zahlung'))) { args.push(q.get('zahlung')); where.push(`b.zahlung = ?${args.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('von') || '')) { args.push(q.get('von')); where.push(`b.datum >= ?${args.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('bis') || '')) { args.push(q.get('bis')); where.push(`b.datum <= ?${args.length}`); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sort = q.get('sort') === 'alt' ? 'b.erstellt ASC, b.id ASC' : q.get('sort') === 'betrag' ? 'b.total_rappen DESC' : 'b.erstellt DESC, b.id DESC';
  const offset = page(q) * 50;
  const list = await env.DB.prepare(`SELECT b.id, b.bestellnummer, b.erstellt, b.anzahl, b.total_rappen, b.status, b.zahlung, k.id AS kunde_id, k.vorname, k.nachname, k.ort,
      (SELECT bild_vorschau FROM bestell_designs d WHERE d.bestellung_id = b.id ORDER BY d.id LIMIT 1) AS bild
    FROM bestellungen b JOIN kunden k ON k.id = b.kunde_id ${clause} ORDER BY ${sort} LIMIT 50 OFFSET ${offset}`).bind(...args).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(b.total_rappen) AS summe FROM bestellungen b JOIN kunden k ON k.id = b.kunde_id ${clause}`).bind(...args).first();
  return {bestellungen: list.results, total: total.n, summe: Number(total.summe) || 0};
}

async function order(env, id) {
  const b = await env.DB.prepare(`SELECT b.*, k.vorname, k.nachname, k.email, k.telefon FROM bestellungen b JOIN kunden k ON k.id = b.kunde_id WHERE b.id = ?`).bind(id).first();
  if (!b) return fail(404, 'Bestellung nicht gefunden.');
  const designs = (await env.DB.prepare('SELECT * FROM bestell_designs WHERE bestellung_id = ? ORDER BY design_nr').bind(id).all()).results;
  for (const d of designs) {
    d.groessen = (await env.DB.prepare('SELECT groesse, bestellgroesse, anzahl FROM bestell_groessen WHERE design_id = ? ORDER BY id').bind(d.id).all()).results;
    d.bilder_original = JSON.parse(d.bilder_original || '[]');
  }
  delete b.client_id;
  b.lieferadresse = JSON.parse(b.lieferadresse || '{}');
  return json({bestellung: b, designs});
}

async function updateOrder(request, env, id) {
  const data = await request.json().catch(() => ({}));
  const current = await env.DB.prepare('SELECT bestellnummer, zahlung FROM bestellungen WHERE id = ?').bind(id).first();
  if (!current) return fail(404, 'Bestellung nicht gefunden.');
  // Zahlung: läuft über die Buchhaltung (erzeugt die Zahlungsbuchung, nie doppelt) – siehe bhSetOrderPayment.
  if (data.zahlung !== undefined) {
    if (!ZAHLUNG.includes(data.zahlung)) return fail(400, 'Unbekannter Zahlungsstatus.');
    if (data.status === undefined && data.notiz === undefined) return bhSetOrderPayment(env, id, data.zahlung);
    const res = await bhSetOrderPayment(env, id, data.zahlung);
    if (!res.ok) return res;
  }
  const changes = [];
  if (data.status !== undefined) { if (!STATUS.includes(data.status)) return fail(400, 'Unbekannter Status.'); changes.push(env.DB.prepare('UPDATE bestellungen SET status = ? WHERE id = ?').bind(data.status, id)); }
  if (data.notiz !== undefined) changes.push(env.DB.prepare('UPDATE bestellungen SET notiz = ? WHERE id = ?').bind(clean(data.notiz, 4000) || null, id));
  if (!changes.length) return fail(400, 'Keine Änderung.');
  await env.DB.batch(changes);
  await log(env, `Bestellung ${current.bestellnummer} geändert${data.status ? ` → ${data.status}` : ''}${data.zahlung ? ` · Zahlung ${data.zahlung}` : ''}`);
  return json({ok: true});
}

// ---------------------------------------------------------------------------
// Bilder: Designbilder privat (nur angemeldet), Newsletter-Bilder werden öffentlich über den Bestell-Worker ausgeliefert.
async function image(env, key) {
  if (!env.BILDER || !/^(bestellungen|newsletter)\/[A-Za-z0-9/_.-]+$/.test(key) || key.includes('..')) return fail(404, 'Bild nicht gefunden.');
  const object = await env.BILDER.get(key);
  if (!object) return fail(404, 'Bild nicht gefunden.');
  const name = key.split('/').pop();
  return new Response(object.body, {headers: {...SECURITY, 'Content-Type': object.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': `inline; filename="${name}"`}});
}

async function uploadImage(request, env) {
  if (!env.BILDER) return fail(503, 'Bildspeicher (R2) ist noch nicht verbunden.');
  const form = await request.formData().catch(() => null);
  const file = form?.get('bild');
  if (!file || typeof file === 'string') return fail(400, 'Kein Bild erhalten.');
  const types = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'};
  if (!types[file.type]) return fail(400, 'Bitte ein JPG-, PNG-, WebP- oder GIF-Bild wählen.');
  if (file.size > 5 * 1024 * 1024) return fail(400, 'Das Bild ist grösser als 5 MB. Bitte verkleinern.');
  const name = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${types[file.type]}`;
  await env.BILDER.put(`newsletter/${name}`, await file.arrayBuffer(), {httpMetadata: {contentType: file.type}});
  return json({url: `${PUBLIC_WORKER}/bild/newsletter/${name}`});
}

// ---------------------------------------------------------------------------
// Newsletter-Abonnenten
async function subscribers(env, q) {
  const where = [], args = [], search = clean(q.get('q') || '', 100);
  if (search) { args.push(like(search)); where.push(`(email LIKE ?1 ESCAPE '\\' OR COALESCE(vorname, '') || ' ' || COALESCE(nachname, '') LIKE ?1 ESCAPE '\\')`); }
  if (['aktiv', 'ausstehend', 'abgemeldet', 'unzustellbar', 'beschwerde'].includes(q.get('status'))) { args.push(q.get('status')); where.push(`status = ?${args.length}`); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '', offset = page(q) * 50;
  const list = await env.DB.prepare(`SELECT id, email, vorname, nachname, status, angemeldet, einwilligung_zeit, einwilligung_quelle, abgemeldet,
      (SELECT id FROM kunden k WHERE k.email = abonnenten.email) AS kunde_id FROM abonnenten ${clause} ORDER BY id DESC LIMIT 50 OFFSET ${offset}`).bind(...args).all();
  const counts = await env.DB.prepare(`SELECT COUNT(*) AS alle, SUM(status = 'aktiv') AS aktiv, SUM(status = 'ausstehend') AS ausstehend,
      SUM(status IN ('abgemeldet', 'beschwerde')) AS abgemeldet, SUM(status = 'unzustellbar') AS unzustellbar FROM abonnenten`).first();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM abonnenten ${clause}`).bind(...args).first();
  return {abonnenten: list.results, total: total.n, zahlen: counts};
}

async function updateSubscriber(request, env, id) {
  const data = await request.json().catch(() => ({}));
  if (data.status !== 'abgemeldet') return fail(400, 'Nur Abmelden ist möglich. Anmelden kann sich eine Person nur selbst (Double-Opt-in).');
  await env.DB.batch([
    env.DB.prepare("UPDATE abonnenten SET status = 'abgemeldet', abgemeldet = ? WHERE id = ?").bind(nowIso(), id),
    env.DB.prepare("UPDATE newsletter_empfaenger SET status = 'uebersprungen' WHERE abonnent_id = ? AND status = 'wartend'").bind(id)
  ]);
  await log(env, `Abonnent #${id} manuell abgemeldet`);
  return json({ok: true});
}

// ---------------------------------------------------------------------------
// Newsletter erstellen, testen, versenden
async function newsletterRoute(request, env, ctx, part, settings) {
  const method = request.method, id = Number(part[2]);
  if (part.length === 2 && method === 'GET') {
    const list = (await env.DB.prepare(`SELECT n.id, n.betreff, n.status, n.erstellt, n.geaendert, n.versand_start, n.versand_ende, n.empfaenger,
        SUM(e.status IN ('gesendet', 'zugestellt')) AS gesendet, SUM(e.status = 'zugestellt') AS zugestellt, SUM(e.status = 'wartend') AS wartend,
        SUM(e.status IN ('fehler', 'unzustellbar', 'beschwerde')) AS fehler
      FROM newsletter n LEFT JOIN newsletter_empfaenger e ON e.newsletter_id = n.id GROUP BY n.id ORDER BY n.id DESC`).all()).results;
    const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM abonnenten WHERE status = 'aktiv'").first();
    return json({newsletter: list, aktive: active.n});
  }
  if (part[2] === 'vorschau' && method === 'POST') {
    const data = await request.json().catch(() => ({}));
    const content = readContent(data.inhalt), subject = clean(data.betreff, 200) || 'Betreff';
    return json({html: renderNewsletter(subject, content, settings, {vorname: 'Max', token: 'vorschau', datum: zurichDay()}).html});
  }
  if (part.length === 2 && method === 'POST') return saveNewsletter(request, env, null);
  const n = await env.DB.prepare('SELECT * FROM newsletter WHERE id = ?').bind(id).first();
  if (!n) return fail(404, 'Newsletter nicht gefunden.');
  if (part.length === 3 && method === 'GET') {
    const problems = (await env.DB.prepare(`SELECT a.email, e.status, e.fehler FROM newsletter_empfaenger e JOIN abonnenten a ON a.id = e.abonnent_id
      WHERE e.newsletter_id = ? AND e.status IN ('fehler', 'unzustellbar', 'beschwerde') ORDER BY e.id LIMIT 200`).bind(id).all()).results;
    const stats = await env.DB.prepare(`SELECT SUM(status IN ('gesendet', 'zugestellt')) AS gesendet, SUM(status = 'zugestellt') AS zugestellt, SUM(status = 'wartend') AS wartend,
      SUM(status IN ('fehler', 'unzustellbar', 'beschwerde')) AS fehler, SUM(status = 'uebersprungen') AS uebersprungen FROM newsletter_empfaenger WHERE newsletter_id = ?`).bind(id).first();
    return json({newsletter: {...n, inhalt: JSON.parse(n.inhalt)}, statistik: stats, probleme: problems});
  }
  if (part.length === 3 && method === 'PUT') { if (n.status !== 'entwurf') return fail(409, 'Ein versendeter Newsletter kann nicht mehr geändert werden.'); return saveNewsletter(request, env, id); }
  if (part.length === 3 && method === 'DELETE') {
    if (n.status !== 'entwurf') return fail(409, 'Nur Entwürfe können gelöscht werden.');
    await env.DB.prepare('DELETE FROM newsletter WHERE id = ?').bind(id).run(); await log(env, `Newsletter-Entwurf #${id} gelöscht`); return json({ok: true});
  }
  if (part[3] === 'kopie' && method === 'POST') {
    const t = nowIso();
    const copy = await env.DB.prepare("INSERT INTO newsletter (betreff, inhalt, status, erstellt, geaendert) VALUES (?, ?, 'entwurf', ?, ?) RETURNING id").bind(`Kopie: ${n.betreff}`.slice(0, 200), n.inhalt, t, t).first();
    return json({id: copy.id});
  }
  if (part[3] === 'test' && method === 'POST') {
    if (!env.RESEND_API_KEY) return fail(503, 'RESEND_API_KEY fehlt.');
    const mail = renderNewsletter(n.betreff, JSON.parse(n.inhalt), settings, {vorname: 'Test', token: 'test', datum: zurichDay()});
    const res = await resend(env, '/emails', {from: `${settings.absender_name} <${settings.absender_email}>`, to: [settings.test_email], reply_to: settings.antwort_email,
      subject: `[TEST] ${n.betreff}`, html: mail.html, text: mail.text});
    if (!res.ok) return fail(502, `Test-E-Mail nicht versendet: ${res.error}`);
    await log(env, `Test-Newsletter #${id} an Test-Adresse gesendet`);
    return json({ok: true, an: settings.test_email});
  }
  if (part[3] === 'versandinfo') {
    const active = (await env.DB.prepare("SELECT COUNT(*) AS n FROM abonnenten WHERE status = 'aktiv'").first()).n;
    const {today, month} = await sentCounts(env);
    return json({empfaenger: active, tageslimit: Number(settings.tageslimit), monatslimit: Number(settings.monatslimit), heute: today, monat: month});
  }
  if (part[3] === 'senden' && method === 'POST') {
    const data = await request.json().catch(() => ({}));
    if (n.status !== 'entwurf') return fail(409, 'Dieser Newsletter wurde bereits versendet.');
    if (!env.RESEND_API_KEY) return fail(503, 'RESEND_API_KEY fehlt.');
    const active = (await env.DB.prepare("SELECT COUNT(*) AS n FROM abonnenten WHERE status = 'aktiv'").first()).n;
    if (!active) return fail(400, 'Es gibt noch keine bestätigten Newsletter-Empfänger.');
    if (Number(data.empfaenger) !== active) return fail(409, `Die Empfängerzahl hat sich geändert (jetzt ${active}). Bitte erneut bestätigen.`);
    const t = nowIso();
    const started = await env.DB.prepare("UPDATE newsletter SET status = 'versand', versand_start = ?, empfaenger = ? WHERE id = ? AND status = 'entwurf'").bind(t, active, id).run();
    if (!started.meta.changes) return fail(409, 'Dieser Newsletter wird bereits versendet.');
    await env.DB.prepare("INSERT OR IGNORE INTO newsletter_empfaenger (newsletter_id, abonnent_id) SELECT ?, id FROM abonnenten WHERE status = 'aktiv'").bind(id).run();
    await log(env, `Newsletter #${id} Versand gestartet (${active} Empfänger)`);
    ctx.waitUntil(processQueue(env).catch(e => console.error('Versand', String(e?.message || e))));
    return json({ok: true, empfaenger: active});
  }
  return fail(404, 'Nicht gefunden.');
}

function readContent(raw) {
  const content = typeof raw === 'object' && raw ? raw : {};
  const link = v => { const s = clean(v, 1000); return /^(https?:\/\/|mailto:)/i.test(s) ? s : ''; };
  const blocks = (Array.isArray(content.bloecke) ? content.bloecke : []).slice(0, 40).map(b => {
    switch (b?.typ) {
      case 'ueberschrift': return {typ: 'ueberschrift', text: clean(b.text, 200)};
      case 'text': return {typ: 'text', text: clean(b.text, 6000)};
      case 'bild': return {typ: 'bild', url: link(b.url), alt: clean(b.alt, 200), link: link(b.link)};
      case 'angebot': return {typ: 'angebot', titel: clean(b.titel, 200), text: clean(b.text, 2000), preis: clean(b.preis, 60), alterpreis: clean(b.alterpreis, 60), bild: link(b.bild), button: clean(b.button, 80), link: link(b.link)};
      case 'button': return {typ: 'button', text: clean(b.text, 80), link: link(b.link)};
      case 'trenner': return {typ: 'trenner'};
      default: return null;
    }
  }).filter(Boolean);
  return {vorschau: clean(content.vorschau, 200), bloecke: blocks};
}

async function saveNewsletter(request, env, id) {
  const data = await request.json().catch(() => ({}));
  const subject = clean(data.betreff, 200);
  if (!subject) return fail(400, 'Bitte einen Betreff eingeben.');
  const content = JSON.stringify(readContent(data.inhalt)), t = nowIso();
  if (id) { await env.DB.prepare('UPDATE newsletter SET betreff = ?, inhalt = ?, geaendert = ? WHERE id = ?').bind(subject, content, t, id).run(); return json({id}); }
  const row = await env.DB.prepare("INSERT INTO newsletter (betreff, inhalt, status, erstellt, geaendert) VALUES (?, ?, 'entwurf', ?, ?) RETURNING id").bind(subject, content, t, t).first();
  await log(env, `Newsletter-Entwurf #${row.id} angelegt`);
  return json({id: row.id});
}

// Einfache Textformatierung: Leerzeile = neuer Absatz, **fett**, [Linktext](https://…), {{vorname}}.
function formatText(text, vars, font) {
  return String(text).split(/\n\s*\n/).map(paragraph => {
    let html = esc(paragraph.trim()).replace(/\n/g, '<br>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<b style="color:#131c30">$1</b>');
    html = html.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2" style="color:#e2481f;font-weight:bold;text-decoration:underline">$1</a>');
    html = html.replace(/\{\{\s*vorname\s*\}\}/gi, esc(vars.vorname || ''));
    return `<p style="${font}margin:0 0 14px;font-size:16px;line-height:1.6;color:#3d4554">${html}</p>`;
  }).join('');
}
const plain = (text, vars) => String(text).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)').replace(/\{\{\s*vorname\s*\}\}/gi, vars.vorname || '');

function renderNewsletter(subject, content, settings, vars) {
  const font = 'font-family:Arial,Helvetica,sans-serif;';
  const unsubscribe = `${PUBLIC_WORKER}/newsletter/abmelden-direkt?t=${vars.token}`;
  const button = (text, href) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:4px 0 18px"><tr><td style="border-radius:999px;background:#ff5b2e"><a href="${esc(href)}" style="${font}display:inline-block;padding:14px 28px;font-size:16px;font-weight:bold;color:#131c30;text-decoration:none">${esc(text)}</a></td></tr></table>`;
  const textParts = [];
  const blocks = content.bloecke.map(b => {
    if (b.typ === 'ueberschrift') { textParts.push(b.text.toUpperCase()); return `<h2 style="${font}margin:8px 0 12px;font-size:24px;line-height:1.2;color:#131c30">${esc(b.text.replace(/\{\{\s*vorname\s*\}\}/gi, vars.vorname || ''))}</h2>`; }
    if (b.typ === 'text') { textParts.push(plain(b.text, vars)); return formatText(b.text, vars, font); }
    if (b.typ === 'bild' && b.url) {
      const img = `<img src="${esc(b.url)}" width="536" alt="${esc(b.alt)}" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:14px">`;
      if (b.link) textParts.push(`${b.alt || 'Bild'}: ${b.link}`);
      return `<div style="margin:6px 0 18px">${b.link ? `<a href="${esc(b.link)}">${img}</a>` : img}</div>`;
    }
    if (b.typ === 'angebot') {
      textParts.push([b.titel, b.text, b.preis && `Preis: ${b.preis}${b.alterpreis ? ` statt ${b.alterpreis}` : ''}`, b.link].filter(Boolean).join('\n'));
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 20px;border:2px solid #ffd2bd;border-radius:18px;background:#fff7f2">
        ${b.bild ? `<tr><td style="padding:12px 12px 0"><img src="${esc(b.bild)}" width="512" alt="${esc(b.titel)}" style="display:block;width:100%;max-width:512px;height:auto;border:0;border-radius:12px"></td></tr>` : ''}
        <tr><td style="padding:18px 22px 6px">
          <p style="${font}margin:0 0 4px;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#e2481f">Angebot</p>
          <p style="${font}margin:0 0 8px;font-size:21px;font-weight:bold;line-height:1.25;color:#131c30">${esc(b.titel)}</p>
          ${b.text ? formatText(b.text, vars, font) : ''}
          ${b.preis ? `<p style="${font}margin:0 0 14px;font-size:26px;font-weight:900;color:#131c30">${esc(b.preis)}${b.alterpreis ? ` <span style="font-size:16px;font-weight:normal;color:#8a909c;text-decoration:line-through">${esc(b.alterpreis)}</span>` : ''}</p>` : ''}
          ${b.button && b.link ? button(b.button, b.link) : ''}
        </td></tr></table>`;
    }
    if (b.typ === 'button' && b.text && b.link) { textParts.push(`${b.text}: ${b.link}`); return button(b.text, b.link); }
    if (b.typ === 'trenner') { textParts.push('—'); return '<div style="height:1px;margin:10px 0 24px;background:#e6e1d6;line-height:1px;font-size:0">&nbsp;</div>'; }
    return '';
  }).join('');
  const reason = `Sie erhalten diese E-Mail, weil Sie den ShirtBOX-Newsletter abonniert haben.`;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ece8e0">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(content.vorschau || '')}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ece8e0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:22px;overflow:hidden">
  <tr><td style="background:#131c30;padding:22px 32px">
    <a href="${SITE}" style="text-decoration:none"><table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td style="padding-right:12px"><img src="${SITE}/shirtbox-icon-mail.png" width="44" height="44" alt="ShirtBOX" style="display:block;border:0;border-radius:12px"></td>
      <td style="${font}font-size:26px;font-weight:900;letter-spacing:-1px;color:#f4f1ea">shirt<span style="color:#ff6a2b">box</span><span style="font-size:15px;font-weight:bold;color:#8a94a6">.ch</span></td>
    </tr></table></a>
  </td></tr>
  <tr><td style="height:5px;line-height:5px;font-size:0;background:#ff5b2e;background-image:linear-gradient(90deg,#ff3d2e,#ff7a2b,#ffb43a)">&nbsp;</td></tr>
  <tr><td style="padding:30px 32px 14px">${blocks}</td></tr>
  <tr><td style="padding:0 32px 26px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;border-radius:16px"><tr><td style="${font}padding:16px 20px;font-size:14px;line-height:1.55;color:#3d4554">
      Fragen? Schreiben Sie uns per <a href="https://wa.me/41764690100" style="color:#e2481f;font-weight:bold;text-decoration:none">WhatsApp</a> oder an <a href="mailto:${esc(settings.antwort_email)}" style="color:#e2481f;font-weight:bold;text-decoration:none">${esc(settings.antwort_email)}</a>.
    </td></tr></table>
  </td></tr>
  <tr><td style="background:#131c30;padding:20px 32px;${font}font-size:12px;line-height:1.7;color:#8a94a6">
    ${esc(settings.adresse)}<br>${reason}<br>
    <a href="${unsubscribe}" style="color:#ff9a6e;text-decoration:underline">Newsletter abbestellen</a> · <a href="${SITE}" style="color:#ff9a6e;text-decoration:none">shirtbox.ch</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [...textParts, '', '---', `Fragen? WhatsApp oder ${settings.antwort_email}`, settings.adresse, reason, `Abmelden: ${unsubscribe}`].join('\n\n');
  return {html, text, unsubscribe};
}

async function resend(env, path, body) {
  const res = await fetch(`https://api.resend.com${path}`, {method: 'POST', headers: {Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(25000)});
  const data = await res.json().catch(() => ({}));
  return {ok: res.ok, status: res.status, data, error: data?.message || data?.name || `HTTP ${res.status}`};
}

async function sentCounts(env) {
  const now = new Date(), day = now.toISOString().slice(0, 10), month = now.toISOString().slice(0, 7);
  const row = await env.DB.prepare(`SELECT SUM(gesendet >= ?) AS heute, SUM(gesendet >= ?) AS monat FROM newsletter_empfaenger WHERE gesendet IS NOT NULL`).bind(day, month + '-01').first();
  return {today: Number(row?.heute) || 0, month: Number(row?.monat) || 0};
}

const pause = ms => new Promise(r => setTimeout(r, ms));

// Versand in Etappen: pro Lauf höchstens so viele Mails, wie das Tages- und Monatslimit von Resend noch zulässt.
// Den Rest übernimmt der Cron-Trigger alle 15 Minuten. Abgemeldete werden bis zuletzt ausgelassen.
async function processQueue(env) {
  if (!env.RESEND_API_KEY) return;
  const settings = await getSettings(env);
  await env.DB.prepare(`UPDATE newsletter_empfaenger SET status = 'uebersprungen' WHERE status = 'wartend'
    AND abonnent_id IN (SELECT id FROM abonnenten WHERE status != 'aktiv')`).run();
  const {today, month} = await sentCounts(env);
  let budget = Math.min(Number(settings.tageslimit) - today, Number(settings.monatslimit) - month, 400);
  const running = (await env.DB.prepare("SELECT * FROM newsletter WHERE status = 'versand' ORDER BY id").all()).results;
  for (const n of running) {
    const content = JSON.parse(n.inhalt);
    while (budget > 0) {
      const rows = (await env.DB.prepare(`SELECT e.id, a.email, a.vorname, a.token FROM newsletter_empfaenger e JOIN abonnenten a ON a.id = e.abonnent_id
        WHERE e.newsletter_id = ? AND e.status = 'wartend' AND a.status = 'aktiv' ORDER BY e.id LIMIT ?`).bind(n.id, Math.min(100, budget)).all()).results;
      if (!rows.length) break;
      const mails = rows.map(r => {
        const m = renderNewsletter(n.betreff, content, settings, {vorname: r.vorname || '', token: r.token});
        return {from: `${settings.absender_name} <${settings.absender_email}>`, to: [r.email], reply_to: settings.antwort_email, subject: n.betreff, html: m.html, text: m.text,
          headers: {'List-Unsubscribe': `<${m.unsubscribe}>, <mailto:${settings.antwort_email}?subject=Newsletter%20abbestellen>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'}};
      });
      const res = await resend(env, '/emails/batch', mails);
      const t = nowIso();
      if (res.status === 429) return; // Ratenlimit: beim nächsten Lauf weiter
      if (res.ok && Array.isArray(res.data?.data)) {
        await env.DB.batch(rows.map((r, i) => env.DB.prepare("UPDATE newsletter_empfaenger SET status = 'gesendet', resend_id = ?, gesendet = ? WHERE id = ?").bind(res.data.data[i]?.id || null, t, r.id)));
      } else {
        // Einzelversand, damit eine fehlerhafte Adresse nicht den ganzen Block blockiert.
        for (const [i, r] of rows.entries()) {
          const single = await resend(env, '/emails', mails[i]);
          if (single.status === 429) return;
          await env.DB.prepare('UPDATE newsletter_empfaenger SET status = ?, resend_id = ?, gesendet = ?, fehler = ? WHERE id = ?')
            .bind(single.ok ? 'gesendet' : 'fehler', single.data?.id || null, t, single.ok ? null : clean(single.error, 300), r.id).run();
          await pause(550);
        }
      }
      budget -= rows.length;
      await pause(600);
    }
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM newsletter_empfaenger WHERE newsletter_id = ? AND status = 'wartend'").bind(n.id).first();
    if (!left.n) { await env.DB.prepare("UPDATE newsletter SET status = 'versendet', versand_ende = ? WHERE id = ?").bind(nowIso(), n.id).run(); await log(env, `Newsletter #${n.id} vollständig versendet`); }
  }
}

// ---------------------------------------------------------------------------
// Export als CSV (Excel-tauglich: UTF-8 mit BOM, Semikolon).
async function exportCsv(env, name) {
  const chf = v => (Number(v || 0) / 100).toFixed(2);
  let rows, file;
  if (name === 'kunden.csv') {
    file = name;
    const list = (await env.DB.prepare(`SELECT k.*, COUNT(b.id) AS n, SUM(CASE WHEN b.status != 'storniert' THEN b.total_rappen END) AS umsatz FROM kunden k LEFT JOIN bestellungen b ON b.kunde_id = k.id GROUP BY k.id ORDER BY k.id`).all()).results;
    rows = [['Kundennummer', 'Vorname', 'Nachname', 'E-Mail', 'Telefon', 'Strasse', 'PLZ', 'Ort', 'Land', 'Erste Bestellung', 'Bestellungen', 'Umsatz CHF'],
      ...list.map(k => [`K-${10000 + k.id}`, k.vorname, k.nachname, k.email, k.telefon, k.strasse, k.plz, k.ort, k.land, k.erste_bestellung.slice(0, 10), k.n, chf(k.umsatz)])];
  } else if (name === 'bestellungen.csv') {
    file = name;
    const list = (await env.DB.prepare(`SELECT b.*, k.id AS kid, k.vorname, k.nachname, k.email FROM bestellungen b JOIN kunden k ON k.id = b.kunde_id ORDER BY b.id`).all()).results;
    rows = [['Bestellnummer', 'Datum', 'Kundennummer', 'Vorname', 'Nachname', 'E-Mail', 'Anzahl Shirts', 'Total CHF', 'Versand CHF', 'Status', 'Zahlung', 'Bezahlt am'],
      ...list.map(b => [b.bestellnummer, b.datum, `K-${10000 + b.kid}`, b.vorname, b.nachname, b.email, b.anzahl, chf(b.total_rappen), chf(b.versand_rappen), b.status, b.zahlung, b.bezahlt_am])];
  } else if (name === 'abonnenten.csv') {
    file = name;
    const list = (await env.DB.prepare('SELECT * FROM abonnenten ORDER BY id').all()).results;
    rows = [['E-Mail', 'Vorname', 'Nachname', 'Status', 'Angemeldet', 'Einwilligung bestätigt', 'Herkunft', 'Einwilligungstext', 'Abgemeldet'],
      ...list.map(a => [a.email, a.vorname, a.nachname, a.status, a.angemeldet, a.einwilligung_zeit, a.einwilligung_quelle, a.einwilligung_text, a.abgemeldet])];
  } else return fail(404, 'Unbekannter Export.');
  const cell = v => { const s = String(v ?? ''); return /[";\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  const body = '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  await log(env, `Export ${file}`);
  return new Response(body, {headers: {...SECURITY, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="shirtbox-${zurichDay()}-${file}"`}});
}


// ===========================================================================
// Buchhaltung (vereinfachte Einnahmen-/Ausgabenrechnung, OR 957 Abs. 2) – wird von bauen.ps1 an admin-worker.js angehängt.
// Alle Beträge in Rappen (ganze Zahlen), nie Kommazahlen.
// Einnahmen = Zahlungseingänge zu Bestellungen (bh_zahlungen) + manuell erfasste Einnahmen. Bestellungen werden NICHT kopiert:
// Umsatz und offene Beträge werden immer direkt aus der Tabelle bestellungen berechnet – damit kann nichts doppelt gezählt werden.
// Gelöscht wird nichts: Buchungen werden storniert (mit Grund und Zeitpunkt), Belege archiviert. Jede Änderung steht im Protokoll.

const BH_ZAHLUNGSARTEN = ['TWINT', 'Banküberweisung', 'Bar', 'Kreditkarte', 'Sonstige'];
const BH_KOSTENARTEN = {textilien: 'T-Shirts (Einkauf)', druck: 'Druck', verpackung: 'Verpackung', versand: 'Versand', gebuehren: 'Zahlungsgebühren', sonstiges: 'Weitere direkte Kosten'};
const BH_PFLICHT_KOSTEN = ['textilien', 'druck', 'verpackung', 'versand', 'gebuehren'];
const BH_DEFAULTS = {
  bh_firma: 'ShirtBOX.ch', bh_uid: '', bh_mwst_pflichtig: '0', bh_mwst_nummer: '', bh_mwst_saetze: '8.1, 2.6, 3.8', bh_mwst_standard: '8.1', bh_preise: 'brutto',
  bh_zahlungsfrist: '30', bh_iban: '', bh_bank: '', bh_gj_beginn: '1', bh_rechnung_praefix: 'RE', bh_gutschrift_praefix: 'GS', bh_gesperrt_bis: '',
  bh_std_textilien: '', bh_std_druck: '', bh_std_verpackung: '', bh_std_versand: '', bh_std_gebuehren_prozent: ''
};
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const bhRef = (prefix, id) => `${prefix}-${String(id).padStart(5, '0')}`;

// "1'250.50", "1250,5", 12 → Rappen. null = ungültig.
function toRappen(value, {negative = false, zero = true} = {}) {
  const s = String(value ?? '').replace(/[’'\s]/g, '').replace(',', '.');
  if (!/^-?\d{1,8}(\.\d{1,2})?$/.test(s)) return null;
  const minus = s.startsWith('-'), [a, b = ''] = s.replace('-', '').split('.');
  const r = Number(a) * 100 + Number((b + '00').slice(0, 2));
  if ((minus && !negative) || (!zero && r === 0)) return null;
  return minus ? -r : r;
}
// MWST-Satz "8.1" → Basispunkte 810. Betrag brutto → MWST-Anteil.
const satzBp = v => { const n = Number(String(v ?? '0').replace(',', '.')); return Number.isFinite(n) && n >= 0 && n < 100 ? Math.round(n * 100) : null; };
const mwstAus = (brutto, bp) => bp ? Math.round(brutto * bp / (10000 + bp)) : 0;

async function bhSettings(env) {
  const all = await getSettings(env);
  const s = {...BH_DEFAULTS};
  for (const k of Object.keys(BH_DEFAULTS)) if (all[k] !== undefined) s[k] = all[k];
  s.adresse = all.adresse; // Firmenadresse wird mit den Verwaltungs-Einstellungen geteilt (keine doppelte Speicherung)
  return s;
}
// Erster Tag des laufenden Geschäftsjahres (Beginn-Monat aus den Einstellungen).
function gjStart(s, today = zurichDay()) {
  const m = Math.min(12, Math.max(1, Number(s.bh_gj_beginn) || 1)), [y, mm] = today.split('-').map(Number);
  return `${mm >= m ? y : y - 1}-${String(m).padStart(2, '0')}-01`;
}
function locked(s, ...days) {
  const until = s.bh_gesperrt_bis;
  return isDay(until) && days.some(d => isDay(d) && d <= until) ? fail(409, `Buchungen bis ${until.split('-').reverse().join('.')} sind abgeschlossen. Bitte eine Korrektur mit neuem Datum erfassen.`) : null;
}
async function bhBody(request) { return request.json().catch(() => ({})); }
function csvFile(rows, file) {
  const cell = v => { const s = String(v ?? ''); return /[";\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  return new Response('﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n'), {headers: {...SECURITY, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="shirtbox-${zurichDay()}-${file}"`}});
}
const chfCsv = v => (Number(v || 0) / 100).toFixed(2);

// ---------------------------------------------------------------------------
// Bestellungen mit Zahlungsstand. soll = Total − Gutschriften (stornierte Bestellung: 0).
const ORDER_FIN = `SELECT b.id, b.bestellnummer, b.datum, b.erstellt, b.anzahl, b.total_rappen, b.status, b.zahlung, b.bezahlt_am, b.kunde_id, k.vorname, k.nachname, k.email,
  COALESCE((SELECT SUM(z.betrag_rappen) FROM bh_zahlungen z WHERE z.bestellung_id = b.id AND z.storniert IS NULL AND z.betrag_rappen > 0), 0) AS bezahlt,
  COALESCE((SELECT -SUM(z.betrag_rappen) FROM bh_zahlungen z WHERE z.bestellung_id = b.id AND z.storniert IS NULL AND z.betrag_rappen < 0), 0) AS erstattet,
  COALESCE((SELECT SUM(r.betrag_rappen) FROM bh_rechnungen r WHERE r.bestellung_id = b.id AND r.art = 'gutschrift' AND r.storniert IS NULL), 0) AS gutgeschrieben,
  (SELECT MAX(z.datum) FROM bh_zahlungen z WHERE z.bestellung_id = b.id AND z.storniert IS NULL AND z.betrag_rappen > 0) AS letzte_zahlung,
  (SELECT r.id FROM bh_rechnungen r WHERE r.bestellung_id = b.id AND r.art = 'rechnung' AND r.storniert IS NULL) AS rechnung_id,
  (SELECT r.nummer FROM bh_rechnungen r WHERE r.bestellung_id = b.id AND r.art = 'rechnung' AND r.storniert IS NULL) AS rechnung_nr
  FROM bestellungen b JOIN kunden k ON k.id = b.kunde_id`;
function finance(o, frist, today = zurichDay()) {
  const soll = o.status === 'storniert' ? 0 : Math.max(0, o.total_rappen - o.gutgeschrieben);
  const offen = Math.max(0, soll - o.bezahlt);
  let zustand = 'offen';
  if (o.bezahlt > 0 && o.erstattet >= o.bezahlt) zustand = 'rueckerstattet';
  else if (o.bezahlt > 0 && o.bezahlt >= soll) zustand = 'bezahlt';
  else if (o.bezahlt > 0) zustand = 'teilweise';
  else if (o.status === 'storniert') zustand = 'storniert';
  const faellig = new Date(new Date(`${o.datum}T12:00:00Z`).getTime() + frist * 86400000).toISOString().slice(0, 10);
  return {...o, soll, offen, zustand, faellig, ueberfaellig: offen > 0 && faellig < today};
}
// Zahlungsstatus der Bestellung aus den Zahlungen ableiten (eine Quelle der Wahrheit).
async function syncOrder(env, id) {
  const o = await env.DB.prepare(`${ORDER_FIN} WHERE b.id = ?`).bind(id).first();
  if (!o) return null;
  const f = finance(o, 30), zahlung = f.zustand === 'storniert' ? 'offen' : f.zustand;
  const am = zahlung === 'bezahlt' ? (o.letzte_zahlung || zurichDay()) : null;
  if (zahlung !== o.zahlung || am !== o.bezahlt_am) await env.DB.prepare('UPDATE bestellungen SET zahlung = ?, bezahlt_am = ? WHERE id = ?').bind(zahlung, am, id).run();
  return zahlung;
}
// Aufruf aus der Bestellansicht (Auswahl „Zahlung“): erzeugt die passende Zahlung bzw. Rückerstattung – nie doppelt.
async function bhSetOrderPayment(env, id, wanted) {
  const o = await env.DB.prepare(`${ORDER_FIN} WHERE b.id = ?`).bind(id).first();
  if (!o) return fail(404, 'Bestellung nicht gefunden.');
  const f = finance(o, 30), t = nowIso(), today = zurichDay();
  if (wanted === 'teilweise') return fail(400, 'Teilzahlungen bitte unter Buchhaltung → Zahlungen mit dem Betrag erfassen.');
  if (wanted === 'bezahlt' && f.offen > 0) {
    await env.DB.prepare("INSERT INTO bh_zahlungen (bestellung_id, datum, betrag_rappen, art, zahlungsart, quelle, notiz, erstellt) VALUES (?, ?, ?, 'zahlung', 'TWINT', 'status', 'Als bezahlt markiert (Bestellung)', ?)").bind(id, today, f.offen, t).run();
  } else if (wanted === 'rueckerstattet') {
    const rest = o.bezahlt - o.erstattet;
    if (rest <= 0) return fail(400, 'Für diese Bestellung ist keine Zahlung erfasst, die zurückerstattet werden könnte.');
    await env.DB.prepare("INSERT INTO bh_zahlungen (bestellung_id, datum, betrag_rappen, art, zahlungsart, quelle, notiz, erstellt) VALUES (?, ?, ?, 'rueckerstattung', 'TWINT', 'status', 'Als rückerstattet markiert (Bestellung)', ?)").bind(id, today, -rest, t).run();
  } else if (wanted === 'offen') {
    // Nur automatisch erzeugte Buchungen werden storniert; manuell erfasste Zahlungen bleiben bestehen.
    await env.DB.prepare("UPDATE bh_zahlungen SET storniert = ?, storno_grund = 'Zahlungsstatus auf offen zurückgesetzt' WHERE bestellung_id = ? AND quelle = 'status' AND storniert IS NULL").bind(t, id).run();
  }
  const now = await syncOrder(env, id);
  await log(env, `Bestellung ${o.bestellnummer}: Zahlung → ${now}`);
  return json({ok: true, zahlung: now, hinweis: wanted === 'offen' && now !== 'offen' ? 'Es sind noch manuell erfasste Zahlungen vorhanden (Buchhaltung → Zahlungen).' : ''});
}

// ---------------------------------------------------------------------------
async function bhRoute(request, env, part, q) {
  const method = request.method, area = part[2], id = Number(part[3]), sub = part[4];
  const s = await bhSettings(env);
  if (area === 'uebersicht') return json(await bhOverview(env, s, q));
  if (area === 'einstellungen') return method === 'PUT' ? bhSaveSettings(request, env) : json({einstellungen: s, kategorien: (await env.DB.prepare('SELECT * FROM bh_kategorien ORDER BY art, aktiv DESC, name').all()).results});
  if (area === 'kategorien') return bhCategories(request, env, id);
  if (area === 'lieferanten') return bhSuppliers(request, env, q, id);
  if (area === 'ausgaben') return bhExpenses(request, env, s, q, part);
  if (area === 'einnahmen') return bhIncome(request, env, s, q, part);
  if (area === 'zahlungen') return bhPayments(request, env, s, q, part);
  if (area === 'kosten') return bhCosts(request, env, s, id, sub);
  if (area === 'rechnungen') return bhInvoices(request, env, s, q, part);
  if (area === 'belege') return bhReceipts(request, env, q, id, sub);
  if (area === 'auswertungen') return json(await bhReports(env, s, q));
  if (area === 'export') return bhExport(env, s, part[3] || '', q);
  return fail(404, 'Nicht gefunden.');
}

async function bhSaveSettings(request, env) {
  const d = await bhBody(request), out = {};
  const text = {bh_firma: 120, bh_uid: 40, bh_mwst_nummer: 40, bh_bank: 120, bh_rechnung_praefix: 6, bh_gutschrift_praefix: 6};
  for (const [k, max] of Object.entries(text)) if (k in d) out[k] = clean(String(d[k] ?? ''), max);
  if ('bh_iban' in d) { out.bh_iban = clean(String(d.bh_iban ?? ''), 40).replace(/\s+/g, '').toUpperCase(); if (out.bh_iban && !/^(CH|LI)\d{19}$/.test(out.bh_iban)) return fail(400, 'Bitte eine Schweizer IBAN (CH + 19 Ziffern) eingeben oder das Feld leer lassen.'); }
  if ('bh_mwst_pflichtig' in d) out.bh_mwst_pflichtig = d.bh_mwst_pflichtig === '1' || d.bh_mwst_pflichtig === true ? '1' : '0';
  if ('bh_preise' in d) out.bh_preise = d.bh_preise === 'netto' ? 'netto' : 'brutto';
  if ('bh_mwst_saetze' in d) {
    const list = String(d.bh_mwst_saetze || '').split(/[;,\s]+/).filter(Boolean);
    if (!list.length || list.some(v => satzBp(v) === null)) return fail(400, 'Bitte MWST-Sätze als Zahlen eingeben, z. B. 8.1, 2.6, 3.8.');
    out.bh_mwst_saetze = list.map(v => String(satzBp(v) / 100)).join(', ');
  }
  if ('bh_mwst_standard' in d) { if (satzBp(d.bh_mwst_standard) === null) return fail(400, 'Ungültiger Standard-MWST-Satz.'); out.bh_mwst_standard = String(satzBp(d.bh_mwst_standard) / 100); }
  if ('bh_zahlungsfrist' in d) { const n = Math.round(Number(d.bh_zahlungsfrist)); if (!(n >= 0 && n <= 365)) return fail(400, 'Zahlungsfrist: 0 bis 365 Tage.'); out.bh_zahlungsfrist = String(n); }
  if ('bh_gj_beginn' in d) { const n = Math.round(Number(d.bh_gj_beginn)); if (!(n >= 1 && n <= 12)) return fail(400, 'Beginn des Geschäftsjahres: Monat 1 bis 12.'); out.bh_gj_beginn = String(n); }
  if ('bh_gesperrt_bis' in d) { if (d.bh_gesperrt_bis && !isDay(d.bh_gesperrt_bis)) return fail(400, 'Ungültiges Abschlussdatum.'); out.bh_gesperrt_bis = d.bh_gesperrt_bis || ''; }
  for (const k of ['bh_std_textilien', 'bh_std_druck', 'bh_std_verpackung', 'bh_std_versand']) if (k in d) {
    if (d[k] === '' || d[k] == null) { out[k] = ''; continue; }
    const r = toRappen(d[k]); if (r === null) return fail(400, 'Standardkosten bitte als Betrag eingeben, z. B. 6.50.'); out[k] = String(r);
  }
  if ('bh_std_gebuehren_prozent' in d) { if (d.bh_std_gebuehren_prozent === '' || d.bh_std_gebuehren_prozent == null) out.bh_std_gebuehren_prozent = ''; else { const bp = satzBp(d.bh_std_gebuehren_prozent); if (bp === null) return fail(400, 'Ungültiger Gebühren-Prozentsatz.'); out.bh_std_gebuehren_prozent = String(bp / 100); } }
  if (!Object.keys(out).length) return fail(400, 'Keine Änderung.');
  await env.DB.batch(Object.entries(out).map(([k, v]) => env.DB.prepare('INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert').bind(k, v)));
  await log(env, 'Buchhaltung: Einstellungen geändert');
  return json({ok: true});
}

async function bhCategories(request, env, id) {
  const method = request.method;
  if (method === 'GET') return json({kategorien: (await env.DB.prepare('SELECT * FROM bh_kategorien ORDER BY art, aktiv DESC, name').all()).results});
  const d = await bhBody(request);
  if (method === 'POST') {
    const art = d.art === 'einnahme' ? 'einnahme' : 'ausgabe', name = clean(d.name, 60);
    if (!name) return fail(400, 'Bitte einen Namen eingeben.');
    const r = await env.DB.prepare('INSERT OR IGNORE INTO bh_kategorien (art, name) VALUES (?, ?) RETURNING id').bind(art, name).first();
    if (!r) return fail(409, 'Diese Kategorie gibt es schon.');
    await log(env, `Buchhaltung: Kategorie „${name}“ angelegt`); return json({id: r.id});
  }
  if (method === 'PATCH' && id) {
    const sets = [], args = [];
    if (d.name !== undefined) { const name = clean(d.name, 60); if (!name) return fail(400, 'Bitte einen Namen eingeben.'); sets.push('name = ?'); args.push(name); }
    if (d.aktiv !== undefined) { sets.push('aktiv = ?'); args.push(d.aktiv ? 1 : 0); }
    if (!sets.length) return fail(400, 'Keine Änderung.');
    await env.DB.prepare(`UPDATE bh_kategorien SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run().catch(() => { throw Error('Diese Kategorie gibt es schon.'); });
    await log(env, `Buchhaltung: Kategorie #${id} geändert`); return json({ok: true});
  }
  return fail(405, 'Nicht erlaubt.');
}

// ---------------------------------------------------------------------------
// Lieferanten
async function bhSuppliers(request, env, q, id) {
  const method = request.method;
  if (method === 'GET' && !id) {
    const search = clean(q.get('q') || '', 100), where = search ? "WHERE l.name LIKE ?1 ESCAPE '\\' OR l.kontakt LIKE ?1 ESCAPE '\\' OR l.email LIKE ?1 ESCAPE '\\'" : '';
    const year = gjStart(await bhSettings(env));
    const stmt = env.DB.prepare(`SELECT l.*, COUNT(a.id) AS anzahl, COALESCE(SUM(a.brutto_rappen), 0) AS total,
        COALESCE(SUM(CASE WHEN a.datum >= '${year}' THEN a.brutto_rappen END), 0) AS jahr, MAX(a.datum) AS letzte
      FROM bh_lieferanten l LEFT JOIN bh_ausgaben a ON a.lieferant_id = l.id AND a.storniert IS NULL ${where} GROUP BY l.id ORDER BY l.name COLLATE NOCASE`);
    return json({lieferanten: (await (search ? stmt.bind(like(search)) : stmt).all()).results, gj_start: year});
  }
  if (method === 'GET') {
    const l = await env.DB.prepare('SELECT * FROM bh_lieferanten WHERE id = ?').bind(id).first();
    if (!l) return fail(404, 'Lieferant nicht gefunden.');
    const year = gjStart(await bhSettings(env));
    const sums = await env.DB.prepare(`SELECT COUNT(*) AS anzahl, COALESCE(SUM(brutto_rappen), 0) AS total, COALESCE(SUM(CASE WHEN datum >= ? THEN brutto_rappen END), 0) AS jahr FROM bh_ausgaben WHERE lieferant_id = ? AND storniert IS NULL`).bind(year, id).first();
    const list = (await env.DB.prepare(`SELECT a.*, c.name AS kategorie, bl.dateiname AS beleg_name FROM bh_ausgaben a LEFT JOIN bh_kategorien c ON c.id = a.kategorie_id LEFT JOIN bh_belege bl ON bl.id = a.beleg_id
      WHERE a.lieferant_id = ? ORDER BY a.datum DESC, a.id DESC LIMIT 50`).bind(id).all()).results;
    return json({lieferant: l, summen: sums, ausgaben: list, gj_start: year});
  }
  const d = await bhBody(request), name = clean(d.name, 120);
  if (!name) return fail(400, 'Bitte den Firmennamen eingeben.');
  const email = clean(d.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
  const website = clean(d.website, 200);
  if (website && !/^https?:\/\//i.test(website)) return fail(400, 'Die Website muss mit https:// beginnen.');
  const vals = [name, clean(d.kontakt, 120) || null, email || null, clean(d.telefon, 40) || null, clean(d.adresse, 400) || null, website || null, clean(d.notiz, 2000) || null, nowIso()];
  if (method === 'POST') {
    const r = await env.DB.prepare('INSERT INTO bh_lieferanten (name, kontakt, email, telefon, adresse, website, notiz, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?8) RETURNING id').bind(...vals).first();
    await log(env, `Buchhaltung: Lieferant „${name}“ angelegt`); return json({id: r.id});
  }
  if (method === 'PUT' && id) {
    const r = await env.DB.prepare('UPDATE bh_lieferanten SET name = ?, kontakt = ?, email = ?, telefon = ?, adresse = ?, website = ?, notiz = ?, geaendert = ? WHERE id = ?').bind(...vals, id).run();
    if (!r.meta.changes) return fail(404, 'Lieferant nicht gefunden.');
    await log(env, `Buchhaltung: Lieferant #${id} geändert`); return json({ok: true});
  }
  return fail(405, 'Nicht erlaubt.');
}

// ---------------------------------------------------------------------------
// Ausgaben
async function readExpense(env, s, d) {
  if (!isDay(d.datum)) return {error: 'Bitte ein gültiges Datum wählen.'};
  const beschreibung = clean(d.beschreibung, 300); if (!beschreibung) return {error: 'Bitte eine Beschreibung eingeben.'};
  const brutto = toRappen(d.betrag, {zero: false}); if (brutto === null) return {error: 'Bitte den Betrag eingeben, z. B. 129.90.'};
  const pflichtig = s.bh_mwst_pflichtig === '1', bp = pflichtig ? satzBp(d.mwst_satz ?? s.bh_mwst_standard) : 0;
  if (bp === null) return {error: 'Ungültiger MWST-Satz.'};
  const kat = Number(d.kategorie_id), lief = d.lieferant_id ? Number(d.lieferant_id) : null, beleg = d.beleg_id ? Number(d.beleg_id) : null;
  if (!(await env.DB.prepare("SELECT id FROM bh_kategorien WHERE id = ? AND art = 'ausgabe'").bind(kat).first())) return {error: 'Bitte eine Kategorie wählen.'};
  if (lief && !(await env.DB.prepare('SELECT id FROM bh_lieferanten WHERE id = ?').bind(lief).first())) return {error: 'Lieferant nicht gefunden.'};
  if (beleg && !(await env.DB.prepare('SELECT id FROM bh_belege WHERE id = ? AND archiviert IS NULL').bind(beleg).first())) return {error: 'Beleg nicht gefunden.'};
  const zahlungsart = BH_ZAHLUNGSARTEN.includes(d.zahlungsart) ? d.zahlungsart : 'Sonstige', zahlung = d.zahlung === 'offen' ? 'offen' : 'bezahlt';
  const bezahlt_am = zahlung === 'bezahlt' ? (isDay(d.bezahlt_am) ? d.bezahlt_am : d.datum) : null;
  const mwst = mwstAus(brutto, bp), wiederkehrend = ['monatlich', 'jaehrlich'].includes(d.wiederkehrend) ? d.wiederkehrend : '';
  return {v: {datum: d.datum, lieferant_id: lief, beschreibung, kategorie_id: kat, netto_rappen: brutto - mwst, mwst_satz: bp / 100, mwst_rappen: mwst, brutto_rappen: brutto, zahlungsart, zahlung, bezahlt_am, beleg_id: beleg, wiederkehrend, notiz: clean(d.notiz, 2000) || null}};
}
async function bhExpenses(request, env, s, q, part) {
  const method = request.method, id = Number(part[3]), action = part[4];
  if (method === 'GET' && !id) {
    const where = ['1 = 1'], args = [];
    const add = (sql, v) => { args.push(v); where.push(sql.replace('?', `?${args.length}`)); };
    if (isDay(q.get('von'))) add('a.datum >= ?', q.get('von'));
    if (isDay(q.get('bis'))) add('a.datum <= ?', q.get('bis'));
    if (Number(q.get('kategorie'))) add('a.kategorie_id = ?', Number(q.get('kategorie')));
    if (Number(q.get('lieferant'))) add('a.lieferant_id = ?', Number(q.get('lieferant')));
    if (['offen', 'bezahlt'].includes(q.get('zahlung'))) add('a.zahlung = ?', q.get('zahlung'));
    if (q.get('storniert') !== '1') where.push('a.storniert IS NULL');
    const search = clean(q.get('q') || '', 100);
    if (search) { args.push(like(search)); const n = args.length; where.push(`(a.beschreibung LIKE ?${n} ESCAPE '\\' OR l.name LIKE ?${n} ESCAPE '\\' OR a.notiz LIKE ?${n} ESCAPE '\\')`); }
    const clause = where.join(' AND '), offset = page(q) * 50;
    const list = (await env.DB.prepare(`SELECT a.*, c.name AS kategorie, l.name AS lieferant, bl.dateiname AS beleg_name FROM bh_ausgaben a
      LEFT JOIN bh_kategorien c ON c.id = a.kategorie_id LEFT JOIN bh_lieferanten l ON l.id = a.lieferant_id LEFT JOIN bh_belege bl ON bl.id = a.beleg_id
      WHERE ${clause} ORDER BY a.datum DESC, a.id DESC LIMIT 50 OFFSET ${offset}`).bind(...args).all()).results;
    const total = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN a.storniert IS NULL THEN a.brutto_rappen END), 0) AS summe FROM bh_ausgaben a LEFT JOIN bh_lieferanten l ON l.id = a.lieferant_id WHERE ${clause}`).bind(...args).first();
    const vorlagen = (await env.DB.prepare("SELECT COUNT(*) AS n FROM bh_ausgaben WHERE wiederkehrend != '' AND storniert IS NULL").first()).n;
    return json({ausgaben: list.map(a => ({...a, ref: bhRef('A', a.id)})), total: total.n, summe: total.summe, vorlagen});
  }
  if (method === 'GET') {
    const a = await env.DB.prepare('SELECT a.*, bl.dateiname AS beleg_name FROM bh_ausgaben a LEFT JOIN bh_belege bl ON bl.id = a.beleg_id WHERE a.id = ?').bind(id).first();
    return a ? json({ausgabe: {...a, ref: bhRef('A', a.id)}}) : fail(404, 'Ausgabe nicht gefunden.');
  }
  // Wiederkehrende Ausgaben für einen Monat erfassen (je Vorlage und Monat höchstens einmal – UNIQUE(vorlage_id, periode)).
  if (method === 'POST' && part[3] === 'wiederkehrend') {
    const d = await bhBody(request), monat = /^\d{4}-\d{2}$/.test(d.monat || '') ? d.monat : zurichDay().slice(0, 7);
    const block = locked(s, `${monat}-28`); if (block) return block;
    const vorlagen = (await env.DB.prepare("SELECT * FROM bh_ausgaben WHERE wiederkehrend != '' AND vorlage_id IS NULL AND storniert IS NULL").all()).results;
    let neu = 0;
    for (const v of vorlagen) {
      if (v.wiederkehrend === 'jaehrlich' && v.datum.slice(5, 7) !== monat.slice(5, 7)) continue;
      if (v.datum.slice(0, 7) >= monat) continue; // Vorlage selbst gilt für ihren eigenen Monat
      const day = Math.min(Number(v.datum.slice(8, 10)), 28), datum = `${monat}-${String(day).padStart(2, '0')}`;
      const r = await env.DB.prepare(`INSERT OR IGNORE INTO bh_ausgaben (datum, lieferant_id, beschreibung, kategorie_id, netto_rappen, mwst_satz, mwst_rappen, brutto_rappen, zahlungsart, zahlung, bezahlt_am, wiederkehrend, vorlage_id, periode, notiz, erstellt, geaendert)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'offen', NULL, '', ?, ?, ?, ?, ?13)`).bind(datum, v.lieferant_id, v.beschreibung, v.kategorie_id, v.netto_rappen, v.mwst_satz, v.mwst_rappen, v.brutto_rappen, v.zahlungsart, v.id, monat, 'Automatisch aus wiederkehrender Ausgabe ' + bhRef('A', v.id), nowIso()).run();
      neu += r.meta.changes;
    }
    if (neu) await log(env, `Buchhaltung: ${neu} wiederkehrende Ausgabe(n) für ${monat} erfasst`);
    return json({ok: true, neu, monat});
  }
  if (method === 'POST' && id && action === 'storno') {
    const d = await bhBody(request), grund = clean(d.grund, 300);
    if (!grund) return fail(400, 'Bitte einen Grund für die Stornierung angeben.');
    const a = await env.DB.prepare('SELECT datum, storniert, brutto_rappen FROM bh_ausgaben WHERE id = ?').bind(id).first();
    if (!a) return fail(404, 'Ausgabe nicht gefunden.');
    if (a.storniert) return fail(409, 'Diese Ausgabe ist bereits storniert.');
    const block = locked(s, a.datum); if (block) return block;
    await env.DB.prepare('UPDATE bh_ausgaben SET storniert = ?, storno_grund = ? WHERE id = ?').bind(nowIso(), grund, id).run();
    await log(env, `Buchhaltung: Ausgabe ${bhRef('A', id)} storniert (CHF ${chfCsv(a.brutto_rappen)}) – ${grund}`);
    return json({ok: true});
  }
  const d = await bhBody(request), r = await readExpense(env, s, d);
  if (r.error) return fail(400, r.error);
  const v = r.v, t = nowIso();
  if (method === 'POST' && !id) {
    const block = locked(s, v.datum); if (block) return block;
    const row = await env.DB.prepare(`INSERT INTO bh_ausgaben (datum, lieferant_id, beschreibung, kategorie_id, netto_rappen, mwst_satz, mwst_rappen, brutto_rappen, zahlungsart, zahlung, bezahlt_am, beleg_id, wiederkehrend, notiz, erstellt, geaendert)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?15) RETURNING id`).bind(v.datum, v.lieferant_id, v.beschreibung, v.kategorie_id, v.netto_rappen, v.mwst_satz, v.mwst_rappen, v.brutto_rappen, v.zahlungsart, v.zahlung, v.bezahlt_am, v.beleg_id, v.wiederkehrend, v.notiz, t).first();
    await log(env, `Buchhaltung: Ausgabe ${bhRef('A', row.id)} erfasst (CHF ${chfCsv(v.brutto_rappen)})`);
    return json({id: row.id, ref: bhRef('A', row.id)});
  }
  if (method === 'PUT' && id) {
    const old = await env.DB.prepare('SELECT * FROM bh_ausgaben WHERE id = ?').bind(id).first();
    if (!old) return fail(404, 'Ausgabe nicht gefunden.');
    if (old.storniert) return fail(409, 'Stornierte Ausgaben können nicht mehr geändert werden.');
    const block = locked(s, old.datum, v.datum); if (block) return block;
    await env.DB.prepare(`UPDATE bh_ausgaben SET datum = ?, lieferant_id = ?, beschreibung = ?, kategorie_id = ?, netto_rappen = ?, mwst_satz = ?, mwst_rappen = ?, brutto_rappen = ?, zahlungsart = ?, zahlung = ?, bezahlt_am = ?, beleg_id = ?, wiederkehrend = ?, notiz = ?, geaendert = ? WHERE id = ?`)
      .bind(v.datum, v.lieferant_id, v.beschreibung, v.kategorie_id, v.netto_rappen, v.mwst_satz, v.mwst_rappen, v.brutto_rappen, v.zahlungsart, v.zahlung, v.bezahlt_am, v.beleg_id, old.vorlage_id ? '' : v.wiederkehrend, v.notiz, t, id).run();
    // Nachvollziehbarkeit: alte und neue Werte der wichtigsten Felder ins Protokoll.
    const diff = [['Datum', old.datum, v.datum], ['Betrag CHF', chfCsv(old.brutto_rappen), chfCsv(v.brutto_rappen)], ['Zahlung', old.zahlung, v.zahlung]].filter(([, a, b]) => a !== b).map(([k, a, b]) => `${k} ${a} → ${b}`);
    await log(env, `Buchhaltung: Ausgabe ${bhRef('A', id)} geändert${diff.length ? ' (' + diff.join(', ') + ')' : ''}`);
    return json({ok: true});
  }
  return fail(405, 'Nicht erlaubt.');
}

// ---------------------------------------------------------------------------
// Einnahmen: Zahlungseingänge aus Bestellungen (automatisch, nur lesbar) + manuell erfasste Einnahmen.
async function bhIncome(request, env, s, q, part) {
  const method = request.method, id = Number(part[3]), action = part[4];
  if (method === 'GET') {
    const von = isDay(q.get('von')) ? q.get('von') : '0000-01-01', bis = isDay(q.get('bis')) ? q.get('bis') : '9999-12-31';
    const art = BH_ZAHLUNGSARTEN.includes(q.get('zahlungsart')) ? q.get('zahlungsart') : '', quelle = q.get('quelle'), search = clean(q.get('q') || '', 100).toLowerCase();
    const auto = quelle === 'manuell' ? [] : (await env.DB.prepare(`SELECT z.id, z.datum, z.betrag_rappen, z.art, z.zahlungsart, z.notiz, z.storniert, z.storno_grund, b.id AS bestellung_id, b.bestellnummer, k.vorname, k.nachname
      FROM bh_zahlungen z JOIN bestellungen b ON b.id = z.bestellung_id JOIN kunden k ON k.id = b.kunde_id WHERE z.datum BETWEEN ? AND ? ${q.get('storniert') === '1' ? '' : 'AND z.storniert IS NULL'} ORDER BY z.datum DESC, z.id DESC LIMIT 2000`).bind(von, bis).all()).results
      .map(z => ({quelle: 'bestellung', id: z.id, ref: bhRef('Z', z.id), datum: z.datum, beschreibung: `${z.art === 'rueckerstattung' ? 'Rückerstattung' : 'Zahlung'} Bestellung ${z.bestellnummer}`, kunde: `${z.vorname} ${z.nachname}`,
        kategorie: z.art === 'rueckerstattung' ? 'Rückerstattung' : 'T-Shirt-Verkäufe', betrag_rappen: z.betrag_rappen, mwst_rappen: s.bh_mwst_pflichtig === '1' ? mwstAus(z.betrag_rappen, satzBp(s.bh_mwst_standard)) : 0,
        zahlungsart: z.zahlungsart, status: z.storniert ? 'storniert' : 'gebucht', storno_grund: z.storno_grund, bestellung_id: z.bestellung_id, notiz: z.notiz}));
    const manual = quelle === 'bestellung' ? [] : (await env.DB.prepare(`SELECT e.*, c.name AS kategorie, bl.dateiname AS beleg_name, b.bestellnummer FROM bh_einnahmen e LEFT JOIN bh_kategorien c ON c.id = e.kategorie_id
      LEFT JOIN bh_belege bl ON bl.id = e.beleg_id LEFT JOIN bestellungen b ON b.id = e.bestellung_id WHERE e.datum BETWEEN ? AND ? ${q.get('storniert') === '1' ? '' : 'AND e.storniert IS NULL'} ORDER BY e.datum DESC, e.id DESC LIMIT 2000`).bind(von, bis).all()).results
      .map(e => ({...e, quelle: 'manuell', ref: bhRef('E', e.id), status: e.storniert ? 'storniert' : 'gebucht'}));
    let list = [...auto, ...manual].filter(x => (!art || x.zahlungsart === art) && (!search || [x.beschreibung, x.kunde, x.ref, x.kategorie, x.bestellnummer].join(' ').toLowerCase().includes(search)));
    list.sort((a, b) => b.datum.localeCompare(a.datum) || b.ref.localeCompare(a.ref));
    const summe = list.filter(x => x.status !== 'storniert').reduce((n, x) => n + x.betrag_rappen, 0), total = list.length, p = page(q);
    return json({einnahmen: list.slice(p * 50, p * 50 + 50), total, summe});
  }
  if (method === 'POST' && id && action === 'storno') {
    const d = await bhBody(request), grund = clean(d.grund, 300);
    if (!grund) return fail(400, 'Bitte einen Grund für die Stornierung angeben.');
    const e = await env.DB.prepare('SELECT datum, storniert, betrag_rappen FROM bh_einnahmen WHERE id = ?').bind(id).first();
    if (!e) return fail(404, 'Einnahme nicht gefunden.');
    if (e.storniert) return fail(409, 'Diese Einnahme ist bereits storniert.');
    const block = locked(s, e.datum); if (block) return block;
    await env.DB.prepare('UPDATE bh_einnahmen SET storniert = ?, storno_grund = ? WHERE id = ?').bind(nowIso(), grund, id).run();
    await log(env, `Buchhaltung: Einnahme ${bhRef('E', id)} storniert (CHF ${chfCsv(e.betrag_rappen)}) – ${grund}`);
    return json({ok: true});
  }
  const d = await bhBody(request);
  if (!isDay(d.datum)) return fail(400, 'Bitte ein gültiges Datum wählen.');
  const beschreibung = clean(d.beschreibung, 300); if (!beschreibung) return fail(400, 'Bitte eine Beschreibung eingeben.');
  const betrag = toRappen(d.betrag, {zero: false}); if (betrag === null) return fail(400, 'Bitte den Betrag eingeben, z. B. 89.00.');
  const kat = Number(d.kategorie_id);
  if (!(await env.DB.prepare("SELECT id FROM bh_kategorien WHERE id = ? AND art = 'einnahme'").bind(kat).first())) return fail(400, 'Bitte eine Kategorie wählen.');
  // Zahlungen zu Bestellungen gehören unter „Zahlungen“ – sonst würde der Betrag doppelt gezählt.
  let bestellung = null;
  if (d.bestellnummer) { bestellung = await env.DB.prepare('SELECT id FROM bestellungen WHERE bestellnummer = ?').bind(clean(d.bestellnummer, 40)).first(); if (!bestellung) return fail(400, 'Bestellnummer nicht gefunden.'); }
  const beleg = d.beleg_id ? Number(d.beleg_id) : null;
  if (beleg && !(await env.DB.prepare('SELECT id FROM bh_belege WHERE id = ? AND archiviert IS NULL').bind(beleg).first())) return fail(400, 'Beleg nicht gefunden.');
  const bp = s.bh_mwst_pflichtig === '1' ? satzBp(d.mwst_satz ?? s.bh_mwst_standard) : 0;
  if (bp === null) return fail(400, 'Ungültiger MWST-Satz.');
  const vals = [d.datum, beschreibung, clean(d.kunde, 160) || null, kat, betrag, bp / 100, mwstAus(betrag, bp), BH_ZAHLUNGSARTEN.includes(d.zahlungsart) ? d.zahlungsart : 'Sonstige', beleg, bestellung?.id || null, clean(d.notiz, 2000) || null, nowIso()];
  if (method === 'POST' && !id) {
    const block = locked(s, d.datum); if (block) return block;
    const row = await env.DB.prepare(`INSERT INTO bh_einnahmen (datum, beschreibung, kunde, kategorie_id, betrag_rappen, mwst_satz, mwst_rappen, zahlungsart, beleg_id, bestellung_id, notiz, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?12) RETURNING id`).bind(...vals).first();
    await log(env, `Buchhaltung: Einnahme ${bhRef('E', row.id)} erfasst (CHF ${chfCsv(betrag)})`);
    return json({id: row.id, ref: bhRef('E', row.id)});
  }
  if (method === 'PUT' && id) {
    const old = await env.DB.prepare('SELECT datum, storniert, betrag_rappen FROM bh_einnahmen WHERE id = ?').bind(id).first();
    if (!old) return fail(404, 'Einnahme nicht gefunden.');
    if (old.storniert) return fail(409, 'Stornierte Einnahmen können nicht mehr geändert werden.');
    const block = locked(s, old.datum, d.datum); if (block) return block;
    await env.DB.prepare('UPDATE bh_einnahmen SET datum = ?, beschreibung = ?, kunde = ?, kategorie_id = ?, betrag_rappen = ?, mwst_satz = ?, mwst_rappen = ?, zahlungsart = ?, beleg_id = ?, bestellung_id = ?, notiz = ?, geaendert = ? WHERE id = ?').bind(...vals, id).run();
    await log(env, `Buchhaltung: Einnahme ${bhRef('E', id)} geändert${old.betrag_rappen !== betrag ? ` (Betrag CHF ${chfCsv(old.betrag_rappen)} → ${chfCsv(betrag)})` : ''}`);
    return json({ok: true});
  }
  return fail(405, 'Nicht erlaubt.');
}

// ---------------------------------------------------------------------------
// Zahlungen zu Bestellungen (Teilzahlungen, Rückerstattungen) und offene Beträge.
async function bhPayments(request, env, s, q, part) {
  const method = request.method, id = Number(part[3]), action = part[4], frist = Number(s.bh_zahlungsfrist) || 30, today = zurichDay();
  if (method === 'GET' && !id) {
    const orders = (await env.DB.prepare(`${ORDER_FIN} ORDER BY b.datum DESC, b.id DESC LIMIT 3000`).all()).results.map(o => finance(o, frist, today));
    const filter = q.get('status') || 'offen', search = clean(q.get('q') || '', 100).toLowerCase();
    const pick = o => filter === 'alle' ? true : filter === 'ueberfaellig' ? o.ueberfaellig : filter === 'offen' ? o.offen > 0 : o.zustand === filter;
    const list = orders.filter(o => pick(o) && (!search || `${o.bestellnummer} ${o.vorname} ${o.nachname} ${o.email}`.toLowerCase().includes(search)));
    const sum = (arr, k) => arr.reduce((n, o) => n + o[k], 0), open = orders.filter(o => o.offen > 0), over = orders.filter(o => o.ueberfaellig);
    const recent = (await env.DB.prepare(`SELECT z.*, b.bestellnummer FROM bh_zahlungen z JOIN bestellungen b ON b.id = z.bestellung_id ORDER BY z.id DESC LIMIT 30`).all()).results.map(z => ({...z, ref: bhRef('Z', z.id)}));
    const ohne = (await env.DB.prepare("SELECT COUNT(*) AS n FROM bestellungen b WHERE b.zahlung IN ('bezahlt', 'rueckerstattet') AND NOT EXISTS (SELECT 1 FROM bh_zahlungen z WHERE z.bestellung_id = b.id)").first()).n;
    const p = page(q);
    return json({bestellungen: list.slice(p * 50, p * 50 + 50), total: list.length, zahlen: {offen: open.length, offen_rappen: sum(open, 'offen'), ueberfaellig: over.length, ueberfaellig_rappen: sum(over, 'offen'), teilweise: orders.filter(o => o.zustand === 'teilweise').length},
      zahlungen: recent, ohne_buchung: ohne, frist});
  }
  if (method === 'GET' && id) {
    const o = await env.DB.prepare(`${ORDER_FIN} WHERE b.id = ?`).bind(id).first();
    if (!o) return fail(404, 'Bestellung nicht gefunden.');
    const list = (await env.DB.prepare('SELECT * FROM bh_zahlungen WHERE bestellung_id = ? ORDER BY datum, id').bind(id).all()).results.map(z => ({...z, ref: bhRef('Z', z.id)}));
    return json({bestellung: finance(o, frist, today), zahlungen: list});
  }
  // Bestehende Bestellungen kontrolliert übernehmen: „bezahlt“/„rückerstattet“ ohne Zahlungsbuchung → Buchung nachtragen (idempotent).
  if (method === 'POST' && part[3] === 'uebernehmen') {
    const list = (await env.DB.prepare("SELECT id, bestellnummer, total_rappen, datum, bezahlt_am, zahlung FROM bestellungen b WHERE b.zahlung IN ('bezahlt', 'rueckerstattet') AND NOT EXISTS (SELECT 1 FROM bh_zahlungen z WHERE z.bestellung_id = b.id)").all()).results;
    const t = nowIso(), stmts = [];
    for (const b of list) {
      const datum = b.bezahlt_am || b.datum;
      stmts.push(env.DB.prepare("INSERT INTO bh_zahlungen (bestellung_id, datum, betrag_rappen, art, zahlungsart, quelle, notiz, erstellt) VALUES (?, ?, ?, 'zahlung', 'TWINT', 'uebernahme', 'Aus bisherigem Zahlungsstatus übernommen', ?)").bind(b.id, datum, b.total_rappen, t));
      if (b.zahlung === 'rueckerstattet') stmts.push(env.DB.prepare("INSERT INTO bh_zahlungen (bestellung_id, datum, betrag_rappen, art, zahlungsart, quelle, notiz, erstellt) VALUES (?, ?, ?, 'rueckerstattung', 'TWINT', 'uebernahme', 'Aus bisherigem Zahlungsstatus übernommen (Datum unbekannt)', ?)").bind(b.id, datum, -b.total_rappen, t));
    }
    if (stmts.length) await env.DB.batch(stmts);
    for (const b of list) await syncOrder(env, b.id);
    await log(env, `Buchhaltung: ${list.length} Bestellung(en) mit bisherigem Zahlungsstatus übernommen`);
    return json({ok: true, anzahl: list.length});
  }
  if (method === 'POST' && id && action === 'storno') {
    const d = await bhBody(request), grund = clean(d.grund, 300);
    if (!grund) return fail(400, 'Bitte einen Grund für die Stornierung angeben.');
    const z = await env.DB.prepare('SELECT z.*, b.bestellnummer FROM bh_zahlungen z JOIN bestellungen b ON b.id = z.bestellung_id WHERE z.id = ?').bind(id).first();
    if (!z) return fail(404, 'Zahlung nicht gefunden.');
    if (z.storniert) return fail(409, 'Diese Zahlung ist bereits storniert.');
    const block = locked(s, z.datum); if (block) return block;
    await env.DB.prepare('UPDATE bh_zahlungen SET storniert = ?, storno_grund = ? WHERE id = ?').bind(nowIso(), grund, id).run();
    await syncOrder(env, z.bestellung_id);
    await log(env, `Buchhaltung: Zahlung ${bhRef('Z', id)} (Bestellung ${z.bestellnummer}, CHF ${chfCsv(z.betrag_rappen)}) storniert – ${grund}`);
    return json({ok: true});
  }
  if (method === 'POST' && !id) {
    const d = await bhBody(request), bid = Number(d.bestellung_id);
    const o = await env.DB.prepare(`${ORDER_FIN} WHERE b.id = ?`).bind(bid).first();
    if (!o) return fail(404, 'Bestellung nicht gefunden.');
    if (!isDay(d.datum) || d.datum > today) return fail(400, 'Bitte ein gültiges Zahlungsdatum wählen (nicht in der Zukunft).');
    const block = locked(s, d.datum); if (block) return block;
    const betrag = toRappen(d.betrag, {zero: false}); if (betrag === null) return fail(400, 'Bitte den Betrag eingeben, z. B. 89.00.');
    const refund = d.art === 'rueckerstattung', f = finance(o, frist, today);
    if (refund && betrag > o.bezahlt - o.erstattet) return fail(400, `Es kann höchstens der bezahlte Betrag (CHF ${chfCsv(o.bezahlt - o.erstattet)}) zurückerstattet werden.`);
    if (!refund && betrag > f.offen) return fail(400, f.offen ? `Offen sind nur noch CHF ${chfCsv(f.offen)}. Überzahlungen bitte prüfen und als separate Einnahme erfassen.` : 'Diese Bestellung ist bereits vollständig bezahlt.');
    const row = await env.DB.prepare("INSERT INTO bh_zahlungen (bestellung_id, datum, betrag_rappen, art, zahlungsart, quelle, notiz, erstellt) VALUES (?, ?, ?, ?, ?, 'manuell', ?, ?) RETURNING id")
      .bind(bid, d.datum, refund ? -betrag : betrag, refund ? 'rueckerstattung' : 'zahlung', BH_ZAHLUNGSARTEN.includes(d.zahlungsart) ? d.zahlungsart : 'TWINT', clean(d.notiz, 500) || null, nowIso()).first();
    const zustand = await syncOrder(env, bid);
    await log(env, `Buchhaltung: ${refund ? 'Rückerstattung' : 'Zahlung'} ${bhRef('Z', row.id)} zu ${o.bestellnummer} erfasst (CHF ${chfCsv(betrag)})`);
    return json({id: row.id, zahlung: zustand});
  }
  return fail(405, 'Nicht erlaubt.');
}

// ---------------------------------------------------------------------------
// Direkte Kosten und Deckungsbeitrag pro Bestellung (Kalkulation – zählt NICHT als Ausgabe, damit nichts doppelt erscheint).
function contribution(o, kosten, s) {
  const pflichtig = s.bh_mwst_pflichtig === '1', bp = pflichtig ? satzBp(s.bh_mwst_standard) : 0;
  const brutto = o.status === 'storniert' ? 0 : Math.max(0, o.total_rappen - (o.gutgeschrieben || 0) - Math.max(0, (o.erstattet || 0) - (o.gutgeschrieben || 0)));
  const netto = brutto - mwstAus(brutto, bp), map = Object.fromEntries(kosten.map(k => [k.art, k]));
  const summe = kosten.reduce((n, k) => n + k.betrag_rappen, 0), fehlt = BH_PFLICHT_KOSTEN.filter(a => !map[a]);
  const db = netto - summe;
  return {erloes_netto: netto, kosten_summe: summe, deckungsbeitrag: db, marge: netto ? Math.round(db / netto * 1000) / 10 : null, fehlt, vollstaendig: !fehlt.length};
}
async function bhCosts(request, env, s, id, sub) {
  const o = await env.DB.prepare(`${ORDER_FIN} WHERE b.id = ?`).bind(id).first();
  if (!o) return fail(404, 'Bestellung nicht gefunden.');
  const load = async () => (await env.DB.prepare('SELECT art, betrag_rappen, notiz FROM bh_kosten WHERE bestellung_id = ?').bind(id).all()).results;
  if (request.method === 'GET') { const k = await load(); return json({bestellung: {id: o.id, bestellnummer: o.bestellnummer, total_rappen: o.total_rappen, anzahl: o.anzahl, status: o.status}, kosten: k, arten: BH_KOSTENARTEN, rechnung: contribution(o, k, s), mwst_pflichtig: s.bh_mwst_pflichtig === '1'}); }
  if (request.method === 'POST' && sub === 'standard') {
    // Standardkosten aus den Einstellungen nur dort einsetzen, wo noch nichts erfasst ist.
    const k = await load(), have = new Set(k.map(x => x.art)), t = nowIso(), stmts = [];
    const per = {textilien: Number(s.bh_std_textilien) * o.anzahl, druck: Number(s.bh_std_druck) * o.anzahl, verpackung: Number(s.bh_std_verpackung), versand: Number(s.bh_std_versand),
      gebuehren: s.bh_std_gebuehren_prozent ? Math.round(o.total_rappen * satzBp(s.bh_std_gebuehren_prozent) / 10000) : NaN};
    const filled = [];
    for (const [art, v] of Object.entries(per)) if (!have.has(art) && s[art === 'gebuehren' ? 'bh_std_gebuehren_prozent' : `bh_std_${art}`] !== '' && Number.isFinite(v)) {
      stmts.push(env.DB.prepare('INSERT OR IGNORE INTO bh_kosten (bestellung_id, art, betrag_rappen, notiz, geaendert) VALUES (?, ?, ?, ?, ?)').bind(id, art, Math.round(v), 'Standardkosten', t)); filled.push(art);
    }
    if (!stmts.length) return fail(400, 'Keine Standardkosten eingesetzt: Entweder sind alle Kosten schon erfasst oder in den Buchhaltungs-Einstellungen sind keine Standardkosten hinterlegt.');
    await env.DB.batch(stmts); await log(env, `Buchhaltung: Standardkosten für ${o.bestellnummer} eingesetzt`);
    return json({ok: true, eingesetzt: filled});
  }
  if (request.method === 'PUT') {
    const d = await bhBody(request), t = nowIso(), stmts = [];
    for (const art of Object.keys(BH_KOSTENARTEN)) {
      if (!(art in (d.kosten || {}))) continue;
      const raw = d.kosten[art];
      if (raw === '' || raw === null) { stmts.push(env.DB.prepare('DELETE FROM bh_kosten WHERE bestellung_id = ? AND art = ?').bind(id, art)); continue; }
      const r = toRappen(raw); if (r === null) return fail(400, `Ungültiger Betrag bei „${BH_KOSTENARTEN[art]}“.`);
      stmts.push(env.DB.prepare('INSERT INTO bh_kosten (bestellung_id, art, betrag_rappen, notiz, geaendert) VALUES (?, ?, ?, NULL, ?) ON CONFLICT(bestellung_id, art) DO UPDATE SET betrag_rappen = excluded.betrag_rappen, notiz = NULL, geaendert = excluded.geaendert').bind(id, art, r, t));
    }
    if (!stmts.length) return fail(400, 'Keine Änderung.');
    await env.DB.batch(stmts); await log(env, `Buchhaltung: Kosten für ${o.bestellnummer} gespeichert`);
    return json({ok: true});
  }
  return fail(405, 'Nicht erlaubt.');
}

// ---------------------------------------------------------------------------
// Rechnungen und Gutschriften: fortlaufende Nummern je Jahr (RE-2026-0001), nie gelöscht, nur storniert.
// Die Rechnungsdaten werden beim Erstellen festgehalten (spätere Adressänderungen ändern die Rechnung nicht).
async function nextNumber(env, prefix, year) {
  const key = `bh_nr_${prefix}_${year}`;
  await env.DB.prepare("INSERT OR IGNORE INTO einstellungen (schluessel, wert) VALUES (?, '0')").bind(key).run();
  const r = await env.DB.prepare('UPDATE einstellungen SET wert = CAST(wert AS INTEGER) + 1 WHERE schluessel = ? RETURNING wert').bind(key).first();
  return `${prefix}-${year}-${String(r.wert).padStart(4, '0')}`;
}
async function bhInvoices(request, env, s, q, part) {
  const method = request.method, id = Number(part[3]), action = part[4], frist = Number(s.bh_zahlungsfrist) || 30, today = zurichDay();
  if (method === 'GET' && part[3] === 'kandidaten') {
    const list = (await env.DB.prepare(`SELECT b.id, b.bestellnummer, b.datum, b.total_rappen, k.vorname, k.nachname FROM bestellungen b JOIN kunden k ON k.id = b.kunde_id
      WHERE b.status != 'storniert' AND NOT EXISTS (SELECT 1 FROM bh_rechnungen r WHERE r.bestellung_id = b.id AND r.art = 'rechnung' AND r.storniert IS NULL) ORDER BY b.datum DESC, b.id DESC LIMIT 200`).all()).results;
    return json({bestellungen: list});
  }
  if (method === 'GET' && !id) {
    const search = clean(q.get('q') || '', 100).toLowerCase(), filter = q.get('status') || '';
    const rows = (await env.DB.prepare(`SELECT r.*, b.bestellnummer FROM bh_rechnungen r LEFT JOIN bestellungen b ON b.id = r.bestellung_id ORDER BY r.datum DESC, r.id DESC LIMIT 2000`).all()).results;
    const fin = Object.fromEntries((await env.DB.prepare(`${ORDER_FIN} WHERE b.id IN (SELECT bestellung_id FROM bh_rechnungen)`).all()).results.map(o => [o.id, finance(o, frist, today)]));
    const list = rows.map(r => {
      const data = JSON.parse(r.daten || '{}'), f = fin[r.bestellung_id];
      const zustand = r.storniert ? 'storniert' : r.art === 'gutschrift' ? 'gutschrift' : f?.zustand === 'bezahlt' || f?.zustand === 'rueckerstattet' ? f.zustand : f?.bezahlt > 0 ? 'teilweise' : r.faellig < today ? 'ueberfaellig' : 'offen';
      return {id: r.id, nummer: r.nummer, art: r.art, datum: r.datum, faellig: r.faellig, betrag_rappen: r.betrag_rappen, bestellnummer: r.bestellnummer, bestellung_id: r.bestellung_id, kunde: data.empfaenger?.name || '', zustand, offen_rappen: r.art === 'rechnung' && !r.storniert ? f?.offen || 0 : 0};
    }).filter(r => (!filter || r.zustand === filter) && (!search || `${r.nummer} ${r.bestellnummer} ${r.kunde}`.toLowerCase().includes(search)));
    const p = page(q);
    return json({rechnungen: list.slice(p * 50, p * 50 + 50), total: list.length});
  }
  if (method === 'GET' && id) {
    const r = await env.DB.prepare('SELECT r.*, b.bestellnummer FROM bh_rechnungen r LEFT JOIN bestellungen b ON b.id = r.bestellung_id WHERE r.id = ?').bind(id).first();
    if (!r) return fail(404, 'Rechnung nicht gefunden.');
    const o = r.bestellung_id ? await env.DB.prepare(`${ORDER_FIN} WHERE b.id = ?`).bind(r.bestellung_id).first() : null;
    const bezug = r.bezug_id ? await env.DB.prepare('SELECT nummer FROM bh_rechnungen WHERE id = ?').bind(r.bezug_id).first() : null;
    const gutschriften = (await env.DB.prepare("SELECT id, nummer, datum, betrag_rappen, storniert FROM bh_rechnungen WHERE bezug_id = ? AND art = 'gutschrift' ORDER BY id").bind(id).all()).results;
    return json({rechnung: {...r, daten: JSON.parse(r.daten || '{}'), bezug_nummer: bezug?.nummer || null}, zahlung: o ? finance(o, frist, today) : null, gutschriften});
  }
  if (method === 'POST' && !id) {
    const d = await bhBody(request), bid = Number(d.bestellung_id);
    const o = await env.DB.prepare(`${ORDER_FIN} WHERE b.id = ?`).bind(bid).first();
    if (!o) return fail(404, 'Bestellung nicht gefunden.');
    if (o.status === 'storniert') return fail(400, 'Für stornierte Bestellungen wird keine Rechnung erstellt.');
    if (o.rechnung_id) return json({id: o.rechnung_id, vorhanden: true}); // idempotent: nie zwei Rechnungen pro Bestellung
    const block = locked(s, today); if (block) return block;
    const k = await env.DB.prepare('SELECT * FROM kunden WHERE id = ?').bind(o.kunde_id).first();
    const b = await env.DB.prepare('SELECT lieferadresse, versand_rappen FROM bestellungen WHERE id = ?').bind(bid).first();
    const designs = (await env.DB.prepare('SELECT design_nr, anzahl, einzelpreis_rappen, summe_rappen, farbe FROM bestell_designs WHERE bestellung_id = ? ORDER BY design_nr').bind(bid).all()).results;
    const positionen = designs.map(x => ({text: `T-Shirt Design ${x.design_nr}, individuell bedruckt (360°-Druck)${x.anzahl > 1 ? ` – 1 × ${chfCsv(x.einzelpreis_rappen)}, weitere je ${chfCsv(Math.round((x.summe_rappen - x.einzelpreis_rappen) / (x.anzahl - 1)))}` : ''}`, menge: x.anzahl, betrag_rappen: x.summe_rappen}));
    const posSum = positionen.reduce((n, p) => n + p.betrag_rappen, 0);
    if (b.versand_rappen) positionen.push({text: 'Versand', menge: 1, betrag_rappen: b.versand_rappen});
    if (posSum + (b.versand_rappen || 0) !== o.total_rappen) positionen.push({text: posSum + (b.versand_rappen || 0) > o.total_rappen ? 'Rabatt' : 'Ausgleich', menge: 1, betrag_rappen: o.total_rappen - posSum - (b.versand_rappen || 0)});
    const faellig = new Date(new Date(`${today}T12:00:00Z`).getTime() + frist * 86400000).toISOString().slice(0, 10);
    const daten = {absender: {firma: s.bh_firma, adresse: String(s.adresse || '').split(/\s*·\s*/).filter(Boolean), uid: s.bh_uid, mwst_nummer: s.bh_mwst_pflichtig === '1' ? s.bh_mwst_nummer : '', iban: s.bh_iban, bank: s.bh_bank},
      empfaenger: {name: `${k.vorname} ${k.nachname}`, strasse: k.strasse, ort: `${k.plz || ''} ${k.ort || ''}`.trim(), land: k.land, email: k.email, kundennummer: `K-${10000 + k.id}`},
      positionen, mwst: s.bh_mwst_pflichtig === '1' ? {satz: Number(s.bh_mwst_standard), betrag_rappen: mwstAus(o.total_rappen, satzBp(s.bh_mwst_standard))} : null, zahlungsfrist: frist, twint: '079 915 48 24'};
    const nummer = await nextNumber(env, s.bh_rechnung_praefix || 'RE', today.slice(0, 4));
    const row = await env.DB.prepare("INSERT INTO bh_rechnungen (nummer, art, bestellung_id, datum, faellig, betrag_rappen, daten, erstellt) VALUES (?, 'rechnung', ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(nummer, bid, today, faellig, o.total_rappen, JSON.stringify(daten), nowIso()).first().catch(async () => null);
    if (!row) { const again = await env.DB.prepare("SELECT id FROM bh_rechnungen WHERE bestellung_id = ? AND art = 'rechnung' AND storniert IS NULL").bind(bid).first(); if (again) return json({id: again.id, vorhanden: true}); throw Error('Rechnung konnte nicht erstellt werden.'); }
    await log(env, `Buchhaltung: Rechnung ${nummer} für ${o.bestellnummer} erstellt`);
    return json({id: row.id, nummer});
  }
  if (method === 'POST' && id && action === 'gutschrift') {
    const d = await bhBody(request), grund = clean(d.grund, 300);
    const r = await env.DB.prepare("SELECT * FROM bh_rechnungen WHERE id = ? AND art = 'rechnung'").bind(id).first();
    if (!r) return fail(404, 'Rechnung nicht gefunden.');
    if (r.storniert) return fail(409, 'Zu einer stornierten Rechnung gibt es keine Gutschrift.');
    if (!grund) return fail(400, 'Bitte einen Grund angeben (z. B. Teilrückerstattung, Reklamation).');
    const betrag = toRappen(d.betrag, {zero: false}); if (betrag === null) return fail(400, 'Bitte den Betrag eingeben.');
    const bisher = (await env.DB.prepare("SELECT COALESCE(SUM(betrag_rappen), 0) AS n FROM bh_rechnungen WHERE bezug_id = ? AND art = 'gutschrift' AND storniert IS NULL").bind(id).first()).n;
    if (betrag + bisher > r.betrag_rappen) return fail(400, `Gutschriften dürfen den Rechnungsbetrag nicht übersteigen (noch möglich: CHF ${chfCsv(r.betrag_rappen - bisher)}).`);
    const block = locked(s, today); if (block) return block;
    const data = JSON.parse(r.daten || '{}');
    const daten = {...data, positionen: [{text: `Gutschrift zu Rechnung ${r.nummer}: ${grund}`, menge: 1, betrag_rappen: betrag}], grund, mwst: data.mwst ? {satz: data.mwst.satz, betrag_rappen: mwstAus(betrag, satzBp(data.mwst.satz))} : null};
    const nummer = await nextNumber(env, s.bh_gutschrift_praefix || 'GS', today.slice(0, 4));
    const row = await env.DB.prepare("INSERT INTO bh_rechnungen (nummer, art, bestellung_id, bezug_id, datum, faellig, betrag_rappen, daten, erstellt) VALUES (?, 'gutschrift', ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(nummer, r.bestellung_id, id, today, today, betrag, JSON.stringify(daten), nowIso()).first();
    if (r.bestellung_id) await syncOrder(env, r.bestellung_id);
    await log(env, `Buchhaltung: Gutschrift ${nummer} zu ${r.nummer} erstellt (CHF ${chfCsv(betrag)})`);
    return json({id: row.id, nummer});
  }
  if (method === 'POST' && id && action === 'storno') {
    const d = await bhBody(request), grund = clean(d.grund, 300);
    if (!grund) return fail(400, 'Bitte einen Grund für die Stornierung angeben.');
    const r = await env.DB.prepare('SELECT * FROM bh_rechnungen WHERE id = ?').bind(id).first();
    if (!r) return fail(404, 'Rechnung nicht gefunden.');
    if (r.storniert) return fail(409, 'Bereits storniert.');
    const block = locked(s, r.datum); if (block) return block;
    await env.DB.prepare('UPDATE bh_rechnungen SET storniert = ?, storno_grund = ? WHERE id = ?').bind(nowIso(), grund, id).run();
    if (r.bestellung_id) await syncOrder(env, r.bestellung_id);
    await log(env, `Buchhaltung: ${r.art === 'gutschrift' ? 'Gutschrift' : 'Rechnung'} ${r.nummer} storniert – ${grund}`);
    return json({ok: true});
  }
  return fail(405, 'Nicht erlaubt.');
}

// ---------------------------------------------------------------------------
// Belege: privat im Bildspeicher (R2) unter belege/…, nur angemeldet abrufbar. Nie endgültig gelöscht, nur archiviert.
const BH_BELEG_TYPEN = {'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png'};
async function bhReceipts(request, env, q, id, sub) {
  const method = request.method;
  if (method === 'GET' && !id) {
    const search = clean(q.get('q') || '', 100), archiv = q.get('archiv') === '1';
    const where = [archiv ? 'b.archiviert IS NOT NULL' : 'b.archiviert IS NULL'], args = [];
    if (search) { args.push(like(search)); where.push(`(b.dateiname LIKE ?1 ESCAPE '\\' OR b.notiz LIKE ?1 ESCAPE '\\')`); }
    const list = (await env.DB.prepare(`SELECT b.*,
        (SELECT GROUP_CONCAT(id) FROM bh_ausgaben a WHERE a.beleg_id = b.id) AS ausgaben,
        (SELECT GROUP_CONCAT(id) FROM bh_einnahmen e WHERE e.beleg_id = b.id) AS einnahmen,
        (SELECT GROUP_CONCAT(nummer) FROM bh_rechnungen r WHERE r.beleg_id = b.id) AS rechnungen
      FROM bh_belege b WHERE ${where.join(' AND ')} ORDER BY b.id DESC LIMIT 50 OFFSET ${page(q) * 50}`).bind(...args).all()).results;
    const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM bh_belege b WHERE ${where.join(' AND ')}`).bind(...args).first()).n;
    return json({belege: list.map(b => ({...b, ref: bhRef('B', b.id), ausgaben: b.ausgaben ? String(b.ausgaben).split(',').map(x => bhRef('A', x)) : [], einnahmen: b.einnahmen ? String(b.einnahmen).split(',').map(x => bhRef('E', x)) : [], rechnungen: b.rechnungen ? String(b.rechnungen).split(',') : []})), total});
  }
  if (method === 'GET' && id && sub === 'datei') {
    const b = await env.DB.prepare('SELECT * FROM bh_belege WHERE id = ?').bind(id).first();
    if (!b || !env.BILDER) return fail(404, 'Beleg nicht gefunden.');
    const object = await env.BILDER.get(b.schluessel);
    if (!object) return fail(404, 'Die Belegdatei fehlt im Speicher.');
    const name = b.dateiname.replace(/[^\w.\-äöüÄÖÜ ]/g, '_');
    // Eigene Sicherheitsregeln: darf nur in der Verwaltung selbst (gleiche Herkunft) als Vorschau eingebettet werden.
    return new Response(object.body, {headers: {...SECURITY, 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
      'Content-Type': b.typ, 'Cache-Control': 'private, no-store', 'Content-Disposition': `${q.get('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`}});
  }
  if (method === 'POST' && !id) {
    if (!env.BILDER) return fail(503, 'Der Bildspeicher (R2) ist noch nicht verbunden.');
    const form = await request.formData().catch(() => null), file = form?.get('datei');
    if (!file || typeof file === 'string') return fail(400, 'Keine Datei erhalten.');
    if (file.size > 10 * 1024 * 1024) return fail(400, 'Die maximale Grösse von 10 MB ist überschritten.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Dateityp am Inhalt prüfen, nicht nur an der Endung.
    const typ = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? 'application/pdf' : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
      : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? 'image/png' : '';
    if (!typ) return fail(400, 'Bitte ein PDF-, JPG- oder PNG-Dokument hochladen.');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    const dup = await env.DB.prepare('SELECT id, dateiname FROM bh_belege WHERE sha256 = ?').bind(hash).first();
    if (dup) return json({id: dup.id, ref: bhRef('B', dup.id), dateiname: dup.dateiname, doppelt: true});
    const key = `belege/${zurichDay().slice(0, 4)}/${crypto.randomUUID()}.${BH_BELEG_TYPEN[typ]}`;
    await env.BILDER.put(key, bytes, {httpMetadata: {contentType: typ}});
    const dateiname = clean(file.name || `beleg.${BH_BELEG_TYPEN[typ]}`, 160) || `beleg.${BH_BELEG_TYPEN[typ]}`;
    const row = await env.DB.prepare('INSERT INTO bh_belege (schluessel, dateiname, typ, groesse, sha256, notiz, hochgeladen) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(key, dateiname, typ, bytes.length, hash, clean(form.get('notiz'), 500) || null, nowIso()).first();
    await log(env, `Buchhaltung: Beleg ${bhRef('B', row.id)} hochgeladen`);
    return json({id: row.id, ref: bhRef('B', row.id), dateiname});
  }
  if (method === 'POST' && id && sub === 'archiv') {
    const d = await bhBody(request), grund = clean(d.grund, 300);
    if (!grund) return fail(400, 'Bitte einen Grund angeben.');
    const used = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM bh_ausgaben WHERE beleg_id = ?1 AND storniert IS NULL) + (SELECT COUNT(*) FROM bh_einnahmen WHERE beleg_id = ?1 AND storniert IS NULL) AS n').bind(id).first();
    if (used.n) return fail(409, 'Dieser Beleg gehört zu einer gültigen Buchung und muss aufbewahrt werden (10 Jahre). Zuerst die Buchung stornieren.');
    const r = await env.DB.prepare('UPDATE bh_belege SET archiviert = ?, archiv_grund = ? WHERE id = ? AND archiviert IS NULL').bind(nowIso(), grund, id).run();
    if (!r.meta.changes) return fail(404, 'Beleg nicht gefunden.');
    await log(env, `Buchhaltung: Beleg ${bhRef('B', id)} archiviert – ${grund}`);
    return json({ok: true});
  }
  if (method === 'PATCH' && id) {
    const d = await bhBody(request);
    await env.DB.prepare('UPDATE bh_belege SET notiz = ? WHERE id = ?').bind(clean(d.notiz, 500) || null, id).run();
    return json({ok: true});
  }
  return fail(405, 'Nicht erlaubt.');
}

// ---------------------------------------------------------------------------
// Übersicht, Auswertungen, Export
function months12(today = zurichDay()) {
  const [y, m] = today.split('-').map(Number), out = [];
  for (let i = 11; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  return out;
}
function periodRange(q, s) {
  const today = zurichDay(), p = q.get('zeitraum') || 'monat';
  const {week, month} = periodStarts();
  if (p === 'heute') return {von: today, bis: today, zeitraum: p};
  if (p === 'woche') return {von: week, bis: today, zeitraum: p};
  if (p === 'jahr') return {von: gjStart(s, today), bis: today, zeitraum: p};
  if (p === 'eigen' && isDay(q.get('von')) && isDay(q.get('bis')) && q.get('von') <= q.get('bis')) return {von: q.get('von'), bis: q.get('bis'), zeitraum: p};
  return {von: month, bis: today, zeitraum: 'monat'};
}
async function sums(env, von, bis) {
  const r = await env.DB.prepare(`SELECT
      (SELECT COALESCE(SUM(betrag_rappen), 0) FROM bh_zahlungen WHERE storniert IS NULL AND datum BETWEEN ?1 AND ?2) AS zahlungen,
      (SELECT COALESCE(SUM(betrag_rappen), 0) FROM bh_einnahmen WHERE storniert IS NULL AND datum BETWEEN ?1 AND ?2) AS manuell,
      (SELECT COALESCE(SUM(brutto_rappen), 0) FROM bh_ausgaben WHERE storniert IS NULL AND datum BETWEEN ?1 AND ?2) AS ausgaben,
      (SELECT COALESCE(SUM(total_rappen), 0) FROM bestellungen WHERE status != 'storniert' AND datum BETWEEN ?1 AND ?2) AS bestellwert,
      (SELECT COALESCE(SUM(betrag_rappen), 0) FROM bh_rechnungen WHERE art = 'gutschrift' AND storniert IS NULL AND datum BETWEEN ?1 AND ?2) AS gutschriften,
      (SELECT COUNT(DISTINCT bestellung_id) FROM bh_zahlungen WHERE storniert IS NULL AND betrag_rappen > 0 AND datum BETWEEN ?1 AND ?2) AS bezahlte_bestellungen`).bind(von, bis).first();
  const einnahmen = r.zahlungen + r.manuell;
  return {einnahmen, ausgaben: r.ausgaben, ergebnis: einnahmen - r.ausgaben, umsatz: r.bestellwert - r.gutschriften, bezahlte_bestellungen: r.bezahlte_bestellungen};
}
async function bhOverview(env, s, q) {
  const today = zurichDay(), range = periodRange(q, s), frist = Number(s.bh_zahlungsfrist) || 30;
  const [periode, monat, jahr] = await Promise.all([sums(env, range.von, range.bis), sums(env, today.slice(0, 8) + '01', today), sums(env, gjStart(s, today), today)]);
  const orders = (await env.DB.prepare(`${ORDER_FIN} WHERE b.status != 'storniert'`).all()).results.map(o => finance(o, frist, today));
  const open = orders.filter(o => o.offen > 0), over = open.filter(o => o.ueberfaellig);
  const labels = months12(today), first = labels[0] + '-01';
  const inc = Object.fromEntries((await env.DB.prepare(`SELECT substr(datum, 1, 7) AS m, SUM(betrag_rappen) AS n FROM (SELECT datum, betrag_rappen FROM bh_zahlungen WHERE storniert IS NULL AND datum >= ?1
      UNION ALL SELECT datum, betrag_rappen FROM bh_einnahmen WHERE storniert IS NULL AND datum >= ?1) GROUP BY m`).bind(first).all()).results.map(r => [r.m, r.n]));
  const exp = Object.fromEntries((await env.DB.prepare(`SELECT substr(datum, 1, 7) AS m, SUM(brutto_rappen) AS n FROM bh_ausgaben WHERE storniert IS NULL AND datum >= ? GROUP BY m`).bind(first).all()).results.map(r => [r.m, r.n]));
  const kategorien = (await env.DB.prepare(`SELECT c.name, SUM(a.brutto_rappen) AS summe FROM bh_ausgaben a JOIN bh_kategorien c ON c.id = a.kategorie_id WHERE a.storniert IS NULL AND a.datum BETWEEN ? AND ? GROUP BY c.id ORDER BY summe DESC`).bind(range.von, range.bis).all()).results;
  const offeneAusgaben = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(brutto_rappen), 0) AS summe FROM bh_ausgaben WHERE storniert IS NULL AND zahlung = 'offen'").first();
  return {zeitraum: range, periode, monat, jahr, gj_start: gjStart(s, today),
    offen: {anzahl: open.length, summe: open.reduce((n, o) => n + o.offen, 0)}, ueberfaellig: {anzahl: over.length, summe: over.reduce((n, o) => n + o.offen, 0), liste: over.slice(0, 8)},
    offene_ausgaben: offeneAusgaben, verlauf: labels.map(m => ({periode: m, einnahmen: Number(inc[m]) || 0, ausgaben: Number(exp[m]) || 0})), kategorien, mwst_pflichtig: s.bh_mwst_pflichtig === '1'};
}

async function bhReports(env, s, q) {
  const today = zurichDay(), von = isDay(q.get('von')) ? q.get('von') : gjStart(s, today), bis = isDay(q.get('bis')) ? q.get('bis') : today;
  const all = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
  const umsatzMonat = await all(`SELECT substr(datum, 1, 7) AS periode, SUM(total_rappen) AS summe, COUNT(*) AS anzahl, SUM(anzahl) AS shirts FROM bestellungen WHERE status != 'storniert' AND datum BETWEEN ? AND ? GROUP BY periode ORDER BY periode`, von, bis);
  const umsatzJahr = await all(`SELECT substr(datum, 1, 4) AS periode, SUM(total_rappen) AS summe, COUNT(*) AS anzahl, SUM(anzahl) AS shirts FROM bestellungen WHERE status != 'storniert' GROUP BY periode ORDER BY periode`);
  const einnahmenKat = await all(`SELECT 'T-Shirt-Verkäufe (Zahlungen)' AS name, COALESCE(SUM(betrag_rappen), 0) AS summe FROM bh_zahlungen WHERE storniert IS NULL AND datum BETWEEN ?1 AND ?2
      UNION ALL SELECT c.name, SUM(e.betrag_rappen) FROM bh_einnahmen e JOIN bh_kategorien c ON c.id = e.kategorie_id WHERE e.storniert IS NULL AND e.datum BETWEEN ?1 AND ?2 GROUP BY c.id`, von, bis);
  // Achtung: bh_ausgaben hat selbst eine Spalte „periode“ – darum hier ein eigener Name für den Monat.
  const ausgabenMonat = (await all(`SELECT substr(datum, 1, 7) AS monat, SUM(brutto_rappen) AS summe, COUNT(*) AS anzahl FROM bh_ausgaben WHERE storniert IS NULL AND datum BETWEEN ? AND ? GROUP BY monat ORDER BY monat`, von, bis))
    .map(r => ({periode: r.monat, summe: r.summe, anzahl: r.anzahl}));
  const ausgabenKat = await all(`SELECT c.name, SUM(a.brutto_rappen) AS summe, COUNT(*) AS anzahl FROM bh_ausgaben a JOIN bh_kategorien c ON c.id = a.kategorie_id WHERE a.storniert IS NULL AND a.datum BETWEEN ? AND ? GROUP BY c.id ORDER BY summe DESC`, von, bis);
  const ausgabenLief = await all(`SELECT COALESCE(l.name, 'Ohne Lieferant') AS name, SUM(a.brutto_rappen) AS summe, COUNT(*) AS anzahl FROM bh_ausgaben a LEFT JOIN bh_lieferanten l ON l.id = a.lieferant_id WHERE a.storniert IS NULL AND a.datum BETWEEN ? AND ? GROUP BY a.lieferant_id ORDER BY summe DESC`, von, bis);
  const orders = await all(`${ORDER_FIN} WHERE b.datum BETWEEN ? AND ? ORDER BY b.datum DESC, b.id DESC`, von, bis);
  const kosten = await all(`SELECT bestellung_id, art, betrag_rappen FROM bh_kosten WHERE bestellung_id IN (SELECT id FROM bestellungen WHERE datum BETWEEN ? AND ?)`, von, bis);
  const byOrder = {}; for (const k of kosten) (byOrder[k.bestellung_id] ||= []).push(k);
  const db = orders.filter(o => o.status !== 'storniert').map(o => ({id: o.id, bestellnummer: o.bestellnummer, datum: o.datum, kunde: `${o.vorname} ${o.nachname}`, anzahl: o.anzahl, ...contribution(o, byOrder[o.id] || [], s)}));
  const dbMonat = {};
  for (const o of db) { const m = o.datum.slice(0, 7), x = dbMonat[m] ||= {periode: m, erloes: 0, kosten: 0, deckungsbeitrag: 0, unvollstaendig: 0}; x.erloes += o.erloes_netto; x.kosten += o.kosten_summe; x.deckungsbeitrag += o.deckungsbeitrag; if (!o.vollstaendig) x.unvollstaendig++; }
  return {von, bis, umsatz_monat: umsatzMonat, umsatz_jahr: umsatzJahr, einnahmen_kategorie: einnahmenKat.filter(r => r.summe), ausgaben_monat: ausgabenMonat, ausgaben_kategorie: ausgabenKat, ausgaben_lieferant: ausgabenLief,
    deckungsbeitrag: db, deckungsbeitrag_monat: Object.values(dbMonat).sort((a, b) => a.periode.localeCompare(b.periode)), ergebnis: await sums(env, von, bis), mwst_pflichtig: s.bh_mwst_pflichtig === '1'};
}

async function bhExport(env, s, name, q) {
  const today = zurichDay(), von = isDay(q.get('von')) ? q.get('von') : '0000-01-01', bis = isDay(q.get('bis')) ? q.get('bis') : '9999-12-31';
  const all = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
  const de = d => d ? d.split('-').reverse().join('.') : '';
  let rows;
  if (name === 'journal.csv') {
    // Für den Treuhänder: alle Geldflüsse chronologisch mit eindeutiger Belegreferenz (inkl. Stornos zur Nachvollziehbarkeit).
    const z = await all(`SELECT z.*, b.bestellnummer, k.vorname || ' ' || k.nachname AS kunde FROM bh_zahlungen z JOIN bestellungen b ON b.id = z.bestellung_id JOIN kunden k ON k.id = b.kunde_id WHERE z.datum BETWEEN ? AND ?`, von, bis);
    const e = await all(`SELECT e.*, c.name AS kat, bl.id AS bid FROM bh_einnahmen e LEFT JOIN bh_kategorien c ON c.id = e.kategorie_id LEFT JOIN bh_belege bl ON bl.id = e.beleg_id WHERE e.datum BETWEEN ? AND ?`, von, bis);
    const a = await all(`SELECT a.*, c.name AS kat, l.name AS lief FROM bh_ausgaben a LEFT JOIN bh_kategorien c ON c.id = a.kategorie_id LEFT JOIN bh_lieferanten l ON l.id = a.lieferant_id WHERE a.datum BETWEEN ? AND ?`, von, bis);
    const list = [
      ...z.map(x => [x.datum, bhRef('Z', x.id), x.art === 'rueckerstattung' ? 'Rückerstattung' : 'Einnahme', `${x.art === 'rueckerstattung' ? 'Rückerstattung' : 'Zahlung'} Bestellung ${x.bestellnummer}`, x.kunde, 'T-Shirt-Verkäufe', chfCsv(x.betrag_rappen), '', x.zahlungsart, '', x.storniert ? 'storniert: ' + (x.storno_grund || '') : '']),
      ...e.map(x => [x.datum, bhRef('E', x.id), 'Einnahme', x.beschreibung, x.kunde, x.kat, chfCsv(x.betrag_rappen), chfCsv(x.mwst_rappen), x.zahlungsart, x.bid ? bhRef('B', x.bid) : '', x.storniert ? 'storniert: ' + (x.storno_grund || '') : '']),
      ...a.map(x => [x.datum, bhRef('A', x.id), 'Ausgabe', x.beschreibung, x.lief, x.kat, chfCsv(-x.brutto_rappen), chfCsv(-x.mwst_rappen), x.zahlungsart, x.beleg_id ? bhRef('B', x.beleg_id) : '', x.storniert ? 'storniert: ' + (x.storno_grund || '') : x.zahlung === 'offen' ? 'noch nicht bezahlt' : ''])
    ].sort((p, r) => p[0].localeCompare(r[0]) || p[1].localeCompare(r[1])).map(r => [de(r[0]), ...r.slice(1)]);
    rows = [['Datum', 'Referenz', 'Art', 'Beschreibung', 'Kunde/Lieferant', 'Kategorie', 'Betrag CHF', 'davon MWST CHF', 'Zahlungsart', 'Beleg', 'Bemerkung'], ...list];
  } else if (name === 'ausgaben.csv') {
    const a = await all(`SELECT a.*, c.name AS kat, l.name AS lief FROM bh_ausgaben a LEFT JOIN bh_kategorien c ON c.id = a.kategorie_id LEFT JOIN bh_lieferanten l ON l.id = a.lieferant_id WHERE a.datum BETWEEN ? AND ? ORDER BY a.datum, a.id`, von, bis);
    rows = [['Datum', 'Referenz', 'Lieferant', 'Beschreibung', 'Kategorie', 'Netto CHF', 'MWST %', 'MWST CHF', 'Brutto CHF', 'Zahlungsart', 'Zahlung', 'Bezahlt am', 'Beleg', 'Wiederkehrend', 'Status', 'Notiz'],
      ...a.map(x => [de(x.datum), bhRef('A', x.id), x.lief, x.beschreibung, x.kat, chfCsv(x.netto_rappen), x.mwst_satz, chfCsv(x.mwst_rappen), chfCsv(x.brutto_rappen), x.zahlungsart, x.zahlung, de(x.bezahlt_am), x.beleg_id ? bhRef('B', x.beleg_id) : '', x.wiederkehrend, x.storniert ? 'storniert: ' + (x.storno_grund || '') : 'gültig', x.notiz])];
  } else if (name === 'einnahmen.csv') {
    const z = await all(`SELECT z.*, b.bestellnummer, k.vorname || ' ' || k.nachname AS kunde FROM bh_zahlungen z JOIN bestellungen b ON b.id = z.bestellung_id JOIN kunden k ON k.id = b.kunde_id WHERE z.datum BETWEEN ? AND ? ORDER BY z.datum, z.id`, von, bis);
    const e = await all(`SELECT e.*, c.name AS kat FROM bh_einnahmen e LEFT JOIN bh_kategorien c ON c.id = e.kategorie_id WHERE e.datum BETWEEN ? AND ? ORDER BY e.datum, e.id`, von, bis);
    rows = [['Datum', 'Referenz', 'Quelle', 'Beschreibung', 'Kunde', 'Kategorie', 'Betrag CHF', 'Zahlungsart', 'Bestellung', 'Status'],
      ...z.map(x => [de(x.datum), bhRef('Z', x.id), 'Bestellung (automatisch)', x.art === 'rueckerstattung' ? 'Rückerstattung' : 'Zahlung', x.kunde, 'T-Shirt-Verkäufe', chfCsv(x.betrag_rappen), x.zahlungsart, x.bestellnummer, x.storniert ? 'storniert' : 'gültig']),
      ...e.map(x => [de(x.datum), bhRef('E', x.id), 'manuell', x.beschreibung, x.kunde, x.kat, chfCsv(x.betrag_rappen), x.zahlungsart, '', x.storniert ? 'storniert' : 'gültig'])];
  } else if (name === 'offene-posten.csv') {
    const frist = Number(s.bh_zahlungsfrist) || 30;
    const list = (await all(`${ORDER_FIN} WHERE b.status != 'storniert' ORDER BY b.datum`)).map(o => finance(o, frist, today)).filter(o => o.offen > 0);
    rows = [['Bestellung', 'Datum', 'Kunde', 'E-Mail', 'Total CHF', 'Bezahlt CHF', 'Offen CHF', 'Fällig', 'Überfällig', 'Rechnung'], ...list.map(o => [o.bestellnummer, de(o.datum), `${o.vorname} ${o.nachname}`, o.email, chfCsv(o.total_rappen), chfCsv(o.bezahlt), chfCsv(o.offen), de(o.faellig), o.ueberfaellig ? 'ja' : 'nein', o.rechnung_nr || ''])];
  } else if (name === 'rechnungen.csv') {
    const list = await all(`SELECT r.*, b.bestellnummer FROM bh_rechnungen r LEFT JOIN bestellungen b ON b.id = r.bestellung_id WHERE r.datum BETWEEN ? AND ? ORDER BY r.id`, von, bis);
    rows = [['Nummer', 'Art', 'Datum', 'Fällig', 'Bestellung', 'Kunde', 'Betrag CHF', 'Status'], ...list.map(r => [r.nummer, r.art === 'gutschrift' ? 'Gutschrift' : 'Rechnung', de(r.datum), de(r.faellig), r.bestellnummer, JSON.parse(r.daten || '{}').empfaenger?.name || '', chfCsv(r.art === 'gutschrift' ? -r.betrag_rappen : r.betrag_rappen), r.storniert ? 'storniert: ' + (r.storno_grund || '') : 'gültig'])];
  } else if (name === 'deckungsbeitrag.csv') {
    const r = await bhReports(env, s, new URLSearchParams({von: von === '0000-01-01' ? '2000-01-01' : von, bis: bis === '9999-12-31' ? today : bis}));
    rows = [['Bestellung', 'Datum', 'Kunde', 'Shirts', 'Erlös netto CHF', 'Direkte Kosten CHF', 'Deckungsbeitrag CHF', 'Marge %', 'Fehlende Kosten'], ...r.deckungsbeitrag.map(o => [o.bestellnummer, de(o.datum), o.kunde, o.anzahl, chfCsv(o.erloes_netto), chfCsv(o.kosten_summe), chfCsv(o.deckungsbeitrag), o.marge ?? '', o.fehlt.map(a => BH_KOSTENARTEN[a]).join(', ')])];
  } else if (name === 'lieferanten.csv') {
    const list = await all(`SELECT l.*, COALESCE(SUM(a.brutto_rappen), 0) AS total FROM bh_lieferanten l LEFT JOIN bh_ausgaben a ON a.lieferant_id = l.id AND a.storniert IS NULL GROUP BY l.id ORDER BY l.name`);
    rows = [['Firma', 'Kontakt', 'E-Mail', 'Telefon', 'Adresse', 'Website', 'Ausgaben total CHF', 'Notiz'], ...list.map(l => [l.name, l.kontakt, l.email, l.telefon, l.adresse, l.website, chfCsv(l.total), l.notiz])];
  } else return fail(404, 'Unbekannter Export.');
  await log(env, `Buchhaltung: Export ${name}`);
  return csvFile(rows, name);
}
