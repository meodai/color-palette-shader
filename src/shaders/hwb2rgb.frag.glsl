// HWB (Hue-Whiteness-Blackness) to sRGB
// c.x = hue [0,1], c.y = whiteness [0,1], c.z = blackness [0,1]
vec3 hwb2rgb(vec3 c) {
  float wb = c.y + c.z;
  if (wb >= 1.0) return vec3(c.y / max(wb, 1e-7)); // achromatic grey
  // Pure hue (hsv with s=1, v=1) inlined to avoid full hsv2rgb call
  vec3 hue = clamp(abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return hue * (1.0 - wb) + c.y;
}
