import * as THREE from "three";

import shaderSRGB2RGB from "./shaders/srgb2rgb.frag.glsl?raw" assert { type: "raw" };
import shaderOKLab from "./shaders/oklab.frag.glsl?raw" assert { type: "raw" };
import shaderHSV2RGB from "./shaders/hsv2rgb.frag.glsl?raw" assert { type: "raw" };
import shaderHSL2RGB from "./shaders/hsl2rgb.frag.glsl?raw" assert { type: "raw" };
import shaderLCH2RGB from "./shaders/lch2rgb.frag.glsl?raw" assert { type: "raw" };
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

${shaderSRGB2RGB}
${shaderHSL2RGB}
${shaderHSV2RGB}
${shaderLCH2RGB}
${shaderOKLab}
${shaderClosestColor}

vec3 polarToRGB(vec3 polar) {
  if (polarColorModel == 0) {
    return isPerceptional ? srgb2rgb(okhsv_to_srgb(polar)) : hsv2rgb(polar);
  } else if (polarColorModel == 1) {
    return isPerceptional ? srgb2rgb(okhsl_to_srgb(polar)) : hsl2rgb(polar);
  } else {
    return srgb2rgb(lch2rgb(vec3(polar.z, polar.y, polar.x)));
  }
}
void main(){
  vec3 hsv = vec3(progress, vUv.x, vUv.y);
  if(progress_axis == 1){
    hsv = vec3(vUv.x, progress, vUv.y);
  } else if(progress_axis == 2){
    hsv = vec3(vUv.x, vUv.y, progress);
  }

  if(isPolar) {
    vec2 toCenter = vUv - 0.5;
    float angle = atan(toCenter.y, toCenter.x);
    float radius = length(toCenter) * 2.0;
    hsv = vec3((angle / TWO_PI), 1. - progress, radius);
    if(progress_axis == 2){
      hsv = vec3((angle / TWO_PI), radius, 1. - progress);
    } else if(progress_axis == 1){
      hsv = vec3((angle / TWO_PI), 1. - progress, radius);
    } else {
      float hue = 1.0 - abs(0.5 - progress * .5) * 2.0;
      if (vUv.x > 0.5) {
        hue += 0.5;
      }
      hsv = vec3(hue, abs(0.5 - vUv.x) * 2.0, vUv.y);
    }
  }

  if(invertZ){
    hsv.z = 1. - hsv.z;
  }
  vec3 rgb = polarToRGB(hsv);
  vec3 closest = closestColor(rgb, paletteTexture, paletteLength);

  if (debug) {
    closest = rgb;
  }

  gl_FragColor = vec4(closest, 1.);
}`;

export const paletteToTexture = (palette) => {
    const paletteColors = palette.map((color) => {
      const c = new THREE.Color(color);
      return { r: c.r, g: c.g, b: c.b, a: 1 };
    });
    const texture = new THREE.DataTexture(
      new Float32Array(
        paletteColors.flatMap((color) => [color.r, color.g, color.b, color.a])
      ),
      palette.length,
      1,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    texture.needsUpdate = true;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;

    return texture;
  }

export const randomPalette = (size = 20) => {
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
  paletteTexture: { value: paletteToTexture(randomPalette(10)) },
  paletteLength: { value: 10 },
  debug: { value: false },
  invertZ: { value: false },
};

const paletteShaderMaterial = new THREE.ShaderMaterial({
  uniforms: paletteShaderUniforms,
  vertexShader: `varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position, 1.);
    }`,
  fragmentShader,
});

export class PaletteViz {
  #palette = [];
  #width = 512;
  #height = 512;

  // uniforms
  #uniforms = paletteShaderUniforms;
  #animationFrame = null;
  #progress = 0.0;
  #progressAxis = "y";
  #polarColorModel = "hsv";
  #isPolar = true;
  #isPerceptional = true;
  #debug = false;
  #invertZ = false;

  // uniform helpers
  #axisMap = { x: 0, y: 1, z: 2 };
  #colorModelMap = { hsv: 0, hsl: 1, lch: 2 };

  // three.js
  #texture = null;
  #material = null;
  #geometry = null;
  #mesh = null;
  #renderer = null;
  #camera = null;
  #scene = null;
  #pixelRatio = 1;

  // dom
  #$renderer = null;
  #$parent = null;

  constructor({
    palette = randomPalette(),
    width = 512,
    height = 512,
    pixelRatio = window.devicePixelRatio,
    uniforms = paletteShaderUniforms,
    $parent = document.body,
  } = {}) {
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
    this.#scene = new THREE.Scene();
    this.#camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1);
    this.#renderer = new THREE.WebGLRenderer();
    this.#renderer.setPixelRatio(this.#pixelRatio);
    this.#renderer.setSize(this.#width, this.#height);
    this.#$renderer = this.#renderer.domElement;

    this.#geometry = new THREE.PlaneGeometry(2, 2);
    this.#mesh = new THREE.Mesh(this.#geometry, this.#material);
    this.#scene.add(this.#mesh);
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

  resize(width, height) {
    if (height === undefined) {
      height = width;
    }
    this.#width = width;
    this.#height = height;
    this.#renderer.setSize(width, height);
    this.#camera.updateProjectionMatrix();
  }

  set palette(palette) {
    this.#palette = palette;
    this.#texture = paletteToTexture(palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#material.uniforms.paletteLength.value = palette.length;
    this.#paint();
  }

  setColor = (color, index) => {
    this.#palette[index] = color;
    this.#texture = paletteToTexture(this.#palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#paint();
  };

  addColor = (color, index) => {
    if (index === undefined) {
      index = this.#palette.length;
    }
    this.#palette.splice(index, 0, color);
    this.#texture = paletteToTexture(this.#palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#material.uniforms.paletteLength.value = this.#palette.length;
  };

  removeColor = (index, color) => {
    // if index is not provided, look for the color in the palette
    if (index === undefined && color !== undefined) {
      index = this.#palette.indexOf(color);
    } else if (index === undefined) {
      throw new Error("Index or color must be provided");
    }
    this.#palette.splice(index, 1);
    this.#texture = paletteToTexture(this.#palette);
    this.#material.uniforms.paletteTexture.value = this.#texture;
    this.#material.uniforms.paletteLength.value = this.#palette.length;
  };

  set progress(progress) {
    this.#progress = parseFloat(progress);
    this.#material.uniforms.progress.value = this.#progress;
    this.#paint();
  }

  get progress() {
    return this.#progress;
  }

  set progressAxis(axis) {
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

  set polarColorModel(model) {
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

  set isPolar(isPolar) {
    this.#isPolar = isPolar;
    this.#material.uniforms.isPolar.value = isPolar;
    this.#paint();
  }

  get isPolar() {
    return this.#isPolar;
  }

  set isPerceptional(isPerceptional) {
    this.#isPerceptional = isPerceptional;
    this.#material.uniforms.isPerceptional.value = isPerceptional;
    this.#paint();
  }

  get isPerceptional() {
    return this.#isPerceptional;
  }

  set debug(debug) {
    this.#debug = debug;
    this.#material.uniforms.debug.value = debug;
    this.#paint();
  }

  get debug() {
    return this.#debug;
  }

  set invertZ(invertZ) {
    this.#invertZ = invertZ;
    this.#material.uniforms.invertZ.value = invertZ;
    this.#paint();
  }

  get invertZ() {
    return this.#invertZ;
  }

  static paletteToTexture = (palette) => paletteToTexture(palette);
}