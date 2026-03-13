#ifndef M_PI
#define M_PI 3.1415926535897932384626433832795
#endif

const float CAM16_SC = 0.59;
const float CAM16_SN_C = 0.9;
const float CAM16_D_R = 1.0187728717648556;
const float CAM16_D_G = 0.9878630004321435;
const float CAM16_D_B = 0.941466578136544;
const float CAM16_F_L = 0.2731305366732074;
const float CAM16_N = 0.2;
const float CAM16_Z = 1.9272135954999579;
const float CAM16_N_BB = 1.0003040045593807;
const float CAM16_N_CB = 1.0003040045593807;
const float CAM16_A_W = 25.510345681082327;
const float CAM16_INV_CAT16_00 = 1.8620678550872327;
const float CAM16_INV_CAT16_01 = -1.0112546305316843;
const float CAM16_INV_CAT16_02 = 0.14918677544445175;
const float CAM16_INV_CAT16_10 = 0.3875265432361371;
const float CAM16_INV_CAT16_11 = 0.6214474419314753;
const float CAM16_INV_CAT16_12 = -0.00897398516761252;
const float CAM16_INV_CAT16_20 = -0.015841498849333856;
const float CAM16_INV_CAT16_21 = -0.03412293802851556;
const float CAM16_INV_CAT16_22 = 1.0499644368778493;
const float CAM16_MAX_JP = 100.0;
const float CAM16_MAX_AB = 50.0;

float cam16_adapt_component(float value) {
  float base = CAM16_F_L * abs(value) / 100.0;
  float power = pow(base, 0.42);
  return 400.0 * sign(value) * power / (power + 27.13) + 0.1;
}

float cam16_unadapt_component(float value) {
  float delta = abs(value - 0.1);
  return sign(value - 0.1)
    * 100.0
    / CAM16_F_L
    * pow((27.13 * delta) / max(400.0 - delta, 1e-6), 1.0 / 0.42);
}

vec3 xyz_to_cam16ucs(vec3 xyz) {
  float R = 0.401288 * xyz.x + 0.650173 * xyz.y - 0.051461 * xyz.z;
  float G = -0.250268 * xyz.x + 1.204414 * xyz.y + 0.045854 * xyz.z;
  float B = -0.002079 * xyz.x + 0.048952 * xyz.y + 0.953127 * xyz.z;

  float R_c = R * CAM16_D_R;
  float G_c = G * CAM16_D_G;
  float B_c = B * CAM16_D_B;

  float R_a = cam16_adapt_component(R_c);
  float G_a = cam16_adapt_component(G_c);
  float B_a = cam16_adapt_component(B_c);

  float a = R_a - 12.0 * G_a / 11.0 + B_a / 11.0;
  float b = (R_a + G_a - 2.0 * B_a) / 9.0;

  float h = atan(b, a) / TWO_PI;
  if (h < 0.0) h += 1.0;
  float hDeg = h * 360.0;
  float hh = hDeg + (hDeg < 20.14 ? 360.0 : 0.0);

  float e_t = 0.25 * (cos(hh / 180.0 * M_PI + 2.0) + 3.8);
  float A = CAM16_N_BB * (2.0 * R_a + G_a + 0.05 * B_a - 0.305);
  float J = 100.0 * pow(max(A / CAM16_A_W, 0.0), CAM16_SC * CAM16_Z);
  float denom = R_a + G_a + 21.0 / 20.0 * B_a;
  float t = denom == 0.0
    ? 0.0
    : (50000.0 / 13.0 * CAM16_SN_C * CAM16_N_CB * e_t * length(vec2(a, b))) / denom;
  float C = pow(max(t, 0.0), 0.9) * sqrt(max(J, 0.0) / 100.0) * pow(1.64 - pow(0.29, CAM16_N), 0.73);
  float M = C * pow(CAM16_F_L, 0.25);
  float Jp = J * 1.7 / (1.0 + 0.007 * J);
  float Mp = log(1.0 + 0.0228 * M) / 0.0228;
  float hRad = hDeg / 180.0 * M_PI;

  return vec3(Jp, Mp * cos(hRad), Mp * sin(hRad));
}

vec3 srgb_to_cam16ucs(vec3 srgb) {
  vec3 lin = srgb2rgb(srgb);
  vec3 xyz = vec3(
    0.4124564 * lin.r + 0.3575761 * lin.g + 0.1804375 * lin.b,
    0.2126729 * lin.r + 0.7151522 * lin.g + 0.0721750 * lin.b,
    0.0193339 * lin.r + 0.1191920 * lin.g + 0.9503041 * lin.b
  ) * 100.0;
  return xyz_to_cam16ucs(xyz);
}

vec3 cam16ucs_to_xyz(vec3 jab) {
  float Jp = clamp(jab.x, 0.0, CAM16_MAX_JP);
  float ap = jab.y;
  float bp = jab.z;

  float J = Jp / max(1.7 - 0.007 * Jp, 1e-6);
  // J=0 is always black regardless of a'/b'; non-zero a'/b' at J=0 cause
  // t to blow up (divides by sqrt(J/100)~0) producing garbage XYZ.
  if (J < 1e-4) return vec3(0.0);

  float Mp = length(vec2(ap, bp));
  float M = (exp(0.0228 * Mp) - 1.0) / 0.0228;
  float C = M / pow(CAM16_F_L, 0.25);

  float hRad = atan(bp, ap);
  float hDeg = degrees(hRad);
  if (hDeg < 0.0) hDeg += 360.0;
  float hh = hDeg + (hDeg < 20.14 ? 360.0 : 0.0);

  float t = pow(
    C / (sqrt(J / 100.0) * pow(1.64 - pow(0.29, CAM16_N), 0.73)),
    1.0 / 0.9
  );
  float e_t = 0.25 * (cos(hh / 180.0 * M_PI + 2.0) + 3.8);
  float A = CAM16_A_W * pow(J / 100.0, 1.0 / (CAM16_SC * CAM16_Z));
  float P1 = ((50000.0 / 13.0) * CAM16_SN_C * CAM16_N_CB * e_t) / max(t, 1e-6);
  float P2 = A / CAM16_N_BB + 0.305;
  float P3 = 21.0 / 20.0;

  float sin_h = sin(hRad);
  float cos_h = cos(hRad);
  float n = P2 * (2.0 + P3) * (460.0 / 1403.0);
  float a = 0.0;
  float b = 0.0;

  if (t > 0.0) {
    if (abs(sin_h) >= abs(cos_h)) {
      float safeSin = abs(sin_h) < 1e-6 ? (sin_h < 0.0 ? -1e-6 : 1e-6) : sin_h;
      float P4 = P1 / safeSin;
      b = n / (
        P4 + (2.0 + P3) * (220.0 / 1403.0) * (cos_h / safeSin)
        - (27.0 / 1403.0)
        + P3 * (6300.0 / 1403.0)
      );
      a = b * (cos_h / safeSin);
    } else {
      float safeCos = abs(cos_h) < 1e-6 ? (cos_h < 0.0 ? -1e-6 : 1e-6) : cos_h;
      float P5 = P1 / safeCos;
      a = n / (
        P5 + (2.0 + P3) * (220.0 / 1403.0)
        - ((27.0 / 1403.0) - P3 * (6300.0 / 1403.0)) * (sin_h / safeCos)
      );
      b = a * (sin_h / safeCos);
    }
  }

  vec3 rgb_a = vec3(
    (460.0 * P2 + 451.0 * a + 288.0 * b) / 1403.0,
    (460.0 * P2 - 891.0 * a - 261.0 * b) / 1403.0,
    (460.0 * P2 - 220.0 * a - 6300.0 * b) / 1403.0
  );

  vec3 rgb_c = vec3(
    cam16_unadapt_component(rgb_a.r),
    cam16_unadapt_component(rgb_a.g),
    cam16_unadapt_component(rgb_a.b)
  );
  vec3 rgb = vec3(rgb_c.r / CAM16_D_R, rgb_c.g / CAM16_D_G, rgb_c.b / CAM16_D_B);

  return vec3(
    CAM16_INV_CAT16_00 * rgb.r + CAM16_INV_CAT16_01 * rgb.g + CAM16_INV_CAT16_02 * rgb.b,
    CAM16_INV_CAT16_10 * rgb.r + CAM16_INV_CAT16_11 * rgb.g + CAM16_INV_CAT16_12 * rgb.b,
    CAM16_INV_CAT16_20 * rgb.r + CAM16_INV_CAT16_21 * rgb.g + CAM16_INV_CAT16_22 * rgb.b
  );
}

vec3 xyz_to_srgb(vec3 xyz) {
  vec3 lin = vec3(
    3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z,
    -0.9692660 * xyz.x + 1.8760108 * xyz.y + 0.0415560 * xyz.z,
    0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z
  ) / 100.0;
  return vec3(
    srgb_transfer_function(lin.r),
    srgb_transfer_function(lin.g),
    srgb_transfer_function(lin.b)
  );
}

vec3 cam16ucs_to_srgb(vec3 jab) {
  return xyz_to_srgb(cam16ucs_to_xyz(jab));
}