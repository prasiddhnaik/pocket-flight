import * as T from "three";
import { StormbirdMechanisms } from "../src/stormbird-mechanisms";
import type { LabAircraftId } from "./aircraft";
import { FinchCockpit } from "./finch-cockpit";
import { internalControlMount } from "./internal-control-link";

export type MechanismProgramme =
  "all" | "gear" | "controls" | "power" | "cockpit";
export type MechanismPose = {
  gear: number;
  compression: number;
  roll: number;
  pitch: number;
  yaw: number;
  flaps: number;
  canopy: number;
  power: number;
};
const smooth = T.MathUtils.smoothstep;
const neutral: MechanismPose = {
  gear: 1,
  compression: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
  flaps: 0,
  canopy: 0,
  power: 0,
};
export function mechanismPose(
  time: number,
  programme: MechanismProgramme,
): MechanismPose {
  const t = ((time % 36) + 36) % 36;
  const controls = programme === "all" || programme === "controls";
  const gear = programme === "all" || programme === "gear";
  const cockpit = programme === "all" || programme === "cockpit";
  const power = programme === "all" || programme === "power";
  return {
    gear: gear ? 1 - smooth(t, 6, 13) + smooth(t, 21, 28) : 1,
    compression: gear ? 0.5 + 0.5 * Math.sin(t * 0.9) : 0,
    roll: controls ? Math.sin(t * 0.65) * 0.85 : 0,
    pitch: controls ? Math.sin(t * 0.45 + 0.8) * 0.75 : 0,
    yaw: controls || gear ? Math.sin(t * 0.5) * 0.8 : 0,
    flaps: controls ? 0.5 + 0.5 * Math.sin(t * 0.25 - Math.PI / 2) : 0,
    canopy: cockpit
      ? smooth(t, 0, 2) -
        smooth(t, 4, 6) +
        smooth(t, 30, 33) -
        smooth(t, 34, 36)
      : 0,
    power: power ? smooth(t, 6, 12) * (1 - smooth(t, 24, 30)) : 0,
  };
}

type Anchor = { node: T.Object3D; point: T.Vector3 };
type Rest = {
  node: T.Object3D;
  position: T.Vector3;
  quaternion: T.Quaternion;
  scale: T.Vector3;
};
type PoolName = "alloy" | "chrome" | "hose" | "black" | "light";
type Slot = { pool: T.InstancedMesh; index: number };
const up = new T.Vector3(0, 1, 0);

function nozzlePetal(radius: number) {
  const geometry = new T.BufferGeometry(),
    positions = new T.Float32BufferAttribute(new Float32Array(270), 3);
  positions.setUsage(T.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  const indices: number[] = [],
    quad = (a: number, b: number, c: number, d: number) =>
      indices.push(a, b, c, a, c, d);
  for (let layer = 0; layer < 2; layer++)
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 8; col++) {
        const a = layer * 45 + row * 9 + col;
        if (layer === 0) quad(a, a + 1, a + 10, a + 9);
        else quad(a, a + 9, a + 10, a + 1);
      }
  for (let col = 0; col < 8; col++) {
    quad(col, col + 45, col + 46, col + 1);
    quad(36 + col, 37 + col, 82 + col, 81 + col);
  }
  for (let row = 0; row < 4; row++) {
    const a = row * 9;
    quad(a, a + 9, a + 54, a + 45);
    quad(a + 8, a + 53, a + 62, a + 17);
  }
  geometry.setIndex(indices);
  let previous = -1;
  return {
    geometry,
    shape(aperture: number) {
      if (previous === aperture) return;
      previous = aperture;
      for (let layer = 0; layer < 2; layer++)
        for (let row = 0; row < 5; row++)
          for (let col = 0; col < 9; col++) {
            const t = row / 4,
              r = T.MathUtils.lerp(radius, aperture, t),
              angle = (((col / 8 - 0.5) * Math.PI) / 8) * 0.99;
            positions.setXYZ(
              layer * 45 + row * 9 + col,
              Math.sin(angle) * r,
              t - 0.5,
              (Math.cos(angle) - 1) * r + (layer === 0 ? 0.004 : -0.004),
            );
          }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      const normals = geometry.getAttribute("normal");
      if (normals instanceof T.BufferAttribute)
        normals.setUsage(T.DynamicDrawUsage);
    },
  };
}

/** Instanced hardware follows native hinges; every hose/ram shares five draw calls. */
export class AircraftMechanics {
  private cockpit: FinchCockpit | null = null;
  readonly details = new T.Group();
  private pools = new Map<PoolName, T.InstancedMesh>();
  private nodes = new Map<string, T.Object3D>();
  private rest: Rest[] = [];
  private mechanisms?: StormbirdMechanisms;
  private mixer?: T.AnimationMixer;
  private gearDuration = 0;
  private legs: { node: T.Object3D; side: number; nose: boolean }[] = [];
  private carriers: { node: T.Object3D; rest: T.Vector3; nose: boolean }[] = [];
  private doors: { node: T.Object3D; side: number }[] = [];
  private canopies: { node: T.Object3D; side: number; axis: "x" | "z" }[] = [];
  private wheels: T.Object3D[] = [];
  private fans: T.Object3D[] = [];
  private sticks: T.Object3D[] = [];
  private throttles: T.Object3D[] = [];
  private pedals: { node: T.Object3D; side: number }[] = [];
  private moving = new Set<T.Object3D>();
  private hardwareUpdates: (() => void)[] = [];
  private inverse = new T.Matrix4();
  private matrix = new T.Matrix4();
  private quaternion = new T.Quaternion();
  private a = new T.Vector3();
  private b = new T.Vector3();
  private direction = new T.Vector3();
  private midpoint = new T.Vector3();
  private scale = new T.Vector3();
  private pose = { ...neutral };
  private time = 0;
  private partCount = 0;
  private nozzlePetals?: T.InstancedMesh;

  constructor(
    readonly root: T.Object3D,
    readonly id: LabAircraftId,
    clips: T.AnimationClip[] = [],
  ) {
    root.updateWorldMatrix(true, true);
    root.traverse((node) => this.nodes.set(node.name, node));
    this.details.name = "Mechanical_detail_pack";
    root.add(this.details);
    const cylinder = new T.CylinderGeometry(1, 1, 1, 32);
    const colors = {
      alloy: new T.MeshStandardMaterial({
        color: "#677a82",
        metalness: 0.82,
        roughness: 0.3,
      }),
      chrome: new T.MeshStandardMaterial({
        color: "#c7d5d9",
        metalness: 0.94,
        roughness: 0.17,
      }),
      hose: new T.MeshStandardMaterial({
        color: "#171f24",
        metalness: 0.08,
        roughness: 0.75,
      }),
      black: new T.MeshStandardMaterial({
        color: "#243139",
        metalness: 0.45,
        roughness: 0.42,
      }),
      light: new T.MeshStandardMaterial({
        color: "#9abdc2",
        emissive: "#3f727a",
        emissiveIntensity: 0.45,
        metalness: 0.35,
        roughness: 0.32,
      }),
    };
    for (const name of Object.keys(colors) as PoolName[]) {
      const mesh = new T.InstancedMesh(cylinder, colors[name], 512);
      mesh.name = `Mechanical_${name}`;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.userData.mechanical = true;
      this.details.add(mesh);
      this.pools.set(name, mesh);
    }
    this.bindNative(clips);
    this.addControlRams();
    this.addGearHardware();
    this.addCockpitControls();
    this.addNozzles();
    this.captureRest();
    this.apply(neutral, 0);
  }

  private mark(node: T.Object3D | undefined) {
    if (!node) return;
    node.userData.mechanical = true;
    this.moving.add(node);
    return node;
  }
  private pivot(node: T.Object3D, point: T.Vector3, name: string) {
    const group = new T.Group();
    group.name = name;
    group.position.copy(point);
    this.root.add(group);
    this.root.updateWorldMatrix(true, true);
    group.attach(node);
    this.mark(group);
    return group;
  }
  private native(node: T.Object3D, point = new T.Vector3()) {
    this.inverse.copy(this.root.matrixWorld).invert();
    return point
      .clone()
      .applyMatrix4(node.matrixWorld)
      .applyMatrix4(this.inverse);
  }
  private bounds(node: T.Object3D) {
    const result = new T.Box3();
    this.inverse.copy(this.root.matrixWorld).invert();
    node.traverse((child) => {
      if (!(child instanceof T.Mesh)) return;
      child.geometry.computeBoundingBox();
      result.union(
        child.geometry
          .boundingBox!.clone()
          .applyMatrix4(
            new T.Matrix4().multiplyMatrices(this.inverse, child.matrixWorld),
          ),
      );
    });
    return result;
  }
  private anchor(node: T.Object3D, point: T.Vector3): Anchor {
    return {
      node,
      point: node.worldToLocal(this.root.localToWorld(point.clone())),
    };
  }
  private read(anchor: Anchor, out: T.Vector3) {
    return out
      .copy(anchor.point)
      .applyMatrix4(anchor.node.matrixWorld)
      .applyMatrix4(this.inverse);
  }
  private slot(name: PoolName): Slot {
    const pool = this.pools.get(name)!;
    if (pool.count >= 512) throw new Error("Mechanical hardware pool exceeded");
    this.partCount++;
    return { pool, index: pool.count++ };
  }
  private segment(slot: Slot, a: T.Vector3, b: T.Vector3, radius: number) {
    this.direction.subVectors(b, a);
    const length = this.direction.length();
    this.quaternion.setFromUnitVectors(
      up,
      this.direction.multiplyScalar(1 / Math.max(length, 1e-8)),
    );
    this.midpoint.addVectors(a, b).multiplyScalar(0.5);
    this.scale.set(radius, Math.max(length, 1e-6), radius);
    this.matrix.compose(this.midpoint, this.quaternion, this.scale);
    slot.pool.setMatrixAt(slot.index, this.matrix);
  }
  private fitting(
    node: T.Object3D,
    center: T.Vector3,
    radius: number,
    length: number,
    axis = new T.Vector3(1, 0, 0),
    pool: PoolName = "chrome",
  ) {
    const a = this.anchor(
      node,
      center.clone().addScaledVector(axis, -length / 2),
    );
    const b = this.anchor(
      node,
      center.clone().addScaledVector(axis, length / 2),
    );
    const slot = this.slot(pool);
    this.hardwareUpdates.push(() =>
      this.segment(slot, this.read(a, this.a), this.read(b, this.b), radius),
    );
    return slot;
  }
  private ram(fixed: Anchor, moving: Anchor, radius: number) {
    const barrel = this.slot("alloy"),
      piston = this.slot("chrome");
    const a = new T.Vector3(),
      b = new T.Vector3(),
      end = new T.Vector3(),
      begin = new T.Vector3(),
      direction = new T.Vector3();
    const restLength = this.read(fixed, a).distanceTo(this.read(moving, b));
    this.hardwareUpdates.push(() => {
      this.read(fixed, a);
      this.read(moving, b);
      const length = a.distanceTo(b);
      direction.subVectors(b, a).normalize();
      end
        .copy(a)
        .addScaledVector(direction, Math.min(restLength * 0.56, length * 0.8));
      begin.copy(end).addScaledVector(direction, -restLength * 0.12);
      this.segment(barrel, a, end, radius);
      this.segment(piston, begin, b, radius * 0.48);
    });
  }
  private hose(fixed: Anchor, moving: Anchor, radius: number) {
    const slots = Array.from({ length: 8 }, () => this.slot("hose"));
    const a = new T.Vector3(),
      b = new T.Vector3(),
      bend = new T.Vector3(),
      from = new T.Vector3(),
      to = new T.Vector3();
    this.hardwareUpdates.push(() => {
      this.read(fixed, a);
      this.read(moving, b);
      bend.addVectors(a, b).multiplyScalar(0.5);
      bend.z -= a.distanceTo(b) * 0.35;
      from.copy(a);
      slots.forEach((slot, i) => {
        const t = (i + 1) / slots.length;
        to.copy(a)
          .multiplyScalar((1 - t) ** 2)
          .addScaledVector(bend, 2 * (1 - t) * t)
          .addScaledVector(b, t * t);
        this.segment(slot, from, to, radius);
        from.copy(to);
      });
    });
  }
  private scissor(fixed: Anchor, moving: Anchor, radius: number) {
    const upper = this.slot("alloy"),
      lower = this.slot("alloy"),
      pin = this.slot("chrome");
    const a = new T.Vector3(),
      b = new T.Vector3(),
      elbow = new T.Vector3(),
      direction = new T.Vector3(),
      perpendicular = new T.Vector3(),
      end = new T.Vector3();
    const length = this.read(fixed, a).distanceTo(this.read(moving, b)) * 0.63;
    this.hardwareUpdates.push(() => {
      this.read(fixed, a);
      this.read(moving, b);
      direction.subVectors(b, a);
      const distance = direction.length();
      perpendicular
        .set(0, 0, -1)
        .addScaledVector(
          direction,
          direction.z / Math.max(distance * distance, 1e-8),
        )
        .normalize();
      elbow
        .addVectors(a, b)
        .multiplyScalar(0.5)
        .addScaledVector(
          perpendicular,
          Math.sqrt(Math.max(0, length * length - (distance * distance) / 4)),
        );
      this.segment(upper, a, elbow, radius);
      this.segment(lower, elbow, b, radius);
      this.a.copy(elbow);
      this.a.x -= radius * 2;
      end.copy(elbow);
      end.x += radius * 2;
      this.segment(pin, this.a, end, radius * 1.4);
    });
  }

  private bindNative(clips: T.AnimationClip[]) {
    for (const node of this.nodes.values()) {
      if (
        /^(Aileron|Flap|Elevator|Rudder|Canard)(_(Left|Right))?$/.test(
          node.name,
        ) ||
        /retraction_hinge|door_hinge/.test(node.name)
      )
        this.mark(node);
      if (
        !(node instanceof T.Mesh) &&
        /^(Wheel_|Main_wheel_|Nose_wheel_|Main_gear_(Left|Right)_wheel_|Nose_gear_wheel_)/.test(
          node.name,
        )
      ) {
        this.mark(node);
        this.wheels.push(node);
      }
      if (/^(Propeller|Compressor_-?1|Fan_Left|Fan_Right)$/.test(node.name)) {
        this.mark(node);
        this.fans.push(node);
      }
    }
    if (this.id === "stormbird") {
      this.mechanisms = new StormbirdMechanisms(this.root);
      for (const node of this.nodes.values())
        if (
          !(node instanceof T.Mesh) &&
          /gear|door|Canopy|actuator|torque_link|brace|scissor_pin|steering/.test(
            node.name,
          )
        )
          this.mark(node);
    } else if (this.id === "aurelia") {
      const tracks = clips
        .flatMap((c) => c.tracks)
        .filter((t) => /retraction_hinge|door_hinge/.test(t.name));
      if (!tracks.length)
        throw new Error("Aurelia native gear tracks are missing");
      this.mixer = new T.AnimationMixer(this.root);
      const clip = new T.AnimationClip("Native gear inspection", -1, [
        ...new Map(tracks.map((t) => [t.name, t])).values(),
      ]);
      this.gearDuration = clip.duration;
      const action = this.mixer.clipAction(clip);
      action.setLoop(T.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
    } else if (this.id === "peregrine") {
      for (const [name, point, side, nose] of [
        ["Nose_steering", [0, 1.72, -7.05], 0, true],
        ["Main_gear_Left", [-1.25, 2.16, 2.15], -1, false],
        ["Main_gear_Right", [1.25, 2.16, 2.15], 1, false],
      ] as const) {
        const node = this.nodes.get(name);
        if (node)
          this.legs.push({
            node: this.pivot(
              node,
              new T.Vector3(...point),
              `Mechanical_hinge_${name}`,
            ),
            side,
            nose,
          });
      }
      for (const node of this.nodes.values())
        if (/^(Nose|Main)_door_(Left|Right)$/.test(node.name)) {
          this.mark(node);
          this.doors.push({ node, side: node.name.endsWith("Left") ? -1 : 1 });
        }
    }
    if (this.id === "finch") {
      const cabin = this.nodes.get("Cockpit");
      if (cabin?.userData.revision) {
        this.cockpit = new FinchCockpit(cabin);
        for (const node of this.cockpit.moving) this.mark(node);
      }
      for (const name of [
        "Suspension_Main_Left",
        "Suspension_Main_Right",
        "Suspension_Nose",
      ]) {
        const node = this.mark(this.nodes.get(name));
        if (node)
          this.carriers.push({
            node,
            rest: node.position.clone(),
            nose: name === "Suspension_Nose",
          });
      }
    } else if (this.id === "peregrine") {
      const canopy = this.nodes.get("Canopy");
      if (canopy)
        this.canopies.push({
          node: this.pivot(
            canopy,
            new T.Vector3().fromArray(canopy.userData.hinge_glTF),
            "Mechanical_canopy",
          ),
          side: 1,
          axis: "x",
        });
    }
    if (this.id === "peregrine" || this.id === "aurelia") {
      for (const name of [
        "Main_gear_Left",
        "Main_gear_Right",
        "Nose_steering",
      ]) {
        const node = this.nodes.get(name);
        if (!node) continue;
        const carrier = new T.Group();
        carrier.name = `Mechanical_oleo_${name}`;
        node.add(carrier);
        this.root.updateWorldMatrix(true, true);
        for (const wheel of this.wheels.filter((w) => w.parent === node))
          carrier.attach(wheel);
        this.mark(carrier);
        this.carriers.push({
          node: carrier,
          rest: carrier.position.clone(),
          nose: name === "Nose_steering",
        });
      }
    }
    this.mark(this.nodes.get("Nose_steering"));
    this.mark(this.nodes.get("Front_Wheel_Steering"));
  }

  private addControlRams() {
    for (const node of this.nodes.values()) {
      if (
        !/^(Aileron|Flap|Elevator|Rudder|Canard)(_(Left|Right))?$/.test(
          node.name,
        )
      )
        continue;
      const box = this.bounds(node),
        point = box.getCenter(new T.Vector3());
      if (box.isEmpty()) continue;
      const hinge = this.native(node),
        parent = node.parent!;
      if (this.id === "finch" && /^(Aileron|Flap)_/.test(node.name)) {
        const mount = internalControlMount(this.root, node);
        const fixed = this.anchor(parent, mount.fixed);
        const moving = this.anchor(node, mount.moving);
        const rod = this.slot("alloy");
        this.hardwareUpdates.push(() =>
          this.segment(rod, this.read(fixed, this.a), this.read(moving, this.b), 0.005),
        );
        const horn = this.fitting(node, mount.moving, 0.007, 0.020);
        const bearing = this.fitting(parent, mount.fixed, 0.009, 0.025);
        for (const slot of [rod, horn, bearing]) {
          slot.pool.userData.internalControlInstances ??= [];
          slot.pool.userData.internalControlInstances.push({ index: slot.index, control: node.name });
        }
        continue;
      }
      point.x = hinge.x * 0.35 + point.x * 0.65;
      const vertical = node.name.startsWith("Rudder");
      if (vertical) {
        point.x += 0.06;
        point.y = hinge.y + (point.y - hinge.y) * 0.35;
      } else point.y = box.min.y - 0.035;
      const fixed = point.clone();
      fixed.z = hinge.z - 0.25;
      this.ram(
        this.anchor(parent, fixed),
        this.anchor(node, point),
        this.id === "finch" ? 0.029 : 0.045,
      );
      this.fitting(node, point, 0.045, 0.09);
      this.hose(
        this.anchor(parent, fixed.clone().add(new T.Vector3(0.035, 0, -0.1))),
        this.anchor(node, point),
        0.007,
      );
    }
    for (const { node } of this.canopies) {
      const hinge = this.native(node),
        box = this.bounds(node);
      for (const sign of [-1, 1]) {
        const moving = box.getCenter(new T.Vector3());
        moving.x =
          hinge.x + sign * Math.min(0.45, box.getSize(new T.Vector3()).x * 0.3);
        const fixed = hinge.clone();
        fixed.x = moving.x;
        fixed.y -= 0.18;
        fixed.z -= 0.4;
        this.ram(
          this.anchor(this.root, fixed),
          this.anchor(node, moving),
          0.025,
        );
      }
    }
    for (const node of this.nodes.values()) {
      if (
        !/^(Nose|Main)_door_/.test(node.name) &&
        !/door_hinge/.test(node.name)
      )
        continue;
      if (node instanceof T.Mesh) continue;
      const box = this.bounds(node);
      if (box.isEmpty()) continue;
      const moving = box.getCenter(new T.Vector3()),
        fixed = this.native(node);
      fixed.y += 0.12;
      fixed.z -= 0.22;
      this.ram(
        this.anchor(node.parent!, fixed),
        this.anchor(node, moving),
        0.026,
      );
    }
  }

  private addGearHardware() {
    this.root.updateWorldMatrix(true, true);
    const assemblies =
      this.id === "finch"
        ? ["Gear_Main_Left", "Gear_Main_Right", "Gear_Nose"]
        : ["Main_gear_Left", "Main_gear_Right", "Nose_gear", "Nose_steering"];
    for (const name of assemblies) {
      const leg = this.nodes.get(name);
      if (!leg || (name === "Nose_steering" && this.nodes.has("Nose_gear")))
        continue;
      const tires = this.wheels.filter((w) => {
        let n: T.Object3D | null = w;
        while (n) {
          if (n === leg) return true;
          n = n.parent;
        }
        return false;
      });
      if (!tires.length) continue;
      const box = this.bounds(leg),
        wheel = tires[0],
        axle = this.native(wheel),
        size = this.bounds(wheel).getSize(new T.Vector3());
      const radius = size.y / 2,
        x = box.getCenter(new T.Vector3()).x;
      const top = axle.clone();
      top.x = x;
      top.y += radius * 2.05;
      top.z -= radius * 0.15;
      const lower = axle.clone();
      lower.x = x;
      lower.y += radius * 0.4;
      lower.z -= radius * 0.15;
      const carrier =
        this.carriers.find((c) => {
          let n: T.Object3D | null = c.node;
          while (n) {
            if (n === leg) return true;
            n = n.parent;
          }
          return false;
        })?.node ??
        (this.id === "stormbird"
          ? this.nodes.get(
              name === "Nose_gear" ? "Nose_steering" : name + "_suspension",
            )
          : wheel.parent)!;
      this.ram(
        this.anchor(leg, top),
        this.anchor(carrier, lower),
        radius * 0.19,
      );
      const torqueTop = top.clone();
      torqueTop.x += radius * 0.22;
      torqueTop.y -= radius * 0.1;
      const torqueBottom = lower.clone();
      torqueBottom.x = torqueTop.x;
      if (this.id !== "stormbird")
        this.scissor(
          this.anchor(leg, torqueTop),
          this.anchor(carrier, torqueBottom),
          radius * 0.07,
        );
      this.hose(
        this.anchor(
          leg,
          top.clone().add(new T.Vector3(radius * 0.25, 0, 0.02)),
        ),
        this.anchor(
          carrier,
          lower.clone().add(new T.Vector3(radius * 0.28, -radius * 0.35, 0.1)),
        ),
        radius * 0.028,
      );
      for (const tire of tires) {
        const center = this.native(tire),
          wheelSize = this.bounds(tire).getSize(new T.Vector3()),
          r = wheelSize.y / 2;
        // A stationary caliper follows suspension/steering; the drilled rotor follows the wheel.
        const rotor = center.clone();
        rotor.x += Math.sign(center.x || 1) * wheelSize.x * 0.38;
        this.fitting(
          tire,
          rotor,
          r * 0.49,
          r * 0.06,
          new T.Vector3(1, 0, 0),
          "alloy",
        );
        for (let i = 0; i < 10; i++) {
          const angle = (i * Math.PI) / 5,
            hole = rotor.clone();
          hole.y += Math.cos(angle) * r * 0.37;
          hole.z += Math.sin(angle) * r * 0.37;
          this.fitting(
            tire,
            hole,
            r * 0.024,
            r * 0.068,
            new T.Vector3(1, 0, 0),
            "black",
          );
        }
        const caliper = rotor.clone();
        caliper.y += r * 0.34;
        this.fitting(
          carrier,
          caliper,
          r * 0.14,
          r * 0.38,
          new T.Vector3(0, 0, 1),
          "black",
        );
        this.fitting(
          carrier,
          top,
          radius * 0.26,
          radius * 0.08,
          new T.Vector3(0, 1, 0),
        );
      }
    }
    for (const { node, side, nose } of this.legs) {
      const pivot = this.native(node),
        moving = pivot.clone();
      moving.y -= nose ? 0.65 : 0.9;
      const fixed = pivot.clone();
      fixed.x += side * 0.35;
      fixed.z += nose ? -0.4 : 0.65;
      this.ram(this.anchor(this.root, fixed), this.anchor(node, moving), 0.052);
    }
  }

  private addCockpitControls() {
    // Finch already has authored cockpit hardware. Guessed additional controls
    // duplicate it and have no verified seat/panel clearance or mounting points.
    if (this.id === "finch") return;
    const config = {
      peregrine: {
        stick: [0, 4.1, -9.0],
        throttle: [-0.7, 4.25, -9.66],
        pedals: [0, 3.98, -10.18],
        unit: 0.32,
      },
      aurelia: {
        stick: [0.55, 3.85, -10.0],
        throttle: [0, 3.95, -10.25],
        pedals: [0.55, 3.35, -10.7],
        unit: 0.3,
      },
      stormbird: {
        stick: [0, 2.21, -4.58],
        throttle: [-0.32, 2.2, -4.76],
        pedals: [0, 2.0, -5.01],
        unit: 0.22,
      },
    }[this.id];
    const make = (name: string, position: number[]) => {
      const g = new T.Group();
      g.name = name;
      g.position.fromArray(position);
      this.root.add(g);
      this.mark(g);
      return g;
    };
    const stick = make("Mechanical_control_stick", config.stick),
      throttle = make("Mechanical_throttle", config.throttle);
    this.root.updateWorldMatrix(true, true);
    this.sticks.push(stick);
    this.throttles.push(throttle);
    const rod = (
      node: T.Object3D,
      end: T.Vector3,
      radius: number,
      pool: PoolName,
    ) => {
      const start = this.native(node),
        tip = this.native(node, end);
      const a = this.anchor(node, start),
        b = this.anchor(node, tip),
        slot = this.slot(pool);
      this.hardwareUpdates.push(() =>
        this.segment(slot, this.read(a, this.a), this.read(b, this.b), radius),
      );
    };
    rod(stick, new T.Vector3(0, config.unit, 0), 0.019, "alloy");
    rod(stick, new T.Vector3(0, config.unit * 1.25, 0.018), 0.038, "black");
    rod(throttle, new T.Vector3(0, config.unit * 0.65, 0), 0.016, "chrome");
    rod(throttle, new T.Vector3(0, config.unit * 0.84, 0), 0.037, "black");
    this.fitting(
      throttle,
      this.native(throttle, new T.Vector3(0.024, config.unit * 0.84, -0.02)),
      0.009,
      0.012,
      new T.Vector3(0, 0, 1),
      "light",
    );
    for (const side of [-1, 1]) {
      const p = [...config.pedals];
      p[0] += side * config.unit * 0.6;
      const pedal = make(`Mechanical_pedal_${side}`, p);
      this.pedals.push({ node: pedal, side });
      this.root.updateWorldMatrix(true, true);
      rod(pedal, new T.Vector3(0, 0.065, 0.04), 0.03, "alloy");
    }
  }

  private addNozzles() {
    if (this.id !== "peregrine" && this.id !== "stormbird") return;
    const config =
      this.id === "peregrine"
        ? { x: 0.91, y: 2.88, z: 13.74, radius: 0.8, length: 0.9 }
        : { x: 1.28, y: 1.9, z: 7.93, radius: 0.46, length: 0.53 };
    const petal = nozzlePetal(config.radius);
    const petals = new T.InstancedMesh(
      petal.geometry,
      new T.MeshStandardMaterial({
        color: "#777b82",
        metalness: 0.9,
        roughness: 0.32,
      }),
      32,
    );
    petals.name = "Articulated_nozzle_petals";
    petals.frustumCulled = false;
    petals.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.details.add(petals);
    this.nozzlePetals = petals;
    this.partCount += 32;
    for (let i = 0; i < 32; i++)
      petals.setColorAt(i, new T.Color(i % 3 === 0 ? "#a8b6bf" : "#c5c5bf"));
    const front = new T.Vector3(),
      back = new T.Vector3(),
      tangent = new T.Vector3(),
      along = new T.Vector3(),
      normal = new T.Vector3(),
      center = new T.Vector3();
    this.hardwareUpdates.push(() => {
      const aperture = config.radius * (0.83 + this.pose.power * 0.14);
      petal.shape(aperture);
      for (const [engine, side] of [-1, 1].entries())
        for (let i = 0; i < 16; i++) {
          const angle = (i * Math.PI) / 8,
            c = Math.cos(angle),
            s = Math.sin(angle);
          front.set(
            side * config.x + c * config.radius,
            config.y + s * config.radius,
            config.z - config.length,
          );
          back.set(
            side * config.x + c * aperture,
            config.y + s * aperture,
            config.z + 0.025,
          );
          tangent.set(-s, c, 0);
          along.subVectors(back, front).normalize();
          normal.crossVectors(tangent, along).normalize();
          this.matrix.makeBasis(tangent, along, normal);
          this.matrix.scale(this.scale.set(1, front.distanceTo(back), 1));
          center.addVectors(front, back).multiplyScalar(0.5);
          this.matrix.setPosition(center);
          petals.setMatrixAt(engine * 16 + i, this.matrix);
        }
      petals.instanceMatrix.needsUpdate = true;
    });
  }

  private captureRest() {
    this.rest = [...this.moving].map((node) => ({
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    }));
  }
  apply(pose: MechanismPose, time: number) {
    this.pose = { ...pose };
    this.time = time;
    for (const rest of this.rest) {
      rest.node.position.copy(rest.position);
      rest.node.quaternion.copy(rest.quaternion);
      rest.node.scale.copy(rest.scale);
    }
    const rotate = (name: string, axis: "x" | "y", angle: number) => {
      const node = this.nodes.get(name);
      if (!node) return;
      const datum = node.userData.hinge_axis;
      if (Array.isArray(datum))
        node.quaternion.setFromAxisAngle(
          this.direction.fromArray(datum).normalize(),
          angle,
        );
      else node.rotation[axis] = angle;
    };
    rotate("Aileron_Left", "x", pose.roll * 0.38);
    rotate("Aileron_Right", "x", -pose.roll * 0.38);
    rotate("Elevator", "x", -pose.pitch * 0.4);
    rotate("Rudder", "y", pose.yaw * 0.42);
    for (const side of ["Left", "Right"]) {
      rotate(`Elevator_${side}`, "x", -pose.pitch * 0.35);
      rotate(`Rudder_${side}`, "y", pose.yaw * 0.38);
      rotate(`Canard_${side}`, "x", pose.pitch * 0.28);
      rotate(`Flap_${side}`, "x", pose.flaps * 0.48);
    }
    const extension = this.id === "finch" ? 1 : pose.gear;
    const pressure = 0.16 * pose.compression * smooth(extension, 0.8, 1);
    if (this.mechanisms) {
      this.mechanisms.setSuspension(pressure);
      this.mechanisms.apply(extension, pose.canopy, pose.yaw);
    }
    if (this.mixer)
      this.mixer.setTime(
        (1 - extension) * Math.max(0, this.gearDuration - 0.001),
      );
    for (const leg of this.legs) {
      const fold = smooth(1 - extension, 0.12, 0.88);
      leg.node.rotation[leg.nose ? "x" : "z"] = leg.nose
        ? -fold * 1.48
        : -leg.side * fold * 2.8;
    }
    for (const door of this.doors)
      door.node.rotation.z = -door.side * smooth(1 - extension, 0.88, 1) * 1.35;
    for (const c of this.carriers) {
      c.node.position.copy(c.rest);
      c.node.position.y += pressure;
      if (this.id === "finch" && !c.nose)
        c.node.position.x -= Math.sign(c.rest.x) * pressure * 0.65;
    }
    rotate("Front_Wheel_Steering", "y", pose.yaw * 0.4);
    rotate("Nose_steering", "y", pose.yaw * 0.32 * smooth(extension, 0.8, 1));
    for (const canopy of this.canopies)
      canopy.node.rotation[canopy.axis] = pose.canopy * canopy.side * 0.65;
    // Deliberately slow rotation exposes blades and brake hardware in an inspection environment.
    for (const fan of this.fans) fan.rotation.z = time * 2.4;
    for (const wheel of this.wheels)
      wheel.rotation.x = -time * 1.2 * (pose.compression > 0 ? 1 : 0);
    for (const stick of this.sticks) {
      stick.rotation.x = pose.pitch * 0.22;
      stick.rotation.z = -pose.roll * 0.18;
    }
    for (const throttle of this.throttles)
      throttle.rotation.x = -0.65 * pose.power;
    for (const pedal of this.pedals)
      pedal.node.position.z += pedal.side * pose.yaw * 0.05;
    this.cockpit?.apply(pose);
    this.root.updateWorldMatrix(true, true);
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const update of this.hardwareUpdates) update();
    for (const pool of this.pools.values())
      pool.instanceMatrix.needsUpdate = true;
  }
  reset() {
    this.apply(neutral, 0);
  }
  getMovingRoots() {
    return [...this.moving].sort((a, b) => {
      const depth = (n: T.Object3D) => {
        let d = 0;
        for (let p = n.parent; p; p = p.parent) d++;
        return d;
      };
      return depth(b) - depth(a);
    });
  }
  diagnostics() {
    return {
      id: this.id,
      time: this.time,
      pose: this.pose,
      hardwareParts: this.partCount,
      internalSystems: this.nodes.has("BellyFuelBay") ? {
        rearBulkhead: this.nodes.has("RearCabinBulkhead"),
        dryEquipmentBay: this.nodes.has("AftEquipmentBay"),
        fuelEnvelopeLitres: this.nodes.get("BellyFuelBay")!.userData.envelope_litres,
        usableFuelLitres: this.nodes.get("BellyFuelBay")!.userData.usable_fuel_litres,
        fuelCentroid: this.nodes.get("BellyFuelBay")!.userData.fuel_centroid_glTF,
      } : null,
      articulatedAssemblies: this.moving.size,
      fixedGear: this.id === "finch",
      actualGearExtension: this.id === "finch" ? 1 : this.pose.gear,
      cockpit: this.cockpit?.diagnostics() ?? null,
    };
  }
  focus(name: "gear" | "controls" | "power" | "cockpit") {
    if (name === "power" && this.nozzlePetals) {
      this.nozzlePetals.computeBoundingBox();
      return this.nozzlePetals;
    }
    const keys =
      name === "gear"
        ? ["Gear_Main_Right", "Main_gear_Right"]
        : name === "controls"
          ? ["Wing_Right"]
          : name === "power"
            ? ["Propeller", "Engine_Right", "Compressor_1"]
            : ["Canopy", "Cockpit"];
    return keys.map((key) => this.nodes.get(key)).find(Boolean) ?? this.root;
  }
}
