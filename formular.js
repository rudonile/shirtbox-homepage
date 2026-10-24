(() => {
  'use strict';
  const form = document.getElementById('bestellung');
  const api = window.ShirtboxOrder;
  const list = document.getElementById('design-list');
  const submit = document.getElementById('absenden');
  const status = document.getElementById('formular-status');
  const phone = document.getElementById('telefon');
  const prefix = document.getElementById('vorwahl');
  const online = ['https:', 'http:'].includes(location.protocol);
  // Gestaltete Kundenbestätigung mit Shirt-Bildern; bei Fehler übernimmt die FormSubmit-Autoantwort.
  const MAIL_API = 'https://black-snow-2fdf.r-n.workers.dev/bestaetigung';
  const designs = new Map();
  let nextSlot = 0;
  const money = api.money;
  function message(text) { status.textContent = text; status.hidden = !text; }
  function snapshot() {
    return [...designs.values()].map(state => ({slot: state.slot, filename: state.file.files[0]?.name || '', rows: [...state.card.querySelectorAll('.design-size-row')].map(row => ({size: row.querySelector('select').value, quantity: row.querySelector('input').value}))}));
  }
  function cell(row, text) { const td = document.createElement('td'); td.textContent = text; row.append(td); }
  function refresh() {
    const order = api.calculate(snapshot());
    const body = document.getElementById('order-summary-body'); body.replaceChildren();
    [...designs.values()].forEach((state, index) => {
      const item = order.designs[index];
      const title=state.card.querySelector('.design-title');title.textContent=`Design ${state.designNumber || index + 1} – Ihr Shirt `;if(state.previewUrl){const mini=document.createElement('img');mini.src=state.previewUrl;mini.alt='Design vergrössern';mini.title='Zum Vergrössern anklicken';mini.style.cssText='width:76px;height:76px;object-fit:contain;vertical-align:middle;margin-left:14px;border-radius:8px;cursor:zoom-in;background:#fff';mini.addEventListener('click',()=>showDesign(state));title.append(mini);}
      state.card.querySelector('.design-subtotal').textContent = `${item.quantity} Shirt${item.quantity === 1 ? '' : 's'} · ${money(item.subtotal)}`;
      const rows = [...state.card.querySelectorAll('.design-size-row')];
      state.card.querySelector('.add-size').disabled = rows.length >= api.SIZES.length;
      rows.forEach(row => row.querySelector('.remove-size').disabled = rows.length === 1);
      const used = new Set();
      for (const row of rows) {
        const size = row.querySelector('select');
        size.setCustomValidity(size.value && used.has(size.value) ? 'Diese Grösse ist bei diesem Design bereits vorhanden.' : '');
        if (size.value) used.add(size.value);
      }
      state.card.querySelector('.design-data').value = `Datei: ${item.filename || 'fehlt'}\n${item.rows.map(row => `${row.size ? row.size : 'Grösse fehlt'}: ${row.quantity || 0} Stück`).join(', ')}\nZwischensumme: ${money(item.subtotal)}`;
      const tr = document.createElement('tr');
      const shirtCell=document.createElement('td'); const viewButton=document.createElement('button'); viewButton.type='button'; viewButton.className='order-view-design'; viewButton.textContent=item.filename ? `Design ${state.designNumber || index + 1}` : 'Noch kein Entwurf'; viewButton.disabled=!state.previewUrl; viewButton.addEventListener('click',()=>showDesign(state)); if(state.previewUrl){const thumb=document.createElement('img');thumb.src=state.previewUrl;thumb.alt='T-Shirt Design '+(state.designNumber||index+1);thumb.style.cssText='display:block;width:390px;max-width:100%;max-height:450px;object-fit:contain;margin:0 auto 8px;cursor:zoom-in;border-radius:8px';thumb.addEventListener('click',()=>showDesign(state));shirtCell.append(thumb);}shirtCell.append(viewButton);const editLink=document.createElement('a');editLink.href='designhilfe.html?weiterbearbeiten='+encodeURIComponent(state.designNumber||index+1);editLink.textContent='✎ Design '+(state.designNumber||index+1)+' mit KI bearbeiten und zurück zur Bestellung';editLink.style.cssText='display:block;margin-top:8px;color:#27b6ff';editLink.addEventListener('click',saveDetails);shirtCell.append(editLink);tr.append(shirtCell);
      cell(tr, item.rows.map(row => `${row.size ? row.size : '–'} × ${row.quantity || '–'}`).join(', '));
      cell(tr, String(item.quantity)); cell(tr, money(item.subtotal)); body.append(tr);
    });
    document.getElementById('summary-quantity').textContent = `${order.quantity} Shirt${order.quantity === 1 ? '' : 's'}`;
    document.getElementById('summary-total').textContent = money(order.total);
    const totalLabel = document.getElementById('gesamt');
    if (totalLabel) totalLabel.textContent = order.valid ? `Gesamtbetrag: ${money(order.total)}` : 'Bitte Grössen und Stückzahlen eintragen';
    document.getElementById('gesamt-feld').value = order.valid ? String(order.total) : '';
    document.getElementById('gesamt-anzahl').value = order.valid ? String(order.quantity) : '';
    document.getElementById('bestell-details').value = api.description(order);
    document.getElementById('antwort-mail').value = order.valid ? api.email(order) : 'Vielen Dank für Ihre ShirtBOX-Bestellung!';
    if (online) {
      const next = new URL('danke.html', location.href);
      if (order.valid) next.searchParams.set('anzahl', String(order.quantity));
      document.getElementById('weiter').value = next.href;
    }
    const validation = document.getElementById('design-validation');
    validation.textContent = order.errors.join(' '); validation.hidden = !order.errors.length; validation.dataset.state = 'error';
    const filesReady = designs.size>0 && [...designs.values()].every(state => Boolean(state.file.files[0]));
    for (const field of form.querySelectorAll('[required]')) {
      if (!['file', 'number', 'checkbox'].includes(field.type) && field.tagName !== 'SELECT') field.setCustomValidity(field.value.trim() ? '' : 'Bitte dieses Pflichtfeld ausfüllen.');
    }
    let number = phone.value.replace(/[^0-9]/g, '');
    phone.setCustomValidity(number.length >= 4 && number.length <= 15 ? '' : 'Bitte eine gültige Telefonnummer ohne Ländervorwahl eingeben.');
    if (prefix.value !== '+39') number = number.replace(/^0+/, '');
    document.getElementById('telefon-komplett').value = `${prefix.value} ${number}`;
    const ready = online && order.valid && filesReady && [...form.querySelectorAll('[required]')].every(field => field.validity.valid);
    submit.disabled = false; submit.setAttribute('aria-disabled', String(!ready));
    return {order, valid: ready};
  }
  function addSize(state, values = {}) {
    if (state.card.querySelectorAll('.design-size-row').length >= api.SIZES.length) return;
    const row = document.createElement('div'); row.className = 'design-size-row';
    row.innerHTML = `<div class="field"><label>Gewohnte Grösse *<select required><option value="">Bitte wählen</option>${api.SIZES.map(size => `<option value="${size}">${size}</option>`).join('')}</select></label></div><div class="field"><label>Stückzahl *<input type="number" min="1" step="1" required inputmode="numeric" placeholder="Anzahl"></label></div><button class="remove-size" type="button" aria-label="Diese Grössenzeile entfernen">×</button>`;
    // The named design summary carries all size rows together with the matching file slot.
    row.querySelector('select').value = values.size || '';
    
    row.querySelector('input').value = values.quantity || '';
    row.querySelector('.remove-size').addEventListener('click', () => { if (state.card.querySelectorAll('.design-size-row').length > 1) { row.remove(); refresh(); } });
    state.card.querySelector('.design-size-list').append(row);
  }
  function releasePreview(state) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = '';
    state.preview.removeAttribute('src'); state.preview.hidden = true; state.preview.style.display='none';
  }
  function selectFile(state) {
    const file = state.file.files[0] || null;
    state.designNumber = Number(file?.name.match(/shirtbox-design-(\d+)\.jpg$/)?.[1]) || state.slot;
    state.rights.checked = false; releasePreview(state);
    state.card.querySelector('.order-inline-view').hidden = !file;
    state.card.querySelector('.order-inline-edit').hidden = !file;
    state.card.querySelector('.design-heading-actions').hidden = !file;
    state.filename.textContent = file ? `Design ${state.designNumber}` : 'Bitte zuerst Ihren Entwurf im Shirt-Designer übernehmen.';
    if (file && (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif|tiff?)$/i.test(file.name))) {
      state.previewUrl = URL.createObjectURL(file); state.preview.src = state.previewUrl; state.preview.hidden = false; state.preview.style.display='block'; state.preview.style.width='100%'; state.preview.style.maxHeight='520px'; state.preview.style.objectFit='contain'; state.preview.onerror=()=>{state.filename.textContent='Bildvorschau konnte nicht geladen werden.';};
      state.card.querySelector('.order-inline-edit').href=`designhilfe.html?weiterbearbeiten=${encodeURIComponent(state.designNumber)}`;
      state.card.querySelector('.design-heading-edit').href=state.card.querySelector('.order-inline-edit').href;
    }
    refresh();
  }
  function showDesign(state) {
    if (!state.previewUrl) return;
    const modal=document.getElementById('order-design-modal');
    modal.querySelector('img').src=state.previewUrl;
    modal.querySelector('.order-design-edit').href=`designhilfe.html?weiterbearbeiten=${encodeURIComponent(state.designNumber || state.slot)}`;
    if(typeof modal.showModal==='function') modal.showModal();
  }
  function addDesign() {
    const slot = ++nextSlot;
    const card = document.createElement('section'); card.className = 'order-design'; card.setAttribute('aria-labelledby', `design-${slot}-title`);
    card.innerHTML = `<div class="design-heading-row"><h3 class="design-title" id="design-${slot}-title">Ihr Shirt</h3><div class="design-heading-actions" hidden><button type="button" class="design-heading-zoom">🔍 Vergrössern</button><a class="design-heading-edit" href="designhilfe.html">✏️ Hier T-Shirt ändern</a></div></div><input id="design-${slot}-file" name="attachment_design_${slot}" type="file" accept="image/jpeg" hidden tabindex="-1" aria-hidden="true"><div class="design-file-preview"><img hidden alt="Ihr übernommener Shirt-Entwurf"><p class="design-filename">Bitte zuerst Ihren Entwurf im Shirt-Designer übernehmen.</p><button type="button" class="order-inline-view" hidden aria-hidden="true" tabindex="-1">🔍 Vergrössern</button><a class="order-inline-edit" href="designhilfe.html" hidden aria-hidden="true" tabindex="-1">✎ Mit KI weiterbearbeiten</a></div><div class="design-size-list"></div><button class="add-size" type="button">+ Weitere Grösse</button><div class="design-subtotal"></div><div class="agb-consent"><input id="design-${slot}-rights" name="Design_${slot}_Rechte_und_Inhalte" type="checkbox" value="Ja – erforderliche Rechte vorhanden und Inhaltsvorgaben eingehalten" required><label for="design-${slot}-rights">Ich bestätige die erforderlichen Nutzungs- und Bildrechte sowie zulässige Inhalte für meinen Entwurf. *</label></div><textarea class="design-data" name="Design_${slot}_Datei_und_Stückzahlen" hidden></textarea>`;
    const state = {slot, card, previewUrl: '', file: card.querySelector('input[type=file]'), rights: card.querySelector('input[type=checkbox]'), preview: card.querySelector('img'), filename: card.querySelector('.design-filename')};
    designs.set(slot, state); list.append(card); addSize(state, {quantity:1});
    state.preview.style.cursor='zoom-in'; state.preview.tabIndex=0; state.preview.setAttribute('role','button'); state.preview.setAttribute('aria-label','Design gross ansehen'); state.preview.addEventListener('click',()=>showDesign(state)); state.preview.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showDesign(state);}});
    state.card.querySelector('.order-inline-view').addEventListener('click',()=>showDesign(state));
    state.card.querySelector('.design-heading-zoom').addEventListener('click',()=>showDesign(state));
    state.card.querySelector('.design-heading-edit').addEventListener('click',saveDetails);
    state.card.querySelector('.order-inline-edit').addEventListener('click',saveDetails);
    state.file.addEventListener('change', () => selectFile(state));
    card.querySelector('.add-size').addEventListener('click', () => { addSize(state); refresh(); });
    const actions=document.createElement('div');actions.className='order-design-actions';const editAction=card.querySelector('.order-inline-edit');editAction.hidden=false;editAction.removeAttribute('aria-hidden');editAction.removeAttribute('tabindex');actions.append(editAction);card.querySelector('.design-size-list').before(actions);
    // Grössenhinweis und Grössentabelle direkt über der Grössenauswahl.
    const sizeHelp=document.createElement('div');sizeHelp.className='order-size-help';card.querySelector('.design-size-list').before(sizeHelp);
    const asianNote=document.createElement('span');asianNote.className='asian-size-notice';asianNote.textContent='Asiatische Grössen – wir bestellen automatisch zwei Grössen grösser.';sizeHelp.append(asianNote);
    const guideTemplate=document.getElementById('shirtbox-size-guide-template');if(guideTemplate){const guide=guideTemplate.content.firstElementChild.cloneNode(true);guide.removeAttribute('id');sizeHelp.append(guide);}
    const remove=document.createElement('button');remove.type='button';remove.className='remove-design';remove.textContent='✕ Entfernen';remove.title='Dieses Design aus der Bestellung löschen';actions.append(remove);remove.addEventListener('click',async()=>{if(!confirm('Sind Sie sicher, dass Sie dieses Design aus der Bestellung löschen wollen?'))return;const number=state.designNumber;releasePreview(state);designs.delete(slot);card.remove();try{const saved=await window.ShirtboxDesignTransfer.load();if(saved){const blobs=(saved.blobs||[saved.blob]).filter((item,i)=>(item.number||i+1)!==number);if(blobs.length)await window.ShirtboxDesignTransfer.save(blobs);else await window.ShirtboxDesignTransfer.clear();}}catch{}try{const details=JSON.parse(sessionStorage.getItem(detailKey)||'{}');delete details[number];sessionStorage.setItem(detailKey,JSON.stringify(details));}catch{}refresh();window.ShirtboxRefreshOrderLink?.();});
    refresh();
    return state;
  }
  function attachOriginals(input, originals, placement) {
    const state=[...designs.values()].find(d=>d.file===input);if(!state)return;
    state.card.querySelectorAll('.print-original').forEach(el=>el.remove());
    if(!originals.length&&!placement)return;
    const data=document.createElement('textarea');data.hidden=true;data.className='print-original';data.name=`Design_${state.slot}_Bildplatzierungen`;data.value=placement;state.card.append(data);
    originals.forEach((item,i)=>{const file=item.file;if(!(file instanceof Blob))throw Error('Originalbild fehlt');const field=document.createElement('input');field.type='file';field.hidden=true;field.className='print-original';field.name=`attachment_original_${state.slot}_${i+1}`;const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';const transfer=new DataTransfer();transfer.items.add(new File([file],`design-${state.designNumber}-original-${i+1}.${ext}`,{type:file.type}));field.files=transfer.files;state.card.append(field);});
    const note=document.createElement('p');note.className='print-original';note.textContent=originals.length?`${originals.length} Originalbild${originals.length===1?'':'er'} und Platzierungsangaben für den Druck beigefügt.`:'Shirt-Farbe und Gestaltungseinstellungen für den Druck beigefügt.';state.card.append(note);
  }
  // Verkleinerte Kopie des Entwurfs für die Bestätigungsmail (die Druckdatei bleibt unverändert).
  async function mailImage(file) {
    const bitmap = await createImageBitmap(file), scale = Math.min(1, 1100 / bitmap.width);
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Bild')), 'image/jpeg', .85));
  }
  // Schickt Bestellung, Druckdateien und Originalbilder an den Worker. Er versendet die interne Mail und die Kundenbestätigung.
  async function sendConfirmation(order) {
    const states = [...designs.values()], value = id => document.getElementById(id).value.trim();
    const body = new FormData();
    body.set('bestellung', JSON.stringify({
      kunde: {vorname: value('vorname'), nachname: value('nachname'), email: value('email'), telefon: value('telefon-komplett'), strasse: value('strasse'), plz: value('plz'), ort: value('ort'), land: value('land')},
      agb: document.getElementById('agb-zustimmung').checked ? document.getElementById('agb-zustimmung').value : '',
      designs: order.designs.map((item, i) => ({nummer: states[i].designNumber || item.number, rechte: states[i].rights.checked, platzierung: states[i].card.querySelector('textarea.print-original')?.value || '', groessen: item.rows.map(row => ({groesse: row.size, anzahl: Number(row.quantity)}))}))
    }));
    let size = 0;
    for (const [i, state] of states.entries()) {
      const file = state.file.files[0];
      if (file) { body.set(`druck_${i}`, file, file.name); size += file.size; body.set(`bild_${i}`, await mailImage(file), `design-${i + 1}.jpg`); }
      for (const input of state.card.querySelectorAll('input.print-original')) { const original = input.files[0]; if (original) { body.append(`original_${i}`, original, original.name); size += original.size; } }
    }
    if (size > 24 * 1024 * 1024) throw Error('Zu gross für den Mailversand');
    const response = await fetch(MAIL_API, {method: 'POST', body, signal: AbortSignal.timeout(60000)});
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.bestellnummer) throw Error(result.error || 'Bestellung nicht versendet');
    return result;
  }
  function fallbackNumber() {
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    return `SB-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
  // Preserve each design's sizes, quantities and rights independently across editing trips.
  const detailKey='shirtbox-design-order-details';
  function saveDetails(){
    const data={};
    for(const state of designs.values())if(state.file.files[0])data[state.designNumber]={
      rows:[...state.card.querySelectorAll('.design-size-row')].map(row=>({size:row.querySelector('select').value,quantity:row.querySelector('input').value})),rights:state.rights.checked};
    try{sessionStorage.setItem(detailKey,JSON.stringify(data));}catch{}
  }
  function restoreDetails(input,number){
    const state=[...designs.values()].find(d=>d.file===input);if(!state)return;
    try{const saved=JSON.parse(sessionStorage.getItem(detailKey)||'{}')[number];if(!saved)return;
      state.card.querySelector('.design-size-list').replaceChildren();
      for(const row of saved.rows||[])addSize(state,row);
      if(!saved.rows?.length)addSize(state,{quantity:1});
      state.rights.checked=!!saved.rights;refresh();
    }catch{}
  }
  form.addEventListener('input',saveDetails);
  form.addEventListener('change',saveDetails);
  document.querySelector('.order-design-edit')?.addEventListener('click',saveDetails);
  window.ShirtboxOrderDesigns = { add: addDesign, attachOriginals, restoreDetails };
  if (online) {
    document.getElementById('weiter').disabled = false;
    document.getElementById('formular-url').disabled = false;
    document.getElementById('formular-url').value = location.href;
  } else message('Dies ist eine lokale Vorschau. Zum Absenden bitte die veröffentlichte Website öffnen.');
  form.noValidate = true;
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  form.addEventListener('reset', () => {
    const originals=[...form.querySelectorAll('input.print-original')].map(input=>({input,file:input.files[0]}));
    const saved = [...designs.values()].map(state => ({state, file: state.file.files[0]}));
    setTimeout(() => {
      for(const {input,file} of originals){if(file){const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;}}
      for (const {state, file} of saved) {
        if (file) { const transfer = new DataTransfer(); transfer.items.add(file); state.file.files = transfer.files; }
        state.card.querySelector('.design-size-list').replaceChildren(); addSize(state);
      }
      refresh();
    }, 0);
  });
  form.addEventListener('submit', event => {
    form.classList.add('was-submitted');
    const result = refresh();
    if (!online || !result.valid || !form.reportValidity()) {
      event.preventDefault();
      message(!online ? 'Bitte die veröffentlichte Website öffnen.' : 'Bitte die gelb markierte Angabe ergänzen.');
      document.querySelectorAll('.missing-required').forEach(el=>el.classList.remove('missing-required'));
      const missing=[...form.querySelectorAll('[required]')].find(el=>!el.validity.valid);
      const target=missing || (result.order.errors.length ? list.querySelector('.design-size-row') || list : null);
      if(target){const box=target.closest('.agb-consent,.design-size-row,.field')||target;box.classList.add('missing-required');box.scrollIntoView({behavior:'smooth',block:'center'});if(missing){try{missing.focus({preventScroll:true});}catch(e){missing.focus();}}}
      else if(!result.order.valid){list.classList.add('missing-required');list.scrollIntoView({behavior:'smooth',block:'center'});}
      return;
    }
    // Normalfall: Der Worker verschickt interne Mail und Kundenbestätigung, danach direkt zur Danke-Seite.
    // Ersatzweg: FormSubmit wie bisher (form.submit löst kein weiteres submit-Ereignis aus).
    event.preventDefault();
    if (submit.getAttribute('aria-busy') === 'true') return;
    // Nur nach Rueckkehr auf die Danke-Seite als abgeschlossen behandeln.
    try { sessionStorage.setItem('shirtbox-order-pending', JSON.stringify({quantity:result.order.quantity, at:Date.now()})); } catch(e) {}
    const progress=document.getElementById('order-submit-progress');
    if(progress){progress.hidden=false;progress.scrollIntoView({behavior:'smooth',block:'center'});}
    submit.setAttribute('aria-busy','true');
    submit.textContent='⏳ Bestellung wird übermittelt …';
    message('Ihre Bestellung wird übermittelt. Bitte warten und die Seite nicht schliessen.');
    (async () => {
      const autoresponse = document.getElementById('antwort-mail');
      const next = document.getElementById('weiter');
      let number, sent = null;
      try { sent = await sendConfirmation(result.order); number = sent.bestellnummer; } catch { number = fallbackNumber(); }
      const thanks = new URL(next.value || new URL('danke.html', location.href).href); thanks.searchParams.set('bestellung', number);
      if (sent?.kunde) { location.href = thanks.href; return; }
      // Ersatzweg FormSubmit: interne Mail mit Anhängen plus Text-Bestätigung an den Kunden.
      autoresponse.disabled = false; autoresponse.value = `Bestellnummer: ${number}\n\n${autoresponse.value}`;
      document.getElementById('bestellnummer').value = number;
      document.getElementById('betreff').value = `Neue ShirtBOX-Bestellung ${number} – ${money(result.order.total)}`;
      next.value = thanks.href;
      form.submit();
    })();
  });
  window.addEventListener('pageshow', () => { const progress=document.getElementById('order-submit-progress');if(progress)progress.hidden=true;submit.disabled=false;submit.removeAttribute('aria-busy');submit.innerHTML='Zahlungspflichtig bestellen <span aria-hidden="true">↗</span>';refresh(); });
  // Empty orders stay empty until a new design is added from the designer.
})();
