// ShirtBOX Verwaltungszentrale – Worker "shirtbox-admin" auf admin.shirtbox.ch.
// Diese Datei wird von bauen.ps1 zu ../2-shirtbox-admin-worker.js zusammengesetzt (mit Oberfläche und Datenbank-Schema).
// Bindings: D1 DB (shirtbox-verwaltung), R2 BILDER (shirtbox-bilder).
// Secrets: RESEND_API_KEY, ADMIN_PASSWORD, ADMIN_TOTP_SECRET.
// Variablen (empfohlen): ACCESS_TEAM_DOMAIN (z. B. shirtbox.cloudflareaccess.com), ACCESS_AUD (Application Audience Tag).
// Cron-Trigger: */15 * * * *  (setzt den Newsletter-Versand in Etappen fort).

const ADMIN_HTML = __ADMIN_HTML__;
const ADMIN_JS = __ADMIN_JS__;
const ADMIN_CSS = __ADMIN_CSS__;
const SCHEMA = __SCHEMA__;

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
      Fragen? Schreiben Sie uns per <a href="https://wa.me/41764690100" style="color:#e2481f;font-weight:bold;text-decoration:none">WhatsApp 076 469 01 00</a> oder an <a href="mailto:${esc(settings.antwort_email)}" style="color:#e2481f;font-weight:bold;text-decoration:none">${esc(settings.antwort_email)}</a>.
    </td></tr></table>
  </td></tr>
  <tr><td style="background:#131c30;padding:20px 32px;${font}font-size:12px;line-height:1.7;color:#8a94a6">
    ${esc(settings.adresse)}<br>${reason}<br>
    <a href="${unsubscribe}" style="color:#ff9a6e;text-decoration:underline">Newsletter abbestellen</a> · <a href="${SITE}" style="color:#ff9a6e;text-decoration:none">shirtbox.ch</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [...textParts, '', '---', `Fragen? WhatsApp 076 469 01 00 oder ${settings.antwort_email}`, settings.adresse, reason, `Abmelden: ${unsubscribe}`].join('\n\n');
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
