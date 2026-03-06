import {
  ColorRGB,
  ColorList,
  PaletteVizOptions,
  SupportedColorModels,
  Axis,
  DistanceMetric,
} from './types.ts';

// @ts-ignore
import shaderSRGB2RGB from './shaders/srgb2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderOKLab from './shaders/oklab.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderHSL2RGB from './shaders/hsl2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderHSV2RGB from './shaders/hsv2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderLCH2RGB from './shaders/lch2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderHWB2RGB from './shaders/hwb2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderCIELab2RGB from './shaders/cielab2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderDeltaE from './shaders/deltaE.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderClosestColor from './shaders/closestColor.frag.glsl?raw' assert { type: 'raw' };

// Include order matters:
//   oklab        – M_PI, cbrt(), srgb_transfer_function(), srgb_transfer_function_inv(), okhsv/okhsl_to_srgb(), …
//   srgb2rgb     – srgb2rgb() wraps srgb_transfer_function_inv from oklab
//   hsl2rgb, hsv2rgb, lch2rgb – color model conversions (lch2rgb uses M_PI + srgb_transfer_function)
//   deltaE       – srgb_to_cielab(), deltaE76/94/2000() (uses srgb2rgb, cbrt, M_PI, TWO_PI)
//   closestColor – branches on DISTANCE_METRIC define; uses everything above
//
// Defines (compile-time, prepended to shader source — trigger recompile, no runtime branching):
//   DISTANCE_METRIC  int  0=rgb 1=oklab 2=deltaE76(=cielabD65) 3=deltaE2000 4=kotsarenkoRamos 5=deltaE94 6=oklrab 7=cielabD50
//   COLOR_MODEL      int  0=rgb 1=oklab 2=okhsv 3=okhsvPolar 4=okhsl 5=okhslPolar
//                         6=oklch 7=oklchPolar 8=hsv 9=hsvPolar 10=hsl 11=hslPolar
//                         12=hwb 13=hwbPolar 14=oklrab 15=oklrch 16=oklrchPolar
//                         17=cielab 18=cielch 19=cielchPolar
//                         20=cielabD50 21=cielchD50 22=cielchD50Polar
//   PROGRESS_AXIS    int  0=x 1=y 2=z
//   INVERT_Z         flag (defined = true)
//   SHOW_RAW         flag (defined = true)

const vertexShaderSrc = `
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 vUv;
void main() {
  vUv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// modelToRGB and main are separated so the selective assembler can reuse them.
const modelToRGBSrc = `
vec3 modelToRGB(vec3 colorCoords) {
  #if COLOR_MODEL == 0
    return colorCoords;
  #elif COLOR_MODEL == 1
    vec3 linear = oklab_to_linear_srgb(vec3(colorCoords.z, colorCoords.x - 0.5, colorCoords.y - 0.5));
    return clamp(vec3(srgb_transfer_function(linear.r), srgb_transfer_function(linear.g), srgb_transfer_function(linear.b)), 0.0, 1.0);
  #elif COLOR_MODEL == 2 || COLOR_MODEL == 3
    return okhsv_to_srgb(colorCoords);
  #elif COLOR_MODEL == 4 || COLOR_MODEL == 5
    return okhsl_to_srgb(colorCoords);
  #elif COLOR_MODEL == 6 || COLOR_MODEL == 7
    return lch2rgb(vec3(colorCoords.z, colorCoords.y, colorCoords.x));
  #elif COLOR_MODEL == 8 || COLOR_MODEL == 9
    return hsv2rgb(colorCoords);
  #elif COLOR_MODEL == 10 || COLOR_MODEL == 11
    return hsl2rgb(colorCoords);
  #elif COLOR_MODEL == 12 || COLOR_MODEL == 13
    return hwb2rgb(colorCoords);
  #elif COLOR_MODEL == 14
    vec3 linear14 = oklab_to_linear_srgb(vec3(toe_inv(colorCoords.z), colorCoords.x - 0.5, colorCoords.y - 0.5));
    return clamp(vec3(srgb_transfer_function(linear14.r), srgb_transfer_function(linear14.g), srgb_transfer_function(linear14.b)), 0.0, 1.0);
  #elif COLOR_MODEL == 15 || COLOR_MODEL == 16
    return lch2rgb(vec3(toe_inv(colorCoords.z), colorCoords.y, colorCoords.x));
  #elif COLOR_MODEL == 17
    return cielab_d65_to_rgb(vec3(colorCoords.z * 100.0, (colorCoords.x - 0.5) * 256.0, (colorCoords.y - 0.5) * 256.0));
  #elif COLOR_MODEL == 18 || COLOR_MODEL == 19
    return cielab_d65_to_rgb(vec3(colorCoords.z * 100.0, colorCoords.y * 150.0 * cos(colorCoords.x * TWO_PI), colorCoords.y * 150.0 * sin(colorCoords.x * TWO_PI)));
  #elif COLOR_MODEL == 20
    return cielab_d50_to_rgb(vec3(colorCoords.z * 100.0, (colorCoords.x - 0.5) * 256.0, (colorCoords.y - 0.5) * 256.0));
  #elif COLOR_MODEL == 21 || COLOR_MODEL == 22
    return cielab_d50_to_rgb(vec3(colorCoords.z * 100.0, colorCoords.y * 150.0 * cos(colorCoords.x * TWO_PI), colorCoords.y * 150.0 * sin(colorCoords.x * TWO_PI)));
  #else
    return colorCoords;
  #endif
}
`;

const mainSrc = `
void main(){
  #if PROGRESS_AXIS == 1
    vec3 colorCoords = vec3(vUv.x, progress, vUv.y);
  #elif PROGRESS_AXIS == 2
    vec3 colorCoords = vec3(vUv.x, vUv.y, 1. - progress);
  #else
    vec3 colorCoords = vec3(progress, vUv.x, vUv.y);
  #endif

  #if COLOR_MODEL == 3 || COLOR_MODEL == 5 || COLOR_MODEL == 7 || COLOR_MODEL == 9 || COLOR_MODEL == 11 || COLOR_MODEL == 16 || COLOR_MODEL == 19 || COLOR_MODEL == 22
    vec2 toCenter = vUv - 0.5;
    float angle = atan(toCenter.y, toCenter.x);
    float radius = length(toCenter) * 2.0;

    #if PROGRESS_AXIS == 2
      colorCoords = vec3((angle / TWO_PI), radius, 1. - progress);
    #elif PROGRESS_AXIS == 1
      colorCoords = vec3((angle / TWO_PI), 1. - progress, radius);
      if (radius > 1.0) { discard; }
    #else
      float hue = 1.0 - abs(0.5 - progress * .5) * 2.0;
      if (vUv.x > 0.5) { hue += 0.5; }
      colorCoords = vec3(hue, abs(0.5 - vUv.x) * 2.0, vUv.y);
    #endif
  #elif COLOR_MODEL == 13
    vec2 toCenter = vUv - 0.5;
    float angle = atan(toCenter.y, toCenter.x);
    float radius = length(toCenter) * 2.0;

    #if PROGRESS_AXIS == 2
      colorCoords = vec3(angle / TWO_PI, 1.0 - radius, progress);
    #elif PROGRESS_AXIS == 1
      if (radius > 1.0) { discard; }
      colorCoords = vec3(angle / TWO_PI, radius, progress);
    #else
      float hue = 1.0 - abs(0.5 - progress * .5) * 2.0;
      if (vUv.x > 0.5) { hue += 0.5; }
      colorCoords = vec3(hue, 1.0 - abs(0.5 - vUv.x) * 2.0, vUv.y);
    #endif
  #endif

  #ifdef INVERT_Z
    colorCoords.z = 1. - colorCoords.z;
  #endif

  vec3 rgb = modelToRGB(colorCoords);

  #ifdef SHOW_RAW
    fragColor = vec4(rgb, 1.);
  #else
    fragColor = vec4(closestColor(rgb, paletteTexture), 1.);
  #endif
}`;

// Full fragment shader source with all includes — exported for users who want
// to inspect or reuse the complete GLSL source.
export const fragmentShader = `
precision highp float;
#define TWO_PI 6.28318530718
in vec2 vUv;
out vec4 fragColor;
uniform float progress;
uniform sampler2D paletteTexture;

${shaderOKLab}
${shaderSRGB2RGB}
${shaderHSL2RGB}
${shaderHSV2RGB}
${shaderLCH2RGB}
${shaderHWB2RGB}
${shaderCIELab2RGB}
${shaderDeltaE}
${shaderClosestColor}
` + modelToRGBSrc + mainSrc;

// ── Selective shader assembly ────────────────────────────────────────────────
// Instead of compiling ALL shader includes every time, pick only the chunks
// needed for the current colorModel + distanceMetric. This dramatically
// reduces compiled shader size and speeds up recompiles.

type ShaderNeeds = {
  oklab: boolean;
  srgb2rgb: boolean;
  hsl2rgb: boolean;
  hsv2rgb: boolean;
  lch2rgb: boolean;
  hwb2rgb: boolean;
  cielab2rgb: boolean;
  deltaE: boolean;
  closestColor: boolean;
};

function shaderNeedsForModel(model: number): Partial<ShaderNeeds> {
  switch (model) {
    case 0: return {};                                             // rgb
    case 1: case 14: return { oklab: true };                       // oklab, oklrab
    case 2: case 3: return { oklab: true };                        // okhsv, okhsvPolar
    case 4: case 5: return { oklab: true };                        // okhsl, okhslPolar
    case 6: case 7: case 15: case 16: return { oklab: true, lch2rgb: true }; // oklch/oklrch + polar
    case 8: case 9: return { hsv2rgb: true };                      // hsv, hsvPolar
    case 10: case 11: return { hsl2rgb: true };                    // hsl, hslPolar
    case 12: case 13: return { hwb2rgb: true };                    // hwb, hwbPolar
    case 17: case 18: case 19:                                     // cielab, cielch, cielchPolar
      return { oklab: true, srgb2rgb: true, cielab2rgb: true };
    case 20: case 21: case 22:                                     // cielabD50, cielchD50, cielchD50Polar
      return { oklab: true, srgb2rgb: true, cielab2rgb: true };
    default: return {};
  }
}

function shaderNeedsForMetric(metric: number): Partial<ShaderNeeds> {
  switch (metric) {
    case 0: return {};                                                           // rgb
    case 1: case 6: return { oklab: true, srgb2rgb: true };                      // oklab, oklrab
    case 2: case 3: case 5:                                                      // deltaE76, deltaE2000, deltaE94
      return { oklab: true, srgb2rgb: true, cielab2rgb: true, deltaE: true };
    case 4: return { deltaE: true };                                             // kotsarenkoRamos
    case 7: return { oklab: true, srgb2rgb: true, cielab2rgb: true };            // cielabD50
    default: return {};
  }
}

function assembleFragShader(colorModel: number, distanceMetric: number, showRaw: boolean): string {
  const modelNeeds = shaderNeedsForModel(colorModel);
  const metricNeeds = showRaw ? {} : shaderNeedsForMetric(distanceMetric);

  const needs: ShaderNeeds = {
    oklab: !!(modelNeeds.oklab || metricNeeds.oklab),
    srgb2rgb: !!(modelNeeds.srgb2rgb || metricNeeds.srgb2rgb),
    hsl2rgb: !!modelNeeds.hsl2rgb,
    hsv2rgb: !!modelNeeds.hsv2rgb,
    lch2rgb: !!modelNeeds.lch2rgb,
    hwb2rgb: !!modelNeeds.hwb2rgb,
    cielab2rgb: !!(modelNeeds.cielab2rgb || metricNeeds.cielab2rgb),
    deltaE: !!metricNeeds.deltaE && !showRaw,
    closestColor: !showRaw,
  };

  let src = `
precision highp float;
#define TWO_PI 6.28318530718
in vec2 vUv;
out vec4 fragColor;
uniform float progress;
uniform sampler2D paletteTexture;
`;

  // oklab must come before srgb2rgb (srgb2rgb wraps srgb_transfer_function_inv)
  if (needs.oklab) src += shaderOKLab + '\n';
  if (needs.srgb2rgb) src += shaderSRGB2RGB + '\n';
  if (needs.hsl2rgb) src += shaderHSL2RGB + '\n';
  if (needs.hsv2rgb) src += shaderHSV2RGB + '\n';
  if (needs.lch2rgb) src += shaderLCH2RGB + '\n';
  if (needs.hwb2rgb) src += shaderHWB2RGB + '\n';
  if (needs.cielab2rgb) src += shaderCIELab2RGB + '\n';
  if (needs.deltaE) src += shaderDeltaE + '\n';
  if (needs.closestColor) src += shaderClosestColor + '\n';

  src += modelToRGBSrc + mainSrc;
  return src;
}

// Pass-2 shader: reads from the FBO color texture, detects edges by comparing
// N/S/E/W neighbors. Only opaque neighbors (a>0) participate in the comparison
// so polar-disc edges don't bleed into the outline.
const outlineFragmentShaderSrc = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D colorMap;
uniform float outlineWidth;
uniform vec2 resolution;

void main() {
  vec4 center = texture(colorMap, vUv);
  if (center.a == 0.0) { fragColor = vec4(0.0); return; }
  vec2 px = outlineWidth / resolution;
  vec4 n0 = texture(colorMap, vUv + vec2( px.x, 0.0));
  vec4 n1 = texture(colorMap, vUv + vec2(-px.x, 0.0));
  vec4 n2 = texture(colorMap, vUv + vec2(0.0,  px.y));
  vec4 n3 = texture(colorMap, vUv + vec2(0.0, -px.y));
  if ((n0.a > 0.0 && any(notEqual(n0.rgb, center.rgb))) ||
      (n1.a > 0.0 && any(notEqual(n1.rgb, center.rgb))) ||
      (n2.a > 0.0 && any(notEqual(n2.rgb, center.rgb))) ||
      (n3.a > 0.0 && any(notEqual(n3.rgb, center.rgb)))) {
    fragColor = vec4(0.0);
    return;
  }
  fragColor = center;
}`;

// ── Palette helpers ────────────────────────────────────────────────────────────

// Returns the palette as a flat RGBA Uint8Array (sRGB, 1×N texture row).
// Useful for building your own WebGL texture or inspecting raw color data.
export const paletteToRGBA = (palette: ColorList): Uint8Array => {
  const data = new Uint8Array(palette.length * 4);
  palette.forEach((color, i) => {
    data[i * 4 + 0] = Math.round(color[0] * 255);
    data[i * 4 + 1] = Math.round(color[1] * 255);
    data[i * 4 + 2] = Math.round(color[2] * 255);
    data[i * 4 + 3] = 255;
  });
  return data;
};

// Backwards-compatible alias (previously returned a Three.js DataTexture)
export const paletteToTexture = paletteToRGBA;

export const randomPalette = (size = 20): ColorList =>
  Array.from({ length: size }, () => [Math.random(), Math.random(), Math.random()] as ColorRGB);

// ── WebGL helpers ──────────────────────────────────────────────────────────────

type Defines = Record<string, number | false>;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
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

function buildProgram(
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

function initTexture(gl: WebGL2RenderingContext, tex: WebGLTexture): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function uploadPaletteTexture(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  palette: ColorList,
): void {
  if (palette.length === 0) throw new Error('Palette must contain at least one color');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    palette.length,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    paletteToRGBA(palette),
  );
}

// ── PaletteViz ─────────────────────────────────────────────────────────────────

export class PaletteViz {
  #palette: ColorList = [];
  #width = 512;
  #height = 512;
  #pixelRatio = 1;

  // shader state
  #position = 0.0;
  #axis: Axis = 'y';
  #colorModel: SupportedColorModels = 'okhsv';
  #distanceMetric: DistanceMetric = 'oklab';
  #invertZ = false;
  #showRaw = false;
  #outlineWidth = 0;

  // uniform value maps
  readonly #axisMap = { x: 0, y: 1, z: 2 } as const;
  readonly #colorModelMap = {
    rgb: 0,
    oklab: 1,
    okhsv: 2,
    okhsvPolar: 3,
    okhsl: 4,
    okhslPolar: 5,
    oklch: 6,
    oklchPolar: 7,
    hsv: 8,
    hsvPolar: 9,
    hsl: 10,
    hslPolar: 11,
    hwb: 12,
    hwbPolar: 13,
    oklrab: 14,
    oklrch: 15,
    oklrchPolar: 16,
    cielab: 17,
    cielch: 18,
    cielchPolar: 19,
    cielabD50: 20,
    cielchD50: 21,
    cielchD50Polar: 22,
  } as const;
  readonly #distanceMetricMap = {
    rgb: 0,
    oklab: 1,
    deltaE76: 2,
    deltaE2000: 3,
    kotsarenkoRamos: 4,
    deltaE94: 5,
    oklrab: 6,
    cielabD50: 7,
  } as const;

  // WebGL
  #canvas: HTMLCanvasElement;
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram | null = null;
  #texture: WebGLTexture | null = null;
  #quadBuffer: WebGLBuffer | null = null;
  #vao: WebGLVertexArrayObject | null = null;
  #animationFrame: number | null = null;
  #programDirty = false;

  // cached uniform locations (re-queried after each program rebuild)
  #uProgress: WebGLUniformLocation | null = null;
  #uPaletteTexture: WebGLUniformLocation | null = null;

  // outline pass (created/destroyed when outlineWidth toggles between 0 and >0)
  #fbo: WebGLFramebuffer | null = null;
  #fboTexture: WebGLTexture | null = null;
  #outlineProgram: WebGLProgram | null = null;
  #uColorMap: WebGLUniformLocation | null = null;
  #uOutlineWidth: WebGLUniformLocation | null = null;
  #uOutlineResolution: WebGLUniformLocation | null = null;

  // dom
  #container: HTMLElement | undefined;

  constructor({
    palette = randomPalette(),
    width = 512,
    height = 512,
    pixelRatio = window.devicePixelRatio,
    container,
    colorModel = 'okhsv',
    distanceMetric = 'oklab',
    axis = 'y',
    position = 0.0,
    invertZ = false,
    showRaw = false,
    outlineWidth = 0,
  }: PaletteVizOptions = {}) {
    this.#palette = palette;
    this.#width = width;
    this.#height = height;
    this.#pixelRatio = pixelRatio;
    this.#colorModel = colorModel;
    this.#distanceMetric = distanceMetric;
    this.#axis = axis;
    this.#position = position;
    this.#invertZ = invertZ;
    this.#showRaw = showRaw;
    this.#outlineWidth = outlineWidth;
    this.#container = container;

    this.#canvas = document.createElement('canvas');
    this.#canvas.classList.add('palette-viz');
    const gl = this.#canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported');
    this.#gl = gl;

    // Quad buffer + VAO — set up once, reused every frame.
    // layout(location=0) in the vertex shader pins a_position to slot 0,
    // so the VAO remains valid across shader recompiles.
    this.#quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.#vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.#vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.#texture = gl.createTexture()!;
    initTexture(gl, this.#texture);
    uploadPaletteTexture(gl, this.#texture, this.#palette);

    this.#rebuildProgram();
    this.#setSize(this.#width, this.#height);
    if (this.#outlineWidth > 0) this.#buildOutlineResources();
    this.#container?.appendChild(this.#canvas);
    this.#paint();
  }

  #defines(): Defines {
    return {
      DISTANCE_METRIC: this.#distanceMetricMap[this.#distanceMetric],
      COLOR_MODEL: this.#colorModelMap[this.#colorModel],
      PROGRESS_AXIS: this.#axisMap[this.#axis],
      INVERT_Z: this.#invertZ ? 1 : false,
      SHOW_RAW: this.#showRaw ? 1 : false,
    };
  }

  #rebuildProgram(): void {
    const gl = this.#gl;
    if (this.#program) gl.deleteProgram(this.#program);
    const fragSrc = assembleFragShader(
      this.#colorModelMap[this.#colorModel],
      this.#distanceMetricMap[this.#distanceMetric],
      this.#showRaw,
    );
    this.#program = buildProgram(gl, this.#defines(), fragSrc, vertexShaderSrc);
    this.#uProgress = gl.getUniformLocation(this.#program, 'progress');
    this.#uPaletteTexture = gl.getUniformLocation(this.#program, 'paletteTexture');
  }

  #buildOutlineResources(): void {
    const gl = this.#gl;
    this.#outlineProgram = buildProgram(gl, {}, outlineFragmentShaderSrc, vertexShaderSrc);
    this.#uColorMap = gl.getUniformLocation(this.#outlineProgram, 'colorMap');
    this.#uOutlineWidth = gl.getUniformLocation(this.#outlineProgram, 'outlineWidth');
    this.#uOutlineResolution = gl.getUniformLocation(this.#outlineProgram, 'resolution');

    this.#fboTexture = gl.createTexture()!;
    this.#fbo = gl.createFramebuffer()!;
    this.#resizeFBO(this.#canvas.width, this.#canvas.height);
  }

  #destroyOutlineResources(): void {
    const gl = this.#gl;
    if (this.#outlineProgram) {
      gl.deleteProgram(this.#outlineProgram);
      this.#outlineProgram = null;
    }
    if (this.#fboTexture) {
      gl.deleteTexture(this.#fboTexture);
      this.#fboTexture = null;
    }
    if (this.#fbo) {
      gl.deleteFramebuffer(this.#fbo);
      this.#fbo = null;
    }
  }

  #resizeFBO(pw: number, ph: number): void {
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, this.#fboTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pw, ph, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.#fboTexture,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #setSize(w: number, h: number): void {
    const pw = Math.round(w * this.#pixelRatio);
    const ph = Math.round(h * this.#pixelRatio);
    this.#canvas.width = pw;
    this.#canvas.height = ph;
    this.#canvas.style.width = `${w}px`;
    this.#canvas.style.height = `${h}px`;
    this.#gl.viewport(0, 0, pw, ph);
    if (this.#fboTexture) this.#resizeFBO(pw, ph);
  }

  #paint(): void {
    if (this.#animationFrame !== null) cancelAnimationFrame(this.#animationFrame);
    this.#animationFrame = requestAnimationFrame(() => {
      if (this.#programDirty) {
        this.#rebuildProgram();
        this.#programDirty = false;
      }
      const gl = this.#gl;

      // ── Pass 1: closest-color render ────────────────────────────────────────
      // Target: FBO when outline is active (and not showing raw), canvas otherwise.
      const useOutline = this.#fbo && !this.#showRaw;
      if (useOutline) gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);

      gl.useProgram(this.#program);
      gl.uniform1f(this.#uProgress, this.#position);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.uniform1i(this.#uPaletteTexture, 0);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(this.#vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (!useOutline) {
        gl.bindVertexArray(null);
        return;
      }

      // ── Pass 2: edge-detection using FBO texture ─────────────────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(this.#outlineProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.#fboTexture);
      gl.uniform1i(this.#uColorMap, 0);
      gl.uniform1f(this.#uOutlineWidth, this.#outlineWidth);
      gl.uniform2f(this.#uOutlineResolution, this.#canvas.width, this.#canvas.height);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }
  get width() {
    return this.#width;
  }
  get height() {
    return this.#height;
  }

  resize(width: number, height: number | null = null): void {
    this.#width = width;
    this.#height = height ?? width;
    this.#setSize(this.#width, this.#height);
    this.#paint();
  }

  destroy(): void {
    if (this.#animationFrame !== null) {
      cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = null;
    }
    const gl = this.#gl;
    this.#destroyOutlineResources();
    gl.deleteProgram(this.#program);
    gl.deleteTexture(this.#texture);
    gl.deleteBuffer(this.#quadBuffer);
    gl.deleteVertexArray(this.#vao);
    this.#canvas.remove();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // ── Palette ─────────────────────────────────────────────────────────────────

  set palette(palette: ColorList) {
    if (palette.length === 0) throw new Error('Palette must contain at least one color');
    this.#palette = palette;
    uploadPaletteTexture(this.#gl, this.#texture!, palette);
    this.#paint();
  }
  get palette(): ColorList {
    return this.#palette.slice();
  }

  setColor(color: ColorRGB, index: number): void {
    if (index < 0 || index >= this.#palette.length) throw new Error(`Index ${index} out of range`);
    this.#palette[index] = color;
    uploadPaletteTexture(this.#gl, this.#texture!, this.#palette);
    this.#paint();
  }

  addColor(color: ColorRGB, index?: number): void {
    this.#palette.splice(index ?? this.#palette.length, 0, color);
    uploadPaletteTexture(this.#gl, this.#texture!, this.#palette);
    this.#paint();
  }

  removeColor(index: number): void;
  removeColor(color: ColorRGB): void;
  removeColor(indexOrColor: number | ColorRGB): void {
    const index =
      typeof indexOrColor === 'number'
        ? indexOrColor
        : this.#palette.findIndex(
            (c) =>
              c[0] === indexOrColor[0] && c[1] === indexOrColor[1] && c[2] === indexOrColor[2],
          );
    if (index === -1) throw new Error('Color not found in palette');
    if (index < 0 || index >= this.#palette.length) throw new Error(`Index ${index} out of range`);
    if (this.#palette.length === 1) throw new Error('Palette must contain at least one color');
    this.#palette.splice(index, 1);
    uploadPaletteTexture(this.#gl, this.#texture!, this.#palette);
    this.#paint();
  }

  // ── Shader properties ────────────────────────────────────────────────────────

  set position(value: number) {
    this.#position = value;
    this.#paint();
  }
  get position() {
    return this.#position;
  }

  set axis(axis: Axis) {
    if (!(axis in this.#axisMap)) throw new Error("axis must be 'x', 'y', or 'z'");
    this.#axis = axis;
    this.#programDirty = true;
    this.#paint();
  }
  get axis() {
    return this.#axis;
  }

  set colorModel(model: SupportedColorModels) {
    if (!(model in this.#colorModelMap)) throw new Error(`colorModel '${model}' is not supported`);
    this.#colorModel = model;
    this.#programDirty = true;
    this.#paint();
  }
  get colorModel() {
    return this.#colorModel;
  }

  set distanceMetric(metric: DistanceMetric) {
    if (!(metric in this.#distanceMetricMap))
      throw new Error(`distanceMetric '${metric}' is not supported`);
    this.#distanceMetric = metric;
    this.#programDirty = true;
    this.#paint();
  }
  get distanceMetric() {
    return this.#distanceMetric;
  }

  set invertZ(value: boolean) {
    this.#invertZ = value;
    this.#programDirty = true;
    this.#paint();
  }
  get invertZ() {
    return this.#invertZ;
  }

  set showRaw(value: boolean) {
    this.#showRaw = value;
    this.#programDirty = true;
    this.#paint();
  }
  get showRaw() {
    return this.#showRaw;
  }

  set pixelRatio(value: number) {
    this.#pixelRatio = value;
    this.#setSize(this.#width, this.#height);
    this.#paint();
  }
  get pixelRatio() {
    return this.#pixelRatio;
  }

  set outlineWidth(value: number) {
    const wasEnabled = this.#outlineWidth > 0;
    this.#outlineWidth = value;
    if (value > 0 !== wasEnabled) {
      if (value > 0) this.#buildOutlineResources();
      else this.#destroyOutlineResources();
    }
    this.#paint();
  }
  get outlineWidth() {
    return this.#outlineWidth;
  }

  static paletteToRGBA = paletteToRGBA;
  /** @deprecated use PaletteViz.paletteToRGBA */
  static paletteToTexture = paletteToRGBA;
}
