export const WORLD_SIZE = 2800;
export const TERRAIN_SEGMENTS = 256;
export const RUNWAY_PAVEMENT_HEIGHT = 0.25;
export const APRON_PAVEMENT_HEIGHT = 0.18;
const terrainCell = WORLD_SIZE / TERRAIN_SEGMENTS;
export const runways = [
  {
    name: "Palm Bay",
    x: -260,
    z: 260,
    heading: 0,
    length: 470,
    width: 27,
    y: 8,
    code: "01",
    short: false,
  },
  {
    name: "Needle Point",
    x: 610,
    z: -200,
    heading: -0.28,
    length: 245,
    width: 22,
    y: 25,
    code: "35",
    short: true,
  },
];
export function runwayLocal(x: number, z: number, r: (typeof runways)[number]) {
  const dx = x - r.x,
    dz = z - r.z;
  return {
    x: dx * Math.cos(r.heading) - dz * Math.sin(r.heading),
    z: dx * Math.sin(r.heading) + dz * Math.cos(r.heading),
  };
}
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hill = (
  x: number,
  z: number,
  cx: number,
  cz: number,
  rx: number,
  rz: number,
  height: number,
) =>
  height * Math.exp(-2.8 * ((x - cx) ** 2 / rx ** 2 + (z - cz) ** 2 / rz ** 2));
// Smooth, deterministic relief: erosion follows warped valley lines down the ridges.
function reliefNoise(x: number, z: number) {
  const hash = (a: number, b: number) => {
    const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const u = smooth(0, 1, x - ix),
    v = smooth(0, 1, z - iz);
  return (
    (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) +
    (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v
  );
}
export function terrainHeight(x: number, z: number) {
  const edge = Math.sqrt((x + 140) ** 2 / 620 ** 2 + (z + 20) ** 2 / 800 ** 2);
  const shore =
    (1 - edge) * 69 +
    4 * Math.sin(x * 0.014) * Math.cos(z * 0.011) +
    3 * Math.sin((x + z) * 0.026);
  const east =
    (1 - Math.sqrt((x - 620) ** 2 / 290 ** 2 + (z + 240) ** 2 / 470 ** 2)) * 62;
  const small = (1 - Math.hypot((x + 850) / 180, (z - 460) / 220)) * 35;
  let h = Math.max(shore, east, small);
  h +=
    hill(x, z, -160, -220, 250, 330, 230) +
    hill(x, z, 295, -260, 150, 300, 200) +
    hill(x, z, -440, -480, 150, 240, 115);
  h +=
    Math.max(0, Math.min(1, h / 40)) *
    (3 * Math.sin(x * 0.05) * Math.cos(z * 0.047) +
      5 * Math.sin(x * 0.022 + z * 0.032));
  // The passage between these two ridges stays low enough for a satisfying canyon run.
  h -=
    28 *
    Math.exp(-(((x - 95) / 65) ** 2)) *
    Math.exp(-(((z + 240) / 350) ** 2));
  const highland = smooth(30, 105, h);
  const warp = (reliefNoise(x * 0.006, z * 0.006) - 0.5) * 52;
  const valley = Math.pow(
    1 - Math.abs(Math.sin((x + warp) * 0.031 + z * 0.012)),
    4,
  );
  const relief =
    (reliefNoise(x * 0.018, z * 0.018) - 0.5) * 22 +
    (reliefNoise(x * 0.047, z * 0.047) - 0.5) * 7;
  h += highland * (relief - valley * 30);
  // Coastal shelves create rock ledges without changing the airfield plateaus.
  const shelf = smooth(2, 9, h) * (1 - smooth(20, 42, h));
  h += shelf * (reliefNoise(x * 0.024, z * 0.024) - 0.5) * 4;
  // A prepared village terrace gives porches, streets and stairs a common grade.
  const villageBlend =
    (1 - smooth(83, 108, Math.abs(x + 355))) *
    (1 - smooth(85, 110, Math.abs(z - 562))) *
    smooth(1, 3, h);
  h = h * (1 - villageBlend) + 6.4 * villageBlend;
  for (const r of runways) {
    const p = runwayLocal(x, z, r);
    // Keep every triangle touching pavement on the plateau, including the
    // apron, hangars and tower. A grid diagonal covers rotated airfields too.
    const margin = terrainCell * Math.SQRT2;
    const runwayBlend =
      (1 -
        smooth(
          r.width / 2 + margin,
          r.width / 2 + margin + 55,
          Math.abs(p.x),
        )) *
      (1 -
        smooth(
          r.length / 2 + margin,
          r.length / 2 + margin + 80,
          Math.abs(p.z),
        ));
    const apronBlend =
      (1 - smooth(40 + margin, 75 + margin, Math.abs(p.x - 50))) *
      (1 - smooth(81 + margin, 116 + margin, Math.abs(p.z - 47)));
    const blend = Math.max(runwayBlend, apronBlend);
    h = h * (1 - blend) + r.y * blend;
  }
  return Math.max(-40, h);
}
export function groundAt(x: number, z: number) {
  const runway = runways.find((r) => {
    const p = runwayLocal(x, z, r);
    return Math.abs(p.x) < r.width / 2 && Math.abs(p.z) < r.length / 2;
  });
  return {
    height: groundHeight(x, z),
    runway,
    water: terrainHeight(x, z) < 0.25,
  };
}

// Same rendered surface, without the extra water query needed by wheel VFX.
export function groundHeight(x: number, z: number) {
  let height = Math.max(0, terrainSurfaceHeight(x, z));
  for (const r of runways) {
    const p = runwayLocal(x, z, r);
    if (p.x >= 12 && p.x <= 76 && p.z >= 15 && p.z <= 125)
      height = Math.max(height, r.y + APRON_PAVEMENT_HEIGHT);
  }
  for (const r of runways) {
    const p = runwayLocal(x, z, r);
    if (Math.abs(p.x) < r.width / 2 && Math.abs(p.z) < r.length / 2)
      height = Math.max(height, r.y + RUNWAY_PAVEMENT_HEIGHT);
  }
  return height;
}
export function random(seed = 247) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Match PlaneGeometry's triangle interpolation for scenery placed on the mesh.
const terrainVertices = new Float64Array((TERRAIN_SEGMENTS + 1) ** 2).fill(NaN);
function vertexHeight(ix: number, iz: number) {
  if (ix < 0 || iz < 0 || ix > TERRAIN_SEGMENTS || iz > TERRAIN_SEGMENTS)
    return terrainHeight(
      ix * terrainCell - WORLD_SIZE / 2,
      iz * terrainCell - WORLD_SIZE / 2,
    );
  const index = iz * (TERRAIN_SEGMENTS + 1) + ix;
  if (Number.isNaN(terrainVertices[index]))
    terrainVertices[index] = terrainHeight(
      ix * terrainCell - WORLD_SIZE / 2,
      iz * terrainCell - WORLD_SIZE / 2,
    );
  return terrainVertices[index];
}
// A triangle cannot rise above its vertices. Use this conservative bound to
// reject aircraft sweeps that are entirely above the local ground and pavement.
export function maximumGroundHeight(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
) {
  const ix0 = Math.floor((x0 + WORLD_SIZE / 2) / terrainCell);
  const ix1 = Math.floor((x1 + WORLD_SIZE / 2) / terrainCell) + 1;
  const iz0 = Math.floor((z0 + WORLD_SIZE / 2) / terrainCell);
  const iz1 = Math.floor((z1 + WORLD_SIZE / 2) / terrainCell) + 1;
  let height = Math.max(
    0,
    ...runways.map(
      (r) => r.y + Math.max(APRON_PAVEMENT_HEIGHT, RUNWAY_PAVEMENT_HEIGHT),
    ),
  );
  for (let iz = iz0; iz <= iz1; iz++)
    for (let ix = ix0; ix <= ix1; ix++)
      height = Math.max(height, vertexHeight(ix, iz));
  return height;
}
export function terrainSurfaceHeight(x: number, z: number) {
  const gx = (x + WORLD_SIZE / 2) / terrainCell;
  const gz = (z + WORLD_SIZE / 2) / terrainCell;
  const ix = Math.floor(gx),
    iz = Math.floor(gz);
  const u = gx - ix,
    v = gz - iz;
  const b = vertexHeight(ix, iz + 1);
  const c = vertexHeight(ix + 1, iz);
  if (u + v <= 1) return vertexHeight(ix, iz) * (1 - u - v) + c * u + b * v;
  return vertexHeight(ix + 1, iz + 1) * (u + v - 1) + b * (1 - u) + c * (1 - v);
}
