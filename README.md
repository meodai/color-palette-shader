# palette-shader

A dependency-free WebGL2 shader that maps any color palette across a 3-D perceptual color space and snaps each pixel to the nearest palette color. Visualize how a palette distributes across 20+ color models and eight distance metrics, all on the GPU. Includes 2-D cross-section views (`PaletteViz`) and an interactive 3-D cube/cylinder view (`PaletteViz3D`) with trackball rotation.

[**Live demo →**](https://meodai.github.io/color-palette-shader/)

---

## What is this for?

It shows you how a color palette distributes across "all possible colors." Each region of the wheel or grid represents a color — and whichever palette color is closest to it claims that region.

So if one of your palette colors only claims a tiny sliver, it lives very close to another color already in your palette — it's almost redundant. If it claims a large region, it's doing a lot of unique work. At a glance you can tell:

- **How distinct** each color is from the others
- **How balanced** the palette is overall — even regions mean even coverage
- **Whether a new color is worth adding** — if it doesn't carve out its own space, it's probably not pulling its weight

---

## Install

```bash
npm install palette-shader
```

No runtime dependencies — only a browser with WebGL2 support is required. Colors must be passed as `[r, g, b]` arrays with values in the `0–1` range (linear sRGB). Use a library such as [culori](https://culorijs.org/) to convert from CSS strings if needed.

---

## Quick start

```js
import { PaletteViz } from 'palette-shader';
import { converter } from 'culori';

const toSRGB = converter('srgb');
const toRGB = (hex) => {
  const c = toSRGB(hex);
  return [c.r, c.g, c.b];
};

// option A — pass a container, canvas is appended automatically
const viz = new PaletteViz({
  palette: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'].map(toRGB),
  container: document.querySelector('#app'),
  width: 512,
  height: 512,
});

// option B — no container, place the canvas yourself
const viz = new PaletteViz({ palette: ['#264653', '#2a9d8f', '#e9c46a'].map(toRGB) });
document.querySelector('#app').appendChild(viz.canvas);
```

---

## Constructor

```ts
new PaletteViz(options?: PaletteVizOptions)
```

All options are optional. The palette defaults to a random 20-color set.

| Option           | Type                         | Default            | Description                                                                                                  |
| ---------------- | ---------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `palette`        | `[number, number, number][]` | random             | sRGB colors as `[r, g, b]` arrays, each component in the `0–1` range                                         |
| `container`      | `HTMLElement`                | `undefined`        | Element the canvas is appended to. Omit and use `viz.canvas` to place it yourself                            |
| `width`          | `number`                     | `512`              | Canvas width in CSS pixels                                                                                   |
| `height`         | `number`                     | `512`              | Canvas height in CSS pixels                                                                                  |
| `pixelRatio`     | `number`                     | `devicePixelRatio` | Renderer pixel ratio                                                                                         |
| `colorModel`     | `string`                     | `'okhsv'`          | Color space for the visualization (see [Color models](#color-models))                                        |
| `distanceMetric` | `string`                     | `'oklab'`          | Distance function for nearest-color matching (see [Distance metrics](#distance-metrics))                     |
| `axis`           | `'x' \| 'y' \| 'z'`          | `'y'`              | Which axis the `position` value controls                                                                     |
| `position`       | `number`                     | `0`                | 0–1 position along the chosen axis                                                                           |
| `invertZ`        | `boolean`                    | `false`            | Flip the lightness/value axis                                                                                |
| `showRaw`        | `boolean`                    | `false`            | Bypass nearest-color matching (shows the raw color space)                                                    |
| `outlineWidth`   | `number`                     | `0`                | Draw a transparent outline where palette regions meet. Width in physical pixels. `0` disables (no overhead). |
| `gamutClip`      | `boolean`                    | `false`            | Discard out-of-sRGB-gamut pixels instead of clamping. Reveals the true gamut boundary of the color model.    |

---

## Properties

Every constructor option is also a live setter/getter. Assigning any of them re-renders immediately via `requestAnimationFrame`.

```js
viz.palette = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
viz.position = 0.5;
viz.colorModel = 'okhslPolar';
viz.distanceMetric = 'deltaE2000';
viz.invertZ = true;
viz.showRaw = true;
viz.outlineWidth = 2; // transparent border between regions, in physical pixels
viz.gamutClip = true; // discard out-of-gamut pixels
viz.pixelRatio = window.devicePixelRatio; // update after display changes
```

Additional read-only properties:

| Property | Type                | Description                   |
| -------- | ------------------- | ----------------------------- |
| `canvas` | `HTMLCanvasElement` | The underlying canvas element |
| `width`  | `number`            | Current width in CSS pixels   |
| `height` | `number`            | Current height in CSS pixels  |

---

## Methods

### `resize(width, height?)`

Resize the canvas. If `height` is omitted the canvas stays square.

```js
window.addEventListener('resize', () => viz.resize(window.innerWidth * 0.5));
```

### `setColor(color, index)`

Update a single palette entry without rebuilding the whole texture.

```js
viz.setColor([0.902, 0.224, 0.275], 2);
```

### `addColor(color, index?)`

Insert a color at `index` (appends if omitted).

```js
viz.addColor([0.659, 0.855, 0.863]); // append
viz.addColor([0.271, 0.482, 0.616], 0); // prepend
```

### `removeColor(index | color)`

Remove a palette entry by index or by color value.

```js
viz.removeColor(0);
viz.removeColor([0.659, 0.855, 0.863]);
```

### `destroy()`

Cancel the animation frame, release all WebGL resources (programs, textures, framebuffer, buffer, VAO), and remove the canvas from the DOM.

### `getColorAtUV(x, y)`

Returns the current shader result at normalized UV coordinates (`0–1` on both axes) as `[r, g, b]` in `0–1` sRGB. This reads directly from the WebGL render target (or outline source buffer), not from DOM canvas sampling.

```js
const color = viz.getColorAtUV(0.5, 0.5); // center
```

---

## Color models

Controls the 3-D color space the visualization is rendered in. Polar variants (`*Polar`) map hue to angle and show a circular wheel; non-polar variants show a rectangular slice.

**OK — hue-based**

| Value          | Shape | Description                                                                                               |
| -------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `'okhsv'`      | cube  | **Default.** Hue–Saturation–Value built on OKLab. Gamut-aware with perceptually uniform saturation steps. |
| `'okhsvPolar'` | wheel | Polar form of OKHsv.                                                                                      |
| `'okhsl'`      | cube  | Hue–Saturation–Lightness built on OKLab. Better lightness uniformity across hues.                         |
| `'okhslPolar'` | wheel | Polar form of OKHsl.                                                                                      |

**OK — Lab / LCH**

| Value           | Shape | Description                                                                          |
| --------------- | ----- | ------------------------------------------------------------------------------------ |
| `'oklab'`       | cube  | Raw OKLab: x→a, y→b, z→L.                                                            |
| `'oklch'`       | cube  | OKLab in cylindrical LCH coordinates. Ideal for chroma or lightness slices.          |
| `'oklchPolar'`  | wheel | Polar form of OKLch.                                                                 |
| `'oklrab'`      | cube  | OKLab with toe-corrected lightness (Lr). Better perceptual uniformity in dark tones. |
| `'oklrch'`      | cube  | OKLrab in cylindrical LCH coordinates.                                               |
| `'oklrchPolar'` | wheel | Polar form of OKLrch.                                                                |

**CIE Lab / LCH — D65**

| Value           | Shape | Description                                                    |
| --------------- | ----- | -------------------------------------------------------------- |
| `'cielab'`      | cube  | CIELab D65: x→a, y→b, z→L. The classic perceptual color space. |
| `'cielch'`      | cube  | CIELab D65 in cylindrical LCH coordinates.                     |
| `'cielchPolar'` | wheel | Polar form of CIELch D65.                                      |

**CIE Lab / LCH — D50**

| Value              | Shape | Description                                              |
| ------------------ | ----- | -------------------------------------------------------- |
| `'cielabD50'`      | cube  | CIELab adapted to D50 illuminant (ICC / print standard). |
| `'cielchD50'`      | cube  | CIELab D50 in cylindrical LCH coordinates.               |
| `'cielchD50Polar'` | wheel | Polar form of CIELch D50.                                |

**Classic**

| Value        | Shape | Description                                          |
| ------------ | ----- | ---------------------------------------------------- |
| `'hsv'`      | cube  | Classic HSV. Not perceptually uniform, but familiar. |
| `'hsvPolar'` | wheel | Polar form of HSV.                                   |
| `'hsl'`      | cube  | Classic HSL.                                         |
| `'hslPolar'` | wheel | Polar form of HSL.                                   |
| `'hwb'`      | cube  | HWB (Hue–Whiteness–Blackness). CSS Color 4 model.    |
| `'hwbPolar'` | wheel | Polar form of HWB.                                   |
| `'rgb'`      | cube  | Raw sRGB cube. Useful as a baseline.                 |

The OK-variants rely on Björn Ottosson's gamut-aware implementation and produce significantly more even hue distributions than the classic variants at the same GPU cost.

### Cube vs. polar — which to use?

Both shapes render the same underlying color space; they just arrange it differently on screen.

**Cube (rectangular slice)** lays the three axes out as a flat grid. One axis is fixed by the `position` slider, the other two fill the canvas. This makes it easy to read absolute values — you can see exactly where on the hue, saturation and lightness axes each palette color falls, and compare palettes side-by-side without any projection distortion.

**Polar (wheel)** wraps the hue axis around a circle. Hue runs around the circumference, saturation (or chroma) runs outward from the center, and the third axis is controlled by `position`. This matches the intuition most designers have for color — it's immediately obvious whether two colors are complementary, analogous or triadic. Voronoi regions that are nearly circular indicate a well-balanced palette; lopsided regions reveal hue bias.

A practical starting point: use a **polar** model to get an intuitive read on hue distribution and harmony, then switch to a **cube** slice to inspect individual lightness or saturation bands in detail. `rgb` and `oklab` have no polar variant because they aren't hue-based cylindrical spaces.

---

## Distance metrics

Controls how "nearest palette color" is determined per pixel.

**OK**

| Value      | Description                                                                                             | Cost |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---- |
| `'oklab'`  | **Default.** Euclidean distance in OKLab. Fast, perceptually uniform, excellent general-purpose choice. | low  |
| `'oklrab'` | Euclidean in OKLab with toe-corrected lightness. Slightly better uniformity in dark tones than OKLab.   | low  |

**CIE — D65**

| Value          | Description                                                                                                | Cost   |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| `'deltaE76'`   | Euclidean distance in CIELab D65. Identical to ΔE76. Classic standard, decent uniformity.                  | medium |
| `'deltaE94'`   | CIE 1994: adds chroma and hue weighting. Better than ΔE76, cheaper than ΔE2000.                            | medium |
| `'deltaE2000'` | CIEDE2000: per-channel corrections for hue, chroma and lightness. Most accurate CIE formula, most complex. | high   |

**CIE — D50**

| Value         | Description                                                                     | Cost   |
| ------------- | ------------------------------------------------------------------------------- | ------ |
| `'cielabD50'` | Euclidean distance in CIELab D50. Useful when working in print / ICC workflows. | medium |

**Heuristic / simple**

| Value               | Description                                                                                              | Cost   |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| `'kotsarenkoRamos'` | Weighted Euclidean in sRGB. Weights R and B by mean red for quick perceptual improvement over plain RGB. | lowest |
| `'rgb'`             | Plain Euclidean in sRGB. Not perceptually uniform. Useful as a baseline.                                 | lowest |

---

## Advanced usage

### Accessing the canvas

```js
// with no container, manage placement yourself
const viz = new PaletteViz({ palette });
document.querySelector('#app').appendChild(viz.canvas);

// or style it after the fact
viz.canvas.style.borderRadius = '50%';
```

### Multiple synchronised views

```js
const palette = ['#264653', '#2a9d8f', '#e9c46a'].map(toRGB);
const shared = { palette, width: 256, height: 256, container: document.querySelector('#views') };

const views = [
  new PaletteViz({ ...shared, axis: 'x', colorModel: 'okhslPolar' }),
  new PaletteViz({ ...shared, axis: 'y', colorModel: 'okhslPolar' }),
  new PaletteViz({ ...shared, axis: 'z', colorModel: 'okhslPolar' }),
];

document.querySelector('#slider').addEventListener('input', (e) => {
  views.forEach((v) => {
    v.position = +e.target.value;
  });
});
```

### Transparent outlines between regions

`outlineWidth` draws a transparent gap where one palette color's region meets another, revealing whatever is behind the canvas. Width is in physical pixels (i.e. it already accounts for `pixelRatio`).

```js
const viz = new PaletteViz({
  palette: ['#264653', '#2a9d8f', '#e9c46a'].map(toRGB),
  outlineWidth: 2,
  container: document.querySelector('#app'),
});

// change at runtime — no shader recompile while the value stays > 0
viz.outlineWidth = 4;

// set back to 0 to disable entirely (zero GPU overhead)
viz.outlineWidth = 0;
```

Implemented as a two-pass render: pass 1 draws the color regions into an offscreen framebuffer at the same cost as without outlines; pass 2 runs a tiny edge-detection shader that checks four neighbors via texture reads (no color-space math). The result is that enabling outlines adds negligible overhead compared to the single-pass approach.

When `outlineWidth` is `0` (the default) the framebuffer and outline program are never allocated.

### Utility exports

```js
import { paletteToRGBA, randomPalette, fragmentShader } from 'palette-shader';

// Get raw RGBA bytes (Uint8Array, sRGB, 4 bytes per color)
// Useful for building your own WebGL texture or processing palette data
const rgba = paletteToRGBA([
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]);

// Quick random palette for prototyping
const palette = randomPalette(16);

// Access the raw GLSL fragment shader string
console.log(fragmentShader);
```

---

## PaletteViz3D

Renders the full 3-D color space as an interactive cube (or cylinder for polar models) that you can rotate with trackball-style controls. Each surface voxel runs the same `modelToRGB` pipeline as `PaletteViz` and is snapped to the nearest palette color.

### Quick start (3D)

```js
import { PaletteViz3D } from 'palette-shader';

const viz3d = new PaletteViz3D({
  palette: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'].map(toRGB),
  container: document.querySelector('#app'),
  colorModel: 'okhsv',
  position: 1.0, // 1 = full volume, 0 = fully sliced
  outlineWidth: 2,
});
```

### Constructor (3D)

```ts
new PaletteViz3D(options?: PaletteViz3DOptions)
```

| Option           | Type                         | Default               | Description                                                                  |
| ---------------- | ---------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `palette`        | `[number, number, number][]` | random                | sRGB colors as `[r, g, b]`, each in `0–1`                                    |
| `container`      | `HTMLElement`                | `undefined`           | Element the canvas is appended to                                            |
| `width`          | `number`                     | `512`                 | Canvas width in CSS pixels                                                   |
| `height`         | `number`                     | `512`                 | Canvas height in CSS pixels                                                  |
| `pixelRatio`     | `number`                     | `devicePixelRatio`    | Renderer pixel ratio                                                         |
| `colorModel`     | `string`                     | `'okhsv'`             | Color model (see [Color models](#color-models)). Polar → cylinder mesh       |
| `distanceMetric` | `string`                     | `'oklab'`             | Distance metric (see [Distance metrics](#distance-metrics))                  |
| `position`       | `number`                     | `1`                   | 0–1 slice position. `1` shows the full volume; `0` slices it completely away |
| `invertZ`        | `boolean`                    | `false`               | Flip the lightness/value axis                                                |
| `showRaw`        | `boolean`                    | `false`               | Bypass nearest-color matching                                                |
| `outlineWidth`   | `number`                     | `0`                   | Transparent outline width (physical px). `0` disables                        |
| `gamutClip`      | `boolean`                    | `false`               | Discard out-of-sRGB-gamut pixels instead of clamping                         |
| `modelMatrix`    | `Float32Array`               | slight tilt (default) | Initial 4×4 column-major model rotation matrix                               |

### Properties (3D)

All constructor options except `modelMatrix` are live setter/getters (re-render on assignment), identical to `PaletteViz`.

Additional properties:

| Property      | Type                | Description                                                    |
| ------------- | ------------------- | -------------------------------------------------------------- |
| `canvas`      | `HTMLCanvasElement` | The canvas (read-only)                                         |
| `modelMatrix` | `Float32Array`      | Get/set the 4×4 model rotation matrix (copies on read & write) |

### Methods (3D)

#### `getColorAtUV(x, y)`

Returns the rendered color at normalised screen coordinates (`0–1` on both axes, y=0 is top) as `[r, g, b]` in `0–1` sRGB, or `null` if the cursor is over a transparent pixel (i.e. outside the 3D geometry). Flushes any pending rAF frame so the reading is always current.

```js
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const color = viz3d.getColorAtUV(
    (e.clientX - rect.left) / rect.width,
    (e.clientY - rect.top) / rect.height,
  );
  if (color) {
    const hex = '#' + color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    console.log(hex);
  }
});
```

#### `rotate(dx, dy)`

Apply an incremental trackball rotation. `dx` and `dy` are in radians (screen-space). Left-multiplies incremental X/Y rotations onto the accumulated model matrix.

```js
// wire up pointer events
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) viz3d.rotate(e.movementX * 0.01, e.movementY * 0.01);
});
```

#### `resize(width, height?)`

Same as `PaletteViz`.

#### `destroy()`

Release all WebGL resources and remove the canvas.

### Matrix helpers

The library exports lightweight 4×4 column-major matrix functions so you can build custom orbit / trackball controls without a math library:

```js
import {
  mat4Perspective,
  mat4Multiply,
  mat4RotateX,
  mat4RotateY,
  mat4Translate,
} from 'palette-shader';

// compose a custom model matrix and apply it
const model = mat4Multiply(mat4RotateX(0.4), mat4RotateY(0.6));
viz3d.modelMatrix = model;
```

| Function          | Signature                                 | Description                      |
| ----------------- | ----------------------------------------- | -------------------------------- |
| `mat4Perspective` | `(fov, aspect, near, far) → Float32Array` | Perspective projection matrix    |
| `mat4Multiply`    | `(a, b) → Float32Array`                   | Matrix multiplication `a × b`    |
| `mat4RotateX`     | `(angle) → Float32Array`                  | Rotation around X axis (radians) |
| `mat4RotateY`     | `(angle) → Float32Array`                  | Rotation around Y axis (radians) |
| `mat4Translate`   | `(x, y, z) → Float32Array`                | Translation matrix               |

---

## Dependencies

None. The library uses raw WebGL 2 with no runtime dependencies. Colors are accepted as `[r, g, b]` arrays (0–1 sRGB) — no CSS parsing happens at runtime.

## Browser support

Requires **WebGL 2** (supported in all modern browsers and most mobile devices since ~2017). Use `canvas.getContext('webgl2')` availability to feature-detect if needed.

---

## Development

```bash
git clone https://github.com/meodai/color-palette-shader.git
cd color-palette-shader
npm install

npm run dev        # start demo dev server → http://localhost:5173
npm run build      # build library → dist/
npm run typecheck  # TypeScript type check
```

The demo lives in `demo/` and is a private workspace package. It resolves the library from `src/` via a Vite alias so changes to the library are reflected immediately without a build step.

---

## License

MIT © [David Aerne](https://elastiq.ch)
