// Synthesised sound (WebAudio, no samples): a deep space drone, the ship's drive rising with speed,
// a roar and crackle when the hull is heating in an atmosphere, autopilot swells and UI blips.

export class SpaceAudio {
  constructor() { this.ctx = null; this.on = false; }

  async start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    this.master = master;
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = 0.985 * b + 0.015 * (Math.random() * 2 - 1); d[i] = b * 6; }
    const loop = (gain) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.connect(gain); s.start(); return s; };
    // drone: two slow detuned sines and filtered rumble
    const drone = ctx.createGain(); drone.gain.value = 0.08; drone.connect(master);
    for (const f of [41.2, 61.7, 82.6]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = f < 50 ? 0.6 : 0.25;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + f * 0.0007;
      const lg = ctx.createGain(); lg.gain.value = 0.2; lfo.connect(lg); lg.connect(g.gain); lfo.start();
      o.connect(g); g.connect(drone); o.start();
    }
    // drive: filtered noise plus a low saw whose pitch follows speed
    this.drive = ctx.createGain(); this.drive.gain.value = 0; this.drive.connect(master);
    this.driveF = ctx.createBiquadFilter(); this.driveF.type = 'bandpass'; this.driveF.frequency.value = 300; this.driveF.Q.value = 0.8;
    this.driveF.connect(this.drive);
    const dn = ctx.createGain(); dn.gain.value = 0.5; dn.connect(this.driveF); loop(dn);
    this.saw = ctx.createOscillator(); this.saw.type = 'sawtooth'; this.saw.frequency.value = 50;
    const sg = ctx.createGain(); sg.gain.value = 0.05; this.saw.connect(sg); sg.connect(this.driveF); this.saw.start();
    // atmosphere: brown-noise roar
    this.roar = ctx.createGain(); this.roar.gain.value = 0; this.roar.connect(master);
    this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'lowpass'; this.roarF.frequency.value = 400; this.roarF.connect(this.roar);
    const rn = ctx.createGain(); rn.gain.value = 1; rn.connect(this.roarF); loop(rn);
    await ctx.resume();
    this.on = true;
  }

  async toggle() {
    if (!this.ctx) { await this.start(); return; }
    if (this.on) { await this.ctx.suspend(); this.on = false; } else { await this.ctx.resume(); this.on = true; }
  }

  blip(f = 880, dur = 0.06, vol = 0.12) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 2.5);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur * 3);
  }

  swell(up = true) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(up ? 110 : 440, t); o.frequency.exponentialRampToValueAtTime(up ? 440 : 165, t + 1.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 2.3);
  }

  update(ship) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = ship.speed;
    const lv = Math.min(1, Math.max(0, (Math.log10(sp + 1e-3) + 1) / 9));
    const moving = ship.auto || sp > 0.01 ? 1 : 0;
    this.drive.gain.setTargetAtTime(0.05 + 0.12 * lv * moving, t, 0.3);
    this.driveF.frequency.setTargetAtTime(160 + 900 * lv, t, 0.3);
    this.saw.frequency.setTargetAtTime(38 + 60 * lv, t, 0.3);
    const h = Math.min(1, ship.heat);
    this.roar.gain.setTargetAtTime(0.5 * h + 0.06 * ship.streak, t, 0.15);
    this.roarF.frequency.setTargetAtTime(250 + 1800 * h, t, 0.2);
  }
}
