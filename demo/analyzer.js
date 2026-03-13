import { PaletteViz } from 'palette-shader';
import { converter } from 'culori';

const toSRGB = converter('rgb');
const toOKLab = converter('oklab');
const toOKLch = converter('oklch');

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normHue = (value) => (((value ?? 0) % 360) + 360) % 360;
const toHex = (value) =>
  Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, '0');
const rgbToHex = (rgb) => `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
const rgbToObject = (rgb) => ({ mode: 'rgb', r: rgb[0], g: rgb[1], b: rgb[2] });
const mixRGB = (a, b, t) => [
  a[0] * (1 - t) + b[0] * t,
  a[1] * (1 - t) + b[1] * t,
  a[2] * (1 - t) + b[2] * t,
];
const SVG_NS = 'http://www.w3.org/2000/svg';
const ISO_PLOT_SIZE = 104;
const ISO_PLOT_SCALE = 58;
const DETAIL_PIXEL_RATIO = devicePixelRatio * 2;

let $metric;
let $outline;
let $raw;
let isoCubeRotation = 0.72;
let isoPlotMode = 'cube';

function srgbArray(input) {
  const color = toSRGB(input);
  return [clamp01(color?.r ?? 0), clamp01(color?.g ?? 0), clamp01(color?.b ?? 0)];
}

function okLab(input) {
  const color = toOKLab(input);
  return { l: clamp01(color?.l ?? 0), a: color?.a ?? 0, b: color?.b ?? 0 };
}

function okLch(input) {
  const color = toOKLch(input);
  return {
    l: clamp01(color?.l ?? 0),
    c: Math.max(0, color?.c ?? 0),
    h: normHue(color?.h),
  };
}

function oklchToHex(l, c, h) {
  return rgbToHex(srgbArray({ mode: 'oklch', l: clamp01(l), c: Math.max(0, c), h: normHue(h) }));
}

function labDistance(a, b) {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

function srgbToLinear(value) {
  if (value <= 0.04045) return value / 12.92;
  return ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((value) => srgbToLinear(clamp01(value)));
  return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
}

function apcaContrast(textRgb, backgroundRgb) {
  const softClamp = (value) => (value <= 0.022 ? value + (0.022 - value) ** 1.414 : value);
  const textY = softClamp(relativeLuminance(textRgb));
  const backgroundY = softClamp(relativeLuminance(backgroundRgb));
  if (Math.abs(backgroundY - textY) < 0.0005) return 0;
  if (backgroundY > textY) {
    return ((backgroundY ** 0.56 - textY ** 0.57) * 1.14 - 0.027) * 100;
  }
  return ((backgroundY ** 0.65 - textY ** 0.62) * 1.14 + 0.027) * 100;
}

const CVD_THRESHOLD = 0.045;
const CVD_MATRICES = [
  {
    id: 'protan',
    label: 'Protan',
    matrix: [
      [0.56667, 0.43333, 0],
      [0.55833, 0.44167, 0],
      [0, 0.24167, 0.75833],
    ],
  },
  {
    id: 'deutan',
    label: 'Deutan',
    matrix: [
      [0.625, 0.375, 0],
      [0.7, 0.3, 0],
      [0, 0.3, 0.7],
    ],
  },
  {
    id: 'tritan',
    label: 'Tritan',
    matrix: [
      [0.95, 0.05, 0],
      [0, 0.43333, 0.56667],
      [0, 0.475, 0.525],
    ],
  },
];

function transformRgb(rgb, matrix) {
  return [
    clamp01(rgb[0] * matrix[0][0] + rgb[1] * matrix[0][1] + rgb[2] * matrix[0][2]),
    clamp01(rgb[0] * matrix[1][0] + rgb[1] * matrix[1][1] + rgb[2] * matrix[1][2]),
    clamp01(rgb[0] * matrix[2][0] + rgb[1] * matrix[2][1] + rgb[2] * matrix[2][2]),
  ];
}

function okDistLiMatchLab(a, b, t) {
  const distance = labDistance(a, b);
  return distance * (1 - t) + Math.abs(a.l - b.l) * t;
}

function paletteDataOf(colors) {
  return colors.map((hex, index) => ({
    index,
    hex,
    rgb: srgbArray(hex),
    lab: okLab(hex),
    lch: okLch(hex),
  }));
}

function usefulMixes(data, limit) {
  const mixes = [];
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const mixed = mixRGB(data[i].rgb, data[j].rgb, 0.5);
      const mixedLab = okLab(rgbToObject(mixed));
      let nearest = Infinity;
      for (const entry of data) nearest = Math.min(nearest, labDistance(mixedLab, entry.lab));
      mixes.push({
        a: data[i],
        b: data[j],
        mixed,
        score: nearest - labDistance(data[i].lab, data[j].lab) * 0.12,
      });
    }
  }
  mixes.sort((a, b) => b.score - a.score);
  return mixes.slice(0, limit);
}

function isAcyclic(size, pairs) {
  const parent = Array.from({ length: size }, (_, index) => index);
  const rank = new Array(size).fill(0);

  function find(index) {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }

  function union(a, b) {
    let rootA = find(a);
    let rootB = find(b);
    if (rootA === rootB) return false;
    if (rank[rootA] < rank[rootB]) [rootA, rootB] = [rootB, rootA];
    parent[rootB] = rootA;
    if (rank[rootA] === rank[rootB]) rank[rootA] += 1;
    return true;
  }

  for (const pair of pairs) if (!union(pair.i, pair.j)) return false;
  return true;
}

function stateForPalette(colors) {
  const data = paletteDataOf(colors);
  const pairs = [];
  const closePairs10 = [];
  const closePairs70 = [];

  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const pair = { i, j, dist: labDistance(data[i].lab, data[j].lab) };
      pairs.push(pair);
      closePairs10.push({ i, j, dist: okDistLiMatchLab(data[i].lab, data[j].lab, 0.1) });
      closePairs70.push({ i, j, dist: okDistLiMatchLab(data[i].lab, data[j].lab, 0.7) });
    }
  }

  pairs.sort((a, b) => a.dist - b.dist);
  closePairs10.sort((a, b) => a.dist - b.dist);
  closePairs70.sort((a, b) => a.dist - b.dist);

  const distances = pairs.map((pair) => pair.dist);
  const minDist = distances.length ? Math.min(...distances) : 0;
  const maxDist = distances.length ? Math.max(...distances) : 0;
  const meanDist = distances.length
    ? distances.reduce((sum, value) => sum + value, 0) / distances.length
    : 0;
  const iss =
    data.length > 1 ? meanDist / Math.max(minDist, 1e-6) / Math.pow(data.length, 2 / 3) : 0;

  const sortedByL = [...data].sort((a, b) => a.lab.l - b.lab.l);
  const lightnesses = data.map((entry) => entry.lab.l);
  const minL = lightnesses.length ? Math.min(...lightnesses) : 0;
  const maxL = lightnesses.length ? Math.max(...lightnesses) : 0;
  const meanL = lightnesses.length
    ? lightnesses.reduce((sum, value) => sum + value, 0) / lightnesses.length
    : 0;
  const maxC = Math.max(...data.map((entry) => entry.lch.c), 0.001);
  const acyclic = isAcyclic(data.length, pairs);
  const darkest = sortedByL[0]?.index ?? 0;

  const neutralisers = data.map((source) => {
    let best = data[0] ?? source;
    let bestScore = Infinity;
    for (const candidate of data) {
      if (candidate.index === source.index) continue;
      const score =
        Math.hypot((source.lab.a + candidate.lab.a) * 0.5, (source.lab.b + candidate.lab.b) * 0.5) +
        Math.abs(source.lab.l - candidate.lab.l) * 0.12;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  });

  const contrastPairs = pairs
    .map((pair) => {
      const source = data[pair.i];
      const target = data[pair.j];
      const sourceOnTarget = apcaContrast(source.rgb, target.rgb);
      const targetOnSource = apcaContrast(target.rgb, source.rgb);
      return {
        ...pair,
        sourceOnTarget,
        targetOnSource,
        bestContrast: Math.max(Math.abs(sourceOnTarget), Math.abs(targetOnSource)),
      };
    })
    .sort((a, b) => a.bestContrast - b.bestContrast);

  const cvdAnalyses = CVD_MATRICES.map(({ id, label, matrix }) => {
    const simulated = data.map((entry) => ({
      ...entry,
      simLab: okLab(rgbToObject(transformRgb(entry.rgb, matrix))),
    }));
    const simulatedPairs = [];
    for (let i = 0; i < simulated.length; i++) {
      for (let j = i + 1; j < simulated.length; j++) {
        simulatedPairs.push({
          i,
          j,
          dist: labDistance(simulated[i].simLab, simulated[j].simLab),
        });
      }
    }
    simulatedPairs.sort((a, b) => a.dist - b.dist);
    return {
      id,
      label,
      minDist: simulatedPairs[0]?.dist ?? 0,
      collapseCount: simulatedPairs.filter((pair) => pair.dist < CVD_THRESHOLD).length,
      totalPairs: simulatedPairs.length,
      closest: simulatedPairs[0] ?? null,
    };
  });

  return {
    data,
    pairs,
    closePairs10,
    closePairs70,
    sortedByL,
    minDist,
    meanDist,
    maxDist,
    iss,
    acyclic,
    minL,
    maxL,
    meanL,
    maxC,
    darkest,
    neutralisers,
    mixes: usefulMixes(data, 14),
    contrastPairs,
    cvdAnalyses,
  };
}

function decodeHash(hash) {
  if (!hash || !hash.startsWith('#colors/')) return null;
  const [colorPart] = hash.slice(8).split('?');
  const colors = colorPart
    .split('-')
    .map((item) => `#${item}`)
    .filter((item) => /^#([0-9a-f]{3}){1,2}$/i.test(item));
  return colors.length >= 2 ? colors : null;
}

function themeVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function makeCanvas(width, height) {
  const dpr = devicePixelRatio;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.className = 'canvas-box';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { canvas, ctx, width, height };
}

function buildShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || 'Shader compile failed');
  }
  return shader;
}

function buildProgram(gl, vertexSource, fragmentSource) {
  const vertex = buildShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = buildShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || 'Program link failed');
  }
  return program;
}

const $grid = document.querySelector('[data-grid]');
const $ctl = document.querySelector('[data-ctl]');
const $paste = document.querySelector('[data-paste]');
const $hdrL = document.querySelector('[data-hdr-l]');
const $hdrR = document.querySelector('[data-hdr-r]');
const $probe = document.querySelector('.cursor-probe');
const $probeDot = $probe.querySelector('.cursor-probe__dot');
const $probeLabel = $probe.querySelector('.cursor-probe__label');

function updateMetricHeader() {
  $hdrR.textContent = '';
  $hdrR.style.display = 'inline-flex';
  $hdrR.style.alignItems = 'center';
  $hdrR.style.gap = '6px';
  const $label = document.createElement('span');
  $label.textContent = 'Colour difference:';
  $hdrR.appendChild($label);
  $hdrR.appendChild($metric);
}

const palettes = [
  ['#f0dab1', '#e39aac', '#c45d9f', '#634b7d', '#6461c2', '#2ba9b4', '#93d4b5', '#f0f6e8'],
  [
    '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731',
    '#a22633', '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948',
    '#265c42', '#193c3e', '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc',
    '#8b9bb4', '#5a6988', '#3a4466', '#262b44', '#181425', '#ff0044', '#68386c',
    '#b55088', '#f6757a', '#e8b796', '#c28569',
  ],
  [
    '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f',
    '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436',
    '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  ],
  [
    '#000000', '#6f6776', '#9a9a97', '#c5ccb8', '#8b5580', '#c38890',
    '#a593a5', '#666092', '#9a4f50', '#c28d75', '#7ca1c0', '#416aa3',
    '#8d6268', '#be955c', '#68aca9', '#387080', '#6e6962', '#93a167',
    '#6eaa78', '#557064', '#9d9f7f', '#7e9e99', '#5d6872', '#433455',
  ],
  [
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
  ],
];

let palette = decodeHash(location.hash) ?? palettes[Math.floor(Math.random() * palettes.length)];

const rectTileConfigs = [
  {
    id: 'rect-hc',
    colorModel: 'oklch',
    label: 'H/L',
    axis: 'y',
    controlLabel: 'C',
    position: 1,
    invertAxes: ['z'],
  },
  {
    id: 'rect-hc-inv',
    colorModel: 'oklch',
    label: 'H/L',
    axis: 'y',
    controlLabel: 'C',
    position: 0.3,
    invertAxes: ['z'],
  },
  {
    id: 'rect-lc',
    colorModel: 'oklch',
    label: 'H/L',
    axis: 'y',
    controlLabel: 'C',
    position: 0.2,
  },
  {
    id: 'rect-lc-inv',
    colorModel: 'oklch',
    label: 'H/L',
    axis: 'y',
    controlLabel: 'C',
    position: 0.2,
    invertAxes: ['z'],
  },
];

const polarTileConfigs = [
  {
    id: 'polar-lo',
    colorModel: 'oklchPolar',
    label: 'Low chroma',
    axis: 'y',
    controlLabel: 'C',
    position: 0.8,
    invertAxes: ['z'],
  },
  {
    id: 'polar-lo-inv',
    colorModel: 'oklchPolar',
    label: 'Low chroma',
    axis: 'y',
    controlLabel: 'C',
    position: 0.8,
  },
  {
    id: 'polar-hi',
    colorModel: 'oklchPolar',
    label: 'High chroma',
    axis: 'y',
    controlLabel: 'C',
    position: 0.3,
    invertAxes: ['z'],
  },
  {
    id: 'polar-hi-inv',
    colorModel: 'oklchPolar',
    label: 'High chroma',
    axis: 'y',
    controlLabel: 'C',
    position: 0.3,
  },
];

const hueSideConfigs = [
  {
    id: 'side-0',
    colorModel: 'oklrchDiag',
    label: 'Purple / seaweed',
    axis: 'x',
    controlLabel: 'H',
    position: 0.805,
  },
  {
    id: 'side-1',
    colorModel: 'oklrchDiag',
    label: 'Red / cyan',
    axis: 'x',
    controlLabel: 'H',
    position: 0.224,
  },
  {
    id: 'side-2',
    colorModel: 'oklrchDiag',
    label: 'Orange / blue',
    axis: 'x',
    controlLabel: 'H',
    position: 0.406,
  },
  {
    id: 'side-3',
    colorModel: 'oklrchDiag',
    label: 'Olive / ultramarine',
    axis: 'x',
    controlLabel: 'H',
    position: 0.635,
  },
  {
    id: 'side-4',
    colorModel: 'oklrchDiag',
    label: 'Lime / violet',
    axis: 'x',
    controlLabel: 'H',
    position: 0.699,
  },
  {
    id: 'side-5',
    colorModel: 'oklrchDiag',
    label: 'Emerald / rose',
    axis: 'x',
    controlLabel: 'H',
    position: 1,
  },
];

const specBoxConfig = {
  id: 'specbox',
  colorModel: 'spectrum',
  label: 'Spectrum',
  axis: 'z',
  controlLabel: 'C',
  position: 0,
};

const TILE_SIZE = 100;
const vizzes = [];

function createVizEntry(cfg, width, height, dynamic = false, pixelRatio = devicePixelRatio) {
  const viz = new PaletteViz({
    palette: palette.map((hex) => srgbArray(hex)),
    width,
    height,
    pixelRatio,
    colorModel: cfg.colorModel ?? 'oklrab',
    distanceMetric: $metric?.value ?? 'oklrab',
    axis: cfg.axis,
    position: cfg.position,
    invertAxes: cfg.invertAxes ?? [],
    outlineWidth: parseFloat($outline?.value ?? '0'),
  });
  if ($raw?.checked) viz.showRaw = true;
  const entry = { viz, cfg, dynamic };
  vizzes.push(entry);
  return entry;
}

function makeVizLabel(cfg, viz, className) {
  const $label = document.createElement('div');
  $label.className = className;

  const $title = document.createElement('span');
  $title.className = 'viz-title';
  $title.textContent = cfg.label;

  const $ctrl = document.createElement('div');
  $ctrl.className = 'viz-ctrl';

  const $axis = document.createElement('span');
  $axis.className = 'viz-axis';
  $axis.textContent = cfg.controlLabel;

  const $slider = document.createElement('input');
  $slider.type = 'range';
  $slider.min = '0';
  $slider.max = '1';
  $slider.step = '0.001';
  $slider.value = String(cfg.position);
  $slider.title = `${cfg.controlLabel} slice`;
  $slider.addEventListener('input', () => {
    viz.position = parseFloat($slider.value);
  });

  $ctrl.appendChild($axis);
  $ctrl.appendChild($slider);
  $label.appendChild($title);
  $label.appendChild($ctrl);
  return $label;
}

function makeVizCell(cfg, extraClass = '') {
  const $cell = document.createElement('div');
  $cell.className = `g ${extraClass}`.trim();
  const entry = createVizEntry(cfg, TILE_SIZE, TILE_SIZE, false, DETAIL_PIXEL_RATIO);
  $cell.appendChild(entry.viz.canvas);
  $cell.appendChild(makeVizLabel(cfg, entry.viz, 'g__lbl'));
  return $cell;
}

function makePanel(role, title, extraClass = '') {
  const $cell = document.createElement('div');
  $cell.className = `g pnl ${extraClass}`.trim();
  $cell.dataset.role = role;
  if (title) {
    const $label = document.createElement('div');
    $label.className = 'pnl__t';
    $label.textContent = title;
    $cell.appendChild($label);
  }
  return $cell;
}

function makePanelShader(cfg, width, height) {
  const $card = document.createElement('div');
  $card.className = 'viz-card';
  const entry = createVizEntry(cfg, width, height, true, DETAIL_PIXEL_RATIO);
  $card.appendChild(entry.viz.canvas);
  $card.appendChild(makeVizLabel(cfg, entry.viz, 'viz-card__lbl'));
  return $card;
}

function buildGrid() {
  $grid.innerHTML = '';
  vizzes.length = 0;

  const $top = document.createElement('div');
  $top.className = 'section section-top';

  const $rects = document.createElement('div');
  $rects.className = 'section-stack stack-rects';
  $rects.appendChild(makeVizCell(rectTileConfigs[0], 'cell-rect1'));
  $rects.appendChild(makeVizCell(rectTileConfigs[1], 'cell-rect2'));
  $rects.appendChild(makePanel('spectrum', 'Spectrum & box', 'cell-spectrum'));

  const $meta = document.createElement('div');
  $meta.className = 'section-stack stack-meta';
  $meta.appendChild(makePanel('overview', 'Indexed palette', 'cell-overview'));
  $meta.appendChild(makePanel('stats', '', 'cell-stats'));

  $top.appendChild($rects);
  $top.appendChild($meta);
  $top.appendChild(makePanel('limatch', 'Li-match', 'cell-limatch'));
  $top.appendChild(makePanel('cubes', 'OK colourspace', 'cell-cubes'));

  const $strips = document.createElement('div');
  $strips.className = 'section section-strips';
  $strips.appendChild(makePanel('main', 'Main palette', 'cell-main'));
  $strips.appendChild(makePanel('neutralisers', 'Neutralisers', 'cell-neutralisers'));

  const $bottom = document.createElement('div');
  $bottom.className = 'section section-bottom';
  $bottom.appendChild(makePanel('mixes', 'mixes', 'cell-mixes'));
  $bottom.appendChild(makePanel('polars', 'Polar hue-lightness', 'cell-polars'));
  $bottom.appendChild(makePanel('hue-sides', 'OKHSL hue sideviews', 'cell-sides'));

  const $lc = makePanel('lc-bars', '', 'section section-lc');
  const $extra = document.createElement('div');
  $extra.className = 'section section-extra';
  $extra.appendChild(makePanel('contrast', 'Perceptual contrast', 'cell-contrast'));
  $extra.appendChild(makePanel('cvd', 'CVD collapse', 'cell-cvd'));

  $grid.appendChild($top);
  $grid.appendChild($strips);
  $grid.appendChild($bottom);
  $grid.appendChild($lc);
  $grid.appendChild($extra);
}

function clearPanel($panel, title) {
  $panel.innerHTML = '';
  if (title) {
    const $label = document.createElement('div');
    $label.className = 'pnl__t';
    $label.textContent = title;
    $panel.appendChild($label);
  }
}

function subTitle($panel, text) {
  const $label = document.createElement('div');
  $label.className = 'pnl__t pnl__t--sub';
  $label.textContent = text;
  $panel.appendChild($label);
}

function addCloseColorsRow($panel, label, pairs, count) {
  subTitle($panel, label);
  const $row = document.createElement('div');
  $row.className = 'close-row';
  const shown = Math.min(count, pairs.length);
  for (let index = 0; index < shown; index++) {
    const pair = pairs[index];
    const $pair = document.createElement('div');
    $pair.className = 'close-pair';
    $pair.title = `dist ${pair.dist.toFixed(4)}`;
    $pair.innerHTML = `<span style="background:${palette[pair.i]}"></span><span style="background:${palette[pair.j]}"></span>`;
    $row.appendChild($pair);
  }
  $panel.appendChild($row);
}

function addPairRow($panel, pair, state) {
  const $row = document.createElement('div');
  $row.className = 'pr';
  $row.innerHTML = `
    <span class="pr__s" style="background:${palette[pair.i]}"></span>
    <span style="color:${themeVar('--c-muted', '#777')}">↔</span>
    <span class="pr__s" style="background:${palette[pair.j]}"></span>
    <span class="pr__d">${pair.dist.toFixed(4)}</span>
  `;
  if (pair.i === state.darkest || pair.j === state.darkest) $row.style.fontWeight = '600';
  $panel.appendChild($row);
}

function svgEl(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function projectIsoPoint(lightness, axisA, axisB, cosY, sinY, scale) {
  const xRot = axisA * cosY + axisB * sinY;
  const zRot = -axisA * sinY + axisB * cosY;
  const x = (xRot - zRot) * 0.86602540378 * scale;
  const y = (xRot + zRot) * 0.5 * scale - lightness * scale;
  return { x, y, z: xRot + zRot };
}

function setIsoSvgViewport(svg, fill) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${ISO_PLOT_SIZE} ${ISO_PLOT_SIZE}`);
  svg.setAttribute('width', ISO_PLOT_SIZE);
  svg.setAttribute('height', ISO_PLOT_SIZE);
  svg.style.background = fill;
}

function renderIsoCubeSvg(svg, state, angle) {
  const border = themeVar('--c-grid', '#bbb');
  const fill = themeVar('--c-paper', '#eee');
  const cosY = Math.cos(angle);
  const sinY = Math.sin(angle);
  const center = projectIsoPoint(0.5, 0, 0, cosY, sinY, ISO_PLOT_SCALE);
  const toSvgPoint = (point) => ({
    x: point.x + ISO_PLOT_SIZE / 2 - center.x,
    y: point.y + ISO_PLOT_SIZE / 2 - center.y,
  });

  setIsoSvgViewport(svg, fill);

  const cubeCorners = [
    [0, -0.5, -0.5],
    [0, 0.5, -0.5],
    [0, 0.5, 0.5],
    [0, -0.5, 0.5],
    [1, -0.5, -0.5],
    [1, 0.5, -0.5],
    [1, 0.5, 0.5],
    [1, -0.5, 0.5],
  ];
  const cubeEdges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const cubePoints = cubeCorners.map(([lightness, axisA, axisB]) =>
    projectIsoPoint(lightness, axisA, axisB, cosY, sinY, ISO_PLOT_SCALE),
  );

  let frontCorner = 4;
  let frontDepth = cubePoints[4].z;
  for (let index = 5; index < 8; index++) {
    if (cubePoints[index].z > frontDepth) {
      frontDepth = cubePoints[index].z;
      frontCorner = index;
    }
  }

  const visibleEdges = [];
  const degrees = new Array(8).fill(0);
  for (const [start, end] of cubeEdges) {
    if (start === frontCorner || end === frontCorner) continue;
    visibleEdges.push([start, end]);
    degrees[start] += 1;
    degrees[end] += 1;
  }

  const dashedGroup = svgEl('g', {
    class: 'iso-cube__frame iso-cube__frame--dashed',
    fill: 'none',
    stroke: border,
    'stroke-width': 1,
  });
  const solidGroup = svgEl('g', {
    class: 'iso-cube__frame iso-cube__frame--solid',
    fill: 'none',
    stroke: border,
    'stroke-width': 1,
  });

  for (const [start, end] of visibleEdges) {
    const a = toSvgPoint(cubePoints[start]);
    const b = toSvgPoint(cubePoints[end]);
    const line = svgEl('line', {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      'vector-effect': 'non-scaling-stroke',
    });
    if (degrees[start] === 2 || degrees[end] === 2) {
      solidGroup.appendChild(line);
    } else {
      dashedGroup.appendChild(line);
    }
  }

  const points = state.data
    .map((entry) => {
      const axisA = clamp(entry.lab.a / 0.45, -1, 1) * 0.5;
      const axisB = clamp(entry.lab.b / 0.45, -1, 1) * 0.5;
      return {
        entry,
        projected: projectIsoPoint(entry.lab.l, axisA, axisB, cosY, sinY, ISO_PLOT_SCALE),
      };
    })
    .sort((a, b) => a.projected.z - b.projected.z);

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  points.forEach(({ projected }) => {
    minDepth = Math.min(minDepth, projected.z);
    maxDepth = Math.max(maxDepth, projected.z);
  });
  const depthSpan = Math.max(1e-6, maxDepth - minDepth);

  const dotsGroup = svgEl('g', { class: 'iso-cube__dots' });
  points.forEach(({ entry, projected }) => {
    const point = toSvgPoint(projected);
    const depthT = (projected.z - minDepth) / depthSpan;
    const radius = 2.4 + depthT * 2.4;
    const circle = svgEl('circle', {
      class: 'iso-cube__dot',
      cx: point.x,
      cy: point.y,
      r: radius,
      fill: entry.hex,
    });
    dotsGroup.appendChild(circle);
  });

  svg.appendChild(dashedGroup);
  svg.appendChild(solidGroup);
  svg.appendChild(dotsGroup);
}

function renderIsoCylinderSvg(svg, state, angle) {
  const border = themeVar('--c-grid', '#bbb');
  const fill = themeVar('--c-paper', '#eee');
  const cosY = Math.cos(angle);
  const sinY = Math.sin(angle);
  const cx = ISO_PLOT_SIZE / 2;
  const cy = ISO_PLOT_SIZE / 2;
  const radius = ISO_PLOT_SCALE * 0.5;
  const rx = radius * Math.sqrt(2) * 0.86602540378;
  const ry = radius * Math.sqrt(2) * 0.5;
  const topY = cy - ISO_PLOT_SCALE * 0.5;
  const bottomY = cy + ISO_PLOT_SCALE * 0.5;

  setIsoSvgViewport(svg, fill);

  const dashedGroup = svgEl('g', {
    class: 'iso-cube__frame iso-cube__frame--dashed',
    fill: 'none',
    stroke: border,
    'stroke-width': 1,
  });
  const solidGroup = svgEl('g', {
    class: 'iso-cube__frame iso-cube__frame--solid',
    fill: 'none',
    stroke: border,
    'stroke-width': 1,
  });

  const topArc = svgEl('path', {
    d: `M ${cx - rx} ${topY} A ${rx} ${ry} 0 0 1 ${cx + rx} ${topY}`,
    'vector-effect': 'non-scaling-stroke',
  });
  const bottomBackArc = svgEl('path', {
    d: `M ${cx - rx} ${bottomY} A ${rx} ${ry} 0 0 1 ${cx + rx} ${bottomY}`,
    'vector-effect': 'non-scaling-stroke',
  });
  const bottomFrontArc = svgEl('path', {
    d: `M ${cx - rx} ${bottomY} A ${rx} ${ry} 0 0 0 ${cx + rx} ${bottomY}`,
    'vector-effect': 'non-scaling-stroke',
  });
  const leftLine = svgEl('line', {
    x1: cx - rx,
    y1: topY,
    x2: cx - rx,
    y2: bottomY,
    'vector-effect': 'non-scaling-stroke',
  });
  const rightLine = svgEl('line', {
    x1: cx + rx,
    y1: topY,
    x2: cx + rx,
    y2: bottomY,
    'vector-effect': 'non-scaling-stroke',
  });

  dashedGroup.appendChild(bottomBackArc);
  solidGroup.appendChild(topArc);
  solidGroup.appendChild(bottomFrontArc);
  solidGroup.appendChild(leftLine);
  solidGroup.appendChild(rightLine);

  const points = state.data
    .map((entry) => {
      const theta = (entry.lch.h * Math.PI) / 180;
      const axisA = Math.cos(theta) * clamp(entry.lch.c / 0.322, 0, 1) * 0.5;
      const axisB = Math.sin(theta) * clamp(entry.lch.c / 0.322, 0, 1) * 0.5;
      return {
        entry,
        projected: projectIsoPoint(entry.lab.l, axisA, axisB, cosY, sinY, ISO_PLOT_SCALE),
      };
    })
    .sort((a, b) => a.projected.z - b.projected.z);

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  points.forEach(({ projected }) => {
    minDepth = Math.min(minDepth, projected.z);
    maxDepth = Math.max(maxDepth, projected.z);
  });
  const depthSpan = Math.max(1e-6, maxDepth - minDepth);

  const dotsGroup = svgEl('g', { class: 'iso-cube__dots' });
  points.forEach(({ entry, projected }) => {
    const point = {
      x: projected.x + cx,
      y: projected.y + cy - projectIsoPoint(0.5, 0, 0, cosY, sinY, ISO_PLOT_SCALE).y,
    };
    const depthT = (projected.z - minDepth) / depthSpan;
    const radiusScale = clamp(entry.lch.c / 0.322, 0, 1);
    const circle = svgEl('circle', {
      class: 'iso-cube__dot',
      cx: point.x,
      cy: point.y,
      r: 2.2 + depthT * 1.8 + radiusScale * 0.8,
      fill: entry.hex,
    });
    dotsGroup.appendChild(circle);
  });

  svg.appendChild(dashedGroup);
  svg.appendChild(solidGroup);
  svg.appendChild(dotsGroup);
}

function makeIsoCubeSvg(state) {
  const svg = svgEl('svg', {
    class: 'iso-cube',
    role: 'img',
    'aria-label': 'OK colourspace scatter plot',
  });
  let dragging = false;
  let startX = 0;
  let startAngle = isoCubeRotation;

  const render = () => {
    svg.setAttribute(
      'aria-label',
      isoPlotMode === 'cylinder' ? 'cylindrical colourspace scatter plot' : 'OK colourspace scatter plot',
    );
    if (isoPlotMode === 'cylinder') {
      renderIsoCylinderSvg(svg, state, isoCubeRotation);
      return;
    }
    renderIsoCubeSvg(svg, state, isoCubeRotation);
  };

  svg.addEventListener('pointerdown', (event) => {
    dragging = true;
    startX = event.clientX;
    startAngle = isoCubeRotation;
    svg.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    isoCubeRotation = startAngle + (event.clientX - startX) * 0.008;
    render();
    event.preventDefault();
  });

  const stopDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    svg.releasePointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  svg.addEventListener('pointerup', stopDrag);
  svg.addEventListener('pointercancel', stopDrag);

  render();
  return svg;
}

function drawSpaceScatter(state, xAccessor, yAccessor, xLabel, yLabel) {
  const { canvas, ctx, width, height } = makeCanvas(104, 104);
  const border = themeVar('--c-grid', '#bbb');
  const ink = themeVar('--c-border', '#111');
  const fill = themeVar('--c-paper', '#eee');
  const padX = 12;
  const padY = 10;

  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = border;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.beginPath();
  ctx.moveTo(padX, height - padY + 0.5);
  ctx.lineTo(width - 4, height - padY + 0.5);
  ctx.moveTo(padX + 0.5, 4);
  ctx.lineTo(padX + 0.5, height - padY);
  ctx.stroke();

  ctx.fillStyle = border;
  ctx.font = '7px Iosevka Web, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(xLabel, width - 24, height - 2);
  ctx.save();
  ctx.translate(6, 24);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  const dotSize = clamp(Math.round(30 / Math.sqrt(Math.max(state.data.length, 1))), 2, 4);
  state.data.forEach((entry) => {
    const x = padX + clamp(xAccessor(entry), 0, 1) * (width - padX - 6);
    const y = height - padY - clamp(yAccessor(entry), 0, 1) * (height - padY - 6);
    ctx.fillStyle = entry.hex;
    ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.arc(x, y, dotSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  return canvas;
}

function drawHuePolar(state) {
  const width = ISO_PLOT_SIZE;
  const height = ISO_PLOT_SIZE;
  const cx = width / 2;
  const cy = height / 2;
  const radius = width / 2 - 8;
  const border = themeVar('--c-grid', '#bbb');

  const svg = svgEl('svg', {
    class: 'canvas-box polar-plot',
    role: 'img',
    'aria-label': 'Polar hue-chroma plot',
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
  });

  [0.25, 0.5, 0.75].forEach((factor) => {
    svg.appendChild(
      svgEl('circle', {
        cx,
        cy,
        r: radius * factor,
        fill: 'none',
        stroke: border,
        'stroke-width': 1,
        'stroke-dasharray': '2 2',
        opacity: 0.85,
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  });
  svg.appendChild(
    svgEl('circle', {
      cx,
      cy,
      r: radius,
      fill: 'none',
      stroke: border,
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  svg.appendChild(
    svgEl('line', {
      x1: cx - radius,
      y1: cy,
      x2: cx + radius,
      y2: cy,
      stroke: border,
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  svg.appendChild(
    svgEl('line', {
      x1: cx,
      y1: cy - radius,
      x2: cx,
      y2: cy + radius,
      stroke: border,
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
    }),
  );

  [
    ['R', 30],
    ['Y', 90],
    ['G', 145],
    ['C', 200],
    ['B', 265],
    ['M', 325],
  ].forEach(([label, angle]) => {
    const a = (angle * Math.PI) / 180;
    const text = svgEl('text', {
      x: cx + Math.cos(a) * (radius + 5),
      y: cy - Math.sin(a) * (radius + 5),
      fill: border,
      'font-size': 7,
      'font-family': 'Iosevka Web, monospace',
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
    });
    text.textContent = label;
    svg.appendChild(text);
  });

  const n = state.data.length;
  const minDD = n <= 24 ? 1 : 0.5;
  const maxDD = n <= 64 ? 2.5 : n <= 128 ? 2 : 1.5;
  state.data.forEach((entry) => {
    const angle = (entry.lch.h * Math.PI) / 180;
    const chromaNorm = clamp(entry.lch.c / 0.322, 0, 1);
    const r = chromaNorm * radius;
    const dotSize = 1 + minDD + Math.round(chromaNorm * (maxDD - minDD));
    const x = cx + Math.cos(angle) * r;
    const y = cy - Math.sin(angle) * r;
    svg.appendChild(
      svgEl('circle', {
        cx: x,
        cy: y,
        r: dotSize,
        fill: entry.hex,
      }),
    );
  });
  return svg;
}

function renderOverview($panel, state) {
  clearPanel($panel);
  addCloseColorsRow($panel, 'Close cols: 10% li-match', state.closePairs10, 10);
  addCloseColorsRow($panel, 'Close cols: 70% li-match', state.closePairs70, 10);

  const $boxes = document.createElement('div');
  $boxes.className = 'box-row';
  const issState = state.iss >= 3.5 ? 'alert' : state.iss >= 2 ? 'warn' : 'ok';
  const $iss = document.createElement('div');
  $iss.className = 'info-box';
  $iss.innerHTML = `
    <div class="info-box__label">similarity</div>
    <div class="info-box__value">${state.iss.toFixed(3)}<span class="info-box__indicator" style="background:${themeVar(`--c-${issState}`, '#000')}"></span></div>
    <div class="info-box__bar" style="width:${Math.min(1, (state.iss - 0.4) / 3.1) * 100}%;background:${themeVar(`--c-${issState}`, '#000')}"></div>
  `;

  const acState = state.acyclic ? 'warn' : 'ok';
  const $acyclic = document.createElement('div');
  $acyclic.className = 'info-box';
  $acyclic.innerHTML = `
    <div class="info-box__label" title="Whether the nearest-neighbour graph (each color linked to its closest match) is cycle-free. Acyclic palettes have cleaner perceptual separation.">Acyclic?</div>
    <div class="info-box__value">&lt;${state.acyclic ? 'yes' : 'no'}&gt;<span class="info-box__indicator" style="background:${themeVar(`--c-${acState}`, '#000')}"></span></div>
    <div class="info-box__bar" style="width:100%;background:${themeVar(`--c-${acState}`, '#000')}"></div>
  `;
  $boxes.appendChild($iss);
  $boxes.appendChild($acyclic);
  $panel.appendChild($boxes);
}

function renderStats($panel, state) {
  clearPanel($panel);
  [
    ['Colours', state.data.length],
    ['Min dist', state.minDist.toFixed(4)],
    ['Mean dist', state.meanDist.toFixed(4)],
    ['Max dist', state.maxDist.toFixed(4)],
    ['L range', `${state.minL.toFixed(2)}-${state.maxL.toFixed(2)}`],
    ['L mean', state.meanL.toFixed(3)],
  ].forEach(([key, value]) => {
    const $row = document.createElement('div');
    $row.className = 'st';
    $row.innerHTML = `<span>${key}</span><span class="st__v">${value}</span>`;
    $panel.appendChild($row);
  });
}

function renderSpectrumPanel($panel, state) {
  clearPanel($panel);
  $panel.appendChild(makePanelShader(specBoxConfig, 188, 82));
}

function renderLiMatch($panel, state) {
  clearPanel($panel, 'Li-match');
  const entry = createVizEntry(
    {
      id: 'li-viz',
      colorModel: 'oklrch',
      label: 'Li-match',
      axis: 'y',
      controlLabel: '',
      position: 0,
    },
    40,
    200,
    true,
    DETAIL_PIXEL_RATIO,
  );
  entry.viz.distanceMetric = 'liMatch';
  entry.lockMetric = true;
  entry.viz.canvas.style.cssText =
    'image-rendering:pixelated;height:180px!important;width:40px!important;display:block;';
  $panel.appendChild(entry.viz.canvas);
}

function renderIsocubes($panel, state) {
  clearPanel($panel, 'OK colourspace');
  const $wrap = document.createElement('div');
  $wrap.className = 'iso-cube-wrap';
  const $toolbar = document.createElement('div');
  $toolbar.className = 'iso-cube__toolbar';
  const $modes = document.createElement('div');
  $modes.className = 'iso-cube__modes';
  [
    ['cube', 'Cube'],
    ['cylinder', 'Cylinder'],
  ].forEach(([mode, label]) => {
    const $button = document.createElement('button');
    $button.type = 'button';
    $button.className = 'iso-cube__mode';
    if (mode === isoPlotMode) $button.dataset.active = 'true';
    $button.textContent = label;
    $button.addEventListener('click', () => {
      if (isoPlotMode === mode) return;
      isoPlotMode = mode;
      renderIsocubes($panel, state);
    });
    $modes.appendChild($button);
  });
  $toolbar.appendChild($modes);
  $wrap.appendChild($toolbar);
  const $plots = document.createElement('div');
  $plots.className = 'iso-cube__plots';

  const $isoPanel = document.createElement('div');
  $isoPanel.className = 'iso-cube__panel';
  $isoPanel.appendChild(makeIsoCubeSvg(state));
  const $hint = document.createElement('div');
  $hint.className = 'iso-cube__hint';
  $hint.textContent = isoPlotMode === 'cylinder' ? 'drag to rotate cylinder' : 'drag to rotate cube';
  $isoPanel.appendChild($hint);

  const $polarPanel = document.createElement('div');
  $polarPanel.className = 'iso-cube__panel';
  const $polarLabel = document.createElement('div');
  $polarLabel.className = 'iso-cube__hint';
  $polarLabel.textContent = 'polar hue-chroma';
  $polarPanel.appendChild(drawHuePolar(state));
  $polarPanel.appendChild($polarLabel);

  $plots.appendChild($isoPanel);
  $plots.appendChild($polarPanel);
  $wrap.appendChild($plots);
  $panel.appendChild($wrap);
}

function renderLCBars($panel, state) {
  clearPanel($panel);
  const $header = document.createElement('div');
  $header.className = 'lc-header';
  $header.innerHTML = '<span>Li</span><span>Chr</span>';
  $panel.appendChild($header);

  const $wrap = document.createElement('div');
  $wrap.className = 'lc-wrap';
  for (const entry of state.data) {
    const $row = document.createElement('div');
    $row.className = 'lc-row';
    $row.title = `${entry.hex}  L=${entry.lab.l.toFixed(3)} C=${entry.lch.c.toFixed(3)}`;

    const $left = document.createElement('div');
    $left.style.cssText =
      'flex:1;display:flex;justify-content:flex-end;border-right:1px solid var(--c-grid)';
    const $leftBar = document.createElement('div');
    $leftBar.className = 'lc-bar lc-bar--l';
    $leftBar.style.width = `${entry.lab.l * 100}%`;
    $leftBar.style.background = entry.hex;
    $left.appendChild($leftBar);

    const $right = document.createElement('div');
    $right.style.cssText = 'flex:1;display:flex;border-left:1px solid var(--c-grid)';
    const $rightBar = document.createElement('div');
    $rightBar.className = 'lc-bar';
    $rightBar.style.width = `${(entry.lch.c / 0.322) * 100}%`;
    $rightBar.style.background = entry.hex;
    $right.appendChild($rightBar);

    $row.appendChild($left);
    $row.appendChild($right);
    $wrap.appendChild($row);
  }
  $panel.appendChild($wrap);
}

function renderMainPalette($panel, state) {
  clearPanel($panel, 'Main palette');
  const $row = document.createElement('div');
  $row.className = 'strip-row';
  $row.innerHTML = '<span class="strip-lbl">Pal</span>';
  const $strip = document.createElement('div');
  $strip.className = 'strip';
  state.sortedByL.forEach((entry) => {
    const $slot = document.createElement('span');
    $slot.style.background = entry.hex;
    $slot.title = entry.hex;
    $strip.appendChild($slot);
  });
  $row.appendChild($strip);
  $panel.appendChild($row);
}

function renderNeutralisers($panel, state) {
  clearPanel($panel, 'Neutralisers');
  const { canvas, ctx, width, height } = makeCanvas(396, 22);
  const slotWidth = width / Math.max(1, state.sortedByL.length);
  state.sortedByL.forEach((entry, index) => {
    const partner = state.neutralisers[entry.index] ?? entry;
    const x = Math.floor(index * slotWidth);
    const nextX = Math.floor((index + 1) * slotWidth);
    const w = Math.max(1, nextX - x);
    ctx.fillStyle = partner.hex;
    ctx.fillRect(x, 0, w, 9);
    for (let yy = 10; yy < height; yy++) {
      for (let xx = 0; xx < w; xx++) {
        ctx.fillStyle = (xx + yy) % 2 === 0 ? entry.hex : partner.hex;
        ctx.fillRect(x + xx, yy, 1, 1);
      }
    }
  });
  ctx.strokeStyle = themeVar('--c-grid', '#bbb');
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  $panel.appendChild(canvas);
}

function renderUsefulMixes($panel, state) {
  clearPanel($panel, 'mixes');
  const { canvas, ctx, width, height } = makeCanvas(44, 58);
  const cols = 2;
  const rows = 7;
  const gap = 1;
  const cellWidth = Math.floor((width - gap * (cols - 1)) / cols);
  const cellHeight = Math.floor((height - gap * (rows - 1)) / rows);
  state.mixes.forEach((mix, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = col * (cellWidth + gap);
    const y = row * (cellHeight + gap);
    for (let yy = 0; yy < cellHeight; yy++) {
      for (let xx = 0; xx < cellWidth; xx++) {
        ctx.fillStyle = (xx + yy) % 2 === 0 ? mix.a.hex : mix.b.hex;
        ctx.fillRect(x + xx, y + yy, 1, 1);
      }
    }
  });
  ctx.strokeStyle = themeVar('--c-grid', '#bbb');
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  $panel.appendChild(canvas);
}

function renderPolarGroup($panel) {
  clearPanel($panel, 'Polar hue-lightness');
  const $gridEl = document.createElement('div');
  $gridEl.className = 'viz-grid-4';
  polarTileConfigs.forEach((cfg) => {
    $gridEl.appendChild(makePanelShader(cfg, 100, 100));
  });
  $panel.appendChild($gridEl);
}

function renderHueSideviews($panel) {
  clearPanel($panel, 'Complementary Slices');
  const $gridEl = document.createElement('div');
  $gridEl.className = 'viz-grid-6';
  const renderSize = 96;
  hueSideConfigs.forEach((cfg) => {
    const $card = document.createElement('div');
    $card.className = 'viz-card';
    const entry = createVizEntry(cfg, renderSize, renderSize, true, DETAIL_PIXEL_RATIO);
    entry.viz.canvas.style.imageRendering = 'auto';
    $card.appendChild(entry.viz.canvas);
    const $lbl = makeVizLabel(cfg, entry.viz, 'viz-card__lbl');
    $lbl.querySelector('.viz-title')?.remove();
    $card.appendChild($lbl);
    $gridEl.appendChild($card);
  });
  $panel.appendChild($gridEl);
}

function formatContrast(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

function renderContrastPanel($panel, state) {
  clearPanel($panel, 'Perceptual contrast');
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = 'Lower = weaker text/background separation';
  $panel.appendChild($note);

  const $list = document.createElement('div');
  $list.className = 'metric-list';
  state.contrastPairs.slice(0, 6).forEach((pair) => {
    const $row = document.createElement('div');
    $row.className = 'metric-row';
    $row.innerHTML = `
      <div class="metric-pair">
        <span style="background:${palette[pair.i]}"></span>
        <span style="background:${palette[pair.j]}"></span>
      </div>
      <div class="metric-copy">
        <div class="metric-copy__title">${formatContrast(pair.sourceOnTarget)} / ${formatContrast(pair.targetOnSource)}</div>
        <div class="metric-copy__meta">a on b / b on a</div>
      </div>
      <div class="metric-value">${pair.bestContrast.toFixed(1)}</div>
    `;
    $list.appendChild($row);
  });
  $panel.appendChild($list);
}

function renderCvdPanel($panel, state) {
  clearPanel($panel, 'CVD collapse');
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = `Pairs under ${CVD_THRESHOLD.toFixed(3)} simulated OKLab distance`;
  $panel.appendChild($note);

  const $list = document.createElement('div');
  $list.className = 'metric-list';
  state.cvdAnalyses.forEach((analysis) => {
    const closest = analysis.closest;
    const pairMarkup = closest
      ? `<div class="metric-pair"><span style="background:${palette[closest.i]}"></span><span style="background:${palette[closest.j]}"></span></div>`
      : '<div class="metric-pair"></div>';
    const $row = document.createElement('div');
    $row.className = 'metric-row';
    $row.innerHTML = `
      <div class="metric-name">${analysis.label}</div>
      ${pairMarkup}
      <div class="metric-copy">
        <div class="metric-copy__title">min ${analysis.minDist.toFixed(3)}</div>
        <div class="metric-copy__meta">${analysis.collapseCount}/${analysis.totalPairs} collapsed</div>
      </div>
    `;
    $list.appendChild($row);
  });
  $panel.appendChild($list);
}

function renderBars($panel, title, items, accessor, max) {
  clearPanel($panel, title);
  const $bars = document.createElement('div');
  $bars.className = 'bars';
  items.forEach((entry) => {
    const value = accessor(entry);
    const $bar = document.createElement('span');
    $bar.style.height = `${(value / max) * 100}%`;
    $bar.style.background = entry.hex;
    $bar.title = `${entry.hex} ${value.toFixed(3)}`;
    $bars.appendChild($bar);
  });
  $panel.appendChild($bars);
}

function renderAnalysis() {
  for (let index = vizzes.length - 1; index >= 0; index--) {
    if (vizzes[index].dynamic) {
      vizzes[index].viz.destroy();
      vizzes.splice(index, 1);
    }
  }

  const state = stateForPalette(palette);
  renderOverview($grid.querySelector('[data-role="overview"]'), state);
  renderStats($grid.querySelector('[data-role="stats"]'), state);
  renderSpectrumPanel($grid.querySelector('[data-role="spectrum"]'), state);
  renderLiMatch($grid.querySelector('[data-role="limatch"]'), state);
  renderIsocubes($grid.querySelector('[data-role="cubes"]'), state);
  renderLCBars($grid.querySelector('[data-role="lc-bars"]'), state);
  renderMainPalette($grid.querySelector('[data-role="main"]'), state);
  renderNeutralisers($grid.querySelector('[data-role="neutralisers"]'), state);
  renderUsefulMixes($grid.querySelector('[data-role="mixes"]'), state);
  renderPolarGroup($grid.querySelector('[data-role="polars"]'));
  renderHueSideviews($grid.querySelector('[data-role="hue-sides"]'));
  renderContrastPanel($grid.querySelector('[data-role="contrast"]'), state);
  renderCvdPanel($grid.querySelector('[data-role="cvd"]'), state);
}

function updateHeader() {
  $hdrL.textContent = `Unique colours in palette: ${palette.length}`;
}

function updateAll() {
  const vizPalette = palette.map((hex) => srgbArray(hex));
  vizzes.forEach(({ viz }) => {
    viz.palette = vizPalette;
  });
  updateHeader();
  renderAnalysis();
}

function controlLabel(text, field) {
  const $label = document.createElement('label');
  $label.innerHTML = `<span>${text}</span>`;
  $label.appendChild(field);
  return $label;
}

buildGrid();

$metric = document.createElement('select');
$metric.innerHTML = `
  <optgroup label="OK">
    <option value="oklab">OKLab</option>
    <option value="oklrab">OKLrab</option>
    <option value="okLightness">OK Lightness</option>
    <option value="liMatch">Li-match</option>
  </optgroup>
  <optgroup label="CIE — D65">
    <option value="deltaE76">Euclidean / ΔE76</option>
    <option value="deltaE94">ΔE94</option>
    <option value="deltaE2000">ΔE2000</option>
  </optgroup>
  <optgroup label="CIE — D50">
    <option value="cielabD50">Euclidean</option>
  </optgroup>
  <optgroup label="Heuristic">
    <option value="kotsarenkoRamos">Kotsarenko / Ramos</option>
  </optgroup>
  <optgroup label="Simple">
    <option value="rgb">RGB</option>
  </optgroup>
`;
$metric.value = 'oklrab';
$metric.addEventListener('change', () => {
  vizzes.forEach((entry) => {
    if (!entry.lockMetric) entry.viz.distanceMetric = $metric.value;
  });
});

$outline = document.createElement('input');
$outline.type = 'range';
$outline.min = '0';
$outline.max = '6';
$outline.step = '0.5';
$outline.value = '0';
$outline.addEventListener('input', () => {
  vizzes.forEach(({ viz }) => {
    viz.outlineWidth = parseFloat($outline.value);
  });
});

$raw = document.createElement('input');
$raw.type = 'checkbox';
$raw.addEventListener('change', () => {
  vizzes.forEach(({ viz }) => {
    viz.showRaw = $raw.checked;
  });
});

$ctl.insertBefore(controlLabel('Outline', $outline), $paste);
$ctl.insertBefore(controlLabel('Raw', $raw), $paste);
updateMetricHeader();

$paste.value = palette.join(' ');
$paste.addEventListener('input', () => {
  const colors = $paste.value
    .split(/[\s,]+/)
    .map((value) => value.trim().replace(/^#?/, '#'))
    .filter((value) => /^#([0-9a-f]{3}){1,2}$/i.test(value));
  if (colors.length < 2) return;
  palette = colors;
  updateAll();
});

let probeFrame = null;
let probeEvent = null;

function hideProbe() {
  $probe.classList.remove('is-visible');
}

function updateProbe() {
  probeFrame = null;
  if (!probeEvent || !(probeEvent.target instanceof Element)) return;
  const canvas = probeEvent.target.closest('canvas.palette-viz');
  if (!canvas) return hideProbe();
  const entry = vizzes.find(({ viz }) => viz.canvas === canvas);
  if (!entry) return hideProbe();
  const rect = canvas.getBoundingClientRect();
  const u = (probeEvent.clientX - rect.left) / rect.width;
  const v = (probeEvent.clientY - rect.top) / rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return hideProbe();
  const color = entry.viz.getColorAtUV(u, 1 - v);
  const hex =
    '#' +
    color
      .map((c) =>
        Math.min(255, Math.max(0, Math.round(c * 255)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  $probeDot.style.background = hex;
  $probeLabel.textContent = hex;
  $probe.style.left = `${probeEvent.clientX + 10}px`;
  $probe.style.top = `${probeEvent.clientY + 10}px`;
  $probe.classList.add('is-visible');
}

$grid.addEventListener('pointermove', (event) => {
  probeEvent = event;
  if (probeFrame === null) probeFrame = requestAnimationFrame(updateProbe);
});

$grid.addEventListener('pointerleave', hideProbe);

updateAll();
