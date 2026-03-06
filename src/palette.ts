import { ColorRGB, ColorList } from './types.ts';

// Returns the palette as a flat RGBA Uint8Array (sRGB, 1×N texture row).
// Useful for building your own WebGL texture or inspecting raw color data.
export const paletteToRGBA = (palette: ColorList): Uint8Array => {
  const data = new Uint8Array(palette.length * 4);
  palette.forEach((color, i) => {
    data[i * 4 + 0] = Math.round(color[0] * 255);
    data[i * 4 + 1] = Math.round(color[1] * 255);
    data[i * 4 + 2] = Math.round(color[2] * 255);
    data[i * 4 + 3] = 255;
  });
  return data;
};

// Backwards-compatible alias (previously returned a Three.js DataTexture)
export const paletteToTexture = paletteToRGBA;

export const randomPalette = (size = 20): ColorList =>
  Array.from({ length: size }, () => [Math.random(), Math.random(), Math.random()] as ColorRGB);
