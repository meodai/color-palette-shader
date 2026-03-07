// slightly rearranged vector components so it matches with LCH
// M_PI and srgb_transfer_function are provided by oklab.frag.glsl (included before this file)
vec3 lch2rgb(vec3 lch) {
    lch.y *= 0.34;

    vec3 lab = vec3(
        lch.x,
        lch.y * cos(lch.z * M_PI*2.0),
        lch.y * sin(lch.z * M_PI*2.0)
    );

    vec3 lms = vec3(
        lab.x + 0.3963377774f * lab.y + 0.2158037573f * lab.z,
        lab.x - 0.1055613458f * lab.y - 0.0638541728f * lab.z,
        lab.x - 0.0894841775f * lab.y - 1.2914855480f * lab.z
    );

    lms = lms * lms * lms;

    vec3 rgb = vec3(
        +4.0767416621f * lms.x - 3.3077115913f * lms.y + 0.2309699292f * lms.z,
        -1.2684380046f * lms.x + 2.6097574011f * lms.y - 0.3413193965f * lms.z,
        -0.0041960863f * lms.x - 0.7034186147f * lms.y + 1.7076147010f * lms.z
    );

    return vec3(
        srgb_transfer_function(rgb.r),
        srgb_transfer_function(rgb.g),
        srgb_transfer_function(rgb.b)
    );
}
