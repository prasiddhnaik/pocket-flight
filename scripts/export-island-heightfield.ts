// Shared collision/render data sampled for Blender's editable island mesh.
import { terrainHeight, WORLD_SIZE, TERRAIN_SEGMENTS } from "../src/terrain";
const heights: number[] = [];
for (let z = 0; z <= TERRAIN_SEGMENTS; z++)
  for (let x = 0; x <= TERRAIN_SEGMENTS; x++)
    heights.push(
      terrainHeight(
        (x / TERRAIN_SEGMENTS - 0.5) * WORLD_SIZE,
        (z / TERRAIN_SEGMENTS - 0.5) * WORLD_SIZE,
      ),
    );
await Bun.write(
  new URL("../assets/island-heightfield.json", import.meta.url),
  JSON.stringify({ size: WORLD_SIZE, segments: TERRAIN_SEGMENTS, heights }),
);
