// Boot, input, main loop.

import { GLRenderer } from './gl.js';
import { Grid } from './grid.js';
import { buildFont, waitForFont } from './font.js';
import { SolarSystem } from './system.js';
import { StarField } from './starfield.js';
import { Baker } from './textures.js';
import { View } from './render.js';
import { MapView } from './mapview.js';
import { Ship } from './ship.js';
import { Hud, TIME_RATES } from './hud.js';
import { SpaceAudio } from './audio.js';
import { asciify } from './asciify.js';
import { jdFromMs, formatDate } from './astro.js';
import { clamp, norm, add, mul, rotate, cross, DEG } from './util.js';

const WEIGHT = 600;
const PLANET_KEYS = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const LENSES = [[62, 'normal lens'], [22, 'telephoto lens'], [100, 'wide lens']];

async function main() {
  const canvas = document.getElementById('screen');
  let gl;
  try { gl = new GLRenderer(canvas); }
  catch (e) {
    document.getElementById('fallback').hidden = false;
    document.getElementById('fallback-msg').textContent = String(e.message || e);
    return;
  }
  await waitForFont(WEIGHT);
  const grid = new Grid();
  const sys = new SolarSystem(jdFromMs(Date.now()));
  const stars = new StarField();
  const baker = new Baker();
  const view = new View(stars, baker);
  const map = new MapView();
  const ship = new Ship(sys);
  const hud = new Hud();
  const audio = new SpaceAudio();
  const state = { mode: 'view', glyphs: true, bloom: true, orbits: false, rateIdx: 4, paused: false, lens: 0, font: null, layout: null, gain: 1 };
  let userScale = 1;
  try { userScale = parseFloat(localStorage.getItem('asciisolar.scale')) || 1; } catch { /* storage may be blocked */ }

  const layout = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.floor(window.innerWidth * dpr), H = Math.floor(window.innerHeight * dpr);
    canvas.width = W; canvas.height = H;
    const base = clamp(Math.round(window.innerHeight / 60), 9, 18);
    const px = clamp(Math.round(base * userScale), 6, 30);
    const font = buildFont(px, dpr, WEIGHT);
    gl.setAtlas(font);
    const cols = Math.max(20, Math.floor(W / font.cellW)), rows = Math.max(10, Math.floor(H / font.cellH));
    grid.resize(cols, rows);
    state.font = font;
    state.layout = { ox: Math.floor((W - cols * font.cellW) / 2), oy: Math.floor((H - rows * font.cellH) / 2) };
  };
  layout();
  let resizeT = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(layout, 120); });

  // ---- title cinematic: a slow orbit of Saturn ------------------------------------------------------
  const saturn = sys.byId.saturn;
  baker.now(saturn);
  let cineT = 0;
  const cinematic = (dt) => {
    cineT += dt;
    const z = saturn.axes[2], s = saturn.toSun;
    const e1 = norm(cross(z, s)), e2 = norm(cross(e1, z));
    const a = cineT * 0.035 + 0.6;
    const flat = add(mul(e2, Math.cos(a)), mul(e1, Math.sin(a)));
    const dir = norm(add(mul(flat, Math.cos(17 * DEG)), mul(z, Math.sin(17 * DEG) * Math.sign(z[0] * s[0] + z[1] * s[1] + z[2] * s[2] || 1))));
    ship.frame = saturn;
    ship.rel = mul(dir, 300000);
    ship.vel = [0, 0, 0];
    ship.lookAt(saturn.pos, true);
    // roll level with the rings, then tilt so Saturn sits below the title
    ship.up = norm(add(z, mul(ship.fwd, -(z[0] * ship.fwd[0] + z[1] * ship.fwd[1] + z[2] * ship.fwd[2]))));
    ship.orthonormalize();
    ship.fwd = norm(rotate(ship.fwd, ship.right, 13 * DEG));
    ship.orthonormalize();
    ship.updateWorld();
  };

  // ---- input ------------------------------------------------------------------------------------------
  const keys = new Set();
  const input = { fwd: 0, right: 0, up: 0, roll: 0, yaw: 0, pitch: 0, boost: false, brake: false, mouseX: 0, mouseY: 0 };
  let dragging = false, lastMX = 0, lastMY = 0;
  const setTarget = (b, quiet) => {
    if (!b) return;
    ship.target = b;
    if (!quiet) hud.toast(`Target: ${b.name}  (G to fly there, I for facts)`);
    audio.blip(660);
  };
  const go = () => {
    if (!ship.target) { hud.toast('Pick a target first: Tab, or 1-9 for the planets'); return; }
    ship.travelTo(ship.target);
    hud.toast(`Autopilot: heading for ${ship.target.name}`);
    audio.swell(true);
  };
  const startPlaying = () => {
    if (!hud.title) return false;
    hud.title = false;
    sys.update(jdFromMs(Date.now()));
    state.rateIdx = 2;
    const earth = sys.byId.earth;
    baker.now(earth);
    ship.placeAt(earth, 30000, 0.9, 0.22);
    ship.target = sys.byId.moon;
    audio.start().then(() => hud.toast(audio.on ? 'Sound on  (N to mute)' : '')).catch(() => {});
    hud.toast('Above Earth. Tab picks a destination, G flies you there. H for help.');
    return true;
  };
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (hud.title && k !== 'F5' && k !== 'F11' && k !== 'F12') { startPlaying(); e.preventDefault(); return; }
    if (k === 'Tab' || k === ' ' || k.startsWith('Arrow') || k === 'PageUp' || k === 'PageDown') e.preventDefault();
    // navigation list has the keyboard while open
    if (hud.nav) {
      if (k === 'ArrowUp' || k === 'w' || k === 'W') { hud.navMove(-1); audio.blip(520, 0.03, 0.05); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { hud.navMove(1); audio.blip(520, 0.03, 0.05); }
      else if (k === 'PageUp') for (let i = 0; i < 8; i++) hud.navMove(-1);
      else if (k === 'PageDown') for (let i = 0; i < 8; i++) hud.navMove(1);
      else if (k === 'Enter' || k === 'g' || k === 'G') { setTarget(hud.navSelected(), true); hud.nav = null; go(); }
      else if (k === ' ') { setTarget(hud.navSelected()); hud.nav = null; }
      else if (k === 'Escape' || k === 'Tab') hud.nav = null;
      return;
    }
    keys.add(e.code);
    if (k === 'Tab') hud.openNav(sys, ship);
    else if (k === 'h' || k === 'H' || k === '?') hud.showHelp = !hud.showHelp;
    else if (k === 'Escape') { hud.showHelp = false; hud.showInfo = false; }
    else if (k === 'm' || k === 'M') { state.mode = state.mode === 'view' ? 'map' : 'view'; if (state.mode === 'map' && document.pointerLockElement) document.exitPointerLock(); hud.toast(state.mode === 'map' ? 'System map  (M to return)' : 'Flight view'); }
    else if (k === 'g' || k === 'G') go();
    else if (k === 'c' || k === 'C') { if (ship.target) { ship.look = { p: ship.target, t: 0 }; } }
    else if (k === 'i' || k === 'I') hud.showInfo = !hud.showInfo;
    else if (k === 'o' || k === 'O') { state.orbits = !state.orbits; hud.toast(state.orbits ? 'Orbits shown' : 'Orbits hidden'); }
    else if (k === 'l' || k === 'L') { hud.labels = !hud.labels; hud.toast(hud.labels ? 'Labels on' : 'Labels off'); }
    else if (k === 'v' || k === 'V') { state.lens = (state.lens + 1) % LENSES.length; ship.fov = LENSES[state.lens][0] * DEG; hud.toast(LENSES[state.lens][1]); }
    else if (k === 'b' || k === 'B') { state.bloom = !state.bloom; hud.toast(state.bloom ? 'Glow on' : 'Glow off'); }
    else if (k === 'u' || k === 'U') { state.glyphs = !state.glyphs; hud.toast(state.glyphs ? 'Character shading on' : 'Character shading off (flat colour)'); }
    else if (k === 'p' || k === 'P') hud.showFps = !hud.showFps;
    else if (k === 'n' || k === 'N') audio.toggle().then(() => hud.toast(audio.on ? 'Sound on' : 'Sound off'));
    else if (k === 'k' || k === 'K') { state.paused = !state.paused; hud.toast(state.paused ? 'Clock paused' : 'Clock running'); }
    else if (k === ']' || k === '[') {
      state.paused = false;
      state.rateIdx = clamp(state.rateIdx + (k === ']' ? 1 : -1), 0, TIME_RATES.length - 1);
      hud.toast(`Time: ${TIME_RATES[state.rateIdx][1]}`);
    } else if (k === 't' || k === 'T') { state.rateIdx = 0; state.paused = false; hud.toast('Time: real time'); }
    else if (k === 'y' || k === 'Y') { sys.update(jdFromMs(Date.now())); hud.toast(`Back to now: ${formatDate(sys.jd)}`); }
    else if (k >= '0' && k <= '9') setTarget(sys.byId[PLANET_KEYS[+k]]);
    else if (k === '+' || k === '=' || k === '-' || k === '_') {
      userScale = clamp(userScale * (k === '-' || k === '_' ? 1 / 1.12 : 1.12), 0.45, 2.2);
      try { localStorage.setItem('asciisolar.scale', String(userScale)); } catch { /* ignore */ }
      layout();
    } else if (k === 'z' || k === 'Z') { if (state.mode === 'map') map.zoomBy(1.5); else throttle(1); }
    else if (k === 'x' || k === 'X') { if (state.mode === 'map') map.zoomBy(1 / 1.5); else throttle(-1); }
  });
  const throttle = (d) => {
    ship.speedK = clamp(ship.speedK * (d > 0 ? 1.3 : 1 / 1.3), 0.01, 20);
  };
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('mousedown', (e) => {
    if (startPlaying()) return;
    dragging = true; lastMX = e.clientX; lastMY = e.clientY;
    if (state.mode === 'view' && !document.pointerLockElement && canvas.requestPointerLock) {
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* not allowed here; drag to look instead */ }
    }
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    const k = ship.fov / (62 * DEG);
    if (document.pointerLockElement === canvas) { input.mouseX += e.movementX * 0.0022 * k; input.mouseY += e.movementY * 0.0022 * k; }
    else if (dragging) { input.mouseX += (e.clientX - lastMX) * 0.004 * k; input.mouseY += (e.clientY - lastMY) * 0.004 * k; lastMX = e.clientX; lastMY = e.clientY; }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (hud.nav) { hud.navMove(e.deltaY > 0 ? 1 : -1); return; }
    if (state.mode === 'map') map.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    else throttle(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  // touch: drag to look, hold still to fly forward, tap the top edge for the map
  let tStart = null;
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); if (startPlaying()) return; const t = e.touches[0]; tStart = { x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, moved: false, time: performance.now() }; }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (!tStart) return;
    input.mouseX += (t.clientX - tStart.lx) * 0.005; input.mouseY += (t.clientY - tStart.ly) * 0.005;
    tStart.lx = t.clientX; tStart.ly = t.clientY;
    if (Math.hypot(t.clientX - tStart.x, t.clientY - tStart.y) > 12) tStart.moved = true;
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (tStart && !tStart.moved && performance.now() - tStart.time < 250) {
      const y = e.changedTouches[0].clientY;
      if (y < 80) state.mode = state.mode === 'view' ? 'map' : 'view';
      else if (y > window.innerHeight - 80) { hud.openNav(sys, ship); }
    }
    tStart = null;
  }, { passive: false });

  const readInput = () => {
    const k = (c) => keys.has(c);
    input.fwd = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    input.right = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    input.up = (k('KeyR') ? 1 : 0) - (k('KeyF') ? 1 : 0);
    input.roll = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);
    input.yaw = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0);
    input.pitch = (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0);
    input.boost = k('ShiftLeft') || k('ShiftRight');
    input.brake = k('Space');
    if (tStart && !tStart.moved && performance.now() - tStart.time > 300) input.fwd = 1;
    if (hud.nav || state.mode === 'map') { input.fwd = input.right = input.up = 0; }
  };

  // ---- debug / automation hooks ---------------------------------------------------------------------
  window.__solar = {
    sys, ship, hud, view, map, state, baker, audio,
    start() { startPlaying(); },
    target(id) { setTarget(sys.byId[id], true); },
    go(id) { setTarget(sys.byId[id], true); go(); },
    // jump straight to a body: distance in km from its centre (default: autopilot standoff)
    tp(id, dist, side, elev) { const b = sys.byId[id]; baker.now(b); ship.placeAt(b, dist || ship.standoff(b), side ?? 0.6, elev ?? 0.25); ship.target = b; ship.auto = null; },
    look(x, y, z) { ship.lookAt([x, y, z], true); },
    // view body id from above body-fixed (lat, lon) at dist km from its centre, north up
    orbit(id, dist, lat, lon, tilt = 0) {
      const b = sys.byId[id]; baker.now(b);
      const ax = b.axes, la = lat * DEG, lo = lon * DEG;
      const d = [0, 1, 2].map((k) => ax[0][k] * Math.cos(la) * Math.cos(lo) + ax[1][k] * Math.cos(la) * Math.sin(lo) + ax[2][k] * Math.sin(la));
      ship.frame = b; ship.rel = mul(d, dist); ship.vel = [0, 0, 0]; ship.auto = null; ship.target = b;
      ship.fwd = mul(d, -1); ship.up = ax[2].slice(); ship.orthonormalize();
      if (tilt) { ship.fwd = norm(rotate(ship.fwd, ship.right, tilt * DEG)); ship.orthonormalize(); }
      ship.updateWorld();
    },
    lookAt(id) { ship.lookAt(sys.byId[id].pos, true); },
    turn(yaw, pitch) { input.mouseX += yaw; input.mouseY += pitch; },
    // sunlit view: dlon degrees from the sub-solar meridian; featLon (optional) spins time until that
    // body-fixed longitude faces the Sun (featDrift: its own drift in deg/day)
    sunside(id, dist, lat = 15, dlon = 0, featLon, featDrift = 0) {
      const b = sys.byId[id];
      const sub = () => { const s = b.toSun, ax = b.axes; return Math.atan2(s[0] * ax[1][0] + s[1] * ax[1][1] + s[2] * ax[1][2], s[0] * ax[0][0] + s[1] * ax[0][1] + s[2] * ax[0][2]) / DEG; };
      if (featLon !== undefined && b.rot && b.rot.Wd) {
        for (let k = 0; k < 6; k++) {
          const days = sys.jd - 2451545, f = featLon + featDrift * days;
          const d = ((sub() - f + 540) % 360) - 180;
          sys.update(sys.jd + d / (b.rot.Wd - featDrift));
        }
      }
      this.orbit(id, dist, lat, sub() + dlon);
    },
    jd(v) { sys.update(v); },
    rate(i) { state.rateIdx = i; },
    mode(m) { state.mode = m; },
    bakeAll() { for (const b of sys.bodies) if (b.kind !== 'star') baker.now(b); },
    perf: { frame: 0, sim: 0, render: 0 },
  };

  // Camera-style exposure: dim scenes (grazing polar light, the outer planets, twilight) are lifted
  // toward a comfortable brightness, within limits, so detail stays visible without faking daylight.
  const autoExposure = (dt) => {
    const { bg, kind } = grid, n = grid.cols * grid.rows;
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i += 3) {
      const k = kind[i];
      if (k === 0 || k === 4) continue;
      const j = i * 3;
      sum += 0.299 * bg[j] + 0.587 * bg[j + 1] + 0.114 * bg[j + 2]; cnt++;
    }
    let want = 1;
    if (cnt > n / 3 * 0.06) want = clamp(0.2 / Math.max(1e-4, sum / cnt), 0.75, 3.5);
    state.gain += (want - state.gain) * (1 - Math.exp(-dt * 1.5));
    const gn = state.gain;
    if (Math.abs(gn - 1) < 0.01) return;
    const { fg } = grid;
    for (let i = 0; i < n; i++) {
      if (kind[i] === 4 && grid.ch[i] !== 32) { /* limb glyphs scale too */ }
      const j = i * 3;
      bg[j] *= gn; bg[j + 1] *= gn; bg[j + 2] *= gn;
      fg[j] *= gn; fg[j + 1] *= gn; fg[j + 2] *= gn;
    }
  };

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
    last = now;
    readInput();
    const t0 = performance.now();
    const rate = hud.title ? 3600 : state.paused ? 0 : TIME_RATES[state.rateIdx][0];
    if (rate) sys.update(sys.jd + (dt * rate) / 86400);
    if (hud.title) cinematic(dt);
    else ship.update(dt, input);
    while (ship.messages.length) hud.toast(ship.messages.shift());
    input.mouseX = 0; input.mouseY = 0;
    baker.work(hud.title ? 10 : 5);
    const t1 = performance.now();
    if (state.mode === 'view' || hud.title) {
      // buffeting in thick air
      const sh = Math.min(1, ship.heat) * 0.006;
      const cam = { pos: ship.updateWorld(), fwd: ship.fwd, right: ship.right, up: ship.up, fov: ship.fov };
      if (sh > 0) {
        const j = (Math.random() - 0.5) * sh, q = (Math.random() - 0.5) * sh;
        cam.fwd = norm(add(add(ship.fwd, mul(ship.right, j)), mul(ship.up, q)));
        cam.right = norm(cross(cam.fwd, ship.up)); cam.up = cross(cam.right, cam.fwd);
      }
      const fx = { heat: ship.heat, streak: ship.streak, vel: ship.vel, streakCol: ship.atm ? (ship.atm.body.look.col) : [0.85, 0.85, 0.9] };
      view.render(grid, sys, cam, state.font, { orbits: state.orbits, target: ship.target, frame: ship.frame, fx: hud.title ? null : fx, dt, twinkle: ship.atm && ship.atm.rho > 0.01 ? 0.6 : 0, mwGain: 1 });
      autoExposure(dt);
    } else {
      map.render(grid, sys, ship, state.font, { dt });
    }
    if (state.glyphs) asciify(grid);
    const t2 = performance.now();
    const p = window.__solar.perf;
    p.sim = p.sim * 0.95 + (t1 - t0) * 0.05; p.render = p.render * 0.95 + (t2 - t1) * 0.05; p.frame++;
    hud.render(grid, sys, ship, view, hud.title ? 'title' : state.mode, dt, { rateIdx: state.rateIdx, paused: state.paused, audioOn: audio.on, perf: p });
    gl.draw(grid, state.layout, { bloom: state.bloom ? 0.55 : 0, vignette: 0.3, exposure: 1.6, saturation: 1.38 });
    audio.update(ship);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
