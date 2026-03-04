import {
  Color,
  DataTexture,
  RGBAFormat,
  FloatType,
  ClampToEdgeWrapping,
  NearestFilter,
  ShaderMaterial,
  Scene,
  OrthographicCamera,
  WebGLRenderer,
  PlaneGeometry,
  Mesh,
} from "three";

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
//   srgb2rgb  – srgb2rgb()
//   oklab     – M_PI, cbrt(), srgb_transfer_function(), okhsv/okhsl_to_srgb(), …
//   hsl2rgb, hsv2rgb, lch2rgb – color model conversions (lch2rgb uses M_PI + srgb_transfer_function)
//   deltaE    – srgb_to_cielab(), deltaE76(), deltaE2000() (uses srgb2rgb, cbrt, M_PI, TWO_PI)
//   closestColor – branches on DISTANCE_METRIC define; uses everything above
//
// Defines (set via ShaderMaterial.defines — triggers recompile, no runtime branching):
//   DISTANCE_METRIC  int  0=rgb 1=oklab 2=deltaE76 3=deltaE2000 4=kotsarenkoRamos
//   COLOR_MODEL      int  0=hsv 1=okhsv 2=hsl 3=okhsl 4=oklch
//   PROGRESS_AXIS    int  0=x 1=y 2=z
//   IS_POLAR         flag (defined = true)
//   INVERT_Z         flag (defined = true)
//   SHOW_RAW         flag (defined = true)
export const fragmentShader = `
#define TWO_PI 6.28318530718
varying vec2 vUv;
uniform float progress;
uniform sampler2D paletteTexture;
uniform int paletteLength;

${shaderSRGB2RGB}
${shaderOKLab}
${shaderHSL2RGB}
${shaderHSV2RGB}
${shaderLCH2RGB}
${shaderDeltaE}
${shaderClosestColor}

// COLOR_MODEL: 0=hsv, 1=okhsv, 2=hsl, 3=okhsl, 4=oklch
vec3 polarToRGB(vec3 colorCoords) {
  #if COLOR_MODEL == 0
    return hsv2rgb(colorCoords);
  #elif COLOR_MODEL == 2
    return hsl2rgb(colorCoords);
  #elif COLOR_MODEL == 3
    return okhsl_to_srgb(colorCoords);
  #elif COLOR_MODEL == 4
    return lch2rgb(vec3(colorCoords.z, colorCoords.y, colorCoords.x));
  #else
    return okhsv_to_srgb(colorCoords);
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

  #ifdef IS_POLAR
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

  vec3 rgb = polarToRGB(colorCoords);

  #ifdef SHOW_RAW
    gl_FragColor = vec4(rgb, 1.);
  #else
    gl_FragColor = vec4(closestColor(rgb, paletteTexture, paletteLength), 1.);
  #endif
}`;

// Internal uniform shape — not part of the public API
// Note: colorModel, distanceMetric, isPolar, invertLightness, showRaw, axis
// are compile-time defines (ShaderMaterial.defines), not uniforms.
type ShaderUniforms = {
  progress: { value: number };
  paletteTexture: { value: DataTexture | null };
  paletteLength: { value: number };
};

const vertexShader = `varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position, 1.);
  }`;

// Stores colors as sRGB so the shader's srgb2rgb() in closestColor correctly
// converts them to linear before OKLab / CIELab distance calculations.
export const paletteToTexture = (palette: ColorList): DataTexture => {
  const data = new Float32Array(
    palette.flatMap((color) => {
      try {
        const c = new Color(color).convertLinearToSRGB();
        return [c.r, c.g, c.b, 1];
      } catch {
        console.error(`Invalid color: ${color}`);
        return [0, 0, 0, 1];
      }
    })
  );

  const texture = new DataTexture(data, palette.length, 1, RGBAFormat, FloatType);
  texture.needsUpdate = true;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;

  return texture;
};

export const randomPalette = (size = 20): ColorList =>
  Array.from({ length: size }, () =>
    `rgb(${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)})`
  );

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
  #isPolar = true;
  #invertLightness = false;
  #showRaw = false;

  // uniform value maps
  readonly #axisMap = { x: 0, y: 1, z: 2 } as const;
  readonly #colorModelMap = { hsv: 0, okhsv: 1, hsl: 2, okhsl: 3, oklch: 4 } as const;
  readonly #distanceMetricMap = { rgb: 0, oklab: 1, deltaE76: 2, deltaE2000: 3, kotsarenkoRamos: 4 } as const;

  // three.js
  #texture!: DataTexture;
  #uniforms!: ShaderUniforms;
  #material!: ShaderMaterial;
  #geometry!: PlaneGeometry;
  #mesh!: Mesh;
  #renderer!: WebGLRenderer;
  #camera!: OrthographicCamera;
  #scene!: Scene;
  #animationFrame: number | null = null;

  // dom
  #container!: HTMLElement;

  constructor({
    palette = randomPalette(),
    width = 512,
    height = 512,
    pixelRatio = window.devicePixelRatio,
    container = document.body,
    colorModel = "okhsv",
    distanceMetric = "oklab",
    isPolar = true,
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
    this.#isPolar = isPolar;
    this.#axis = axis;
    this.#position = position;
    this.#invertLightness = invertLightness;
    this.#showRaw = showRaw;
    this.#container = container;

    this.#texture = paletteToTexture(this.#palette);
    this.#uniforms = {
      progress:       { value: this.#position },
      paletteTexture: { value: this.#texture },
      paletteLength:  { value: this.#palette.length },
    };

    this.#material = new ShaderMaterial({
      uniforms: this.#uniforms,
      vertexShader,
      fragmentShader,
      defines: {
        DISTANCE_METRIC: this.#distanceMetricMap[this.#distanceMetric],
        COLOR_MODEL:     this.#colorModelMap[this.#colorModel],
        PROGRESS_AXIS:   this.#axisMap[this.#axis],
        IS_POLAR:        this.#isPolar ? 1 : false,
        INVERT_Z:        this.#invertLightness ? 1 : false,
        SHOW_RAW:        this.#showRaw ? 1 : false,
      },
    });
    this.#initThree();
  }

  #initThree() {
    this.#scene = new Scene();
    this.#camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1);
    this.#renderer = new WebGLRenderer();
    this.#renderer.setPixelRatio(this.#pixelRatio);
    this.#renderer.setSize(this.#width, this.#height);
    this.#renderer.domElement.classList.add("palette-viz");

    this.#geometry = new PlaneGeometry(2, 2);
    this.#mesh = new Mesh(this.#geometry, this.#material);
    this.#scene.add(this.#mesh);
    this.#container.appendChild(this.#renderer.domElement);

    this.#paint();
  }

  #paint() {
    if (this.#animationFrame !== null) {
      cancelAnimationFrame(this.#animationFrame);
    }
    this.#animationFrame = requestAnimationFrame(() => {
      this.#renderer.render(this.#scene, this.#camera);
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get canvas(): HTMLCanvasElement {
    return this.#renderer.domElement;
  }

  get width() { return this.#width; }
  get height() { return this.#height; }

  resize(width: number, height: number | null = null): void {
    this.#width = width;
    this.#height = height === null ? width : height;
    this.#renderer.setSize(this.#width, this.#height);
    this.#camera.updateProjectionMatrix();
    this.#paint();
  }

  destroy(): void {
    if (this.#animationFrame !== null) {
      cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = null;
    }
    this.#texture.dispose();
    this.#material.dispose();
    this.#geometry.dispose();
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }

  // ── Palette ───────────────────────────────────────────────────────────────

  set palette(palette: ColorList) {
    this.#palette = palette;
    this.#texture = paletteToTexture(palette);
    this.#uniforms.paletteTexture.value = this.#texture;
    this.#uniforms.paletteLength.value = palette.length;
    this.#paint();
  }

  get palette() {
    return this.#palette;
  }

  setColor(color: ColorString, index: number): void {
    if (index < 0 || index >= this.#palette.length) {
      throw new Error(`Index ${index} out of range`);
    }
    this.#palette[index] = color;
    this.#texture = paletteToTexture(this.#palette);
    this.#uniforms.paletteTexture.value = this.#texture;
    this.#paint();
  }

  addColor(color: ColorString, index?: number): void {
    this.#palette.splice(index ?? this.#palette.length, 0, color);
    this.#texture = paletteToTexture(this.#palette);
    this.#uniforms.paletteTexture.value = this.#texture;
    this.#uniforms.paletteLength.value = this.#palette.length;
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
    this.#texture = paletteToTexture(this.#palette);
    this.#uniforms.paletteTexture.value = this.#texture;
    this.#uniforms.paletteLength.value = this.#palette.length;
    this.#paint();
  }

  // ── Shader properties ─────────────────────────────────────────────────────

  set position(value: number) {
    this.#position = value;
    this.#uniforms.progress.value = value;
    this.#paint();
  }
  get position() { return this.#position; }

  set axis(axis: Axis) {
    if (!(axis in this.#axisMap)) throw new Error("axis must be 'x', 'y', or 'z'");
    this.#axis = axis;
    this.#material.defines.PROGRESS_AXIS = this.#axisMap[axis];
    this.#material.needsUpdate = true;
    this.#paint();
  }
  get axis() { return this.#axis; }

  set colorModel(model: SupportedColorModels) {
    if (!(model in this.#colorModelMap)) throw new Error("colorModel must be 'hsv', 'okhsv', 'hsl', 'okhsl', or 'oklch'");
    this.#colorModel = model;
    this.#material.defines.COLOR_MODEL = this.#colorModelMap[model];
    this.#material.needsUpdate = true;
    this.#paint();
  }
  get colorModel() { return this.#colorModel; }

  set distanceMetric(metric: DistanceMetric) {
    if (!(metric in this.#distanceMetricMap)) throw new Error("distanceMetric must be 'rgb', 'oklab', 'deltaE76', 'deltaE2000', or 'kotsarenkoRamos'");
    this.#distanceMetric = metric;
    this.#material.defines.DISTANCE_METRIC = this.#distanceMetricMap[metric];
    this.#material.needsUpdate = true;
    this.#paint();
  }
  get distanceMetric() { return this.#distanceMetric; }

  set isPolar(value: boolean) {
    this.#isPolar = value;
    this.#material.defines.IS_POLAR = value ? 1 : false;
    this.#material.needsUpdate = true;
    this.#paint();
  }
  get isPolar() { return this.#isPolar; }

  set invertLightness(value: boolean) {
    this.#invertLightness = value;
    this.#material.defines.INVERT_Z = value ? 1 : false;
    this.#material.needsUpdate = true;
    this.#paint();
  }
  get invertLightness() { return this.#invertLightness; }

  set showRaw(value: boolean) {
    this.#showRaw = value;
    this.#material.defines.SHOW_RAW = value ? 1 : false;
    this.#material.needsUpdate = true;
    this.#paint();
  }
  get showRaw() { return this.#showRaw; }

  static paletteToTexture = (palette: ColorList) => paletteToTexture(palette);
}
