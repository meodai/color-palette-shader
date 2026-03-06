export type ColorRGB = [number, number, number];
export type ColorList = ColorRGB[];

export type SupportedColorModels =
  | 'rgb'
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
  | 'cielabD50';

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
  invertZ?: boolean;
  showRaw?: boolean;
  outlineWidth?: number;
};

export type PaletteViz3DOptions = {
  palette?: ColorList;
  width?: number;
  height?: number;
  pixelRatio?: number;
  container?: HTMLElement;
  colorModel?: SupportedColorModels;
  distanceMetric?: DistanceMetric;
  invertZ?: boolean;
  showRaw?: boolean;
  outlineWidth?: number;
  position?: number;
  yaw?: number;
  pitch?: number;
};
