import { PaletteViz3DOptions, SupportedColorModels, DistanceMetric, Axis } from './types.ts';
import { randomPalette } from './palette.ts';
import { Defines, buildProgram } from './webgl.ts';
import {
  vertexShaderSrc,
  vertexShader3DCubeSrc,
  vertexShader3DCylSrc,
  assembleFragShader3D,
  assembleFragShader3DPrepass,
  outlineFragmentShaderSrc,
} from './shaderSrc.ts';
import {
  createCubeMesh,
  createSlicedCubeMesh,
  createSlicedCylinderMesh,
  POLAR_MODEL_IDS,
  CONE_MODEL_IDS,
  BICONE_MODEL_IDS,
  CONE_INV_MODEL_IDS,
} from './mesh.ts';
import {
  mat4Perspective,
  mat4Ortho,
  mat4Multiply,
  mat4RotateX,
  mat4RotateY,
  mat4Translate,
} from './math.ts';
import {
  BasePaletteRenderer,
  COLOR_MODEL_MAP,
  DISTANCE_METRIC_MAP,
} from './rendererShared.ts';

const GUTTERED_CLIP_PADDING = 0.42;
const SETTLED_CLIP_PASS_COUNT = 2;

export class PaletteViz3D extends BasePaletteRenderer {
  #position = 1.0;
  #modelMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  #colorModel: SupportedColorModels = 'okhsv';
  #distanceMetric: DistanceMetric = 'oklab';
  #invertAxes: Axis[] = [];
  #showRaw = false;
  #outlineWidth = 0;
  #gamutClip = false;

  #program: WebGLProgram | null = null;
  #depthProgram: WebGLProgram | null = null;
  #vao: WebGLVertexArrayObject | null = null;
  #vbo: WebGLBuffer | null = null;
  #ibo: WebGLBuffer | null = null;
  #indexCount = 0;
  #programDirty = false;
  #meshDirty = false;
  #isPolar = false;
  #sliceCount = 0;
  #interactiveUntil = 0;
  #refineTimer: number | null = null;

  #uMVP: WebGLUniformLocation | null = null;
  #uDepthMVP: WebGLUniformLocation | null = null;
  #uPosition: WebGLUniformLocation | null = null;
  #uDepthPosition: WebGLUniformLocation | null = null;
  #uPaletteTexture: WebGLUniformLocation | null = null;
  #uPaletteMetricTexture: WebGLUniformLocation | null = null;
  #uPaletteSize: WebGLUniformLocation | null = null;
  #uColorRotation: WebGLUniformLocation | null = null;
  #uDepthColorRotation: WebGLUniformLocation | null = null;
  #uSliceOffset: WebGLUniformLocation | null = null;
  #uDepthSliceOffset: WebGLUniformLocation | null = null;
  #rot3x3 = new Float32Array(9);

  #fbo: WebGLFramebuffer | null = null;
  #fboTexture: WebGLTexture | null = null;
  #fboDepth: WebGLRenderbuffer | null = null;
  #blitProgram: WebGLProgram | null = null;
  #blitVao: WebGLVertexArrayObject | null = null;
  #blitQuadBuf: WebGLBuffer | null = null;
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
    invertAxes = [],
    showRaw = false,
    outlineWidth = 0,
    gamutClip = false,
    position = 1.0,
    modelMatrix,
  }: PaletteViz3DOptions = {}) {
    super({
      palette,
      width,
      height,
      pixelRatio,
      container,
      canvasClassName: 'palette-viz-3d',
    });

    this.#colorModel = colorModel;
    this.#distanceMetric = distanceMetric;
    this.#invertAxes = this.normalizeInvertAxes(invertAxes);
    this.#showRaw = showRaw;
    this.#outlineWidth = outlineWidth;
    this.#gamutClip = gamutClip;
    this.#position = position;
    this.#isPolar = POLAR_MODEL_IDS.has(COLOR_MODEL_MAP[this.#colorModel]);

    if (modelMatrix) {
      this.#modelMatrix = new Float32Array(modelMatrix);
    } else {
      this.#modelMatrix = new Float32Array(mat4Multiply(mat4RotateX(0.45), mat4RotateY(0.65)));
    }

    this.#buildMesh();
    this.#rebuildProgram();
    this.syncCanvasSize(this.width, this.height);
    this.#syncSliceBudget();
    this.glContext.enable(this.glContext.DEPTH_TEST);
    this.#buildFBO();
    this.attachCanvas();
    this.schedulePaint();
  }

  #buildMesh(): void {
    const gl = this.glContext;
    if (this.#vbo) gl.deleteBuffer(this.#vbo);
    if (this.#ibo) gl.deleteBuffer(this.#ibo);
    if (this.#vao) gl.deleteVertexArray(this.#vao);

    if (this.#isPolar) {
      this.#sliceCount = this.#desiredSliceCount();
      const { vertices, indices } = createSlicedCylinderMesh(32, this.#sliceCount, 0.25);
      this.#indexCount = indices.length;

      this.#vbo = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      this.#ibo = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

      this.#vao = gl.createVertexArray()!;
      gl.bindVertexArray(this.#vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#ibo);
      gl.bindVertexArray(null);
      return;
    }

    this.#sliceCount = this.#gamutClip ? this.#desiredSliceCount() : 0;
    const { vertices, indices } = this.#gamutClip
      ? createSlicedCubeMesh(2, this.#sliceCount, GUTTERED_CLIP_PADDING)
      : createCubeMesh(64);
    this.#indexCount = indices.length;

    this.#vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    this.#ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    this.#vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.#vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#ibo);
    gl.bindVertexArray(null);
  }

  #desiredSliceCount(): number {
    if (!(this.#gamutClip || this.#isPolar)) return 0;
    const diagonal = Math.hypot(this.canvas.width, this.canvas.height);
    const settled = Math.max(320, Math.min(640, Math.round(diagonal * 0.9)));
    return this.#isInteractive()
      ? Math.max(160, Math.min(320, Math.round(settled * 0.4)))
      : settled;
  }

  #isInteractive(): boolean {
    return performance.now() < this.#interactiveUntil;
  }

  #markInteractive(): void {
    this.#interactiveUntil = performance.now() + 140;
    if (this.#refineTimer !== null) window.clearTimeout(this.#refineTimer);
    this.#refineTimer = window.setTimeout(() => {
      this.#refineTimer = null;
      this.schedulePaint();
    }, 150);
  }

  #syncSliceBudget(): void {
    if (!(this.#gamutClip || this.#isPolar)) {
      this.#sliceCount = 0;
      return;
    }
    const desired = this.#desiredSliceCount();
    if (desired !== this.#sliceCount) this.#meshDirty = true;
  }

  #clipPassCount(): number {
    return this.#gamutClip && !this.#isInteractive() ? SETTLED_CLIP_PASS_COUNT : 1;
  }

  #clipSliceOffset(passIndex: number, passCount: number): number {
    if (!this.#gamutClip || passCount <= 1 || this.#sliceCount <= 0) return 0;
    const span = 1 + GUTTERED_CLIP_PADDING * 2;
    const step = span / this.#sliceCount;
    return ((passIndex + 0.5) / passCount - 0.5) * step;
  }

  #drawClipPasses(
    program: WebGLProgram,
    mvp: WebGLUniformLocation | null,
    position: WebGLUniformLocation | null,
    colorRotation: WebGLUniformLocation | null,
    sliceOffset: WebGLUniformLocation | null,
  ): void {
    const gl = this.glContext;
    const passCount = this.#clipPassCount();
    this.#applySharedUniforms(program, mvp, position, colorRotation);
    gl.bindVertexArray(this.#vao);
    for (let passIndex = 0; passIndex < passCount; passIndex++) {
      if (sliceOffset) gl.uniform1f(sliceOffset, this.#clipSliceOffset(passIndex, passCount));
      gl.drawElements(gl.TRIANGLES, this.#indexCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  #defines(): Defines {
    const modelId = COLOR_MODEL_MAP[this.#colorModel];
    return {
      COLOR_MODEL: modelId,
      DISTANCE_METRIC: DISTANCE_METRIC_MAP[this.#distanceMetric],
      INVERT_X: this.#invertAxes.includes('x') ? 1 : false,
      INVERT_Y: this.#invertAxes.includes('y') ? 1 : false,
      INVERT_Z: this.#invertAxes.includes('z') ? 1 : false,
      SHOW_RAW: this.#showRaw ? 1 : false,
      GAMUT_CLIP: this.#gamutClip ? 1 : false,
      IS_POLAR: this.#isPolar ? 1 : false,
      SHAPE_CONE: this.#isPolar && CONE_MODEL_IDS.has(modelId) ? 1 : false,
      SHAPE_CONE_INV: this.#isPolar && CONE_INV_MODEL_IDS.has(modelId) ? 1 : false,
      SHAPE_BICONE: this.#isPolar && BICONE_MODEL_IDS.has(modelId) ? 1 : false,
    };
  }

  #rebuildProgram(): void {
    const gl = this.glContext;
    if (this.#program) gl.deleteProgram(this.#program);
    if (this.#depthProgram) gl.deleteProgram(this.#depthProgram);

    const fragSrc = assembleFragShader3D(
      COLOR_MODEL_MAP[this.#colorModel],
      DISTANCE_METRIC_MAP[this.#distanceMetric],
      this.#showRaw,
    );
    const prepassFragSrc = assembleFragShader3DPrepass(
      COLOR_MODEL_MAP[this.#colorModel],
      this.#gamutClip,
    );
    const vertSrc = this.#isPolar ? vertexShader3DCylSrc : vertexShader3DCubeSrc;
    this.#program = buildProgram(gl, this.#defines(), fragSrc, vertSrc);
    this.#depthProgram = buildProgram(gl, this.#defines(), prepassFragSrc, vertSrc);
    this.#uMVP = gl.getUniformLocation(this.#program, 'uMVP');
    this.#uDepthMVP = gl.getUniformLocation(this.#depthProgram, 'uMVP');
    this.#uPosition = gl.getUniformLocation(this.#program, 'uPosition');
    this.#uDepthPosition = gl.getUniformLocation(this.#depthProgram, 'uPosition');
    this.#uPaletteTexture = gl.getUniformLocation(this.#program, 'paletteTexture');
    this.#uPaletteMetricTexture = gl.getUniformLocation(this.#program, 'paletteMetricTexture');
    this.#uPaletteSize = gl.getUniformLocation(this.#program, 'uPaletteSize');
    this.#uColorRotation = gl.getUniformLocation(this.#program, 'uColorRotation');
    this.#uDepthColorRotation = gl.getUniformLocation(this.#depthProgram, 'uColorRotation');
    this.#uSliceOffset = gl.getUniformLocation(this.#program, 'uSliceOffset');
    this.#uDepthSliceOffset = gl.getUniformLocation(this.#depthProgram, 'uSliceOffset');
    this.metricPaletteDirty = true;
  }

  #applySharedUniforms(
    program: WebGLProgram,
    mvp: WebGLUniformLocation | null,
    position: WebGLUniformLocation | null,
    colorRotation: WebGLUniformLocation | null,
  ): void {
    const gl = this.glContext;
    gl.useProgram(program);
    gl.uniformMatrix4fv(mvp, false, this.#buildMVP());
    gl.uniform1f(position, this.#position);
    if ((this.#gamutClip || this.#isPolar) && colorRotation) {
      const m = this.#modelMatrix;
      const r = this.#rot3x3;
      r[0] = m[0];
      r[1] = m[1];
      r[2] = m[2];
      r[3] = m[4];
      r[4] = m[5];
      r[5] = m[6];
      r[6] = m[8];
      r[7] = m[9];
      r[8] = m[10];
      gl.uniformMatrix3fv(colorRotation, false, r);
    }
  }

  #buildFBO(): void {
    const gl = this.glContext;

    this.#fboTexture = gl.createTexture()!;
    this.#fboDepth = gl.createRenderbuffer()!;
    this.#fbo = gl.createFramebuffer()!;
    this.#resizeFBO(this.canvas.width, this.canvas.height);

    this.#blitQuadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#blitQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.#blitVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.#blitVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.#blitProgram = buildProgram(gl, {}, outlineFragmentShaderSrc, vertexShaderSrc);
    this.#uColorMap = gl.getUniformLocation(this.#blitProgram, 'colorMap');
    this.#uOutlineWidth = gl.getUniformLocation(this.#blitProgram, 'outlineWidth');
    this.#uOutlineResolution = gl.getUniformLocation(this.#blitProgram, 'resolution');
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

    gl.bindRenderbuffer(gl.RENDERBUFFER, this.#fboDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, pw, ph);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.#fboTexture,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      this.#fboDepth,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #buildMVP(): Float32Array {
    const aspect = this.canvas.width / this.canvas.height;
    if (this.#gamutClip || this.#isPolar) {
      const s = 1.0;
      const proj = mat4Ortho(-s * aspect, s * aspect, -s, s, 0.1, 100);
      const view = mat4Translate(0, 0, -3);
      const fixedOrientation = this.#isPolar ? mat4RotateX(Math.PI / 2) : mat4RotateY(-Math.PI / 2);
      return mat4Multiply(proj, mat4Multiply(view, fixedOrientation));
    }
    const proj = mat4Perspective(Math.PI / 5, aspect, 0.1, 100);
    const view = mat4Translate(0, 0, -3);
    return mat4Multiply(proj, mat4Multiply(view, this.#modelMatrix));
  }

  protected currentMetricCode(): number {
    return DISTANCE_METRIC_MAP[this.#distanceMetric];
  }

  protected onSurfaceResized(pw: number, ph: number): void {
    this.#syncSliceBudget();
    if (this.#fboTexture) this.#resizeFBO(pw, ph);
  }

  protected renderFrame(): void {
    this.#syncSliceBudget();
    if (this.#meshDirty) {
      this.#isPolar = POLAR_MODEL_IDS.has(COLOR_MODEL_MAP[this.#colorModel]);
      this.#buildMesh();
      this.#meshDirty = false;
    }
    if (this.#programDirty) {
      this.#rebuildProgram();
      this.#programDirty = false;
    }

    const gl = this.glContext;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (this.#gamutClip || this.#isPolar) {
      gl.colorMask(false, false, false, false);
      if (this.#gamutClip) {
        this.#drawClipPasses(
          this.#depthProgram!,
          this.#uDepthMVP,
          this.#uDepthPosition,
          this.#uDepthColorRotation,
          this.#uDepthSliceOffset,
        );
      } else {
        this.#applySharedUniforms(
          this.#depthProgram!,
          this.#uDepthMVP,
          this.#uDepthPosition,
          this.#uDepthColorRotation,
        );
        gl.bindVertexArray(this.#vao);
        gl.drawElements(gl.TRIANGLES, this.#indexCount, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
      }
      gl.colorMask(true, true, true, true);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.depthFunc(gl.EQUAL);
      gl.depthMask(false);
    }

    if (this.#gamutClip) {
      gl.useProgram(this.#program!);
    } else {
      this.#applySharedUniforms(this.#program!, this.#uMVP, this.#uPosition, this.#uColorRotation);
    }
    this.uploadMetricPalette(this.#uPaletteSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.uniform1i(this.#uPaletteTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.metricTexture);
    gl.uniform1i(this.#uPaletteMetricTexture, 1);

    if (this.#gamutClip) {
      this.#drawClipPasses(
        this.#program!,
        this.#uMVP,
        this.#uPosition,
        this.#uColorRotation,
        this.#uSliceOffset,
      );
    } else {
      gl.bindVertexArray(this.#vao);
      gl.drawElements(gl.TRIANGLES, this.#indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }
    if (this.#gamutClip || this.#isPolar) {
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.#blitProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#fboTexture);
    gl.uniform1i(this.#uColorMap, 0);
    gl.uniform1f(this.#uOutlineWidth, this.#showRaw ? 0 : this.#outlineWidth);
    gl.uniform2f(this.#uOutlineResolution, this.canvas.width, this.canvas.height);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.#blitVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }

  getColorAtUV(x: number, y: number): [number, number, number] | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('x and y must be finite numbers');
    }
    if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error('x and y must be in the range [0, 1]');
    this.flushScheduledPaint();
    this.renderFrame();

    const gl = this.glContext;
    const px = Math.min(this.canvas.width - 1, Math.max(0, Math.round(x * (this.canvas.width - 1))));
    const py = Math.min(
      this.canvas.height - 1,
      Math.max(0, Math.round((1 - y) * (this.canvas.height - 1))),
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    const out = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (out[3] === 0) return null;
    return [out[0] / 255, out[1] / 255, out[2] / 255];
  }

  override resize(width: number, height: number | null = null): void {
    super.resize(width, height);
    this.#markInteractive();
  }

  destroy(): void {
    if (!this.beginDestroy()) return;
    if (this.#refineTimer !== null) {
      window.clearTimeout(this.#refineTimer);
      this.#refineTimer = null;
    }

    const gl = this.glContext;
    if (this.#blitProgram) gl.deleteProgram(this.#blitProgram);
    if (this.#depthProgram) gl.deleteProgram(this.#depthProgram);
    if (this.#blitVao) gl.deleteVertexArray(this.#blitVao);
    if (this.#blitQuadBuf) gl.deleteBuffer(this.#blitQuadBuf);
    if (this.#fboTexture) gl.deleteTexture(this.#fboTexture);
    if (this.#fboDepth) gl.deleteRenderbuffer(this.#fboDepth);
    if (this.#fbo) gl.deleteFramebuffer(this.#fbo);
    if (this.#program) gl.deleteProgram(this.#program);
    if (this.#vbo) gl.deleteBuffer(this.#vbo);
    if (this.#ibo) gl.deleteBuffer(this.#ibo);
    if (this.#vao) gl.deleteVertexArray(this.#vao);
    this.destroyBaseResources();
  }

  set colorModel(model: SupportedColorModels) {
    if (!(model in COLOR_MODEL_MAP)) throw new Error(`colorModel '${model}' is not supported`);
    this.#colorModel = model;
    this.#programDirty = true;
    this.#meshDirty = true;
    this.schedulePaint();
  }
  get colorModel(): SupportedColorModels {
    return this.#colorModel;
  }

  set distanceMetric(metric: DistanceMetric) {
    if (!(metric in DISTANCE_METRIC_MAP)) {
      throw new Error(`distanceMetric '${metric}' is not supported`);
    }
    this.#distanceMetric = metric;
    this.#programDirty = true;
    this.schedulePaint();
  }
  get distanceMetric(): DistanceMetric {
    return this.#distanceMetric;
  }

  set invertAxes(value: Axis[]) {
    this.#invertAxes = this.normalizeInvertAxes(value);
    this.#programDirty = true;
    this.schedulePaint();
  }
  get invertAxes(): Axis[] {
    return this.#invertAxes.slice();
  }

  set showRaw(value: boolean) {
    this.#showRaw = value;
    this.#programDirty = true;
    this.schedulePaint();
  }
  get showRaw(): boolean {
    return this.#showRaw;
  }

  set position(value: number) {
    this.#position = Math.max(0, Math.min(1, value));
    this.#markInteractive();
    this.schedulePaint();
  }
  get position(): number {
    return this.#position;
  }

  rotate(dx: number, dy: number): void {
    if (this.#gamutClip || this.#isPolar) {
      const fixed = this.#isPolar ? mat4RotateX(Math.PI / 2) : mat4RotateY(-Math.PI / 2);
      const fixedInverse = this.#isPolar ? mat4RotateX(-Math.PI / 2) : mat4RotateY(Math.PI / 2);
      const screenIncrement = mat4Multiply(mat4RotateY(dx), mat4RotateX(dy));
      const colorIncrement = mat4Multiply(fixedInverse, mat4Multiply(screenIncrement, fixed));
      this.#modelMatrix = new Float32Array(mat4Multiply(this.#modelMatrix, colorIncrement));
    } else {
      const increment = mat4Multiply(mat4RotateX(-dy), mat4RotateY(-dx));
      this.#modelMatrix = new Float32Array(mat4Multiply(increment, this.#modelMatrix));
    }
    this.#markInteractive();
    this.schedulePaint();
  }

  set modelMatrix(matrix: Float32Array) {
    this.#modelMatrix = new Float32Array(matrix);
    this.#markInteractive();
    this.schedulePaint();
  }
  get modelMatrix(): Float32Array {
    return new Float32Array(this.#modelMatrix);
  }

  set gamutClip(value: boolean) {
    this.#gamutClip = value;
    this.#programDirty = true;
    this.#meshDirty = true;
    this.schedulePaint();
  }
  get gamutClip(): boolean {
    return this.#gamutClip;
  }

  set outlineWidth(value: number) {
    this.#outlineWidth = value;
    this.schedulePaint();
  }
  get outlineWidth(): number {
    return this.#outlineWidth;
  }

  override set pixelRatio(value: number) {
    super.pixelRatio = value;
    this.#markInteractive();
  }

  override get pixelRatio(): number {
    return super.pixelRatio;
  }
}
