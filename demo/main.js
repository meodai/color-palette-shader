import './style.css'
import { PaletteViz } from '../src';

const $palette = document.querySelector("[data-palette]");
const $tools = document.querySelector("[data-tools]");
const $app = document.querySelector("#app");

if (!$palette || !$tools || !$app) {
  throw new Error("Required DOM elements not found");
}

const palette = [
  '#f2f0e5', '#b8b5b9', '#868188', '#646365', '#45444f',
  '#3a3858', '#212123', '#352b42', '#43436a', '#4b80ca',
  '#68c2d3', '#a2dcc7', '#ede19e', '#d3a068', '#b45252',
  '#6a536e', '#4b4158', '#80493a', '#a77b5b', '#e5ceb4',
  '#c2d368', '#8ab060', '#567b79', '#4e584a', '#7b7243',
  '#b2b47e', '#edc8c4', '#cf8acb', '#5f556a',
];

const size = window.innerWidth * 0.2;

const sharedOptions = {
  palette,
  width: size,
  height: size,
  container: $app,
  pixelRatio: devicePixelRatio * 2,
};

const viz = new PaletteViz({ ...sharedOptions, axis: 'x' });

const vizzes = [
  viz,
  new PaletteViz({ ...sharedOptions, axis: 'y' }),
  new PaletteViz({ ...sharedOptions, axis: 'z' }),
  new PaletteViz({ ...sharedOptions, axis: 'x', isPolar: false }),
  new PaletteViz({ ...sharedOptions, axis: 'y', isPolar: false }),
  new PaletteViz({ ...sharedOptions, axis: 'z', isPolar: false }),
];

// ── Controls ────────────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
  vizzes.forEach((v) => v.resize(window.innerWidth * 0.2));
});

// Position slider
const $positionSlider = document.createElement('input');
$positionSlider.type = 'range';
$positionSlider.min = '0';
$positionSlider.max = '1';
$positionSlider.step = '0.0001';
$positionSlider.value = '0';
$positionSlider.classList.add('hue-slider');

$positionSlider.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  vizzes.forEach((v) => { v.position = value; });
});

// Polar / slice toggle
const $selectMode = document.createElement('select');
$selectMode.classList.add('shader-select');
$selectMode.innerHTML = `
  <option value="polar">Polar</option>
  <option value="slice">Slice</option>
`;
$selectMode.addEventListener("change", (e) => {
  viz.isPolar = e.target.value !== "slice";
});
$tools.appendChild($selectMode);

// Axis
const $selectAxis = document.createElement('select');
$selectAxis.classList.add('axis-select');
$selectAxis.innerHTML = `
  <option value="x">x</option>
  <option value="y">y</option>
  <option value="z">z</option>
`;
$selectAxis.addEventListener('change', (e) => {
  vizzes.forEach((v) => { v.axis = e.target.value; });
});
$tools.appendChild($selectAxis);

// Color model
const $colorModel = document.createElement('select');
$colorModel.classList.add('color-model-select');
$colorModel.innerHTML = `
  <option value="okhsv">OKHsv</option>
  <option value="okhsl">OKHsl</option>
  <option value="oklch">OKLch</option>
  <option value="hsv">HSV</option>
  <option value="hsl">HSL</option>
`;
$colorModel.addEventListener('change', (e) => {
  vizzes.forEach((v) => { v.colorModel = e.target.value; });
});
$tools.appendChild($colorModel);

// Distance metric
const $distanceMetric = document.createElement('select');
$distanceMetric.classList.add('distance-metric-select');
$distanceMetric.innerHTML = `
  <option value="oklab">OKLab</option>
  <option value="deltaE2000">ΔE2000</option>
  <option value="deltaE76">ΔE76</option>
  <option value="rgb">RGB</option>
`;
$distanceMetric.addEventListener('change', (e) => {
  vizzes.forEach((v) => { v.distanceMetric = e.target.value; });
});
$tools.appendChild($distanceMetric);

// Invert lightness
const $invertLightnessLabel = document.createElement('label');
$invertLightnessLabel.textContent = 'Invert lightness';
const $invertLightnessCheckbox = document.createElement('input');
$invertLightnessCheckbox.type = 'checkbox';
$invertLightnessCheckbox.checked = false;
$invertLightnessLabel.appendChild($invertLightnessCheckbox);
$invertLightnessCheckbox.addEventListener("change", (e) => {
  vizzes.forEach((v) => { v.invertLightness = e.target.checked; });
});
$tools.appendChild($invertLightnessLabel);

// Show raw (debug)
const $showRawLabel = document.createElement('label');
$showRawLabel.textContent = 'Show raw colors';
const $showRawCheckbox = document.createElement('input');
$showRawCheckbox.type = 'checkbox';
$showRawCheckbox.checked = false;
$showRawLabel.appendChild($showRawCheckbox);
$showRawCheckbox.addEventListener("change", (e) => {
  vizzes.forEach((v) => { v.showRaw = e.target.checked; });
});
$tools.appendChild($showRawLabel);

// ── Palette editor ──────────────────────────────────────────────────────────

function createDomFromPalette(palette) {
  $palette.innerHTML = "";
  palette.forEach((color, index) => {
    const $picker = document.createElement("div");
    $picker.style.setProperty("--color", color);
    $picker.classList.add("color-picker", "palette__color");
    $picker.dataset.color = color;
    $picker.dataset.index = index;

    const $pickerInput = document.createElement("input");
    $pickerInput.type = "color";
    $pickerInput.value = color;
    $pickerInput.classList.add("color-picker-input");

    const $removeButton = document.createElement("button");
    $removeButton.textContent = "x";
    $removeButton.classList.add("color-picker__remove");

    $picker.appendChild($pickerInput);
    $picker.appendChild($removeButton);
    $palette.appendChild($picker);
  });
}

$palette.addEventListener("input", (e) => {
  if (e.target.parentElement.dataset.index !== undefined) {
    const $target = e.target;
    const index = parseInt($target.parentElement.dataset.index);
    $target.parentElement.style.setProperty("--color", $target.value);
    $target.parentElement.dataset.color = $target.value;
    vizzes.forEach((v) => { v.setColor($target.value, index); });
  }
}, true);

$palette.addEventListener("click", (e) => {
  if (e.target.classList.contains("color-picker__remove")) {
    viz.removeColor(e.target.parentElement.dataset.color);
    createDomFromPalette(viz.palette);
    vizzes.forEach((v) => { v.palette = viz.palette; });
  }
});

createDomFromPalette(palette);
$tools.appendChild($positionSlider);
