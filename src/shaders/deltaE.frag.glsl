#ifndef M_PI
#define M_PI 3.1415926535897932384626433832795
#endif

// Kotsarenko/Ramos weighted RGB distance.
// Operates on sRGB values directly (no linearisation needed).
// Weights red and blue channels by the mean red value, which improves
// perceptual uniformity compared to plain Euclidean RGB at minimal cost.
float kotsarenkoRamos(vec3 c1, vec3 c2) {
    float rMean = (c1.r + c2.r) * 0.5;
    vec3 d = c1 - c2;
    return sqrt((2.0 + rMean) * d.r*d.r + 4.0 * d.g*d.g + (3.0 - rMean) * d.b*d.b);
}

// srgb_to_cielab / srgb_to_cielab_d50 live in cielab2rgb.frag.glsl (included before this file)

// CIE76: plain Euclidean distance in CIELab
float deltaE76(vec3 lab1, vec3 lab2) {
    return distance(lab1, lab2);
}

// CIE94: weighted chroma/hue corrections, cheaper than CIEDE2000
// Uses graphics application constants: kL=1, K1=0.045, K2=0.015
float deltaE94(vec3 lab1, vec3 lab2) {
    float dL = lab1.x - lab2.x;
    float da = lab1.y - lab2.y;
    float db = lab1.z - lab2.z;
    float C1 = sqrt(lab1.y * lab1.y + lab1.z * lab1.z);
    float C2 = sqrt(lab2.y * lab2.y + lab2.z * lab2.z);
    float dC = C1 - C2;
    float dH = sqrt(max(0.0, da*da + db*db - dC*dC));
    float SC = 1.0 + 0.045 * C1;
    float SH = 1.0 + 0.015 * C1;
    return sqrt(dL*dL + (dC/SC)*(dC/SC) + (dH/SH)*(dH/SH));
}

// CIEDE2000
float deltaE2000(vec3 lab1, vec3 lab2) {
    float L1 = lab1.x, a1 = lab1.y, b1 = lab1.z;
    float L2 = lab2.x, a2 = lab2.y, b2 = lab2.z;

    // Chroma
    float C1 = sqrt(a1*a1 + b1*b1);
    float C2 = sqrt(a2*a2 + b2*b2);
    float Cavg = (C1 + C2) * 0.5;
    float Cavg7 = pow(Cavg, 7.0);

    // G factor: adjustment to a* axis
    float G = 0.5 * (1.0 - sqrt(Cavg7 / (Cavg7 + 6103515625.0))); // 25^7

    float a1p = a1 * (1.0 + G);
    float a2p = a2 * (1.0 + G);
    float C1p = sqrt(a1p*a1p + b1*b1);
    float C2p = sqrt(a2p*a2p + b2*b2);

    // Guard atan(0,0): GLSL ES leaves that undefined, so skip it for achromatic colors.
    // When a color has no chroma its hue angle is meaningless — we just need it to
    // be a well-defined number so it doesn't corrupt the rest of the formula.
    bool c1Achromatic = C1p < 1e-6;
    bool c2Achromatic = C2p < 1e-6;

    float h1p = c1Achromatic ? 0.0 : atan(b1, a1p);
    if (h1p < 0.0) h1p += TWO_PI;
    float h2p = c2Achromatic ? 0.0 : atan(b2, a2p);
    if (h2p < 0.0) h2p += TWO_PI;

    // Deltas
    float dLp = L2 - L1;
    float dCp = C2p - C1p;

    float dhp = 0.0;
    if (!c1Achromatic && !c2Achromatic) {
        dhp = h2p - h1p;
        if      (dhp >  M_PI) dhp -= TWO_PI;
        else if (dhp < -M_PI) dhp += TWO_PI;
    }
    float dHp = 2.0 * sqrt(C1p * C2p) * sin(dhp * 0.5);

    // Averages
    float Lp = (L1 + L2) * 0.5;
    float Cp = (C1p + C2p) * 0.5;

    // When one color is achromatic, its hue is 0 and the average is simply the other's hue
    float hp;
    if (c1Achromatic || c2Achromatic) {
        hp = h1p + h2p;
    } else if (abs(h1p - h2p) <= M_PI) {
        hp = (h1p + h2p) * 0.5;
    } else if (h1p + h2p < TWO_PI) {
        hp = (h1p + h2p + TWO_PI) * 0.5;
    } else {
        hp = (h1p + h2p - TWO_PI) * 0.5;
    }

    float T = 1.0
        - 0.17 * cos(hp - radians(30.0))
        + 0.24 * cos(2.0 * hp)
        + 0.32 * cos(3.0 * hp + radians(6.0))
        - 0.20 * cos(4.0 * hp - radians(63.0));

    // Weighting functions
    float Lpm50sq = (Lp - 50.0) * (Lp - 50.0);
    float SL = 1.0 + 0.015 * Lpm50sq / sqrt(20.0 + Lpm50sq);
    float SC = 1.0 + 0.045 * Cp;
    float SH = 1.0 + 0.015 * Cp * T;

    // Rotation term
    float Cp7 = pow(Cp, 7.0);
    float RC = 2.0 * sqrt(Cp7 / (Cp7 + 6103515625.0));
    float hpDeg = degrees(hp);
    float dTheta = radians(30.0) * exp(-((hpDeg - 275.0) / 25.0) * ((hpDeg - 275.0) / 25.0));
    float RT = -sin(2.0 * dTheta) * RC;

    float dLn = dLp / SL;
    float dCn = dCp / SC;
    float dHn = dHp / SH;

    return sqrt(dLn*dLn + dCn*dCn + dHn*dHn + RT * dCn * dHn);
}
