// ── Barrel re-exports ─────────────────────────────────────────────────────────
// Types
export type {
  ColorRGB,
  ColorList,
  SupportedColorModels,
  Axis,
  DistanceMetric,
  PaletteVizOptions,
  PaletteViz3DOptions,
} from './types.ts';

// Classes
export { PaletteViz } from './PaletteViz.ts';
export { PaletteViz3D } from './PaletteViz3D.ts';

// Palette helpers
export { paletteToRGBA, paletteToTexture, randomPalette } from './palette.ts';

// GLSL source (for users who want to inspect or reuse the shader)
export { fragmentShader } from './shaderSrc.ts';

// 4×4 matrix helpers (for building custom orbit / trackball controls)
export { mat4Perspective, mat4Multiply, mat4RotateX, mat4RotateY, mat4Translate } from './math.ts';
