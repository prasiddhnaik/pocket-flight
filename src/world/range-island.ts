import layout from "./range-layout.json";

// Anvil Key, the weapons sandbox island. Blender owns its shape (see
// scripts/build-range-island.py); this module reads the exported height grid,
// which holds exactly the vertices of the visible mesh.

export const rangeLayout = layout;
export const RANGE_NAME = layout.name;
const { size: SIZE, segments: SEGMENTS } = layout;
const CELL = SIZE / SEGMENTS;
const originX = layout.centre.x - SIZE / 2;
const originZ = layout.centre.z - SIZE / 2;

let heights: Float32Array | null = null;

export function setRangeHeights(data: Float32Array | null) {
  if (data && data.length !== (SEGMENTS + 1) ** 2)
    throw new Error(`Range height grid has ${data.length} samples.`);
  heights = data;
}

export async function loadRangeHeights() {
  const response = await fetch("/assets/range/range-island-heights.bin");
  if (!response.ok) throw new Error(`Range heights: HTTP ${response.status}`);
  setRangeHeights(new Float32Array(await response.arrayBuffer()));
}

/** Island-local layout coordinates to world coordinates. */
export const rangeWorld = (x: number, z: number) => ({
  x: x + layout.centre.x,
  z: z + layout.centre.z,
});

/** Same triangles as the mesh. Null outside the island or before the grid loads. */
export function rangeSurface(x: number, z: number) {
  if (!heights) return null;
  const gx = (x - originX) / CELL;
  const gz = (z - originZ) / CELL;
  if (gx < 0 || gz < 0 || gx >= SEGMENTS || gz >= SEGMENTS) return null;
  const ix = Math.floor(gx),
    iz = Math.floor(gz);
  const u = gx - ix,
    v = gz - iz;
  const row = SEGMENTS + 1;
  const a = iz * row + ix;
  const b = heights[a + row],
    c = heights[a + 1];
  if (u + v <= 1) return heights[a] * (1 - u - v) + c * u + b * v;
  return heights[a + row + 1] * (u + v - 1) + b * (1 - u) + c * (1 - v);
}

/** Highest grid vertex under a sweep; null when the sweep misses the island. */
export function rangeMaximum(x0: number, x1: number, z0: number, z1: number) {
  if (!heights) return null;
  const clamp = (n: number) => Math.max(0, Math.min(SEGMENTS, n));
  const ix0 = Math.floor((x0 - originX) / CELL),
    ix1 = Math.floor((x1 - originX) / CELL) + 1,
    iz0 = Math.floor((z0 - originZ) / CELL),
    iz1 = Math.floor((z1 - originZ) / CELL) + 1;
  if (ix1 < 0 || iz1 < 0 || ix0 > SEGMENTS || iz0 > SEGMENTS) return null;
  let height = -Infinity;
  for (let iz = clamp(iz0); iz <= clamp(iz1); iz++)
    for (let ix = clamp(ix0); ix <= clamp(ix1); ix++)
      height = Math.max(height, heights[iz * (SEGMENTS + 1) + ix]);
  return height;
}
