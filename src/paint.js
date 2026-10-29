// Surface painters: for a point on a body's unit sphere they return albedo, relief and material.
// They are baked into textures (textures.js); the runtime adds detail, weather and storms on top
// (surface.js). Every named feature sits at its real planetocentric latitude / east longitude.

import { noise3, fbm3, ridged3, hash3, clamp, smoothstep, DEG, fromLatLon, RNG, hex, TAU } from './util.js';
import { EARTH_W, EARTH_H, EARTH_RLE } from './data/earth.js';

const dotp = (p, c) => p[0] * c[0] + p[1] * c[1] + p[2] * c[2];
const angd = (p, c) => Math.acos(clamp(dotp(p, c), -1, 1)) / DEG;
const blend = (o, c, w) => { if (w <= 0) return; if (w > 1) w = 1; o.r += (c[0] - o.r) * w; o.g += (c[1] - o.g) * w; o.b += (c[2] - o.b) * w; };
const shade = (o, k) => { o.r *= k; o.g *= k; o.b *= k; };

// ---- shared building blocks ---------------------------------------------------------------------

// Crater height profile at normalised distance d (rim at 1); `big` (0..1) gives flat floors and
// central peaks to complex craters.
function craterProfile(d, big) {
  if (d < 1) {
    let h = d * d - 1;
    if (big > 0) { h = Math.max(h, -1 + big * 0.55); h += big * 0.5 * Math.exp(-(d * d) / 0.018); }
    return h + 0.22 * Math.exp(-((d - 1) * (d - 1)) / 0.012);
  }
  const e = d - 1;
  return 0.22 * Math.exp(-(e * e) / 0.012) + 0.07 * Math.exp(-e * 3.2);
}

// One octave of random craters on a lattice of spacing `cell` (unit-sphere units). Adds height (body
// radii) to o.h and fresh-ejecta brightness to o.f.
export function craters(p, cell, dens, depthK, seed, o, flat) {
  const gx = p[0] / cell, gy = p[1] / cell, gz = p[2] / cell;
  const bx = Math.round(gx) - 1, by = Math.round(gy) - 1, bz = Math.round(gz) - 1;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    const cx = bx + i, cy = by + j, cz = bz + k;
    const h = hash3(cx + seed * 7919, cy - seed * 131, cz);
    if ((h & 0xffff) / 65536 > dens) continue;
    const h2 = hash3(h, 11, seed), h3 = hash3(h, 23, seed);
    const ox = cx + (h2 & 0xffff) / 65536, oy = cy + (h2 >>> 16) / 65536, oz = cz + (h3 & 0xffff) / 65536;
    const rc = Math.hypot(ox, oy, oz) * cell;
    if (Math.abs(rc - 1) > cell * 0.5) continue;
    const rad = 0.14 + 0.34 * ((h3 >>> 16) / 65536);
    const dx = gx - ox, dy = gy - oy, dz = gz - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / rad;
    if (d > 2.4) continue;
    const age = ((h >>> 16) & 0xff) / 255;
    const rr = rad * cell;
    const depth = (rr * depthK * (0.4 + 0.6 * (1 - age))) / (1 + rr * 22);
    o.h += craterProfile(d, clamp((rr - 0.012) * 30, 0, 1)) * depth * (1 - flat);
    if (age < 0.1) o.f += (1 - age / 0.1) * Math.exp(-Math.max(0, d - 0.7) * 2.4) * (1 - flat * 0.6);
    else if (d < 0.9 && age > 0.7) o.f -= 0.15 * (age - 0.7);
  }
}

function craterField(p, o, cr, flat, startCell = 0.36, oct = 7) {
  if (!cr || cr.dens <= 0) return;
  let cell = cr.cell || startCell;
  for (let k = 0; k < (cr.oct || oct); k++) {
    craters(p, cell, Math.min(0.97, cr.dens * (0.3 + k * 0.13)), cr.depth || 0.25, (cr.seed || 1) + k * 17, o, flat);
    cell *= 0.5;
  }
}

// Azimuthal streaks radiating from a crater (bright ray systems).
function rayPattern(p, f, dist) {
  const a = dotp(p, f.e1), b = dotp(p, f.e2);
  const th = Math.atan2(b, a), ca = Math.cos(th), sa = Math.sin(th);
  const n = f.rays.n || 7;
  let r = noise3(ca * n, sa * n, f.seed) * 0.65 + noise3(ca * n * 3.1, sa * n * 3.1, f.seed + 9) * 0.35;
  r = smoothstep(0.08, 0.45, r);
  return r * Math.exp(-dist / f.rays.len) * smoothstep(f.r * 0.8, f.r * 1.3, dist);
}

// Angular distance (deg) from p to a polyline of great-circle segments.
function pathDist(p, segs) {
  let best = 180;
  for (const s of segs) {
    const pn = dotp(p, s.n);
    const cx = [s.a[1] * p[2] - s.a[2] * p[1], s.a[2] * p[0] - s.a[0] * p[2], s.a[0] * p[1] - s.a[1] * p[0]];
    const cy = [p[1] * s.b[2] - p[2] * s.b[1], p[2] * s.b[0] - p[0] * s.b[2], p[0] * s.b[1] - p[1] * s.b[0]];
    let d;
    if (dotp(cx, s.n) >= 0 && dotp(cy, s.n) >= 0) d = Math.asin(Math.min(1, Math.abs(pn))) / DEG;
    else d = Math.min(angd(p, s.a), angd(p, s.b));
    if (d < best) best = d;
  }
  return best;
}

// Cellular (Worley) noise: distances to the nearest and second-nearest feature points.
function cellular(x, y, z, out) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let f1 = 9, f2 = 9;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const h = hash3(xi + i, yi + j, zi + k);
    const h2 = hash3(h, 5, 9);
    const dx = xi + i + (h & 0xffff) / 65536 - x, dy = yi + j + (h >>> 16) / 65536 - y, dz = zi + k + (h2 & 0xffff) / 65536 - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  out[0] = Math.sqrt(f1); out[1] = Math.sqrt(f2);
  return out;
}
const CELL = [0, 0];

function prepFeatures(list, seed = 1) {
  const rng = new RNG(seed * 7717 + 3);
  const out = [];
  for (const f0 of list || []) {
    const f = { ...f0 };
    if (f.lat !== undefined && f.lon !== undefined && f.t !== 'ridge') {
      f.c = fromLatLon(f.lat, f.lon);
      const t = Math.abs(f.c[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
      let e1 = [t[1] * f.c[2] - t[2] * f.c[1], t[2] * f.c[0] - t[0] * f.c[2], t[0] * f.c[1] - t[1] * f.c[0]];
      const l = Math.hypot(...e1); e1 = e1.map((v) => v / l);
      f.e1 = e1; f.e2 = [f.c[1] * e1[2] - f.c[2] * e1[1], f.c[2] * e1[0] - f.c[0] * e1[2], f.c[0] * e1[1] - f.c[1] * e1[0]];
      f.cosMax = Math.cos(Math.min(179, (f.r || 10) * (f.reach || 2.5) + (f.rays ? f.rays.len * 3 : 0)) * DEG);
    }
    f.seed = f.seed || rng.int(1, 9999);
    if (f.pts) {
      f.segs = [];
      for (let i = 0; i + 1 < f.pts.length; i++) {
        const a = fromLatLon(...f.pts[i]), b = fromLatLon(...f.pts[i + 1]);
        let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
        f.segs.push({ a, b, n });
      }
    }
    if (f.t === 'lines' || f.t === 'spots') {
      f.items = [];
      for (let k = 0; k < f.n; k++) {
        const lat = f.latRange ? rng.range(f.latRange[0], f.latRange[1]) : Math.asin(rng.range(-1, 1)) / DEG;
        const lon = f.lonRange ? rng.range(f.lonRange[0], f.lonRange[1]) : rng.range(-180, 180);
        const c = fromLatLon(lat, lon);
        const ang = rng.range(0, TAU);
        const e1 = fromLatLon(lat + 90, lon);           // a tangent direction (northward)
        const e2 = [c[1] * e1[2] - c[2] * e1[1], c[2] * e1[0] - c[0] * e1[2], c[0] * e1[1] - c[1] * e1[0]];
        const t = [e1[0] * Math.cos(ang) + e2[0] * Math.sin(ang), e1[1] * Math.cos(ang) + e2[1] * Math.sin(ang), e1[2] * Math.cos(ang) + e2[2] * Math.sin(ang)];
        const n = [c[1] * t[2] - c[2] * t[1], c[2] * t[0] - c[0] * t[2], c[0] * t[1] - c[1] * t[0]];
        const len = f.len ? rng.range(f.len[0], f.len[1]) : 20;
        const r = f.size ? rng.range(f.size[0], f.size[1]) : 3;
        f.items.push({ c, t, n, len, r, cosMax: Math.cos(Math.min(179, (f.t === 'lines' ? len : r * 2) + 2) * DEG), k: rng.next(), curve: rng.range(-1, 1) });
      }
    }
    out.push(f);
  }
  return out;
}

// Apply a feature list to o (colour, height, flatness, freshness).
function applyFeatures(p, lat, lon, o, feats, st) {
  for (const f of feats) {
    if (f.c && dotp(p, f.c) < f.cosMax) continue;
    switch (f.t) {
      case 'mare': case 'spot': {
        let d = angd(p, f.c);
        if (f.rx) {
          // elliptical: rx along east-west, ry along north-south (degrees)
          const a = Math.asin(clamp(dotp(p, f.e1), -1, 1)) / DEG, b = Math.asin(clamp(dotp(p, f.e2), -1, 1)) / DEG;
          d = f.r * Math.hypot(a / f.rx, b / (f.ry || f.r));
        }
        if (f.warp) d += f.warp * f.r * (fbm3(p[0] * 4.5 + f.seed, p[1] * 4.5, p[2] * 4.5, 4) * 1.2 + fbm3(p[0] * 17 - f.seed, p[1] * 17, p[2] * 17, 3) * 0.35);
        const s = f.soft === undefined ? f.r * 0.2 : f.soft;
        const w = smoothstep(f.r + s, f.r - s, d) * (f.amt === undefined ? 1 : f.amt);
        if (w <= 0) break;
        if (f.col) blend(o, f.col, w);
        if (f.h) o.h += f.h * w;
        if (f.t === 'mare') st.flat = Math.max(st.flat, w * (f.flat === undefined ? 0.8 : f.flat));
        break;
      }
      case 'crater': {
        const dist = angd(p, f.c), d = dist / f.r;
        if (d < 2.6) {
          o.h += craterProfile(d, f.big === undefined ? 1 : f.big) * (f.depth || 0.004);
          if (f.floor && d < 0.92) blend(o, f.floor, smoothstep(0.92, 0.8, d) * (f.floorAmt || 1));
          if (f.rim) blend(o, f.rim, Math.exp(-((d - 1) * (d - 1)) / 0.02) * 0.6);
          if (f.flatten) st.flat = Math.max(st.flat, smoothstep(1.1, 0.8, d) * f.flatten);
          if (f.bright) o.f += f.bright * Math.exp(-Math.max(0, d - 0.6) * 1.6);
          if (f.rings) {
            const ringy = Math.max(0, Math.sin(d * Math.PI * 2 * f.rings / 2.6)) * smoothstep(2.6, 1.0, d) * smoothstep(0.6, 1.0, d);
            o.h += ringy * (f.depth || 0.004) * 0.25;
            if (f.ringCol) blend(o, f.ringCol, ringy * 0.4);
          }
        }
        if (f.rays) o.f += rayPattern(p, f, dist) * f.rays.amt;
        break;
      }
      case 'ring': {
        const d = angd(p, f.c);
        const w = Math.exp(-((d - f.r) * (d - f.r)) / (f.w * f.w)) * (f.amt || 1) * (1 + (f.warp || 0) * fbm3(p[0] * 9, p[1] * 9, p[2] * 9, 3));
        blend(o, f.col, w);
        if (f.h) o.h += f.h * w;
        break;
      }
      case 'path': {
        let d = pathDist(p, f.segs);
        if (f.warp) d += f.warp * fbm3(p[0] * 14 + f.seed, p[1] * 14, p[2] * 14, 3);
        const w = smoothstep(f.w, f.w * 0.45, d);
        if (w > 0) { if (f.col) blend(o, f.col, w * (f.amt || 1)); if (f.depth) o.h -= f.depth * w; }
        if (f.wall && d < f.w * 1.6) o.h -= f.depth * 0.1 * smoothstep(f.w * 1.6, f.w, d);
        break;
      }
      case 'volcano': {
        const d = angd(p, f.c) / f.r;
        if (d < 1.4) {
          let h = Math.pow(Math.max(0, 1 - d), 1.3);
          if (f.scarp) h += 0.18 * smoothstep(1.05, 0.92, d);
          if (d < f.caldera) h -= 0.12 * smoothstep(f.caldera, f.caldera * 0.7, d);
          o.h += h * f.h;
          if (f.col) blend(o, f.col, smoothstep(1.2, 0.6, d) * (f.amt || 0.5));
        }
        break;
      }
      case 'cap': {
        const pole = f.lat === undefined ? (f.north ? 90 : -90) : f.lat;
        const d = f.c ? angd(p, f.c) : 90 - (pole > 0 ? lat : -lat);
        const n = f.warp ? f.warp * fbm3(p[0] * 7 + f.seed, p[1] * 7, p[2] * 7, 4) : 0;
        const w = smoothstep(f.r + f.soft, f.r - f.soft, d + n) * (f.amt || 1);
        blend(o, f.col, w);
        if (f.h) o.h += f.h * w;
        break;
      }
      case 'band': {
        const n = f.warp ? f.warp * fbm3(p[0] * 5 + f.seed, p[1] * 5, p[2] * 5, 3) : 0;
        const l = lat + n, s = f.soft || 3;
        const w = smoothstep(f.lat0 - s, f.lat0 + s, l) * smoothstep(f.lat1 + s, f.lat1 - s, l) * (f.amt || 1);
        blend(o, f.col, w);
        break;
      }
      case 'hemi': {
        const n = f.warp ? f.warp * fbm3(p[0] * 4 + f.seed, p[1] * 4, p[2] * 4, 5) : 0;
        const d = angd(p, f.c) + n;
        const w = smoothstep(f.r + f.soft, f.r - f.soft, d) * (f.amt || 1);
        blend(o, f.col, w);
        if (f.flat) st.flat = Math.max(st.flat, w * f.flat);
        if (f.darkFloors) st.darkFloor = Math.max(st.darkFloor, w);
        break;
      }
      case 'lines': {
        for (const L of f.items) {
          const cd = dotp(p, L.c);
          if (cd < L.cosMax) continue;
          const along = Math.atan2(dotp(p, L.t), cd) / DEG;
          if (Math.abs(along) > L.len) continue;
          let off = Math.asin(clamp(dotp(p, L.n), -1, 1)) / DEG + L.curve * (along * along) / (L.len * 2.2);
          if (f.wobble) off += f.wobble * noise3(along * 0.4, L.k * 50, f.seed);
          const fade = smoothstep(L.len, L.len * 0.7, Math.abs(along));
          const w = f.w * (0.6 + L.k * 0.8);
          let s = Math.exp(-(off * off) / (w * w)) * fade;
          if (f.double) s = s * (1 - 0.8 * Math.exp(-(off * off) / (w * w * 0.12)));
          blend(o, f.col, s * (f.amt || 1));
          if (f.h) o.h += f.h * s;
        }
        break;
      }
      case 'spots': {
        for (const S of f.items) {
          const cd = dotp(p, S.c);
          if (cd < S.cosMax) continue;
          let d = Math.acos(clamp(cd, -1, 1)) / DEG;
          if (f.warp) d += f.warp * S.r * noise3(p[0] * 30, p[1] * 30, p[2] * 30 + S.k * 10);
          const w = smoothstep(S.r * 1.25, S.r * 0.75, d) * (f.amt || 1);
          if (w <= 0) continue;
          const col = f.cols ? f.cols[Math.floor(S.k * f.cols.length)] : f.col;
          blend(o, col, w);
          if (f.glow) o.l = Math.max(o.l, w * f.glow * (S.k > 0.5 ? 1 : 0.35));
          if (f.h) o.h += f.h * w;
        }
        break;
      }
      case 'cells': {
        const d = angd(p, f.c);
        const w = smoothstep(f.r * 1.05, f.r * 0.85, d + 4 * fbm3(p[0] * 5, p[1] * 5, p[2] * 5, 3));
        if (w <= 0) break;
        cellular(p[0] * f.freq, p[1] * f.freq, p[2] * f.freq, CELL);
        const edge = smoothstep(0.12, 0.0, CELL[1] - CELL[0]);
        blend(o, f.col, w);
        blend(o, f.edge, w * edge * 0.6);
        o.h -= w * edge * (f.h || 0.0003);
        st.flat = Math.max(st.flat, w);
        break;
      }
      case 'ridge': {
        const dl = lat - (f.lat || 0);
        const seg = f.lonSpan ? smoothstep(f.lonSpan + 15, f.lonSpan - 15, Math.abs(((lon - f.lon + 540) % 360) - 180)) : 1;
        const w = Math.exp(-(dl * dl) / (f.w * f.w)) * seg * (0.8 + 0.4 * noise3(lon * 0.15, 3, 5));
        o.h += f.h * w;
        break;
      }
      default: break;
    }
  }
}

// Generic rocky / icy world. cfg: base, tint, tintAmp, tintFreq, rough, relief, craters, fresh,
// features, post.
function rocky(cfg) {
  const feats = prepFeatures(cfg.features, cfg.seed || 1);
  const base = cfg.base, tint = cfg.tint || base.map((v) => v * 0.8);
  const tf = cfg.tintFreq || 2.2, ta = cfg.tintAmp === undefined ? 0.5 : cfg.tintAmp;
  const rough = cfg.rough === undefined ? 0.12 : cfg.rough;
  const fresh = cfg.fresh || [0.25, 0.25, 0.24];
  const st = { flat: 0, darkFloor: 0 };
  return (p, lat, lon, o) => {
    const n1 = fbm3(p[0] * tf + 3.1, p[1] * tf, p[2] * tf, 5);
    o.r = base[0]; o.g = base[1]; o.b = base[2];
    blend(o, tint, clamp(0.5 + n1 * 1.3, 0, 1) * ta);
    const n2 = fbm3(p[0] * 11, p[1] * 11, p[2] * 11, 3);
    shade(o, 1 + n2 * rough);
    o.h = n1 * (cfg.undulate || 0.002) + n2 * 0.0006;
    o.f = 0; st.flat = cfg.smooth || 0; st.darkFloor = 0;
    applyFeatures(p, lat, lon, o, feats, st);
    if (cfg.craterMod) st.flat = Math.max(st.flat, 1 - cfg.craterMod(lat, lon, p));
    const h0 = o.h;
    craterField(p, o, cfg.craters, st.flat);
    if (st.darkFloor > 0 && o.h < h0) blend(o, cfg.darkFloorCol || [0.1, 0.08, 0.07], st.darkFloor * smoothstep(0, -0.002, o.h - h0));
    if (o.f !== 0) { o.r += o.f * fresh[0]; o.g += o.f * fresh[1]; o.b += o.f * fresh[2]; }
    if (cfg.post) cfg.post(p, lat, lon, o);
    o.r = clamp(o.r, 0, 1); o.g = clamp(o.g, 0, 1); o.b = clamp(o.b, 0, 1);
  };
}

// Banded gas giant: colour table by planetographic latitude, warped by zonal turbulence.
function bandColor(table, lat, out) {
  if (lat >= table[0][0]) { out[0] = table[0][1][0]; out[1] = table[0][1][1]; out[2] = table[0][1][2]; return out; }
  for (let i = 0; i + 1 < table.length; i++) {
    const a = table[i], b = table[i + 1];
    if (lat <= a[0] && lat >= b[0]) {
      let t = (a[0] - lat) / (a[0] - b[0]);
      t = t * t * (3 - 2 * t);
      for (let k = 0; k < 3; k++) out[k] = a[1][k] + (b[1][k] - a[1][k]) * t;
      return out;
    }
  }
  const l = table[table.length - 1][1];
  out[0] = l[0]; out[1] = l[1]; out[2] = l[2];
  return out;
}
const BC = [0, 0, 0];

function gas(cfg) {
  const table = cfg.bands.map(([l, c]) => [l, typeof c === 'number' ? hex(c) : c]);
  const feats = prepFeatures(cfg.features, cfg.seed || 3);
  const st = { flat: 0, darkFloor: 0 };
  return (p, lat, lon, o) => {
    const zs = cfg.zStretch || 14;
    const q1 = fbm3(p[0] * 2.2, p[1] * 2.2, p[2] * zs, 4), q2 = fbm3(p[0] * 2.2 + 5.2, p[1] * 2.2 + 1.3, p[2] * zs + 2.8, 4);
    const w1 = fbm3(p[0] * 4.4 + q1 * 3.5 + 1.7, p[1] * 4.4 + q2 * 3.5 + 9.2, p[2] * zs * 2, 4);
    const w2 = fbm3(p[0] * 11 + w1 * 2, p[1] * 11 - q1, p[2] * zs * 4, 3);
    const turb = cfg.turb(lat) * (cfg.turbK || 1.9);
    const latW = lat + w1 * turb + q1 * turb * 0.5 + w2 * turb * 0.3;
    bandColor(table, latW, BC);
    o.r = BC[0]; o.g = BC[1]; o.b = BC[2];
    const s = fbm3(p[0] * 9 + w1 * 2, p[1] * 9, p[2] * zs * 5, 4);
    shade(o, 1 + s * (cfg.streak || 0.06));
    // filaments: bright and dark streaks drawn out by the flow inside turbulent belts
    const tk = clamp(turb / 7, 0, 1) * (cfg.filament === undefined ? 1 : cfg.filament);
    if (tk > 0.02) {
      const fl = ridged3(p[0] * 5 + w1 * 2.5, p[1] * 5 + q2 * 2.5, p[2] * zs * 2.2, 4);
      shade(o, 1 + (fl - 0.55) * 0.55 * tk);
    }
    o.h = 0; o.f = 0; st.flat = 0;
    applyFeatures(p, lat, lon, o, feats, st);
    if (cfg.post) cfg.post(p, lat, lon, o, w1, w2);
    o.r = clamp(o.r, 0, 1); o.g = clamp(o.g, 0, 1); o.b = clamp(o.b, 0, 1);
  };
}

// ---- Earth --------------------------------------------------------------------------------------
let EARTH = null;
function earthData() {
  if (EARTH) return EARTH;
  const W = EARTH_W, H = EARTH_H;
  const bin = atob(EARTH_RLE);
  const cls = new Uint8Array(W * H);
  let i = 0;
  for (let k = 0; k < bin.length; k++) {
    const b = bin.charCodeAt(k), c = b >> 6, n = (b & 63) + 1;
    cls.fill(c, i, i + n); i += n;
  }
  // distance (pixels, capped) to the nearest pixel of the other kind: coast distance both ways
  const D = new Float32Array(W * H).fill(60);
  const water = (c) => c === 0 || c === 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = water(cls[y * W + x]);
    const r = x + 1 < W ? water(cls[y * W + x + 1]) : a, d = y + 1 < H ? water(cls[(y + 1) * W + x]) : a;
    if (a !== r || a !== d) D[y * W + x] = 0;
  }
  const pass = (dir) => {
    for (let yy = 0; yy < H; yy++) {
      const y = dir > 0 ? yy : H - 1 - yy;
      for (let xx = 0; xx < W; xx++) {
        const x = dir > 0 ? xx : W - 1 - xx, i0 = y * W + x;
        let v = D[i0];
        const xp = x - dir, yp = y - dir;
        if (xp >= 0 && xp < W) v = Math.min(v, D[y * W + xp] + 1);
        if (yp >= 0 && yp < H) {
          v = Math.min(v, D[yp * W + x] + 1);
          if (xp >= 0 && xp < W) v = Math.min(v, D[yp * W + xp] + 1.414);
          const xq = x + dir;
          if (xq >= 0 && xq < W) v = Math.min(v, D[yp * W + xq] + 1.414);
        }
        D[i0] = v;
      }
    }
  };
  pass(1); pass(-1);
  EARTH = { W, H, cls, D };
  return EARTH;
}

const box = (lat, lon, la0, la1, lo0, lo1, s = 3) => smoothstep(la0 - s, la0 + s, lat) * smoothstep(la1 + s, la1 - s, lat) * smoothstep(lo0 - s, lo0 + s, lon) * smoothstep(lo1 + s, lo1 - s, lon);
const DESERTS = [
  [16, 31, -17, 34, 1.0], [14, 32, 34, 58, 0.95], [24, 37, 52, 72, 0.7], [36, 46, 76, 108, 0.75], [-28, -17, 12, 25, 0.65],
  [-32, -19, 116, 142, 0.9], [-28, -16, -71.5, -68.5, 0.9], [-50, -38, -71, -64, 0.45], [26, 41, -118, -104, 0.6], [2, 12, 40, 51, 0.6],
  [40, 50, 48, 78, 0.4], [-34, -26, 17, 22, 0.4], [18, 26, -6, 8, 0.2],
];
const RAINFOREST = [[-12, 5, -76, -47], [-5, 5, 9, 30], [-9, 12, 95, 152], [5, 18, -92, -78]];
const MOUNTAINS = [
  [27, 40, 70, 102, 1.0], [32, 62, -128, -104, 0.6], [44, 48, 5.5, 16, 0.7], [41, 44, 38, 50, 0.6], [5, 14, 36, 42, 0.5],
  [35, 42, 25, 45, 0.4], [-35, -20, 145, 152, 0.3], [62, 70, -155, -140, 0.5], [47, 55, 82, 100, 0.5],
];
const ANDES = prepFeatures([{ t: 'path', pts: [[10, -73], [5, -76], [-2, -78.5], [-12, -76], [-18, -69], [-24, -67.5], [-33, -70], [-41, -71.5], [-50, -73.5], [-54, -71]], w: 3.2 }]);
const CITIES = [
  [40.7, -74.0, 1], [34.05, -118.25, 0.9], [41.9, -87.6, 0.7], [29.8, -95.4, 0.6], [32.8, -96.8, 0.6], [33.7, -84.4, 0.5], [25.8, -80.2, 0.5],
  [37.8, -122.3, 0.6], [47.6, -122.3, 0.4], [43.7, -79.4, 0.5], [45.5, -73.6, 0.4], [19.4, -99.1, 0.9], [4.7, -74.1, 0.5], [-12.0, -77.0, 0.5],
  [-33.4, -70.6, 0.5], [-34.6, -58.4, 0.7], [-23.5, -46.6, 0.95], [-22.9, -43.2, 0.7], [51.5, -0.1, 0.9], [48.9, 2.35, 0.8], [40.4, -3.7, 0.6],
  [41.4, 2.2, 0.4], [41.9, 12.5, 0.5], [45.5, 9.2, 0.6], [52.5, 13.4, 0.5], [51.4, 7.0, 0.7], [52.4, 4.9, 0.6], [55.75, 37.6, 0.85], [59.9, 30.3, 0.45],
  [41.0, 29.0, 0.75], [30.0, 31.2, 0.85], [6.5, 3.4, 0.6], [-4.3, 15.3, 0.4], [-26.2, 28.0, 0.6], [-1.3, 36.8, 0.3], [24.7, 46.7, 0.5],
  [25.2, 55.3, 0.6], [35.7, 51.4, 0.65], [24.9, 67.0, 0.6], [28.6, 77.2, 0.95], [19.1, 72.9, 0.8], [22.6, 88.4, 0.7], [12.97, 77.6, 0.6],
  [13.1, 80.3, 0.5], [23.8, 90.4, 0.7], [13.75, 100.5, 0.7], [-6.2, 106.8, 0.85], [14.6, 121.0, 0.7], [10.8, 106.7, 0.5], [1.35, 103.8, 0.5],
  [22.5, 114.0, 1.0], [31.2, 121.5, 1.0], [39.9, 116.4, 0.9], [39.1, 117.2, 0.5], [29.6, 106.5, 0.6], [30.7, 104.1, 0.6], [30.6, 114.3, 0.6],
  [37.6, 127.0, 0.9], [35.7, 139.7, 1.0], [34.7, 135.5, 0.8], [35.2, 136.9, 0.5], [25.0, 121.5, 0.6], [-33.9, 151.2, 0.6], [-37.8, 145.0, 0.5],
  [-27.5, 153.0, 0.3], [-31.95, 115.9, 0.3], [-36.85, 174.8, 0.3], [31.5, 74.3, 0.6], [33.3, 44.4, 0.4], [33.6, -7.6, 0.4], [36.8, 3.1, 0.4],
  [9.0, 38.7, 0.3], [15.6, 32.5, 0.3], [50.45, 30.5, 0.5], [52.2, 21.0, 0.45], [48.2, 16.4, 0.4], [38.0, 23.7, 0.4], [10.5, -66.9, 0.4],
  [23.1, -82.4, 0.3], [33.4, -112.1, 0.45], [39.7, -105.0, 0.4], [44.98, -93.3, 0.35], [42.36, -71.06, 0.55], [38.9, -77.0, 0.6],
  [39.95, -75.2, 0.5], [42.3, -83.0, 0.45], [49.3, -123.1, 0.3], [51.0, -114.1, 0.25], [55.0, 82.9, 0.3], [56.8, 60.6, 0.3], [43.2, 76.9, 0.3],
  [41.3, 69.2, 0.3], [34.0, 72.0, 0.4], [26.9, 80.9, 0.5], [17.4, 78.5, 0.5], [21.0, 105.8, 0.5], [32.1, 118.8, 0.6], [36.1, 120.4, 0.5],
  [45.75, 126.6, 0.4], [41.8, 123.4, 0.5], [3.0, 101.5, 0.4], [-8.0, 112.5, 0.6], [53.5, -2.2, 0.6], [50.1, 8.7, 0.5], [48.1, 11.6, 0.45],
  [45.8, 4.8, 0.35], [43.3, 5.4, 0.35], [38.7, -9.1, 0.4], [37.4, -6.0, 0.3], [59.3, 18.1, 0.35], [60.2, 24.9, 0.3], [55.7, 12.6, 0.3],
  [-3.7, -38.5, 0.4], [-8.05, -34.9, 0.4], [-12.97, -38.5, 0.4], [-19.9, -43.9, 0.5], [-30.0, -51.2, 0.4], [-25.4, -49.3, 0.4], [14.1, -87.2, 0.25],
  [9.0, -79.5, 0.3], [18.5, -69.9, 0.3], [-17.8, -63.2, 0.3], [-0.2, -78.5, 0.35], [-2.2, -79.9, 0.35],
].map(([la, lo, w]) => ({ c: fromLatLon(la, lo), w, cos: Math.cos((1.2 + 2.4 * w) * DEG) }));
const LIT_REGIONS = [[35, 60, -10, 40, 0.55], [25, 48, -100, -70, 0.5], [30, 50, -125, -115, 0.35], [8, 31, 70, 90, 0.5], [22, 41, 104, 123, 0.55],
  [31, 44, 129, 143, 0.65], [34, 39, 126, 130, 0.6], [-30, -20, -54, -40, 0.35], [24, 31, 30, 33, 0.6], [22, 30, 47, 57, 0.4], [-8, -6, 105, 115, 0.6],
  [45, 58, 30, 60, 0.3], [15, 25, -105, -95, 0.3], [-38, -30, 140, 153, 0.25], [5, 14, -10, 10, 0.2], [-35, -25, 18, 32, 0.2]];
const CYCLONES = (() => {
  const r = new RNG(77);
  const l = [];
  for (let k = 0; k < 16; k++) {
    const south = k % 2 === 1;
    const lat = (south ? -1 : 1) * r.range(38, 62), lon = r.range(-180, 180);
    l.push({ c: fromLatLon(lat, lon), s: south ? -1 : 1, r: r.range(10, 17), k: r.range(3.5, 5.5) });
  }
  for (let k = 0; k < 4; k++) { const lat = (k % 2 ? -1 : 1) * r.range(12, 20); l.push({ c: fromLatLon(lat, r.range(-180, 180)), s: lat < 0 ? -1 : 1, r: 4, k: 5 }); }
  return l;
})();

export function earthClouds(p, lat) {
  // swirl the domain around cyclone centres so the clouds curl
  let x = p[0], y = p[1], z = p[2];
  for (const cy of CYCLONES) {
    const cd = x * cy.c[0] + y * cy.c[1] + z * cy.c[2];
    const d = Math.acos(clamp(cd, -1, 1)) / DEG;
    if (d > cy.r) continue;
    const a = cy.s * cy.k * Math.pow(1 - d / cy.r, 2);
    const c = Math.cos(a), s = Math.sin(a), k = cy.c;
    const kd = cd * (1 - c);
    const nx = x * c + (k[1] * z - k[2] * y) * s + k[0] * kd, ny = y * c + (k[2] * x - k[0] * z) * s + k[1] * kd, nz = z * c + (k[0] * y - k[1] * x) * s + k[2] * kd;
    x = nx; y = ny; z = nz;
  }
  const wx = fbm3(x * 1.6 + 5, y * 1.6, z * 1.6, 3), wy = fbm3(x * 1.6 - 3, y * 1.6 + 7, z * 1.6, 3);
  const n = fbm3(x * 2.8 + wx * 1.4, y * 2.8 + wy * 1.4, z * 2.8, 6);
  const al = Math.abs(lat);
  const itcz = 0.34 * Math.exp(-((lat - 6) * (lat - 6)) / 40);
  const subtrop = -0.26 * Math.exp(-((al - 24) * (al - 24)) / 70);
  const mid = 0.22 * smoothstep(32, 52, al) - 0.12 * smoothstep(72, 88, al);
  const v = n * 0.75 + 0.02 + itcz + subtrop + mid;
  const puff = itcz > 0.05 ? 0.25 * ridged3(x * 9, y * 9, z * 9, 3) * itcz * 3 : 0;
  return clamp(smoothstep(0.08, 0.42, v + puff * 0.4), 0, 1);
}

function earthPaint(p, lat, lon, o) {
  const E = earthData();
  const mx = Math.min(E.W - 1, Math.floor(((lon + 180) / 360) * E.W)), my = Math.min(E.H - 1, Math.floor(((90 - lat) / 180) * E.H));
  const cls = E.cls[my * E.W + mx], dc = E.D[my * E.W + mx];
  const al = Math.abs(lat);
  const n = fbm3(p[0] * 9, p[1] * 9, p[2] * 9, 4);
  o.h = 0; o.l = 0;
  if (cls === 0 || cls === 3) {
    // ocean: deeper blue offshore, turquoise shelves, sea ice in the Arctic and around Antarctica
    const shelf = Math.exp(-dc / 2.2) * (cls === 3 ? 0.4 : 1);
    o.r = 0.018 + shelf * 0.03; o.g = 0.06 + shelf * 0.1 + n * 0.01; o.b = 0.17 + shelf * 0.1 + n * 0.015;
    if (al < 30) { o.g += 0.015; o.b += 0.02; }
    o.m = 1;
    const ice = lat > 0 ? smoothstep(74, 80, lat + n * 5) : smoothstep(64, 70, -lat + n * 4);
    if (ice > 0.5) { o.r = 0.82 + n * 0.05; o.g = 0.86 + n * 0.05; o.b = 0.92; o.m = 2; }
  } else if (cls === 2) {
    const k = 0.88 + n * 0.06;
    o.r = k * 0.95; o.g = k * 0.97; o.b = k; o.m = 2;
    o.h = 0.0003 * smoothstep(0, 30, dc) + 0.00008 * n;
  } else {
    o.m = 0;
    let dry = 0;
    for (const [a0, a1, b0, b1, w] of DESERTS) dry = Math.max(dry, box(lat, lon, a0, a1, b0, b1, 4) * w);
    dry = clamp(dry + (n * 0.25) + smoothstep(25, 55, dc) * 0.2 * smoothstep(30, 50, al) * (al < 55 ? 1 : 0), 0, 1);
    let wet = 0;
    for (const [a0, a1, b0, b1] of RAINFOREST) wet = Math.max(wet, box(lat, lon, a0, a1, b0, b1, 3));
    const boreal = smoothstep(46, 54, al) * smoothstep(70, 62, al);
    const tundra = smoothstep(60, 70, al);
    const forest = [0.09, 0.19, 0.06], jungle = [0.05, 0.16, 0.04], grass = [0.34, 0.36, 0.17], tun = [0.33, 0.32, 0.26], bor = [0.08, 0.15, 0.09];
    const sand = lon > 110 && lat < -10 ? [0.7, 0.42, 0.22] : lat > 14 && lat < 33 && lon > -20 && lon < 60 ? [0.86, 0.7, 0.46] : [0.72, 0.6, 0.42];
    o.r = grass[0]; o.g = grass[1]; o.b = grass[2];
    blend(o, forest, clamp(0.55 + n * 1.4, 0, 1) * (1 - dry) * smoothstep(60, 40, al));
    blend(o, jungle, wet * (1 - dry));
    blend(o, bor, boreal * (0.6 + n));
    blend(o, tun, tundra);
    blend(o, sand, smoothstep(0.35, 0.8, dry));
    // mountains: ridged relief, rock and snow
    let mtn = 0;
    for (const [a0, a1, b0, b1, w] of MOUNTAINS) mtn = Math.max(mtn, box(lat, lon, a0, a1, b0, b1, 3) * w);
    const ad = pathDist(p, ANDES[0].segs);
    mtn = Math.max(mtn, smoothstep(3.2, 0.5, ad) * 0.9);
    const rg = ridged3(p[0] * 26, p[1] * 26, p[2] * 26, 4);
    const elev = mtn * (0.4 + rg) + (0.05 + 0.05 * n) * smoothstep(0, 20, dc);
    o.h = elev * 0.0009;
    blend(o, [0.38, 0.34, 0.3], smoothstep(0.5, 1.1, elev) * 0.7);
    const snowLine = al > 55 ? 0.5 : al > 35 ? 0.85 : 1.15;
    blend(o, [0.9, 0.92, 0.95], smoothstep(snowLine, snowLine + 0.2, elev + n * 0.1));
    shade(o, 1 + n * 0.12);
    // city lights
    let lit = 0;
    for (const c of CITIES) {
      const cd = p[0] * c.c[0] + p[1] * c.c[1] + p[2] * c.c[2];
      if (cd < c.cos) continue;
      const d = Math.acos(clamp(cd, -1, 1)) / DEG;
      lit += c.w * Math.exp(-(d * d) / (0.35 + 0.9 * c.w));
    }
    let dev = 0;
    for (const [a0, a1, b0, b1, w] of LIT_REGIONS) dev = Math.max(dev, box(lat, lon, a0, a1, b0, b1, 3) * w);
    const speck = smoothstep(0.1, 0.55, noise3(p[0] * 140, p[1] * 140, p[2] * 140) + noise3(p[0] * 40, p[1] * 40, p[2] * 40) * 0.5);
    lit += dev * speck * 0.7 + 0.04 * speck * smoothstep(60, 40, al) * (1 - dry);
    lit *= 1 - 0.85 * dry * (lit < 0.6 ? 1 : 0.3);
    o.l = clamp(lit, 0, 1);
  }
  o.c = earthClouds(p, lat);
}

// ---- Per-world painters -------------------------------------------------------------------------
const PAINTERS = {
  earth: () => earthPaint,

  moon: () => rocky({
    base: [0.64, 0.62, 0.59], tint: [0.55, 0.53, 0.51], tintAmp: 0.6, rough: 0.1, fresh: [0.32, 0.32, 0.31],
    craters: { dens: 0.95, depth: 0.3, seed: 5 }, undulate: 0.003,
    features: [
      { t: 'mare', lat: 32.8, lon: -15.6, r: 20.1, col: [0.27, 0.27, 0.27], warp: 0.22, h: -0.002 },
      { t: 'mare', lat: 18, lon: -57, r: 17.2, col: [0.29, 0.29, 0.28], warp: 0.5, h: -0.001 },
      { t: 'mare', lat: 2, lon: -50, r: 12.6, col: [0.29, 0.29, 0.28], warp: 0.5, h: -0.001 },
      { t: 'mare', lat: 33, lon: -54, r: 12.6, col: [0.3, 0.29, 0.28], warp: 0.5, h: -0.001 },
      { t: 'mare', lat: -6, lon: -40, r: 9.2, col: [0.3, 0.3, 0.29], warp: 0.5, h: -0.001 },
      { t: 'mare', lat: 28, lon: 17.5, r: 12.1, col: [0.31, 0.29, 0.27], warp: 0.18, h: -0.002 },
      { t: 'mare', lat: 8.5, lon: 31.4, r: 12.6, col: [0.25, 0.26, 0.29], warp: 0.4, h: -0.0015 },
      { t: 'mare', lat: 1, lon: 23, r: 6.9, col: [0.26, 0.27, 0.29], warp: 0.4 },
      { t: 'mare', lat: 17, lon: 59.1, r: 9.2, col: [0.27, 0.27, 0.27], warp: 0.12, h: -0.002 },
      { t: 'mare', lat: -7.8, lon: 51.3, r: 10.3, col: [0.3, 0.29, 0.28], warp: 0.5 },
      { t: 'mare', lat: -15.2, lon: 35.5, r: 6.0, col: [0.3, 0.29, 0.28], warp: 0.3 },
      { t: 'mare', lat: -21.3, lon: -16.6, r: 10.9, col: [0.32, 0.31, 0.3], warp: 0.5 },
      { t: 'mare', lat: -24.4, lon: -38.6, r: 6.7, col: [0.29, 0.29, 0.28], warp: 0.3 },
      { t: 'mare', lat: -10, lon: -23, r: 6.3, col: [0.31, 0.3, 0.29], warp: 0.4 },
      { t: 'mare', lat: 7.5, lon: -30.9, r: 7.5, col: [0.31, 0.3, 0.29], warp: 0.5 },
      { t: 'mare', lat: 13.3, lon: 3.6, r: 4.6, col: [0.3, 0.3, 0.29], warp: 0.4 },
      { t: 'mare', lat: 56, lon: -35, r: 5.8, col: [0.32, 0.31, 0.3], warp: 0.5 },
      { t: 'mare', lat: 57, lon: -8, r: 5.8, col: [0.32, 0.31, 0.3], warp: 0.5 },
      { t: 'mare', lat: 56, lon: 18, r: 5.8, col: [0.32, 0.31, 0.3], warp: 0.5 },
      { t: 'mare', lat: 55, lon: 40, r: 4.6, col: [0.32, 0.31, 0.3], warp: 0.5 },
      { t: 'mare', lat: -46.6, lon: 91, r: 9.2, col: [0.36, 0.35, 0.34], warp: 0.7, amt: 0.7 },
      { t: 'mare', lat: 1.3, lon: 87.5, r: 5.2, col: [0.31, 0.3, 0.29], warp: 0.3 },
      { t: 'mare', lat: 13.3, lon: 86.1, r: 5.2, col: [0.32, 0.31, 0.3], warp: 0.3 },
      { t: 'mare', lat: 27.3, lon: 147.9, r: 4.0, col: [0.3, 0.29, 0.28], warp: 0.3 },
      { t: 'mare', lat: -33.7, lon: 163.5, r: 4.0, col: [0.33, 0.32, 0.31], warp: 0.6, amt: 0.7 },
      { t: 'crater', lat: -19.4, lon: -92.8, r: 5, depth: 0.006, rings: 3, floor: [0.3, 0.3, 0.29], ringCol: [0.5, 0.49, 0.47] },
      { t: 'crater', lat: -53, lon: -169, r: 38, depth: 0.012, big: 1, floor: [0.5, 0.48, 0.46], floorAmt: 0.5 },
      { t: 'crater', lat: -43.31, lon: -11.36, r: 1.45, depth: 0.0035, bright: 0.5, rays: { len: 18, amt: 0.5, n: 9 } },
      { t: 'crater', lat: 9.62, lon: -20.08, r: 1.6, depth: 0.003, bright: 0.35, rays: { len: 9, amt: 0.35, n: 7 } },
      { t: 'crater', lat: 8.1, lon: -38.0, r: 0.6, depth: 0.0015, bright: 0.4, rays: { len: 6, amt: 0.3, n: 6 } },
      { t: 'crater', lat: 23.7, lon: -47.4, r: 0.7, depth: 0.0018, bright: 0.8, rays: { len: 4, amt: 0.3, n: 5 } },
      { t: 'crater', lat: 16.1, lon: 46.8, r: 0.9, depth: 0.0015, bright: 0.35, rays: { len: 6, amt: 0.3, n: 4 } },
      { t: 'crater', lat: 36, lon: 102.9, r: 0.4, depth: 0.001, bright: 0.5, rays: { len: 6, amt: 0.4, n: 7 } },
      { t: 'crater', lat: 22.4, lon: -163.1, r: 1.2, depth: 0.002, bright: 0.3, rays: { len: 9, amt: 0.3, n: 6 } },
      { t: 'crater', lat: -58.4, lon: -14.4, r: 3.7, depth: 0.003 },
      { t: 'crater', lat: -9.3, lon: -1.9, r: 2.5, depth: 0.002, flatten: 1 },
      { t: 'crater', lat: -11.4, lon: 26.4, r: 1.65, depth: 0.0025 },
      { t: 'crater', lat: -8.9, lon: 61.1, r: 2.2, depth: 0.0025 },
      { t: 'crater', lat: -25.3, lon: 60.4, r: 3, depth: 0.0025 },
      { t: 'crater', lat: -44.3, lon: -54.6, r: 3.7, depth: 0.002, floor: [0.42, 0.41, 0.4], floorAmt: 0.5 },
      { t: 'crater', lat: 51.6, lon: -9.4, r: 1.65, depth: 0.0015, floor: [0.22, 0.22, 0.22], flatten: 1 },
      { t: 'crater', lat: -5.2, lon: -68.6, r: 2.8, depth: 0.002, floor: [0.23, 0.23, 0.23], flatten: 1 },
      { t: 'crater', lat: -20.4, lon: 129.1, r: 3, depth: 0.003, floor: [0.24, 0.24, 0.24], flatten: 1 },
      { t: 'crater', lat: 2.6, lon: -128.4, r: 8.3, depth: 0.004, rings: 2 },
      { t: 'crater', lat: -4.4, lon: -157.4, r: 7.3, depth: 0.004, rings: 2 },
      { t: 'crater', lat: -36.1, lon: -151.8, r: 8, depth: 0.004 },
    ],
  }),

  mercury: () => rocky({
    base: [0.56, 0.53, 0.5], tint: [0.4, 0.39, 0.38], tintAmp: 0.65, tintFreq: 3, fresh: [0.35, 0.34, 0.32], rough: 0.1,
    craters: { dens: 0.92, depth: 0.32, seed: 11 }, undulate: 0.003,
    features: [
      { t: 'crater', lat: 30.5, lon: 170.2, r: 18, depth: 0.004, big: 1, floor: [0.68, 0.6, 0.5], floorAmt: 0.6, flatten: 0.8, rings: 2 },
      { t: 'spot', lat: 70, lon: 0, r: 24, col: [0.62, 0.58, 0.53], warp: 0.6, amt: 0.6 },
      { t: 'crater', lat: 57.8, lon: 16.8, r: 1.9, depth: 0.003, bright: 0.6, rays: { len: 14, amt: 0.4, n: 8 } },
      { t: 'crater', lat: -33.9, lon: -12.5, r: 1.9, depth: 0.003, bright: 0.5, rays: { len: 12, amt: 0.35, n: 7 } },
      { t: 'crater', lat: -11.3, lon: -31.5, r: 1.4, depth: 0.003, bright: 0.6, rays: { len: 10, amt: 0.35, n: 6 } },
      { t: 'crater', lat: -2.7, lon: -105, r: 11, depth: 0.003, floor: [0.42, 0.4, 0.38], floorAmt: 0.4, rings: 2 },
    ],
  }),

  mars: () => rocky({
    base: [0.74, 0.46, 0.27], tint: [0.56, 0.33, 0.2], tintAmp: 0.4, tintFreq: 2.5, rough: 0.1, fresh: [0.12, 0.08, 0.05],
    craters: { dens: 0.85, depth: 0.22, seed: 21 }, relief: 1.4, undulate: 0.004,
    craterMod: (lat, _lon, p) => 0.35 + 0.65 * smoothstep(25, -10, lat + 15 * fbm3(p[0] * 3, p[1] * 3, p[2] * 3, 3)),
    features: [
      { t: 'spot', lat: 8.4, lon: 69.5, r: 11, rx: 7, ry: 13, col: [0.3, 0.2, 0.14], warp: 0.6 },
      { t: 'spot', lat: 46.7, lon: -30, r: 13, col: [0.33, 0.21, 0.15], warp: 0.7 },
      { t: 'spot', lat: -25, lon: -40, r: 15, col: [0.34, 0.22, 0.15], warp: 0.8, amt: 0.8 },
      { t: 'spot', lat: -3, lon: 0, r: 6, col: [0.3, 0.2, 0.14], warp: 0.6 },
      { t: 'spot', lat: -8, lon: 22, r: 7, col: [0.32, 0.21, 0.15], warp: 0.6 },
      { t: 'spot', lat: -20, lon: 105, r: 12, col: [0.34, 0.22, 0.15], warp: 0.7, amt: 0.8 },
      { t: 'spot', lat: -25, lon: 145, r: 12, col: [0.33, 0.21, 0.15], warp: 0.7, amt: 0.85 },
      { t: 'spot', lat: -30, lon: -150, r: 12, col: [0.34, 0.22, 0.16], warp: 0.7, amt: 0.8 },
      { t: 'spot', lat: -26, lon: -85, r: 4.5, col: [0.32, 0.21, 0.15], warp: 0.6 },
      { t: 'spot', lat: -15, lon: -50, r: 6, col: [0.34, 0.22, 0.15], warp: 0.6, amt: 0.8 },
      { t: 'spot', lat: 50, lon: 118, r: 13, col: [0.52, 0.34, 0.22], warp: 0.6, amt: 0.6 },
      { t: 'spot', lat: 20, lon: 5, r: 18, col: [0.8, 0.52, 0.32], warp: 0.5, amt: 0.6 },
      { t: 'spot', lat: 5, lon: -115, r: 22, col: [0.8, 0.5, 0.3], warp: 0.4, amt: 0.6 },
      { t: 'spot', lat: 15, lon: -160, r: 13, col: [0.8, 0.52, 0.32], warp: 0.4, amt: 0.6 },
      { t: 'spot', lat: 25, lon: 147, r: 10, col: [0.78, 0.5, 0.3], warp: 0.4, amt: 0.5 },
      { t: 'crater', lat: -42.4, lon: 70.5, r: 19, depth: 0.0055, big: 1, floor: [0.82, 0.62, 0.46], floorAmt: 0.6, flatten: 0.8 },
      { t: 'crater', lat: -49.7, lon: -43.4, r: 8.5, depth: 0.004, big: 1, floor: [0.78, 0.55, 0.38], floorAmt: 0.5, flatten: 0.7 },
      { t: 'crater', lat: 47, lon: 113, r: 25, depth: 0.002, big: 1 },
      { t: 'volcano', lat: 18.65, lon: -133.8, r: 5.2, h: 0.0062, caldera: 0.16, scarp: true, col: [0.72, 0.48, 0.32], amt: 0.4 },
      { t: 'volcano', lat: 11.92, lon: -104.08, r: 3.1, h: 0.004, caldera: 0.18, col: [0.72, 0.48, 0.32], amt: 0.3 },
      { t: 'volcano', lat: 1.48, lon: -112.96, r: 2.7, h: 0.0035, caldera: 0.18, col: [0.72, 0.48, 0.32], amt: 0.3 },
      { t: 'volcano', lat: -8.26, lon: -120.09, r: 3.6, h: 0.004, caldera: 0.2, col: [0.72, 0.48, 0.32], amt: 0.3 },
      { t: 'volcano', lat: 40.5, lon: -109.6, r: 9, h: 0.0018, caldera: 0.08 },
      { t: 'volcano', lat: 24.8, lon: 146.9, r: 3, h: 0.0025, caldera: 0.12 },
      { t: 'path', pts: [[-6.5, -101], [-9, -88], [-10, -76], [-12, -65], [-12.5, -55], [-8, -45], [-4, -38]], w: 1.8, depth: 0.0021, col: [0.46, 0.3, 0.21], amt: 0.7, warp: 0.5, wall: true },
      { t: 'path', pts: [[-5, -106], [-7, -101], [-10, -97]], w: 2.2, depth: 0.0012, col: [0.5, 0.33, 0.22], amt: 0.4, warp: 0.8 },
      { t: 'cap', north: true, r: 9.5, soft: 1.5, warp: 2.5, col: [0.95, 0.94, 0.92], h: 0.0007 },
      { t: 'cap', lat: -87, lon: -45, r: 4.2, soft: 1.2, warp: 1.5, col: [0.95, 0.94, 0.93], h: 0.0008, reach: 3 },
    ],
    post: (p, lat, _lon, o) => {
      // broken dark terrain across the southern highlands and the classic dark markings' fringes
      const n = fbm3(p[0] * 3.2 + 11, p[1] * 3.2, p[2] * 3.2, 5) + 0.35 * fbm3(p[0] * 12, p[1] * 12, p[2] * 12, 3);
      const band = smoothstep(-62, -38, lat) * smoothstep(28, 8, lat);
      blend(o, [0.38, 0.24, 0.16], smoothstep(-0.05, 0.25, n) * band * 0.8);
      blend(o, [0.82, 0.55, 0.34], smoothstep(-0.05, -0.35, n) * 0.35);
      // spiral troughs in the north polar cap
      if (lat > 78) {
        const th = Math.atan2(p[1], p[0]), rr = 90 - lat;
        const s = Math.sin(th * 2 - rr * 0.9 + noise3(p[0] * 20, p[1] * 20, 1) * 1.5);
        const w = smoothstep(0.75, 0.95, s) * smoothstep(9.5, 7, rr) * smoothstep(1, 2.5, rr);
        blend(o, [0.6, 0.45, 0.35], w * 0.6);
      }
    },
  }),

  venus: () => (p, lat, lon, o) => {
    const w = fbm3(p[0] * 2, p[1] * 2, p[2] * 6, 5);
    const s = fbm3(p[0] * 5 + w, p[1] * 5, p[2] * 18, 4);
    o.r = 0.92; o.g = 0.84; o.b = 0.64;
    // the dark sideways "Y" of the ultraviolet absorber, faint in visible light
    const lo = ((lon + 540) % 360) - 180;
    const arm = Math.abs(Math.abs(lat) - smoothstep(-20, 100, lo) * 40) ;
    const y = Math.exp(-(arm * arm) / 90) * smoothstep(-60, -10, lo) * smoothstep(150, 90, lo);
    shade(o, 1 - 0.1 * y + 0.05 * w + 0.04 * s);
    const al = Math.abs(lat);
    shade(o, 1 + 0.05 * smoothstep(55, 65, al) * smoothstep(75, 66, al) - 0.06 * smoothstep(70, 85, al));
    o.r += 0.03 * (1 - al / 90);
    o.h = 0; o.m = 0;
  },

  jupiter: () => gas({
    zStretch: 16, streak: 0.07, seed: 8,
    bands: [
      [90, 0x8a8781], [72, 0x8d8a83], [62, 0x99917f], [52, 0xa39886], [47, 0xb6aa92], [43, 0xc7b99d], [39, 0xa99177], [35, 0xcfc3a8],
      [31, 0xd7cdb3], [28.5, 0xb39072], [25, 0xa98466], [22.5, 0xe2d5bc], [19, 0xe6d9c0], [17, 0xa47456], [14, 0x8d5a3e], [10, 0x94634a],
      [7.5, 0xb08a74], [5.5, 0xeee4cf], [0, 0xe8dbc2], [-5, 0xece0c8], [-7.5, 0xb18a6a], [-10, 0x9b6c4d], [-14, 0xa87d5c], [-18, 0x93664a],
      [-20, 0xd6c3a6], [-23, 0xe6d9bf], [-26.5, 0xe0d3b8], [-28.5, 0xa98a6c], [-32, 0xb39678], [-35, 0xd9ceb5], [-39, 0xcabba0], [-42, 0xab977c],
      [-46, 0xc5b79c], [-53, 0xa49784], [-62, 0x958d80], [-72, 0x8d8982], [-90, 0x878580],
    ],
    turb: (lat) => {
      const a = Math.abs(lat);
      return 1.1 + 2.4 * Math.exp(-((a - 8) * (a - 8)) / 6) + 1.6 * Math.exp(-((a - 18) * (a - 18)) / 8) + (a > 45 ? 2.5 : 0) + 0.8 * Math.exp(-((a - 27) * (a - 27)) / 8);
    },
    features: [
      // NEB brown barges and the white ovals of the southern temperate belts
      { t: 'spots', n: 7, size: [0.7, 1.3], latRange: [14, 16], col: [0.45, 0.25, 0.16], amt: 0.7, warp: 0.3 },
      { t: 'spots', n: 9, size: [0.8, 1.5], latRange: [-42, -39], col: [0.93, 0.9, 0.84], amt: 0.85, warp: 0.25 },
      { t: 'spots', n: 6, size: [0.5, 1.0], latRange: [-49, -46], col: [0.9, 0.87, 0.8], amt: 0.7, warp: 0.3 },
      { t: 'spots', n: 5, size: [0.6, 1.2], latRange: [40, 42], col: [0.92, 0.88, 0.82], amt: 0.6, warp: 0.3 },
    ],
    post: (p, lat, lon, o, w1) => {
      // festoons: dark blue-grey plumes trailing from the NEB's southern edge into the Equatorial Zone
      if (lat > -2 && lat < 9) {
        const ph = ((lon * 13) / 360 + w1 * 0.3) % 1;
        const f = ph < 0 ? ph + 1 : ph;
        const tail = (9 - lat) / 9;
        const d = Math.abs(f - 0.5 - tail * 0.35);
        const w = smoothstep(0.08, 0.0, d - tail * 0.02) * smoothstep(-2, 3, lat) * smoothstep(9, 6.5, lat);
        blend(o, [0.42, 0.42, 0.46], w * 0.7);
      }
      // brighter plumes in the EZ and chaotic mottling in the belts
      if (Math.abs(lat) < 6) { const n = fbm3(p[0] * 14, p[1] * 14, p[2] * 40, 3); shade(o, 1 + Math.max(0, n) * 0.12); }
    },
  }),

  saturn: () => gas({
    zStretch: 22, streak: 0.04, seed: 9,
    bands: [
      [90, 0x6f7a7c], [86, 0x7d8784], [81, 0x9a9a88], [77, 0xa9a68f], [72, 0xbcae88], [66, 0xc9b78d], [60, 0xb9a47c], [55, 0xd2be92],
      [48, 0xd8c497], [46.5, 0xa99474], [44, 0xdcc89c], [37, 0xd5c095], [31, 0xdfcda1], [24, 0xd2bc8f], [18, 0xe3d2a7], [12, 0xead9ae],
      [5, 0xeedfb6], [-5, 0xecdcb2], [-12, 0xe0cda2], [-20, 0xd0ba8c], [-27, 0xdbc79b], [-34, 0xcab489], [-42, 0xd3bf94], [-52, 0xc0ad87],
      [-62, 0xb5a585], [-72, 0xa79d86], [-82, 0x9b9586], [-90, 0x948f84],
    ],
    turb: (lat) => 0.5 + 0.8 * Math.exp(-((Math.abs(lat) - 40) * (Math.abs(lat) - 40)) / 60),
    post: (p, lat, lon, o) => {
      // the "ribbon": a wavy jet at 47 N
      const rib = lat - (47 + 0.9 * Math.sin((lon * 12 * Math.PI) / 180 + noise3(p[0] * 6, p[1] * 6, 3) * 1.5));
      blend(o, [0.6, 0.52, 0.4], Math.exp(-(rib * rib) / 0.25) * 0.5);
    },
  }),

  uranus: () => gas({
    zStretch: 10, streak: 0.02, seed: 10,
    bands: [[90, [0.78, 0.92, 0.92]], [70, [0.74, 0.9, 0.91]], [55, [0.66, 0.85, 0.88]], [40, [0.62, 0.83, 0.87]], [20, [0.6, 0.82, 0.86]],
      [0, [0.6, 0.81, 0.86]], [-20, [0.6, 0.8, 0.85]], [-40, [0.63, 0.82, 0.86]], [-48, [0.7, 0.86, 0.88]], [-60, [0.62, 0.8, 0.85]], [-90, [0.6, 0.78, 0.84]]],
    turb: () => 1.5,
    features: [{ t: 'spots', n: 6, size: [0.6, 1.4], latRange: [25, 45], col: [0.9, 0.97, 0.97], amt: 0.7, warp: 0.5 }],
  }),

  neptune: () => gas({
    zStretch: 12, streak: 0.05, seed: 12,
    bands: [[90, [0.28, 0.44, 0.78]], [65, [0.3, 0.48, 0.82]], [45, [0.28, 0.47, 0.84]], [25, [0.3, 0.5, 0.86]], [5, [0.33, 0.53, 0.88]],
      [-10, [0.3, 0.5, 0.87]], [-30, [0.27, 0.46, 0.85]], [-50, [0.22, 0.38, 0.75]], [-62, [0.25, 0.42, 0.8]], [-75, [0.31, 0.5, 0.84]], [-90, [0.33, 0.52, 0.85]]],
    turb: () => 2.5,
    features: [
      { t: 'lines', n: 14, w: 0.5, len: [8, 30], latRange: [-46, -26], col: [0.85, 0.9, 0.98], amt: 0.85, wobble: 0.6 },
      { t: 'lines', n: 8, w: 0.4, len: [6, 18], latRange: [22, 38], col: [0.85, 0.9, 0.98], amt: 0.7, wobble: 0.5 },
    ],
  }),

  io: () => rocky({
    base: [0.88, 0.8, 0.44], tint: [0.9, 0.88, 0.72], tintAmp: 0.6, tintFreq: 3.5, rough: 0.12, craters: null,
    features: [
      { t: 'cap', north: true, r: 32, soft: 10, warp: 8, col: [0.55, 0.4, 0.28], amt: 0.75 },
      { t: 'cap', north: false, r: 30, soft: 10, warp: 8, col: [0.52, 0.38, 0.27], amt: 0.75 },
      { t: 'spots', n: 24, size: [2, 7], col: [0.85, 0.5, 0.22], amt: 0.55, warp: 0.4, latRange: [-60, 60] },
      { t: 'spots', n: 30, size: [2.5, 6], col: [0.93, 0.92, 0.84], amt: 0.5, warp: 0.6, latRange: [-50, 50] },
      { t: 'spots', n: 70, size: [0.4, 1.4], cols: [[0.08, 0.06, 0.05], [0.18, 0.12, 0.08], [0.35, 0.2, 0.1]], amt: 0.9, warp: 0.3, glow: 0.9, latRange: [-65, 65] },
      { t: 'ring', lat: -18.7, lon: 104.7, r: 17, w: 3.2, col: [0.78, 0.3, 0.14], amt: 0.8, warp: 0.4 },
      { t: 'spot', lat: -18.7, lon: 104.7, r: 0.9, col: [0.05, 0.04, 0.04] },
      { t: 'spot', lat: 13, lon: 51.2, r: 2.2, col: [0.06, 0.05, 0.05], warp: 0.4 },
      { t: 'ring', lat: -1.5, lon: -153, r: 5, w: 1.5, col: [0.95, 0.94, 0.88], amt: 0.6 },
      { t: 'ring', lat: 63, lon: -124, r: 8, w: 2, col: [0.7, 0.3, 0.15], amt: 0.5 },
    ],
  }),

  europa: () => rocky({
    base: [0.88, 0.83, 0.74], tint: [0.74, 0.62, 0.5], tintAmp: 0.35, tintFreq: 3, rough: 0.05,
    craters: { dens: 0.12, depth: 0.12, seed: 31, oct: 4 },
    features: [
      { t: 'hemi', lat: 0, lon: 90, r: 70, soft: 30, warp: 12, col: [0.62, 0.5, 0.4], amt: 0.55 },
      { t: 'lines', n: 70, w: 0.55, len: [15, 75], col: [0.55, 0.34, 0.22], amt: 0.85, double: true, wobble: 0.6, h: 0.0002 },
      { t: 'lines', n: 50, w: 0.3, len: [5, 25], col: [0.6, 0.42, 0.3], amt: 0.6, wobble: 0.4 },
      { t: 'spots', n: 18, size: [2, 6], col: [0.55, 0.4, 0.3], amt: 0.6, warp: 0.9, latRange: [-50, 50] },
      { t: 'crater', lat: -25, lon: 89, r: 0.9, depth: 0.0006, bright: 0.6, rays: { len: 14, amt: 0.4, n: 8 } },
    ],
  }),

  ganymede: () => rocky({
    base: [0.62, 0.6, 0.57], tint: [0.7, 0.69, 0.66], tintAmp: 0.4, rough: 0.1, fresh: [0.3, 0.3, 0.3],
    craters: { dens: 0.6, depth: 0.2, seed: 41 },
    features: [
      { t: 'spot', lat: 35, lon: -145, r: 36, col: [0.33, 0.29, 0.25], warp: 0.5, amt: 0.9 },
      { t: 'spot', lat: -5, lon: 160, r: 28, col: [0.35, 0.31, 0.27], warp: 0.6, amt: 0.85 },
      { t: 'spot', lat: -30, lon: 30, r: 22, col: [0.38, 0.34, 0.3], warp: 0.7, amt: 0.7 },
      { t: 'spot', lat: 30, lon: 60, r: 18, col: [0.38, 0.34, 0.3], warp: 0.7, amt: 0.6 },
      { t: 'lines', n: 90, w: 0.6, len: [10, 40], col: [0.75, 0.74, 0.71], amt: 0.5, wobble: 0.8, h: 0.0003 },
      { t: 'cap', north: true, r: 40, soft: 10, warp: 6, col: [0.82, 0.82, 0.82], amt: 0.5 },
      { t: 'cap', north: false, r: 40, soft: 10, warp: 6, col: [0.82, 0.82, 0.82], amt: 0.5 },
      { t: 'crater', lat: -38, lon: -166, r: 1.2, depth: 0.001, bright: 0.6, rays: { len: 15, amt: 0.45, n: 8 } },
      { t: 'crater', lat: 11, lon: -27, r: 1, depth: 0.001, bright: 0.5, rays: { len: 12, amt: 0.4, n: 7 } },
    ],
  }),

  callisto: () => rocky({
    base: [0.34, 0.3, 0.26], tint: [0.3, 0.26, 0.22], tintAmp: 0.4, rough: 0.12, fresh: [0.45, 0.43, 0.4],
    craters: { dens: 0.97, depth: 0.18, seed: 51, oct: 8 },
    features: [
      { t: 'crater', lat: 14.7, lon: -56, r: 6, depth: 0.001, big: 1, floor: [0.62, 0.6, 0.56], floorAmt: 0.8, flatten: 0.6, rings: 7, ringCol: [0.5, 0.48, 0.44], reach: 7 },
      { t: 'crater', lat: 32, lon: -140, r: 4, depth: 0.001, big: 1, floor: [0.55, 0.53, 0.5], floorAmt: 0.6, rings: 4, ringCol: [0.45, 0.43, 0.4], reach: 6 },
    ],
  }),

  // Titan's hidden surface: dune seas near the equator, bright Xanadu, hydrocarbon seas in the north
  titan: () => rocky({
    base: [0.42, 0.33, 0.22], tint: [0.3, 0.22, 0.15], tintAmp: 0.5, rough: 0.08, craters: { dens: 0.08, depth: 0.1, seed: 9, oct: 4 },
    features: [
      { t: 'band', lat0: -25, lat1: 25, col: [0.22, 0.16, 0.11], amt: 0.6, warp: 8 },
      { t: 'spot', lat: -10, lon: -100, r: 22, rx: 35, ry: 16, col: [0.62, 0.55, 0.45], warp: 0.5 },
      { t: 'spot', lat: 68, lon: -50, r: 9, col: [0.05, 0.05, 0.07], warp: 0.6 },
      { t: 'spot', lat: 78, lon: -110, r: 5, col: [0.05, 0.05, 0.07], warp: 0.6 },
      { t: 'spot', lat: 74, lon: -75, r: 4, col: [0.05, 0.05, 0.07], warp: 0.6 },
    ],
  }),

  enceladus: () => rocky({
    base: [0.94, 0.95, 0.97], tint: [0.88, 0.9, 0.93], tintAmp: 0.4, rough: 0.04, fresh: [0.06, 0.06, 0.06],
    craters: { dens: 0.55, depth: 0.25, seed: 61 },
    craterMod: (lat) => smoothstep(-30, 10, lat) * 0.9,
    features: [
      { t: 'path', pts: [[-72, -170], [-80, -120], [-84, -60], [-80, -10]], w: 1.0, depth: 0.0012, col: [0.62, 0.78, 0.82] },
      { t: 'path', pts: [[-70, 165], [-80, -150], [-86, -80], [-82, 0], [-76, 30]], w: 1.0, depth: 0.0012, col: [0.62, 0.78, 0.82] },
      { t: 'path', pts: [[-70, 140], [-78, 175], [-84, 120], [-80, 70]], w: 1.0, depth: 0.0012, col: [0.62, 0.78, 0.82] },
      { t: 'path', pts: [[-68, 120], [-74, 90], [-76, 60]], w: 1.0, depth: 0.0012, col: [0.62, 0.78, 0.82] },
      { t: 'lines', n: 30, w: 0.7, len: [10, 35], latRange: [-25, 30], col: [0.82, 0.86, 0.9], amt: 0.4, h: 0.0006 },
    ],
  }),

  mimas: () => rocky({
    base: [0.8, 0.79, 0.78], tint: [0.7, 0.7, 0.7], tintAmp: 0.3, rough: 0.06,
    craters: { dens: 0.95, depth: 0.32, seed: 71 },
    features: [{ t: 'crater', lat: 1.4, lon: -111.8, r: 20, depth: 0.05, big: 1, floor: [0.72, 0.71, 0.7], floorAmt: 0.3 }],
  }),

  tethys: () => rocky({
    base: [0.88, 0.88, 0.87], tint: [0.8, 0.8, 0.79], tintAmp: 0.3, rough: 0.05,
    craters: { dens: 0.85, depth: 0.25, seed: 81 },
    features: [
      { t: 'crater', lat: 32.8, lon: -128.9, r: 24, depth: 0.012, big: 1 },
      { t: 'path', pts: [[70, 30], [40, 5], [10, -5], [-20, -5], [-50, 10], [-75, 40]], w: 4, depth: 0.006, warp: 0.8, wall: true },
      { t: 'hemi', lat: 0, lon: 90, r: 60, soft: 30, col: [0.78, 0.8, 0.82], amt: 0.4 },
    ],
  }),

  dione: () => rocky({
    base: [0.8, 0.8, 0.79], tint: [0.7, 0.7, 0.7], tintAmp: 0.3, rough: 0.06,
    craters: { dens: 0.8, depth: 0.25, seed: 91 },
    features: [
      { t: 'hemi', lat: 0, lon: 90, r: 70, soft: 25, warp: 10, col: [0.55, 0.55, 0.56], amt: 0.6, flat: 0.5 },
      { t: 'lines', n: 30, w: 0.6, len: [10, 45], lonRange: [40, 140], latRange: [-50, 50], col: [0.95, 0.95, 0.96], amt: 0.85, wobble: 1.2, h: 0.0008 },
    ],
  }),

  rhea: () => rocky({
    base: [0.8, 0.79, 0.77], tint: [0.7, 0.69, 0.68], tintAmp: 0.3, rough: 0.06,
    craters: { dens: 0.92, depth: 0.25, seed: 101 },
    features: [
      { t: 'hemi', lat: 0, lon: 90, r: 65, soft: 25, warp: 10, col: [0.6, 0.6, 0.6], amt: 0.5 },
      { t: 'lines', n: 22, w: 0.5, len: [10, 40], lonRange: [50, 130], latRange: [-45, 45], col: [0.95, 0.95, 0.95], amt: 0.7, wobble: 1 },
      { t: 'crater', lat: -14, lon: -112, r: 1.8, depth: 0.002, bright: 0.7, rays: { len: 20, amt: 0.5, n: 8 } },
    ],
  }),

  iapetus: () => rocky({
    base: [0.78, 0.76, 0.72], tint: [0.7, 0.68, 0.64], tintAmp: 0.3, rough: 0.06, darkFloorCol: [0.1, 0.07, 0.05],
    craters: { dens: 0.9, depth: 0.28, seed: 111 },
    features: [
      { t: 'hemi', lat: 0, lon: -90, r: 68, soft: 6, warp: 16, col: [0.1, 0.065, 0.045], darkFloors: 1 },
      { t: 'ridge', lat: 0, lon: -90, lonSpan: 110, w: 1.4, h: 0.022 },
      { t: 'crater', lat: 17, lon: -28, r: 22, depth: 0.012, big: 1 },
      { t: 'crater', lat: -44, lon: -96, r: 18, depth: 0.012, big: 1 },
    ],
  }),

  hyperion: () => rocky({
    base: [0.66, 0.6, 0.52], tint: [0.5, 0.45, 0.38], tintAmp: 0.4, rough: 0.1, darkFloorCol: [0.18, 0.13, 0.09],
    craters: { dens: 0.97, depth: 0.55, seed: 121, oct: 6 }, smooth: 0,
    features: [{ t: 'hemi', lat: 0, lon: 0, r: 180, soft: 1, col: [0.6, 0.55, 0.48], amt: 0.01, darkFloors: 1 }],
  }),

  miranda: () => rocky({
    base: [0.68, 0.68, 0.68], tint: [0.55, 0.55, 0.56], tintAmp: 0.4, rough: 0.08,
    craters: { dens: 0.7, depth: 0.25, seed: 131 },
    features: [
      { t: 'mare', lat: -70, lon: 0, r: 22, col: [0.5, 0.5, 0.51], warp: 0.4, flat: 0.8 },
      { t: 'mare', lat: -20, lon: -90, r: 25, col: [0.56, 0.56, 0.57], warp: 0.3, flat: 0.8 },
      { t: 'mare', lat: -20, lon: 90, r: 24, col: [0.56, 0.56, 0.57], warp: 0.3, flat: 0.8 },
      { t: 'lines', n: 40, w: 0.9, len: [8, 25], latRange: [-80, 0], col: [0.82, 0.82, 0.83], amt: 0.7, wobble: 0.3, h: 0.003 },
      { t: 'path', pts: [[-15, -15], [-35, -25], [-55, -35]], w: 1.2, depth: -0.02, col: [0.85, 0.85, 0.86], amt: 0.6 },
    ],
  }),

  ariel: () => rocky({
    base: [0.72, 0.72, 0.71], tint: [0.62, 0.62, 0.62], tintAmp: 0.3, rough: 0.06,
    craters: { dens: 0.55, depth: 0.2, seed: 141 },
    features: [{ t: 'lines', n: 18, w: 1.2, len: [20, 70], col: [0.55, 0.55, 0.55], amt: 0.6, wobble: 0.5, h: -0.002 }],
  }),

  umbriel: () => rocky({
    base: [0.36, 0.36, 0.37], tint: [0.3, 0.3, 0.31], tintAmp: 0.3, rough: 0.06,
    craters: { dens: 0.95, depth: 0.25, seed: 151 },
    features: [{ t: 'ring', lat: -7.9, lon: -86.4, r: 4.5, w: 1.2, col: [0.85, 0.85, 0.85], amt: 0.9 }],
  }),

  titania: () => rocky({
    base: [0.6, 0.57, 0.55], tint: [0.5, 0.48, 0.47], tintAmp: 0.35, rough: 0.07,
    craters: { dens: 0.8, depth: 0.22, seed: 161 },
    features: [
      { t: 'path', pts: [[-10, 0], [-25, 25], [-35, 60], [-30, 95]], w: 2.2, depth: 0.004, warp: 0.6, wall: true },
      { t: 'path', pts: [[10, -60], [-5, -35], [-20, -10]], w: 1.6, depth: 0.003, warp: 0.6 },
      { t: 'crater', lat: -9.2, lon: -26, r: 2.6, depth: 0.003, bright: 0.5, rays: { len: 10, amt: 0.3, n: 6 } },
    ],
  }),

  oberon: () => rocky({
    base: [0.52, 0.48, 0.46], tint: [0.44, 0.4, 0.38], tintAmp: 0.35, rough: 0.07, darkFloorCol: [0.12, 0.1, 0.09],
    craters: { dens: 0.92, depth: 0.25, seed: 171 },
    features: [
      { t: 'hemi', lat: 0, lon: 0, r: 180, soft: 1, col: [0.5, 0.47, 0.45], amt: 0.01, darkFloors: 0.8 },
      { t: 'crater', lat: -46, lon: 44, r: 7, depth: 0.004, floor: [0.15, 0.13, 0.12], floorAmt: 0.8, bright: 0.2, rays: { len: 10, amt: 0.25, n: 6 } },
    ],
  }),

  triton: () => rocky({
    base: [0.66, 0.68, 0.64], tint: [0.58, 0.62, 0.6], tintAmp: 0.5, rough: 0.08,
    craters: { dens: 0.18, depth: 0.15, seed: 181, oct: 5 },
    features: [
      { t: 'cap', north: false, r: 70, soft: 6, warp: 10, col: [0.88, 0.76, 0.7] },
      { t: 'cells', lat: 20, lon: -30, r: 55, freq: 70, col: [0.58, 0.63, 0.58], edge: [0.42, 0.48, 0.45], h: 0.0004 },
      { t: 'spots', n: 60, size: [0.4, 0.9], latRange: [-60, -20], col: [0.32, 0.26, 0.24], amt: 0.8, warp: 0.6 },
    ],
  }),

  pluto: () => rocky({
    base: [0.78, 0.66, 0.52], tint: [0.66, 0.5, 0.38], tintAmp: 0.5, rough: 0.08,
    craters: { dens: 0.4, depth: 0.15, seed: 191, oct: 6 },
    features: [
      { t: 'spot', lat: -5, lon: 85, r: 30, rx: 55, ry: 13, col: [0.24, 0.12, 0.08], warp: 0.4 },
      { t: 'spot', lat: -8, lon: -60, r: 18, rx: 28, ry: 10, col: [0.3, 0.16, 0.1], warp: 0.5, amt: 0.85 },
      { t: 'spot', lat: -2, lon: -140, r: 20, rx: 22, ry: 16, col: [0.93, 0.89, 0.82], warp: 0.4 },
      { t: 'cells', lat: 22, lon: 178, r: 21, freq: 95, col: [0.95, 0.92, 0.86], edge: [0.72, 0.66, 0.58], h: 0.0006 },
      { t: 'cap', north: true, r: 40, soft: 10, warp: 8, col: [0.76, 0.7, 0.58], amt: 0.7 },
      { t: 'cap', north: true, r: 12, soft: 5, warp: 3, col: [0.72, 0.72, 0.72], amt: 0.6 },
    ],
  }),

  charon: () => rocky({
    base: [0.56, 0.54, 0.53], tint: [0.48, 0.47, 0.46], tintAmp: 0.35, rough: 0.06,
    craters: { dens: 0.6, depth: 0.22, seed: 201 },
    features: [
      { t: 'cap', north: true, r: 22, soft: 6, warp: 6, col: [0.36, 0.2, 0.14] },
      { t: 'path', pts: [[5, -60], [12, 0], [5, 60]], w: 2.5, depth: 0.006, warp: 0.8, wall: true },
      { t: 'mare', lat: -25, lon: 0, r: 40, col: [0.6, 0.58, 0.57], flat: 0.6, warp: 0.4 },
    ],
  }),

  ceres: () => rocky({
    base: [0.32, 0.31, 0.3], tint: [0.27, 0.27, 0.27], tintAmp: 0.4, rough: 0.08, fresh: [0.2, 0.2, 0.2],
    craters: { dens: 0.9, depth: 0.28, seed: 211 },
    features: [
      { t: 'crater', lat: 19.8, lon: -120.7, r: 5.6, depth: 0.012, big: 1 },
      { t: 'spot', lat: 19.8, lon: -120.7, r: 0.7, col: [1.0, 1.0, 0.98], soft: 0.3 },
      { t: 'spots', n: 4, size: [0.2, 0.4], latRange: [20, 22], lonRange: [-118, -116], col: [0.9, 0.9, 0.88], amt: 0.9 },
      { t: 'volcano', lat: -10.5, lon: -43.8, r: 1.4, h: 0.009, caldera: 0, col: [0.7, 0.7, 0.68], amt: 0.7 },
      { t: 'crater', lat: 2, lon: 120, r: 17, depth: 0.012, big: 1 },
    ],
  }),

  vesta: () => rocky({
    base: [0.56, 0.52, 0.48], tint: [0.42, 0.38, 0.34], tintAmp: 0.6, tintFreq: 3, rough: 0.1,
    craters: { dens: 0.85, depth: 0.3, seed: 221 },
    features: [
      { t: 'crater', lat: -75, lon: -59, r: 31, depth: 0.1, big: 1 },
      { t: 'crater', lat: -52, lon: -170, r: 22, depth: 0.05, big: 0.6 },
      { t: 'band', lat0: -22, lat1: -6, col: [0.48, 0.44, 0.4], amt: 0.4 },
      { t: 'crater', lat: 9, lon: -170, r: 6, depth: 0.03 }, { t: 'crater', lat: 13, lon: -162, r: 4.5, depth: 0.025 }, { t: 'crater', lat: 4, lon: -165, r: 3.5, depth: 0.02 },
    ],
    post: (p, lat, _lon, o) => {
      // Divalia Fossae: troughs ringing the equator, thrown up by the Rheasilvia impact
      if (lat > -28 && lat < 0) { const s = Math.sin(lat * 1.6 + noise3(p[0] * 8, p[1] * 8, p[2] * 8) * 0.6); o.h -= 0.004 * smoothstep(0.85, 1, s) * smoothstep(-28, -18, lat) * smoothstep(0, -6, lat); }
    },
  }),

  phobos: () => rocky({
    base: [0.36, 0.33, 0.3], tint: [0.3, 0.27, 0.25], tintAmp: 0.4, rough: 0.08,
    craters: { dens: 0.9, depth: 0.35, seed: 231 },
    features: [
      { t: 'crater', lat: -1, lon: -49, r: 22, depth: 0.12, big: 0.5, floor: [0.42, 0.38, 0.34], floorAmt: 0.4 },
      { t: 'lines', n: 26, w: 1.0, len: [40, 80], col: [0.3, 0.27, 0.25], amt: 0.5, h: -0.006 },
    ],
  }),
};

export function painterFor(b) {
  const look = b.look || {};
  const make = PAINTERS[look.paint || b.id];
  if (make) return make();
  return rocky({
    base: look.col || [0.5, 0.5, 0.5], tint: (look.col || [0.5, 0.5, 0.5]).map((v) => v * 0.78), tintAmp: 0.4, rough: 0.1,
    craters: { dens: look.craters === undefined ? 0.8 : look.craters, depth: 0.3, seed: (b.id.length * 97 + b.id.charCodeAt(0)) | 0 },
    smooth: look.smooth || 0,
  });
}
