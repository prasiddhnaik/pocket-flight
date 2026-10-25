import { Vector3 } from "three";
import { fuelTable, type Triangles } from "./fuel-volume";

const data = (await Bun.file(
  new URL("../assets/heron/GLB/wing-cells.json", import.meta.url),
).json()) as {
  sourceSha256: string;
  enclosedByWing: boolean;
  parts: {
    name: string;
    exactLitres: number;
    vertices: [number, number, number][];
    faces: number[][];
  }[];
};
const tanks = data.parts.map((part, i) => {
  const triangles: Triangles = part.faces.map((f) =>
    f.map((index) => new Vector3(...part.vertices[index])),
  );
  const table = fuelTable(triangles);
  if (Math.abs(table.envelopeLitres / part.exactLitres - 1) > 0.005)
    throw Error("Fuel tessellation differs from CAD volume");
  return {
    id: i === 0 ? "left-wing" : "right-wing",
    name: i === 0 ? "Left wing cell" : "Right wing cell",
    densityKgPerLitre: 0.8,
    fillPriority: 1,
    ...table,
    exactEnvelopeLitres: part.exactLitres,
  };
});
const usableFuelKg = tanks.reduce(
  (sum, t) => sum + t.usableLitres * t.densityKgPerLitre,
  0,
);
const unusableFuelKg = tanks.reduce(
  (sum, t) => sum + t.unusableLitres * t.densityKgPerLitre,
  0,
);
const result = {
  sourceSha256: data.sourceSha256,
  enclosedByWing: data.enclosedByWing,
  tanks,
  usableFuelKg,
  unusableFuelKg,
  emptyMassIncludingResidual: 2310 + unusableFuelKg,
};
await Bun.write(
  new URL("../src/aircraft/heron/fuel-geometry.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    usableFuelKg,
    unusableFuelKg,
    enclosedByWing: data.enclosedByWing,
  }),
);
