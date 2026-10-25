/** Aircraft-owned definitions included in offline report source fingerprints. */
export const aircraftDefinitionSources = [
  "src/aircraft/mass-component.ts",
  "src/aircraft/heron/fuel.ts",
  "src/aircraft/heron/fuel-geometry.json",
  "src/aircraft/heron/aerodynamics.json",
  "src/aircraft/heron/geometry.json",
  "src/aircraft/heron/collision.json",
  "src/aircraft/f15c/fuel.ts",
  "src/aircraft/f15c/mechanisms.ts",
  "src/aircraft/f15c/geometry.json",
  "src/aircraft/f15c/collision.json",
  "src/aircraft/f15c/effects.ts",
  ...["finch", "peregrine", "aurelia", "stormbird", "heron", "f15c"].flatMap((id) =>
    ["design.ts", "landing-gear.ts", "systems.ts"].map(
      (file) => `src/aircraft/${id}/${file}`,
    ),
  ),
];
