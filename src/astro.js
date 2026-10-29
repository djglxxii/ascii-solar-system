// Time scales, Kepler orbits, planetary and lunar ephemerides, and body orientation.
// Everything is heliocentric ecliptic J2000 in kilometres (x toward the vernal equinox, z toward
// ecliptic north), with time as Julian Date.

import { DEG, wrap360 } from './util.js';

export const AU = 149597870.7;
export const C_KMS = 299792.458;
export const J2000 = 2451545.0;
export const OBLIQUITY = 23.4392911 * DEG;
export const GM_SUN = 1.32712440018e11;

export const jdFromMs = (ms) => ms / 86400000 + 2440587.5;
export const msFromJd = (jd) => (jd - 2440587.5) * 86400000;

// Equatorial (ICRF) to ecliptic J2000.
export function eqToEcl(v) {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return [v[0], v[1] * c + v[2] * s, -v[1] * s + v[2] * c];
}
// Right ascension / declination (degrees) as an ecliptic unit vector.
export function radecToEcl(ra, dec) {
  const a = ra * DEG, d = dec * DEG;
  return eqToEcl([Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]);
}

// Eccentric anomaly from mean anomaly (radians).
export function keplerE(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 12; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

// Position in an orbit's reference plane from classical elements (a in km, angles in radians).
// `out` receives x, y, z in the reference frame (x toward the reference direction).
export function orbitXYZ(a, e, inc, node, argp, M, out) {
  const E = keplerE(M, e);
  const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cO = Math.cos(node), sO = Math.sin(node), cw = Math.cos(argp), sw = Math.sin(argp), ci = Math.cos(inc), si = Math.sin(inc);
  const x1 = xv * cw - yv * sw, y1 = xv * sw + yv * cw;
  out[0] = x1 * cO - y1 * ci * sO;
  out[1] = x1 * sO + y1 * ci * cO;
  out[2] = y1 * si;
  return out;
}

// JPL "Keplerian Elements for Approximate Positions of the Major Planets" (Standish), valid
// 1800-2050: a [AU], e, I, L, long. perihelion, long. node [deg], and rates per Julian century.
export const PLANET_ELEMENTS = {
  mercury: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593,
    0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  venus: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255,
    0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  emb: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
    0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  mars: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
    0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
    -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
    -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503,
    -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
    0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  pluto: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684,
    -0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
};

// Classical elements of a major planet at Julian Date jd: { a km, e, i, node, argp, M } radians.
export function planetElements(key, jd) {
  const p = PLANET_ELEMENTS[key], T = (jd - J2000) / 36525;
  const a = (p[0] + p[6] * T) * AU, e = p[1] + p[7] * T, I = p[2] + p[8] * T;
  const L = p[3] + p[9] * T, w = p[4] + p[10] * T, O = p[5] + p[11] * T;
  return { a, e, i: I * DEG, node: O * DEG, argp: (w - O) * DEG, M: wrap360(L - w) * DEG };
}
export function planetPos(key, jd, out = [0, 0, 0]) {
  const el = planetElements(key, jd);
  return orbitXYZ(el.a, el.e, el.i, el.node, el.argp, el.M, out);
}

// Geocentric Moon (ecliptic, km) from the mean orbit plus the largest periodic terms
// (evection, variation, annual equation...), good to a few tenths of a degree.
export function moonGeo(jd, out = [0, 0, 0]) {
  const d = jd - 2451543.5;
  const N = (125.1228 - 0.0529538083 * d) * DEG;
  const inc = 5.1454 * DEG;
  const w = (318.0634 + 0.1643573223 * d) * DEG;
  const e = 0.0549;
  const Mm = wrap360(115.3654 + 13.0649929509 * d) * DEG;
  const Ms = wrap360(356.0470 + 0.9856002585 * d) * DEG;
  const ws = (282.9404 + 4.70935e-5 * d) * DEG;
  const E = keplerE(Mm, e);
  const xv = Math.cos(E) - e, yv = Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  let r = 60.2666 * Math.hypot(xv, yv);
  const xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(inc));
  const yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(inc));
  const zh = r * Math.sin(v + w) * Math.sin(inc);
  let lon = Math.atan2(yh, xh), lat = Math.atan2(zh, Math.hypot(xh, yh));
  const Lm = N + w + Mm, Ls = Ms + ws, D = Lm - Ls, F = Lm - N;
  lon += DEG * (-1.274 * Math.sin(Mm - 2 * D) + 0.658 * Math.sin(2 * D) - 0.186 * Math.sin(Ms)
    - 0.059 * Math.sin(2 * Mm - 2 * D) - 0.057 * Math.sin(Mm - 2 * D + Ms) + 0.053 * Math.sin(Mm + 2 * D)
    + 0.046 * Math.sin(2 * D - Ms) + 0.041 * Math.sin(Mm - Ms) - 0.035 * Math.sin(D)
    - 0.031 * Math.sin(Mm + Ms) - 0.015 * Math.sin(2 * F - 2 * D) + 0.011 * Math.sin(Mm - 4 * D));
  lat += DEG * (-0.173 * Math.sin(F - 2 * D) - 0.055 * Math.sin(Mm - F - 2 * D) - 0.046 * Math.sin(Mm + F - 2 * D)
    + 0.033 * Math.sin(F + 2 * D) + 0.017 * Math.sin(2 * Mm + F));
  r += -0.58 * Math.cos(Mm - 2 * D) - 0.46 * Math.cos(2 * D);
  const km = r * 6378.14;
  out[0] = km * Math.cos(lat) * Math.cos(lon);
  out[1] = km * Math.cos(lat) * Math.sin(lon);
  out[2] = km * Math.sin(lat);
  return out;
}

// Body-fixed axes (ecliptic unit vectors) from an IAU pole (RA/Dec of the north pole, degrees) and
// prime-meridian angle W (degrees). Returns [x, y, z] with z the pole and x longitude 0.
export function poleBasis(ra, dec) {
  const a = ra * DEG, d = dec * DEG;
  const z = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const n = [-Math.sin(a), Math.cos(a), 0];                   // ascending node of the equator on the ICRF equator
  const q = [z[1] * n[2] - z[2] * n[1], z[2] * n[0] - z[0] * n[2], z[0] * n[1] - z[1] * n[0]];
  return { z: eqToEcl(z), n: eqToEcl(n), q: eqToEcl(q) };
}
export function spinAxes(pb, W, out) {
  const c = Math.cos(W * DEG), s = Math.sin(W * DEG);
  const x = out[0], y = out[1], z = out[2];
  x[0] = pb.n[0] * c + pb.q[0] * s; x[1] = pb.n[1] * c + pb.q[1] * s; x[2] = pb.n[2] * c + pb.q[2] * s;
  z[0] = pb.z[0]; z[1] = pb.z[1]; z[2] = pb.z[2];
  y[0] = z[1] * x[2] - z[2] * x[1]; y[1] = z[2] * x[0] - z[0] * x[2]; y[2] = z[0] * x[1] - z[1] * x[0];
  return out;
}

// Sub-solar latitude style season helper: the Sun's declination as seen from a body (radians).
export function sunDeclination(axisZ, toSun) {
  const l = Math.hypot(toSun[0], toSun[1], toSun[2]) || 1;
  return Math.asin((axisZ[0] * toSun[0] + axisZ[1] * toSun[1] + axisZ[2] * toSun[2]) / l);
}

export function formatDate(jd) {
  const d = new Date(msFromJd(jd));
  if (isNaN(d.getTime())) return '----';
  const p = (n, k = 2) => String(n).padStart(k, '0');
  const y = d.getUTCFullYear();
  return `${y < 0 ? '-' + p(-y, 4) : p(y, 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
