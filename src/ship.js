// The camera ship. Position is kept relative to the body whose sphere of influence you are in, so you
// ride along with planets and moons as they orbit. Speed scales with the distance to the nearest
// surface (you can cross the Solar System in seconds and still creep along a ring), the autopilot flies
// you to any body and parks you on its sunlit side, and atmospheres push back with heat and buffeting.

import { AU, C_KMS } from './astro.js';
import { clamp, cross, norm, rotate, dot, sub, add, mul, len, smoothstep, fmtDist } from './util.js';

const MAX_SPEED = 3000 * C_KMS;

export class Ship {
  constructor(sys) {
    this.sys = sys;
    this.frame = sys.byId.earth;
    this.rel = [0, -40000, 8000];
    this.vel = [0, 0, 0];
    this.fwd = [0, 1, 0]; this.up = [0, 0, 1]; this.right = [1, 0, 0];
    this.speedK = 0.5;
    this.target = null;
    this.auto = null;
    this.look = null;
    this.heat = 0;
    this.streak = 0;
    this.messages = [];
    this.world = [0, 0, 0];
    this.speed = 0;
    this.alt = Infinity; this.altBody = null;
    this.atm = null;
    this.fov = 62 * Math.PI / 180;
    this.ringSide = 0;
    this.updateWorld();
  }

  updateWorld() {
    const f = this.frame.pos;
    this.world[0] = f[0] + this.rel[0]; this.world[1] = f[1] + this.rel[1]; this.world[2] = f[2] + this.rel[2];
    return this.world;
  }

  setFrame(b) {
    if (b === this.frame) return;
    const w = this.updateWorld();
    this.rel = [w[0] - b.pos[0], w[1] - b.pos[1], w[2] - b.pos[2]];
    this.frame = b;
  }

  // Place the camera at `dist` from body b, on its sunlit side, looking at it.
  placeAt(b, dist, side = 0.6, elev = 0.25) {
    const s = b.toSun;
    let e = norm(cross(s, [0, 0, 1]));
    if (!isFinite(e[0])) e = [1, 0, 0];
    const dir = norm(add(add(mul(s, Math.cos(side)), mul(e, Math.sin(side))), [0, 0, elev]));
    this.frame = b;
    this.rel = mul(dir, dist);
    this.vel = [0, 0, 0];
    this.updateWorld();
    this.lookAt(b.pos, true);
  }

  lookAt(p, now) {
    const w = this.updateWorld();
    const d = norm(sub(p, w));
    if (now) {
      this.fwd = d;
      let r = cross(d, [0, 0, 1]);
      if (len(r) < 1e-6) r = [1, 0, 0];
      this.right = norm(r);
      this.up = cross(this.right, this.fwd);
    } else this.look = { p, t: 0 };
  }

  turnToward(dir, rate) {
    const c = clamp(dot(this.fwd, dir), -1, 1);
    const ang = Math.acos(c);
    if (ang < 1e-5) return true;
    let ax = cross(this.fwd, dir);
    if (len(ax) < 1e-9) ax = this.up;
    ax = norm(ax);
    const step = Math.min(ang, Math.max(ang * rate, 0.002));
    this.fwd = norm(rotate(this.fwd, ax, step));
    this.up = norm(rotate(this.up, ax, step));
    this.orthonormalize();
    return ang < 0.01;
  }

  orthonormalize() {
    this.fwd = norm(this.fwd);
    this.right = norm(cross(this.fwd, this.up));
    this.up = norm(cross(this.right, this.fwd));
  }

  // Distance at which the autopilot parks next to body b.
  standoff(b) {
    if (b.kind === 'star') return b.Req * 14;
    if (b.rings && b.rings.main) return b.rings.outer * 2.1;
    const base = b.atmo ? b.Req + b.atmo.top : b.Rmax;
    if (b.kind === 'planet') return base * 3.4;
    return Math.max(base * 3.6, 8);
  }

  travelTo(b) {
    if (!b) return;
    const w = this.updateWorld();
    const toCam = norm(sub(w, b.pos));
    let side = norm(add(mul(toCam, 0.5), mul(b.toSun, 0.85)));
    side = norm(add(side, [0, 0, 0.18]));
    if (b.kind === 'star') side = toCam;
    this.auto = { target: b, side, t: 0, dist0: len(sub(b.pos, w)), wp: null };
    this.target = b;
    this.look = null;
  }

  cancelAuto(msg) {
    if (!this.auto) return;
    this.auto = null;
    if (msg) this.messages.push(msg);
  }

  // Nearest surface (km above it), counting a ring plane as a surface when you are over the rings.
  proximity() {
    const w = this.world;
    let best = Infinity, body = null;
    for (const b of this.sys.bodies) {
      const dx = w[0] - b.pos[0], dy = w[1] - b.pos[1], dz = w[2] - b.pos[2];
      const d = Math.hypot(dx, dy, dz);
      const s = this.surfaceR(b, dx, dy, dz, d);
      const alt = d - s;
      if (alt < best) { best = alt; body = b; }
      if (b.rings && d < b.rings.outer * 1.1) {
        const z = dx * b.axes[2][0] + dy * b.axes[2][1] + dz * b.axes[2][2];
        const rr = Math.sqrt(Math.max(0, d * d - z * z));
        if (rr > b.rings.inner && rr < b.rings.outer) best = Math.min(best, Math.max(Math.abs(z), 2));
      }
    }
    this.alt = best; this.altBody = body;
    return best;
  }

  // Radius of b's surface (cloud tops for giants) in the direction (dx, dy, dz) from its centre.
  surfaceR(b, dx, dy, dz, d) {
    const ax = b.axes;
    const x = (dx * ax[0][0] + dy * ax[0][1] + dz * ax[0][2]) / d, y = (dx * ax[1][0] + dy * ax[1][1] + dz * ax[1][2]) / d, z = (dx * ax[2][0] + dy * ax[2][1] + dz * ax[2][2]) / d;
    const r = b.radii;
    let s = 1 / Math.sqrt((x * x) / (r[0] * r[0]) + (y * y) / (r[1] * r[1]) + (z * z) / (r[2] * r[2]));
    if (b.shape) s *= 1 + b.shape.amp * 1.3;
    return s;
  }

  update(dt, input) {
    const sys = this.sys;
    this.updateWorld();
    const fr = sys.frameFor(this.world);
    if (fr !== this.frame) this.setFrame(fr);
    this.updateWorld();
    // --- turning
    const look = 1;
    if (input.mouseX || input.mouseY || input.yaw || input.pitch || input.roll) {
      if (this.auto && (input.mouseX || input.mouseY || input.yaw || input.pitch) && this.auto.t > 0.5) this.autoLook = false;
      const yaw = -(input.mouseX * look) - input.yaw * dt * 1.4, pitch = -(input.mouseY * look) + input.pitch * dt * 1.1;
      if (yaw) { this.fwd = rotate(this.fwd, this.up, yaw); }
      if (pitch) { this.fwd = rotate(this.fwd, this.right, pitch); this.up = rotate(this.up, this.right, pitch); }
      if (input.roll) { this.up = rotate(this.up, this.fwd, input.roll * dt * 1.6); }
      this.orthonormalize();
      this.look = null;
    }
    const prox = this.proximity();
    // --- autopilot
    if (this.auto) {
      if (input.fwd || input.right || input.up) this.cancelAuto('Autopilot off');
      else this.fly(dt);
    }
    if (!this.auto) {
      const D = Math.max(prox, 0.05);
      let sp = clamp(this.speedK * D, 0.02, MAX_SPEED);
      if (input.boost) sp = Math.min(MAX_SPEED, sp * 6);
      const want = [
        (this.fwd[0] * input.fwd + this.right[0] * input.right + this.up[0] * input.up) * sp,
        (this.fwd[1] * input.fwd + this.right[1] * input.right + this.up[1] * input.up) * sp,
        (this.fwd[2] * input.fwd + this.right[2] * input.right + this.up[2] * input.up) * sp,
      ];
      const k = 1 - Math.exp(-dt * (input.brake ? 9 : 3.2));
      for (let i = 0; i < 3; i++) this.vel[i] += (want[i] - this.vel[i]) * k;
      // never faster than the proximity limit allows (so you cannot plough into a planet)
      const v = len(this.vel), lim = Math.max(sp, this.speedK * D * 6 * (input.boost ? 6 : 1));
      if (v > lim) this.vel = mul(this.vel, lim / v);
      for (let i = 0; i < 3; i++) this.rel[i] += this.vel[i] * dt;
      if (this.look) {
        this.look.t += dt;
        const d = norm(sub(this.look.p.pos || this.look.p, this.updateWorld()));
        if (this.turnToward(d, 1 - Math.exp(-dt * 5)) || this.look.t > 3) this.look = null;
      }
    }
    this.collide();
    this.updateWorld();
    this.speed = len(this.vel);
    this.atmosphereFx(dt);
    this.ringCrossing();
  }

  fly(dt) {
    const a = this.auto, b = a.target;
    a.t += dt;
    const w = this.updateWorld();
    const sOff = this.standoff(b);
    const goal = add(b.pos, mul(a.side, sOff));
    let aim = goal;
    // steer around the target (and the Sun) instead of through them
    const obstacles = [b, this.sys.sun];
    for (const o of obstacles) {
      const seg = sub(aim, w), sl = len(seg);
      if (sl < 1) continue;
      const u = mul(seg, 1 / sl);
      const oc = sub(o.pos, w);
      const tca = dot(oc, u);
      if (tca <= 0 || tca >= sl) continue;
      const closest = sub(oc, mul(u, tca));
      const dmin = len(closest);
      const safe = (o.kind === 'star' ? o.Req * 4 : o.boundR * 1.3);
      if (dmin < safe) {
        const away = dmin > 1e-6 ? mul(closest, -1 / dmin) : norm(cross(u, [0, 0, 1]));
        aim = add(o.pos, mul(away, safe * 1.6));
        break;
      }
    }
    const v = sub(aim, w), dist = len(v);
    const total = len(sub(goal, w));
    const ease = smoothstep(0, 1.4, a.t);
    let sp = Math.max(total * 1.35, 0.4) * (0.08 + 0.92 * ease);
    sp = Math.min(sp, MAX_SPEED * 0.5);
    const step = Math.min(dist, sp * dt);
    const u = dist > 0 ? mul(v, 1 / dist) : [0, 0, 0];
    for (let i = 0; i < 3; i++) this.rel[i] += u[i] * step;
    this.vel = mul(u, step / Math.max(dt, 1e-6));
    if (this.autoLook !== false) this.turnToward(norm(sub(b.pos, this.updateWorld())), 1 - Math.exp(-dt * 2.6));
    if (total < Math.max(0.02 * sOff, 0.3) || (total < sOff * 0.08 && a.t > 40)) {
      this.auto = null;
      this.autoLook = true;
      this.vel = [0, 0, 0];
      this.messages.push(`Arrived at ${b.name}: ${fmtDist(len(sub(b.pos, this.updateWorld())) - b.Req)} above the ${b.atmo && (b.look.ramp === 3 || b.look.ramp === 6) ? 'cloud tops' : 'surface'}`);
      this.look = { p: b, t: 0 };
    }
  }

  collide() {
    for (const b of [this.frame, ...this.frame.children, this.frame.parentBody].filter(Boolean)) {
      const w = this.updateWorld();
      const dx = w[0] - b.pos[0], dy = w[1] - b.pos[1], dz = w[2] - b.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > b.Rmax * 2 + b.minAlt * 2) continue;
      const s = this.surfaceR(b, dx, dy, dz, d) + b.minAlt;
      if (d < s) {
        const n = [dx / d, dy / d, dz / d];
        const push = s - d;
        for (let i = 0; i < 3; i++) this.rel[i] += n[i] * push;
        const vn = dot(this.vel, n);
        if (vn < 0) this.vel = sub(this.vel, mul(n, vn * 1.1));
        if (!this.floorT || performance.now() - this.floorT > 4000) {
          this.messages.push(b.atmo ? `Holding at ${Math.round(b.minAlt)} km: the ${b.name} atmosphere is too thick to go deeper` : `Surface proximity: holding ${fmtDist(b.minAlt)} above ${b.name}`);
          this.floorT = performance.now();
        }
      }
    }
  }

  atmosphereFx(dt) {
    let heat = 0, streak = 0, info = null;
    const w = this.world;
    for (const b of [this.frame, this.frame.parentBody].filter(Boolean)) {
      if (!b.atmo) continue;
      const dx = w[0] - b.pos[0], dy = w[1] - b.pos[1], dz = w[2] - b.pos[2];
      const d = Math.hypot(dx, dy, dz);
      const h = d - this.surfaceR(b, dx, dy, dz, d);
      if (h > b.atmo.top * 1.5) continue;
      const c0 = b.atmo.comps[0];
      const rho = Math.exp(-h / c0.H);
      const v = this.speed;
      heat = clamp(rho * Math.pow(v / 4, 3) * 0.3, 0, 1.3);
      streak = clamp(rho * 40, 0, 1) * (v > 0.2 ? 1 : 0);
      info = { body: b, h, P: b.atmo.P0 * rho, rho };
    }
    // ring plane: ice motes streaming past
    for (const b of [this.frame, this.frame.parentBody].filter(Boolean)) {
      if (!b.rings || !b.rings.main) continue;
      const dx = w[0] - b.pos[0], dy = w[1] - b.pos[1], dz = w[2] - b.pos[2];
      const z = dx * b.axes[2][0] + dy * b.axes[2][1] + dz * b.axes[2][2];
      const rr = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - z * z));
      if (rr > 74000 && rr < 141000) streak = Math.max(streak, clamp(1 - Math.abs(z) / 400, 0, 1));
    }
    this.atm = info;
    this.heat += (heat - this.heat) * (1 - Math.exp(-dt * 2.5));
    this.streak += (streak - this.streak) * (1 - Math.exp(-dt * 3));
  }

  ringCrossing() {
    const w = this.world;
    for (const b of [this.frame, this.frame.parentBody].filter(Boolean)) {
      if (!b.rings || !b.rings.main) continue;
      const dx = w[0] - b.pos[0], dy = w[1] - b.pos[1], dz = w[2] - b.pos[2];
      const z = dx * b.axes[2][0] + dy * b.axes[2][1] + dz * b.axes[2][2];
      const rr = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - z * z));
      const side = Math.sign(z);
      if (this.ringSide && side !== this.ringSide && rr > 66900 && rr < 141000) {
        const name = rr < 74500 ? 'D ring' : rr < 92000 ? 'C ring' : rr < 117580 ? 'B ring' : rr < 122170 ? 'Cassini Division' : rr < 136800 ? (Math.abs(rr - 133583) < 200 ? 'Encke Gap' : 'A ring') : 'F ring';
        this.messages.push(`Crossing the ${name}, ${Math.round(rr).toLocaleString('en-US')} km from Saturn`);
      }
      this.ringSide = side;
      return;
    }
    this.ringSide = 0;
  }

  // Short description of where the camera is.
  region() {
    const sys = this.sys, w = this.world;
    const r = Math.hypot(w[0], w[1], w[2]) / AU;
    const f = this.frame;
    if (this.atm && this.atm.h < this.atm.body.atmo.top) return { title: `UPPER ATMOSPHERE OF ${this.atm.body.name.toUpperCase()}`, sub: this.atm.body.atmo.label };
    if (f.kind !== 'star') {
      const sysName = f.kind === 'moon' ? `${f.name}, ${f.parentBody.name} system` : f.children.length ? `${f.name} system` : f.name;
      return { title: `NEAR ${f.name.toUpperCase()}`, sub: sysName };
    }
    let zone = 'interplanetary space';
    if (r < 0.3) zone = 'close to the Sun';
    else if (r < 1.8) zone = 'inner Solar System';
    else if (r < 2.1) zone = 'inner edge of the asteroid belt';
    else if (r < 3.3) zone = 'main asteroid belt';
    else if (r < 3.7) zone = 'outer asteroid belt';
    else if (r < 4.3) zone = 'Hilda asteroids';
    else if (r < 6) {
      const j = sys.byId.jupiter.pos;
      const a = Math.atan2(w[1], w[0]) - Math.atan2(j[1], j[0]);
      const da = ((a / Math.PI * 180) + 540) % 360 - 180;
      zone = Math.abs(Math.abs(da) - 60) < 25 ? (da > 0 ? 'Jupiter Trojans (L4, the Greek camp)' : 'Jupiter Trojans (L5, the Trojan camp)') : 'near Jupiter\'s orbit';
    } else if (r < 29) zone = 'outer Solar System';
    else if (r < 50) zone = 'Kuiper belt';
    else if (r < 120) zone = 'scattered disc';
    else zone = 'beyond the heliopause';
    return { title: 'HELIOCENTRIC SPACE', sub: `${r.toFixed(r < 10 ? 2 : 1)} AU from the Sun, ${zone}` };
  }
}
