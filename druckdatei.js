// ShirtBOX Druckdatei: rechnet das bestellte Design (Vorder- und Rückseite nebeneinander) auf 5315 × 7087 px hoch.
// Das Bild wird nicht gedreht, nicht verzerrt und nicht beschnitten: volle Breite, oben/unten in der Randfarbe des Bildes ergänzt.
// Computer/Android: ein grosses Canvas. iPhone (max. ~16 Mio. Pixel pro Canvas): Berechnung in Streifen und eigener JPG-Encoder.
// Ergebnis: JPG mit 300 dpi (= 45 × 60 cm). Aufruf: await window.ShirtboxPrint.make(file)
(() => {
  'use strict';
  const W = 5315, H = 7087, DPI = 300, QUALITY = .92;
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

  // Zeichnet den Ausschnitt y..y+h der fertigen Druckdatei in ein Canvas der Breite W.
  function painter(bitmap) {
    const step = prepare(bitmap), bg = edgeColor(bitmap);
    const scale = Math.min(W / bitmap.width, H / bitmap.height), dw = Math.round(bitmap.width * scale), dh = Math.round(bitmap.height * scale);
    const dx = Math.round((W - dw) / 2), dy = Math.round((H - dh) / 2);
    return {draw(ctx, y) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, ctx.canvas.height); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(step, dx, dy - y, dw, dh); }, free() { step.width = step.height = 0; }};
  }

  // JPG-Kopf auf 300 dpi setzen (Browser-JPGs haben 72 dpi bzw. keine Angabe).
  async function withDpi(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes[2] === 0xFF && bytes[3] === 0xE0 && String.fromCharCode(...bytes.slice(6, 10)) === 'JFIF') {
      bytes[13] = 1; bytes[14] = DPI >> 8; bytes[15] = DPI & 255; bytes[16] = DPI >> 8; bytes[17] = DPI & 255;
    }
    return new Blob([bytes], {type: 'image/jpeg'});
  }

  async function native(paint) {
    const c = canvas(W, H), ctx = c.getContext('2d');
    if (!ctx) return null;
    paint.draw(ctx, 0);
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', QUALITY));
    c.width = c.height = 0;
    return blob && blob.size > 50000 ? withDpi(blob) : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Streifen-Encoder (Baseline-JPG, YCbCr 4:4:4, Standard-Huffman-Tabellen) für Geräte mit kleinem Canvas-Limit.
  const ZIGZAG = [0,1,5,6,14,15,27,28,2,4,7,13,16,26,29,42,3,8,12,17,25,30,41,43,9,11,18,24,31,40,44,53,10,19,23,32,39,45,52,54,20,22,33,38,46,51,55,60,21,34,37,47,50,56,59,61,35,36,48,49,57,58,62,63];
  const Q_Y = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
  const Q_C = [17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99];
  const DC_Y_BITS = [0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0], DC_C_BITS = [0,3,1,1,1,1,1,1,1,1,1,0,0,0,0,0], DC_VALS = [0,1,2,3,4,5,6,7,8,9,10,11];
  const AC_Y_BITS = [0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d];
  const AC_Y_VALS = [0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa];
  const AC_C_BITS = [0,2,1,2,4,4,3,4,7,5,4,4,0,1,2,0x77];
  const AC_C_VALS = [0x00,0x01,0x02,0x03,0x11,0x04,0x05,0x21,0x31,0x06,0x12,0x41,0x51,0x07,0x61,0x71,0x13,0x22,0x32,0x81,0x08,0x14,0x42,0x91,0xa1,0xb1,0xc1,0x09,0x23,0x33,0x52,0xf0,0x15,0x62,0x72,0xd1,0x0a,0x16,0x24,0x34,0xe1,0x25,0xf1,0x17,0x18,0x19,0x1a,0x26,0x27,0x28,0x29,0x2a,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x82,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa];
  const AAN = [1, 1.387039845, 1.306562965, 1.175875602, 1, 0.785694958, 0.5411961, 0.275899379];

  function huffman(bits, vals) {
    const table = []; let code = 0, k = 0;
    for (let len = 1; len <= 16; len++) { for (let j = 0; j < bits[len - 1]; j++) table[vals[k++]] = [code++, len]; code <<= 1; }
    return table;
  }
  function tables(base, quality) {
    const sf = quality < 50 ? 5000 / quality : 200 - quality * 2, zz = new Uint8Array(64), div = new Float32Array(64);
    for (let i = 0; i < 64; i++) zz[ZIGZAG[i]] = Math.min(255, Math.max(1, Math.floor((base[i] * sf + 50) / 100)));
    for (let i = 0; i < 64; i++) div[i] = 1 / (zz[ZIGZAG[i]] * AAN[i >> 3] * AAN[i & 7] * 8);
    return {zz, div};
  }

  function encodeStrips(paint) {
    const quality = Math.round(QUALITY * 100), qy = tables(Q_Y, quality), qc = tables(Q_C, quality);
    const dcY = huffman(DC_Y_BITS, DC_VALS), dcC = huffman(DC_C_BITS, DC_VALS), acY = huffman(AC_Y_BITS, AC_Y_VALS), acC = huffman(AC_C_BITS, AC_C_VALS);
    let out = new Uint8Array(8 << 20), pos = 0, bitBuf = 0, bitCount = 0;
    const byte = v => { if (pos >= out.length) { const bigger = new Uint8Array(out.length * 2); bigger.set(out); out = bigger; } out[pos++] = v; };
    const word = v => { byte(v >> 8); byte(v & 255); };
    const bitsOut = (code, len) => {
      bitBuf = (bitBuf << len) | code; bitCount += len;
      while (bitCount >= 8) { const v = (bitBuf >> (bitCount - 8)) & 255; byte(v); if (v === 255) byte(0); bitCount -= 8; }
      bitBuf &= (1 << bitCount) - 1;
    };
    // Kopf: SOI, JFIF mit 300 dpi, Quantisierung, Bildgrösse, Huffman-Tabellen, Scan-Beginn.
    word(0xFFD8); word(0xFFE0); word(16); [0x4A,0x46,0x49,0x46,0,1,1,1].forEach(byte); word(DPI); word(DPI); byte(0); byte(0);
    word(0xFFDB); word(132); byte(0); qy.zz.forEach(byte); byte(1); qc.zz.forEach(byte);
    word(0xFFC0); word(17); byte(8); word(H); word(W); byte(3); [1,0x11,0, 2,0x11,1, 3,0x11,1].forEach(byte);
    word(0xFFC4); word(418);
    for (const [cls, bits, vals] of [[0, DC_Y_BITS, DC_VALS], [0x10, AC_Y_BITS, AC_Y_VALS], [1, DC_C_BITS, DC_VALS], [0x11, AC_C_BITS, AC_C_VALS]]) { byte(cls); bits.forEach(byte); vals.forEach(byte); }
    word(0xFFDA); word(12); [3, 1,0, 2,0x11, 3,0x11, 0,0x3F,0].forEach(byte);

    const block = new Float32Array(64), quant = new Int32Array(64);
    const category = v => { let a = v < 0 ? -v : v, n = 0; while (a) { n++; a >>= 1; } return n; };
    function encodeBlock(dc, div, dcTable, acTable) {
      const d = block;
      for (let o = 0; o < 64; o += 8) row(d, o, 1);
      for (let o = 0; o < 8; o++) row(d, o, 8);
      for (let i = 0; i < 64; i++) { const v = d[i] * div[i]; quant[ZIGZAG[i]] = v > 0 ? (v + .5) | 0 : (v - .5) | 0; }
      const diff = quant[0] - dc, cat = category(diff);
      bitsOut(...dcTable[cat]); if (cat) bitsOut(diff < 0 ? diff + (1 << cat) - 1 : diff, cat);
      let end = 63; while (end > 0 && quant[end] === 0) end--;
      for (let i = 1; i <= end; i++) {
        let zeros = 0; while (quant[i] === 0) { zeros++; i++; }
        while (zeros >= 16) { bitsOut(...acTable[0xF0]); zeros -= 16; }
        const v = quant[i], c = category(v);
        bitsOut(...acTable[(zeros << 4) + c]); bitsOut(v < 0 ? v + (1 << c) - 1 : v, c);
      }
      if (end < 63) bitsOut(...acTable[0]);
      return quant[0];
    }
    // Schnelle DCT (AAN) über eine Zeile bzw. Spalte, Abstand s.
    function row(d, o, s) {
      const t0 = d[o] + d[o + 7 * s], t7 = d[o] - d[o + 7 * s], t1 = d[o + s] + d[o + 6 * s], t6 = d[o + s] - d[o + 6 * s];
      const t2 = d[o + 2 * s] + d[o + 5 * s], t5 = d[o + 2 * s] - d[o + 5 * s], t3 = d[o + 3 * s] + d[o + 4 * s], t4 = d[o + 3 * s] - d[o + 4 * s];
      let a = t0 + t3, b = t0 - t3, c = t1 + t2, e = t1 - t2;
      d[o] = a + c; d[o + 4 * s] = a - c;
      const z1 = (e + b) * 0.707106781; d[o + 2 * s] = b + z1; d[o + 6 * s] = b - z1;
      a = t4 + t5; c = t5 + t6; e = t6 + t7;
      const z5 = (a - e) * 0.382683433, z2 = 0.5411961 * a + z5, z4 = 1.306562965 * e + z5, z3 = c * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      d[o + 5 * s] = z13 + z2; d[o + 3 * s] = z13 - z2; d[o + s] = z11 + z4; d[o + 7 * s] = z11 - z4;
    }

    const STRIP = 256, strip = canvas(W, STRIP), sctx = strip.getContext('2d', {willReadFrequently: true});
    let dcY0 = 0, dcCb = 0, dcCr = 0;
    const yb = new Float32Array(64), cbb = new Float32Array(64), crb = new Float32Array(64);
    for (let y0 = 0; y0 < H; y0 += STRIP) {
      paint.draw(sctx, y0);
      const rows = Math.min(STRIP, H - y0), px = sctx.getImageData(0, 0, W, STRIP).data;
      for (let by = 0; by < rows; by += 8) for (let bx = 0; bx < W; bx += 8) {
        for (let j = 0; j < 64; j++) {
          const yy = Math.min(by + (j >> 3), rows - 1), xx = Math.min(bx + (j & 7), W - 1), p = (yy * W + xx) * 4;
          const r = px[p], g = px[p + 1], b = px[p + 2];
          yb[j] = 0.299 * r + 0.587 * g + 0.114 * b - 128; cbb[j] = -0.16874 * r - 0.33126 * g + 0.5 * b; crb[j] = 0.5 * r - 0.41869 * g - 0.08131 * b;
        }
        block.set(yb); dcY0 = encodeBlock(dcY0, qy.div, dcY, acY);
        block.set(cbb); dcCb = encodeBlock(dcCb, qc.div, dcC, acC);
        block.set(crb); dcCr = encodeBlock(dcCr, qc.div, dcC, acC);
      }
    }
    strip.width = strip.height = 0;
    if (bitCount) bitsOut((1 << (8 - bitCount)) - 1, 8 - bitCount);
    word(0xFFD9);
    return new Blob([out.subarray(0, pos)], {type: 'image/jpeg'});
  }

  async function make(file, {forceStrips = false} = {}) {
    const bitmap = await createImageBitmap(file), paint = painter(bitmap);
    try {
      return (!forceStrips && await native(paint).catch(() => null)) || encodeStrips(paint);
    } finally { paint.free(); bitmap.close(); }
  }

  window.ShirtboxPrint = {make, width: W, height: H};
})();
