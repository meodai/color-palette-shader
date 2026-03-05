// HWB (Hue-Whiteness-Blackness) to sRGB
// c.x = hue [0,1], c.y = whiteness [0,1], c.z = blackness [0,1]
// Depends on hsv2rgb (must be included first).
vec3 hwb2rgb(vec3 c) {
  float wb = c.y + c.z;
  if (wb >= 1.0) return vec3(c.y / wb); // achromatic grey
  return hsv2rgb(vec3(c.x, 1.0, 1.0)) * (1.0 - wb) + c.y;
}
