import { ColorList } from './types.ts';

export type Defines = Record<string, number | false>;

// ── CPU-side color math (mirrors GLSL conversions) ──────────────────────────

function _srgbToLinear(c: number): number {
  return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
}

function _linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function _toe(x: number): number {
  const k1 = 0.206,
    k2 = 0.03,
    k3 = (1 + k1) / (1 + k2);
  return 0.5 * (k3 * x - k1 + Math.sqrt((k3 * x - k1) ** 2 + 4 * k2 * k3 * x));
}

function _labF(t: number): number {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

function _xyzToLab(
  x: number,
  y: number,
  z: number,
  wx: number,
  wy: number,
  wz: number,
): [number, number, number] {
  const fx = _labF(x / wx);
  const fy = _labF(y / wy);
  const fz = _labF(z / wz);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function _srgbToCielabD65(r: number, g: number, b: number): [number, number, number] {
  const lr = _srgbToLinear(r),
    lg = _srgbToLinear(g),
    lb = _srgbToLinear(b);
  return _xyzToLab(
    0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb,
    0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb,
    0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb,
    0.95047,
    1.0,
    1.08883,
  );
}

function _srgbToCielabD50(r: number, g: number, b: number): [number, number, number] {
  const lr = _srgbToLinear(r),
    lg = _srgbToLinear(g),
    lb = _srgbToLinear(b);
  return _xyzToLab(
    0.4360747 * lr + 0.3850649 * lg + 0.1430804 * lb,
    0.2225045 * lr + 0.7168786 * lg + 0.0606169 * lb,
    0.0139322 * lr + 0.0971045 * lg + 0.7141733 * lb,
    0.96422,
    1.0,
    0.82521,
  );
}

const CAM16_D65 = {
  Sc: 0.59,
  SN_c: 0.9,
  D_R: 1.0187728717648556,
  D_G: 0.9878630004321435,
  D_B: 0.941466578136544,
  F_L: 0.2731305366732074,
  n: 0.2,
  z: 1.9272135954999579,
  N_bb: 1.0003040045593807,
  N_cb: 1.0003040045593807,
  A_w: 25.510345681082327,
} as const;

function _xyzToCam16ucsD65(x: number, y: number, z: number): [number, number, number] {
  const R = 0.401288 * x + 0.650173 * y - 0.051461 * z;
  const G = -0.250268 * x + 1.204414 * y + 0.045854 * z;
  const B = -0.002079 * x + 0.048952 * y + 0.953127 * z;

  const R_c = R * CAM16_D65.D_R;
  const G_c = G * CAM16_D65.D_G;
  const B_c = B * CAM16_D65.D_B;

  const adapt = (value: number): number => {
    const base = (CAM16_D65.F_L * Math.abs(value)) / 100;
    const power = base ** 0.42;
    return (400 * Math.sign(value) * power) / (power + 27.13) + 0.1;
  };

  const R_a = adapt(R_c);
  const G_a = adapt(G_c);
  const B_a = adapt(B_c);

  const a = R_a - (12 * G_a) / 11 + B_a / 11;
  const b = (R_a + G_a - 2 * B_a) / 9;

  let h = (Math.atan2(b, a) / (2 * Math.PI)) % 1;
  if (h < 0) h += 1;
  h *= 360;
  const hh = h < 20.14 ? h + 360 : h;

  const e_t = 0.25 * (Math.cos((hh / 180) * Math.PI + 2) + 3.8);
  const A = CAM16_D65.N_bb * (2 * R_a + G_a + 0.05 * B_a - 0.305);
  const J = 100 * Math.max(A / CAM16_D65.A_w, 0) ** (CAM16_D65.Sc * CAM16_D65.z);
  const denom = R_a + G_a + (21 / 20) * B_a;
  const t =
    denom === 0
      ? 0
      : ((50000 / 13) * CAM16_D65.SN_c * CAM16_D65.N_cb * e_t * Math.hypot(a, b)) / denom;
  const C =
    Math.max(t, 0) ** 0.9 * Math.sqrt(Math.max(J, 0) / 100) * (1.64 - 0.29 ** CAM16_D65.n) ** 0.73;
  const M = C * CAM16_D65.F_L ** 0.25;
  const Jp = (J * 1.7) / (1 + 0.007 * J);
  const Mp = Math.log(1 + 0.0228 * M) / 0.0228;
  const hRad = (h / 180) * Math.PI;
  return [Jp, Mp * Math.cos(hRad), Mp * Math.sin(hRad)];
}

function _srgbToCam16ucsD65(r: number, g: number, b: number): [number, number, number] {
  const lr = _srgbToLinear(r);
  const lg = _srgbToLinear(g);
  const lb = _srgbToLinear(b);
  return _xyzToCam16ucsD65(
    (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) * 100,
    (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) * 100,
    (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) * 100,
  );
}

/** Pre-convert palette to the colour space used by DISTANCE_METRIC on CPU.
 *  Returns RGBA Float32Array (1×N) suitable for upload as a texture. */
export function computeMetricPalette(palette: ColorList, metricCode: number): Float32Array {
  const n = palette.length;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = palette[i];
    let c: [number, number, number];
    switch (metricCode) {
      case 1:
      case 8:
      case 9: {
        // oklab, okLightness, liMatch
        c = _linearToOklab(_srgbToLinear(r), _srgbToLinear(g), _srgbToLinear(b));
        break;
      }
      case 6: {
        // oklrab
        const lab = _linearToOklab(_srgbToLinear(r), _srgbToLinear(g), _srgbToLinear(b));
        c = [_toe(lab[0]), lab[1], lab[2]];
        break;
      }
      case 2:
      case 3:
      case 5: // deltaE76, deltaE2000, deltaE94
        c = _srgbToCielabD65(r, g, b);
        break;
      case 7: // cielabD50
        c = _srgbToCielabD50(r, g, b);
        break;
      case 10: // cam16ucsD65
        c = _srgbToCam16ucsD65(r, g, b);
        break;
      default: // 0 (rgb), 4 (kotsarenkoRamos)
        c = [r, g, b];
    }
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = 1.0;
  }
  return out;
}

export function uploadMetricTexture(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  data: Float32Array,
  count: number,
): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, count, 1, 0, gl.RGBA, gl.FLOAT, data);
}

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return shader;
}

export function buildProgram(
  gl: WebGL2RenderingContext,
  defines: Defines,
  fragSrc: string,
  vertSrc: string,
): WebGLProgram {
  // #version 300 es must be the very first line — prepend it before defines.
  const defineStr =
    Object.entries(defines)
      .filter(([, v]) => v !== false)
      .map(([k, v]) => `#define ${k} ${v}`)
      .join('\n') + '\n';
  const prefix = '#version 300 es\n' + defineStr;

  const vert = compileShader(gl, gl.VERTEX_SHADER, prefix + vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, prefix + fragSrc);

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error:\n${log}`);
  }
  return prog;
}

export function initTexture(gl: WebGL2RenderingContext, tex: WebGLTexture): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function uploadPaletteTexture(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  palette: ColorList,
): void {
  if (palette.length === 0) throw new Error('Palette must contain at least one color');
  const data = new Float32Array(palette.length * 4);
  palette.forEach(([r, g, b], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 1.0;
  });
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, palette.length, 1, 0, gl.RGBA, gl.FLOAT, data);
}
