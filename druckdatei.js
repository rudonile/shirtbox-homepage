// ShirtBOX Druckdatei: rechnet das bestellte Design (Vorder- und Rückseite nebeneinander) als PNG auf das Druckformat 45 × 60 cm hoch.
// Das Bild wird nicht gedreht, nicht verzerrt und nicht beschnitten: volle Breite, oben/unten in der Randfarbe des Bildes ergänzt.
// Ziel 2657 × 3543 px (150 dpi) – so passt die PNG noch in den Mail-Anhang. Ist sie grösser als maxBytes, wird sie schrittweise verkleinert.
// Die dpi-Angabe im PNG passt sich der Pixelgrösse an, damit das Druckmass immer 45 × 60 cm bleibt.
// Aufruf: await window.ShirtboxPrint.make(file, {maxBytes})
(() => {
  'use strict';
  const W = 2657, H = 3543, WIDTH_M = .45, MIN_W = 1500, MAX_BYTES = 11 * 1024 * 1024;
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // Zwischenstufe in doppelter Grösse, leicht nachgeschärft – Kanten und Schrift bleiben nach dem Hochrechnen klarer.
  function prepare(bitmap) {
    const step = canvas(bitmap.width * 2, bitmap.height * 2), s = step.getContext('2d');
    s.imageSmoothingQuality = 'high'; s.drawImage(bitmap, 0, 0, step.width, step.height);
    const blur = canvas(step.width, step.height), b = blur.getContext('2d');
    b.filter = 'blur(1px)'; b.drawImage(step, 0, 0);
    const img = s.getImageData(0, 0, step.width, step.height), soft = b.getImageData(0, 0, step.width, step.height).data, px = img.data;
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) px[i + k] = px[i + k] + .6 * (px[i + k] - soft[i + k]);
    s.putImageData(img, 0, 0); blur.width = blur.height = 0;
    return step;
  }

  // Randfarbe aus den vier Ecken, damit die Ergänzung oben/unten nahtlos wirkt.
  function edgeColor(bitmap) {
    const c = canvas(bitmap.width, bitmap.height), ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
    let r = 0, g = 0, b = 0, n = 0;
    for (const [x, y] of [[0, 0], [bitmap.width - 8, 0], [0, bitmap.height - 8], [bitmap.width - 8, bitmap.height - 8]]) {
      const d = ctx.getImageData(x, y, 8, 8).data;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    }
    return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  }

  // CRC32 für den PNG-Block mit der Auflösung.
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc32 = bytes => { let c = ~0; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };

  // pHYs-Block direkt nach IHDR einsetzen (Browser-PNGs haben keine dpi-Angabe).
  async function withDpi(blob, w) {
    const bytes = new Uint8Array(await blob.arrayBuffer()), ppm = Math.round(w / WIDTH_M);
    const chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
    view.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); view.setUint32(8, ppm); view.setUint32(12, ppm); chunk[16] = 1;
    view.setUint32(17, crc32(chunk.subarray(4, 17)));
    const at = 33; // 8 Byte Signatur + 25 Byte IHDR
    return new Blob([bytes.subarray(0, at), chunk, bytes.subarray(at)], {type: 'image/png'});
  }

  async function render(step, bg, bitmap, w, h) {
    const c = canvas(w, h), ctx = c.getContext('2d');
    if (!ctx) return null;
    const scale = Math.min(w / bitmap.width, h / bitmap.height), dw = Math.round(bitmap.width * scale), dh = Math.round(bitmap.height * scale);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(step, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    c.width = c.height = 0;
    return blob && blob.size > 50000 ? blob : null;
  }

  async function make(file, {maxBytes = MAX_BYTES} = {}) {
    const bitmap = await createImageBitmap(file), step = prepare(bitmap), bg = edgeColor(bitmap);
    try {
      let w = W;
      for (let tries = 0; tries < 4; tries++) {
        const h = Math.round(w * H / W), blob = await render(step, bg, bitmap, w, h);
        if (!blob) return null;
        if (blob.size <= maxBytes || w <= MIN_W) return blob.size <= maxBytes ? Object.assign(await withDpi(blob, w), {width: w, height: h}) : null;
        w = Math.max(MIN_W, Math.floor(w * Math.sqrt(maxBytes / blob.size) * .95));
      }
      return null;
    } finally { step.width = step.height = 0; bitmap.close(); }
  }

  window.ShirtboxPrint = {make, width: W, height: H};
})();
