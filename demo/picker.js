import { PaletteViz } from 'palette-shader';
import { converter } from 'culori';
import { SourceSession, TargetSession, extractColorTokens, createCollection } from 'token-beam';

// ── Color conversion helpers ──────────────────────────────────────────────────

const toSRGB = converter('rgb');
const hexToRGB = (hex) => {
  const c = toSRGB(hex);
  return [c.r, c.g, c.b];
};
const toVizPalette = (p) => p.map(hexToRGB);
const toHexByte = (v) =>
  Math.min(255, Math.max(0, Math.round(v * 255)))
    .toString(16)
    .padStart(2, '0');
const rgbToHex = (rgb) => `#${toHexByte(rgb[0])}${toHexByte(rgb[1])}${toHexByte(rgb[2])}`;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $tools = document.querySelector('[data-tools]');
const $swatches = document.querySelector('[data-swatches]');
const $canvasWrap = document.querySelector('[data-canvas-wrap]');
const $sliderWrap = document.querySelector('[data-slider-wrap]');
const $addBtn = document.querySelector('[data-add]');

// ── Settings toggle ──────────────────────────────────────────────────────────

const $settingsToggle = document.querySelector('[data-settings-toggle]');

$settingsToggle.addEventListener('change', () => {
  $tools.hidden = !$settingsToggle.checked;
});

// ── Import / Export toggle ────────────────────────────────────────────────────

const $ioToggle = document.querySelector('[data-io-toggle]');
const $ioBody = document.querySelector('[data-io-body]');
const $ioLed = document.querySelector('[data-io-led]');

$ioToggle.addEventListener('change', () => {
  $ioBody.hidden = !$ioToggle.checked;
});

function openIO() {
  $ioToggle.checked = true;
  $ioBody.hidden = false;
}

function closeIO() {
  $ioToggle.checked = false;
  $ioBody.hidden = true;
}

// ── Axis names per color model ────────────────────────────────────────────────

const AXIS_NAMES = {
  rgb: ['R', 'G', 'B'],
  rgb6bit: ['R', 'G', 'B'],
  rgb8bit: ['R', 'G', 'B'],
  rgb12bit: ['R', 'G', 'B'],
  rgb15bit: ['R', 'G', 'B'],
  rgb18bit: ['R', 'G', 'B'],
  oklab: ['a', 'b', 'L'],
  okhsv: ['H', 'S', 'V'],
  okhsvPolar: ['H', 'S', 'V'],
  okhsl: ['H', 'S', 'L'],
  okhslPolar: ['H', 'S', 'L'],
  oklch: ['H', 'C', 'L'],
  oklchPolar: ['H', 'C', 'L'],
  oklrab: ['a', 'b', 'Lr'],
  oklrch: ['H', 'C', 'Lr'],
  oklrchPolar: ['H', 'C', 'Lr'],
  oklchDiag: ['H', 'C↔', 'L'],
  oklrchDiag: ['H', 'C↔', 'Lr'],
  hsv: ['H', 'S', 'V'],
  hsvPolar: ['H', 'S', 'V'],
  hsl: ['H', 'S', 'L'],
  hslPolar: ['H', 'S', 'L'],
  hwb: ['H', 'W', 'B'],
  hwbPolar: ['H', 'W', 'B'],
  cielab: ['a*', 'b*', 'L*'],
  cielch: ['H', 'C', 'L*'],
  cielchPolar: ['H', 'C', 'L*'],
  cielabD50: ['a*', 'b*', 'L*'],
  cielchD50: ['H', 'C', 'L*'],
  cielchD50Polar: ['H', 'C', 'L*'],
  cam16ucsD65: ["a'", "b'", "J'"],
  cam16ucsD65Polar: ['H', "M'", "J'"],
  spectrum: ['λ', 'L', 'C'],
};

// ── State ─────────────────────────────────────────────────────────────────────

let palette = []; // hex strings
let selectedIndex = -1; // -1 = no selection
let currentAxis = 'y'; // which axis the slider controls (default: S for okhsl)
const AXES = ['x', 'y', 'z'];

// ── PaletteViz instances ──────────────────────────────────────────────────────

const pixelRatio = Math.min(devicePixelRatio, 2);
const DUMMY_PALETTE = [[0.5, 0.5, 0.5]]; // minimum 1 color required by PaletteViz

function sharedOptions() {
  return {
    width: 500,
    height: 500,
    pixelRatio,
    axis: currentAxis,
    position: 0.5,
    colorModel: 'okhsl',
    distanceMetric: 'oklab',
  };
}

// Raw viz is always present (showRaw ignores palette for rendering, but needs one to init)
const vizRaw = new PaletteViz({ ...sharedOptions(), palette: DUMMY_PALETTE, showRaw: true, container: $canvasWrap });

// Closest viz is created lazily when the first color is added
let vizClosest = null;

function ensureVizClosest() {
  if (vizClosest) return vizClosest;
  const vp = vizPalette();
  if (vp.length < 2) return null;
  const w = Math.round($canvasWrap.clientWidth) || 500;
  vizClosest = new PaletteViz({
    ...sharedOptions(),
    width: w,
    height: w,
    palette: vp,
    showRaw: false,
    container: $canvasWrap,
    colorModel: $colorModel.value,
    distanceMetric: $distanceMetric.value,
    axis: currentAxis,
    position: parseFloat($posSlider.value),
    outlineWidth: $outlineCheckbox.checked ? 2 : 0,
    gamutClip: $gamutClipCheckbox.checked,
  });
  // Keep mask canvas on top of all WebGL canvases
  $canvasWrap.appendChild(maskCanvas);
  return vizClosest;
}

// ── Mask overlay (2D canvas for compositing during drag) ──────────────────────

const maskCanvas = document.createElement('canvas');
maskCanvas.className = 'mask-canvas';
maskCanvas.style.display = 'none';
const maskCtx = maskCanvas.getContext('2d');
$canvasWrap.appendChild(maskCanvas);

// Shared mask compositor: reads pixels from both canvases, composites them based
// on which pixels match the selected color. `matchSource` is shown in matching
// regions, `otherSource` in non-matching regions.
function compositeMask(colorIndex, matchSource, otherSource) {
  if (!vizClosest || colorIndex < 0 || colorIndex >= palette.length) return;

  // Force synchronous render so we can read fresh pixels
  vizClosest.getColorAtUV(0.5, 0.5);
  vizRaw.getColorAtUV(0.5, 0.5);

  const w = vizClosest.canvas.width;
  const h = vizClosest.canvas.height;

  const glClosest = vizClosest.canvas.getContext('webgl2');
  const closestPx = new Uint8Array(w * h * 4);
  glClosest.bindFramebuffer(glClosest.FRAMEBUFFER, null);
  glClosest.readPixels(0, 0, w, h, glClosest.RGBA, glClosest.UNSIGNED_BYTE, closestPx);

  const glRaw = vizRaw.canvas.getContext('webgl2');
  const rawPx = new Uint8Array(w * h * 4);
  glRaw.bindFramebuffer(glRaw.FRAMEBUFFER, null);
  glRaw.readPixels(0, 0, w, h, glRaw.RGBA, glRaw.UNSIGNED_BYTE, rawPx);

  const sel = hexToRGB(palette[colorIndex]);
  const sr = Math.round(sel[0] * 255);
  const sg = Math.round(sel[1] * 255);
  const sb = Math.round(sel[2] * 255);
  const tol = 3;

  if (maskCanvas.width !== w || maskCanvas.height !== h) {
    maskCanvas.width = w;
    maskCanvas.height = h;
  }

  const sources = { closest: closestPx, raw: rawPx };
  const matchPx = sources[matchSource];
  const otherPx = sources[otherSource];

  const imageData = maskCtx.createImageData(w, h);
  const out = imageData.data;

  // WebGL readPixels = bottom-to-top; canvas putImageData = top-to-bottom
  for (let row = 0; row < h; row++) {
    const srcRow = (h - 1 - row) * w * 4;
    const dstRow = row * w * 4;
    for (let col = 0; col < w; col++) {
      const si = srcRow + col * 4;
      const di = dstRow + col * 4;

      const isMatch =
        Math.abs(closestPx[si] - sr) <= tol &&
        Math.abs(closestPx[si + 1] - sg) <= tol &&
        Math.abs(closestPx[si + 2] - sb) <= tol;

      const src = isMatch ? matchPx : otherPx;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }

  maskCtx.putImageData(imageData, 0, 0);
  maskCanvas.style.display = '';
  vizClosest.canvas.style.display = 'none';
  vizRaw.canvas.style.display = 'none';
}

function buildMask(colorIndex) {
  if (!$revealCheckbox.checked) return;
  // Selected region → show raw color space, other regions → show closest
  compositeMask(colorIndex, 'raw', 'closest');
}

function buildHighlightMask(colorIndex) {
  // Hovered region → show closest (the palette color), other regions → show raw
  compositeMask(colorIndex, 'closest', 'raw');
}

function hideMask() {
  maskCanvas.style.display = 'none';
  vizRaw.canvas.style.display = '';
  updateView();
}

// ── Controls ──────────────────────────────────────────────────────────────────

function labeled(text, el) {
  const $label = document.createElement('label');
  const $span = document.createElement('span');
  $span.textContent = text;
  $label.appendChild($span);
  $label.appendChild(el);
  return $label;
}

// Color model dropdown
const $colorModel = document.createElement('select');
$colorModel.innerHTML = `
  <optgroup label="OK — Hue-based">
    <option value="okhsl" selected>OKHsl</option>
    <option value="okhslPolar">OKHsl Polar</option>
    <option value="okhsvPolar">OKHsv Polar</option>
    <option value="okhsv">OKHsv</option>
  </optgroup>
  <optgroup label="OK — Lab / LCH">
    <option value="oklab">OKLab</option>
    <option value="oklch">OKLch</option>
    <option value="oklchPolar">OKLch Polar</option>
    <option value="oklrab">OKLrab</option>
    <option value="oklrch">OKLrch</option>
    <option value="oklrchPolar">OKLrch Polar</option>
    <option value="oklchDiag">OKLch Complementary</option>
    <option value="oklrchDiag">OKLrch Complementary</option>
  </optgroup>
  <optgroup label="CIE Lab / LCH — D65">
    <option value="cielab">CIELab</option>
    <option value="cielch">CIELch</option>
    <option value="cielchPolar">CIELch Polar</option>
  </optgroup>
  <optgroup label="CIE Lab / LCH — D50">
    <option value="cielabD50">CIELab D50</option>
    <option value="cielchD50">CIELch D50</option>
    <option value="cielchD50Polar">CIELch D50 Polar</option>
  </optgroup>
  <optgroup label="CAM16 — D65">
    <option value="cam16ucsD65">CAM16-UCS D65</option>
    <option value="cam16ucsD65Polar">CAM16-UCS Polar D65</option>
  </optgroup>
  <optgroup label="Classic">
    <option value="hslPolar">HSL Polar</option>
    <option value="hsl">HSL</option>
    <option value="hsvPolar">HSV Polar</option>
    <option value="hsv">HSV</option>
    <option value="hwbPolar">HWB Polar</option>
    <option value="hwb">HWB</option>
    <option value="rgb">RGB</option>
  </optgroup>
  <optgroup label="Spectral">
    <option value="spectrum">Visible Spectrum</option>
  </optgroup>
`;
// Axis selector — 3 buttons showing axis names, in same row as color model
const $axisGroup = document.createElement('span');
$axisGroup.className = 'axis-buttons';
const $axisBtns = AXES.map((a, i) => {
  const btn = document.createElement('button');
  btn.className = 'axis-btn';
  btn.dataset.axis = a;
  if (a === currentAxis) btn.classList.add('is-active');
  btn.addEventListener('click', () => setAxis(a));
  $axisGroup.appendChild(btn);
  return btn;
});

function setAxis(axis) {
  currentAxis = axis;
  vizRaw.axis = axis;
  if (vizClosest) vizClosest.axis = axis;
  $axisBtns.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.axis === axis));
  updateSliderLabel();
  updateAxisButtonLabels();
  scheduleMaskUpdate();
}

function updateAxisButtonLabels() {
  const names = AXIS_NAMES[$colorModel.value] || ['X', 'Y', 'Z'];
  $axisBtns.forEach((btn, i) => {
    btn.textContent = names[i];
  });
}

$colorModel.addEventListener('change', () => {
  const model = $colorModel.value;
  vizRaw.colorModel = model;
  if (vizClosest) vizClosest.colorModel = model;
  updateSliderLabel();
  updateAxisButtonLabels();
  scheduleMaskUpdate();
});

// Layout: color model row with axis buttons on the right
const $modelRow = document.createElement('label');
$modelRow.className = 'picker__model-row';
const $modelSpan = document.createElement('span');
$modelSpan.textContent = 'Color model';
const $modelControls = document.createElement('span');
$modelControls.className = 'picker__model-controls';
$modelControls.appendChild($colorModel);
$modelControls.appendChild($axisGroup);
$modelRow.appendChild($modelSpan);
$modelRow.appendChild($modelControls);
$tools.appendChild($modelRow);
updateAxisButtonLabels();

// Distance metric dropdown
const $distanceMetric = document.createElement('select');
$distanceMetric.innerHTML = `
  <optgroup label="OK">
    <option value="oklab" selected>OKLab</option>
    <option value="oklrab">OKLrab</option>
  </optgroup>
  <optgroup label="CIE — D65">
    <option value="deltaE76">Euclidean / ΔE76</option>
    <option value="deltaE94">ΔE94</option>
    <option value="deltaE2000">ΔE2000</option>
  </optgroup>
  <optgroup label="CIE — D50">
    <option value="cielabD50">Euclidean D50</option>
  </optgroup>
  <optgroup label="Misc">
    <option value="cam16ucsD65">CAM16-UCS D65</option>
    <option value="rgb">RGB</option>
  </optgroup>
`;
$distanceMetric.addEventListener('change', () => {
  vizRaw.distanceMetric = $distanceMetric.value;
  if (vizClosest) vizClosest.distanceMetric = $distanceMetric.value;
  scheduleMaskUpdate();
});
$tools.appendChild(labeled('Distance metric', $distanceMetric));

// Outline toggle
const $outlineCheckbox = document.createElement('input');
$outlineCheckbox.type = 'checkbox';
$outlineCheckbox.checked = false;
$outlineCheckbox.addEventListener('change', () => {
  const w = $outlineCheckbox.checked ? 2 : 0;
  vizRaw.outlineWidth = w;
  if (vizClosest) vizClosest.outlineWidth = w;
  scheduleHashUpdate();
});
$tools.appendChild(labeled('Outline', $outlineCheckbox));

// Reveal on Pick toggle
const $revealCheckbox = document.createElement('input');
$revealCheckbox.type = 'checkbox';
$revealCheckbox.checked = true;
$revealCheckbox.addEventListener('change', () => {
  scheduleHashUpdate();
});
$tools.appendChild(labeled('Reveal Color Space While Picking', $revealCheckbox));

// Gamut clip toggle
const $gamutClipCheckbox = document.createElement('input');
$gamutClipCheckbox.type = 'checkbox';
$gamutClipCheckbox.checked = false;
$gamutClipCheckbox.addEventListener('change', () => {
  vizRaw.gamutClip = $gamutClipCheckbox.checked;
  if (vizClosest) vizClosest.gamutClip = $gamutClipCheckbox.checked;
  scheduleHashUpdate();
});
$tools.appendChild(labeled('Clip to sRGB', $gamutClipCheckbox));

// Position slider
const $posSlider = document.createElement('input');
$posSlider.type = 'range';
$posSlider.min = '0';
$posSlider.max = '1';
$posSlider.step = '0.001';
$posSlider.value = '0.5';

const $sliderAxisWrap = document.createElement('div');
$sliderAxisWrap.className = 'picker__axis-switcher';
const $sliderAxisBtns = AXES.map((a, i) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'picker__axis-btn';
  btn.dataset.axis = a;
  if (a === currentAxis) btn.classList.add('is-active');
  btn.addEventListener('click', () => setAxis(a));
  $sliderAxisWrap.appendChild(btn);
  return btn;
});

$posSlider.addEventListener('input', () => {
  const v = parseFloat($posSlider.value);
  vizRaw.position = v;
  if (vizClosest) vizClosest.position = v;
  scheduleMaskUpdate();
});

const $sliderCell = document.createElement('div');
$sliderCell.className = 'picker__slider-cell';
$sliderCell.appendChild($posSlider);
$sliderWrap.appendChild($sliderAxisWrap);
$sliderWrap.appendChild($sliderCell);

function updateSliderLabel() {
  const names = AXIS_NAMES[$colorModel.value] || ['X', 'Y', 'Z'];
  $sliderAxisBtns.forEach((btn, i) => {
    btn.textContent = names[i];
    btn.classList.toggle('is-active', AXES[i] === currentAxis);
  });
  updateSliderGradient();
}

// ── Slider gradient ──────────────────────────────────────────────────────────

const SLIDER_CULORI_MODE = {
  okhsl: 'okhsl', okhslPolar: 'okhsl',
  okhsv: 'okhsv', okhsvPolar: 'okhsv',
  oklch: 'oklch', oklchPolar: 'oklch', oklchDiag: 'oklch',
  oklrab: 'oklch', oklrch: 'oklch', oklrchPolar: 'oklch', oklrchDiag: 'oklch',
  oklab: 'oklab',
  hsl: 'hsl', hslPolar: 'hsl',
  hsv: 'hsv', hsvPolar: 'hsv',
  hwb: 'hwb', hwbPolar: 'hwb',
  rgb: 'rgb', rgb6bit: 'rgb', rgb8bit: 'rgb', rgb12bit: 'rgb', rgb15bit: 'rgb', rgb18bit: 'rgb',
  cielab: 'lab65', cielch: 'lch65', cielchPolar: 'lch65',
  cielabD50: 'lab', cielchD50: 'lch', cielchD50Polar: 'lch',
};

const SLIDER_COMPONENTS = {
  okhsl: ['h', 's', 'l'], okhsv: ['h', 's', 'v'],
  oklch: ['h', 'c', 'l'], oklab: ['a', 'b', 'l'],
  hsl: ['h', 's', 'l'], hsv: ['h', 's', 'v'], hwb: ['h', 'w', 'b'],
  rgb: ['r', 'g', 'b'],
  lab65: ['a', 'b', 'l'], lch65: ['h', 'c', 'l'],
  lab: ['a', 'b', 'l'], lch: ['h', 'c', 'l'],
};

const SLIDER_RANGES = {
  okhsl: { h: [0, 360], s: [0, 1], l: [0, 1] },
  okhsv: { h: [0, 360], s: [0, 1], v: [0, 1] },
  oklch: { h: [0, 360], c: [0, 0.4], l: [0, 1] },
  oklab: { l: [0, 1], a: [-0.4, 0.4], b: [-0.4, 0.4] },
  hsl: { h: [0, 360], s: [0, 1], l: [0, 1] },
  hsv: { h: [0, 360], s: [0, 1], v: [0, 1] },
  hwb: { h: [0, 360], w: [0, 1], b: [0, 1] },
  rgb: { r: [0, 1], g: [0, 1], b: [0, 1] },
  lab65: { l: [0, 100], a: [-128, 128], b: [-128, 128] },
  lch65: { h: [0, 360], c: [0, 150], l: [0, 100] },
  lab: { l: [0, 100], a: [-128, 128], b: [-128, 128] },
  lch: { h: [0, 360], c: [0, 150], l: [0, 100] },
};

const SLIDER_CENTERS = {
  okhsl: { h: 10, s: 0.5, l: 0.5 },
  okhsv: { h: 10, s: 0.5, v: 0.5 },
  oklch: { h: 25, c: 0.15, l: 0.5 },
  oklab: { l: 0.5, a: 0.1, b: 0.05 },
  hsl: { h: 10, s: 0.5, l: 0.5 },
  hsv: { h: 10, s: 0.5, v: 0.5 },
  hwb: { h: 10, w: 0.25, b: 0.25 },
  rgb: { r: 0.5, g: 0.5, b: 0.5 },
  lab65: { l: 50, a: 40, b: 20 },
  lch65: { h: 30, c: 50, l: 50 },
  lab: { l: 50, a: 40, b: 20 },
  lch: { h: 30, c: 50, l: 50 },
};

function updateSliderGradient() {
  const model = $colorModel.value;
  const culoriMode = SLIDER_CULORI_MODE[model];
  if (!culoriMode) {
    $sliderCell.style.removeProperty('--slider-gradient');
    return;
  }

  const comps = SLIDER_COMPONENTS[culoriMode];
  const ranges = SLIDER_RANGES[culoriMode];
  const centers = SLIDER_CENTERS[culoriMode];
  const axisIdx = AXES.indexOf(currentAxis);
  const varyComp = comps[axisIdx];
  const [min, max] = ranges[varyComp];

  const STEPS = 12;
  const stops = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const val = min + t * (max - min);
    const color = { mode: culoriMode };
    comps.forEach((c) => { color[c] = c === varyComp ? val : centers[c]; });
    const rgb = toSRGB(color);
    if (!rgb) { stops.push('#000000'); continue; }
    const r = rgb.r ?? 0, g = rgb.g ?? 0, b = rgb.b ?? 0;
    stops.push(rgbToHex([
      Math.max(0, Math.min(1, isNaN(r) ? 0 : r)),
      Math.max(0, Math.min(1, isNaN(g) ? 0 : g)),
      Math.max(0, Math.min(1, isNaN(b) ? 0 : b)),
    ]));
  }

  // Shader inverts z-axis: colorCoords.z = 1 - progress
  if (currentAxis === 'z') stops.reverse();

  $sliderCell.style.setProperty('--slider-gradient',
    `linear-gradient(to right, ${stops.join(', ')})`);
}
updateSliderLabel();

// ── Palette management ────────────────────────────────────────────────────────

function vizPalette() {
  return toVizPalette(palette);
}

function syncVizPalette() {
  const vp = vizPalette();
  // Raw viz always needs a palette for init, but with showRaw the colors don't matter visually.
  // Update it when we have colors so getColorAtUV works correctly.
  vizRaw.palette = vp.length > 0 ? vp : DUMMY_PALETTE;
  if (vp.length >= 2) {
    ensureVizClosest();
    if (vizClosest) vizClosest.palette = vp;
  } else if (vizClosest) {
    vizClosest.destroy();
    vizClosest = null;
  }
}

function addColor(hex) {
  if (palette.length >= MAX_COLORS) return;
  pushUndo();
  palette.push(hex);
  syncVizPalette();
  selectedIndex = palette.length - 1;
  renderSwatches();
  syncPasteField();
  scheduleMaskUpdate();
  scheduleHashUpdate();
  beamSendPalette();
}

function removeColor(index) {
  pushUndo();
  palette.splice(index, 1);
  if (selectedIndex >= palette.length) selectedIndex = palette.length - 1;
  if (palette.length === 0) selectedIndex = -1;
  syncVizPalette();
  renderSwatches();
  syncPasteField();
  scheduleMaskUpdate();
  scheduleHashUpdate();
  beamSendPalette();
}

function setColorAt(index, hex) {
  palette[index] = hex;
  syncVizPalette();
  renderSwatches();
  syncPasteField();
  scheduleMaskUpdate();
  scheduleHashUpdate();
  beamSendPalette();
}

function selectColor(index) {
  selectedIndex = index;
  renderSwatches();
  scheduleMaskUpdate();
}

// ── Render swatch grid ───────────────────────────────────────────────────────

function renderSwatches() {
  // Remove all swatches but keep $addBtn
  while ($swatches.firstChild !== $addBtn) $swatches.firstChild.remove();

  palette.forEach((hex, i) => {
    const $s = document.createElement('span');
    $s.className = 'picker__swatch';
    $s.style.background = hex;
    $s.dataset.index = i;
    if (i === selectedIndex) $s.classList.add('is-selected');

    const $rm = document.createElement('button');
    $rm.className = 'picker__swatch__remove';
    $rm.textContent = '\u00d7';
    $rm.addEventListener('click', (e) => {
      e.stopPropagation();
      removeColor(i);
    });
    $s.appendChild($rm);

    $s.addEventListener('click', () => selectColor(i));
    $s.addEventListener('mouseenter', (e) => {
      if (!e.shiftKey || pointerState?.dragging || !vizClosest) return;
      buildHighlightMask(i);
    });
    $s.addEventListener('mouseleave', () => {
      hideMask();
    });
    $swatches.insertBefore($s, $addBtn);
  });

  // Toggle compact mode
  $addBtn.classList.toggle('is-compact', palette.length > 0);
}

// ── View layer ────────────────────────────────────────────────────────────────
// Decides which canvas is visible based on state + interaction.
//  • pickMode ON  → raw on top (user is choosing a new color)
//  • dragging      → mask on top (selected region reveals raw)
//  • else          → closest on top (normal), or raw-only when palette empty

let pickMode = false; // "add color" toggle

function updateView() {
  const hasColors = palette.length > 0;

  if (pickMode) {
    // Pick mode: raw canvas on top, hide closest
    vizRaw.canvas.style.zIndex = '2';
    if (vizClosest) vizClosest.canvas.style.display = 'none';
    return;
  }

  vizRaw.canvas.style.zIndex = '';

  if (!hasColors || !vizClosest) {
    if (vizClosest) vizClosest.canvas.style.display = 'none';
    return;
  }

  // Normal: show closest on top
  vizClosest.canvas.style.display = '';
}

// Alias for use in palette management callbacks
function scheduleMaskUpdate() {
  updateView();
}

// ── Canvas pointer interaction ────────────────────────────────────────────────
// Click        → select palette color (or add first color / pick in pickMode)
// Click + drag → add color and update it live as you move

const DRAG_THRESHOLD = 5; // px to distinguish click from drag
let pointerState = null;  // { x, y, id, dragging, dragIndex }
let dragMaskRAF = null;

function cancelDrag() {
  if (!pointerState || !pointerState.dragging) return;
  const idx = pointerState.dragIndex;
  pointerState = null;
  if (dragMaskRAF !== null) { cancelAnimationFrame(dragMaskRAF); dragMaskRAF = null; }
  hideMask();
  if (idx >= 0) removeColor(idx);
  if (pickMode) exitPickMode();
}

function getUV(e) {
  const rect = $canvasWrap.getBoundingClientRect();
  const u = (e.clientX - rect.left) / rect.width;
  const v = 1 - (e.clientY - rect.top) / rect.height;
  return { u, v, inBounds: u >= 0 && u <= 1 && v >= 0 && v <= 1 };
}

function getRawHexAtUV(u, v) {
  const raw = vizRaw.getColorAtUV(u, v);
  return rgbToHex(raw);
}

// Fast update during drag: only touch the viz + the one DOM swatch, skip full re-render
function liveUpdateColor(index, hex) {
  palette[index] = hex;
  const rgb = hexToRGB(hex);
  vizRaw.setColor(rgb, index);
  if (vizClosest) vizClosest.setColor(rgb, index);

  // Update just the DOM swatch for this index
  const $s = $swatches.querySelector(`[data-index="${index}"]`);
  if ($s) $s.style.background = hex;
}

$canvasWrap.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointerState = { x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false, dragIndex: -1 };
  $canvasWrap.setPointerCapture(e.pointerId);
});

$canvasWrap.addEventListener('pointermove', (e) => {
  // Probe (cursor tooltip)
  probeEvent = e;
  if (probeRAF === null) probeRAF = requestAnimationFrame(updateProbe);

  if (!pointerState || pointerState.id !== e.pointerId) return;

  const dx = e.clientX - pointerState.x;
  const dy = e.clientY - pointerState.y;

  if (!pointerState.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
    pointerState.dragging = true;

    // Drag start: add a new color at the original pointer position
    const { u, v, inBounds } = getUV(e);
    if (inBounds) {
      const hex = getRawHexAtUV(u, v);
      addColor(hex);
      pointerState.dragIndex = palette.length - 1;
      buildMask(pointerState.dragIndex);
    }
  }

  // While dragging: update the color live and rebuild mask (throttled to rAF)
  if (pointerState.dragging && pointerState.dragIndex >= 0) {
    const { u, v, inBounds } = getUV(e);
    if (inBounds) {
      liveUpdateColor(pointerState.dragIndex, getRawHexAtUV(u, v));
      if (dragMaskRAF === null) {
        const idx = pointerState.dragIndex;
        dragMaskRAF = requestAnimationFrame(() => {
          dragMaskRAF = null;
          buildMask(idx);
        });
      }
    }
  }
});

$canvasWrap.addEventListener('pointerup', (e) => {
  if (!pointerState || pointerState.id !== e.pointerId) return;
  const wasDragging = pointerState.dragging;
  const dragIndex = pointerState.dragIndex;
  pointerState = null;
  if (dragMaskRAF !== null) { cancelAnimationFrame(dragMaskRAF); dragMaskRAF = null; }

  if (wasDragging) {
    hideMask();
    // End of drag: do a final full sync so everything is consistent
    const { u, v, inBounds } = getUV(e);
    if (inBounds && dragIndex >= 0) {
      setColorAt(dragIndex, getRawHexAtUV(u, v));
    }
    if (pickMode) exitPickMode();
    return;
  }

  // Simple click
  const { u, v, inBounds } = getUV(e);
  if (!inBounds) return;

  if (pickMode) {
    addColor(getRawHexAtUV(u, v));
    exitPickMode();
    return;
  }

  if (palette.length === 0 || !vizClosest) {
    addColor(getRawHexAtUV(u, v));
    return;
  }

  // Normal click with palette: select the color at this pixel
  const closestColor = vizClosest.getColorAtUV(u, v);
  const matchIndex = findPaletteIndex(closestColor);
  if (matchIndex >= 0) {
    selectColor(matchIndex);
  }
});

$canvasWrap.addEventListener('pointercancel', () => {
  pointerState = null;
  if (dragMaskRAF !== null) { cancelAnimationFrame(dragMaskRAF); dragMaskRAF = null; }
  hideMask();
});

$canvasWrap.addEventListener('pointerleave', () => {
  hideProbe();
});

// ── Scroll on shader → adjust position ────────────────────────────────────────

// Hue axes wrap around; other axes clamp 0–1
function isHueAxis() {
  const names = AXIS_NAMES[$colorModel.value] || ['X', 'Y', 'Z'];
  const axisIdx = AXES.indexOf(currentAxis);
  return names[axisIdx] === 'H';
}

$canvasWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Normalize: line-mode (~3–100 per tick) vs pixel-mode (trackpad, smaller)
  const delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
  const step = delta * 0.001;
  let v = parseFloat($posSlider.value) - step;

  if (isHueAxis()) {
    v = v - Math.floor(v); // wrap 0–1
  } else {
    v = Math.max(0, Math.min(1, v));
  }

  $posSlider.value = String(v);
  vizRaw.position = v;
  if (vizClosest) vizClosest.position = v;
  scheduleMaskUpdate();
}, { passive: false });

// Two-finger touch pan → adjust position
let touchState = null;

$canvasWrap.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    touchState = { y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
  }
}, { passive: false });

$canvasWrap.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && touchState) {
    e.preventDefault();
    const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const delta = touchState.y - y;
    touchState.y = y;
    const step = delta * 0.003;
    let v = parseFloat($posSlider.value) + step;

    if (isHueAxis()) {
      v = v - Math.floor(v);
    } else {
      v = Math.max(0, Math.min(1, v));
    }

    $posSlider.value = String(v);
    vizRaw.position = v;
    if (vizClosest) vizClosest.position = v;
    scheduleMaskUpdate();
  }
}, { passive: false });

$canvasWrap.addEventListener('touchend', () => { touchState = null; });
$canvasWrap.addEventListener('touchcancel', () => { touchState = null; });

function findPaletteIndex(rgb) {
  const tol = 4 / 255;
  for (let i = 0; i < palette.length; i++) {
    const c = hexToRGB(palette[i]);
    if (
      Math.abs(rgb[0] - c[0]) < tol &&
      Math.abs(rgb[1] - c[1]) < tol &&
      Math.abs(rgb[2] - c[2]) < tol
    ) {
      return i;
    }
  }
  return -1;
}

// ── Pick mode (add button toggle) ─────────────────────────────────────────────

const $addIcon = $addBtn.querySelector('.picker__add-icon');
const $addLabel = $addBtn.querySelector('.picker__add-label');

function enterPickMode() {
  pickMode = true;
  $addBtn.classList.add('is-picking');
  $addIcon.textContent = '\u00d7';
  $addLabel.innerHTML = '<kbd>C</kbd> Cancel pick';
  updateView();
}

function exitPickMode() {
  pickMode = false;
  $addBtn.classList.remove('is-picking');
  $addIcon.textContent = '+';
  $addLabel.innerHTML = '<kbd>C</kbd> Add color';
  updateView();
}

function togglePickMode() {
  if (pickMode) exitPickMode();
  else enterPickMode();
}

$addBtn.addEventListener('click', togglePickMode);

// ── Cursor probe ──────────────────────────────────────────────────────────────

const $probe = document.createElement('div');
$probe.className = 'cursor-probe';
$probe.innerHTML =
  '<span class="cursor-probe__dot"></span><span class="cursor-probe__label"></span>';
const $probeDot = $probe.querySelector('.cursor-probe__dot');
const $probeLabel = $probe.querySelector('.cursor-probe__label');
document.body.appendChild($probe);

let probeRAF = null;
let probeEvent = null;

const hideProbe = () => $probe.classList.remove('is-visible');

const updateProbe = () => {
  probeRAF = null;
  if (!probeEvent) return;
  const rect = $canvasWrap.getBoundingClientRect();
  const u = (probeEvent.clientX - rect.left) / rect.width;
  const v = 1 - (probeEvent.clientY - rect.top) / rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return hideProbe();

  const color = vizRaw.getColorAtUV(u, v);
  const hex = rgbToHex(color);
  $probeDot.style.background = hex;
  $probeLabel.textContent = hex;
  $probe.style.left = `${probeEvent.clientX + 14}px`;
  $probe.style.top = `${probeEvent.clientY + 14}px`;
  $probe.classList.add('is-visible');
};

// ── Undo stack ───────────────────────────────────────────────────────────────

const undoStack = [];
const MAX_UNDO = 50;

function pushUndo() {
  undoStack.push({ palette: [...palette], selectedIndex });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function undo() {
  const state = undoStack.pop();
  if (!state) return;
  palette = state.palette;
  selectedIndex = state.selectedIndex;
  syncVizPalette();
  renderSwatches();
  syncPasteField();
  scheduleMaskUpdate();
  scheduleHashUpdate();
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    togglePickMode();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedIndex >= 0 && selectedIndex < palette.length) {
      e.preventDefault();
      removeColor(selectedIndex);
    }
  }
  if (e.key === 'Escape') {
    if (pointerState && pointerState.dragging) {
      e.preventDefault();
      cancelDrag();
    } else if (pickMode) {
      exitPickMode();
    }
  }
});

// ── Paste field ───────────────────────────────────────────────────────────────

const $paste = document.querySelector('[data-paste]');
let pasteIsSync = false;

$paste.addEventListener('input', () => {
  if (pasteIsSync) return;
  const colors = $paste.value
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^#?/, '#'))
    .filter((s) => /^#([0-9a-f]{3}){1,2}$/i.test(s));
  if (colors.length < 1) return;
  setPalette(colors);
  closeIO();
});

function syncPasteField() {
  pasteIsSync = true;
  $paste.value = palette.join(', ');
  pasteIsSync = false;
}

// Bulk replace palette (used by paste, hash restore, beam receive)
function setPalette(colors) {
  pushUndo();
  palette = colors.slice(0, MAX_COLORS);
  selectedIndex = palette.length > 0 ? 0 : -1;
  syncVizPalette();
  renderSwatches();
  syncPasteField();
  scheduleMaskUpdate();
  scheduleHashUpdate();
  beamSendPalette();
}

// ── URL hash state ────────────────────────────────────────────────────────────

const MAX_COLORS = 128;

function encodeHash() {
  const colorStr = palette.length > 0
    ? palette.map((c) => c.replace('#', '')).join('-')
    : '';
  const params = new URLSearchParams({
    model: $colorModel.value,
    metric: $distanceMetric.value,
    axis: currentAxis,
    pos: parseFloat($posSlider.value).toFixed(4),
    ...$outlineCheckbox.checked && { outline: '1' },
    ...!$revealCheckbox.checked && { reveal: '0' },
    ...$gamutClipCheckbox.checked && { gamut: '1' },
  });
  return colorStr ? `#colors/${colorStr}?${params}` : `#?${params}`;
}

function decodeHash(hash) {
  if (!hash || hash === '#') return null;
  let colorPart = '', queryPart = '';
  if (hash.startsWith('#colors/')) {
    const rest = hash.slice('#colors/'.length);
    [colorPart, queryPart] = rest.split('?');
  } else if (hash.startsWith('#?')) {
    queryPart = hash.slice(2);
  } else {
    return null;
  }
  const colors = colorPart
    ? colorPart.split('-').map((h) => `#${h}`).filter((c) => /^#([0-9a-f]{3}){1,2}$/i.test(c))
    : [];
  const params = new URLSearchParams(queryPart || '');
  return {
    colors,
    colorModel: params.get('model') || 'okhsl',
    distanceMetric: params.get('metric') || 'oklab',
    axis: params.get('axis') || 'y',
    pos: parseFloat(params.get('pos') ?? '0.5'),
    outline: params.get('outline') === '1',
    reveal: params.get('reveal') !== '0',
    gamut: params.get('gamut') === '1',
  };
}

let _hashTimer = null;
function scheduleHashUpdate() {
  clearTimeout(_hashTimer);
  _hashTimer = setTimeout(() => {
    history.replaceState(null, '', encodeHash());
  }, 400);
}

// Hook all control changes to update hash
$colorModel.addEventListener('change', scheduleHashUpdate);
$distanceMetric.addEventListener('change', scheduleHashUpdate);
$posSlider.addEventListener('input', scheduleHashUpdate);
$swatches.addEventListener('click', scheduleHashUpdate);

function applyHashState(state) {
  $colorModel.value = state.colorModel;
  $distanceMetric.value = state.distanceMetric;
  $posSlider.value = String(state.pos);

  $outlineCheckbox.checked = state.outline;
  const outlineW = state.outline ? 2 : 0;
  vizRaw.outlineWidth = outlineW;

  $revealCheckbox.checked = state.reveal;

  $gamutClipCheckbox.checked = state.gamut;
  vizRaw.gamutClip = state.gamut;

  vizRaw.colorModel = state.colorModel;
  vizRaw.distanceMetric = state.distanceMetric;
  vizRaw.position = state.pos;

  palette = state.colors.slice(0, MAX_COLORS);
  selectedIndex = palette.length > 0 ? 0 : -1;
  syncVizPalette();

  if (vizClosest) {
    vizClosest.colorModel = state.colorModel;
    vizClosest.distanceMetric = state.distanceMetric;
    vizClosest.position = state.pos;
    vizClosest.outlineWidth = outlineW;
    vizClosest.gamutClip = state.gamut;
  }

  // setAxis after vizClosest exists so it gets the axis too
  setAxis(state.axis);

  updateSliderLabel();
  updateAxisButtonLabels();
  renderSwatches();
  updateView();
}

// ── Token Beam ────────────────────────────────────────────────────────────────

const $beamMode = document.querySelector('[data-beam-mode]');
const $beamToken = document.querySelector('[data-beam-token]');
const $beamConnect = document.querySelector('[data-beam-connect]');
const $beamCopy = document.querySelector('[data-beam-copy]');
const $beamStatus = document.querySelector('[data-beam-status]');
let beamSession = null;
let beamSessionToken = null;

function beamShowError(msg) {
  $beamStatus.textContent = msg;
  $beamStatus.dataset.state = 'error';
}
function beamShowInfo(msg) {
  $beamStatus.textContent = msg;
  $beamStatus.dataset.state = 'info';
}
function beamClearStatus() {
  delete $beamStatus.dataset.state;
  $beamStatus.textContent = '';
}

function beamSendPalette() {
  if (!beamSession || $beamMode.value !== 'send' || !beamSession.hasPeers() || palette.length === 0) return;
  const tokens = {};
  palette.forEach((hex, i) => {
    tokens[`color-${i}`] = hex;
  });
  beamSession.sync(createCollection('picker-palette', tokens));
}

// ── Send mode: auto-connect, server generates token ───────────────────────────

function initBeamSource() {
  $ioLed.classList.remove('is-active');
  if (beamSession) {
    beamSession.disconnect();
    beamSession = null;
  }
  beamSessionToken = null;
  beamClearStatus();

  $beamToken.value = '';
  $beamToken.disabled = true;
  $beamToken.placeholder = 'Generating token…';
  $beamConnect.style.display = 'none';
  $beamCopy.style.display = '';
  $beamCopy.textContent = 'Copy';

  beamSession = new SourceSession({
    serverUrl: 'wss://tokenbeam.dev',
    clientType: 'web',
    origin: 'Palette Picker',
    icon: { type: 'unicode', value: '🎨' },
  });

  beamSession.on('paired', ({ sessionToken }) => {
    beamSessionToken = sessionToken;
    $beamToken.value = sessionToken;
    $beamToken.placeholder = '';
    beamShowInfo('Copy this token to sync — waiting for receiver…');
  });

  beamSession.on('peer-connected', () => {
    beamShowInfo('Paired — sending palette');
    beamSendPalette();
  });

  beamSession.on('peer-disconnected', () => {
    beamShowInfo('Peer disconnected — waiting…');
  });

  beamSession.on('error', ({ message }) => {
    beamShowError(message);
  });

  beamSession.on('disconnected', () => {
    beamClearStatus();
  });

  beamSession.connect().catch((err) => {
    beamShowError(err instanceof Error ? err.message : 'Could not connect');
    $beamToken.placeholder = 'Connection failed';
  });
}

$beamCopy.addEventListener('click', () => {
  if (!beamSessionToken) return;
  navigator.clipboard.writeText(beamSessionToken).then(() => {
    $beamCopy.textContent = 'Copied!';
    setTimeout(() => { $beamCopy.textContent = 'Copy'; }, 1500);
  });
});

// ── Receive mode: user enters token, clicks connect ───────────────────────────

function initBeamTarget() {
  $ioLed.classList.remove('is-active');
  if (beamSession) {
    beamSession.disconnect();
    beamSession = null;
  }
  beamSessionToken = null;
  beamClearStatus();

  $beamToken.value = '';
  $beamToken.disabled = false;
  $beamToken.placeholder = 'Paste session token…';
  $beamConnect.style.display = '';
  $beamConnect.textContent = 'Connect';
  $beamConnect.disabled = false;
  $beamCopy.style.display = 'none';
}

function connectBeamTarget() {
  const token = $beamToken.value.trim();
  if (!token) {
    beamShowError('Enter a session token');
    return;
  }

  if (beamSession) {
    beamSession.disconnect();
    beamSession = null;
  }
  beamClearStatus();

  beamSession = new TargetSession({
    serverUrl: 'wss://tokenbeam.dev',
    clientType: 'pickypalette',
    sessionToken: token,
  });

  beamSession.on('paired', () => {
    $beamToken.disabled = true;
    $beamConnect.textContent = 'Disconnect';
    beamShowInfo('Paired — receiving');
  });

  beamSession.on('sync', ({ payload }) => {
    const hexColors = [...new Set(extractColorTokens(payload).map((e) => e.hex))];
    if (hexColors.length >= 1) {
      setPalette(hexColors);
      $ioLed.classList.add('is-active');
      closeIO();
    }
  });

  beamSession.on('error', ({ message }) => {
    beamShowError(message);
  });

  beamSession.on('disconnected', () => {
    $beamToken.disabled = false;
    $beamConnect.textContent = 'Connect';
    beamClearStatus();
    $ioLed.classList.remove('is-active');
    beamSession = null;
  });

  $beamConnect.textContent = 'Connecting…';
  $beamConnect.disabled = true;
  beamSession.connect().then(() => {
    $beamConnect.disabled = false;
  }).catch((err) => {
    beamShowError(err instanceof Error ? err.message : 'Could not connect');
    $beamConnect.textContent = 'Connect';
    $beamConnect.disabled = false;
    beamSession = null;
  });
}

$beamConnect.addEventListener('click', () => {
  if ($beamMode.value === 'receive' && beamSession && beamSession.getState() === 'paired') {
    // Disconnect
    beamSession.disconnect();
    beamSession = null;
    initBeamTarget();
    return;
  }
  connectBeamTarget();
});

// ── Mode switch ───────────────────────────────────────────────────────────────

$beamMode.addEventListener('change', () => {
  if ($beamMode.value === 'send') initBeamSource();
  else initBeamTarget();
});

// Auto-start in send mode
initBeamSource();

window.addEventListener('beforeunload', () => {
  if (beamSession) beamSession.disconnect();
});

// ── Resize handling ───────────────────────────────────────────────────────────

const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const w = Math.round(entry.contentRect.width);
    if (w > 0) {
      vizRaw.resize(w, w);
      if (vizClosest) vizClosest.resize(w, w);
      scheduleMaskUpdate();
    }
  }
});
resizeObserver.observe($canvasWrap);

// ── Init ──────────────────────────────────────────────────────────────────────

renderSwatches();
updateView();

// Restore from URL hash after first paint
requestAnimationFrame(() => {
  setTimeout(() => {
    const state = decodeHash(location.hash);
    if (state) applyHashState(state);
  }, 0);
});
