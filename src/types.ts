export type ColorString = string;
export type ColorList = ColorString[];

export type SupportedColorModels = 'hsv' | 'okhsv' | 'hsl' | 'okhsl' | 'oklch';
export type Axis = 'x' | 'y' | 'z';
export type DistanceMetric = 'rgb' | 'oklab' | 'deltaE76' | 'deltaE94' | 'deltaE2000' | 'kotsarenkoRamos';

export type PaletteVizOptions = {
  palette?: ColorList;
  width?: number;
  height?: number;
  pixelRatio?: number;
  container?: HTMLElement;
  // shader options
  colorModel?: SupportedColorModels;
  distanceMetric?: DistanceMetric;
  isPolar?: boolean;
  axis?: Axis;
  position?: number;
  invertLightness?: boolean;
  showRaw?: boolean;
};
