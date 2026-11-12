import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { AircraftId } from "./aircraft";
import { cockpitSpecs } from "./cockpit-specs";
import rig from "./pilot-rig.json";
import measured from "./pilot-seats.json";

/** Built by scripts/build-pilot.py from "Fighter Pilot Character" by SoftNote (CC-BY-4.0). */
export const PILOT_URL = "/assets/pilot/fighter-pilot.glb";

type V = readonly [number, number, number];
type Q = readonly [number, number, number, number];
type Grip =
  | { kind: "stick"; pivot: V; rest: Q; grip: V }
  | { kind: "yoke"; base: V; rest: Q; wheel: V; wheelRest: Q; grip: V }
  | { kind: "throttle"; at: V }
  | { kind: "fixed"; at: V }
  | { kind: "thigh" };
export type PilotSeat = {
  /** The camera's eye in the aircraft group, in metres: the pilot is fitted to it. */
  eye: V;
  /** Radians the torso leans back from upright. */
  recline: number;
  right: Grip;
  left: Grip;
  pedals: readonly [V, V];
  pedalsMove: boolean;
  /** The figure's height as a fraction of the 1.83 m model, scaled about the eye. */
  size?: number;
  /** The figure's size in outside views, when it differs from the seat view. */
  outsideSize?: number;
  /** From the seat draws the hips, legs, forearms and hands: the chest and shoulders would hide the controls at any size. */
  clearSeatView?: boolean;
  /** Metres the body moves in outside views, where the airframe's own simple seat is showing. */
  outside?: V;
};
export type PilotControls = { pitch: number; roll: number; yaw: number; power: number };

// Measured control positions (scripts/measure-pilot-seats.ts) plus each seat's posture.
const POSTURE: Record<AircraftId, { recline: number; eye?: V; size?: number; outsideSize?: number; clearSeatView?: boolean; outside?: V }> = {
  // 10 cm forward of the old camera so the feet reach the rudder pedals.
  // The canopy is 7 cm above the eye. Outside, a 1.57 m figure sits lower and back against the seat, under the
  // glass, and its boots stop short in the footwell; from the seat the full-size legs reach the pedals in view.
  finch: { recline: 0.06, eye: [-0.3, 1.01, 0.0], outsideSize: 0.86, outside: [0, -0.1, 0.04] },
  // The Heron's front seats are moved aft at load (see aircraft.ts); the eye follows them, under the cabin roof.
  heron: { recline: 0.2, eye: [-0.4, 0.62, -1.0] },
  // Nearly upright against the jets' upright seat backs; reclining would push the hips off the cushion.
  f15c: { recline: 0.05 },
  peregrine: { recline: 0.05 },
  stormbird: { recline: 0.05 },
  // The eye looks down on a low panel: at 1.65 m the knees stay under the sightlines to the tilt panel.
  // Outside, the airframe's seat is further outboard and forward.
  aurelia: { recline: 0.2, size: 0.9, clearSeatView: true, outside: [-0.084, 0.053, -0.11] },
};
export const pilotSeats = Object.fromEntries(
  (Object.keys(POSTURE) as AircraftId[]).map((id) => {
    const seat = measured[id] as unknown as Omit<PilotSeat, "recline">;
    return [id, { ...seat, ...POSTURE[id], eye: POSTURE[id].eye ?? seat.eye }];
  }),
) as Record<AircraftId, PilotSeat>;

const PEDAL_TRAVEL = 0.035;
// Leaning moves the neck forward; from the seat it has to stay behind the camera.
const MAX_LEAN = 0.2;
const MAX_LEAN_SEATED_VIEW = 0.07;
const MAX_SHRUG = 0.08;
const MAX_SIDE_LEAN = 0.12;
export const ANKLE_FROM_BALL = new T.Vector3(0, 0.08, 0.12);
const WRIST_FROM_PALM = new T.Vector3(0, -0.035, 0.075);
// A thrust lever is held from above, the wrist just behind and above the grip.
const WRIST_FROM_THROTTLE = new T.Vector3(0, 0.03, 0.065);
const ACROSS = new T.Vector3(1, 0, 0);
const AFT = new T.Vector3(0, 0, -1);
const FOLDED = 1e-3;
const SEAT_VIEW_BONE = /^(hips|thigh_.|shin_.|foot_.|upperarm_.|forearm_.|hand_.)$/;
const seatViewGeometry = new WeakMap<T.BufferGeometry, T.BufferGeometry>();

let source: Promise<GLTF> | null = null;
export function loadPilot() {
  return (source ??= new GLTFLoader().loadAsync(PILOT_URL));
}

export const wristOffset = (grip: Grip) => (grip.kind === "throttle" ? WRIST_FROM_THROTTLE : WRIST_FROM_PALM);

/** Bind matrices that pull each upper arm into its elbow, closing the sleeve there as the neck fold closes the collar. */
function seatViewBinds(skeleton: T.Skeleton) {
  return skeleton.boneInverses.map((inverse, i) => {
    const point = skeleton.bones[i].children.find((child) => child.name.startsWith("forearm_"))?.position;
    if (!point) return inverse;
    const fold = new T.Matrix4().makeScale(FOLDED, FOLDED, FOLDED);
    return new T.Matrix4().makeTranslation(point).multiply(fold).multiply(new T.Matrix4().makeTranslation(point.clone().negate())).multiply(inverse);
  });
}

/** The triangles drawn from the seat over the mesh's own vertices: one extra index, shared like the geometry itself. */
function seatViewOf(mesh: T.SkinnedMesh) {
  const whole = mesh.geometry;
  let drawn = seatViewGeometry.get(whole);
  if (drawn) return drawn;
  const joints = whole.getAttribute("skinIndex"), weights = whole.getAttribute("skinWeight"), index = whole.index!;
  // A vertex also tied to the chest would stretch from a folded joint back up to the shoulders.
  const kept = (vertex: number) => [0, 1, 2, 3].every((k) => weights.getComponent(vertex, k) < 0.01 || SEAT_VIEW_BONE.test(mesh.skeleton.bones[joints.getComponent(vertex, k)].name));
  const triangles: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    if (kept(a) && kept(b) && kept(c)) triangles.push(a, b, c);
  }
  drawn = new T.BufferGeometry();
  for (const [name, attribute] of Object.entries(whole.attributes)) drawn.setAttribute(name, attribute);
  drawn.setIndex(triangles);
  seatViewGeometry.set(whole, drawn);
  return drawn;
}

/** The pilot's palm target for one hand, in the aircraft group, mirroring cockpitDriver's control motion. */
export function gripTarget(id: AircraftId, grip: Grip, c: PilotControls, out = new T.Vector3()) {
  const spec = cockpitSpecs[id];
  const pitch = c.pitch * (spec?.stick.pitch ?? 0), roll = c.roll * (spec?.stick.roll ?? 0);
  const turn = (axis: T.Vector3, angle: number) => new T.Quaternion().setFromAxisAngle(axis, angle);
  if (grip.kind === "stick") {
    const q = new T.Quaternion(...grip.rest).multiply(turn(ACROSS, pitch)).multiply(turn(AFT, roll));
    return out.set(...grip.grip).applyQuaternion(q).add(new T.Vector3(...grip.pivot));
  }
  if (grip.kind === "yoke") {
    const wheel = new T.Vector3(...grip.grip).applyQuaternion(new T.Quaternion(...grip.wheelRest).multiply(turn(AFT, roll))).add(new T.Vector3(...grip.wheel));
    return out.copy(wheel).applyQuaternion(new T.Quaternion(...grip.rest).multiply(turn(ACROSS, pitch))).add(new T.Vector3(...grip.base));
  }
  if (grip.kind === "throttle") {
    out.set(...grip.at);
    if (spec) out.z -= spec.throttle.idle + c.power * spec.throttle.travel;
    return out;
  }
  if (grip.kind === "fixed") return out.set(...grip.at);
  throw new Error("A hand resting on the thigh has no control target.");
}

/** A seated, rigged pilot whose hands and feet follow the controls. */
export class Pilot {
  readonly root = new T.Group();
  private bones = new Map<string, T.Bone>();
  private rest = new Map<T.Bone, T.Quaternion>();
  private lengths = new Map<string, number>();
  private meshes: { mesh: T.SkinnedMesh; whole: T.BufferGeometry; inverses: T.Matrix4[]; folded: T.Matrix4[] }[] = [];
  private firstPerson = false;
  private disposed = false;
  private controls: PilotControls = { pitch: 0, roll: 0, yaw: 0, power: 0 };
  readonly seat: PilotSeat;
  readonly ready: Promise<void>;
  private eyeLocal = new T.Vector3();
  private eye = new T.Vector3();
  constructor(aircraft: T.Object3D, readonly id: AircraftId, model: Promise<{ scene: T.Object3D }> = loadPilot()) {
    this.seat = pilotSeats[id];
    this.root.name = "Pilot";
    aircraft.add(this.root);
    this.ready = model.then((gltf) => {
      if (this.disposed) return;
      const figure = clone(gltf.scene);
      figure.traverse((node) => {
        if (node instanceof T.Bone) {
          this.bones.set(node.name, node);
          this.rest.set(node, node.quaternion.clone());
        }
        if (node instanceof T.Mesh) {
          node.frustumCulled = false;
          node.castShadow = node.receiveShadow = true;
        }
        if (node instanceof T.SkinnedMesh) this.meshes.push({ mesh: node, whole: node.geometry, inverses: node.skeleton.boneInverses, folded: seatViewBinds(node.skeleton) });
      });
      this.root.add(figure);
      this.root.scale.setScalar(this.size);
      this.root.updateMatrixWorld(true);
      for (const [name, child] of [["upperarm_L", "forearm_L"], ["forearm_L", "hand_L"], ["thigh_L", "shin_L"], ["shin_L", "foot_L"]])
        this.lengths.set(name.slice(0, -2), this.position(this.bone(name)).distanceTo(this.position(this.bone(child))));
      // Fit the seated figure to the eye: the posture never changes, so this happens once.
      const head = this.bone("head");
      this.eyeLocal.copy(head.worldToLocal(this.root.localToWorld(new T.Vector3(...rig.eye))));
      this.show();
    });
  }
  /** Puts the body in the seat for the current view and poses it. */
  private show() {
    if (!this.bones.size) return;
    this.root.scale.setScalar(this.size);
    this.posture();
    this.root.position.set(...this.seat.eye).sub(this.eyeLocal.clone().applyMatrix4(this.toRoot(this.bone("head"))).multiplyScalar(this.size));
    if (this.seat.outside && !this.firstPerson) this.root.position.add(new T.Vector3(...this.seat.outside));
    if (this.seat.clearSeatView)
      for (const { mesh, whole, inverses, folded } of this.meshes) {
        mesh.geometry = this.firstPerson ? seatViewOf(mesh) : whole;
        mesh.skeleton.boneInverses = this.firstPerson ? folded : inverses;
      }
    this.update(this.controls);
  }
  private get size() {
    return (this.firstPerson ? undefined : this.seat.outsideSize) ?? this.seat.size ?? 1;
  }
  private bone(name: string) {
    const bone = this.bones.get(name);
    if (!bone) throw new Error(`The pilot has no ${name} bone.`);
    return bone;
  }
  /** A node's transform relative to the pilot root, from local matrices only. */
  private toRoot(node: T.Object3D) {
    const m = node.matrix.clone();
    for (let p = node.parent; p && p !== this.root; p = p.parent) m.premultiply(p.matrix);
    return m;
  }
  private position(node: T.Object3D) {
    return new T.Vector3().setFromMatrixPosition(this.toRoot(node));
  }
  private rotation(node: T.Object3D) {
    const q = new T.Quaternion();
    this.toRoot(node).decompose(new T.Vector3(), q, new T.Vector3());
    return q;
  }
  /** Rotates a bone by q in the pilot root's frame. */
  private turn(bone: T.Bone, q: T.Quaternion) {
    const parent = bone.parent ? this.rotation(bone.parent) : new T.Quaternion();
    bone.quaternion.copy(parent.clone().invert().multiply(q).multiply(this.rotation(bone)));
    bone.updateMatrix();
  }
  private aim(bone: T.Bone, from: T.Vector3, to: T.Vector3) {
    this.turn(bone, new T.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize()));
  }
  private posture() {
    for (const [bone, q] of this.rest) {
      bone.quaternion.copy(q);
      bone.scale.setScalar(1);
      bone.updateMatrix();
    }
    const lean = new T.Quaternion().setFromAxisAngle(ACROSS, this.seat.recline);
    this.turn(this.bone("hips"), lean);
    // Head level with the horizon again; the neck stays with the collar on the chest.
    this.turn(this.bone("head"), lean.clone().invert());
  }
  /** Two-bone IK in the pilot root: the end of `lower` reaches `target`, bending towards `pole`. */
  private reach(upper: T.Bone, lower: T.Bone, end: T.Bone, target: T.Vector3, pole: T.Vector3, l1: number, l2: number) {
    const a = this.position(upper);
    const toTarget = target.clone().sub(a);
    const d = T.MathUtils.clamp(toTarget.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const dir = toTarget.normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const bend = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const joint = a.clone().addScaledVector(dir, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
    this.aim(upper, this.position(lower).sub(a), joint.clone().sub(a));
    const reached = a.clone().addScaledVector(dir, d);
    this.aim(lower, this.position(end).sub(joint), reached.sub(joint));
  }
  /** Moves hands and feet to the controls. Cheap enough for every frame. */
  update(c: PilotControls) {
    this.controls = c;
    if (!this.bones.size || this.disposed) return;
    this.posture();
    const offset = this.root.position;
    // The rig works in the figure's own 1.83 m; everything aimed at the aircraft comes through here.
    const local = (v: T.Vector3) => v.sub(offset).divideScalar(this.size);
    const knees: T.Vector3[] = [], hips: T.Vector3[] = [];
    this.seat.pedals.forEach((pedal, i) => {
      const side = i === 0 ? "L" : "R", sign = i === 0 ? -1 : 1;
      const ball = new T.Vector3(...pedal);
      if (this.seat.pedalsMove) ball.z -= sign * c.yaw * PEDAL_TRAVEL;
      const thigh = this.bone(`thigh_${side}`), shin = this.bone(`shin_${side}`);
      this.reach(thigh, shin, this.bone(`foot_${side}`), local(ball.add(ANKLE_FROM_BALL)), new T.Vector3(sign * 0.15, 1, -0.4), this.lengths.get("thigh")!, this.lengths.get("shin")!);
      hips.push(this.position(thigh));
      knees.push(this.position(shin));
    });
    const arm = this.lengths.get("upperarm")! + this.lengths.get("forearm")!;
    const hands = ([[this.seat.left, "L", -1], [this.seat.right, "R", 1]] as const).map(([grip, side, sign]) => {
      const palm =
        grip.kind === "thigh"
          ? hips[side === "L" ? 0 : 1].clone().lerp(knees[side === "L" ? 0 : 1], 0.7).add(new T.Vector3(0, 0.07, 0))
          : local(gripTarget(this.id, grip, c).add(wristOffset(grip)).add(new T.Vector3(sign * 0.01, 0, 0)));
      return { side, sign, wrist: grip.kind === "thigh" ? palm.add(WRIST_FROM_PALM).add(new T.Vector3(sign * 0.01, 0, 0)) : palm };
    });
    const short = () => Math.max(0, ...hands.map((h) => this.position(this.bone(`upperarm_${h.side}`)).distanceTo(h.wrist) - arm + 0.01));
    // Controls beyond arm's length: lean forward from the waist, keeping the head level...
    const lean = Math.min(this.firstPerson ? MAX_LEAN_SEATED_VIEW : MAX_LEAN, short() / 0.5);
    if (lean > 0) {
      const forward = new T.Quaternion().setFromAxisAngle(ACROSS, -lean);
      this.turn(this.bone("spine"), forward);
      this.turn(this.bone("head"), forward.invert());
    }
    // ...and drop a shoulder towards a low lever still out of reach.
    const far = hands.map((h) => ({ ...h, gap: this.position(this.bone(`upperarm_${h.side}`)).distanceTo(h.wrist) - arm + 0.01 })).sort((a, b) => b.gap - a.gap)[0];
    if (far.gap > 0) {
      const side = new T.Quaternion().setFromAxisAngle(AFT, far.sign * Math.min(this.firstPerson ? MAX_LEAN_SEATED_VIEW : MAX_SIDE_LEAN, far.gap / 0.5));
      this.turn(this.bone("spine"), side);
      this.turn(this.bone("head"), side.invert());
    }
    for (const { side, sign, wrist } of hands) {
      // ...then push the shoulder out towards the grip.
      const clavicle = this.bone(`clavicle_${side}`), shoulder = this.position(this.bone(`upperarm_${side}`));
      const gap = shoulder.distanceTo(wrist) - arm + 0.01;
      if (gap > 0) {
        const base = this.position(clavicle);
        const moved = shoulder.clone().addScaledVector(wrist.clone().sub(shoulder).normalize(), Math.min(MAX_SHRUG, gap));
        this.aim(clavicle, shoulder.sub(base), moved.sub(base));
      }
      this.reach(this.bone(`upperarm_${side}`), this.bone(`forearm_${side}`), this.bone(`hand_${side}`), wrist, new T.Vector3(sign * 0.6, -0.7, 0.3), this.lengths.get("upperarm")!, this.lengths.get("forearm")!);
    }
    const head = this.bone("head");
    this.eye.copy(this.eyeLocal).applyMatrix4(this.toRoot(head));
    // From the seat the camera sits inside the helmet: the head, collar and hose fold away with the neck.
    for (const name of ["neck", "head"]) {
      this.bone(name).scale.setScalar(this.firstPerson ? 1e-3 : 1);
      this.bone(name).updateMatrix();
    }
  }
  /** A bone's origin in the aircraft group; the eye when no bone is named. */
  locate(name?: string) {
    // Where the eye was before the head folded away.
    const point = name ? this.position(this.bone(name)) : this.eye.clone();
    return point.multiplyScalar(this.size).add(this.root.position);
  }
  setFirstPerson(on: boolean) {
    if (on === this.firstPerson) return;
    this.firstPerson = on;
    this.show();
  }
  /** Detaches without disposing: the geometry and textures are shared by every aircraft. */
  dispose() {
    this.disposed = true;
    this.root.removeFromParent();
  }
}
