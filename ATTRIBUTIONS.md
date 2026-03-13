# Attributions

## Spectrum color model (`COLOR_MODEL == 28`)

The spectrum visualization is inspired by the **SpectroBoxWidget** from
[censor](https://github.com/Quickmarble/censor) by Quickmarble.

- Wavelength → XYZ conversion uses the **CIE 1931 color matching function
  approximation** by Wyman, Sloan & Shirley (2013):
  [Simple Analytic Approximations to the CIE XYZ Color Matching Functions](https://jcgt.org/published/0002/02/01/)
- Lightness/chroma modulation in a perceptually uniform color space (OKLab)
  follows censor's approach of modulating J and C in CAM16UCS.
- Purple line wrap-around (connecting spectral red and violet) matches censor's
  `compute_spectrum` design with a configurable ratio (0.8 spectral / 0.2 purple).

## OKLab / OKHsl / OKHsv

GLSL implementation based on Bjorn Ottosson's reference code:
[A perceptual color space for image processing](https://bottosson.github.io/posts/oklab/)

## Delta E formulas

CIE ΔE76, ΔE94, and ΔE2000 follow the standard CIE specifications.
Kotsarenko–Ramos metric from their 2010 paper on measuring perceptual color
difference.

## CAM16-UCS metric

The fixed-viewing-condition CAM16-UCS implementation is based on the
MIT-licensed [censor](https://github.com/Quickmarble/censor) project by
Quickmarble.

This repo ports the forward sRGB/XYZ → CAM16-UCS transform for nearest-colour
matching under a fixed D65 CAT16 viewing condition.

## Demo dependencies and services

The demo and analyzer include a few third-party libraries and external services
that are not part of the core runtime package:

- [colorsort-js](https://github.com/websublime/colorsort) powers the analyzer's
  auto-sort worker for palette ordering.
- [culori](https://culorijs.org/) is used in the demo/analyzer for color
  conversion, interpolation, and color-vision-deficiency simulation.
- [token-beam](https://github.com/meodai/token-beam) is used for live palette
  sync in the demo/analyzer.
- [Color Name API](https://meodai.github.io/color-name-api/) via
  [api.color.pizza](https://api.color.pizza/v1/) is used to fetch palette color
  names in the analyzer.
- [Iosevka](https://be5invis.github.io/Iosevka/) is loaded from cdnjs for the
  demo and analyzer UI typography.
