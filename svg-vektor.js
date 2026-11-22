/* ShirtBOX: immer eine echte SVG-Datei mit Vektorpfaden erzeugen.
   Fotorealistische Motive sind nur angenaehert vektorisierbar.
   Die Originaldatei bleibt fuer die Druckqualitaet massgebend. */
(() => {
  'use strict';
  const LIMIT = 2.7 * 1024 * 1024; // Reserve fuer Mail-/Worker-Grenzen
  async function make(file) {
    const bitmap = await createImageBitmap(file);
    try {
      // Adaptive Aufloesung und Farbzahl: moeglichst viele Details,
      // ohne die 3-MB-Grenze des Workers zu ueberschreiten.
      for (const maxWidth of [720, 600, 480, 360, 280, 200]) {
        const width = Math.max(1, Math.min(maxWidth, bitmap.width));
        const height = Math.max(1, Math.round(bitmap.height * width / bitmap.width));
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        ctx.drawImage(bitmap, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        for (const steps of [16, 12, 8, 6, 4]) {
          const colors = new Map();
          const q = v => Math.min(255, Math.round(Math.round(v * (steps - 1) / 255) * 255 / (steps - 1)));
          const hex = v => v.toString(16).padStart(2, '0');
          const at = (x, y) => {
            const i = (y * width + x) * 4;
            if (pixels[i + 3] < 64) return null;
            return `#${hex(q(pixels[i]))}${hex(q(pixels[i + 1]))}${hex(q(pixels[i + 2]))}`;
          };
          for (let y = 0; y < height; y++) {
            let x = 0;
            while (x < width) {
              const color = at(x, y);
              let end = x + 1;
              while (end < width && at(end, y) === color) end++;
              if (color) {
                if (!colors.has(color)) colors.set(color, []);
                colors.get(color).push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
              }
              x = end;
            }
          }
          const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${bitmap.width}" height="${bitmap.height}">`];
          for (const [color, paths] of colors) parts.push(`<path fill="${color}" d="${paths.join('')}"/>`);
          parts.push('</svg>');
          const svg = new Blob(parts, {type: 'image/svg+xml'});
          if (svg.size <= LIMIT) return svg;
        }
      }
      throw new Error('SVG konnte nicht innerhalb der Versandgroesse erstellt werden');
    } finally { bitmap.close(); }
  }
  window.ShirtboxVector = {make};
})();
