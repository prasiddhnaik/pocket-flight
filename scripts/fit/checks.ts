import * as T from "three";
import { ANKLE_FROM_BALL, gripTarget, wristOffset, type Pilot, type PilotControls } from "../../src/aircraft/pilot";
import { faces, Tree, insideDepth, hidden, solidTrees, type Face } from "./geometry";
import { load, state, type FitMap } from "./load";
import { limits, contactLimit, type FitId } from "./limits";

const control = (pitch = 0, roll = 0, yaw = 0, power = 0.6): PilotControls => ({ pitch, roll, yaw, power });
export const poses = [
  { name: "idle", c: control(0, 0, 0, 0) }, { name: "cruise", c: control() },
  { name: "full-power", c: control(0, 0, 0, 1) },
  { name: "pitch-up", c: control(1) }, { name: "pitch-down", c: control(-1) },
  { name: "roll-left", c: control(0, -1) }, { name: "roll-right", c: control(0, 1) },
  { name: "rudder", c: control(0, 0, 1) },
  { name: "combined-left", c: control(1, -1, -1, 1) },
  { name: "combined-right", c: control(-1, 1, 1, 0) },
];
export function joints(pilot: Pilot, c: PilotControls) {
  const angle = (a: string, b: string, d: string) => T.MathUtils.radToDeg(pilot.locate(a).sub(pilot.locate(b)).angleTo(pilot.locate(d).sub(pilot.locate(b))));
  return (["L", "R"] as const).map((side, i) => {
    const grip = side === "L" ? pilot.seat.left : pilot.seat.right;
    const target = grip.kind === "thigh" ? undefined : gripTarget(pilot.id, grip, c).add(wristOffset(grip)).add(new T.Vector3(side === "L" ? -0.01 : 0.01, 0, 0));
    const foot = new T.Vector3(...pilot.seat.pedals[i]).add(ANKLE_FROM_BALL);
    if (pilot.seat.pedalsMove) foot.z -= (i === 0 ? -1 : 1) * c.yaw * 0.035;
    return { side, knee: angle(`thigh_${side}`, `shin_${side}`, `foot_${side}`), elbow: angle(`upperarm_${side}`, `forearm_${side}`, `hand_${side}`), handMiss: target ? pilot.locate(`hand_${side}`).distanceTo(target) : 0, footMiss: pilot.locate(`foot_${side}`).distanceTo(foot) };
  });
}
function partAt(point: T.Vector3, fallback: string, map?: FitMap) {
  let name = fallback, volume = Infinity;
  for (const part of map?.parts ?? []) {
    if (fallback.replace(/^.*Static_/, "") !== part.material) continue;
    const box = new T.Box3(new T.Vector3(...part.min), new T.Vector3(...part.max));
    const size = box.getSize(new T.Vector3()), v = size.x * size.y * size.z;
    if (box.clone().expandByScalar(0.001).containsPoint(point) && v < volume) { name = part.name; volume = v; }
  }
  return name;
}
function panels(scene: T.Object3D, map?: FitMap) {
  const result: { name: string; samples: T.Vector3[] }[] = [];
  scene.traverse((node) => {
    if (!/^(Screen_|Copilot_Screen_|Rear_Screen_)/.test(node.name) || /^(Screen_|Copilot_Screen_|Rear_Screen_)/.test(node.parent?.name ?? "")) return;
    const triangles = faces(node).faces;
    if (!triangles.length) return;
    // Nine interior samples distributed across the actual face triangles, not its AABB.
    const samples = Array.from({ length: 9 }, (_, i) => {
      const tri = triangles[Math.min(triangles.length - 1, Math.floor(i * triangles.length / 9))].triangle;
      const u = [0.15, 0.5, 0.8][i % 3], v = [0.15, 0.35, 0.1][Math.floor(i / 3)];
      return tri.a.clone().lerp(tri.b, u).lerp(tri.c, v);
    });
    result.push({ name: node.name, samples });
  });
  for (const surface of map?.surfaces ?? []) {
    if (surface.corners.length !== 3 || result.some((p) => p.name === surface.id)) continue;
    const [o, u, v] = surface.corners.map((p) => new T.Vector3(...p));
    result.push({ name: surface.id, samples: [0.1, 0.5, 0.9].flatMap((a) => [0.1, 0.5, 0.9].map((b) => o.clone().addScaledVector(u.clone().sub(o), a).addScaledVector(v.clone().sub(o), b))) });
  }
  return result;
}
export type Clip = { body: string; part: string; depth: number; vertices: number; crossings: number; allowed: number };
export function clipping(body: ReturnType<typeof faces>, cockpit: Face[], id: FitId, map?: FitMap, prepared?: ReturnType<typeof solidTrees>) {
  const solids = prepared ?? solidTrees(cockpit);
  const tree = new Tree(cockpit), groups = new Map<string, Clip>();
  const entry = (body: string, at: T.Vector3, fallback: string) => {
    const part = partAt(at, fallback, map), key = `${body}/${part}`;
    let item = groups.get(key);
    if (!item) { item = { body, part, depth: 0, vertices: 0, crossings: 0, allowed: contactLimit(id, body, part) }; groups.set(key, item); }
    return item;
  };
  const cell = 0.15, grid = new Map<string, typeof solids>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const solid of solids) {
    const { min, max } = solid.tree.box;
    for (let x = Math.floor(min.x / cell); x <= Math.floor(max.x / cell); x++)
      for (let y = Math.floor(min.y / cell); y <= Math.floor(max.y / cell); y++)
        for (let z = Math.floor(min.z / cell); z <= Math.floor(max.z / cell); z++) {
          const k = key(x, y, z), entries = grid.get(k) ?? []; entries.push(solid); grid.set(k, entries);
        }
  }
  for (const p of body.points) for (const solid of grid.get(key(Math.floor(p.at.x / cell), Math.floor(p.at.y / cell), Math.floor(p.at.z / cell))) ?? []) {
    if (!solid.tree.box.containsPoint(p.at)) continue;
    const depth = insideDepth(p.at, solid.tree);
    if (depth < 0.001) continue;
    const item = entry(p.part, p.at, solid.part);
    item.vertices++; item.depth = Math.max(item.depth, depth);
  }
  // Crossing triangles remain evidence even when a thin surface has no interior vertices.
  for (const face of body.faces) {
    const crossed = tree.crossing(face);
    if (!crossed) continue;
    const centre = face.triangle.getMidpoint(new T.Vector3());
    const item = entry(face.part, centre, crossed.part);
    item.crossings++;
  }
  return [...groups.values()];
}
export async function checkPlane(id: FitId, selected = poses) {
  const start = performance.now(), loaded = await load(id);
  const { pilot, driver, scene, group, map } = loaded;
  const targets = panels(scene, map);
  const results = [];
  group.updateMatrixWorld(true);
  const staticSolids = solidTrees(faces(scene).faces.filter((f) => f.part.includes("Static_")));
  const moving = ["Stick", "Yoke_left", "Throttle_left", "Pedal_left"].map((name) => scene.getObjectByName(name)).filter((n): n is T.Object3D => !!n);
  const before = moving.map((n) => n.matrixWorld.clone());
  for (const pose of selected) {
    driver.update(state(pose.c), 1);
    pilot.setFirstPerson(true); pilot.update(pose.c); group.updateMatrixWorld(true);
    const body = faces(pilot.root, true), cockpit = faces(scene).faces;
    const drawn = new Tree(body.faces);
    const eye = new T.Vector3(...pilot.seat.eye);
    const seatHidden = targets.map((p) => ({ name: p.name, hidden: p.samples.filter((t) => hidden(eye, t, drawn)).length / p.samples.length * 100 }));
    const joint = joints(pilot, pose.c);
    const clips = clipping(body, cockpit, id, map, [...staticSolids, ...solidTrees(cockpit.filter((f) => !f.part.includes("Static_")))]);
    // Diagnostic whole body in the SAME detail seat, never an outside fit score.
    pilot.setFirstPerson(false);
    if (pilot.seat.outside) pilot.root.position.sub(new T.Vector3(...pilot.seat.outside));
    pilot.update(pose.c); group.updateMatrixWorld(true);
    const whole = new Tree(faces(pilot.root, true).faces);
    const wholeHidden = targets.map((p) => ({ name: p.name, hidden: p.samples.filter((t) => hidden(eye, t, whole)).length / p.samples.length * 100 }));
    // Vertical compression relative to the authored cushion top, separate from
    // the nearest-surface solid depth (bevels and seams make these different).
    const pans = map?.parts.filter((p) => /^Seat_pan$/.test(p.name)) ?? [];
    const cushionCompression = Math.max(0, ...pans.flatMap((p) => body.points.filter((v) => v.part === "hips" && v.at.x >= p.min[0] && v.at.x <= p.max[0] && v.at.z >= p.min[2] && v.at.z <= p.max[2]).map((v) => p.max[1] - v.at.y)));
    results.push({ pose: pose.name, joints: joint, clips, cushionCompression: pans.length ? cushionCompression : null, panels: seatHidden, wholeBodyPanels: wholeHidden });
  }
  group.updateMatrixWorld(true);
  const driverMoved = moving.filter((n, i) => !n.matrixWorld.equals(before[i])).map((n) => n.name);
  pilot.dispose(); driver.dispose?.();
  const l = limits[id];
  const issues = results.flatMap((r) => [
    ...r.joints.flatMap((j) => [j.knee < l.knee ? `${r.pose}: ${j.side} knee ${j.knee.toFixed(1)}° < ${l.knee}°` : "", j.elbow < l.elbow ? `${r.pose}: ${j.side} elbow ${j.elbow.toFixed(1)}°` : "", j.handMiss > l.miss ? `${r.pose}: ${j.side} hand misses ${(j.handMiss * 100).toFixed(1)} cm` : "", j.footMiss > l.miss ? `${r.pose}: ${j.side} foot misses ${(j.footMiss * 100).toFixed(1)} cm` : ""].filter(Boolean)),
    ...r.clips.filter((c) => c.depth > c.allowed).map((c) => `${r.pose}: ${c.body} in ${c.part} ${(c.depth * 100).toFixed(1)} cm (limit ${(c.allowed * 100).toFixed(1)})`),
    ...r.panels.filter((p) => p.hidden > 0).map((p) => `${r.pose}: ${p.name} hidden ${p.hidden.toFixed(0)}%`),
  ]);
  return { id, view: "seat only; outside not scored", fitMap: !!map, driverMoved, seconds: (performance.now() - start) / 1000, verdict: issues.length ? (results.every((r) => r.joints.every((j) => j.knee >= l.knee && j.elbow >= l.elbow && j.handMiss <= l.miss && j.footMiss <= l.miss) && r.clips.every((c) => c.depth <= c.allowed) && r.panels.every((p) => !/Screen_/.test(p.name) || p.hidden === 0)) ? "NEAR PASS" : "REVIEW") : "PASS", issues, results };
}
export type FitReport = Awaited<ReturnType<typeof checkPlane>>;
export function verdictText(report: FitReport) {
  const allJoints = report.results.flatMap((r) => r.joints), cruise = report.results.find((r) => r.pose === "cruise") ?? report.results[0];
  const worst = (key: "panels" | "wholeBodyPanels") => Math.max(0, ...report.results.flatMap((r) => r[key].map((p) => p.hidden)));
  const clips = report.results.flatMap((r) => r.clips), failures = clips.filter((c) => c.depth > c.allowed).sort((a, b) => b.depth - a.depth);
  const cushion = cruise.cushionCompression;
  const screen = (rows: typeof cruise.panels) => Math.max(0, ...rows.filter((p) => /Screen_/.test(p.name)).map((p) => p.hidden));
  const lines = [
    `${report.id}: ${report.verdict} | seat view | ${report.seconds.toFixed(2)} s | ${report.results.length} poses`,
    `  driver moved: ${report.driverMoved.join(", ") || "none"}; ${report.fitMap ? "fit-map labels + surfaces" : "no fit-map: mesh labels + screen nodes"}`,
    `  cruise knees L/R ${cruise.joints.map((j) => j.knee.toFixed(1)).join("/")}°; minimum knee ${Math.min(...allJoints.map((j) => j.knee)).toFixed(1)}°; elbows ${Math.min(...allJoints.map((j) => j.elbow)).toFixed(1)}–${Math.max(...allJoints.map((j) => j.elbow)).toFixed(1)}°`,
    `  max hand/foot miss ${(Math.max(...allJoints.map((j) => j.handMiss)) * 100).toFixed(1)}/${(Math.max(...allJoints.map((j) => j.footMiss)) * 100).toFixed(1)} cm; hips below cushion top ${cushion === null ? "unavailable" : `${(cushion * 100).toFixed(1)} cm (vertical reference)`}`,
    `  screens hidden: cruise ${screen(cruise.panels).toFixed(0)}%, worst ${Math.max(...report.results.map((r) => screen(r.panels))).toFixed(0)}%; all surfaces worst ${worst("panels").toFixed(0)}%; whole body ${worst("wholeBodyPanels").toFixed(0)}%`,
    `  clipping: ${failures.length} over-limit groups across poses; ${clips.reduce((s, c) => s + c.crossings, 0)} crossing triangles (contacts included)`,
  ];
  const unique = new Map<string, typeof failures[number]>();
  for (const c of failures) if (!unique.has(`${c.body}/${c.part}`)) unique.set(`${c.body}/${c.part}`, c);
  for (const c of [...unique.values()].slice(0, 3)) lines.push(`    ${c.body} / ${c.part}: ${(c.depth * 100).toFixed(1)} cm > ${(c.allowed * 100).toFixed(1)} cm`);
  lines.push(`  ${report.issues.length} findings in --json; outside view not run.`);
  return lines.join("\n");
}
