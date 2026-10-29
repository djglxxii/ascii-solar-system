// System map: an orrery seen from above the ecliptic. Orbits are drawn from the same elements that
// move the bodies, so speeding up time shows everything wheeling round; the small-body swarm shows the
// belt's Kirkwood gaps, the Hilda triangle and the two Trojan clouds riding with Jupiter.

import { AU } from './astro.js';
import { clamp, fmtDist, smoothstep } from './util.js';
import { K } from './bodies.js';

const G = (c) => c.charCodeAt(0);

export class MapView {
  constructor() { this.zoom = 1; this.cx = 0; this.cy = 0; this.cache = new Map(); this.focus = null; }

  // Half-width (km) of the whole-system view that frames the focus body's orbit, and of its own
  // moon system (null if it has none worth zooming into).
  spans(f) {
    const helio = f.kind === 'star' ? 5.5 * AU : Math.max(1.7 * AU, f.sunDist * 1.18);
    const far = f.children.reduce((m, c) => Math.max(m, c.orbit && c.orbit.a ? c.orbit.a * (1 + (c.orbit.e || 0)) : c.orbit && c.orbit.lunar ? 405000 : 0), 0);
    return { helio, local: far ? Math.min(far, 4e7) * 1.3 : Math.max(f.Req * 40, 2e5) };
  }

  render(g, sys, ship, font, opts) {
    const cols = g.cols, rows = g.rows, aspect = font.cellW / font.cellH;
    g.ch.fill(32); g.fg.fill(0); g.bg.fill(0); g.glow.fill(0); g.depth.fill(Infinity); g.kind.fill(K.UI);
    const focus = ship.target ? (ship.target.kind === 'moon' && ship.target.parentBody.id !== 'sun' ? ship.target.parentBody : ship.target) : sys.sun;
    if (focus !== this.focus) { this.focus = focus; this.zoom = 1; }
    // zooming in glides from the Sun-centred overview to the focus body's own system
    const sp = this.spans(focus);
    const half = sp.helio / this.zoom;
    // fit the span in whichever screen dimension is shorter
    const kmx = Math.max(half / (cols / 2), (half * aspect) / (rows / 2 - 2)), kmy = kmx / aspect;
    const glide = focus.kind === "star" ? 0 : smoothstep(Math.log(1.2), Math.log(3.5), Math.log(this.zoom));
    const fx = focus.pos[0] * glide, fy = focus.pos[1] * glide;
    const k = opts.snap ? 1 : 1 - Math.exp(-(opts.dt || 0.016) * 6);
    this.cx += (fx - this.cx) * k; this.cy += (fy - this.cy) * k;
    const toS = (x, y) => [cols / 2 + (x - this.cx) / kmx, rows / 2 - (y - this.cy) / kmy];
    // background stars
    for (let i = 0; i < 400; i++) {
      const x = (i * 7919) % cols, y = (i * 104729) % rows;
      g.glyph(x, y, 46, 0.12, 0.12, 0.15);
    }
    // scale rings around the Sun
    for (const au of [1, 5, 10, 20, 30, 40]) {
      const r = au * AU;
      if (r / kmx < 4 || r / kmx > cols * 3) continue;
      const n = 240;
      for (let s = 0; s < n; s++) {
        const a = (s / n) * Math.PI * 2;
        const [x, y] = toS(Math.cos(a) * r, Math.sin(a) * r);
        if (s % 2 === 0) this.put(g, x, y, 46, [0.1, 0.12, 0.16]);
      }
      const [lx, ly] = toS(r * 0.707, -r * 0.707);
      g.text(Math.floor(lx) + 1, Math.floor(ly), `${au} AU`, 0.2, 0.24, 0.3);
    }
    // swarm
    const s = sys.swarm;
    const SC = [[0.26, 0.23, 0.2], [0.36, 0.29, 0.22], [0.42, 0.3, 0.2], [0.24, 0.25, 0.32]];
    for (let i = 0; i < s.n; i++) {
      const [x, y] = toS(s.pos[i * 3], s.pos[i * 3 + 1]);
      this.put(g, x, y, 46, SC[s.type[i]], true);
    }
    // orbits
    const showMoons = focus.kind !== 'star' && half < 0.5 * AU;
    for (const b of sys.bodies) {
      if (!b.orbit) continue;
      const helio = b.parentBody.id === 'sun';
      if (helio && !(b.kind === 'planet' || b.kind === 'dwarf' || b.belt)) continue;
      if (!helio && !(showMoons && (b.parentBody === focus || b.parentBody === focus.parentBody))) continue;
      if (b.belt && !(b === ship.target || half < 4 * AU)) continue;
      let c = this.cache.get(b.id);
      const period = b.orbit.lunar ? 27.32 : b.n ? (2 * Math.PI) / b.n : 365;
      if (!c || Math.abs(c.jd - sys.jd) > Math.min(period * 0.01, 20)) { c = { jd: sys.jd, pts: sys.orbitPath(b, 240) }; this.cache.set(b.id, c); }
      const par = b.parentBody, base = par.id === 'sun' ? [0, 0] : (par.bary || par.pos);
      const col = b.look.col, kk = b === ship.target ? (b === focus && showMoons ? 0.25 : 0.7) : b.belt ? 0.22 : 0.4;
      const cc = [col[0] * kk + 0.04, col[1] * kk + 0.04, col[2] * kk + 0.06];
      const n = c.pts.length / 3;
      let px = null, py = null;
      for (let i = 0; i <= n; i++) {
        const j = i % n;
        const [x, y] = toS(base[0] + c.pts[j * 3], base[1] + c.pts[j * 3 + 1]);
        if (px !== null) this.line(g, px, py, x, y, cc, aspect);
        px = x; py = y;
      }
    }
    // bodies
    const labels = [];
    for (const b of sys.bodies) {
      const helio = !b.parentBody || b.parentBody.id === 'sun';
      if (!helio && !showMoons) continue;
      if (!helio && b.parentBody !== focus && b.parentBody !== focus.parentBody) continue;
      const [x, y] = toS(b.pos[0], b.pos[1]);
      const col = b.look.col;
      const ch = b.kind === 'star' ? '@' : b.kind === 'planet' ? (b.Req > 20000 ? 'O' : 'o') : b.kind === 'dwarf' ? 'o' : '.';
      const rr = b.Req / kmx;
      if (rr > 1.5) {
        // big enough to draw as a disc
        for (let yy = Math.floor(y - rr * aspect); yy <= Math.ceil(y + rr * aspect); yy++) for (let xx = Math.floor(x - rr); xx <= Math.ceil(x + rr); xx++) {
          if (Math.hypot((xx + 0.5 - x) / rr, (yy + 0.5 - y) / (rr * aspect)) < 1) this.put(g, xx, yy, 35, [col[0] * 1.1, col[1] * 1.1, col[2] * 1.1]);
        }
      } else this.put(g, x, y, G(ch), [col[0] * 1.3 + 0.1, col[1] * 1.3 + 0.1, col[2] * 1.3 + 0.1], false, b.kind === 'star' ? 1 : 0.25);
      if (b.kind === 'star' || b.kind === 'planet' || b.kind === 'dwarf' || !helio || b === ship.target || (b.belt && half < 4 * AU)) labels.push({ b, x, y, rr });
    }
    // ship marker and its heading
    const w = ship.world;
    const [sx, sy] = toS(w[0], w[1]);
    const hx = ship.fwd[0], hy = -ship.fwd[1] * aspect;
    const a = Math.atan2(-hy, hx) * 180 / Math.PI;
    const arrow = Math.abs(a) < 22.5 ? '>' : Math.abs(a) > 157.5 ? '<' : a > 0 ? (a < 67.5 ? '/' : a < 112.5 ? '^' : '\\') : (a > -67.5 ? '\\' : a > -112.5 ? 'v' : '/');
    this.put(g, sx, sy, G(arrow), [0.5, 1.4, 0.6], false, 0.6);
    // labels
    const used = new Uint8Array(cols * rows);
    labels.sort((p, q) => (q.b === ship.target) - (p.b === ship.target) || (p.b.kind === 'star' ? -1 : 0));
    const lab = (x, y, s, c) => {
      x = Math.floor(x); y = Math.floor(y);
      if (y < 2 || y >= rows - 2 || x < 0 || x + s.length >= cols) return false;
      for (let k = -1; k <= s.length; k++) if (used[y * cols + x + k]) return false;
      for (let k = -1; k <= s.length; k++) used[y * cols + x + k] = 1;
      g.text(x, y, s, c[0], c[1], c[2]);
      return true;
    };
    const tl = labels.find((L) => L.b === ship.target);
    if (!tl || Math.hypot(tl.x - sx, (tl.y - sy) / aspect) > 6) lab(sx + 2, sy, 'YOU', [0.5, 1.0, 0.6]);
    for (const L of labels) {
      const t = L.b === ship.target;
      const c = t ? [0.45, 0.85, 1.0] : L.b.kind === 'moon' ? [0.55, 0.6, 0.65] : [0.8, 0.8, 0.82];
      const gap = t ? 4 : 2;
      if (!lab(L.x + Math.max(gap, L.rr + gap), L.y, L.b.name, c) && !lab(L.x - L.b.name.length - gap - L.rr, L.y, L.b.name, c)) lab(L.x - L.b.name.length / 2, L.y + L.rr * aspect + 1, L.b.name, c);
      if (t && L.rr < 1.5) { this.put(g, L.x - 2, L.y, 91, [0.45, 0.85, 1.0]); this.put(g, L.x + 2, L.y, 93, [0.45, 0.85, 1.0]); }
    }
    // scale bar
    const bar = 16, km = bar * kmx;
    const sbar = ` |${'-'.repeat(bar - 2)}| ${fmtDist(km)} `;
    g.text(cols - sbar.length - 1, rows - 3, sbar, 0.55, 0.55, 0.58);
    const fl = ` SYSTEM MAP  ${glide > 0.5 ? `${focus.name} system` : "Sun-centred"}   wheel / Z X zoom ${this.zoom < 10 ? this.zoom.toFixed(1) : Math.round(this.zoom)}x `;
    g.text(Math.floor((cols - fl.length) / 2), rows - 2, fl, 0.6, 0.6, 0.62);
  }

  put(g, x, y, ch, c, weak = false, glow = 0) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return;
    const i = y * g.cols + x;
    if (weak && g.ch[i] !== 32 && g.ch[i] !== 46) return;
    g.glyph(x, y, ch, c[0], c[1], c[2], glow);
  }

  line(g, x0, y0, x1, y1, c, aspect) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    if (n > 600) return;
    const a = ((Math.atan2(-dy, dx * aspect) * 180) / Math.PI + 180) % 180;
    const ch = a < 25 || a >= 155 ? 45 : a < 65 ? 47 : a < 115 ? 124 : 92;
    for (let s = 0; s <= n; s++) {
      const x = Math.floor(x0 + (dx * s) / Math.max(1, n)), y = Math.floor(y0 + (dy * s) / Math.max(1, n));
      if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue;
      const i = y * g.cols + x;
      if (g.ch[i] !== 32 && g.ch[i] !== 46) continue;
      g.glyph(x, y, n < 2 ? 46 : ch, c[0], c[1], c[2]);
    }
  }

  zoomBy(f) { this.zoom = clamp(this.zoom * f, 0.08, 20000); }
}
