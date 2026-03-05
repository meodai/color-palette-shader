// OKLrab: OKLab with toe-corrected lightness (Lr)
// Requires: oklab_to_linear_srgb, srgb_transfer_function (from oklab.frag.glsl)
//
// Forward toe: L → Lr  (used for distance comparisons)
float oklrab_toe(float x) {
  const float k1 = 0.206;
  const float k2 = 0.03;
  const float k3 = (1.0 + k1) / (1.0 + k2);
  return (x * x + k1 * x) / (k3 * (x + k2));
}

// Inverse toe: Lr → L  (used for color model rendering)
// Quadratic solve of the forward toe equation.
float oklrab_toe_inv(float x) {
  const float k1 = 0.206;
  const float k2 = 0.03;
  const float k3 = (1.0 + k1) / (1.0 + k2);
  float b = k1 - x * k3;
  return (-b + sqrt(b * b + 4.0 * k2 * x * k3)) * 0.5;
}
