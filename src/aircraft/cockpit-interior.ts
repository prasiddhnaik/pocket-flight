import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type CockpitCarve = {
  /** Corners of the old cabin in the flight model's own units. */
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  /** Parts that stay whole even inside the box, such as the glazing. */
  keep: RegExp;
  /** Also drop faces that only cross the box, for skins with long triangles. */
  touching?: boolean;
};
export type InteriorDriver<State> = {
  url: string;
  /** Simple cockpit parts in the flight model that this interior replaces. */
  replaces: readonly string[];
  /** Old cockpit faces merged into larger meshes, cut away while the interior shows. */
  carve?: CockpitCarve;
  bind(cabin: T.Object3D): void;
  update(state: State, dt: number): void;
  dispose?(): void;
};

async function loadCabin(url: string) {
  return (await new GLTFLoader().loadAsync(url)).scene;
}

/**
 * A detailed cockpit that lives beside the flight model. It loads the first time
 * the cockpit camera is used and costs nothing from any other view.
 */
export class CockpitInterior<State> {
  loaded: Promise<void> | null = null;
  private cabin: T.Object3D | null = null;
  private attached: T.Object3D | null = null;
  private replaced: T.Object3D[] = [];
  private carved: { geometry: T.BufferGeometry; whole: T.BufferAttribute; open: T.BufferAttribute }[] = [];
  private wanted = false;
  private disposed = false;
  constructor(
    private aircraft: T.Object3D,
    private driver: InteriorDriver<State>,
    private load: (url: string) => Promise<T.Object3D> = loadCabin,
  ) {}
  get active() {
    return this.wanted && this.cabin !== null;
  }
  setActive(active: boolean) {
    if (active === this.wanted) return;
    this.wanted = active;
    if (active) this.loaded ??= this.fetch();
    this.show();
  }
  private async fetch() {
    const cabin = await this.load(this.driver.url);
    if (this.disposed) {
      disposeCabin(cabin);
      return;
    }
    cabin.traverse((node) => {
      node.castShadow = false;
      node.receiveShadow = false;
    });
    this.driver.bind(cabin);
    this.findReplaced();
    this.carve();
    this.aircraft.add(cabin);
    // Parts fixed to the canopy ride with the flight model's opening canopy.
    this.attached = cabin.getObjectByName("Canopy_attached") ?? null;
    const canopy = this.aircraft.getObjectByName("Canopy");
    if (this.attached && canopy) {
      this.aircraft.updateWorldMatrix(true, true);
      canopy.attach(this.attached);
    }
    this.cabin = cabin;
    this.show();
  }
  private findReplaced() {
    const names = new Set(this.driver.replaces);
    this.aircraft.traverse((node) => {
      if (names.has(node.name) || names.has(String(node.userData.name ?? ""))) this.replaced.push(node);
    });
  }
  /** Prepares a second index for each mesh with faces wholly inside the old cabin. */
  private carve() {
    const box = this.driver.carve;
    if (!box) return;
    this.aircraft.updateWorldMatrix(true, true);
    const toRoot = new T.Matrix4().copy(this.aircraft.matrixWorld).invert();
    const local = new T.Matrix4();
    const point = new T.Vector3();
    const seen = new Set<T.BufferGeometry>();
    this.aircraft.traverse((node) => {
      if (!(node instanceof T.Mesh) || seen.has(node.geometry)) return;
      const whole = node.geometry.index;
      if (!whole) return;
      for (let cursor: T.Object3D | null = node; cursor; cursor = cursor.parent)
        if (box.keep.test(String(cursor.userData.name ?? cursor.name))) return;
      seen.add(node.geometry);
      local.multiplyMatrices(toRoot, node.matrixWorld);
      const position = node.geometry.getAttribute("position");
      const inside = new Uint8Array(position.count);
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(local);
        inside[i] = point.x >= box.min[0] && point.x <= box.max[0] && point.y >= box.min[1] && point.y <= box.max[1] && point.z >= box.min[2] && point.z <= box.max[2] ? 1 : 0;
      }
      const kept: number[] = [];
      for (let i = 0; i < whole.count; i += 3) {
        const a = whole.getX(i), b = whole.getX(i + 1), c = whole.getX(i + 2);
        const gone = box.touching ? inside[a] || inside[b] || inside[c] : inside[a] && inside[b] && inside[c];
        if (!gone) kept.push(a, b, c);
      }
      if (kept.length < whole.count)
        this.carved.push({ geometry: node.geometry, whole: whole as T.BufferAttribute, open: new T.BufferAttribute(new Uint32Array(kept), 1) });
    });
  }
  private show() {
    const on = this.active;
    if (this.cabin) this.cabin.visible = on;
    if (this.attached) this.attached.visible = on;
    for (const part of this.replaced) part.visible = !on;
    for (const cut of this.carved) cut.geometry.setIndex(on ? cut.open : cut.whole);
  }
  update(state: State, dt: number) {
    if (this.active) this.driver.update(state, dt);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.wanted = false;
    this.show();
    this.driver.dispose?.();
    if (this.attached) disposeCabin(this.attached);
    if (this.cabin) disposeCabin(this.cabin);
    this.attached = this.cabin = null;
  }
}

function disposeCabin(root: T.Object3D) {
  root.removeFromParent();
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material instanceof T.MeshStandardMaterial) {
        material.map?.dispose();
        material.emissiveMap?.dispose();
      }
      material.dispose();
    }
  });
}
