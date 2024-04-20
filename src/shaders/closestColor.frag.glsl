vec3 closestColor(vec3 color, sampler2D paletteTexture, int paletteSize) {
  float minDist = 1000000.0;
  vec3 closestColor = vec3(0.0);

  for (int i = 0; i < paletteSize; i++) {
    // Sample color from the texture
    vec3 paletteColor = texture2D(paletteTexture, vec2(float(i) / float(paletteSize), 0.5)).rgb;

    // Calculate distance between the sampled color and the input color
    float dist;
    if (isPerceptional) {
      dist = distance(linear_srgb_to_oklab(srgb2rgb(color)), linear_srgb_to_oklab(srgb2rgb(paletteColor)));
    } else {
      dist = distance(color, paletteColor);
    }

    // Update closest color if the distance is smaller
    if (dist < minDist) {
      minDist = dist;
      closestColor = paletteColor;
    }
  }

  return closestColor;
}