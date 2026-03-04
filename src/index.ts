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

import { ColorString, ColorList, PaletteVizOptions, PaletteShaderUniforms, SupportedColorModels, Axis } from "./types.ts";

// @ts-ignore
import shaderSRGB2RGB from "./shaders/srgb2rgb.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderOKLab from "./shaders/oklab.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderHSV2RGB from "./shaders/hsv2rgb.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderHSL2RGB from "./shaders/hsl2rgb.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderLCH2RGB from "./shaders/lch2rgb.frag.glsl?raw" assert { type: "raw" };
// @ts-ignore
import shaderClosestColor from "./shaders/closestColor.frag.glsl?raw" assert { type: "raw" };

// oklab is included before lch2rgb so that M_PI and srgb_transfer_function
// are defined before lch2rgb uses them.
export const fragmentShader = `
#define TWO_PI 6.28318530718
varying vec2 vUv;
uniform float progress;
uniform bool isPolar;
uniform bool isPerceptional;
uniform int progress_axis;
uniform sampler2D paletteTexture;
uniform int paletteLength;
uniform bool debug;
uniform int polarColorModel;
uniform bool invertZ;

${shaderSRGB2RGB}
${shaderOKLab}
${shaderHSL2RGB}
${shaderHSV2RGB}
${shaderLCH2RGB}
${shaderClosestColor}

vec3 polarToRGB(vec3 colorCoords) {
  if (polarColorModel == 0) {
    return isPerceptional ? okhsv_to_srgb(colorCoords) : hsv2rgb(colorCoords);
  } else if (polarColorModel == 1) {
    return isPerceptional ? okhsl_to_srgb(colorCoords) : hsl2rgb(colorCoords);
  } else {
    return lch2rgb(vec3(colorCoords.z, colorCoords.y, colorCoords.x));
  }
}

void main(){
  vec3 colorCoords = vec3(progress, vUv.x, vUv.y);
  if(progress_axis == 1){
    colorCoords = vec3(vUv.x, progress, vUv.y);
  } else if(progress_axis == 2){
    colorCoords = vec3(vUv.x, vUv.y, 1. - progress);
  }

  if(isPolar) {
    vec2 toCenter = vUv - 0.5;
    float angle = atan(toCenter.y, toCenter.x);
    float radius = length(toCenter) * 2.0;

    if(progress_axis == 2){
      colorCoords = vec3((angle / TWO_PI), radius, 1. - progress);
    } else if(progress_axis == 1){
      colorCoords = vec3((angle / TWO_PI), 1. - progress, radius);
      if (radius > 1.0) {
        discard;
      }
    } else {
      float hue = 1.0 - abs(0.5 - progress * .5) * 2.0;
      if (vUv.x > 0.5) {
        hue += 0.5;
      }
      colorCoords = vec3(hue, abs(0.5 - vUv.x) * 2.0, vUv.y);
    }
  }

  if(invertZ){
    colorCoords.z = 1. - colorCoords.z;
  }
  vec3 rgb = polarToRGB(colorCoords);
  vec3 closest = closestColor(rgb, paletteTexture, paletteLength);

  if (debug) {
    closest = rgb;
  }

  gl_FragColor = vec4(closest, 1.);
}`;

// Stores colors as sRGB in the texture so that the shader's srgb2rgb()
// call in closestColor correctly converts them to linear for OKLab comparison.
export const paletteToTexture = (palette: ColorList) => {
  const paletteColors = palette.map((color) => {
    try {
      const c = new Color(color).convertLinearToSRGB();
      return { r: c.r, g: c.g, b: c.b, a: 1 };
    } catch (e) {
      console.error(`Invalid color: ${color}`);
      return { r: 0, g: 0, b: 0, a: 1 };
    }
  });
  const texture = new DataTexture(
    new Float32Array(
      paletteColors.flatMap((color) => [color.r, color.g, color.b, color.a])
    ),
    palette.length,
    1,
    RGBAFormat,
    FloatType
  );
  texture.needsUpdate = true;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;

  return texture;
}

export const randomPalette = (size = 20): ColorList => {
  const palette = [];
  for (let i = 0; i < size; i++) {
    palette.push(`rgb(${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)})`);
  }
  return palette;
};

const vertexShader = `varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position, 1.);
  }`;

export class PaletteViz {
  #palette: ColorList = [];
  #width = 512;
  #height = 512;

  #uniforms: PaletteShaderUniforms;
  #animationFrame: number | null = null;
  #progress = 0.0;
  #progressAxis: Axis = "y";
  #polarColorModel: SupportedColorModels = "hsv";
  #isPolar = true;
  #isPerceptional = true;
  #debug = false;
  #invertZ = false;

  // uniform helpers
  #axisMap = { x: 0, y: 1, z: 2 } as const;
  #colorModelMap = { hsv: 0, hsl: 1, lch: 2 } as const;

  // three.js
  #texture: DataTexture;
  #material: ShaderMaterial;
  #geometry!: PlaneGeometry;
  #mesh!: Mesh;
  #renderer!: WebGLRenderer;
  #camera!: OrthographicCamera;
  #scene!: Scene;
  #pixelRatio = 1;

  // dom
  #$renderer!: HTMLElement;
  #$parent!: HTMLElement;

  constructor({
    palette = randomPalette(),
    width = 512,
    height = 512,
    pixelRatio = window.devicePixelRatio,
    uniforms = {},
    $parent = document.body,
  }: PaletteVizOptions = {}) {
    this.#palette = palette;
    this.#width = width;
    this.#height = height;
    this.#pixelRatio = pixelRatio;

    this.#texture = paletteToTexture(this.#palette);
    this.#uniforms = {
      progress: { value: 0.0 },
      progress_axis: { value: 1 },
      polarColorModel: { value: 0 },
      isPolar: { value: true },
      isPerceptional: { value: true },
      paletteTexture: { value: this.#texture },
      paletteLength: { value: this.#palette.length },
      debug: { value: false },
      invertZ: { value: false },
      ...uniforms,
    };
    // always use our managed texture and length, not whatever was in uniforms
    this.#uniforms.paletteTexture = { value: this.#texture };
    this.#uniforms.paletteLength = { value: this.#palette.length };

    this.#material = new ShaderMaterial({
      uniforms: this.#uniforms,
      vertexShader,
      fragmentShader,
    });

    this.#$parent = $parent;
    this.#initThree();
  }

  #initThree() {
    this.#scene = new Scene();
    this.#camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1);
    this.#renderer = new WebGLRenderer();
    this.#renderer.setPixelRatio(this.#pixelRatio);
    this.#renderer.setSize(this.#width, this.#height);
    this.#$renderer = this.#renderer.domElement;

    this.#geometry = new PlaneGeometry(2, 2);
    this.#mesh = new Mesh(this.#geometry, this.#material);
    this.#scene.add(this.#mesh);
    this.#$renderer.classList.add("palette-viz");
    this.#$parent.appendChild(this.#$renderer);

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
    this.#$renderer.remove();
  }

  set palette(palette: ColorList) {
    this.#palette = palette;
    this.#texture = paletteToTexture(palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#material.uniforms.paletteLength.value = palette.length;
    this.#paint();
  }

  get palette() {
    return this.#palette;
  }

  setColor(color: ColorString, index: number): void {
    if (index < 0 || index >= this.#palette.length) {
      throw new Error("Invalid index");
    }
    this.#palette[index] = color;
    this.#texture = paletteToTexture(this.#palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#paint();
  }

  addColor(color: ColorString, index?: number): void {
    const i = index ?? this.#palette.length;
    this.#palette.splice(i, 0, color);
    this.#texture = paletteToTexture(this.#palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#material.uniforms.paletteLength.value = this.#palette.length;
    this.#paint();
  }

  removeColor(index: number): void;
  removeColor(color: ColorString): void;
  removeColor(indexOrColor: number | ColorString): void {
    const index = typeof indexOrColor === "number"
      ? indexOrColor
      : this.#palette.indexOf(indexOrColor);
    if (index === -1) {
      throw new Error("Color not found in palette");
    }
    if (index < 0 || index >= this.#palette.length) {
      throw new Error("Invalid index");
    }
    this.#palette.splice(index, 1);
    this.#texture = paletteToTexture(this.#palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#material.uniforms.paletteLength.value = this.#palette.length;
    this.#paint();
  }

  set progress(progress: number) {
    this.#progress = progress;
    this.#material.uniforms.progress.value = this.#progress;
    this.#paint();
  }

  get progress() {
    return this.#progress;
  }

  set progressAxis(axis: Axis) {
    if (!(axis in this.#axisMap)) {
      throw new Error("Invalid axis. Must be one of 'x', 'y', or 'z'");
    }
    this.#progressAxis = axis;
    this.#material.uniforms.progress_axis.value = this.#axisMap[axis];
    this.#paint();
  }

  get progressAxis() {
    return this.#progressAxis;
  }

  set polarColorModel(model: SupportedColorModels) {
    if (!(model in this.#colorModelMap)) {
      throw new Error(
        "Invalid color model. Must be one of 'hsv', 'hsl', or 'lch'"
      );
    }
    this.#polarColorModel = model;
    this.#material.uniforms.polarColorModel.value = this.#colorModelMap[model];
    this.#paint();
  }

  get polarColorModel() {
    return this.#polarColorModel;
  }

  set isPolar(isPolar: boolean) {
    this.#isPolar = isPolar;
    this.#material.uniforms.isPolar.value = isPolar;
    this.#paint();
  }

  get isPolar() {
    return this.#isPolar;
  }

  set isPerceptional(isPerceptional: boolean) {
    this.#isPerceptional = isPerceptional;
    this.#material.uniforms.isPerceptional.value = isPerceptional;
    this.#paint();
  }

  get isPerceptional() {
    return this.#isPerceptional;
  }

  set debug(debug: boolean) {
    this.#debug = debug;
    this.#material.uniforms.debug.value = debug;
    this.#paint();
  }

  get debug() {
    return this.#debug;
  }

  set invertZ(invertZ: boolean) {
    this.#invertZ = invertZ;
    this.#material.uniforms.invertZ.value = invertZ;
    this.#paint();
  }

  get invertZ() {
    return this.#invertZ;
  }

  static paletteToTexture = (palette: ColorList) => paletteToTexture(palette);
}
