# Use-case reference

Pick a color model and distance metric based on the question you want to answer.
No single combination is universally best — different questions call for different tools.

---

## What question do you want to answer?

| I want to know…                           | Color model                   | Distance metric | Why                                                                                          |
| ----------------------------------------- | ----------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| How my hue distribution looks             | `okhslPolar`                  | `oklab`         | Hue wraps around the wheel; perceptual uniformity means equal arc = equal visual difference. |
| Whether two colors are too similar        | `okhsl`                       | `deltaE2000`    | ΔE2000 best matches human perception of "same vs. different."                                |
| Whether a new color is worth adding       | `okhslPolar`                  | `oklab`         | If the new color doesn't carve out a visible region, it's redundant.                         |
| How my palette distributes lightness      | `oklch` or `okhsl`, axis `z`  | `oklab`         | Slice along the lightness axis; uneven coverage = contrast gaps.                             |
| How the palette reads in print workflows  | `cielchD50Polar`              | `cielabD50`     | D50 is the ICC/print reference illuminant.                                                   |
| How close colors look to a human eye      | `oklchPolar`                  | `deltaE2000`    | LCH polar + ΔE2000 is the closest pair to real perceptual experience.                        |
| What the palette looks like to a computer | `hslPolar`                    | `rgb`           | HSL and RGB are the coordinate systems most designers already think in.                      |
| Where gamut boundaries fall               | any model + `gamutClip: true` | any             | Out-of-gamut pixels are discarded, revealing the sRGB shell of the color space.              |

---

## Color model quick-reference

### OK — hue-based

These are usually the best starting point. OKLab gives perceptually uniform hue steps — unlike HSL/HSV where some hue arcs look much wider than others.

| Model        | Best for                             | Notes                                                  |
| ------------ | ------------------------------------ | ------------------------------------------------------ |
| `okhslPolar` | Hue harmony, coverage at a glance    | Recommended default. Wheel = intuitive.                |
| `okhsl`      | Comparing saturation/lightness bands | Rectangular slices expose exact L/S values.            |
| `okhsvPolar` | Gamut-relative saturation            | S is relative to the sRGB gamut boundary for that hue. |
| `okhsv`      | Same, rectangular layout             | —                                                      |

### OK — Lab / LCH

Useful when you want to reason about chroma and lightness independently, or when computing distances.

| Model                    | Best for                               | Notes                                            |
| ------------------------ | -------------------------------------- | ------------------------------------------------ |
| `oklab`                  | Raw perceptual space, debugging        | Axes are a/b (chroma directions) and L.          |
| `oklch`                  | Chroma and lightness slices            | C = chroma, H = hue angle, L = lightness.        |
| `oklchPolar`             | Closest to ΔE perception, wheel layout | Good partner with `deltaE2000`.                  |
| `oklrab`                 | Dark tone accuracy                     | Toe-corrected L (Lr) improves shadow uniformity. |
| `oklrch` / `oklrchPolar` | Same as oklch with better darks        | —                                                |

### CIE Lab / LCH

The classic standard. D65 is screen/daylight; D50 is print/ICC.

| Model                          | Best for                           | Notes                                         |
| ------------------------------ | ---------------------------------- | --------------------------------------------- |
| `cielab`                       | Legacy compatibility, research     | Slightly less uniform than OKLab in practice. |
| `cielchPolar`                  | Perceptual hue wheel, CIE-grounded | Good when you need CIE compliance.            |
| `cielabD50` / `cielchD50Polar` | Print and ICC workflows            | Match what your color management system sees. |

### Classic

Familiar, but not perceptually uniform — equal steps in HSL/HSV look unequal to the eye.

| Model              | Best for                                 | Notes                                                       |
| ------------------ | ---------------------------------------- | ----------------------------------------------------------- |
| `hslPolar` / `hsl` | Audience who thinks in CSS/HSL           | Good for communicating results to computers/external tools. |
| `hsvPolar` / `hsv` | Artists used to traditional color wheels | —                                                           |
| `hwbPolar` / `hwb` | CSS Color 4 / web-standard context       | —                                                           |
| `rgb`              | Raw baseline, debugging                  | No perceptual weighting at all.                             |

### Bit-depth / retro

Quantizes the color space to a hardware palette. Useful for checking whether a palette still reads well under hardware color limitations.

| Model      | Real-world context             | Colors available |
| ---------- | ------------------------------ | ---------------- |
| `rgb6bit`  | Early digital / toy hardware   | 64               |
| `rgb8bit`  | CGA / indexed-color era        | 256              |
| `rgb12bit` | NTSC / Amiga OCS               | 4,096            |
| `rgb15bit` | SVGA HiColor (5-5-5)           | 32,768           |
| `rgb18bit` | VGA DAC hardware palette space | 262,144          |

---

## Distance metric quick-reference

The distance metric controls how "nearest palette color" is decided per pixel. It does not change the shape of the visualization — only which palette color claims each region.

| Metric            | Speed   | Best for                                  | Avoid when…                                       |
| ----------------- | ------- | ----------------------------------------- | ------------------------------------------------- |
| `oklab`           | fast    | General-purpose default                   | You need strict CIE compliance                    |
| `oklrab`          | fast    | Better shadow differentiation             | —                                                 |
| `deltaE76`        | medium  | Classic CIE baseline                      | Colors in highly saturated or blue/purple ranges  |
| `deltaE94`        | medium  | Better than ΔE76, cheaper than ΔE2000     | You need the most accurate result                 |
| `deltaE2000`      | slow    | Most perceptually accurate CIE formula    | GPU-heavy, may affect framerate on large palettes |
| `cielabD50`       | medium  | Print / ICC workflows                     | Screen-only contexts                              |
| `kotsarenkoRamos` | fastest | Quick cheap approximation                 | Any accuracy-sensitive use                        |
| `rgb`             | fastest | Debugging, computer/external tool context | Perceptual quality matters                        |

For most use-cases `oklab` is the right default. Upgrade to `deltaE2000` when you specifically need the closest match to how a human observer perceives color differences.
