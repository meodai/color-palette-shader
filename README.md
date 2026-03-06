# palette-shader

A dependency-free WebGL2 shader that maps any colour palette across a 3-D perceptual colour space and snaps each pixel to the nearest palette colour. Visualise how a palette distributes across more than twenty colour models — OKHsl, OKHsv, OKLab, OKLrab, OKLch, CIELab, CIELch, HSL, HSV, HWB, RGB and their D50 / polar variants — and compare results across eight distance metrics from plain RGB to CIEDE2000, all on the GPU.

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
const toRGB = (hex) => { const c = toSRGB(hex); return [c.r, c.g, c.b]; };

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

All options are optional. The palette defaults to a random 20-colour set.

| Option           | Type                | Default            | Description                                                                                                  |
| ---------------- | ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `palette`        | `[number, number, number][]` | random   | sRGB colours as `[r, g, b]` arrays, each component in the `0–1` range                                       |
| `container`      | `HTMLElement`       | `undefined`        | Element the canvas is appended to. Omit and use `viz.canvas` to place it yourself                            |
| `width`          | `number`            | `512`              | Canvas width in CSS pixels                                                                                   |
| `height`         | `number`            | `512`              | Canvas height in CSS pixels                                                                                  |
| `pixelRatio`     | `number`            | `devicePixelRatio` | Renderer pixel ratio                                                                                         |
| `colorModel`     | `string`            | `'okhsv'`          | Colour space for the visualisation (see [Colour models](#colour-models))                                     |
| `distanceMetric` | `string`            | `'oklab'`          | Distance function for nearest-colour matching (see [Distance metrics](#distance-metrics))                    |
| `axis`           | `'x' \| 'y' \| 'z'` | `'y'`              | Which axis the `position` value controls                                                                     |
| `position`       | `number`            | `0`                | 0–1 position along the chosen axis                                                                           |
| `invertZ`        | `boolean`           | `false`            | Flip the lightness/value axis                                                                                |
| `showRaw`        | `boolean`           | `false`            | Bypass nearest-colour matching (shows the raw colour space)                                                  |
| `outlineWidth`   | `number`            | `0`                | Draw a transparent outline where palette regions meet. Width in physical pixels. `0` disables (no overhead). |

---

## Properties

Every constructor option is also a live setter/getter. Assigning any of them re-renders immediately via `requestAnimationFrame`.

```js
viz.palette = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
viz.position = 0.5;
viz.colorModel = 'okhslPolar';
viz.distanceMetric = 'deltaE2000';
viz.invertZ = true;
viz.showRaw = true;
viz.outlineWidth = 2; // transparent border between regions, in physical pixels
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

Insert a colour at `index` (appends if omitted).

```js
viz.addColor([0.659, 0.855, 0.863]); // append
viz.addColor([0.271, 0.482, 0.616], 0); // prepend
```

### `removeColor(index | color)`

Remove a palette entry by index or by colour value.

```js
viz.removeColor(0);
viz.removeColor([0.659, 0.855, 0.863]);
```

### `destroy()`

Cancel the animation frame, release all WebGL resources (programs, textures, framebuffer, buffer, VAO), and remove the canvas from the DOM.

---

## Colour models

Controls the 3-D colour space the visualisation is rendered in. Polar variants (`*Polar`) map hue to angle and show a circular wheel; non-polar variants show a rectangular slice.

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

| Value           | Shape | Description                                                     |
| --------------- | ----- | --------------------------------------------------------------- |
| `'cielab'`      | cube  | CIELab D65: x→a, y→b, z→L. The classic perceptual colour space. |
| `'cielch'`      | cube  | CIELab D65 in cylindrical LCH coordinates.                      |
| `'cielchPolar'` | wheel | Polar form of CIELch D65.                                       |

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

Both shapes render the same underlying colour space; they just arrange it differently on screen.

**Cube (rectangular slice)** lays the three axes out as a flat grid. One axis is fixed by the `position` slider, the other two fill the canvas. This makes it easy to read absolute values — you can see exactly where on the hue, saturation and lightness axes each palette colour falls, and compare palettes side-by-side without any projection distortion.

**Polar (wheel)** wraps the hue axis around a circle. Hue runs around the circumference, saturation (or chroma) runs outward from the centre, and the third axis is controlled by `position`. This matches the intuition most designers have for colour — it's immediately obvious whether two colours are complementary, analogous or triadic. Voronoi regions that are nearly circular indicate a well-balanced palette; lopsided regions reveal hue bias.

A practical starting point: use a **polar** model to get an intuitive read on hue distribution and harmony, then switch to a **cube** slice to inspect individual lightness or saturation bands in detail. `rgb` and `oklab` have no polar variant because they aren't hue-based cylindrical spaces.

---

## Distance metrics

Controls how "nearest palette colour" is determined per pixel.

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

`outlineWidth` draws a transparent gap where one palette colour's region meets another, revealing whatever is behind the canvas. Width is in physical pixels (i.e. it already accounts for `pixelRatio`).

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

Implemented as a two-pass render: pass 1 draws the colour regions into an offscreen framebuffer at the same cost as without outlines; pass 2 runs a tiny edge-detection shader that checks four neighbours via texture reads (no colour-space math). The result is that enabling outlines adds negligible overhead compared to the single-pass approach.

When `outlineWidth` is `0` (the default) the framebuffer and outline program are never allocated.

### Utility exports

```js
import { paletteToRGBA, randomPalette, fragmentShader } from 'palette-shader';

// Get raw RGBA bytes (Uint8Array, sRGB, 4 bytes per color)
// Useful for building your own WebGL texture or processing palette data
const rgba = paletteToRGBA([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);

// Quick random palette for prototyping
const palette = randomPalette(16);

// Access the raw GLSL fragment shader string
console.log(fragmentShader);
```

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
