// ShirtBOX Verwaltung – Buchhaltung (vereinfachte Einnahmen-/Ausgabenrechnung). Nutzt die Bausteine aus admin.js (window.ShirtboxAdmin).
(() => {
  'use strict';
  const A = window.ShirtboxAdmin; if (!A) return;
  const {PAGES, TITLES, api, esc, chf, date, time, kpi, badge, pager, bindFilters, bindPager, query, after, toast, failed, confirmDialog, render, content, $, STATUS, ZAHLUNG} = A;
  const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Zurich'}).format(new Date());
  const amount = r => ((Number(r) || 0) / 100).toFixed(2); // für Eingabefelder
  const ZAHLUNGSARTEN = ['TWINT', 'Banküberweisung', 'Bar', 'Kreditkarte', 'Sonstige'];
  const ZUSTAND = {offen: ['Offen', 'warn'], teilweise: ['Teilweise bezahlt', 'info'], bezahlt: ['Bezahlt', 'good'], ueberfaellig: ['Überfällig', 'bad'], rueckerstattet: ['Rückerstattet', 'bad'], storniert: ['Storniert', ''], gutschrift: ['Gutschrift', 'accent'], gebucht: ['Gebucht', 'good']};
  const KOSTEN = {textilien: 'T-Shirts (Einkauf)', druck: 'Druck', verpackung: 'Verpackung', versand: 'Versand', gebuehren: 'Zahlungsgebühren', sonstiges: 'Weitere direkte Kosten'};
  const opt = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const SIMPLE = '<p class="bh-note">Vereinfachte Einnahmen-/Ausgabenrechnung (OR 957 Abs. 2) – keine doppelte Buchhaltung mit Kontenplan, Bilanz und Erfolgsrechnung. Alle Beträge in CHF.</p>';

  // Navigation: eigene Seiten, Titel und aktiver Menüpunkt (die Untermenü-Links tragen data-nav).
  Object.assign(TITLES, {'bh-uebersicht': 'Buchhaltung · Übersicht', 'bh-einnahmen': 'Buchhaltung · Einnahmen', 'bh-ausgaben': 'Buchhaltung · Ausgaben', 'bh-rechnungen': 'Buchhaltung · Rechnungen',
    'bh-belege': 'Buchhaltung · Belege', 'bh-zahlungen': 'Buchhaltung · Zahlungen', 'bh-lieferanten': 'Buchhaltung · Lieferanten', 'bh-auswertungen': 'Buchhaltung · Auswertungen', 'bh-einstellungen': 'Buchhaltung · Einstellungen'});
  const quick = `<div class="actions bh-quick no-print"><button class="btn btn-main" data-quick="einnahme">＋ Neue Einnahme</button><button class="btn btn-main" data-quick="ausgabe">＋ Neue Ausgabe</button><button class="btn" data-quick="beleg">⬆ Beleg hochladen</button><a class="btn" href="#/bh-rechnungen/neu">🧾 Rechnung erstellen</a><a class="btn" href="#/bh-auswertungen">⬇ Bericht exportieren</a></div>`;
  content.addEventListener('click', e => {
    const q = e.target.closest('[data-quick]'); if (!q) return;
    if (q.dataset.quick === 'ausgabe') expenseForm(null, render);
    if (q.dataset.quick === 'einnahme') incomeForm(null, render);
    if (q.dataset.quick === 'beleg') uploadOnly(render);
  });

  // ---- Formular-Dialog: bleibt bei Fehlern offen und zeigt die Meldung direkt im Dialog ----
  function formDialog(title, body, okLabel, save, wide) {
    return new Promise(resolve => {
      const dialog = $('dialog');
      dialog.classList.toggle('wide', !!wide);
      $('dialog-body').innerHTML = `<h2>${esc(title)}</h2>${body}<p class="error" id="bh-dialog-error" hidden></p>`;
      $('dialog-body').oninput = null;
      $('dialog-actions').innerHTML = `<button class="btn" value="nein" type="submit" formnovalidate>Abbrechen</button>${okLabel ? `<button class="btn btn-main" type="button" id="bh-dialog-save">${esc(okLabel)}</button>` : ''}`;
      dialog.onclose = () => { dialog.classList.remove('wide'); resolve(dialog.returnValue === 'ja'); };
      dialog.returnValue = '';
      const btn = $('bh-dialog-save');
      btn?.addEventListener('click', async () => {
        btn.disabled = true; const err = $('bh-dialog-error'); err.hidden = true;
        try { await save(); dialog.close('ja'); }
        catch (e) { if (e.message !== 'abgemeldet') { err.textContent = e.message; err.hidden = false; } }
        btn.disabled = false;
      });
      dialog.showModal();
    });
  }
  const val = id => ($(id)?.value ?? '').trim();
  async function lists() {
    const [e, l] = await Promise.all([api('/api/bh/einstellungen'), api('/api/bh/lieferanten')]);
    return {s: e.einstellungen, kat: e.kategorien, lief: l.lieferanten};
  }
  // Beleg-Feld in Formularen: lädt sofort hoch und merkt sich die Belegnummer.
  const receiptField = (current, name) => `<div class="bh-receipt"><input type="hidden" id="f-beleg" value="${esc(current || '')}"><span id="f-beleg-name" class="small">${current ? `📎 ${esc(name || 'Beleg B-' + String(current).padStart(5, '0'))}` : 'Kein Beleg verknüpft'}</span>
    <label class="btn btn-small">⬆ Beleg hochladen<input type="file" id="f-beleg-datei" accept="application/pdf,image/jpeg,image/png" hidden></label>${current ? '<button type="button" class="btn btn-small" id="f-beleg-weg">Lösen</button>' : ''}</div><p class="hint">PDF, JPG oder PNG, höchstens 10 MB.</p>`;
  function bindReceipt() {
    $('f-beleg-datei')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 10 * 1024 * 1024) { $('f-beleg-name').textContent = '⚠ Die maximale Grösse von 10 MB ist überschritten.'; return; }
      $('f-beleg-name').textContent = 'Wird hochgeladen …';
      try { const r = await upload(file); $('f-beleg').value = r.id; $('f-beleg-name').textContent = `📎 ${r.dateiname} (${r.ref})${r.doppelt ? ' – war schon vorhanden, wurde verknüpft' : ''}`; }
      catch (err) { $('f-beleg-name').textContent = '⚠ ' + err.message; }
    });
    $('f-beleg-weg')?.addEventListener('click', () => { $('f-beleg').value = ''; $('f-beleg-name').textContent = 'Kein Beleg verknüpft'; });
  }
  async function upload(file, notiz) { const form = new FormData(); form.append('datei', file); if (notiz) form.append('notiz', notiz); return api('/api/bh/belege', {method: 'POST', body: form}); }
  function uploadOnly(done) {
    formDialog('Beleg hochladen', `<label>Datei (PDF, JPG oder PNG, höchstens 10 MB)<input type="file" id="u-datei" accept="application/pdf,image/jpeg,image/png"></label><label>Notiz (optional)<input id="u-notiz" placeholder="z. B. Quittung Post Versand"></label>
      <p class="hint">Tipp: Belege für Ausgaben lädst du am einfachsten direkt beim Erfassen der Ausgabe hoch – dann sind sie gleich verknüpft.</p>`, 'Hochladen', async () => {
      const file = $('u-datei').files[0]; if (!file) throw Error('Bitte eine Datei wählen.');
      if (file.size > 10 * 1024 * 1024) throw Error('Die maximale Grösse von 10 MB ist überschritten.');
      const r = await upload(file, val('u-notiz')); toast(r.doppelt ? `Dieser Beleg war schon vorhanden (${r.ref}).` : `Beleg ${r.ref} gespeichert.`);
    }).then(ok => ok && done && done());
  }
  function stornoDialog(what, url, done) {
    formDialog(`${what} stornieren?`, `<p>Die Buchung bleibt zur Nachvollziehbarkeit erhalten, zählt aber nicht mehr. Für eine Korrektur danach einfach neu erfassen.</p><label>Grund (Pflicht)<input id="s-grund" placeholder="z. B. Doppelt erfasst, falscher Betrag"></label>`, 'Stornieren', async () => {
      if (!val('s-grund')) throw Error('Bitte einen Grund angeben.');
      await api(url, {method: 'POST', body: {grund: val('s-grund')}}); toast('Storniert.');
    }).then(ok => ok && done());
  }

  // ---- Diagramm: Einnahmen und Ausgaben pro Monat (zwei Reihen) ----
  function chart2(el, punkte) {
    const draw = () => {
      const W = Math.max(280, el.clientWidth), H = 260, padL = 50, padB = 26, padT = 12, innerW = W - padL - 6, innerH = H - padB - padT;
      const max = Math.max(...punkte.flatMap(p => [p.einnahmen, p.ausgaben]), 0), stepRaw = (max || 10000) / 4, mag = Math.pow(10, Math.floor(Math.log10(stepRaw)));
      const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= stepRaw), top = step * 4, slot = innerW / punkte.length, bw = Math.max(3, Math.min(16, slot / 2 - 3));
      const y = v => padT + innerH - (v / top) * innerH, short = v => { v /= 100; return v >= 1000 ? `${(v / 1000).toLocaleString('de-CH', {maximumFractionDigits: 1})}k` : String(Math.round(v)); };
      const label = p => new Intl.DateTimeFormat('de-CH', {month: 'short', timeZone: 'UTC'}).format(new Date(p.periode + '-01T12:00:00Z'));
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Einnahmen und Ausgaben der letzten zwölf Monate">`;
      for (let i = 0; i <= 4; i++) svg += `<line class="grid-line" x1="${padL}" x2="${W - 6}" y1="${y(step * i)}" y2="${y(step * i)}"/><text class="axis" x="${padL - 8}" y="${y(step * i) + 4}" text-anchor="end">${short(step * i)}</text>`;
      punkte.forEach((p, i) => {
        const x = padL + slot * i + slot / 2;
        for (const [k, cls, dx] of [['einnahmen', 'bar', -bw - 1], ['ausgaben', 'bar bar-out', 1]]) {
          const h = Math.max(0, padT + innerH - y(p[k])); if (h > 0) svg += `<rect class="${cls}" x="${x + dx}" y="${y(p[k])}" width="${bw}" height="${h}" rx="2"><title>${label(p)}: ${k === 'einnahmen' ? 'Einnahmen' : 'Ausgaben'} ${chf(p[k])}</title></rect>`;
        }
        if (punkte.length <= 12 || i % 2 === 0) svg += `<text class="axis" x="${x}" y="${H - 6}" text-anchor="middle">${esc(label(p))}</text>`;
      });
      el.innerHTML = svg + `<line x1="${padL}" x2="${W - 6}" y1="${padT + innerH}" y2="${padT + innerH}" stroke="#c9c3b6"/></svg>`;
    };
    el._w = el.clientWidth; draw();
    const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } if (Math.abs(el.clientWidth - el._w) > 8) { el._w = el.clientWidth; draw(); } });
    ro.observe(el);
  }
  const bars = (rows, labelKey = 'name') => { const max = Math.max(...rows.map(r => Number(r.summe) || 0), 1); return rows.length ? `<div class="bh-bars">${rows.map(r => `<div class="bh-bar"><span>${esc(r[labelKey])}</span><i style="width:${Math.max(2, (Number(r.summe) || 0) / max * 100)}%"></i><b>${chf(r.summe)}</b></div>`).join('')}</div>` : '<p class="empty">Keine Daten im gewählten Zeitraum.</p>'; };

  // ---- Übersicht ----
  const ovState = {zeitraum: 'monat', von: '', bis: ''};
  const PERIODS = {heute: 'Heute', woche: 'Diese Woche', monat: 'Dieser Monat', jahr: 'Dieses Geschäftsjahr', eigen: 'Zeitraum wählen'};
  PAGES['bh-uebersicht'] = async () => {
    const d = await api('/api/bh/uebersicht?' + query(ovState)), p = d.periode, m = d.monat, j = d.jahr;
    after(() => {
      chart2($('bh-chart'), d.verlauf);
      content.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => { ovState.zeitraum = b.dataset.period; if (ovState.zeitraum !== 'eigen') render(); else $('bh-eigen').hidden = false; }));
      $('bh-eigen-ok').addEventListener('click', () => { ovState.von = val('bh-von'); ovState.bis = val('bh-bis'); ovState.zeitraum = 'eigen'; render(); });
    });
    const sign = v => `<b class="${v < 0 ? 'neg' : 'pos'}">${chf(v)}</b>`;
    return `<div class="page-head"><div><h1>Buchhaltung</h1>${SIMPLE}</div></div>${quick}
      <div class="grid kpis">
        ${kpi('Einnahmen diesen Monat', chf(m.einnahmen), 'tatsächlich eingegangen')}${kpi('Ausgaben diesen Monat', chf(m.ausgaben))}${kpi('Ergebnis diesen Monat', sign(m.ergebnis), 'Einnahmen − Ausgaben', 'highlight')}
        ${kpi('Offene Kundenzahlungen', chf(d.offen.summe), `${d.offen.anzahl} Bestellung${d.offen.anzahl === 1 ? '' : 'en'} · <a href="#/bh-zahlungen">ansehen</a>`)}
        ${kpi('Überfällig', chf(d.ueberfaellig.summe), `${d.ueberfaellig.anzahl} Bestellung${d.ueberfaellig.anzahl === 1 ? '' : 'en'}`, d.ueberfaellig.anzahl ? 'alert' : '')}
        ${kpi('Bezahlte Bestellungen', p.bezahlte_bestellungen, PERIODS[d.zeitraum.zeitraum])}
        ${kpi('Umsatz Geschäftsjahr', chf(j.umsatz), `Bestellwert seit ${date(d.gj_start)}`)}${kpi('Ergebnis Geschäftsjahr', sign(j.ergebnis), `Einnahmen ${chf(j.einnahmen)} − Ausgaben ${chf(j.ausgaben)}`)}
      </div>
      <div class="card"><h2>Zeitraum <span class="seg">${Object.entries(PERIODS).map(([k, l]) => `<button type="button" data-period="${k}" class="${d.zeitraum.zeitraum === k ? 'on' : ''}">${l}</button>`).join('')}</span></h2>
        <div class="filters" id="bh-eigen"${d.zeitraum.zeitraum === 'eigen' ? '' : ' hidden'}><label>Von<input type="date" id="bh-von" value="${esc(ovState.von)}"></label><label>Bis<input type="date" id="bh-bis" value="${esc(ovState.bis)}"></label><button class="btn" id="bh-eigen-ok" type="button">Anzeigen</button></div>
        <p class="muted small">${date(d.zeitraum.von)} – ${date(d.zeitraum.bis)}</p>
        <div class="grid kpis">${kpi('Einnahmen', chf(p.einnahmen))}${kpi('Ausgaben', chf(p.ausgaben))}${kpi('Ergebnis', sign(p.ergebnis), '', 'highlight')}${kpi('Umsatz (Bestellwert)', chf(p.umsatz), 'nach Bestelldatum, nach Gutschriften')}</div></div>
      <div class="grid two">
        <div class="card"><h2>Einnahmen und Ausgaben – letzte 12 Monate</h2><p class="bh-legend"><i class="in"></i>Einnahmen <i class="out"></i>Ausgaben</p><div class="chart" id="bh-chart"></div>
          <details class="table-view"><summary>Werte als Tabelle anzeigen</summary><div class="table-wrap"><table><thead><tr><th>Monat</th><th class="num">Einnahmen</th><th class="num">Ausgaben</th><th class="num">Ergebnis</th></tr></thead><tbody>${d.verlauf.slice().reverse().map(r => `<tr><td>${r.periode.split('-').reverse().join('.')}</td><td class="num">${chf(r.einnahmen)}</td><td class="num">${chf(r.ausgaben)}</td><td class="num">${chf(r.einnahmen - r.ausgaben)}</td></tr>`).join('')}</tbody></table></div></details></div>
        <div class="card"><h2>Ausgaben nach Kategorie</h2><p class="muted small">${PERIODS[d.zeitraum.zeitraum]}</p>${bars(d.kategorien)}</div>
      </div>
      ${d.ueberfaellig.liste.length ? `<div class="card"><h2>Überfällige Zahlungen <a class="btn btn-small" href="#/bh-zahlungen">Alle Zahlungen</a></h2><div class="table-wrap"><table><thead><tr><th>Bestellung</th><th>Kunde</th><th>Fällig seit</th><th class="num">Offen</th></tr></thead><tbody>
        ${d.ueberfaellig.liste.map(o => `<tr class="click" data-href="#/bestellungen/${o.id}"><td><b>${esc(o.bestellnummer)}</b></td><td>${esc(o.vorname)} ${esc(o.nachname)}</td><td>${date(o.faellig)}</td><td class="num">${chf(o.offen)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${Number(d.offene_ausgaben.n) ? `<div class="card"><p>⏳ <b>${d.offene_ausgaben.n} Ausgabe${d.offene_ausgaben.n === 1 ? '' : 'n'}</b> noch nicht bezahlt (${chf(d.offene_ausgaben.summe)}). <a href="#/bh-ausgaben/?zahlung=offen">Ansehen</a></p></div>` : ''}`;
  };

  // ---- Ausgaben ----
  const exState = {q: '', von: '', bis: '', kategorie: '', lieferant: '', zahlung: '', storniert: '', seite: 1};
  async function expenseForm(id, done) {
    let s, kat, lief, cur;
    try { [{s, kat, lief}, cur] = await Promise.all([lists(), id ? api('/api/bh/ausgaben/' + id) : null]); } catch (e) { failed(e); return; }
    const a = cur?.ausgabe || {datum: today(), zahlung: 'bezahlt', zahlungsart: 'TWINT', mwst_satz: s.bh_mwst_standard, wiederkehrend: ''};
    const pflichtig = s.bh_mwst_pflichtig === '1', saetze = ['0', ...s.bh_mwst_saetze.split(/,\s*/)];
    const body = `<div class="form-grid">
      <label>Datum<input type="date" id="f-datum" value="${esc(a.datum)}" required></label>
      <label>Betrag in CHF${pflichtig ? ' (brutto, inkl. MWST)' : ''}<input id="f-betrag" inputmode="decimal" value="${a.brutto_rappen ? amount(a.brutto_rappen) : ''}" placeholder="z. B. 129.90" required></label>
      <label class="span">Beschreibung<input id="f-beschreibung" value="${esc(a.beschreibung || '')}" placeholder="z. B. 50 Polo-Shirts Grösse M" required></label>
      <label>Kategorie<select id="f-kategorie"><option value="">Bitte wählen …</option>${opt(kat.filter(k => k.art === 'ausgabe' && (k.aktiv || k.id === a.kategorie_id)).map(k => [k.id, k.name]), a.kategorie_id)}</select></label>
      <label>Lieferant<select id="f-lieferant"><option value="">– ohne –</option>${opt(lief.map(l => [l.id, l.name]), a.lieferant_id)}</select></label>
      ${pflichtig ? `<label>MWST-Satz (Vorsteuer)<select id="f-mwst">${opt(saetze.map(v => [v, v + ' %']), String(a.mwst_satz ?? s.bh_mwst_standard))}</select></label><p class="hint span" id="f-mwst-info"></p>` : ''}
      <label>Zahlungsart<select id="f-zahlungsart">${opt(ZAHLUNGSARTEN.map(z => [z, z]), a.zahlungsart)}</select></label>
      <label>Zahlungsstatus<select id="f-zahlung">${opt([['bezahlt', 'Bezahlt'], ['offen', 'Noch offen']], a.zahlung)}</select></label>
      <label>Bezahlt am<input type="date" id="f-bezahlt" value="${esc(a.bezahlt_am || '')}"></label>
      ${a.vorlage_id ? '<p class="hint span">Automatisch aus einer wiederkehrenden Ausgabe erfasst.</p>' : `<label>Wiederkehrend<select id="f-wiederkehrend">${opt([['', 'Nein, einmalig'], ['monatlich', 'Jeden Monat'], ['jaehrlich', 'Jedes Jahr']], a.wiederkehrend)}</select></label>`}
      <div class="span">${receiptField(a.beleg_id, a.beleg_name)}</div>
      <label class="span">Interne Notiz<textarea id="f-notiz" rows="2">${esc(a.notiz || '')}</textarea></label></div>
      ${pflichtig ? '' : '<p class="hint">ShirtBOX ist nicht MWST-pflichtig – Beträge werden ohne Vorsteuer erfasst (in den Einstellungen umschaltbar).</p>'}`;
    const done2 = formDialog(id ? `Ausgabe ${a.ref} bearbeiten` : 'Neue Ausgabe', body, 'Speichern', async () => {
      const data = {datum: val('f-datum'), betrag: val('f-betrag'), beschreibung: val('f-beschreibung'), kategorie_id: val('f-kategorie'), lieferant_id: val('f-lieferant'), mwst_satz: pflichtig ? val('f-mwst') : '0',
        zahlungsart: val('f-zahlungsart'), zahlung: val('f-zahlung'), bezahlt_am: val('f-bezahlt'), wiederkehrend: $('f-wiederkehrend') ? val('f-wiederkehrend') : '', beleg_id: val('f-beleg'), notiz: val('f-notiz')};
      if (id) await api('/api/bh/ausgaben/' + id, {method: 'PUT', body: data}); else { const r = await api('/api/bh/ausgaben', {method: 'POST', body: data}); toast(`Ausgabe ${r.ref} gespeichert.`); }
    }, true);
    bindReceipt();
    if (pflichtig) { const info = () => { const b = Number(val('f-betrag').replace(/[’'\s]/g, '').replace(',', '.')) || 0, sz = Number(val('f-mwst')) || 0, m = Math.round(b * 100 * sz * 100 / (10000 + sz * 100)); $('f-mwst-info').textContent = `Netto ${chf(b * 100 - m)} · MWST ${chf(m)} · Brutto ${chf(b * 100)}`; }; $('f-betrag').addEventListener('input', info); $('f-mwst').addEventListener('change', info); info(); }
    if ((await done2) && done) done();
  }
  PAGES['bh-ausgaben'] = async id => {
    if (id && id.startsWith('?')) { const p = new URLSearchParams(id); for (const k of ['zahlung', 'lieferant', 'kategorie']) if (p.has(k)) exState[k] = p.get(k); }
    const {kat, lief} = await lists();
    const load = async () => {
      const d = await api('/api/bh/ausgaben?' + query(exState));
      $('bh-liste').innerHTML = (d.ausgaben.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Beleg-Nr.</th><th>Beschreibung</th><th class="hide-mobile">Lieferant</th><th class="hide-mobile">Kategorie</th><th class="num">Betrag</th><th>Zahlung</th><th></th></tr></thead><tbody>
        ${d.ausgaben.map(a => `<tr class="${a.storniert ? 'bh-storno' : ''}"><td>${date(a.datum)}</td><td class="small">${a.ref}${a.beleg_id ? ` <a href="#" data-preview="${a.beleg_id}" title="${esc(a.beleg_name || 'Beleg')}">📎</a>` : ' <span class="muted" title="Kein Beleg">–</span>'}</td>
          <td><b>${esc(a.beschreibung)}</b>${a.wiederkehrend ? ` <span class="badge info">${a.wiederkehrend === 'monatlich' ? 'monatlich' : 'jährlich'}</span>` : ''}${a.storniert ? `<br><span class="small">Storniert: ${esc(a.storno_grund)}</span>` : ''}</td>
          <td class="hide-mobile">${esc(a.lieferant || '–')}</td><td class="hide-mobile small">${esc(a.kategorie)}</td><td class="num">${chf(a.brutto_rappen)}${a.mwst_rappen ? `<br><span class="muted small">MWST ${chf(a.mwst_rappen)}</span>` : ''}</td>
          <td>${a.storniert ? badge(ZUSTAND, 'storniert') : badge(ZUSTAND, a.zahlung)}<br><span class="muted small">${esc(a.zahlungsart || '')}</span></td>
          <td class="num">${a.storniert ? '' : `<button class="btn btn-small" data-edit="${a.id}">Bearbeiten</button> <button class="btn btn-small btn-danger" data-storno="${a.id}" title="Stornieren">✕</button>`}</td></tr>`).join('')}
        </tbody></table></div>${pager(d.total, exState.seite)}<p class="muted small">Summe (ohne Stornos): <b>${chf(d.summe)}</b></p>` : '<p class="empty">Keine Ausgaben gefunden. Mit „＋ Neue Ausgabe“ erfassen.</p>')
        + (d.vorlagen ? `<p class="small" style="margin-top:12px">🔁 ${d.vorlagen} wiederkehrende Ausgabe(n) hinterlegt. <button class="btn btn-small" id="bh-wk">Für ${new Intl.DateTimeFormat('de-CH', {month: 'long', year: 'numeric'}).format(new Date())} erfassen</button></p>` : '');
      bindPager($('bh-liste'), exState, load);
      $('bh-liste').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => expenseForm(b.dataset.edit, load)));
      $('bh-liste').querySelectorAll('[data-storno]').forEach(b => b.addEventListener('click', () => stornoDialog('Ausgabe', `/api/bh/ausgaben/${b.dataset.storno}/storno`, load)));
      $('bh-wk')?.addEventListener('click', async () => { try { const r = await api('/api/bh/ausgaben/wiederkehrend', {method: 'POST', body: {monat: today().slice(0, 7)}}); toast(r.neu ? `${r.neu} Ausgabe(n) erfasst (Status: offen).` : 'Für diesen Monat ist schon alles erfasst.'); load(); } catch (e) { failed(e); } });
    };
    after(() => { bindFilters(exState, load); load().catch(failed); });
    const exp = `/api/bh/export/ausgaben.csv?${query({von: exState.von, bis: exState.bis})}`;
    return `<div class="page-head"><div><h1>Ausgaben</h1><p class="muted">Stornieren statt löschen: Stornierte Ausgaben bleiben sichtbar, zählen aber nicht.</p></div><div class="actions"><a class="btn" href="${exp}">⬇ Excel/CSV</a><button class="btn btn-main" data-quick="ausgabe">＋ Neue Ausgabe</button></div></div>
      <div class="card"><div class="filters">
        <label class="grow">Suchen<input type="search" data-filter="q" value="${esc(exState.q)}" placeholder="Beschreibung, Lieferant oder Notiz"></label>
        <label>Von<input type="date" data-filter="von" value="${esc(exState.von)}"></label><label>Bis<input type="date" data-filter="bis" value="${esc(exState.bis)}"></label>
        <label>Kategorie<select data-filter="kategorie"><option value="">Alle</option>${opt(kat.filter(k => k.art === 'ausgabe').map(k => [k.id, k.name]), exState.kategorie)}</select></label>
        <label>Lieferant<select data-filter="lieferant"><option value="">Alle</option>${opt(lief.map(l => [l.id, l.name]), exState.lieferant)}</select></label>
        <label>Zahlung<select data-filter="zahlung"><option value="">Alle</option>${opt([['bezahlt', 'Bezahlt'], ['offen', 'Offen']], exState.zahlung)}</select></label>
        <label>Stornierte<select data-filter="storniert">${opt([['', 'ausblenden'], ['1', 'anzeigen']], exState.storniert)}</select></label>
      </div><div id="bh-liste"><p class="loading">Wird geladen …</p></div></div>`;
  };

  // ---- Einnahmen ----
  const inState = {q: '', von: '', bis: '', zahlungsart: '', quelle: '', storniert: '', seite: 1};
  async function incomeForm(id, done, current) {
    const {kat} = await lists().catch(e => { failed(e); return {}; }); if (!kat) return;
    const e = current || {datum: today(), zahlungsart: 'TWINT'};
    const body = `<p class="hint">Zahlungen zu Bestellungen bitte unter <a href="#/bh-zahlungen">Zahlungen</a> erfassen – sie erscheinen hier automatisch. Hier nur andere Einnahmen (z. B. Barverkauf am Turnier).</p><div class="form-grid">
      <label>Datum<input type="date" id="f-datum" value="${esc(e.datum)}"></label><label>Betrag in CHF<input id="f-betrag" inputmode="decimal" value="${e.betrag_rappen ? amount(e.betrag_rappen) : ''}" placeholder="z. B. 89.00"></label>
      <label class="span">Beschreibung<input id="f-beschreibung" value="${esc(e.beschreibung || '')}"></label>
      <label>Kunde (optional)<input id="f-kunde" value="${esc(e.kunde || '')}"></label>
      <label>Kategorie<select id="f-kategorie"><option value="">Bitte wählen …</option>${opt(kat.filter(k => k.art === 'einnahme' && (k.aktiv || k.id === e.kategorie_id)).map(k => [k.id, k.name]), e.kategorie_id)}</select></label>
      <label>Zahlungsart<select id="f-zahlungsart">${opt(ZAHLUNGSARTEN.map(z => [z, z]), e.zahlungsart)}</select></label>
      <label>Bestellnummer (optional)<input id="f-bestellung" value="${esc(e.bestellnummer || '')}" placeholder="SB-…"></label>
      <div class="span">${receiptField(e.beleg_id, e.beleg_name)}</div><label class="span">Interne Notiz<textarea id="f-notiz" rows="2">${esc(e.notiz || '')}</textarea></label></div>`;
    const p = formDialog(id ? `Einnahme ${e.ref} bearbeiten` : 'Neue Einnahme', body, 'Speichern', async () => {
      const data = {datum: val('f-datum'), betrag: val('f-betrag'), beschreibung: val('f-beschreibung'), kunde: val('f-kunde'), kategorie_id: val('f-kategorie'), zahlungsart: val('f-zahlungsart'), bestellnummer: val('f-bestellung'), beleg_id: val('f-beleg'), notiz: val('f-notiz')};
      if (id) await api('/api/bh/einnahmen/' + id, {method: 'PUT', body: data}); else { const r = await api('/api/bh/einnahmen', {method: 'POST', body: data}); toast(`Einnahme ${r.ref} gespeichert.`); }
    }, true);
    bindReceipt();
    if ((await p) && done) done();
  }
  PAGES['bh-einnahmen'] = async () => {
    let rows = [];
    const load = async () => {
      const d = await api('/api/bh/einnahmen?' + query(inState)); rows = d.einnahmen;
      $('bh-liste').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Beleg-Nr.</th><th>Beschreibung</th><th class="hide-mobile">Kunde</th><th class="hide-mobile">Kategorie</th><th class="num">Betrag</th>${d.einnahmen.some(x => x.mwst_rappen) ? '<th class="num hide-mobile">MWST</th>' : ''}<th class="hide-mobile">Zahlungsart</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((x, i) => `<tr class="${x.status === 'storniert' ? 'bh-storno' : ''}"><td>${date(x.datum)}</td><td class="small">${x.ref}${x.beleg_id ? ` <a href="#" data-preview="${x.beleg_id}">📎</a>` : ''}</td>
          <td><b>${esc(x.beschreibung)}</b>${x.quelle === 'bestellung' ? ` <a class="badge accent" href="#/bestellungen/${x.bestellung_id}" title="Automatisch aus der Bestellung übernommen">🔗 aus Bestellung</a>` : ''}${x.storno_grund ? `<br><span class="small">Storniert: ${esc(x.storno_grund)}</span>` : ''}</td>
          <td class="hide-mobile">${esc(x.kunde || '–')}</td><td class="hide-mobile small">${esc(x.kategorie || '')}</td><td class="num"><span class="${x.betrag_rappen < 0 ? 'neg' : ''}">${chf(x.betrag_rappen)}</span></td>${d.einnahmen.some(r => r.mwst_rappen) ? `<td class="num hide-mobile">${chf(x.mwst_rappen)}</td>` : ''}
          <td class="hide-mobile">${esc(x.zahlungsart || '')}</td><td>${badge(ZUSTAND, x.status)}</td>
          <td class="num">${x.quelle === 'manuell' && x.status !== 'storniert' ? `<button class="btn btn-small" data-edit="${i}">Bearbeiten</button> <button class="btn btn-small btn-danger" data-storno="${x.id}" title="Stornieren">✕</button>` : x.quelle === 'bestellung' ? '<span class="muted small">unter Zahlungen</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>${pager(d.total, inState.seite)}<p class="muted small">Summe (ohne Stornos): <b>${chf(d.summe)}</b></p>` : '<p class="empty">Keine Einnahmen im gewählten Zeitraum.</p>';
      bindPager($('bh-liste'), inState, load);
      $('bh-liste').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { const x = rows[Number(b.dataset.edit)]; incomeForm(x.id, load, x); }));
      $('bh-liste').querySelectorAll('[data-storno]').forEach(b => b.addEventListener('click', () => stornoDialog('Einnahme', `/api/bh/einnahmen/${b.dataset.storno}/storno`, load)));
    };
    after(() => { bindFilters(inState, load); load().catch(failed); });
    return `<div class="page-head"><div><h1>Einnahmen</h1><p class="muted">Zahlungseingänge zu Bestellungen erscheinen automatisch (🔗) und sind hier schreibgeschützt – geändert werden sie unter Zahlungen.</p></div><div class="actions"><a class="btn" href="/api/bh/export/einnahmen.csv?${query({von: inState.von, bis: inState.bis})}">⬇ Excel/CSV</a><button class="btn btn-main" data-quick="einnahme">＋ Neue Einnahme</button></div></div>
      <div class="card"><div class="filters"><label class="grow">Suchen<input type="search" data-filter="q" value="${esc(inState.q)}" placeholder="Beschreibung, Kunde, Bestellung oder Beleg-Nr."></label>
        <label>Von<input type="date" data-filter="von" value="${esc(inState.von)}"></label><label>Bis<input type="date" data-filter="bis" value="${esc(inState.bis)}"></label>
        <label>Zahlungsart<select data-filter="zahlungsart"><option value="">Alle</option>${opt(ZAHLUNGSARTEN.map(z => [z, z]), inState.zahlungsart)}</select></label>
        <label>Herkunft<select data-filter="quelle">${opt([['', 'Alle'], ['bestellung', 'Aus Bestellungen'], ['manuell', 'Manuell erfasst']], inState.quelle)}</select></label>
        <label>Stornierte<select data-filter="storniert">${opt([['', 'ausblenden'], ['1', 'anzeigen']], inState.storniert)}</select></label></div><div id="bh-liste"><p class="loading">Wird geladen …</p></div></div>`;
  };

  // ---- Zahlungen und offene Beträge ----
  const payState = {status: 'offen', q: '', seite: 1};
  function paymentForm(o, done, refund) {
    formDialog(refund ? `Rückerstattung zu ${o.bestellnummer}` : `Zahlung zu ${o.bestellnummer} erfassen`, `<p class="muted small">${esc(o.vorname)} ${esc(o.nachname)} · Total ${chf(o.total_rappen)} · bezahlt ${chf(o.bezahlt)} · offen <b>${chf(o.offen)}</b></p>
      <div class="form-grid"><label>Datum<input type="date" id="f-datum" value="${today()}" max="${today()}"></label><label>Betrag in CHF<input id="f-betrag" inputmode="decimal" value="${amount(refund ? o.bezahlt - o.erstattet : o.offen)}"></label>
      <label>Zahlungsart<select id="f-zahlungsart">${opt(ZAHLUNGSARTEN.map(z => [z, z]), 'TWINT')}</select></label><label>Notiz (optional)<input id="f-notiz" placeholder="${refund ? 'z. B. Reklamation, Teilrückerstattung' : 'z. B. TWINT-Mitteilung'}"></label></div>
      ${refund ? '' : '<p class="hint">Weniger als der offene Betrag = Teilzahlung. Die Bestellung wird automatisch auf „Teilweise bezahlt“ bzw. „Bezahlt“ gesetzt.</p>'}`, refund ? 'Rückerstattung buchen' : 'Zahlung buchen', async () => {
      const r = await api('/api/bh/zahlungen', {method: 'POST', body: {bestellung_id: o.id, datum: val('f-datum'), betrag: val('f-betrag'), zahlungsart: val('f-zahlungsart'), notiz: val('f-notiz'), art: refund ? 'rueckerstattung' : 'zahlung'}});
      toast(`Gebucht – Bestellung jetzt: ${(ZAHLUNG[r.zahlung] || [r.zahlung])[0]}.`);
    }).then(ok => ok && done());
  }
  PAGES['bh-zahlungen'] = async () => {
    let list = [];
    const load = async () => {
      const d = await api('/api/bh/zahlungen?' + query(payState)); list = d.bestellungen;
      $('bh-zahlen').innerHTML = `${kpi('Offen', chf(d.zahlen.offen_rappen), `${d.zahlen.offen} Bestellung(en)`, 'highlight')}${kpi('Überfällig', chf(d.zahlen.ueberfaellig_rappen), `${d.zahlen.ueberfaellig} Bestellung(en) · Frist ${d.frist} Tage`, d.zahlen.ueberfaellig ? 'alert' : '')}${kpi('Teilweise bezahlt', d.zahlen.teilweise)}`;
      $('bh-uebernahme').innerHTML = d.ohne_buchung ? `<div class="card bh-warn"><p>ℹ️ <b>${d.ohne_buchung} Bestellung(en)</b> sind als bezahlt bzw. rückerstattet markiert, haben aber noch keine Zahlungsbuchung (aus der Zeit vor der Buchhaltung). <button class="btn btn-small" id="bh-uebernehmen">Kontrolliert übernehmen</button></p></div>` : '';
      $('bh-liste').innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Bestellung</th><th>Kunde</th><th class="hide-mobile">Datum</th><th class="num">Total</th><th class="num">Bezahlt</th><th class="num">Offen</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((o, i) => `<tr><td><a href="#/bestellungen/${o.id}"><b>${esc(o.bestellnummer)}</b></a>${o.rechnung_nr ? `<br><a class="small" href="#/bh-rechnungen/${o.rechnung_id}">${esc(o.rechnung_nr)}</a>` : ''}</td><td>${esc(o.vorname)} ${esc(o.nachname)}</td><td class="hide-mobile">${date(o.datum)}<br><span class="muted small">fällig ${date(o.faellig)}</span></td>
          <td class="num">${chf(o.total_rappen)}${o.gutgeschrieben ? `<br><span class="muted small">Gutschrift −${chf(o.gutgeschrieben)}</span>` : ''}</td><td class="num">${chf(o.bezahlt)}${o.erstattet ? `<br><span class="neg small">−${chf(o.erstattet)} erstattet</span>` : ''}</td><td class="num"><b>${chf(o.offen)}</b></td>
          <td>${badge(ZUSTAND, o.ueberfaellig ? 'ueberfaellig' : o.zustand)}${o.status === 'storniert' ? '<br><span class="badge">Bestellung storniert</span>' : ''}</td>
          <td class="num">${o.offen > 0 ? `<button class="btn btn-small btn-main" data-pay="${i}">Zahlung erfassen</button>` : ''} ${o.bezahlt - o.erstattet > 0 ? `<button class="btn btn-small" data-refund="${i}">Rückerstattung</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>${pager(d.total, payState.seite)}` : '<p class="empty">Keine Bestellungen in dieser Ansicht.</p>';
      $('bh-buchungen').innerHTML = d.zahlungen.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Nr.</th><th>Bestellung</th><th class="num">Betrag</th><th class="hide-mobile">Art</th><th class="hide-mobile">Notiz</th><th></th></tr></thead><tbody>
        ${d.zahlungen.map(z => `<tr class="${z.storniert ? 'bh-storno' : ''}"><td>${date(z.datum)}</td><td class="small">${z.ref}</td><td><a href="#/bestellungen/${z.bestellung_id}">${esc(z.bestellnummer)}</a></td><td class="num"><span class="${z.betrag_rappen < 0 ? 'neg' : ''}">${chf(z.betrag_rappen)}</span></td>
          <td class="hide-mobile small">${esc(z.zahlungsart || '')}${z.quelle !== 'manuell' ? ' · automatisch' : ''}</td><td class="hide-mobile small">${esc(z.storniert ? 'Storniert: ' + (z.storno_grund || '') : z.notiz || '')}</td>
          <td class="num">${z.storniert ? '' : `<button class="btn btn-small btn-danger" data-zstorno="${z.id}" title="Stornieren">✕</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Noch keine Zahlungen gebucht.</p>';
      bindPager($('bh-liste'), payState, load);
      content.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => paymentForm(list[Number(b.dataset.pay)], load)));
      content.querySelectorAll('[data-refund]').forEach(b => b.addEventListener('click', () => paymentForm(list[Number(b.dataset.refund)], load, true)));
      content.querySelectorAll('[data-zstorno]').forEach(b => b.addEventListener('click', () => stornoDialog('Zahlung', `/api/bh/zahlungen/${b.dataset.zstorno}/storno`, load)));
      $('bh-uebernehmen')?.addEventListener('click', async () => {
        if (!await confirmDialog(`<h2>Bisherige Zahlungen übernehmen?</h2><p>Für ${d.ohne_buchung} Bestellung(en) wird je eine Zahlung über den Bestellbetrag gebucht (Datum = „bezahlt am“). Bei rückerstatteten Bestellungen zusätzlich die Rückerstattung. Bereits gebuchte Bestellungen werden nicht doppelt erfasst.</p>`, 'Übernehmen')) return;
        try { const r = await api('/api/bh/zahlungen/uebernehmen', {method: 'POST'}); toast(`${r.anzahl} Bestellung(en) übernommen.`); load(); } catch (e) { failed(e); }
      });
    };
    after(() => { bindFilters(payState, load); load().catch(failed); });
    return `<div class="page-head"><div><h1>Zahlungen</h1><p class="muted">Eine Bestellung gilt erst als bezahlt, wenn die Zahlung hier (oder in der Bestellung mit „Bezahlt“) gebucht ist.</p></div><div class="actions"><a class="btn" href="/api/bh/export/offene-posten.csv">⬇ Offene Posten (CSV)</a></div></div>
      <div class="grid kpis" id="bh-zahlen"></div><div id="bh-uebernahme"></div>
      <div class="card"><div class="filters"><label class="grow">Suchen<input type="search" data-filter="q" value="${esc(payState.q)}" placeholder="Bestellnummer, Name oder E-Mail"></label>
        <label>Ansicht<select data-filter="status">${opt([['offen', 'Offen (inkl. teilweise)'], ['ueberfaellig', 'Überfällig'], ['teilweise', 'Teilweise bezahlt'], ['bezahlt', 'Bezahlt'], ['rueckerstattet', 'Rückerstattet'], ['alle', 'Alle Bestellungen']], payState.status)}</select></label></div>
        <div id="bh-liste"><p class="loading">Wird geladen …</p></div></div>
      <div class="card"><h2>Letzte Buchungen</h2><div id="bh-buchungen"></div></div>`;
  };

  // ---- Rechnungen ----
  const invState = {q: '', status: '', seite: 1};
  PAGES['bh-rechnungen'] = async id => {
    if (id === 'neu') return invoiceNew();
    if (id && /^\d+$/.test(id)) return invoiceDetail(id);
    const load = async () => {
      const d = await api('/api/bh/rechnungen?' + query(invState));
      $('bh-liste').innerHTML = d.rechnungen.length ? `<div class="table-wrap"><table><thead><tr><th>Nummer</th><th>Datum</th><th>Kunde</th><th class="hide-mobile">Bestellung</th><th class="num">Betrag</th><th class="num hide-mobile">Offen</th><th>Status</th></tr></thead><tbody>
        ${d.rechnungen.map(r => `<tr class="click" data-href="#/bh-rechnungen/${r.id}"><td><b>${esc(r.nummer)}</b></td><td>${date(r.datum)}${r.art === 'rechnung' ? `<br><span class="muted small">fällig ${date(r.faellig)}</span>` : ''}</td><td>${esc(r.kunde)}</td><td class="hide-mobile">${esc(r.bestellnummer || '–')}</td>
          <td class="num">${r.art === 'gutschrift' ? '−' : ''}${chf(r.betrag_rappen)}</td><td class="num hide-mobile">${r.offen_rappen ? chf(r.offen_rappen) : '–'}</td><td>${badge(ZUSTAND, r.zustand)}</td></tr>`).join('')}</tbody></table></div>${pager(d.total, invState.seite)}`
        : '<p class="empty">Noch keine Rechnungen. Mit „🧾 Rechnung erstellen“ für eine Bestellung erzeugen.</p>';
      bindPager($('bh-liste'), invState, load);
    };
    after(() => { bindFilters(invState, load); load().catch(failed); });
    return `<div class="page-head"><div><h1>Rechnungen</h1><p class="muted">Fortlaufende Nummern, die nie verändert werden. Falsche Rechnungen werden storniert, Teilrückerstattungen als Gutschrift erfasst.</p></div><div class="actions"><a class="btn" href="/api/bh/export/rechnungen.csv">⬇ Excel/CSV</a><a class="btn btn-main" href="#/bh-rechnungen/neu">🧾 Rechnung erstellen</a></div></div>
      <div class="card"><div class="filters"><label class="grow">Suchen<input type="search" data-filter="q" value="${esc(invState.q)}" placeholder="Rechnungsnummer, Bestellung oder Kunde"></label>
        <label>Status<select data-filter="status">${opt([['', 'Alle'], ['offen', 'Offen'], ['ueberfaellig', 'Überfällig'], ['teilweise', 'Teilweise bezahlt'], ['bezahlt', 'Bezahlt'], ['gutschrift', 'Gutschriften'], ['storniert', 'Storniert']], invState.status)}</select></label></div>
        <div id="bh-liste"><p class="loading">Wird geladen …</p></div></div>`;
  };
  async function invoiceNew() {
    const d = await api('/api/bh/rechnungen/kandidaten');
    after(() => content.querySelectorAll('[data-create]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await api('/api/bh/rechnungen', {method: 'POST', body: {bestellung_id: Number(b.dataset.create)}}); toast(r.vorhanden ? 'Für diese Bestellung gibt es schon eine Rechnung.' : `Rechnung ${r.nummer} erstellt.`); location.hash = '#/bh-rechnungen/' + r.id; }
      catch (e) { failed(e); b.disabled = false; }
    })));
    return `<div class="page-head"><div><a href="#/bh-rechnungen">← Rechnungen</a><h1>Rechnung erstellen</h1><p class="muted">Bestellung wählen – Positionen, Kunde und Betrag werden aus der Bestellung übernommen. Pro Bestellung gibt es genau eine Rechnung.</p></div></div>
      <div class="card">${d.bestellungen.length ? `<div class="table-wrap"><table><thead><tr><th>Bestellung</th><th>Kunde</th><th>Datum</th><th class="num">Betrag</th><th></th></tr></thead><tbody>${d.bestellungen.map(o => `<tr><td><b>${esc(o.bestellnummer)}</b></td><td>${esc(o.vorname)} ${esc(o.nachname)}</td><td>${date(o.datum)}</td><td class="num">${chf(o.total_rappen)}</td><td class="num"><button class="btn btn-small btn-main" data-create="${o.id}">Rechnung erstellen</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Alle Bestellungen haben bereits eine Rechnung.</p>'}</div>`;
  }
  async function invoiceDetail(id) {
    const d = await api('/api/bh/rechnungen/' + id), r = d.rechnung, x = r.daten, z = d.zahlung, gs = r.art === 'gutschrift';
    after(() => {
      $('inv-print').addEventListener('click', () => window.print());
      $('inv-storno')?.addEventListener('click', () => stornoDialog(gs ? 'Gutschrift' : 'Rechnung', `/api/bh/rechnungen/${id}/storno`, render));
      $('inv-gs')?.addEventListener('click', () => formDialog(`Gutschrift zu ${r.nummer}`, `<p class="hint">Für Teilrückerstattungen, Rabatte im Nachhinein oder Reklamationen. Die Gutschrift reduziert den Umsatz und den offenen Betrag. Geld zurückzahlen: danach unter Zahlungen „Rückerstattung“ buchen.</p>
        <div class="form-grid"><label>Betrag in CHF<input id="f-betrag" inputmode="decimal"></label><label>Grund<input id="f-grund" placeholder="z. B. Druckfehler Design 2"></label></div>`, 'Gutschrift erstellen', async () => {
        const g = await api(`/api/bh/rechnungen/${id}/gutschrift`, {method: 'POST', body: {betrag: val('f-betrag'), grund: val('f-grund')}}); toast(`Gutschrift ${g.nummer} erstellt.`); location.hash = '#/bh-rechnungen/' + g.id;
      }));
    });
    const lines = x.positionen.map(p => `<tr><td>${esc(p.text)}</td><td class="num">${p.menge}</td><td class="num">${chf(p.betrag_rappen)}</td></tr>`).join('');
    const status = r.storniert ? `<span class="badge">Storniert: ${esc(r.storno_grund || '')}</span>` : gs ? badge(ZUSTAND, 'gutschrift') : z ? badge(ZUSTAND, z.ueberfaellig ? 'ueberfaellig' : z.zustand) : '';
    return `<div class="page-head no-print"><div><a href="#/bh-rechnungen">← Rechnungen</a><h1>${gs ? 'Gutschrift' : 'Rechnung'} ${esc(r.nummer)}</h1><p class="muted">${status}${r.bestellnummer ? ` · Bestellung <a href="#/bestellungen/${r.bestellung_id}">${esc(r.bestellnummer)}</a>` : ''}${z && !gs ? ` · bezahlt ${chf(z.bezahlt)} · offen ${chf(z.offen)}` : ''}</p></div>
      <div class="actions"><button class="btn btn-dark" id="inv-print">🖨 Drucken / als PDF speichern</button>${!gs && !r.storniert ? '<button class="btn" id="inv-gs">Gutschrift erstellen</button>' : ''}${r.storniert ? '' : '<button class="btn btn-danger" id="inv-storno">Stornieren</button>'}</div></div>
      ${d.gutschriften.length ? `<div class="card no-print"><p class="small">Gutschriften: ${d.gutschriften.map(g => `<a href="#/bh-rechnungen/${g.id}">${esc(g.nummer)}</a> (${chf(g.betrag_rappen)}${g.storniert ? ', storniert' : ''})`).join(', ')}</p></div>` : ''}
      <article class="invoice${r.storniert ? ' is-storno' : ''}">
        <header><div><img src="https://shirtbox.ch/shirtbox-icon.svg" alt="" width="44" height="44"><b>${esc(x.absender.firma)}</b><br>${x.absender.adresse.filter(l => l !== x.absender.firma).map(esc).join('<br>')}${x.absender.uid ? `<br>UID ${esc(x.absender.uid)}` : ''}${x.absender.mwst_nummer ? `<br>${esc(x.absender.mwst_nummer)} MWST` : ''}</div>
          <div class="to">${esc(x.empfaenger.name)}<br>${esc(x.empfaenger.strasse || '')}<br>${esc(x.empfaenger.ort || '')}${x.empfaenger.land && !/^(schweiz|ch)$/i.test(x.empfaenger.land) ? '<br>' + esc(x.empfaenger.land) : ''}</div></header>
        <h2>${gs ? 'Gutschrift' : 'Rechnung'} ${esc(r.nummer)}</h2>
        <dl class="facts"><dt>Datum</dt><dd>${date(r.datum)}</dd>${r.bestellnummer ? `<dt>Bestellung</dt><dd>${esc(r.bestellnummer)}</dd>` : ''}<dt>Kundennummer</dt><dd>${esc(x.empfaenger.kundennummer)}</dd>${gs && r.bezug_nummer ? `<dt>Zu Rechnung</dt><dd>${esc(r.bezug_nummer)}</dd>` : ''}</dl>
        <table><thead><tr><th>Beschreibung</th><th class="num">Menge</th><th class="num">Betrag</th></tr></thead><tbody>${lines}</tbody>
          <tfoot><tr><td colspan="2"><b>${gs ? 'Gutschrift total' : 'Total'}</b></td><td class="num"><b>${chf(r.betrag_rappen)}</b></td></tr>${x.mwst ? `<tr><td colspan="2">darin enthalten MWST ${x.mwst.satz} %</td><td class="num">${chf(x.mwst.betrag_rappen)}</td></tr>` : ''}</tfoot></table>
        <p>${x.mwst ? '' : 'Kein MWST-Ausweis (nicht mehrwertsteuerpflichtig). '}Alle Beträge in CHF.</p>
        ${gs ? '<p>Der Betrag wird Ihnen gutgeschrieben bzw. zurückerstattet.</p>' : z && z.zustand === 'bezahlt' ? `<p><b>Bezahlt</b>${z.letzte_zahlung ? ` am ${date(z.letzte_zahlung)}` : ''} – vielen Dank!</p>`
          : `<p>Zahlbar bis <b>${date(r.faellig)}</b> per TWINT an <b>${esc(x.twint)}</b> (Mitteilung: ${esc(r.bestellnummer || r.nummer)})${x.absender.iban ? ` oder per Überweisung auf IBAN <b>${esc(x.absender.iban.replace(/(.{4})/g, '$1 ').trim())}</b>${x.absender.bank ? ` (${esc(x.absender.bank)})` : ''}` : ''}.</p>`}
        <footer>${esc(x.absender.firma)} · info@shirtbox.ch · shirtbox.ch</footer>
      </article>`;
  }

  // ---- Belege ----
  const recState = {q: '', archiv: '', seite: 1};
  function preview(id) {
    const url = `/api/bh/belege/${id}/datei`;
    formDialog('Beleg', `<div class="bh-preview" id="bh-preview"><p class="loading">Wird geladen …</p></div><p><a class="btn btn-small" href="${url}?download=1">⬇ Herunterladen</a> <a class="btn btn-small" href="${url}" target="_blank" rel="noopener">In neuem Tab öffnen</a></p>`, null, null, true);
    fetch(url, {credentials: 'same-origin'}).then(r => r.ok ? r.headers.get('Content-Type') : Promise.reject()).then(type => {
      $('bh-preview').innerHTML = type === 'application/pdf' ? `<iframe src="${url}" title="Beleg-Vorschau"></iframe>` : `<img src="${url}" alt="Beleg">`;
    }).catch(() => { $('bh-preview').innerHTML = '<p class="error">Der Beleg konnte nicht geladen werden.</p>'; });
  }
  content.addEventListener('click', e => { const a = e.target.closest('[data-preview]'); if (a) { e.preventDefault(); preview(a.dataset.preview); } });
  PAGES['bh-belege'] = async () => {
    const load = async () => {
      const d = await api('/api/bh/belege?' + query(recState));
      $('bh-liste').innerHTML = d.belege.length ? `<div class="table-wrap"><table><thead><tr><th>Nr.</th><th>Datei</th><th class="hide-mobile">Hochgeladen</th><th>Verknüpft mit</th><th class="hide-mobile">Notiz</th><th></th></tr></thead><tbody>
        ${d.belege.map(b => { const links = [...b.ausgaben, ...b.einnahmen, ...b.rechnungen]; return `<tr><td class="small">${b.ref}</td><td><a href="#" data-preview="${b.id}"><b>${esc(b.dateiname)}</b></a><br><span class="muted small">${b.typ === 'application/pdf' ? 'PDF' : b.typ === 'image/png' ? 'PNG' : 'JPG'} · ${(b.groesse / 1024 / 1024).toFixed(1).replace('.', ',')} MB</span></td>
          <td class="hide-mobile">${time(b.hochgeladen)}</td><td class="small">${links.length ? links.map(esc).join(', ') : '<span class="badge warn">nicht verknüpft</span>'}</td><td class="hide-mobile small">${esc(b.archiviert ? 'Archiviert: ' + (b.archiv_grund || '') : b.notiz || '')}</td>
          <td class="num">${b.archiviert || links.length ? '' : `<button class="btn btn-small" data-archiv="${b.id}">Archivieren</button>`}</td></tr>`; }).join('')}</tbody></table></div>${pager(d.total, recState.seite)}` : '<p class="empty">Keine Belege.</p>';
      bindPager($('bh-liste'), recState, load);
      $('bh-liste').querySelectorAll('[data-archiv]').forEach(b => b.addEventListener('click', () => formDialog('Beleg archivieren?', '<p>Der Beleg wird ausgeblendet, aber nicht gelöscht (Aufbewahrungspflicht 10 Jahre). Nur nicht verknüpfte Belege können archiviert werden.</p><label>Grund<input id="s-grund" placeholder="z. B. Falsche Datei hochgeladen"></label>', 'Archivieren', async () => {
        await api(`/api/bh/belege/${b.dataset.archiv}/archiv`, {method: 'POST', body: {grund: val('s-grund')}}); toast('Archiviert.');
      }).then(ok => ok && load())));
    };
    after(() => { bindFilters(recState, load); load().catch(failed); });
    return `<div class="page-head"><div><h1>Belege</h1><p class="muted">Privat gespeichert, nur nach Anmeldung sichtbar. Belege werden nie gelöscht – höchstens archiviert.</p></div><div class="actions"><button class="btn btn-main" data-quick="beleg">⬆ Beleg hochladen</button></div></div>
      <div class="card"><div class="filters"><label class="grow">Suchen<input type="search" data-filter="q" value="${esc(recState.q)}" placeholder="Dateiname oder Notiz"></label><label>Ansicht<select data-filter="archiv">${opt([['', 'Aktive Belege'], ['1', 'Archiv']], recState.archiv)}</select></label></div>
        <div id="bh-liste"><p class="loading">Wird geladen …</p></div></div>`;
  };

  // ---- Lieferanten ----
  function supplierForm(l, done) {
    l = l || {};
    const f = (k, label, type = 'text', ph = '') => `<label${k === 'adresse' || k === 'notiz' ? ' class="span"' : ''}>${label}${k === 'adresse' || k === 'notiz' ? `<textarea id="l-${k}" rows="2">${esc(l[k] || '')}</textarea>` : `<input id="l-${k}" type="${type}" value="${esc(l[k] || '')}" placeholder="${esc(ph)}">`}</label>`;
    formDialog(l.id ? `${l.name} bearbeiten` : 'Neuer Lieferant', `<div class="form-grid">${f('name', 'Firmenname')}${f('kontakt', 'Kontaktperson')}${f('email', 'E-Mail', 'email')}${f('telefon', 'Telefon', 'tel')}${f('website', 'Website', 'url', 'https://…')}${f('adresse', 'Adresse')}${f('notiz', 'Notizen')}</div>`, 'Speichern', async () => {
      const body = Object.fromEntries(['name', 'kontakt', 'email', 'telefon', 'website', 'adresse', 'notiz'].map(k => [k, val('l-' + k)]));
      if (l.id) await api('/api/bh/lieferanten/' + l.id, {method: 'PUT', body}); else await api('/api/bh/lieferanten', {method: 'POST', body});
      toast('Lieferant gespeichert.');
    }, true).then(ok => ok && done());
  }
  PAGES['bh-lieferanten'] = async id => {
    if (id && /^\d+$/.test(id)) {
      const d = await api('/api/bh/lieferanten/' + id), l = d.lieferant;
      after(() => $('l-edit').addEventListener('click', () => supplierForm(l, render)));
      return `<div class="page-head"><div><a href="#/bh-lieferanten">← Lieferanten</a><h1>${esc(l.name)}</h1></div><div class="actions"><button class="btn" id="l-edit">Bearbeiten</button><a class="btn" href="#/bh-ausgaben/?lieferant=${l.id}">Alle Ausgaben</a></div></div>
        <div class="grid kpis">${kpi('Ausgaben total', chf(d.summen.total), `${d.summen.anzahl} Buchung(en)`)}${kpi('Laufendes Geschäftsjahr', chf(d.summen.jahr), `seit ${date(d.gj_start)}`, 'highlight')}</div>
        <div class="grid two"><div class="card"><h2>Kontakt</h2><dl class="facts"><dt>Kontaktperson</dt><dd>${esc(l.kontakt || '–')}</dd><dt>E-Mail</dt><dd>${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : '–'}</dd><dt>Telefon</dt><dd>${esc(l.telefon || '–')}</dd><dt>Adresse</dt><dd>${esc(l.adresse || '–').replace(/\n/g, '<br>')}</dd><dt>Website</dt><dd>${l.website ? `<a href="${esc(l.website)}" target="_blank" rel="noopener">${esc(l.website)}</a>` : '–'}</dd></dl>${l.notiz ? `<p class="small">${esc(l.notiz)}</p>` : ''}</div>
        <div class="card"><h2>Letzte Ausgaben und Belege</h2>${d.ausgaben.length ? `<div class="table-wrap"><table><tbody>${d.ausgaben.map(a => `<tr class="${a.storniert ? 'bh-storno' : ''}"><td>${date(a.datum)}</td><td>${esc(a.beschreibung)}<br><span class="muted small">${esc(a.kategorie || '')}</span></td><td class="num">${chf(a.brutto_rappen)}</td><td>${a.beleg_id ? `<a href="#" data-preview="${a.beleg_id}">📎 Beleg</a>` : '<span class="muted small">kein Beleg</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Noch keine Ausgaben.</p>'}</div></div>`;
    }
    const d = await api('/api/bh/lieferanten');
    after(() => $('l-neu').addEventListener('click', () => supplierForm(null, render)));
    return `<div class="page-head"><div><h1>Lieferanten</h1></div><div class="actions"><a class="btn" href="/api/bh/export/lieferanten.csv">⬇ Excel/CSV</a><button class="btn btn-main" id="l-neu">＋ Neuer Lieferant</button></div></div>
      <div class="card">${d.lieferanten.length ? `<div class="table-wrap"><table><thead><tr><th>Firma</th><th class="hide-mobile">Kontakt</th><th class="num">Ausgaben total</th><th class="num">Geschäftsjahr</th><th class="hide-mobile">Letzte Ausgabe</th></tr></thead><tbody>
        ${d.lieferanten.map(l => `<tr class="click" data-href="#/bh-lieferanten/${l.id}"><td><b>${esc(l.name)}</b></td><td class="hide-mobile">${esc(l.kontakt || '')}${l.email ? `<br><span class="muted small">${esc(l.email)}</span>` : ''}</td><td class="num">${chf(l.total)}</td><td class="num">${chf(l.jahr)}</td><td class="hide-mobile">${date(l.letzte)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Noch keine Lieferanten erfasst.</p>'}</div>`;
  };

  // ---- Auswertungen ----
  const repState = {von: '', bis: ''};
  PAGES['bh-auswertungen'] = async () => {
    const d = await api('/api/bh/auswertungen?' + query(repState)), e = d.ergebnis;
    if (!repState.von) { repState.von = d.von; repState.bis = d.bis; }
    after(() => {
      $('r-print').addEventListener('click', () => window.print());
      $('r-ok').addEventListener('click', () => { repState.von = val('r-von'); repState.bis = val('r-bis'); render(); });
      content.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { const y = Number(today().slice(0, 4)) - Number(b.dataset.range); repState.von = `${y}-01-01`; repState.bis = `${y}-12-31`; render(); }));
    });
    const qs = query({von: d.von, bis: d.bis}), mon = p => p.split('-').reverse().join('.');
    const table = (head, rows) => rows.length ? `<div class="table-wrap"><table><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="empty">Keine Daten im gewählten Zeitraum.</p>';
    const missing = d.deckungsbeitrag.filter(o => !o.vollstaendig).length;
    return `<div class="page-head"><div><h1>Auswertungen</h1>${SIMPLE}</div><div class="actions no-print"><button class="btn btn-dark" id="r-print" type="button">🖨 Drucken / PDF</button></div></div>
      <div class="card no-print"><div class="filters"><label>Von<input type="date" id="r-von" value="${esc(d.von)}"></label><label>Bis<input type="date" id="r-bis" value="${esc(d.bis)}"></label><button class="btn btn-main" id="r-ok" type="button">Anzeigen</button>
        <span class="seg"><button type="button" data-range="0">Dieses Jahr</button><button type="button" data-range="1">Letztes Jahr</button></span></div>
        <p class="small"><b>Export für den Treuhänder:</b> <a class="btn btn-small" href="/api/bh/export/journal.csv?${qs}">⬇ Journal (alle Geldflüsse)</a> <a class="btn btn-small" href="/api/bh/export/einnahmen.csv?${qs}">⬇ Einnahmen</a> <a class="btn btn-small" href="/api/bh/export/ausgaben.csv?${qs}">⬇ Ausgaben</a> <a class="btn btn-small" href="/api/bh/export/rechnungen.csv?${qs}">⬇ Rechnungen</a> <a class="btn btn-small" href="/api/bh/export/deckungsbeitrag.csv?${qs}">⬇ Deckungsbeiträge</a> <a class="btn btn-small" href="/api/bh/export/offene-posten.csv">⬇ Offene Posten</a></p>
        <p class="hint">CSV-Dateien öffnen sich direkt in Excel. Als PDF: Seite drucken und „Als PDF speichern“ wählen.</p></div>
      <p class="muted small">${date(d.von)} – ${date(d.bis)}</p>
      <div class="grid kpis">${kpi('Einnahmen', chf(e.einnahmen))}${kpi('Ausgaben', chf(e.ausgaben))}${kpi('Ergebnis', chf(e.ergebnis), 'Einnahmen − Ausgaben', 'highlight')}${kpi('Umsatz (Bestellwert)', chf(e.umsatz))}</div>
      <div class="grid two">
        <div class="card"><h2>Umsatz pro Monat</h2>${table(['Monat', 'Bestellungen', 'Shirts', 'Umsatz'], d.umsatz_monat.map(r => [mon(r.periode), r.anzahl, r.shirts, chf(r.summe)]))}</div>
        <div class="card"><h2>Umsatz pro Jahr</h2>${table(['Jahr', 'Bestellungen', 'Shirts', 'Umsatz'], d.umsatz_jahr.map(r => [r.periode, r.anzahl, r.shirts, chf(r.summe)]))}
          <h3 style="margin-top:16px">Einnahmen nach Kategorie</h3>${bars(d.einnahmen_kategorie)}<p class="hint">Umsatz nach Produkt (Polo/Zip) ist noch nicht möglich, weil das Shirt-Modell bei der Bestellung bisher nicht gespeichert wird.</p></div>
        <div class="card"><h2>Ausgaben pro Monat</h2>${table(['Monat', 'Buchungen', 'Ausgaben'], d.ausgaben_monat.map(r => [mon(r.periode), r.anzahl, chf(r.summe)]))}</div>
        <div class="card"><h2>Ausgaben nach Kategorie</h2>${bars(d.ausgaben_kategorie)}<h3 style="margin-top:16px">Ausgaben nach Lieferant</h3>${bars(d.ausgaben_lieferant)}</div>
      </div>
      <div class="card"><h2>Rentabilität: Deckungsbeitrag pro Bestellung</h2>
        <p class="muted small">Deckungsbeitrag = Nettoerlös − direkte Kosten der Bestellung. Das ist <b>nicht</b> der Unternehmensgewinn (dafür zählen auch Fixkosten wie Software, Werbung, Maschinen). ${missing ? `<span class="badge warn">${missing} Bestellung(en) mit fehlenden Kosten – Werte dort unvollständig</span>` : ''}</p>
        ${table(['Monat', 'Erlös netto', 'Direkte Kosten', 'Deckungsbeitrag', 'unvollständig'], d.deckungsbeitrag_monat.map(r => [mon(r.periode), chf(r.erloes), chf(r.kosten), chf(r.deckungsbeitrag), r.unvollstaendig || '–']))}
        <h3 style="margin-top:16px">Einzelne Bestellungen</h3>
        ${d.deckungsbeitrag.length ? `<div class="table-wrap"><table><thead><tr><th>Bestellung</th><th class="hide-mobile">Kunde</th><th class="num">Erlös netto</th><th class="num">Kosten</th><th class="num">Deckungsbeitrag</th><th class="num">Marge</th><th>Kosten</th></tr></thead><tbody>
          ${d.deckungsbeitrag.map(o => `<tr class="click" data-href="#/bestellungen/${o.id}"><td><b>${esc(o.bestellnummer)}</b><br><span class="muted small">${date(o.datum)} · ${o.anzahl} Shirt${o.anzahl === 1 ? '' : 's'}</span></td><td class="hide-mobile">${esc(o.kunde)}</td><td class="num">${chf(o.erloes_netto)}</td><td class="num">${chf(o.kosten_summe)}</td>
            <td class="num"><b>${o.vollstaendig ? '' : '≈ '}${chf(o.deckungsbeitrag)}</b></td><td class="num">${o.marge === null ? '–' : (o.vollstaendig ? '' : '≈ ') + o.marge.toLocaleString('de-CH') + ' %'}</td>
            <td>${o.vollstaendig ? '<span class="badge good">vollständig</span>' : `<span class="badge warn" title="${esc(o.fehlt.map(a => KOSTEN[a]).join(', '))}">fehlt: ${o.fehlt.length}</span>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Keine Bestellungen im Zeitraum.</p>'}</div>`;
  };

  // ---- Einstellungen ----
  PAGES['bh-einstellungen'] = async () => {
    const d = await api('/api/bh/einstellungen'), s = d.einstellungen;
    const field = (k, label, hint = '', type = 'text', extra = '') => `<label>${label}<input id="s-${k}" type="${type}" value="${esc(s[k] ?? '')}" ${extra}>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
    const money = k => s[k] === '' ? '' : amount(s[k]);
    after(() => {
      $('bh-set').addEventListener('submit', async e => {
        e.preventDefault();
        const keys = ['bh_firma', 'bh_uid', 'bh_mwst_nummer', 'bh_mwst_saetze', 'bh_mwst_standard', 'bh_zahlungsfrist', 'bh_iban', 'bh_bank', 'bh_gj_beginn', 'bh_rechnung_praefix', 'bh_gutschrift_praefix', 'bh_gesperrt_bis', 'bh_std_textilien', 'bh_std_druck', 'bh_std_verpackung', 'bh_std_versand', 'bh_std_gebuehren_prozent'];
        const body = Object.fromEntries(keys.map(k => [k, val('s-' + k)])); body.bh_mwst_pflichtig = $('s-bh_mwst_pflichtig').checked ? '1' : '0'; body.bh_preise = val('s-bh_preise');
        try { await api('/api/bh/einstellungen', {method: 'PUT', body}); toast('Einstellungen gespeichert.'); } catch (err) { failed(err); }
      });
      $('k-neu').addEventListener('click', () => formDialog('Neue Kategorie', `<div class="form-grid"><label>Art<select id="k-art">${opt([['ausgabe', 'Ausgabe'], ['einnahme', 'Einnahme']], 'ausgabe')}</select></label><label>Name<input id="k-name"></label></div>`, 'Anlegen', async () => {
        await api('/api/bh/kategorien', {method: 'POST', body: {art: val('k-art'), name: val('k-name')}}); toast('Kategorie angelegt.');
      }).then(ok => ok && render()));
      content.querySelectorAll('[data-kat]').forEach(b => b.addEventListener('click', () => {
        const k = d.kategorien.find(x => x.id === Number(b.dataset.kat));
        formDialog('Kategorie bearbeiten', `<label>Name<input id="k-name" value="${esc(k.name)}"></label><label class="check-row"><input type="checkbox" id="k-aktiv"${k.aktiv ? ' checked' : ''}> aktiv (in Formularen auswählbar)</label><p class="hint">Kategorien werden nie gelöscht, damit alte Buchungen ihre Kategorie behalten – nicht mehr benötigte einfach deaktivieren.</p>`, 'Speichern', async () => {
          await api('/api/bh/kategorien/' + k.id, {method: 'PATCH', body: {name: val('k-name'), aktiv: $('k-aktiv').checked}}); toast('Gespeichert.');
        }).then(ok => ok && render());
      }));
    });
    const kat = art => d.kategorien.filter(k => k.art === art).map(k => `<button type="button" class="chip${k.aktiv ? '' : ' off'}" data-kat="${k.id}">${esc(k.name)}${k.aktiv ? '' : ' (inaktiv)'}</button>`).join('');
    return `<div class="page-head"><div><h1>Buchhaltung · Einstellungen</h1><p class="muted">Firmenadresse und Absender werden aus den allgemeinen <a href="#/einstellungen">Einstellungen</a> übernommen (Feld „Absenderangaben“) – keine doppelte Erfassung.</p></div></div>
      <form id="bh-set"><div class="grid two">
        <div class="card"><h2>Firma und Rechnungen</h2>${field('bh_firma', 'Firmenname auf Rechnungen')}<p class="small muted">Adresse: ${esc(s.adresse || '–')}</p>${field('bh_uid', 'UID (optional)', 'z. B. CHE-123.456.789')}
          ${field('bh_iban', 'IBAN (optional)', 'Erscheint als zweite Zahlungsmöglichkeit auf Rechnungen.')}${field('bh_bank', 'Bank (optional)')}
          <div class="form-grid">${field('bh_rechnung_praefix', 'Präfix Rechnungen', 'RE-2026-0001')}${field('bh_gutschrift_praefix', 'Präfix Gutschriften', 'GS-2026-0001')}</div>
          ${field('bh_zahlungsfrist', 'Zahlungsfrist in Tagen', 'Danach gelten offene Bestellungen und Rechnungen als überfällig.', 'number', 'min="0" max="365"')}
          <label>Währung<input value="CHF" disabled></label></div>
        <div class="card"><h2>MWST</h2><label class="check-row"><input type="checkbox" id="s-bh_mwst_pflichtig"${s.bh_mwst_pflichtig === '1' ? ' checked' : ''}> ShirtBOX ist MWST-pflichtig</label>
          <p class="hint">Aktuell: ${s.bh_mwst_pflichtig === '1' ? 'pflichtig – MWST wird auf Rechnungen ausgewiesen und bei Ausgaben als Vorsteuer erfasst.' : 'nicht pflichtig (Pflicht ab CHF 100’000 Jahresumsatz). Rechnungen enthalten keinen MWST-Ausweis.'}</p>
          ${field('bh_mwst_nummer', 'MWST-Nummer', 'z. B. CHE-123.456.789 MWST')}${field('bh_mwst_saetze', 'MWST-Sätze in %', 'Normalsatz 8.1, reduziert 2.6, Beherbergung 3.8')}${field('bh_mwst_standard', 'Standardsatz in %')}
          <label>Preise<select id="s-bh_preise">${opt([['brutto', 'Bruttopreise (inkl. MWST)'], ['netto', 'Nettopreise (zzgl. MWST)']], s.bh_preise)}</select></label>
          <p class="hint">Hinweis: Die MWST-Abrechnung (effektive Methode oder Saldosteuersatz) bitte mit dem Treuhänder abstimmen – diese Übersicht ersetzt keine MWST-Abrechnung.</p></div>
        <div class="card"><h2>Geschäftsjahr und Abschluss</h2><label>Beginn des Geschäftsjahres<select id="s-bh_gj_beginn">${opt(Array.from({length: 12}, (_, i) => [String(i + 1), new Intl.DateTimeFormat('de-CH', {month: 'long'}).format(new Date(2026, i, 1))]), s.bh_gj_beginn)}</select></label>
          ${field('bh_gesperrt_bis', 'Buchungen abgeschlossen bis', 'Nach dem Jahresabschluss setzen: Buchungen bis zu diesem Datum können dann nicht mehr geändert werden (nur noch Korrekturen mit neuem Datum).', 'date')}</div>
        <div class="card"><h2>Standardkosten für den Deckungsbeitrag</h2><p class="hint">Werden mit einem Klick bei einer Bestellung eingesetzt, wenn dort noch keine Kosten erfasst sind. Leer = nicht verwenden.</p>
          <div class="form-grid"><label>T-Shirt-Einkauf pro Shirt (CHF)<input id="s-bh_std_textilien" inputmode="decimal" value="${money('bh_std_textilien')}"></label><label>Druck pro Shirt (CHF)<input id="s-bh_std_druck" inputmode="decimal" value="${money('bh_std_druck')}"></label>
          <label>Verpackung pro Bestellung (CHF)<input id="s-bh_std_verpackung" inputmode="decimal" value="${money('bh_std_verpackung')}"></label><label>Versand pro Bestellung (CHF)<input id="s-bh_std_versand" inputmode="decimal" value="${money('bh_std_versand')}"></label>
          <label>Zahlungsgebühren in % vom Betrag<input id="s-bh_std_gebuehren_prozent" inputmode="decimal" value="${esc(s.bh_std_gebuehren_prozent)}" placeholder="z. B. 1.3"></label></div></div>
      </div><p><button class="btn btn-main" type="submit">Einstellungen speichern</button></p></form>
      <div class="card"><h2>Kategorien <button class="btn btn-small" id="k-neu" type="button">＋ Neue Kategorie</button></h2><h3>Ausgaben</h3><div class="chips">${kat('ausgabe')}</div><h3 style="margin-top:14px">Einnahmen</h3><div class="chips">${kat('einnahme')}</div><p class="hint">Antippen zum Umbenennen oder Deaktivieren.</p></div>`;
  };

  // ---- Bestellung: Buchhaltungs-Karte (Zahlungen, Rechnung, Kosten und Deckungsbeitrag) ----
  const origOrders = PAGES.bestellungen;
  PAGES.bestellungen = async id => {
    const html = await origOrders(id);
    if (id && /^\d+$/.test(id)) after(() => orderCard(id).catch(failed));
    return html;
  };
  async function orderCard(id) {
    const box = document.createElement('div'); box.className = 'card no-print'; box.id = 'bh-order';
    const target = content.querySelector('.grid.two'); if (!target) return;
    target.after(box);
    const draw = async () => {
      const [k, p] = await Promise.all([api(`/api/bh/kosten/${id}`), api(`/api/bh/zahlungen/${id}`)]), c = k.rechnung, o = p.bestellung;
      const have = Object.fromEntries(k.kosten.map(x => [x.art, x]));
      box.innerHTML = `<h2>Buchhaltung</h2><div class="grid two">
        <div><h3>Zahlungen</h3><p>${badge(ZUSTAND, o.ueberfaellig ? 'ueberfaellig' : o.zustand)} Total ${chf(o.total_rappen)} · bezahlt <b>${chf(o.bezahlt)}</b> · offen <b>${chf(o.offen)}</b>${o.erstattet ? ` · erstattet ${chf(o.erstattet)}` : ''}</p>
          ${p.zahlungen.length ? `<table><tbody>${p.zahlungen.map(z => `<tr class="${z.storniert ? 'bh-storno' : ''}"><td>${date(z.datum)}</td><td class="small">${z.ref} · ${esc(z.zahlungsart || '')}</td><td class="num">${chf(z.betrag_rappen)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Noch keine Zahlung gebucht.</p>'}
          <p class="actions" style="margin-top:8px">${o.offen > 0 ? '<button class="btn btn-small btn-main" id="bo-pay">Zahlung / Teilzahlung erfassen</button>' : ''}${o.rechnung_id ? `<a class="btn btn-small" href="#/bh-rechnungen/${o.rechnung_id}">🧾 Rechnung ${esc(o.rechnung_nr)}</a>` : o.status !== 'storniert' ? '<button class="btn btn-small" id="bo-inv">🧾 Rechnung erstellen</button>' : ''}</p></div>
        <div><h3>Direkte Kosten und Deckungsbeitrag</h3><div class="form-grid">${Object.entries(KOSTEN).map(([a, l]) => `<label>${l}${['textilien', 'druck', 'verpackung', 'versand', 'gebuehren'].includes(a) && !have[a] ? ' <span class="badge warn">fehlt</span>' : ''}<input data-kost="${a}" inputmode="decimal" value="${have[a] ? amount(have[a].betrag_rappen) : ''}" placeholder="0.00"></label>`).join('')}</div>
          <p class="actions" style="margin-top:8px"><button class="btn btn-small btn-main" id="bo-save">Kosten speichern</button><button class="btn btn-small" id="bo-std">Standardkosten einsetzen</button></p>
          <dl class="facts"><dt>Erlös${k.mwst_pflichtig ? ' netto' : ''}</dt><dd>${chf(c.erloes_netto)}</dd><dt>Direkte Kosten</dt><dd>${chf(c.kosten_summe)}</dd><dt>Deckungsbeitrag</dt><dd><b>${c.vollstaendig ? '' : '≈ '}${chf(c.deckungsbeitrag)}</b>${c.marge !== null ? ` (${c.vollstaendig ? '' : '≈ '}${c.marge.toLocaleString('de-CH')} %)` : ''}</dd></dl>
          ${c.vollstaendig ? '' : `<p class="hint">⚠ Unvollständig – es fehlen: ${c.fehlt.map(a => KOSTEN[a]).join(', ')}. Kosten von 0 bitte als 0.00 eintragen.</p>`}<p class="hint">Nur zur Kalkulation – zählt nicht als Ausgabe (echte Einkäufe unter Ausgaben erfassen).</p></div></div>`;
      $('bo-pay')?.addEventListener('click', () => paymentForm(o, () => render()));
      $('bo-inv')?.addEventListener('click', async () => { try { const r = await api('/api/bh/rechnungen', {method: 'POST', body: {bestellung_id: Number(id)}}); toast(`Rechnung ${r.nummer || ''} erstellt.`); location.hash = '#/bh-rechnungen/' + r.id; } catch (e) { failed(e); } });
      $('bo-save').addEventListener('click', async () => {
        const kosten = {}; box.querySelectorAll('[data-kost]').forEach(i => { kosten[i.dataset.kost] = i.value.trim(); });
        try { await api(`/api/bh/kosten/${id}`, {method: 'PUT', body: {kosten}}); toast('Kosten gespeichert.'); draw().catch(failed); } catch (e) { failed(e); }
      });
      $('bo-std').addEventListener('click', async () => { try { await api(`/api/bh/kosten/${id}/standard`, {method: 'POST'}); toast('Standardkosten eingesetzt.'); draw().catch(failed); } catch (e) { failed(e); } });
    };
    box.innerHTML = '<p class="loading">Buchhaltung wird geladen …</p>';
    await draw();
  }
})();
