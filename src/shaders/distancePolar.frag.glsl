float distancePolar(vec3 c0, vec3 c1) {
    float h0 = c0.x;
    float s0 = c0.y;
    float v0 = c0.z;
    float h1 = c1.x;
    float s1 = c1.y;
    float v1 = c1.z;

    float dh = min(abs(h1-h0), 1-abs(h1-h0)) / .5;
    float ds = abs(s1-s0);
    float dv = abs(v1-v0);

    return sqrt(dh*dh+ds*ds+dv*dv);
}