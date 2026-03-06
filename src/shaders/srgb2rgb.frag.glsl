// sRGB→linear using srgb_transfer_function_inv from oklab.frag.glsl (included before this file)
vec3 srgb2rgb(const in vec3 srgb) { return vec3(srgb_transfer_function_inv(srgb.r), srgb_transfer_function_inv(srgb.g), srgb_transfer_function_inv(srgb.b)); }
vec4 srgb2rgb(const in vec4 srgb) { return vec4(srgb2rgb(srgb.rgb), srgb.a); }
