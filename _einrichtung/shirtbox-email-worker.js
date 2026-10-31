// ShirtBOX dedicated order-mail Worker. Deploy ONLY to shirtbox-email.
// Required secrets: RESEND_API_KEY, TURNSTILE_SECRET_KEY.
// Required KV binding: ORDER_KV (for duplicate protection).
// Optional (Verwaltung): D1 binding DB (shirtbox-verwaltung), R2 binding BILDER (shirtbox-bilder),
// secret RESEND_WEBHOOK_SECRET. Ohne DB/BILDER laufen Bestellungen unverändert weiter, es wird nur nichts gespeichert.
// Public site must configure Turnstile site key in bestellen.html.
const ALLOWED_SITES = new Set(['https://shirtbox.ch','https://www.shirtbox.ch']);
function headers(origin) {
  const h={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  if(ALLOWED_SITES.has(origin)) h['Access-Control-Allow-Origin']=origin;
  return h;
}
function reply(origin,status,error){return new Response(JSON.stringify({error}),{status,headers:headers(origin)});}
async function readBody(request,limit){
  const reader=request.body?.getReader(); if(!reader)throw Error('BODY');
  const chunks=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw Error('SIZE');}chunks.push(value);}
  const body=new Uint8Array(total);let pos=0;for(const chunk of chunks){body.set(chunk,pos);pos+=chunk.byteLength;}return body;
}
async function verifyTurnstile(token,request,env){
  // Leerzeichen und Anführungszeichen aus dem Dashboard-Eintrag entfernen.
  const secret = String(env.TURNSTILE_SECRET_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!secret) {
    console.error('Turnstile Diagnose: Secret fehlt');
    return {ok:false, reason:'secret-fehlt'};
  }
  if (typeof token !== 'string' || !token.trim()) {
    console.warn('Turnstile Diagnose: Token fehlt im Formular (cf-turnstile-response)');
    return {ok:false, reason:'token-fehlt'};
  }
  try {
    const form = new FormData();
    form.set('secret', secret);
    form.set('response', token);
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) form.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {method:'POST',body:form});
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Turnstile Diagnose: HTTP', res.status, errorText);
      let codes = '';
      try { codes = (JSON.parse(errorText)['error-codes'] || []).join(','); } catch {}
      return {ok:false, reason:`siteverify-http ${res.status} ${codes}`.trim()};
    }
    const data = await res.json();
    // Keine Tokens, IP-Adressen oder Secrets protokollieren.
    console.log('Turnstile Diagnose:', JSON.stringify({success:data.success,hostname:data.hostname,errors:data['error-codes']}));
    if (data.success !== true) return {ok:false, reason:(data['error-codes'] || []).join(',') || 'siteverify-abgelehnt'};
    if (data.hostname && !['shirtbox.ch','www.shirtbox.ch'].includes(data.hostname)) {
      console.warn('Turnstile Diagnose: unerwarteter Hostname',data.hostname);
      return {ok:false, reason:'hostname'};
    }
    return {ok:true};
  } catch (error) {
    console.error('Turnstile Diagnose: Anfrage fehlgeschlagen', String(error?.message || error));
    return {ok:false, reason:'netzwerkfehler'};
  }
}
export default {async fetch(request,env,ctx){
  const origin=request.headers.get('Origin')||'';const url=new URL(request.url),path=url.pathname;
  // Ohne Website-Herkunft: Abmeldung per Mailprogramm (One-Click), Resend-Webhook, öffentliche Newsletter-Bilder.
  if(path==='/newsletter/abmelden-direkt')return unsubscribeDirect(request,env,url);
  if(path==='/resend/webhook')return resendWebhook(request,env);
  if(path.startsWith('/bild/newsletter/'))return newsletterImage(request,env,path);  if(request.method==='OPTIONS' && ALLOWED_SITES.has(origin))return new Response(null,{status:204,headers:{...headers(origin),'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
  if(!ALLOWED_SITES.has(origin))return reply(origin,403,'Nicht freigegeben.');
  if(request.method!=='POST')return reply(origin,405,'Nur POST erlaubt.');
  if(path.startsWith('/newsletter/'))return newsletterRoute(request,env,origin,path);
  if(path!=='/bestaetigung')return reply(origin,404,'Nicht gefunden.');
  if(!env.RESEND_API_KEY||!env.TURNSTILE_SECRET_KEY||!env.ORDER_KV)return reply(origin,503,'Mail-Dienst noch nicht vollständig eingerichtet.');
  return orderConfirmation(request,env,origin,ctx);
}};

// ---------------------------------------------------------------------------
// Bestellbestätigung für Kundinnen und Kunden: gestaltete HTML-Mail mit Shirt-Bildern über Resend.
// Preise werden hier neu berechnet; der Browser liefert nur Grössen, Stückzahlen und Adressdaten.
const MAX_ORDER_BODY = 28 * 1024 * 1024;
const MAX_MAIL_IMAGE = 1.5 * 1024 * 1024, MAX_PRINT_FILE = 12 * 1024 * 1024;
const PRICE_FIRST = 8900, PRICE_MORE = 8010;
const ORDER_SIZE = {S:'L',M:'XL',L:'XXL',XL:'3XL',XXL:'4XL','3XL':'5XL','4XL':'6XL','5XL':'7XL'};
const TWINT = '079 915 48 24', WHATSAPP = '076 469 01 00', WHATSAPP_LINK = 'https://wa.me/41764690100';
const chf = cents => `CHF ${(cents / 100).toFixed(2)}`;
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';

function orderNumber() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('de-CH', {timeZone: 'Europe/Zurich', year: '2-digit', month: '2-digit', day: '2-digit'}).formatToParts(new Date()).map(p => [p.type, p.value]));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = [...crypto.getRandomValues(new Uint8Array(4))].map(n => alphabet[n % alphabet.length]).join('');
  return `SB-${parts.year}${parts.month}${parts.day}-${code}`;
}

function base64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Prüft die Angaben aus dem Browser und berechnet Stückzahlen und Beträge.
function readOrder(raw) {
  const data = JSON.parse(raw);
  const k = data?.kunde || {};
  const customer = {vorname: clean(k.vorname, 80), nachname: clean(k.nachname, 80), email: clean(k.email, 254), telefon: clean(k.telefon, 40), strasse: clean(k.strasse, 120), plz: clean(k.plz, 20), ort: clean(k.ort, 100), land: clean(k.land, 80)};
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(customer.email)) throw Error('E-Mail-Adresse ungültig.');
  if (['vorname', 'nachname', 'strasse', 'plz', 'ort', 'land'].some(key => !customer[key])) throw Error('Adresse unvollständig.');
  if (!Array.isArray(data.designs) || data.designs.length < 1 || data.designs.length > 20) throw Error('Keine Designs.');
  let firstUsed = false, quantity = 0;
  const designs = data.designs.map((design, index) => {
    const seen = new Set();
    const rows = (Array.isArray(design.groessen) ? design.groessen : []).slice(0, 8).map(row => {
      const size = String(row.groesse), count = Number(row.anzahl);
      if (!ORDER_SIZE[size] || seen.has(size) || !Number.isInteger(count) || count < 1 || count > 100) throw Error('Grössen ungültig.');
      seen.add(size); return {size, ordered: ORDER_SIZE[size], count};
    });
    if (!rows.length) throw Error('Grösse fehlt.');
    const count = rows.reduce((sum, row) => sum + row.count, 0);
    const first = firstUsed ? 0 : 1; firstUsed = true; quantity += count;
    return {number: Number.isInteger(design.nummer) && design.nummer > 0 && design.nummer < 1000 ? design.nummer : index + 1, rows, count, subtotal: first * PRICE_FIRST + (count - first) * PRICE_MORE,
      rights: design.rechte === true, placement: typeof design.platzierung === 'string' ? design.platzierung.replace(/\r/g, '').slice(0, 4000).trim() : ''};
  });
  if (quantity > 200) throw Error('Zu viele Shirts.');
  return {customer, designs, quantity, total: PRICE_FIRST + (quantity - 1) * PRICE_MORE, agb: clean(data.agb, 80),
    newsletter: data.newsletter === true, newsletterText: clean(data.newsletter_text, 400)};
}

// E-Mail-taugliches HTML: Tabellen-Layout, Inline-Styles, Bilder als cid-Anhänge.
function buildOrderMail(order, number, imageIds) {
  const {customer: c, designs, quantity, total} = order;
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const designBlocks = designs.map((d, i) => `
<tr><td style="padding:0 0 22px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e6e1d6;border-radius:16px;background:#fbfaf7">
    ${imageIds[i] ? `<tr><td style="padding:12px 12px 0"><img src="cid:${imageIds[i]}" width="512" alt="Design ${d.number}: Vorder- und Rückseite" style="display:block;width:100%;max-width:512px;height:auto;border:0;border-radius:12px;background:#747474"></td></tr>` : ''}
    <tr><td style="padding:14px 18px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        <td style="${font}font-size:17px;font-weight:bold;color:#090c13">Design ${d.number}</td>
        <td align="right" style="${font}font-size:16px;font-weight:bold;color:#090c13">${chf(d.subtotal)}</td>
      </tr>
      ${d.rows.map(r => `<tr><td colspan="2" style="${font}font-size:14px;color:#3d4554;padding-top:6px">Grösse <b>${r.size}</b> · ${r.count} Stück <span style="color:#8a909c;font-size:12.5px">(asiatische Grösse ${r.ordered})</span></td></tr>`).join('')}
      </table>
    </td></tr>
  </table>
</td></tr>`).join('');
  const more = quantity - 1;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Ihre ShirtBOX-Bestellung ${number}</title></head>
<body style="margin:0;padding:0;background:#ece8e0">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Danke für Ihre Bestellung ${number} – jetzt ${chf(total)} per TWINT an ${TWINT} bezahlen.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ece8e0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:22px;overflow:hidden">
  <tr><td style="background:#090c13;padding:26px 32px 22px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td style="${font}font-size:26px;font-weight:900;letter-spacing:-1px;color:#f4f1ea">shirt<span style="color:#ff6a2b">box</span><span style="font-size:15px;font-weight:bold;color:#7d8796">.ch</span></td>
      <td align="right" style="${font}font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#ffb48f">Bestellbestätigung</td>
    </tr></table>
  </td></tr>
  <tr><td style="height:5px;line-height:5px;font-size:0;background:#ff5b2e;background-image:linear-gradient(90deg,#ff3d2e,#ff7a2b,#ffb43a)">&nbsp;</td></tr>
  <tr><td style="padding:34px 32px 8px">
    <h1 style="${font}margin:0 0 10px;font-size:28px;line-height:1.15;color:#090c13">Vielen Dank, ${esc(c.vorname)}! 🎉</h1>
    <p style="${font}margin:0;font-size:16px;line-height:1.55;color:#3d4554">Ihre Bestellung ist bei uns eingegangen. Wir freuen uns darauf, Ihre Shirts für Sie anzufertigen.</p>
    <p style="${font}margin:14px 0 0;font-size:14px;color:#3d4554">Bestellnummer: <b style="color:#090c13">${number}</b></p>
  </td></tr>
  <tr><td style="padding:24px 32px 8px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#090c13;border-radius:18px">
      <tr><td style="padding:22px 24px">
        <p style="${font}margin:0 0 4px;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#ffb48f">Jetzt bezahlen</p>
        <p style="${font}margin:0 0 10px;font-size:34px;font-weight:900;letter-spacing:-1px;color:#ffffff">${chf(total)}</p>
        <p style="${font}margin:0;font-size:15px;line-height:1.55;color:#d9dde4">per <b style="color:#ffffff">TWINT</b> an <b style="color:#ffffff">${TWINT}</b> (ShirtBOX)<br>Bitte als Mitteilung angeben: <b style="color:#ff9a6e">${number}</b></p>
      </td></tr>
    </table>
    <p style="${font}margin:10px 4px 0;font-size:12.5px;color:#8a909c">Die Anfertigung startet nach Zahlungseingang.</p>
  </td></tr>
  <tr><td style="padding:26px 32px 4px"><h2 style="${font}margin:0 0 14px;font-size:19px;color:#090c13">Ihre Shirts</h2></td></tr>
  <tr><td style="padding:0 32px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${designBlocks}</table></td></tr>
  <tr><td style="padding:0 32px 8px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="${font}font-size:14.5px;color:#3d4554">
      <tr><td style="padding:6px 0">1 Shirt à CHF 89.00</td><td align="right" style="padding:6px 0">CHF 89.00</td></tr>
      ${more ? `<tr><td style="padding:6px 0">${more} weitere${more === 1 ? 's' : ''} Shirt${more === 1 ? '' : 's'} à CHF 80.10 <span style="color:#1f9d61">(−10 %)</span></td><td align="right" style="padding:6px 0">${chf(more * PRICE_MORE)}</td></tr>` : ''}
      <tr><td style="padding:6px 0">Versand</td><td align="right" style="padding:6px 0;color:#1f9d61">inklusive</td></tr>
      <tr><td style="padding:12px 0 0;border-top:2px solid #090c13;font-size:17px;font-weight:bold;color:#090c13">Total (${quantity} Shirt${quantity === 1 ? '' : 's'})</td><td align="right" style="padding:12px 0 0;border-top:2px solid #090c13;font-size:17px;font-weight:bold;color:#090c13">${chf(total)}</td></tr>
      <tr><td colspan="2" style="padding:4px 0 0;font-size:12px;color:#8a909c">inkl. Mehrwertsteuer und Versand</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:26px 32px 4px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td valign="top" width="50%" style="${font}font-size:14px;line-height:1.55;color:#3d4554;padding-right:12px">
        <p style="margin:0 0 6px;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#8a909c">Lieferadresse</p>
        ${esc(c.vorname)} ${esc(c.nachname)}<br>${esc(c.strasse)}<br>${esc(c.plz)} ${esc(c.ort)}<br>${esc(c.land)}
      </td>
      <td valign="top" width="50%" style="${font}font-size:14px;line-height:1.55;color:#3d4554">
        <p style="margin:0 0 6px;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#8a909c">Kontakt</p>
        ${esc(c.email)}${c.telefon ? `<br>${esc(c.telefon)}` : ''}
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:26px 32px 6px">
    <h2 style="${font}margin:0 0 12px;font-size:19px;color:#090c13">So geht es weiter</h2>
    ${[['1', 'Mit TWINT bezahlen', `${chf(total)} an ${TWINT}, Mitteilung ${number}`], ['2', 'Wir fertigen Ihre Shirts', 'Jedes Shirt wird einzeln für Sie bedruckt.'], ['3', 'Lieferung zu Ihnen', 'In ca. 14 Tagen (± einige Tage) nach Zahlungseingang.']].map(([n, t, s]) => `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 10px"><tr>
      <td width="40" valign="top"><div style="${font}width:30px;height:30px;line-height:30px;border-radius:15px;background:#ff5b2e;color:#090c13;font-size:14px;font-weight:bold;text-align:center">${n}</div></td>
      <td style="${font}font-size:14.5px;line-height:1.45;color:#3d4554"><b style="color:#090c13">${t}</b><br>${s}</td>
    </tr></table>`).join('')}
  </td></tr>
  <tr><td style="padding:18px 32px 30px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;border-radius:16px"><tr><td style="${font}padding:18px 20px;font-size:14px;line-height:1.55;color:#3d4554">
      <b style="color:#090c13">Fragen zu Ihrer Bestellung?</b><br>
      Schreiben Sie uns per <a href="${WHATSAPP_LINK}" style="color:#e2481f;font-weight:bold;text-decoration:none">WhatsApp</a> oder antworten Sie einfach auf diese E-Mail.
    </td></tr></table>
  </td></tr>
  <tr><td style="background:#090c13;padding:20px 32px;${font}font-size:12px;line-height:1.6;color:#7d8796">
    Diese E-Mail bestätigt den Eingang Ihrer Bestellung, nicht den Zahlungseingang.<br>© ${new Date().getFullYear()} ShirtBOX.ch · <a href="https://shirtbox.ch" style="color:#ff9a6e;text-decoration:none">shirtbox.ch</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [`Vielen Dank, ${c.vorname}!`, '', `Ihre Bestellung ${number} ist bei uns eingegangen.`, '',
    `JETZT BEZAHLEN: ${chf(total)} per TWINT an ${TWINT} (ShirtBOX), Mitteilung: ${number}`, 'Die Anfertigung startet nach Zahlungseingang.', '',
    'IHRE SHIRTS', ...designs.map(d => `Design ${d.number}: ${d.rows.map(r => `Grösse ${r.size} × ${r.count} (asiatische Grösse ${r.ordered})`).join(', ')} – ${chf(d.subtotal)}`), '',
    `Total (${quantity} Shirt${quantity === 1 ? '' : 's'}): ${chf(total)} inkl. MwSt. und Versand`, '',
    'LIEFERADRESSE', `${c.vorname} ${c.nachname}`, c.strasse, `${c.plz} ${c.ort}`, c.land, '',
    'Lieferung in ca. 14 Tagen (± einige Tage) nach Zahlungseingang.', `Fragen? WhatsApp oder Antwort auf diese E-Mail.`, '',
    'Diese E-Mail bestätigt den Eingang Ihrer Bestellung, nicht den Zahlungseingang.', 'ShirtBOX.ch'].join('\n');
  return {html, text};
}

// Interne Arbeitsmail für ShirtBOX: offene Zahlung, Kunde, Lieferanten-Bestellliste, Bilder, Druckhinweise.
function buildShopMail(order, number, imageIds, printNames, originalNames) {
  const {customer: c, designs, quantity, total} = order;
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const digits = c.telefon.replace(/\D/g, '');
  const label = t => `<p style="${font}margin:0 0 6px;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#8a909c">${t}</p>`;
  const link = (href, t) => `<a href="${href}" style="color:#e2481f;font-weight:bold;text-decoration:none">${t}</a>`;
  const supplierRows = designs.flatMap(d => d.rows.map(r => `<tr>
      <td style="${font}padding:9px 10px;border-bottom:1px solid #e6e1d6;font-size:14px">Design ${d.number}</td>
      <td style="${font}padding:9px 10px;border-bottom:1px solid #e6e1d6;font-size:14px;color:#6b7280">${r.size}</td>
      <td style="${font}padding:9px 10px;border-bottom:1px solid #e6e1d6;font-size:16px;font-weight:bold;color:#090c13">${r.ordered}</td>
      <td align="right" style="${font}padding:9px 10px;border-bottom:1px solid #e6e1d6;font-size:16px;font-weight:bold;color:#090c13">${r.count}×</td></tr>`)).join('');
  const designBlocks = designs.map((d, i) => `
  <tr><td style="padding:0 0 18px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e6e1d6;border-radius:14px;background:#fbfaf7">
      ${imageIds[i] ? `<tr><td style="padding:10px 10px 0"><img src="cid:${imageIds[i]}" width="516" alt="Design ${d.number}" style="display:block;width:100%;max-width:516px;height:auto;border:0;border-radius:10px;background:#747474"></td></tr>` : ''}
      <tr><td style="${font}padding:12px 16px 14px;font-size:14px;line-height:1.55;color:#3d4554">
        <b style="font-size:16px;color:#090c13">Design ${d.number}</b> · ${d.count} Shirt${d.count === 1 ? '' : 's'} · ${chf(d.subtotal)}<br>
        ${d.rows.map(r => `Kunde ${r.size} → <b style="color:#090c13">bestellen ${r.ordered}</b> × ${r.count}`).join('<br>')}<br>
        <span style="color:${printNames[i] ? '#1f9d61' : '#c42b1c'}">${printNames[i] ? `📎 Druckdatei: ${esc(printNames[i])}` : '⚠ Druckdatei fehlt'}</span>
        ${originalNames[i]?.length ? `<br><span style="color:#1f9d61">📎 Originalbilder: ${originalNames[i].map(esc).join(', ')}</span>` : ''}
        <br><span style="color:${d.rights ? '#1f9d61' : '#c42b1c'}">${d.rights ? '✓ Bildrechte bestätigt' : '⚠ Bildrechte nicht bestätigt'}</span>
        ${d.placement ? `<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#f1eee7;font-size:12.5px;white-space:pre-wrap;color:#3d4554"><b>Platzierung / Einstellungen</b><br>${esc(d.placement)}</div>` : ''}
      </td></tr>
    </table>
  </td></tr>`).join('');
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Neue Bestellung ${number}</title></head>
<body style="margin:0;padding:0;background:#ece8e0">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${quantity} Shirt${quantity === 1 ? '' : 's'} · ${chf(total)} · ${esc(c.vorname)} ${esc(c.nachname)}, ${esc(c.ort)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ece8e0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:22px;overflow:hidden">
  <tr><td style="background:#090c13;padding:24px 28px 20px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td style="${font}font-size:24px;font-weight:900;letter-spacing:-1px;color:#f4f1ea">shirt<span style="color:#ff6a2b">box</span><span style="font-size:14px;font-weight:bold;color:#7d8796">.ch</span></td>
      <td align="right" style="${font}font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#ffb48f">Neue Bestellung</td>
    </tr></table>
    <p style="${font}margin:16px 0 0;font-size:30px;font-weight:900;letter-spacing:-1px;color:#ffffff">${chf(total)} <span style="font-size:15px;font-weight:bold;color:#aab2c0">· ${quantity} Shirt${quantity === 1 ? '' : 's'} · ${designs.length} Design${designs.length === 1 ? '' : 's'}</span></p>
    <p style="${font}margin:4px 0 0;font-size:14px;color:#ff9a6e;font-weight:bold">${number}</p>
  </td></tr>
  <tr><td style="height:5px;line-height:5px;font-size:0;background:#ff5b2e;background-image:linear-gradient(90deg,#ff3d2e,#ff7a2b,#ffb43a)">&nbsp;</td></tr>
  <tr><td style="padding:22px 28px 6px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff4d6;border:1px solid #f1d58a;border-radius:14px"><tr><td style="${font}padding:14px 18px;font-size:14.5px;line-height:1.5;color:#5c4605">
      <b>⏳ Zahlung offen:</b> ${chf(total)} per TWINT an ${TWINT}<br>Mitteilung des Kunden sollte <b>${number}</b> lauten. Erst nach Zahlungseingang produzieren.
    </td></tr></table>
  </td></tr>
  <tr><td style="padding:18px 28px 4px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td valign="top" width="50%" style="${font}font-size:14.5px;line-height:1.6;color:#3d4554;padding-right:12px">
        ${label('Kunde')}<b style="color:#090c13">${esc(c.vorname)} ${esc(c.nachname)}</b><br>
        ${link(`mailto:${esc(c.email)}?subject=${encodeURIComponent('Ihre ShirtBOX-Bestellung ' + number)}`, esc(c.email))}<br>
        ${digits ? `${link(`tel:+${digits}`, esc(c.telefon))}<br>${link(`https://wa.me/${digits}`, 'WhatsApp schreiben')}` : ''}
      </td>
      <td valign="top" width="50%" style="${font}font-size:14.5px;line-height:1.6;color:#3d4554">
        ${label('Lieferadresse')}${esc(c.vorname)} ${esc(c.nachname)}<br>${esc(c.strasse)}<br>${esc(c.plz)} ${esc(c.ort)}<br>${esc(c.land)}
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:22px 28px 6px">
    <h2 style="${font}margin:0 0 4px;font-size:18px;color:#090c13">Beim Lieferanten bestellen</h2>
    <p style="${font}margin:0 0 10px;font-size:12.5px;color:#8a909c">Asiatische Grössen: automatisch zwei Grössen grösser als vom Kunden gewählt.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e6e1d6;border-radius:12px;border-collapse:separate;overflow:hidden">
      <tr style="background:#090c13">
        <td style="${font}padding:8px 10px;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#aab2c0">Design</td>
        <td style="${font}padding:8px 10px;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#aab2c0">Kunde</td>
        <td style="${font}padding:8px 10px;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#ffb48f">Bestellen</td>
        <td align="right" style="${font}padding:8px 10px;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#aab2c0">Stück</td>
      </tr>${supplierRows}
      <tr><td colspan="3" style="${font}padding:10px;font-size:14px;font-weight:bold;color:#090c13">Total</td><td align="right" style="${font}padding:10px;font-size:16px;font-weight:bold;color:#090c13">${quantity}×</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:22px 28px 4px"><h2 style="${font}margin:0 0 12px;font-size:18px;color:#090c13">Designs &amp; Druckdateien</h2></td></tr>
  <tr><td style="padding:0 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${designBlocks}</table></td></tr>
  <tr><td style="${font}padding:4px 28px 24px;font-size:13px;line-height:1.6;color:#3d4554">
    ${order.agb ? `✓ AGB akzeptiert (${esc(order.agb)})<br>` : '⚠ AGB-Zustimmung fehlt<br>'}
    <span style="color:#8a909c">Tipp: „Antworten“ schreibt direkt an ${esc(c.email)}.</span>
  </td></tr>
  <tr><td style="background:#090c13;padding:16px 28px;${font}font-size:12px;color:#7d8796">ShirtBOX.ch · interne Bestellmeldung</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [`NEUE BESTELLUNG ${number}`, `${chf(total)} · ${quantity} Shirts · Zahlung offen (TWINT ${TWINT})`, '',
    `Kunde: ${c.vorname} ${c.nachname}, ${c.email}, ${c.telefon}`, `Lieferadresse: ${c.strasse}, ${c.plz} ${c.ort}, ${c.land}`, '',
    'BEIM LIEFERANTEN BESTELLEN', ...designs.flatMap(d => d.rows.map(r => `Design ${d.number}: Kunde ${r.size} -> bestellen ${r.ordered} × ${r.count}`)), `Total: ${quantity}`, '',
    ...designs.map((d, i) => `Design ${d.number}: Druckdatei ${printNames[i] || 'FEHLT'}${originalNames[i]?.length ? `; Originale: ${originalNames[i].join(', ')}` : ''}${d.placement ? `\n${d.placement}` : ''}`), '',
    `AGB: ${order.agb || 'FEHLT'}`].join('\n');
  return {html, text};
}

async function sendMail(env, mail) {
  const response = await fetch('https://api.resend.com/emails', {method: 'POST', headers: {Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json'}, signal: AbortSignal.timeout(25000),
    body: JSON.stringify({from: env.MAIL_FROM || 'ShirtBOX <bestellung@shirtbox.ch>', ...mail})});
  return response.ok;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const extension = type => type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';

// Ablauf: zuerst die interne Mail (mit Druckdateien), dann die Kundenmail.
// Antwort {bestellnummer, kunde}: Ohne interne Mail -> Fehler, die Website nimmt dann FormSubmit.
async function orderConfirmation(request, env, origin, ctx) {
  if (request.method !== 'POST') return reply(origin, 405, 'Bitte eine Bestellung senden.');
  if (!env.RESEND_API_KEY) return reply(origin, 503, 'Der Mailversand ist noch nicht eingerichtet.');
  if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data')) return reply(origin, 415, 'Ungültige Anfrage.');
  let form, order;
  try {
    const body = await readBody(request, MAX_ORDER_BODY);
    form = await new Request(request.url, {method: 'POST', headers: {'Content-Type': request.headers.get('Content-Type')}, body}).formData();
    const raw = form.get('bestellung');
    if (typeof raw !== 'string' || raw.length > 60000) throw Error('Bestellung fehlt.');
    order = readOrder(raw);
  } catch (e) { return reply(origin, e.message === 'SIZE' ? 413 : 400, 'Die Bestellangaben sind unvollständig oder ungültig.'); }
  const token = form.get('cf-turnstile-response');
  const turnstile = await verifyTurnstile(token,request,env);
  if (!turnstile.ok) return reply(origin,403,`Sicherheitsprüfung fehlgeschlagen (${turnstile.reason}). Bitte Sicherheitsprüfung erneuern.`);
  const clientId=form.get('bestell-id');
  if(typeof clientId!=='string'||!/^[a-f0-9-]{36}$/.test(clientId))return reply(origin,400,'Bestellkennung fehlt.');
  const key='order:'+clientId;
  const existing=await env.ORDER_KV.get(key,'json');
  if(existing?.status==='sent')return new Response(JSON.stringify(existing.result),{headers:headers(origin)});
  if(existing?.status==='pending')return reply(origin,409,'Diese Bestellung wird bereits verarbeitet. Bitte warten.');
  await env.ORDER_KV.put(key,JSON.stringify({status:'pending'}),{expirationTtl:600});
  const number = orderNumber(), shop = env.SHOP_EMAIL || 'r-n@gmx.ch', contact = env.CONTACT_EMAIL || 'info@shirtbox.ch';
  const inline = [], imageIds = [], prints = [], printNames = [], originals = [], originalNames = [], files = [];
  for (let i = 0; i < order.designs.length; i++) {
    const d = order.designs[i], image = form.get(`bild_${i}`), print = form.get(`druck_${i}`), stored = {originals: []};
    if (image && typeof image !== 'string' && image.size && image.size <= MAX_MAIL_IMAGE && IMAGE_TYPES.includes(image.type)) {
      const buffer = await image.arrayBuffer(); stored.preview = {buffer, type: image.type};
      inline.push({filename: `vorschau-design-${d.number}.${extension(image.type)}`, content: base64(buffer), content_id: `design-${i + 1}`});
      imageIds.push(`design-${i + 1}`);
    } else imageIds.push('');
    if (print && typeof print !== 'string' && print.size && print.size <= MAX_PRINT_FILE && IMAGE_TYPES.includes(print.type)) {
      const name = `${number}-design-${d.number}.${extension(print.type)}`, buffer = await print.arrayBuffer(); stored.print = {buffer, type: print.type, name};
      prints.push({filename: name, content: base64(buffer)}); printNames.push(name);
    } else printNames.push('');
    const names = [];
    for (const [j, file] of form.getAll(`original_${i}`).entries()) {
      if (typeof file === 'string' || !file.size || file.size > MAX_PRINT_FILE || !IMAGE_TYPES.includes(file.type)) continue;
      const name = `${number}-design-${d.number}-original-${j + 1}.${extension(file.type)}`, buffer = await file.arrayBuffer(); stored.originals.push({buffer, type: file.type, name});
      originals.push({filename: name, content: base64(buffer)}); names.push(name);
    }
    originalNames.push(names); files.push(stored);
  }
  const customerName = `${order.customer.vorname} ${order.customer.nachname}`;
  try {
    const internal = buildShopMail(order, number, imageIds, printNames, originalNames);
    const sent = await sendMail(env, {to: [shop], reply_to: order.customer.email, subject: `🛒 Neue Bestellung ${number} – ${chf(order.total)} – ${customerName}`, ...internal, attachments: [...inline, ...prints, ...originals]});
    if (!sent) { await env.ORDER_KV.delete(key); return reply(origin, 502, 'Die Bestellung konnte nicht versendet werden.'); }
  } catch { await env.ORDER_KV.delete(key); return reply(origin, 504, 'Die Bestellung konnte nicht versendet werden.'); }
  let kunde = false;
  try {
    const confirmation = buildOrderMail(order, number, imageIds);
    kunde = await sendMail(env, {to: [order.customer.email], reply_to: contact, subject: `Ihre ShirtBOX-Bestellung ${number} – ${chf(order.total)}`, ...confirmation, attachments: inline});
  } catch {}
  const result={bestellnummer:number,kunde,total:order.total/100};
  await env.ORDER_KV.put(key,JSON.stringify({status:'sent',result}),{expirationTtl:86400*14});
  // Verwaltung: Speichern läuft nach der Antwort weiter. Ein Fehler hier betrifft nie die Bestellung selbst.
  if (env.DB) ctx?.waitUntil((async () => {
    try { await saveOrder(env, order, number, clientId, files); } catch (e) { console.error('Verwaltung: Bestellung nicht gespeichert', String(e?.message || e)); }
    if (order.newsletter) try { await subscribe(env, {email: order.customer.email, vorname: order.customer.vorname, nachname: order.customer.nachname, quelle: `Bestellung ${number}`, text: order.newsletterText || NEWSLETTER_TEXT_ORDER}); } catch (e) { console.error('Verwaltung: Newsletter-Anmeldung fehlgeschlagen', String(e?.message || e)); }
  })());
  return new Response(JSON.stringify(result),{headers:headers(origin)});
}

// ---------------------------------------------------------------------------
// Verwaltung: Kunden und Bestellungen in D1 speichern, Bilder in R2.
const zurichDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);

async function putImage(env, key, file) {
  if (!env.BILDER || !file) return null;
  await env.BILDER.put(key, file.buffer, {httpMetadata: {contentType: file.type}});
  return key;
}

async function saveOrder(env, order, number, clientId, files) {
  const now = new Date().toISOString(), c = order.customer;
  const customer = await env.DB.prepare(`INSERT INTO kunden (email, vorname, nachname, telefon, strasse, plz, ort, land, erste_bestellung, aktualisiert)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
    ON CONFLICT(email) DO UPDATE SET vorname = excluded.vorname, nachname = excluded.nachname, telefon = COALESCE(NULLIF(excluded.telefon, ''), kunden.telefon),
      strasse = excluded.strasse, plz = excluded.plz, ort = excluded.ort, land = excluded.land, aktualisiert = excluded.aktualisiert
    RETURNING id`).bind(c.email.toLowerCase(), c.vorname, c.nachname, c.telefon || null, c.strasse, c.plz, c.ort, c.land, now).first();
  const address = JSON.stringify({vorname: c.vorname, nachname: c.nachname, strasse: c.strasse, plz: c.plz, ort: c.ort, land: c.land, email: c.email, telefon: c.telefon});
  const saved = await env.DB.prepare(`INSERT OR IGNORE INTO bestellungen (bestellnummer, client_id, kunde_id, erstellt, datum, anzahl, total_rappen, versand_rappen, lieferadresse, agb)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?) RETURNING id`).bind(number, clientId, customer.id, now, zurichDay(), order.quantity, order.total, address, order.agb || null).first();
  if (!saved) return; // bereits gespeichert
  for (const [i, d] of order.designs.entries()) {
    const f = files[i] || {originals: []}, base = `bestellungen/${number}/design-${d.number}`;
    const preview = await putImage(env, `${base}-vorschau.${extension(f.preview?.type)}`, f.preview);
    const print = await putImage(env, `${base}-druck.${extension(f.print?.type)}`, f.print);
    const originalKeys = [];
    for (const [j, o] of f.originals.entries()) { const k = await putImage(env, `${base}-original-${j + 1}.${extension(o.type)}`, o); if (k) originalKeys.push(k); }
    const design = await env.DB.prepare(`INSERT INTO bestell_designs (bestellung_id, design_nr, anzahl, einzelpreis_rappen, summe_rappen, farbe, details, bild_vorschau, bild_druck, bilder_original, rechte)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(saved.id, d.number, d.count, i === 0 ? PRICE_FIRST : PRICE_MORE, d.subtotal,
      'Rundum-Druck gemäss Design', d.placement || null, preview, print, originalKeys.length ? JSON.stringify(originalKeys) : null, d.rights ? 1 : 0).first();
    await env.DB.batch(d.rows.map(r => env.DB.prepare('INSERT INTO bestell_groessen (design_id, groesse, bestellgroesse, anzahl) VALUES (?, ?, ?, ?)').bind(design.id, r.size, r.ordered, r.count)));
  }
}

// ---------------------------------------------------------------------------
// Newsletter: Anmeldung mit Double-Opt-in, Bestätigung, Abmeldung, Zustellmeldungen von Resend.
const SITE = 'https://shirtbox.ch';
const NEWSLETTER_TEXT_ORDER = 'Ja, ich möchte den ShirtBOX-Newsletter mit Neuigkeiten, Aktionen und Angeboten per E-Mail erhalten. Ich kann mich jederzeit wieder abmelden.';
const NEWSLETTER_TEXT_HOME = 'Anmeldung zum ShirtBOX-Newsletter (Neuigkeiten, Aktionen und Angebote per E-Mail) auf der Startseite. Abmeldung jederzeit möglich.';
const EMAIL_PATTERN = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
const ok = (origin, data) => new Response(JSON.stringify(data), {headers: headers(origin)});

async function newsletterRoute(request, env, origin, path) {
  if (!env.DB) return reply(origin, 503, 'Der Newsletter ist noch nicht eingerichtet.');
  let data;
  try { const raw = new TextDecoder().decode(await readBody(request, 20000)); data = JSON.parse(raw); } catch { return reply(origin, 400, 'Ungültige Anfrage.'); }
  if (path === '/newsletter/anmelden') {
    if (data.website) return ok(origin, {status: 'gesendet'}); // Honigtopf: Bots erhalten scheinbar Erfolg
    const email = clean(data.email, 254).toLowerCase(), vorname = clean(data.vorname, 80), nachname = clean(data.nachname, 80);
    if (!EMAIL_PATTERN.test(email)) return reply(origin, 400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
    if (!vorname) return reply(origin, 400, 'Bitte Ihren Vornamen eingeben.');
    const turnstile = await verifyTurnstile(data.turnstile, request, env);
    if (!turnstile.ok) return reply(origin, 403, 'Sicherheitsprüfung fehlgeschlagen. Bitte erneut versuchen.');
    return ok(origin, {status: await subscribe(env, {email, vorname, nachname, quelle: 'Startseite', text: NEWSLETTER_TEXT_HOME})});
  }
  const token = clean(data.token, 80);
  if (!/^[a-f0-9]{48}$/.test(token)) return reply(origin, 400, 'Der Link ist ungültig.');
  if (path === '/newsletter/bestaetigen') return ok(origin, {status: await confirmSubscription(env, token)});
  if (path === '/newsletter/abmelden') return ok(origin, {status: await unsubscribe(env, token)});
  return reply(origin, 404, 'Nicht gefunden.');
}

// Legt eine Anmeldung an (Status "ausstehend") und schickt den Bestätigungslink. Aktive Abonnenten bleiben unverändert.
async function subscribe(env, {email, vorname, nachname, quelle, text}) {
  email = email.toLowerCase();
  const now = new Date(), iso = now.toISOString();
  const existing = await env.DB.prepare('SELECT status, token, bestaetigung_gesendet FROM abonnenten WHERE email = ?').bind(email).first();
  if (existing?.status === 'aktiv') return 'bereits';
  if (existing?.status === 'ausstehend' && existing.bestaetigung_gesendet && now - new Date(existing.bestaetigung_gesendet) < 10 * 60000) return 'gesendet';
  const token = existing?.token || randomToken();
  await env.DB.prepare(`INSERT INTO abonnenten (email, vorname, nachname, status, angemeldet, einwilligung_quelle, einwilligung_text, bestaetigung_gesendet, token)
    VALUES (?1, ?2, ?3, 'ausstehend', ?4, ?5, ?6, ?4, ?7)
    ON CONFLICT(email) DO UPDATE SET vorname = excluded.vorname, nachname = COALESCE(NULLIF(excluded.nachname, ''), abonnenten.nachname), status = 'ausstehend',
      angemeldet = excluded.angemeldet, einwilligung_quelle = excluded.einwilligung_quelle, einwilligung_text = excluded.einwilligung_text,
      einwilligung_zeit = NULL, bestaetigung_gesendet = excluded.bestaetigung_gesendet`).bind(email, vorname, nachname || null, iso, quelle, text, token).run();
  const link = `${SITE}/newsletter.html?bestaetigen=${token}`;
  const sent = await sendMail(env, {from: env.NEWSLETTER_FROM || 'ShirtBOX <newsletter@shirtbox.ch>', to: [email], reply_to: env.CONTACT_EMAIL || 'info@shirtbox.ch',
    subject: 'Bitte bestätigen Sie Ihre Newsletter-Anmeldung', ...confirmMail(vorname, link)});
  if (!sent) throw Error('Bestätigungsmail nicht versendet');
  return 'gesendet';
}

async function confirmSubscription(env, token) {
  const row = await env.DB.prepare('SELECT status, bestaetigung_gesendet FROM abonnenten WHERE token = ?').bind(token).first();
  if (!row) return 'unbekannt';
  if (row.status === 'aktiv') return 'bereits';
  if (row.status !== 'ausstehend') return 'unbekannt';
  if (Date.now() - new Date(row.bestaetigung_gesendet) > 14 * 86400000) return 'abgelaufen';
  await env.DB.prepare("UPDATE abonnenten SET status = 'aktiv', einwilligung_zeit = ?, abgemeldet = NULL WHERE token = ? AND status = 'ausstehend'").bind(new Date().toISOString(), token).run();
  return 'bestaetigt';
}

async function unsubscribe(env, token) {
  const row = await env.DB.prepare('SELECT id, status FROM abonnenten WHERE token = ?').bind(token).first();
  if (!row) return 'unbekannt';
  if (row.status === 'abgemeldet') return 'bereits';
  await env.DB.batch([
    env.DB.prepare("UPDATE abonnenten SET status = 'abgemeldet', abgemeldet = ? WHERE id = ? AND status IN ('aktiv', 'ausstehend')").bind(new Date().toISOString(), row.id),
    env.DB.prepare("UPDATE newsletter_empfaenger SET status = 'uebersprungen' WHERE abonnent_id = ? AND status = 'wartend'").bind(row.id)
  ]);
  return 'abgemeldet';
}

// Mailprogramme (Gmail, Apple Mail …) melden per POST direkt ab (RFC 8058). Ein Klick im Browser führt zur Abmeldeseite.
async function unsubscribeDirect(request, env, url) {
  const token = url.searchParams.get('t') || '';
  if (request.method === 'GET') return Response.redirect(`${SITE}/newsletter.html?abmelden=${encodeURIComponent(token)}`, 302);
  if (request.method !== 'POST' || !env.DB || !/^[a-f0-9]{48}$/.test(token)) return new Response('Ungültig', {status: 400});
  await unsubscribe(env, token);
  return new Response('Abgemeldet', {headers: {'Content-Type': 'text/plain; charset=utf-8'}});
}

// Newsletter-Bilder sind öffentlich (sonst zeigen Mailprogramme sie nicht). Designbilder der Bestellungen bleiben privat.
async function newsletterImage(request, env, path) {
  const name = path.slice('/bild/newsletter/'.length);
  if (!env.BILDER || !/^[a-z0-9-]+\.(jpg|png|webp|gif)$/.test(name)) return new Response('Nicht gefunden', {status: 404});
  const object = await env.BILDER.get(`newsletter/${name}`);
  if (!object) return new Response('Nicht gefunden', {status: 404});
  return new Response(object.body, {headers: {'Content-Type': object.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff'}});
}

// Resend-Webhook (Svix-Signatur): zugestellt, unzustellbar, Beschwerde. Bei Beschwerde/hartem Bounce keine weiteren Mails.
async function resendWebhook(request, env) {
  if (request.method !== 'POST' || !env.DB || !env.RESEND_WEBHOOK_SECRET) return new Response('Nicht eingerichtet', {status: 503});
  const body = await request.text(), id = request.headers.get('svix-id'), time = request.headers.get('svix-timestamp'), signatures = request.headers.get('svix-signature') || '';
  if (!id || !time || Math.abs(Date.now() / 1000 - Number(time)) > 300) return new Response('Ungültig', {status: 400});
  const secret = Uint8Array.from(atob(String(env.RESEND_WEBHOOK_SECRET).trim().replace(/^whsec_/, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', secret, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const expected = base64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${time}.${body}`)));
  if (!signatures.split(' ').some(s => s.split(',')[1] === expected)) return new Response('Signatur falsch', {status: 401});
  const event = JSON.parse(body), emailId = event?.data?.email_id;
  if (!emailId) return new Response('ok');
  const row = await env.DB.prepare('SELECT id, abonnent_id, status FROM newsletter_empfaenger WHERE resend_id = ?').bind(emailId).first();
  if (!row) return new Response('ok'); // z. B. Bestellmails
  const set = (status, extra) => env.DB.prepare('UPDATE newsletter_empfaenger SET status = ?, fehler = COALESCE(?, fehler) WHERE id = ?').bind(status, extra || null, row.id).run();
  if (event.type === 'email.delivered' && row.status === 'gesendet') await set('zugestellt');
  else if (event.type === 'email.bounced') {
    await set('unzustellbar', clean(event.data?.bounce?.message || 'Unzustellbar', 300));
    if (!event.data?.bounce?.type || /permanent/i.test(event.data.bounce.type)) await env.DB.prepare("UPDATE abonnenten SET status = 'unzustellbar' WHERE id = ? AND status = 'aktiv'").bind(row.abonnent_id).run();
  } else if (event.type === 'email.complained') {
    await set('beschwerde');
    await env.DB.prepare("UPDATE abonnenten SET status = 'beschwerde', abgemeldet = ? WHERE id = ?").bind(new Date().toISOString(), row.abonnent_id).run();
  } else if (event.type === 'email.failed') await set('fehler', clean(event.data?.failed?.reason || 'Versand fehlgeschlagen', 300));
  return new Response('ok');
}

function confirmMail(vorname, link) {
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Newsletter bestätigen</title></head>
<body style="margin:0;padding:0;background:#ece8e0">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ece8e0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:22px;overflow:hidden">
  <tr><td style="background:#131c30;padding:22px 32px">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td style="padding-right:12px"><img src="${SITE}/shirtbox-icon-mail.png" width="44" height="44" alt="" style="display:block;border:0;border-radius:12px"></td>
      <td style="${font}font-size:26px;font-weight:900;letter-spacing:-1px;color:#f4f1ea">shirt<span style="color:#ff6a2b">box</span><span style="font-size:15px;font-weight:bold;color:#8a94a6">.ch</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="height:5px;line-height:5px;font-size:0;background:#ff5b2e;background-image:linear-gradient(90deg,#ff3d2e,#ff7a2b,#ffb43a)">&nbsp;</td></tr>
  <tr><td style="padding:34px 32px 10px">
    <h1 style="${font}margin:0 0 12px;font-size:26px;line-height:1.2;color:#131c30">Fast geschafft, ${esc(vorname)}!</h1>
    <p style="${font}margin:0 0 22px;font-size:16px;line-height:1.55;color:#3d4554">Bitte bestätigen Sie mit einem Klick, dass Sie den ShirtBOX-Newsletter mit Neuigkeiten, Aktionen und Angeboten erhalten möchten.</p>
    <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:999px;background:#ff5b2e"><a href="${link}" style="${font}display:inline-block;padding:15px 30px;font-size:16px;font-weight:bold;color:#131c30;text-decoration:none">Anmeldung bestätigen</a></td></tr></table>
    <p style="${font}margin:22px 0 0;font-size:13px;line-height:1.55;color:#8a909c">Falls Sie sich nicht angemeldet haben, ignorieren Sie diese E-Mail einfach – ohne Bestätigung erhalten Sie keine Newsletter. Der Link ist 14 Tage gültig.</p>
  </td></tr>
  <tr><td style="background:#131c30;padding:18px 32px;${font}font-size:12px;line-height:1.6;color:#8a94a6">ShirtBOX.ch · Leinackerweg 19 · 5014 Gretzenbach · Schweiz · <a href="mailto:info@shirtbox.ch" style="color:#ff9a6e;text-decoration:none">info@shirtbox.ch</a></td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = `Fast geschafft, ${vorname}!\n\nBitte bestätigen Sie Ihre Anmeldung zum ShirtBOX-Newsletter:\n${link}\n\nFalls Sie sich nicht angemeldet haben, ignorieren Sie diese E-Mail. Der Link ist 14 Tage gültig.\n\nShirtBOX.ch · Leinackerweg 19 · 5014 Gretzenbach · info@shirtbox.ch`;
  return {html, text};
}
