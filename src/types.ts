import {
  Texture
} from 'three';

export type ColorString = string;
export type ColorList = ColorString[];
export type PaletteVizOptions = {
  palette?: ColorList,
  width?: number,
  height?: number,
  pixelRatio?: number,
  uniforms?: { [key: string]: { value: string | number | boolean | Texture}},
  $parent?: HTMLElement,
};

export type SupportedColorModels = 'hsv' | 'hsl' | 'lch';
export type Axis = 'x' | 'y' | 'z';