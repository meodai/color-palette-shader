import './style.css'

import { PaletteViz } from '../src';

const $palette = document.querySelector("[data-palette]");
const $tools = document.querySelector("[data-tools]");

const $app = document.querySelector("#app");
let size = window.innerWidth * 0.2;

let palette = [
  /*
  '#bc8b96', '#974b72', '#7f305c', '#5d2047', '#46173a', '#340d31', '#200816', 
  '#312234', '#40364a', '#5b596d', '#7c8497', '#9daec0', '#f8e6d0', '#dcbaa0', 
  '#c08e70', '#946452', '#683a34', '#442125', '#732f31', '#a23c3c', '#b45e4e', 
  '#cf8c52', '#e8c988', '#a3ab6d', '#5e8c51', '#436852', '#3e4350', '#381d4e',
  '#3c2c6a', '#444c84', '#5c79a6', '#8bc0ca',
 /*
  ...new Array(500).fill(0).map((_, i) => {
    return `hsl(${Math.random() * 360}, ${Math.random() * 100}%, ${
      Math.random() * 100
    }%)`;
  }),*/

  "#B71C1C",
  "#C62828",
  "#D32F2F",
  "#E53935",
  "#F44336",
  "#EF5350",
  "#E57373",
  "#EF9A9A",
  "#FFCDD2",
  "#FFEBEE",

  "#E65100",
  "#EF6C00",
  "#F57C00",
  "#FB8C00",
  "#FF9800",
  "#FFA726",
  "#FFB74D",
  "#FFCC80",
  "#FFE0B2",
  "#FFF3E0",

  "#1B5E20",
  "#2E7D32",
  "#388E3C",
  "#43A047",
  "#4CAF50",
  "#66BB6A",
  "#81C784",
  "#A5D6A7",
  "#C8E6C9",
  "#E8F5E9",

  "#01579B",
  "#0277BD",
  "#0288D1",
  "#039BE5",
  "#03A9F4",
  "#29B6F6",
  "#4FC3F7",
  "#81D4FA",
  "#B3E5FC",
  "#E1F5FE",

  "#212121",
  "#424242",
  "#616161",
  "#757575",
  "#9E9E9E",
  "#BDBDBD",
  "#E0E0E0",
  "#EEEEEE",
  "#F5F5F5",
  "#FAFAFA",
];

getNamesFromPalette(palette);

function getNamesFromPalette(palette) {
  fetch(
    `https://api.color.pizza/v1/?values=${palette
      .map((color) => color.slice(1))
      .join(",")}&list=bestOf&noduplicates=true`
  )
    .then((res) => res.json())
    .then((data) => {
      console.log(data.colors);
    });
}

const options = {
  palette,
  width: size,
  height: size,
  $parent: $app,
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
$hueSlider.min = 0;
$hueSlider.max = 1;
$hueSlider.step = 0.0001;
$hueSlider.value = 0;
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
  if (e.target.value === "slice") {
    viz.isPolar = false;
  } else {
    viz.isPolar = true;
  }
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

function createDomFromPalette (palette) {
  $palette.innerHTML = "";
  palette.forEach((color) => {
    const $picker = document.createElement("div");
    $picker.style.setProperty("--color", color);
    $picker.classList.add("color-picker", "palette__color");
    $picker.dataset.color = color;

    const $pickerInput = document.createElement("input");
    $pickerInput.type = "color";
    $pickerInput.value = color;
    $pickerInput.classList.add("color-picker-input");
    $picker.dataset.index = palette.indexOf(color);

    const $removeButton = document.createElement("button");
    $removeButton.textContent = "x";
    $removeButton.classList.add("color-picker__remove");

    $picker.appendChild($pickerInput);
    $picker.appendChild($removeButton);
    $palette.appendChild($picker);
  });
}

$palette.addEventListener("input", (e) => {
  // make sure the event comes from a color picker using the dataset
  if (e.target.parentElement.dataset.index !== undefined) {
    const $target = e.target;
    const index = parseInt($target.parentElement.dataset.index);
    $target.parentElement.style.setProperty("--color", $target.value);
    $target.parentElement.dataset.color = $target.value;
    viz.setColor($target.value, index);

    vizzes.forEach((v) => {
      v.setColor($target.value, index);
    });
  }
}, true);

$palette.addEventListener("click", (e) => {
  if (e.target.classList.contains("color-picker__remove")) {
    const $target = e.target;

    viz.removeColor(null, $target.parentElement.dataset.color);
    createDomFromPalette(viz.palette);
    $target.parentElement.remove();

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

