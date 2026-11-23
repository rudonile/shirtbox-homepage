/* ===== Eingebaut: weisser-hintergrund.js ===== */
/* ShirtBOX: Druckmotive auf total weissen Hintergrund (#FFFFFF) stellen.
   1. Transparente Bereiche werden exakt auf Weiss gerechnet (weiche Kanten bleiben weich).
   2. Ein einfarbiger heller oder grauer Hintergrund wird vom Bildrand her erkannt und
      durch reines Weiss ersetzt; die Uebergangskante wird sauber auf Weiss umgerechnet.
   Das Motiv selbst bleibt Pixel fuer Pixel unveraendert. Dunkle oder bunte Hintergruende
   (z. B. ein bewusst schwarzes Motiv) werden nicht angetastet.
   Ergebnis: {png, jpg, changed} oder null, wenn das Bild schon passt. */
(() => {
  'use strict';
  const EDGE = 60;         // Uebergangskante zwischen Motiv und Hintergrund

  // Loest ein kleines lineares Gleichungssystem (Gauss).
  function solve(A, y) {
    const n = y.length, M = A.map((r, i) => [...r, y[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  // Hintergrund als weicher Verlauf (Vignette): je Farbkanal a + bx + cy + dx^2 + ey^2 + fxy.
  function fitSurface(px, w, h, mask) {
    const A = Array.from({length: 6}, () => new Float64Array(6)), Y = [0, 1, 2].map(() => new Float64Array(6));
    const step = Math.max(1, Math.round(Math.sqrt(w * h / 40000)));
    let n = 0;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      const p = y * w + x; if (!mask[p]) continue;
      const u = 2 * x / w - 1, v = 2 * y / h - 1, f = [1, u, v, u * u, v * v, u * v];
      for (let i = 0; i < 6; i++) { for (let j = 0; j < 6; j++) A[i][j] += f[i] * f[j]; for (let k = 0; k < 3; k++) Y[k][i] += f[i] * px[p * 4 + k]; }
      n++;
    }
    if (n < 50) return null;
    const coef = Y.map(y => solve(A.map(r => [...r]), [...y]));
    if (coef.some(c => !c)) return null;
    return (x, y, k) => { const u = 2 * x / w - 1, v = 2 * y / h - 1, c = coef[k]; return c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * v * v + c[5] * u * v; };
  }

  // Arbeitet direkt auf RGBA-Pixeln (auch ohne Browser testbar). Gibt true zurueck, wenn etwas geaendert wurde.
  function whiten(px, w, h) {
    let changed = false;
    // 1. Transparenz exakt ueber Weiss legen.
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a === 255) continue;
      const f = a / 255;
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * f + 255 * (1 - f));
      px[i + 3] = 255; changed = true;
    }
    // 2. Randfarbe bestimmen; nur neutrale (graue/weisse), nicht zu dunkle Hintergruende.
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
    const neutralPx = i => Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) <= 14;
    const edgeNeutral = border.filter(p => neutralPx(p * 4));
    if (edgeNeutral.length < border.length * 0.6) return changed;
    const lum = i => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const avg = edgeNeutral.reduce((s, p) => s + lum(p * 4), 0) / edgeNeutral.length;
    if (avg < 45) return changed;
    // 3. Hintergrund-Modell: zuerst konstant, dann als Verlauf nachgefuehrt (2 Runden).
    const base = [0, 1, 2].map(k => edgeNeutral.reduce((s, p) => s + px[p * 4 + k], 0) / edgeNeutral.length);
    let model = (x, y, k) => base[k];
    let mark = new Uint8Array(w * h);
    const flat = (p, lim) => {
      const x = p % w, y = (p - x) / w, i = p * 4;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = (yy * w + xx) * 4;
        if (Math.abs(px[k] - px[i]) > lim || Math.abs(px[k + 1] - px[i + 1]) > lim || Math.abs(px[k + 2] - px[i + 2]) > lim) return false;
      }
      return true;
    };
    let mdist;
    for (let round = 0; round < 3; round++) {
      const M = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) M[(y * w + x) * 3 + k] = model(x, y, k);
      mdist = p => Math.max(Math.abs(px[p * 4] - M[p * 3]), Math.abs(px[p * 4 + 1] - M[p * 3 + 1]), Math.abs(px[p * 4 + 2] - M[p * 3 + 2]));
      const ok = p => neutralPx(p * 4) && (mdist(p) <= 8 || (mdist(p) <= 18 && flat(p, 4)));
      mark = new Uint8Array(w * h); const stack = [];
      for (const p of border) if (!mark[p] && ok(p)) { mark[p] = 1; stack.push(p); }
      while (stack.length) {
        const p = stack.pop(), x = p % w;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
          if (q < 0 || q >= w * h || mark[q] || !ok(q)) continue;
          mark[q] = 1; stack.push(q);
        }
      }
      if (round === 2) { model.cache = M; break; }
      const next = fitSurface(px, w, h, mark); if (!next) { model.cache = M; break; }
      model = next;
    }
    const M = model.cache;
    // 3b. Eingeschlossene Hintergrundstuecke (z. B. Kragen-Ausschnitt): nur sehr nahe am Modell, flach und gross genug.
    const minArea = Math.max(50, Math.round(w * h * 0.001)), seen = new Uint8Array(w * h);
    const close = p => neutralPx(p * 4) && mdist(p) <= 6 && flat(p, 3);
    for (let s = 0; s < w * h; s++) {
      if (mark[s] || seen[s] || !close(s)) continue;
      const region = [s]; seen[s] = 1;
      for (let r = 0; r < region.length; r++) {
        const p = region[r], x = p % w;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
          if (q < 0 || q >= w * h || seen[q] || mark[q] || !close(q)) continue;
          seen[q] = 1; region.push(q);
        }
      }
      if (region.length >= minArea) for (const p of region) mark[p] = 1;
    }
    // 4. Kante (2 Pixel tief) umrechnen: Mischfarbe aus Motiv + Hintergrund -> Motiv + Weiss.
    for (let ring = 2; ring <= 3; ring++) {
      for (let p = 0; p < w * h; p++) {
        if (mark[p]) continue;
        const x = p % w;
        const near = q => mark[q] === 1 || (ring === 3 && mark[q] === 2);
        if (!((x > 0 && near(p - 1)) || (x < w - 1 && near(p + 1)) || (p >= w && near(p - w)) || (p < w * (h - 1) && near(p + w)))) continue;
        const d = mdist(p); if (d >= EDGE) continue;
        const rest = 1 - d / EDGE, i = p * 4;
        for (let k = 0; k < 3; k++) px[i + k] = Math.max(0, Math.min(255, Math.round(px[i + k] + rest * (255 - M[p * 3 + k]))));
        mark[p] = ring; changed = true;
      }
    }
    for (let p = 0; p < w * h; p++) if (mark[p] === 1) {
      const i = p * 4;
      if (px[i] !== 255 || px[i + 1] !== 255 || px[i + 2] !== 255) { px[i] = px[i + 1] = px[i + 2] = 255; changed = true; }
    }
    return changed;
  }

  // Trennlinie zwischen den zwei Shirts (links Vorderseite, rechts Rueckseite).
  // Laeuft durch die weisse Luecke; beruehren sich die Shirts, folgt sie der Umrisslinie.
  // Liefert pro Bildzeile die x-Position der Trennung.
  function shirtSeam(px, w, h) {
    const ink = i => px[i] < 232 || px[i + 1] < 232 || px[i + 2] < 232; // blasse Schattenreste zaehlen nicht
    const L = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) L[p] = 0.2126 * px[p * 4] + 0.7152 * px[p * 4 + 1] + 0.0722 * px[p * 4 + 2];
    const cols = new Uint32Array(w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink((y * w + x) * 4)) cols[x]++;
    let c0 = w >> 1, mn = Infinity;
    for (let x = Math.floor(w * 0.3); x < w * 0.7; x++) if (cols[x] < mn) { mn = cols[x]; c0 = x; }
    // Bei klarer Luecke: Mitte der Luecke nehmen.
    if (mn === 0) { let a = c0, b = c0; while (a > 0 && cols[a - 1] === 0) a--; while (b < w - 1 && cols[b + 1] === 0) b++; c0 = (a + b) >> 1; }
    const x0 = Math.max(1, Math.round(c0 - w * 0.15)), x1 = Math.min(w - 2, Math.round(c0 + w * 0.15)), W = x1 - x0 + 1;
    const cost = (x, y) => {
      const p = y * w + x;
      if (!ink(p * 4)) return Math.abs(x - c0) * 0.002;
      const gx = Math.abs(L[p + 1] - L[p - 1]), gy = y > 0 && y < h - 1 ? Math.abs(L[p + w] - L[p - w]) : 0;
      return 6 + Math.max(0, 40 - (gx + gy) / 4) - (L[p] < 70 ? 20 : 0) + Math.abs(x - c0) * 0.02;
    };
    const D = new Float32Array(W * h), P = new Int8Array(W * h);
    for (let i = 0; i < W; i++) D[i] = cost(x0 + i, 0);
    for (let y = 1; y < h; y++) for (let i = 0; i < W; i++) {
      let b = D[(y - 1) * W + i], bp = 0;
      for (const d of [-2, -1, 1, 2]) { const j = i + d; if (j < 0 || j >= W) continue; const v = D[(y - 1) * W + j] + Math.abs(d) * 1.5; if (v < b) { b = v; bp = d; } }
      D[y * W + i] = b + cost(x0 + i, y); P[y * W + i] = bp;
    }
    let i = 0; for (let k = 1; k < W; k++) if (D[(h - 1) * W + k] < D[(h - 1) * W + i]) i = k;
    const path = new Int32Array(h);
    for (let y = h - 1; y >= 0; y--) { path[y] = x0 + i; i += P[y * W + i]; }
    return path;
  }

  // ---------- Kontur einer Seite ----------
  // Maske des Shirts dieser Seite: groesste zusammenhaengende Flaeche(n), Loecher gefuellt,
  // Kruemel/Ausfransungen entfernt und der graue Schatten-Randring abgetragen.
  function shirtMask(px, w, h, path, left) {
    const N = w * h, ink = i => px[i] < 250 || px[i + 1] < 250 || px[i + 2] < 250;
    const mine = p => { const x = p % w, y = (p - x) / w; return left ? x < path[y] : x >= path[y]; };
    const label = new Int32Array(N).fill(-1), sizes = [], stack = [];
    for (let s = 0; s < N; s++) {
      if (label[s] >= 0 || !mine(s) || !ink(s * 4)) continue;
      const id = sizes.length; let n = 0; label[s] = id; stack.push(s);
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p - x) / w; n++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx; if (label[q] >= 0 || !mine(q) || !ink(q * 4)) continue;
          label[q] = id; stack.push(q);
        }
      }
      sizes.push(n);
    }
    const biggest = Math.max(0, ...sizes);
    let m = new Uint8Array(N);
    for (let p = 0; p < N; p++) if (label[p] >= 0 && sizes[label[p]] >= biggest * 0.02) m[p] = 1;
    const morph = (src, grow) => { // 3x3 Erosion/Dilatation
      const out = new Uint8Array(N);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let dy = -1; dy <= 1 && v === (grow ? 0 : 1); dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, q = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[yy * w + xx];
          if (grow && q) { v = 1; break; } if (!grow && !q) { v = 0; break; }
        }
        out[y * w + x] = v;
      }
      return out;
    };
    // Loecher fuellen (weisse Stoffflaechen, Kragen-Innenseite gehoeren zum Shirt).
    const outside = new Uint8Array(N); stack.length = 0;
    for (let x = 0; x < w; x++) for (const p of [x, (h - 1) * w + x]) if (!m[p] && !outside[p]) { outside[p] = 1; stack.push(p); }
    for (let y = 0; y < h; y++) for (const p of [y * w, y * w + w - 1]) if (!m[p] && !outside[p]) { outside[p] = 1; stack.push(p); }
    while (stack.length) {
      const p = stack.pop(), x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < N && !m[q] && !outside[q]) { outside[q] = 1; stack.push(q); }
    }
    for (let p = 0; p < N; p++) if (!outside[p]) m[p] = 1;
    // Oeffnen (entfernt Kruemel und duenne Ausfransungen), dann Randring abtragen.
    m = morph(morph(m, false), true);
    // Grauen Schatten-/Umrissring Schicht fuer Schicht abtragen (max. 4 Pixel): nur farblose,
    // nicht weisse und nicht schwarze Randpixel. Stofffarben, Weiss und Schwarz bleiben.
    const grey = p => { const i = p * 4, mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]), L = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; return mx - mn <= 28 && L > 55 && L < 238; };
    for (let it = 0; it < 4; it++) {
      const drop = [];
      for (let p = 0; p < N; p++) {
        if (!m[p]) continue;
        const x = p % w;
        const edge = x === 0 || x === w - 1 || p < w || p >= N - w || !m[p - 1] || !m[p + 1] || !m[p - w] || !m[p + w];
        if (edge && grey(p)) drop.push(p);
      }
      if (!drop.length) break;
      for (const p of drop) m[p] = 0;
    }
    // Kontur professionell glaetten: kleine Einkerbungen schliessen (Closing), dann den Umriss
    // weichzeichnen und bei 50 % schneiden -> ruhige, glatte Kante ohne Ausfransungen und Zacken.
    const unit = Math.max(w, h) / 1536, S = 2; // Glaettungsstaerke (getestet: glatte Kante, Form bleibt)
    const R = Math.max(2, Math.round(3 * unit * S)), O = Math.max(2, Math.round(5 * unit * S));
    for (let k = 0; k < R; k++) m = morph(m, true);   // Einkerbungen schliessen
    for (let k = 0; k < R; k++) m = morph(m, false);
    for (let k = 0; k < O; k++) m = morph(m, false);  // Ausbuchtungen (z. B. Schuppen am Saum) abtragen
    for (let k = 0; k < O; k++) m = morph(m, true);
    const blurred = gaussBlur(Float32Array.from(m), w, h, 1, 4 * unit * S);
    for (let p = 0; p < N; p++) m[p] = blurred[p] > 0.55 ? 1 : 0;  // leicht nach innen: kein Saum
    m = morph(m, false);                                              // 1 px Sicherheitsabstand
    // Bounding Box
    let l = w, r = -1, t = h, b = -1;
    for (let p = 0; p < N; p++) if (m[p]) { const x = p % w, y = (p - x) / w; if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
    if (r < 0) { l = 0; r = w - 1; t = 0; b = h - 1; m.fill(1); }
    return {mask: m, box: {l, r, t, b}};
  }

  // ---------- Hochwertiges Vergroessern (Lanczos-3) und Nachschaerfen ----------
  const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
  const lanczos = x => (x = Math.abs(x)) < 3 ? sinc(x) * sinc(x / 3) : 0;
  function resample(src, sw, sh, ch, dw, dh) {
    const pass = (data, w, h, nw, horizontal) => { // eine Achse
      const n = horizontal ? nw : h, len = horizontal ? w : h, scale = len / (horizontal ? nw : nw);
      const outW = horizontal ? nw : w, outH = horizontal ? h : nw, out = new Float32Array(outW * outH * ch);
      const support = Math.max(1, scale) * 3;
      for (let i = 0; i < nw; i++) {
        const center = (i + 0.5) * scale - 0.5, lo = Math.max(0, Math.floor(center - support)), hi = Math.min(len - 1, Math.ceil(center + support));
        const wts = [], idx = []; let sum = 0;
        for (let j = lo; j <= hi; j++) { const v = lanczos((j - center) / Math.max(1, scale)); if (v) { wts.push(v); idx.push(j); sum += v; } }
        for (let k = 0; k < wts.length; k++) wts[k] /= sum;
        const lines = horizontal ? h : w;
        for (let line = 0; line < lines; line++) for (let c = 0; c < ch; c++) {
          let acc = 0;
          for (let k = 0; k < wts.length; k++) acc += wts[k] * (horizontal ? data[(line * w + idx[k]) * ch + c] : data[(idx[k] * w + line) * ch + c]);
          out[(horizontal ? line * outW + i : i * outW + line) * ch + c] = acc;
        }
      }
      return out;
    };
    return pass(pass(src, sw, sh, dw, true), dw, sh, dh, false);
  }
  function gaussBlur(src, w, h, ch, sigma) {
    const r = Math.ceil(sigma * 3), k = []; let s = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
      let a = 0; for (let i = -r; i <= r; i++) a += k[i + r] * src[(y * w + Math.min(w - 1, Math.max(0, x + i))) * ch + c]; tmp[(y * w + x) * ch + c] = a;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
      let a = 0; for (let i = -r; i <= r; i++) a += k[i + r] * tmp[(Math.min(h - 1, Math.max(0, y + i)) * w + x) * ch + c]; out[(y * w + x) * ch + c] = a;
    }
    return out;
  }

  // ---------- Saubere Vektor-Kontur ----------
  // Umriss der Maske als geschlossene Linie (Pixelecken), laengste Schleife = Aussenkontur.
  function outerContour(mask, w, h) {
    const W = w + 1, nxt = new Int32Array((h + 1) * W).fill(-1);
    const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (!at(x, y - 1)) nxt[y * W + x] = y * W + x + 1;
      if (!at(x + 1, y)) nxt[y * W + x + 1] = (y + 1) * W + x + 1;
      if (!at(x, y + 1)) nxt[(y + 1) * W + x + 1] = (y + 1) * W + x;
      if (!at(x - 1, y)) nxt[(y + 1) * W + x] = y * W + x;
    }
    let best = [];
    const seen = new Uint8Array(nxt.length);
    for (let s = 0; s < nxt.length; s++) {
      if (nxt[s] < 0 || seen[s]) continue;
      const loop = []; let c = s, guard = 0;
      while (!seen[c] && nxt[c] >= 0 && guard++ < nxt.length) { seen[c] = 1; loop.push([c % W, (c - c % W) / W]); c = nxt[c]; }
      if (loop.length > best.length) best = loop;
    }
    return best;
  }
  // Treppen glaetten, dann vereinfachen (gerade Strecken werden gerade Linien).
  function simplifyContour(pts, tol) {
    const n = pts.length; if (n < 8) return pts;
    const k = 4, sm = [];
    for (let i = 0; i < n; i++) { let x = 0, y = 0; for (let j = -k; j <= k; j++) { const q = pts[(i + j + n) % n]; x += q[0]; y += q[1]; } sm.push([x / (2 * k + 1), y / (2 * k + 1)]); }
    const rdp = arr => {
      const keep = new Uint8Array(arr.length); keep[0] = keep[arr.length - 1] = 1; const st = [[0, arr.length - 1]];
      while (st.length) {
        const [a, b] = st.pop(), A = arr[a], B = arr[b], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
        let md = 0, mi = -1;
        for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * arr[i][0] - dx * arr[i][1] + B[0] * A[1] - B[1] * A[0]) / L; if (d > md) { md = d; mi = i; } }
        if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
      }
      return arr.filter((_, i) => keep[i]);
    };
    let far = 0, fd = 0; for (let i = 1; i < n; i++) { const d = (sm[i][0] - sm[0][0]) ** 2 + (sm[i][1] - sm[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
    const a = rdp(sm.slice(0, far + 1)), b = rdp([...sm.slice(far), sm[0]]);
    return [...a.slice(0, -1), ...b.slice(0, -1)];
  }
  // Sanfte Kurven an flachen Knicken, Ecken nur minimal abrunden (Chaikin mit begrenztem Schnitt).
  function roundContour(pts, soft, sharp, iterations) {
    let p = pts;
    for (let it = 0; it < iterations; it++) {
      const out = [], n = p.length;
      for (let i = 0; i < n; i++) {
        const A = p[(i - 1 + n) % n], B = p[i], C = p[(i + 1) % n];
        const v1 = [B[0] - A[0], B[1] - A[1]], v2 = [C[0] - B[0], C[1] - B[1]], l1 = Math.hypot(...v1) || 1, l2 = Math.hypot(...v2) || 1;
        const turn = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2))));
        const cut = turn > 0.9 ? sharp : soft;                           // >~50 Grad = Ecke
        const c1 = Math.min(l1 * 0.3, cut), c2 = Math.min(l2 * 0.3, cut);
        out.push([B[0] - v1[0] / l1 * c1, B[1] - v1[1] / l1 * c1], [B[0] + v2[0] / l2 * c2, B[1] + v2[1] / l2 * c2]);
      }
      p = out;
    }
    return p;
  }
  // Polygon kantengeglaettet rastern (4 Unterzeilen, exakte horizontale Abdeckung).
  function rasterPolygon(poly, w, h) {
    const cov = new Float32Array(w * h), SUB = 4, n = poly.length;
    for (let y = 0; y < h; y++) for (let sy = 0; sy < SUB; sy++) {
      const yy = y + (sy + 0.5) / SUB, xs = [];
      for (let i = 0; i < n; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
        if ((y1 <= yy && y2 > yy) || (y2 <= yy && y1 > yy)) xs.push(x1 + (yy - y1) / (y2 - y1) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = Math.max(0, xs[i]), b = Math.min(w, xs[i + 1]); if (b <= a) continue;
        const ia = Math.floor(a), ib = Math.floor(b), row = y * w;
        if (ia === ib) { cov[row + ia] += (b - a) / SUB; continue; }
        cov[row + ia] += (ia + 1 - a) / SUB;
        for (let x = ia + 1; x < ib && x < w; x++) cov[row + x] += 1 / SUB;
        if (ib < w) cov[row + ib] += (b - ib) / SUB;
      }
    }
    return cov;
  }

  // Druckbild einer Seite: Shirt sauber freigestellt auf Weiss, vergroessert und nachgeschaerft.
  // Ergebnis: RGBA-Pixel (deckend) in Zielgroesse.
  function printSide(px, w, h, path, left, targetH) {
    const {mask, box} = shirtMask(px, w, h, path, left);
    const pad = Math.round(Math.max(box.r - box.l, box.b - box.t) * 0.02);
    const X = Math.max(0, box.l - pad), Y = Math.max(0, box.t - pad);
    const cw = Math.min(w, box.r + pad + 1) - X, chh = Math.min(h, box.b + pad + 1) - Y;
    // Farbe ausserhalb der Maske mit naechster Shirtfarbe auffuellen, damit beim Vergroessern kein Grau einblutet.
    const rgb = new Float32Array(cw * chh * 3), alpha = new Float32Array(cw * chh), filled = new Uint8Array(cw * chh), queue = [];
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
      const p = (Y + y) * w + X + x, d = y * cw + x;
      if (mask[p]) { rgb[d * 3] = px[p * 4]; rgb[d * 3 + 1] = px[p * 4 + 1]; rgb[d * 3 + 2] = px[p * 4 + 2]; alpha[d] = 1; filled[d] = 1; queue.push(d); }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const d = queue[qi], x = d % cw;
      for (const n of [x > 0 ? d - 1 : -1, x < cw - 1 ? d + 1 : -1, d - cw, d + cw]) {
        if (n < 0 || n >= cw * chh || filled[n]) continue;
        filled[n] = 1; rgb[n * 3] = rgb[d * 3]; rgb[n * 3 + 1] = rgb[d * 3 + 1]; rgb[n * 3 + 2] = rgb[d * 3 + 2]; queue.push(n);
      }
    }
    const scale = Math.max(1, Math.min(3, targetH / chh));
    const dw = Math.round(cw * scale), dh = Math.round(chh * scale);
    let big = scale > 1 ? resample(rgb, cw, chh, 3, dw, dh) : rgb;
    // Saubere Kante: Umriss nachziehen, Fransen ausgleichen (gerade Strecken bleiben gerade,
    // Rundungen werden gleichmaessige Kurven) und in Zielgroesse kantengeglaettet zeichnen.
    const cropMask = new Uint8Array(cw * chh);
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) cropMask[y * cw + x] = mask[(Y + y) * w + X + x];
    const unit = Math.max(w, h) / 1536;
    let poly = simplifyContour(outerContour(cropMask, cw, chh), 3 * unit);
    poly = roundContour(poly, 10 * unit, 1.5 * unit, 3);
    const sx = dw / cw, sy = dh / chh;
    const bigA = rasterPolygon(poly.map(([x, y]) => [x * sx, y * sy]), dw, dh);
    // Nachschaerfen (Unscharf maskieren), dezent, ohne Rauschen zu verstaerken.
    // Schaerfen in zwei Stufen: feine Details (kleiner Radius) und Konturen (groesserer Radius).
    // Schwelle verhindert, dass Rauschen in Flaechen verstaerkt wird.
    const SH = {a1: 1.2, a2: 0.5, t: 2}; // getestet: deutlich schaerfer, ohne Halos
    const blur = gaussBlur(big, dw, dh, 3, Math.max(0.8, scale * 0.6)), amount = SH.a1, thresh = SH.t;
    const blur2 = SH.a2 ? gaussBlur(big, dw, dh, 3, Math.max(2, scale * 1.6)) : null;
    const out = new Uint8ClampedArray(dw * dh * 4);
    for (let i = 0; i < dw * dh; i++) {
      const a = Math.max(0, Math.min(1, bigA[i]));
      for (let c = 0; c < 3; c++) {
        const v = big[i * 3 + c], diff = v - blur[i * 3 + c];
        let sharp = Math.abs(diff) > thresh ? v + amount * diff : v;
        if (blur2) { const d2 = v - blur2[i * 3 + c]; if (Math.abs(d2) > thresh * 2) sharp += SH.a2 * d2; }
        out[i * 4 + c] = Math.round(sharp * a + 255 * (1 - a));
      }
      out[i * 4 + 3] = 255;
    }
    return {data: out, w: dw, h: dh};
  }

  // ---------- Dateien: PNG (pHYs), JPEG (dpi), PDF ----------
  const MAX_W_MM = 400, MAX_H_MM = 500;
  const mmPerPx = (w, h) => Math.min(MAX_W_MM / w, MAX_H_MM / h);
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (const v of b) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const concat = parts => { const o = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
  function pngPrintSize(b, w, h) {
    const ppm = Math.round(1000 / mmPerPx(w, h)), c = new Uint8Array(21), dv = new DataView(c.buffer);
    dv.setUint32(0, 9); c.set([112, 72, 89, 115], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); c[16] = 1; dv.setUint32(17, crc32(c.subarray(4, 17)));
    const src = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [b.subarray(0, 8)]; let p = 8;
    while (p + 8 <= b.length) {
      const len = src.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]), end = p + 12 + len;
      if (type !== 'pHYs') out.push(b.subarray(p, end)); if (type === 'IHDR') out.push(c); if (type === 'IEND') break; p = end;
    }
    return concat(out);
  }
  function jpegPrintSize(b, w, h) {
    const dpi = Math.max(1, Math.min(65535, Math.round(25.4 / mmPerPx(w, h))));
    if (b[2] === 0xFF && b[3] === 0xE0 && b[6] === 0x4A && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46) { const o = b.slice(); o[13] = 1; o[14] = dpi >> 8; o[15] = dpi & 255; o[16] = dpi >> 8; o[17] = dpi & 255; return o; }
    return concat([b.subarray(0, 2), new Uint8Array([0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]), b.subarray(2)]);
  }
  // PDF mit dem JPEG (Qualitaet 100) als Bild, Seite exakt in Druckgroesse.
  function pdfFromJpeg(jpg, w, h, title) {
    const enc = new TextEncoder(), s = mmPerPx(w, h), pt = mm => +(mm * 72 / 25.4).toFixed(3), W = pt(w * s), H = pt(h * s);
    const content = enc.encode(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`);
    const stream = (dict, data) => [enc.encode(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, enc.encode('\nendstream')];
    const objs = [[enc.encode('<< /Type /Catalog /Pages 2 0 R >>')], [enc.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')],
      [enc.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /TrimBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`)],
      stream('', content), stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, jpg),
      [enc.encode(`<< /Producer (ShirtBOX) /Title (${title} ${Math.round(w * s)} x ${Math.round(h * s)} mm) >>`)]];
    const parts = [enc.encode('%PDF-1.4\n'), new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])];
    let off = parts[0].length + parts[1].length; const offs = [];
    objs.forEach((chunks, i) => { offs.push(off); const hd = enc.encode(`${i + 1} 0 obj\n`), tl = enc.encode('\nendobj\n'); parts.push(hd, ...chunks, tl); off += hd.length + tl.length + chunks.reduce((a, c) => a + c.length, 0); });
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; for (const o of offs) x += `${String(o).padStart(10, '0')} 00000 n \n`;
    x += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${off}\n%%EOF\n`;
    parts.push(enc.encode(x));
    return concat(parts);
  }

  const pause = () => new Promise(r => setTimeout(r)); // Browser zwischendurch atmen lassen

  // Shirt-Bild -> {front, back}: je {png, jpg, pdf} (Blobs), weisser Hintergrund, saubere Kante,
  // vergroessert/nachgeschaerft und mit Druckgroesse (passt in 40 x 50 cm).
  async function split(file, opt = {}) {
    const targetH = opt.targetHeight || 1600;            // PNG + JPEG
    const pdfH = Math.max(targetH, opt.pdfHeight || 2800); // PDF in hoher Aufloesung
    const bitmap = await createImageBitmap(file, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
    try {
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', {willReadFrequently: true});
      if (!ctx) throw Error('Canvas nicht verfuegbar');
      ctx.drawImage(bitmap, 0, 0);
      const w = canvas.width, h = canvas.height, px = ctx.getImageData(0, 0, w, h).data;
      whiten(px, w, h); await pause();
      const path = shirtSeam(px, w, h), out = {};
      for (const [side, left, label] of [['front', true, 'Vorderseite'], ['back', false, 'Rueckseite']]) {
        await pause();
        const img = printSide(px, w, h, path, left, pdfH);
        const big = document.createElement('canvas'); big.width = img.w; big.height = img.h;
        big.getContext('2d').putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
        // PNG/JPEG: hochwertig verkleinert (bleibt scharf), PDF: volle hohe Aufloesung.
        const f = Math.min(1, targetH / img.h), sw = Math.round(img.w * f), shh = Math.round(img.h * f);
        const small = document.createElement('canvas'); small.width = sw; small.height = shh;
        const sctx = small.getContext('2d'); sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(big, 0, 0, sw, shh);
        const blob = (c, type, q) => new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(Error('Bild konnte nicht gespeichert werden')), type, q));
        const bytes = async b => new Uint8Array(await b.arrayBuffer());
        const png = pngPrintSize(await bytes(await blob(small, 'image/png')), sw, shh);
        const jpg = jpegPrintSize(await bytes(await blob(small, 'image/jpeg', 1.0)), sw, shh);
        const pdfJpg = jpegPrintSize(await bytes(await blob(big, 'image/jpeg', 1.0)), img.w, img.h);
        const pdf = pdfFromJpeg(pdfJpg, img.w, img.h, `ShirtBOX ${label}`);
        const s = mmPerPx(sw, shh);
        out[side] = {png: new Blob([png], {type: 'image/png'}), jpg: new Blob([jpg], {type: 'image/jpeg'}), pdf: new Blob([pdf], {type: 'application/pdf'}),
          size: `${(sw * s / 10).toFixed(1)} x ${(shh * s / 10).toFixed(1)} cm, PNG/JPEG ${sw} x ${shh} px, PDF ${img.w} x ${img.h} px`};
      }
      return out;
    } finally { bitmap.close(); }
  }

  if (typeof window !== 'undefined') window.ShirtboxWhite = {split, whiten, shirtSeam, printSide};
  if (typeof module !== 'undefined') module.exports = {whiten, shirtSeam, printSide, pngPrintSize, jpegPrintSize, pdfFromJpeg, outerContour, simplifyContour, roundContour, rasterPolygon};
})();
/* ===== Ende weisser-hintergrund.js ===== */

(() => {
  'use strict';
  const form = document.getElementById('bestellung');
  const api = window.ShirtboxOrder;
  const list = document.getElementById('design-list');
  const submit = document.getElementById('absenden');
  const status = document.getElementById('formular-status');
  const phone = document.getElementById('telefon');
  const prefix = document.getElementById('vorwahl');
  const online = ['https:', 'http:'].includes(location.protocol);
  // Gestaltete Kundenbestätigung mit Shirt-Bildern; bei Fehler übernimmt die FormSubmit-Autoantwort.
  const MAIL_API = 'https://shirtbox-email.r-n.workers.dev/bestaetigung';
  const designs = new Map();
  let nextSlot = 0;
  const money = api.money;
  function message(text) { status.textContent = text; status.hidden = !text; }
  function snapshot() {
    return [...designs.values()].map(state => ({slot: state.slot, filename: state.file.files[0]?.name || '', rows: [...state.card.querySelectorAll('.design-size-row')].map(row => ({size: row.querySelector('select').value, quantity: row.querySelector('input').value}))}));
  }
  function cell(row, text) { const td = document.createElement('td'); td.textContent = text; row.append(td); }
  function refresh() {
    const order = api.calculate(snapshot());
    const body = document.getElementById('order-summary-body'); body.replaceChildren();
    [...designs.values()].forEach((state, index) => {
      const item = order.designs[index];
      const title=state.card.querySelector('.design-title');title.textContent=`Design ${state.designNumber || index + 1} – Ihr Shirt `;if(state.previewUrl){const mini=document.createElement('img');mini.src=state.previewUrl;mini.alt='Design vergrössern';mini.title='Zum Vergrössern anklicken';mini.style.cssText='width:76px;height:76px;object-fit:contain;vertical-align:middle;margin-left:14px;border-radius:8px;cursor:zoom-in;background:#fff';mini.addEventListener('click',()=>showDesign(state));title.append(mini);}
      state.card.querySelector('.design-subtotal').textContent = `${item.quantity} Shirt${item.quantity === 1 ? '' : 's'} · ${money(item.subtotal)}`;
      const rows = [...state.card.querySelectorAll('.design-size-row')];
      state.card.querySelector('.add-size').disabled = rows.length >= api.SIZES.length;
      rows.forEach(row => row.querySelector('.remove-size').disabled = rows.length === 1);
      const used = new Set();
      for (const row of rows) {
        const size = row.querySelector('select');
        size.setCustomValidity(size.value && used.has(size.value) ? 'Diese Grösse ist bei diesem Design bereits vorhanden.' : '');
        if (size.value) used.add(size.value);
      }
      state.card.querySelector('.design-data').value = `Datei: ${item.filename || 'fehlt'}\n${item.rows.map(row => `${row.size ? row.size : 'Grösse fehlt'}: ${row.quantity || 0} Stück`).join(', ')}\nZwischensumme: ${money(item.subtotal)}`;
      const tr = document.createElement('tr');
      const shirtCell=document.createElement('td'); const viewButton=document.createElement('button'); viewButton.type='button'; viewButton.className='order-view-design'; viewButton.textContent=item.filename ? `Design ${state.designNumber || index + 1}` : 'Noch kein Entwurf'; viewButton.disabled=!state.previewUrl; viewButton.addEventListener('click',()=>showDesign(state)); if(state.previewUrl){const thumb=document.createElement('img');thumb.src=state.previewUrl;thumb.alt='T-Shirt Design '+(state.designNumber||index+1);thumb.style.cssText='display:block;width:390px;max-width:100%;max-height:450px;object-fit:contain;margin:0 auto 8px;cursor:zoom-in;border-radius:8px';thumb.addEventListener('click',()=>showDesign(state));shirtCell.append(thumb);}shirtCell.append(viewButton);const editLink=document.createElement('a');editLink.href='designhilfe.html?weiterbearbeiten='+encodeURIComponent(state.designNumber||index+1);editLink.textContent='✎ Design '+(state.designNumber||index+1)+' mit KI bearbeiten und zurück zur Bestellung';editLink.style.cssText='display:block;margin-top:8px;color:#27b6ff';editLink.addEventListener('click',saveDetails);shirtCell.append(editLink);tr.append(shirtCell);
      cell(tr, item.rows.map(row => `${row.size ? row.size : '–'} × ${row.quantity || '–'}`).join(', '));
      cell(tr, String(item.quantity)); cell(tr, money(item.subtotal)); body.append(tr);
    });
    document.getElementById('summary-quantity').textContent = `${order.quantity} Shirt${order.quantity === 1 ? '' : 's'}`;
    document.getElementById('summary-total').textContent = money(order.total);
    const totalLabel = document.getElementById('gesamt');
    if (totalLabel) totalLabel.textContent = order.valid ? `Gesamtbetrag: ${money(order.total)}` : 'Bitte Grössen und Stückzahlen eintragen';
    document.getElementById('gesamt-feld').value = order.valid ? String(order.total) : '';
    document.getElementById('gesamt-anzahl').value = order.valid ? String(order.quantity) : '';
    document.getElementById('bestell-details').value = api.description(order);
    document.getElementById('antwort-mail').value = order.valid ? api.email(order) : 'Vielen Dank für Ihre ShirtBOX-Bestellung!';
    if (online) {
      const next = new URL('danke.html', location.href);
      if (order.valid) next.searchParams.set('anzahl', String(order.quantity));
      document.getElementById('weiter').value = next.href;
    }
    const validation = document.getElementById('design-validation');
    validation.textContent = order.errors.join(' '); validation.hidden = !order.errors.length; validation.dataset.state = 'error';
    const filesReady = designs.size>0 && [...designs.values()].every(state => Boolean(state.file.files[0]));
    for (const field of form.querySelectorAll('[required]')) {
      if (!['file', 'number', 'checkbox'].includes(field.type) && field.tagName !== 'SELECT') field.setCustomValidity(field.value.trim() ? '' : 'Bitte dieses Pflichtfeld ausfüllen.');
    }
    let number = phone.value.replace(/[^0-9]/g, '');
    phone.setCustomValidity(number.length >= 4 && number.length <= 15 ? '' : 'Bitte eine gültige Telefonnummer ohne Ländervorwahl eingeben.');
    if (prefix.value !== '+39') number = number.replace(/^0+/, '');
    document.getElementById('telefon-komplett').value = `${prefix.value} ${number}`;
    const ready = online && order.valid && filesReady && [...form.querySelectorAll('[required]')].every(field => field.validity.valid);
    submit.disabled = false; submit.setAttribute('aria-disabled', String(!ready));
    return {order, valid: ready};
  }
  function addSize(state, values = {}) {
    if (state.card.querySelectorAll('.design-size-row').length >= api.SIZES.length) return;
    const row = document.createElement('div'); row.className = 'design-size-row';
    row.innerHTML = `<div class="field"><label>Gewohnte Grösse *<select required><option value="">Bitte wählen</option>${api.SIZES.map(size => `<option value="${size}">${size}</option>`).join('')}</select></label></div><div class="field"><label>Stückzahl *<input type="number" min="1" step="1" required inputmode="numeric" placeholder="Anzahl"></label></div><button class="remove-size" type="button" aria-label="Diese Grössenzeile entfernen">×</button>`;
    // The named design summary carries all size rows together with the matching file slot.
    row.querySelector('select').value = values.size || '';
    
    row.querySelector('input').value = values.quantity || '';
    row.querySelector('.remove-size').addEventListener('click', () => { if (state.card.querySelectorAll('.design-size-row').length > 1) { row.remove(); refresh(); } });
    state.card.querySelector('.design-size-list').append(row);
  }
  function releasePreview(state) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = '';
    state.preview.removeAttribute('src'); state.preview.hidden = true; state.preview.style.display='none';
  }
  function selectFile(state) {
    const file = state.file.files[0] || null;
    state.designNumber = Number(file?.name.match(/shirtbox-design-(\d+)\.(?:jpe?g|png)$/i)?.[1]) || state.slot;
    state.rights.checked = false; releasePreview(state);
    state.card.querySelector('.order-inline-view').hidden = !file;
    state.card.querySelector('.order-inline-edit').hidden = !file;
    state.card.querySelector('.design-heading-actions').hidden = !file;
    state.filename.textContent = file ? `Design ${state.designNumber}` : 'Bitte zuerst Ihren Entwurf im Shirt-Designer übernehmen.';
    if (file && (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif|tiff?)$/i.test(file.name))) {
      state.previewUrl = URL.createObjectURL(file); state.preview.src = state.previewUrl; state.preview.hidden = false; state.preview.style.display='block'; state.preview.style.width='100%'; state.preview.style.maxHeight='520px'; state.preview.style.objectFit='contain'; state.preview.onerror=()=>{state.filename.textContent='Bildvorschau konnte nicht geladen werden.';};
      state.card.querySelector('.order-inline-edit').href=`designhilfe.html?weiterbearbeiten=${encodeURIComponent(state.designNumber)}`;
      state.card.querySelector('.design-heading-edit').href=state.card.querySelector('.order-inline-edit').href;
    }
    refresh();
  }
  function showDesign(state) {
    if (!state.previewUrl) return;
    const modal=document.getElementById('order-design-modal');
    modal.querySelector('img').src=state.previewUrl;
    modal.querySelector('.order-design-edit').href=`designhilfe.html?weiterbearbeiten=${encodeURIComponent(state.designNumber || state.slot)}`;
    if(typeof modal.showModal==='function') modal.showModal();
  }
  function addDesign() {
    const slot = ++nextSlot;
    const card = document.createElement('section'); card.className = 'order-design'; card.setAttribute('aria-labelledby', `design-${slot}-title`);
    card.innerHTML = `<div class="design-heading-row"><h3 class="design-title" id="design-${slot}-title">Ihr Shirt</h3><div class="design-heading-actions" hidden><button type="button" class="design-heading-zoom">🔍 Vergrössern</button><a class="design-heading-edit" href="designhilfe.html">✏️ Hier T-Shirt ändern</a></div></div><input id="design-${slot}-file" name="attachment_design_${slot}" type="file" accept="image/jpeg" hidden tabindex="-1" aria-hidden="true"><div class="design-file-preview"><img hidden alt="Ihr übernommener Shirt-Entwurf"><p class="design-filename">Bitte zuerst Ihren Entwurf im Shirt-Designer übernehmen.</p><button type="button" class="order-inline-view" hidden aria-hidden="true" tabindex="-1">🔍 Vergrössern</button><a class="order-inline-edit" href="designhilfe.html" hidden aria-hidden="true" tabindex="-1">✎ Mit KI weiterbearbeiten</a></div><div class="design-size-list"></div><button class="add-size" type="button">+ Weitere Grösse</button><div class="design-subtotal"></div><div class="agb-consent"><input id="design-${slot}-rights" name="Design_${slot}_Rechte_und_Inhalte" type="checkbox" value="Ja – erforderliche Rechte vorhanden und Inhaltsvorgaben eingehalten" required><label for="design-${slot}-rights">Ich bestätige die erforderlichen Nutzungs- und Bildrechte sowie zulässige Inhalte für meinen Entwurf. *</label></div><textarea class="design-data" name="Design_${slot}_Datei_und_Stückzahlen" hidden></textarea>`;
    const state = {slot, card, previewUrl: '', file: card.querySelector('input[type=file]'), rights: card.querySelector('input[type=checkbox]'), preview: card.querySelector('img'), filename: card.querySelector('.design-filename')};
    designs.set(slot, state); list.append(card); addSize(state, {quantity:1});
    state.preview.style.cursor='zoom-in'; state.preview.tabIndex=0; state.preview.setAttribute('role','button'); state.preview.setAttribute('aria-label','Design gross ansehen'); state.preview.addEventListener('click',()=>showDesign(state)); state.preview.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showDesign(state);}});
    state.card.querySelector('.order-inline-view').addEventListener('click',()=>showDesign(state));
    state.card.querySelector('.design-heading-zoom').addEventListener('click',()=>showDesign(state));
    state.card.querySelector('.design-heading-edit').addEventListener('click',saveDetails);
    state.card.querySelector('.order-inline-edit').addEventListener('click',saveDetails);
    state.file.addEventListener('change', () => selectFile(state));
    card.querySelector('.add-size').addEventListener('click', () => { addSize(state); refresh(); });
    const actions=document.createElement('div');actions.className='order-design-actions';const editAction=card.querySelector('.order-inline-edit');editAction.hidden=false;editAction.removeAttribute('aria-hidden');editAction.removeAttribute('tabindex');actions.append(editAction);card.querySelector('.design-size-list').before(actions);
    // Grössenhinweis und Grössentabelle direkt über der Grössenauswahl.
    const sizeHelp=document.createElement('div');sizeHelp.className='order-size-help';card.querySelector('.design-size-list').before(sizeHelp);
    const asianNote=document.createElement('span');asianNote.className='asian-size-notice';asianNote.textContent='Asiatische Grössen – wir bestellen automatisch zwei Grössen grösser.';sizeHelp.append(asianNote);
    const guideTemplate=document.getElementById('shirtbox-size-guide-template');if(guideTemplate){const guide=guideTemplate.content.firstElementChild.cloneNode(true);guide.removeAttribute('id');sizeHelp.append(guide);}
    const remove=document.createElement('button');remove.type='button';remove.className='remove-design';remove.textContent='✕ Entfernen';remove.title='Dieses Design aus der Bestellung löschen';actions.append(remove);remove.addEventListener('click',async()=>{if(!confirm('Sind Sie sicher, dass Sie dieses Design aus der Bestellung löschen wollen?'))return;const number=state.designNumber;releasePreview(state);designs.delete(slot);card.remove();try{const saved=await window.ShirtboxDesignTransfer.load();if(saved){const blobs=(saved.blobs||[saved.blob]).filter((item,i)=>(item.number||i+1)!==number);if(blobs.length)await window.ShirtboxDesignTransfer.save(blobs);else await window.ShirtboxDesignTransfer.clear();}}catch{}try{const details=JSON.parse(sessionStorage.getItem(detailKey)||'{}');delete details[number];sessionStorage.setItem(detailKey,JSON.stringify(details));}catch{}refresh();window.ShirtboxRefreshOrderLink?.();});
    refresh();
    return state;
  }
  function attachOriginals(input, originals, placement) {
    const state=[...designs.values()].find(d=>d.file===input);if(!state)return;
    state.card.querySelectorAll('.print-original').forEach(el=>el.remove());
    if(!originals.length&&!placement)return;
    const data=document.createElement('textarea');data.hidden=true;data.className='print-original';data.name=`Design_${state.slot}_Bildplatzierungen`;data.value=placement;state.card.append(data);
    originals.forEach((item,i)=>{
      const file=item.file;
      if(!(file instanceof Blob))throw Error('Originalbild fehlt');
      const side=String(item.region||'').toLowerCase();
      const label=side==='front'?'Vorderseite':side==='back'?'Rueckseite':side==='left'?'Linker-Aermel':side==='right'?'Rechter-Aermel':'Nicht-zugeordnet';
      const field=document.createElement('input');field.type='file';field.hidden=true;field.className='print-original';
      field.name=`attachment_original_${state.slot}_${i+1}`;
      const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
      const transfer=new DataTransfer();
      transfer.items.add(new File([file],`Design-${state.designNumber}-${label}-Original-${i+1}.${ext}`,{type:file.type}));
      field.files=transfer.files;state.card.append(field);
    });
    const note=document.createElement('p');note.className='print-original';note.textContent=originals.length?`${originals.length} Originalbild${originals.length===1?'':'er'} und Platzierungsangaben für den Druck beigefügt.`:'Shirt-Farbe und Gestaltungseinstellungen für den Druck beigefügt.';state.card.append(note);
  }
  function attachSidePrints(input, sidePrints, uploadOnly=false) {
    const state=[...designs.values()].find(d=>d.file===input);
    if(state){
      state.sidePrints=sidePrints;
      state.uploadOnly=uploadOnly;
      const front=sidePrints?.front, back=sidePrints?.back;
      const good=v=>v instanceof Blob && v.size>0 && ['image/png','image/jpeg','image/webp'].includes(v.type);
      let status=state.card.querySelector('.shirtbox-print-status');
      if(!status){status=document.createElement('p');status.className='shirtbox-print-status';status.style.cssText='font-size:13px;font-weight:700;margin:10px 0;line-height:1.5';state.card.querySelector('.design-file-preview')?.append(status);}
      if(status){
        // Vorder-/Rueckseite werden beim Absenden direkt aus dem Shirt-Bild geschnitten.
        status.textContent=uploadOnly?'Eigene Bilder: Originaldateien für den Druck werden übernommen.':'✓ Vorder- und Rückseite werden beim Bestellen als separate Druckdateien erstellt.';
        status.style.color='#31d68a';
        state.printsMissing=false;
      }
    }
  }
  // Verkleinerte Kopie des Entwurfs für die Bestätigungsmail (die Druckdatei bleibt unverändert).
  async function mailImage(file) {
    const bitmap = await createImageBitmap(file), scale = Math.min(1, 1100 / bitmap.width);
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Bild')), 'image/jpeg', .85));
  }
  // Eine PNG-Datei aus der vorhandenen Bildquelle erstellen (ohne neue Details zu erfinden).
  async function pngImage(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return await new Promise((resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(blob) : reject(Error('PNG-Konvertierung fehlgeschlagen')),
        'image/png'
      ));
    } finally { bitmap.close(); }
  }
  async function jpegImage(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return await new Promise((resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(blob) : reject(Error('JPEG-Konvertierung fehlgeschlagen')),
        'image/jpeg', 1.0));
    } finally { bitmap.close(); }
  }
  // Druckvorlagen der vom Kunden einzeln hochgeladenen Vorder-/Rueckseiten.
  // Keine Ausschnitte aus der Polo-Vorschau als vermeintliche Druckdateien.
  async function attachSideOriginals(body, slot, state) {
    const fields = [...state.card.querySelectorAll('input.print-original[type="file"]')];
    let total = 0;
    for (const field of fields) {
      const original = field.files?.[0];
      if (!original) continue;
      const match = original.name.match(/-(Vorderseite|Rueckseite)-Original-/i);
      const side = match?.[1];
      // Unbekannte Platzierung: Original erhalten, aber keine Druckseite erfinden.
      if (!side) {
        body.append(`original_${slot}`, original, original.name);
        total += original.size;
        continue;
      }
      // Kunden-Original unveraendert als Zusatz fuer die Bestellmail.
      const ext = original.type === 'image/png' ? 'png' : original.type === 'image/webp' ? 'webp' : 'jpg';
      if (original.size > 12 * 1024 * 1024) throw Error(`${side}: Originalbild ist groesser als 12 MB.`);
      body.append(`original_${slot}`, original, `ShirtBOX_Design-${state.designNumber}_Kunde-Original-${side}.${ext}`);
      total += original.size;
    }
    return total;
  }
  // Schickt Bestellung, Druckdateien und Originalbilder an den Worker. Er versendet die interne Mail und die Kundenbestätigung.
  function getOrderId(){let id=sessionStorage.getItem('shirtbox-order-id');if(!id){id=crypto.randomUUID();sessionStorage.setItem('shirtbox-order-id',id);}return id;}
  // Shirt-Bild teilen und auf total weissen Hintergrund stellen (weisser-hintergrund.js).
  // Das Modul ist oben in dieser Datei eingebaut; es wird nichts nachgeladen.
  async function whiteModule() {
    if (typeof window.ShirtboxWhite?.split === 'function') return window.ShirtboxWhite;
    throw Error('Vorder-/Rueckseiten-Modul fehlt. Bitte die aktuelle formular.js veröffentlichen.');
  }
  async function sendConfirmation(order) {
    const states = [...designs.values()], value = id => document.getElementById(id).value.trim();
    // Bei KI-Entwürfen darf eine blosse Shirt-Vorschau nicht als Druckdatei gelten.
    // Vorder-/Rueckseite werden direkt aus dem Shirt-Bild geschnitten; fehlende KI-Einzelmotive blockieren nicht mehr.
    const body = new FormData();
    body.set('bestell-id', getOrderId());
    body.set('cf-turnstile-response', window.turnstile?.getResponse() || '');
    body.set('bestellung', JSON.stringify({
      kunde: {vorname: value('vorname'), nachname: value('nachname'), email: value('email'), telefon: value('telefon-komplett'), strasse: value('strasse'), plz: value('plz'), ort: value('ort'), land: value('land')},
      agb: document.getElementById('agb-zustimmung').checked ? document.getElementById('agb-zustimmung').value : '',
      newsletter: document.getElementById('newsletter-zustimmung')?.checked === true, newsletter_text: document.getElementById('newsletter-text')?.textContent.trim() || '',
      designs: order.designs.map((item, i) => ({nummer: states[i].designNumber || item.number, rechte: states[i].rights.checked, platzierung: states[i].card.querySelector('textarea.print-original')?.value || '', groessen: item.rows.map(row => ({groesse: row.size, anzahl: Number(row.quantity)}))}))
    }));
    let size = 0;
    for (const [i, state] of states.entries()) {
      const file = state.file.files[0];
      // Druckdatei: exakt das bestellte Design in Originalauflösung und verlustfrei (PNG) – nicht verkleinert, nicht aufgefüllt.
      if (file) {
        // Die Druckdatei immer als PNG mitsenden. Keine kuenstliche Hochskalierung.
        const printPng = file.type === 'image/png' ? file : await pngImage(file);
        body.set(`druck_${i}`, printPng, `ShirtBOX_Design-${i + 1}_Druckdatei.png`);
        // Bestellmail: nur EIN Anhang pro Design (das Shirt-Bild als PNG). Die getrennten
        // Vorder-/Rueckseiten kommen ausschliesslich ins Mail "Zum Weiterleiten".
        size += printPng.size;
        body.set(`bild_${i}`, await mailImage(file), `design-${i + 1}.jpg`);
        // Shirt-Bild auseinanderschneiden: links Vorderseite, rechts Rueckseite.
        // Weisser Hintergrund, saubere Kante, hochwertig vergroessert + nachgeschaerft,
        // je als PNG, JPEG (100 %) und PDF mit Druckgroesse (passend in 40 x 50 cm).
        // Bei vielen Shirts etwas kleiner, damit die Mails nicht zu gross werden.
        const targetHeight = states.length <= 2 ? 1600 : states.length === 3 ? 1300 : 1000;
        const pdfHeight = states.length <= 2 ? 2800 : states.length === 3 ? 2000 : 1600;
        const parts = await (await whiteModule()).split(file, {targetHeight, pdfHeight});
        for (const [side, label] of [['front', 'Vorderseite'], ['back', 'Rueckseite']]) {
          for (const ext of ['png', 'jpg', 'pdf']) {
            const blob = parts[side][ext];
            if (blob.size > 12 * 1024 * 1024) throw Error(label + ': Druckdatei zu gross.');
            body.append(`original_${i}`, blob, `ShirtBOX_Design-${i + 1}_${label}.${ext}`);
            size += blob.size;
          }
        }
      }
      size += await attachSideOriginals(body, i, state);
    }
    if (size > 38 * 1024 * 1024) throw Error('Die Druckdateien sind zusammen zu gross fuer den Mailversand (38 MB). Bitte weniger Designs pro Bestellung oder kleinere Originalbilder verwenden.');
    const response = await fetch(MAIL_API, {method: 'POST', body, signal: AbortSignal.timeout(60000)});
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.bestellnummer) throw Error(result.error || 'Bestellung nicht versendet');
    return result;
  }
  function fallbackNumber() {
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    return `SB-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
  // Preserve each design's sizes, quantities and rights independently across editing trips.
  const detailKey='shirtbox-design-order-details';
  function saveDetails(){
    const data={};
    for(const state of designs.values())if(state.file.files[0])data[state.designNumber]={
      rows:[...state.card.querySelectorAll('.design-size-row')].map(row=>({size:row.querySelector('select').value,quantity:row.querySelector('input').value})),rights:state.rights.checked};
    try{sessionStorage.setItem(detailKey,JSON.stringify(data));}catch{}
  }
  function restoreDetails(input,number){
    const state=[...designs.values()].find(d=>d.file===input);if(!state)return;
    try{const saved=JSON.parse(sessionStorage.getItem(detailKey)||'{}')[number];if(!saved)return;
      state.card.querySelector('.design-size-list').replaceChildren();
      for(const row of saved.rows||[])addSize(state,row);
      if(!saved.rows?.length)addSize(state,{quantity:1});
      state.rights.checked=!!saved.rights;refresh();
    }catch{}
  }
  form.addEventListener('input',saveDetails);
  form.addEventListener('change',saveDetails);
  document.querySelector('.order-design-edit')?.addEventListener('click',saveDetails);
  window.ShirtboxOrderDesigns = { add: addDesign, attachOriginals, attachSidePrints, restoreDetails };
  if (online) {
    document.getElementById('weiter').disabled = false;
    document.getElementById('formular-url').disabled = false;
    document.getElementById('formular-url').value = location.href;
  } else message('Dies ist eine lokale Vorschau. Zum Absenden bitte die veröffentlichte Website öffnen.');
  form.noValidate = true;
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  form.addEventListener('reset', () => {
    const originals=[...form.querySelectorAll('input.print-original')].map(input=>({input,file:input.files[0]}));
    const saved = [...designs.values()].map(state => ({state, file: state.file.files[0]}));
    setTimeout(() => {
      for(const {input,file} of originals){if(file){const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;}}
      for (const {state, file} of saved) {
        if (file) { const transfer = new DataTransfer(); transfer.items.add(file); state.file.files = transfer.files; }
        state.card.querySelector('.design-size-list').replaceChildren(); addSize(state);
      }
      refresh();
    }, 0);
  });
  form.addEventListener('submit', event => {
    form.classList.add('was-submitted');
    const result = refresh();
    if (!online || !result.valid || !form.reportValidity()) {
      event.preventDefault();
      message(!online ? 'Bitte die veröffentlichte Website öffnen.' : 'Bitte die gelb markierte Angabe ergänzen.');
      document.querySelectorAll('.missing-required').forEach(el=>el.classList.remove('missing-required'));
      const missing=[...form.querySelectorAll('[required]')].find(el=>!el.validity.valid);
      const target=missing || (result.order.errors.length ? list.querySelector('.design-size-row') || list : null);
      // Fehlende Angabe: hinscrollen und orange pulsierend markieren (window.sbMissing aus navigation.js).
      const en=document.documentElement.lang==='en';
      const show=(box,focus,text)=>{box.classList.add('missing-required');if(window.sbMissing)window.sbMissing(box,focus,text);else{box.scrollIntoView({behavior:'smooth',block:'center'});if(focus){try{focus.focus({preventScroll:true});}catch(e){focus.focus();}}}};
      if(target){const box=target.closest('.agb-consent,.design-size-row,.field')||target;const text=box.matches('.agb-consent')||missing?.type==='checkbox'?(en?'👇 Please tick this box':'👇 Bitte Häkchen setzen'):box.matches('.design-size-row')||!missing?(en?'👇 Please choose size and quantity':'👇 Bitte Grösse und Anzahl wählen'):'';show(box,missing,text);}
      else if(!result.order.valid){show(list,null,en?'👇 Please add a design':'👇 Bitte ein Design hinzufügen');}
      return;
    }
    // Normalfall: Der Worker verschickt interne Mail und Kundenbestätigung, danach direkt zur Danke-Seite.
    // Ersatzweg: FormSubmit wie bisher (form.submit löst kein weiteres submit-Ereignis aus).
    event.preventDefault();
    if (submit.getAttribute('aria-busy') === 'true') return;
    // Nur nach Rueckkehr auf die Danke-Seite als abgeschlossen behandeln.
    try { sessionStorage.setItem('shirtbox-order-pending', JSON.stringify({quantity:result.order.quantity, at:Date.now()})); } catch(e) {}
    const progress=document.getElementById('order-submit-progress');
    if(progress){progress.hidden=false;progress.scrollIntoView({behavior:'smooth',block:'center'});}
    submit.setAttribute('aria-busy','true');
    submit.textContent='⏳ Bestellung wird übermittelt …';
    message('Ihre Bestellung wird übermittelt. Bitte warten und die Seite nicht schliessen.');
    (async () => {
      const next = document.getElementById('weiter');
      try {
        const sent=await sendConfirmation(result.order);
        if(!sent.kunde) {
          message(`Bestellung ${sent.bestellnummer} ist eingegangen, aber die Kundenbestätigung konnte nicht versendet werden. Bitte ShirtBOX kontaktieren.`);
          submit.textContent='Bestellung eingegangen';
          return;
        }
        sessionStorage.removeItem('shirtbox-order-id');
        const thanks=new URL(next.value || new URL('danke.html',location.href).href);
        thanks.searchParams.set('bestellung',sent.bestellnummer);
        location.href=thanks.href;
      } catch(e) {
        message(`Bestellung nicht bestätigt: ${e.message}. Bitte NICHT erneut bestellen, wenn bereits eine Bestellmail angekommen ist. Kontaktieren Sie ShirtBOX.`);
        if(progress)progress.hidden=true;
        submit.removeAttribute('aria-busy');
        submit.textContent='Erneut versuchen';
        window.turnstile?.reset();
      }
    })();
  });
  window.addEventListener('pageshow', () => { const progress=document.getElementById('order-submit-progress');if(progress)progress.hidden=true;submit.disabled=false;submit.removeAttribute('aria-busy');submit.innerHTML='Zahlungspflichtig bestellen <span aria-hidden="true">↗</span>';refresh(); });
  // Empty orders stay empty until a new design is added from the designer.
})();
