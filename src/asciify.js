// Turns flat colour cells into characters. Every cell a renderer left as a plain block gets a glyph
// from a luminance ramp chosen by surface type (rock, ice, gas bands, ocean, cloud...); the colour
// moves into the glyph and the background drops back, so worlds read as text while keeping colour.

import { K } from './bodies.js';

const RAMPS = [];
RAMPS[K.ROCK] = ' .:-=+*#%@';
RAMPS[K.ICE] = ' .:;=+*#%';
RAMPS[K.GAS] = ' .-~=+#';
RAMPS[K.OCEAN] = ' .~~';
RAMPS[K.CLOUD] = ' .:;+*#%';
RAMPS[K.LAND] = ' .,:;+*#';
RAMPS[K.RING] = ' .:-=';
RAMPS[K.DUST] = ' ...:';
const GAIN = [];
GAIN[K.ROCK] = 1.0; GAIN[K.ICE] = 0.95; GAIN[K.GAS] = 1.0; GAIN[K.OCEAN] = 1.4; GAIN[K.CLOUD] = 0.95; GAIN[K.LAND] = 1.08; GAIN[K.RING] = 1.1; GAIN[K.DUST] = 1.7;

const codes = [];
for (let k = 0; k < 16; k++) codes[k] = RAMPS[k] ? [...RAMPS[k]].map((c) => c.charCodeAt(0)) : null;

export function asciify(g, strength = 1) {
  const { cols, rows, ch, fg, bg, kind, glow } = g;
  const n = cols * rows;
  for (let i = 0; i < n; i++) {
    if (ch[i] !== 32) continue;
    const k = kind[i];
    const ramp = codes[k];
    if (!ramp || glow[i] > 0.12) continue;
    const k3 = i * 3;
    const r = bg[k3], gg = bg[k3 + 1], b = bg[k3 + 2];
    const L = 0.299 * r + 0.587 * gg + 0.114 * b;
    const m = ramp.length;
    const t = Math.sqrt(L) * GAIN[k] * strength;
    let idx = Math.floor(t * m);
    if (idx <= 0) continue;
    if (idx >= m) idx = m - 1;
    ch[i] = ramp[idx];
    fg[k3] = r * 1.85 + 0.012; fg[k3 + 1] = gg * 1.85 + 0.012; fg[k3 + 2] = b * 1.85 + 0.015;
    bg[k3] = r * 0.6; bg[k3 + 1] = gg * 0.6; bg[k3 + 2] = b * 0.6;
  }
}
