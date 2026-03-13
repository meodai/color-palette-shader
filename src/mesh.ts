// Generate a unit cube mesh as indexed triangles. Returns interleaved positions.
export function createCubeMesh(resolution: number): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  const verts: number[] = [];
  const idx: number[] = [];
  const n = resolution; // quads per face edge

  // 6 faces: for each face we create an (n+1)×(n+1) grid of vertices and n×n×2 triangles
  // Face mappings: [axis perpendicular, sign, u-axis, v-axis]
  const faces: [number, number, number, number, number, number][] = [
    // axisIndex, sign, uAxis, vAxis, uSign, vSign
    // +X face
    [0, 1, 2, 1, 1, 1],
    // -X face
    [0, 0, 2, 1, -1, 1],
    // +Y face
    [1, 1, 0, 2, 1, 1],
    // -Y face
    [1, 0, 0, 2, 1, -1],
    // +Z face
    [2, 1, 0, 1, 1, 1],
    // -Z face
    [2, 0, 0, 1, -1, 1],
  ];

  for (const [axIdx, sign, uIdx, vIdx, _uSign, _vSign] of faces) {
    const base = verts.length / 3;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const v = j / n;
        const pos = [0, 0, 0];
        pos[axIdx] = sign;
        pos[uIdx] = u;
        pos[vIdx] = v;
        verts.push(pos[0], pos[1], pos[2]);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

// Stacked X-axis slices filling the cube volume. Each slice is a YZ quad.
// Used for gamut clipping — out-of-gamut fragments are discarded per-slice,
// and the dense stack forms the visible gamut body.
export function createSlicedCubeMesh(
  resolution: number,
  slices: number,
  padding = 0,
): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  const n = resolution;
  const lo = -padding;
  const hi = 1 + padding;
  const span = hi - lo;

  // Iterate near-to-far so the draw order is front-to-back.
  // With depth test on, early-Z rejects occluded fragments → huge perf win.
  for (let s = slices; s >= 0; s--) {
    const x = lo + (span * s) / slices;
    const base = verts.length / 3;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        verts.push(x, lo + (span * j) / n, lo + (span * i) / n);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

// Stacked height slices filling the cylinder volume. Each slice is a full disc.
// Only position (3 floats) is stored per vertex — polar conversion happens
// per-pixel in the fragment shader via the color-rotation matrix.
export function createSlicedCylinderMesh(
  radialSegments: number,
  slices: number,
  padding = 0,
): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  const TWO_PI = Math.PI * 2;
  const capSegs = Math.max(1, Math.floor(radialSegments / 4));
  const maxR = 0.5 + padding; // radius extent
  const hLo = -padding; // height range: [-padding, 1+padding]
  const hHi = 1 + padding;

  // Iterate near-to-far so the draw order is front-to-back.
  for (let s = slices; s >= 0; s--) {
    const h = hLo + ((hHi - hLo) * s) / slices;
    const py = h - 0.5;
    const discBase = verts.length / 3;
    for (let ring = 0; ring <= capSegs; ring++) {
      const r01 = ring / capSegs;
      const rPos = r01 * maxR;
      for (let i = 0; i <= radialSegments; i++) {
        const u = i / radialSegments;
        const angle = u * TWO_PI;
        verts.push(rPos * Math.cos(angle), py, rPos * Math.sin(angle));
      }
    }
    const stride = radialSegments + 1;
    for (let ring = 0; ring < capSegs; ring++) {
      for (let i = 0; i < radialSegments; i++) {
        const a = discBase + ring * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

// Polar model IDs that should use a cylinder (or cone/bicone variant)
export const POLAR_MODEL_IDS = new Set([5, 7, 9, 11, 13, 15, 18, 21, 24, 32]); // all *Polar models

// Cone: HSV-type polar models (radius = value, point at bottom)
export const CONE_MODEL_IDS = new Set([5, 11]); // okhsvPolar, hsvPolar

// Bicone: HSL-type polar models (radius = 1-|2L-1|, points at top and bottom)
export const BICONE_MODEL_IDS = new Set([7, 13]); // okhslPolar, hslPolar

// Inverted cone: HWB-type polar models (radius = 1-height, wide at bottom, point at top)
export const CONE_INV_MODEL_IDS = new Set([15]); // hwbPolar
