// The 3D view. Every character cell is a ray from the camera: the sky (Milky Way, catalogue stars,
// small-body swarm) is laid down first, then each world on screen is ray-traced far to near as an
// ellipsoid (or a lumpy shape for small irregular bodies) with its rings and a single-scattering
// atmosphere, lit by the Sun with eclipse and ring shadows. Limb cells are supersampled 3x3 and the
// coverage mask picks the glyph whose ink best matches, so silhouettes read as ( ) / \ _ edges.

import { K } from './bodies.js';
import { AU } from './astro.js';
import { sampleSurface, sampleHeight, sampleSun, S } from './surface.js';
import { ringsFor, ringSample } from './rings.js';
import { clamp, smoothstep, fbm3, noise3, hashf, DEG, TAU } from './util.js';

const SUN_COL = [1.0, 0.97, 0.92];
const SUB = [];
for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) SUB.push([(sx - 1) / 3, (sy - 1) / 3]);
const G_DASH = 45, G_SLASH = 47, G_BAR = 124, G_BSL = 92, G_DOT = 46, G_STAR = 42, G_PLUS = 43, G_APOS = 39, G_O = 111, G_AT = 64;

// Chapman grazing-incidence function (Schuler's approximation): column density along a ray at
// zenith cosine mu from radius X (in scale heights), relative to the vertical column.
function chapman(X, mu) {
  const c = Math.sqrt(X * 1.5707963);
  if (mu >= 0) return c / ((c - 1) * mu + 1);
  const s = Math.sqrt(Math.max(0, 1 - mu * mu));
  return c / ((c - 1) * mu - 1) + 2 * c * Math.exp(X - X * s) * Math.sqrt(s);
}

export class View {
  constructor(stars, baker) {
    this.stars = stars;
    this.baker = baker;
    this.marks = [];
    this.ringCache = new Map();
    this.shapes = new Map();
    this.orbitCache = new Map();
    this.starI = null;
    this.B = {};
    this.A = { r: 0, g: 0, b: 0, tr: 1, tg: 1, tb: 1 };
    this.RS = { a: 0, r: 0, g: 0, b: 0 };
    this.SC = { r: 0, g: 0, b: 0, spot: 1, gran: 0 };
    this.dust = [];
    this.time = 0;
  }

  setup(grid, font, cam) {
    const cols = grid.cols, rows = grid.rows;
    const aspect = font.cellW / font.cellH;
    let fy = rows / 2 / Math.tan(cam.fov / 2);
    let fx = fy / aspect;
    const hf = 2 * Math.atan(cols / 2 / fx);
    if (hf > 125 * DEG) { fx = cols / 2 / Math.tan(62.5 * DEG); fy = fx * aspect; }
    Object.assign(this, { grid, font, cam, cols, rows, fx, fy, aspect, maskTable: font.maskTable });
    this.cellAng = 1 / Math.sqrt(fx * fy);
    const n = cols * rows;
    if (!this.starI || this.starI.length !== n) { this.starI = new Float32Array(n); this.skyL = new Float32Array(n); }
    this.halfDiag = Math.atan(Math.hypot(cols / 2 / fx, rows / 2 / fy));
  }

  // Camera-space projection of a camera-relative vector; returns false if behind.
  project(x, y, z, out) {
    const c = this.cam;
    const cz = x * c.fwd[0] + y * c.fwd[1] + z * c.fwd[2];
    if (cz <= 1e-9) return false;
    const cx = x * c.right[0] + y * c.right[1] + z * c.right[2], cy = x * c.up[0] + y * c.up[1] + z * c.up[2];
    out[0] = this.cols / 2 + (cx / cz) * this.fx;
    out[1] = this.rows / 2 - (cy / cz) * this.fy;
    out[2] = cz;
    return true;
  }

  render(grid, sys, cam, font, opts) {
    this.setup(grid, font, cam);
    this.sys = sys; this.opts = opts;
    this.time += opts.dt || 0;
    this.days = sys.jd - 2451545.0;
    const g = grid;
    g.ch.fill(32); g.fg.fill(0); g.bg.fill(0); g.glow.fill(0); g.depth.fill(Infinity); g.kind.fill(K.SPACE);
    this.starI.fill(0);
    const camSun = Math.hypot(cam.pos[0], cam.pos[1], cam.pos[2]);
    this.adapt = Math.pow(camSun / AU, 2 * 0.92);
    this.sky();
    this.drawStars();
    this.drawSwarm();
    this.marks.length = 0;
    // collect worlds, split into resolved discs and points
    const res = [], pts = [];
    const P = [0, 0, 0];
    for (const b of sys.bodies) {
      const rx = b.pos[0] - cam.pos[0], ry = b.pos[1] - cam.pos[1], rz = b.pos[2] - cam.pos[2];
      const d = Math.hypot(rx, ry, rz);
      const bound = b.boundR * (b.look.plume ? 5 : 1);
      const inside = d < bound * 1.05;
      const ang = inside ? Math.PI : Math.asin(Math.min(1, bound / d));
      const cz = (rx * cam.fwd[0] + ry * cam.fwd[1] + rz * cam.fwd[2]) / d;
      const vis = inside || Math.acos(clamp(cz, -1, 1)) < this.halfDiag + ang + 0.02;
      const onScreen = this.project(rx, ry, rz, P);
      const pr = Math.atan(b.Rmax / d) * this.fy;
      const m = { b, x: P[0], y: P[1], d, pr, on: onScreen && P[0] >= 0 && P[0] < this.cols && P[1] >= 0 && P[1] < this.rows, rel: [rx, ry, rz], vis };
      this.marks.push(m);
      if (!vis) continue;
      const haloPx = Math.atan(bound / d) * this.fy;
      if (pr >= 0.55 || (b.atmo && haloPx > 1.2) || inside || (b.rings && haloPx > 1.5)) res.push(m);
      else pts.push(m);
    }
    res.sort((a, b) => b.d - a.d);
    for (const m of res) {
      if (m.b.kind === 'star') this.renderSun(m);
      else this.renderBody(m);
    }
    if (opts.orbits) this.drawOrbits(opts);
    for (const m of pts) this.drawPoint(m);
    this.effects(opts);
  }

  // ---- sky ------------------------------------------------------------------------------------------
  sky() {
    const { cols, rows, fx, fy, cam, grid: g } = this;
    const mw = this.stars.mw, W = mw.W, H = mw.H, img = mw.img;
    const F = cam.fwd, R = cam.right, U = cam.up;
    const gain = this.opts.mwGain === undefined ? 1 : this.opts.mwGain;
    for (let y = 0; y < rows; y++) {
      const py = -(y + 0.5 - rows / 2) / fy;
      for (let x = 0; x < cols; x++) {
        const px = (x + 0.5 - cols / 2) / fx;
        let dx = F[0] + R[0] * px + U[0] * py, dy = F[1] + R[1] * px + U[1] * py, dz = F[2] + R[2] * px + U[2] * py;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        const lon = Math.atan2(dy, dx), lat = Math.asin(dz);
        let u = (lon / TAU + 0.5) * W - 0.5, v = (0.5 - lat / Math.PI) * H - 0.5;
        if (u < 0) u += W;
        if (v < 0) v = 0; else if (v > H - 1.001) v = H - 1.001;
        const x0 = Math.floor(u), y0 = Math.floor(v), fu = u - x0, fv = v - y0, x1 = x0 + 1 >= W ? 0 : x0 + 1;
        const i = y * cols + x, k = i * 3;
        for (let c = 0; c < 3; c++) {
          const a = img[(y0 * W + x0) * 3 + c] * (1 - fu) + img[(y0 * W + x1) * 3 + c] * fu;
          const b = img[((y0 + 1) * W + x0) * 3 + c] * (1 - fu) + img[((y0 + 1) * W + x1) * 3 + c] * fu;
          g.bg[k + c] = (a * (1 - fv) + b * fv) * gain * 0.55;
        }
        // unresolved star clouds: a sparse sprinkle tied to the sky, denser where the band is bright
        const L = g.bg[k] + g.bg[k + 1] + g.bg[k + 2];
        if (L > 0.012) {
          const h = hashf(Math.floor(u * 3), Math.floor(v * 3), 77);
          if (h < L * 9) {
            g.ch[i] = h < L * 3 ? 58 : G_DOT;
            g.fg[k] = g.bg[k] * 5 + 0.03; g.fg[k + 1] = g.bg[k + 1] * 5 + 0.03; g.fg[k + 2] = g.bg[k + 2] * 5 + 0.04;
          }
        }
        g.kind[i] = K.SPACE;
      }
    }
  }

  drawStars() {
    const { cols, rows, fx, fy, cam, grid: g } = this;
    const st = this.stars, n = st.n;
    const F = cam.fwd, R = cam.right, U = cam.up;
    const minCz = Math.cos(this.halfDiag + 0.02);
    const tw = this.opts.twinkle || 0;
    for (let i = 0; i < n; i++) {
      const sx = st.x[i], sy = st.y[i], sz = st.z[i];
      const cz = sx * F[0] + sy * F[1] + sz * F[2];
      if (cz < minCz) continue;
      const X = cols / 2 + ((sx * R[0] + sy * R[1] + sz * R[2]) / cz) * fx;
      const Y = rows / 2 - ((sx * U[0] + sy * U[1] + sz * U[2]) / cz) * fy;
      const xi = Math.floor(X), yi = Math.floor(Y);
      if (xi < 0 || yi < 0 || xi >= cols || yi >= rows) continue;
      let I = Math.pow(10, -0.4 * (st.mag[i] - 1.0));
      if (tw > 0) I *= 1 + tw * (hashf(i, Math.floor(this.time * 14)) - 0.5);
      const c = yi * cols + xi;
      if (I <= this.starI[c]) continue;
      this.starI[c] = I;
      let ch, k, glow;
      if (I > 1.4) { ch = G_STAR; k = 1.25; glow = Math.min(0.9, 0.25 + I * 0.08); }
      else if (I > 0.5) { ch = G_STAR; k = 0.7 + I * 0.25; glow = 0.15; }
      else if (I > 0.16) { ch = G_PLUS; k = 0.45 + I * 0.8; glow = 0.05; }
      else { ch = Y - yi < 0.45 ? G_APOS : G_DOT; k = 0.12 + Math.sqrt(I) * 1.25; glow = 0; }
      const k3 = c * 3;
      g.ch[c] = ch;
      g.fg[k3] = st.col[i * 3] * k; g.fg[k3 + 1] = st.col[i * 3 + 1] * k; g.fg[k3 + 2] = st.col[i * 3 + 2] * k;
      g.glow[c] = glow;
      g.kind[c] = K.SPACE;
    }
  }

  drawSwarm() {
    if (this.opts.swarm === false) return;
    const { cols, rows, fx, fy, cam, grid: g } = this;
    const s = this.sys.swarm, n = s.n, pos = s.pos;
    const F = cam.fwd, R = cam.right, U = cam.up, C = cam.pos;
    const COL = [[0.75, 0.68, 0.58], [0.72, 0.62, 0.52], [0.8, 0.62, 0.46], [0.66, 0.64, 0.72]];
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3] - C[0], y = pos[i * 3 + 1] - C[1], z = pos[i * 3 + 2] - C[2];
      const cz = x * F[0] + y * F[1] + z * F[2];
      if (cz <= 0) continue;
      const X = cols / 2 + ((x * R[0] + y * R[1] + z * R[2]) / cz) * fx;
      const Y = rows / 2 - ((x * U[0] + y * U[1] + z * U[2]) / cz) * fy;
      const xi = Math.floor(X), yi = Math.floor(Y);
      if (xi < 0 || yi < 0 || xi >= cols || yi >= rows) continue;
      const d = Math.hypot(x, y, z) / AU;
      const I = clamp(0.22 * Math.pow(1 / Math.max(d, 0.002), 0.55), 0.04, 0.7) * (0.55 + 0.45 * s.mag[i]);
      const c = yi * cols + xi;
      if (I * 0.3 <= this.starI[c]) continue;
      this.starI[c] = I * 0.3;
      const col = COL[s.type[i]], k3 = c * 3;
      g.ch[c] = d < 0.02 ? G_O : Y - yi < 0.45 ? G_APOS : G_DOT;
      g.fg[k3] = col[0] * I; g.fg[k3 + 1] = col[1] * I; g.fg[k3 + 2] = col[2] * I;
      g.kind[c] = K.SPACE;
    }
  }

  // ---- unresolved bodies --------------------------------------------------------------------------
  drawPoint(m) {
    if (!m.on) return;
    const b = m.b, g = this.grid;
    const xi = Math.floor(m.x), yi = Math.floor(m.y);
    const c = yi * this.cols + xi;
    if (g.depth[c] < m.d) return;
    const k3 = c * 3;
    if (b.kind === 'star') {
      const I = Math.min(6, 1.6 * Math.pow(AU / m.d, 0.6));
      g.ch[c] = m.pr > 0.25 ? G_AT : G_STAR;
      g.fg[k3] = 1.8; g.fg[k3 + 1] = 1.7; g.fg[k3 + 2] = 1.45;
      g.bg[k3] = Math.min(1.6, 0.6 * I); g.bg[k3 + 1] = Math.min(1.5, 0.52 * I); g.bg[k3 + 2] = Math.min(1.3, 0.38 * I);
      g.glow[c] = 1; g.depth[c] = m.d; g.kind[c] = K.UI;
      return;
    }
    // reflected sunlight: p (R/d)^2 (AU/r)^2 times a phase term, as a magnitude
    const toCam = [-m.rel[0] / m.d, -m.rel[1] / m.d, -m.rel[2] / m.d];
    const cosA = toCam[0] * b.toSun[0] + toCam[1] * b.toSun[1] + toCam[2] * b.toSun[2];
    const phase = Math.max(0.02, (1 + cosA) / 2);
    const col = b.look.col || [0.6, 0.6, 0.6];
    const alb = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2];
    const flux = alb * 0.6 * (b.Rmean / m.d) ** 2 * (AU / b.sunDist) ** 2 * phase;
    let mag = -26.74 - 2.5 * Math.log10(Math.max(flux, 1e-40));
    const important = b.kind === 'planet' || b.kind === 'dwarf' || (this.opts.target === b) || (this.opts.frame && (b.parentBody === this.opts.frame || b.parentBody === this.opts.frame.parentBody));
    if (important) mag = Math.min(mag, 5.2);
    if (mag > 6.8) return;
    const I = Math.pow(10, -0.4 * (mag - 1));
    if (I < this.starI[c] * 0.8) return;
    let ch;
    if (m.pr > 0.28) ch = G_O; else if (I > 1.2) ch = G_STAR; else if (I > 0.2) ch = G_PLUS; else ch = m.y - yi < 0.45 ? G_APOS : G_DOT;
    const k = clamp(0.25 + Math.sqrt(I) * 0.6, 0.25, 1.6);
    g.ch[c] = ch;
    g.fg[k3] = (col[0] * 0.7 + 0.3) * k; g.fg[k3 + 1] = (col[1] * 0.7 + 0.3) * k; g.fg[k3 + 2] = (col[2] * 0.7 + 0.3) * k;
    g.glow[c] = Math.min(0.6, I * 0.12);
    g.depth[c] = m.d; g.kind[c] = K.SPACE;
  }

  // ---- the Sun ----------------------------------------------------------------------------------------
  renderSun(m) {
    const b = m.b, g = this.grid, { cols, rows, fx, fy, cam } = this;
    const R = b.Req, d = m.d;
    const ang = Math.asin(Math.min(1, R / d));
    const coronaAng = Math.min(Math.PI * 0.45, ang * 6 + this.cellAng * 6);
    const C = m.rel, cd = [C[0] / d, C[1] / d, C[2] / d];
    const ax = b.axes[0], ay = b.axes[1], az = b.axes[2];
    const box = this.bbox(m, coronaAng);
    if (!box) return;
    const SC = this.SC;
    const F = cam.fwd, Rr = cam.right, U = cam.up;
    const lodBase = this.cellAng * d / R;
    for (let y = box[1]; y <= box[3]; y++) {
      for (let x = box[0]; x <= box[2]; x++) {
        let r = 0, gg = 0, bl = 0, hits = 0, mask = 0, glow = 0;
        const i = y * cols + x;
        // corona and glare from the cell centre
        const px0 = (x + 0.5 - cols / 2) / fx, py0 = -(y + 0.5 - rows / 2) / fy;
        let dx = F[0] + Rr[0] * px0 + U[0] * py0, dy = F[1] + Rr[1] * px0 + U[1] * py0, dz = F[2] + Rr[2] * px0 + U[2] * py0;
        let l = Math.hypot(dx, dy, dz);
        const th = Math.acos(clamp((dx * cd[0] + dy * cd[1] + dz * cd[2]) / l, -1, 1));
        const rim = th < ang + this.cellAng * 1.5 && th > ang - this.cellAng * 1.5;
        const ns = rim ? 9 : th < ang ? 1 : 0;
        for (let s = 0; s < ns; s++) {
          const ox = ns === 9 ? SUB[s][0] : 0, oy = ns === 9 ? SUB[s][1] : 0;
          const px = (x + 0.5 + ox - cols / 2) / fx, py = -(y + 0.5 + oy - rows / 2) / fy;
          dx = F[0] + Rr[0] * px + U[0] * py; dy = F[1] + Rr[1] * px + U[1] * py; dz = F[2] + Rr[2] * px + U[2] * py;
          l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
          const B = -(C[0] * dx + C[1] * dy + C[2] * dz);
          const cc = d * d - R * R;
          const disc = B * B - cc;
          if (disc < 0) continue;
          const t = -B - Math.sqrt(disc);
          if (t <= 0) continue;
          const hx = -C[0] + t * dx, hy = -C[1] + t * dy, hz = -C[2] + t * dz;
          const mu = clamp(-(hx * dx + hy * dy + hz * dz) / R, 0, 1);
          const bx = (hx * ax[0] + hy * ax[1] + hz * ax[2]) / R, by = (hx * ay[0] + hy * ay[1] + hz * ay[2]) / R, bz = (hx * az[0] + hy * az[1] + hz * az[2]) / R;
          sampleSun(bx, by, bz, mu, lodBase / Math.max(0.2, mu), this.days, SC);
          r += SC.r; gg += SC.g; bl += SC.b; hits++;
          if (ns === 9) mask |= 1 << s;
        }
        const k3 = i * 3;
        // corona: K-corona falloff with streamers
        if (th > ang * 0.98) {
          const q = th / ang;
          const pa = Math.atan2(dx * U[0] + dy * U[1] + dz * U[2], dx * Rr[0] + dy * Rr[1] + dz * Rr[2]);
          const streak = 0.7 + 0.5 * Math.max(0, noise3(Math.cos(pa) * 3, Math.sin(pa) * 3, 0.5)) + 0.25 * noise3(Math.cos(pa) * 9, Math.sin(pa) * 9, 1.5);
          const I = 0.9 * Math.pow(q, -2.6) * streak * smoothstep(coronaAng, coronaAng * 0.6, th);
          const glare = 0.5 * Math.exp(-(th - ang) / (this.cellAng * 2.5));
          const add = Math.min(2, I + glare);
          g.bg[k3] += add * 1.0; g.bg[k3 + 1] += add * 0.88; g.bg[k3 + 2] += add * 0.7;
          glow = Math.max(glow, Math.min(1, add * 0.7));
          // prominences: red loops just off the limb
          if (q < 1.12) {
            const pr = smoothstep(0.55, 0.85, noise3(Math.cos(pa) * 7, Math.sin(pa) * 7, this.days * 0.05));
            g.bg[k3] += pr * 1.2; g.bg[k3 + 1] += pr * 0.25; g.bg[k3 + 2] += pr * 0.2;
          }
        }
        if (hits) {
          const k = 3.1 / hits;
          if (ns === 1 || mask === 511) {
            g.bg[k3] = r * k; g.bg[k3 + 1] = gg * k; g.bg[k3 + 2] = bl * k;
            const gr = SC.gran;
            g.ch[i] = SC.spot < 0.6 ? G_STAR : gr > 0.25 ? G_AT : gr > 0 ? 79 : gr > -0.25 ? G_O : 58;
            g.fg[k3] = r * k * 1.1; g.fg[k3 + 1] = gg * k * 1.05; g.fg[k3 + 2] = bl * k;
          } else {
            g.ch[i] = this.maskTable[mask];
            g.fg[k3] = r * k * 1.2; g.fg[k3 + 1] = gg * k * 1.1; g.fg[k3 + 2] = bl * k;
          }
          glow = 1;
          g.depth[i] = d - R;
          g.kind[i] = K.SUN;
        }
        g.glow[i] = Math.max(g.glow[i], glow);
      }
    }
  }

  // Screen-space bounding box [x0, y0, x1, y1] of a cone around a body, or null if off-screen.
  bbox(m, ang) {
    const { cols, rows } = this;
    if (ang > 1.2 || m.d < m.b.boundR * 1.05) return [0, 0, cols - 1, rows - 1];
    const C = m.rel, d = m.d, cam = this.cam;
    const c = [C[0] / d, C[1] / d, C[2] / d];
    let e1 = [c[1] * cam.up[2] - c[2] * cam.up[1], c[2] * cam.up[0] - c[0] * cam.up[2], c[0] * cam.up[1] - c[1] * cam.up[0]];
    let l = Math.hypot(...e1);
    if (l < 1e-6) { e1 = cam.right.slice(); l = 1; }
    e1 = e1.map((v) => v / l);
    const e2 = [c[1] * e1[2] - c[2] * e1[1], c[2] * e1[0] - c[0] * e1[2], c[0] * e1[1] - c[1] * e1[0]];
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const P = [0, 0, 0];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU, ck = Math.cos(a), sk = Math.sin(a);
      const v = [c[0] * ca + (e1[0] * ck + e2[0] * sk) * sa, c[1] * ca + (e1[1] * ck + e2[1] * sk) * sa, c[2] * ca + (e1[2] * ck + e2[2] * sk) * sa];
      if (!this.project(v[0], v[1], v[2], P)) return [0, 0, cols - 1, rows - 1];
      x0 = Math.min(x0, P[0]); x1 = Math.max(x1, P[0]); y0 = Math.min(y0, P[1]); y1 = Math.max(y1, P[1]);
    }
    const bx0 = Math.max(0, Math.floor(x0) - 1), by0 = Math.max(0, Math.floor(y0) - 1);
    const bx1 = Math.min(cols - 1, Math.ceil(x1) + 1), by1 = Math.min(rows - 1, Math.ceil(y1) + 1);
    if (bx0 > bx1 || by0 > by1) return null;
    return [bx0, by0, bx1, by1];
  }

  // ---- worlds ---------------------------------------------------------------------------------------
  prepareBody(m) {
    const b = m.b, cam = this.cam, B = this.B;
    const ax = b.axes[0], ay = b.axes[1], az = b.axes[2];
    const toB = (v) => [v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2], v[0] * ay[0] + v[1] * ay[1] + v[2] * ay[2], v[0] * az[0] + v[1] * az[1] + v[2] * az[2]];
    const [ra, rb, rc] = b.radii;
    const oc = toB([-m.rel[0], -m.rel[1], -m.rel[2]]);
    B.b = b; B.look = b.look; B.ra = ra; B.rb = rb; B.rc = rc;
    B.ocx = oc[0]; B.ocy = oc[1]; B.ocz = oc[2];
    B.ox = oc[0] / ra; B.oy = oc[1] / rb; B.oz = oc[2] / rc;
    B.oo = B.ox * B.ox + B.oy * B.oy + B.oz * B.oz;
    B.F = toB(cam.fwd); B.R = toB(cam.right); B.U = toB(cam.up);
    const s = toB(b.toSun); B.sx = s[0]; B.sy = s[1]; B.sz = s[2];
    B.light = Math.min(3.2, ((AU / b.sunDist) ** 2) * this.adapt) * 0.68;
    B.d = m.d;
    B.tex = this.baker.get(b, m.pr);
    B.texFull = B.tex !== b.texLow;
    B.sunAng = 695700 / b.sunDist;
    B.kind = b.look.ramp;
    B.relief = b.look.relief === undefined ? 1 : b.look.relief;
    if (B.kind === K.GAS || B.kind === K.CLOUD) B.relief = 0;
    B.ls = b.look.ls === undefined ? 0.45 : b.look.ls;
    B.minn = b.look.minnaert || 0;
    B.twilight = b.atmo ? (B.kind === K.CLOUD || B.kind === K.GAS ? 0.06 : 0.03) : 0;
    // planetshine / earthshine on moons of big planets
    B.amb = 0.004 + (b.parentBody && b.parentBody.kind === 'planet' ? 0.01 : 0);
    // season (Mars): solar declination in degrees
    B.season = b.id === 'mars' ? Math.asin(clamp(B.sz, -1, 1)) / DEG : undefined;
    // shadow casters, in body axes relative to b's centre (km)
    B.occ = [];
    for (const o of this.sys.occludersFor(b)) {
      const v = toB([o.pos[0] - b.pos[0], o.pos[1] - b.pos[1], o.pos[2] - b.pos[2]]);
      // only those roughly between b and the Sun matter
      const along = v[0] * B.sx + v[1] * B.sy + v[2] * B.sz;
      if (along <= 0) continue;
      const lat2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] - along * along;
      const reach = o.Rmean + b.Rmax + along * B.sunAng * 1.2;
      if (lat2 > reach * reach) continue;
      // only rocky worlds with air bend reddened sunlight into their shadow (a blood-red eclipsed Moon)
      B.occ.push({ x: v[0], y: v[1], z: v[2], r: o.Rmean, atmo: !!o.atmo && o.look.ramp !== K.GAS });
    }
    // atmosphere, with scale heights widened when the limb is unresolved so the halo still shows
    B.atm = null;
    if (b.atmo) {
      const kmCell = Math.max(1e-3, (m.d - b.Req) * this.cellAng) * (b.look.halo === undefined ? 0.3 : b.look.halo);
      const comps = b.atmo.comps.map((c) => {
        if (c.layer) {
          const w = Math.max(c.layer[1], kmCell * 1.2);
          return { layer: true, h0: c.layer[0], w, H: w, br: c.beta[0] * c.layer[1] / w, bg: c.beta[1] * c.layer[1] / w, bb: c.beta[2] * c.layer[1] / w, ar: c.abs[0], ag: c.abs[1], ab: c.abs[2], g: c.g };
        }
        const Hv = Math.max(c.H, kmCell);
        const k = c.H / Hv;
        const gv = Array.isArray(c.g) ? c.g : [c.g, c.g, c.g];
        return { layer: false, H: Hv, br: c.beta[0] * k, bg: c.beta[1] * k, bb: c.beta[2] * k, ar: c.abs[0] * k, ag: c.abs[1] * k, ab: c.abs[2] * k, gr: gv[0], gg: gv[1], gb: gv[2], ray: c.g === 0, ms: c.ms || 0 };
      });
      let top = b.atmo.top;
      for (const c of comps) top = Math.max(top, c.layer ? c.h0 + c.w * 3 : c.H * 7);
      B.atm = { comps, top, rt: 1 + top / ra, aurora: b.atmo.aurora || null, dense: b.atmo.comps[0].beta[0] * b.atmo.comps[0].H > 3 };
      if (B.atm.aurora) {
        const a = B.atm.aurora;
        const la = a.poleLat * DEG, lo = a.poleLon * DEG;
        a.v = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
      }
    }
    // rings
    B.rings = null;
    if (b.rings) {
      let rr = this.ringCache.get(b.id);
      if (!rr) { rr = ringsFor(b); this.ringCache.set(b.id, rr); }
      B.rings = rr;
    }
    B.shape = b.shape ? this.shapeFor(b) : null;
    B.plume = !!b.look.plume;
  }

  renderBody(m) {
    this.prepareBody(m);
    const B = this.B, b = m.b, g = this.grid, { cols, rows, fx, fy } = this;
    let bound = b.boundR;
    if (B.atm) bound = Math.max(bound, b.Req + B.atm.top);
    if (B.plume) bound = b.Req * 5;
    const ang = m.d <= bound ? Math.PI : Math.asin(Math.min(1, bound / m.d));
    const box = this.bbox(m, ang);
    if (!box) return;
    const res = this.res || (this.res = { hit: false, t: 0, r: 0, g: 0, b: 0, kind: 0, glow: 0, er: 0, eg: 0, eb: 0, ch: 0 });
    const BG = [0, 0, 0];
    const Fx = B.F[0], Fy = B.F[1], Fz = B.F[2], Rx = B.R[0], Ry = B.R[1], Rz = B.R[2], Ux = B.U[0], Uy = B.U[1], Uz = B.U[2];
    const ox = B.ox, oy = B.oy, oz = B.oz, oo = B.oo;
    // With an atmosphere over a large area, integrate it only on even columns and interpolate the
    // odd ones between neighbours that agree (both sky, or both ground at a similar distance).
    const halve = !!B.atm && (box[2] - box[0]) * (box[3] - box[1]) > 1500;
    const W = cols;
    if (!this.rowA || this.rowA.length < W * 7) { this.rowA = new Float64Array(W * 7); this.rowS = new Int8Array(W); }
    const RA = this.rowA, RSt = this.rowS;
    for (let y = box[1]; y <= box[3]; y++) {
      if (halve) RSt.fill(-1);
      for (let pass = 0; pass < (halve ? 2 : 1); pass++)
      for (let x = box[0]; x <= box[2]; x++) {
        if (halve && ((x - box[0]) & 1) !== pass && !(pass === 0 && x === box[2])) continue;
        if (halve && pass === 1 && RSt[x] !== -1) continue;
        const i = y * cols + x, k3 = i * 3;
        // centre ray in body axes
        const px = (x + 0.5 - cols / 2) / fx, py = -(y + 0.5 - rows / 2) / fy;
        let dx = Fx + Rx * px + Ux * py, dy = Fy + Ry * px + Uy * py, dz = Fz + Rz * px + Uz * py;
        let l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        // limb test on the bounding ellipsoid
        const sx = dx / B.ra, sy = dy / B.rb, sz = dz / B.rc;
        const A = sx * sx + sy * sy + sz * sz, Bq = ox * sx + oy * sy + oz * sz;
        const tc = Math.max(0, -Bq / A);
        const dmin = Math.sqrt(Math.max(0, oo - (Bq * Bq) / A));
        const kmFromLimb = (dmin - 1) * B.ra - (B.look.visAlt || 0);
        const cellKm = tc * this.cellAng * 1.15 + 1e-9;
        const shapeBand = B.shape ? (B.shape.rmax - 1) * B.ra : 0;
        const rim = kmFromLimb < cellKm * 1.2 + shapeBand && kmFromLimb > -cellKm * 1.2 - (B.shape ? (1 - B.shape.rmin) * B.ra : 0);
        BG[0] = g.bg[k3]; BG[1] = g.bg[k3 + 1]; BG[2] = g.bg[k3 + 2];
        const fg0 = g.fg[k3], fg1 = g.fg[k3 + 1], fg2 = g.fg[k3 + 2];
        if (!rim) {
          this.atmOverride = false;
          if (halve && pass === 1) {
            const a = x - 1, c = x + 1;
            if (a >= box[0] && c <= box[2] && RSt[a] >= 0 && RSt[a] === RSt[c] && (RSt[a] === 0 || Math.abs(RA[a * 7 + 6] - RA[c * 7 + 6]) < 0.2 * Math.min(RA[a * 7 + 6], RA[c * 7 + 6]))) {
              const A2 = this.A, ja = a * 7, jc = c * 7;
              A2.r = (RA[ja] + RA[jc]) / 2; A2.g = (RA[ja + 1] + RA[jc + 1]) / 2; A2.b = (RA[ja + 2] + RA[jc + 2]) / 2;
              A2.tr = (RA[ja + 3] + RA[jc + 3]) / 2; A2.tg = (RA[ja + 4] + RA[jc + 4]) / 2; A2.tb = (RA[ja + 5] + RA[jc + 5]) / 2;
              this.atmOverride = true;
            }
          }
          this.sampleRay(dx, dy, dz, BG, res);
          this.atmOverride = false;
          if (halve) {
            const A2 = this.A, j = x * 7;
            RA[j] = A2.r; RA[j + 1] = A2.g; RA[j + 2] = A2.b; RA[j + 3] = A2.tr; RA[j + 4] = A2.tg; RA[j + 5] = A2.tb; RA[j + 6] = res.t;
            RSt[x] = res.hit ? 1 : 0;
          }
          if (res.hit) {
            g.bg[k3] = res.r; g.bg[k3 + 1] = res.g; g.bg[k3 + 2] = res.b;
            g.ch[i] = res.ch || 32;
            if (res.ch) { g.fg[k3] = res.fr; g.fg[k3 + 1] = res.fgg; g.fg[k3 + 2] = res.fb; }
            g.kind[i] = res.kind; g.depth[i] = res.t; g.glow[i] = res.glow;
          } else if (res.t > 0) {
            // through atmosphere / ring without striking the solid body
            const A2 = this.A;
            g.bg[k3] = res.r; g.bg[k3 + 1] = res.g; g.bg[k3 + 2] = res.b;
            g.fg[k3] = fg0 * A2.tr + res.ir; g.fg[k3 + 1] = fg1 * A2.tg + res.ig; g.fg[k3 + 2] = fg2 * A2.tb + res.ib;
            g.glow[i] *= (A2.tr + A2.tg + A2.tb) / 3;
            if (res.ch) { g.ch[i] = res.ch; g.fg[k3] = res.fr; g.fg[k3 + 1] = res.fgg; g.fg[k3 + 2] = res.fb; g.kind[i] = K.UI; g.depth[i] = res.t; }
            else if (res.glow > g.glow[i]) g.glow[i] = res.glow;
            if (res.ring) g.depth[i] = Math.min(g.depth[i], res.t);
          }
          continue;
        }
        // limb: 3x3 supersampling, coverage mask picks the glyph
        if (halve) RSt[x] = 2;
        let hr = 0, hg = 0, hb = 0, nh = 0, mr = 0, mg = 0, mb = 0, nm = 0, mask = 0, tmin = Infinity, gl = 0, ir = 0, ig = 0, ib = 0, trs = 0;
        for (let s = 0; s < 9; s++) {
          const qx = px + SUB[s][0] / fx, qy = py - SUB[s][1] / fy;
          let ex = Fx + Rx * qx + Ux * qy, ey = Fy + Ry * qx + Uy * qy, ez = Fz + Rz * qx + Uz * qy;
          l = Math.hypot(ex, ey, ez); ex /= l; ey /= l; ez /= l;
          this.sampleRay(ex, ey, ez, BG, res);
          if (res.hit) { hr += res.r; hg += res.g; hb += res.b; nh++; mask |= 1 << s; tmin = Math.min(tmin, res.t); gl = Math.max(gl, res.glow); }
          else {
            mr += res.t > 0 ? res.r : BG[0]; mg += res.t > 0 ? res.g : BG[1]; mb += res.t > 0 ? res.b : BG[2]; nm++;
            if (res.t > 0) { ir += res.ir; ig += res.ig; ib += res.ib; trs += (this.A.tr + this.A.tg + this.A.tb) / 3; } else trs += 1;
          }
        }
        if (nh === 9) {
          g.bg[k3] = hr / 9; g.bg[k3 + 1] = hg / 9; g.bg[k3 + 2] = hb / 9;
          g.ch[i] = 32; g.kind[i] = res.kind; g.depth[i] = tmin; g.glow[i] = gl;
        } else if (nh === 0) {
          g.bg[k3] = mr / 9; g.bg[k3 + 1] = mg / 9; g.bg[k3 + 2] = mb / 9;
          const tr = trs / 9;
          g.fg[k3] = fg0 * tr + ir / 9; g.fg[k3 + 1] = fg1 * tr + ig / 9; g.fg[k3 + 2] = fg2 * tr + ib / 9;
          g.glow[i] *= tr;
        } else {
          const kk = 1.2 / nh;
          g.ch[i] = this.maskTable[mask];
          g.fg[k3] = hr * kk + 0.01; g.fg[k3 + 1] = hg * kk + 0.01; g.fg[k3 + 2] = hb * kk + 0.012;
          g.bg[k3] = mr / nm; g.bg[k3 + 1] = mg / nm; g.bg[k3 + 2] = mb / nm;
          g.kind[i] = K.UI; g.depth[i] = tmin; g.glow[i] = gl * 0.5;
        }
      }
    }
  }

  // Trace one ray (unit direction in body axes) against body, rings and atmosphere.
  // On return res.hit tells whether the solid surface was struck; res.t > 0 if anything was.
  sampleRay(dx, dy, dz, BG, res) {
    const B = this.B;
    const sx = dx / B.ra, sy = dy / B.rb, sz = dz / B.rc;
    const ox = B.ox, oy = B.oy, oz = B.oz;
    const A = sx * sx + sy * sy + sz * sz, Bq = ox * sx + oy * sy + oz * sz;
    res.hit = false; res.t = 0; res.ch = 0; res.glow = 0; res.ring = false; res.ir = res.ig = res.ib = 0;
    let tHit = Infinity, qx = 0, qy = 0, qz = 0, nx = 0, ny = 0, nz = 0;
    if (B.shape) {
      const h = this.marchShape(ox, oy, oz, sx, sy, sz, A, Bq);
      if (h) { tHit = h.t; qx = h.qx; qy = h.qy; qz = h.qz; nx = h.nx; ny = h.ny; nz = h.nz; }
    } else {
      const disc = Bq * Bq - A * (B.oo - 1);
      if (disc >= 0) {
        const t = (-Bq - Math.sqrt(disc)) / A;
        if (t > 0) {
          tHit = t;
          qx = ox + t * sx; qy = oy + t * sy; qz = oz + t * sz;
          nx = qx / B.ra; ny = qy / B.rb; nz = qz / B.rc;
          const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        }
      }
    }
    // rings in the equatorial plane
    let ringT = Infinity;
    const RS = this.RS;
    if (B.rings && Math.abs(sz) > 1e-12) {
      const t = -oz / sz;
      if (t > 0 && t < tHit) {
        const rx = (ox + t * sx) * B.ra, ry = (oy + t * sy) * B.ra;
        const rr = Math.hypot(rx, ry);
        const fp = (t * this.cellAng) / Math.max(0.03, Math.abs(dz)) + 0.5;
        ringSample(B.rings, rr, fp, Math.atan2(ry, rx), this.days, RS);
        if (RS.a > 0.0005) {
          ringT = t;
          this.ringLight(rx, ry, dx, dy, dz);
        }
      }
    }
    // atmosphere between the camera and whatever the ray reached
    const A2 = this.A;
    let inAtm = false, tAtm = 0;
    if (B.atm) {
      const rt = B.atm.rt;
      const disc2 = Bq * Bq - A * (B.oo - rt * rt);
      if (disc2 > 0) {
        const sq = Math.sqrt(disc2);
        let t0 = (-Bq - sq) / A, t1 = (-Bq + sq) / A;
        if (t1 > 0) {
          if (t0 < 0) t0 = 0;
          if (tHit < t1) t1 = tHit;
          if (t1 > t0) {
            if (!this.atmOverride) this.atmosphere(ox, oy, oz, sx, sy, sz, dx, dy, dz, t0, t1);
            inAtm = true; tAtm = t1;
          }
        }
      }
    }
    if (!inAtm) { A2.tr = A2.tg = A2.tb = 1; A2.r = A2.g = A2.b = 0; }
    let r, g, b;
    if (tHit < Infinity) {
      if (A2.tr + A2.tg + A2.tb > 0.006) {
        this.shadeSurface(qx, qy, qz, nx, ny, nz, dx, dy, dz, tHit, res);
        r = res.r; g = res.g; b = res.b;
      } else { r = g = b = 0; res.kind = K.CLOUD; res.glow = 0; }
      res.hit = true; res.t = tHit;
    } else { r = BG[0]; g = BG[1]; b = BG[2]; }
    if (inAtm) {
      r = r * A2.tr + A2.r; g = g * A2.tg + A2.g; b = b * A2.tb + A2.b;
      res.ir = A2.r; res.ig = A2.g; res.ib = A2.b;
      if (!res.hit) res.t = tAtm;
    }
    if (ringT < Infinity) {
      const a = RS.a;
      r = RS.r + r * (1 - a); g = RS.g + g * (1 - a); b = RS.b + b * (1 - a);
      res.ring = true;
      if (!res.hit) res.t = res.t || ringT;
      if (a > 0.12 && !res.hit) {
        // dense ring: draw it with a glyph that follows the ring's curve on screen
        const k = 1.25;
        res.ch = this.ringGlyph(ox + ringT * sx, oy + ringT * sy, dx, dy, dz, ringT, a);
        res.fr = RS.r * k + r * 0.3; res.fgg = RS.g * k + g * 0.3; res.fb = RS.b * k + b * 0.3;
        r *= 0.55; g *= 0.55; b *= 0.55;
        res.t = ringT;
      }
      if (res.hit && ringT < tHit && a > 0.12) { res.kind = K.RING; }
    }
    if (B.plume) {
      const p = this.plume(ox, oy, oz, sx, sy, sz, dx, dy, dz, res.hit ? tHit : Infinity);
      r += p * 0.75; g += p * 0.85; b += p; res.glow = Math.max(res.glow, Math.min(0.5, p));
      if (p > 0.002 && !res.hit && !res.t) res.t = B.d;
      if (!res.hit && p > 0.002) { res.ir += p * 0.75; res.ig += p * 0.85; res.ib += p; }
    }
    res.r = r; res.g = g; res.b = b;
    return res;
  }

  // Colour of the ring at a point (km, body axes, z = 0): sunlit or backlit, in Saturn's shadow or not.
  ringLight(rx, ry, dx, dy, dz) {
    const B = this.B, RS = this.RS;
    const a = RS.a;
    const sameSide = (B.ocz > 0) === (B.sz > 0);
    const elev = Math.abs(B.sz);
    let L;
    if (sameSide) L = a * (0.55 + 0.45 * Math.pow(elev, 0.25)) * 1.5;
    else L = a * (1 - a) * 1.3 * Math.pow(elev, 0.2);
    if (B.rings.dusty) {
      // fine dust shines brightest when backlit
      const back = Math.max(0, dx * B.sx + dy * B.sy + dz * B.sz);
      L *= 1 + 20 * Math.pow(back, 8);
    }
    // planet shadow: does the ray from this ring point toward the Sun hit the planet?
    const px = rx / B.ra, py = ry / B.rb;
    const qx = B.sx / B.ra, qy = B.sy / B.rb, qz = B.sz / B.rc;
    const A = qx * qx + qy * qy + qz * qz, Bq = px * qx + py * qy;
    const disc = Bq * Bq - A * (px * px + py * py - 1);
    let sh = 1;
    if (Bq < 0) {
      const dmin = Math.sqrt(Math.max(0, px * px + py * py - (Bq * Bq) / A));
      sh = smoothstep(0.985, 1.015, dmin);
      if (disc < 0) sh = 1;
    }
    L *= sh * B.light * B.rings.lit;
    RS.r *= L * SUN_COL[0]; RS.g *= L * SUN_COL[1]; RS.b *= L * SUN_COL[2];
  }

  ringGlyph(qx, qy, dx, dy, dz, t, a) {
    const B = this.B;
    // tangent of the ring circle at this point, and the point relative to the camera, in camera space
    const tl = Math.hypot(qx, qy) || 1;
    const Tx = -qy / tl, Ty = qx / tl;
    const tcx = Tx * B.R[0] + Ty * B.R[1], tcy = Tx * B.U[0] + Ty * B.U[1], tcz = Tx * B.F[0] + Ty * B.F[1];
    const Px = t * (dx * B.R[0] + dy * B.R[1] + dz * B.R[2]), Py = t * (dx * B.U[0] + dy * B.U[1] + dz * B.U[2]), Pz = t * (dx * B.F[0] + dy * B.F[1] + dz * B.F[2]);
    const sxd = tcx * Pz - Px * tcz, syd = tcy * Pz - Py * tcz;
    let ang = Math.atan2(syd, sxd);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI) ang -= Math.PI;
    const deg = ang / DEG;
    // follow the ring's curve: = and - along the near and far arcs, ( ) where it turns at the ansae
    if (deg < 28 || deg >= 152) return a > 0.55 ? 61 : a > 0.25 ? G_DASH : G_DOT;
    if (deg > 62 && deg < 118) return Px < 0 ? 40 : 41;
    if (a < 0.3) return 58;
    return deg < 90 ? G_SLASH : G_BSL;
  }

  // Lit colour of the surface point q (on the unit ellipsoid, body axes scaled), normal n.
  shadeSurface(qx, qy, qz, nx, ny, nz, dx, dy, dz, t, res) {
    const B = this.B, b = B.b;
    const ql = Math.hypot(qx, qy, qz);
    const px = qx / ql, py = qy / ql, pz = qz / ql;
    const mu0r = nx * B.sx + ny * B.sy + nz * B.sz;
    const mu = Math.max(0.02, -(nx * dx + ny * dy + nz * dz));
    const lod = (t * this.cellAng) / Math.max(0.18, mu) / B.ra;
    sampleSurface(b, B.tex, px, py, pz, lod, this.days, B.season);
    let ar = S.r, ag = S.g, ab = S.b;
    let kind = S.kind;
    // relief: tilt the normal by the height slope along the sunward direction
    let mu0 = mu0r;
    if (B.relief > 0 && mu0r > -0.2 && mu0r < 0.999) {
      let tx = B.sx - mu0r * nx, ty = B.sy - mu0r * ny, tz = B.sz - mu0r * nz;
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const eps = Math.max(lod * 1.4, Math.min(B.tex.texel * 0.8, lod * 6));
      const h1 = sampleHeight(b, B.tex, px + tx * eps, py + ty * eps, pz + tz * eps, lod);
      const slope = (h1 - S.h) / eps;
      mu0 = mu0r - Math.sqrt(Math.max(0, 1 - mu0r * mu0r)) * slope * B.relief * 2.2;
      if (mu0r <= 0) mu0 = Math.min(mu0, mu0r + 0.05);
    }
    // shadows: eclipses by other bodies, Saturn's rings on Saturn
    let sh = 1;
    const P0 = px * B.ra, P1 = py * B.rb, P2 = pz * B.rc;
    let red = 0;
    for (let k = 0; k < B.occ.length; k++) {
      const o = B.occ[k];
      const vx = o.x - P0, vy = o.y - P1, vz = o.z - P2;
      const tca = vx * B.sx + vy * B.sy + vz * B.sz;
      if (tca <= 0) continue;
      const dd = Math.sqrt(Math.max(0, vx * vx + vy * vy + vz * vz - tca * tca));
      const ao = o.r / tca, sep = dd / tca, as = B.sunAng;
      if (sep > ao + as) continue;
      // fraction of the solar disc still visible: total, annular, or partial overlap
      const lo = Math.abs(ao - as), fMin = ao > as ? 0 : 1 - (ao * ao) / (as * as);
      const f = sep <= lo ? fMin : fMin + ((1 - fMin) * (sep - lo)) / (ao + as - lo);
      if (o.atmo && f < 0.3) red = Math.max(red, 1 - f / 0.3);
      sh *= f;
    }
    if (B.rings && B.sz !== 0) {
      const s = -P2 / B.sz;
      if (s > 0) {
        const rx = P0 + s * B.sx, ry = P1 + s * B.sy;
        ringSample(B.rings, Math.hypot(rx, ry), 200, Math.atan2(ry, rx), this.days, this.RS);
        sh *= 1 - this.RS.a * 0.92;
      }
    }
    // reflectance law
    const tw = B.twilight;
    const m0 = tw > 0 ? clamp((mu0 + tw) / (1 + tw), 0, 1) * smoothstep(-tw, tw * 0.6, mu0) : Math.max(0, mu0);
    let f;
    if (b.id === 'earth') {
      const cl = S.c;
      const land = m0;
      const cloud = m0 > 0 ? Math.pow(m0, 0.9) * Math.pow(mu, -0.1) : 0;
      ar = ar * (1 - cl) * land + 0.92 * cl * cloud;
      ag = ag * (1 - cl) * land + 0.93 * cl * cloud;
      ab = ab * (1 - cl) * land + 0.96 * cl * cloud;
      f = 1;
      if (S.spec && m0 > 0) {
        const hx = B.sx - dx, hy = B.sy - dy, hz = B.sz - dz, hl = Math.hypot(hx, hy, hz);
        const nh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
        const fres = 0.3 + 0.7 * Math.pow(1 - mu, 5);
        const sp = Math.pow(nh, 90) * 2.2 * fres * (1 - cl) + Math.pow(nh, 12) * 0.05;
        ar += sp; ag += sp * 0.95; ab += sp * 0.85;
      }
    } else if (B.minn > 0) {
      f = m0 > 0 ? Math.pow(m0, B.minn) * Math.pow(mu, B.minn - 1) : 0;
    } else {
      f = m0 > 0 ? B.ls * (2 * m0) / (m0 + mu) + (1 - B.ls) * m0 : 0;
      if (B.look.metal) f *= 1 + B.look.metal * Math.pow(Math.max(0, m0 + mu - 1), 3);
    }
    const L = B.light * sh * f;
    let r = ar * L * SUN_COL[0], g = ag * L * SUN_COL[1], bl = ab * L * SUN_COL[2];
    if (red > 0) { const k = red * 0.06 * B.light * Math.max(0, m0 > 0 ? 1 : 0); r += ar * k * 1.4; g += ag * k * 0.35; bl += ab * k * 0.15; }
    r += ar * B.amb; g += ag * B.amb; bl += ab * B.amb;
    let glow = 0;
    // emission: city lights on Earth's night side, lava on Io
    if (b.id === 'earth' && S.l > 0.01) {
      const night = smoothstep(0.1, -0.12, mu0r);
      const e = S.l * night * (1 - S.c * 0.85) * 0.8;
      r += e * 1.0; g += e * 0.7; bl += e * 0.34;
      glow = e * 0.8;
      if (e > 0.25) kind = K.UI;
    } else if (S.emit > 0) {
      const e = S.emit * (0.25 + 0.75 * smoothstep(0.1, -0.1, mu0r)) * 0.9;
      r += e; g += e * 0.32; bl += e * 0.08; glow = e * 0.7;
    }
    res.r = r; res.g = g; res.b = bl; res.kind = kind; res.glow = glow;
  }

  // Single scattering through the atmosphere from t0 to t1 (km along the ray). Results in this.A.
  atmosphere(ox, oy, oz, sx, sy, sz, dx, dy, dz, t0, t1) {
    const B = this.B, at = B.atm, A = this.A;
    const comps = at.comps, nc = comps.length, Rkm = B.ra;
    const cosT = dx * B.sx + dy * B.sy + dz * B.sz;
    const len = t1 - t0;
    let hmin = Infinity;
    for (const c of comps) hmin = Math.min(hmin, c.H);
    const n = Math.max(4, Math.min(at.dense ? 16 : 11, Math.ceil(len / (hmin * 3)) + 3));
    const dsU = len / n, NMAX = at.dense ? 28 : 14;
    // steps shrink where the air is thick so no single step swallows more than ~0.45 of optical depth
    let ePrev = 0;
    {
      const qx = ox + t0 * sx, qy = oy + t0 * sy, qz = oz + t0 * sz;
      const h0 = Math.max(0, (Math.hypot(qx, qy, qz) - 1) * Rkm);
      for (let k = 0; k < nc; k++) { const c = comps[k]; if (!c.layer) ePrev += Math.exp(-h0 / c.H) * (c.br + c.ar); }
    }
    let tcur = t0;
    let tr = 1, tg = 1, tb = 1, ir = 0, ig = 0, ib = 0;
    const phR = 0.75 * (1 + cosT * cosT);
    const PH = this.PH || (this.PH = new Float64Array(24));
    for (let k = 0; k < nc; k++) {
      const c = comps[k];
      if (!c.layer && c.ray) { PH[k * 3] = PH[k * 3 + 1] = PH[k * 3 + 2] = phR; continue; }
      const gr = c.layer ? c.g : c.gr, gg = c.layer ? c.g : c.gg, gb = c.layer ? c.g : c.gb;
      PH[k * 3] = hg(gr, cosT); PH[k * 3 + 1] = gg === gr ? PH[k * 3] : hg(gg, cosT); PH[k * 3 + 2] = gb === gr ? PH[k * 3] : hg(gb, cosT);
      // multiple scattering in thick hazes, approximated by blending toward isotropic
      if (c.ms) for (let q = 0; q < 3; q++) PH[k * 3 + q] = PH[k * 3 + q] * (1 - c.ms) + c.ms;
    }
    for (let i = 0; i < NMAX && tcur < t1 - 1e-9; i++) {
      let ds = ePrev > 0 ? Math.min(dsU, Math.max(dsU * 0.03, 0.45 / ePrev)) : dsU;
      if (tcur + ds > t1 || i === NMAX - 1) ds = t1 - tcur;
      const t = tcur + ds * 0.5;
      tcur += ds;
      const qx = ox + t * sx, qy = oy + t * sy, qz = oz + t * sz;
      const r = Math.hypot(qx, qy, qz);
      const h = Math.max(0, (r - 1) * Rkm);
      const mus = (qx * B.sx + qy * B.sy + qz * B.sz) / r;
      // in the planet's shadow?
      const lit = mus > -Math.sqrt(Math.max(0, 1 - 1 / (r * r))) ? 1 : 0;
      let er = 0, eg = 0, eb = 0, sr = 0, sg = 0, sb = 0, osr = 0, osg = 0, osb = 0;
      for (let k = 0; k < nc; k++) {
        const c = comps[k];
        let rho, col;
        if (c.layer) { const z = (h - c.h0) / c.w; rho = Math.exp(-z * z); col = rho * c.w * 1.5; }
        else { rho = Math.exp(-h / c.H); col = lit ? rho * c.H * chapman((r * Rkm) / c.H, mus) : 0; }
        if (rho < 1e-7) continue;
        er += rho * (c.br + c.ar); eg += rho * (c.bg + c.ag); eb += rho * (c.bb + c.ab);
        if (lit) {
          osr += col * (c.br + c.ar); osg += col * (c.bg + c.ag); osb += col * (c.bb + c.ab);
          sr += rho * c.br * PH[k * 3]; sg += rho * c.bg * PH[k * 3 + 1]; sb += rho * c.bb * PH[k * 3 + 2];
        }
      }
      // exact integral over the step of scattering into a medium of extinction e: s (1 - e^-e ds) / e
      const xr = Math.exp(-er * ds), xg = Math.exp(-eg * ds), xb = Math.exp(-eb * ds);
      if (lit) {
        ir += tr * sr * Math.exp(-osr) * (er > 1e-9 ? (1 - xr) / er : ds);
        ig += tg * sg * Math.exp(-osg) * (eg > 1e-9 ? (1 - xg) / eg : ds);
        ib += tb * sb * Math.exp(-osb) * (eb > 1e-9 ? (1 - xb) / eb : ds);
      }
      if (at.aurora && h > 90 && h < 400 && mus < 0.1) {
        const e = this.aurora(at.aurora, qx / r, qy / r, qz / r, h) * smoothstep(0.1, -0.15, mus);
        if (e > 0) { const k = e * ds * tr; ir += k * at.aurora.col[0] * (h > 220 ? 0.4 : 1) + (h > 220 ? k * at.aurora.col2[0] : 0); ig += k * at.aurora.col[1] * (h > 220 ? 0.3 : 1); ib += k * at.aurora.col[2] * (h > 220 ? 0.4 : 1) + (h > 220 ? k * at.aurora.col2[2] * 0.5 : 0); }
      }
      tr *= xr; tg *= xg; tb *= xb;
      ePrev = Math.max(er, eg, eb);
      if (tr + tg + tb < 0.003) break;
    }
    const L = B.light * 1.6;
    A.r = ir * L * SUN_COL[0]; A.g = ig * L * SUN_COL[1]; A.b = ib * L * SUN_COL[2];
    A.tr = tr; A.tg = tg; A.tb = tb;
  }

  // Auroral ovals round the geomagnetic poles, in vertical curtains.
  aurora(a, px, py, pz, h) {
    const c = px * a.v[0] + py * a.v[1] + pz * a.v[2];
    const ml = Math.asin(Math.abs(clamp(c, -1, 1))) / DEG;
    const w = Math.exp(-((ml - a.lat) * (ml - a.lat)) / 6);
    if (w < 0.02) return 0;
    const curtain = 0.5 + 0.5 * noise3(px * 60, py * 60, pz * 60 + this.time * 0.3);
    const vert = h < 110 ? smoothstep(90, 110, h) : Math.exp(-(h - 110) / 60);
    return w * curtain * curtain * vert * 0.004;
  }

  // Enceladus' south polar plume: icy spray, brightest when backlit.
  plume(ox, oy, oz, sx, sy, sz, dx, dy, dz, tmax) {
    const B = this.B;
    // closest approach of the ray to the line through the south pole along -z (scaled units)
    const wx = ox, wy = oy;
    const a = sx * sx + sy * sy;
    if (a < 1e-12) return 0;
    let t = -(wx * sx + wy * sy) / a;
    if (t < 0) t = 0;
    if (t > tmax) t = tmax;
    const px = ox + t * sx, py = oy + t * sy, pz = oz + t * sz;
    if (pz > -0.9) return 0;
    const hgt = -pz - 1;
    const rho = Math.hypot(px, py);
    const width = 0.06 + 0.3 * hgt;
    const dens = Math.exp(-hgt / 1.1) * Math.exp(-(rho * rho) / (width * width));
    const path = (width * 1.7) / Math.sqrt(a) * B.ra;
    const back = Math.max(0, dx * B.sx + dy * B.sy + dz * B.sz);
    const lit = pz < 0 && B.sz < 0.2 ? 1 : 0.6;
    return dens * path * 1.2e-4 * (0.1 + 6 * Math.pow(back, 6)) * B.light * lit;
  }

  // Lumpy small bodies: a radius map around the ellipsoid, intersected by marching.
  shapeFor(b) {
    let s = this.shapes.get(b.id);
    if (s) return s;
    const W = 96, H = 48;
    const r = new Float32Array(W * H);
    const paint = this.baker.painter(b);
    const o = { r: 0, g: 0, b: 0, h: 0, m: 0, c: 0, l: 0, f: 0 };
    const sh = b.shape;
    let rmin = 9, rmax = 0;
    const p = [0, 0, 0];
    for (let y = 0; y < H; y++) {
      const lat = 90 - ((y + 0.5) * 180) / H;
      for (let x = 0; x < W; x++) {
        const lon = -180 + ((x + 0.5) * 360) / W;
        p[0] = Math.cos(lat * DEG) * Math.cos(lon * DEG); p[1] = Math.cos(lat * DEG) * Math.sin(lon * DEG); p[2] = Math.sin(lat * DEG);
        o.h = 0;
        paint(p, lat, lon, o);
        const n = fbm3(p[0] * sh.freq + sh.seed, p[1] * sh.freq, p[2] * sh.freq, 4);
        const v = 1 + sh.amp * n + clamp(o.h, -0.2, 0.2) * 2.5;
        r[y * W + x] = v;
        rmin = Math.min(rmin, v); rmax = Math.max(rmax, v);
      }
    }
    s = { W, H, r, rmin: rmin - 0.01, rmax: rmax + 0.01, hit: { t: 0, qx: 0, qy: 0, qz: 0, nx: 0, ny: 0, nz: 0 } };
    this.shapes.set(b.id, s);
    return s;
  }

  shapeR(s, x, y, z) {
    const l = Math.hypot(x, y, z) || 1;
    const lat = Math.asin(clamp(z / l, -1, 1)), lon = Math.atan2(y, x);
    let u = (lon / TAU + 0.5) * s.W - 0.5, v = (0.5 - lat / Math.PI) * s.H - 0.5;
    u -= Math.floor(u / s.W) * s.W;
    if (v < 0) v = 0; else if (v > s.H - 1.001) v = s.H - 1.001;
    const x0 = Math.floor(u), y0 = Math.floor(v), fu = u - x0, fv = v - y0, x1 = x0 + 1 >= s.W ? 0 : x0 + 1;
    const R = s.r, W = s.W;
    return (R[y0 * W + x0] * (1 - fu) + R[y0 * W + x1] * fu) * (1 - fv) + (R[(y0 + 1) * W + x0] * (1 - fu) + R[(y0 + 1) * W + x1] * fu) * fv;
  }

  marchShape(ox, oy, oz, sx, sy, sz, A, Bq) {
    const s = this.B.shape, oo = this.B.oo;
    const dOut = Bq * Bq - A * (oo - s.rmax * s.rmax);
    if (dOut < 0) return null;
    const sq = Math.sqrt(dOut);
    let ta = (-Bq - sq) / A, tb = (-Bq + sq) / A;
    if (tb <= 0) return null;
    if (ta < 0) ta = 0;
    const dIn = Bq * Bq - A * (oo - s.rmin * s.rmin);
    if (dIn >= 0) { const ti = (-Bq - Math.sqrt(dIn)) / A; if (ti > ta) tb = Math.min(tb, ti + 1e-9); }
    const N = 16;
    const f = (t) => { const x = ox + t * sx, y = oy + t * sy, z = oz + t * sz; return Math.hypot(x, y, z) - this.shapeR(s, x, y, z); };
    let t0 = ta, f0 = f(ta);
    if (f0 < 0) return null;
    let found = false, t1 = tb, f1 = 0;
    for (let k = 1; k <= N; k++) {
      const t = ta + ((tb - ta) * k) / N;
      const fv = f(t);
      if (fv < 0) { t1 = t; f1 = fv; found = true; break; }
      t0 = t; f0 = fv;
    }
    if (!found) {
      if (dIn < 0) return null;
      t1 = tb; f1 = f(tb);
      if (f1 > 0) return null;
    }
    for (let k = 0; k < 6; k++) {
      const tm = t0 + (t1 - t0) * clamp(f0 / (f0 - f1), 0.1, 0.9);
      const fm = f(tm);
      if (fm < 0) { t1 = tm; f1 = fm; } else { t0 = tm; f0 = fm; }
    }
    const t = (t0 + t1) / 2;
    const h = s.hit;
    h.t = t; h.qx = ox + t * sx; h.qy = oy + t * sy; h.qz = oz + t * sz;
    // normal from the gradient of |q| - r(q/|q|), mapped back through the ellipsoid scaling
    const e = 0.02;
    const F0 = Math.hypot(h.qx, h.qy, h.qz) - this.shapeR(s, h.qx, h.qy, h.qz);
    const fxp = Math.hypot(h.qx + e, h.qy, h.qz) - this.shapeR(s, h.qx + e, h.qy, h.qz) - F0;
    const fyp = Math.hypot(h.qx, h.qy + e, h.qz) - this.shapeR(s, h.qx, h.qy + e, h.qz) - F0;
    const fzp = Math.hypot(h.qx, h.qy, h.qz + e) - this.shapeR(s, h.qx, h.qy, h.qz + e) - F0;
    const nx = fxp / this.B.ra, ny = fyp / this.B.rb, nz = fzp / this.B.rc;
    const nl = Math.hypot(nx, ny, nz) || 1;
    h.nx = nx / nl; h.ny = ny / nl; h.nz = nz / nl;
    return h;
  }

  // ---- orbit lines --------------------------------------------------------------------------------
  drawOrbits(opts) {
    const sys = this.sys, cam = this.cam;
    const show = [];
    const frame = opts.frame;
    const sysRoot = frame ? (frame.kind === 'moon' ? frame.parentBody : frame) : null;
    for (const b of sys.bodies) {
      if (!b.orbit) continue;
      const planetish = b.parentBody && b.parentBody.id === 'sun' && (b.kind === 'planet' || b.kind === 'dwarf' || b === opts.target);
      const moonHere = b.parentBody && sysRoot && b.parentBody === sysRoot;
      if (!planetish && !moonHere && b !== opts.target && !(b.belt && opts.target && opts.target.belt)) continue;
      show.push(b);
    }
    const P0 = [0, 0, 0], P1 = [0, 0, 0];
    for (const b of show) {
      let c = this.orbitCache.get(b.id);
      const period = b.orbit.lunar ? 27.32 : b.n ? TAU / b.n : 365;
      if (!c || Math.abs(c.jd - sys.jd) > Math.min(period * 0.01, 30)) {
        c = { jd: sys.jd, pts: sys.orbitPath(b, 360) };
        this.orbitCache.set(b.id, c);
      }
      const pts = c.pts;
      if (!pts) continue;
      const par = b.parentBody;
      const center = par.bary || par.pos;
      const base = par.id === 'sun' ? [0, 0, 0] : center;
      const col = b.look.col || [0.6, 0.6, 0.6];
      const isT = b === opts.target;
      const k = isT ? 0.75 : 0.38;
      const cr = col[0] * k + 0.05, cg = col[1] * k + 0.05, cb = col[2] * k + 0.08;
      const n = pts.length / 3;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = base[0] + pts[i * 3] - cam.pos[0], ay = base[1] + pts[i * 3 + 1] - cam.pos[1], az = base[2] + pts[i * 3 + 2] - cam.pos[2];
        const bx = base[0] + pts[j * 3] - cam.pos[0], by = base[1] + pts[j * 3 + 1] - cam.pos[1], bz = base[2] + pts[j * 3 + 2] - cam.pos[2];
        this.line3(ax, ay, az, bx, by, bz, cr, cg, cb, P0, P1);
      }
    }
  }

  line3(ax, ay, az, bx, by, bz, r, g, b, P0, P1) {
    const cam = this.cam, F = cam.fwd;
    let za = ax * F[0] + ay * F[1] + az * F[2], zb = bx * F[0] + by * F[1] + bz * F[2];
    const near = 1e-3;
    if (za < near && zb < near) return;
    if (za < near) { const t = (near - za) / (zb - za); ax += (bx - ax) * t; ay += (by - ay) * t; az += (bz - az) * t; za = near; }
    if (zb < near) { const t = (near - zb) / (za - zb); bx += (ax - bx) * t; by += (ay - by) * t; bz += (az - bz) * t; zb = near; }
    this.project(ax, ay, az, P0); this.project(bx, by, bz, P1);
    const x0 = P0[0], y0 = P0[1], x1 = P1[0], y1 = P1[1];
    const dx = x1 - x0, dy = y1 - y0;
    if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) || (x0 >= this.cols && x1 >= this.cols) || (y0 >= this.rows && y1 >= this.rows)) return;
    const steps = Math.min(4000, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy) * 1.0)) + 1);
    const ang = Math.atan2(-dy, dx * this.aspect + 1e-9);
    let gch;
    const a = ((ang / DEG) + 180) % 180;
    if (a < 25 || a >= 155) gch = G_DASH; else if (a < 65) gch = G_SLASH; else if (a < 115) gch = G_BAR; else gch = G_BSL;
    if (steps > 3000) return;
    const grid = this.grid, cols = this.cols;
    const da = Math.hypot(ax, ay, az), db = Math.hypot(bx, by, bz);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.floor(x0 + dx * t), y = Math.floor(y0 + dy * t);
      if (x < 0 || y < 0 || x >= cols || y >= this.rows) continue;
      const i = y * cols + x;
      const dep = da + (db - da) * t;
      if (grid.depth[i] < dep) continue;
      const k3 = i * 3;
      if (grid.ch[i] !== 32 && grid.kind[i] !== K.DUST && grid.kind[i] !== K.SPACE) continue;
      grid.ch[i] = steps < 2 ? G_DOT : gch;
      grid.fg[k3] = r; grid.fg[k3 + 1] = g; grid.fg[k3 + 2] = b;
      grid.kind[i] = K.SPACE;
    }
  }

  // ---- flight effects -------------------------------------------------------------------------------
  effects(opts) {
    const fx = opts.fx;
    if (!fx) return;
    const g = this.grid, { cols, rows } = this;
    // re-entry plasma: a hot glow pressing in from the screen edges, with streamers
    if (fx.heat > 0.01) {
      const h = Math.min(1, fx.heat);
      const T = this.time;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const u = (x + 0.5) / cols - 0.5, v = ((y + 0.5) / rows - 0.5) * (rows / cols) / this.aspect;
        const r = Math.hypot(u, v) * 2;
        const a = Math.atan2(v, u);
        const fl = 0.6 + 0.4 * noise3(Math.cos(a) * 4, Math.sin(a) * 4, T * 3 - r * 4);
        const I = h * smoothstep(0.3 - h * 0.25, 1.1, r) * fl * 0.9;
        if (I < 0.01) continue;
        const i = y * cols + x, k3 = i * 3;
        const hot = Math.min(1, I * 1.5);
        g.bg[k3] += I * 1.2; g.bg[k3 + 1] += I * (0.35 + 0.45 * hot); g.bg[k3 + 2] += I * (0.15 + 0.5 * hot * hot);
        g.glow[i] = Math.max(g.glow[i], Math.min(0.8, I));
      }
      const n = Math.floor(40 + 160 * h);
      for (let k = 0; k < n; k++) {
        const a = hashf(k, 7) * TAU, sp = 0.6 + hashf(k, 9) * 1.2;
        const r = ((hashf(k, 3) + T * sp * (0.8 + h)) % 1) * 1.2 + 0.15;
        const x = Math.floor(cols / 2 + Math.cos(a) * r * cols * 0.5), y = Math.floor(rows / 2 + Math.sin(a) * r * rows * 0.5);
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const i = y * cols + x, k3 = i * 3;
        const deg = ((Math.atan2(-Math.sin(a) * rows, Math.cos(a) * cols * this.aspect) / DEG) + 180) % 180;
        g.ch[i] = deg < 25 || deg >= 155 ? G_DASH : deg < 65 ? G_SLASH : deg < 115 ? G_BAR : G_BSL;
        const I = h * (0.6 + 0.6 * hashf(k, 5));
        g.fg[k3] = 1.6 * I + 0.2; g.fg[k3 + 1] = 0.9 * I + 0.1; g.fg[k3 + 2] = 0.5 * I + 0.1;
        g.glow[i] = Math.max(g.glow[i], 0.6 * I);
        g.kind[i] = K.UI;
      }
    }
    // wisps streaming past: cloud vapour in an atmosphere, ice motes in a ring plane
    if (fx.streak > 0.01 && fx.vel) {
      const sp = Math.hypot(fx.vel[0], fx.vel[1], fx.vel[2]);
      if (sp < 1e-6) return;
      const L = Math.max(0.02, sp * 0.35);
      const N = 70;
      if (!this.dust.length || Math.abs(this.dustL - L) / L > 0.6) {
        this.dust = [];
        for (let k = 0; k < N; k++) this.dust.push([(hashf(k, 1) - 0.5) * 2 * L, (hashf(k, 2) - 0.5) * 2 * L, (hashf(k, 3) - 0.5) * 2 * L]);
        this.dustL = L;
      }
      const dt = opts.dt || 0.016;
      const P = [0, 0, 0], Q = [0, 0, 0];
      for (const d of this.dust) {
        d[0] -= fx.vel[0] * dt; d[1] -= fx.vel[1] * dt; d[2] -= fx.vel[2] * dt;
        for (let k = 0; k < 3; k++) { if (d[k] < -L) d[k] += 2 * L; else if (d[k] > L) d[k] -= 2 * L; }
        if (!this.project(d[0], d[1], d[2], P)) continue;
        if (!this.project(d[0] + fx.vel[0] * 0.05, d[1] + fx.vel[1] * 0.05, d[2] + fx.vel[2] * 0.05, Q)) continue;
        const x = Math.floor(P[0]), y = Math.floor(P[1]);
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const dist = Math.hypot(d[0], d[1], d[2]);
        const I = fx.streak * clamp(1.2 - dist / L, 0, 1);
        if (I < 0.05) continue;
        const i = y * cols + x, k3 = i * 3;
        const ddx = Q[0] - P[0], ddy = Q[1] - P[1];
        const deg = ((Math.atan2(-ddy, ddx * this.aspect) / DEG) + 180) % 180;
        const long = Math.hypot(ddx, ddy) > 1.2;
        g.ch[i] = !long ? G_DOT : deg < 25 || deg >= 155 ? G_DASH : deg < 65 ? G_SLASH : deg < 115 ? G_BAR : G_BSL;
        const c = fx.streakCol || [0.9, 0.9, 0.95];
        g.fg[k3] = c[0] * I; g.fg[k3 + 1] = c[1] * I; g.fg[k3 + 2] = c[2] * I;
        g.kind[i] = K.UI;
      }
    }
  }
}

function hg(gv, c) {
  const g2 = gv * gv, d = 1 + g2 - 2 * gv * c;
  return (1 - g2) / (d * Math.sqrt(d));
}

