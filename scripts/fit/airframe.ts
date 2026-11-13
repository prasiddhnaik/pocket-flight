// Pilot fit for aircraft without a detail cockpit: the Finch (and its attack variant) and the Heron
// seat the pilot in the airframe model's own seat, under its own canopy or cabin roof.
import * as T from "three";
import { loadGeometryOnly } from "../geometry-loader";
import { Pilot } from "../../src/aircraft/pilot";
import { moveHeronSeats } from "../../src/aircraft/aircraft";
import { FINCH_ATTACK_ROOT, finchAttackStores } from "../../src/aircraft/finch/attack";
import { addAircraftStores } from "../../src/aircraft/aircraft-stores";
import { faces } from "./geometry";
import { joints, poses } from "./checks";

export const airframeIds = ["finch", "finch-attack", "heron"] as const;
export type AirframeId = typeof airframeIds[number];
export type AirframeReport = { id: AirframeId; verdict: "PASS" | "NEAR PASS" | "REVIEW"; issues: string[]; seconds: number };

// Metres. The Finch's outside figure sits back in its seat with the boots short of the pedals (12 Nov 2026).
const limits = {
  finch: { canopy: 0, cushion: 0.04, back: [-0.02, 0.03], hand: 0.05, footSeat: 0.035, footOutside: 0.2 },
  heron: { canopy: 0, cushion: 0.04, back: [-0.02, 0.05], hand: 0.05, footSeat: 0.035, footOutside: 0.035 },
} as const;
const cm = (m: number) => (m * 100).toFixed(1);

async function airframe(id: AirframeId) {
  const group = new T.Group();
  const { scene } = await loadGeometryOnly(new URL(`../../public/assets/${id === "heron" ? "heron-ut9" : "finch-u2"}.glb`, import.meta.url));
  group.add(scene);
  if (id === "heron") moveHeronSeats(scene);
  if (id === "finch-attack") {
    scene.getObjectByName("Finch_U2")!.name = FINCH_ATTACK_ROOT;
    if (!addAircraftStores(scene, "finch", finchAttackStores())) throw new Error("Finch attack stores did not attach");
  }
  const glass: T.Object3D[] = [], seat: T.Object3D[] = [];
  const roof = id === "heron" ? /^(Cabin_liner|Windshield|Windshield_post|Window_frames)$/ : /^Glass_Cabin/;
  const seatPart = id === "heron" ? /^Seat_(cushion|back)_0_-1$/ : /^Seat_Left/;
  scene.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    // Rays leave the eye from inside the cabin, so every surface has to answer from both sides.
    node.material = new T.MeshBasicMaterial({ side: T.DoubleSide });
    let named: T.Object3D | null = node;
    while (named && !seatPart.test(named.name) && named !== scene) named = named.parent;
    if (roof.test(node.name)) glass.push(node);
    else if (named && named !== scene) seat.push(node);
  });
  if (!glass.length || !seat.length) throw new Error(`${id}: canopy or seat meshes not found`);
  const pilot = new Pilot(group, id === "heron" ? "heron" : "finch", loadGeometryOnly(new URL("../../public/assets/pilot/fighter-pilot.glb", import.meta.url)));
  await pilot.ready;
  // Only the triangles round the seat: the Heron's cabin liner spans the whole fuselage.
  const around = new T.Box3().setFromCenterAndSize(new T.Vector3(...pilot.seat.eye), new T.Vector3(1.6, 2.4, 2));
  return { group, pilot, glass: near(glass, around), seat: near(seat, around) };
}
function near(meshes: T.Object3D[], box: T.Box3) {
  const positions: number[] = [];
  for (const mesh of meshes) for (const f of faces(mesh).faces) if (f.box.intersectsBox(box)) positions.push(...[f.triangle.a, f.triangle.b, f.triangle.c].flatMap((v) => v.toArray()));
  const geometry = new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  return [new T.Mesh(geometry, new T.MeshBasicMaterial({ side: T.DoubleSide }))];
}

/** Checks one airframe in every control pose, outside and from the seat. */
export async function checkAirframe(id: AirframeId): Promise<AirframeReport> {
  const start = performance.now(), l = limits[id === "heron" ? "heron" : "finch"];
  const { group, pilot, glass, seat } = await airframe(id);
  const ray = new T.Raycaster(), issues: string[] = [];
  for (const pose of poses) for (const firstPerson of [false, true]) {
    pilot.setFirstPerson(firstPerson); pilot.update(pose.c); group.updateMatrixWorld(true);
    const view = firstPerson ? "seat" : "outside", at = `${pose.name} ${view}`;
    for (const j of joints(pilot, pose.c)) {
      if (j.handMiss > l.hand) issues.push(`${at}: ${j.side} hand misses ${cm(j.handMiss)} cm`);
      const foot = firstPerson ? l.footSeat : l.footOutside;
      if (j.footMiss > foot) issues.push(`${at}: ${j.side} foot misses ${cm(j.footMiss)} cm`);
    }
    // The head folds away from the seat, where the camera sits inside the helmet: body checks are outside only.
    if (firstPerson) continue;
    const points = faces(pilot.root, true).points;
    const eye = new T.Vector3(...pilot.seat.eye).add(new T.Vector3(...(pilot.seat.outside ?? [0, 0, 0])));
    let canopy = Infinity;
    for (const p of points) {
      if (!/^(head|neck|clavicle_.|chest|upperarm_.)$/.test(p.part)) continue;
      const d = p.at.clone().sub(eye), length = d.length();
      if (length < 0.03 || length > 0.6) continue;
      ray.set(eye, d.normalize());
      const hit = ray.intersectObjects(glass, false)[0];
      if (hit) canopy = Math.min(canopy, hit.distance - length);
    }
    if (canopy < l.canopy) issues.push(`${at}: head through the canopy by ${cm(-canopy)} cm`);
    const hips = pilot.locate("hips");
    ray.set(hips, new T.Vector3(0, -1, 0));
    const cushion = ray.intersectObjects(seat, false)[0]?.point.y;
    const sunk = cushion === undefined ? Infinity : cushion - Math.min(...points.filter((p) => p.part === "hips").map((p) => p.at.y));
    if (sunk > l.cushion) issues.push(`${at}: hips ${cushion === undefined ? "not over the seat" : `${cm(sunk)} cm into the cushion`}`);
    const chest = pilot.locate("chest");
    const back = Math.max(...points.filter((p) => /^(spine|chest)$/.test(p.part) && Math.abs(p.at.y - chest.y) < 0.05).map((p) => p.at.z));
    ray.set(new T.Vector3(chest.x, chest.y, back - 0.05), new T.Vector3(0, 0, 1));
    const face = ray.intersectObjects(seat, false)[0]?.point.z;
    const gap = face === undefined ? Infinity : face - back;
    if (gap < l.back[0] || gap > l.back[1]) issues.push(`${at}: back ${face === undefined ? "has no seat back behind it" : `${cm(gap)} cm from the seat back`}`);
  }
  pilot.dispose();
  return { id, verdict: issues.length ? "REVIEW" : "PASS", issues, seconds: (performance.now() - start) / 1000 };
}

export function airframeText(report: AirframeReport) {
  const unique = [...new Set(report.issues.map((i) => i.replace(/^[\w-]+ (outside|seat): /, "$1: ").replace(/[\d.]+ cm/, "… cm")))];
  return [`${report.id}: ${report.verdict} | airframe seat | ${report.seconds.toFixed(2)} s | ${poses.length} poses × outside and seat`, ...unique.slice(0, 4).map((i) => `    ${i}`), `  ${report.issues.length} findings in --json.`].join("\n");
}
