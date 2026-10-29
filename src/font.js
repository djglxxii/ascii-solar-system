// Builds the glyph atlas (printable ASCII 32..126) and analyses each glyph's ink so shapes can be
// drawn with sub-cell precision: a 3x3 occupancy mask maps to the glyph whose ink best matches it.

export const FONT_STACK = '"JetBrains Mono", "DejaVu Sans Mono", "Menlo", "Consolas", "Liberation Mono", monospace';
const LINE_H = 1.14;
const EDGE_SET = " .,:;'`\"^-_=~+*/\\|()<>[]!oO#%&@";

export async function waitForFont(weight, timeoutMs = 2500) {
  if (!document.fonts) return;
  const t = new Promise((r) => setTimeout(r, timeoutMs));
  try {
    await Promise.race([document.fonts.load(`${weight} 16px "JetBrains Mono"`), t]);
    await Promise.race([document.fonts.ready, t]);
  } catch { /* fall back to whatever monospace exists */ }
}

export function buildFont(cssPx, dpr, weight = 600) {
  const px = Math.max(6, Math.round(cssPx * dpr));
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d', { willReadFrequently: true });
  const font = `${weight} ${px}px ${FONT_STACK}`;
  ctx.font = font;
  const m = ctx.measureText('M');
  const cellW = Math.max(3, Math.round(m.width));
  const cellH = Math.max(5, Math.round(px * LINE_H));
  const asc = m.fontBoundingBoxAscent || px * 0.8;
  const desc = m.fontBoundingBoxDescent || px * 0.22;
  c.width = cellW * 16; c.height = cellH * 6;
  ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const base = Math.round((cellH - (asc + desc)) / 2 + asc);
  for (let i = 0; i < 95; i++) {
    const x = (i % 16) * cellW, y = Math.floor(i / 16) * cellH;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, cellW, cellH); ctx.clip();
    ctx.fillText(String.fromCharCode(32 + i), x + cellW / 2, y + base);
    ctx.restore();
  }

  // Ink per 3x3 region for every glyph.
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  const cov = new Float32Array(95 * 9);
  for (let i = 0; i < 95; i++) {
    const gx = (i % 16) * cellW, gy = Math.floor(i / 16) * cellH;
    for (let ry = 0; ry < 3; ry++) {
      for (let rx = 0; rx < 3; rx++) {
        const x0 = Math.floor((rx * cellW) / 3), x1 = Math.floor(((rx + 1) * cellW) / 3);
        const y0 = Math.floor((ry * cellH) / 3), y1 = Math.floor(((ry + 1) * cellH) / 3);
        let s = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += img[((gy + y) * c.width + gx + x) * 4 + 3]; n++; }
        cov[i * 9 + ry * 3 + rx] = n ? s / (n * 255) : 0;
      }
    }
  }
  // Normalise each region by the densest candidate so "full" means comparable things.
  const cand = [...EDGE_SET].map((ch) => ch.charCodeAt(0) - 32);
  const mx = new Float32Array(9);
  for (const g of cand) for (let k = 0; k < 9; k++) mx[k] = Math.max(mx[k], cov[g * 9 + k]);
  const norm = (g, k) => cov[g * 9 + k] / (mx[k] || 1);

  const maskTable = new Uint8Array(512);
  for (let m = 0; m < 512; m++) {
    let best = 32, bestE = 1e9;
    for (const g of cand) {
      let e = 0;
      for (let k = 0; k < 9; k++) {
        const t = (m >> k) & 1;
        const v = Math.min(1, norm(g, k) * 1.6);
        const d = t - v;
        e += d * d * (t ? 1 : 1.5);
      }
      if (e < bestE) { bestE = e; best = g + 32; }
    }
    maskTable[m] = best;
  }
  maskTable[0] = 32;
  const maskTableSq = matchTable(" .,_-=|[]#:;'", cov, mx);

  return { canvas: c, cellW, cellH, px, dpr, maskTable, maskTableSq, aspect: cellW / cellH };
}

function matchTable(set, cov, mx) {
  const cand = [...set].map((ch) => ch.charCodeAt(0) - 32);
  const t = new Uint8Array(512);
  for (let m = 1; m < 512; m++) {
    let best = 32, bestE = 1e9;
    for (const g of cand) {
      let e = 0;
      for (let k = 0; k < 9; k++) {
        const tt = (m >> k) & 1;
        const d = tt - Math.min(1, (cov[g * 9 + k] / (mx[k] || 1)) * 1.6);
        e += d * d * (tt ? 1 : 1.5);
      }
      if (e < bestE) { bestE = e; best = g + 32; }
    }
    t[m] = best;
  }
  t[0] = 32;
  return t;
}
