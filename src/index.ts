import {
  ColorString,
  ColorList,
  PaletteVizOptions,
  SupportedColorModels,
  Axis,
  DistanceMetric,
} from "./types.ts";

// @ts-ignore
import shaderSRGB2RGB from "./shaders/srgb2rgb.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderOKLab from "./shaders/oklab.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderHSL2RGB from "./shaders/hsl2rgb.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderHSV2RGB from "./shaders/hsv2rgb.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderLCH2RGB from "./shaders/lch2rgb.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderDeltaE from "./shaders/deltaE.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderClosestColor from "./shaders/closestColor.frag.glsl?raw" assert { type: "raw" };

// Include order matters:
//   srgb2rgb     – srgb2rgb()
//   oklab        – M_PI, cbrt(), srgb_transfer_function(), okhsv/okhsl_to_srgb(), …
//   hsl2rgb, hsv2rgb, lch2rgb – color model conversions (lch2rgb uses M_PI + srgb_transfer_function)
//   deltaE       – srgb_to_cielab(), deltaE76/94/2000() (uses srgb2rgb, cbrt, M_PI, TWO_PI)
//   closestColor – branches on DISTANCE_METRIC define; uses everything above
//
// Defines (compile-time, prepended to shader source — trigger recompile, no runtime branching):
//   DISTANCE_METRIC  int  0=rgb 1=oklab 2=deltaE76 3=deltaE2000 4=kotsarenkoRamos 5=deltaE94
//   COLOR_MODEL      int  0=rgb 1=oklab 2=okhsv 3=okhsvPolar 4=okhsl 5=okhslPolar
//                         6=oklch 7=oklchPolar 8=hsv 9=hsvPolar 10=hsl 11=hslPolar
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

// fragmentShader is exported so users can inspect or reuse the GLSL source.
// Defines are NOT embedded here — they are prepended at compile time via buildProgram().
// Note: #version 300 es is prepended by buildProgram() (must be first line,
// before defines). Do not add it here.
export const fragmentShader = `
precision highp float;
#define TWO_PI 6.28318530718
in vec2 vUv;
out vec4 fragColor;
uniform float progress;
uniform sampler2D paletteTexture;

${shaderSRGB2RGB}
${shaderOKLab}
${shaderHSL2RGB}
${shaderHSV2RGB}
${shaderLCH2RGB}
${shaderDeltaE}
${shaderClosestColor}

// COLOR_MODEL: 0=rgb, 1=oklab, 2=okhsv, 3=okhsvPolar, 4=okhsl, 5=okhslPolar,
//              6=oklch, 7=oklchPolar, 8=hsv, 9=hsvPolar, 10=hsl, 11=hslPolar
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
  #else
    return hsl2rgb(colorCoords);
  #endif
}

void main(){
  #if PROGRESS_AXIS == 1
    vec3 colorCoords = vec3(vUv.x, progress, vUv.y);
  #elif PROGRESS_AXIS == 2
    vec3 colorCoords = vec3(vUv.x, vUv.y, 1. - progress);
  #else
    vec3 colorCoords = vec3(progress, vUv.x, vUv.y);
  #endif

  #if COLOR_MODEL == 3 || COLOR_MODEL == 5 || COLOR_MODEL == 7 || COLOR_MODEL == 9 || COLOR_MODEL == 11
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

// ── Color parsing ──────────────────────────────────────────────────────────────
// Use a canvas 2D context as a free CSS color parser — handles hex, rgb(),
// hsl(), named colors, etc. Lazy-initialised to avoid issues at module load time.

let _colorCtx: CanvasRenderingContext2D | null = null;

function cssToSRGB(color: string): [number, number, number] {
  if (!_colorCtx) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    _colorCtx = c.getContext("2d")!;
  }
  _colorCtx.fillStyle = "#000000"; // reset before setting
  _colorCtx.fillStyle = color;
  const v = _colorCtx.fillStyle; // browser normalises to '#rrggbb' or 'rgba(...)'
  if (v[0] === "#") {
    return [
      parseInt(v.slice(1, 3), 16) / 255,
      parseInt(v.slice(3, 5), 16) / 255,
      parseInt(v.slice(5, 7), 16) / 255,
    ];
  }
  // rgba(r, g, b, a) fallback
  const m = v.match(/[\d.]+/g)!;
  return [+m[0] / 255, +m[1] / 255, +m[2] / 255];
}

// ── Palette helpers ────────────────────────────────────────────────────────────

// Returns the palette as a flat RGBA Uint8Array (sRGB, 1×N texture row).
// Useful for building your own WebGL texture or inspecting raw color data.
export const paletteToRGBA = (palette: ColorList): Uint8Array => {
  const data = new Uint8Array(palette.length * 4);
  palette.forEach((color, i) => {
    try {
      const [r, g, b] = cssToSRGB(color);
      data[i * 4 + 0] = Math.round(r * 255);
      data[i * 4 + 1] = Math.round(g * 255);
      data[i * 4 + 2] = Math.round(b * 255);
      data[i * 4 + 3] = 255;
    } catch {
      console.error(`Invalid color: ${color}`);
    }
  });
  return data;
};

// Backwards-compatible alias (previously returned a Three.js DataTexture)
export const paletteToTexture = paletteToRGBA;

export const randomPalette = (size = 20): ColorList =>
  Array.from({ length: size }, () =>
    `rgb(${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)})`
  );

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

function buildProgram(gl: WebGL2RenderingContext, defines: Defines, fragSrc: string, vertSrc: string): WebGLProgram {
  // #version 300 es must be the very first line — prepend it before defines.
  const defineStr = Object.entries(defines)
    .filter(([, v]) => v !== false)
    .map(([k, v]) => `#define ${k} ${v}`)
    .join("\n") + "\n";
  const prefix = "#version 300 es\n" + defineStr;

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

function uploadPaletteTexture(gl: WebGL2RenderingContext, tex: WebGLTexture, palette: ColorList): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // RGBA8: sized internal format required by WebGL2 spec
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, palette.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteToRGBA(palette));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// ── PaletteViz ─────────────────────────────────────────────────────────────────

export class PaletteViz {
  #palette: ColorList = [];
  #width = 512;
  #height = 512;
  #pixelRatio = 1;

  // shader state
  #position = 0.0;
  #axis: Axis = "y";
  #colorModel: SupportedColorModels = "okhsv";
  #distanceMetric: DistanceMetric = "oklab";
  #invertLightness = false;
  #showRaw = false;

  // uniform value maps
  readonly #axisMap           = { x: 0, y: 1, z: 2 } as const;
  readonly #colorModelMap     = {
    rgb: 0, oklab: 1,
    okhsv: 2, okhsvPolar: 3,
    okhsl: 4, okhslPolar: 5,
    oklch: 6, oklchPolar: 7,
    hsv: 8,  hsvPolar: 9,
    hsl: 10, hslPolar: 11,
  } as const;
  readonly #distanceMetricMap = { rgb: 0, oklab: 1, deltaE76: 2, deltaE2000: 3, kotsarenkoRamos: 4, deltaE94: 5 } as const;

  // WebGL
  #canvas: HTMLCanvasElement;
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram | null = null;
  #texture: WebGLTexture | null = null;
  #quadBuffer: WebGLBuffer | null = null;
  #vao: WebGLVertexArrayObject | null = null;
  #animationFrame: number | null = null;

  // cached uniform locations (re-queried after each program rebuild)
  #uProgress: WebGLUniformLocation | null = null;
  #uPaletteTexture: WebGLUniformLocation | null = null;

  // dom
  #container: HTMLElement | undefined;

  constructor({
    palette = randomPalette(),
    width = 512,
    height = 512,
    pixelRatio = window.devicePixelRatio,
    container,
    colorModel = "okhsv",
    distanceMetric = "oklab",
    axis = "y",
    position = 0.0,
    invertLightness = false,
    showRaw = false,
  }: PaletteVizOptions = {}) {
    this.#palette = palette;
    this.#width = width;
    this.#height = height;
    this.#pixelRatio = pixelRatio;
    this.#colorModel = colorModel;
    this.#distanceMetric = distanceMetric;
    this.#axis = axis;
    this.#position = position;
    this.#invertLightness = invertLightness;
    this.#showRaw = showRaw;
    this.#container = container;

    this.#canvas = document.createElement("canvas");
    this.#canvas.classList.add("palette-viz");
    const gl = this.#canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 not supported");
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
    uploadPaletteTexture(gl, this.#texture, this.#palette);

    this.#buildProgram();
    this.#setSize(this.#width, this.#height);
    this.#container?.appendChild(this.#canvas);
    this.#paint();
  }

  #defines(): Defines {
    return {
      DISTANCE_METRIC: this.#distanceMetricMap[this.#distanceMetric],
      COLOR_MODEL:     this.#colorModelMap[this.#colorModel],
      PROGRESS_AXIS:   this.#axisMap[this.#axis],
      INVERT_Z:        this.#invertLightness ? 1 : false,
      SHOW_RAW:        this.#showRaw ? 1 : false,
    };
  }

  #buildProgram(): void {
    const gl = this.#gl;
    if (this.#program) gl.deleteProgram(this.#program);
    this.#program = buildProgram(gl, this.#defines(), fragmentShader, vertexShaderSrc);
    this.#uProgress       = gl.getUniformLocation(this.#program, "progress");
    this.#uPaletteTexture = gl.getUniformLocation(this.#program, "paletteTexture");
  }

  #setSize(w: number, h: number): void {
    const pw = Math.round(w * this.#pixelRatio);
    const ph = Math.round(h * this.#pixelRatio);
    this.#canvas.width = pw;
    this.#canvas.height = ph;
    this.#canvas.style.width = `${w}px`;
    this.#canvas.style.height = `${h}px`;
    this.#gl.viewport(0, 0, pw, ph);
  }

  #paint(): void {
    if (this.#animationFrame !== null) cancelAnimationFrame(this.#animationFrame);
    this.#animationFrame = requestAnimationFrame(() => {
      const gl = this.#gl;
      gl.useProgram(this.#program);

      gl.uniform1f(this.#uProgress, this.#position);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.uniform1i(this.#uPaletteTexture, 0);

      gl.bindVertexArray(this.#vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get canvas(): HTMLCanvasElement { return this.#canvas; }
  get width()  { return this.#width; }
  get height() { return this.#height; }

  resize(width: number, height: number | null = null): void {
    this.#width  = width;
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
    gl.deleteProgram(this.#program);
    gl.deleteTexture(this.#texture);
    gl.deleteBuffer(this.#quadBuffer);
    gl.deleteVertexArray(this.#vao);
    this.#canvas.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  // ── Palette ─────────────────────────────────────────────────────────────────

  set palette(palette: ColorList) {
    this.#palette = palette;
    uploadPaletteTexture(this.#gl, this.#texture!, palette);
    this.#paint();
  }
  get palette() { return this.#palette; }

  setColor(color: ColorString, index: number): void {
    if (index < 0 || index >= this.#palette.length) throw new Error(`Index ${index} out of range`);
    this.#palette[index] = color;
    uploadPaletteTexture(this.#gl, this.#texture!, this.#palette);
    this.#paint();
  }

  addColor(color: ColorString, index?: number): void {
    this.#palette.splice(index ?? this.#palette.length, 0, color);
    uploadPaletteTexture(this.#gl, this.#texture!, this.#palette);
    this.#paint();
  }

  removeColor(index: number): void;
  removeColor(color: ColorString): void;
  removeColor(indexOrColor: number | ColorString): void {
    const index = typeof indexOrColor === "number"
      ? indexOrColor
      : this.#palette.indexOf(indexOrColor);
    if (index === -1) throw new Error("Color not found in palette");
    if (index < 0 || index >= this.#palette.length) throw new Error(`Index ${index} out of range`);
    this.#palette.splice(index, 1);
    uploadPaletteTexture(this.#gl, this.#texture!, this.#palette);
    this.#paint();
  }

  // ── Shader properties ────────────────────────────────────────────────────────

  set position(value: number) { this.#position = value; this.#paint(); }
  get position() { return this.#position; }

  set axis(axis: Axis) {
    if (!(axis in this.#axisMap)) throw new Error("axis must be 'x', 'y', or 'z'");
    this.#axis = axis;
    this.#buildProgram();
    this.#paint();
  }
  get axis() { return this.#axis; }

  set colorModel(model: SupportedColorModels) {
    if (!(model in this.#colorModelMap)) throw new Error(`colorModel '${model}' is not supported`);
    this.#colorModel = model;
    this.#buildProgram();
    this.#paint();
  }
  get colorModel() { return this.#colorModel; }

  set distanceMetric(metric: DistanceMetric) {
    if (!(metric in this.#distanceMetricMap)) throw new Error("distanceMetric must be 'rgb', 'oklab', 'deltaE76', 'deltaE94', 'deltaE2000', or 'kotsarenkoRamos'");
    this.#distanceMetric = metric;
    this.#buildProgram();
    this.#paint();
  }
  get distanceMetric() { return this.#distanceMetric; }

  set invertLightness(value: boolean) {
    this.#invertLightness = value;
    this.#buildProgram();
    this.#paint();
  }
  get invertLightness() { return this.#invertLightness; }

  set showRaw(value: boolean) {
    this.#showRaw = value;
    this.#buildProgram();
    this.#paint();
  }
  get showRaw() { return this.#showRaw; }

  static paletteToRGBA = paletteToRGBA;
  /** @deprecated use PaletteViz.paletteToRGBA */
  static paletteToTexture = paletteToRGBA;
}
