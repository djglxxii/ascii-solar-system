// The sky behind everything: the naked-eye stars of the Yale Bright Star Catalogue in their real
// places, a fainter random field concentrated toward the galactic plane, and the Milky Way itself
// (bulge, Great Rift, Magellanic Clouds, Andromeda) baked into an ecliptic sky map.

import { STAR_COUNT, STARS_B64 } from './data/stars.js';
import { radecToEcl } from './astro.js';
import { blackbody, fbm3, clamp, smoothstep, RNG, DEG, TAU } from './util.js';

export class StarField {
  constructor() {
    const bin = atob(STARS_B64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dv = new DataView(u8.buffer);
    const extra = 7000;
    const n = STAR_COUNT + extra;
    this.n = n;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.mag = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const ra = (dv.getUint16(i * 6, true) / 65535) * 360;
      const dec = (dv.getUint16(i * 6 + 2, true) / 65535) * 180 - 90;
      const v = radecToEcl(ra, dec);
      this.x[i] = v[0]; this.y[i] = v[1]; this.z[i] = v[2];
      this.mag[i] = u8[i * 6 + 4] / 25 - 2;
      const c = blackbody(u8[i * 6 + 5] * 100);
      this.col.set(c, i * 3);
    }
    this.gal = galacticBasis();
    // faint filler stars, crowding toward the plane of the Galaxy
    const rng = new RNG(4242);
    for (let i = STAR_COUNT; i < n;) {
      const z = rng.range(-1, 1), a = rng.range(0, TAU), r = Math.sqrt(1 - z * z);
      const d = [r * Math.cos(a), r * Math.sin(a), z];
      const b = Math.abs(this.gal.z[0] * d[0] + this.gal.z[1] * d[1] + this.gal.z[2] * d[2]);
      if (rng.next() > 0.25 + 0.75 * Math.exp(-b * b * 30)) continue;
      this.x[i] = d[0]; this.y[i] = d[1]; this.z[i] = d[2];
      this.mag[i] = 6.2 + rng.next() * 1.6;
      this.col.set(blackbody(rng.range(3200, 11000)), i * 3);
      i++;
    }
    this.mw = milkyWay(this.gal);
  }
}

function galacticBasis() {
  const z = radecToEcl(192.85948, 27.12825);
  let x = radecToEcl(266.40499, -28.93617);
  const d = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
  x = [x[0] - z[0] * d, x[1] - z[1] * d, x[2] - z[2] * d];
  const l = Math.hypot(...x); x = x.map((v) => v / l);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return { x, y, z };
}

// Equirectangular map (ecliptic longitude/latitude) of diffuse galactic light, RGB.
function milkyWay(G) {
  const W = 512, H = 256;
  const img = new Float32Array(W * H * 3);
  const lmc = radecToEcl(80.89, -69.76), smc = radecToEcl(13.19, -72.83), m31 = radecToEcl(10.68, 41.27);
  for (let y = 0; y < H; y++) {
    const lat = (90 - ((y + 0.5) * 180) / H) * DEG;
    for (let x = 0; x < W; x++) {
      const lon = (-180 + ((x + 0.5) * 360) / W) * DEG;
      const d = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
      const gx = d[0] * G.x[0] + d[1] * G.x[1] + d[2] * G.x[2];
      const gy = d[0] * G.y[0] + d[1] * G.y[1] + d[2] * G.y[2];
      const gz = d[0] * G.z[0] + d[1] * G.z[1] + d[2] * G.z[2];
      const l = Math.atan2(gy, gx) / DEG, b = Math.asin(clamp(gz, -1, 1)) / DEG;
      const n = fbm3(d[0] * 6, d[1] * 6, d[2] * 6, 5), n2 = fbm3(d[0] * 18 + 3, d[1] * 18, d[2] * 18, 3);
      const width = 6 + 5 * Math.exp(-(l * l) / 900) + 2 * n;
      const disk = Math.exp(-(b * b) / (width * width)) * (0.45 + 0.55 * Math.exp(-(l * l) / 3600));
      const bulge = 1.2 * Math.exp(-((l * l) / 140 + (b * b) / 70));
      // the Great Rift: dust lanes splitting the band from Cygnus down to Sagittarius
      const rift = Math.exp(-((b - 1.2 - 1.5 * n) * (b - 1.2 - 1.5 * n)) / 3.5) * smoothstep(75, 30, Math.abs(l - 15));
      let I = (disk + bulge) * (1 - 0.7 * rift) * (0.75 + 0.5 * n + 0.25 * n2);
      const blob = (c, r) => Math.exp(-(1 - (d[0] * c[0] + d[1] * c[1] + d[2] * c[2])) / (r * r * DEG * DEG * 0.5));
      I += 0.6 * blob(lmc, 3.5) + 0.35 * blob(smc, 1.8) + 0.25 * blob(m31, 0.9);
      I = Math.max(0, I) * 0.03;
      const warm = Math.exp(-(l * l) / 1500);
      const k = (y * W + x) * 3;
      img[k] = I * (0.85 + 0.12 * warm); img[k + 1] = I * (0.88 + 0.05 * warm); img[k + 2] = I * (1.0 - 0.08 * warm);
    }
  }
  return { W, H, img };
}
