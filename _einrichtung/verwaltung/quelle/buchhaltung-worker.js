
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
