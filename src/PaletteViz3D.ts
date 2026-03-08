import { ColorList, PaletteViz3DOptions, SupportedColorModels, DistanceMetric } from './types.ts';
import { randomPalette } from './palette.ts';
import {
  Defines,
  buildProgram,
  initTexture,
  uploadPaletteTexture,
  computeMetricPalette,
  uploadMetricTexture,
} from './webgl.ts';
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

const GUTTERED_CLIP_PADDING = 0.42;
const SETTLED_CLIP_PASS_COUNT = 2;

export class PaletteViz3D {
  #palette: ColorList = [];
  #width = 512;
  #height = 512;
  #pixelRatio = 1;
  #position = 1.0;
  // accumulated model rotation matrix (spherical/trackball controls)
  #modelMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  #colorModel: SupportedColorModels = 'okhsv';
  #distanceMetric: DistanceMetric = 'oklab';
  #invertZ = false;
  #showRaw = false;
  #outlineWidth = 0;
  #gamutClip = false;

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

  #canvas: HTMLCanvasElement;
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram | null = null;
  #depthProgram: WebGLProgram | null = null;
  #texture: WebGLTexture | null = null;
  #metricTexture: WebGLTexture | null = null;
  #vao: WebGLVertexArrayObject | null = null;
  #vbo: WebGLBuffer | null = null;
  #ibo: WebGLBuffer | null = null;
  #indexCount = 0;
  #animationFrame: number | null = null;
  #programDirty = false;
  #meshDirty = false;
  #metricPaletteDirty = true;
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

  // FBO + blit quad (always used — decouples 3D render from display compositor)
  #fbo: WebGLFramebuffer | null = null;
  #fboTexture: WebGLTexture | null = null;
  #fboDepth: WebGLRenderbuffer | null = null;
  #blitProgram: WebGLProgram | null = null;
  #blitVao: WebGLVertexArrayObject | null = null;
  #blitQuadBuf: WebGLBuffer | null = null;
  #uColorMap: WebGLUniformLocation | null = null;
  #uOutlineWidth: WebGLUniformLocation | null = null;
  #uOutlineResolution: WebGLUniformLocation | null = null;

  #container: HTMLElement | undefined;

  constructor({
    palette = randomPalette(),
    width = 512,
    height = 512,
    pixelRatio = window.devicePixelRatio,
    container,
    colorModel = 'okhsv',
    distanceMetric = 'oklab',
    invertZ = false,
    showRaw = false,
    outlineWidth = 0,
    gamutClip = false,
    position = 1.0,
    modelMatrix,
  }: PaletteViz3DOptions = {}) {
    this.#palette = palette;
    this.#width = width;
    this.#height = height;
    this.#pixelRatio = pixelRatio;
    this.#colorModel = colorModel;
    this.#distanceMetric = distanceMetric;
    this.#invertZ = invertZ;
    this.#showRaw = showRaw;
    this.#outlineWidth = outlineWidth;
    this.#gamutClip = gamutClip;
    this.#position = position;
    this.#container = container;
    this.#isPolar = POLAR_MODEL_IDS.has(this.#colorModelMap[this.#colorModel]);

    this.#canvas = document.createElement('canvas');
    this.#canvas.classList.add('palette-viz-3d');
    const gl = this.#canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported');
    this.#gl = gl;

    // Initialise model rotation matrix (default: slight tilt)
    if (modelMatrix) {
      this.#modelMatrix = new Float32Array(modelMatrix);
    } else {
      this.#modelMatrix = new Float32Array(mat4Multiply(mat4RotateX(0.45), mat4RotateY(0.65)));
    }

    this.#buildMesh();

    this.#texture = gl.createTexture()!;
    initTexture(gl, this.#texture);
    uploadPaletteTexture(gl, this.#texture, this.#palette);

    this.#metricTexture = gl.createTexture()!;
    initTexture(gl, this.#metricTexture);

    this.#rebuildProgram();
    this.#setSize(this.#width, this.#height);
    gl.enable(gl.DEPTH_TEST);

    this.#buildFBO();
    this.#container?.appendChild(this.#canvas);
    this.#paint();
  }

  #buildMesh(): void {
    const gl = this.#gl;
    // Clean up old buffers
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
    } else {
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
  }

  #desiredSliceCount(): number {
    if (!(this.#gamutClip || this.#isPolar)) return 0;
    const diagonal = Math.hypot(this.#canvas.width, this.#canvas.height);
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
      this.#paint();
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
    const gl = this.#gl;
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
    const modelId = this.#colorModelMap[this.#colorModel];
    return {
      COLOR_MODEL: modelId,
      DISTANCE_METRIC: this.#distanceMetricMap[this.#distanceMetric],
      INVERT_Z: this.#invertZ ? 1 : false,
      SHOW_RAW: this.#showRaw ? 1 : false,
      GAMUT_CLIP: this.#gamutClip ? 1 : false,
      IS_POLAR: this.#isPolar ? 1 : false,
      SHAPE_CONE: this.#isPolar && CONE_MODEL_IDS.has(modelId) ? 1 : false,
      SHAPE_CONE_INV: this.#isPolar && CONE_INV_MODEL_IDS.has(modelId) ? 1 : false,
      SHAPE_BICONE: this.#isPolar && BICONE_MODEL_IDS.has(modelId) ? 1 : false,
    };
  }

  #rebuildProgram(): void {
    const gl = this.#gl;
    if (this.#program) gl.deleteProgram(this.#program);
    if (this.#depthProgram) gl.deleteProgram(this.#depthProgram);

    const fragSrc = assembleFragShader3D(
      this.#colorModelMap[this.#colorModel],
      this.#distanceMetricMap[this.#distanceMetric],
      this.#showRaw,
    );
    const prepassFragSrc = assembleFragShader3DPrepass(
      this.#colorModelMap[this.#colorModel],
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
    this.#metricPaletteDirty = true;
  }

  #applySharedUniforms(
    program: WebGLProgram,
    mvp: WebGLUniformLocation | null,
    position: WebGLUniformLocation | null,
    colorRotation: WebGLUniformLocation | null,
  ): void {
    const gl = this.#gl;
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

  #setSize(w: number, h: number): void {
    const pw = Math.round(w * this.#pixelRatio);
    const ph = Math.round(h * this.#pixelRatio);
    this.#canvas.width = pw;
    this.#canvas.height = ph;
    this.#canvas.style.width = `${w}px`;
    this.#canvas.style.height = `${h}px`;
    this.#gl.viewport(0, 0, pw, ph);
    this.#syncSliceBudget();
    if (this.#fboTexture) this.#resizeFBO(pw, ph);
  }

  #buildFBO(): void {
    const gl = this.#gl;

    // FBO
    this.#fboTexture = gl.createTexture()!;
    this.#fboDepth = gl.createRenderbuffer()!;
    this.#fbo = gl.createFramebuffer()!;
    this.#resizeFBO(this.#canvas.width, this.#canvas.height);

    // Fullscreen quad for blit / outline pass
    this.#blitQuadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#blitQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.#blitVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.#blitVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Outline/passthrough shader (outlineWidth=0 → pure passthrough)
    this.#blitProgram = buildProgram(gl, {}, outlineFragmentShaderSrc, vertexShaderSrc);
    this.#uColorMap = gl.getUniformLocation(this.#blitProgram, 'colorMap');
    this.#uOutlineWidth = gl.getUniformLocation(this.#blitProgram, 'outlineWidth');
    this.#uOutlineResolution = gl.getUniformLocation(this.#blitProgram, 'resolution');
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
    const aspect = this.#canvas.width / this.#canvas.height;
    if (this.#gamutClip || this.#isPolar) {
      // Orthographic projection — all slices project identically (no perspective
      // parallax that would reveal slice edges as line patterns).
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

  #render(): void {
    this.#syncSliceBudget();
    if (this.#meshDirty) {
      this.#isPolar = POLAR_MODEL_IDS.has(this.#colorModelMap[this.#colorModel]);
      this.#buildMesh();
      this.#meshDirty = false;
    }
    if (this.#programDirty) {
      this.#rebuildProgram();
      this.#programDirty = false;
    }
    const gl = this.#gl;

    // ── Pass 1: render 3D scene into FBO ─────────────────────────────────────
    // Always render to FBO — rendering 512 slices with discard directly to the
    // default framebuffer is significantly slower due to compositor overhead.
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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.uniform1i(this.#uPaletteTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#metricTexture);
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

    // ── Pass 2: blit FBO to default framebuffer ─────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.#blitProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#fboTexture);
    gl.uniform1i(this.#uColorMap, 0);
    gl.uniform1f(this.#uOutlineWidth, this.#showRaw ? 0 : this.#outlineWidth);
    gl.uniform2f(this.#uOutlineResolution, this.#canvas.width, this.#canvas.height);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.#blitVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }

  #paint(): void {
    if (this.#animationFrame !== null) cancelAnimationFrame(this.#animationFrame);
    this.#animationFrame = requestAnimationFrame(() => {
      this.#animationFrame = null;
      this.#render();
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Read the rendered colour at normalised screen coordinates (0–1, y=0 is top).
   * Returns [r, g, b] in [0, 1], or null if the pixel is transparent (no geometry).
   * Flushes any pending rAF frame to ensure the reading is up to date.
   */
  getColorAtUV(x: number, y: number): [number, number, number] | null {
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
    // WebGL y=0 is bottom; UV y=0 is top
    const py = Math.min(
      this.#canvas.height - 1,
      Math.max(0, Math.round((1 - y) * (this.#canvas.height - 1))),
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    const out = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (out[3] === 0) return null; // transparent — no geometry at this pixel
    return [out[0] / 255, out[1] / 255, out[2] / 255];
  }

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
    this.#markInteractive();
    this.#paint();
  }

  destroy(): void {
    if (this.#animationFrame !== null) {
      cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = null;
    }
    if (this.#refineTimer !== null) {
      window.clearTimeout(this.#refineTimer);
      this.#refineTimer = null;
    }
    const gl = this.#gl;
    if (this.#blitProgram) gl.deleteProgram(this.#blitProgram);
    if (this.#depthProgram) gl.deleteProgram(this.#depthProgram);
    if (this.#blitVao) gl.deleteVertexArray(this.#blitVao);
    if (this.#blitQuadBuf) gl.deleteBuffer(this.#blitQuadBuf);
    if (this.#fboTexture) gl.deleteTexture(this.#fboTexture);
    if (this.#fboDepth) gl.deleteRenderbuffer(this.#fboDepth);
    if (this.#fbo) gl.deleteFramebuffer(this.#fbo);
    gl.deleteProgram(this.#program);
    gl.deleteTexture(this.#texture);
    gl.deleteTexture(this.#metricTexture);
    gl.deleteBuffer(this.#vbo);
    gl.deleteBuffer(this.#ibo);
    gl.deleteVertexArray(this.#vao);
    this.#canvas.remove();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

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

  set colorModel(model: SupportedColorModels) {
    if (!(model in this.#colorModelMap)) throw new Error(`colorModel '${model}' is not supported`);
    this.#colorModel = model;
    this.#programDirty = true;
    this.#meshDirty = true;
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

  set position(value: number) {
    this.#position = Math.max(0, Math.min(1, value));
    this.#markInteractive();
    this.#paint();
  }
  get position() {
    return this.#position;
  }

  /** Apply an incremental spherical rotation (screen-space dx/dy in radians). */
  rotate(dx: number, dy: number): void {
    if (this.#gamutClip || this.#isPolar) {
      // The model matrix rotates the color space (inverse of geometry rotation).
      // The camera views through fixed orientation F. To make drags feel natural:
      //   R' = R * F^T * screenInc^T * F    (post-multiply, transposed, conjugated)
      const F = this.#isPolar ? mat4RotateX(Math.PI / 2) : mat4RotateY(-Math.PI / 2);
      const Ft = this.#isPolar ? mat4RotateX(-Math.PI / 2) : mat4RotateY(Math.PI / 2);
      const screenIncT = mat4Multiply(mat4RotateY(dx), mat4RotateX(dy));
      const colorInc = mat4Multiply(Ft, mat4Multiply(screenIncT, F));
      this.#modelMatrix = new Float32Array(mat4Multiply(this.#modelMatrix, colorInc));
    } else {
      const inc = mat4Multiply(mat4RotateX(-dy), mat4RotateY(-dx));
      this.#modelMatrix = new Float32Array(mat4Multiply(inc, this.#modelMatrix));
    }
    this.#markInteractive();
    this.#paint();
  }

  set modelMatrix(m: Float32Array) {
    this.#modelMatrix = new Float32Array(m);
    this.#markInteractive();
    this.#paint();
  }
  get modelMatrix(): Float32Array {
    return new Float32Array(this.#modelMatrix);
  }

  set gamutClip(value: boolean) {
    this.#gamutClip = value;
    this.#programDirty = true;
    this.#meshDirty = true;
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

  set pixelRatio(value: number) {
    this.#pixelRatio = value;
    this.#setSize(this.#width, this.#height);
    this.#markInteractive();
    this.#paint();
  }
  get pixelRatio() {
    return this.#pixelRatio;
  }
}
