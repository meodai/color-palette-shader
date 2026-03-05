import './style.css';
import { PaletteViz } from 'palette-shader';

const $palette = document.querySelector('[data-palette]');
const $tools = document.querySelector('[data-tools]');
const $app = document.querySelector('#app');
const $palettePaste = document.querySelector('[data-palette-paste]');

if (!$palette || !$tools || !$app || !$palettePaste) {
  throw new Error('Required DOM elements not found');
}

const palette = [
  '#d1b187',
  '#c77b58',
  '#ae5d40',
  '#79444a',
  '#4b3d44',
  '#ba9158',
  '#927441',
  '#4d4539',
  '#77743b',
  '#b3a555',
  '#d2c9a5',
  '#8caba1',
  '#4b726e',
  '#574852',
  '#847875',
  '#ab9b8e',
];

function vizSize() {
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  const cols = portrait ? 2 : 3;
  const padding = portrait ? 16 : 32;
  const sidebarWidth = portrait ? 0 : Math.min(320, Math.max(200, window.innerWidth * 0.35));
  const vizWidth = window.innerWidth - sidebarWidth - padding;
  return Math.floor(vizWidth / cols);
}

const sharedOptions = {
  palette,
  width: vizSize(),
  height: vizSize(),
  container: $app,
  pixelRatio: devicePixelRatio * 2,
};

const viz = new PaletteViz({ ...sharedOptions, axis: 'x', position: 0 });

const vizzes = [
  viz,
  new PaletteViz({ ...sharedOptions, axis: 'y', position: 0 }),
  new PaletteViz({ ...sharedOptions, axis: 'z', position: 0 }),
  new PaletteViz({ ...sharedOptions, axis: 'x', position: 1 }),
  new PaletteViz({ ...sharedOptions, axis: 'y', position: 1 }),
  new PaletteViz({ ...sharedOptions, axis: 'z', position: 1 }),
];
// t=0 default: first row at 0 (one extreme), second row at 1 (other side)

// ── Controls ────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  const s = vizSize();
  vizzes.forEach((v) => v.resize(s));
});

function labeled(text, el) {
  const $label = document.createElement('label');
  const $span = document.createElement('span');
  $span.textContent = text;
  $label.appendChild($span);
  $label.appendChild(el);
  return $label;
}

// Color model
const $colorModel = document.createElement('select');
$colorModel.innerHTML = `
  <option value="okhslPolar">OKHsl Polar</option>
  <option value="okhsl">OKHsl</option>
  <option value="okhsv">OKHsv</option>
  <option value="okhsvPolar">OKHsv Polar</option>
  <option value="oklch">OKLch</option>
  <option value="oklchPolar">OKLch Polar</option>
  <option value="hsl">HSL</option>
  <option value="hslPolar">HSL Polar</option>
  <option value="hsv">HSV</option>
  <option value="hsvPolar">HSV Polar</option>
  <option value="oklab">OKLab</option>
  <option value="rgb">RGB</option>
`;
$colorModel.addEventListener('change', (e) => {
  vizzes.forEach((v) => {
    v.colorModel = e.target.value;
  });
});
$tools.appendChild(labeled('Color model', $colorModel));
// Set initial color model
vizzes.forEach((v) => {
  v.colorModel = $colorModel.value;
});

// Distance metric
const $distanceMetric = document.createElement('select');
$distanceMetric.innerHTML = `
  <option value="oklab">OKLab</option>
  <option value="deltaE2000">ΔE2000 (slow)</option>
  <option value="deltaE94">ΔE94 (slow)</option>
  <option value="deltaE76">ΔE76 (slow)</option>
  <option value="kotsarenkoRamos">Kotsarenko/Ramos</option>
  <option value="rgb">RGB</option>
`;
$distanceMetric.addEventListener('change', (e) => {
  vizzes.forEach((v) => {
    v.distanceMetric = e.target.value;
  });
});
$tools.appendChild(labeled('Distance metric', $distanceMetric));
// Set initial distance metric
vizzes.forEach((v) => {
  v.distanceMetric = $distanceMetric.value;
});

// Position slider (t=1 → faces at 0 and 1; t=0.5 → faces at 0.25 and 0.75)
const $positionSlider = document.createElement('input');
$positionSlider.type = 'range';
$positionSlider.min = '0';
$positionSlider.max = '1';
$positionSlider.step = '0.0001';
$positionSlider.value = '0';

function applyPosition(t) {
  vizzes.slice(0, 3).forEach((v) => {
    v.position = t;
  });
  vizzes.slice(3, 6).forEach((v) => {
    v.position = 1 - t;
  });
}

$positionSlider.addEventListener('input', (e) => {
  applyPosition(parseFloat(e.target.value));
});
applyPosition(0);
$tools.appendChild(labeled('Position', $positionSlider));

// Invert lightness
const $invertZCheckbox = document.createElement('input');
$invertZCheckbox.type = 'checkbox';
$invertZCheckbox.checked = false;
$invertZCheckbox.addEventListener('change', (e) => {
  vizzes.forEach((v) => {
    v.invertZ = e.target.checked;
  });
});
$tools.appendChild(labeled('Invert Z', $invertZCheckbox));

// Show raw (debug)
const $showRawCheckbox = document.createElement('input');
$showRawCheckbox.type = 'checkbox';
$showRawCheckbox.checked = false;
$showRawCheckbox.addEventListener('change', (e) => {
  vizzes.forEach((v) => {
    v.showRaw = e.target.checked;
  });
});
$tools.appendChild(labeled('Show raw colors', $showRawCheckbox));

// ── Palette editor ──────────────────────────────────────────────────────────

function createDomFromPalette(palette) {
  $palette.innerHTML = '';
  palette.forEach((color, index) => {
    const $picker = document.createElement('div');
    $picker.style.setProperty('--color', color);
    $picker.classList.add('color-picker', 'palette__color');
    $picker.dataset.color = color;
    $picker.dataset.index = index;

    const $pickerInput = document.createElement('input');
    $pickerInput.type = 'color';
    $pickerInput.value = color;
    $pickerInput.classList.add('color-picker-input');

    const $removeButton = document.createElement('button');
    $removeButton.textContent = 'x';
    $removeButton.classList.add('color-picker__remove');

    $picker.appendChild($pickerInput);
    $picker.appendChild($removeButton);
    $palette.appendChild($picker);
  });
}

$palette.addEventListener(
  'input',
  (e) => {
    if (e.target.parentElement.dataset.index !== undefined) {
      const $target = e.target;
      const index = parseInt($target.parentElement.dataset.index);
      $target.parentElement.style.setProperty('--color', $target.value);
      $target.parentElement.dataset.color = $target.value;
      vizzes.forEach((v) => {
        v.setColor($target.value, index);
      });
    }
  },
  true,
);

$palette.addEventListener('click', (e) => {
  if (e.target.classList.contains('color-picker__remove')) {
    viz.removeColor(e.target.parentElement.dataset.color);
    createDomFromPalette(viz.palette);
    vizzes.forEach((v) => {
      v.palette = viz.palette;
    });
  }
});

// ── Paste field ─────────────────────────────────────────────────────────────

$palettePaste.addEventListener('input', () => {
  const raw = $palettePaste.value;
  const colors = raw
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^#?/, '#'))
    .filter((s) => /^#([0-9a-f]{3}){1,2}$/i.test(s));
  if (colors.length < 2) return;
  vizzes.forEach((v) => {
    v.palette = colors;
  });
  createDomFromPalette(colors);
});

createDomFromPalette(palette);

// ── URL hash state ───────────────────────────────────────────────────────────

function encodeHash(colors, settings) {
  const colorStr = colors.map((c) => c.replace('#', '')).join('-');
  const params = new URLSearchParams({
    model: settings.colorModel,
    metric: settings.distanceMetric,
    pos: settings.pos.toFixed(4),
    ...(settings.invertZ && { invert: '1' }),
    ...(settings.showRaw && { raw: '1' }),
  });
  return `#colors/${colorStr}?${params}`;
}

function decodeHash(hash) {
  if (!hash || !hash.startsWith('#colors/')) return null;
  const withoutPrefix = hash.slice('#colors/'.length);
  const [colorPart, queryPart] = withoutPrefix.split('?');

  const colors = colorPart
    .split('-')
    .map((h) => `#${h}`)
    .filter((c) => /^#([0-9a-f]{3}){1,2}$/i.test(c));

  if (colors.length < 2) return null;

  const params = new URLSearchParams(queryPart || '');
  return {
    colors,
    colorModel: params.get('model') || 'okhsl',
    distanceMetric: params.get('metric') || 'oklab',
    pos: parseFloat(params.get('pos') ?? '0'),
    invertZ: params.get('invert') === '1',
    showRaw: params.get('raw') === '1',
  };
}

function getSettings() {
  return {
    colorModel: $colorModel.value,
    distanceMetric: $distanceMetric.value,
    pos: parseFloat($positionSlider.value),
    invertZ: $invertZCheckbox.checked,
    showRaw: $showRawCheckbox.checked,
  };
}

function applyState(state) {
  // palette
  vizzes.forEach((v) => {
    v.palette = state.colors;
  });
  createDomFromPalette(state.colors);

  // controls
  $colorModel.value = state.colorModel;
  $distanceMetric.value = state.distanceMetric;
  $positionSlider.value = String(state.pos);
  $invertZCheckbox.checked = state.invertZ;
  $showRawCheckbox.checked = state.showRaw;

  vizzes.forEach((v) => {
    v.colorModel = state.colorModel;
    v.distanceMetric = state.distanceMetric;
    v.invertZ = state.invertZ;
    v.showRaw = state.showRaw;
  });
  applyPosition(state.pos);
}

// debounced hash writer
let _hashTimer = null;
function scheduleHashUpdate() {
  clearTimeout(_hashTimer);
  _hashTimer = setTimeout(() => {
    const hash = encodeHash(viz.palette, getSettings());
    history.replaceState(null, '', hash);
  }, 400);
}

// hook all control changes to also update hash
$colorModel.addEventListener('change', scheduleHashUpdate);
$distanceMetric.addEventListener('change', scheduleHashUpdate);
$positionSlider.addEventListener('input', scheduleHashUpdate);
$invertZCheckbox.addEventListener('change', scheduleHashUpdate);
$showRawCheckbox.addEventListener('change', scheduleHashUpdate);
$palette.addEventListener('input', scheduleHashUpdate, true);
$palette.addEventListener('click', (e) => {
  if (e.target.classList.contains('color-picker__remove')) scheduleHashUpdate();
});
$palettePaste.addEventListener('input', scheduleHashUpdate);

// async load from hash — after first paint so it never blocks rendering
requestAnimationFrame(() => {
  setTimeout(() => {
    const state = decodeHash(location.hash);
    if (state) applyState(state);
  }, 0);
});
