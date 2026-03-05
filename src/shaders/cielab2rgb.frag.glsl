// CIELab → sRGB conversions (D65 and D50)
// Requires: srgb_transfer_function from oklab.frag.glsl
//
// Inverse of the CIELab f() function
float _cielab_finv(float t) {
  const float delta = 6.0 / 29.0;
  return t > delta
    ? t * t * t
    : 3.0 * delta * delta * (t - 4.0 / 29.0);
}

// CIELab (D65) → sRGB
// L: [0,100], a,b: typically [-128,128]
vec3 cielab_d65_to_rgb(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  vec3 fxyz = vec3(lab.y / 500.0 + fy, fy, fy - lab.z / 200.0);
  vec3 xyz = vec3(
    _cielab_finv(fxyz.x) * 0.95047,
    _cielab_finv(fxyz.y) * 1.00000,
    _cielab_finv(fxyz.z) * 1.08883
  );
  // XYZ (D65) → linear sRGB
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

// CIELab (D50) → sRGB
// L: [0,100], a,b: typically [-128,128]
vec3 cielab_d50_to_rgb(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  vec3 fxyz = vec3(lab.y / 500.0 + fy, fy, fy - lab.z / 200.0);
  vec3 xyz = vec3(
    _cielab_finv(fxyz.x) * 0.96422,
    _cielab_finv(fxyz.y) * 1.00000,
    _cielab_finv(fxyz.z) * 0.82521
  );
  // XYZ (D50) → linear sRGB (includes Bradford chromatic adaptation back to D65)
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
