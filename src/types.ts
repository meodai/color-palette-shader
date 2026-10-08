export type ColorRGB = [number, number, number];
export type ColorList = ColorRGB[];

export type SupportedColorModels =
  | 'rgb'
  | 'rgb12bit'
  | 'rgb8bit'
  | 'rgb18bit'
  | 'rgb6bit'
  | 'rgb15bit'
  | 'oklab'
  | 'okhsv'
  | 'okhsvPolar'
  | 'okhsl'
  | 'okhslPolar'
  | 'oklch'
  | 'oklchPolar'
  | 'hsv'
  | 'hsvPolar'
  | 'hsl'
  | 'hslPolar'
  | 'hwb'
  | 'hwbPolar'
  | 'oklrab'
  | 'oklrch'
  | 'oklrchPolar'
  | 'cielab'
  | 'cielch'
  | 'cielchPolar'
  | 'cielabD50'
  | 'cielchD50'
  | 'cielchD50Polar'
  | 'cam16ucsD65'
  | 'cam16ucsD65Polar'
  | 'spectrum'
  | 'oklchDiag'
  | 'oklrchDiag';
export type Axis = 'x' | 'y' | 'z';
export type DistanceMetric =
  | 'rgb'
  | 'oklab'
  | 'deltaE76'
  | 'deltaE94'
  | 'deltaE2000'
  | 'redmean'
  /** @deprecated Misattributed name for Riemersma's "redmean" formula — use 'redmean' for the same result, or 'kotsarenkoRamosYIQ' for the actual Kotsarenko/Ramos metric. */
  | 'kotsarenkoRamos'
  | 'kotsarenkoRamosYIQ'
  | 'oklrab'
  | 'cielabD50'
  | 'okLightness'
  | 'liMatch'
  | 'cam16ucsD65';

export type PaletteVizOptions = {
  palette?: ColorList;
  width?: number;
  height?: number;
  pixelRatio?: number;
  observeResize?: boolean;
  container?: HTMLElement;
  // shader options
  colorModel?: SupportedColorModels;
  distanceMetric?: DistanceMetric;
  axis?: Axis;
  position?: number;
  invertAxes?: Axis[];
  showRaw?: boolean;
  outlineWidth?: number;
  gamutClip?: GamutClip | true;
};

/**
 * Target gamut for `gamutClip`. Pixels outside it are discarded instead of
 * clamped. `true` is accepted as an alias for `'srgb'`.
 */
export type GamutClip = false | 'srgb' | 'p3';

export type PaletteViz3DOptions = {
  palette?: ColorList;
  width?: number;
  height?: number;
  pixelRatio?: number;
  observeResize?: boolean;
  container?: HTMLElement;
  colorModel?: SupportedColorModels;
  distanceMetric?: DistanceMetric;
  invertAxes?: Axis[];
  showRaw?: boolean;
  outlineWidth?: number;
  gamutClip?: GamutClip | true;
  position?: number;
  modelMatrix?: Float32Array;
};
