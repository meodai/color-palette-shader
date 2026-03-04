import { Texture } from 'three';

export type ColorString = string;
export type ColorList = ColorString[];

export type PaletteShaderUniforms = {
  progress: { value: number };
  progress_axis: { value: number };
  polarColorModel: { value: number };
  isPolar: { value: boolean };
  isPerceptional: { value: boolean };
  paletteTexture: { value: Texture | null };
  paletteLength: { value: number };
  debug: { value: boolean };
  invertZ: { value: boolean };
};

export type PaletteVizOptions = {
  palette?: ColorList,
  width?: number,
  height?: number,
  pixelRatio?: number,
  uniforms?: Partial<PaletteShaderUniforms>,
  $parent?: HTMLElement,
};

export type SupportedColorModels = 'hsv' | 'hsl' | 'lch';
export type Axis = 'x' | 'y' | 'z';
