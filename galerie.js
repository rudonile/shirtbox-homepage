(() => {
  'use strict';
  const dialog = document.getElementById('bild-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const bild = document.getElementById('grosses-bild');
  document.querySelectorAll('.gallery-card').forEach(link => {
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      bild.src = link.href;
      bild.alt = link.querySelector('img').alt;
      document.getElementById('bild-titel').textContent = link.dataset.caption;
      dialog.showModal();
      document.body.classList.add('image-open');
    });
  });
  document.getElementById('bild-schliessen').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  // Escape und Schliessen geben den Fokus an das angeklickte Bild zurück.
  dialog.addEventListener('close', () => document.body.classList.remove('image-open'));
})();
