/* ShirtBOX: kostenlose lokale SVG-Vektorisierung (reduzierte Farbpalette).
   SVG enthält ausschliesslich Vektor-Rechtecke, keine eingebetteten Rasterbilder.
   Bei Fotos ist das SVG eine vereinfachte Annäherung; PNG bleibt Original. */
(() => {
  'use strict';
  async function make(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const width = Math.max(1, Math.round(Math.min(240, bitmap.width) ));
      const height = Math.max(1, Math.round(bitmap.height * width / bitmap.width));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', {willReadFrequently:true});
      ctx.drawImage(bitmap, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      const colors = new Map();
      const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${bitmap.width}" height="${bitmap.height}">`];
      // 4x4x4 Farbpalette: echte Vektorelemente, mit bewusst reduzierten Farben.
      const keyAt = (x,y) => { const i=(y*width+x)*4; if(data[i+3]<64)return 'none';
        const q=v=>Math.min(255,Math.round(v/51)*51).toString(16).padStart(2,'0');
        return `#${q(data[i])}${q(data[i+1])}${q(data[i+2])}`; };
      for(let y=0;y<height;y++) {
        let x=0;
        while(x<width) {
          const color=keyAt(x,y); let end=x+1;
          while(end<width && keyAt(end,y)===color)end++;
          if(color!=='none') {
            if(!colors.has(color))colors.set(color,[]);
            colors.get(color).push(`M${x} ${y}h${end-x}v1H${x}z`);
          }
          x=end;
        }
      }
      for(const [color,paths] of colors)parts.push(`<path fill="${color}" d="${paths.join('')}"/>`);
      parts.push('</svg>');
      return new Blob([parts.join('')],{type:'image/svg+xml'});
    } finally { bitmap.close(); }
  }
  window.ShirtboxVector = {make};
})();
