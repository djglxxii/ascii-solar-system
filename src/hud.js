// Interface drawn into the same character grid: clock, location, target marker and panel, labels,
// the navigation list, body information, help, toasts and the title screen.

import { clamp, fmtDist, fmtSpeed, fmtDuration, DEG } from './util.js';
import { formatDate, AU, C_KMS } from './astro.js';
import { K } from './bodies.js';

const INK = [0.93, 0.9, 0.82], AMBER = [1.0, 0.72, 0.3], DIM = [0.55, 0.55, 0.56], PANEL = [0.012, 0.014, 0.022], CYAN = [0.45, 0.85, 1.0], GREEN = [0.5, 0.95, 0.6];

export const TIME_RATES = [
  [1, 'real time'], [10, '10 s/s'], [60, '1 min/s'], [600, '10 min/s'], [3600, '1 h/s'], [21600, '6 h/s'],
  [86400, '1 day/s'], [604800, '1 week/s'], [2629800, '1 month/s'], [31557600, '1 year/s'],
];

const FIG = {
  A: ['    _    ', '   / \\   ', '  / _ \\  ', ' / ___ \\ ', '/_/   \\_\\'],
  S: [' ____  ', '/ ___| ', '\\___ \\ ', ' ___) |', '|____/ '],
  C: ['  ____ ', ' / ___|', '| |    ', '| |___ ', ' \\____|'],
  I: [' ___ ', '|_ _|', ' | | ', ' | | ', '|___|'],
  O: ['  ___  ', ' / _ \\ ', '| | | |', '| |_| |', ' \\___/ '],
  L: [' _     ', '| |    ', '| |    ', '| |___ ', '|_____|'],
  R: [' ____  ', '|  _ \\ ', '| |_) |', '|  _ < ', '|_| \\_\\'],
  Y: ['__   __', '\\ \\ / /', ' \\ V / ', '  | |  ', '  |_|  '],
  T: [' _____ ', '|_   _|', '  | |  ', '  | |  ', '  |_|  '],
  E: [' _____ ', '| ____|', '|  _|  ', '| |___ ', '|_____|'],
  M: [' __  __ ', '|  \\/  |', '| |\\/| |', '| |  | |', '|_|  |_|'],
  ' ': ['    ', '    ', '    ', '    ', '    '],
};
const figlet = (s) => { const r = ['', '', '', '', '']; for (const ch of s) for (let k = 0; k < 5; k++) r[k] += FIG[ch][k]; return r; };
const LOGO1 = figlet('ASCII SOLAR SYSTEM'), LOGO_A = figlet('ASCII'), LOGO_B = figlet('SOLAR SYSTEM');

const HELP = [
  ['FLY', 'W A S D  forward / back / strafe     R F  up / down'],
  ['LOOK', 'mouse (click to capture) or arrow keys     Q E  roll'],
  ['SPEED', 'wheel or Z / X  throttle     Shift  boost     Space  brake'],
  ['', 'speed scales with distance to the nearest surface'],
  ['TARGET', 'Tab  navigation list     1-9  planets     0  Sun'],
  ['', 'G  autopilot to target     C  look at target'],
  ['INFO', 'I  facts about the target'],
  ['TIME', '[ ]  slower / faster     K  pause     T  real time     Y  now'],
  ['VIEW', 'M  system map     O  orbits     L  labels     V  wide / narrow lens'],
  ['', 'B  glow     U  character shading     + -  text size     P  fps'],
  ['SOUND', 'N  on / off'],
  ['', 'Skim an atmosphere: fly low and fast to feel it push back.'],
];

export class Hud {
  constructor() {
    this.toasts = []; this.showHelp = false; this.showFps = false; this.fps = 60; this.title = true;
    this.nav = null; this.showInfo = false; this.labels = true; this.t = 0;
  }

  toast(s) { if (!s) return; this.toasts.push({ s, t: 3.2 }); if (this.toasts.length > 3) this.toasts.shift(); }
  text(g, x, y, s, c, glow = 0) { g.text(x, y, s, c[0], c[1], c[2], glow); }
  panel(g, x, y, w, h, a = 0.72) { g.shade(x, y, w, h, PANEL[0], PANEL[1], PANEL[2], a); }

  render(g, sys, ship, view, mode, dt, extra) {
    this.t += dt;
    const cols = g.cols, rows = g.rows;
    if (this.title) { this.drawTitle(g); return; }
    if (mode === 'view') { this.drawMarks(g, ship, view); this.reticle(g); }
    // top-left: date and clock rate
    const rate = TIME_RATES[extra.rateIdx];
    const tl = ` ${formatDate(sys.jd)} `;
    const tr = extra.paused ? ' || paused ' : ` >> ${rate[1]} `;
    this.panel(g, 0, 0, Math.max(tl.length + tr.length, 26), 2);
    this.text(g, 0, 0, tl, INK);
    this.text(g, tl.length, 0, tr, extra.paused ? AMBER : DIM);
    const thr = ` throttle ${this.throttleBar(ship.speedK)} `;
    this.text(g, 0, 1, thr, DIM);
    // top-right: where you are
    const reg = ship.region();
    const l1 = ` ${reg.title} `, l2 = ` ${reg.sub} `;
    let l3 = '';
    if (ship.atm && ship.atm.h < ship.atm.body.atmo.top * 1.2) {
      const P = ship.atm.P;
      l3 = ` alt ${fmtDist(Math.max(0, ship.atm.h))}  ${P > 0.01 ? P.toFixed(3) + ' bar' : P > 1e-5 ? (P * 1000).toFixed(3) + ' mbar' : (P * 1e6).toFixed(2) + ' ubar'} `;
    } else if (ship.altBody && ship.alt < 5e7) l3 = ` ${fmtDist(Math.max(0, ship.alt))} above ${ship.altBody.name} `;
    const l4 = ` speed ${fmtSpeed(ship.speed)} `;
    const rw = Math.max(l1.length, l2.length, l3.length, l4.length);
    this.panel(g, cols - rw, 0, rw, l3 ? 4 : 3);
    this.text(g, cols - l1.length, 0, l1, AMBER);
    this.text(g, cols - l2.length, 1, l2, INK);
    let yy = 2;
    if (l3) { this.text(g, cols - l3.length, yy++, l3, DIM); }
    this.text(g, cols - l4.length, yy, l4, ship.heat > 0.15 ? [1, 0.55, 0.3] : DIM, ship.heat > 0.15 ? 0.3 : 0);
    if (ship.heat > 0.12) {
      const s = ` HULL HEATING ${'#'.repeat(Math.round(clamp(ship.heat, 0, 1) * 10)).padEnd(10, '.')} `;
      this.panel(g, Math.floor((cols - s.length) / 2), 2, s.length, 1, 0.6);
      const k = 0.7 + 0.3 * Math.sin(this.t * 12);
      this.text(g, Math.floor((cols - s.length) / 2), 2, s, [1.2 * k, 0.5 * k, 0.25 * k], 0.4);
    }
    if (ship.auto) {
      const a = ship.auto;
      const s = ` AUTOPILOT  ->  ${a.target.name.toUpperCase()}   (any flight key takes over) `;
      this.panel(g, Math.floor((cols - s.length) / 2), rows - 3, s.length, 1, 0.65);
      this.text(g, Math.floor((cols - s.length) / 2), rows - 3, s, AMBER, 0.25);
    }
    // bottom-left hints
    const hint = mode === 'map' ? ' M back to flight   wheel zoom   Tab targets   G go   H help ' : ' H help   Tab targets   G go   M map   I info   [ ] time ';
    this.panel(g, 0, rows - 1, hint.length, 1, 0.6);
    this.text(g, 0, rows - 1, hint, DIM);
    if (extra.audioOn) this.text(g, hint.length + 1, rows - 1, ' sound on ', [0.5, 0.8, 0.6]);
    this.targetPanel(g, ship);
    // toasts
    let ty = 5;
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      t.t -= dt;
      if (t.t <= 0) { this.toasts.splice(i, 1); continue; }
      const a = clamp(t.t / 0.6, 0, 1);
      const s = `  ${t.s}  `;
      const x = Math.max(0, Math.floor((cols - s.length) / 2));
      this.panel(g, x, ty, s.length, 1, 0.75 * a);
      this.text(g, x, ty, s, [INK[0] * a, INK[1] * a, INK[2] * a], 0.15 * a);
      ty += 2;
    }
    if (this.showFps) {
      this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
      const s = ` ${Math.round(this.fps)} fps  ${cols}x${rows}  sim ${extra.perf.sim.toFixed(1)}ms  draw ${extra.perf.render.toFixed(1)}ms `;
      this.text(g, cols - s.length, rows - 2, s, GREEN);
    }
    if (this.nav) this.drawNav(g, ship);
    if (this.showInfo && ship.target) this.drawInfo(g, ship);
    if (this.showHelp) this.drawHelp(g);
  }

  throttleBar(k) {
    const t = clamp((Math.log10(k) + 2) / 3.3, 0, 1);
    const n = Math.round(t * 12);
    return '[' + '='.repeat(n) + '-'.repeat(12 - n) + ']';
  }

  reticle(g) {
    const cx = Math.floor(g.cols / 2), cy = Math.floor(g.rows / 2);
    const i = cy * g.cols + cx;
    if (g.ch[i] === 32 || g.kind[i] === K.DUST) g.glyph(cx, cy, 43, 0.35, 0.4, 0.42);
  }

  // Names beside bodies, and the target bracket / off-screen pointer.
  drawMarks(g, ship, view) {
    const cols = g.cols, rows = g.rows;
    const used = new Uint8Array(cols * rows);
    const tgt = ship.target;
    const frame = ship.frame;
    const sysRoot = frame.kind === 'moon' ? frame.parentBody : frame;
    const marks = view.marks.slice().sort((a, b) => (b.b === tgt) - (a.b === tgt) || prio(a.b) - prio(b.b));
    for (const m of marks) {
      const b = m.b;
      if (b === tgt) continue;
      if (!this.labels || !m.on) continue;
      const showMoon = b.kind === 'moon' && (b.parentBody === sysRoot || b.parentBody === tgt || b.parentBody === frame);
      const showBelt = b.belt && (frame.kind === 'star' ? Math.hypot(...ship.world) / AU > 1.8 && Math.hypot(...ship.world) / AU < 3.6 : false);
      if (!(b.kind === 'planet' || b.kind === 'star' || b.kind === 'dwarf' || showMoon || showBelt)) continue;
      if (b === frame && m.pr > 6) continue;
      const xi = Math.floor(m.x), yi = Math.floor(m.y);
      // hidden behind something nearer?
      const c = yi * cols + xi;
      if (g.depth[c] < m.d * 0.98 && m.pr < 1) continue;
      if (m.pr > rows * 0.4) continue;
      const s = b.name;
      const lx = xi + Math.ceil(m.pr / view.aspect) + 2, ly = yi - (m.pr > 1.5 ? Math.ceil(m.pr) + 1 : 0);
      const x0 = m.pr > 1.5 ? xi - Math.floor(s.length / 2) : lx;
      if (!this.free(used, cols, rows, x0, ly, s.length)) continue;
      this.mark(used, cols, x0, ly, s.length);
      const col = b.kind === 'moon' ? [0.6, 0.66, 0.7] : b.kind === 'star' ? [1, 0.85, 0.5] : [0.78, 0.8, 0.84];
      this.text(g, x0, ly, s, col);
    }
    if (!tgt) return;
    const m = view.marks.find((q) => q.b === tgt);
    if (!m) return;
    const dist = m.d;
    const lbl = ` ${tgt.name}  ${fmtDist(Math.max(0, dist - tgt.Req))} `;
    if (m.on && m.x > 1 && m.x < cols - 2 && m.y > 0 && m.y < rows - 1) {
      const xi = Math.floor(m.x), yi = Math.floor(m.y);
      const hx = Math.max(1, Math.ceil(m.pr / view.aspect) + 1), hy = Math.ceil(m.pr);
      const pulse = 0.8 + 0.2 * Math.sin(this.t * 4);
      const c = [CYAN[0] * pulse, CYAN[1] * pulse, CYAN[2] * pulse];
      if (m.pr < 1.5) {
        g.glyph(xi - 2, yi, 91, c[0], c[1], c[2], 0.3); g.glyph(xi + 2, yi, 93, c[0], c[1], c[2], 0.3);
      } else if (m.pr < rows * 0.45) {
        const corner = (x, y, ch) => g.glyph(x, y, ch.charCodeAt(0), c[0], c[1], c[2], 0.3);
        corner(xi - hx, yi - hy, '/'); corner(xi + hx, yi - hy, '\\'); corner(xi - hx, yi + hy, '\\'); corner(xi + hx, yi + hy, '/');
      }
      const ly = m.pr < 1.5 ? yi + 1 : Math.min(rows - 4, yi + hy + 1);
      const lx = clamp(xi - Math.floor(lbl.length / 2), 0, cols - lbl.length);
      if (m.pr < rows * 0.45) { this.panel(g, lx, ly, lbl.length, 1, 0.5); this.text(g, lx, ly, lbl, CYAN); }
    } else {
      // off screen: point to it from the edge
      const cam = ship;
      const r = m.rel;
      const cx = r[0] * cam.right[0] + r[1] * cam.right[1] + r[2] * cam.right[2];
      const cy = r[0] * cam.up[0] + r[1] * cam.up[1] + r[2] * cam.up[2];
      const a = Math.atan2(cy, cx * view.aspect);
      const ex = cols / 2 + Math.cos(a) * (cols / 2 - 3), ey = rows / 2 - Math.sin(a) * (rows / 2 - 3);
      const deg = ((a / DEG) + 360) % 360;
      const arrow = deg < 22.5 || deg >= 337.5 ? '>' : deg < 67.5 ? '/' : deg < 112.5 ? '^' : deg < 157.5 ? '\\' : deg < 202.5 ? '<' : deg < 247.5 ? '/' : deg < 292.5 ? 'v' : '\\';
      const x = Math.floor(ex), y = Math.floor(ey);
      g.glyph(x, y, arrow.charCodeAt(0), CYAN[0] * 1.2, CYAN[1] * 1.2, CYAN[2] * 1.2, 0.5);
      const lx = clamp(x - Math.floor(lbl.length / 2), 0, cols - lbl.length), ly = clamp(y + (ey > rows / 2 ? -1 : 1), 3, rows - 4);
      this.panel(g, lx, ly, lbl.length, 1, 0.5);
      this.text(g, lx, ly, lbl, CYAN);
    }
  }

  free(used, cols, rows, x, y, n) {
    if (y < 2 || y >= rows - 2 || x < 0 || x + n >= cols) return false;
    for (let k = -1; k <= n; k++) if (used[y * cols + x + k]) return false;
    return true;
  }
  mark(used, cols, x, y, n) { for (let k = -1; k <= n; k++) used[y * cols + x + k] = 1; }

  targetPanel(g, ship) {
    const t = ship.target;
    if (!t) return;
    const cols = g.cols, rows = g.rows;
    const w = ship.world;
    const d = Math.hypot(t.pos[0] - w[0], t.pos[1] - w[1], t.pos[2] - w[2]);
    const alt = Math.max(0, d - t.Req);
    // closing speed (positive when approaching)
    const u = [(t.pos[0] - w[0]) / d, (t.pos[1] - w[1]) / d, (t.pos[2] - w[2]) / d];
    const close = ship.vel[0] * u[0] + ship.vel[1] * u[1] + ship.vel[2] * u[2];
    const eta = close > 0.01 ? alt / close : Infinity;
    const lines = [
      [` TARGET  ${t.name.toUpperCase()}`, AMBER],
      [` ${t.info ? t.info.type : t.kind}`, DIM],
      [` range ${fmtDist(alt)}${d > 1e7 ? `  (light ${fmtDuration(d / C_KMS)})` : ''}`, INK],
      [` ${close > 0.01 ? `closing ${fmtSpeed(close)}  eta ${fmtDuration(eta)}` : 'not closing'}`, DIM],
      [ship.auto ? ' autopilot engaged' : ' G go   C look   I info', ship.auto ? AMBER : DIM],
    ];
    const pw = Math.max(...lines.map((l) => l[0].length)) + 2;
    const x0 = cols - pw, y0 = rows - lines.length - 1;
    this.panel(g, x0, y0, pw, lines.length);
    lines.forEach(([s, c], k) => this.text(g, x0, y0 + k, s, c));
  }

  // ---- navigation list ------------------------------------------------------------------------------
  openNav(sys, ship) {
    const items = [];
    const depth = (b) => { let d = 0; for (let p = b.parentBody; p && p.id !== 'sun'; p = p.parentBody) d++; return d; };
    let beltDone = false;
    for (const b of sys.bodies) {
      if (b.belt && !beltDone) { items.push({ header: 'asteroid belt' }); beltDone = true; }
      if (!b.belt && beltDone && b.kind === 'planet' && !items.some((i) => i.header === 'outer planets')) items.push({ header: 'outer planets' });
      if (b.id === 'pluto') items.push({ header: 'kuiper belt' });
      items.push({ b, depth: b.id === 'sun' ? 0 : depth(b) + 1 });
    }
    let sel = items.findIndex((i) => i.b && i.b === (ship.target || ship.frame));
    if (sel < 0) sel = 1;
    this.nav = { items, sel };
  }

  navMove(d) {
    const n = this.nav;
    if (!n) return;
    let s = n.sel;
    do { s = (s + d + n.items.length) % n.items.length; } while (!n.items[s].b);
    n.sel = s;
  }
  navSelected() { return this.nav && this.nav.items[this.nav.sel].b; }

  drawNav(g, ship) {
    const n = this.nav, rows = g.rows;
    const w = 42, h = Math.min(n.items.length + 4, rows - 6);
    const x0 = 2, y0 = 3;
    this.panel(g, x0, y0, w, h, 0.9);
    this.text(g, x0 + 2, y0, 'NAVIGATION', AMBER, 0.3);
    this.text(g, x0 + w - 18, y0, 'Enter go  Esc', DIM);
    const vis = h - 3;
    const top = clamp(n.sel - Math.floor(vis / 2), 0, Math.max(0, n.items.length - vis));
    const w0 = ship.world;
    for (let k = 0; k < vis && top + k < n.items.length; k++) {
      const it = n.items[top + k], y = y0 + 2 + k;
      if (it.header) { this.text(g, x0 + 2, y, `-- ${it.header} --`, [0.45, 0.45, 0.48]); continue; }
      const b = it.b, selected = top + k === n.sel;
      const d = Math.hypot(b.pos[0] - w0[0], b.pos[1] - w0[1], b.pos[2] - w0[2]);
      const name = ' '.repeat(it.depth * 2) + b.name;
      const dist = fmtDist(d);
      const line = `${selected ? '>' : ' '} ${name.padEnd(20)} ${dist.padStart(16)}`;
      if (selected) g.shade(x0 + 1, y, w - 2, 1, 0.18, 0.12, 0.04, 0.8);
      this.text(g, x0 + 1, y, line.slice(0, w - 2), selected ? AMBER : b.kind === 'moon' ? [0.62, 0.66, 0.7] : INK, selected ? 0.25 : 0);
      if (b === ship.target && !selected) this.text(g, x0 + 1, y, '*', CYAN);
    }
  }

  // ---- body information -------------------------------------------------------------------------------
  drawInfo(g, ship) {
    const t = ship.target, inf = t.info || {};
    const rows = [];
    rows.push([t.name.toUpperCase(), AMBER]);
    rows.push([inf.type || '', DIM]);
    rows.push(['', INK]);
    const kv = [['diameter', inf.diameter], ['mass', inf.mass], ['gravity', inf.gravity], ['day', inf.day], ['year', inf.year], ['temperature', inf.temp], ['atmosphere', inf.atmo], ['moons', inf.moons]];
    for (const [k, v] of kv) if (v) rows.push([`${k.padEnd(12)}${v}`, INK]);
    const sunD = t.sunDist / AU;
    if (t.kind !== 'star') {
      const vs = Math.hypot(...t.vel);
      rows.push([`${'from Sun'.padEnd(12)}${sunD.toFixed(3)} AU now`, INK]);
      if (vs > 0 && isFinite(vs)) rows.push([`${'speed'.padEnd(12)}${vs.toFixed(1)} km/s ${t.parentBody && t.parentBody.id !== 'sun' ? 'around the Sun' : 'in its orbit'}`, INK]);
    }
    rows.push(['', INK]);
    for (const f of inf.facts || []) for (const l of wrap(f, 58)) rows.push([l, [0.75, 0.82, 0.88]]);
    const w = Math.min(g.cols - 4, Math.max(...rows.map((r) => r[0].length)) + 6), h = rows.length + 3;
    const x0 = g.cols - w - 2, y0 = Math.max(4, Math.floor((g.rows - h) / 2) - 2);
    this.panel(g, x0, y0, w, h, 0.9);
    rows.forEach(([s, c], k) => this.text(g, x0 + 3, y0 + 1 + k, s.slice(0, w - 4), c, k === 0 ? 0.3 : 0));
    this.text(g, x0 + 3, y0 + h - 1, 'I closes', DIM);
  }

  drawHelp(g) {
    const cols = g.cols, rows = g.rows;
    const w = Math.max(...HELP.map((s) => s[1].length)) + 18, h = HELP.length + 6;
    const x0 = Math.floor((cols - w) / 2), y0 = Math.max(0, Math.floor((rows - h) / 2));
    this.panel(g, x0, y0, w, h, 0.9);
    const top = '+' + '-'.repeat(w - 2) + '+';
    this.text(g, x0, y0, top, AMBER); this.text(g, x0, y0 + h - 1, top, AMBER);
    for (let y = 1; y < h - 1; y++) { this.text(g, x0, y0 + y, '|', AMBER); this.text(g, x0 + w - 1, y0 + y, '|', AMBER); }
    this.text(g, x0 + 3, y0 + 1, 'FLIGHT MANUAL', AMBER, 0.3);
    HELP.forEach(([a, b], k) => { this.text(g, x0 + 3, y0 + 3 + k, a, AMBER); this.text(g, x0 + 13, y0 + 3 + k, b, INK); });
    this.text(g, x0 + 3, y0 + h - 2, 'H or Esc closes this', DIM);
  }

  drawTitle(g) {
    const cols = g.cols, rows = g.rows;
    const t = this.t;
    const one = LOGO1[0].length + 4 <= cols;
    const logos = one ? [LOGO1] : LOGO_B[0].length + 4 <= cols ? [LOGO_A, LOGO_B] : null;
    let y0 = Math.max(1, Math.floor(rows * 0.18));
    const boxH = logos ? logos.length * 6 + 7 : 6;
    const boxW = logos ? Math.max(...logos.map((l) => l[0].length)) + 8 : 40;
    g.shade(Math.floor((cols - boxW) / 2), y0 - 2, boxW, boxH, PANEL[0], PANEL[1], PANEL[2], 0.7);
    if (!logos) {
      const s = 'ASCII SOLAR SYSTEM';
      this.text(g, Math.floor((cols - s.length) / 2), y0, s, AMBER, 1);
      y0 += 2;
    } else {
      for (const L of logos) {
        const w = L[0].length, x0 = Math.floor((cols - w) / 2);
        for (let r = 0; r < 5; r++) for (let k = 0; k < w; k++) {
          const ch = L[r][k];
          if (ch === ' ') continue;
          const q = k / w;
          const wave = 0.85 + 0.15 * Math.sin(t * 2 - k * 0.1 + r * 0.4);
          g.glyph(x0 + k, y0 + r, ch.charCodeAt(0), (1.0 - q * 0.45) * 1.5 * wave, (0.6 + q * 0.15) * 1.5 * wave, (0.25 + q * 0.75) * 1.5 * wave, 0.7);
        }
        y0 += 6;
      }
    }
    const sub = 'fly through the real Solar System, drawn in 95 printable characters';
    this.text(g, Math.floor((cols - sub.length) / 2), y0 + 1, sub, INK);
    const go = '[ click or press any key to launch ]';
    const blink = 0.75 + 0.25 * Math.sin(t * 3);
    this.text(g, Math.floor((cols - go.length) / 2), y0 + 3, go, [AMBER[0] * blink, AMBER[1] * blink, AMBER[2] * blink], 0.4 * blink);
    const hint = 'WASD fly  /  mouse look  /  Tab targets  /  G autopilot  /  H help';
    this.text(g, Math.floor((cols - hint.length) / 2), y0 + 4, hint, DIM);
  }
}

function prio(b) { return b.kind === 'star' ? 0 : b.kind === 'planet' ? 1 : b.kind === 'dwarf' ? 2 : b.kind === 'asteroid' ? 3 : 4; }

function wrap(s, n) {
  const out = [];
  let line = '';
  for (const w of s.split(' ')) {
    if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}
