import { PaletteViz } from 'palette-shader';
import {
  converter,
  wcagLuminance,
  filterDeficiencyProt,
  filterDeficiencyDeuter,
  filterDeficiencyTrit,
  interpolate as culoriInterpolate,
} from 'culori';
import { TargetSession, extractColorTokens } from 'token-beam';

const toSRGB = converter('rgb');
const toOKLab = converter('oklab');
const toOKLch = converter('oklch');
const simulateProtan = filterDeficiencyProt(1);
const simulateDeutan = filterDeficiencyDeuter(1);
const simulateTritan = filterDeficiencyTrit(1);

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normHue = (value) => (((value ?? 0) % 360) + 360) % 360;
const rgbToObject = (rgb) => ({ mode: 'rgb', r: rgb[0], g: rgb[1], b: rgb[2] });
const SVG_NS = 'http://www.w3.org/2000/svg';
const ISO_PLOT_SIZE = 156;
const ISO_PLOT_SCALE = 58;
const DETAIL_PIXEL_RATIO = devicePixelRatio * 2;
const MAX_PALETTE_COLORS = 128;
const COLOR_NAME_FETCH_THROTTLE_MS = 100;
const APCA_MIN_CONTRAST = 15;
const APCA_LOW_CLIP = 0.1;
const CONTRAST_SORT_OPTIONS = [
  { value: 'worst', label: 'Worst case' },
  { value: 'dark-on-light', label: 'Dark on light' },
  { value: 'light-on-dark', label: 'Light on dark' },
];
const MAIN_PALETTE_SORT_OPTIONS = [
  { value: 'original', label: 'Original order' },
  { value: 'current', label: 'Lightness' },
  { value: 'auto', label: 'Auto' },
];
const COLOR_NAME_LIST_VALUES = [
  'bestOf',
  'default',
  'short',
  'wikipedia',
  'french',
  'spanish',
  'german',
  'hindi',
  'chineseTraditional',
  'html',
  'japaneseTraditional',
  'nbsIscc',
  'ntc',
  'sanzoWadaI',
  'thesaurus',
  'xkcd',
];
const ARTICLE_LINKS = {
  contrast: [
    { label: 'APCA', href: 'https://colorandcontrast.com/#/apca' },
    { label: 'Relative luminance', href: 'https://colorandcontrast.com/#/relative-luminance' },
  ],
  polarity: [
    { label: 'Contrast polarity', href: 'https://colorandcontrast.com/#/contrast-polarity' },
    { label: 'Light mode', href: 'https://colorandcontrast.com/#/light-mode' },
    { label: 'Dark mode', href: 'https://colorandcontrast.com/#/dark-mode' },
  ],
  cvd: [
    { label: 'CVD', href: 'https://colorandcontrast.com/#/color-vision-deficiency' },
    { label: 'Confusion lines', href: 'https://colorandcontrast.com/#/color-confusion-lines' },
  ],
  simultaneous: [
    { label: 'Simultaneous contrast', href: 'https://colorandcontrast.com/#/simultaneous-contrast' },
    { label: 'Lateral inhibition', href: 'https://colorandcontrast.com/#/lateral-inhibition' },
  ],
  luminance: [
    { label: 'Relative luminance', href: 'https://colorandcontrast.com/#/relative-luminance' },
    { label: 'Dynamic range', href: 'https://colorandcontrast.com/#/dynamic-range' },
  ],
  harmony: [
    { label: 'Analogous', href: 'https://colorandcontrast.com/#/analogous-colors' },
    { label: 'Complementary', href: 'https://colorandcontrast.com/#/complimentary-colors' },
    { label: 'Split-compl.', href: 'https://colorandcontrast.com/#/split-complimentary-colors' },
    { label: 'Triadic', href: 'https://colorandcontrast.com/#/triadic-colors' },
    { label: 'Tetradic', href: 'https://colorandcontrast.com/#/tetradic-colors' },
    { label: 'Monochromatic', href: 'https://colorandcontrast.com/#/monochromatic-colors' },
  ],
  hk: [
    { label: 'HK effect', href: 'https://colorandcontrast.com/#/helmholtz-kohlrausch-effect' },
  ],
  chromostereopsis: [
    { label: 'Chromostereopsis', href: 'https://colorandcontrast.com/#/chromostereopsis' },
  ],
  temperature: [
    { label: 'Warm & cool', href: 'https://colorandcontrast.com/#/warm-and-cool-colors' },
  ],
};
const HARMONY_RULES = [
  { id: 'analogous', label: 'Analogous', kind: 'pair', target: 30, tolerance: 18 },
  { id: 'complementary', label: 'Complementary', kind: 'pair', target: 180, tolerance: 18 },
  { id: 'split-complementary', label: 'Split-compl.', kind: 'split', target: 150, splitGap: 60, tolerance: 20 },
  { id: 'triadic', label: 'Triadic', kind: 'triad', target: 120, tolerance: 16 },
  { id: 'tetradic', label: 'Tetradic', kind: 'tetrad', target: 90, tolerance: 16 },
  { id: 'monochromatic', label: 'Monochromatic', kind: 'pair', target: 0, tolerance: 12 },
];

let $metric;
let $outline;
let $raw;
let $beamToken;
let $beamConnect;
let $beamStatus;
let isoCubeRotation = 0.72;
let isoPlotMode = 'cube';
let isoPlotView = 'front';
let contrastSortMode = 'worst';
let mainPaletteSortMode = 'original';
let autoSortedPaletteHexes = null;
let autoSortRequestId = 0;
let beamSession = null;

const TOKEN_BEAM_SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || 'wss://tokenbeam.dev';
const COLOR_NAME_API_URL = 'https://api.color.pizza/v1/';

const mainPaletteSortWorker = new Worker(new URL('./sort-worker.js', import.meta.url), {
  type: 'module',
});
let analysisWorker = null;

let analysisRequestId = 0;
let latestAnalysisState = null;
let colorNamesTimer = null;
let colorNamesAbortController = null;
let colorNamesRequestId = 0;
let colorNamesLoading = false;
let colorNamesError = '';
let colorNameEntries = [];
let colorNameRequestKey = '';
let colorNameList = 'bestOf';
let colorNameListTitles = new Map(COLOR_NAME_LIST_VALUES.map((value) => [value, value]));
let colorNameListMetaLoaded = false;
let showColorNames = false;

function attachAnalysisWorker(worker) {
  worker.addEventListener('message', (event) => {
    const { type, payload } = event.data || {};
    if (!payload || payload.requestId !== analysisRequestId) return;
    if (type === 'error') {
      console.error('Analysis worker failed:', payload.message);
      return;
    }
    if (type !== 'analyzed' || !payload.state) return;
    latestAnalysisState = payload.state;
    renderAnalysisState(latestAnalysisState);
  });
}

function createAnalysisWorker() {
  const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), {
    type: 'module',
  });
  attachAnalysisWorker(worker);
  return worker;
}

function cancelAnalysisRequest() {
  analysisRequestId += 1;
  if (analysisWorker) analysisWorker.terminate();
  analysisWorker = createAnalysisWorker();
}

analysisWorker = createAnalysisWorker();

function srgbArray(input) {
  const color = toSRGB(input);
  return [clamp01(color?.r ?? 0), clamp01(color?.g ?? 0), clamp01(color?.b ?? 0)];
}

function paletteKeyOf(colors) {
  return colors.map((hex) => String(hex).toLowerCase()).join(',');
}

function colorNameListOptions() {
  return COLOR_NAME_LIST_VALUES.map((value) => ({
    value,
    label: colorNameListTitles.get(value) ?? value,
  }));
}

function sortedColorNameEntries(entries) {
  const buckets = new Map();
  colorNameEntries.forEach((entry) => {
    const key = String(entry?.requestedHex ?? entry?.hex ?? '').toLowerCase();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  });
  return entries.map((entry) => {
    const bucket = buckets.get(String(entry.hex).toLowerCase());
    return bucket?.shift() ?? null;
  });
}

function mainPaletteEntries(state) {
  return mainPaletteSortMode === 'auto' && Array.isArray(autoSortedPaletteHexes)
    ? reorderEntriesByHex(state.data, autoSortedPaletteHexes)
    : mainPaletteSortMode === 'current'
      ? state.sortedByL
      : state.data;
}

function colorNameRequestKeyOf(colors, list) {
  return `${list}::${paletteKeyOf(colors)}`;
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

function labDistance(a, b) {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

function capPalette(colors) {
  return colors.slice(0, MAX_PALETTE_COLORS);
}

function hueDistance(a, b) {
  const delta = Math.abs(normHue(a) - normHue(b));
  return Math.min(delta, 360 - delta);
}

function relativeLuminance(rgb) {
  return wcagLuminance(rgbToObject(rgb));
}

function apcaContrast(textRgb, backgroundRgb) {
  const softClamp = (value) => (value <= 0.022 ? value + (0.022 - value) ** 1.414 : value);
  const textY = softClamp(relativeLuminance(textRgb));
  const backgroundY = softClamp(relativeLuminance(backgroundRgb));
  if (Math.abs(backgroundY - textY) < 0.0005) return 0;
  let contrast;
  if (backgroundY > textY) {
    contrast = (backgroundY ** 0.56 - textY ** 0.57) * 1.14;
    if (contrast < APCA_LOW_CLIP) return 0;
    return (contrast - 0.027) * 100;
  }
  contrast = (backgroundY ** 0.65 - textY ** 0.62) * 1.14;
  if (contrast > -APCA_LOW_CLIP) return 0;
  return (contrast + 0.027) * 100;
}

const CVD_THRESHOLD = 0.045;
const CVD_FILTERS = [
  { id: 'protan', label: 'Protan', filter: simulateProtan },
  { id: 'deutan', label: 'Deutan', filter: simulateDeutan },
  { id: 'tritan', label: 'Tritan', filter: simulateTritan },
];

function apparentAgainstNeighbour(sourceLab, neighbourLab) {
  return {
    l: clamp01(sourceLab.l + (sourceLab.l - neighbourLab.l) * 0.1),
    a: sourceLab.a + (sourceLab.a - neighbourLab.a) * 0.08,
    b: sourceLab.b + (sourceLab.b - neighbourLab.b) * 0.08,
  };
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
      const mixedLab = okLab(culoriInterpolate([data[i].hex, data[j].hex], 'rgb')(0.5));
      let nearest = Infinity;
      for (const entry of data) nearest = Math.min(nearest, labDistance(mixedLab, entry.lab));
      mixes.push({
        a: data[i],
        b: data[j],
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
  const luminances = data.map((entry) => relativeLuminance(entry.rgb));
  const minL = lightnesses.length ? Math.min(...lightnesses) : 0;
  const maxL = lightnesses.length ? Math.max(...lightnesses) : 0;
  const meanL = lightnesses.length
    ? lightnesses.reduce((sum, value) => sum + value, 0) / lightnesses.length
    : 0;
  const maxC = Math.max(...data.map((entry) => entry.lch.c), 0.001);
  const acyclic = isAcyclic(data.length, pairs);
  const darkest = sortedByL[0]?.index ?? 0;
  const sortedByY = [...data]
    .map((entry, index) => ({ ...entry, luminance: luminances[index] }))
    .sort((a, b) => a.luminance - b.luminance);
  const luminanceSpan = sortedByY.length
    ? sortedByY[sortedByY.length - 1].luminance - sortedByY[0].luminance
    : 0;
  const luminanceGaps = [];
  for (let i = 0; i < sortedByY.length - 1; i++) {
    luminanceGaps.push({
      a: sortedByY[i],
      b: sortedByY[i + 1],
      gap: sortedByY[i + 1].luminance - sortedByY[i].luminance,
    });
  }
  luminanceGaps.sort((a, b) => a.gap - b.gap);
  const meanLuminance = luminances.length
    ? luminances.reduce((sum, value) => sum + value, 0) / luminances.length
    : 0;

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
        contrastDelta: Math.abs(Math.abs(sourceOnTarget) - Math.abs(targetOnSource)),
      };
    });

  const polarityPairs = contrastPairs
    .map((pair) => ({
      ...pair,
      weakerContrast: Math.min(Math.abs(pair.sourceOnTarget), Math.abs(pair.targetOnSource)),
      strongerContrast: Math.max(Math.abs(pair.sourceOnTarget), Math.abs(pair.targetOnSource)),
    }))
    .sort((a, b) => b.contrastDelta - a.contrastDelta || a.weakerContrast - b.weakerContrast);

  const luminancePairs = contrastPairs
    .map((pair) => ({
      ...pair,
      deltaY: Math.abs(luminances[pair.i] - luminances[pair.j]),
    }))
    .sort((a, b) => a.deltaY - b.deltaY);

  const neighbourPairs = pairs
    .map((pair) => {
      const source = data[pair.i];
      const target = data[pair.j];
      const apparentSource = apparentAgainstNeighbour(source.lab, target.lab);
      const apparentTarget = apparentAgainstNeighbour(target.lab, source.lab);
      const apparentDist = labDistance(apparentSource, apparentTarget);
      return {
        ...pair,
        apparentDist,
        influence: apparentDist - pair.dist,
      };
    })
    .sort((a, b) => b.influence - a.influence);

  const chromaticPairs = [];
  const chromaticEntries = data.filter((entry) => entry.lch.c >= 0.03);
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      if (data[i].lch.c < 0.03 || data[j].lch.c < 0.03) continue;
      chromaticPairs.push({
        i,
        j,
        delta: hueDistance(data[i].lch.h, data[j].lch.h),
      });
    }
  }

  const chromaticTriads = [];
  for (let i = 0; i < chromaticEntries.length; i++) {
    for (let j = i + 1; j < chromaticEntries.length; j++) {
      for (let k = j + 1; k < chromaticEntries.length; k++) {
        const triad = [chromaticEntries[i], chromaticEntries[j], chromaticEntries[k]];
        const sorted = [...triad].sort((a, b) => a.lch.h - b.lch.h);
        const gaps = [
          sorted[1].lch.h - sorted[0].lch.h,
          sorted[2].lch.h - sorted[1].lch.h,
          360 - (sorted[2].lch.h - sorted[0].lch.h),
        ];
        chromaticTriads.push({
          indices: triad.map((entry) => entry.index),
          gaps,
        });
      }
    }
  }

  const chromaticTetrads = [];
  for (let i = 0; i < chromaticEntries.length; i++) {
    for (let j = i + 1; j < chromaticEntries.length; j++) {
      for (let k = j + 1; k < chromaticEntries.length; k++) {
        for (let m = k + 1; m < chromaticEntries.length; m++) {
          const tetrad = [chromaticEntries[i], chromaticEntries[j], chromaticEntries[k], chromaticEntries[m]];
          const sorted = [...tetrad].sort((a, b) => a.lch.h - b.lch.h);
          const gaps = [
            sorted[1].lch.h - sorted[0].lch.h,
            sorted[2].lch.h - sorted[1].lch.h,
            sorted[3].lch.h - sorted[2].lch.h,
            360 - (sorted[3].lch.h - sorted[0].lch.h),
          ];
          chromaticTetrads.push({
            indices: tetrad.map((entry) => entry.index),
            gaps,
          });
        }
      }
    }
  }

  const harmonyAnalyses = HARMONY_RULES.map((rule) => {
    if (rule.kind === 'split') {
      // Split-complementary: two gaps near target (150°) and one gap near splitGap (60°)
      const ranked = chromaticTriads
        .map((triad) => {
          const sorted3 = [...triad.gaps].sort((a, b) => a - b);
          // Smallest gap should match splitGap, two larger gaps should match target
          const splitError = Math.abs(sorted3[0] - rule.splitGap);
          const bigError = Math.max(Math.abs(sorted3[1] - rule.target), Math.abs(sorted3[2] - rule.target));
          return {
            ...triad,
            error: Math.max(splitError, bigError),
            meanGap: triad.gaps.reduce((sum, gap) => sum + gap, 0) / triad.gaps.length,
          };
        })
        .sort((a, b) => a.error - b.error);
      const matches = ranked.filter((triad) => triad.error <= rule.tolerance);
      return {
        ...rule,
        kind: 'triad',
        count: matches.length,
        setCount: chromaticTriads.length,
        coverage: chromaticTriads.length ? matches.length / chromaticTriads.length : 0,
        closest: ranked[0] ?? null,
      };
    }

    if (rule.kind === 'tetrad') {
      const ranked = chromaticTetrads
        .map((tetrad) => ({
          ...tetrad,
          error: Math.max(...tetrad.gaps.map((gap) => Math.abs(gap - rule.target))),
          meanGap: tetrad.gaps.reduce((sum, gap) => sum + gap, 0) / tetrad.gaps.length,
        }))
        .sort((a, b) => a.error - b.error);
      const matches = ranked.filter((tetrad) => tetrad.error <= rule.tolerance);
      return {
        ...rule,
        count: matches.length,
        setCount: chromaticTetrads.length,
        coverage: chromaticTetrads.length ? matches.length / chromaticTetrads.length : 0,
        closest: ranked[0] ?? null,
      };
    }

    if (rule.kind === 'triad') {
      const ranked = chromaticTriads
        .map((triad) => ({
          ...triad,
          error: Math.max(...triad.gaps.map((gap) => Math.abs(gap - rule.target))),
          meanGap: triad.gaps.reduce((sum, gap) => sum + gap, 0) / triad.gaps.length,
        }))
        .sort((a, b) => a.error - b.error);
      const matches = ranked.filter((triad) => triad.error <= rule.tolerance);
      return {
        ...rule,
        count: matches.length,
        setCount: chromaticTriads.length,
        coverage: chromaticTriads.length ? matches.length / chromaticTriads.length : 0,
        closest: ranked[0] ?? null,
      };
    }

    const ranked = chromaticPairs
      .map((pair) => ({
        ...pair,
        error: Math.abs(pair.delta - rule.target),
      }))
      .sort((a, b) => a.error - b.error);
    const matches = ranked.filter((pair) => pair.error <= rule.tolerance);
    return {
      ...rule,
      count: matches.length,
      setCount: chromaticPairs.length,
      coverage: chromaticPairs.length ? matches.length / chromaticPairs.length : 0,
      closest: ranked[0] ?? null,
    };
  });

  const cvdAnalyses = CVD_FILTERS.map(({ id, label, filter }) => {
    const simulated = data.map((entry) => ({
      ...entry,
      simLab: okLab(filter(rgbToObject(entry.rgb))),
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

  // Helmholtz-Kohlrausch effect: high-chroma colors appear brighter than
  // their luminance suggests. The HK correction uses Nayatani's formula
  // approximated via OKLch chroma as a proxy for saturation.
  // Factor: perceived_L ≈ L + f(chroma) where f scales with chroma.
  const hkEntries = data.map((entry, index) => {
    const y = luminances[index];
    // Nayatani-style HK factor: chroma drives the perceived brightness boost.
    // OKLch C typically ranges 0–0.4; scale so a fully saturated color
    // gets roughly +0.15 perceived-luminance boost.
    const hkBoost = entry.lch.c * 0.37;
    const perceivedY = Math.min(1, y + hkBoost);
    return { index, hex: entry.hex, y, perceivedY, boost: hkBoost, chroma: entry.lch.c };
  });
  const hkPairs = [];
  for (let i = 0; i < hkEntries.length; i++) {
    for (let j = i + 1; j < hkEntries.length; j++) {
      const a = hkEntries[i];
      const b = hkEntries[j];
      // Cases where luminance order and perceived order disagree
      const lumDelta = a.y - b.y;
      const percDelta = a.perceivedY - b.perceivedY;
      const flipped = (lumDelta > 0.02 && percDelta < -0.02) || (lumDelta < -0.02 && percDelta > 0.02);
      hkPairs.push({
        i, j,
        lumDelta: Math.abs(lumDelta),
        percDelta: Math.abs(percDelta),
        boostDelta: Math.abs(a.boost - b.boost),
        flipped,
      });
    }
  }
  hkPairs.sort((a, b) => b.boostDelta - a.boostDelta);

  // Chromostereopsis: heuristic depth-separation risk based on strong
  // chromatic separation, opponent hue distance, and some lightness contrast.
  const CHROMA_STEREO_MIN = 0.06;
  const stereopsisPairs = [];
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      if (data[i].lch.c < CHROMA_STEREO_MIN || data[j].lch.c < CHROMA_STEREO_MIN) continue;
      const hueDelta = hueDistance(data[i].lch.h, data[j].lch.h);
      const minChroma = Math.min(data[i].lch.c, data[j].lch.c);
      const lightnessDelta = Math.abs(data[i].lab.l - data[j].lab.l);
      const hueFactor = Math.sin((hueDelta * Math.PI) / 360);
      const severity = minChroma * (0.4 + 0.6 * hueFactor) * (0.75 + 0.25 * lightnessDelta);
      stereopsisPairs.push({
        i,
        j,
        severity,
        minChroma,
        hueDelta,
        hueFactor,
        lightnessDelta,
      });
    }
  }
  stereopsisPairs.sort((a, b) => b.severity - a.severity);

  // Warm/Cool classification based on OKLch hue.
  // Warm: 0–90° and 330–360° (reds, oranges, yellows)
  // Cool: 90–330° (greens, blues, purples)
  // Near-neutral colors (low chroma) are classified as neutral.
  const WARM_COOL_CHROMA_MIN = 0.03;
  const temperature = data.map((entry) => {
    if (entry.lch.c < WARM_COOL_CHROMA_MIN) return { ...entry, temp: 'neutral' };
    const h = entry.lch.h;
    if (h <= 90 || h >= 330) return { ...entry, temp: 'warm' };
    return { ...entry, temp: 'cool' };
  });
  const warmCount = temperature.filter((e) => e.temp === 'warm').length;
  const coolCount = temperature.filter((e) => e.temp === 'cool').length;
  const neutralCount = temperature.filter((e) => e.temp === 'neutral').length;

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
    luminances,
    sortedByY,
    luminanceSpan,
    meanLuminance,
    luminanceGaps,
    neutralisers,
    mixes: usefulMixes(data, 14),
    contrastPairs,
    polarityPairs,
    luminancePairs,
    neighbourPairs,
    harmonyAnalyses,
    cvdAnalyses,
    hkEntries,
    hkPairs,
    stereopsisPairs,
    temperature,
    warmCount,
    coolCount,
    neutralCount,
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

function reorderEntriesByHex(entries, sortedHexes) {
  const buckets = new Map();
  entries.forEach((entry) => {
    const key = entry.hex.toLowerCase();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  });

  const ordered = [];
  sortedHexes.forEach((hex) => {
    const bucket = buckets.get(String(hex).toLowerCase());
    if (bucket?.length) ordered.push(bucket.shift());
  });

  buckets.forEach((remaining) => ordered.push(...remaining));
  return ordered;
}

function requestAutoPaletteSort() {
  const requestId = ++autoSortRequestId;
  mainPaletteSortWorker.postMessage({ hexes: [...palette], requestId });
}

mainPaletteSortWorker.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  if (!payload || payload.requestId !== autoSortRequestId) return;
  if (type !== 'sorted' || !Array.isArray(payload.sorted)) return;
  autoSortedPaletteHexes = payload.sorted;
  if (mainPaletteSortMode === 'auto' && latestAnalysisState) {
    renderMainPalette($grid.querySelector('[data-role="main"]'), latestAnalysisState);
  }
});

analysisWorker.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  if (!payload || payload.requestId !== analysisRequestId) return;
  if (type === 'error') {
    console.error('Analysis worker failed:', payload.message);
    return;
  }
  if (type !== 'analyzed' || !payload.state) return;
  latestAnalysisState = payload.state;
  renderAnalysisState(latestAnalysisState);
});
function checkerBackground(a, b, size = 2) {
  return `repeating-conic-gradient(${a} 0 25%, #0000 0 50%) 50% / ${size}px ${size}px, ${b}`;
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

function renderColorNamesIfReady() {
  if (!latestAnalysisState) return;
  renderMainPalette($grid.querySelector('[data-role="main"]'), latestAnalysisState);
}

async function loadColorNameListMetadata() {
  if (colorNameListMetaLoaded) return;
  colorNameListMetaLoaded = true;
  try {
    const response = await fetch(`${COLOR_NAME_API_URL}lists/`);
    if (!response.ok) throw new Error(`Color name list metadata returned ${response.status}`);
    const payload = await response.json();
    const listDescriptions = payload?.listDescriptions ?? {};
    COLOR_NAME_LIST_VALUES.forEach((value) => {
      const title = listDescriptions?.[value]?.title;
      if (typeof title === 'string' && title.trim()) colorNameListTitles.set(value, title.trim());
    });
    renderColorNamesIfReady();
  } catch (error) {
    console.error('Could not load color-name list metadata:', error);
  }
}

function abortColorNamesFetch() {
  if (colorNamesTimer !== null) {
    window.clearTimeout(colorNamesTimer);
    colorNamesTimer = null;
  }
  if (colorNamesAbortController) {
    colorNamesAbortController.abort();
    colorNamesAbortController = null;
  }
}

async function fetchColorNames(colors, requestId, controller, paletteKey) {
  const values = colors.map((hex) => String(hex).replace(/^#/, '')).join(',');
  const url = `${COLOR_NAME_API_URL}?values=${encodeURIComponent(values)}&list=${encodeURIComponent(colorNameList)}&noduplicates=false`;
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) throw new Error(`Color name API returned ${response.status}`);
  const payload = await response.json();
  if (requestId !== colorNamesRequestId || paletteKey !== colorNameRequestKey) return;
  colorNamesAbortController = null;
  colorNamesLoading = false;
  colorNamesError = '';
  colorNameEntries = Array.isArray(payload?.colors) ? payload.colors : [];
  renderColorNamesIfReady();
}

function scheduleColorNamesFetch(colors) {
  const nextColors = [...colors];
  colorNameRequestKey = colorNameRequestKeyOf(nextColors, colorNameList);
  colorNamesLoading = true;
  colorNamesError = '';
  colorNameEntries = [];
  renderColorNamesIfReady();
  abortColorNamesFetch();
  const requestId = ++colorNamesRequestId;
  const requestPaletteKey = colorNameRequestKey;
  colorNamesTimer = window.setTimeout(() => {
    colorNamesTimer = null;
    const controller = new AbortController();
    colorNamesAbortController = controller;
    fetchColorNames(nextColors, requestId, controller, requestPaletteKey).catch((error) => {
      if (controller.signal.aborted || requestId !== colorNamesRequestId) return;
      colorNamesAbortController = null;
      colorNamesLoading = false;
      colorNamesError = error instanceof Error ? error.message : String(error);
      colorNameEntries = [];
      renderColorNamesIfReady();
    });
  }, COLOR_NAME_FETCH_THROTTLE_MS);
}

const $grid = document.querySelector('[data-grid]');
const $ctl = document.querySelector('[data-ctl]');
const $paste = document.querySelector('[data-paste]');
const $beam = document.querySelector('[data-beam]');
const $hdrL = document.querySelector('[data-hdr-l]');
const $hdrR = document.querySelector('[data-hdr-r]');
const $probe = document.querySelector('.cursor-probe');
const $probeDot = $probe.querySelector('.cursor-probe__dot');
const $probeLabel = $probe.querySelector('.cursor-probe__label');

function beamShowError(message) {
  if (!$beamStatus) return;
  $beamStatus.textContent = message;
  $beamStatus.dataset.state = 'error';
}

function beamClearError() {
  if (!$beamStatus) return;
  delete $beamStatus.dataset.state;
  $beamStatus.textContent = '';
}

function beamResetUI() {
  if (!$beamToken || !$beamConnect) return;
  $beamToken.disabled = false;
  $beamConnect.textContent = 'Connect';
  $beamConnect.disabled = !$beamToken.value.trim();
  beamSession = null;
}

function applyBeamPalette(colors) {
  const cappedColors = capPalette(colors);
  if (cappedColors.length < 1) return;
  palette = cappedColors;
  $paste.value = palette.join(' ');
  updateAll();
}

function initTokenBeamControls() {
  if (!$beam) return;
  $beamToken = $beam.querySelector('[data-beam-token]');
  $beamConnect = $beam.querySelector('[data-beam-connect]');
  $beamStatus = $beam.querySelector('[data-beam-status]');
  if (!$beamToken || !$beamConnect || !$beamStatus) return;

  $beamToken.addEventListener('input', () => {
    beamClearError();
    $beamConnect.disabled = !$beamToken.value.trim();
  });

  $beamConnect.addEventListener('click', () => {
    if (beamSession) {
      beamSession.disconnect();
      beamResetUI();
      beamClearError();
      return;
    }

    const token = $beamToken.value.trim();
    if (!token) return;

    beamClearError();
    $beamToken.disabled = true;
    $beamConnect.disabled = true;

    beamSession = new TargetSession({
      serverUrl: TOKEN_BEAM_SERVER_URL,
      clientType: 'palette-shader',
      sessionToken: token,
    });

    beamSession.on('paired', () => {
      $beamConnect.textContent = 'Disconnect';
      $beamConnect.disabled = false;
    });

    beamSession.on('sync', ({ payload }) => {
      const hexColors = [...new Set(extractColorTokens(payload).map((entry) => entry.hex))];
      if (hexColors.length >= 1) {
        applyBeamPalette(hexColors);
      }
    });

    beamSession.on('error', ({ message }) => {
      beamShowError(message);
      beamResetUI();
    });

    beamSession.on('disconnected', () => {
      beamResetUI();
      beamClearError();
    });

    beamSession.connect().catch((err) => {
      beamShowError(err instanceof Error ? err.message : 'Could not connect');
      beamResetUI();
    });
  });
}

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

let palette = capPalette(decodeHash(location.hash) ?? palettes[Math.floor(Math.random() * palettes.length)]);

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
    label: 'C',
    axis: 'y',
    controlLabel: 'C',
    position: 0.8,
    invertAxes: ['z'],
  },
  {
    id: 'polar-lo-inv',
    colorModel: 'oklchPolar',
    label: 'C',
    axis: 'y',
    controlLabel: 'C',
    position: 0.8,
  },
];

const hueSideConfigs = [
  {
    id: 'side-0',
    colorModel: 'oklrchDiag',
    label: 'Slice 1',
    axis: 'x',
    controlLabel: 'H',
    position: 0.33,
  },
  {
    id: 'side-1',
    colorModel: 'oklrchDiag',
    label: 'Slice 2',
    axis: 'x',
    controlLabel: 'H',
    position: 0.66,
  },
  {
    id: 'side-2',
    colorModel: 'oklrchDiag',
    label: 'Slice 3',
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
  $extra.appendChild(makePanel('polarity', 'Contrast polarity', 'cell-polarity'));
  $extra.appendChild(makePanel('cvd', 'CVD collapse', 'cell-cvd'));
  $extra.appendChild(makePanel('simultaneous', 'Neighbour influence', 'cell-simultaneous'));
  $extra.appendChild(makePanel('luminance', 'Luminance spread', 'cell-luminance'));
  $extra.appendChild(makePanel('harmony', 'Harmony structure', 'cell-harmony'));
  $extra.appendChild(makePanel('hk', 'Helmholtz-Kohlrausch', 'cell-hk'));
  $extra.appendChild(makePanel('stereopsis', 'Chromostereopsis', 'cell-stereopsis'));
  $extra.appendChild(makePanel('temperature', 'Warm / Cool', 'cell-temperature'));

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
    $pair.innerHTML = `<span style="--c:${palette[pair.i]}"></span><span style="--c:${palette[pair.j]}"></span>`;
    $row.appendChild($pair);
  }
  $panel.appendChild($row);
}

function addPairRow($panel, pair, state) {
  const $row = document.createElement('div');
  $row.className = 'pr';
  $row.innerHTML = `
    <span class="pr__s" style="--c:${palette[pair.i]}"></span>
    <span style="color:${themeVar('--c-muted', '#777')}">↔</span>
    <span class="pr__s" style="--c:${palette[pair.j]}"></span>
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

  const dotsGroup = svgEl('g', { class: 'iso-cube__dots' });
  points.forEach(({ entry, projected }) => {
    const point = toSvgPoint(projected);
    const radius = colourspaceDotRadius(state, clamp(entry.lch.c / 0.322, 0, 1));
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

  const dotsGroup = svgEl('g', { class: 'iso-cube__dots' });
  points.forEach(({ entry, projected }) => {
    const point = {
      x: projected.x + cx,
      y: projected.y + cy - projectIsoPoint(0.5, 0, 0, cosY, sinY, ISO_PLOT_SCALE).y,
    };
    const radiusScale = clamp(entry.lch.c / 0.322, 0, 1);
    const circle = svgEl('circle', {
      class: 'iso-cube__dot',
      cx: point.x,
      cy: point.y,
      r: colourspaceDotRadius(state, radiusScale),
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
  const { canvas, ctx, width, height } = makeCanvas(ISO_PLOT_SIZE, ISO_PLOT_SIZE);
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

function colourspaceDotRadius(state, chromaNorm = 0.5) {
  const count = state.data.length;
  const minRadius = count <= 24 ? 1 : 0.5;
  const maxRadius = count <= 64 ? 2.5 : count <= 128 ? 2 : 1.5;
  return 1 + minRadius + Math.round(clamp(chromaNorm, 0, 1) * (maxRadius - minRadius));
}

function drawOkLabTop(state) {
  const width = ISO_PLOT_SIZE;
  const height = ISO_PLOT_SIZE;
  const border = themeVar('--c-grid', '#bbb');
  const ink = themeVar('--c-border', '#111');
  const fill = themeVar('--c-paper', '#eee');
  const plotWidth = width;
  const plotHeight = height;
  const originX = 0;
  const originY = height;
  const mapX = (value) => originX + clamp(value, 0, 1) * plotWidth;
  const mapY = (value) => originY - clamp(value, 0, 1) * plotHeight;

  const svg = svgEl('svg', {
    class: 'canvas-box polar-plot',
    role: 'img',
    'aria-label': 'OKLab top view',
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
  });

  svg.appendChild(
    svgEl('rect', {
      x: 0,
      y: 0,
      width,
      height,
      fill,
    }),
  );

  [0.25, 0.5, 0.75].forEach((factor) => {
    svg.appendChild(
      svgEl('line', {
        x1: mapX(factor),
        y1: mapY(0),
        x2: mapX(factor),
        y2: mapY(1),
        stroke: border,
        'stroke-width': 1,
        'stroke-dasharray': '2 2',
        opacity: 0.85,
        'vector-effect': 'non-scaling-stroke',
      }),
    );
    svg.appendChild(
      svgEl('line', {
        x1: mapX(0),
        y1: mapY(factor),
        x2: mapX(1),
        y2: mapY(factor),
        stroke: border,
        'stroke-width': 1,
        'stroke-dasharray': '2 2',
        opacity: 0.85,
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  });

  svg.appendChild(
    svgEl('rect', {
      x: originX,
      y: mapY(1),
      width: plotWidth,
      height: plotHeight,
      fill: 'none',
      stroke: border,
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  svg.appendChild(
    svgEl('line', {
      x1: mapX(0.5),
      y1: mapY(0),
      x2: mapX(0.5),
      y2: mapY(1),
      stroke: border,
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  svg.appendChild(
    svgEl('line', {
      x1: mapX(0),
      y1: mapY(0.5),
      x2: mapX(1),
      y2: mapY(0.5),
      stroke: border,
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
    }),
  );

  const axisX = svgEl('text', {
    x: width - 8,
    y: height - 8,
    fill: border,
    'font-size': 7,
    'font-family': 'Iosevka Web, monospace',
    'text-anchor': 'end',
    'dominant-baseline': 'alphabetic',
  });
  axisX.textContent = 'a';
  svg.appendChild(axisX);

  const axisY = svgEl('text', {
    x: 9,
    y: 10,
    fill: border,
    'font-size': 7,
    'font-family': 'Iosevka Web, monospace',
    'text-anchor': 'middle',
    transform: `rotate(-90 9 10)`,
  });
  axisY.textContent = 'b';
  svg.appendChild(axisY);

  state.data.forEach((entry) => {
    const x = mapX((entry.lab.a + 0.45) / 0.9);
    const y = mapY((entry.lab.b + 0.45) / 0.9);
    const dotSize = colourspaceDotRadius(state, clamp(entry.lch.c / 0.322, 0, 1));
    svg.appendChild(
      svgEl('circle', {
        cx: x,
        cy: y,
        r: dotSize,
        fill: entry.hex,
        stroke: ink,
        'stroke-width': 1,
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  });

  return svg;
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

  state.data.forEach((entry) => {
    const angle = (entry.lch.h * Math.PI) / 180;
    const chromaNorm = clamp(entry.lch.c / 0.322, 0, 1);
    const r = chromaNorm * radius;
    const dotSize = colourspaceDotRadius(state, chromaNorm);
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

  const $views = document.createElement('div');
  $views.className = 'iso-cube__modes';
  [
    ['front', 'Front'],
    ['top', 'Top'],
  ].forEach(([view, label]) => {
    const $button = document.createElement('button');
    $button.type = 'button';
    $button.className = 'iso-cube__mode';
    if (view === isoPlotView) $button.dataset.active = 'true';
    $button.textContent = label;
    $button.addEventListener('click', () => {
      if (isoPlotView === view) return;
      isoPlotView = view;
      renderIsocubes($panel, state);
    });
    $views.appendChild($button);
  });
  $toolbar.appendChild($views);

  $wrap.appendChild($toolbar);

  const $plotPanel = document.createElement('div');
  $plotPanel.className = 'iso-cube__panel';
  if (isoPlotView === 'top') {
    $plotPanel.appendChild(isoPlotMode === 'cylinder' ? drawHuePolar(state) : drawOkLabTop(state));
  } else {
    $plotPanel.appendChild(makeIsoCubeSvg(state));
  }

  const $hint = document.createElement('div');
  $hint.className = 'iso-cube__hint';
  if (isoPlotView === 'top') {
    $hint.textContent = isoPlotMode === 'cylinder' ? 'top view: polar hue-chroma' : 'top view: OKLab a/b';
  } else {
    $hint.textContent = isoPlotMode === 'cylinder' ? 'front view: drag to rotate cylinder' : 'front view: drag to rotate cube';
  }
  $plotPanel.appendChild($hint);

  $wrap.appendChild($plotPanel);
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
  clearPanel($panel);
  const $head = document.createElement('div');
  $head.className = 'pnl__head';
  const $title = document.createElement('div');
  $title.className = 'pnl__t';
  $title.textContent = 'Main palette';
  $head.appendChild($title);

  const $controls = document.createElement('div');
  $controls.className = 'main-palette__controls';

  const $sort = metricToolbarSelect(MAIN_PALETTE_SORT_OPTIONS, mainPaletteSortMode, (value) => {
    mainPaletteSortMode = value;
    if (mainPaletteSortMode === 'auto' && !autoSortedPaletteHexes) requestAutoPaletteSort();
    renderMainPalette($panel, state);
  });
  $sort.classList.add('metric-toolbar--inline');
  const $sortLabel = document.createElement('span');
  $sortLabel.className = 'metric-toolbar__label';
  $sortLabel.textContent = 'Sort';
  $sort.insertBefore($sortLabel, $sort.firstChild);
  $controls.appendChild($sort);

  const $namesToggle = document.createElement('button');
  $namesToggle.type = 'button';
  $namesToggle.className = 'metric-link metric-link--button';
  $namesToggle.textContent = showColorNames ? 'names v' : 'names >';
  $namesToggle.addEventListener('click', () => {
    showColorNames = !showColorNames;
    if (showColorNames) {
      scheduleColorNamesFetch(palette);
    } else {
      abortColorNamesFetch();
      colorNamesLoading = false;
    }
    renderMainPalette($panel, state);
  });
  $controls.appendChild($namesToggle);

  if (showColorNames) {
    const $listSelect = metricToolbarSelect(colorNameListOptions(), colorNameList, (value) => {
      colorNameList = value;
      scheduleColorNamesFetch(palette);
      renderMainPalette($panel, state);
    });
    $listSelect.classList.add('metric-toolbar--inline');
    const $listLabel = document.createElement('span');
    $listLabel.className = 'metric-toolbar__label';
    $listLabel.textContent = 'List';
    $listSelect.insertBefore($listLabel, $listSelect.firstChild);
    $controls.appendChild($listSelect);
  }

  $head.appendChild($controls);
  $panel.appendChild($head);

  const $row = document.createElement('div');
  $row.className = 'strip-row';
  const $strip = document.createElement('div');
  $strip.className = 'strip';
  const entries = mainPaletteEntries(state);
  entries.forEach((entry) => {
    const $slot = document.createElement('span');
    $slot.style.background = entry.hex;
    $slot.title = entry.hex;
    $strip.appendChild($slot);
  });
  $row.appendChild($strip);
  $panel.appendChild($row);

  if (showColorNames) appendColorNamesSection($panel, state, entries);
}

function appendColorNamesSection($panel, state, entries) {
  appendMetricLinks($panel, [{ label: 'API', href: 'https://meodai.github.io/color-name-api/' }]);
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  if (colorNamesLoading) {
    $note.textContent = `Fetching ${colorNameList} names...`;
    $panel.appendChild($note);
    return;
  }
  if (colorNamesError) {
    $note.textContent = `Could not load names: ${colorNamesError}`;
    $panel.appendChild($note);
    return;
  }

  const currentKey = colorNameRequestKeyOf(state.data.map((entry) => entry.hex), colorNameList);
  if (colorNameRequestKey !== currentKey) {
    $note.textContent = `Waiting for ${colorNameList} names...`;
    $panel.appendChild($note);
    return;
  }

  const $gridEl = document.createElement('div');
  $gridEl.className = 'name-grid';
  const sortedMatches = sortedColorNameEntries(entries);
  entries.forEach((entry, index) => {
    const match = sortedMatches[index];
    const title = match?.name ?? 'Unknown';
    const matchedHex = match?.hex ?? entry.hex;
    const distance = Number.isFinite(match?.distance) ? match.distance.toFixed(2) : '0.00';

    const $chip = document.createElement('div');
    $chip.className = 'name-chip';
    $chip.title = `${entry.hex} -> ${title}`;

    const $swatch = document.createElement('span');
    $swatch.className = 'name-chip__swatch';
    $swatch.style.background = entry.hex;

    const $copy = document.createElement('span');
    $copy.className = 'name-chip__copy';

    const $title = document.createElement('span');
    $title.className = 'name-chip__title';
    $title.textContent = title;

    const $meta = document.createElement('span');
    $meta.className = 'name-chip__meta';
    $meta.textContent = `${matchedHex} · Δ ${distance}`;

    $copy.appendChild($title);
    $copy.appendChild($meta);
    $chip.appendChild($swatch);
    $chip.appendChild($copy);
    $gridEl.appendChild($chip);
  });
  $panel.appendChild($gridEl);
}

function renderNeutralisers($panel, state) {
  clearPanel($panel, 'Neutralisers');
  const $strip = document.createElement('div');
  $strip.className = 'dither-strip';
  state.sortedByL.forEach((entry) => {
    const partner = state.neutralisers[entry.index] ?? entry;
    const $slot = document.createElement('div');
    $slot.className = 'dither-strip__slot';
    $slot.title = `${entry.hex} -> ${partner.hex}`;

    const $top = document.createElement('span');
    $top.className = 'dither-strip__top';
    $top.style.background = partner.hex;

    const $bottom = document.createElement('span');
    $bottom.className = 'dither-strip__bottom';
    $bottom.style.background = checkerBackground(entry.hex, partner.hex);

    $slot.appendChild($top);
    $slot.appendChild($bottom);
    $strip.appendChild($slot);
  });
  $panel.appendChild($strip);
}

function renderUsefulMixes($panel, state) {
  clearPanel($panel, 'mixes');
  const $gridEl = document.createElement('div');
  $gridEl.className = 'mix-grid';
  state.mixes.forEach((mix, index) => {
    const $cell = document.createElement('span');
    $cell.className = 'mix-grid__cell';
    $cell.title = `${mix.a.hex} + ${mix.b.hex}`;
    $cell.style.background = checkerBackground(mix.a.hex, mix.b.hex);
    $gridEl.appendChild($cell);
  });
  $panel.appendChild($gridEl);
}

function renderPolarGroup($panel) {
  clearPanel($panel, 'Polar hue-lightness');
  const $gridEl = document.createElement('div');
  $gridEl.className = 'viz-grid-4';
  polarTileConfigs.forEach((cfg) => {
    const $card = makePanelShader(cfg, 100, 100);
    $card.querySelector('.viz-title')?.remove();
    $gridEl.appendChild($card);
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

function sortedContrastPairs(state) {
  const pairs = [...state.contrastPairs];
  if (contrastSortMode === 'dark-on-light') {
    pairs.sort((a, b) => Math.abs(a.sourceOnTarget) - Math.abs(b.sourceOnTarget));
    return pairs;
  }
  if (contrastSortMode === 'light-on-dark') {
    pairs.sort((a, b) => Math.abs(a.targetOnSource) - Math.abs(b.targetOnSource));
    return pairs;
  }
  pairs.sort((a, b) => {
    if (a.bestContrast !== b.bestContrast) return a.bestContrast - b.bestContrast;
    return b.contrastDelta - a.contrastDelta;
  });
  return pairs;
}

function metricToolbarSelect(options, value, onChange) {
  const $wrap = document.createElement('div');
  $wrap.className = 'metric-toolbar';
  const $select = document.createElement('select');
  options.forEach((option) => {
    const $option = document.createElement('option');
    $option.value = option.value;
    $option.textContent = option.label;
    if (option.value === value) $option.selected = true;
    $select.appendChild($option);
  });
  $select.addEventListener('change', () => onChange($select.value));
  $wrap.appendChild($select);
  return $wrap;
}

function appendMetricLinks($panel, links) {
  const $links = document.createElement('div');
  $links.className = 'metric-links';
  links.forEach((link) => {
    const $anchor = document.createElement('a');
    $anchor.className = 'metric-link';
    $anchor.href = link.href;
    $anchor.target = '_blank';
    $anchor.rel = 'noreferrer';
    $anchor.textContent = link.label;
    $links.appendChild($anchor);
  });
  $panel.appendChild($links);
}

function renderContrastPanel($panel, state) {
  clearPanel($panel);
  const $head = document.createElement('div');
  $head.className = 'pnl__head';
  const $title = document.createElement('div');
  $title.className = 'pnl__t';
  $title.textContent = 'Perceptual contrast';
  $head.appendChild($title);

  const $sort = metricToolbarSelect(CONTRAST_SORT_OPTIONS, contrastSortMode, (value) => {
    contrastSortMode = value;
    renderContrastPanel($panel, state);
  });
  $sort.classList.add('metric-toolbar--inline');
  const $sortLabel = document.createElement('span');
  $sortLabel.className = 'metric-toolbar__label';
  $sortLabel.textContent = 'Sort';
  $sort.insertBefore($sortLabel, $sort.firstChild);
  $head.appendChild($sort);
  $panel.appendChild($head);

  appendMetricLinks($panel, ARTICLE_LINKS.contrast);
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = `Lower = weaker text/background separation, under ${APCA_MIN_CONTRAST} is fragile`;
  $panel.appendChild($note);

  const $list = document.createElement('div');
  $list.className = 'metric-list';
  sortedContrastPairs(state)
    .slice(0, 6)
    .forEach((pair) => {
    const $row = document.createElement('div');
    $row.className = 'metric-row';
    if (pair.bestContrast < APCA_MIN_CONTRAST) $row.classList.add('metric-row--danger');
    $row.innerHTML = `
      <div class="metric-pair">
        <span style="--c:${palette[pair.i]}"></span>
        <span style="--c:${palette[pair.j]}"></span>
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

function renderPolarityPanel($panel, state) {
  clearPanel($panel, 'Contrast polarity');
  appendMetricLinks($panel, ARTICLE_LINKS.polarity);
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = 'Largest APCA asymmetry when foreground and background are swapped';
  $panel.appendChild($note);

  const $list = document.createElement('div');
  $list.className = 'metric-list';
  state.polarityPairs.slice(0, 6).forEach((pair) => {
    const $row = document.createElement('div');
    $row.className = 'metric-row';
    if (pair.weakerContrast < APCA_MIN_CONTRAST) $row.classList.add('metric-row--danger');
    $row.innerHTML = `
      <div class="metric-pair">
        <span style="--c:${palette[pair.i]}"></span>
        <span style="--c:${palette[pair.j]}"></span>
      </div>
      <div class="metric-copy">
        <div class="metric-copy__title">${formatContrast(pair.sourceOnTarget)} / ${formatContrast(pair.targetOnSource)}</div>
        <div class="metric-copy__meta">polarity gap ${pair.contrastDelta.toFixed(1)}</div>
      </div>
      <div class="metric-value">${pair.weakerContrast.toFixed(1)}</div>
    `;
    $list.appendChild($row);
  });
  $panel.appendChild($list);
}

function renderCvdPanel($panel, state) {
  clearPanel($panel, 'CVD collapse');
  appendMetricLinks($panel, ARTICLE_LINKS.cvd);
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = `Pairs under ${CVD_THRESHOLD.toFixed(3)} simulated OKLab distance`;
  $panel.appendChild($note);

  const $list = document.createElement('div');
  $list.className = 'metric-list';
  state.cvdAnalyses.forEach((analysis) => {
    const closest = analysis.closest;
    const pairMarkup = closest
      ? `<div class="metric-pair"><span style="--c:${palette[closest.i]}"></span><span style="--c:${palette[closest.j]}"></span></div>`
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

function renderNeighbourPanel($panel, state) {
  clearPanel($panel, 'Neighbour influence');
  appendMetricLinks($panel, ARTICLE_LINKS.simultaneous);
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = 'Heuristic opponent-push: apparent separation increase when paired';
  $panel.appendChild($note);

  const $list = document.createElement('div');
  $list.className = 'metric-list';
  state.neighbourPairs.slice(0, 6).forEach((pair) => {
    const $row = document.createElement('div');
    $row.className = 'metric-row';
    $row.innerHTML = `
      <div class="metric-pair">
        <span style="--c:${palette[pair.i]}"></span>
        <span style="--c:${palette[pair.j]}"></span>
      </div>
      <div class="metric-copy">
        <div class="metric-copy__title">+${pair.influence.toFixed(3)} apparent distance</div>
        <div class="metric-copy__meta">${pair.dist.toFixed(3)} → ${pair.apparentDist.toFixed(3)}</div>
      </div>
      <div class="metric-value">${pair.apparentDist.toFixed(3)}</div>
    `;
    $list.appendChild($row);
  });
  $panel.appendChild($list);
}

function renderLuminancePanel($panel, state) {
  clearPanel($panel, 'Luminance distribution');
  appendMetricLinks($panel, ARTICLE_LINKS.luminance);
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = 'Pairwise ΔY plus overall luminance span';
  $panel.appendChild($note);

  const $summary = document.createElement('div');
  $summary.className = 'metric-summary';
  $summary.innerHTML = `
    <div><span>Span</span><strong>${state.luminanceSpan.toFixed(3)}</strong></div>
    <div><span>Mean Y</span><strong>${state.meanLuminance.toFixed(3)}</strong></div>
    <div><span>Weakest pair</span><strong>${(state.luminancePairs[0]?.deltaY ?? 0).toFixed(3)}</strong></div>
  `;
  $panel.appendChild($summary);

  const $bars = document.createElement('div');
  $bars.className = 'lum-bars';
  state.sortedByY.forEach((entry) => {
    const $bar = document.createElement('span');
    $bar.style.background = entry.hex;
    $bar.style.height = `${Math.max(10, entry.luminance * 100)}%`;
    $bar.title = `${entry.hex} Y ${entry.luminance.toFixed(3)}`;
    $bars.appendChild($bar);
  });
  $panel.appendChild($bars);

  const histogram = new Array(6).fill(0);
  state.luminancePairs.forEach((pair) => {
    const index = Math.min(histogram.length - 1, Math.floor(pair.deltaY * histogram.length));
    histogram[index] += 1;
  });
  const histogramMax = Math.max(...histogram, 1);
  const $distBars = document.createElement('div');
  $distBars.className = 'dist-bars';
  histogram.forEach((count, index) => {
    const $bar = document.createElement('span');
    $bar.style.height = `${(count / histogramMax) * 100}%`;
    $bar.title = `bin ${index + 1}: ${count} pairs`;
    $distBars.appendChild($bar);
  });
  $panel.appendChild($distBars);

  const $list = document.createElement('div');
  $list.className = 'metric-list';
  state.luminancePairs.slice(0, 4).forEach((pair) => {
    const $row = document.createElement('div');
    $row.className = 'metric-row';
    if (pair.deltaY < 0.06) $row.classList.add('metric-row--danger');
    $row.innerHTML = `
      <div class="metric-pair">
        <span style="--c:${palette[pair.i]}"></span>
        <span style="--c:${palette[pair.j]}"></span>
      </div>
      <div class="metric-copy">
        <div class="metric-copy__title">${palette[pair.i]} / ${palette[pair.j]}</div>
        <div class="metric-copy__meta">ΔY ${pair.deltaY.toFixed(3)} · APCA ${pair.bestContrast.toFixed(1)}</div>
      </div>
      <div class="metric-value">${pair.deltaY.toFixed(3)}</div>
    `;
    $list.appendChild($row);
  });
  $panel.appendChild($list);
}

function renderHarmonyPanel($panel, state) {
  clearPanel($panel, 'Harmony structure');
  appendMetricLinks($panel, ARTICLE_LINKS.harmony);
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = 'Hue coverage for chromatic pairs, triads, and tetrads';
  $panel.appendChild($note);

  const $list = document.createElement('div');
  $list.className = 'metric-list';
  state.harmonyAnalyses.forEach((analysis) => {
    const closest = analysis.closest;
    let pairMarkup = '<div class="metric-pair"></div>';
    if (closest) {
      if (analysis.kind === 'tetrad') {
        pairMarkup = `<div class="metric-pair"><span style="--c:${palette[closest.indices[0]]}"></span><span style="--c:${palette[closest.indices[1]]}"></span><span style="--c:${palette[closest.indices[2]]}"></span><span style="--c:${palette[closest.indices[3]]}"></span></div>`;
      } else if (analysis.kind === 'triad') {
        pairMarkup = `<div class="metric-pair"><span style="--c:${palette[closest.indices[0]]}"></span><span style="--c:${palette[closest.indices[1]]}"></span><span style="--c:${palette[closest.indices[2]]}"></span></div>`;
      } else {
        pairMarkup = `<div class="metric-pair"><span style="--c:${palette[closest.i]}"></span><span style="--c:${palette[closest.j]}"></span></div>`;
      }
    }
    const setLabel = analysis.kind === 'tetrad' ? 'tetrads' : analysis.kind === 'triad' ? 'triads' : 'pairs';
    const nearestLabel = (analysis.kind === 'tetrad' || analysis.kind === 'triad')
      ? `nearest ${closest ? closest.meanGap.toFixed(0) : '—'}° avg`
      : `nearest ${closest ? closest.delta.toFixed(0) : '—'}°`;
    const meta = `${analysis.count}/${analysis.setCount} ${setLabel} · ${nearestLabel}`;
    const $row = document.createElement('div');
    $row.className = 'metric-row';
    $row.innerHTML = `
      <div class="metric-name">${analysis.label}</div>
      ${pairMarkup}
      <div class="metric-copy">
        <div class="metric-copy__title">${Math.round(analysis.coverage * 100)}% coverage</div>
        <div class="metric-copy__meta">${meta}</div>
      </div>
      <div class="metric-value">${closest ? closest.error.toFixed(0) : '—'}°</div>
    `;
    $list.appendChild($row);
  });
  $panel.appendChild($list);
}

function renderHkPanel($panel, state) {
  clearPanel($panel, 'Helmholtz-Kohlrausch');
  appendMetricLinks($panel, ARTICLE_LINKS.hk);
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = 'High-chroma colors appear brighter than their luminance suggests';
  $panel.appendChild($note);

  const $list = document.createElement('div');
  $list.className = 'metric-list';
  const sorted = [...state.hkEntries].sort((a, b) => b.boost - a.boost);
  sorted.slice(0, 8).forEach((entry) => {
    const $row = document.createElement('div');
    $row.className = 'metric-row';
    if (entry.boost > 0.05) $row.classList.add('metric-row--warn');
    $row.innerHTML = `
      <div class="metric-pair">
        <span style="--c:${entry.hex}" title="${entry.hex}"></span>
        <span style="--c:hsl(0 0% ${Math.round(entry.perceivedY * 100)}%)" title="Perceived: Y ${entry.perceivedY.toFixed(3)}"></span>
      </div>
      <div class="metric-copy">
        <div class="metric-copy__title">Y ${entry.y.toFixed(3)} → perceived ${entry.perceivedY.toFixed(3)}</div>
        <div class="metric-copy__meta">C ${entry.chroma.toFixed(3)} · boost +${entry.boost.toFixed(3)}</div>
      </div>
      <div class="metric-value">+${(entry.boost * 100).toFixed(0)}%</div>
    `;
    $list.appendChild($row);
  });

  const flipped = state.hkPairs.filter((p) => p.flipped);
  if (flipped.length > 0) {
    const $warn = document.createElement('div');
    $warn.className = 'metric-note';
    $warn.textContent = `${flipped.length} pair${flipped.length !== 1 ? 's' : ''} where perceived brightness order disagrees with luminance order`;
    $panel.appendChild($warn);
  }
  $panel.appendChild($list);
}

function renderStereopsisPanel($panel, state) {
  clearPanel($panel);
  const atRiskCount = state.stereopsisPairs.filter((pair) => pair.severity >= 0.05).length;
  const totalPairs = state.pairs.length;
  const riskRatio = totalPairs ? atRiskCount / totalPairs : 0;
  const riskColor = `hsl(${120 * (1 - riskRatio)} 72% 46%)`;

  const $head = document.createElement('div');
  $head.className = 'pnl__head';
  const $title = document.createElement('div');
  $title.className = 'pnl__t';
  $title.textContent = 'Chromostereopsis';
  $head.appendChild($title);

  const $status = document.createElement('div');
  $status.className = 'panel-status';
  $status.innerHTML = `<span>${atRiskCount}/${totalPairs} at risk</span><span class="panel-status__dot" style="background:${riskColor}"></span>`;
  $head.appendChild($status);
  $panel.appendChild($head);

  appendMetricLinks($panel, ARTICLE_LINKS.chromostereopsis);
  const count = state.stereopsisPairs.length;

  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = 'Heuristic strongest depth-separation pairs';
  $panel.appendChild($note);

  if (count) {
    const $row = document.createElement('div');
    $row.className = 'close-row';
    state.stereopsisPairs.slice(0, 10).forEach((pair) => {
      const $pair = document.createElement('div');
      $pair.className = 'stereo-pair';
      $pair.title = `${palette[pair.i]} / ${palette[pair.j]} · score ${pair.severity.toFixed(3)} · Δh ${pair.hueDelta.toFixed(0)}° · Cmin ${pair.minChroma.toFixed(3)} · hue ${pair.hueFactor.toFixed(2)} · ΔL ${pair.lightnessDelta.toFixed(3)}`;
      $pair.innerHTML = `<span style="--c:${palette[pair.i]}"><span style="--c:${palette[pair.j]}"></span></span><span style="--c:${palette[pair.j]}"><span style="--c:${palette[pair.i]}"></span></span>`;
      $row.appendChild($pair);
    });
    $panel.appendChild($row);
  }
}

function renderTemperaturePanel($panel, state) {
  clearPanel($panel, 'Warm / Cool');
  appendMetricLinks($panel, ARTICLE_LINKS.temperature);
  const $note = document.createElement('div');
  $note.className = 'metric-note';
  $note.textContent = 'Color temperature based on OKLch hue angle';
  $panel.appendChild($note);

  const $boxes = document.createElement('div');
  $boxes.className = 'box-row';
  [
    { label: 'Warm', count: state.warmCount, color: '--c-warm', fallback: '#e06030' },
    { label: 'Cool', count: state.coolCount, color: '--c-cool', fallback: '#3080d0' },
    { label: 'Neutral', count: state.neutralCount, color: '--c-neutral', fallback: '#888' },
  ].forEach(({ label, count, color, fallback }) => {
    const $box = document.createElement('div');
    $box.className = 'info-box';
    $box.innerHTML = `
      <div class="info-box__label">${label}</div>
      <div class="info-box__value">${count}<span class="info-box__indicator" style="background:${themeVar(color, fallback)}"></span></div>
      <div class="info-box__bar" style="width:${state.data.length ? (count / state.data.length) * 100 : 0}%;background:${themeVar(color, fallback)}"></div>
    `;
    $boxes.appendChild($box);
  });
  $panel.appendChild($boxes);
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

function renderAnalysisState(state) {
  for (let index = vizzes.length - 1; index >= 0; index--) {
    if (vizzes[index].dynamic) {
      vizzes[index].viz.destroy();
      vizzes.splice(index, 1);
    }
  }

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
  renderPolarityPanel($grid.querySelector('[data-role="polarity"]'), state);
  renderCvdPanel($grid.querySelector('[data-role="cvd"]'), state);
  renderNeighbourPanel($grid.querySelector('[data-role="simultaneous"]'), state);
  renderLuminancePanel($grid.querySelector('[data-role="luminance"]'), state);
  renderHarmonyPanel($grid.querySelector('[data-role="harmony"]'), state);
  renderHkPanel($grid.querySelector('[data-role="hk"]'), state);
  renderStereopsisPanel($grid.querySelector('[data-role="stereopsis"]'), state);
  renderTemperaturePanel($grid.querySelector('[data-role="temperature"]'), state);
}

function renderAnalysis() {
  latestAnalysisState = null;
  cancelAnalysisRequest();
  const requestId = analysisRequestId;
  analysisWorker.postMessage({ colors: [...palette], requestId });
}

function updateHeader() {
  $hdrL.textContent = `Unique colours in palette: ${palette.length}`;
}

function updateAll() {
  const vizPalette = palette.map((hex) => srgbArray(hex));
  autoSortedPaletteHexes = null;
  requestAutoPaletteSort();
  if (showColorNames) scheduleColorNamesFetch(palette);
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
initTokenBeamControls();
loadColorNameListMetadata();

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
  const colors = capPalette(
    $paste.value
    .split(/[\s,]+/)
    .map((value) => value.trim().replace(/^#?/, '#'))
    .filter((value) => /^#([0-9a-f]{3}){1,2}$/i.test(value)),
  );
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
