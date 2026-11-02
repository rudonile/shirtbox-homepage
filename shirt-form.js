// ShirtBOX Shirt-Form: Die KI gestaltet das Design – die Software bestimmt Form, Ärmel und Druckflächen.
//
// Ablauf für jedes KI-Bild (neu oder geändert):
// 1. Umriss beider Shirts im KI-Bild finden (Vorderseite links, Rückseite rechts).
// 2. Das Design jedes Shirts auf die feste, geometrisch korrekte Vorlage übertragen (gleiche Aussenkanten:
//    Kragen, Ärmelenden, Saum). Ergebnis hat IMMER exakt den Umriss der Vorlage – verzerrte Ärmel,
//    Dreiecke/Spitzen unter den Achseln oder überstehende Motive der KI fallen dabei weg.
//    Kleine Lücken (KI-Ärmel etwas schmaler als die Vorlage) werden mit dem angrenzenden Design gefüllt.
// 3. Kundentexte (in Anführungszeichen oder nach „Text:“) setzt die Software selbst als echte Schrift:
//    exakt wie eingegeben, standardmässig mittig, mit Sicherheitsabstand, automatisch verkleinert/umbrochen
//    und vor der Anzeige geprüft, dass sie vollständig auf dem Stoff liegen.
// Passt das KI-Bild gar nicht zur Vorlage (z. B. Hintergrund übermalt), bleibt es unverändert – die Texte
// werden dann trotzdem an der entsprechenden Stelle gesetzt.
(() => {
  'use strict';
  const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const read = (img, w, h) => { const c = canvasOf(w, h), x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h); };
  const toBlob = canvas => new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('Bild konnte nicht gespeichert werden.')), 'image/png'));

  // Hintergrund = vom Bildrand aus erreichbare, graue Fläche, die nur sanft verläuft (Vignette erlaubt).
  // Grenze zum Shirt: harter Farbsprung oder deutlich andere Farbe als der Rand.
  function silhouette(data, w, h) {
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
    let r = 0, g = 0, b = 0;
    for (const i of border) { r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; }
    r /= border.length; g /= border.length; b /= border.length;
    const m = new Uint8Array(w * h).fill(1), stack = [];
    const near = i => { const dr = data[i * 4] - r, dg = data[i * 4 + 1] - g, db = data[i * 4 + 2] - b; return dr * dr + dg * dg + db * db < 4900; };
    const visit = (i, j) => {
      if (!m[j] || !near(j)) return;
      const dr = data[i * 4] - data[j * 4], dg = data[i * 4 + 1] - data[j * 4 + 1], db = data[i * 4 + 2] - data[j * 4 + 2];
      if (dr * dr + dg * dg + db * db < 500) { m[j] = 0; stack.push(j); }
    };
    for (const i of border) if (m[i] && near(i)) { m[i] = 0; stack.push(i); }
    while (stack.length) {
      const i = stack.pop(), x = i % w;
      if (x > 0) visit(i, i - 1); if (x < w - 1) visit(i, i + 1); if (i >= w) visit(i, i - w); if (i < w * (h - 1)) visit(i, i + w);
    }
    return {m, calm: border.filter(i => !m[i]).length / border.length};
  }

  // Die zwei Shirts: 1 = Vorderseite (links), 2 = Rückseite (rechts). Kleine Flecken zählen nicht.
  // Berühren sich die Shirts im Bild, wird an der schmalsten Stelle in der Mitte getrennt.
  function shirts(m, w, h) {
    const label = new Int32Array(w * h), comps = [], stack = [];
    for (let s = 0; s < m.length; s++) {
      if (!m[s] || label[s]) continue;
      const id = comps.length + 1; let n = 0, sx = 0; label[s] = id; stack.push(s);
      while (stack.length) {
        const i = stack.pop(), x = i % w; n++; sx += x;
        if (x > 0 && m[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
        if (x < w - 1 && m[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
        if (i >= w && m[i - w] && !label[i - w]) { label[i - w] = id; stack.push(i - w); }
        if (i < w * (h - 1) && m[i + w] && !label[i + w]) { label[i + w] = id; stack.push(i + w); }
      }
      comps.push({id, n, cx: sx / n});
    }
    comps.sort((a, b) => b.n - a.n);
    const [a, b] = comps;
    if (!a || a.n < w * h * .04) return null;
    const keep = new Uint8Array(w * h);
    if (b && b.n > a.n * .35) {
      const [left, right] = a.cx < b.cx ? [a, b] : [b, a];
      for (let i = 0; i < keep.length; i++) keep[i] = label[i] === left.id ? 1 : label[i] === right.id ? 2 : 0;
    } else {
      let x0 = w, x1 = 0;
      for (let i = 0; i < label.length; i++) if (label[i] === a.id) { const x = i % w; if (x < x0) x0 = x; if (x > x1) x1 = x; }
      let split = Math.round((x0 + x1) / 2), best = Infinity;
      for (let x = Math.round(x0 + (x1 - x0) * .38); x <= x0 + (x1 - x0) * .62; x++) {
        let n = 0; for (let y = 0; y < h; y++) if (label[y * w + x] === a.id) n++;
        if (n < best) { best = n; split = x; }
      }
      for (let i = 0; i < keep.length; i++) if (label[i] === a.id) keep[i] = i % w < split ? 1 : 2;
    }
    const boxes = [1, 2].map(() => ({x0: w, x1: -1, y0: h, y1: -1, n: 0}));
    for (let i = 0; i < keep.length; i++) {
      const k = keep[i]; if (!k) continue;
      const bx = boxes[k - 1], x = i % w, y = (i - x) / w;
      bx.n++; if (x < bx.x0) bx.x0 = x; if (x > bx.x1) bx.x1 = x; if (y < bx.y0) bx.y0 = y; if (y > bx.y1) bx.y1 = y;
    }
    if (boxes.some(bx => bx.n < w * h * .03)) return null;
    return {keep, boxes};
  }

  // Druckflächen je Shirt aus der Vorlage: Mitte und Breite des Rumpfs (unterhalb der Ärmel gemessen).
  function zonesOf(keep, w, boxes) {
    return boxes.map((b, k) => {
      const h = b.y1 - b.y0, y = Math.round(b.y0 + .62 * h), mid = Math.round((b.x0 + b.x1) / 2);
      let l = mid, r = mid;
      while (l > b.x0 && keep[y * w + l - 1] === k + 1) l--;
      while (r < b.x1 && keep[y * w + r + 1] === k + 1) r++;
      return {cx: (l + r) / 2, torso: Math.max(1, r - l), top: b.y0, h};
    });
  }

  const templates = {};
  function template(src) {
    if (!templates[src]) templates[src] = (async () => {
      const response = await fetch(src); if (!response.ok) throw Error('Vorlage fehlt');
      const img = await createImageBitmap(await response.blob());
      const W = img.width, H = img.height, data = read(img, W, H).data;
      const s = shirts(silhouette(data, W, H).m, W, H); if (!s) throw Error('Vorlage ohne Umriss');
      // Weiche Kante (3×3-Mittel) gegen Treppenstufen am Umriss – je Shirt eine eigene Maske.
      const masks = [1, 2].map(k => {
        const c = canvasOf(W, H), x = c.getContext('2d'), out = x.createImageData(W, H);
        for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) {
          const i = y * W + xx; let n = 0;
          for (let dy = -W; dy <= W; dy += W) for (let dx = -1; dx <= 1; dx++) if (s.keep[i + dy + dx] === k) n++;
          if (n) { out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255; out.data[i * 4 + 3] = Math.round(n * 255 / 9); }
        }
        x.putImageData(out, 0, 0); return c;
      });
      return {img, W, H, keep: s.keep, boxes: s.boxes, masks, zones: zonesOf(s.keep, W, s.boxes)};
    })().catch(e => { delete templates[src]; throw e; });
    return templates[src];
  }

  // ---------- Kundentexte ----------
  // Exakt zu druckende Texte: „…“, "…", “…”, «…», »…« oder nach „Text:“, „Schriftzug:“ usw. (bis Satzende).
  // Position aus den Wörtern daneben: hinten/Rücken → Rückseite, vorne/Brust → Vorderseite (Standard: Rückseite),
  // links/rechts → Brust links/rechts (aus Sicht der Trägerin/des Trägers). Texte für Ärmel überlässt die Software der KI.
  const SIDE_BACK = /hinten|rücken|rückseite|\bback\b/g, SIDE_FRONT = /vorne|vorn\b|brust|vorderseite|\bfront\b|chest/g;
  const POS_LEFT = /\blinks?\b|\blinke[nmrs]?\b|\bleft\b/g, POS_RIGHT = /\brechts?\b|\brechte[nmrs]?\b|\bright\b/g, SLEEVE = /ärmel|sleeve/g;
  // Abstand des nächsten Treffers: zuerst im eigenen Satzteil VOR dem Text („hinten „X““), sonst danach („„X“ hinten“).
  // Treffer davor zählen immer näher als Treffer danach.
  function nearest(re, before, after) {
    let best = Infinity, m;
    re.lastIndex = 0; while ((m = re.exec(before))) best = before.length - m.index;
    if (best < Infinity) return best;
    re.lastIndex = 0; return (m = re.exec(after)) ? 1000 + m.index : Infinity;
  }
  // Eigener Satzteil: endet an Satzzeichen, „und“/„sowie“ oder dem nächsten/vorigen Text.
  const clauseBefore = s => s.split(/[,.;!?\n„“”"«»]|\bund\b|\bsowie\b/i).pop();
  const clauseAfter = s => s.split(/[,.;!?\n„“”"«»]|\bund\b|\bsowie\b/i)[0];
  function extractTexts(description) {
    const source = String(description || ''), texts = [];
    const re = /[„“"«»]\s*([^„“”"«»\n]{1,90}?)\s*[“”"«»]|\b(?:Text|Schrift|Schriftzug|Aufschrift|Beschriftung|Slogan)\s*:\s*([^\n.;!?„“"«»]{1,90})/gi;
    let prompt = '', last = 0, m;
    while ((m = re.exec(source)) && texts.length < 3) {
      let text = (m[1] || m[2] || '').replace(/\s+/g, ' ').trim(), tail = '';
      // Nach „Text:“ gehört eine angehängte Ortsangabe nicht zum Text („Text: Team Rot auf dem Rücken“) – sie bestimmt die Stelle.
      if (m[2]) {
        const place = /\s+(?:(?:auf|am|an|im)\s+(?:der|dem|den|die)\s+)?(?:brust|rücken|rückseite|vorderseite|vorne|hinten|links|rechts|ärmel)\b.*$/i.exec(text);
        if (place) { tail = place[0]; text = text.slice(0, place.index).trim(); }
      }
      if (!text) continue;
      const before = clauseBefore(source.slice(Math.max(0, m.index - 80), m.index).toLowerCase());
      const after = clauseAfter((tail + source.slice(m.index + m[0].length, m.index + m[0].length + 80)).toLowerCase());
      if (nearest(SLEEVE, before, after) < Infinity) continue;
      const back = nearest(SIDE_BACK, before, after), front = nearest(SIDE_FRONT, before, after);
      const left = nearest(POS_LEFT, before, after), right = nearest(POS_RIGHT, before, after);
      const side = front < back ? 'front' : 'back';
      const pos = left < right ? 'left' : right < left ? 'right' : 'center';
      texts.push({text, side, pos});
      prompt += source.slice(last, m.index) + `[Schriftzug ${texts.length}]`; last = m.index + m[0].length;
    }
    prompt += source.slice(last);
    return {texts, prompt: prompt.trim()};
  }
  const AREA_NAMES = {back: 'Rücken oben', front: 'Brust', 'front-left': 'linke Brust', 'front-right': 'rechte Brust', 'back-left': 'Rücken oben', 'back-right': 'Rücken oben'};
  const areaOf = t => t.pos === 'center' ? t.side : `${t.side}-${t.pos}`;

  // Druckfläche je Stelle (in Bildkoordinaten). Links/rechts = aus Sicht der Person, die das Shirt trägt:
  // vorne erscheint „links“ im Bild rechts, hinten im Bild links.
  function area(key, zones) {
    const [f, b] = zones;
    switch (key) {
      case 'front': return {x: f.cx, y: f.top + .40 * f.h, w: .70 * f.torso, h: .10 * f.h};
      case 'front-left': return {x: f.cx + .24 * f.torso, y: f.top + .31 * f.h, w: .30 * f.torso, h: .07 * f.h};
      case 'front-right': return {x: f.cx - .24 * f.torso, y: f.top + .31 * f.h, w: .30 * f.torso, h: .07 * f.h};
      case 'back-left': return {x: b.cx - .2 * b.torso, y: b.top + .30 * b.h, w: .36 * b.torso, h: .12 * b.h};
      case 'back-right': return {x: b.cx + .2 * b.torso, y: b.top + .30 * b.h, w: .36 * b.torso, h: .12 * b.h};
      default: return {x: b.cx, y: b.top + .30 * b.h, w: .78 * b.torso, h: .20 * b.h};
    }
  }

  let fontFamily = null;
  function font() {
    if (!fontFamily) fontFamily = (async () => {
      const fallback = '"Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';
      try {
        const face = new FontFace('SBShirtText', 'url(schrift/unbounded-latin.woff2)', {weight: '200 900'});
        await Promise.race([face.load(), new Promise((_, reject) => setTimeout(() => reject(Error('timeout')), 4000))]);
        document.fonts.add(face); return `SBShirtText, ${fallback}`;
      } catch { return fallback; }
    })();
    return fontFamily;
  }

  // Wörter auf n Zeilen möglichst gleich lang verteilen.
  function wrap(words, n) {
    const total = words.join(' ').length, target = total / n, lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length > target * 1.08 && lines.length < n - 1) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line); return lines;
  }
  // Grösste Schrift, die in die Fläche passt (1–4 Zeilen), mittig ausgerichtet.
  function layoutText(ctx, text, family, maxW, maxH) {
    const words = text.split(' ');
    let best = null;
    for (let n = 1; n <= Math.min(4, words.length); n++) {
      const lines = wrap(words, n);
      ctx.font = `800 100px ${family}`;
      const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
      const size = Math.min(100 * maxW / widest, maxH / (lines.length * 1.15));
      if (!best || size > best.size * 1.05) best = {lines, size};
    }
    return best;
  }

  // Setzt die Texte, prüft vor dem Zeichnen, dass jeder Block mit 5 % Rand vollständig auf dem Stoff liegt
  // (sonst schrittweise kleiner), und gibt die Anordnung zurück (für spätere Änderungen identisch wiederverwendbar).
  async function placeTexts(canvas, texts, zones, inside) {
    const ctx = canvas.getContext('2d', {willReadFrequently: true}), family = await font(), layouts = [];
    const groups = {};
    texts.forEach(t => (groups[areaOf(t)] = groups[areaOf(t)] || []).push(t));
    for (const [key, items] of Object.entries(groups)) {
      const a = area(key, zones), slot = a.h / items.length;
      items.forEach((t, i) => {
        const cy = a.y - a.h / 2 + slot * (i + .5);
        let {lines, size} = layoutText(ctx, t.text, family, a.w, slot * .9);
        for (let tries = 0; tries < 14; tries++) {
          ctx.font = `800 ${size}px ${family}`;
          const bw = Math.max(...lines.map(l => ctx.measureText(l).width)), bh = lines.length * size * 1.15, pad = a.w * .05;
          const pts = []; for (const fx of [-.5, 0, .5]) for (const fy of [-.5, 0, .5]) pts.push([a.x + fx * (bw + 2 * pad), cy + fy * (bh + pad)]);
          if (!inside || pts.every(([x, y]) => inside(Math.round(x), Math.round(y)))) break;
          size *= .9;
        }
        // Kontrast: helle Stelle → dunkle Schrift mit heller Kontur, sonst umgekehrt.
        const sw = Math.max(1, Math.round(a.w)), sh = Math.max(1, Math.round(slot));
        const px = ctx.getImageData(Math.max(0, Math.round(a.x - sw / 2)), Math.max(0, Math.round(cy - sh / 2)), sw, sh).data;
        let lum = 0; for (let i = 0; i < px.length; i += 16) lum += .299 * px[i] + .587 * px[i + 1] + .114 * px[i + 2];
        lum /= px.length / 16;
        const light = lum > 150;
        layouts.push({lines, size, x: a.x, y: cy, family, fill: light ? '#14161c' : '#ffffff', stroke: light ? 'rgba(255,255,255,.85)' : 'rgba(10,12,18,.9)'});
      });
    }
    return layouts;
  }
  function drawTexts(canvas, layouts, shade) {
    const W = canvas.width, H = canvas.height, T = canvasOf(W, H), t = T.getContext('2d');
    for (const l of layouts) {
      t.font = `800 ${l.size}px ${l.family}`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.lineJoin = 'round';
      const lh = l.size * 1.15, y0 = l.y - lh * (l.lines.length - 1) / 2;
      l.lines.forEach((line, i) => { t.lineWidth = l.size * .14; t.strokeStyle = l.stroke; t.strokeText(line, l.x, y0 + i * lh); });
      l.lines.forEach((line, i) => { t.fillStyle = l.fill; t.fillText(line, l.x, y0 + i * lh); });
    }
    // Wie aufgedruckt: Falten und Licht der Vorlage auch auf der Schrift.
    if (shade) {
      const alpha = canvasOf(W, H); alpha.getContext('2d').drawImage(T, 0, 0);
      t.globalCompositeOperation = 'multiply'; t.drawImage(shade, 0, 0, W, H);
      t.globalCompositeOperation = 'destination-in'; t.drawImage(alpha, 0, 0);
    }
    canvas.getContext('2d').drawImage(T, 0, 0);
  }

  // ---------- Hauptfunktion ----------
  // fit(blob, vorlage, {texts, layouts}) → {blob, layouts, locked}
  //   texts:   neu zu setzende Kundentexte (aus extractTexts)
  //   layouts: bereits gesetzte Texte eines früheren Entwurfs – nach einer Änderung identisch neu setzen
  //   locked:  true = Ergebnis hat exakt die Form der Vorlage (Koordinaten der Vorlage)
  async function fit(blob, src, options = {}) {
    const wanted = options.texts || [];
    let t, ai;
    try { t = await template(src); ai = await createImageBitmap(blob); }
    catch { return {blob, layouts: [], locked: false}; }
    const W = ai.width, H = ai.height, image = read(ai, W, H), sil = silhouette(image.data, W, H);
    const s = sil.calm > .85 ? shirts(sil.m, W, H) : null;
    const maps = s && [0, 1].map(k => {
      const a = s.boxes[k], b = t.boxes[k];
      return {a, b, sx: (b.x1 - b.x0 + 1) / (a.x1 - a.x0 + 1), sy: (b.y1 - b.y0 + 1) / (a.y1 - a.y0 + 1)};
    });
    const cut = s && s.boxes.some(b => b.x0 <= 1 || b.y0 <= 1 || b.x1 >= W - 2 || b.y1 >= H - 2);
    const odd = maps && maps.some(p => Math.max(p.sx / p.sy, p.sy / p.sx) > 1.3);
    // Wie gut passt der KI-Umriss nach der Übertragung zur Vorlage? (Stichprobe jedes 3. Pixels)
    let score = 0;
    if (maps && !cut && !odd) {
      let inter = 0, union = 0;
      maps.forEach(({a, b, sx, sy}, k) => {
        for (let y = b.y0; y <= b.y1; y += 3) for (let x = b.x0; x <= b.x1; x += 3) {
          const u = Math.round(a.x0 + (x - b.x0) / sx), v = Math.round(a.y0 + (y - b.y0) / sy);
          const inT = t.keep[y * t.W + x] === k + 1, inA = u >= 0 && u < W && v >= 0 && v < H && s.keep[v * W + u] === k + 1;
          if (inT && inA) inter++; if (inT || inA) union++;
        }
      });
      score = union ? inter / union : 0;
    }

    if (score >= .6) {
      // Form der Vorlage: Vorlage als Grund, darauf das übertragene Design – nur innerhalb des Vorlagen-Umrisses.
      const out = canvasOf(t.W, t.H), o = out.getContext('2d');
      o.drawImage(t.img, 0, 0);
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [.7, .7], [-.7, .7], [.7, -.7], [-.7, -.7]];
      maps.forEach(({a, b}, k) => {
        const part = canvasOf(W, H), pd = new ImageData(new Uint8ClampedArray(image.data), W, H);
        for (let i = 0; i < s.keep.length; i++) pd.data[i * 4 + 3] = s.keep[i] === k + 1 ? 255 : 0;
        part.getContext('2d').putImageData(pd, 0, 0);
        const layer = canvasOf(t.W, t.H), l = layer.getContext('2d');
        const aw = a.x1 - a.x0 + 1, ah = a.y1 - a.y0 + 1, bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
        const draw = (dx, dy) => l.drawImage(part, a.x0, a.y0, aw, ah, b.x0 + dx, b.y0 + dy, bw, bh);
        // Lücken füllen: leicht versetzte Kopien darunter, das eigentliche Design obenauf.
        for (const r of [18, 10, 5]) for (const [ux, uy] of DIRS) draw(ux * r, uy * r);
        draw(0, 0);
        l.globalCompositeOperation = 'destination-in'; l.drawImage(t.masks[k], 0, 0);
        o.drawImage(layer, 0, 0);
      });
      ai.close();
      const layouts = (options.layouts || []).slice();
      if (wanted.length) layouts.push(...await placeTexts(out, wanted, t.zones, (x, y) => t.keep[y * t.W + x] > 0));
      if (layouts.length) drawTexts(out, layouts, t.img);
      return {blob: await toBlob(out), layouts, locked: true, score};
    }

    // KI-Bild passt nicht sicher zur Vorlage: Bild bleibt, Texte kommen trotzdem an die richtige Stelle.
    if (!wanted.length) { ai.close(); return {blob, layouts: [], locked: false, score}; }
    const out = canvasOf(W, H); out.getContext('2d').drawImage(ai, 0, 0); ai.close();
    let zones, inside = null;
    if (maps && !cut) {
      zones = t.zones.map((z, k) => { const {a, b, sx, sy} = maps[k]; return {cx: a.x0 + (z.cx - b.x0) / sx, top: a.y0 + (z.top - b.y0) / sy, torso: z.torso / sx, h: z.h / sy}; });
      inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && s.keep[y * W + x] > 0;
    } else zones = t.zones.map(z => ({cx: z.cx * W / t.W, top: z.top * H / t.H, torso: z.torso * W / t.W, h: z.h * H / t.H}));
    const layouts = await placeTexts(out, wanted, zones, inside);
    drawTexts(out, layouts, null);
    return {blob: await toBlob(out), layouts: [], locked: false, score};
  }

  window.ShirtboxForm = {fit, extractTexts, areaName: t => AREA_NAMES[areaOf(t)]};
})();
