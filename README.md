# palette-shader

A WebGL shader (Three.js) that maps any colour palette across a 3-D perceptual colour space and snaps each pixel to the nearest palette colour. Visualise how a palette distributes across HSV, HSL, LCH or their perceptual OK-variants, and compare results across five colour-distance metrics — all on the GPU.

[**Live demo →**](https://meodai.github.io/color-palette-shader)

---

## Install

```bash
npm install palette-shader
```

No dependencies — only a browser with WebGL support is required.

---

## Quick start

```js
import { PaletteViz } from 'palette-shader';

// option A — pass a container, canvas is appended automatically
const viz = new PaletteViz({
  palette: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'],
  container: document.querySelector('#app'),
  width: 512,
  height: 512,
});

// option B — no container, place the canvas yourself
const viz = new PaletteViz({ palette: ['#264653', '#2a9d8f', '#e9c46a'] });
document.querySelector('#app').appendChild(viz.canvas);
```

---

## Constructor

```ts
new PaletteViz(options?: PaletteVizOptions)
```

All options are optional. The palette defaults to a random 20-colour set.

| Option | Type | Default | Description |
|---|---|---|---|
| `palette` | `string[]` | random | CSS colour strings (`#hex`, `rgb()`, `hsl()`, …) |
| `container` | `HTMLElement` | `undefined` | Element the canvas is appended to. Omit and use `viz.canvas` to place it yourself |
| `width` | `number` | `512` | Canvas width in CSS pixels |
| `height` | `number` | `512` | Canvas height in CSS pixels |
| `pixelRatio` | `number` | `devicePixelRatio` | Renderer pixel ratio |
| `colorModel` | `string` | `'okhsv'` | Colour space for the visualisation (see [Colour models](#colour-models)) |
| `distanceMetric` | `string` | `'oklab'` | Distance function for nearest-colour matching (see [Distance metrics](#distance-metrics)) |
| `isPolar` | `boolean` | `true` | `true` = circular wheel, `false` = rectangular slice |
| `axis` | `'x' \| 'y' \| 'z'` | `'y'` | Which axis the `position` value controls |
| `position` | `number` | `0` | 0–1 position along the chosen axis |
| `invertLightness` | `boolean` | `false` | Flip the lightness/value axis |
| `showRaw` | `boolean` | `false` | Bypass nearest-colour matching (shows the raw colour space) |

---

## Properties

Every constructor option is also a live setter/getter. Assigning any of them re-renders immediately via `requestAnimationFrame`.

```js
viz.palette = ['#ff0000', '#00ff00', '#0000ff'];
viz.position = 0.5;
viz.colorModel = 'okhsl';
viz.distanceMetric = 'deltaE2000';
viz.isPolar = false;
viz.invertLightness = true;
viz.showRaw = true;
```

Additional read-only properties:

| Property | Type | Description |
|---|---|---|
| `canvas` | `HTMLCanvasElement` | The underlying canvas element |
| `width` | `number` | Current width in CSS pixels |
| `height` | `number` | Current height in CSS pixels |

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
viz.setColor('#e63946', 2);
```

### `addColor(color, index?)`

Insert a colour at `index` (appends if omitted).

```js
viz.addColor('#a8dadc');       // append
viz.addColor('#457b9d', 0);   // prepend
```

### `removeColor(index | color)`

Remove a palette entry by index or by colour string.

```js
viz.removeColor(0);
viz.removeColor('#a8dadc');
```

### `destroy()`

Cancel the animation frame, dispose all Three.js resources, and remove the canvas from the DOM.

---

## Colour models

Controls the 3-D colour space the wheel or slice is rendered in.

| Value | Description |
|---|---|
| `'okhsv'` | **Default.** Hue–Saturation–Value built on OKLab. Gamut-aware hue wheel with perceptually uniform saturation steps. |
| `'okhsl'` | Hue–Saturation–Lightness built on OKLab. Better lightness uniformity across hues. |
| `'oklch'` | OKLab in cylindrical form (Lightness, Chroma, Hue). Ideal for chroma or lightness slices. |
| `'hsv'` | Classic HSV. Not perceptually uniform — hue jumps are uneven — but familiar and fast. |
| `'hsl'` | Classic HSL. Same caveats as `'hsv'`. |

The OK-variants rely on Björn Ottosson's gamut-aware implementation. They produce significantly more even hue distributions than the classic variants, at the same GPU cost.

---

## Distance metrics

Controls how "nearest palette colour" is determined per pixel.

| Value | Description | Cost |
|---|---|---|
| `'oklab'` | **Default.** Euclidean distance in OKLab. Fast, perceptually uniform, excellent general-purpose choice. | low |
| `'kotsarenkoRamos'` | Weighted Euclidean in sRGB — no colour-space conversion. Weights R and B by the mean red value for quick perceptual improvement over plain RGB. | lowest |
| `'deltaE76'` | CIE 1976: plain Euclidean distance in CIELab. Classic standard, decent uniformity. | medium |
| `'deltaE94'` | CIE 1994: adds chroma and hue weighting on top of ΔE76. Better than ΔE76, cheaper than ΔE2000. | medium |
| `'deltaE2000'` | CIEDE2000: weighted colour difference with per-channel corrections for hue, chroma, and lightness. Most accurate, most expensive. | high |
| `'rgb'` | Plain Euclidean in sRGB. Not perceptually uniform. Useful as a baseline. | lowest |

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
const palette = ['#264653', '#2a9d8f', '#e9c46a'];
const shared = { palette, width: 256, height: 256, container: document.querySelector('#views') };

const views = [
  new PaletteViz({ ...shared, axis: 'x', colorModel: 'okhsv' }),
  new PaletteViz({ ...shared, axis: 'y', colorModel: 'okhsl' }),
  new PaletteViz({ ...shared, axis: 'z', colorModel: 'oklch' }),
];

document.querySelector('#slider').addEventListener('input', (e) => {
  views.forEach((v) => { v.position = +e.target.value; });
});
```

### Utility exports

```js
import { paletteToRGBA, randomPalette, fragmentShader } from 'palette-shader';

// Get raw RGBA bytes (Uint8Array, sRGB, 4 bytes per color)
// Useful for building your own WebGL texture or processing palette data
const rgba = paletteToRGBA(['#ff0000', '#00ff00', '#0000ff']);

// Quick random palette for prototyping
const palette = randomPalette(16);

// Access the raw GLSL fragment shader string
console.log(fragmentShader);
```

---

## Dependencies

None. The library uses raw WebGL 1 and the browser's native CSS color parser. No Three.js or any other runtime dependency is required.

## Browser support

Requires **WebGL 1** or higher. Supported in all modern browsers and most mobile devices.

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
