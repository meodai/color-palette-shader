#define M_PI 3.1415926535897932384626433832795
float transfer(float v) {
    return v <= 0.0031308 ? 12.92 * v : 1.055 *pow(v, 0.4166666666666667) - 0.055;
}

vec3 transfer(vec3 v) {
    return vec3(transfer(v.x), transfer(v.y), transfer(v.z));
}

vec3 hcl2rgb(vec3 hcl) {
    hcl.y *= 0.33;
    
    vec3 lab = vec3(
        hcl.z,
        hcl.y * cos(hcl.x * M_PI*2.0),
        hcl.y * sin(hcl.x * M_PI*2.0)
    );
    
    vec3 lms = vec3(
        lab.x + 0.3963377774f * lab.y + 0.2158037573f * lab.z,
        lab.x - 0.1055613458f * lab.y - 0.0638541728f * lab.z,
        lab.x - 0.0894841775f * lab.y - 1.2914855480f * lab.z
    );
    
    lms = pow(max(lms, vec3(0.0)), vec3(3.0));
    
    vec3 rgb = vec3(
        +4.0767416621f * lms.x - 3.3077115913f * lms.y + 0.2309699292f * lms.z,
        -1.2684380046f * lms.x + 2.6097574011f * lms.y - 0.3413193965f * lms.z,
        -0.0041960863f * lms.x - 0.7034186147f * lms.y + 1.7076147010f * lms.z
    );
     
    rgb = transfer(rgb);
    
    if (any(lessThan(rgb, vec3(0.0))) || any(greaterThan(rgb, vec3(1.0)))) {
        rgb = vec3(0.5);
    }

    return rgb;
}