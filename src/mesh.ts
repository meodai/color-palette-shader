// Generate a unit cube mesh as indexed triangles. Returns interleaved positions.
export function createCubeMesh(resolution: number): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  const n = resolution; // quads per face edge

  // 6 faces: for each face we create an (n+1)×(n+1) grid of vertices and n×n×2 triangles
  // Face mappings: [axis perpendicular, sign, u-axis, v-axis]
  const faces: [number, number, number, number, number, number][] = [
    // axisIndex, sign, uAxis, vAxis, uSign, vSign
    // +X face
    [0, 1,  2, 1, 1, 1],
    // -X face
    [0, 0,  2, 1, -1, 1],
    // +Y face
    [1, 1,  0, 2, 1, 1],
    // -Y face
    [1, 0,  0, 2, 1, -1],
    // +Z face
    [2, 1,  0, 1, 1, 1],
    // -Z face
    [2, 0,  0, 1, -1, 1],
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

// Generate a cylinder mesh for polar color models.
// The color coordinate is stored per-vertex as (angle/TWO_PI, radius, height)
// where angle ∈ [0,1], radius ∈ [0,1], height ∈ [0,1].
// The 3D position is centered: x = r*cos(θ), z = r*sin(θ), y = height-0.5
export function createCylinderMesh(radialSegments: number, heightSegments: number): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  const TWO_PI = Math.PI * 2;

  // ── Side wall ──────────────────────────────────────────────────────────────
  const sideBase = 0;
  for (let j = 0; j <= heightSegments; j++) {
    const v = j / heightSegments;
    for (let i = 0; i <= radialSegments; i++) {
      const u = i / radialSegments;
      const angle = u * TWO_PI;
      const r = 0.5; // unit radius (maps to radius=1 in color space)
      // position (centered around origin)
      const px = r * Math.cos(angle);
      const pz = r * Math.sin(angle);
      const py = v - 0.5;
      // color coord: (angle/TWO_PI, 1.0 (edge), height)
      verts.push(px, py, pz, u, 1.0, v);
    }
  }
  const sideStride = radialSegments + 1;
  for (let j = 0; j < heightSegments; j++) {
    for (let i = 0; i < radialSegments; i++) {
      const a = sideBase + j * sideStride + i;
      const b = a + 1;
      const c = a + sideStride;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }

  // ── Cap discs (top and bottom) ─────────────────────────────────────────────
  for (const capV of [0, 1]) {
    const capBase = verts.length / 6;
    const capY = capV - 0.5;
    const capSegs = Math.max(1, Math.floor(radialSegments / 4)); // radial rings on cap
    for (let ring = 0; ring <= capSegs; ring++) {
      const r01 = ring / capSegs; // 0 = center, 1 = edge
      const rPos = r01 * 0.5;
      for (let i = 0; i <= radialSegments; i++) {
        const u = i / radialSegments;
        const angle = u * TWO_PI;
        const px = rPos * Math.cos(angle);
        const pz = rPos * Math.sin(angle);
        verts.push(px, capY, pz, u, r01, capV);
      }
    }
    const capStride = radialSegments + 1;
    for (let ring = 0; ring < capSegs; ring++) {
      for (let i = 0; i < radialSegments; i++) {
        const a = capBase + ring * capStride + i;
        const b = a + 1;
        const c = a + capStride;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  }

  // Interleave: 6 floats per vertex (px, py, pz, colorU, colorV, colorW)
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

// Stacked X-axis slices filling the cube volume. Each slice is a YZ quad.
// Used for gamut clipping — out-of-gamut fragments are discarded per-slice,
// and the dense stack forms the visible gamut body.
export function createSlicedCubeMesh(resolution: number, slices: number, padding = 0): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  const n = resolution;
  const lo = -padding;
  const hi = 1 + padding;
  const span = hi - lo;

  for (let s = 0; s <= slices; s++) {
    const x = lo + span * s / slices;
    const base = verts.length / 3;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        verts.push(x, lo + span * j / n, lo + span * i / n);
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
export function createSlicedCylinderMesh(radialSegments: number, slices: number, padding = 0): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  const TWO_PI = Math.PI * 2;
  const capSegs = Math.max(1, Math.floor(radialSegments / 4));
  const maxR = 0.5 + padding;   // radius extent
  const hLo = -padding;         // height range: [-padding, 1+padding]
  const hHi = 1 + padding;

  for (let s = 0; s <= slices; s++) {
    const h = hLo + (hHi - hLo) * s / slices;
    const py = h - 0.5;
    const discBase = verts.length / 6;
    for (let ring = 0; ring <= capSegs; ring++) {
      const r01 = ring / capSegs;
      const rPos = r01 * maxR;
      for (let i = 0; i <= radialSegments; i++) {
        const u = i / radialSegments;
        const angle = u * TWO_PI;
        verts.push(rPos * Math.cos(angle), py, rPos * Math.sin(angle), u, r01, h);
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

// Polar model IDs that should use a cylinder
export const POLAR_MODEL_IDS = new Set([3, 5, 7, 9, 11, 13, 16, 19, 22]);

// All hue-based model IDs (polar + non-polar). In gamut clip mode these all
// need the cylinder mesh so rotation doesn't distort the periodic hue axis.
export const HUE_MODEL_IDS = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 18, 19, 21, 22]);
