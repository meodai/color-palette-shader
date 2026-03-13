import { Axis, ColorList } from './types.ts';
import {
  computeMetricPalette,
  initTexture,
  uploadMetricTexture,
  uploadPaletteTexture,
} from './webgl.ts';

export const AXIS_MAP = { x: 0, y: 1, z: 2 } as const;

export const COLOR_MODEL_MAP = {
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
  oklchDiag: 29,
  oklrchDiag: 30,
} as const;

export const DISTANCE_METRIC_MAP = {
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

type BaseRendererOptions = {
  palette: ColorList;
  width: number;
  height: number;
  pixelRatio: number;
  observeResize: boolean;
  container?: HTMLElement;
  canvasClassName: string;
};

export abstract class BasePaletteRenderer {
  protected paletteState: ColorList;
  protected cssWidth: number;
  protected cssHeight: number;
  protected pixelRatioState: number;

  protected readonly canvasElement: HTMLCanvasElement;
  protected readonly glContext: WebGL2RenderingContext;
  protected readonly paletteTexture: WebGLTexture;
  protected readonly metricTexture: WebGLTexture;

  protected metricPaletteDirty = true;
  protected animationFrameId: number | null = null;
  protected destroyed = false;
  protected readonly containerElement?: HTMLElement;
  protected readonly observeResize: boolean;
  protected resizeObserver: ResizeObserver | null = null;

  protected constructor({
    palette,
    width,
    height,
    pixelRatio,
    observeResize,
    container,
    canvasClassName,
  }: BaseRendererOptions) {
    this.paletteState = palette;
    this.cssWidth = width;
    this.cssHeight = height;
    this.pixelRatioState = pixelRatio;
    this.observeResize = observeResize;
    this.containerElement = container;

    this.canvasElement = document.createElement('canvas');
    this.canvasElement.classList.add(canvasClassName);
    const gl = this.canvasElement.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported');
    this.glContext = gl;

    this.paletteTexture = gl.createTexture()!;
    initTexture(gl, this.paletteTexture);
    uploadPaletteTexture(gl, this.paletteTexture, this.paletteState);

    this.metricTexture = gl.createTexture()!;
    initTexture(gl, this.metricTexture);
  }

  protected normalizeInvertAxes(axes: Axis[]): Axis[] {
    const uniqueAxes = new Set<Axis>();
    axes.forEach((axis) => {
      if (!(axis in AXIS_MAP)) throw new Error("invertAxes entries must be 'x', 'y', or 'z'");
      uniqueAxes.add(axis);
    });
    return [...uniqueAxes];
  }

  protected syncCanvasSize(width: number, height: number): { pw: number; ph: number } {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    const pw = Math.max(1, Math.round(nextWidth * this.pixelRatioState));
    const ph = Math.max(1, Math.round(nextHeight * this.pixelRatioState));
    this.cssWidth = nextWidth;
    this.cssHeight = nextHeight;
    this.canvasElement.width = pw;
    this.canvasElement.height = ph;
    this.glContext.viewport(0, 0, pw, ph);
    return { pw, ph };
  }

  protected syncCanvasSizeFromLayout(): { pw: number; ph: number; width: number; height: number } {
    const rect = this.canvasElement.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : this.cssWidth;
    const height = rect.height > 0 ? rect.height : this.cssHeight;
    const { pw, ph } = this.syncCanvasSize(width, height);
    return { pw, ph, width: this.cssWidth, height: this.cssHeight };
  }

  protected schedulePaint(): void {
    if (this.destroyed) return;
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.renderFrame();
    });
  }

  protected flushScheduledPaint(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  protected uploadMetricPalette(paletteSizeUniform: WebGLUniformLocation | null): void {
    if (!this.metricPaletteDirty) return;
    uploadMetricTexture(
      this.glContext,
      this.metricTexture,
      computeMetricPalette(this.paletteState, this.currentMetricCode()),
      this.paletteState.length,
    );
    if (paletteSizeUniform) this.glContext.uniform1i(paletteSizeUniform, this.paletteState.length);
    this.metricPaletteDirty = false;
  }

  protected attachCanvas(): void {
    this.containerElement?.appendChild(this.canvasElement);
    const { pw, ph } = this.observeResize
      ? this.syncCanvasSizeFromLayout()
      : this.syncCanvasSize(this.cssWidth, this.cssHeight);
    this.onSurfaceResized(pw, ph);
    if (!this.observeResize || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyed) return;
      const { pw, ph } = this.syncCanvasSizeFromLayout();
      this.onSurfaceResized(pw, ph);
      this.schedulePaint();
    });
    this.resizeObserver.observe(this.canvasElement);
  }

  protected beginDestroy(): boolean {
    if (this.destroyed) return false;
    this.destroyed = true;
    this.flushScheduledPaint();
    return true;
  }

  protected destroyBaseResources(): void {
    const gl = this.glContext;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    gl.deleteTexture(this.paletteTexture);
    gl.deleteTexture(this.metricTexture);
    this.canvasElement.remove();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  protected onSurfaceResized(_pw: number, _ph: number): void {}

  protected abstract currentMetricCode(): number;
  protected abstract renderFrame(): void;

  get canvas(): HTMLCanvasElement {
    return this.canvasElement;
  }

  get width(): number {
    return this.cssWidth;
  }

  get height(): number {
    return this.cssHeight;
  }

  resize(width: number, height: number | null = null): void {
    const { pw, ph } = this.syncCanvasSize(width, height ?? width);
    this.onSurfaceResized(pw, ph);
    this.schedulePaint();
  }

  set palette(palette: ColorList) {
    if (palette.length === 0) throw new Error('Palette must contain at least one color');
    this.paletteState = palette;
    uploadPaletteTexture(this.glContext, this.paletteTexture, palette);
    this.metricPaletteDirty = true;
    this.schedulePaint();
  }

  get palette(): ColorList {
    return this.paletteState.slice();
  }

  set pixelRatio(value: number) {
    this.pixelRatioState = value;
    const { pw, ph } = this.observeResize
      ? this.syncCanvasSizeFromLayout()
      : this.syncCanvasSize(this.cssWidth, this.cssHeight);
    this.onSurfaceResized(pw, ph);
    this.schedulePaint();
  }

  get pixelRatio(): number {
    return this.pixelRatioState;
  }
}