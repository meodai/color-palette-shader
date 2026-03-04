// DISTANCE_METRIC define: 0=rgb, 1=oklab, 2=deltaE76, 3=deltaE2000, 4=kotsarenkoRamos
vec3 closestColor(vec3 color, sampler2D paletteTexture, int paletteSize) {
  float minDist = 1000000.0;
  vec3 closest = vec3(0.0);

  for (int i = 0; i < paletteSize; i++) {
    vec3 paletteColor = texture2D(paletteTexture, vec2(float(i) / float(paletteSize), 0.5)).rgb;

    float dist;
    #if DISTANCE_METRIC == 1
      dist = distance(linear_srgb_to_oklab(srgb2rgb(color)), linear_srgb_to_oklab(srgb2rgb(paletteColor)));
    #elif DISTANCE_METRIC == 2
      dist = deltaE76(srgb_to_cielab(color), srgb_to_cielab(paletteColor));
    #elif DISTANCE_METRIC == 3
      dist = deltaE2000(srgb_to_cielab(color), srgb_to_cielab(paletteColor));
    #elif DISTANCE_METRIC == 4
      dist = kotsarenkoRamos(color, paletteColor);
    #else
      dist = distance(color, paletteColor);
    #endif

    if (dist < minDist) {
      minDist = dist;
      closest = paletteColor;
    }
  }

  return closest;
}
