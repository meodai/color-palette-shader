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
  | 'cielchD50Polar';
export type Axis = 'x' | 'y' | 'z';
export type DistanceMetric =
  | 'rgb'
  | 'oklab'
  | 'deltaE76'
  | 'deltaE94'
  | 'deltaE2000'
  | 'kotsarenkoRamos'
  | 'oklrab'
  | 'cielabD50'
  | 'okLightness'
  | 'liMatch';

export type PaletteVizOptions = {
  palette?: ColorList;
  width?: number;
  height?: number;
  pixelRatio?: number;
  container?: HTMLElement;
  // shader options
  colorModel?: SupportedColorModels;
  distanceMetric?: DistanceMetric;
  axis?: Axis;
  position?: number;
  invertAxes?: Axis[];
  showRaw?: boolean;
  outlineWidth?: number;
  gamutClip?: boolean;
};

export type PaletteViz3DOptions = {
  palette?: ColorList;
  width?: number;
  height?: number;
  pixelRatio?: number;
  container?: HTMLElement;
  colorModel?: SupportedColorModels;
  distanceMetric?: DistanceMetric;
  invertAxes?: Axis[];
  showRaw?: boolean;
  outlineWidth?: number;
  gamutClip?: boolean;
  position?: number;
  modelMatrix?: Float32Array;
};
