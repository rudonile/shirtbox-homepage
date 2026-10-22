(() => {
  'use strict';
  const link = document.getElementById('vorlage-download');
  const status = document.getElementById('vorlage-download-status');
  if (!link || !status) return;
  let pending = false;
  link.addEventListener('click', async event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    // Lokale Vorschau: den nativen Download verwenden.
    if (!['http:', 'https:'].includes(location.protocol)) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    status.textContent = 'Download wird vorbereitet …';
    let url;
    try {
      const response = await fetch(link.href);
      if (!response.ok) throw new Error('Download nicht verfügbar');
      url = URL.createObjectURL(await response.blob());
      const download = document.createElement('a');
      download.href = url;
      download.download = link.download;
      document.body.appendChild(download);
      download.click();
      download.remove();
      status.textContent = 'Download gestartet. Sie finden die Vorlage in Ihren Downloads oder wählen den Speicherort im Speicherdialog.';
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (url) URL.revokeObjectURL(url);
      status.textContent = 'Der Download konnte nicht gestartet werden. Bitte versuchen Sie es nochmals.';
    } finally {
      pending = false;
    }
  });
})();
