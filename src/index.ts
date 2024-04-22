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

import { ColorString, ColorList, PaletteVizOptions, SupportedColorModels, Axis } from "./types.ts";

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
import shaderLabBased from "./shaders/labbased.frag.glsl?raw" assert { type: "raw" };

// @ts-ignore
import shaderClosestColor from "./shaders/closestColor.frag.glsl?raw" assert { type: "raw" };

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

uniform int cartesianModel;
uniform int polarModel;

${shaderSRGB2RGB}
${shaderHSL2RGB}
${shaderHSV2RGB}
${shaderLCH2RGB}
${shaderOKLab}
${shaderLabBased}
${shaderClosestColor}

vec3 toRGB(vec3 coords, int model, bool isPolar) {
  if (isPolar) {
    vec2 toCenter = vec2(coords.x - 0.5, coords.y - 0.5);
    float angle = atan(toCenter.y, toCenter.x);
    float radius = length(toCenter) * 2.0;
    float h = (coords.x / TWO_PI) * TWO_PI;
    vec3 polar = vec3((angle / TWO_PI), progress, radius);

    switch (model) {
      case 0: return hsv2rgb(polar);
      case 1: return hsl2rgb(polar);
      case 2: return okhsv_to_srgb(polar);
      case 3: return okhsl_to_srgb(polar);
      case 4: return okLCh_to_sRGB(vec3(polar.z, polar.y * 1.5, polar.x));
      case 5:
        float L = 0.50 + 0.49 * sin(TWO_PI * (0.2 * coords.y - 0.1 * coords.z));
        float C = 0.18*L*(1.0 - L*L*L);
        float h = TWO_PI*(fract(coords.x + 0.5*coords.x) - 0.5);
        
        return Lab_to_sRGB(LCh_to_Lab(vec3(L, C, h)));
      case 6: 
        float J = 0.50 + 0.49 * sin(TWO_PI * (0.2 * coords.y - 0.1 * coords.z)); // Lightness
        float M = 0.56 * J * (1.0 - J * J); // Chroma
        return sRGB_OETF(XYZ_D65_TO_sRGB * CAM16_UCS_to_XYZ_D65(vec3(J, M, h)));
      default: return coords;
    }
  } else { // Cartesian
    switch (model) {
      case 0: return coords;
      case 1: return okLab_to_sRGB(vec3(coords.x, -0.4 + coords.y * 0.8, -0.4 + coords.z * 0.8));
      case 2: return Lab_to_sRGB(vec3(coords.x, -1. + coords.y * 2., -1. + coords.z * 2.));
      case 3: XYZ_D65_TO_sRGB * CAM16_UCS_to_XYZ_D65(coords);
      default: return coords;
    }
  }
}

vec3 polarToRGB(vec3 polar) {
  if (polarColorModel == 0) {
    // maybe srgb2rgb(okhsv_to_srgb(polar));
    return isPerceptional ? okhsv_to_srgb(polar) : hsv2rgb(polar);
  } else if (polarColorModel == 1) {
    return isPerceptional ? okhsl_to_srgb(polar) : hsl2rgb(polar);
  } else {
    return lch2rgb(vec3(polar.z, polar.y, polar.x));
  }
}
void main(){
  // define x, y, z based on progress and axis

  vec3 coords = vec3(progress, vUv.x, vUv.y);
  if(progress_axis == 1){
    coords = vec3(vUv.x, progress, vUv.y);
  } else if(progress_axis == 2){
    coords = vec3(vUv.x, vUv.y, progress);
  }

  vec3 hsv = vec3(progress, vUv.x, vUv.y);
  if(progress_axis == 1){
    hsv = vec3(vUv.x, progress, vUv.y);
  } else if(progress_axis == 2){
    hsv = vec3(vUv.x, vUv.y, 1. - progress);
  }

  vec3 sRGB = vec3(0.0);

  if(isPolar) {
    vec2 toCenter = vUv - 0.5;
    float angle = atan(toCenter.y, toCenter.x);
    float radius = length(toCenter) * 2.0;
    hsv = vec3((angle / TWO_PI), 1. - progress, radius);
    // clamp radius

    float J = 0.50 + 0.49*sin(TWO_PI*(0.2*radius - 0.1*progress)); // Lightness
    float M = 0.56*J*(1.0 - J*J); // Chroma
    float h = (angle / TWO_PI)*TWO_PI;

    vec3 JMh = vec3(J, M, h);
    sRGB = XYZ_D65_TO_sRGB*CAM16_UCS_to_XYZ_D65(JMh);

    if(progress_axis == 2){
      hsv = vec3((angle / TWO_PI), radius, 1. - progress);
    } else if(progress_axis == 1){
      hsv = vec3((angle / TWO_PI), 1. - progress, radius);
      if (radius > 1.0) {
        discard;
      }
    } else {
      float hue = 1.0 - abs(0.5 - progress * .5) * 2.0;
      if (vUv.x > 0.5) {
        hue += 0.5;
      }
      hsv = vec3(hue, abs(0.5 - vUv.x) * 2.0, vUv.y);
    }
  }

  if(invertZ){
    coords.z = 1. - coords.z;
  }
  vec3 rgb = polarToRGB(coords);
  vec3 closest = closestColor(rgb, paletteTexture, paletteLength);

  if (debug) {
    closest = rgb;
  }

  closest = toRGB(coords, 3, isPolar);

  
  gl_FragColor = vec4(closest, 1.);
}`;

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

export const randomPalette = (size = 20):ColorList => {
  const palette = [];
  for (let i = 0; i < size; i++) {
    palette.push(`rgb(${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)})`);
  }
  return palette;
};

export const paletteShaderUniforms = {
  progress: { value: 0.0 },
  progress_axis: { value: 1 }, // 0 = x, 1 = y, 2 = z
  polarColorModel: { value: 0 }, // 0 = HSV, 1 = HSL, 2 = LCH
  isPolar: { value: true },
  isPerceptional: { value: true },
  
  cartesianModel: { value: 0 }, // 0 = RGB, 1 = OKLab, 2 = Lab, 3 = Jab 
  polarModel: { value: 0 }, // 0 = HSV, 1 = HSL, 2 = okHSV, 3 = okHSL, 4 = okLCh, 5 = LCh, 6 = JCh

  /**
   * cartesian: RGB
   * polar:     HSV, HSL
   * 
   * cartesian: OKLab
   * polar:     okHSV, okHSL, okLCh
   * 
   * cartesian: Lab
   * polar:     LCh
   * 
   * cartesian: CAM16UCS Jab
   * polar:     CAM16 JCh
   */

  paletteTexture: { value: paletteToTexture(randomPalette(10)) },
  paletteLength: { value: 10 },
  debug: { value: false },
  invertZ: { value: false },
};

const paletteShaderMaterial = new ShaderMaterial({
  uniforms: paletteShaderUniforms,
  vertexShader: `varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position, 1.);
    }`,
  fragmentShader,
});

export class PaletteViz {
  #palette:ColorList = [];
  #width = 512;
  #height = 512;

  // uniforms
  #uniforms = paletteShaderUniforms;
  #animationFrame:number | null = null;
  #progress = 0.0;
  #progressAxis:Axis = "y";
  #polarColorModel:SupportedColorModels = "hsv";
  #isPolar = true;
  #isPerceptional = true;
  #debug = false;
  #invertZ = false;

  // uniform helpers
  #axisMap = { x: 0, y: 1, z: 2 };
  #colorModelMap = { hsv: 0, hsl: 1, lch: 2 };

  // three.js
  #texture:DataTexture;
  #material:ShaderMaterial;
  #geometry!:PlaneGeometry;
  #mesh!:Mesh;
  #renderer!:WebGLRenderer;
  #camera!:OrthographicCamera;
  #scene!:Scene;
  #pixelRatio = 1;

  // dom
  #$renderer!:HTMLElement;
  #$parent!:HTMLElement;

  constructor({
    palette = randomPalette(),
    width = 512,
    height = 512,
    pixelRatio = window.devicePixelRatio,
    uniforms = paletteShaderUniforms,
    $parent = document.body,
  }:PaletteVizOptions = {}) {
    this.#palette = palette;
    this.#width = width;
    this.#height = height;
    this.#pixelRatio = pixelRatio;

    this.#material = paletteShaderMaterial.clone();
    this.#texture = paletteToTexture(this.#palette);
    this.#uniforms = {
      ...this.#uniforms,
      ...uniforms,
      paletteTexture: { value: this.#texture },
      paletteLength: { value: this.#palette.length },
    };
    this.#material.uniforms = this.#uniforms;

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
    // stop animation frame if it's running
    if (this.#animationFrame) {
      cancelAnimationFrame(this.#animationFrame);
    }
    this.#animationFrame = requestAnimationFrame(() => {
      this.#renderer.render(this.#scene, this.#camera);
    });
  }

  resize(width: number, height: null | number): void {
    if (!height) {
      height = width;
    }

    this.#width = width;
    this.#height = height;
    this.#renderer.setSize(width, height);
    this.#camera.updateProjectionMatrix();
    this.#paint();
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

  setColor = (color: ColorString, index: number) => {
    // validate index
    if (index < 0 || index >= this.#palette.length) {
      throw new Error("Invalid index");
    }
    this.#palette[index] = color;
    this.#texture = paletteToTexture(this.#palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#paint();
  };

  addColor = (color: ColorString, index: undefined | number) => {
    if (index === undefined) {
      index = this.#palette.length;
    }
    this.#palette.splice(index, 0, color);
    this.#texture = paletteToTexture(this.#palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#material.uniforms.paletteLength.value = this.#palette.length;
    this.#paint();
  };

  removeColor = (index: undefined | null | number, color?: ColorString) => {
    if ((index === null || index === undefined) && color !== undefined) {
      index = this.#palette.indexOf(color);
    } else if (index === undefined || index === null) {
      throw new Error("Index or color must be provided");
    }
    if (index === -1) {
      throw new Error("Color not found in palette");
    }
    this.#palette.splice(index, 1);
    this.#texture = paletteToTexture(this.#palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#material.uniforms.paletteLength.value = this.#palette.length;
    this.#paint();
  };

  set progress(progress: number) {
    this.#progress = progress;
    this.#material.uniforms.progress.value = this.#progress;
    this.#paint();
  }

  get progress() {
    return this.#progress;
  }

  set progressAxis(axis: Axis) {
    // validate axis
    if (!Object.keys(this.#axisMap).includes(axis)) {
      throw new Error("Invalid axis. Must be one of 'x', 'y', or 'z'");
    }
    this.#progressAxis = axis;
    this.#material.uniforms.progress_axis.value = this.#axisMap[axis];
    this.#paint();
  }

  get progressAxis() {
    return this.#progressAxis;
  }

  set polarColorModel(model:SupportedColorModels) {
    // validate model
    if (!Object.keys(this.#colorModelMap).includes(model)) {
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