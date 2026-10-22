(() => {
  const menge = Number(new URLSearchParams(location.search).get('anzahl'));
  const api = window.ShirtboxOrder;
  if (Number.isInteger(menge) && menge >= 1 && menge <= api.MAX_TOTAL) {
    document.getElementById('danke-betrag').textContent = `${api.money(api.totalForQuantity(menge))} inklusive Mehrwertsteuer und Versand`;
  } else document.getElementById('danke-betrag').classList.add('is-fallback');
})();
