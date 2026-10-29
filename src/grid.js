// The character grid every view draws into. Colors are floats so lighting math can run
// past 1.0; pack() clamps everything into the two RGBA8 textures the GPU reads.

// Colours are stored at 1/HDR_RANGE scale so values up to HDR_RANGE survive into the tone mapper.
export const HDR_RANGE = 1.8;
const HDR = 255 / HDR_RANGE;

export class Grid {
  constructor() { this.cols = 0; this.rows = 0; }

  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    const n = cols * rows;
    this.ch = new Uint8Array(n);
    this.fg = new Float32Array(n * 3);
    this.bg = new Float32Array(n * 3);
    this.glow = new Float32Array(n);
    this.depth = new Float32Array(n);
    this.kind = new Uint8Array(n);      // 0 sky, 1 wall, 2 ground, 3 sprite, 4 ui
    this.tex0 = new Uint8ClampedArray(n * 4);
    this.tex1 = new Uint8ClampedArray(n * 4);
    this.clear();
  }

  clear() {
    this.ch.fill(32); this.fg.fill(0); this.bg.fill(0); this.glow.fill(0); this.depth.fill(Infinity); this.kind.fill(0);
  }

  set(x, y, ch, fr, fg, fb, br, bg, bb, glow = 0) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x, k = i * 3;
    this.ch[i] = ch;
    this.fg[k] = fr; this.fg[k + 1] = fg; this.fg[k + 2] = fb;
    this.bg[k] = br; this.bg[k + 1] = bg; this.bg[k + 2] = bb;
    this.glow[i] = glow;
  }

  // Overwrite only the glyph + foreground, keeping what is behind.
  glyph(x, y, ch, r, g, b, glow = 0) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x, k = i * 3;
    this.ch[i] = ch;
    this.fg[k] = r; this.fg[k + 1] = g; this.fg[k + 2] = b;
    if (glow > this.glow[i]) this.glow[i] = glow;
  }

  // Darken/tint the background of a rectangle (HUD panels).
  shade(x, y, w, h, r, g, b, a) {
    for (let yy = Math.max(0, y); yy < Math.min(this.rows, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.cols, x + w); xx++) {
        const i = yy * this.cols + xx, k = i * 3;
        this.bg[k] += (r - this.bg[k]) * a; this.bg[k + 1] += (g - this.bg[k + 1]) * a; this.bg[k + 2] += (b - this.bg[k + 2]) * a;
        this.fg[k] += (r - this.fg[k]) * a; this.fg[k + 1] += (g - this.fg[k + 1]) * a; this.fg[k + 2] += (b - this.fg[k + 2]) * a;
        this.glow[i] *= 1 - a;
      }
    }
  }

  text(x, y, s, r, g, b, glow = 0) {
    r *= 1.25; g *= 1.25; b *= 1.25;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c !== 32) this.glyph(x + i, y, c < 32 || c > 126 ? 63 : c, r, g, b, glow);
      else if (x + i >= 0 && x + i < this.cols && y >= 0 && y < this.rows) this.ch[y * this.cols + x + i] = 32;
    }
  }

  pack() {
    const n = this.cols * this.rows;
    const { ch, fg, bg, glow, tex0, tex1 } = this;
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) {
      tex0[j] = fg[k] * HDR; tex0[j + 1] = fg[k + 1] * HDR; tex0[j + 2] = fg[k + 2] * HDR;
      tex0[j + 3] = ch[i] - 32;
      tex1[j] = bg[k] * HDR; tex1[j + 1] = bg[k + 1] * HDR; tex1[j + 2] = bg[k + 2] * HDR;
      tex1[j + 3] = glow[i] * 255;
    }
  }
}
