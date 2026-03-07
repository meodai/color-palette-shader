import {
  ColorList,
  PaletteViz3DOptions,
  SupportedColorModels,
  DistanceMetric,
} from './types.ts';
import { randomPalette } from './palette.ts';
import { Defines, buildProgram, initTexture, uploadPaletteTexture, computeMetricPalette, uploadMetricTexture } from './webgl.ts';
import {
  vertexShaderSrc,
  vertexShader3DCubeSrc,
  vertexShader3DCylSrc,
  assembleFragShader3D,
  outlineFragmentShaderSrc,
} from './shaderSrc.ts';
import { createCubeMesh, createCylinderMesh, createSlicedCubeMesh, createSlicedCylinderMesh, POLAR_MODEL_IDS, HUE_MODEL_IDS } from './mesh.ts';
import { mat4Perspective, mat4Ortho, mat4Multiply, mat4RotateX, mat4RotateY, mat4RotateZ, mat4Translate } from './math.ts';

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
  #gamutClip = false;
  // Turntable orbit angles for gamut clip mode (avoids axis drift)
  #gcYaw = 0;
  #gcPitch = 0;

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

  #uMVP: WebGLUniformLocation | null = null;
  #uPosition: WebGLUniformLocation | null = null;
  #uPaletteTexture: WebGLUniformLocation | null = null;
  #uPaletteMetricTexture: WebGLUniformLocation | null = null;
  #uPaletteSize: WebGLUniformLocation | null = null;
  #uColorRotation: WebGLUniformLocation | null = null;
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
    this.#isPolar = this.#gamutClip
      ? HUE_MODEL_IDS.has(this.#colorModelMap[this.#colorModel])
      : POLAR_MODEL_IDS.has(this.#colorModelMap[this.#colorModel]);

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
      const { vertices, indices } = this.#gamutClip
        ? createSlicedCylinderMesh(32, 1024, 0.25)
        : createCylinderMesh(128, 64);
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
      const { vertices, indices } = this.#gamutClip
        ? createSlicedCubeMesh(2, 1024, 0.42)
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

  #defines(): Defines {
    return {
      COLOR_MODEL: this.#colorModelMap[this.#colorModel],
      DISTANCE_METRIC: this.#distanceMetricMap[this.#distanceMetric],
      INVERT_Z: this.#invertZ ? 1 : false,
      SHOW_RAW: this.#showRaw ? 1 : false,
      GAMUT_CLIP: this.#gamutClip ? 1 : false,
      GAMUT_CLIP_POLAR: (this.#gamutClip && this.#isPolar) ? 1 : false,
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
    this.#uPaletteMetricTexture = gl.getUniformLocation(this.#program, 'paletteMetricTexture');
    this.#uPaletteSize = gl.getUniformLocation(this.#program, 'uPaletteSize');
    this.#uColorRotation = gl.getUniformLocation(this.#program, 'uColorRotation');
    this.#metricPaletteDirty = true;
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
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

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
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#fboTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.#fboDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #buildMVP(): Float32Array {
    const aspect = this.#canvas.width / this.#canvas.height;
    if (this.#gamutClip) {
      // Orthographic projection — all slices project identically (no perspective
      // parallax that would reveal slice edges as line patterns).
      const s = 1.0; // half-size of the view volume (covers padded mesh)
      const proj = mat4Ortho(-s * aspect, s * aspect, -s, s, 0.1, 100);
      const view = mat4Translate(0, 0, -3);
      // Fixed orientation: slices always face the camera.
      // Orientations chosen so that mesh draw order (ascending index) is
      // back-to-front, enabling correct painter's-algorithm rendering
      // without depth test.
      const fixedOrientation = this.#isPolar
        ? mat4RotateX(Math.PI / 2)
        : mat4RotateY(-Math.PI / 2);
      return mat4Multiply(proj, mat4Multiply(view, fixedOrientation));
    }
    const proj = mat4Perspective(Math.PI / 5, aspect, 0.1, 100);
    const view = mat4Translate(0, 0, -3);
    return mat4Multiply(proj, mat4Multiply(view, this.#modelMatrix));
  }

  #render(): void {
    if (this.#meshDirty) {
      this.#isPolar = this.#gamutClip
      ? HUE_MODEL_IDS.has(this.#colorModelMap[this.#colorModel])
      : POLAR_MODEL_IDS.has(this.#colorModelMap[this.#colorModel]);
      this.#buildMesh();
      this.#meshDirty = false;
    }
    if (this.#programDirty) {
      this.#rebuildProgram();
      this.#programDirty = false;
    }
    const gl = this.#gl;

    const useOutline = !this.#showRaw && this.#outlineWidth > 0;

    // Render into FBO only when outline pass is needed, otherwise direct
    if (useOutline) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.#program);
    if (this.#metricPaletteDirty) {
      const metricCode = this.#distanceMetricMap[this.#distanceMetric];
      uploadMetricTexture(gl, this.#metricTexture!, computeMetricPalette(this.#palette, metricCode), this.#palette.length);
      gl.uniform1i(this.#uPaletteSize, this.#palette.length);
      this.#metricPaletteDirty = false;
    }
    gl.uniformMatrix4fv(this.#uMVP, false, this.#buildMVP());
    gl.uniform1f(this.#uPosition, this.#position);
    if (this.#gamutClip && this.#uColorRotation) {
      const m = this.#modelMatrix;
      const r = this.#rot3x3;
      r[0] = m[0]; r[1] = m[1]; r[2] = m[2];
      r[3] = m[4]; r[4] = m[5]; r[5] = m[6];
      r[6] = m[8]; r[7] = m[9]; r[8] = m[10];
      gl.uniformMatrix3fv(this.#uColorRotation, false, r);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.uniform1i(this.#uPaletteTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#metricTexture);
    gl.uniform1i(this.#uPaletteMetricTexture, 1);

    gl.bindVertexArray(this.#vao);
    gl.drawElements(gl.TRIANGLES, this.#indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);

    // ── Pass 2: blit FBO to screen (only when outline is enabled) ────────
    if (useOutline) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.#blitProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.#fboTexture);
      gl.uniform1i(this.#uColorMap, 0);
      gl.uniform1f(this.#uOutlineWidth, this.#outlineWidth);
      gl.uniform2f(this.#uOutlineResolution, this.#canvas.width, this.#canvas.height);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(this.#blitVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
    }
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
    if (this.#blitProgram) gl.deleteProgram(this.#blitProgram);
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
    if (this.#gamutClip) {
      // Turntable orbit for gamut clip: track yaw/pitch and rebuild matrix.
      // This avoids axis drift from accumulated matrix multiplication.
      this.#gcYaw += dx;
      this.#gcPitch += dy;
      // Clamp pitch to avoid flipping
      this.#gcPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.#gcPitch));
      // Rebuild: yaw around the "up" axis first, then pitch around the screen horizontal.
      // Cube:  up = Y, horiz = Z → rotateY(yaw) * rotateZ(pitch)
      // Cyl:   up = Z, horiz = X → rotateZ(yaw) * rotateX(pitch)
      this.#modelMatrix = this.#isPolar
        ? mat4Multiply(mat4RotateZ(-this.#gcYaw), mat4RotateX(-this.#gcPitch))
        : mat4Multiply(mat4RotateY(-this.#gcYaw), mat4RotateZ(this.#gcPitch));
      this.#paint();
    } else {
      const inc = mat4Multiply(mat4RotateX(-dy), mat4RotateY(-dx));
      this.#modelMatrix = mat4Multiply(inc, this.#modelMatrix);
      this.#paint();
    }
  }

  set modelMatrix(m: Float32Array) {
    this.#modelMatrix = new Float32Array(m);
    this.#paint();
  }
  get modelMatrix(): Float32Array { return new Float32Array(this.#modelMatrix); }

  set gamutClip(value: boolean) {
    this.#gamutClip = value;
    this.#programDirty = true;
    this.#meshDirty = true;
    this.#paint();
  }
  get gamutClip() { return this.#gamutClip; }

  set outlineWidth(value: number) {
    this.#outlineWidth = value;
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
