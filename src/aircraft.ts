import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { controlSurfaces } from "./control-surfaces";
export const paints = [
  { name: "Sunrise", color: "#eab34c", dark: "#bc702f" },
  { name: "Lagoon", color: "#48b9b1", dark: "#1f746e" },
  { name: "Coral", color: "#e67862", dark: "#a64335" },
  { name: "Cloud", color: "#e8e4d8", dark: "#7b898b" },
  { name: "Midnight", color: "#526980", dark: "#2a3b50" },
];
export const AIRCRAFT_URL = "/assets/finch-u2.glb";
export function prepareAircraftMaterials(root: T.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      material.envMapIntensity = 0.8;
      if (material.name.startsWith("Glass")) {
        material.transparent = true;
        material.opacity = 0.34;
        material.depthWrite = false;
        material.color.set("#88b3bd");
        material.envMapIntensity = 1.1;
        material.side = T.DoubleSide;
        object.castShadow = false;
        object.renderOrder = 3;
        if (material instanceof T.MeshPhysicalMaterial) {
          // Alpha glazing gives consistent visibility of the modeled cockpit on mobile too.
          material.transmission = 0;
          material.roughness = 0.09;
          material.metalness = 0.18;
          material.clearcoat = 0.9;
        }
      }
    }
  });
}
export function disposeAircraft(root: T.Object3D, disposeTextures = true) {
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    object.geometry.dispose();
    for (const m of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(m);
  });
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof T.Texture) textures.add(value);
    material.dispose();
  }
  if (disposeTextures) textures.forEach((texture) => texture.dispose());
}
export function makeAircraft(paintIndex = 0) {
  const group = new T.Group();
  group.name = "PocketFlight_Finch_U2";
  const disc = new T.Mesh(
    new T.CircleGeometry(1.08, 48),
    new T.MeshBasicMaterial({
      color: "#d7ded9",
      transparent: true,
      opacity: 0.075,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  disc.position.set(0, 0.025, -3.44);
  disc.visible = false;
  group.add(disc);
  let selectedPaint = paintIndex;
  let disposed = false;
  const livery = new Set<T.MeshStandardMaterial>();
  const restPositions = new Map<string, T.Vector3>();
  const controls = new Map<string, T.Object3D>();
  const model = {
    group,
    wings: [new T.Group(), new T.Group()] as T.Object3D[],
    gear: new T.Group() as T.Object3D,
    propeller: new T.Group() as T.Object3D,
    disc,
    ready: Promise.resolve(),
    controls,
    surfaces: controlSurfaces(controls),
    setPaint(index: number) {
      selectedPaint = index;
      livery.forEach((material) => material.color.set(paints[index].color));
    },
    setSuspension(meters: number) {
      const travel = T.MathUtils.clamp(meters, 0, 0.16);
      for (const name of [
        "Suspension_Main_Left",
        "Suspension_Main_Right",
        "Suspension_Nose",
      ]) {
        const node = model.controls.get(name),
          rest = restPositions.get(name);
        if (!node || !rest) continue;
        node.position.copy(rest);
        node.position.y += travel;
        if (name !== "Suspension_Nose")
          node.position.x += (name.endsWith("Left") ? 1 : -1) * travel * 0.65;
      }
    },
    dispose() {
      disposed = true;
      disposeAircraft(group);
    },
  };
  model.ready = new GLTFLoader().loadAsync(AIRCRAFT_URL).then((gltf) => {
    if (disposed) {
      disposeAircraft(gltf.scene);
      return;
    }
    prepareAircraftMaterials(gltf.scene);
    group.add(gltf.scene);
    const part = (name: string) => {
      const node = gltf.scene.getObjectByName(name);
      if (!node) throw new Error(`The Finch aircraft is missing ${name}.`);
      return node;
    };
    model.wings = [part("Wing_Left"), part("Wing_Right")];
    model.gear = part("LandingGear");
    model.propeller = part("Propeller");
    for (const name of [
      "Aileron_Left",
      "Aileron_Right",
      "Flap_Left",
      "Flap_Right",
      "Elevator",
      "Rudder",
      "Wheel_Main_Left",
      "Wheel_Main_Right",
      "Wheel_Front",
      "Front_Wheel_Steering",
      "Suspension_Main_Left",
      "Suspension_Main_Right",
      "Suspension_Nose",
    ])
      model.controls.set(name, part(name));
    gltf.scene.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        if (
          material instanceof T.MeshStandardMaterial &&
          material.name.startsWith("Livery • coastal")
        )
          livery.add(material);
      }
    });
    for (const [name, node] of model.controls)
      restPositions.set(name, node.position.clone());
    model.surfaces.apply(model.surfaces.snapshot());
    model.setPaint(selectedPaint);
  });
  return model;
}
export type AircraftModel = ReturnType<typeof makeAircraft>;
