import * as T from "three";
import { tree, triangles, type Tree, type Tri } from "./triangle-distance";
import { aureliaBodyAt } from "../src/aircraft/aurelia/exterior-reference";

function nearest(node: Tree, ray: T.Ray, limit = Infinity): number {
  const point = new T.Vector3();
  if (!ray.intersectBox(node.box, point)) return limit;
  if (node.tri) {
    for (const tri of node.tri) {
      if (ray.intersectTriangle(tri.a, tri.b, tri.c, false, point))
        limit = Math.min(limit, point.distanceTo(ray.origin));
    }
    return limit;
  }
  return nearest(node.right!, ray, nearest(node.left!, ray, limit));
}

/** Radial containment against actual pressure-skin triangles, including glazing. */
export function cockpitSkinContainment(root: T.Object3D) {
  root.updateMatrixWorld(true);
  const shell: Tri[] = [];
  root.traverse((o) => {
    if (
      o instanceof T.Mesh &&
      /^(Pressure_shell|Windshield_-?1($|_surround$|_seal$)|Cockpit_side_window_-?1$)/.test(
        o.name,
      )
    )
      shell.push(...triangles(o));
  });
  const frame = root.getObjectByName("Aurelia_Phenom300E") ?? root;
  const hull = tree(shell),
    inverse = frame.matrixWorld.clone().invert();
  const tested = new Set<string>();
  let probes = 0,
    apertureProbes = 0,
    minimumClearanceMetres = Infinity,
    closestPart = "";
  const escapes: { name: string; clearanceMetres: number; point: number[] }[] =
    [];
  for (const name of ["Instrument_panel", "Dashboard_housing"])
    root.getObjectByName(name)!.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const p = o.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const point = new T.Vector3()
          .fromBufferAttribute(p, i)
          .applyMatrix4(o.matrixWorld);
        const key = point
          .toArray()
          .map((v) => v.toFixed(6))
          .join(":");
        if (tested.has(key)) continue;
        tested.add(key);
        const nominal = point.clone().applyMatrix4(inverse);
        const [rx, ry, cy] = aureliaBodyAt(nominal.z);
        const axis = new T.Vector3(0, cy, nominal.z).applyMatrix4(
          frame.matrixWorld,
        );
        const direction = point.clone().sub(axis),
          radius = direction.length();
        let clearance =
          nearest(hull, new T.Ray(axis, direction.divideScalar(radius))) -
          radius;
        // A radial ray through the open nose-gear aperture has no pressure-skin
        // triangle. Check the mathematical hull there and count it separately.
        if (
          !Number.isFinite(clearance) &&
          Math.abs(Math.atan2(nominal.x / rx, (nominal.y - cy) / ry)) > 2.8
        ) {
          const q = (nominal.x / rx) ** 2 + ((nominal.y - cy) / ry) ** 2;
          clearance = radius * (1 / Math.sqrt(q) - 1);
          apertureProbes++;
        }
        probes++;
        if (clearance < minimumClearanceMetres) {
          minimumClearanceMetres = clearance;
          closestPart = o.name;
        }
        if (!Number.isFinite(clearance) || clearance < 0)
          escapes.push({
            name: o.name,
            clearanceMetres: clearance,
            point: point.toArray(),
          });
      }
    });
  return {
    probes,
    apertureProbes,
    minimumClearanceMetres,
    closestPart,
    escapes,
  };
}

/** Two-sided triangles include back faces: an opaque liner must obstruct the view. */
export function cockpitSightlines(root: T.Object3D, eyes: T.Vector3[]) {
  root.updateMatrixWorld(true);
  const panes: Tri[] = [],
    solids: Tri[] = [];
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    if (/^Windshield_-?1$/.test(o.name)) panes.push(...triangles(o));
    else if (!/^Cabin_window_(Left|Right)_\d+$/.test(o.name))
      solids.push(...triangles(o));
  });
  const glass = tree(panes),
    opaque = tree(solids);
  const ray = new T.Ray();
  function outside(eye: T.Vector3, yaw: number, pitch: number) {
    const y = T.MathUtils.degToRad(yaw),
      p = T.MathUtils.degToRad(pitch);
    ray.set(
      eye,
      new T.Vector3(
        Math.sin(y) * Math.cos(p),
        Math.sin(p),
        -Math.cos(y) * Math.cos(p),
      ),
    );
    const pane = nearest(glass, ray);
    return Number.isFinite(pane) && nearest(opaque, ray, pane + 0.00001) > pane;
  }
  return eyes.map((eye) => {
    let samples = 0,
      clear = 0,
      solidAngleSteradians = 0;
    const step = 2;
    for (let yaw = -60; yaw <= 60; yaw += step)
      for (let pitch = -20; pitch <= 34; pitch += step) {
        samples++;
        if (outside(eye, yaw, pitch)) {
          clear++;
          solidAngleSteradians +=
            Math.cos(T.MathUtils.degToRad(pitch)) *
            T.MathUtils.degToRad(step) ** 2;
        }
      }
    const forwardClearPitchDegrees: number[] = [];
    for (let pitch = -20; pitch <= 40; pitch += 0.5)
      if (outside(eye, 0, pitch)) forwardClearPitchDegrees.push(pitch);
    let eyeBoxProbes = 0,
      eyeBoxBlocked = 0;
    for (const dx of [-0.03, 0, 0.03])
      for (const dy of [-0.03, 0, 0.03])
        for (const yaw of [-8, 0, 8])
          for (const pitch of [-4, 0, 4]) {
            eyeBoxProbes++;
            if (!outside(eye.clone().add(new T.Vector3(dx, dy, 0)), yaw, pitch))
              eyeBoxBlocked++;
          }
    return {
      eye: eye.toArray(),
      samples,
      clear,
      solidAngleSteradians,
      horizonClear: outside(eye, 0, 0),
      eyeBoxProbes,
      eyeBoxBlocked,
      forwardClearPitchDegrees,
    };
  });
}
