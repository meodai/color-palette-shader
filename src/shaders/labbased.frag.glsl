// CIE Lab, Luv, LCh, JCh, Jab
// https://www.shadertoy.com/view/3dKyWm

#define diag3(v) mat3((v).x, 0.0, 0.0, 0.0, (v).y, 0.0, 0.0, 0.0, (v).z)
#define xy_to_XYZ(x, y) vec3(x/y, 1.0, (1.0 - x - y)/y)
#define xyY_to_XYZ(x, y, Y) vec3(Y/y*x, Y, Y/y*(1.0 - x - y))
#define xy_to_xyz(x, y) vec3(x, y, 1.0 - x - y)

const mat3 BFD = mat3(0.8951, -0.7502, 0.0389, 0.2664, 1.7135, -0.0685, -0.1614, 0.0367, 1.0296);

const vec3 D50 = xy_to_XYZ(0.34567, 0.35850);
const vec3 D65 = xy_to_XYZ(0.31271, 0.32902);
const mat3 D65_TO_D50 = inverse(BFD)*diag3((BFD*D50)/(BFD*D65))*BFD;

const mat3 sRGB = mat3(xy_to_XYZ(0.64, 0.33), xy_to_XYZ(0.30, 0.60), xy_to_XYZ(0.15, 0.06));
const mat3 sRGB_TO_XYZ_D65 = sRGB*diag3(inverse(sRGB)*D65);
const mat3 sRGB_TO_XYZ_D50 = D65_TO_D50*sRGB_TO_XYZ_D65;
const mat3 XYZ_D65_TO_sRGB = inverse(sRGB_TO_XYZ_D65);
const mat3 XYZ_D50_TO_sRGB = inverse(sRGB_TO_XYZ_D50);


// Lab / Luv / LCh
vec3 XYZ_to_Lab(vec3 XYZ, vec3 XYZw) {
    vec3 t = XYZ/XYZw;
    vec3 a = pow(t, vec3(1.0/3.0));
    vec3 b = 841.0/108.0*t + 4.0/29.0;
    vec3 c = mix(b, a, greaterThan(t, vec3(216.0/24389.0)));
    return vec3(1.16*c.y - 0.16, vec2(5.0, 2.0)*(c.xy - c.yz));
}

vec3 Lab_to_XYZ(vec3 Lab, vec3 XYZw) {
    float L = (Lab.x + 0.16)/1.16;
    vec3 t = vec3(L + Lab.y/5.0, L, L - Lab.z/2.0);
    vec3 a = pow(t, vec3(3.0));
    vec3 b = 108.0/841.0*(t - 4.0/29.0);
    return XYZw*mix(b, a, greaterThan(t, vec3(6.0/29.0)));
}

vec3 LCh_to_Lab(vec3 LCh) {
    return vec3(LCh.x, LCh.y*vec2(cos(LCh.z), sin(LCh.z)));
}

vec3 Lab_to_LCh(vec3 Lab) {
    return vec3(Lab.x, length(Lab.yz), atan(Lab.z, Lab.y));
}

vec3 sRGB_to_Lab(vec3 sRGB) {
    return XYZ_to_Lab(sRGB_TO_XYZ_D50*sRGB, D50);
}

vec3 Lab_to_sRGB(vec3 Lab) {
    return XYZ_D50_TO_sRGB*Lab_to_XYZ(Lab, D50);
}


// LCh(uv) ↔ Luv ↔ XYZ ↔ sRGB

#define XYZ_to_uv(XYZ) vec2(4.0, 9.0)*XYZ.xy/(XYZ.x + 15.0*XYZ.y + 3.0*XYZ.z)
#define xy_to_uv(xy) vec2(4.0, 9.0)*xy/(-2.0*xy.x + 12.0*xy.y + 3.0)
#define uv_to_xy(uv) vec2(9.0, 4.0)*uv/(6.0*uv.x - 16.0*uv.y + 12.0)

vec3 XYZ_to_Luv(vec3 XYZ, vec3 XYZw) {
    float Y = XYZ.y/XYZw.y;
    float L = Y > 216.0/24389.0 ? 1.16*pow(Y, 1.0/3.0) - 0.16 : 24389.0/2700.0*Y;
    return vec3(L, 13.0*L*(XYZ_to_uv(XYZ) - XYZ_to_uv(XYZw)));
}

vec3 Luv_to_XYZ(vec3 Luv, vec3 XYZw) {
	vec2 uv = Luv.yz/(13.0*Luv.x) + XYZ_to_uv(XYZw);
    float Y = Luv.x > 0.08 ? pow((Luv.x + 0.16)/1.16, 3.0) : 2700.0/24389.0*Luv.x;
    float X = (9.0*uv.x)/(4.0*uv.y);
    float Z = (12.0 - 3.0*uv.x - 20.0*uv.y)/(4.0*uv.y);
    return XYZw.y*vec3(Y*X, Y, Y*Z);
}

vec3 LCh_to_Luv(vec3 LCh) {
    return vec3(LCh.x, LCh.y*vec2(cos(LCh.z), sin(LCh.z)));
}

vec3 Luv_to_LCh(vec3 Luv) {
    return vec3(Luv.x, length(Luv.yz), atan(Luv.z, Luv.y));
}

vec3 sRGB_to_Luv(vec3 sRGB) {
    return XYZ_to_Luv(sRGB_TO_XYZ_D65*sRGB, D65);
}

vec3 Luv_to_sRGB(vec3 Luv) {
    return XYZ_D65_TO_sRGB*Luv_to_XYZ(Luv, D65);
}

vec3 sRGB_OETF(vec3 c) {
    vec3 a = 12.92*c;
    vec3 b = 1.055*pow(c, vec3(1.0/2.4)) - 0.055;
    return mix(a, b, greaterThan(c, vec3(0.00313066844250063)));
}

vec3 sRGB_EOTF(vec3 c) {
    vec3 a = c/12.92;
    vec3 b = pow((c + 0.055)/1.055, vec3(2.4));
    return mix(a, b, greaterThan(c, vec3(0.0404482362771082)));
}

// JCh / Jab
#define adapt_aux(x) pow(F_L*abs(x), vec3(0.42))
#define adapt(x) 400.0*sign(x)*adapt_aux(x)/(27.13 + adapt_aux(x))
#define unadapt(x) sign(x)/F_L*pow(27.13*abs(x)/(400.0 - abs(x)), vec3(1.0/0.42))

const mat3 M16 = mat3(
    +0.401288, -0.250268, -0.002079,
    +0.650173, +1.204414, +0.048952,
    -0.051461, +0.045854, +0.953127
);

// sRGB conditions, average surround
const vec3 XYZ_w = D65;
const float Y_w = XYZ_w.y;
const float Y_b = 0.2;
const float L_w = 64.0/radians(180.0);
const float L_A = L_w*Y_b/Y_w;
const float F = 1.0;
const float c = 0.69;
const float N_c = F;

// step 0*
const vec3 RGB_w = M16*XYZ_w;
const float D = 1.0; // clamp(F*(1.0 - 1.0/3.6*exp((-L_A - 42.0)/92.0)), 0.0, 1.0);
const vec3 D_RGB = D*(Y_w/RGB_w) + 1.0 - D;
const float k4 = pow(1.0/(5.0*L_A + 1.0), 4.0);
const float F_L = k4*L_A + 0.1*pow(1.0 - k4, 2.0)*pow(5.0*L_A, 1.0/3.0);
const float n = Y_b/Y_w;
const float z = 1.48 + sqrt(n);
const float N_bb = 0.725/pow(n, 0.2);
const float N_cb = N_bb;
const vec3 RGB_cw = D_RGB*RGB_w;
const vec3 RGB_aw = adapt(RGB_cw);
const float A_w = dot(vec3(2.0, 1.0, 0.05), RGB_aw)*N_bb;

vec3 XYZ_D65_to_CAM16(vec3 XYZ) {
    // step 1
    vec3 RGB = M16*XYZ;
    // step 2
    vec3 RGB_c = D_RGB*RGB;
    // step 3*
    vec3 RGB_a = adapt(RGB_c);
    // step 4*
    const mat3x4 m = 1.0/1980.0*mat3x4(
        3960.0, 1980.0, 220.0, 1980.0,
        1980.0, -2160.0, 220.0, 1980.0,
        99.0, 180.0, -440.0, 2079.0
    );
    vec4 aux = m*RGB_a; // p_2, a, b, u
    float h = atan(aux.z, aux.y);
    // step 5
    float e_t = 0.25*(cos(h + 2.0) + 3.8);
    // step 6*
    float A = aux.x*N_bb;
    // step 7
    float J = pow(A/A_w, c*z);
    // step 8
    // step 9*
    float t = 5e4/13.0*N_c*N_cb*e_t*length(aux.yz)/(aux.w + 0.305);
    float alpha = pow(t, 0.9)*pow(1.64 - pow(0.29, n), 0.73);
    float C = 0.01*alpha*sqrt(J);
    float M = C*pow(F_L, 0.25);
    return vec3(J, M, h);
}

vec3 CAM16_to_XYZ_D65(vec3 JMh) {
    // step 1
    // step 1-1
    // step 1-2*
    float C = JMh.y/pow(F_L, 0.25);
    float alpha = JMh.x == 0.0 ? JMh.x : 100.0*C/sqrt(JMh.x);
    float t = pow(alpha/pow(1.64 - pow(0.29, n), 0.73), 1.0/0.9);
    // step 1-3
    // step 2*
    float e_t = 0.25*(cos(JMh.z + 2.0) + 3.8);
    float A = A_w*pow(JMh.x, 1.0/(c*z));
    float p_1 = 5e4/13.0*N_c*N_cb*e_t;
    float p_2 = A/N_bb;
    // step 3*
    vec2 cs = vec2(cos(JMh.z), sin(JMh.z));
    float r = 23.0*(p_2 + 0.305)*t/(23.0*p_1 + t*dot(vec2(11.0, 108.0), cs));
    vec2 ab = r*cs;
    // step 4
    const mat3 m = 1.0/1403.0*mat3(
        460.0, 460.0, 460.0,
        451.0, -891.0, -220.0,
        288.0, -261.0, -6300.0
    );
    vec3 RGB_a = m*vec3(p_2, ab);
    // step 5*
    vec3 RGB_c = unadapt(RGB_a);
    // step 6
    vec3 RGB = RGB_c/D_RGB;
    // step 7
    return inverse(M16)*RGB;
}

vec3 XYZ_D65_to_CAM16_UCS(vec3 XYZ) {
    vec3 JMh = XYZ_D65_to_CAM16(XYZ);
    float J = 1.7*JMh.x/(1.0 + 0.7*JMh.x);
    float M = log(1.0 + 2.28*JMh.y)/2.28;
    return vec3(J, M, JMh.z);
}

vec3 CAM16_UCS_to_XYZ_D65(vec3 JMh) {
    float J = JMh.x/(1.0 - 0.7*(JMh.x - 1.0));
    float M = (exp(2.28*JMh.y) - 1.0)/2.28;
    return CAM16_to_XYZ_D65(vec3(J, M, JMh.z));
}

// Oklab

const mat3 M1 = mat3(
    +0.8189330101, +0.0329845436, +0.0482003018,
    +0.3618667424, +0.9293118715, +0.2643662691,
    -0.1288597137, +0.0361456387, +0.6338517070
);

const mat3 M2 = mat3(
    +0.2104542553, +1.9779984951, +0.0259040371,
    +0.7936177850, -2.4285922050, +0.7827717662,
    -0.0040720468, +0.4505937099, -0.8086757660
);

vec3 XYZ_to_okLab(vec3 XYZ) {
    vec3 lms = M1*XYZ;
    vec3 lms_p = sign(lms)*pow(abs(lms), vec3(1.0/3.0));
    return M2*lms_p;
}

vec3 okLab_to_XYZ(vec3 Lab) {
    vec3 lms_p = inverse(M2)*Lab;
    vec3 lms = lms_p*lms_p*lms_p;
    return inverse(M1)*lms;
}

vec3 okLCh_to_okLab(vec3 LCh) {
    return vec3(LCh.x, LCh.y*vec2(cos(LCh.z), sin(LCh.z)));
}

vec3 okLab_to_okLCh(vec3 Lab) {
    return vec3(Lab.x, length(Lab.yz), atan(Lab.z, Lab.y));
}

vec3 sRGB_to_okLab(vec3 sRGB) {
    return XYZ_to_okLab(sRGB_TO_XYZ_D65*sRGB);
}

vec3 okLab_to_sRGB(vec3 Lab) {
    return XYZ_D65_TO_sRGB*okLab_to_XYZ(Lab);
}

vec3 sRGB_to_okLCh(vec3 sRGB) {
    return okLab_to_okLCh(sRGB_to_okLab(sRGB));
}

vec3 okLCh_to_sRGB(vec3 LCh) {
    return okLab_to_sRGB(okLCh_to_okLab(LCh));
}

float L_to_Lr(float L) {
    const vec3 k = vec3(0.206, 0.03, 1.206/1.03);
    float x = k.z*L - k.x;
    return 0.5*(x + sqrt(x*x + 4.0*k.y*k.z*L));
}

float Lr_to_L(float Lr) {
    const vec3 k = vec3(0.206, 0.03, 1.206/1.03);
    return (Lr*(Lr + k.x))/(k.z*(Lr + k.y));
}