import {
  ColorRGB,
  ColorList,
  PaletteVizOptions,
  SupportedColorModels,
  Axis,
  DistanceMetric,
} from './types.ts';
import { paletteToRGBA, randomPalette } from './palette.ts';
import {
  Defines,
  buildProgram,
  initTexture,
  uploadPaletteTexture,
  computeMetricPalette,
  uploadMetricTexture,
} from './webgl.ts';
import { vertexShaderSrc, assembleFragShader, outlineFragmentShaderSrc } from './shaderSrc.ts';

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
  #invertAxes: Axis[] = [];
  #showRaw = false;
  #outlineWidth = 0;
  #gamutClip = false;

  // uniform value maps
  readonly #axisMap = { x: 0, y: 1, z: 2 } as const;
  readonly #colorModelMap = {
    rgb: 0,
    rgb12bit: 1,
    rgb8bit: 2,
    rgb18bit: 25,
    rgb6bit: 26,
    rgb15bit: 27,
    oklab: 3,
    okhsv: 4,
    okhsvPolar: 5,
    okhsl: 6,
    okhslPolar: 7,
    oklch: 8,
    oklchPolar: 9,
    hsv: 10,
    hsvPolar: 11,
    hsl: 12,
    hslPolar: 13,
    hwb: 14,
    hwbPolar: 15,
    oklrab: 16,
    oklrch: 17,
    oklrchPolar: 18,
    cielab: 19,
    cielch: 20,
    cielchPolar: 21,
    cielabD50: 22,
    cielchD50: 23,
    cielchD50Polar: 24,
    spectrum: 28,
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
    okLightness: 8,
    liMatch: 9,
  } as const;

  // WebGL
  #canvas: HTMLCanvasElement;
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram | null = null;
  #texture: WebGLTexture | null = null;
  #metricTexture: WebGLTexture | null = null;
  #quadBuffer: WebGLBuffer | null = null;
  #vao: WebGLVertexArrayObject | null = null;
  #animationFrame: number | null = null;
  #programDirty = false;
  #metricPaletteDirty = true;
  #destroyed = false;

  // cached uniform locations (re-queried after each program rebuild)
  #uProgress: WebGLUniformLocation | null = null;
  #uPaletteTexture: WebGLUniformLocation | null = null;
  #uPaletteMetricTexture: WebGLUniformLocation | null = null;
  #uPaletteSize: WebGLUniformLocation | null = null;

  // FBO + blit/outline pass (always used — decouples render from display compositor)
  #fbo: WebGLFramebuffer | null = null;
  #fboTexture: WebGLTexture | null = null;
  #blitProgram: WebGLProgram | null = null;
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
    invertAxes = [],
    showRaw = false,
    outlineWidth = 0,
    gamutClip = false,
  }: PaletteVizOptions = {}) {
    this.#palette = palette;
    this.#width = width;
    this.#height = height;
    this.#pixelRatio = pixelRatio;
    this.#colorModel = colorModel;
    this.#distanceMetric = distanceMetric;
    this.#axis = axis;
    this.#position = position;
    this.#invertAxes = this.#normalizeInvertAxes(invertAxes);
    this.#showRaw = showRaw;
    this.#outlineWidth = outlineWidth;
    this.#gamutClip = gamutClip;
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

    this.#metricTexture = gl.createTexture()!;
    initTexture(gl, this.#metricTexture);

    this.#rebuildProgram();
    this.#setSize(this.#width, this.#height);
    this.#buildFBO();
    this.#container?.appendChild(this.#canvas);
    this.#paint();
  }

  #defines(): Defines {
    const useImplicitPolarFlipY =
      this.#colorModel.endsWith('Polar') && this.#invertAxes.includes('y');
    return {
      DISTANCE_METRIC: this.#distanceMetricMap[this.#distanceMetric],
      COLOR_MODEL: this.#colorModelMap[this.#colorModel],
      PROGRESS_AXIS: this.#axisMap[this.#axis],
      INVERT_X: this.#invertAxes.includes('x') ? 1 : false,
      INVERT_Y: this.#invertAxes.includes('y') && !useImplicitPolarFlipY ? 1 : false,
      INVERT_Z: this.#invertAxes.includes('z') ? 1 : false,
      AUTO_FLIP_Y: useImplicitPolarFlipY ? 1 : false,
      SHOW_RAW: this.#showRaw ? 1 : false,
      GAMUT_CLIP: this.#gamutClip ? 1 : false,
    };
  }

  #normalizeInvertAxes(axes: Axis[]): Axis[] {
    const uniqueAxes = new Set<Axis>();
    axes.forEach((axis) => {
      if (!(axis in this.#axisMap)) throw new Error("invertAxes entries must be 'x', 'y', or 'z'");
      uniqueAxes.add(axis);
    });
    return [...uniqueAxes];
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
    this.#uPaletteMetricTexture = gl.getUniformLocation(this.#program, 'paletteMetricTexture');
    this.#uPaletteSize = gl.getUniformLocation(this.#program, 'uPaletteSize');
    this.#metricPaletteDirty = true;
  }

  #buildFBO(): void {
    const gl = this.#gl;
    this.#blitProgram = buildProgram(gl, {}, outlineFragmentShaderSrc, vertexShaderSrc);
    this.#uColorMap = gl.getUniformLocation(this.#blitProgram, 'colorMap');
    this.#uOutlineWidth = gl.getUniformLocation(this.#blitProgram, 'outlineWidth');
    this.#uOutlineResolution = gl.getUniformLocation(this.#blitProgram, 'resolution');

    this.#fboTexture = gl.createTexture()!;
    this.#fbo = gl.createFramebuffer()!;
    this.#resizeFBO(this.#canvas.width, this.#canvas.height);
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

  #render(): void {
    if (this.#programDirty) {
      this.#rebuildProgram();
      this.#programDirty = false;
    }
    const gl = this.#gl;

    // ── Pass 1: closest-color render into FBO ────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);

    gl.useProgram(this.#program);
    if (this.#metricPaletteDirty) {
      const metricCode = this.#distanceMetricMap[this.#distanceMetric];
      uploadMetricTexture(
        gl,
        this.#metricTexture!,
        computeMetricPalette(this.#palette, metricCode),
        this.#palette.length,
      );
      gl.uniform1i(this.#uPaletteSize, this.#palette.length);
      this.#metricPaletteDirty = false;
    }
    gl.uniform1f(this.#uProgress, this.#position);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.uniform1i(this.#uPaletteTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#metricTexture);
    gl.uniform1i(this.#uPaletteMetricTexture, 1);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.#vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.flush();

    // ── Pass 2: blit FBO to canvas (outline when enabled) ────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.#blitProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#fboTexture);
    gl.uniform1i(this.#uColorMap, 0);
    gl.uniform1f(this.#uOutlineWidth, this.#showRaw ? 0 : this.#outlineWidth);
    gl.uniform2f(this.#uOutlineResolution, this.#canvas.width, this.#canvas.height);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  #paint(): void {
    if (this.#animationFrame !== null) cancelAnimationFrame(this.#animationFrame);
    this.#animationFrame = requestAnimationFrame(() => {
      this.#animationFrame = null;
      this.#render();
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
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#animationFrame !== null) {
      cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = null;
    }
    const gl = this.#gl;
    if (this.#blitProgram) gl.deleteProgram(this.#blitProgram);
    if (this.#fboTexture) gl.deleteTexture(this.#fboTexture);
    if (this.#fbo) gl.deleteFramebuffer(this.#fbo);
    gl.deleteProgram(this.#program);
    gl.deleteTexture(this.#texture);
    gl.deleteTexture(this.#metricTexture);
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
    this.#metricPaletteDirty = true;
    this.#paint();
  }
  get palette(): ColorList {
    return this.#palette.slice();
  }

  setColor(color: ColorRGB, index: number): void {
    if (index < 0 || index >= this.#palette.length) throw new Error(`Index ${index} out of range`);
    this.#palette[index] = color;
    uploadPaletteTexture(this.#gl, this.#texture!, this.#palette);
    this.#metricPaletteDirty = true;
    this.#paint();
  }

  addColor(color: ColorRGB, index?: number): void {
    this.#palette.splice(index ?? this.#palette.length, 0, color);
    uploadPaletteTexture(this.#gl, this.#texture!, this.#palette);
    this.#metricPaletteDirty = true;
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
              Math.abs(c[0] - indexOrColor[0]) < 1e-9 &&
              Math.abs(c[1] - indexOrColor[1]) < 1e-9 &&
              Math.abs(c[2] - indexOrColor[2]) < 1e-9,
          );
    if (index === -1) throw new Error('Color not found in palette');
    if (index < 0 || index >= this.#palette.length) throw new Error(`Index ${index} out of range`);
    if (this.#palette.length === 1) throw new Error('Palette must contain at least one color');
    this.#palette.splice(index, 1);
    uploadPaletteTexture(this.#gl, this.#texture!, this.#palette);
    this.#metricPaletteDirty = true;
    this.#paint();
  }

  getColorAtUV(x: number, y: number): ColorRGB {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error('x and y must be finite numbers');
    if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error('x and y must be in the range [0, 1]');
    if (this.#animationFrame !== null) {
      cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = null;
    }

    this.#render();

    const gl = this.#gl;
    const px = Math.min(
      this.#canvas.width - 1,
      Math.max(0, Math.round(x * (this.#canvas.width - 1))),
    );
    const py = Math.min(
      this.#canvas.height - 1,
      Math.max(0, Math.round(y * (this.#canvas.height - 1))),
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    const out = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [out[0] / 255, out[1] / 255, out[2] / 255];
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

  set invertAxes(value: Axis[]) {
    this.#invertAxes = this.#normalizeInvertAxes(value);
    this.#programDirty = true;
    this.#paint();
  }
  get invertAxes() {
    return this.#invertAxes.slice();
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

  set gamutClip(value: boolean) {
    this.#gamutClip = value;
    this.#programDirty = true;
    this.#paint();
  }
  get gamutClip() {
    return this.#gamutClip;
  }

  set outlineWidth(value: number) {
    this.#outlineWidth = value;
    this.#paint();
  }
  get outlineWidth() {
    return this.#outlineWidth;
  }

  static paletteToRGBA = paletteToRGBA;
  /** @deprecated use PaletteViz.paletteToRGBA */
  static paletteToTexture = paletteToRGBA;
}
