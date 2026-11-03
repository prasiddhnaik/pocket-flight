import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { terrainSurfaceHeight } from "../src/world/terrain";
import {
  AIRFIELD_TOWER,
  MARINA_PIERS,
  PALM_BAY_AIRFIELD,
  PALM_BAY_MARINA,
  PALM_BAY_VILLAGE,
} from "../src/world/palm-bay-landmarks";
import { palmGeometry, waveNormals } from "../src/world/scenery-geometry";

const assets = ["airfield-tower", "airfield-terminal", "airfield-fuel", "palm-bay-lighthouse", "marina-pier", "marina-boat", "marina-boathouse", "village-church", "village-store", "village-water-tower"];

test("every landmark has a small model that stands below its own origin, so it cannot hover", () => {
  for (const name of assets) {
    const bytes = readFileSync(new URL(`../public/assets/scenery/${name}.glb`, import.meta.url));
    expect(bytes.length).toBeLessThan(100 * 1024);
    const data = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    let lowest = Infinity;
    for (const mesh of data.meshes)
      for (const primitive of mesh.primitives) lowest = Math.min(lowest, data.accessors[primitive.attributes.POSITION].min[1]);
    // Foundations and pilings go below ground; a boat's keel goes below the waterline.
    expect(lowest).toBeLessThan(-0.3);
  }
});

test("village landmarks stand on ground level enough for their foundations", () => {
  for (const { x, z, reach, asset } of PALM_BAY_VILLAGE) {
    const centre = terrainSurfaceHeight(x, z);
    expect(centre).toBeGreaterThan(3);
    for (let i = 0; i < 8; i++) {
      const edge = terrainSurfaceHeight(x + Math.cos((i * Math.PI) / 4) * reach, z + Math.sin((i * Math.PI) / 4) * reach);
      expect(Math.abs(edge - centre)).toBeLessThan(asset === "village-water-tower" ? 1 : 1.2);
    }
  }
});

test("every pier starts on the beach and ends over water", () => {
  for (const [x, z] of MARINA_PIERS) {
    expect(terrainSurfaceHeight(x, z - 37)).toBeGreaterThan(1.8);
    expect(terrainSurfaceHeight(x, z + 37)).toBeLessThan(-2);
  }
});

test("boats float in water deep enough for their keels, and the boathouse is ashore", () => {
  for (const landmark of PALM_BAY_MARINA) {
    const depth = terrainSurfaceHeight(landmark.x, landmark.z);
    if (landmark.asset === "marina-boat") expect(depth).toBeLessThan(-0.7);
    else expect(depth).toBeGreaterThan(2);
  }
});

test("tall buildings have collision, reaching close to the top of each model", () => {
  for (const landmark of [AIRFIELD_TOWER, ...PALM_BAY_AIRFIELD, ...PALM_BAY_VILLAGE]) {
    expect(landmark.height).toBeGreaterThan(3);
    expect(landmark.circles?.length).toBeGreaterThan(0);
  }
});

test("the ocean's ripples wrap at their edges, so tiling leaves no seam", () => {
  const texture = waveNormals(64);
  const data = texture.image.data as Uint8Array;
  const at = (x: number, y: number, c: number) => data[((y % 64) * 64 + (x % 64)) * 4 + c];
  let across = 0,
    within = 0;
  for (let i = 0; i < 64; i++) {
    across = Math.max(across, Math.abs(at(i, 63, 2) - at(i, 0, 2)), Math.abs(at(63, i, 2) - at(0, i, 2)));
    within = Math.max(within, Math.abs(at(i, 20, 2) - at(i, 21, 2)), Math.abs(at(20, i, 2) - at(21, i, 2)));
  }
  // A wrapped edge changes no more than any other step across the texture.
  expect(across).toBeLessThanOrEqual(within + 2);
  let mean = 0;
  for (let i = 0; i < 64 * 64; i++) mean += data[i * 4];
  expect(Math.abs(mean / (64 * 64) - 127.5)).toBeLessThan(6);
  expect(texture.generateMipmaps).toBe(true);
});

test("a palm is one continuous trunk with a full, drooping crown at the same height as its collision", () => {
  const { trunk, fronds } = palmGeometry();
  trunk.computeBoundingBox();
  fronds.computeBoundingBox();
  expect(trunk.boundingBox!.max.y).toBeCloseTo(12, 5);
  expect(trunk.boundingBox!.min.y).toBeCloseTo(0, 5);
  expect(fronds.boundingBox!.max.y).toBeGreaterThan(12.5);
  expect(fronds.boundingBox!.min.y).toBeLessThan(10);
  expect(fronds.boundingBox!.max.x - fronds.boundingBox!.min.x).toBeGreaterThan(9);
  expect((trunk.index!.count + fronds.index!.count) / 3).toBeLessThan(700);
});
