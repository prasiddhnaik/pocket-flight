import { readFile, writeFile } from "node:fs/promises";

type Station = { x: number; y: number; leading: number; chord: number; zeroLiftAlpha: number; incidence: number };
const source = new URL("../assets/f15c/parts/wings/checks/", import.meta.url);
const measured = JSON.parse(await readFile(new URL("wing-geometry.json", source), "utf8"));
const evidence = JSON.parse(await readFile(new URL("results.json", source), "utf8"));
if (evidence.failed) throw new Error("The saved wing has failing checks.");
const stations: Station[] = measured.stations.map((s: Station) => ({ ...s, y: s.y - 2.38 }));
let area = 0, chordSquared = 0, quarterMoment = 0;
for (let i = 1; i < stations.length; i++) {
  const a = stations[i - 1], b = stations[i], dx = b.x - a.x;
  const middle = { chord: (a.chord + b.chord) / 2, leading: (a.leading + b.leading) / 2 };
  const quarter = (s: { chord: number; leading: number }) => s.chord * (s.leading + s.chord / 4);
  area += dx * (a.chord + b.chord);
  chordSquared += 2 * dx * (a.chord ** 2 + a.chord * b.chord + b.chord ** 2) / 3;
  quarterMoment += 2 * dx * (quarter(a) + 4 * quarter(middle) + quarter(b)) / 6;
}
const geometry = {
  id: "f15c", name: "F-15C Eagle", revision: evidence.sha256,
  dimensions: [13.04925, 5.6261, 19.431], scale: 1, offsetY: 0, maxChordAsymmetry: 0,
  meshNames: ["Wing_fixed_Left", "Wing_fixed_Right"], stations,
  wingArea: area, meanAerodynamicChord: chordSquared / area, quarterChordZ: quarterMoment / area,
  assumptions: [...measured.assumptions, "Runtime axes +X right/+Y up/+Z aft; CAD ground datum Z=2.38 m is subtracted from station heights."],
};
await writeFile(new URL("../src/aircraft/f15c/geometry.json", import.meta.url), `${JSON.stringify(geometry, null, 2)}\n`);
console.log(JSON.stringify({ wingArea: area, meanAerodynamicChord: geometry.meanAerodynamicChord, quarterChordZ: geometry.quarterChordZ }));
