import './style.css'

import { PaletteViz } from './src';

const $app = document.querySelector("#app");
let size = Math.min(window.innerWidth, window.innerHeight) * 0.6;

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

const viz = new PaletteViz({
  palette,
  width: size,
  height: size,
});

const $hueSlider = document.createElement('input');
$hueSlider.type = 'range';
$hueSlider.min = 0;
$hueSlider.max = 1;
$hueSlider.step = 0.0001;
$hueSlider.value = 0;
$hueSlider.classList.add('hue-slider');

$hueSlider.addEventListener('input', (e) => {
  viz.progress = parseFloat(e.target.value);
});

const $selectShader = document.createElement('select');
$selectShader.classList.add('shader-select');
$selectShader.innerHTML = `
  <option value="polar">Polar</option>
  <option value="slice">Slice</option>
`;
$selectShader.addEventListener("change", (e) => {
  if (e.target.value === "slice") {
    viz.isPolar = false;
  } else {
    viz.isPolar = true;
  }
});
$app.appendChild($selectShader);


const $perccheckboxlabel = document.createElement('label');
$perccheckboxlabel.textContent = 'Perceptual';

$perccheckboxlabel.classList.add("perceptual-checkbox");

const $perceptualCheckbox = document.createElement('input');
$perceptualCheckbox.type = 'checkbox';
$perceptualCheckbox.checked = true;

$perccheckboxlabel.appendChild($perceptualCheckbox);


$perceptualCheckbox.addEventListener("change", (e) => {
  viz.isPerceptional = e.target.checked;
});

$app.appendChild($perccheckboxlabel);

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
  <option value="x">x</option>
  <option value="y" selected="selected">y</option>
  <option value="z">z</option>
`;

$selectAxis.classList.add('axis-select');

const $labelInverseLightness = document.createElement('label');
$labelInverseLightness.textContent = 'InvertZ lightness';

const $inverseLightnessCheckbox = document.createElement('input');
$inverseLightnessCheckbox.type = 'checkbox';
$inverseLightnessCheckbox.checked = false;

$labelInverseLightness.appendChild($inverseLightnessCheckbox);

const $colorList = document.createElement('div');

$colorList.classList.add('color-list');

$app.appendChild($colorList);

window.addEventListener("resize", () => {
  viz.resize(Math.min(window.innerWidth, window.innerHeight) * 0.6);
});

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

    viz.setColor(e.target.value, index);

    $picker.style.setProperty("--color", e.target.value);
  });
});


$app.appendChild($hueSlider);


$app.appendChild($selectAxis);
$selectAxis.addEventListener('change', (e) => {
  viz.progressAxis = e.target.value;
});

$debugCheckbox.addEventListener("change", (e) => {
  viz.debug = e.target.checked;
});

$app.appendChild($debuglabel);

$app.appendChild($colorModel);
$colorModel.addEventListener('change', (e) => {
  viz.polarColorModel = e.target.value;
});

$inverseLightnessCheckbox.addEventListener("change", (e) => {
  viz.invertZ = e.target.checked;
});
$app.appendChild($labelInverseLightness);

