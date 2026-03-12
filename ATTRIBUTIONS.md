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
https://bottosson.github.io/posts/oklab/

## Delta E formulas

CIE ΔE76, ΔE94, and ΔE2000 follow the standard CIE specifications.
Kotsarenko–Ramos metric from their 2010 paper on measuring perceptual color
difference.
