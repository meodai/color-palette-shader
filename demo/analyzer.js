import { PaletteViz } from 'palette-shader';
import { converter } from 'culori';

const toSRGB = converter('rgb');
const toOKLab = converter('oklab');
const toOKLch = converter('oklch');

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normHue = (value) => ((value ?? 0) % 360 + 360) % 360;
const toHex = (value) => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
const rgbToHex = (rgb) => `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
const rgbToObject = (rgb) => ({ mode: 'rgb', r: rgb[0], g: rgb[1], b: rgb[2] });
const mixRGB = (a, b, t) => [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t];
const LI_MATCH_MAX_COLORS = 64;

const LI_MATCH_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const LI_MATCH_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform int u_paletteCount;
uniform vec4 u_palette[${LI_MATCH_MAX_COLORS}];
uniform vec3 u_lab[${LI_MATCH_MAX_COLORS}];

void main() {
  float l = 1.0 - v_uv.y;
  float t = v_uv.x;
  vec3 neutral = vec3(l, 0.0, 0.0);
  float bestScore = 1e9;
  vec3 bestRgb = vec3(0.0);

  for (int i = 0; i < ${LI_MATCH_MAX_COLORS}; i++) {
    if (i >= u_paletteCount) break;
    vec3 sampleLab = u_lab[i];
    float dist = length(neutral - sampleLab);
    float score = dist * (1.0 - t) + abs(l - sampleLab.x) * t;
    if (score < bestScore) {
      bestScore = score;
      bestRgb = u_palette[i].rgb;
    }
  }

  fragColor = vec4(bestRgb, 1.0);
}`;

let $metric;
let $outline;
let $raw;

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
  const meanDist = distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : 0;
  const iss = data.length > 1 ? (meanDist / Math.max(minDist, 1e-6)) / Math.pow(data.length, 2 / 3) : 0;

  const sortedByL = [...data].sort((a, b) => a.lab.l - b.lab.l);
  const lightnesses = data.map((entry) => entry.lab.l);
  const minL = lightnesses.length ? Math.min(...lightnesses) : 0;
  const maxL = lightnesses.length ? Math.max(...lightnesses) : 0;
  const meanL = lightnesses.length ? lightnesses.reduce((sum, value) => sum + value, 0) / lightnesses.length : 0;
  const maxC = Math.max(...data.map((entry) => entry.lch.c), 0.001);
  const acyclic = isAcyclic(data.length, pairs);
  const darkest = sortedByL[0]?.index ?? 0;

  const neutralisers = data.map((source) => {
    let best = data[0] ?? source;
    let bestScore = Infinity;
    for (const candidate of data) {
      if (candidate.index === source.index) continue;
      const score = Math.hypot((source.lab.a + candidate.lab.a) * 0.5, (source.lab.b + candidate.lab.b) * 0.5) + Math.abs(source.lab.l - candidate.lab.l) * 0.12;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
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

function nearestPaletteColorForLab(lab, state) {
  let best = state.data[0];
  let bestScore = Infinity;
  for (const entry of state.data) {
    const score = labDistance(lab, entry.lab);
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
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
];

let palette = decodeHash(location.hash) ?? palettes[Math.floor(Math.random() * palettes.length)];

const rectTileConfigs = [
  { id: 'rect-hc', colorModel: 'oklch', label: 'Rect hue-lightness', axis: 'y', controlLabel: 'C', position: 0.35 },
  { id: 'rect-lc', colorModel: 'oklch', label: 'Rect hue-lightness', axis: 'y', controlLabel: 'C', position: 0.08 },
];

const polarTileConfigs = [
  { id: 'polar-okhsl', colorModel: 'okhslPolar', label: 'Polar hue-chroma', axis: 'z', controlLabel: 'L', position: 0.5 },
  { id: 'polar-oklch', colorModel: 'oklchPolar', label: 'Polar hue-lightness', axis: 'z', controlLabel: 'L', position: 0.5 },
  { id: 'polar-lc', colorModel: 'oklchPolar', label: 'Hue-lightness', axis: 'y', controlLabel: 'C', position: 0.08 },
  { id: 'polar-hc', colorModel: 'oklchPolar', label: 'Hue-lightness', axis: 'y', controlLabel: 'C', position: 0.35 },
];

const hueSideConfigs = [
  { id: 'side-0', colorModel: 'hslPolar', label: 'Purple / seaweed', axis: 'x', controlLabel: 'H', position: 0 / 6 },
  { id: 'side-1', colorModel: 'hslPolar', label: 'Red / cyan', axis: 'x', controlLabel: 'H', position: 1 / 6 },
  { id: 'side-2', colorModel: 'hslPolar', label: 'Orange / blue', axis: 'x', controlLabel: 'H', position: 2 / 6 },
  { id: 'side-3', colorModel: 'hslPolar', label: 'Olive / ultramarine', axis: 'x', controlLabel: 'H', position: 3 / 6 },
  { id: 'side-4', colorModel: 'hslPolar', label: 'Lime / violet', axis: 'x', controlLabel: 'H', position: 4 / 6 },
  { id: 'side-5', colorModel: 'hslPolar', label: 'Emerald / rose', axis: 'x', controlLabel: 'H', position: 5 / 6 },
];

const specBoxConfig = {
  id: 'specbox',
  colorModel: 'okhsl',
  label: 'OKHSL box',
  axis: 'z',
  controlLabel: 'L',
  position: 0.5,
};

const TILE_SIZE = 100;
const vizzes = [];

function createVizEntry(cfg, width, height, dynamic = false) {
  const viz = new PaletteViz({
    palette: palette.map((hex) => srgbArray(hex)),
    width,
    height,
    pixelRatio: devicePixelRatio,
    colorModel: cfg.colorModel,
    distanceMetric: $metric?.value ?? 'oklab',
    axis: cfg.axis,
    position: cfg.position,
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
  const entry = createVizEntry(cfg, TILE_SIZE, TILE_SIZE, false);
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
  const entry = createVizEntry(cfg, width, height, true);
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
  $meta.appendChild(makePanel('stats', 'Statistics', 'cell-stats'));

  $top.appendChild($rects);
  $top.appendChild($meta);
  $top.appendChild(makePanel('limatch', 'Li-match greyscale', 'cell-limatch'));
  $top.appendChild(makePanel('cubes', 'OKLab colourspace', 'cell-cubes'));

  const $strips = document.createElement('div');
  $strips.className = 'section section-strips';
  $strips.appendChild(makePanel('main', 'Main palette', 'cell-main'));
  $strips.appendChild(makePanel('neutralisers', 'Neutralisers', 'cell-neutralisers'));

  const $bottom = document.createElement('div');
  $bottom.className = 'section section-bottom';

  const $left = document.createElement('div');
  $left.className = 'section-stack stack-left';
  $left.appendChild(makePanel('rgb12', '12-bit RGB', 'cell-rgb12'));
  $left.appendChild(makePanel('hue-polar', 'Polar hue-chroma', 'cell-huepolar'));

  $bottom.appendChild($left);
  $bottom.appendChild(makePanel('mixes', 'Useful mixes', 'cell-mixes'));
  $bottom.appendChild(makePanel('polars', 'Polar hue-lightness', 'cell-polars'));
  $bottom.appendChild(makePanel('hue-sides', 'OKHSL hue sideviews', 'cell-sides'));

  const $lc = makePanel('lc-bars', 'Lightness & chroma', 'section section-lc');

  $grid.appendChild($top);
  $grid.appendChild($strips);
  $grid.appendChild($bottom);
  $grid.appendChild($lc);
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

function drawDistribution(state, mode) {
  const { canvas, ctx, width, height } = makeCanvas(92, 30);
  const border = themeVar('--c-grid', '#bbb');
  const ink = themeVar('--c-border', '#111');
  const fill = themeVar('--c-paper', '#eee');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = border;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const buckets = new Array(20).fill(0);
  for (const entry of state.data) {
    const chromaWeight = 0.25 + 0.75 * (entry.lch.c / state.maxC);
    let index = 0;
    if (mode === 'spectral') {
      index = clamp(Math.round((entry.lch.h / 360) * (buckets.length - 1)), 0, buckets.length - 1);
    } else {
      const temperature = 0.5 + 0.5 * Math.cos(((entry.lch.h - 70) * Math.PI) / 180);
      index = clamp(Math.round(temperature * (buckets.length - 1)), 0, buckets.length - 1);
    }
    buckets[index] += chromaWeight;
  }

  const maxValue = Math.max(...buckets, 1);
  const barWidth = width / buckets.length;
  ctx.fillStyle = ink;
  for (let index = 0; index < buckets.length; index++) {
    const barHeight = Math.round((buckets[index] / maxValue) * (height - 5));
    ctx.fillRect(index * barWidth + 1, height - 2 - barHeight, Math.max(1, barWidth - 1), barHeight);
  }

  return canvas;
}

function drawSpectrumStrip(mode, state) {
  const { canvas, ctx, width, height } = makeCanvas(168, 8);
  for (let x = 0; x < width; x++) {
    const hue = (x / Math.max(1, width - 1)) * 360;
    let lightness = 0.72;
    let chroma = 0.19;
    if (mode === 'c50') chroma = 0.1;
    if (mode === 'j50') lightness = 0.5;
    const sampleLab = okLab({ mode: 'oklch', l: lightness, c: chroma, h: hue });
    ctx.fillStyle = nearestPaletteColorForLab(sampleLab, state).hex;
    ctx.fillRect(x, 0, 1, height);
  }
  ctx.strokeStyle = themeVar('--c-grid', '#bbb');
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  return canvas;
}

function drawLiMatchCanvasCPU(state) {
  const { canvas, ctx, width, height } = makeCanvas(40, 92);
  const plotWidth = 28;
  const image = ctx.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    const l = 1 - y / Math.max(1, height - 1);
    for (let x = 0; x < plotWidth; x++) {
      const t = x / Math.max(1, plotWidth - 1);
      const neutral = { l, a: 0, b: 0 };
      let best = state.data[0];
      let bestScore = Infinity;
      for (const entry of state.data) {
        const score = okDistLiMatchLab(neutral, entry.lab, t);
        if (score < bestScore) {
          bestScore = score;
          best = entry;
        }
      }
      const offset = (y * width + x) * 4;
      image.data[offset] = Math.round(best.rgb[0] * 255);
      image.data[offset + 1] = Math.round(best.rgb[1] * 255);
      image.data[offset + 2] = Math.round(best.rgb[2] * 255);
      image.data[offset + 3] = 255;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = plotWidth; x < width; x++) {
      const offset = (y * width + x) * 4;
      image.data[offset] = 236;
      image.data[offset + 1] = 231;
      image.data[offset + 2] = 220;
      image.data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const marks = new Array(height).fill(0);
  const markWidth = state.data.length <= 64 ? 2 : 1;
  const markStep = state.data.length <= 64 ? 3 : 2;
  for (const entry of state.data) {
    const yy = clamp(Math.round((1 - entry.lab.l) * (height - 1)), 0, height - 1);
    const x = plotWidth + 2 + marks[yy] * markStep;
    ctx.fillStyle = entry.hex;
    ctx.fillRect(x, yy, markWidth, 1);
    marks[yy] += 1;
  }
  ctx.strokeStyle = themeVar('--c-grid', '#bbb');
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  return canvas;
}

function drawLiMatchCanvas(state) {
  const width = 40;
  const height = 92;
  const dpr = devicePixelRatio;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.className = 'canvas-box';

  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl || state.data.length > LI_MATCH_MAX_COLORS) return drawLiMatchCanvasCPU(state);

  try {
    const program = buildProgram(gl, LI_MATCH_VERT, LI_MATCH_FRAG);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);

    const positionLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const rgbData = new Float32Array(LI_MATCH_MAX_COLORS * 4);
    const labData = new Float32Array(LI_MATCH_MAX_COLORS * 3);
    state.data.slice(0, LI_MATCH_MAX_COLORS).forEach((entry, index) => {
      rgbData[index * 4] = entry.rgb[0];
      rgbData[index * 4 + 1] = entry.rgb[1];
      rgbData[index * 4 + 2] = entry.rgb[2];
      rgbData[index * 4 + 3] = 1;
      labData[index * 3] = entry.lab.l;
      labData[index * 3 + 1] = entry.lab.a;
      labData[index * 3 + 2] = entry.lab.b;
    });

    gl.uniform1i(gl.getUniformLocation(program, 'u_paletteCount'), Math.min(state.data.length, LI_MATCH_MAX_COLORS));
    gl.uniform4fv(gl.getUniformLocation(program, 'u_palette'), rgbData);
    gl.uniform3fv(gl.getUniformLocation(program, 'u_lab'), labData);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    return canvas;
  } catch {
    return drawLiMatchCanvasCPU(state);
  }
}

function drawIsoCube(state, rotate) {
  const { canvas, ctx, width, height } = makeCanvas(104, 104);
  const border = themeVar('--c-grid', '#bbb');
  const ink = themeVar('--c-border', '#111');
  const fill = themeVar('--c-paper', '#eee');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);

  const vertices = [
    [width / 2, 8],
    [width - 8, height * 0.3],
    [width - 8, height * 0.7],
    [width / 2, height - 8],
    [8, height * 0.7],
    [8, height * 0.3],
  ];
  ctx.strokeStyle = border;
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    ctx.beginPath();
    ctx.moveTo(current[0], current[1]);
    ctx.lineTo(next[0], next[1]);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(width / 2, height / 2);
  ctx.lineTo(width / 2, 0);
  ctx.moveTo(width / 2, height / 2);
  ctx.lineTo(width, height / 4);
  ctx.moveTo(width / 2, height / 2);
  ctx.lineTo(0, height / 4);
  ctx.stroke();

  const points = state.data
    .map((entry) => {
      const point = {
        x: clamp(entry.lab.a / 0.45 + 0.5, 0, 1),
        y: clamp(entry.lab.b / 0.45 + 0.5, 0, 1),
        z: entry.lab.l,
        entry,
      };
      return rotate ? { x: 1 - point.y, y: point.x, z: point.z, entry } : point;
    })
    .sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z));

  const dotSize = clamp(Math.round(32 / Math.sqrt(Math.max(state.data.length, 1))), 2, 5);
  const cx = width / 2;
  const cy = height / 2;
  const span = width * 0.34;
  const dy = height * 0.18;
  for (const point of points) {
    const xx = (point.y - point.x) * span;
    const yy = (point.x + point.y - 1) * dy - (point.z - 0.5) * height * 0.45;
    const x = cx + xx;
    const y = cy + yy;
    ctx.fillStyle = point.entry.hex;
    ctx.beginPath();
    ctx.arc(x, y, dotSize, 0, Math.PI * 2);
    ctx.fill();
    if (point.entry.index === state.darkest) {
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.arc(x, y, dotSize + 1, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return canvas;
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
  const { canvas, ctx, width, height } = makeCanvas(92, 92);
  const cx = width / 2;
  const cy = height / 2;
  const radius = width / 2 - 8;
  const border = themeVar('--c-grid', '#bbb');
  const ink = themeVar('--c-border', '#111');

  ctx.strokeStyle = border;
  [0.25, 0.5, 0.75, 1].forEach((factor) => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * factor, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  ctx.fillStyle = border;
  ctx.font = '7px Iosevka Web, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [
    ['R', 30],
    ['Y', 90],
    ['G', 145],
    ['C', 200],
    ['B', 265],
    ['M', 325],
  ].forEach(([label, angle]) => {
    const a = (angle * Math.PI) / 180;
    ctx.fillText(label, cx + Math.cos(a) * (radius + 5), cy - Math.sin(a) * (radius + 5));
  });

  const dotSize = clamp(Math.round(32 / Math.sqrt(Math.max(state.data.length, 1))), 2, 5);
  state.data.forEach((entry) => {
    const angle = (entry.lch.h * Math.PI) / 180;
    const r = (entry.lch.c / state.maxC) * radius;
    const x = cx + Math.cos(angle) * r;
    const y = cy - Math.sin(angle) * r;
    ctx.fillStyle = entry.hex;
    ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.arc(x, y, dotSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  return canvas;
}

function renderOverview($panel, state) {
  clearPanel($panel, 'Indexed palette');
  const $gridEl = document.createElement('div');
  $gridEl.className = 'idx-grid';
  const slots = Math.max(32, state.data.length);
  for (let index = 0; index < slots; index++) {
    const $slot = document.createElement('span');
    if (index < state.data.length) {
      $slot.style.background = state.data[index].hex;
      $slot.title = `${index}: ${state.data[index].hex}`;
      if (index === state.darkest) $slot.style.outline = `1px solid ${themeVar('--c-border', '#111')}`;
    } else {
      $slot.className = 'empty';
    }
    $gridEl.appendChild($slot);
  }
  $panel.appendChild($gridEl);
  addCloseColorsRow($panel, 'Close cols: 10% li-match', state.closePairs10, 10);
  addCloseColorsRow($panel, 'Close cols: 70% li-match', state.closePairs70, 10);

  const $boxes = document.createElement('div');
  $boxes.className = 'box-row';
  const issState = state.iss >= 3.5 ? 'alert' : state.iss >= 2 ? 'warn' : 'ok';
  const $iss = document.createElement('div');
  $iss.className = 'info-box';
  $iss.innerHTML = `
    <div class="info-box__label">Internal similarity</div>
    <div class="info-box__value">${state.iss.toFixed(3)}<span class="info-box__indicator" style="background:${themeVar(`--c-${issState}`, '#000')}"></span></div>
    <div class="info-box__bar" style="width:${Math.min(1, (state.iss - 0.4) / 3.1) * 100}%;background:${themeVar(`--c-${issState}`, '#000')}"></div>
  `;

  const acState = state.acyclic ? 'warn' : 'ok';
  const $acyclic = document.createElement('div');
  $acyclic.className = 'info-box';
  $acyclic.innerHTML = `
    <div class="info-box__label">Acyclic?</div>
    <div class="info-box__value">&lt;${state.acyclic ? 'yes' : 'no'}&gt;<span class="info-box__indicator" style="background:${themeVar(`--c-${acState}`, '#000')}"></span></div>
    <div class="info-box__bar" style="width:100%;background:${themeVar(`--c-${acState}`, '#000')}"></div>
  `;
  $boxes.appendChild($iss);
  $boxes.appendChild($acyclic);
  $panel.appendChild($boxes);
}

function renderStats($panel, state) {
  clearPanel($panel, 'Statistics');
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
  subTitle($panel, 'Spectral distribution');
  $panel.appendChild(drawDistribution(state, 'spectral'));
  subTitle($panel, 'Temperature distribution');
  $panel.appendChild(drawDistribution(state, 'temperature'));
}

function renderSpectrumPanel($panel, state) {
  clearPanel($panel, 'Spectrum & box');
  const $stack = document.createElement('div');
  $stack.className = 'mini-stack';
  [
    ['Spec', 'spec'],
    ['C50', 'c50'],
    ['J50', 'j50'],
  ].forEach(([label, mode]) => {
    const $row = document.createElement('div');
    $row.className = 'mini-row';
    const $label = document.createElement('div');
    $label.className = 'mini-label';
    $label.textContent = label;
    $row.appendChild($label);
    $row.appendChild(drawSpectrumStrip(mode, state));
    $stack.appendChild($row);
  });
  $panel.appendChild($stack);
  subTitle($panel, 'Specbox');
  $panel.appendChild(makePanelShader(specBoxConfig, 188, 82));
}

function renderLiMatch($panel, state) {
  clearPanel($panel, 'Li-match greyscale');
  $panel.appendChild(drawLiMatchCanvas(state));
}

function renderIsocubes($panel, state) {
  clearPanel($panel, 'OKLab colourspace');
  const $gridEl = document.createElement('div');
  $gridEl.className = 'cube-grid';
  $gridEl.appendChild(drawIsoCube(state, false));
  $gridEl.appendChild(drawIsoCube(state, true));
  $panel.appendChild($gridEl);
}

function renderLCBars($panel, state) {
  clearPanel($panel, 'Lightness & chroma');
  const $header = document.createElement('div');
  $header.className = 'lc-header';
  $header.innerHTML = '<span>Li</span><span>Chr</span>';
  $panel.appendChild($header);

  const $wrap = document.createElement('div');
  $wrap.className = 'lc-wrap';
  for (const entry of state.sortedByL) {
    const $row = document.createElement('div');
    $row.className = 'lc-row';
    $row.title = `${entry.hex}  L=${entry.lab.l.toFixed(3)} C=${entry.lch.c.toFixed(3)}`;

    const $left = document.createElement('div');
    $left.style.cssText = 'flex:1;display:flex;justify-content:flex-end;border-right:1px solid var(--c-grid)';
    const $leftBar = document.createElement('div');
    $leftBar.className = 'lc-bar lc-bar--l';
    $leftBar.style.width = `${entry.lab.l * 100}%`;
    $leftBar.style.background = entry.hex;
    $left.appendChild($leftBar);

    const $right = document.createElement('div');
    $right.style.cssText = 'flex:1;display:flex;border-left:1px solid var(--c-grid)';
    const $rightBar = document.createElement('div');
    $rightBar.className = 'lc-bar';
    $rightBar.style.width = `${(entry.lch.c / state.maxC) * 100}%`;
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

function renderHuePolar($panel, state) {
  clearPanel($panel, 'Polar hue-chroma');
  $panel.appendChild(drawHuePolar(state));
}

function renderUsefulMixes($panel, state) {
  clearPanel($panel, 'Useful mixes');
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
  clearPanel($panel, 'OKHSL hue sideviews');
  const $gridEl = document.createElement('div');
  $gridEl.className = 'viz-grid-6';
  hueSideConfigs.forEach((cfg) => {
    $gridEl.appendChild(makePanelShader(cfg, 54, 54));
  });
  $panel.appendChild($gridEl);
}

function renderRGB12($panel, state) {
  clearPanel($panel, '12-bit RGB');
  const { canvas, ctx, width, height } = makeCanvas(92, 44);
  const image = new ImageData(128, 32);
  for (let green = 0; green < 16; green++) {
    const offsetX = (green % 8) * 16;
    const offsetY = Math.floor(green / 8) * 16;
    for (let red = 0; red < 16; red++) {
      for (let blue = 0; blue < 16; blue++) {
        const lab = okLab({ mode: 'rgb', r: red / 15, g: green / 15, b: blue / 15 });
        let best = state.data[0];
        let bestScore = Infinity;
        for (const entry of state.data) {
          const score = labDistance(lab, entry.lab);
          if (score < bestScore) {
            bestScore = score;
            best = entry;
          }
        }
        const pixel = ((offsetY + red) * 128 + offsetX + blue) * 4;
        image.data[pixel] = Math.round(best.rgb[0] * 255);
        image.data[pixel + 1] = Math.round(best.rgb[1] * 255);
        image.data[pixel + 2] = Math.round(best.rgb[2] * 255);
        image.data[pixel + 3] = 255;
      }
    }
  }
  const source = document.createElement('canvas');
  source.width = 128;
  source.height = 32;
  source.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, width, height);
  ctx.strokeStyle = themeVar('--c-grid', '#bbb');
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  $panel.appendChild(canvas);
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
    if (vizzes[index].dynamic) vizzes.splice(index, 1);
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
  renderHuePolar($grid.querySelector('[data-role="hue-polar"]'), state);
  renderUsefulMixes($grid.querySelector('[data-role="mixes"]'), state);
  renderPolarGroup($grid.querySelector('[data-role="polars"]'));
  renderHueSideviews($grid.querySelector('[data-role="hue-sides"]'));
  renderRGB12($grid.querySelector('[data-role="rgb12"]'), state);
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
  <optgroup label="OK"><option value="oklab">OKLab</option><option value="oklrab">OKLrab</option></optgroup>
  <optgroup label="CIE"><option value="deltaE76">DeltaE76</option><option value="deltaE94">DeltaE94</option><option value="deltaE2000">DeltaE2000</option><option value="cielabD50">CIELab D50</option></optgroup>
  <optgroup label="Simple"><option value="rgb">RGB</option></optgroup>
`;
$metric.addEventListener('change', () => {
  vizzes.forEach(({ viz }) => {
    viz.distanceMetric = $metric.value;
  });
  $hdrR.textContent = `Colour difference: ${$metric.selectedOptions[0].text}`;
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

$ctl.insertBefore(controlLabel('Metric', $metric), $paste);
$ctl.insertBefore(controlLabel('Outline', $outline), $paste);
$ctl.insertBefore(controlLabel('Raw', $raw), $paste);

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
  $probeDot.style.background = color;
  $probeLabel.textContent = color;
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