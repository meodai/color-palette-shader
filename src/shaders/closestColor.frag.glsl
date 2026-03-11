// DISTANCE_METRIC define: 0=rgb, 1=oklab, 2=deltaE76, 3=deltaE2000, 4=kotsarenkoRamos, 5=deltaE94, 6=oklrab, 7=cielabD50, 8=okLightness

uniform sampler2D paletteMetricTexture;
uniform int uPaletteSize;

vec3 closestColor(vec3 color, sampler2D paletteTexture) {
  float minDist = 1000000.0;
  vec3 closest = vec3(0.0);

  // Pre-convert the input color once (palette entries pre-converted on CPU).
  #if DISTANCE_METRIC == 1
    vec3 colorConverted = linear_srgb_to_oklab(srgb2rgb(color));
  #elif DISTANCE_METRIC == 6
    vec3 _lab6 = linear_srgb_to_oklab(srgb2rgb(color));
    vec3 colorConverted = vec3(toe(_lab6.x), _lab6.y, _lab6.z);
  #elif DISTANCE_METRIC == 7
    vec3 colorConverted = srgb_to_cielab_d50(color);
  #elif DISTANCE_METRIC == 8
    vec3 colorConverted = linear_srgb_to_oklab(srgb2rgb(color));
  #elif DISTANCE_METRIC == 2 || DISTANCE_METRIC == 3 || DISTANCE_METRIC == 5
    vec3 colorConverted = srgb_to_cielab(color);
  #else
    vec3 colorConverted = color;
  #endif

  for (int i = 0; i < uPaletteSize; i++) {
    vec3 paletteColor = texelFetch(paletteTexture, ivec2(i, 0), 0).rgb;

    float dist;
    #if DISTANCE_METRIC == 3
      dist = deltaE2000(colorConverted, texelFetch(paletteMetricTexture, ivec2(i, 0), 0).rgb);
    #elif DISTANCE_METRIC == 4
      dist = kotsarenkoRamos(color, paletteColor);
    #elif DISTANCE_METRIC == 5
      dist = deltaE94(colorConverted, texelFetch(paletteMetricTexture, ivec2(i, 0), 0).rgb);
    #elif DISTANCE_METRIC == 8
      dist = abs(colorConverted.x - texelFetch(paletteMetricTexture, ivec2(i, 0), 0).x);
    #else
      dist = distance(colorConverted, texelFetch(paletteMetricTexture, ivec2(i, 0), 0).rgb);
    #endif

    if (dist < minDist) {
      minDist = dist;
      closest = paletteColor;
    }
  }

  return closest;
}
