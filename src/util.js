// Small math, hashing, noise, vector and colour helpers shared by every module.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const fract = (x) => x - Math.floor(x);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const wrap360 = (a) => ((a % 360) + 360) % 360;

// Integer hash -> uint32. Deterministic, fast, decent avalanche.
export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export const hashf = (a, b = 0, c = 0) => hash3(a, b, c) / 4294967296;

export class RNG {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  gauss() { return Math.sqrt(-2 * Math.log(1 - this.next())) * Math.cos(TAU * this.next()); }
}

// ---- gradient noise (improved Perlin), roughly -1..1 --------------------------------------------
const PERM = new Uint8Array(512);
{
  const r = new RNG(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
// Gradient per hashed corner (the 12 cube edges, 4 repeated), indexed by the permutation value.
const GX = new Float64Array(256), GY = new Float64Array(256), GZ = new Float64Array(256);
{
  const E = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1]];
  for (let i = 0; i < 256; i++) { const e = E[i & 15]; GX[i] = e[0]; GY[i] = e[1]; GZ[i] = e[2]; }
}
export function noise3(x, y, z) {
  let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  X &= 255; Y &= 255; Z &= 255;
  const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10), w = z * z * z * (z * (z * 6 - 15) + 10);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  const x1 = x - 1, y1 = y - 1, z1 = z - 1;
  let h = PERM[AA]; const g000 = GX[h] * x + GY[h] * y + GZ[h] * z;
  h = PERM[BA]; const g100 = GX[h] * x1 + GY[h] * y + GZ[h] * z;
  h = PERM[AB]; const g010 = GX[h] * x + GY[h] * y1 + GZ[h] * z;
  h = PERM[BB]; const g110 = GX[h] * x1 + GY[h] * y1 + GZ[h] * z;
  h = PERM[AA + 1]; const g001 = GX[h] * x + GY[h] * y + GZ[h] * z1;
  h = PERM[BA + 1]; const g101 = GX[h] * x1 + GY[h] * y + GZ[h] * z1;
  h = PERM[AB + 1]; const g011 = GX[h] * x + GY[h] * y1 + GZ[h] * z1;
  h = PERM[BB + 1]; const g111 = GX[h] * x1 + GY[h] * y1 + GZ[h] * z1;
  const a0 = g000 + u * (g100 - g000), a1 = g010 + u * (g110 - g010);
  const b0 = g001 + u * (g101 - g001), b1 = g011 + u * (g111 - g011);
  const c0 = a0 + v * (a1 - a0), c1 = b0 + v * (b1 - b0);
  return c0 + w * (c1 - c0);
}

// Fractal sum, normalised to roughly -1..1. Fractional octave counts fade the last octave in, so
// level-of-detail changes never pop.
export function fbm3(x, y, z, oct = 4, lac = 2.03, gain = 0.5) {
  let s = 0, amp = 1, n = 0;
  const full = Math.floor(oct), part = oct - full;
  for (let i = 0; i < full + (part > 0.01 ? 1 : 0); i++) {
    const a = i < full ? amp : amp * part;
    s += a * noise3(x + i * 31.7, y - i * 17.3, z + i * 7.1);
    n += a; amp *= gain; x *= lac; y *= lac; z *= lac;
  }
  return n > 0 ? s / n : 0;
}
// Ridged variant (sharp crests), 0..1.
export function ridged3(x, y, z, oct = 4) {
  let s = 0, amp = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(noise3(x + i * 13.1, y + i * 3.7, z - i * 9.9));
    s += amp * v * v; n += amp; amp *= 0.5; x *= 2.07; y *= 2.07; z *= 2.07;
  }
  return s / n;
}

// ---- vectors (plain arrays, used outside the hot loops) ------------------------------------------
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Rotate v about unit axis k by angle a (Rodrigues).
export function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, v) * (1 - c);
  return [v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d,
    v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d,
    v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d];
}
// Any unit vector perpendicular to n.
export function perp(n) {
  const a = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  return norm(cross(n, a));
}
// Unit vector from latitude/longitude (degrees) in a frame whose z is north and x is longitude 0.
export const fromLatLon = (lat, lon) => {
  const la = lat * DEG, lo = lon * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};

// ---- colours ------------------------------------------------------------------------------------
export const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
// Approximate display colour of a blackbody, normalised so the brightest channel is 1.
export function blackbody(K) {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  r = clamp(r, 0, 255) / 255; g = clamp(g, 0, 255) / 255; b = clamp(b, 0, 255) / 255;
  const m = Math.max(r, g, b);
  return [r / m, g / m, b / m];
}

export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
// "12,345 km", "1.52 AU", "4.2 ly"-style distance labels.
export function fmtDist(km) {
  const AU = 149597870.7;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(2)} km`;
  if (km < 1e6) return `${fmtInt(km)} km`;
  if (km < 0.1 * AU) return `${(km / 1e6).toFixed(2)} million km`;
  return `${(km / AU).toFixed(km < 10 * AU ? 3 : 2)} AU`;
}
export function fmtSpeed(kms) {
  const C = 299792.458;
  if (kms < 1) return `${Math.round(kms * 1000)} m/s`;
  if (kms < 0.1 * C) return `${kms < 100 ? kms.toFixed(1) : fmtInt(kms)} km/s`;
  return `${(kms / C).toFixed(kms < 10 * C ? 2 : 0)} c`;
}
export function fmtDuration(s) {
  if (!isFinite(s)) return '--';
  if (s < 60) return `${Math.max(0, Math.round(s))} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  if (s < 86400 * 2) return `${(s / 3600).toFixed(1)} h`;
  if (s < 86400 * 365 * 2) return `${(s / 86400).toFixed(1)} days`;
  return `${(s / 86400 / 365.25).toFixed(1)} years`;
}
