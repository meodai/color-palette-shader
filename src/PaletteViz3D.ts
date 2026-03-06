import {
  ColorList,
  PaletteViz3DOptions,
  SupportedColorModels,
  DistanceMetric,
} from './types.ts';
import { randomPalette } from './palette.ts';
import { Defines, buildProgram, initTexture, uploadPaletteTexture } from './webgl.ts';
import {
  vertexShaderSrc,
  vertexShader3DCubeSrc,
  vertexShader3DCylSrc,
  assembleFragShader3D,
  outlineFragmentShaderSrc,
} from './shaderSrc.ts';
import { createCubeMesh, createCylinderMesh, POLAR_MODEL_IDS } from './mesh.ts';
import { mat4Perspective, mat4Multiply, mat4RotateX, mat4RotateY, mat4Translate } from './math.ts';

export class PaletteViz3D {
  #palette: ColorList = [];
  #width = 512;
  #height = 512;
  #pixelRatio = 1;
  #position = 1.0;
  // accumulated model rotation matrix (spherical/trackball controls)
  #modelMatrix = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

  #colorModel: SupportedColorModels = 'okhsv';
  #distanceMetric: DistanceMetric = 'oklab';
  #invertZ = false;
  #showRaw = false;
  #outlineWidth = 0;

  readonly #colorModelMap = {
    rgb: 0, oklab: 1, okhsv: 2, okhsvPolar: 3, okhsl: 4, okhslPolar: 5,
    oklch: 6, oklchPolar: 7, hsv: 8, hsvPolar: 9, hsl: 10, hslPolar: 11,
    hwb: 12, hwbPolar: 13, oklrab: 14, oklrch: 15, oklrchPolar: 16,
    cielab: 17, cielch: 18, cielchPolar: 19,
    cielabD50: 20, cielchD50: 21, cielchD50Polar: 22,
  } as const;
  readonly #distanceMetricMap = {
    rgb: 0, oklab: 1, deltaE76: 2, deltaE2000: 3, kotsarenkoRamos: 4,
    deltaE94: 5, oklrab: 6, cielabD50: 7,
  } as const;

  #canvas: HTMLCanvasElement;
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram | null = null;
  #texture: WebGLTexture | null = null;
  #vao: WebGLVertexArrayObject | null = null;
  #vbo: WebGLBuffer | null = null;
  #ibo: WebGLBuffer | null = null;
  #indexCount = 0;
  #animationFrame: number | null = null;
  #programDirty = false;
  #meshDirty = false;
  #isPolar = false;

  #uMVP: WebGLUniformLocation | null = null;
  #uPosition: WebGLUniformLocation | null = null;
  #uPaletteTexture: WebGLUniformLocation | null = null;

  // outline FBO resources
  #fbo: WebGLFramebuffer | null = null;
  #fboTexture: WebGLTexture | null = null;
  #fboDepth: WebGLRenderbuffer | null = null;
  #outlineProgram: WebGLProgram | null = null;
  #outlineVao: WebGLVertexArrayObject | null = null;
  #outlineQuadBuf: WebGLBuffer | null = null;
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
      this.#modelMatrix = mat4Multiply(mat4RotateX(0.45), mat4RotateY(0.65));
    }

    this.#buildMesh();

    this.#texture = gl.createTexture()!;
    initTexture(gl, this.#texture);
    uploadPaletteTexture(gl, this.#texture, this.#palette);

    this.#rebuildProgram();
    this.#setSize(this.#width, this.#height);
    gl.enable(gl.DEPTH_TEST);

    if (this.#outlineWidth > 0) this.#buildOutlineResources();
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
      const { vertices, indices } = createCylinderMesh(128, 64);
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
      // stride = 6 floats (pos.xyz + color.xyz)
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#ibo);
      gl.bindVertexArray(null);
    } else {
      const { vertices, indices } = createCubeMesh(64);
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

  #defines(): Defines {
    return {
      COLOR_MODEL: this.#colorModelMap[this.#colorModel],
      DISTANCE_METRIC: this.#distanceMetricMap[this.#distanceMetric],
      INVERT_Z: this.#invertZ ? 1 : false,
      SHOW_RAW: this.#showRaw ? 1 : false,
    };
  }

  #rebuildProgram(): void {
    const gl = this.#gl;
    if (this.#program) gl.deleteProgram(this.#program);
    const fragSrc = assembleFragShader3D(
      this.#colorModelMap[this.#colorModel],
      this.#distanceMetricMap[this.#distanceMetric],
      this.#showRaw,
    );
    const vertSrc = this.#isPolar ? vertexShader3DCylSrc : vertexShader3DCubeSrc;
    this.#program = buildProgram(gl, this.#defines(), fragSrc, vertSrc);
    this.#uMVP = gl.getUniformLocation(this.#program, 'uMVP');
    this.#uPosition = gl.getUniformLocation(this.#program, 'uPosition');
    this.#uPaletteTexture = gl.getUniformLocation(this.#program, 'paletteTexture');
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

  #buildOutlineResources(): void {
    const gl = this.#gl;
    // Fullscreen quad for the outline pass
    this.#outlineQuadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#outlineQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    this.#outlineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.#outlineVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Reuse the same outline fragment shader as PaletteViz (reads vUv from vertex shader)
    this.#outlineProgram = buildProgram(gl, {}, outlineFragmentShaderSrc, vertexShaderSrc);
    this.#uColorMap = gl.getUniformLocation(this.#outlineProgram, 'colorMap');
    this.#uOutlineWidth = gl.getUniformLocation(this.#outlineProgram, 'outlineWidth');
    this.#uOutlineResolution = gl.getUniformLocation(this.#outlineProgram, 'resolution');

    this.#fboTexture = gl.createTexture()!;
    this.#fboDepth = gl.createRenderbuffer()!;
    this.#fbo = gl.createFramebuffer()!;
    this.#resizeFBO(this.#canvas.width, this.#canvas.height);
  }

  #destroyOutlineResources(): void {
    const gl = this.#gl;
    if (this.#outlineProgram) { gl.deleteProgram(this.#outlineProgram); this.#outlineProgram = null; }
    if (this.#fboTexture) { gl.deleteTexture(this.#fboTexture); this.#fboTexture = null; }
    if (this.#fboDepth) { gl.deleteRenderbuffer(this.#fboDepth); this.#fboDepth = null; }
    if (this.#fbo) { gl.deleteFramebuffer(this.#fbo); this.#fbo = null; }
    if (this.#outlineVao) { gl.deleteVertexArray(this.#outlineVao); this.#outlineVao = null; }
    if (this.#outlineQuadBuf) { gl.deleteBuffer(this.#outlineQuadBuf); this.#outlineQuadBuf = null; }
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
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#fboTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.#fboDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #buildMVP(): Float32Array {
    const aspect = this.#canvas.width / this.#canvas.height;
    const proj = mat4Perspective(Math.PI / 5, aspect, 0.1, 100);
    const view = mat4Translate(0, 0, -3);
    return mat4Multiply(proj, mat4Multiply(view, this.#modelMatrix));
  }

  #render(): void {
    if (this.#meshDirty) {
      const wasPolar = this.#isPolar;
      this.#isPolar = POLAR_MODEL_IDS.has(this.#colorModelMap[this.#colorModel]);
      if (wasPolar !== this.#isPolar) this.#buildMesh();
      this.#meshDirty = false;
    }
    if (this.#programDirty) {
      this.#rebuildProgram();
      this.#programDirty = false;
    }
    const gl = this.#gl;
    const useOutline = this.#fbo && !this.#showRaw;

    // ── Pass 1: render 3D scene ──────────────────────────────────────────────
    if (useOutline) gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.#program);
    gl.uniformMatrix4fv(this.#uMVP, false, this.#buildMVP());
    gl.uniform1f(this.#uPosition, this.#position);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.uniform1i(this.#uPaletteTexture, 0);

    gl.bindVertexArray(this.#vao);
    gl.drawElements(gl.TRIANGLES, this.#indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);

    if (!useOutline) return;

    // ── Pass 2: outline edge detection ───────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.#outlineProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#fboTexture);
    gl.uniform1i(this.#uColorMap, 0);
    gl.uniform1f(this.#uOutlineWidth, this.#outlineWidth);
    gl.uniform2f(this.#uOutlineResolution, this.#canvas.width, this.#canvas.height);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.#outlineVao);
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

  get canvas(): HTMLCanvasElement { return this.#canvas; }
  get width() { return this.#width; }
  get height() { return this.#height; }

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
    this.#paint();
  }
  get palette(): ColorList { return this.#palette.slice(); }

  set colorModel(model: SupportedColorModels) {
    if (!(model in this.#colorModelMap)) throw new Error(`colorModel '${model}' is not supported`);
    this.#colorModel = model;
    this.#programDirty = true;
    this.#meshDirty = true;
    this.#paint();
  }
  get colorModel() { return this.#colorModel; }

  set distanceMetric(metric: DistanceMetric) {
    if (!(metric in this.#distanceMetricMap)) throw new Error(`distanceMetric '${metric}' is not supported`);
    this.#distanceMetric = metric;
    this.#programDirty = true;
    this.#paint();
  }
  get distanceMetric() { return this.#distanceMetric; }

  set invertZ(value: boolean) {
    this.#invertZ = value;
    this.#programDirty = true;
    this.#paint();
  }
  get invertZ() { return this.#invertZ; }

  set showRaw(value: boolean) {
    this.#showRaw = value;
    this.#programDirty = true;
    this.#paint();
  }
  get showRaw() { return this.#showRaw; }

  set position(value: number) {
    this.#position = Math.max(0, Math.min(1, value));
    this.#paint();
  }
  get position() { return this.#position; }

  /** Apply an incremental spherical rotation (screen-space dx/dy in radians). */
  rotate(dx: number, dy: number): void {
    const incY = mat4RotateY(-dx);
    const incX = mat4RotateX(-dy);
    this.#modelMatrix = mat4Multiply(incX, mat4Multiply(incY, this.#modelMatrix));
    this.#paint();
  }

  set modelMatrix(m: Float32Array) {
    this.#modelMatrix = new Float32Array(m);
    this.#paint();
  }
  get modelMatrix(): Float32Array { return new Float32Array(this.#modelMatrix); }

  set outlineWidth(value: number) {
    const wasEnabled = this.#outlineWidth > 0;
    this.#outlineWidth = value;
    if (value > 0 !== wasEnabled) {
      if (value > 0) this.#buildOutlineResources();
      else this.#destroyOutlineResources();
    }
    this.#paint();
  }
  get outlineWidth() { return this.#outlineWidth; }

  set pixelRatio(value: number) {
    this.#pixelRatio = value;
    this.#setSize(this.#width, this.#height);
    this.#paint();
  }
  get pixelRatio() { return this.#pixelRatio; }
}
