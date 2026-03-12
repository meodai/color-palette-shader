// @ts-ignore
import shaderSRGB2RGB from './shaders/srgb2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderOKLab from './shaders/oklab.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderHSL2RGB from './shaders/hsl2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderHSV2RGB from './shaders/hsv2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderLCH2RGB from './shaders/lch2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderHWB2RGB from './shaders/hwb2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderCIELab2RGB from './shaders/cielab2rgb.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderDeltaE from './shaders/deltaE.frag.glsl?raw' assert { type: 'raw' };
// @ts-ignore
import shaderClosestColor from './shaders/closestColor.frag.glsl?raw' assert { type: 'raw' };

// Include order matters:
//   oklab        – M_PI, cbrt(), srgb_transfer_function(), srgb_transfer_function_inv(), okhsv/okhsl_to_srgb(), …
//   srgb2rgb     – srgb2rgb() wraps srgb_transfer_function_inv from oklab
//   hsl2rgb, hsv2rgb, lch2rgb – color model conversions (lch2rgb uses M_PI + srgb_transfer_function)
//   deltaE       – srgb_to_cielab(), deltaE76/94/2000() (uses srgb2rgb, cbrt, M_PI, TWO_PI)
//   closestColor – branches on DISTANCE_METRIC define; uses everything above
//
// Defines (compile-time, prepended to shader source — trigger recompile, no runtime branching):
//   DISTANCE_METRIC  int  0=rgb 1=oklab 2=deltaE76(=cielabD65) 3=deltaE2000 4=kotsarenkoRamos 5=deltaE94 6=oklrab 7=cielabD50 8=okLightness 9=liMatch
//   COLOR_MODEL      int  0=rgb 1=rgb12bit 2=rgb8bit 3=oklab 4=okhsv 5=okhsvPolar
//                         6=okhsl 7=okhslPolar 8=oklch 9=oklchPolar 10=hsv 11=hsvPolar
//                         12=hsl 13=hslPolar 14=hwb 15=hwbPolar 16=oklrab 17=oklrch
//                         18=oklrchPolar 19=cielab 20=cielch 21=cielchPolar
//                         22=cielabD50 23=cielchD50 24=cielchD50Polar
//                         25=rgb18bit 26=rgb6bit 27=rgb15bit 28=spectrum 29=oklchDiag
//   PROGRESS_AXIS    int  0=x 1=y 2=z
//   INVERT_X         flag (defined = true)
//   INVERT_Y         flag (defined = true)
//   INVERT_Z         flag (defined = true)
//   AUTO_FLIP_Y      flag (defined = true)
//   SHOW_RAW         flag (defined = true)

export const vertexShaderSrc = `
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 vUv;
void main() {
  vUv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// modelToRGB and main are separated so the selective assembler can reuse them.
export const modelToRGBSrc = `
#if COLOR_MODEL == 1
vec3 quantizeRGB444(vec3 colorCoords) {
  vec3 rgb = clamp(colorCoords, 0.0, 1.0);
  vec3 levels = min(floor(rgb * 16.0), vec3(15.0));
  return levels / 15.0;
}
#endif

#if COLOR_MODEL == 2
vec3 quantizeRGB332(vec3 colorCoords) {
  vec3 rgb = clamp(colorCoords, 0.0, 1.0);
  float r = min(floor(rgb.r * 8.0), 7.0) / 7.0;
  float g = min(floor(rgb.g * 8.0), 7.0) / 7.0;
  float b = min(floor(rgb.b * 4.0), 3.0) / 3.0;
  return vec3(r, g, b);
}
#endif

#if COLOR_MODEL == 25
vec3 quantizeRGB666(vec3 colorCoords) {
  vec3 rgb = clamp(colorCoords, 0.0, 1.0);
  vec3 levels = min(floor(rgb * 64.0), vec3(63.0));
  return levels / 63.0;
}
#endif

#if COLOR_MODEL == 26
vec3 quantizeRGB222(vec3 colorCoords) {
  vec3 rgb = clamp(colorCoords, 0.0, 1.0);
  vec3 levels = min(floor(rgb * 4.0), vec3(3.0));
  return levels / 3.0;
}
#endif

#if COLOR_MODEL == 27
vec3 quantizeRGB555(vec3 colorCoords) {
  vec3 rgb = clamp(colorCoords, 0.0, 1.0);
  vec3 levels = min(floor(rgb * 32.0), vec3(31.0));
  return levels / 31.0;
}
#endif

#if COLOR_MODEL == 28
// CIE 1931 XYZ color matching function approximation (Wyman et al. 2013)
float cie_x(float w) {
  float t1 = (w - 442.0) * ((w < 442.0) ? 0.0624 : 0.0374);
  float t2 = (w - 599.8) * ((w < 599.8) ? 0.0264 : 0.0323);
  float t3 = (w - 501.1) * ((w < 501.1) ? 0.0490 : 0.0382);
  return 0.362 * exp(-0.5*t1*t1) + 1.056 * exp(-0.5*t2*t2) - 0.065 * exp(-0.5*t3*t3);
}
float cie_y(float w) {
  float t1 = (w - 568.8) * ((w < 568.8) ? 0.0213 : 0.0247);
  float t2 = (w - 530.9) * ((w < 530.9) ? 0.0613 : 0.0322);
  return 0.821 * exp(-0.5*t1*t1) + 0.286 * exp(-0.5*t2*t2);
}
float cie_z(float w) {
  float t1 = (w - 437.0) * ((w < 437.0) ? 0.0845 : 0.0278);
  float t2 = (w - 459.0) * ((w < 459.0) ? 0.0385 : 0.0725);
  return 1.217 * exp(-0.5*t1*t1) + 0.681 * exp(-0.5*t2*t2);
}
// Wavelength → OKLab (via XYZ → linear sRGB → OKLab)
vec3 wavelength_to_oklab(float nm) {
  float x = cie_x(nm), y = cie_y(nm), z = cie_z(nm);
  // XYZ → linear sRGB (D65)
  vec3 lin = vec3(
     3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
     0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  );
  lin = max(lin, vec3(0.0));
  return linear_srgb_to_oklab(lin);
}
#endif

vec3 modelToRGB(vec3 colorCoords) {
  #if COLOR_MODEL == 0
    return colorCoords;
  #elif COLOR_MODEL == 1
    return quantizeRGB444(colorCoords);
  #elif COLOR_MODEL == 2
    return quantizeRGB332(colorCoords);
  #elif COLOR_MODEL == 3
    vec3 linear = oklab_to_linear_srgb(vec3(colorCoords.z, colorCoords.x - 0.5, colorCoords.y - 0.5));
    return vec3(srgb_transfer_function(linear.r), srgb_transfer_function(linear.g), srgb_transfer_function(linear.b));
  #elif COLOR_MODEL == 4 || COLOR_MODEL == 5
    return okhsv_to_srgb(colorCoords);
  #elif COLOR_MODEL == 6 || COLOR_MODEL == 7
    return okhsl_to_srgb(colorCoords);
  #elif COLOR_MODEL == 8 || COLOR_MODEL == 9 || COLOR_MODEL == 29
    return lch2rgb(vec3(colorCoords.z, colorCoords.y, colorCoords.x));
  #elif COLOR_MODEL == 10 || COLOR_MODEL == 11
    return hsv2rgb(colorCoords);
  #elif COLOR_MODEL == 12 || COLOR_MODEL == 13
    return hsl2rgb(colorCoords);
  #elif COLOR_MODEL == 14 || COLOR_MODEL == 15
    return hwb2rgb(colorCoords);
  #elif COLOR_MODEL == 16
    vec3 linear14 = oklab_to_linear_srgb(vec3(toe_inv(colorCoords.z), colorCoords.x - 0.5, colorCoords.y - 0.5));
    return vec3(srgb_transfer_function(linear14.r), srgb_transfer_function(linear14.g), srgb_transfer_function(linear14.b));
  #elif COLOR_MODEL == 17 || COLOR_MODEL == 18
    return lch2rgb(vec3(toe_inv(colorCoords.z), colorCoords.y, colorCoords.x));
  #elif COLOR_MODEL == 19
    return cielab_d65_to_rgb(vec3(colorCoords.z * 100.0, (colorCoords.x - 0.5) * 256.0, (colorCoords.y - 0.5) * 256.0));
  #elif COLOR_MODEL == 20 || COLOR_MODEL == 21
    return cielab_d65_to_rgb(vec3(colorCoords.z * 100.0, colorCoords.y * 150.0 * cos(colorCoords.x * TWO_PI), colorCoords.y * 150.0 * sin(colorCoords.x * TWO_PI)));
  #elif COLOR_MODEL == 22
    return cielab_d50_to_rgb(vec3(colorCoords.z * 100.0, (colorCoords.x - 0.5) * 256.0, (colorCoords.y - 0.5) * 256.0));
  #elif COLOR_MODEL == 23 || COLOR_MODEL == 24
    return cielab_d50_to_rgb(vec3(colorCoords.z * 100.0, colorCoords.y * 150.0 * cos(colorCoords.x * TWO_PI), colorCoords.y * 150.0 * sin(colorCoords.x * TWO_PI)));
  #elif COLOR_MODEL == 25
    return quantizeRGB666(colorCoords);
  #elif COLOR_MODEL == 26
    return quantizeRGB222(colorCoords);
  #elif COLOR_MODEL == 27
    return quantizeRGB555(colorCoords);
  #elif COLOR_MODEL == 28
    // X = spectral position, Y = lightness modulation, Z = chroma scale
    // All modulation in OKLab for perceptually uniform results (like censor's CAM16UCS approach)
    float sx = colorCoords.x;
    vec3 labSpec;
    if (sx < 0.8) {
      // 0..0.8 → wavelengths 410..665nm (visible range)
      labSpec = wavelength_to_oklab(410.0 + (sx / 0.8) * 255.0);
    } else {
      // 0.8..1.0 → purple line (red to violet, mixed in OKLab)
      float pt = (sx - 0.8) / 0.2;
      labSpec = mix(wavelength_to_oklab(665.0), wavelength_to_oklab(410.0), pt);
    }
    // Y: t in [-1,1] — center = natural lightness, bottom = black, top = white
    float st = 2.0 * colorCoords.y - 1.0;
    // Modulate L toward 0 (black) or 1 (white)
    float L = (st < 0.0)
      ? mix(labSpec.x, 0.0, -st)
      : mix(labSpec.x, 1.0,  st);
    // Chroma fades parabolically toward extremes, scaled by Z
    float chromaScale = (1.0 - st * st) * colorCoords.z;
    float a = labSpec.y * chromaScale;
    float b = labSpec.z * chromaScale;
    // OKLab → linear sRGB → sRGB
    vec3 linOut = oklab_to_linear_srgb(vec3(L, a, b));
    return vec3(
      srgb_transfer_function(max(linOut.r, 0.0)),
      srgb_transfer_function(max(linOut.g, 0.0)),
      srgb_transfer_function(max(linOut.b, 0.0))
    );
  #else
    return colorCoords;
  #endif
}
`;

const mainSrc = `
void main(){
  vec2 uv = vUv;
  #ifdef AUTO_FLIP_Y
    uv.y = 1. - uv.y;
  #endif

  #if PROGRESS_AXIS == 1
    vec3 colorCoords = vec3(uv.x, progress, uv.y);
  #elif PROGRESS_AXIS == 2
    vec3 colorCoords = vec3(uv.x, uv.y, 1. - progress);
  #else
    vec3 colorCoords = vec3(progress, uv.x, uv.y);
  #endif

  #if COLOR_MODEL == 5 || COLOR_MODEL == 7 || COLOR_MODEL == 9 || COLOR_MODEL == 11 || COLOR_MODEL == 13 || COLOR_MODEL == 18 || COLOR_MODEL == 21 || COLOR_MODEL == 24
    vec2 toCenter = uv - 0.5;
    float angle = atan(toCenter.y, toCenter.x);
    float radius = length(toCenter) * 2.0;

    #if PROGRESS_AXIS == 2
      if (radius > 1.0) { discard; }
      colorCoords = vec3((angle / TWO_PI), radius, 1. - progress);
    #elif PROGRESS_AXIS == 1
      colorCoords = vec3((angle / TWO_PI), 1. - progress, radius);
      if (radius > 1.0) { discard; }
    #else
      float hue = 1.0 - abs(0.5 - progress * .5) * 2.0;
      if (uv.x > 0.5) { hue += 0.5; }
      colorCoords = vec3(hue, abs(0.5 - uv.x) * 2.0, uv.y);
    #endif
  #elif COLOR_MODEL == 15
    vec2 toCenter = uv - 0.5;
    float angle = atan(toCenter.y, toCenter.x);
    float radius = length(toCenter) * 2.0;

    #if PROGRESS_AXIS == 2
      if (radius > 1.0) { discard; }
      colorCoords = vec3(angle / TWO_PI, 1.0 - radius, progress);
    #elif PROGRESS_AXIS == 1
      if (radius > 1.0) { discard; }
      colorCoords = vec3(angle / TWO_PI, radius, progress);
    #else
      float hue = 1.0 - abs(0.5 - progress * .5) * 2.0;
      if (uv.x > 0.5) { hue += 0.5; }
      colorCoords = vec3(hue, 1.0 - abs(0.5 - uv.x) * 2.0, uv.y);
    #endif
  #elif COLOR_MODEL == 29
    // Diagonal complementary: 3D cube is (hue, diagA, diagB) where
    // L = (diagA+diagB)/2, signed chroma = diagB-diagA, hue wraps at 0.5.
    // Each axis slices a different plane of that cube.
    #if PROGRESS_AXIS == 0
      // axis='x': slider=hue, uv shows diagA×diagB → complementary diagonal
      float compHue29 = progress * 0.5;
      float compL29 = (uv.x + uv.y) * 0.5;
      float compD29 = uv.y - uv.x;
    #elif PROGRESS_AXIS == 1
      // axis='y': slider=diagA, uv.x=hue, uv.y=diagB → hue vs chroma/lightness
      float compHue29 = uv.x * 0.5;
      float compL29 = (progress + uv.y) * 0.5;
      float compD29 = uv.y - progress;
    #else
      // axis='z': slider=diagB, uv.x=hue, uv.y=diagA → hue vs chroma/lightness
      float compHue29 = uv.x * 0.5;
      float compL29 = (uv.y + (1.0 - progress)) * 0.5;
      float compD29 = (1.0 - progress) - uv.y;
    #endif
    float compC29 = abs(compD29);
    if (compD29 < 0.0) compHue29 += 0.5;
    colorCoords = vec3(compHue29, compC29, compL29);
  #endif

  #ifdef INVERT_X
    colorCoords.x = 1. - colorCoords.x;
  #endif

  #ifdef INVERT_Y
    colorCoords.y = 1. - colorCoords.y;
  #endif

  #ifdef INVERT_Z
    colorCoords.z = 1. - colorCoords.z;
  #endif

  vec3 rgb = modelToRGB(colorCoords);

  #ifdef GAMUT_CLIP
  if (any(lessThan(rgb, vec3(0.0))) || any(greaterThan(rgb, vec3(1.0)))) {
    fragColor = vec4(0.0);
    return;
  }
  #endif

  rgb = clamp(rgb, 0.0, 1.0);
  #ifdef SHOW_RAW
    fragColor = vec4(rgb, 1.);
  #else
    fragColor = vec4(closestColor(rgb, paletteTexture), 1.);
  #endif
}`;

// Full fragment shader source with all includes — exported for users who want
// to inspect or reuse the complete GLSL source.
export const fragmentShader =
  `
precision highp float;
#define TWO_PI 6.28318530718
in vec2 vUv;
out vec4 fragColor;
uniform float progress;
uniform sampler2D paletteTexture;

${shaderOKLab}
${shaderSRGB2RGB}
${shaderHSL2RGB}
${shaderHSV2RGB}
${shaderLCH2RGB}
${shaderHWB2RGB}
${shaderCIELab2RGB}
${shaderDeltaE}
${shaderClosestColor}
` +
  modelToRGBSrc +
  mainSrc;

// ── Selective shader assembly ────────────────────────────────────────────────
// Instead of compiling ALL shader includes every time, pick only the chunks
// needed for the current colorModel + distanceMetric. This dramatically
// reduces compiled shader size and speeds up recompiles.

type ShaderNeeds = {
  oklab: boolean;
  srgb2rgb: boolean;
  hsl2rgb: boolean;
  hsv2rgb: boolean;
  lch2rgb: boolean;
  hwb2rgb: boolean;
  cielab2rgb: boolean;
  deltaE: boolean;
  closestColor: boolean;
};

function shaderNeedsForModel(model: number): Partial<ShaderNeeds> {
  switch (model) {
    case 0:
    case 1:
    case 2:
    case 25:
    case 26:
    case 27:
      return {}; // rgb, rgb12bit, rgb8bit, rgb18bit, rgb6bit, rgb15bit, rgb16bit
    case 3:
    case 16:
      return { oklab: true }; // oklab, oklrab
    case 4:
    case 5:
      return { oklab: true }; // okhsv, okhsvPolar
    case 6:
    case 7:
      return { oklab: true }; // okhsl, okhslPolar
    case 8:
    case 9:
    case 17:
    case 18:
      return { oklab: true, lch2rgb: true }; // oklch/oklrch + polar
    case 10:
    case 11:
      return { hsv2rgb: true }; // hsv, hsvPolar
    case 12:
    case 13:
      return { hsl2rgb: true }; // hsl, hslPolar
    case 14:
    case 15:
      return { hwb2rgb: true }; // hwb, hwbPolar
    case 19:
    case 20:
    case 21: // cielab, cielch, cielchPolar
      return { oklab: true, srgb2rgb: true, cielab2rgb: true };
    case 22:
    case 23:
    case 24: // cielabD50, cielchD50, cielchD50Polar
      return { oklab: true, srgb2rgb: true, cielab2rgb: true };
    case 28: // spectrum (uses srgb_transfer_function from oklab)
      return { oklab: true };
    case 29: // oklchDiag (same conversion as oklch)
      return { oklab: true, lch2rgb: true };
    default:
      return {};
  }
}

function shaderNeedsForMetric(metric: number): Partial<ShaderNeeds> {
  switch (metric) {
    case 0:
      return {}; // rgb
    case 1:
    case 6:
    case 8:
    case 9:
      return { oklab: true, srgb2rgb: true }; // oklab, oklrab, okLightness, liMatch
    case 2:
    case 3:
    case 5: // deltaE76, deltaE2000, deltaE94
      return { oklab: true, srgb2rgb: true, cielab2rgb: true, deltaE: true };
    case 4:
      return { deltaE: true }; // kotsarenkoRamos
    case 7:
      return { oklab: true, srgb2rgb: true, cielab2rgb: true }; // cielabD50
    default:
      return {};
  }
}

function assembleChunks(needs: ShaderNeeds): string {
  let src = '';
  // oklab must come before srgb2rgb (srgb2rgb wraps srgb_transfer_function_inv)
  if (needs.oklab) src += shaderOKLab + '\n';
  if (needs.srgb2rgb) src += shaderSRGB2RGB + '\n';
  if (needs.hsl2rgb) src += shaderHSL2RGB + '\n';
  if (needs.hsv2rgb) src += shaderHSV2RGB + '\n';
  if (needs.lch2rgb) src += shaderLCH2RGB + '\n';
  if (needs.hwb2rgb) src += shaderHWB2RGB + '\n';
  if (needs.cielab2rgb) src += shaderCIELab2RGB + '\n';
  if (needs.deltaE) src += shaderDeltaE + '\n';
  if (needs.closestColor) src += shaderClosestColor + '\n';
  return src;
}

function resolveNeeds(colorModel: number, distanceMetric: number, showRaw: boolean): ShaderNeeds {
  const modelNeeds = shaderNeedsForModel(colorModel);
  const metricNeeds = showRaw ? {} : shaderNeedsForMetric(distanceMetric);
  return {
    oklab: !!(modelNeeds.oklab || metricNeeds.oklab),
    srgb2rgb: !!(modelNeeds.srgb2rgb || metricNeeds.srgb2rgb),
    hsl2rgb: !!modelNeeds.hsl2rgb,
    hsv2rgb: !!modelNeeds.hsv2rgb,
    lch2rgb: !!modelNeeds.lch2rgb,
    hwb2rgb: !!modelNeeds.hwb2rgb,
    cielab2rgb: !!(modelNeeds.cielab2rgb || metricNeeds.cielab2rgb),
    deltaE: !!metricNeeds.deltaE && !showRaw,
    closestColor: !showRaw,
  };
}

export function assembleFragShader(
  colorModel: number,
  distanceMetric: number,
  showRaw: boolean,
): string {
  const needs = resolveNeeds(colorModel, distanceMetric, showRaw);
  let src = `
precision highp float;
#define TWO_PI 6.28318530718
in vec2 vUv;
out vec4 fragColor;
uniform float progress;
uniform sampler2D paletteTexture;
`;
  src += assembleChunks(needs);
  src += modelToRGBSrc + mainSrc;
  return src;
}

// ── 3D-specific shader sources ───────────────────────────────────────────────

// Vertex shader: a unit cube [0,1]^3 projected with a model-view-proj matrix.
// Passes the 3D position as the color coordinate to the fragment shader.
export const vertexShader3DCubeSrc = `
precision highp float;
layout(location = 0) in vec3 a_position;
out vec3 vColorCoord;

uniform mat4 uMVP;
uniform float uPosition;
#ifdef GAMUT_CLIP
uniform mat3 uColorRotation;
uniform float uSliceOffset;
#endif

void main() {
  vec3 pos = a_position;
  #ifdef GAMUT_CLIP
    pos.x += uSliceOffset;
    vColorCoord = uColorRotation * (pos - 0.5) + 0.5;
  #else
    pos.x = min(pos.x, uPosition);
    vColorCoord = pos;
  #endif
  gl_Position = uMVP * vec4(pos - 0.5, 1.0);
}`;

// Cylinder vertex shader: always uses color-space rotation (ortho + fixed camera).
// The mesh stores only position (3 floats) — polar conversion happens
// per-pixel in the fragment shader.
export const vertexShader3DCylSrc = `
precision highp float;
layout(location = 0) in vec3 a_position;
out vec3 vColorCoord;

uniform mat4 uMVP;
uniform mat3 uColorRotation;

void main() {
  vColorCoord = uColorRotation * a_position;
  gl_Position = uMVP * vec4(a_position, 1.0);
}`;

// Fragment shader for the 3D view.
const mainSrc3D = `
void main() {
  vec3 cc = vColorCoord;

  #ifdef IS_POLAR
    // Rotated Cartesian → polar per-pixel (avoids atan interpolation artifacts)
    float hue = atan(cc.z, cc.x) / TWO_PI;
    if (hue < 0.0) hue += 1.0;
    float r = length(cc.xz) * 2.0;
    float h = cc.y + 0.5;
    // Single discard: height bounds + position + shape envelope
    #ifdef SHAPE_CONE
      if (h < 0.0 || h > uPosition || r > h) discard;
    #elif defined(SHAPE_CONE_INV)
      if (h < 0.0 || h > uPosition || r > 1.0 - h) discard;
    #elif defined(SHAPE_BICONE)
      if (h < 0.0 || h > uPosition || r > 1.0 - abs(2.0 * h - 1.0)) discard;
    #else
      if (h < 0.0 || h > uPosition || r > 1.0) discard;
    #endif
    cc = vec3(hue, r, h);
  #else
    #ifdef GAMUT_CLIP
      // Discard outside [0,1]³ — padding covers the rotated cube but
      // out-of-range coords would duplicate via trig periodicity / mirroring.
      if (any(lessThan(cc, vec3(0.0))) || any(greaterThan(cc, vec3(1.0)))) discard;
    #endif
    if (cc.x > uPosition) discard;
  #endif

  #if COLOR_MODEL == 29
    // Diagonal complementary: cc.x = hue axis, cc.y/cc.z form the diagonal
    float dL3 = (cc.y + cc.z) * 0.5;
    float dD3 = cc.z - cc.y;
    float dC3 = abs(dD3);
    float dH3 = cc.x * 0.5;
    if (dD3 < 0.0) dH3 += 0.5;
    cc = vec3(dH3, dC3, dL3);
  #endif

  #ifdef INVERT_X
    cc.x = 1.0 - cc.x;
  #endif

  #ifdef INVERT_Y
    cc.y = 1.0 - cc.y;
  #endif

  #ifdef INVERT_Z
    cc.z = 1.0 - cc.z;
  #endif

  vec3 rgb = modelToRGB(cc);

  #ifdef GAMUT_CLIP
    if (any(lessThan(rgb, vec3(-0.0))) || any(greaterThan(rgb, vec3(1.0)))) discard;
  #endif

  #ifdef SHOW_RAW
    fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
  #else
    fragColor = vec4(closestColor(clamp(rgb, 0.0, 1.0), paletteTexture), 1.0);
  #endif
}`;

const mainSrc3DPrepass = `
void main() {
  vec3 cc = vColorCoord;

  #ifdef IS_POLAR
    float hue = atan(cc.z, cc.x) / TWO_PI;
    if (hue < 0.0) hue += 1.0;
    float r = length(cc.xz) * 2.0;
    float h = cc.y + 0.5;
    #ifdef SHAPE_CONE
      if (h < 0.0 || h > uPosition || r > h) discard;
    #elif defined(SHAPE_CONE_INV)
      if (h < 0.0 || h > uPosition || r > 1.0 - h) discard;
    #elif defined(SHAPE_BICONE)
      if (h < 0.0 || h > uPosition || r > 1.0 - abs(2.0 * h - 1.0)) discard;
    #else
      if (h < 0.0 || h > uPosition || r > 1.0) discard;
    #endif
    cc = vec3(hue, r, h);
  #else
    #ifdef GAMUT_CLIP
      if (any(lessThan(cc, vec3(0.0))) || any(greaterThan(cc, vec3(1.0)))) discard;
    #endif
    if (cc.x > uPosition) discard;
  #endif

  #if COLOR_MODEL == 29
    float dL3p = (cc.y + cc.z) * 0.5;
    float dD3p = cc.z - cc.y;
    float dC3p = abs(dD3p);
    float dH3p = cc.x * 0.5;
    if (dD3p < 0.0) dH3p += 0.5;
    cc = vec3(dH3p, dC3p, dL3p);
  #endif

  #ifdef INVERT_X
    cc.x = 1.0 - cc.x;
  #endif

  #ifdef INVERT_Y
    cc.y = 1.0 - cc.y;
  #endif

  #ifdef INVERT_Z
    cc.z = 1.0 - cc.z;
  #endif

  #ifdef GAMUT_CLIP
    vec3 rgb = modelToRGB(cc);
    if (any(lessThan(rgb, vec3(-0.0))) || any(greaterThan(rgb, vec3(1.0)))) discard;
  #endif

  fragColor = vec4(1.0);
}`;

export function assembleFragShader3D(
  colorModel: number,
  distanceMetric: number,
  showRaw: boolean,
): string {
  const needs = resolveNeeds(colorModel, distanceMetric, showRaw);
  let src = `
precision highp float;
#define TWO_PI 6.28318530718
in vec3 vColorCoord;
out vec4 fragColor;
uniform sampler2D paletteTexture;
uniform float uPosition;
`;
  src += assembleChunks(needs);
  src += modelToRGBSrc + mainSrc3D;
  return src;
}

export function assembleFragShader3DPrepass(colorModel: number, gamutClip: boolean): string {
  const needs = {
    ...resolveNeeds(colorModel, 0, true),
    closestColor: false,
  };
  let src = `
precision highp float;
#define TWO_PI 6.28318530718
in vec3 vColorCoord;
out vec4 fragColor;
uniform float uPosition;
`;
  src += assembleChunks(needs);
  if (gamutClip) src += modelToRGBSrc;
  src += mainSrc3DPrepass;
  return src;
}

// Pass-2 shader: reads from the FBO color texture, detects edges by comparing
// N/S/E/W neighbors. Only opaque neighbors (a>0) participate in the comparison
// so polar-disc edges don't bleed into the outline.
export const outlineFragmentShaderSrc = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D colorMap;
uniform float outlineWidth;
uniform vec2 resolution;

void main() {
  vec4 center = texture(colorMap, vUv);
  if (center.a == 0.0) { fragColor = vec4(0.0); return; }
  vec2 px = outlineWidth / resolution;
  vec4 n0 = texture(colorMap, vUv + vec2( px.x, 0.0));
  vec4 n1 = texture(colorMap, vUv + vec2(-px.x, 0.0));
  vec4 n2 = texture(colorMap, vUv + vec2(0.0,  px.y));
  vec4 n3 = texture(colorMap, vUv + vec2(0.0, -px.y));
  if ((n0.a > 0.0 && any(notEqual(n0.rgb, center.rgb))) ||
      (n1.a > 0.0 && any(notEqual(n1.rgb, center.rgb))) ||
      (n2.a > 0.0 && any(notEqual(n2.rgb, center.rgb))) ||
      (n3.a > 0.0 && any(notEqual(n3.rgb, center.rgb)))) {
    fragColor = vec4(0.0);
    return;
  }
  fragColor = center;
}`;
