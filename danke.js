(() => {
  const el = document.getElementById('danke-betrag');
  const api = window.ShirtboxOrder;
  if (!el || !api) return;
  const menge = Number(new URLSearchParams(location.search).get('anzahl'));
  const nummer = new URLSearchParams(location.search).get('bestellung') || '';
  const nummerFeld = document.getElementById('danke-nummer');
  if (nummerFeld && /^SB-\d{6}-[A-Z0-9]{4}$/.test(nummer)) { nummerFeld.querySelector('strong').textContent = nummer; nummerFeld.hidden = false; }
  // Nur ein echter Redirect nach einem gueltigen Bestell-Submit leert den Warenkorb.
  // Direkter Aufruf von danke.html darf bestehende Designs nicht loeschen.
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem('shirtbox-order-pending') || 'null'); } catch(e) {}
  const confirmedReturn = pending && Number(pending.quantity) === menge &&
    Date.now() - Number(pending.at) >= 0 && Date.now() - Number(pending.at) < 60 * 60 * 1000;
  if (confirmedReturn) {
    sessionStorage.removeItem('shirtbox-order-pending');
    for (const key of ['shirtbox-order-fields','shirtbox-design-order-details']) sessionStorage.removeItem(key);
    try { window.ShirtboxDesignTransfer?.clear?.().catch(console.error); } catch(e) { console.error(e); }
    try { sessionStorage.setItem('shirtbox-order-completed', String(Date.now())); } catch(e) {}
  }
  if (Number.isInteger(menge) && menge >= 1 && menge <= api.MAX_TOTAL) {
    el.textContent = api.money(api.totalForQuantity(menge));
  }
})();
