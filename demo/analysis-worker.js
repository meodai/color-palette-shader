import {
  converter,
  wcagLuminance,
  filterDeficiencyProt,
  filterDeficiencyDeuter,
  filterDeficiencyTrit,
  interpolate as culoriInterpolate,
} from 'culori';

const toSRGB = converter('rgb');
const toOKLab = converter('oklab');
const toOKLch = converter('oklch');
const toOKHSV = converter('okhsv');
const simulateProtan = filterDeficiencyProt(1);
const simulateDeutan = filterDeficiencyDeuter(1);
const simulateTritan = filterDeficiencyTrit(1);

const APCA_LOW_CLIP = 0.1;
const CVD_THRESHOLD = 0.045;
const CHROMA_STEREO_MIN = 0.06;
const WARM_COOL_CHROMA_MIN = 0.03;
const CLOSE_PAIR_LIMIT = 10;
const METRIC_PAIR_LIMIT = 16;
const USEFUL_MIX_SAMPLE_LIMIT = 64;
const HARMONY_SAMPLE_LIMIT = 48;
const HARMONY_RULES = [
  { id: 'analogous', label: 'Analogous', kind: 'pair', target: 30, tolerance: 18 },
  { id: 'complementary', label: 'Complementary', kind: 'pair', target: 180, tolerance: 18 },
  { id: 'split-complementary', label: 'Split-compl.', kind: 'split', target: 150, splitGap: 60, tolerance: 20 },
  { id: 'triadic', label: 'Triadic', kind: 'triad', target: 120, tolerance: 16 },
  { id: 'tetradic', label: 'Tetradic', kind: 'tetrad', target: 90, tolerance: 16 },
  { id: 'monochromatic', label: 'Monochromatic', kind: 'pair', target: 0, tolerance: 12 },
];
const CVD_FILTERS = [
  { id: 'protan', label: 'Protan', filter: simulateProtan },
  { id: 'deutan', label: 'Deutan', filter: simulateDeutan },
  { id: 'tritan', label: 'Tritan', filter: simulateTritan },
];

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const normHue = (value) => (((value ?? 0) % 360) + 360) % 360;
const rgbToObject = (rgb) => ({ mode: 'rgb', r: rgb[0], g: rgb[1], b: rgb[2] });

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

function okHsv(input) {
  const color = toOKHSV(input);
  return {
    h: normHue(color?.h),
    s: clamp01(color?.s ?? 0),
    v: clamp01(color?.v ?? 0),
  };
}

function labDistance(a, b) {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
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
    okhsv: okHsv(hex),
  }));
}

function insertSortedLimited(list, item, limit, compare) {
  const index = list.findIndex((entry) => compare(item, entry) < 0);
  if (index === -1) {
    if (list.length < limit) list.push(item);
    return;
  }
  list.splice(index, 0, item);
  if (list.length > limit) list.pop();
}

function sampleEntries(entries, limit) {
  if (entries.length <= limit) return entries;
  const sampled = [];
  const seen = new Set();
  const step = (entries.length - 1) / Math.max(limit - 1, 1);
  for (let index = 0; index < limit; index++) {
    const candidate = Math.min(entries.length - 1, Math.round(index * step));
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    sampled.push(entries[candidate]);
  }
  return sampled;
}

function usefulMixes(data, limit) {
  const sampled = sampleEntries(data, USEFUL_MIX_SAMPLE_LIMIT);
  const mixes = [];
  for (let i = 0; i < sampled.length; i++) {
    for (let j = i + 1; j < sampled.length; j++) {
      const mixedLab = okLab(culoriInterpolate([sampled[i].hex, sampled[j].hex], 'rgb')(0.5));
      let nearest = Infinity;
      for (const entry of sampled) nearest = Math.min(nearest, labDistance(mixedLab, entry.lab));
      insertSortedLimited(
        mixes,
        {
          a: sampled[i],
          b: sampled[j],
          score: nearest - labDistance(sampled[i].lab, sampled[j].lab) * 0.12,
        },
        limit,
        (a, b) => b.score - a.score,
      );
    }
  }
  return mixes;
}

function summarizeHarmony(rule, chromaticPairs, chromaticTriads, chromaticTetrads) {
  if (rule.kind === 'split') {
    let count = 0;
    let closest = null;
    for (const triad of chromaticTriads) {
      const sortedGaps = [...triad.gaps].sort((a, b) => a - b);
      const splitError = Math.abs(sortedGaps[0] - rule.splitGap);
      const bigError = Math.max(
        Math.abs(sortedGaps[1] - rule.target),
        Math.abs(sortedGaps[2] - rule.target),
      );
      const error = Math.max(splitError, bigError);
      const meanGap = triad.gaps.reduce((sum, gap) => sum + gap, 0) / triad.gaps.length;
      if (error <= rule.tolerance) count += 1;
      if (!closest || error < closest.error) closest = { ...triad, error, meanGap };
    }
    return {
      ...rule,
      kind: 'triad',
      count,
      setCount: chromaticTriads.length,
      coverage: chromaticTriads.length ? count / chromaticTriads.length : 0,
      closest,
    };
  }

  if (rule.kind === 'tetrad') {
    let count = 0;
    let closest = null;
    for (const tetrad of chromaticTetrads) {
      const error = Math.max(...tetrad.gaps.map((gap) => Math.abs(gap - rule.target)));
      const meanGap = tetrad.gaps.reduce((sum, gap) => sum + gap, 0) / tetrad.gaps.length;
      if (error <= rule.tolerance) count += 1;
      if (!closest || error < closest.error) closest = { ...tetrad, error, meanGap };
    }
    return {
      ...rule,
      count,
      setCount: chromaticTetrads.length,
      coverage: chromaticTetrads.length ? count / chromaticTetrads.length : 0,
      closest,
    };
  }

  if (rule.kind === 'triad') {
    let count = 0;
    let closest = null;
    for (const triad of chromaticTriads) {
      const error = Math.max(...triad.gaps.map((gap) => Math.abs(gap - rule.target)));
      const meanGap = triad.gaps.reduce((sum, gap) => sum + gap, 0) / triad.gaps.length;
      if (error <= rule.tolerance) count += 1;
      if (!closest || error < closest.error) closest = { ...triad, error, meanGap };
    }
    return {
      ...rule,
      count,
      setCount: chromaticTriads.length,
      coverage: chromaticTriads.length ? count / chromaticTriads.length : 0,
      closest,
    };
  }

  let count = 0;
  let closest = null;
  for (const pair of chromaticPairs) {
    const error = Math.abs(pair.delta - rule.target);
    if (error <= rule.tolerance) count += 1;
    if (!closest || error < closest.error) closest = { ...pair, error };
  }
  return {
    ...rule,
    count,
    setCount: chromaticPairs.length,
    coverage: chromaticPairs.length ? count / chromaticPairs.length : 0,
    closest,
  };
}

function stateForPalette(colors) {
  const data = paletteDataOf(colors);
  const pairCount = (data.length * (data.length - 1)) / 2;
  const closePairs10 = [];
  const closePairs70 = [];
  const contrastPairsWorst = [];
  const contrastPairsDarkOnLight = [];
  const contrastPairsLightOnDark = [];
  const polarityPairs = [];
  const luminancePairs = [];
  const neighbourPairs = [];
  const hkPairs = [];
  const stereopsisPairs = [];
  const luminanceHistogram = new Array(6).fill(0);

  const lightnesses = data.map((entry) => entry.lab.l);
  const luminances = data.map((entry) => relativeLuminance(entry.rgb));
  let minDist = Infinity;
  let maxDist = 0;
  let totalDist = 0;
  let hkFlippedCount = 0;
  let stereopsisAtRiskCount = 0;

  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const source = data[i];
      const target = data[j];
      const dist = labDistance(source.lab, target.lab);
      minDist = Math.min(minDist, dist);
      maxDist = Math.max(maxDist, dist);
      totalDist += dist;

      insertSortedLimited(
        closePairs10,
        { i, j, dist: okDistLiMatchLab(source.lab, target.lab, 0.1) },
        CLOSE_PAIR_LIMIT,
        (a, b) => a.dist - b.dist,
      );
      insertSortedLimited(
        closePairs70,
        { i, j, dist: okDistLiMatchLab(source.lab, target.lab, 0.7) },
        CLOSE_PAIR_LIMIT,
        (a, b) => a.dist - b.dist,
      );

      const sourceOnTarget = apcaContrast(source.rgb, target.rgb);
      const targetOnSource = apcaContrast(target.rgb, source.rgb);
      const contrastPair = {
        i,
        j,
        dist,
        sourceOnTarget,
        targetOnSource,
        bestContrast: Math.max(Math.abs(sourceOnTarget), Math.abs(targetOnSource)),
        contrastDelta: Math.abs(Math.abs(sourceOnTarget) - Math.abs(targetOnSource)),
      };
      insertSortedLimited(
        contrastPairsWorst,
        contrastPair,
        METRIC_PAIR_LIMIT,
        (a, b) => a.bestContrast - b.bestContrast || b.contrastDelta - a.contrastDelta,
      );
      insertSortedLimited(
        contrastPairsDarkOnLight,
        contrastPair,
        METRIC_PAIR_LIMIT,
        (a, b) => Math.abs(a.sourceOnTarget) - Math.abs(b.sourceOnTarget),
      );
      insertSortedLimited(
        contrastPairsLightOnDark,
        contrastPair,
        METRIC_PAIR_LIMIT,
        (a, b) => Math.abs(a.targetOnSource) - Math.abs(b.targetOnSource),
      );

      const weakerContrast = Math.min(Math.abs(sourceOnTarget), Math.abs(targetOnSource));
      const strongerContrast = Math.max(Math.abs(sourceOnTarget), Math.abs(targetOnSource));
      insertSortedLimited(
        polarityPairs,
        { ...contrastPair, weakerContrast, strongerContrast },
        METRIC_PAIR_LIMIT,
        (a, b) => b.contrastDelta - a.contrastDelta || a.weakerContrast - b.weakerContrast,
      );

      const deltaY = Math.abs(luminances[i] - luminances[j]);
      const histogramIndex = Math.min(
        luminanceHistogram.length - 1,
        Math.floor(deltaY * luminanceHistogram.length),
      );
      luminanceHistogram[histogramIndex] += 1;
      insertSortedLimited(
        luminancePairs,
        { ...contrastPair, deltaY },
        METRIC_PAIR_LIMIT,
        (a, b) => a.deltaY - b.deltaY,
      );

      const apparentSource = apparentAgainstNeighbour(source.lab, target.lab);
      const apparentTarget = apparentAgainstNeighbour(target.lab, source.lab);
      const apparentDist = labDistance(apparentSource, apparentTarget);
      insertSortedLimited(
        neighbourPairs,
        { i, j, dist, apparentDist, influence: apparentDist - dist },
        METRIC_PAIR_LIMIT,
        (a, b) => b.influence - a.influence,
      );

      const hkBoostSource = source.lch.c * 0.37;
      const hkBoostTarget = target.lch.c * 0.37;
      const lumDelta = luminances[i] - luminances[j];
      const percDelta =
        Math.min(1, luminances[i] + hkBoostSource) - Math.min(1, luminances[j] + hkBoostTarget);
      const flipped = (lumDelta > 0.02 && percDelta < -0.02) || (lumDelta < -0.02 && percDelta > 0.02);
      if (flipped) hkFlippedCount += 1;
      insertSortedLimited(
        hkPairs,
        {
          i,
          j,
          lumDelta: Math.abs(lumDelta),
          percDelta: Math.abs(percDelta),
          boostDelta: Math.abs(hkBoostSource - hkBoostTarget),
          flipped,
        },
        METRIC_PAIR_LIMIT,
        (a, b) => b.boostDelta - a.boostDelta,
      );

      if (source.lch.c >= CHROMA_STEREO_MIN && target.lch.c >= CHROMA_STEREO_MIN) {
        const hueDelta = hueDistance(source.lch.h, target.lch.h);
        const minChroma = Math.min(source.lch.c, target.lch.c);
        const lightnessDelta = Math.abs(source.lab.l - target.lab.l);
        const hueFactor = Math.sin((hueDelta * Math.PI) / 360);
        const severity = minChroma * (0.4 + 0.6 * hueFactor) * (0.75 + 0.25 * lightnessDelta);
        if (severity >= 0.05) stereopsisAtRiskCount += 1;
        insertSortedLimited(
          stereopsisPairs,
          { i, j, severity, minChroma, hueDelta, hueFactor, lightnessDelta },
          METRIC_PAIR_LIMIT,
          (a, b) => b.severity - a.severity,
        );
      }
    }
  }

  const meanDist = pairCount ? totalDist / pairCount : 0;
  if (!Number.isFinite(minDist)) minDist = 0;
  const iss =
    data.length > 1 ? meanDist / Math.max(minDist, 1e-6) / Math.pow(data.length, 2 / 3) : 0;

  const sortedByL = [...data].sort((a, b) => a.lab.l - b.lab.l);
  const minL = lightnesses.length ? Math.min(...lightnesses) : 0;
  const maxL = lightnesses.length ? Math.max(...lightnesses) : 0;
  const meanL = lightnesses.length
    ? lightnesses.reduce((sum, value) => sum + value, 0) / lightnesses.length
    : 0;
  const maxC = Math.max(...data.map((entry) => entry.lch.c), 0.001);
  const acyclic = data.length < 3;
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

  const chromaticEntries = data.filter((entry) => entry.lch.c >= 0.03);
  const chromaticPairs = [];
  for (let i = 0; i < chromaticEntries.length; i++) {
    for (let j = i + 1; j < chromaticEntries.length; j++) {
      chromaticPairs.push({
        i: chromaticEntries[i].index,
        j: chromaticEntries[j].index,
        delta: hueDistance(chromaticEntries[i].lch.h, chromaticEntries[j].lch.h),
      });
    }
  }

  const harmonyEntries = sampleEntries(chromaticEntries, HARMONY_SAMPLE_LIMIT);
  const harmonySampled = harmonyEntries.length < chromaticEntries.length;
  const chromaticTriads = [];
  for (let i = 0; i < harmonyEntries.length; i++) {
    for (let j = i + 1; j < harmonyEntries.length; j++) {
      for (let k = j + 1; k < harmonyEntries.length; k++) {
        const triad = [harmonyEntries[i], harmonyEntries[j], harmonyEntries[k]];
        const sorted = [...triad].sort((a, b) => a.lch.h - b.lch.h);
        chromaticTriads.push({
          indices: triad.map((entry) => entry.index),
          gaps: [
            sorted[1].lch.h - sorted[0].lch.h,
            sorted[2].lch.h - sorted[1].lch.h,
            360 - (sorted[2].lch.h - sorted[0].lch.h),
          ],
        });
      }
    }
  }

  const chromaticTetrads = [];
  for (let i = 0; i < harmonyEntries.length; i++) {
    for (let j = i + 1; j < harmonyEntries.length; j++) {
      for (let k = j + 1; k < harmonyEntries.length; k++) {
        for (let m = k + 1; m < harmonyEntries.length; m++) {
          const tetrad = [harmonyEntries[i], harmonyEntries[j], harmonyEntries[k], harmonyEntries[m]];
          const sorted = [...tetrad].sort((a, b) => a.lch.h - b.lch.h);
          chromaticTetrads.push({
            indices: tetrad.map((entry) => entry.index),
            gaps: [
              sorted[1].lch.h - sorted[0].lch.h,
              sorted[2].lch.h - sorted[1].lch.h,
              sorted[3].lch.h - sorted[2].lch.h,
              360 - (sorted[3].lch.h - sorted[0].lch.h),
            ],
          });
        }
      }
    }
  }

  const harmonyAnalyses = HARMONY_RULES.map((rule) => ({
    ...summarizeHarmony(rule, chromaticPairs, chromaticTriads, chromaticTetrads),
    sampled: harmonySampled,
    sampleSize: harmonyEntries.length,
    sourceSize: chromaticEntries.length,
  }));

  const cvdAnalyses = CVD_FILTERS.map(({ id, label, filter }) => {
    const simulated = data.map((entry) => ({
      ...entry,
      simLab: okLab(filter(rgbToObject(entry.rgb))),
    }));
    let minSimDist = Infinity;
    let collapseCount = 0;
    let closest = null;
    for (let i = 0; i < simulated.length; i++) {
      for (let j = i + 1; j < simulated.length; j++) {
        const dist = labDistance(simulated[i].simLab, simulated[j].simLab);
        if (dist < minSimDist) {
          minSimDist = dist;
          closest = { i, j, dist };
        }
        if (dist < CVD_THRESHOLD) collapseCount += 1;
      }
    }
    return {
      id,
      label,
      minDist: Number.isFinite(minSimDist) ? minSimDist : 0,
      collapseCount,
      totalPairs: pairCount,
      closest,
    };
  });

  const hkEntries = data.map((entry, index) => {
    const y = luminances[index];
    const hkBoost = entry.lch.c * 0.37;
    const perceivedY = Math.min(1, y + hkBoost);
    return { index, hex: entry.hex, y, perceivedY, boost: hkBoost, chroma: entry.lch.c };
  });

  const temperature = data.map((entry) => {
    if (entry.lch.c < WARM_COOL_CHROMA_MIN) return { ...entry, temp: 'neutral' };
    const h = entry.lch.h;
    if (h <= 90 || h >= 330) return { ...entry, temp: 'warm' };
    return { ...entry, temp: 'cool' };
  });
  const warmCount = temperature.filter((entry) => entry.temp === 'warm').length;
  const coolCount = temperature.filter((entry) => entry.temp === 'cool').length;
  const neutralCount = temperature.filter((entry) => entry.temp === 'neutral').length;

  return {
    data,
    pairCount,
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
    luminanceHistogram,
    neutralisers,
    mixes: usefulMixes(data, 14),
    contrastPairs: {
      worst: contrastPairsWorst,
      darkOnLight: contrastPairsDarkOnLight,
      lightOnDark: contrastPairsLightOnDark,
    },
    polarityPairs,
    luminancePairs,
    neighbourPairs,
    harmonyAnalyses,
    cvdAnalyses,
    hkEntries,
    hkPairs,
    hkFlippedCount,
    stereopsisPairs,
    stereopsisAtRiskCount,
    temperature,
    warmCount,
    coolCount,
    neutralCount,
  };
}

self.onmessage = (event) => {
  const { colors, requestId } = event.data || {};

  try {
    const state = Array.isArray(colors) ? stateForPalette(colors) : null;
    self.postMessage({ type: 'analyzed', payload: { requestId, state } });
  } catch (error) {
    self.postMessage({
      type: 'error',
      payload: { message: error?.message || String(error), requestId },
    });
  }
};