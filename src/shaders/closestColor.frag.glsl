// DISTANCE_METRIC define: 0=rgb, 1=oklab, 2=deltaE76, 3=deltaE2000, 4=kotsarenkoRamos, 5=deltaE94
vec3 closestColor(vec3 color, sampler2D paletteTexture) {
  int paletteSize = textureSize(paletteTexture, 0).x;
  float minDist = 1000000.0;
  vec3 closest = vec3(0.0);

  // Pre-convert the input color once — palette entries are converted inside the loop.
  #if DISTANCE_METRIC == 1
    vec3 colorConverted = linear_srgb_to_oklab(srgb2rgb(color));
  #elif DISTANCE_METRIC == 2 || DISTANCE_METRIC == 3 || DISTANCE_METRIC == 5
    vec3 colorConverted = srgb_to_cielab(color);
  #else
    vec3 colorConverted = color;
  #endif

  for (int i = 0; i < paletteSize; i++) {
    vec3 paletteColor = texelFetch(paletteTexture, ivec2(i, 0), 0).rgb;

    float dist;
    #if DISTANCE_METRIC == 1
      dist = distance(colorConverted, linear_srgb_to_oklab(srgb2rgb(paletteColor)));
    #elif DISTANCE_METRIC == 2
      dist = deltaE76(colorConverted, srgb_to_cielab(paletteColor));
    #elif DISTANCE_METRIC == 3
      dist = deltaE2000(colorConverted, srgb_to_cielab(paletteColor));
    #elif DISTANCE_METRIC == 4
      dist = kotsarenkoRamos(color, paletteColor);
    #elif DISTANCE_METRIC == 5
      dist = deltaE94(colorConverted, srgb_to_cielab(paletteColor));
    #else
      dist = distance(colorConverted, paletteColor);
    #endif

    if (dist < minDist) {
      minDist = dist;
      closest = paletteColor;
    }
  }

  return closest;
}
