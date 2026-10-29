import { HDR_RANGE } from './grid.js';

// WebGL2 renderer for the character grid: one full-screen pass reads per-cell glyph/colour textures
// and the font atlas; an emissive pass feeds a two-level blur so lit windows, neon and headlights glow.

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS_GRID = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uT0; uniform sampler2D uT1; uniform sampler2D uAtlas;
uniform sampler2D uB1; uniform sampler2D uB2;
uniform vec2 uOrigin; uniform vec2 uCell; uniform ivec2 uGrid;
uniform float uCanvasH; uniform float uScale; uniform int uMode;
uniform float uBloom; uniform float uVig; uniform float uExposure; uniform float uRange; uniform float uSat;
in vec2 vUv; out vec4 o;
void main(){
  vec2 px = vec2(gl_FragCoord.x * uScale, uCanvasH - gl_FragCoord.y * uScale);
  vec2 g = (px - uOrigin) / uCell;
  ivec2 c = ivec2(floor(g));
  vec3 col = vec3(0.0); float glow = 0.0;
  if (c.x >= 0 && c.y >= 0 && c.x < uGrid.x && c.y < uGrid.y) {
    vec4 a = texelFetch(uT0, c, 0);
    vec4 b = texelFetch(uT1, c, 0);
    int gi = int(a.a * 255.0 + 0.5);
    ivec2 lp = ivec2(px - uOrigin) - c * ivec2(uCell);
    ivec2 ap = ivec2(gi % 16, gi / 16) * ivec2(uCell) + lp;
    float k = texelFetch(uAtlas, ap, 0).a;
    col = mix(b.rgb, a.rgb, k) * uRange;
    glow = b.a;
  }
  if (uMode == 1) { o = vec4(col * glow * 1.6, 1.0); return; }
  vec3 bl = texture(uB1, vUv).rgb * 0.8 + texture(uB2, vUv).rgb * 1.3;
  col = col + bl * uBloom;
  col = 1.0 - exp(-col * uExposure);
  float lm = dot(col, vec3(0.299, 0.587, 0.114));
  col = clamp(mix(vec3(lm), col, uSat), 0.0, 1.0);
  vec2 q = vUv - 0.5;
  col *= 1.0 - uVig * dot(q, q) * 1.5;
  o = vec4(col, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uDir;
in vec2 vUv; out vec4 o;
void main(){
  vec3 s = texture(uSrc, vUv).rgb * 0.2270270;
  s += (texture(uSrc, vUv + uDir * 1.3846153).rgb + texture(uSrc, vUv - uDir * 1.3846153).rgb) * 0.3162162;
  s += (texture(uSrc, vUv + uDir * 3.2307692).rgb + texture(uSrc, vUv - uDir * 3.2307692).rgb) * 0.0702702;
  o = vec4(s, 1.0);
}`;

const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel;
in vec2 vUv; out vec4 o;
void main(){
  vec3 s = texture(uSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture(uSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture(uSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  o = vec4(s * 0.25, 1.0);
}`;

export class GLRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('This browser does not support WebGL2.');
    this.gl = gl;
    this.canvas = canvas;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    this.pGrid = this.program(FS_GRID);
    this.pBlur = this.program(FS_BLUR);
    this.pDown = this.program(FS_DOWN);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const p of [this.pGrid, this.pBlur, this.pDown]) {
      const loc = gl.getAttribLocation(p.prog, 'aPos');
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    }
    gl.useProgram(this.pGrid.prog);
    gl.uniform1i(this.pGrid.u.uT0, 0); gl.uniform1i(this.pGrid.u.uT1, 1); gl.uniform1i(this.pGrid.u.uAtlas, 2);
    gl.uniform1i(this.pGrid.u.uB1, 3); gl.uniform1i(this.pGrid.u.uB2, 4);
    gl.useProgram(this.pBlur.prog); gl.uniform1i(this.pBlur.u.uSrc, 5);
    gl.useProgram(this.pDown.prog); gl.uniform1i(this.pDown.u.uSrc, 5);
    this.t0 = this.texture(gl.NEAREST); this.t1 = this.texture(gl.NEAREST); this.atlas = this.texture(gl.NEAREST);
    this.black = this.texture(gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.gridW = 0; this.gridH = 0; this.targetsFor = '';
  }

  program(fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(prog, i); u[info.name] = gl.getUniformLocation(prog, info.name); }
    return { prog, u };
  }

  texture(filter) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  target(w, h) {
    const gl = this.gl;
    const tex = this.texture(gl.LINEAR);
    if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && this.hdr) {
      this.hdr = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return this.target(w, h);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }

  ensureTargets() {
    const W = this.canvas.width, H = this.canvas.height;
    const key = W + 'x' + H;
    if (this.targetsFor === key) return;
    const gl = this.gl;
    for (const t of [this.E, this.Q1, this.Q2, this.O1, this.O2]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    this.E = this.target(Math.max(1, Math.ceil(W / 2)), Math.max(1, Math.ceil(H / 2)));
    this.Q1 = this.target(Math.max(1, Math.ceil(W / 4)), Math.max(1, Math.ceil(H / 4)));
    this.Q2 = this.target(this.Q1.w, this.Q1.h);
    this.O1 = this.target(Math.max(1, Math.ceil(W / 8)), Math.max(1, Math.ceil(H / 8)));
    this.O2 = this.target(this.O1.w, this.O1.h);
    this.targetsFor = key;
  }

  setAtlas(font) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, font.canvas);
    this.font = font;
  }

  upload(grid) {
    const gl = this.gl;
    const a = new Uint8Array(grid.tex0.buffer), b = new Uint8Array(grid.tex1.buffer);
    if (grid.cols !== this.gridW || grid.rows !== this.gridH) {
      gl.bindTexture(gl.TEXTURE_2D, this.t0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, grid.cols, grid.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, a);
      gl.bindTexture(gl.TEXTURE_2D, this.t1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, grid.cols, grid.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, b);
      this.gridW = grid.cols; this.gridH = grid.rows;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.t0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grid.cols, grid.rows, gl.RGBA, gl.UNSIGNED_BYTE, a);
      gl.bindTexture(gl.TEXTURE_2D, this.t1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grid.cols, grid.rows, gl.RGBA, gl.UNSIGNED_BYTE, b);
    }
  }

  pass(p, target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.useProgram(p.prog);
  }

  bind(unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  blur(src, tmp) {
    const gl = this.gl;
    this.pass(this.pBlur, tmp); this.bind(5, src.tex);
    gl.uniform2f(this.pBlur.u.uDir, 1 / src.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.pass(this.pBlur, src); this.bind(5, tmp.tex);
    gl.uniform2f(this.pBlur.u.uDir, 0, 1 / src.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  down(src, dst) {
    const gl = this.gl;
    this.pass(this.pDown, dst); this.bind(5, src.tex);
    gl.uniform2f(this.pDown.u.uTexel, 1 / src.w, 1 / src.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // layout: { ox, oy } grid origin in device pixels.
  draw(grid, layout, { bloom = 0.9, vignette = 0.35, exposure = 1, saturation = 1 } = {}) {
    const gl = this.gl, f = this.font;
    grid.pack();
    this.upload(grid);
    gl.bindVertexArray(this.vao);
    this.ensureTargets();
    this.bind(3, this.black); this.bind(4, this.black);
    this.bind(0, this.t0); this.bind(1, this.t1); this.bind(2, this.atlas);
    const setGrid = (scale, mode) => {
      const u = this.pGrid.u;
      gl.uniform2f(u.uOrigin, layout.ox, layout.oy);
      gl.uniform2f(u.uCell, f.cellW, f.cellH);
      gl.uniform2i(u.uGrid, grid.cols, grid.rows);
      gl.uniform1f(u.uCanvasH, this.canvas.height);
      gl.uniform1f(u.uScale, scale);
      gl.uniform1i(u.uMode, mode);
      gl.uniform1f(u.uRange, HDR_RANGE);
    };
    if (bloom > 0) {
      this.pass(this.pGrid, this.E);
      setGrid(this.canvas.width / this.E.w, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.down(this.E, this.Q1); this.blur(this.Q1, this.Q2);
      this.down(this.Q1, this.O1); this.blur(this.O1, this.O2);
      this.blur(this.O1, this.O2);
    }
    this.pass(this.pGrid, null);
    this.bind(0, this.t0); this.bind(1, this.t1); this.bind(2, this.atlas);
    this.bind(3, bloom > 0 ? this.Q1.tex : this.black);
    this.bind(4, bloom > 0 ? this.O1.tex : this.black);
    setGrid(1, 0);
    gl.uniform1f(this.pGrid.u.uBloom, bloom);
    gl.uniform1f(this.pGrid.u.uVig, vignette);
    gl.uniform1f(this.pGrid.u.uExposure, exposure);
    gl.uniform1f(this.pGrid.u.uSat, saturation);
    gl.uniform1f(this.pGrid.u.uRange, HDR_RANGE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
