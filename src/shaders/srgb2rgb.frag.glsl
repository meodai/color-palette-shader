// https://lygia.xyz/
float srgb2rgb(const in float v) {   return (v < 0.04045) ? v * 0.0773993808 : pow((v + 0.055) * 0.947867298578199, 2.4); }
vec3 srgb2rgb(const in vec3 srgb) {  return vec3(srgb2rgb(srgb.r), srgb2rgb(srgb.g), srgb2rgb(srgb.b)); }
vec4 srgb2rgb(const in vec4 srgb) {  return vec4(srgb2rgb(srgb.rgb), srgb.a); }
