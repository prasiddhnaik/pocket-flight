export const WORLD_SIZE = 2800;
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
  for (const r of runways) {
    const p = runwayLocal(x, z, r);
    const blend =
      (1 - smooth(r.width * 0.65, r.width * 2.8, Math.abs(p.x))) *
      (1 - smooth(r.length / 2 + 10, r.length / 2 + 95, Math.abs(p.z)));
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
    height: Math.max(0, terrainHeight(x, z)),
    runway,
    water: terrainHeight(x, z) < 0.25,
  };
}
export function random(seed = 247) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
