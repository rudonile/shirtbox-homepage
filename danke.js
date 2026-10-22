(() => {
  const el = document.getElementById('danke-betrag');
  const api = window.ShirtboxOrder;
  if (!el || !api) return;
  const menge = Number(new URLSearchParams(location.search).get('anzahl'));
  if (Number.isInteger(menge) && menge >= 1 && menge <= api.MAX_TOTAL) {
    el.textContent = api.money(api.totalForQuantity(menge));
  }
})();
