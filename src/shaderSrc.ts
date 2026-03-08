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
//   DISTANCE_METRIC  int  0=rgb 1=oklab 2=deltaE76(=cielabD65) 3=deltaE2000 4=kotsarenkoRamos 5=deltaE94 6=oklrab 7=cielabD50
//   COLOR_MODEL      int  0=rgb 1=oklab 2=okhsv 3=okhsvPolar 4=okhsl 5=okhslPolar
//                         6=oklch 7=oklchPolar 8=hsv 9=hsvPolar 10=hsl 11=hslPolar
//                         12=hwb 13=hwbPolar 14=oklrab 15=oklrch 16=oklrchPolar
//                         17=cielab 18=cielch 19=cielchPolar
//                         20=cielabD50 21=cielchD50 22=cielchD50Polar
//   PROGRESS_AXIS    int  0=x 1=y 2=z
//   INVERT_Z         flag (defined = true)
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
vec3 modelToRGB(vec3 colorCoords) {
  #if COLOR_MODEL == 0
    return colorCoords;
  #elif COLOR_MODEL == 1
    vec3 linear = oklab_to_linear_srgb(vec3(colorCoords.z, colorCoords.x - 0.5, colorCoords.y - 0.5));
    return vec3(srgb_transfer_function(linear.r), srgb_transfer_function(linear.g), srgb_transfer_function(linear.b));
  #elif COLOR_MODEL == 2 || COLOR_MODEL == 3
    return okhsv_to_srgb(colorCoords);
  #elif COLOR_MODEL == 4 || COLOR_MODEL == 5
    return okhsl_to_srgb(colorCoords);
  #elif COLOR_MODEL == 6 || COLOR_MODEL == 7
    return lch2rgb(vec3(colorCoords.z, colorCoords.y, colorCoords.x));
  #elif COLOR_MODEL == 8 || COLOR_MODEL == 9
    return hsv2rgb(colorCoords);
  #elif COLOR_MODEL == 10 || COLOR_MODEL == 11
    return hsl2rgb(colorCoords);
  #elif COLOR_MODEL == 12 || COLOR_MODEL == 13
    return hwb2rgb(colorCoords);
  #elif COLOR_MODEL == 14
    vec3 linear14 = oklab_to_linear_srgb(vec3(toe_inv(colorCoords.z), colorCoords.x - 0.5, colorCoords.y - 0.5));
    return vec3(srgb_transfer_function(linear14.r), srgb_transfer_function(linear14.g), srgb_transfer_function(linear14.b));
  #elif COLOR_MODEL == 15 || COLOR_MODEL == 16
    return lch2rgb(vec3(toe_inv(colorCoords.z), colorCoords.y, colorCoords.x));
  #elif COLOR_MODEL == 17
    return cielab_d65_to_rgb(vec3(colorCoords.z * 100.0, (colorCoords.x - 0.5) * 256.0, (colorCoords.y - 0.5) * 256.0));
  #elif COLOR_MODEL == 18 || COLOR_MODEL == 19
    return cielab_d65_to_rgb(vec3(colorCoords.z * 100.0, colorCoords.y * 150.0 * cos(colorCoords.x * TWO_PI), colorCoords.y * 150.0 * sin(colorCoords.x * TWO_PI)));
  #elif COLOR_MODEL == 20
    return cielab_d50_to_rgb(vec3(colorCoords.z * 100.0, (colorCoords.x - 0.5) * 256.0, (colorCoords.y - 0.5) * 256.0));
  #elif COLOR_MODEL == 21 || COLOR_MODEL == 22
    return cielab_d50_to_rgb(vec3(colorCoords.z * 100.0, colorCoords.y * 150.0 * cos(colorCoords.x * TWO_PI), colorCoords.y * 150.0 * sin(colorCoords.x * TWO_PI)));
  #else
    return colorCoords;
  #endif
}
`;

const mainSrc = `
void main(){
  #if PROGRESS_AXIS == 1
    vec3 colorCoords = vec3(vUv.x, progress, vUv.y);
  #elif PROGRESS_AXIS == 2
    vec3 colorCoords = vec3(vUv.x, vUv.y, 1. - progress);
  #else
    vec3 colorCoords = vec3(progress, vUv.x, vUv.y);
  #endif

  #if COLOR_MODEL == 3 || COLOR_MODEL == 5 || COLOR_MODEL == 7 || COLOR_MODEL == 9 || COLOR_MODEL == 11 || COLOR_MODEL == 16 || COLOR_MODEL == 19 || COLOR_MODEL == 22
    vec2 toCenter = vUv - 0.5;
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
      if (vUv.x > 0.5) { hue += 0.5; }
      colorCoords = vec3(hue, abs(0.5 - vUv.x) * 2.0, vUv.y);
    #endif
  #elif COLOR_MODEL == 13
    vec2 toCenter = vUv - 0.5;
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
      if (vUv.x > 0.5) { hue += 0.5; }
      colorCoords = vec3(hue, 1.0 - abs(0.5 - vUv.x) * 2.0, vUv.y);
    #endif
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
      return {}; // rgb
    case 1:
    case 14:
      return { oklab: true }; // oklab, oklrab
    case 2:
    case 3:
      return { oklab: true }; // okhsv, okhsvPolar
    case 4:
    case 5:
      return { oklab: true }; // okhsl, okhslPolar
    case 6:
    case 7:
    case 15:
    case 16:
      return { oklab: true, lch2rgb: true }; // oklch/oklrch + polar
    case 8:
    case 9:
      return { hsv2rgb: true }; // hsv, hsvPolar
    case 10:
    case 11:
      return { hsl2rgb: true }; // hsl, hslPolar
    case 12:
    case 13:
      return { hwb2rgb: true }; // hwb, hwbPolar
    case 17:
    case 18:
    case 19: // cielab, cielch, cielchPolar
      return { oklab: true, srgb2rgb: true, cielab2rgb: true };
    case 20:
    case 21:
    case 22: // cielabD50, cielchD50, cielchD50Polar
      return { oklab: true, srgb2rgb: true, cielab2rgb: true };
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
      return { oklab: true, srgb2rgb: true }; // oklab, oklrab
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
#endif

void main() {
  vec3 pos = a_position;
  #ifdef GAMUT_CLIP
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
