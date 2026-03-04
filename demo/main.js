import './style.css'

import { PaletteViz } from '../src';

const $palette = document.querySelector("[data-palette]");
const $tools = document.querySelector("[data-tools]");
const $app = document.querySelector("#app");

if (!$palette || !$tools || !$app) {
  throw new Error("Required DOM elements not found");
}

let size = window.innerWidth * 0.2;

let palette = [
  '#f2f0e5',
  '#b8b5b9',
  '#868188',
  '#646365',
  '#45444f',
  '#3a3858',
  '#212123',
  '#352b42',
  '#43436a',
  '#4b80ca',
  '#68c2d3',
  '#a2dcc7',
  '#ede19e',
  '#d3a068',
  '#b45252',
  '#6a536e',
  '#4b4158',
  '#80493a',
  '#a77b5b',
  '#e5ceb4',
  '#c2d368',
  '#8ab060',
  '#567b79',
  '#4e584a',
  '#7b7243',
  '#b2b47e',
  '#edc8c4',
  '#cf8acb',
  '#5f556a',
];

const options = {
  palette,
  width: size,
  height: size,
  $parent: $app,
  pixelRatio: devicePixelRatio * 2,
  uniforms: {
    progress_axis: { value: 0 },
  },
};

const viz = new PaletteViz(options);

const vizzes = [
  viz,
  new PaletteViz({
    ...options,
    uniforms: {
      progress_axis: { value: 1 },
    },
  }),
  new PaletteViz({
    ...options,
    uniforms: {
      progress_axis: { value: 2 },
    },
  }),
  new PaletteViz({
    ...options,
    uniforms: {
      progress_axis: { value: 0 },
      isPolar: { value: false },
    },
  }),
  new PaletteViz({
    ...options,
    uniforms: {
      progress_axis: { value: 1 },
      isPolar: { value: false },
    },
  }),
  new PaletteViz({
    ...options,
    uniforms: {
      progress_axis: { value: 2 },
      isPolar: { value: false },
    },
  }),
];

const $hueSlider = document.createElement('input');
$hueSlider.type = 'range';
$hueSlider.min = '0';
$hueSlider.max = '1';
$hueSlider.step = '0.0001';
$hueSlider.value = '0';
$hueSlider.classList.add('hue-slider');

$hueSlider.addEventListener('input', (e) => {
  const progress = parseFloat(e.target.value);
  vizzes.forEach((v) => {
    v.progress = progress;
  });
});

const $selectShader = document.createElement('select');
$selectShader.classList.add('shader-select');
$selectShader.innerHTML = `
  <option value="polar">Polar</option>
  <option value="slice">Slice</option>
`;
$selectShader.addEventListener("change", (e) => {
  viz.isPolar = e.target.value !== "slice";
});
$tools.appendChild($selectShader);


const $perccheckboxlabel = document.createElement('label');
$perccheckboxlabel.textContent = 'Perceptual';

$perccheckboxlabel.classList.add("perceptual-checkbox");

const $perceptualCheckbox = document.createElement('input');
$perceptualCheckbox.type = 'checkbox';
$perceptualCheckbox.checked = true;

$perccheckboxlabel.appendChild($perceptualCheckbox);

$perceptualCheckbox.addEventListener("change", (e) => {
  vizzes.forEach((v) => {
    v.isPerceptional = e.target.checked;
  });
});

$tools.appendChild($perccheckboxlabel);

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

window.addEventListener("resize", () => {
  viz.resize(window.innerWidth * 0.2);
});

function createDomFromPalette(palette) {
  $palette.innerHTML = "";
  palette.forEach((color, index) => {
    const $picker = document.createElement("div");
    $picker.style.setProperty("--color", color);
    $picker.classList.add("color-picker", "palette__color");
    $picker.dataset.color = color;

    const $pickerInput = document.createElement("input");
    $pickerInput.type = "color";
    $pickerInput.value = color;
    $pickerInput.classList.add("color-picker-input");
    $picker.dataset.index = index;

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
    vizzes.forEach((v) => {
      v.setColor($target.value, index);
    });
  }
}, true);

$palette.addEventListener("click", (e) => {
  if (e.target.classList.contains("color-picker__remove")) {
    const $target = e.target;

    viz.removeColor($target.parentElement.dataset.color);
    createDomFromPalette(viz.palette);

    vizzes.forEach((v) => {
      v.palette = viz.palette;
    });
  }
});

createDomFromPalette(palette);

$tools.appendChild($hueSlider);

$tools.appendChild($selectAxis);
$selectAxis.addEventListener('change', (e) => {
  vizzes.forEach((v) => {
    v.progressAxis = e.target.value;
  });
});

$debugCheckbox.addEventListener("change", (e) => {
  vizzes.forEach((v) => {
    v.debug = e.target.checked;
  });
});

$tools.appendChild($debuglabel);

$tools.appendChild($colorModel);
$colorModel.addEventListener('change', (e) => {
  vizzes.forEach((v) => {
    v.polarColorModel = e.target.value;
  });
});

$inverseLightnessCheckbox.addEventListener("change", (e) => {
  vizzes.forEach((v) => {
    v.invertZ = e.target.checked;
  });
});
$tools.appendChild($labelInverseLightness);
