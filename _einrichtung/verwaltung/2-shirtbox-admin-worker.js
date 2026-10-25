// ShirtBOX Verwaltungszentrale – Worker "shirtbox-admin" auf admin.shirtbox.ch.
// Diese Datei wird von bauen.ps1 zu ../2-shirtbox-admin-worker.js zusammengesetzt (mit Oberfläche und Datenbank-Schema).
// Bindings: D1 DB (shirtbox-verwaltung), R2 BILDER (shirtbox-bilder).
// Secrets: RESEND_API_KEY, ADMIN_PASSWORD, ADMIN_TOTP_SECRET.
// Variablen (empfohlen): ACCESS_TEAM_DOMAIN (z. B. shirtbox.cloudflareaccess.com), ACCESS_AUD (Application Audience Tag).
// Cron-Trigger: */15 * * * *  (setzt den Newsletter-Versand in Etappen fort).

const ADMIN_HTML = "<!doctype html>\n<html lang=\"de-CH\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"robots\" content=\"noindex, nofollow\">\n<meta name=\"theme-color\" content=\"#131c30\">\n<title>ShirtBOX Verwaltung</title>\n<link rel=\"icon\" href=\"https://shirtbox.ch/shirtbox-icon.svg\" type=\"image/svg+xml\">\n<link rel=\"stylesheet\" href=\"/app.css\">\n</head>\n<body>\n<div id=\"login\" class=\"login\" hidden>\n  <form id=\"login-form\" class=\"login-card\" autocomplete=\"on\">\n    <div class=\"brand\"><img src=\"https://shirtbox.ch/shirtbox-icon.svg\" alt=\"\" width=\"44\" height=\"44\"><span>shirt<b>box</b><small>.ch</small></span></div>\n    <h1>Verwaltung</h1>\n    <p class=\"muted\">Nur für ShirtBOX. Bitte Passwort und den 6-stelligen Code aus Ihrer Authenticator-App eingeben.</p>\n    <label>Passwort<input id=\"login-passwort\" type=\"password\" autocomplete=\"current-password\" required></label>\n    <label>Code aus der App<input id=\"login-code\" inputmode=\"numeric\" autocomplete=\"one-time-code\" pattern=\"[0-9 ]{6,7}\" maxlength=\"7\" required placeholder=\"123 456\"></label>\n    <button class=\"btn btn-main\" type=\"submit\">Anmelden</button>\n    <p id=\"login-fehler\" class=\"error\" role=\"alert\" hidden></p>\n  </form>\n</div>\n\n<div id=\"app\" class=\"app\" hidden>\n  <aside class=\"side\" id=\"side\">\n    <div class=\"brand\"><img src=\"https://shirtbox.ch/shirtbox-icon.svg\" alt=\"\" width=\"36\" height=\"36\"><span>shirt<b>box</b><small>.ch</small></span></div>\n    <nav id=\"menu\" aria-label=\"Verwaltung\">\n      <a href=\"#/dashboard\" data-nav=\"dashboard\"><i>📊</i>Dashboard</a>\n      <a href=\"#/kunden\" data-nav=\"kunden\"><i>👥</i>Kunden</a>\n      <a href=\"#/bestellungen\" data-nav=\"bestellungen\"><i>📦</i>Bestellungen</a>\n      <a href=\"#/umsatz\" data-nav=\"umsatz\"><i>💰</i>Umsatz</a>\n      <a href=\"#/newsletter\" data-nav=\"newsletter\"><i>📬</i>Newsletter</a>\n      <a href=\"#/newsletter-erstellen\" data-nav=\"newsletter-erstellen\"><i>✏️</i>Newsletter erstellen</a>\n      <a href=\"#/einstellungen\" data-nav=\"einstellungen\"><i>⚙️</i>Einstellungen</a>\n    </nav>\n    <button class=\"logout\" id=\"logout\" type=\"button\">Abmelden</button>\n  </aside>\n  <header class=\"topbar\">\n    <button class=\"menu-btn\" id=\"menu-btn\" type=\"button\" aria-controls=\"side\" aria-expanded=\"false\">☰ Menü</button>\n    <span class=\"topbar-title\" id=\"topbar-title\">Dashboard</span>\n  </header>\n  <main class=\"content\" id=\"content\" tabindex=\"-1\"></main>\n</div>\n\n<div class=\"toast\" id=\"toast\" role=\"status\" aria-live=\"polite\" hidden></div>\n<dialog id=\"dialog\" class=\"dialog\"><form method=\"dialog\" id=\"dialog-form\"><div id=\"dialog-body\"></div><div class=\"dialog-actions\" id=\"dialog-actions\"></div></form></dialog>\n<script src=\"/app.js\"></script>\n</body>\n</html>\n";
const ADMIN_JS = "// ShirtBOX Verwaltung – Oberfläche (ohne Fremdbibliotheken). Alle Daten kommen von /api/… desselben Workers.\n(() => {\n  'use strict';\n  const $ = id => document.getElementById(id);\n  const content = $('content');\n  const esc = v => String(v ?? '').replace(/[&<>\"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;'}[c]));\n  const money = new Intl.NumberFormat('de-CH', {minimumFractionDigits: 2, maximumFractionDigits: 2});\n  const chf = r => `CHF ${money.format((Number(r) || 0) / 100)}`;\n  const chfShort = r => { const v = (Number(r) || 0) / 100; return v >= 1000 ? `${new Intl.NumberFormat('de-CH', {maximumFractionDigits: 1}).format(v / 1000)}k` : String(Math.round(v)); };\n  const dateFmt = new Intl.DateTimeFormat('de-CH', {timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric'});\n  const timeFmt = new Intl.DateTimeFormat('de-CH', {timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});\n  const date = iso => iso ? dateFmt.format(new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)) : '–';\n  const time = iso => iso ? timeFmt.format(new Date(iso)) : '–';\n  const kNr = id => `K-${10000 + Number(id)}`;\n  const STATUS = {neu: ['Neu', 'info'], bearbeitung: ['In Bearbeitung', 'warn'], produziert: ['Produziert', 'accent'], versendet: ['Versendet', 'info'], abgeschlossen: ['Abgeschlossen', 'good'], storniert: ['Storniert', 'bad']};\n  const ZAHLUNG = {offen: ['Offen', 'warn'], bezahlt: ['Bezahlt', 'good'], rueckerstattet: ['Rückerstattet', 'bad']};\n  const ABO = {aktiv: ['Aktiv', 'good'], ausstehend: ['Bestätigung ausstehend', 'warn'], abgemeldet: ['Abgemeldet', ''], unzustellbar: ['Unzustellbar', 'bad'], beschwerde: ['Spam-Beschwerde', 'bad']};\n  const NL = {entwurf: ['Entwurf', ''], versand: ['Wird versendet', 'warn'], versendet: ['Versendet', 'good']};\n  const EMPF = {wartend: 'Wartet', gesendet: 'Gesendet', zugestellt: 'Zugestellt', fehler: 'Fehler', unzustellbar: 'Unzustellbar', beschwerde: 'Spam-Beschwerde', uebersprungen: 'Übersprungen'};\n  const badge = (map, key) => { const [label, cls] = map[key] || [key || '–', '']; return `<span class=\"badge ${cls}\">${esc(label)}</span>`; };\n  const options = (map, selected) => Object.entries(map).map(([k, [label]]) => `<option value=\"${k}\"${k === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');\n  const LINKS = [['Startseite', 'https://shirtbox.ch/'], ['Shirt erstellen (KI-Designer)', 'https://shirtbox.ch/designhilfe.html'], ['Shirts live', 'https://shirtbox.ch/shirts-live.html'], ['Bestellen', 'https://shirtbox.ch/bestellen.html'], ['FAQs', 'https://shirtbox.ch/faq.html'], ['Über uns', 'https://shirtbox.ch/ueber-uns.html']];\n\n  // ---- Server-Anfragen ----\n  async function api(path, {method = 'GET', body, raw} = {}) {\n    const opts = {method, credentials: 'same-origin', headers: {'X-ShirtBOX': '1'}};\n    if (body instanceof FormData) opts.body = body;\n    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }\n    const res = await fetch(path, opts);\n    if (res.status === 401 && path !== '/api/login') { showLogin('Ihre Sitzung ist abgelaufen. Bitte erneut anmelden.'); throw Error('abgemeldet'); }\n    if (raw) return res;\n    const data = await res.json().catch(() => ({}));\n    if (!res.ok) throw Error(data.error || `Fehler ${res.status}`);\n    activity();\n    return data;\n  }\n  function toast(text, bad) { const t = $('toast'); t.textContent = text; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => t.hidden = true, 3800); }\n  const failed = e => { if (e.message !== 'abgemeldet') toast(e.message, true); };\n\n  // Bestätigungsdialog. Gibt true zurück, wenn bestätigt.\n  function confirmDialog(bodyHtml, okLabel = 'OK', danger = false, check) {\n    return new Promise(resolve => {\n      const dialog = $('dialog');\n      $('dialog-body').innerHTML = bodyHtml;\n      $('dialog-actions').innerHTML = `<button class=\"btn\" value=\"nein\" type=\"submit\">Abbrechen</button><button class=\"btn ${danger ? 'btn-danger' : 'btn-main'}\" value=\"ja\" type=\"submit\" id=\"dialog-ok\">${esc(okLabel)}</button>`;\n      const ok = $('dialog-ok');\n      ok.disabled = !!check;\n      $('dialog-body').oninput = check ? () => { ok.disabled = !check(); } : null;\n      dialog.onclose = () => resolve(dialog.returnValue === 'ja');\n      dialog.returnValue = '';\n      dialog.showModal();\n    });\n  }\n\n  // ---- Anmeldung und automatische Abmeldung bei Inaktivität ----\n  let timeoutMin = 30, lastActivity = Date.now(), idleTimer = null;\n  function activity() { lastActivity = Date.now(); }\n  ['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(e => addEventListener(e, activity, {passive: true}));\n  function startIdleWatch() {\n    clearInterval(idleTimer);\n    idleTimer = setInterval(async () => {\n      if ($('app').hidden) return;\n      const idle = Date.now() - lastActivity;\n      if (idle > timeoutMin * 60000) { await fetch('/api/logout', {method: 'POST', headers: {'X-ShirtBOX': '1'}}).catch(() => {}); showLogin('Aus Sicherheitsgründen wurden Sie nach ' + timeoutMin + ' Minuten ohne Aktivität abgemeldet.'); }\n      else if (idle > timeoutMin * 60000 - 120000) toast('Sie werden in Kürze automatisch abgemeldet. Klicken Sie irgendwo, um angemeldet zu bleiben.');\n      else if (idle < 60000 && Date.now() - (startIdleWatch.ping || 0) > 4 * 60000) { startIdleWatch.ping = Date.now(); fetch('/api/sitzung', {headers: {'X-ShirtBOX': '1'}}).catch(() => {}); }\n    }, 30000);\n  }\n  function showLogin(message) {\n    $('app').hidden = true; $('login').hidden = false; content.innerHTML = '';\n    const err = $('login-fehler'); err.hidden = !message; err.textContent = message || '';\n    err.style.background = message && message.startsWith('Aus Sicherheits') ? '#e8eefc' : ''; err.style.color = message && message.startsWith('Aus Sicherheits') ? '#2f5bd3' : '';\n    $('login-passwort').value = ''; $('login-code').value = ''; setTimeout(() => $('login-passwort').focus(), 50);\n  }\n  function showApp() { $('login').hidden = true; $('app').hidden = false; lastActivity = Date.now(); startIdleWatch(); render(); }\n  $('login-form').addEventListener('submit', async e => {\n    e.preventDefault();\n    const btn = e.submitter || e.target.querySelector('button'); btn.disabled = true;\n    try {\n      const data = await api('/api/login', {method: 'POST', body: {passwort: $('login-passwort').value, code: $('login-code').value}});\n      timeoutMin = data.timeout || 30; showApp();\n    } catch (err) { const box = $('login-fehler'); box.hidden = false; box.style.background = ''; box.style.color = ''; box.textContent = err.message; }\n    btn.disabled = false;\n  });\n  $('logout').addEventListener('click', async () => { await api('/api/logout', {method: 'POST'}).catch(() => {}); showLogin('Sie wurden abgemeldet.'); });\n  $('menu-btn').addEventListener('click', () => { const open = $('side').classList.toggle('open'); $('menu-btn').setAttribute('aria-expanded', open); });\n  $('menu').addEventListener('click', () => $('side').classList.remove('open'));\n  // Klickbare Tabellenzeilen (keine Inline-Skripte wegen Sicherheitsrichtlinie).\n  content.addEventListener('click', e => {\n    if (e.target.closest('a, button, input, select, textarea')) { if (e.target.closest('[data-reload]')) location.reload(); return; }\n    const row = e.target.closest('[data-href]'); if (row) location.hash = row.dataset.href;\n  });\n\n  // ---- Navigation ----\n  const TITLES = {dashboard: 'Dashboard', kunden: 'Kunden', bestellungen: 'Bestellungen', umsatz: 'Umsatz', newsletter: 'Newsletter', 'newsletter-erstellen': 'Newsletter erstellen', einstellungen: 'Einstellungen'};\n  addEventListener('hashchange', render);\n  let renderId = 0;\n  async function render() {\n    if ($('app').hidden) return;\n    const [view = 'dashboard', id] = location.hash.replace(/^#\\/?/, '').split('/');\n    const page = PAGES[view] ? view : 'dashboard';\n    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === page));\n    $('topbar-title').textContent = TITLES[page]; document.title = `${TITLES[page]} · ShirtBOX Verwaltung`;\n    const mine = ++renderId;\n    content.innerHTML = '<p class=\"loading\">Wird geladen …</p>';\n    try { const html = await PAGES[page](id); if (mine === renderId && typeof html === 'string') { content.innerHTML = html; while (AFTER.length) AFTER.shift()(); } }\n    catch (e) { if (mine === renderId && e.message !== 'abgemeldet') content.innerHTML = `<div class=\"card\"><h2>Das hat nicht geklappt</h2><p class=\"error\">${esc(e.message)}</p><button class=\"btn\" data-reload>Neu laden</button></div>`; }\n    AFTER.length = 0;\n    window.scrollTo(0, 0);\n  }\n  const AFTER = []; // Funktionen, die nach dem Einfügen des HTML laufen (Ereignisse binden)\n  const after = fn => AFTER.push(fn);\n  const kpi = (label, value, note, cls = '') => `<div class=\"kpi ${cls}\"><span>${esc(label)}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ''}</div>`;\n  const pager = (total, seite, size = 50) => total > size ? `<div class=\"pager\"><span>${total} Einträge · Seite ${seite} von ${Math.ceil(total / size)}</span><span class=\"actions\">${seite > 1 ? '<button class=\"btn btn-small\" data-page=\"-1\">← Zurück</button>' : ''}${seite * size < total ? '<button class=\"btn btn-small\" data-page=\"1\">Weiter →</button>' : ''}</span></div>` : `<div class=\"pager\"><span>${total} Einträge</span></div>`;\n  // Filter einmal pro Seitenaufbau binden, Blättern nach jedem Neuladen der Liste.\n  function bindFilters(state, reload) {\n    content.querySelectorAll('[data-filter]').forEach(el => el.addEventListener(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', () => {\n      clearTimeout(bindFilters.t); bindFilters.t = setTimeout(() => { state[el.dataset.filter] = el.value; state.seite = 1; reload().catch(failed); }, el.type === 'search' ? 300 : 0);\n    }));\n  }\n  function bindPager(box, state, reload) {\n    box.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { state.seite += Number(b.dataset.page); reload().catch(failed); }));\n  }\n  const query = state => new URLSearchParams(Object.entries(state).filter(([, v]) => v !== '' && v != null)).toString();\n\n  // ---- Diagramm: Umsatz pro Tag oder Monat (eine Reihe) ----\n  function chart(el, verlauf) {\n    const points = verlauf.punkte, monthly = verlauf.zeitraum === '12m';\n    const draw = () => {\n      const W = Math.max(280, el.clientWidth), H = 260, padL = 46, padB = 26, padT = 12, innerW = W - padL - 6, innerH = H - padB - padT;\n      const max = Math.max(...points.map(p => p.summe), 0);\n      const stepRaw = (max || 10000) / 4, mag = Math.pow(10, Math.floor(Math.log10(stepRaw))), step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= stepRaw);\n      const top = step * 4, slot = innerW / points.length, bw = Math.max(3, Math.min(34, slot - 4));\n      const y = v => padT + innerH - (v / top) * innerH;\n      const label = p => monthly ? new Intl.DateTimeFormat('de-CH', {month: 'short', year: '2-digit', timeZone: 'UTC'}).format(new Date(p.periode + '-01T12:00:00Z')) : date(p.periode).slice(0, 5);\n      const every = Math.ceil(points.length / Math.max(2, Math.floor(innerW / 56)));\n      let svg = `<svg viewBox=\"0 0 ${W} ${H}\" role=\"img\" aria-label=\"Umsatzentwicklung\">`;\n      for (let i = 0; i <= 4; i++) { const v = step * i, yy = y(v); svg += `<line class=\"grid-line\" x1=\"${padL}\" x2=\"${W - 6}\" y1=\"${yy}\" y2=\"${yy}\"/><text class=\"axis\" x=\"${padL - 8}\" y=\"${yy + 4}\" text-anchor=\"end\">${chfShort(v)}</text>`; }\n      points.forEach((p, i) => {\n        const x = padL + slot * i + (slot - bw) / 2, h = Math.max(0, padT + innerH - y(p.summe)), r = Math.min(4, bw / 2, h);\n        if (h > 0) svg += `<path class=\"bar\" data-i=\"${i}\" d=\"M${x},${padT + innerH} V${y(p.summe) + r} Q${x},${y(p.summe)} ${x + r},${y(p.summe)} H${x + bw - r} Q${x + bw},${y(p.summe)} ${x + bw},${y(p.summe) + r} V${padT + innerH} Z\"/>`;\n        if (i % every === 0 || i === points.length - 1) svg += `<text class=\"axis\" x=\"${padL + slot * i + slot / 2}\" y=\"${H - 6}\" text-anchor=\"middle\">${esc(label(p))}</text>`;\n        svg += `<rect class=\"hit\" data-i=\"${i}\" x=\"${padL + slot * i}\" y=\"${padT}\" width=\"${slot}\" height=\"${innerH}\"/>`;\n      });\n      svg += `<line x1=\"${padL}\" x2=\"${W - 6}\" y1=\"${padT + innerH}\" y2=\"${padT + innerH}\" stroke=\"#c9c3b6\"/></svg><div class=\"chart-tip\" hidden></div>`;\n      el.innerHTML = svg;\n      const tip = el.querySelector('.chart-tip');\n      el.querySelectorAll('.hit').forEach(hit => {\n        const show = () => {\n          const i = Number(hit.dataset.i), p = points[i];\n          el.querySelectorAll('.bar').forEach(b => b.classList.toggle('on', b.dataset.i === hit.dataset.i));\n          tip.innerHTML = `${esc(monthly ? label(p) : date(p.periode))}<b>${chf(p.summe)}</b>${p.anzahl} Bestellung${p.anzahl === 1 ? '' : 'en'}`;\n          tip.style.left = `${Math.min(W - 70, Math.max(70, padL + slot * i + slot / 2))}px`; tip.style.top = `${Math.max(40, y(p.summe) - 8)}px`; tip.hidden = false;\n        };\n        hit.addEventListener('pointerenter', show); hit.addEventListener('click', show);\n      });\n    };\n    el.addEventListener('pointerleave', () => { const tip = el.querySelector('.chart-tip'); if (tip) tip.hidden = true; el.querySelectorAll('.bar.on').forEach(b => b.classList.remove('on')); });\n    el._w = el.clientWidth; draw();\n    const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } if (Math.abs(el.clientWidth - el._w) > 8) { el._w = el.clientWidth; draw(); } });\n    ro.observe(el);\n  }\n  const chartTable = verlauf => `<details class=\"table-view\"><summary>Werte als Tabelle anzeigen</summary><div class=\"table-wrap\"><table><thead><tr><th>${verlauf.zeitraum === '12m' ? 'Monat' : 'Tag'}</th><th class=\"num\">Bestellungen</th><th class=\"num\">Betrag</th></tr></thead><tbody>${verlauf.punkte.slice().reverse().map(p => `<tr><td>${esc(verlauf.zeitraum === '12m' ? p.periode.split('-').reverse().join('.') : date(p.periode))}</td><td class=\"num\">${p.anzahl}</td><td class=\"num\">${chf(p.summe)}</td></tr>`).join('')}</tbody></table></div></details>`;\n\n  // ---- Seiten ----\n  const PAGES = {};\n\n  PAGES.dashboard = async () => {\n    const d = await api('/api/dashboard'), b = d.bestellungen, u = d.umsatz;\n    after(() => chart($('chart'), d.verlauf));\n    return `<div class=\"page-head\"><div><h1>Dashboard</h1><p class=\"muted\">Stand ${time(new Date().toISOString())} · alle Beträge in CHF inkl. MwSt. und Versand</p></div></div>\n      <div class=\"grid kpis\">\n        ${kpi('Bestellungen heute', b.heute)}${kpi('Diese Woche', b.woche)}${kpi('Diesen Monat', b.monat)}${kpi('Bestellungen total', b.total, b.storniert ? `${b.storniert} storniert (nicht gezählt)` : '')}\n        ${kpi('Umsatz heute', chf(u.heute))}${kpi('Umsatz diese Woche', chf(u.woche))}${kpi('Umsatz diesen Monat', chf(u.monat))}${kpi('Gesamtumsatz', chf(u.total), 'Bestellwert', 'highlight')}\n        ${kpi('Offene Zahlungen', b.offen, '<a href=\"#/bestellungen/?zahlung=offen\">ansehen</a>')}${kpi('Bezahlte Bestellungen', b.bezahlt, chf(u.bezahlt) + ' erhalten')}${kpi('Verkaufte T-Shirts', d.shirts)}${kpi('Ø Bestellwert', chf(u.durchschnitt))}\n      </div>\n      <div class=\"grid kpis\" style=\"margin-top:12px\">\n        ${kpi('In Arbeit', b.in_arbeit, 'Neu, in Bearbeitung, produziert')}${kpi('Kunden', d.kunden)}${kpi('Newsletter-Abonnenten', d.abonnenten, d.ausstehend ? `${d.ausstehend} warten auf Bestätigung` : '')}${kpi('Abgemeldet', d.abgemeldet)}\n      </div>\n      <div class=\"card\"><h2>Umsatz der letzten 30 Tage <a class=\"btn btn-small\" href=\"#/umsatz\">Mehr Auswertungen</a></h2><div class=\"chart\" id=\"chart\"></div>${chartTable(d.verlauf)}</div>\n      <div class=\"card\"><h2>Neueste Bestellungen <a class=\"btn btn-small\" href=\"#/bestellungen\">Alle Bestellungen</a></h2>\n        ${d.neueste.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Bestellung</th><th>Kunde</th><th class=\"hide-mobile\">Datum</th><th class=\"num\">Betrag</th><th>Status</th><th>Zahlung</th></tr></thead><tbody>\n        ${d.neueste.map(o => `<tr class=\"click\" data-href=\"#/bestellungen/${o.id}\"><td><b>${esc(o.bestellnummer)}</b></td><td>${esc(o.vorname)} ${esc(o.nachname)}</td><td class=\"hide-mobile\">${time(o.erstellt)}</td><td class=\"num\">${chf(o.total_rappen)}</td><td>${badge(STATUS, o.status)}</td><td>${badge(ZAHLUNG, o.zahlung)}</td></tr>`).join('')}\n        </tbody></table></div>` : '<p class=\"empty\">Noch keine Bestellungen gespeichert. Neue Bestellungen erscheinen hier automatisch.</p>'}\n      </div>`;\n  };\n\n  // Kunden\n  const customerState = {q: '', seite: 1};\n  PAGES.kunden = async id => {\n    if (id) return customerDetail(id);\n    const load = async () => {\n      const d = await api('/api/kunden?' + query(customerState));\n      $('kunden-liste').innerHTML = d.kunden.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Nr.</th><th>Name</th><th class=\"hide-mobile\">E-Mail</th><th class=\"hide-mobile\">Ort</th><th class=\"num\">Bestellungen</th><th class=\"num\">Umsatz</th><th class=\"hide-mobile\">Newsletter</th></tr></thead><tbody>\n        ${d.kunden.map(k => `<tr class=\"click\" data-href=\"#/kunden/${k.id}\"><td>${kNr(k.id)}</td><td><b>${esc(k.vorname)} ${esc(k.nachname)}</b></td><td class=\"hide-mobile\">${esc(k.email)}</td><td class=\"hide-mobile\">${esc(k.plz)} ${esc(k.ort)}</td><td class=\"num\">${k.bestellungen}</td><td class=\"num\">${chf(k.umsatz)}</td><td class=\"hide-mobile\">${k.newsletter ? badge(ABO, k.newsletter) : '<span class=\"muted\">–</span>'}</td></tr>`).join('')}\n        </tbody></table></div>${pager(d.total, customerState.seite)}` : '<p class=\"empty\">Keine Kunden gefunden.</p>';\n      bindPager($('kunden-liste'), customerState, load);\n    };\n    after(() => { bindFilters(customerState, load); load().catch(failed); });\n    return `<div class=\"page-head\"><div><h1>Kunden</h1><p class=\"muted\">Jede E-Mail-Adresse ist ein Kunde – auch bei mehreren Bestellungen.</p></div><div class=\"actions\"><a class=\"btn\" href=\"/api/export/kunden.csv\">⬇ Excel/CSV-Export</a></div></div>\n      <div class=\"card\"><div class=\"filters\"><label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(customerState.q)}\" placeholder=\"Name, E-Mail, Ort, PLZ oder Kundennummer\"></label></div><div id=\"kunden-liste\"><p class=\"loading\">Wird geladen …</p></div></div>`;\n  };\n\n  async function customerDetail(id) {\n    const d = await api('/api/kunden/' + id), k = d.kunde;\n    after(() => {\n      $('del-kunde').addEventListener('click', async () => {\n        const ok = await confirmDialog(`<h2>Kunde löschen?</h2><p>Alle Daten von <b>${esc(k.vorname)} ${esc(k.nachname)}</b> werden endgültig gelöscht – inklusive ${d.bestellungen.length} Bestellung(en) und Designbildern.</p>\n          <p class=\"error\" style=\"background:#fff4d6;color:#7a5200\">Achtung Aufbewahrungspflicht: Geschäftsunterlagen (z. B. Bestellungen und Zahlungen) müssen in der Schweiz grundsätzlich 10 Jahre aufbewahrt werden. Löschen Sie nur, wenn keine Pflicht mehr besteht – oder bewahren Sie vorher einen Beleg ausserhalb auf.</p>\n          <label style=\"margin-top:12px\"><input type=\"checkbox\" id=\"del-nl\" style=\"width:auto;min-height:0;margin-right:6px\">Auch Newsletter-Daten dieser E-Mail-Adresse löschen</label>\n          <label style=\"margin-top:12px\">Zur Bestätigung <b>LÖSCHEN</b> eingeben<input id=\"del-wort\" autocomplete=\"off\"></label>`, 'Endgültig löschen', true, () => $('del-wort').value.trim() === 'LÖSCHEN');\n        if (!ok) return;\n        try { await api('/api/kunden/' + id, {method: 'DELETE', body: {bestaetigung: 'LÖSCHEN', newsletter: $('del-nl')?.checked}}); toast('Kunde gelöscht.'); location.hash = '#/kunden'; } catch (e) { failed(e); }\n      });\n    });\n    const nl = d.newsletter;\n    return `<div class=\"page-head\"><div><a href=\"#/kunden\" class=\"no-print\">← Alle Kunden</a><h1>${esc(k.vorname)} ${esc(k.nachname)}</h1><p class=\"muted\">${kNr(k.id)} · Kunde seit ${date(k.erste_bestellung)}</p></div>\n      <div class=\"actions no-print\"><a class=\"btn\" href=\"mailto:${esc(k.email)}\">✉️ E-Mail</a>${k.telefon ? `<a class=\"btn\" href=\"https://wa.me/${esc(k.telefon.replace(/\\D/g, ''))}\" target=\"_blank\" rel=\"noopener\">💬 WhatsApp</a>` : ''}<a class=\"btn\" href=\"/api/kunden/${k.id}/auskunft\">⬇ Datenauskunft</a><button class=\"btn btn-danger\" id=\"del-kunde\">Löschen</button></div></div>\n      <div class=\"grid two\">\n        <div class=\"card\"><h2>Kontakt und Adresse</h2><dl class=\"facts\"><dt>E-Mail</dt><dd>${esc(k.email)}</dd><dt>Telefon</dt><dd>${esc(k.telefon || '–')}</dd><dt>Adresse</dt><dd>${esc(k.strasse)}<br>${esc(k.plz)} ${esc(k.ort)}<br>${esc(k.land)}</dd><dt>Erste Bestellung</dt><dd>${time(k.erste_bestellung)}</dd></dl></div>\n        <div class=\"card\"><h2>Newsletter</h2>${nl ? `<dl class=\"facts\"><dt>Status</dt><dd>${badge(ABO, nl.status)}</dd><dt>Angemeldet</dt><dd>${time(nl.angemeldet)}</dd><dt>Bestätigt</dt><dd>${time(nl.einwilligung_zeit)}</dd><dt>Herkunft</dt><dd>${esc(nl.einwilligung_quelle || '–')}</dd>${nl.abgemeldet ? `<dt>Abgemeldet</dt><dd>${time(nl.abgemeldet)}</dd>` : ''}</dl>` : '<p class=\"muted\">Kein Newsletter-Abo. Kunden erhalten nur dann Newsletter, wenn sie selbst zustimmen und bestätigen.</p>'}</div>\n      </div>\n      <div class=\"card\"><h2>Bestellungen (${d.bestellungen.length})</h2><div class=\"table-wrap\"><table><thead><tr><th>Bestellung</th><th>Datum</th><th class=\"num\">Shirts</th><th class=\"num\">Betrag</th><th>Status</th><th>Zahlung</th></tr></thead><tbody>\n        ${d.bestellungen.map(o => `<tr class=\"click\" data-href=\"#/bestellungen/${o.id}\"><td><b>${esc(o.bestellnummer)}</b></td><td>${time(o.erstellt)}</td><td class=\"num\">${o.anzahl}</td><td class=\"num\">${chf(o.total_rappen)}</td><td>${badge(STATUS, o.status)}</td><td>${badge(ZAHLUNG, o.zahlung)}</td></tr>`).join('')}\n      </tbody></table></div></div>`;\n  }\n\n  // Bestellungen\n  const orderState = {q: '', status: '', zahlung: '', von: '', bis: '', sort: 'neu', seite: 1};\n  PAGES.bestellungen = async id => {\n    if (id && /^\\d+$/.test(id)) return orderDetail(id);\n    if (id && id.startsWith('?')) { const p = new URLSearchParams(id); for (const k of ['status', 'zahlung']) if (p.has(k)) orderState[k] = p.get(k); }\n    const load = async () => {\n      const d = await api('/api/bestellungen?' + query(orderState));\n      $('bestell-liste').innerHTML = d.bestellungen.length ? `<div class=\"table-wrap\"><table><thead><tr><th></th><th>Bestellung</th><th>Kunde</th><th class=\"hide-mobile\">Datum</th><th class=\"num\">Shirts</th><th class=\"num\">Betrag</th><th>Status</th><th>Zahlung</th></tr></thead><tbody>\n        ${d.bestellungen.map(o => `<tr class=\"click\" data-href=\"#/bestellungen/${o.id}\"><td>${o.bild ? `<img class=\"thumb\" loading=\"lazy\" src=\"/api/bild?k=${encodeURIComponent(o.bild)}\" alt=\"\">` : ''}</td><td><b>${esc(o.bestellnummer)}</b></td><td>${esc(o.vorname)} ${esc(o.nachname)}<br><span class=\"muted small\">${esc(o.ort)}</span></td><td class=\"hide-mobile\">${time(o.erstellt)}</td><td class=\"num\">${o.anzahl}</td><td class=\"num\">${chf(o.total_rappen)}</td><td>${badge(STATUS, o.status)}</td><td>${badge(ZAHLUNG, o.zahlung)}</td></tr>`).join('')}\n        </tbody></table></div>${pager(d.total, orderState.seite)}<p class=\"muted small\">Summe der gefilterten Bestellungen: <b>${chf(d.summe)}</b></p>` : '<p class=\"empty\">Keine Bestellungen gefunden.</p>';\n      bindPager($('bestell-liste'), orderState, load);\n    };\n    after(() => { bindFilters(orderState, load); load().catch(failed); });\n    return `<div class=\"page-head\"><div><h1>Bestellungen</h1><p class=\"muted\">Anklicken zum Öffnen, Status ändern und Drucken.</p></div><div class=\"actions\"><a class=\"btn\" href=\"/api/export/bestellungen.csv\">⬇ Excel/CSV-Export</a></div></div>\n      <div class=\"card\"><div class=\"filters\">\n        <label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(orderState.q)}\" placeholder=\"Bestellnummer, Name, E-Mail oder Ort\"></label>\n        <label>Status<select data-filter=\"status\"><option value=\"\">Alle</option><option value=\"offen\"${orderState.status === 'offen' ? ' selected' : ''}>Alle offenen (in Arbeit)</option>${options(STATUS, orderState.status)}</select></label>\n        <label>Zahlung<select data-filter=\"zahlung\"><option value=\"\">Alle</option>${options(ZAHLUNG, orderState.zahlung)}</select></label>\n        <label>Von<input type=\"date\" data-filter=\"von\" value=\"${esc(orderState.von)}\"></label>\n        <label>Bis<input type=\"date\" data-filter=\"bis\" value=\"${esc(orderState.bis)}\"></label>\n        <label>Sortierung<select data-filter=\"sort\"><option value=\"neu\"${orderState.sort === 'neu' ? ' selected' : ''}>Neueste zuerst</option><option value=\"alt\"${orderState.sort === 'alt' ? ' selected' : ''}>Älteste zuerst</option><option value=\"betrag\"${orderState.sort === 'betrag' ? ' selected' : ''}>Höchster Betrag</option></select></label>\n      </div><div id=\"bestell-liste\"><p class=\"loading\">Wird geladen …</p></div></div>`;\n  };\n\n  async function orderDetail(id) {\n    const d = await api('/api/bestellungen/' + id), o = d.bestellung, a = o.lieferadresse || {};\n    const img = key => `/api/bild?k=${encodeURIComponent(key)}`;\n    after(() => {\n      const save = async body => { try { await api('/api/bestellungen/' + id, {method: 'PATCH', body}); toast('Gespeichert.'); } catch (e) { failed(e); } };\n      $('o-status').addEventListener('change', e => save({status: e.target.value}).then(() => $('o-status-badge').innerHTML = badge(STATUS, e.target.value)));\n      $('o-zahlung').addEventListener('change', e => save({zahlung: e.target.value}).then(() => $('o-zahlung-badge').innerHTML = badge(ZAHLUNG, e.target.value)));\n      $('o-notiz-save').addEventListener('click', () => save({notiz: $('o-notiz').value}));\n      $('o-print').addEventListener('click', () => window.print());\n    });\n    const digits = (o.telefon || '').replace(/\\D/g, '');\n    return `<div class=\"page-head\"><div><a href=\"#/bestellungen\" class=\"no-print\">← Alle Bestellungen</a><h1>Bestellung ${esc(o.bestellnummer)}</h1><p class=\"muted\">${time(o.erstellt)} · <span id=\"o-status-badge\">${badge(STATUS, o.status)}</span> <span id=\"o-zahlung-badge\">${badge(ZAHLUNG, o.zahlung)}</span></p></div>\n      <div class=\"actions no-print\"><button class=\"btn btn-dark\" id=\"o-print\">🖨 Drucken</button><a class=\"btn\" href=\"mailto:${esc(o.email)}?subject=${encodeURIComponent('Ihre ShirtBOX-Bestellung ' + o.bestellnummer)}\">✉️ Kunde anschreiben</a>${digits ? `<a class=\"btn\" href=\"https://wa.me/${digits}\" target=\"_blank\" rel=\"noopener\">💬 WhatsApp</a>` : ''}</div></div>\n      <div class=\"grid two\">\n        <div class=\"card no-print\"><h2>Status</h2><div class=\"status-row\"><label>Bestellstatus<select id=\"o-status\">${options(STATUS, o.status)}</select></label><label>Zahlung<select id=\"o-zahlung\">${options(ZAHLUNG, o.zahlung)}</select></label></div>\n          ${o.bezahlt_am ? `<p class=\"muted small\">Als bezahlt markiert am ${date(o.bezahlt_am)}</p>` : ''}\n          <label style=\"margin-top:12px\">Interne Notiz<textarea id=\"o-notiz\" rows=\"3\" placeholder=\"z. B. TWINT erhalten am …, beim Lieferanten bestellt am …\">${esc(o.notiz || '')}</textarea></label><button class=\"btn btn-small\" id=\"o-notiz-save\" style=\"margin-top:8px\">Notiz speichern</button></div>\n        <div class=\"card\"><h2>Kunde</h2><dl class=\"facts\"><dt>Name</dt><dd><a href=\"#/kunden/${o.kunde_id}\">${esc(o.vorname)} ${esc(o.nachname)}</a> (${kNr(o.kunde_id)})</dd><dt>E-Mail</dt><dd>${esc(o.email)}</dd><dt>Telefon</dt><dd>${esc(o.telefon || '–')}</dd>\n          <dt>Lieferadresse</dt><dd>${esc(a.vorname)} ${esc(a.nachname)}<br>${esc(a.strasse)}<br>${esc(a.plz)} ${esc(a.ort)}<br>${esc(a.land)}</dd></dl></div>\n      </div>\n      <div class=\"card\"><h2>Bestellte T-Shirts</h2>\n        ${d.designs.map(x => `<div class=\"design\"><div>${x.bild_vorschau ? `<img src=\"${img(x.bild_vorschau)}\" alt=\"Design ${x.design_nr}: Vorder- und Rückseite\">` : '<p class=\"empty\">Kein Vorschaubild gespeichert</p>'}<p class=\"muted small\">Vorderseite links, Rückseite rechts</p></div>\n          <div><h3>Design ${x.design_nr}</h3><dl class=\"facts\"><dt>Farbe</dt><dd>${esc(x.farbe || '–')}</dd><dt>Stückzahl</dt><dd>${x.anzahl}</dd><dt>Einzelpreis</dt><dd>${chf(x.einzelpreis_rappen)}${x.anzahl > 1 ? ` · weitere ${chf(8010)}` : ''}</dd><dt>Summe</dt><dd>${chf(x.summe_rappen)}</dd><dt>Bildrechte</dt><dd>${x.rechte ? '✓ bestätigt' : '⚠ nicht bestätigt'}</dd></dl>\n          <table style=\"margin-top:10px\"><thead><tr><th>Grösse Kunde</th><th>Beim Lieferanten</th><th class=\"num\">Stück</th></tr></thead><tbody>${x.groessen.map(g => `<tr><td>${esc(g.groesse)}</td><td><b>${esc(g.bestellgroesse)}</b></td><td class=\"num\">${g.anzahl}×</td></tr>`).join('')}</tbody></table>\n          <p class=\"no-print\" style=\"margin:10px 0 0\">${x.bild_druck ? `<a class=\"btn btn-small\" href=\"${img(x.bild_druck)}\" download>⬇ Druckdatei</a> ` : '<span class=\"badge bad\">Druckdatei fehlt</span> '}${x.bilder_original.map((k, i) => `<a class=\"btn btn-small\" href=\"${img(k)}\" download>⬇ Original ${i + 1}</a>`).join(' ')}</p>\n          ${x.details ? `<pre>${esc(x.details)}</pre>` : ''}</div></div>`).join('')}\n        <table style=\"margin-top:12px\"><tbody><tr><td>Versand</td><td class=\"num\">${o.versand_rappen ? chf(o.versand_rappen) : 'inklusive'}</td></tr><tr><td><b>Total (${o.anzahl} Shirt${o.anzahl === 1 ? '' : 's'})</b></td><td class=\"num\"><b>${chf(o.total_rappen)}</b></td></tr></tbody></table>\n        <p class=\"muted small\">Bezahlung per TWINT · ${esc(o.agb ? 'AGB akzeptiert (' + o.agb + ')' : 'AGB-Zustimmung nicht gespeichert')}</p>\n      </div>`;\n  }\n\n  // Umsatz\n  const revState = {zeitraum: '30t', art: 'bestellwert'};\n  PAGES.umsatz = async () => {\n    const d = await api('/api/umsatz?' + query(revState)), s = d.summen;\n    after(() => {\n      chart($('chart'), d);\n      content.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => { revState[b.dataset.seg] = b.dataset.value; render(); }));\n    });\n    const seg = (key, value, label) => `<button type=\"button\" data-seg=\"${key}\" data-value=\"${value}\" class=\"${revState[key] === value ? 'on' : ''}\">${label}</button>`;\n    return `<div class=\"page-head\"><div><h1>Umsatz</h1><p class=\"muted\">Bestellwert = alle nicht stornierten Bestellungen. Bezahlt = als „Bezahlt“ markiert. Alle Beträge in CHF.</p></div></div>\n      <div class=\"grid kpis\">${kpi('Bestellwert', chf(s.bestellwert), revState.zeitraum === '12m' ? 'letzte 12 Monate' : 'letzte 30 Tage', 'highlight')}${kpi('Tatsächlich bezahlt', chf(s.bezahlt))}${kpi('Noch offen', chf(s.offen))}${kpi('Rückerstattet', chf(s.rueckerstattet))}</div>\n      <div class=\"card\"><h2>Umsatzentwicklung <span class=\"actions\"><span class=\"seg\">${seg('zeitraum', '30t', '30 Tage')}${seg('zeitraum', '12m', '12 Monate')}</span><span class=\"seg\">${seg('art', 'bestellwert', 'Bestellwert')}${seg('art', 'bezahlt', 'Bezahlt')}</span></span></h2>\n        <p class=\"muted small\">${revState.art === 'bezahlt' ? 'Nach Datum der Zahlungsbestätigung.' : 'Nach Bestelldatum.'} Fahren Sie über einen Balken für Details.</p><div class=\"chart\" id=\"chart\"></div>${chartTable(d)}</div>`;\n  };\n\n  // Newsletter: Abonnenten und versendete Newsletter\n  const subState = {q: '', status: '', seite: 1};\n  PAGES.newsletter = async id => {\n    if (id) return newsletterDetail(id);\n    const [list] = await Promise.all([api('/api/newsletter')]);\n    const load = async () => {\n      const d = await api('/api/abonnenten?' + query(subState)), z = d.zahlen;\n      $('abo-zahlen').innerHTML = `${kpi('Aktive Abonnenten', Number(z.aktiv) || 0, 'erhalten Newsletter', 'highlight')}${kpi('Warten auf Bestätigung', Number(z.ausstehend) || 0)}${kpi('Abgemeldet', Number(z.abgemeldet) || 0)}${kpi('Unzustellbar', Number(z.unzustellbar) || 0)}`;\n      $('abo-liste').innerHTML = d.abonnenten.length ? `<div class=\"table-wrap\"><table><thead><tr><th>E-Mail</th><th>Name</th><th>Status</th><th class=\"hide-mobile\">Angemeldet</th><th class=\"hide-mobile\">Einwilligung</th><th></th></tr></thead><tbody>\n        ${d.abonnenten.map(a => `<tr><td>${esc(a.email)}${a.kunde_id ? ` <a class=\"small\" href=\"#/kunden/${a.kunde_id}\">Kunde</a>` : ''}</td><td>${esc([a.vorname, a.nachname].filter(Boolean).join(' ') || '–')}</td><td>${badge(ABO, a.status)}${a.abgemeldet ? `<br><span class=\"muted small\">${date(a.abgemeldet)}</span>` : ''}</td><td class=\"hide-mobile\">${time(a.angemeldet)}</td><td class=\"hide-mobile small\">${a.einwilligung_zeit ? `bestätigt ${time(a.einwilligung_zeit)}<br>` : ''}<span class=\"muted\">${esc(a.einwilligung_quelle || '')}</span></td>\n          <td class=\"num\">${['aktiv', 'ausstehend'].includes(a.status) ? `<button class=\"btn btn-small\" data-abmelden=\"${a.id}\">Abmelden</button> ` : ''}<button class=\"btn btn-small btn-danger\" data-loeschen=\"${a.id}\" title=\"Löschen\">✕</button></td></tr>`).join('')}\n        </tbody></table></div>${pager(d.total, subState.seite)}` : '<p class=\"empty\">Keine Abonnenten gefunden.</p>';\n      bindPager($('abo-liste'), subState, load);\n      content.querySelectorAll('[data-abmelden]').forEach(b => b.addEventListener('click', async () => {\n        if (!await confirmDialog('<h2>Abonnent abmelden?</h2><p>Diese Person erhält danach keine Newsletter mehr. Die Abmeldung wird gespeichert.</p>', 'Abmelden')) return;\n        try { await api('/api/abonnenten/' + b.dataset.abmelden, {method: 'PATCH', body: {status: 'abgemeldet'}}); toast('Abgemeldet.'); load(); } catch (e) { failed(e); }\n      }));\n      content.querySelectorAll('[data-loeschen]').forEach(b => b.addEventListener('click', async () => {\n        if (!await confirmDialog('<h2>Abonnent löschen?</h2><p>Der Eintrag und der Nachweis der Einwilligung werden endgültig gelöscht. Tipp: Für eine Abmeldung reicht „Abmelden“ – dann bleibt dokumentiert, dass die Person keine Werbung mehr möchte.</p>', 'Endgültig löschen', true)) return;\n        try { await api('/api/abonnenten/' + b.dataset.loeschen, {method: 'DELETE'}); toast('Gelöscht.'); load(); } catch (e) { failed(e); }\n      }));\n    };\n    after(() => { bindFilters(subState, load); load().catch(failed); });\n    return `<div class=\"page-head\"><div><h1>Newsletter</h1><p class=\"muted\">Nur Personen, die selbst zugestimmt und per E-Mail bestätigt haben (Double-Opt-in), erhalten Newsletter.</p></div><div class=\"actions\"><a class=\"btn\" href=\"/api/export/abonnenten.csv\">⬇ Excel/CSV-Export</a><a class=\"btn btn-main\" href=\"#/newsletter-erstellen\">✏️ Newsletter erstellen</a></div></div>\n      <div class=\"grid kpis\" id=\"abo-zahlen\"></div>\n      <div class=\"card\"><h2>Versendete Newsletter und Entwürfe</h2>${list.newsletter.length ? `<div class=\"table-wrap\"><table><thead><tr><th>Betreff</th><th>Status</th><th class=\"hide-mobile\">Datum</th><th class=\"num\">Empfänger</th><th class=\"num\">Gesendet</th><th class=\"num hide-mobile\">Zugestellt</th><th class=\"num\">Fehler</th></tr></thead><tbody>\n        ${list.newsletter.map(n => `<tr class=\"click\" data-href=\"${n.status === 'entwurf' ? '#/newsletter-erstellen/' : '#/newsletter/'}${n.id}\"><td><b>${esc(n.betreff)}</b></td><td>${badge(NL, n.status)}${Number(n.wartend) ? `<br><span class=\"muted small\">${n.wartend} warten</span>` : ''}</td><td class=\"hide-mobile\">${time(n.versand_start || n.geaendert)}</td><td class=\"num\">${n.empfaenger || '–'}</td><td class=\"num\">${Number(n.gesendet) || 0}</td><td class=\"num hide-mobile\">${Number(n.zugestellt) || 0}</td><td class=\"num\">${Number(n.fehler) || 0}</td></tr>`).join('')}\n        </tbody></table></div>` : '<p class=\"empty\">Noch kein Newsletter erstellt.</p>'}</div>\n      <div class=\"card\"><h2>Abonnenten</h2><div class=\"filters\"><label class=\"grow\">Suchen<input type=\"search\" data-filter=\"q\" value=\"${esc(subState.q)}\" placeholder=\"E-Mail oder Name\"></label><label>Status<select data-filter=\"status\"><option value=\"\">Alle</option>${options(ABO, subState.status)}</select></label></div><div id=\"abo-liste\"><p class=\"loading\">Wird geladen …</p></div></div>`;\n  };\n\n  async function newsletterDetail(id) {\n    const d = await api('/api/newsletter/' + id), n = d.newsletter, s = d.statistik || {};\n    after(() => {\n      $('nl-kopie').addEventListener('click', async () => { try { const r = await api(`/api/newsletter/${id}/kopie`, {method: 'POST'}); location.hash = '#/newsletter-erstellen/' + r.id; } catch (e) { failed(e); } });\n      api('/api/newsletter/vorschau', {method: 'POST', body: {betreff: n.betreff, inhalt: n.inhalt}}).then(r => $('nl-frame').srcdoc = r.html).catch(failed);\n    });\n    return `<div class=\"page-head\"><div><a href=\"#/newsletter\">← Newsletter</a><h1>${esc(n.betreff)}</h1><p class=\"muted\">${badge(NL, n.status)} · Versand gestartet ${time(n.versand_start)}${n.versand_ende ? ` · abgeschlossen ${time(n.versand_ende)}` : ''}</p></div><div class=\"actions\"><button class=\"btn\" id=\"nl-kopie\">Als Vorlage für neuen Newsletter</button></div></div>\n      <div class=\"grid kpis\">${kpi('Empfänger', n.empfaenger)}${kpi('Gesendet', Number(s.gesendet) || 0)}${kpi('Zugestellt', Number(s.zugestellt) || 0, 'laut Resend')}${kpi('Nicht zugestellt / Fehler', Number(s.fehler) || 0)}${Number(s.wartend) ? kpi('Warten auf Versand', s.wartend, 'wird automatisch fortgesetzt') : ''}${Number(s.uebersprungen) ? kpi('Übersprungen', s.uebersprungen, 'vorher abgemeldet') : ''}</div>\n      ${Number(s.wartend) ? '<div class=\"card\"><p>⏳ Wegen der Versandlimits von Resend wird der Newsletter in Etappen verschickt. Der Rest folgt automatisch alle 15 Minuten bzw. am nächsten Tag.</p></div>' : ''}\n      <div class=\"card\"><h2>Nicht zugestellte E-Mails</h2>${d.probleme.length ? `<div class=\"table-wrap\"><table><thead><tr><th>E-Mail</th><th>Status</th><th>Grund</th></tr></thead><tbody>${d.probleme.map(p => `<tr><td>${esc(p.email)}</td><td><span class=\"badge bad\">${esc(EMPF[p.status] || p.status)}</span></td><td class=\"small\">${esc(p.fehler || '–')}</td></tr>`).join('')}</tbody></table></div>` : '<p class=\"muted\">Keine Zustellprobleme gemeldet.</p>'}</div>\n      <div class=\"card preview\"><h2>So sah der Newsletter aus</h2><iframe id=\"nl-frame\" title=\"Newsletter-Ansicht\" sandbox=\"\"></iframe></div>`;\n  }\n\n  // Newsletter erstellen\n  const BLOCK_NAMES = {ueberschrift: 'Überschrift', text: 'Text', bild: 'Bild', angebot: 'Angebot / Aktion', button: 'Button mit Link', trenner: 'Trennlinie'};\n  const NEW_CONTENT = () => ({vorschau: 'Neuigkeiten und Aktionen von ShirtBOX', bloecke: [\n    {typ: 'ueberschrift', text: 'Hallo {{vorname}}!'},\n    {typ: 'text', text: 'Hier steht Ihr Newsletter-Text.\\n\\nTipp: **fett** schreiben Sie mit zwei Sternchen, einen Link mit [Linktext](https://shirtbox.ch).'},\n    {typ: 'button', text: 'Jetzt Shirt designen', link: 'https://shirtbox.ch/designhilfe.html'}]});\n  PAGES['newsletter-erstellen'] = async id => {\n    let n = {betreff: '', inhalt: NEW_CONTENT(), status: 'entwurf'};\n    if (id) { const d = await api('/api/newsletter/' + id); n = d.newsletter; if (n.status !== 'entwurf') { location.hash = '#/newsletter/' + id; return; } }\n    let current = id ? Number(id) : null, dirty = false;\n    const linkSelect = cls => `<select class=\"${cls}\"><option value=\"\">Seite wählen …</option>${LINKS.map(([l, u]) => `<option value=\"${u}\">${esc(l)}</option>`).join('')}</select>`;\n    const blockHtml = (b, i) => {\n      const f = (key, label, type = 'text', ph = '') => `<label>${label}${type === 'area' ? `<textarea data-k=\"${key}\" rows=\"${key === 'text' ? 6 : 3}\" placeholder=\"${esc(ph)}\">${esc(b[key] || '')}</textarea>` : `<input data-k=\"${key}\" type=\"${type}\" value=\"${esc(b[key] || '')}\" placeholder=\"${esc(ph)}\">`}</label>`;\n      let body = '';\n      if (b.typ === 'ueberschrift') body = f('text', 'Überschrift', 'text', 'z. B. Hallo {{vorname}}!');\n      if (b.typ === 'text') body = f('text', 'Text', 'area') + '<p class=\"hint\">Leerzeile = neuer Absatz · **fett** · [Linktext](https://…) · {{vorname}} = Vorname des Empfängers</p>';\n      if (b.typ === 'bild') body = `<label>Bild hochladen<input type=\"file\" accept=\"image/jpeg,image/png,image/webp,image/gif\" data-upload=\"url\"></label>${b.url ? `<img class=\"mini\" src=\"${esc(b.url)}\" alt=\"\">` : ''}${f('url', 'oder Bildadresse', 'url', 'https://…')}${f('alt', 'Bildbeschreibung', 'text', 'z. B. Neues Fussball-Shirt')}<div class=\"row\">${f('link', 'Link beim Anklicken (optional)', 'url', 'https://shirtbox.ch/…')}<label>Schnellwahl${linkSelect('pick-link')}</label></div>`;\n      if (b.typ === 'angebot') body = `${f('titel', 'Titel', 'text', 'z. B. 10 % auf alle Vereins-Shirts')}${f('text', 'Beschreibung', 'area')}<div class=\"row\">${f('preis', 'Preis', 'text', 'z. B. CHF 79.–')}${f('alterpreis', 'Alter Preis (durchgestrichen)', 'text', 'z. B. CHF 89.–')}</div>\n        <label>Bild hochladen (optional)<input type=\"file\" accept=\"image/jpeg,image/png,image/webp,image/gif\" data-upload=\"bild\"></label>${b.bild ? `<img class=\"mini\" src=\"${esc(b.bild)}\" alt=\"\">` : ''}<div class=\"row\">${f('button', 'Button-Text', 'text', 'z. B. Jetzt bestellen')}${f('link', 'Link', 'url', 'https://shirtbox.ch/…')}</div><label>Schnellwahl Link${linkSelect('pick-link')}</label>`;\n      if (b.typ === 'button') body = `<div class=\"row\">${f('text', 'Button-Text', 'text', 'z. B. Jetzt Shirt designen')}${f('link', 'Link', 'url', 'https://shirtbox.ch/…')}</div><label>Schnellwahl Link${linkSelect('pick-link')}</label>`;\n      if (b.typ === 'trenner') body = '<p class=\"hint\">Eine feine Linie zwischen zwei Abschnitten.</p>';\n      return `<div class=\"block\" data-i=\"${i}\"><div class=\"block-head\">${esc(BLOCK_NAMES[b.typ])}<span class=\"block-tools\"><button type=\"button\" data-move=\"-1\" title=\"Nach oben\">↑</button><button type=\"button\" data-move=\"1\" title=\"Nach unten\">↓</button><button type=\"button\" data-del title=\"Entfernen\">✕</button></span></div>${body}</div>`;\n    };\n    const content2 = n.inhalt;\n    const drawBlocks = () => {\n      $('blocks').innerHTML = content2.bloecke.map(blockHtml).join('') || '<p class=\"empty\">Noch keine Inhalte. Fügen Sie unten Bausteine hinzu.</p>';\n      $('blocks').querySelectorAll('.block').forEach(el => {\n        const b = content2.bloecke[Number(el.dataset.i)];\n        el.querySelectorAll('[data-k]').forEach(input => input.addEventListener('input', () => { b[input.dataset.k] = input.value; changed(); }));\n        el.querySelectorAll('.pick-link').forEach(sel => sel.addEventListener('change', () => { if (!sel.value) return; b.link = sel.value; el.querySelector('[data-k=\"link\"]').value = sel.value; sel.value = ''; changed(); }));\n        el.querySelectorAll('[data-upload]').forEach(input => input.addEventListener('change', async () => {\n          const file = input.files[0]; if (!file) return;\n          const form = new FormData(); form.append('bild', file);\n          try { toast('Bild wird hochgeladen …'); const r = await api('/api/bild', {method: 'POST', body: form}); b[input.dataset.upload] = r.url; drawBlocks(); changed(); toast('Bild hinzugefügt.'); } catch (e) { failed(e); }\n        }));\n        el.querySelector('[data-del]').addEventListener('click', () => { content2.bloecke.splice(Number(el.dataset.i), 1); drawBlocks(); changed(); });\n        el.querySelectorAll('[data-move]').forEach(btn => btn.addEventListener('click', () => {\n          const i = Number(el.dataset.i), j = i + Number(btn.dataset.move);\n          if (j < 0 || j >= content2.bloecke.length) return;\n          [content2.bloecke[i], content2.bloecke[j]] = [content2.bloecke[j], content2.bloecke[i]]; drawBlocks(); changed();\n        }));\n      });\n    };\n    let previewTimer;\n    const preview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => api('/api/newsletter/vorschau', {method: 'POST', body: {betreff: $('nl-betreff').value, inhalt: content2}}).then(r => { const fr = $('nl-frame'); if (fr) fr.srcdoc = r.html; }).catch(failed), 450); };\n    // Automatisches Speichern 3 Sekunden nach der letzten Änderung (sobald ein Betreff da ist).\n    let autosave, saving = null;\n    const changed = () => {\n      dirty = true; $('nl-saved').textContent = 'Ungespeicherte Änderungen'; preview();\n      clearTimeout(autosave); autosave = setTimeout(() => { if ($('nl-betreff')?.value.trim() && dirty) save(true).catch(() => {}); }, 3000);\n    };\n    const save = async quiet => {\n      if (saving) await saving.catch(() => {});\n      saving = (async () => {\n        const body = {betreff: $('nl-betreff').value, inhalt: content2};\n        const r = current ? await api('/api/newsletter/' + current, {method: 'PUT', body}) : await api('/api/newsletter', {method: 'POST', body});\n        if (!current) { current = r.id; history.replaceState(null, '', '#/newsletter-erstellen/' + r.id); }\n        dirty = false;\n        const label = $('nl-saved'); if (label) label.textContent = 'Gespeichert ' + new Intl.DateTimeFormat('de-CH', {hour: '2-digit', minute: '2-digit'}).format(new Date());\n        if (!quiet) toast('Entwurf gespeichert.');\n      })();\n      try { await saving; } finally { saving = null; }\n    };\n    after(() => {\n      drawBlocks(); preview();\n      $('nl-betreff').addEventListener('input', changed);\n      $('nl-vorschau').addEventListener('input', e => { content2.vorschau = e.target.value; changed(); });\n      content.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { content2.bloecke.push({typ: b.dataset.add}); drawBlocks(); changed(); $('blocks').lastElementChild?.scrollIntoView({behavior: 'smooth', block: 'center'}); }));\n      $('nl-save').addEventListener('click', () => save().catch(failed));\n      $('nl-test').addEventListener('click', async () => { try { await save(true); const r = await api(`/api/newsletter/${current}/test`, {method: 'POST'}); toast('Test-E-Mail gesendet an ' + r.an); } catch (e) { failed(e); } });\n      $('nl-delete').addEventListener('click', async () => {\n        if (!current) { location.hash = '#/newsletter'; return; }\n        if (!await confirmDialog('<h2>Entwurf löschen?</h2><p>Der Entwurf wird endgültig gelöscht.</p>', 'Löschen', true)) return;\n        try { await api('/api/newsletter/' + current, {method: 'DELETE'}); dirty = false; toast('Entwurf gelöscht.'); location.hash = '#/newsletter'; } catch (e) { failed(e); }\n      });\n      $('nl-send').addEventListener('click', async () => {\n        try {\n          if (!$('nl-betreff').value.trim()) throw Error('Bitte zuerst einen Betreff eingeben.');\n          await save(true);\n          const info = await api(`/api/newsletter/${current}/versandinfo`);\n          if (!info.empfaenger) throw Error('Es gibt noch keine bestätigten Newsletter-Empfänger.');\n          const freeToday = Math.max(0, Math.min(info.tageslimit - info.heute, info.monatslimit - info.monat));\n          const days = freeToday >= info.empfaenger ? 0 : Math.ceil((info.empfaenger - freeToday) / Math.max(1, info.tageslimit));\n          const ok = await confirmDialog(`<h2>Newsletter jetzt versenden?</h2><p>Betreff: <b>${esc($('nl-betreff').value)}</b></p>\n            <p style=\"font-size:18px\">Empfänger: <b>${info.empfaenger}</b> bestätigte Abonnent${info.empfaenger === 1 ? '' : 'en'}</p>\n            ${days ? `<p class=\"error\" style=\"background:#fff4d6;color:#7a5200\">Wegen Ihres Versandlimits (${info.tageslimit} pro Tag) wird in Etappen verschickt: heute ${freeToday}, der Rest automatisch in ca. ${days} weiteren Tag${days === 1 ? '' : 'en'}.</p>` : ''}\n            <p class=\"muted\">Haben Sie vorher eine Test-E-Mail angeschaut? Der Versand kann nicht rückgängig gemacht werden.</p>`, `An ${info.empfaenger} Empfänger senden`);\n          if (!ok) return;\n          await api(`/api/newsletter/${current}/senden`, {method: 'POST', body: {empfaenger: info.empfaenger}});\n          dirty = false; toast('Der Versand wurde gestartet.'); location.hash = '#/newsletter/' + current;\n        } catch (e) { failed(e); }\n      });\n      window.onbeforeunload = () => dirty && $('nl-betreff') ? 'Ungespeicherte Änderungen' : undefined;\n    });\n    return `<div class=\"page-head\"><div><a href=\"#/newsletter\">← Newsletter</a><h1>Newsletter erstellen</h1><p class=\"muted\"><span id=\"nl-saved\">${current ? 'Entwurf' : 'Neuer Entwurf'}</span></p></div>\n      <div class=\"actions\"><button class=\"btn\" id=\"nl-save\">💾 Entwurf speichern</button><button class=\"btn\" id=\"nl-test\">✉️ Test-E-Mail an mich</button></div></div>\n      <div class=\"editor\"><div>\n        <div class=\"card\"><label>Betreff *<input id=\"nl-betreff\" maxlength=\"200\" value=\"${esc(n.betreff)}\" placeholder=\"z. B. Neu: Shirts für Ihren Verein\"></label>\n          <label style=\"margin-top:12px\">Vorschautext <span class=\"muted\">(erscheint im Postfach neben dem Betreff)</span><input id=\"nl-vorschau\" maxlength=\"200\" value=\"${esc(n.inhalt.vorschau || '')}\"></label></div>\n        <div class=\"card\"><h2>Inhalt</h2><div id=\"blocks\"></div>\n          <p class=\"muted small\" style=\"margin:10px 0 4px\">Baustein hinzufügen:</p>\n          <div class=\"add-blocks\">${Object.entries(BLOCK_NAMES).map(([k, l]) => `<button class=\"btn btn-small\" type=\"button\" data-add=\"${k}\">+ ${l}</button>`).join('')}</div>\n          <p class=\"hint\">Logo, Kontakt, Absenderangaben und der Abmeldelink werden automatisch in jeden Newsletter eingefügt.</p></div>\n        <div class=\"send-box\"><h2>Versenden</h2><p class=\"small\">Geht nur an bestätigte Abonnenten. Vor dem Versand sehen Sie die Anzahl Empfänger und müssen bestätigen.</p>\n          <div class=\"actions\"><button class=\"btn btn-main\" id=\"nl-send\">📨 Newsletter jetzt versenden</button><button class=\"btn btn-danger\" id=\"nl-delete\">Entwurf löschen</button></div></div>\n      </div>\n      <div class=\"card preview\"><h2>Vorschau</h2><iframe id=\"nl-frame\" title=\"Newsletter-Vorschau\" sandbox=\"\"></iframe></div></div>`;\n  };\n\n  // Einstellungen\n  PAGES.einstellungen = async () => {\n    const d = await api('/api/einstellungen'), e = d.einstellungen, s = d.status;\n    const check = (good, label, note) => `<div class=\"check\">${good ? '<span class=\"badge good\">✓ OK</span>' : '<span class=\"badge bad\">✕ Fehlt</span>'}<span><b>${label}</b>${note ? `<br><span class=\"muted small\">${note}</span>` : ''}</span></div>`;\n    after(() => $('settings-form').addEventListener('submit', async ev => {\n      ev.preventDefault();\n      const body = Object.fromEntries([...new FormData(ev.target).entries()]);\n      try { await api('/api/einstellungen', {method: 'PUT', body}); timeoutMin = Number(body.timeout) || timeoutMin; toast('Einstellungen gespeichert.'); } catch (err) { failed(err); }\n    }));\n    const field = (name, label, type = 'text', note = '') => `<label>${label}<input name=\"${name}\" type=\"${type}\" value=\"${esc(e[name])}\" required>${note ? `<span class=\"hint\">${note}</span>` : ''}</label>`;\n    return `<div class=\"page-head\"><div><h1>Einstellungen</h1><p class=\"muted\">Version ${esc(s.version)}</p></div></div>\n      <div class=\"grid two\">\n        <form class=\"card\" id=\"settings-form\"><h2>Newsletter und Sicherheit</h2><div class=\"grid\">\n          ${field('test_email', 'Test-E-Mails gehen an', 'email')}\n          ${field('absender_name', 'Absendername')}\n          ${field('absender_email', 'Absenderadresse', 'email', 'Muss zur in Resend bestätigten Domain shirtbox.ch gehören.')}\n          ${field('antwort_email', 'Antworten gehen an', 'email')}\n          ${field('adresse', 'Absenderangaben in der Fusszeile', 'text', 'Pflichtangabe: Name und Postadresse.')}\n          <div class=\"row\" style=\"display:grid;grid-template-columns:1fr 1fr;gap:8px\">${field('tageslimit', 'Max. Newsletter-Mails pro Tag', 'number')}${field('monatslimit', 'Max. pro Monat', 'number')}</div>\n          <p class=\"hint\" style=\"margin-top:-4px\">Resend Gratis: 100 Mails/Tag und 3000/Monat insgesamt – inklusive Bestellmails. Deshalb Standard 80/2500. Mit Resend Pro z. B. 5000/50000 eintragen.</p>\n          ${field('timeout', 'Automatisch abmelden nach (Minuten ohne Aktivität)', 'number')}\n          <button class=\"btn btn-main\" type=\"submit\">Speichern</button></div></form>\n        <div class=\"card\"><h2>Systemprüfung</h2>\n          ${check(s.datenbank, 'Datenbank (D1)')}${check(s.bilder, 'Bildspeicher (R2)', 'für Designbilder und Newsletter-Bilder')}${check(s.resend, 'Resend-Schlüssel', 'für Test- und Newsletter-Versand')}\n          ${check(s.access, 'Cloudflare Access', s.access ? 'Zusätzlicher Schutz vor der Anmeldeseite ist aktiv.' : 'Empfohlen: ACCESS_TEAM_DOMAIN und ACCESS_AUD eintragen.')}\n          ${check(!!s.letzter_lauf, 'Automatischer Versand (Cron)', s.letzter_lauf ? 'Zuletzt gelaufen: ' + time(s.letzter_lauf) : 'Cron-Trigger */15 * * * * einrichten.')}\n          <p class=\"small\" style=\"margin-top:12px\">Newsletter-Mails heute: <b>${s.heute_gesendet}</b> von ${s.tageslimit} · diesen Monat: <b>${s.monat_gesendet}</b> von ${s.monatslimit}</p></div>\n      </div>\n      <div class=\"grid two\">\n        <div class=\"card\"><h2>Daten exportieren</h2><p class=\"muted small\">CSV-Dateien öffnen sich direkt in Excel. Bitte sicher aufbewahren – sie enthalten Personendaten.</p><div class=\"actions\"><a class=\"btn\" href=\"/api/export/kunden.csv\">⬇ Kunden</a><a class=\"btn\" href=\"/api/export/bestellungen.csv\">⬇ Bestellungen</a><a class=\"btn\" href=\"/api/export/abonnenten.csv\">⬇ Newsletter-Abonnenten</a></div>\n          <h3 style=\"margin-top:18px\">Datensicherung</h3><p class=\"small muted\">Cloudflare D1 sichert die Datenbank automatisch und kann sie bis zu 30 Tage zurück wiederherstellen („Time Travel“). Zusätzlich empfehlen wir, monatlich die drei Exporte herunterzuladen.</p></div>\n        <div class=\"card\"><h2>Protokoll</h2><p class=\"muted small\">Letzte Aktionen (ohne Kundendaten).</p><div class=\"table-wrap\"><table><tbody>${d.protokoll.map(p => `<tr><td class=\"small\" style=\"white-space:nowrap\">${time(p.zeit)}</td><td class=\"small\">${esc(p.aktion)}</td></tr>`).join('') || '<tr><td class=\"muted\">Noch keine Einträge.</td></tr>'}</tbody></table></div></div>\n      </div>`;\n  };\n\n  // ---- Start ----\n  fetch('/api/sitzung', {headers: {'X-ShirtBOX': '1'}, credentials: 'same-origin'}).then(r => r.json().then(d => ({ok: r.ok, d}))).then(({ok, d}) => {\n    if (!ok) { showLogin(d.error); return; }\n    timeoutMin = d.timeout || 30;\n    if (d.angemeldet) showApp(); else showLogin();\n  }).catch(() => showLogin('Der Server ist nicht erreichbar.'));\n})();\n";
const ADMIN_CSS = "/* ShirtBOX Verwaltung – dunkelblaue Navigation, helle Arbeitsfläche, Orange als Akzent. */\n:root{\n  --navy:#131c30;--navy-2:#1c2741;--navy-3:#2b3856;--paper:#f6f4ef;--card:#fff;--ink:#131c30;--ink-2:#465063;--ink-3:#7a8394;\n  --line:#e4e0d7;--line-2:#d3cec3;--accent:#ff5b2e;--accent-2:#e2481f;--accent-soft:#fff1ea;--fire:linear-gradient(100deg,#ff3d2e,#ff7a2b 55%,#ffb43a);\n  --good:#1f8a55;--good-soft:#e5f5ec;--warn:#a86a00;--warn-soft:#fff4d6;--bad:#c42b1c;--bad-soft:#fde8e6;--info:#2f5bd3;--info-soft:#e8eefc;\n  --radius:16px;--shadow:0 1px 2px #131c3014,0 6px 20px #131c300d;\n  --font:\"Segoe UI Variable Text\",\"Segoe UI\",system-ui,-apple-system,\"Helvetica Neue\",Arial,sans-serif;\n}\n*,*::before,*::after{box-sizing:border-box}\nhtml{-webkit-text-size-adjust:100%}\nbody{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 var(--font);-webkit-font-smoothing:antialiased}\n[hidden]{display:none!important}\na{color:var(--accent-2)}\nh1,h2,h3{margin:0 0 .4em;line-height:1.15;letter-spacing:-.02em}\nh1{font-size:clamp(24px,3vw,30px)}h2{font-size:19px}h3{font-size:16px}\n.muted{color:var(--ink-3)}.small{font-size:13px}\n.error{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:var(--bad-soft);color:var(--bad);font-weight:600}\ninput,select,textarea,button{font:inherit;color:inherit}\ninput,select,textarea{width:100%;min-height:42px;padding:9px 12px;border:1.5px solid var(--line-2);border-radius:10px;background:#fff}\ntextarea{min-height:110px;resize:vertical;line-height:1.5}\ninput:focus,select:focus,textarea:focus{outline:2px solid #ff5b2e55;border-color:var(--accent)}\nlabel{display:block;font-weight:650;font-size:14px}\nlabel>input,label>select,label>textarea{margin-top:5px;font-weight:400}\n.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;padding:0 16px;border:1.5px solid var(--line-2);border-radius:999px;background:#fff;color:var(--ink);font-weight:700;text-decoration:none;cursor:pointer;white-space:nowrap}\n.btn:hover{border-color:var(--ink)}\n.btn-main{border:0;background:var(--fire);color:var(--navy);box-shadow:0 6px 18px #ff5b2e40}\n.btn-main:hover{filter:brightness(1.05)}\n.btn-dark{border:0;background:var(--navy);color:#fff}\n.btn-danger{border-color:#f0b7b0;color:var(--bad)}\n.btn-danger:hover{border-color:var(--bad);background:var(--bad-soft)}\n.btn-small{min-height:34px;padding:0 12px;font-size:13.5px}\n.btn:disabled{opacity:.5;cursor:not-allowed}\n\n/* Anmeldung */\n.login{min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(900px 600px at 80% -10%,#ff5b2e33,transparent 70%),radial-gradient(900px 600px at 0% 110%,#4f7bff40,transparent 70%),var(--navy)}\n.login-card{width:min(400px,100%);padding:28px;border-radius:22px;background:#fff;box-shadow:0 30px 70px #0006}\n.login-card label{margin:14px 0}\n.login-card .btn{width:100%;margin-top:6px;min-height:50px;font-size:16px}\n.brand{display:flex;align-items:center;gap:10px;margin:0 0 16px;font-weight:900;font-size:21px;letter-spacing:-.04em}\n.brand img{border-radius:11px}.brand b{background:var(--fire);-webkit-background-clip:text;background-clip:text;color:transparent}.brand small{font-size:.62em;opacity:.55;font-weight:700}\n\n/* Gerüst */\n.app{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}\n.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:20px 14px;background:var(--navy);color:#e8ebf1;overflow-y:auto}\n.side .brand{color:#f4f1ea;padding:0 8px}\n.side nav{display:flex;flex-direction:column;gap:2px}\n.side nav a{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;color:#c4cbd8;font-weight:650;text-decoration:none}\n.side nav a i{font-style:normal;width:22px;text-align:center}\n.side nav a:hover{background:#ffffff12;color:#fff}\n.side nav a.active{background:#ffffff1c;color:#fff;box-shadow:inset 3px 0 0 var(--accent)}\n.logout{margin-top:auto;padding:10px 12px;border:1px solid #ffffff2b;border-radius:12px;background:transparent;color:#c4cbd8;font-weight:650;cursor:pointer}\n.logout:hover{background:#ffffff12;color:#fff}\n.topbar{display:none}\n.content{min-width:0;padding:28px clamp(16px,3vw,36px) 60px;outline:none}\n.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 20px}\n.page-head p{margin:2px 0 0}\n.actions{display:flex;gap:8px;flex-wrap:wrap}\n\n/* Karten und Kennzahlen */\n.card{padding:18px 20px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow)}\n.card+.card,.card+.grid,.grid+.card,.grid+.grid{margin-top:16px}\n.card h2{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}\n.grid{display:grid;gap:12px}\n.kpis{grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}\n.kpi{padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:var(--shadow)}\n.kpi span{display:block;color:var(--ink-3);font-size:12.5px;font-weight:650;text-transform:uppercase;letter-spacing:.05em}\n.kpi strong{display:block;margin-top:2px;font-size:clamp(18px,1.6vw,23px);letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}\n.kpi small{display:block;color:var(--ink-3);font-size:12.5px}\n.kpi.highlight{border-color:#ffd2bd;background:var(--accent-soft)}\n.two{grid-template-columns:repeat(2,minmax(0,1fr))}\n.three{grid-template-columns:repeat(3,minmax(0,1fr))}\n\n/* Tabellen */\n.table-wrap{overflow-x:auto;margin:0 -20px;padding:0 20px}\ntable{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}\nth{padding:9px 10px;border-bottom:2px solid var(--line);color:var(--ink-3);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;white-space:nowrap}\ntd{padding:10px;border-bottom:1px solid var(--line);vertical-align:middle}\ntr.click{cursor:pointer}tr.click:hover td{background:#faf8f4}\ntd.num,th.num{text-align:right;white-space:nowrap}\n.thumb{width:54px;height:36px;object-fit:cover;border-radius:6px;background:#747474;display:block}\n.empty{padding:26px;border:2px dashed var(--line);border-radius:14px;color:var(--ink-3);text-align:center}\n\n/* Filterzeile */\n.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:0 0 14px}\n.filters>*{flex:1 1 150px}\n.filters .grow{flex:3 1 240px}\n.filters label{font-size:12.5px;color:var(--ink-3)}\n.pager{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;color:var(--ink-3);font-size:13.5px}\n\n/* Status-Abzeichen: immer mit Text, nie nur Farbe. */\n.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:12.5px;font-weight:700;white-space:nowrap;background:#eef0f4;color:var(--ink-2)}\n.badge.good{background:var(--good-soft);color:var(--good)}.badge.warn{background:var(--warn-soft);color:var(--warn)}\n.badge.bad{background:var(--bad-soft);color:var(--bad)}.badge.info{background:var(--info-soft);color:var(--info)}.badge.accent{background:var(--accent-soft);color:var(--accent-2)}\n\n/* Details */\n.facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}\n.facts dt{color:var(--ink-3);font-size:13.5px}.facts dd{margin:0;font-weight:600;overflow-wrap:anywhere}\n.design{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:18px;padding:16px 0;border-top:1px solid var(--line)}\n.design:first-of-type{border-top:0}\n.design img{width:100%;border-radius:12px;background:#747474;display:block}\n.design pre{white-space:pre-wrap;font:12.5px/1.5 var(--font);margin:8px 0 0;padding:10px 12px;border-radius:10px;background:#f4f1ea;color:var(--ink-2)}\n.status-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n\n/* Diagramm: eine Reihe, Balken mit gerundeten Enden, Tooltip beim Darüberfahren. */\n.chart{position:relative}\n.chart svg{display:block;width:100%;height:260px;overflow:visible}\n.chart .bar{fill:#ff6a2b}.chart .bar:hover,.chart .bar.on{fill:#e2481f}\n.chart .hit{fill:transparent;cursor:crosshair}\n.chart .grid-line{stroke:#ece8df;stroke-width:1}\n.chart .axis{fill:var(--ink-3);font-size:11px}\n.chart-tip{position:absolute;pointer-events:none;padding:8px 10px;border-radius:10px;background:var(--navy);color:#fff;font-size:12.5px;line-height:1.35;white-space:nowrap;transform:translate(-50%,-100%);box-shadow:0 8px 20px #0003}\n.chart-tip b{display:block;font-size:14px}\n.seg{display:inline-flex;padding:3px;border-radius:999px;background:#eef0f4}\n.seg button{min-height:32px;padding:0 12px;border:0;border-radius:999px;background:transparent;font-size:13px;font-weight:700;color:var(--ink-2);cursor:pointer}\n.seg button.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px #0002}\ndetails.table-view{margin-top:10px}details.table-view summary{cursor:pointer;color:var(--ink-3);font-size:13px}\n\n/* Newsletter-Editor */\n.editor{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}\n.editor .preview{position:sticky;top:16px}\n.preview iframe{width:100%;height:calc(100vh - 140px);min-height:520px;border:1px solid var(--line);border-radius:14px;background:#ece8e0}\n.block{position:relative;margin:0 0 10px;padding:14px;border:1.5px solid var(--line);border-radius:14px;background:#fff}\n.block-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;font-weight:750;font-size:13.5px;color:var(--ink-2)}\n.block-tools{display:flex;gap:4px}\n.block-tools button{width:32px;height:32px;border:1px solid var(--line-2);border-radius:8px;background:#fff;cursor:pointer}\n.block-tools button:hover{border-color:var(--ink)}\n.block .row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}\n.block label{margin-top:8px}\n.block img.mini{max-width:160px;max-height:100px;border-radius:8px;display:block;margin-top:6px}\n.add-blocks{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 16px}\n.hint{margin:6px 0 0;color:var(--ink-3);font-size:12.5px}\n.send-box{margin-top:16px;padding:16px;border:2px solid #ffd2bd;border-radius:14px;background:var(--accent-soft)}\n.send-box .btn-main{min-height:52px;padding:0 26px;font-size:16px}\n\n/* Dialog und Meldung */\n.dialog{width:min(480px,calc(100vw - 32px));padding:0;border:0;border-radius:18px;box-shadow:0 30px 70px #0005}\n.dialog::backdrop{background:#131c30aa}\n#dialog-body{padding:22px 22px 6px}\n.dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:14px 22px 20px}\n.toast{position:fixed;left:50%;bottom:24px;z-index:50;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:12px 18px;border-radius:12px;background:var(--navy);color:#fff;font-weight:650;box-shadow:0 12px 30px #0004}\n.toast.bad{background:var(--bad)}\n.loading{padding:40px;color:var(--ink-3);text-align:center}\n.check{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}\n.check:last-child{border-bottom:0}\n\n@media(max-width:1100px){.editor{grid-template-columns:1fr}.editor .preview{position:static}.preview iframe{height:640px}}\n@media(max-width:860px){\n  .app{grid-template-columns:1fr}\n  .side{position:fixed;inset:0 auto 0 0;z-index:40;width:min(280px,84vw);transform:translateX(-100%);transition:transform .2s;box-shadow:20px 0 50px #0005}\n  .side.open{transform:none}\n  .topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--navy);color:#fff}\n  .menu-btn{min-height:40px;padding:0 14px;border:1px solid #ffffff33;border-radius:999px;background:transparent;color:#fff;font-weight:700;cursor:pointer}\n  .topbar-title{font-weight:750}\n  .content{padding:18px 16px 50px}\n  .two,.three,.design,.status-row{grid-template-columns:1fr}\n  .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .kpi strong{font-size:18px}\n  .card{padding:16px}\n  .table-wrap{margin:0 -16px;padding:0 16px}\n  .hide-mobile{display:none}\n}\n@media print{\n  body{background:#fff;font-size:12px}\n  .side,.topbar,.no-print,.toast{display:none!important}\n  .app{display:block}.content{padding:0}\n  .card{box-shadow:none;border:0;padding:0}\n  .design{break-inside:avoid;grid-template-columns:1.4fr 1fr}\n  a{color:inherit;text-decoration:none}\n}\n";
const SCHEMA = "-- ShirtBOX Verwaltung – Datenbank (Cloudflare D1, Name: shirtbox-verwaltung)\n-- Einmal komplett in der D1-Konsole ausführen. Mehrfaches Ausführen schadet nicht.\n-- Bereich 1: Kunden und Bestellungen. Bereich 2: Newsletter (getrennte Tabellen, nur per E-Mail verknüpfbar).\n\n-- ===== Bereich 1: Kunden und Bestellungen =====\nCREATE TABLE IF NOT EXISTS kunden (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- Kundennummer = K-(10000 + id)\n  email TEXT NOT NULL UNIQUE COLLATE NOCASE,\n  vorname TEXT NOT NULL,\n  nachname TEXT NOT NULL,\n  telefon TEXT,\n  strasse TEXT,\n  plz TEXT,\n  ort TEXT,\n  land TEXT,\n  erste_bestellung TEXT NOT NULL,                -- ISO-Zeitpunkt (UTC)\n  aktualisiert TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS bestellungen (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  bestellnummer TEXT NOT NULL UNIQUE,\n  client_id TEXT UNIQUE,                         -- Schutz gegen doppelte Speicherung\n  kunde_id INTEGER NOT NULL REFERENCES kunden(id),\n  erstellt TEXT NOT NULL,                        -- ISO-Zeitpunkt (UTC)\n  datum TEXT NOT NULL,                           -- Kalendertag in Zürich (JJJJ-MM-TT) für Auswertungen\n  anzahl INTEGER NOT NULL,\n  total_rappen INTEGER NOT NULL,\n  versand_rappen INTEGER NOT NULL DEFAULT 0,\n  status TEXT NOT NULL DEFAULT 'neu',            -- neu, bearbeitung, produziert, versendet, abgeschlossen, storniert\n  zahlung TEXT NOT NULL DEFAULT 'offen',         -- offen, bezahlt, rueckerstattet\n  bezahlt_am TEXT,\n  lieferadresse TEXT NOT NULL,                   -- Adresse zum Zeitpunkt der Bestellung (JSON)\n  notiz TEXT,\n  agb TEXT\n);\nCREATE INDEX IF NOT EXISTS bestellungen_kunde ON bestellungen(kunde_id);\nCREATE INDEX IF NOT EXISTS bestellungen_datum ON bestellungen(datum);\n\nCREATE TABLE IF NOT EXISTS bestell_designs (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id) ON DELETE CASCADE,\n  design_nr INTEGER NOT NULL,\n  anzahl INTEGER NOT NULL,\n  einzelpreis_rappen INTEGER NOT NULL,           -- Preis des ersten Shirts dieses Designs\n  summe_rappen INTEGER NOT NULL,\n  farbe TEXT,\n  details TEXT,                                  -- Platzierung / Gestaltungseinstellungen\n  bild_vorschau TEXT,                            -- R2-Schlüssel (Vorder- und Rückseite in einem Bild)\n  bild_druck TEXT,                               -- R2-Schlüssel der Druckdatei\n  bilder_original TEXT,                          -- JSON-Liste von R2-Schlüsseln\n  rechte INTEGER NOT NULL DEFAULT 0\n);\nCREATE INDEX IF NOT EXISTS bestell_designs_bestellung ON bestell_designs(bestellung_id);\n\nCREATE TABLE IF NOT EXISTS bestell_groessen (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  design_id INTEGER NOT NULL REFERENCES bestell_designs(id) ON DELETE CASCADE,\n  groesse TEXT NOT NULL,                         -- vom Kunden gewählt\n  bestellgroesse TEXT NOT NULL,                  -- beim Lieferanten (asiatisch, +2)\n  anzahl INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS bestell_groessen_design ON bestell_groessen(design_id);\n\n-- ===== Bereich 2: Newsletter =====\nCREATE TABLE IF NOT EXISTS abonnenten (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  email TEXT NOT NULL UNIQUE COLLATE NOCASE,     -- jede Adresse nur einmal\n  vorname TEXT,\n  nachname TEXT,\n  status TEXT NOT NULL DEFAULT 'ausstehend',     -- ausstehend, aktiv, abgemeldet, unzustellbar, beschwerde\n  angemeldet TEXT NOT NULL,                      -- Zeitpunkt der Anmeldung\n  einwilligung_zeit TEXT,                        -- Zeitpunkt der bestätigten Einwilligung (Double-Opt-in)\n  einwilligung_quelle TEXT,                      -- z. B. Startseite, Bestellung SB-…\n  einwilligung_text TEXT,                        -- exakter Wortlaut, dem zugestimmt wurde\n  bestaetigung_gesendet TEXT,\n  abgemeldet TEXT,\n  token TEXT NOT NULL UNIQUE                     -- geheimer Schlüssel für Bestätigungs- und Abmeldelink\n);\nCREATE INDEX IF NOT EXISTS abonnenten_status ON abonnenten(status);\n\nCREATE TABLE IF NOT EXISTS newsletter (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  betreff TEXT NOT NULL,\n  inhalt TEXT NOT NULL,                          -- JSON: Vorschautext und Blöcke\n  status TEXT NOT NULL DEFAULT 'entwurf',        -- entwurf, versand, versendet\n  erstellt TEXT NOT NULL,\n  geaendert TEXT NOT NULL,\n  versand_start TEXT,\n  versand_ende TEXT,\n  empfaenger INTEGER NOT NULL DEFAULT 0\n);\n\nCREATE TABLE IF NOT EXISTS newsletter_empfaenger (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  newsletter_id INTEGER NOT NULL REFERENCES newsletter(id) ON DELETE CASCADE,\n  abonnent_id INTEGER NOT NULL REFERENCES abonnenten(id) ON DELETE CASCADE,\n  status TEXT NOT NULL DEFAULT 'wartend',        -- wartend, gesendet, zugestellt, fehler, unzustellbar, beschwerde, uebersprungen\n  resend_id TEXT,\n  gesendet TEXT,\n  fehler TEXT,\n  UNIQUE(newsletter_id, abonnent_id)\n);\nCREATE INDEX IF NOT EXISTS newsletter_empfaenger_status ON newsletter_empfaenger(status);\nCREATE INDEX IF NOT EXISTS newsletter_empfaenger_resend ON newsletter_empfaenger(resend_id);\n\n-- ===== Verwaltung =====\nCREATE TABLE IF NOT EXISTS einstellungen (\n  schluessel TEXT PRIMARY KEY,\n  wert TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS anmeldeversuche (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  zeit TEXT NOT NULL,\n  erfolg INTEGER NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS protokoll (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  zeit TEXT NOT NULL,\n  aktion TEXT NOT NULL                           -- nur Aktionen, keine Kundendaten\n);\n";

const VERSION = '20261024-verwaltung';
const PUBLIC_WORKER = 'https://shirtbox-email.r-n.workers.dev';
const SITE = 'https://shirtbox.ch';
const STATUS = ['neu', 'bearbeitung', 'produziert', 'versendet', 'abgeschlossen', 'storniert'];
const ZAHLUNG = ['offen', 'bezahlt', 'rueckerstattet'];
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
  const exists = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'protokoll'").first();
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
      SUM(zahlung = 'offen') AS offen, SUM(zahlung = 'bezahlt') AS bezahlt, SUM(anzahl) AS shirts,
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
      SUM(CASE WHEN zahlung = 'offen' AND status != 'storniert' THEN total_rappen END) AS offen FROM bestellungen WHERE datum >= ?`).bind(range === '12m' ? labels[0] + '-01' : labels[0]).first();
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
  const designs = (await env.DB.prepare('SELECT d.bild_vorschau, d.bild_druck, d.bilder_original FROM bestell_designs d JOIN bestellungen b ON b.id = d.bestellung_id WHERE b.kunde_id = ?').bind(id).all()).results;
  const keys = designs.flatMap(d => [d.bild_vorschau, d.bild_druck, ...JSON.parse(d.bilder_original || '[]')]).filter(Boolean);
  if (env.BILDER && keys.length) for (let i = 0; i < keys.length; i += 1000) await env.BILDER.delete(keys.slice(i, i + 1000));
  await env.DB.batch([
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
  const changes = [];
  if (data.status !== undefined) { if (!STATUS.includes(data.status)) return fail(400, 'Unbekannter Status.'); changes.push(env.DB.prepare('UPDATE bestellungen SET status = ? WHERE id = ?').bind(data.status, id)); }
  if (data.zahlung !== undefined) {
    if (!ZAHLUNG.includes(data.zahlung)) return fail(400, 'Unbekannter Zahlungsstatus.');
    const paid = data.zahlung === 'bezahlt' ? (current.zahlung === 'bezahlt' ? undefined : zurichDay()) : null;
    changes.push(paid === undefined ? env.DB.prepare('UPDATE bestellungen SET zahlung = ? WHERE id = ?').bind(data.zahlung, id)
      : env.DB.prepare('UPDATE bestellungen SET zahlung = ?, bezahlt_am = ? WHERE id = ?').bind(data.zahlung, paid, id));
  }
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
