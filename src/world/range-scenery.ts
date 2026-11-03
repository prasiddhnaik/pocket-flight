import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { rangeLayout } from "./range-island";

// The island and its dressing load with each world. The game and Replay Studio
// both build one, so the dummies are a single shared cache, cloned per flight.
const targetModels = new Map<string, T.Object3D>();
let targetsLoad: Promise<void> | null = null;

export function rangeTargetModel(name: string | undefined) {
  return (name && targetModels.get(`Range_${name}`)) || null;
}

const load = async (name: string) =>
  (await new GLTFLoader().loadAsync(`/assets/range/${name}.glb`)).scene;

function loadTargets() {
  targetsLoad ??= load("range-targets")
    .then((targets) => {
      targets.traverse((part) => {
        if (part instanceof T.Mesh) part.castShadow = part.receiveShadow = true;
      });
      for (const model of [...targets.children]) targetModels.set(model.name, model);
    })
    .catch((error) => {
      targetsLoad = null;
      throw error;
    });
  return targetsLoad;
}

export async function addRangeScenery(root: T.Object3D, land: T.Mesh) {
  const [terrain, dressing] = await Promise.all([
    load("range-island"),
    load("range-dressing"),
    loadTargets(),
  ]);
  const group = new T.Group();
  group.name = "Anvil Key";
  group.position.set(rangeLayout.centre.x, 0, rangeLayout.centre.z);
  terrain.traverse((part) => {
    if (!(part instanceof T.Mesh)) return;
    // The shared terrain material keeps both islands in one visual language.
    part.material = land.material;
    part.receiveShadow = true;
  });
  dressing.traverse((part) => {
    if (part instanceof T.Mesh) part.castShadow = part.receiveShadow = true;
  });
  group.add(terrain, dressing);
  root.add(group);
}
