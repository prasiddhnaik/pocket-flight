import { expect, test } from "bun:test";
import { measureFinch } from "../scripts/measure-finch";
import { finchDesign, finchMass, finchCG } from "../src/finch-design";
import { finchWheels } from "../src/landing-gear";
import { Vector3 } from "three";

test("Finch engineering dimensions, wing area and gear datums match the actual runtime GLB", async () => {
  const measured = await measureFinch();
  for (const dimension of ["span", "length", "height"] as const)
    expect(measured.dimensions[dimension]).toBeCloseTo(
      finchDesign.geometry[dimension],
      3,
    );
  expect(measured.wing.meshes).toHaveLength(6);
  expect(measured.wing.referenceArea).toBeCloseTo(
    finchDesign.geometry.wingArea,
    3,
  );
  expect(measured.wing.meanAerodynamicChord).toBeCloseTo(
    finchDesign.geometry.meanAerodynamicChord,
    3,
  );
  expect(measured.wing.quarterChordZ).toBeCloseTo(
    finchDesign.geometry.quarterChordZ,
    3,
  );
  for (const [i, wheel] of measured.wheels.entries())
    expect(
      finchWheels[i].center.distanceTo(new Vector3().fromArray(wheel.center)),
    ).toBeLessThan(0.000001);
});

test("concept loading budget fits between nose and main gear and remains laterally symmetric", () => {
  expect(finchMass).toBe(860);
  expect(finchCG[0]).toBe(0);
  expect(finchCG[2]).toBeGreaterThan(finchWheels[2].center.z);
  expect(finchCG[2]).toBeLessThan(finchWheels[0].center.z);
  const mainZ = finchWheels[0].center.z;
  const noseZ = finchWheels[2].center.z;
  const noseFraction = (mainZ - finchCG[2]) / (mainZ - noseZ);
  expect(noseFraction).toBeGreaterThan(0.1);
  expect(noseFraction).toBeLessThan(0.35);
});
