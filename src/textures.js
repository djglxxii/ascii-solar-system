// Equirectangular surface maps (albedo, relief, material, clouds, night lights) and the baker that
// fills them a few rows per frame so approaching a world never stalls the frame loop.

import { TAU } from './util.js';
import { painterFor } from './paint.js';

export class SurfaceTex {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.col = new Uint8Array(w * h * 3);
    this.hgt = new Float32Array(w * h);
    this.aux = new Uint8Array(w * h * 4);  // material, cloud cover, night lights, spare
    this.row = 0; this.done = false;
    this.texel = Math.PI / h;              // angular size of one texel (radians)
  }
}

const O = { r: 0, g: 0, b: 0, h: 0, m: 0, c: 0, l: 0 };

function bakeRows(tex, paint, rows) {
  const { w, h } = tex;
  const end = Math.min(h, tex.row + rows);
  const p = [0, 0, 0];
  for (let y = tex.row; y < end; y++) {
    const lat = 90 - ((y + 0.5) * 180) / h;
    const la = (lat * Math.PI) / 180, cl = Math.cos(la), sl = Math.sin(la);
    for (let x = 0; x < w; x++) {
      const lon = -180 + ((x + 0.5) * 360) / w;
      const lo = (lon * Math.PI) / 180;
      p[0] = cl * Math.cos(lo); p[1] = cl * Math.sin(lo); p[2] = sl;
      O.r = O.g = O.b = 0.5; O.h = 0; O.m = 0; O.c = 0; O.l = 0;
      paint(p, lat, lon, O, x, y);
      const i = y * w + x, k = i * 3;
      tex.col[k] = O.r * 255; tex.col[k + 1] = O.g * 255; tex.col[k + 2] = O.b * 255;
      tex.hgt[i] = O.h;
      tex.aux[i * 4] = O.m; tex.aux[i * 4 + 1] = O.c * 255; tex.aux[i * 4 + 2] = O.l * 255;
    }
  }
  tex.row = end;
  if (end >= h) tex.done = true;
}

// Each body gets a tiny map at once and a full-size one baked in the background when it is close
// enough to matter.
export class Baker {
  constructor() { this.queue = []; this.painters = new Map(); }

  painter(b) {
    let p = this.painters.get(b.id);
    if (!p) { p = painterFor(b); this.painters.set(b.id, p); }
    return p;
  }

  low(b) {
    if (!b.texLow) {
      const t = new SurfaceTex(64, 32);
      bakeRows(t, this.painter(b), 32);
      b.texLow = t;
    }
    return b.texLow;
  }

  // Texture to use for body b this frame; `px` is its apparent radius in cells.
  get(b, px) {
    if (b.tex && b.tex.done) return b.tex;
    const low = this.low(b);
    if (px > 5 && !b.tex) {
      const W = b.look.tex || 256;
      b.tex = new SurfaceTex(W, W / 2);
      this.queue.push(b);
    }
    if (b.tex) b.texPx = Math.max(b.texPx || 0, px);
    return low;
  }

  // Spend up to `ms` milliseconds baking, biggest-on-screen body first.
  work(ms) {
    if (!this.queue.length) return;
    const t0 = performance.now();
    this.queue.sort((a, b) => (b.texPx || 0) - (a.texPx || 0));
    while (this.queue.length && performance.now() - t0 < ms) {
      const b = this.queue[0];
      bakeRows(b.tex, this.painter(b), Math.max(1, Math.round(16384 / b.tex.w)));
      if (b.tex.done) this.queue.shift();
    }
  }

  // Bake a body completely right now (used at start-up for the first view).
  now(b) {
    this.get(b, 99);
    if (!b.tex.done) bakeRows(b.tex, this.painter(b), b.tex.h);
    this.queue = this.queue.filter((q) => q !== b);
  }
}

// Bilinear lookup. lon/lat in radians. Writes r g b (0..1), h, m (nearest), c, l into S.
export function sampleTex(t, lon, lat, S) {
  const w = t.w, h = t.h;
  let u = (lon / TAU + 0.5) * w - 0.5;
  u -= Math.floor(u / w) * w;
  let v = (0.5 - lat / Math.PI) * h - 0.5;
  if (v < 0) v = 0; else if (v > h - 1.001) v = h - 1.001;
  const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  const x1 = x0 + 1 >= w ? 0 : x0 + 1, y1 = y0 + 1;
  const i00 = y0 * w + x0, i10 = y0 * w + x1, i01 = y1 * w + x0, i11 = y1 * w + x1;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  const c = t.col, H = t.hgt, a = t.aux;
  S.r = (c[i00 * 3] * w00 + c[i10 * 3] * w10 + c[i01 * 3] * w01 + c[i11 * 3] * w11) / 255;
  S.g = (c[i00 * 3 + 1] * w00 + c[i10 * 3 + 1] * w10 + c[i01 * 3 + 1] * w01 + c[i11 * 3 + 1] * w11) / 255;
  S.b = (c[i00 * 3 + 2] * w00 + c[i10 * 3 + 2] * w10 + c[i01 * 3 + 2] * w01 + c[i11 * 3 + 2] * w11) / 255;
  S.h = H[i00] * w00 + H[i10] * w10 + H[i01] * w01 + H[i11] * w11;
  const near = w00 >= 0.25 ? i00 : w10 >= 0.25 ? i10 : w01 >= 0.25 ? i01 : i11;
  S.m = a[near * 4];
  S.c = (a[i00 * 4 + 1] * w00 + a[i10 * 4 + 1] * w10 + a[i01 * 4 + 1] * w01 + a[i11 * 4 + 1] * w11) / 255;
  S.l = (a[i00 * 4 + 2] * w00 + a[i10 * 4 + 2] * w10 + a[i01 * 4 + 2] * w01 + a[i11 * 4 + 2] * w11) / 255;
  return S;
}

// Height only (for relief slopes).
export function sampleH(t, lon, lat) {
  const w = t.w, h = t.h;
  let u = (lon / TAU + 0.5) * w - 0.5;
  u -= Math.floor(u / w) * w;
  let v = (0.5 - lat / Math.PI) * h - 0.5;
  if (v < 0) v = 0; else if (v > h - 1.001) v = h - 1.001;
  const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  const x1 = x0 + 1 >= w ? 0 : x0 + 1, y1 = y0 + 1;
  const H = t.hgt;
  return (H[y0 * w + x0] * (1 - fx) + H[y0 * w + x1] * fx) * (1 - fy) + (H[y1 * w + x0] * (1 - fx) + H[y1 * w + x1] * fx) * fy;
}
