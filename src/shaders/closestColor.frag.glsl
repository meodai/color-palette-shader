// distanceMetric uniform: 0 = rgb, 1 = oklab, 2 = deltaE76, 3 = deltaE2000
vec3 closestColor(vec3 color, sampler2D paletteTexture, int paletteSize) {
  float minDist = 1000000.0;
  vec3 closest = vec3(0.0);

  for (int i = 0; i < paletteSize; i++) {
    vec3 paletteColor = texture2D(paletteTexture, vec2(float(i) / float(paletteSize), 0.5)).rgb;

    float dist;
    if (distanceMetric == 1) {
      // OKLab: perceptually uniform Euclidean distance
      dist = distance(linear_srgb_to_oklab(srgb2rgb(color)), linear_srgb_to_oklab(srgb2rgb(paletteColor)));
    } else if (distanceMetric == 2) {
      // CIE76: Euclidean distance in CIELab
      dist = deltaE76(srgb_to_cielab(color), srgb_to_cielab(paletteColor));
    } else if (distanceMetric == 3) {
      // CIEDE2000: perceptually weighted color difference
      dist = deltaE2000(srgb_to_cielab(color), srgb_to_cielab(paletteColor));
    } else {
      // RGB: plain Euclidean distance in sRGB space
      dist = distance(color, paletteColor);
    }

    if (dist < minDist) {
      minDist = dist;
      closest = paletteColor;
    }
  }

  return closest;
}
