// CIELab ↔ sRGB conversions (D65 and D50)
// Requires: srgb2rgb, srgb_transfer_function, cbrt from oklab.frag.glsl

// ── Shared Lab↔XYZ helpers ───────────────────────────────────────────────────

// Forward: t → f(t) used in XYZ→Lab encode
float _lab_f(float t) {
  const float delta = 6.0 / 29.0;
  return t > delta * delta * delta
    ? cbrt(t)
    : t / (3.0 * delta * delta) + 4.0 / 29.0;
}

// Inverse: f⁻¹(t) used in Lab→XYZ decode
float _cielab_finv(float t) {
  const float delta = 6.0 / 29.0;
  return t > delta
    ? t * t * t
    : 3.0 * delta * delta * (t - 4.0 / 29.0);
}

// Lab→XYZ, white-point-normalised
vec3 _lab_to_xyz(vec3 lab, vec3 white) {
  float fy = (lab.x + 16.0) / 116.0;
  return vec3(
    _cielab_finv(lab.y / 500.0 + fy) * white.x,
    _cielab_finv(fy)                  * white.y,
    _cielab_finv(fy - lab.z / 200.0)  * white.z
  );
}

// XYZ→Lab, white-point-normalised
vec3 _xyz_to_lab(vec3 xyz, vec3 white) {
  float fx = _lab_f(xyz.x / white.x);
  float fy = _lab_f(xyz.y / white.y);
  float fz = _lab_f(xyz.z / white.z);
  return vec3(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}

// ── sRGB → CIELab (forward, used by distance metrics and closestColor) ───────

// sRGB → CIELab D65
vec3 srgb_to_cielab(vec3 srgb) {
  vec3 lin = srgb2rgb(srgb);
  vec3 xyz = vec3(
    0.4124564 * lin.r + 0.3575761 * lin.g + 0.1804375 * lin.b,
    0.2126729 * lin.r + 0.7151522 * lin.g + 0.0721750 * lin.b,
    0.0193339 * lin.r + 0.1191920 * lin.g + 0.9503041 * lin.b
  );
  return _xyz_to_lab(xyz, vec3(0.95047, 1.0, 1.08883));
}

// sRGB → CIELab D50 (Bradford-adapted)
vec3 srgb_to_cielab_d50(vec3 srgb) {
  vec3 lin = srgb2rgb(srgb);
  vec3 xyz = vec3(
    0.4360747 * lin.r + 0.3850649 * lin.g + 0.1430804 * lin.b,
    0.2225045 * lin.r + 0.7168786 * lin.g + 0.0606169 * lin.b,
    0.0139322 * lin.r + 0.0971045 * lin.g + 0.7141733 * lin.b
  );
  return _xyz_to_lab(xyz, vec3(0.96422, 1.0, 0.82521));
}

// ── CIELab → sRGB (inverse, used by color models) ────────────────────────────

// CIELab D65 → sRGB  (L: [0,100], a,b: typically [-128,128])
vec3 cielab_d65_to_rgb(vec3 lab) {
  vec3 xyz = _lab_to_xyz(lab, vec3(0.95047, 1.0, 1.08883));
  vec3 lin = vec3(
     3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z,
    -0.9692660 * xyz.x + 1.8760108 * xyz.y + 0.0415560 * xyz.z,
     0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z
  );
  return clamp(vec3(
    srgb_transfer_function(lin.r),
    srgb_transfer_function(lin.g),
    srgb_transfer_function(lin.b)
  ), 0.0, 1.0);
}

// CIELab D50 → sRGB  (L: [0,100], a,b: typically [-128,128])
// XYZ→sRGB matrix includes Bradford chromatic adaptation back to D65
vec3 cielab_d50_to_rgb(vec3 lab) {
  vec3 xyz = _lab_to_xyz(lab, vec3(0.96422, 1.0, 0.82521));
  vec3 lin = vec3(
     3.1338561 * xyz.x - 1.6168667 * xyz.y - 0.4906146 * xyz.z,
    -0.9787684 * xyz.x + 1.9161415 * xyz.y + 0.0334540 * xyz.z,
     0.0719453 * xyz.x - 0.2289914 * xyz.y + 1.4052427 * xyz.z
  );
  return clamp(vec3(
    srgb_transfer_function(lin.r),
    srgb_transfer_function(lin.g),
    srgb_transfer_function(lin.b)
  ), 0.0, 1.0);
}
