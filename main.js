import './style.css'
import * as THREE from "three";

import shaderOKLab from "./shaders/oklab.frag.glsl?raw" assert { type: "raw" };
import shaderHSV2RGB from "./shaders/hsv2rgb.frag.glsl?raw" assert { type: "raw" };
import shaderHSL2RGB from "./shaders/hsl2rgb.frag.glsl?raw" assert { type: "raw" };
import shaderLCH2RGB from "./shaders/lch2rgb.frag.glsl?raw" assert { type: "raw" };

const $app = document.querySelector("#app");

let progress = 0.0;

const size = Math.min(window.innerWidth, window.innerHeight) * .6;

const $hueSlider = document.createElement('input');
$hueSlider.type = 'range';
$hueSlider.min = 0;
$hueSlider.max = 1;
$hueSlider.step = 0.0001;
$hueSlider.value = progress;
$hueSlider.classList.add('hue-slider');

$hueSlider.addEventListener('input', (e) => {
  progress = parseFloat(e.target.value);
});

const $selectShader = document.createElement('select');
$selectShader.classList.add('shader-select');
$selectShader.innerHTML = `
  <option value="polar">Polar</option>
  <option value="slice">Slice</option>
`;
$app.appendChild($selectShader);


const $perccheckboxlabel = document.createElement('label');
$perccheckboxlabel.textContent = 'Perceptual';

$perccheckboxlabel.classList.add("perceptual-checkbox");

const $perceptualCheckbox = document.createElement('input');
$perceptualCheckbox.type = 'checkbox';
$perceptualCheckbox.checked = true;

$perccheckboxlabel.appendChild($perceptualCheckbox);


const $debuglabel = document.createElement('label');
$debuglabel.textContent = 'Debug view';

const $debugCheckbox = document.createElement('input');
$debugCheckbox.type = 'checkbox';
$debugCheckbox.checked = false;

$debuglabel.appendChild($debugCheckbox);

const $colorModel = document.createElement('select');
$colorModel.classList.add('color-model-select');
$colorModel.innerHTML = `
  <option value="hsv">HSV</option>
  <option value="hsl">HSL</option>
  <option value="lch">LCh</option>
`;


const $selectAxis = document.createElement('select');
$selectAxis.innerHTML = `
  <option value="0">x</option>
  <option value="1">y</option>
  <option value="2">z</option>
`;

$selectAxis.classList.add('axis-select');

const palette = [
  
'#bc8b96', '#974b72', '#7f305c', '#5d2047', '#46173a', '#340d31', '#200816', 
'#312234', '#40364a', '#5b596d', '#7c8497', '#9daec0', '#f8e6d0', '#dcbaa0', 
'#c08e70', '#946452', '#683a34', '#442125', '#732f31', '#a23c3c', '#b45e4e', 
'#cf8c52', '#e8c988', '#a3ab6d', '#5e8c51', '#436852', '#3e4350', '#381d4e',
'#3c2c6a', '#444c84', '#5c79a6', '#8bc0ca',
 /*
  ...new Array(1000).fill(0).map((_, i) => {
    return `hsl(${Math.random() * 360}, ${Math.random() * 100}%, ${
      Math.random() * 100
    }%)`;
  }),*/
];


const $colorList = document.createElement('div');

$colorList.classList.add('color-list');

$app.appendChild($colorList);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
});
renderer.setSize(size, size);
$app.appendChild(renderer.domElement);


const shaderClosestColor = `
vec3 closestColor(vec3 color, sampler2D paletteTexture, int paletteSize) {
  float minDist = 1000000.0;
  vec3 closestColor = vec3(0.0);

  for (int i = 0; i < paletteSize; i++) {
    // Sample color from the texture
    vec3 paletteColor = texture2D(paletteTexture, vec2(float(i) / float(paletteSize), 0.5)).rgb;

    // Calculate distance between the sampled color and the input color
    float dist;
    if (isPerceptional) {
      dist = distance(linear_srgb_to_oklab(color), linear_srgb_to_oklab(paletteColor));
    } else {
      dist = distance(color, paletteColor);
    }

    // Update closest color if the distance is smaller
    if (dist < minDist) {
      minDist = dist;
      closestColor = paletteColor;
    }
  }

  return closestColor;
}`;

function paletteToTexture (palette) {
  const paletteColors = palette.map((color) => {
    const c = new THREE.Color(color);
    return { r: c.r, g: c.g, b: c.b, a: 1};
  } );
  const texture = new THREE.DataTexture(
    new Float32Array(paletteColors.flatMap((color) => [color.r, color.g, color.b, color.a])),
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

function paletteToShader (palette) {
  const texture = paletteToTexture(palette);

return new THREE.ShaderMaterial({
  uniforms: {
    progress: { value: 0.0 },
    progress_axis: { value: 1 },
    polarColorModel: { value: 0 }, // 0 = HSV, 1 = HSL
    time: { value: 0.0 },
    isPolar: { value: true },
    isPerceptional: { value: true },
    paletteTexture: { value: texture },
    paletteLength: { value: palette.length },
    debug: { value: false },
  },
  vertexShader: `varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = vec4(position, 1.);
      }`,
  fragmentShader: `
    #define TWO_PI 6.28318530718
    varying vec2 vUv;
    uniform float progress;
    uniform float time;
    uniform bool isPolar;
    uniform bool isPerceptional;
    uniform int progress_axis;
    uniform sampler2D paletteTexture;
    uniform int paletteLength;
    uniform bool debug;
    uniform int polarColorModel;

    ${shaderHSL2RGB}
    ${shaderHSV2RGB}
    ${shaderLCH2RGB}
    ${shaderOKLab}
    ${shaderClosestColor}

    vec3 polarToRGB(vec3 polar) {
      if (polarColorModel == 0) {
        return isPerceptional ? okhsv_to_srgb(polar) : hsv2rgb(polar);
      } else if (polarColorModel == 1) {
        return isPerceptional ? okhsl_to_srgb(polar) : hsl2rgb(polar);
      } else {
        return lch2rgb(vec3(polar.z, polar.y, polar.x));
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
        float radius = length(toCenter) * 1.5;
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

      vec3 rgb = vec3(0.);

      rgb = polarToRGB(hsv);
      
      vec3 closest = closestColor(rgb, paletteTexture, paletteLength);
      if (debug) {
        closest = rgb;
      }
      gl_FragColor = vec4(closest, 1.);
    }`,
});
}

const geometry = new THREE.PlaneGeometry(2, 2);
const cube = new THREE.Mesh(geometry, paletteToShader(palette));
scene.add(cube);
let time = 0;
function animate() {
  requestAnimationFrame(animate);
  cube.material.uniforms.progress.value = progress;
  cube.material.uniforms.time.value = time;
  time += 0.0001;
  renderer.render(scene, camera);
}

animate();


palette.forEach((color) => {
  const $picker = document.createElement("div");
  $picker.style.setProperty("--color", color);
  $picker.classList.add("color-picker");

  const $pickerInput = document.createElement("input");
  $pickerInput.type = "color";
  $pickerInput.value = color;
  $pickerInput.classList.add("color-picker-input");
  $pickerInput.dataset.index = palette.indexOf(color);

  $picker.appendChild($pickerInput);

  $colorList.appendChild($picker);

  $pickerInput.addEventListener("input", (e) => {
    const index = parseInt(e.target.dataset.index);
    palette[index] = e.target.value;

    cube.material.uniforms.paletteTexture.value = paletteToTexture(palette);
    cube.material.uniforms.paletteLength.value = palette.length;

    $picker.style.setProperty("--color", e.target.value);
  });
});


$app.appendChild($hueSlider);
$selectShader.addEventListener('change', (e) => {
  if(e.target.value === 'slice'){
    cube.material.uniforms.isPolar.value = false;
  } else {
    cube.material.uniforms.isPolar.value = true;
  }
});

$perceptualCheckbox.addEventListener("change", (e) => {
  cube.material.uniforms.isPerceptional.value = e.target.checked;
});

$app.appendChild($perccheckboxlabel);

$app.appendChild($selectAxis);
$selectAxis.addEventListener('change', (e) => {
  // x = 0, y = 1, z = 2
  cube.material.uniforms.progress_axis.value = parseInt(e.target.value);
});

$debugCheckbox.addEventListener("change", (e) => {
  cube.material.uniforms.debug.value = e.target.checked;
});
$app.appendChild($debuglabel);

$app.appendChild($colorModel);
$colorModel.addEventListener('change', (e) => {
  const value = e.target.value;
  if(value === 'hsv'){
    cube.material.uniforms.polarColorModel.value = 0;
  } else if(value === 'hsl'){
    cube.material.uniforms.polarColorModel.value = 1;
  } else {
    cube.material.uniforms.polarColorModel.value = 2;
  }
});