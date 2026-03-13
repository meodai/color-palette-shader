import {
  ColorRGB,
  PaletteVizOptions,
  SupportedColorModels,
  Axis,
  DistanceMetric,
} from './types.ts';
import { paletteToRGBA, randomPalette } from './palette.ts';
import {
  Defines,
  buildProgram,
  uploadPaletteTexture,
} from './webgl.ts';
import { vertexShaderSrc, assembleFragShader, outlineFragmentShaderSrc } from './shaderSrc.ts';
import {
  AXIS_MAP,
  BasePaletteRenderer,
  COLOR_MODEL_MAP,
  DISTANCE_METRIC_MAP,
} from './rendererShared.ts';

export class PaletteViz extends BasePaletteRenderer {
  // shader state
  #position = 0.0;
  #axis: Axis = 'y';
  #colorModel: SupportedColorModels = 'okhsv';
  #distanceMetric: DistanceMetric = 'oklab';
  #invertAxes: Axis[] = [];
  #showRaw = false;
  #outlineWidth = 0;
  #gamutClip = false;

  // WebGL
  #program: WebGLProgram | null = null;
  #quadBuffer: WebGLBuffer | null = null;
  #vao: WebGLVertexArrayObject | null = null;
  #programDirty = false;

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
    super({
      palette,
      width,
      height,
      pixelRatio,
      container,
      canvasClassName: 'palette-viz',
    });
    this.#colorModel = colorModel;
    this.#distanceMetric = distanceMetric;
    this.#axis = axis;
    this.#position = position;
    this.#invertAxes = this.normalizeInvertAxes(invertAxes);
    this.#showRaw = showRaw;
    this.#outlineWidth = outlineWidth;
    this.#gamutClip = gamutClip;
    const gl = this.glContext;

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

    this.#rebuildProgram();
    this.syncCanvasSize(this.width, this.height);
    this.#buildFBO();
    this.attachCanvas();
    this.schedulePaint();
  }

  #defines(): Defines {
    const useImplicitPolarFlipY =
      this.#colorModel.endsWith('Polar') && this.#invertAxes.includes('y');
    return {
      DISTANCE_METRIC: DISTANCE_METRIC_MAP[this.#distanceMetric],
      COLOR_MODEL: COLOR_MODEL_MAP[this.#colorModel],
      PROGRESS_AXIS: AXIS_MAP[this.#axis],
      INVERT_X: this.#invertAxes.includes('x') ? 1 : false,
      INVERT_Y: this.#invertAxes.includes('y') && !useImplicitPolarFlipY ? 1 : false,
      INVERT_Z: this.#invertAxes.includes('z') ? 1 : false,
      AUTO_FLIP_Y: useImplicitPolarFlipY ? 1 : false,
      SHOW_RAW: this.#showRaw ? 1 : false,
      GAMUT_CLIP: this.#gamutClip ? 1 : false,
    };
  }

  #rebuildProgram(): void {
    const gl = this.glContext;
    if (this.#program) gl.deleteProgram(this.#program);
    const fragSrc = assembleFragShader(
      COLOR_MODEL_MAP[this.#colorModel],
      DISTANCE_METRIC_MAP[this.#distanceMetric],
      this.#showRaw,
    );
    this.#program = buildProgram(gl, this.#defines(), fragSrc, vertexShaderSrc);
    this.#uProgress = gl.getUniformLocation(this.#program, 'progress');
    this.#uPaletteTexture = gl.getUniformLocation(this.#program, 'paletteTexture');
    this.#uPaletteMetricTexture = gl.getUniformLocation(this.#program, 'paletteMetricTexture');
    this.#uPaletteSize = gl.getUniformLocation(this.#program, 'uPaletteSize');
    this.metricPaletteDirty = true;
  }

  #buildFBO(): void {
    const gl = this.glContext;
    this.#blitProgram = buildProgram(gl, {}, outlineFragmentShaderSrc, vertexShaderSrc);
    this.#uColorMap = gl.getUniformLocation(this.#blitProgram, 'colorMap');
    this.#uOutlineWidth = gl.getUniformLocation(this.#blitProgram, 'outlineWidth');
    this.#uOutlineResolution = gl.getUniformLocation(this.#blitProgram, 'resolution');

    this.#fboTexture = gl.createTexture()!;
    this.#fbo = gl.createFramebuffer()!;
    this.#resizeFBO(this.canvas.width, this.canvas.height);
  }

  #resizeFBO(pw: number, ph: number): void {
    const gl = this.glContext;
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

  protected currentMetricCode(): number {
    return DISTANCE_METRIC_MAP[this.#distanceMetric];
  }

  protected onSurfaceResized(pw: number, ph: number): void {
    if (this.#fboTexture) this.#resizeFBO(pw, ph);
  }

  protected renderFrame(): void {
    if (this.#programDirty) {
      this.#rebuildProgram();
      this.#programDirty = false;
    }
    const gl = this.glContext;

    // ── Pass 1: closest-color render into FBO ────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);

    gl.useProgram(this.#program);
    this.uploadMetricPalette(this.#uPaletteSize);
    gl.uniform1f(this.#uProgress, this.#position);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.uniform1i(this.#uPaletteTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.metricTexture);
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
    gl.uniform2f(this.#uOutlineResolution, this.canvas.width, this.canvas.height);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  destroy(): void {
    if (!this.beginDestroy()) return;
    const gl = this.glContext;
    if (this.#blitProgram) gl.deleteProgram(this.#blitProgram);
    if (this.#fboTexture) gl.deleteTexture(this.#fboTexture);
    if (this.#fbo) gl.deleteFramebuffer(this.#fbo);
    gl.deleteProgram(this.#program);
    gl.deleteBuffer(this.#quadBuffer);
    gl.deleteVertexArray(this.#vao);
    this.destroyBaseResources();
  }

  // ── Palette ─────────────────────────────────────────────────────────────────

  setColor(color: ColorRGB, index: number): void {
    if (index < 0 || index >= this.paletteState.length) throw new Error(`Index ${index} out of range`);
    this.paletteState[index] = color;
    uploadPaletteTexture(this.glContext, this.paletteTexture, this.paletteState);
    this.metricPaletteDirty = true;
    this.schedulePaint();
  }

  addColor(color: ColorRGB, index?: number): void {
    this.paletteState.splice(index ?? this.paletteState.length, 0, color);
    uploadPaletteTexture(this.glContext, this.paletteTexture, this.paletteState);
    this.metricPaletteDirty = true;
    this.schedulePaint();
  }

  removeColor(index: number): void;
  removeColor(color: ColorRGB): void;
  removeColor(indexOrColor: number | ColorRGB): void {
    const index =
      typeof indexOrColor === 'number'
        ? indexOrColor
        : this.paletteState.findIndex(
            (c) =>
              Math.abs(c[0] - indexOrColor[0]) < 1e-9 &&
              Math.abs(c[1] - indexOrColor[1]) < 1e-9 &&
              Math.abs(c[2] - indexOrColor[2]) < 1e-9,
          );
    if (index === -1) throw new Error('Color not found in palette');
    if (index < 0 || index >= this.paletteState.length) throw new Error(`Index ${index} out of range`);
    if (this.paletteState.length === 1) throw new Error('Palette must contain at least one color');
    this.paletteState.splice(index, 1);
    uploadPaletteTexture(this.glContext, this.paletteTexture, this.paletteState);
    this.metricPaletteDirty = true;
    this.schedulePaint();
  }

  getColorAtUV(x: number, y: number): ColorRGB {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error('x and y must be finite numbers');
    if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error('x and y must be in the range [0, 1]');
    this.flushScheduledPaint();
    this.renderFrame();

    const gl = this.glContext;
    const px = Math.min(this.canvas.width - 1, Math.max(0, Math.round(x * (this.canvas.width - 1))));
    const py = Math.min(this.canvas.height - 1, Math.max(0, Math.round(y * (this.canvas.height - 1))));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    const out = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [out[0] / 255, out[1] / 255, out[2] / 255];
  }

  // ── Shader properties ────────────────────────────────────────────────────────

  set position(value: number) {
    this.#position = value;
    this.schedulePaint();
  }
  get position() {
    return this.#position;
  }

  set axis(axis: Axis) {
    if (!(axis in AXIS_MAP)) throw new Error("axis must be 'x', 'y', or 'z'");
    this.#axis = axis;
    this.#programDirty = true;
    this.schedulePaint();
  }
  get axis() {
    return this.#axis;
  }

  set colorModel(model: SupportedColorModels) {
    if (!(model in COLOR_MODEL_MAP)) throw new Error(`colorModel '${model}' is not supported`);
    this.#colorModel = model;
    this.#programDirty = true;
    this.schedulePaint();
  }
  get colorModel() {
    return this.#colorModel;
  }

  set distanceMetric(metric: DistanceMetric) {
    if (!(metric in DISTANCE_METRIC_MAP))
      throw new Error(`distanceMetric '${metric}' is not supported`);
    this.#distanceMetric = metric;
    this.#programDirty = true;
    this.schedulePaint();
  }
  get distanceMetric() {
    return this.#distanceMetric;
  }

  set invertAxes(value: Axis[]) {
    this.#invertAxes = this.normalizeInvertAxes(value);
    this.#programDirty = true;
    this.schedulePaint();
  }
  get invertAxes() {
    return this.#invertAxes.slice();
  }

  set showRaw(value: boolean) {
    this.#showRaw = value;
    this.#programDirty = true;
    this.schedulePaint();
  }
  get showRaw() {
    return this.#showRaw;
  }

  set gamutClip(value: boolean) {
    this.#gamutClip = value;
    this.#programDirty = true;
    this.schedulePaint();
  }
  get gamutClip() {
    return this.#gamutClip;
  }

  set outlineWidth(value: number) {
    this.#outlineWidth = value;
    this.schedulePaint();
  }
  get outlineWidth() {
    return this.#outlineWidth;
  }

  static paletteToRGBA = paletteToRGBA;
  /** @deprecated use PaletteViz.paletteToRGBA */
  static paletteToTexture = paletteToRGBA;
}
