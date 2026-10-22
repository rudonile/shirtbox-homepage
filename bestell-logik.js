(() => {
  'use strict';
  const PRICE = 89, MAX_DESIGNS = 5, MAX_PER_DESIGN = 5, MAX_TOTAL = 5;
  const PRICE_CENTS = 8900, DISCOUNTED_PRICE_CENTS = 8010;
  const money = amount => `CHF ${Number(amount).toFixed(2)}`;
  function totalForQuantity(quantity) { return quantity > 0 ? (PRICE_CENTS + (quantity - 1) * DISCOUNTED_PRICE_CENTS) / 100 : 0; }
  const SIZES = ['S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL', '7XL'];
  const SIZE_LABELS = Object.fromEntries(SIZES.map((size, i) => [size, `${size} → ${SIZES[i + 2] || 'nicht verfügbar'}`]));
  const ORDER_SIZE = Object.fromEntries(SIZES.slice(0, -2).map((size, i) => [size, SIZES[i + 2]]));
  function calculate(designs) {
    const errors = [];
    if (!Array.isArray(designs) || designs.length < 1 || designs.length > MAX_DESIGNS) {
      return {valid: false, errors: ['Bitte Ihren Entwurf aus dem Shirt-Designer übernehmen.'], designs: [], quantity: 0, total: 0};
    }
    let standardShirtAssigned = false;
    const items = designs.map((design, index) => {
      let quantity = 0; const sizes = new Set();
      if (!design.rows?.length || design.rows.length > SIZES.length) errors.push(`Design ${index + 1}: Bitte mindestens eine Grösse auswählen.`);
      for (const row of design.rows || []) {
        const count = Number(row.quantity);
        if (!ORDER_SIZE[row.size]) errors.push(`Design ${index + 1}: Bitte eine Grösse auswählen.`);
        if (sizes.has(row.size) && row.size) errors.push(`Design ${index + 1}: Jede Grösse nur einmal wählen.`);
        sizes.add(row.size);
        if (!Number.isInteger(count) || count < 1 || count > MAX_PER_DESIGN) errors.push(`Design ${index + 1}: Stückzahl muss zwischen 1 und 5 liegen.`);
        else quantity += count;
      }
      if (quantity > MAX_PER_DESIGN) errors.push(`Design ${index + 1}: Höchstens fünf Shirts pro Design bestellen.`);
      const standardQuantity = quantity > 0 && !standardShirtAssigned ? 1 : 0;
      if (standardQuantity) standardShirtAssigned = true;
      const discountedQuantity = quantity - standardQuantity;
      const subtotal = (standardQuantity * PRICE_CENTS + discountedQuantity * DISCOUNTED_PRICE_CENTS) / 100;
      return {number: index + 1, slot: design.slot, filename: design.filename || '', rows: design.rows || [], quantity, standardQuantity, discountedQuantity, subtotal};
    });
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
    if (quantity > MAX_TOTAL) errors.push('Maximal fünf Shirts insgesamt pro Bestellung. Bitte reduzieren Sie die Stückzahlen.');
    return {valid: !errors.length, errors: [...new Set(errors)], designs: items, quantity, total: totalForQuantity(quantity), discount: Math.max(0,quantity-1)*8.9};
  }
  function description(order) {
    return order.designs.map(item => `Design ${item.number} – Datei ${item.slot}: ${item.filename || 'noch keine Datei'}\n${item.rows.map(row => `${row.size ? `${row.size} (bestellt: ${ORDER_SIZE[row.size] || 'ungültig'})` : 'Grösse fehlt'}: ${row.quantity || 0} Stück`).join(', ')}\n${item.quantity} Shirts · ${money(item.subtotal)} inklusive Mehrwertsteuer und Versand${item.discountedQuantity ? ` (10 % Rabatt auf ${item.discountedQuantity} zusätzliche Shirts)` : ''}`).join('\n\n');
  }
  function email(order) {
    return `ShirtBOX.ch – Ihre Bestellbestätigung\n\nVielen Dank für Ihre ShirtBOX-Bestellung!\n\n${description(order)}\n\nInsgesamt ${order.quantity} Shirts. Erstes Shirt: CHF 89.00; jedes weitere Shirt derselben Bestellung: CHF 80.10 (10 % Rabatt).\nAlle Preise inklusive Mehrwertsteuer und Versand.\nTotalbetrag: ${money(order.total)}\n\nBitte bezahlen Sie diesen Betrag per TWINT an ShirtBOX, 079 915 48 24. Die Lieferzeit beträgt ca. 14 Tage (± einige Tage). Diese E-Mail bestätigt den Bestelleingang, nicht den Zahlungseingang. Bei Fragen erreichen Sie uns unter r-n@gmx.ch.`;
  }
  const api = {PRICE, PRICE_CENTS, DISCOUNTED_PRICE_CENTS, money, totalForQuantity, MAX_DESIGNS, MAX_PER_DESIGN, MAX_TOTAL, SIZES: SIZES.slice(0, -2), SIZE_LABELS, ORDER_SIZE, calculate, description, email};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.ShirtboxOrder = api;
})();
