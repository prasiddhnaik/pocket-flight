import * as T from "three";
import type { AircraftId } from "./aircraft";
import { aircraftSky } from "./aircraft-finish";

// Visual loadouts and small exterior details (nav-light glows, blade antennas,
// pitot probes) for the fighters and the Finch A-2. Everything is hung from the measured skin
// with rays, so it follows the saved airframes. Visual only: the flight
// models' mass budgets still have no stores fitted.

const body = new T.MeshPhysicalMaterial({ name: "Store • missile body", color: "#c9ccc8", roughness: 0.38, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.2 });
const dark = new T.MeshStandardMaterial({ name: "Store • seeker and bands", color: "#2a2f31", roughness: 0.3, metalness: 0.4 });
const band = new T.MeshStandardMaterial({ name: "Store • warhead band", color: "#b8902c", roughness: 0.5 });
const pylonPaint = new T.MeshPhysicalMaterial({ name: "Store • pylon gray", color: "#5d6569", roughness: 0.45, metalness: 0.3, clearcoat: 0.25 });
const probeMetal = new T.MeshStandardMaterial({ name: "Store • probe metal", color: "#9aa0a3", roughness: 0.3, metalness: 0.9 });
const ordnance = new T.MeshPhysicalMaterial({ name: "Store • ordnance olive", color: "#4b5240", roughness: 0.62, metalness: 0.1, clearcoat: 0.15, clearcoatRoughness: 0.5 });
const fuze = new T.MeshStandardMaterial({ name: "Store • live band yellow", color: "#c9a227", roughness: 0.55 });
const podPaint = new T.MeshPhysicalMaterial({ name: "Store • rocket pod gray", color: "#6a6f68", roughness: 0.5, metalness: 0.2, clearcoat: 0.2, clearcoatRoughness: 0.4 });

export type StoreLoad = "aim9-pair" | "aim120" | "bomb-250" | "rocket-pod-7";
export type StoreLayout = {
  /** CAD airframe node: rays only hit this, never effect volumes. */
  airframe: string;
  /** Ray start height below the airframe, glTF units. */
  floor: number;
  /** Mirrored to both wings unless `side` is set (−1 left, 1 right). */
  pylons: { x: number; z: number; load: StoreLoad | null; side?: -1 | 1; id?: string }[];
  /** Pylon chord and drop below the lowest skin point; fighters by default. */
  pylon?: { length: number; drop: number };
  /** Wingtip launch rails carrying an AIM-9. */
  tipRails: boolean;
  /** Set false when the airframe already has its own wingtip lights. */
  tipLights?: boolean;
  fuselage: { x: number; z: number }[];
  /** Hang stores from Store_* stations modelled with the airframe, not from code-built pylons. */
  stations?: boolean;
  tank?: { z: number };
  blades: { z: number; size: number }[];
  pitots: { z: number; y: number }[];
};

const layouts: Partial<Record<AircraftId, StoreLayout>> = {
  f15c: {
    airframe: "F15C_Eagle",
    floor: -1.6,
    pylons: [],
    stations: true,
    tipRails: false,
    fuselage: [],
    tank: { z: -0.6 },
    blades: [
      { z: -1.0, size: 0.32 },
      { z: 2.6, size: 0.22 },
    ],
    pitots: [{ z: -6.7, y: 0.12 }],
  },
  peregrine: {
    airframe: "Peregrine_HX27",
    floor: 0.25,
    pylons: [
      { x: 4.4, z: 2.0, load: "aim120" },
      { x: 6.9, z: 3.2, load: "aim120" },
    ],
    tipRails: true,
    fuselage: [],
    blades: [{ z: 2.5, size: 0.42 }],
    pitots: [],
  },
  stormbird: {
    airframe: "Stormbird_HX40",
    floor: 0.25,
    pylons: [{ x: 3.6, z: 1.9, load: "aim120" }],
    tipRails: true,
    fuselage: [],
    blades: [{ z: 0.6, size: 0.3 }],
    pitots: [],
  },
};

function lathe(profile: [number, number][], material: T.Material) {
  // Profile is (radius, z) from nose (z = 0) aft; the lathe axis becomes +Z.
  const geometry = new T.LatheGeometry(profile.map(([r, z]) => new T.Vector2(r, z)), 24);
  geometry.rotateX(Math.PI / 2);
  return new T.Mesh(geometry, material);
}

function fins(radius: number, z: number, span: number, root: number, tip: number, sweep: number, offset = Math.PI / 4) {
  const shape = new T.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(sweep, span);
  shape.lineTo(sweep + tip, span);
  shape.lineTo(root, 0);
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false });
  geometry.translate(0, radius * 0.9, -0.004);
  // Shape X runs aft along the missile, Y radially out.
  geometry.rotateY(-Math.PI / 2);
  const group = new T.Group();
  for (let i = 0; i < 4; i++) {
    const fin = new T.Mesh(geometry, body);
    fin.rotation.z = offset + (i * Math.PI) / 2;
    fin.position.z = z;
    group.add(fin);
  }
  return group;
}

function aim9() {
  const g = new T.Group();
  const r = 0.0635,
    L = 2.87;
  g.add(lathe([[0, 0], [0.04, 0.025], [0.058, 0.07], [r, 0.12], [r, L - 0.04], [0.05, L]], body));
  const dome = new T.Mesh(new T.SphereGeometry(0.045, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  dome.rotation.x = -Math.PI / 2;
  dome.position.z = 0.03;
  g.add(dome);
  g.add(lathe([[r + 0.002, 0.55], [r + 0.002, 0.62]], band));
  g.add(fins(r, 0.3, 0.12, 0.2, 0.06, 0.1));
  g.add(fins(r, L - 0.42, 0.22, 0.38, 0.16, 0.2));
  return g;
}

function aim120() {
  const g = new T.Group();
  const r = 0.089,
    L = 3.65;
  g.add(lathe([[0, 0], [0.05, 0.08], [0.08, 0.24], [r, 0.38], [r, L - 0.03], [0.07, L]], body));
  g.add(lathe([[r + 0.002, 0.7], [r + 0.002, 0.78]], band));
  g.add(fins(r, 1.55, 0.14, 0.42, 0.1, 0.26));
  g.add(fins(r, L - 0.42, 0.2, 0.4, 0.14, 0.22));
  return g;
}

/** Length and radius of the wing stores, nose at z = 0. */
const BOMB = { length: 1.88, radius: 0.114 },
  POD = { length: 1.62, radius: 0.13 };

function bomb250() {
  // Low-drag 250 lb general-purpose bomb: ogive nose, live-fuze bands and a
  // cruciform tail. Its suspension lugs rise into the pylon.
  const g = new T.Group();
  const { length: L, radius: r } = BOMB;
  g.add(lathe([[0, 0], [0.035, 0.03], [0.075, 0.15], [0.1, 0.3], [r, 0.48], [r, 1.2], [0.085, 1.5], [0.055, L - 0.05], [0, L]], ordnance));
  g.add(lathe([[r + 0.002, 0.34], [r + 0.002, 0.4]], fuze));
  g.add(lathe([[0.104, 0.24], [0.104, 0.27]], fuze));
  const fin = fins(0.06, L - 0.42, 0.13, 0.4, 0.3, 0.1);
  fin.traverse((o) => { if (o instanceof T.Mesh) o.material = ordnance; });
  g.add(fin);
  for (const z of [0.62, 0.98]) {
    const lug = new T.Mesh(new T.BoxGeometry(0.03, 0.06, 0.05), probeMetal);
    lug.position.set(0, r + 0.02, z);
    g.add(lug);
  }
  return g;
}

function rocketPod7() {
  // Seven-tube 2.75 in rocket pod: frangible nose fairing, plain body and an
  // open aft face showing the tube mouths.
  const g = new T.Group();
  const { length: L, radius: r } = POD;
  g.add(lathe([[0.04, 0], [0.08, 0.06], [0.115, 0.18], [r, 0.3], [r, L], [r - 0.012, L]], podPaint));
  g.add(lathe([[r + 0.002, 0.3], [r + 0.002, 0.33]], dark));
  const face = new T.Mesh(new T.CircleGeometry(r - 0.012, 24), dark);
  face.position.z = L - 0.004;
  g.add(face);
  const mouths = new T.MeshStandardMaterial({ name: "Store • rocket tube", color: "#0b0d0e", roughness: 0.9 });
  const tubes = [[0, 0], ...Array.from({ length: 6 }, (_, i) => [Math.cos((i * Math.PI) / 3) * 0.075, Math.sin((i * Math.PI) / 3) * 0.075])];
  for (const [x, y] of tubes) {
    const tube = new T.Mesh(new T.CircleGeometry(0.034, 16), mouths);
    tube.position.set(x, y, L - 0.001);
    g.add(tube);
  }
  return g;
}

const rail = (length: number) => new T.Mesh(new T.BoxGeometry(0.07, 0.07, length), pylonPaint);

function wingPylon(height: number, length = 2.65) {
  // Tapered aerofoil-section pylon, leading edge forward (−Z); top face at y = 0.
  const k = length / 2.65,
    width = Math.min(0.12, 0.05 + 0.07 * k);
  const shape = new T.Shape();
  shape.moveTo(-1.35 * k, 0);
  shape.lineTo(-1.35 * k, -(height - 0.22 * k));
  shape.quadraticCurveTo(-1.35 * k, -height + 0.06 * k, -0.9 * k, -height);
  shape.lineTo(1.0 * k, -height + 0.02 * k);
  shape.lineTo(1.3 * k, -(height - 0.3 * k) * 0.5);
  shape.lineTo(1.3 * k, 0);
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.02 * k, bevelThickness: 0.02 * k, bevelSegments: 2 });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(Math.PI / 2);
  return new T.Mesh(geometry, pylonPaint);
}

/** Pylon strut spanning from `bottom` up to `top`, buried a little in both. */
function strut(width: number, length: number, bottom: number, top: number) {
  const height = top - bottom + 0.06;
  const mesh = new T.Mesh(new T.BoxGeometry(width, height, length), pylonPaint);
  mesh.position.y = bottom - 0.03 + height / 2;
  return mesh;
}

function tank(skin: number) {
  // `skin` is the belly height above the tank axis along the strut.
  const g = new T.Group();
  g.add(lathe([[0, 0], [0.18, 0.3], [0.31, 1.0], [0.33, 2.0], [0.3, 3.4], [0.16, 4.1], [0, 4.4]], pylonPaint));
  g.add(fins(0.31, 3.7, 0.18, 0.4, 0.22, 0.2, 0));
  const neck = strut(0.12, 1.4, 0.3, skin);
  neck.position.z = 2.1;
  g.add(neck);
  return g;
}

function blade(size: number) {
  // Swept UHF blade antenna standing on the spine.
  const shape = new T.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(size * 0.55, size);
  shape.lineTo(size * 0.85, size);
  shape.lineTo(size * 0.9, 0);
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  geometry.translate(0, 0, -0.01);
  geometry.rotateY(-Math.PI / 2);
  return new T.Mesh(geometry, pylonPaint);
}

let glowMap: T.Texture | null | undefined;
function glow() {
  if (glowMap !== undefined) return glowMap;
  const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
  const g = canvas?.getContext?.("2d");
  if (!canvas || typeof g?.createRadialGradient !== "function") return (glowMap = null);
  canvas.width = canvas.height = 64;
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  glowMap = new T.CanvasTexture(canvas);
  return glowMap;
}

function navLight(color: string, size: number) {
  const g = new T.Group();
  g.add(new T.Mesh(new T.SphereGeometry(size * 0.18, 12, 8), new T.MeshBasicMaterial({ color, toneMapped: false })));
  const map = glow();
  if (map) {
    const halo = new T.Sprite(new T.SpriteMaterial({ map, color, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
    halo.scale.setScalar(size * 1.6);
    g.add(halo);
  }
  return g;
}

/** What a store part is fixed to: another part, or the skin above/below/beside it. */
export type StoreMount = T.Object3D | "under-skin" | "over-skin" | "side-skin";
const BURY = 0.025; // every joint overlaps its mount by at least this much

export function addAircraftStores(root: T.Object3D, id: AircraftId, layout = layouts[id]) {
  if (!layout) return null;
  for (const m of [body, dark, band, pylonPaint, probeMetal, ordnance, fuze, podPaint]) m.envMap = aircraftSky();
  root.updateMatrixWorld(true);
  const solids: T.Mesh[] = [];
  const airframe = root.getObjectByName(layout.airframe);
  if (!airframe) return null;
  airframe.traverse((o) => {
    if (o instanceof T.Mesh && !/glass|glazing/i.test((o.material as T.Material).name)) solids.push(o);
  });
  const ray = new T.Raycaster();
  const toLocal = new T.Matrix4().copy(root.matrixWorld).invert();
  const cast = (from: T.Vector3, direction: T.Vector3) => {
    ray.set(from.clone().applyMatrix4(root.matrixWorld), direction.clone().transformDirection(root.matrixWorld));
    const hit = ray.intersectObjects(solids, false)[0];
    return hit ? hit.point.applyMatrix4(toLocal) : null;
  };
  // Skin heights along a store's length (rays up from below / down from above).
  const below = (x: number, z0: number, z1: number) => {
    const ys: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const hit = cast(new T.Vector3(x, layout.floor, z0 + ((z1 - z0) * k) / 8), new T.Vector3(0, 1, 0));
      if (hit) ys.push(hit.y);
    }
    return ys.length === 9 ? { low: Math.min(...ys), high: Math.max(...ys) } : undefined;
  };
  const above = (x: number, z0: number, z1: number) => {
    const ys: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const hit = cast(new T.Vector3(x, 30, z0 + ((z1 - z0) * k) / 8), new T.Vector3(0, -1, 0));
      if (hit) ys.push(hit.y);
    }
    return ys.length === 9 ? { low: Math.min(...ys), high: Math.max(...ys) } : undefined;
  };
  const group = new T.Group();
  group.name = "Stores";
  // `contact` records where a skin mount touches: x and a z-range under or over
  // the skin, or y/z for side mounts. Tests re-cast rays there.
  const add = (part: T.Object3D, mount: StoreMount, contact?: { x?: number; y?: number; z0: number; z1: number }) => {
    part.userData.mount = mount;
    if (contact) part.userData.contact = contact;
    group.add(part);
    return part;
  };
  const bounds = new T.Box3().setFromObject(airframe);
  for (const side of [-1, 1]) {
    for (const p of layout.pylons) {
      if (p.side && p.side !== side) continue;
      const x = side * p.x;
      const { length, drop } = layout.pylon ?? { length: 2.65, drop: 0.3 };
      const k = length / 2.65;
      const skin = below(x, p.z - 1.35 * k, p.z + 1.3 * k);
      if (!skin) continue;
      // Top buried at the highest skin point so the curved wing never shows a gap.
      const top = skin.high + BURY,
        bottom = skin.low - drop;
      const pylon = add(wingPylon(top - bottom, length), "under-skin", { x, z0: p.z - 1.35 * k, z1: p.z + 1.3 * k });
      pylon.position.set(x, top, p.z);
      // Store attachment point, for weapons release.
      pylon.userData.hardpoint = { id: p.id, position: [x, bottom, p.z] };
      if (p.load === "bomb-250" || p.load === "rocket-pod-7") {
        const spec = p.load === "bomb-250" ? BOMB : POD;
        const store = add(p.load === "bomb-250" ? bomb250() : rocketPod7(), pylon);
        store.userData.weaponStore = true;
        store.userData.storeLoad = p.load;
        // Stores ride slightly forward of the pylon, top overlapping its keel.
        store.position.set(x, bottom - spec.radius + BURY, p.z - spec.length * 0.55);
      } else if (p.load === "aim9-pair") {
        // Cross beam under the pylon carries a rail and AIM-9 on each side.
        const beam = add(new T.Mesh(new T.BoxGeometry(0.44, 0.06, 1.8), pylonPaint), pylon);
        beam.position.set(x, bottom - 0.03 + BURY, p.z + 0.1);
        for (const s of [-1, 1]) {
          const launcher = add(rail(2.0), beam);
          launcher.position.set(x + s * 0.17, beam.position.y - 0.03 - 0.035 + BURY, p.z + 0.1);
          const missile = add(aim9(), launcher);
          missile.userData.weaponStore = true;
          missile.position.set(launcher.position.x, launcher.position.y - 0.035 - 0.0635 + BURY, p.z - 1.3);
        }
      } else if (p.load === "aim120") {
        const launcher = add(rail(1.9), pylon);
        launcher.position.set(x, bottom - 0.035 + BURY, p.z);
        const missile = add(aim120(), launcher);
        missile.userData.weaponStore = true;
        missile.position.set(x, launcher.position.y - 0.035 - 0.089 + BURY, p.z - 1.8);
      }
    }
    for (const f of layout.fuselage) {
      const x = side * f.x;
      const skin = below(x, f.z + 0.4, f.z + 3.2);
      if (!skin) continue;
      const missile = add(aim120(), "under-skin", { x, z0: f.z + 0.4, z1: f.z + 3.2 });
      missile.userData.weaponStore = true;
      missile.rotation.z = side * (Math.PI / 4);
      missile.position.set(x, skin.low - 0.12, f.z);
      // Launcher adapter from the missile's back up into the highest skin.
      const adapter = add(strut(0.09, 2.6, skin.low - 0.12 + 0.06, skin.high), "under-skin", { x, z0: f.z + 0.5, z1: f.z + 3.1 });
      adapter.position.x = x;
      adapter.position.z = f.z + 1.8;
      missile.userData.mount = adapter;
    }
    // Wingtip: the outermost vertices of this side's wing meshes.
    const tipPoints: T.Vector3[] = [];
    const vertex = new T.Vector3();
    let reach = 0;
    root.getObjectByName(side < 0 ? "Wing_Left" : "Wing_Right")?.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const position = o.geometry.getAttribute("position");
      const toRoot = new T.Matrix4().multiplyMatrices(toLocal, o.matrixWorld);
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(toRoot);
        if (Math.abs(vertex.x) > reach - 0.05) {
          reach = Math.max(reach, Math.abs(vertex.x));
          tipPoints.push(vertex.clone());
        }
      }
    });
    // Only the straight outer edge: rails and lights mount where the tip is full width.
    const outer = tipPoints.filter((p) => Math.abs(p.x) > reach - 0.02);
    const y = outer.reduce((sum, p) => sum + p.y, 0) / Math.max(1, outer.length);
    // Keep to the part of the edge that is level with the rail.
    const edge = outer.filter((p) => Math.abs(p.y - y) < 0.03);
    if (edge.length) {
      // Inset from the tapered leading and trailing corners.
      const first = Math.min(...edge.map((p) => p.z)),
        last = Math.max(...edge.map((p) => p.z));
      const front = first + (last - first) * 0.08,
        back = last - (last - first) * 0.08;
      const x = side * reach;
      const span = Math.abs(bounds.max.x - bounds.min.x);
      const size = span * 0.012;
      if (layout.tipLights !== false) {
        const light = add(navLight(side < 0 ? "#ff3b2f" : "#3dff8a", size), "side-skin", { y, z0: front + 0.05, z1: front + 0.05 });
        light.position.set(x + side * (size * 0.18 - BURY * 0.5), y, front + 0.05);
      }
      if (layout.tipRails && back - front > 0.6) {
        const launcher = add(rail(back - front), "side-skin", { y, z0: front, z1: back });
        launcher.position.set(x + side * (0.035 - BURY), y, (front + back) / 2);
        const missile = add(aim9(), launcher);
          missile.userData.weaponStore = true;
        missile.position.set(launcher.position.x + side * (0.035 + 0.0635 - BURY), y, (front + back) / 2 - 1.5);
      }
    }
    for (const p of layout.pitots) {
      const skin = cast(new T.Vector3(side * 4, p.y, p.z), new T.Vector3(-side, 0, 0));
      if (!skin) continue;
      // Stalk from inside the skin, then the probe tube running forward.
      const stalk = add(new T.Mesh(new T.CylinderGeometry(0.018, 0.024, 0.09, 8), probeMetal), "side-skin", { y: skin.y, z0: skin.z, z1: skin.z });
      stalk.rotation.z = Math.PI / 2;
      stalk.position.set(skin.x + side * (0.045 - BURY), skin.y, skin.z);
      const probe = add(new T.Mesh(new T.CylinderGeometry(0.01, 0.014, 0.42, 8), probeMetal), stalk);
      probe.rotation.x = Math.PI / 2;
      probe.position.set(stalk.position.x + side * 0.04, skin.y, skin.z - 0.2);
    }
  }
  for (const b of layout.blades) {
    const skin = above(0, b.z, b.z + b.size * 0.9);
    if (!skin) continue;
    const antenna = add(blade(b.size), "over-skin", { x: 0, z0: b.z, z1: b.z + b.size * 0.9 });
    antenna.position.set(0, skin.low - BURY, b.z);
  }
  if (layout.stations) {
    const anchors: T.Object3D[] = [];
    airframe.traverse((node) => {
      if (/^Store_(aim9|aim120)_/.test(node.name)) anchors.push(node);
    });
    for (const station of anchors) {
      const heavy = station.name.startsWith("Store_aim120");
      const mount = root.getObjectByName(station.userData.mount);
      if (!mount) continue;
      const missile = add(heavy ? aim120() : aim9(), mount);
      missile.userData.weaponStore = true;
      const at = station.getWorldPosition(new T.Vector3()).applyMatrix4(toLocal);
      missile.position.copy(at);
      // Body missiles sit rolled 45 degrees so their fins clear the housing.
      if (heavy) missile.rotation.z = Math.sign(at.x) * (Math.PI / 4);
    }
  }
  const tankStation = layout.tank;
  if (tankStation) {
    // Hang the tank below the lowest belly point; its strut runs up into the
    // highest skin along its length, so it is buried, never floating.
    const skin = below(0, tankStation.z + 1.4, tankStation.z + 2.8);
    if (skin) {
      const axis = skin.low - 0.6;
      const centre = add(tank(skin.high - axis), "under-skin", { x: 0, z0: tankStation.z + 1.4, z1: tankStation.z + 2.8 });
      centre.position.set(0, axis, tankStation.z);
    }
  }
  group.traverse((o) => {
    if (o instanceof T.Mesh) o.castShadow = o.receiveShadow = !(o.material instanceof T.MeshBasicMaterial);
  });
  root.add(group);
  return group;
}
