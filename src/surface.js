// Runtime surface sampling: the baked map plus everything that moves or needs more detail than a
// texture holds: zonal winds, the Great Red Spot and other vortices turning in place, Saturn's polar
// hexagon, Juno's polar cyclone clusters, seasonal Martian frost, drifting Earth clouds and fractal
// detail that keeps appearing as you descend.

import { sampleTex, sampleH } from './textures.js';
import { craters } from './paint.js';
import { fbm3, noise3, clamp, smoothstep, DEG } from './util.js';
import { K } from './bodies.js';

const RAD = 180 / Math.PI;

// Zonal drift (degrees of longitude per day, relative to the body's rotation) by latitude band.
const DRIFT = {
  jupiter: (lat) => (Math.abs(lat) < 7 ? 7.3 : lat >= 7 && lat < 17 ? 0.4 : lat >= 17 && lat < 25 ? 2.2 : lat <= -7 && lat > -18 ? -0.5 : lat <= -18 && lat > -27 ? -0.2 : lat <= -27 && lat > -37 ? -1.0 : 0),
  saturn: (lat) => (Math.abs(lat) < 15 ? 30 : Math.abs(lat) < 30 ? 12 : 0),
  neptune: (lat) => (Math.abs(lat) < 14 ? -80 : lat <= -14 && lat > -32 ? -65 : lat <= -32 && lat > -50 ? -30 : lat >= 14 && lat < 40 ? -40 : 8),
  uranus: (lat) => (Math.abs(lat) < 20 ? -12 : 18),
};

// Storms that turn in place. lon is in the drifting frame of their band; rx/ry are half sizes in
// degrees (east-west at that latitude, north-south); spin +1 counter-clockwise seen from outside.
const VORTICES = {
  jupiter: [
    { lat: -22.3, lon: 52, rx: 7.0, ry: 4.4, core: [0.74, 0.36, 0.2], edge: [0.86, 0.56, 0.38], collar: [0.94, 0.9, 0.82], hollow: 1.5, spin: 1, period: 6, seed: 1 },
    { lat: -33.2, lon: 118, rx: 2.3, ry: 1.8, core: [0.84, 0.6, 0.46], edge: [0.95, 0.9, 0.84], collar: [0.9, 0.87, 0.82], hollow: 1.3, spin: 1, period: 3, seed: 2 },
    { lat: 15.4, lon: 205, rx: 2.4, ry: 0.85, core: [0.36, 0.2, 0.13], edge: [0.5, 0.3, 0.2], spin: -1, period: 3, seed: 3 },
    { lat: 15.0, lon: 300, rx: 1.8, ry: 0.75, core: [0.38, 0.21, 0.14], edge: [0.5, 0.31, 0.21], spin: -1, period: 3, seed: 4 },
    { lat: -40.5, lon: 260, rx: 1.6, ry: 1.3, core: [0.97, 0.95, 0.9], edge: [0.92, 0.88, 0.82], spin: 1, period: 2, seed: 5 },
  ],
  neptune: [
    { lat: -20, lon: 30, rx: 14, ry: 7, core: [0.07, 0.13, 0.4], edge: [0.16, 0.27, 0.62], spin: 1, period: 0.8, seed: 6, companion: true },
    { lat: -42, lon: 140, rx: 2.4, ry: 1.4, core: [0.9, 0.94, 0.99], edge: [0.7, 0.8, 0.95], spin: 1, period: 0.5, seed: 7 },
    { lat: -55, lon: 250, rx: 4, ry: 2.6, core: [0.75, 0.85, 0.98], edge: [0.12, 0.22, 0.55], spin: 1, period: 0.6, seed: 8 },
  ],
  saturn: [{ lat: 41, lon: 60, rx: 1.8, ry: 1.2, core: [0.92, 0.86, 0.72], edge: [0.82, 0.74, 0.58], spin: -1, period: 2, seed: 9 }],
};

function vortex(v, latD, lonD, days, S) {
  let dl = lonD - v.lon;
  dl -= Math.round(dl / 360) * 360;
  const qx = (dl * Math.cos(latD * DEG)) / v.rx, qy = (latD - v.lat) / v.ry;
  const q = Math.hypot(qx, qy);
  const reach = v.hollow || 1.25;
  if (q > reach + 0.2) return;
  const ang = Math.atan2(qy, qx) + v.spin * ((days / v.period) * 6.283 * (1.15 - q * 0.6) + 2.6 * (1 - Math.min(1, q)));
  const sx = q * Math.cos(ang), sy = q * Math.sin(ang);
  const n = fbm3(sx * 2.6 + v.seed * 7, sy * 2.6, v.seed, 4);
  const spiral = Math.sin(Math.atan2(sy, sx) * 2 + q * 9);
  if (v.collar) {
    const wc = smoothstep(0.95, 1.08, q) * smoothstep(reach + 0.15, reach - 0.25, q);
    S.r += (v.collar[0] - S.r) * wc * 0.8; S.g += (v.collar[1] - S.g) * wc * 0.8; S.b += (v.collar[2] - S.b) * wc * 0.8;
  }
  const w = smoothstep(1.05, 0.88, q + n * 0.08);
  if (w <= 0) return;
  const t = q * q;
  const k = 1 + n * 0.16 + spiral * 0.05;
  const r = (v.core[0] + (v.edge[0] - v.core[0]) * t) * k, g = (v.core[1] + (v.edge[1] - v.core[1]) * t) * k, b = (v.core[2] + (v.edge[2] - v.core[2]) * t) * k;
  S.r += (r - S.r) * w; S.g += (g - S.g) * w; S.b += (b - S.b) * w;
  if (v.companion) {
    // bright methane cirrus hugging the southern rim of Neptune's dark spot
    const c = smoothstep(0.85, 1.0, q) * smoothstep(1.3, 1.05, q) * smoothstep(0.1, -0.5, qy) * smoothstep(0.2, 0.6, n + 0.5);
    S.r += (0.95 - S.r) * c; S.g += (0.97 - S.g) * c; S.b += (1.0 - S.b) * c;
  }
}

// Saturn's north polar hexagon: a six-sided jet at 78 N around a hurricane-like polar vortex.
function hexagon(latD, lonD, px, py, S) {
  const rho = 90 - latD;
  if (rho > 22) return;
  const sec = (((lonD + 30) % 60) + 60) % 60 - 30;
  const rh = 12 / Math.cos(sec * DEG);
  const wave = 0.3 * Math.sin(lonD * DEG * 18 + noise3(px * 30, py * 30, 1) * 2);
  const s = (rho + wave) / rh;
  const inside = smoothstep(1.03, 0.97, s);
  let r = S.r, g = S.g, b = S.b;
  const n = fbm3(px * 40, py * 40, 2.5, 3);
  // interior: blue-grey haze turning gold toward the rim
  const ir = 0.4 + 0.2 * s + n * 0.04, ig = 0.5 + 0.12 * s + n * 0.04, ib = 0.56 + n * 0.03;
  r += (ir - r) * inside; g += (ig - g) * inside; b += (ib - b) * inside;
  // the jet itself: a dark six-sided river of cloud with a bright band just outside it
  const jet = Math.exp(-((s - 1) * (s - 1)) / 0.006);
  r += (0.3 - r) * jet * 0.85; g += (0.27 - g) * jet * 0.85; b += (0.22 - b) * jet * 0.85;
  const rim = Math.exp(-((s - 1.12) * (s - 1.12)) / 0.004);
  r += (0.93 - r) * rim * 0.6; g += (0.86 - g) * rim * 0.6; b += (0.68 - b) * rim * 0.6;
  // the polar vortex: a dark eye ringed by bright cloud, spiral arms
  if (rho < 4.5) {
    const th = Math.atan2(py, px);
    const sp = Math.sin(th * 3 + Math.log(rho + 0.2) * 7);
    const eye = smoothstep(0.9, 0.5, rho), ring = Math.exp(-((rho - 1.3) * (rho - 1.3)) / 0.25);
    const arms = smoothstep(4.5, 1.5, rho) * (0.5 + 0.5 * sp) * 0.3;
    r += (0.32 - r) * eye; g += (0.34 - g) * eye; b += (0.34 - b) * eye;
    r += (0.85 - r) * (ring * 0.6 + arms); g += (0.84 - g) * (ring * 0.6 + arms); b += (0.78 - b) * (ring * 0.6 + arms);
  }
  S.r = r; S.g = g; S.b = b;
}

// Juno's polar cyclones: eight round the north pole, five round the south, plus one on each pole.
const CYC_N = [[0, 0]], CYC_S = [[0, 0]];
for (let k = 0; k < 8; k++) CYC_N.push([7.2 * Math.cos((k * Math.PI) / 4 + 0.3), 7.2 * Math.sin((k * Math.PI) / 4 + 0.3)]);
for (let k = 0; k < 5; k++) CYC_S.push([6.6 * Math.cos((k * 2 * Math.PI) / 5 + 1.1), 6.6 * Math.sin((k * 2 * Math.PI) / 5 + 1.1)]);
function cyclones(latD, lonD, S, days) {
  const north = latD > 0;
  const rho = 90 - Math.abs(latD);
  if (rho > 12) return;
  const th = lonD * DEG * (north ? 1 : -1);
  const x = rho * Math.cos(th), y = rho * Math.sin(th);
  const list = north ? CYC_N : CYC_S, rad = north ? 2.3 : 2.9;
  for (let i = 0; i < list.length; i++) {
    const dx = x - list[i][0], dy = y - list[i][1];
    const r = Math.hypot(dx, dy) / rad;
    if (r > 1.25) continue;
    const a = Math.atan2(dy, dx) + (north ? 1 : -1) * days * 0.8;
    const sp = Math.sin(a * 2 - Math.log(r + 0.04) * 6 + i);
    const w = smoothstep(1.25, 0.8, r);
    const n = noise3(dx * 3, dy * 3, i * 3.3);
    const lt = 0.5 + 0.5 * sp + n * 0.2;
    const cr = 0.42 + 0.42 * lt, cg = 0.43 + 0.38 * lt, cb = 0.47 + 0.3 * lt;
    S.r += (cr - S.r) * w * 0.85; S.g += (cg - S.g) * w * 0.85; S.b += (cb - S.b) * w * 0.85;
    return;
  }
}

// Shared scratch for samples.
export const S = { r: 0, g: 0, b: 0, h: 0, m: 0, c: 0, l: 0, kind: 0, spec: 0, emit: 0, er: 0, eg: 0, eb: 0 };
const CS = { r: 0, g: 0, b: 0, h: 0, m: 0, c: 0, l: 0 };

// Sample body b at body-fixed unit vector (px, py, pz). lod: angular footprint of the sample on
// the unit sphere (radians). days: days since J2000. Fills S.
export function sampleSurface(b, tex, px, py, pz, lod, days, season) {
  const lat = Math.asin(clamp(pz, -1, 1)), lon = Math.atan2(py, px);
  const latD = lat * RAD;
  const look = b.look, id = b.id;
  let lonT = lon;
  const drift = DRIFT[id];
  if (drift) lonT = lon - drift(latD) * days * DEG;
  else if (look.cloudDrift) lonT = lon - look.cloudDrift * days * DEG;
  sampleTex(tex, lonT, lat, S);
  S.kind = look.ramp; S.spec = 0; S.emit = 0;
  const texel = tex.texel;
  const fine = lod < texel ? clamp(Math.log2(texel / lod), 0, 7) : 0;

  if (id === 'earth') {
    // clouds ride slowly east of the ground; city lights are emissive
    const cl = lon - 3.0 * days * DEG;
    sampleTex(tex, cl, lat, CS);
    let c = CS.c;
    if (fine > 0) {
      const f = 1 / texel;
      const n = fbm3(px * f * 0.7, py * f * 0.7, pz * f * 0.7, Math.min(5, fine + 1));
      c = clamp(c + n * 0.35 * Math.min(1, fine / 2), 0, 1);
      const nl = fbm3(px * f * 1.3 + 7, py * f * 1.3, pz * f * 1.3, Math.min(5, fine));
      if (S.m === 0) { const k = 1 + nl * 0.25; S.r *= k; S.g *= k; S.b *= k; S.h += nl * texel * 0.08; }
      else if (S.m === 2) { S.h += nl * texel * 0.02; }
    }
    S.c = smoothstep(0.12, 0.85, c);
    S.kind = S.c > 0.5 ? K.CLOUD : S.m === 1 ? K.OCEAN : S.m === 2 ? K.ICE : K.LAND;
    S.spec = S.m === 1 ? 1 : 0;
    return S;
  }

  if (look.ramp === K.GAS) {
    const v = VORTICES[id];
    const lonDT = lonT * RAD;
    if (v) for (let i = 0; i < v.length; i++) vortex(v[i], latD, lonDT, days, S);
    if (id === 'saturn' && latD > 66) hexagon(latD, lon * RAD, px, py, S);
    if (id === 'saturn' && latD < -84) {
      const rho = 90 + latD, eye = smoothstep(1.4, 0.6, rho), ring = Math.exp(-((rho - 2) * (rho - 2)) / 0.6);
      S.r += (0.4 - S.r) * eye + (0.9 - S.r) * ring * 0.4; S.g += (0.38 - S.g) * eye + (0.85 - S.g) * ring * 0.4; S.b += (0.34 - S.b) * eye + (0.75 - S.b) * ring * 0.4;
    }
    if (id === 'jupiter' && Math.abs(latD) > 76) cyclones(latD, lon * RAD, S, days);
    if (fine > 0) {
      const f = 1 / texel;
      // streaky turbulence stretched along the zonal flow
      const w = noise3(px * f * 0.5, py * f * 0.5, pz * f * 3);
      const n = fbm3(px * f + w * 1.5, py * f, pz * f * 6, Math.min(5, fine + 1));
      let k = 1 + n * 0.22;
      if (fine > 1.5) {
        // towering convective cells and their shadowed gaps, only resolvable up close
        const c = fbm3(px * f * 4 + w, py * f * 4, pz * f * 4, Math.min(4, fine - 1));
        k += smoothstep(0.05, 0.45, c) * 0.25 * Math.min(1, fine - 1.5) - smoothstep(-0.1, -0.45, c) * 0.15;
      }
      S.r *= k; S.g *= k; S.b *= k;
    }
    return S;
  }

  if (id === 'mars' && season !== undefined) {
    // seasonal carbon-dioxide frost: the winter cap reaches down toward 55 degrees
    const capN = 90 - (7 + Math.max(0, -season) * 1.35), capS = -90 + (7 + Math.max(0, season) * 1.35);
    const nz = fbm3(px * 6, py * 6, pz * 6, 3) * 3;
    const w = Math.max(smoothstep(capN - 1.5, capN + 1.5, latD + nz), smoothstep(capS + 1.5, capS - 1.5, latD + nz));
    if (w > 0) { S.r += (0.93 - S.r) * w * 0.85; S.g += (0.92 - S.g) * w * 0.85; S.b += (0.92 - S.b) * w * 0.85; S.kind = K.ICE; }
  }

  if (S.l > 0.02 && id === 'io') { S.emit = S.l; }

  if (fine > 0) {
    const f = 1 / texel;
    const n = fbm3(px * f, py * f, pz * f, Math.min(6, fine + 1));
    const k = 1 + n * (look.ramp === K.CLOUD ? 0.05 : 0.14);
    S.r *= k; S.g *= k; S.b *= k;
    if (look.ramp !== K.CLOUD) S.h += detailHeight(b, px, py, pz, lod, texel, n);
  }
  return S;
}

const DO = { h: 0, f: 0 };
// Relief finer than the texture: fractal roughness plus small craters at the right scale.
function detailHeight(b, px, py, pz, lod, texel, n) {
  let h = n * texel * 0.12;
  const dens = b.look.craters === undefined ? 0.8 : b.look.craters;
  if (dens > 0 && b.look.ramp !== K.GAS) {
    DO.h = 0; DO.f = 0;
    const P = [px, py, pz];
    let cell = texel * 2.2;
    for (let k = 0; k < 3 && cell > lod * 2; k++) {
      craters(P, cell, dens * 0.8, 0.3, 900 + k * 7, DO, 0);
      cell *= 0.5;
    }
    h += DO.h;
  }
  return h;
}

// Height only, for relief slopes (same layers as sampleSurface).
export function sampleHeight(b, tex, px, py, pz, lod) {
  const lat = Math.asin(clamp(pz, -1, 1)), lon = Math.atan2(py, px);
  let h = sampleH(tex, lon, lat);
  const texel = tex.texel;
  if (lod < texel && b.look.ramp !== K.CLOUD && b.look.ramp !== K.GAS) {
    const fine = clamp(Math.log2(texel / lod), 0, 7);
    const f = 1 / texel;
    if (b.id === 'earth') h += fbm3(px * f * 1.3 + 7, py * f * 1.3, pz * f * 1.3, fine) * texel * 0.08;
    else h += detailHeight(b, px, py, pz, lod, texel, fbm3(px * f, py * f, pz * f, fine + 1));
  }
  return h;
}

// Solar surface: limb darkening, granulation and a few sunspot groups.
const SPOTS = [];
{
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 9; k++) {
    const lat = (rnd() < 0.5 ? -1 : 1) * (8 + rnd() * 22), lon = rnd() * 360 - 180, r = 0.6 + rnd() * 1.6;
    SPOTS.push({ c: [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)], r: r * DEG });
    const n = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      const la = lat + (rnd() - 0.5) * 3, lo = lon + 2 + rnd() * 5;
      SPOTS.push({ c: [Math.cos(la * DEG) * Math.cos(lo * DEG), Math.cos(la * DEG) * Math.sin(lo * DEG), Math.sin(la * DEG)], r: (0.3 + rnd() * 0.6) * DEG });
    }
  }
}
export function sampleSun(px, py, pz, mu, lod, days, out) {
  const f = Math.min(600, 0.5 / Math.max(lod, 1e-5));
  const oct = clamp(Math.log2(f / 8), 1, 6);
  const g = fbm3(px * 80 + days * 0.3, py * 80, pz * 80, oct);
  const gran = 1 + 0.12 * g;
  let spot = 1;
  for (const s of SPOTS) {
    const d = Math.acos(clamp(px * s.c[0] + py * s.c[1] + pz * s.c[2], -1, 1));
    if (d < s.r * 2.2) spot *= 1 - 0.55 * smoothstep(s.r * 2.2, s.r * 1.2, d) - 0.35 * smoothstep(s.r, s.r * 0.6, d);
  }
  const ld = 1 - 0.62 * (1 - mu) - 0.18 * (1 - mu) * (1 - mu);
  const fac = 1 + 0.25 * smoothstep(0.35, 0.05, mu) * Math.max(0, fbm3(px * 30, py * 30, pz * 30, 3));
  const I = ld * gran * spot * fac;
  out.r = I * 1.0; out.g = I * (0.86 + 0.1 * mu); out.b = I * (0.62 + 0.25 * mu);
  out.spot = spot; out.gran = g;
  return out;
}
