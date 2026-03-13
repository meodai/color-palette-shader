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

  const contrastPairs = pairs.map((pair) => {
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
      const ranked = chromaticTriads
        .map((triad) => {
          const sorted3 = [...triad.gaps].sort((a, b) => a - b);
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

  const hkEntries = data.map((entry, index) => {
    const y = luminances[index];
    const hkBoost = entry.lch.c * 0.37;
    const perceivedY = Math.min(1, y + hkBoost);
    return { index, hex: entry.hex, y, perceivedY, boost: hkBoost, chroma: entry.lch.c };
  });
  const hkPairs = [];
  for (let i = 0; i < hkEntries.length; i++) {
    for (let j = i + 1; j < hkEntries.length; j++) {
      const a = hkEntries[i];
      const b = hkEntries[j];
      const lumDelta = a.y - b.y;
      const percDelta = a.perceivedY - b.perceivedY;
      const flipped = (lumDelta > 0.02 && percDelta < -0.02) || (lumDelta < -0.02 && percDelta > 0.02);
      hkPairs.push({
        i,
        j,
        lumDelta: Math.abs(lumDelta),
        percDelta: Math.abs(percDelta),
        boostDelta: Math.abs(a.boost - b.boost),
        flipped,
      });
    }
  }
  hkPairs.sort((a, b) => b.boostDelta - a.boostDelta);

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