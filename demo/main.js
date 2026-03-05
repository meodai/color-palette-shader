import './style.css';
import { PaletteViz } from 'palette-shader';
import { TargetSession, extractColorTokens } from 'token-beam';

const randomColor = () =>
  `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`;

const $palette = document.querySelector('[data-palette]');
const $tools = document.querySelector('[data-tools]');
const $app = document.querySelector('#app');
const $palettePaste = document.querySelector('[data-palette-paste]');

if (!$palette || !$tools || !$app || !$palettePaste) {
  throw new Error('Required DOM elements not found');
}

const palettes = [
  ['#f0dab1', '#e39aac', '#c45d9f', '#634b7d', '#6461c2', '#2ba9b4', '#93d4b5', '#f0f6e8'],
  [
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
  ],
  [
    '#413652',
    '#6f577e',
    '#986f9c',
    '#c090a7',
    '#d4beb8',
    '#eae4dd',
    '#c9d4b8',
    '#90c0a0',
    '#6f919c',
    '#62778c',
    '#575f7e',
  ],
  [
    '#be4a2f',
    '#d77643',
    '#ead4aa',
    '#e4a672',
    '#b86f50',
    '#733e39',
    '#3e2731',
    '#a22633',
    '#e43b44',
    '#f77622',
    '#feae34',
    '#fee761',
    '#63c74d',
    '#3e8948',
    '#265c42',
    '#193c3e',
    '#124e89',
    '#0099db',
    '#2ce8f5',
    '#ffffff',
    '#c0cbdc',
    '#8b9bb4',
    '#5a6988',
    '#3a4466',
    '#262b44',
    '#181425',
    '#ff0044',
    '#68386c',
    '#b55088',
    '#f6757a',
    '#e8b796',
    '#c28569',
  ],
  [
    '#000000',
    '#1D2B53',
    '#7E2553',
    '#008751',
    '#AB5236',
    '#5F574F',
    '#C2C3C7',
    '#FFF1E8',
    '#FF004D',
    '#FFA300',
    '#FFEC27',
    '#00E436',
    '#29ADFF',
    '#83769C',
    '#FF77A8',
    '#FFCCAA',
  ],
  [
    '#636663',
    '#87857c',
    '#bcad9f',
    '#f2b888',
    '#eb9661',
    '#b55945',
    '#734c44',
    '#3d3333',
    '#593e47',
    '#7a5859',
    '#a57855',
    '#de9f47',
    '#fdd179',
    '#fee1b8',
    '#d4c692',
    '#a6b04f',
    '#819447',
    '#44702d',
    '#2f4d2f',
    '#546756',
    '#89a477',
    '#a4c5af',
    '#cae6d9',
    '#f1f6f0',
    '#d5d6db',
    '#bbc3d0',
    '#96a9c1',
    '#6c81a1',
    '#405273',
    '#303843',
    '#14233a',
  ],
  [
    '#1f240a',
    '#39571c',
    '#a58c27',
    '#efac28',
    '#efd8a1',
    '#ab5c1c',
    '#183f39',
    '#ef692f',
    '#efb775',
    '#a56243',
    '#773421',
    '#724113',
    '#2a1d0d',
    '#392a1c',
    '#684c3c',
    '#927e6a',
    '#276468',
    '#ef3a0c',
    '#45230d',
    '#3c9f9c',
    '#9b1a0a',
    '#36170c',
    '#550f0a',
    '#300f0a',
  ],
  [
    '#000000',
    '#6f6776',
    '#9a9a97',
    '#c5ccb8',
    '#8b5580',
    '#c38890',
    '#a593a5',
    '#666092',
    '#9a4f50',
    '#c28d75',
    '#7ca1c0',
    '#416aa3',
    '#8d6268',
    '#be955c',
    '#68aca9',
    '#387080',
    '#6e6962',
    '#93a167',
    '#6eaa78',
    '#557064',
    '#9d9f7f',
    '#7e9e99',
    '#5d6872',
    '#433455',
  ],
];

const palette = palettes[Math.floor(Math.random() * palettes.length)];

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

// Outline width
const $outlineSlider = document.createElement('input');
$outlineSlider.type = 'range';
$outlineSlider.min = '0';
$outlineSlider.max = '10';
$outlineSlider.step = '0.5';
$outlineSlider.value = '0';
$outlineSlider.addEventListener('input', (e) => {
  vizzes.forEach((v) => {
    v.outlineWidth = parseFloat(e.target.value);
  });
});
$tools.appendChild(labeled('Outline width', $outlineSlider));

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

  const $addButton = document.createElement('button');
  $addButton.textContent = '+';
  $addButton.classList.add('palette__add');
  $addButton.addEventListener('click', () => {
    const color = randomColor();
    viz.addColor(color);
    vizzes.forEach((v) => {
      v.palette = viz.palette;
    });
    createDomFromPalette(viz.palette);
    scheduleHashUpdate();
  });
  $palette.appendChild($addButton);
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
    ...(settings.outlineWidth > 0 && { outline: settings.outlineWidth.toString() }),
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
    outlineWidth: parseFloat(params.get('outline') ?? '0'),
  };
}

function getSettings() {
  return {
    colorModel: $colorModel.value,
    distanceMetric: $distanceMetric.value,
    pos: parseFloat($positionSlider.value),
    invertZ: $invertZCheckbox.checked,
    showRaw: $showRawCheckbox.checked,
    outlineWidth: parseFloat($outlineSlider.value),
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
  $outlineSlider.value = String(state.outlineWidth);

  vizzes.forEach((v) => {
    v.colorModel = state.colorModel;
    v.distanceMetric = state.distanceMetric;
    v.invertZ = state.invertZ;
    v.showRaw = state.showRaw;
    v.outlineWidth = state.outlineWidth;
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
$outlineSlider.addEventListener('input', scheduleHashUpdate);
$invertZCheckbox.addEventListener('change', scheduleHashUpdate);
$showRawCheckbox.addEventListener('change', scheduleHashUpdate);
$palette.addEventListener('input', scheduleHashUpdate, true);
$palette.addEventListener('click', (e) => {
  if (e.target.classList.contains('color-picker__remove')) scheduleHashUpdate();
});
$palettePaste.addEventListener('input', scheduleHashUpdate);

// ── Token Beam receiver ──────────────────────────────────────────────────────

const $beamToken = document.querySelector('[data-beam-token]');
const $beamConnect = document.querySelector('[data-beam-connect]');
const $beamStatus = document.querySelector('[data-beam-status]');
let beamSession = null;

function beamSetStatus(text, state = null) {
  $beamStatus.textContent = text;
  if (state) $beamStatus.dataset.state = state;
  else delete $beamStatus.dataset.state;
}

function beamResetUI() {
  $beamToken.disabled = false;
  $beamConnect.textContent = 'Connect';
  $beamConnect.disabled = !$beamToken.value.trim();
  beamSession = null;
}

$beamToken.addEventListener('input', () => {
  $beamConnect.disabled = !$beamToken.value.trim();
});

$beamConnect.addEventListener('click', () => {
  if (beamSession) {
    beamSession.disconnect();
    beamResetUI();
    beamSetStatus('');
    return;
  }

  const token = $beamToken.value.trim();
  if (!token) return;

  beamSetStatus('Connecting…', 'connecting');
  $beamToken.disabled = true;
  $beamConnect.disabled = true;

  beamSession = new TargetSession({
    serverUrl: 'wss://tokenbeam.dev',
    clientType: 'palette-shader',
    sessionToken: token,
  });

  beamSession.on('paired', ({ origin }) => {
    beamSetStatus(`Paired with ${origin ?? 'unknown source'}`, 'connected');
    $beamConnect.textContent = 'Disconnect';
    $beamConnect.disabled = false;
  });

  beamSession.on('sync', ({ payload }) => {
    const hexColors = [...new Set(extractColorTokens(payload).map((e) => e.hex))];
    if (hexColors.length >= 1) {
      vizzes.forEach((v) => (v.palette = hexColors));
      createDomFromPalette(hexColors);
      scheduleHashUpdate();
    }
  });

  beamSession.on('error', ({ message }) => {
    beamSetStatus(message, 'error');
    beamResetUI();
  });

  beamSession.on('disconnected', () => {
    beamSetStatus('Disconnected', 'error');
    beamResetUI();
  });

  beamSession.connect().catch((err) => {
    beamSetStatus(err instanceof Error ? err.message : 'Could not connect', 'error');
    beamResetUI();
  });
});

// async load from hash — after first paint so it never blocks rendering
requestAnimationFrame(() => {
  setTimeout(() => {
    const state = decodeHash(location.hash);
    if (state) applyState(state);
  }, 0);
});
