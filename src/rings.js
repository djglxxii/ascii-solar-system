// Ring systems as radial opacity/colour profiles with mip levels, so they stay smooth from afar and
// break into ringlets, gaps and arcs up close.

import { clamp, smoothstep, noise3 } from './util.js';

function build(r0, r1, step, fn) {
  const n = Math.ceil((r1 - r0) / step);
  const a = new Float32Array(n), c = new Float32Array(n * 3);
  const o = { a: 0, r: 0, g: 0, b: 0 };
  for (let i = 0; i < n; i++) {
    o.a = 0; o.r = o.g = o.b = 0.6;
    fn(r0 + (i + 0.5) * step, o);
    a[i] = clamp(o.a, 0, 1); c[i * 3] = o.r; c[i * 3 + 1] = o.g; c[i * 3 + 2] = o.b;
  }
  const levels = [{ a, c, n }];
  while (levels[levels.length - 1].n > 8) {
    const p = levels[levels.length - 1], m = Math.floor(p.n / 2);
    const a2 = new Float32Array(m), c2 = new Float32Array(m * 3);
    for (let i = 0; i < m; i++) {
      const w0 = p.a[2 * i], w1 = p.a[2 * i + 1];
      a2[i] = (w0 + w1) / 2;
      const ws = w0 + w1 + 1e-6;
      for (let k = 0; k < 3; k++) c2[i * 3 + k] = (p.c[i * 6 + k] * (w0 + 1e-6) + p.c[i * 6 + 3 + k] * (w1 + 1e-6)) / (ws + 1e-6);
    }
    levels.push({ a: a2, c: c2, n: m });
  }
  return { r0, r1, step, levels };
}

const band = (r, a, b, s = 40) => smoothstep(a - s, a + s, r) * smoothstep(b + s, b - s, r);
const gap = (r, c, w) => 1 - Math.exp(-((r - c) * (r - c)) / (w * w));

function saturn() {
  return build(66900, 182000, 12, (r, o) => {
    const n1 = noise3(r * 0.011, 0.5, 0.5), n2 = noise3(r * 0.07, 3.5, 1.5), n3 = noise3(r * 0.4, 7.5, 2.5);
    let a = 0, col = [0.6, 0.56, 0.5];
    if (r < 74500) { a = 0.025 * band(r, 66900, 74500); col = [0.5, 0.48, 0.45]; }
    else if (r < 92000) {
      a = (0.08 + 0.06 * n1 + 0.04 * n2) * band(r, 74658, 92000, 30);
      a += 0.18 * Math.exp(-((r - 90200) ** 2) / 4e4) + 0.12 * Math.exp(-((r - 85800) ** 2) / 1e4);
      a *= gap(r, 77870, 60) * gap(r, 87500, 90);
      col = [0.55, 0.5, 0.45];
    } else if (r < 117580) {
      const inner = smoothstep(92000, 99000, r);
      a = (0.62 + 0.3 * inner + 0.08 * n1 + 0.08 * n2 + 0.04 * n3) * band(r, 92000, 117580, 25);
      col = [0.86 + 0.04 * n1, 0.79 + 0.03 * n1, 0.66];
    } else if (r < 122170) {
      a = (0.07 + 0.08 * Math.max(0, n2) + 0.12 * Math.exp(-((r - 120050) ** 2) / 2e4)) * gap(r, 117700, 80);
      col = [0.55, 0.52, 0.5];
    } else if (r < 136800) {
      a = (0.5 + 0.08 * n1 + 0.06 * n2 + 0.03 * n3) * band(r, 122170, 136775, 20);
      a *= 1 - 0.3 * smoothstep(127000, 133000, r) * (0.5 + 0.5 * n2);
      a *= gap(r, 133583, 170) * gap(r, 136505, 25);
      col = [0.8, 0.74, 0.64];
    } else if (r < 141000) {
      a = 0.35 * Math.exp(-((r - 140180) ** 2) / 900); col = [0.92, 0.9, 0.86];
    } else if (r < 176000) {
      a = 0.006 * band(r, 166000, 175000, 2000); col = [0.75, 0.7, 0.68];
    } else a = 0;
    o.a = a; o.r = col[0]; o.g = col[1]; o.b = col[2];
  });
}

function uranus() {
  const RINGS = [[41837, 1.5, 0.6], [42234, 2, 0.6], [42571, 2.2, 0.6], [44718, 7, 0.7], [45661, 8, 0.65], [47176, 2, 0.5], [47627, 3, 0.8], [48300, 6, 0.6], [50024, 2, 0.4], [51149, 58, 0.9]];
  return build(41000, 103000, 2, (r, o) => {
    let a = 0;
    for (const [c, w, op] of RINGS) a = Math.max(a, op * smoothstep(w / 2 + 1, w / 2 - 1, Math.abs(r - c)));
    o.r = 0.3; o.g = 0.3; o.b = 0.31;
    const nu = 0.004 * band(r, 66100, 69900, 600), mu = 0.003 * band(r, 86000, 103000, 3000);
    if (nu > a) { a = nu; o.r = 0.6; o.g = 0.5; o.b = 0.45; }
    if (mu > a) { a = mu; o.r = 0.5; o.g = 0.65; o.b = 0.9; }
    o.a = a;
  });
}

function neptune() {
  return build(40000, 64000, 2, (r, o) => {
    let a = 0.008 * band(r, 40900, 42900, 300);
    a = Math.max(a, 0.05 * Math.exp(-((r - 53200) ** 2) / 1600), 0.004 * band(r, 53200, 57200, 300), 0.02 * Math.exp(-((r - 57200) ** 2) / 400));
    a = Math.max(a, 0.08 * Math.exp(-((r - 62932) ** 2) / 300));
    o.a = a; o.r = 0.45; o.g = 0.42; o.b = 0.42;
  });
}

function jupiter() {
  return build(89000, 226000, 40, (r, o) => {
    let a = 0.004 * band(r, 89400, 122800, 3000) + 0.03 * band(r, 122800, 129200, 300);
    a += 0.003 * band(r, 129200, 182000, 2000) + 0.0015 * band(r, 182000, 226000, 3000);
    o.a = a; o.r = 0.62; o.g = 0.5; o.b = 0.4;
  });
}

export function ringsFor(b) {
  if (!b.rings) return null;
  if (b.rings.main) return { t: saturn(), lit: 1.0 };
  if (b.rings.uranian) return { t: uranus(), lit: 0.6 };
  if (b.rings.neptunian) return { t: neptune(), lit: 0.8, arcs: true };
  return { t: jupiter(), lit: 1.4, dusty: true };
}

// Opacity and colour at radius r (km), for a radial footprint fp (km). Writes RS.
export function ringSample(R, r, fp, azim, days, RS) {
  const t = R.t;
  RS.a = 0;
  if (r < t.r0 || r >= t.r1) return RS;
  const lv = Math.max(0, Math.log2(Math.max(1, fp / t.step)));
  const L = Math.min(t.levels.length - 1, Math.floor(lv));
  const l = t.levels[L];
  const s = t.step * (1 << L);
  let u = (r - t.r0) / s - 0.5;
  if (u < 0) u = 0;
  const i0 = Math.min(l.n - 1, Math.floor(u)), i1 = Math.min(l.n - 1, i0 + 1), f = u - Math.floor(u);
  let a = l.a[i0] * (1 - f) + l.a[i1] * f;
  RS.r = l.c[i0 * 3] * (1 - f) + l.c[i1 * 3] * f;
  RS.g = l.c[i0 * 3 + 1] * (1 - f) + l.c[i1 * 3 + 1] * f;
  RS.b = l.c[i0 * 3 + 2] * (1 - f) + l.c[i1 * 3 + 2] * f;
  // ringlets finer than the table, appearing as you get close
  if (fp < 40 && a > 0.05) {
    const k = smoothstep(40, 4, fp);
    a *= 1 + k * 0.35 * noise3(r * 0.9, 1.5, 0.5) * noise3(r * 0.23, 2.5, 4.5);
  }
  if (R.arcs && Math.abs(r - 62932) < 60) {
    // Neptune's Adams ring arcs (Courage, Liberte, Egalite, Fraternite), orbiting together
    let az = ((azim * 180) / Math.PI - 278.9 * days - 247) % 360;   // arcs orbit faster than Neptune turns
    if (az < 0) az += 360;
    const arc = (c, w) => smoothstep(w, w * 0.6, Math.abs(az - c));
    const g = arc(2, 2) + arc(8, 2.5) + arc(14, 2.5) + arc(25, 5);
    a = Math.max(a, 0.45 * g * Math.exp(-((r - 62932) ** 2) / 300));
  }
  RS.a = clamp(a, 0, 1);
  return RS;
}
