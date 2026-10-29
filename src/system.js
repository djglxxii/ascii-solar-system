// The live Solar System: positions, spin axes and lighting geometry of every body at the current
// Julian Date, plus the background swarm of small bodies (main belt, Hildas, Trojans, Kuiper belt).

import { BODIES } from './bodies.js';
import { AU, GM_SUN, J2000, PLANET_ELEMENTS, planetPos, planetElements, moonGeo, orbitXYZ, poleBasis, spinAxes } from './astro.js';
import { DEG, RNG, TAU, clamp, cross, norm } from './util.js';

const MU_MOON = 4902.8 / (398600.4418 + 4902.8);

class Body {
  constructor(def) {
    Object.assign(this, def);
    this.def = def;
    const R = def.R;
    this.radii = R.length === 3 ? [R[0], R[1], R[2]] : [R[0], R[0], R[1]];
    this.Req = this.radii[0];
    this.Rmean = (this.radii[0] + this.radii[1] + this.radii[2]) / 3;
    this.Rmax = Math.max(...this.radii) * (1 + (def.shape ? def.shape.amp * 1.6 : 0));
    this.pos = [0, 0, 0];
    this.prev = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    this.children = [];
    this.toSun = [1, 0, 0];
    this.sunDist = 1;
    this.atmo = def.atmo || null;
    this.rings = def.rings || null;
    this.boundR = Math.max(this.Rmax, this.atmo ? this.Req + this.atmo.top : 0, this.rings ? this.rings.outer : 0);
    this.minAlt = this.atmo ? this.atmo.minAlt : Math.max(0.15, this.Rmean * 0.0025);
    this.tex = null;
  }
}

export class SolarSystem {
  constructor(jd) {
    this.jd = jd;
    this.bodies = BODIES.map((d) => new Body(d));
    this.byId = Object.fromEntries(this.bodies.map((b) => [b.id, b]));
    for (const b of this.bodies) {
      b.parentBody = b.parent ? this.byId[b.parent] : null;
      if (b.parentBody) b.parentBody.children.push(b);
    }
    this.sun = this.byId.sun;
    for (const b of this.bodies) this.prepare(b);
    // Spheres of influence decide which body's frame the camera rides in.
    for (const b of this.bodies) {
      if (!b.parentBody) { b.soi = Infinity; continue; }
      const p = b.parentBody;
      const a = b.orbit.helio ? b.orbit.a * AU : b.orbit.planet ? PLANET_ELEMENTS[b.orbit.planet][0] * AU : b.orbit.emb ? AU : b.orbit.lunar ? 384400 : b.orbit.a;
      b.soi = Math.max(a * Math.pow(b.gm / p.gm, 0.4), b.boundR * 3, b.Rmax * 8);
    }
    this.makeSwarm();
    this.update(jd);
    this.update(jd);
  }

  prepare(b) {
    const r = b.rot || {};
    if (r.ra !== undefined) b.pole = poleBasis(r.ra, r.dec);
    else if (r.elon !== undefined) {
      const lo = r.elon * DEG, la = r.elat * DEG;
      const z = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
      const n = norm(cross([0, 0, 1], z));
      b.pole = { z, n, q: cross(z, n) };
    }
    // spin axis by the right-hand rule (moons orbit prograde about it)
    if (b.pole) b.spin = (r.Wd || 0) < 0 ? b.pole.z.map((v) => -v) : b.pole.z;
    const o = b.orbit;
    if (o && o.a && !o.helio) {
      const p = b.parentBody;
      let zr = [0, 0, 1];
      if (o.plane !== 'ecliptic' && p.spin) zr = p.spin;
      let xr = cross([0, 0, 1], zr);
      xr = Math.hypot(...xr) < 1e-6 ? [1, 0, 0] : norm(xr);
      const yr = cross(zr, xr);
      b.ref = [xr, yr, zr];
      const gm = o.binaryOf ? p.gm + b.gm : p.gm + b.gm;
      b.n = Math.sqrt(gm / (o.a * o.a * o.a)) * 86400; // rad/day
    }
    if (o && o.helio) b.n = Math.sqrt((GM_SUN + b.gm) / Math.pow(o.a * AU, 3)) * 86400;
  }

  // Position of body b relative to its parent (or heliocentric for planets), at jd.
  relPos(b, jd, out) {
    const o = b.orbit;
    if (o.planet) return planetPos(o.planet, jd, out);
    if (o.emb) return planetPos('emb', jd, out);
    if (o.lunar) return moonGeo(jd, out);
    if (o.helio) {
      return orbitXYZ(o.a * AU, o.e, o.i * DEG, o.node * DEG, o.argp * DEG, o.M0 * DEG + b.n * (jd - (o.epoch || J2000)), out);
    }
    const t = [0, 0, 0];
    orbitXYZ(o.a, o.e, o.i * DEG, o.node * DEG, o.argp * DEG, o.M0 * DEG + b.n * (jd - J2000), t);
    const [x, y, z] = b.ref;
    out[0] = x[0] * t[0] + y[0] * t[1] + z[0] * t[2];
    out[1] = x[1] * t[0] + y[1] * t[1] + z[1] * t[2];
    out[2] = x[2] * t[0] + y[2] * t[1] + z[2] * t[2];
    return out;
  }

  update(jd) {
    const dJd = jd - this.jd;
    this.jd = jd;
    const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
    for (const b of this.bodies) { b.prev[0] = b.pos[0]; b.prev[1] = b.pos[1]; b.prev[2] = b.pos[2]; }
    // Planets and heliocentric small bodies first, then moons outward from their parents.
    const order = this.order || (this.order = this.bodies.slice().sort((a, b) => this.depth(a) - this.depth(b)));
    for (const b of order) {
      const o = b.orbit;
      if (!o) { b.pos[0] = b.pos[1] = b.pos[2] = 0; continue; }
      if (o.emb) continue;                  // set together with the Moon
      if (o.lunar) {
        planetPos('emb', jd, tmp);
        moonGeo(jd, tmp2);
        const e = this.byId.earth;
        for (let k = 0; k < 3; k++) { e.pos[k] = tmp[k] - MU_MOON * tmp2[k]; b.pos[k] = tmp[k] + (1 - MU_MOON) * tmp2[k]; }
        continue;
      }
      if (o.binary) {
        // Pluto system: the elements are for the barycentre; Pluto and Charon circle it.
        planetPos(o.planet, jd, tmp);
        const c = this.byId[o.binary];
        this.relPos(c, jd, tmp2);
        const f = c.gm / (c.gm + b.gm);
        b.bary = b.bary || [0, 0, 0];
        for (let k = 0; k < 3; k++) { b.bary[k] = tmp[k]; b.pos[k] = tmp[k] - f * tmp2[k]; c.pos[k] = tmp[k] + (1 - f) * tmp2[k]; }
        continue;
      }
      if (o.binaryOf) continue;
      this.relPos(b, jd, tmp);
      const p = b.parentBody;
      const c = p.bary || p.pos;
      for (let k = 0; k < 3; k++) b.pos[k] = (p.id === 'sun' ? 0 : c[k]) + tmp[k];
    }
    for (const b of this.bodies) {
      // velocity in km per simulated second (for display and frame changes)
      if (dJd !== 0) for (let k = 0; k < 3; k++) b.vel[k] = (b.pos[k] - b.prev[k]) / (dJd * 86400);
      const d = Math.hypot(b.pos[0], b.pos[1], b.pos[2]);
      b.sunDist = d || 1;
      if (d > 0) { b.toSun[0] = -b.pos[0] / d; b.toSun[1] = -b.pos[1] / d; b.toSun[2] = -b.pos[2] / d; }
      this.orient(b, jd);
    }
    this.updateSwarm(jd);
  }

  depth(b) { let d = 0; for (let p = b.parentBody; p; p = p.parentBody) d++; return d; }

  orient(b, jd) {
    const r = b.rot || {};
    const d = jd - J2000;
    if (r.locked || r.lockTo) {
      const other = r.lockTo ? this.byId[r.lockTo] : b.parentBody;
      let x = [other.pos[0] - b.pos[0], other.pos[1] - b.pos[1], other.pos[2] - b.pos[2]];
      x = norm(x);
      let z;
      if (r.lockTo) z = b.pole.z;
      else {
        // orbit normal from the relative motion over a short interval
        if (!b.orbNormal || Math.abs(jd - b.normalJd) > 0.25) {
          const a = [0, 0, 0], c = [0, 0, 0];
          if (b.orbit.lunar) { moonGeo(jd, a); moonGeo(jd + 0.01, c); }
          else { this.relPos(b, jd, a); this.relPos(b, jd + 0.01, c); }
          b.orbNormal = norm(cross(a, c));
          b.normalJd = jd;
        }
        z = b.orbNormal;
      }
      const y = norm(cross(z, x));
      const x2 = cross(y, z);
      b.axes[0] = x2; b.axes[1] = y; b.axes[2] = norm(z);
      return;
    }
    if (r.tumble) {
      const t = d / r.tumble;
      const ax = norm([Math.sin(t * 0.37 + 1), Math.cos(t * 0.23), 0.6 + 0.4 * Math.sin(t * 0.11)]);
      const pb = { z: ax, n: norm(cross([0, 0, 1], ax)) };
      pb.q = cross(pb.z, pb.n);
      spinAxes(pb, t * 360, b.axes);
      return;
    }
    if (b.pole) spinAxes(b.pole, (r.W0 || 0) + (r.Wd || 0) * d, b.axes);
  }

  // ---- small-body swarm ---------------------------------------------------------------------------
  makeSwarm() {
    const rng = new RNG(20261029);
    const list = [];
    const J = PLANET_ELEMENTS.jupiter, N = PLANET_ELEMENTS.neptune;
    const nJ = J[9] / 36525 * DEG, nN = N[9] / 36525 * DEG;               // rad/day (mean longitude rates)
    const lamJ = J[3] * DEG, lamN = N[3] * DEG;
    const push = (type, a, e, i, node, argp, M0, n) => list.push({ type, a, e, i, node, argp, M0, n: n || Math.sqrt(GM_SUN / Math.pow(a * AU, 3)) * 86400 });
    const gaps = [[2.502, 0.035], [2.825, 0.022], [2.958, 0.016], [3.279, 0.05], [2.065, 0.02]];
    let made = 0;
    while (made < 3600) {
      const a = 2.1 + Math.pow(rng.next(), 1.15) * 1.25;
      if (gaps.some(([g, w]) => Math.abs(a - g) < w * (0.6 + rng.next() * 0.6))) continue;
      const e = clamp(Math.abs(rng.gauss()) * 0.085, 0, 0.33);
      const i = Math.abs(rng.gauss()) * (rng.chance(0.15) ? 16 : 6.5);
      push(0, a, e, i * DEG, rng.next() * TAU, rng.next() * TAU, rng.next() * TAU);
      made++;
    }
    for (let k = 0; k < 90; k++) push(0, 1.78 + rng.next() * 0.22, rng.next() * 0.1, (16 + rng.next() * 14) * DEG, rng.next() * TAU, rng.next() * TAU, rng.next() * TAU);
    // Hildas: 3:2 resonance with Jupiter, aphelia toward L3, L4 and L5 (a triangle).
    const aH = J[0] * Math.pow(2 / 3, 2 / 3);
    for (let k = 0; k < 280; k++) {
      const lam = rng.next() * TAU, sigma = rng.gauss() * 0.35;
      const varpi = 3 * lamJ - 2 * lam - sigma;
      const node = rng.next() * TAU;
      push(1, aH, 0.12 + rng.next() * 0.16, Math.abs(rng.gauss()) * 6 * DEG, node, varpi - node, lam - varpi, 1.5 * nJ);
    }
    // Jupiter Trojans at L4 (ahead) and L5 (behind).
    for (let k = 0; k < 700; k++) {
      const lam = lamJ + (k % 2 ? 1 : -1) * 60 * DEG + rng.gauss() * 0.22;
      const varpi = rng.next() * TAU, node = rng.next() * TAU;
      push(2, J[0], Math.abs(rng.gauss()) * 0.06, Math.abs(rng.gauss()) * 12 * DEG, node, varpi - node, lam - varpi, nJ);
    }
    // Kuiper belt: cold classicals, hot classicals, plutinos (3:2 with Neptune) and scattered disc.
    for (let k = 0; k < 900; k++) {
      const hot = rng.chance(0.35);
      push(3, 42 + rng.next() * 5.5, rng.next() * 0.1, Math.abs(rng.gauss()) * (hot ? 14 : 2.5) * DEG, rng.next() * TAU, rng.next() * TAU, rng.next() * TAU);
    }
    const aP = N[0] * Math.pow(3 / 2, 2 / 3);
    for (let k = 0; k < 320; k++) {
      const lam = rng.next() * TAU, sigma = Math.PI + rng.gauss() * 0.6;
      const varpi = 3 * lam - 2 * lamN - sigma;
      const node = rng.next() * TAU;
      push(3, aP, 0.1 + rng.next() * 0.2, Math.abs(rng.gauss()) * 10 * DEG, node, varpi - node, lam - varpi, (2 / 3) * nN);
    }
    for (let k = 0; k < 180; k++) push(3, 50 + rng.next() * 60, 0.3 + rng.next() * 0.35, Math.abs(rng.gauss()) * 18 * DEG, rng.next() * TAU, rng.next() * TAU, rng.next() * TAU);
    const n = list.length;
    this.swarm = { n, list, pos: new Float64Array(n * 3), type: new Uint8Array(n), mag: new Float32Array(n), jd: -1 };
    list.forEach((s, k) => { this.swarm.type[k] = s.type; this.swarm.mag[k] = rng.next(); });
  }

  updateSwarm(jd) {
    const s = this.swarm;
    if (Math.abs(jd - s.jd) < 0.02) return;
    s.jd = jd;
    const out = [0, 0, 0], dt = jd - J2000;
    for (let k = 0; k < s.n; k++) {
      const o = s.list[k];
      orbitXYZ(o.a * AU, o.e, o.i, o.node, o.argp, o.M0 + o.n * dt, out);
      s.pos[k * 3] = out[0]; s.pos[k * 3 + 1] = out[1]; s.pos[k * 3 + 2] = out[2];
    }
  }

  // ---- queries ------------------------------------------------------------------------------------
  // Deepest body whose sphere of influence holds the heliocentric point p.
  frameFor(p) {
    let best = this.sun;
    const visit = (b) => {
      for (const c of b.children) {
        const d = Math.hypot(p[0] - c.pos[0], p[1] - c.pos[1], p[2] - c.pos[2]);
        if (d < c.soi) { best = c; visit(c); return; }
      }
    };
    visit(this.sun);
    return best;
  }

  // Body whose surface is closest to p, and the altitude above it.
  nearest(p) {
    let best = this.sun, alt = Infinity;
    for (const b of this.bodies) {
      const d = Math.hypot(p[0] - b.pos[0], p[1] - b.pos[1], p[2] - b.pos[2]) - b.Rmean;
      if (d < alt) { alt = d; best = b; }
    }
    return { body: best, alt };
  }

  // Sampled orbit of a body relative to its parent (km), for drawing.
  orbitPath(b, n = 256) {
    const pts = new Float64Array(n * 3), t = [0, 0, 0];
    const o = b.orbit;
    if (!o) return null;
    let period;
    if (o.planet || o.emb) {
      const el = planetElements(o.emb ? 'emb' : o.planet, this.jd);
      for (let k = 0; k < n; k++) { orbitXYZ(el.a, el.e, el.i, el.node, el.argp, (k / n) * TAU, t); pts.set(t, k * 3); }
      return pts;
    }
    if (o.lunar) period = 27.321661;
    else period = TAU / b.n;
    for (let k = 0; k < n; k++) {
      const jd = this.jd + (k / n - 0.5) * period;
      if (o.lunar) moonGeo(jd, t); else this.relPos(b, jd, t);
      pts.set(t, k * 3);
    }
    return pts;
  }

  // Bodies that can throw a shadow on b (its parent, its siblings and its own moons).
  occludersFor(b) {
    if (b.occ) return b.occ;
    const set = new Set();
    if (b.parentBody && b.parentBody.id !== 'sun') {
      set.add(b.parentBody);
      for (const s of b.parentBody.children) if (s !== b && s.Rmean > 60) set.add(s);
    }
    for (const c of b.children) if (c.Rmean > 60 || b.Rmean < 100) set.add(c);
    b.occ = [...set];
    return b.occ;
  }
}

