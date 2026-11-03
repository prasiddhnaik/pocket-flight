import * as T from "three";

// The island's trees, built to cost almost nothing. Models come from scripts/build-tropical-trees.py.
//
// There is one draw per kind and level, however many trees exist, and no scene object per tree or
// per cell. Trees are grouped once into grid cells; when the camera has moved enough, the cells in
// view are copied into each draw's buffer. Lighting is worked out per vertex, so a leaf pixel only
// costs fog and tone mapping, and there is no transparency, so nothing is shaded twice.

export type TreeSite = {
  kind: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  /** Width against height, so copies of a model differ. */
  stretch: number;
  shade: number;
};

const CELL_SIZE = 64;
/** Numbers per tree in a draw's buffer: x, y, z, scale, then cos yaw, sin yaw, stretch, shade. */
export const TREE_STRIDE = 8;
/** Distance, in metres at normal zoom, where each level gives way to the next. */
export const TREE_LEVELS = [90, 280, 700] as const;
/** Undergrowth stops here: beyond it, a shrub is smaller than a pixel worth drawing. */
export const SHRUB_REACH = 300;
/** Cells this close draw even when behind the camera, so their shadows stay on the ground in view. */
const ALWAYS_NEAR = 170;
const REFRESH_DISTANCE = 6;
const REFRESH_TURN = 0.998;

/** Far away, gaps between trees are smaller than a pixel, so most of them can go. */
export function keptFraction(distance: number) {
  if (distance < 650) return 1;
  if (distance < 1100) return 0.6;
  return 0.35;
}

export function levelAt(distance: number, levels: number) {
  const level = TREE_LEVELS.findIndex((reach) => distance < reach);
  return Math.min(level < 0 ? TREE_LEVELS.length : level, levels - 1);
}

type Cell = { x: number; y: number; z: number; radius: number; ranges: Map<string, [number, number]> };

/** Sorts sites into cells once, then fills draw buffers from them in a few microseconds. */
export class TreeBuckets {
  readonly kinds: string[];
  readonly cells: Cell[] = [];
  private readonly packed = new Map<string, Float32Array>();
  /** Per kind, per level: what the next draw should show. */
  readonly buffers = new Map<string, Float32Array[]>();
  readonly counts = new Map<string, number[]>();

  constructor(sites: readonly TreeSite[], private readonly levels: Record<string, number>) {
    this.kinds = Object.keys(levels);
    const grouped = new Map<string, TreeSite[]>();
    for (const site of sites) {
      const key = `${Math.floor(site.x / CELL_SIZE)},${Math.floor(site.z / CELL_SIZE)}`;
      const list = grouped.get(key) ?? [];
      list.push(site);
      grouped.set(key, list);
    }
    const cursor = new Map<string, number>();
    for (const kind of this.kinds) {
      const total = sites.filter((site) => site.kind === kind).length;
      this.packed.set(kind, new Float32Array(total * TREE_STRIDE));
      cursor.set(kind, 0);
      this.buffers.set(kind, Array.from({ length: levels[kind] }, () => new Float32Array(total * TREE_STRIDE)));
      this.counts.set(kind, new Array(levels[kind]).fill(0));
    }
    for (const list of grouped.values()) {
      let x = 0,
        y = 0,
        z = 0;
      for (const site of list) {
        x += site.x;
        y += site.y;
        z += site.z;
      }
      x /= list.length;
      y /= list.length;
      z /= list.length;
      let radius = 0;
      const ranges = new Map<string, [number, number]>();
      for (const kind of this.kinds) {
        const own = list.filter((site) => site.kind === kind);
        if (!own.length) continue;
        const start = cursor.get(kind)!;
        const data = this.packed.get(kind)!;
        own.forEach((site, i) => {
          const at = (start + i) * TREE_STRIDE;
          data[at] = site.x;
          data[at + 1] = site.y;
          data[at + 2] = site.z;
          data[at + 3] = site.scale;
          data[at + 4] = Math.cos(site.yaw);
          data[at + 5] = Math.sin(site.yaw);
          data[at + 6] = site.stretch;
          data[at + 7] = site.shade;
          radius = Math.max(radius, Math.hypot(site.x - x, site.y - y, site.z - z) + site.scale * (kind === "palm" ? 12 : 3.4));
        });
        ranges.set(kind, [start, own.length]);
        cursor.set(kind, start + own.length);
      }
      this.cells.push({ x, y, z, radius, ranges });
    }
  }

  /** Copies every cell in view into the buffer for its level. */
  fill(position: T.Vector3, frustum: T.Frustum, zoom = 1) {
    for (const kind of this.kinds) this.counts.get(kind)!.fill(0);
    const sphere = TreeBuckets.sphere;
    for (const cell of this.cells) {
      const distance = Math.hypot(cell.x - position.x, cell.y - position.y, cell.z - position.z);
      if (distance > ALWAYS_NEAR) {
        sphere.center.set(cell.x, cell.y, cell.z);
        sphere.radius = cell.radius;
        if (!frustum.intersectsSphere(sphere)) continue;
      }
      const seen = distance / zoom;
      const kept = keptFraction(seen);
      for (const [kind, [start, count]] of cell.ranges) {
        if (kind === "shrub" && seen > SHRUB_REACH) continue;
        const level = levelAt(seen, this.levels[kind]);
        const shown = kept === 1 ? count : Math.ceil(count * kept);
        const used = this.counts.get(kind)!;
        this.buffers.get(kind)![level].set(
          this.packed.get(kind)!.subarray(start * TREE_STRIDE, (start + shown) * TREE_STRIDE),
          used[level] * TREE_STRIDE,
        );
        used[level] += shown;
      }
    }
  }

  private static sphere = new T.Sphere();
}

const PLACE = `
attribute vec4 placeA;
attribute vec4 placeB;
vec3 treeTurn(vec3 v) { return vec3(placeB.x * v.x + placeB.y * v.z, v.y, placeB.x * v.z - placeB.y * v.x); }
vec3 treePlace(vec3 v) { return treeTurn(vec3(v.x * placeB.z, v.y, v.z * placeB.z)) * placeA.w + placeA.xyz; }
`;
const vertexShader = `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
${PLACE}
attribute vec3 color;
uniform vec3 sunDirection, sunLight, skyLight, groundLight;
varying vec3 vColour;
void main() {
  vec3 n = treeTurn(normal);
  // Leaves pass light, so the sun wraps a little way round the crown.
  float sun = max(0., dot(n, sunDirection) * .78 + .22);
  vec3 light = mix(groundLight, skyLight, .5 + .5 * n.y) + sunLight * sun;
  // Each tree leans a little warm or cool, by where it stands.
  float warm = fract(placeA.x * .37 + placeA.z * .71);
  vColour = color * mix(vec3(.94, 1.02, .96), vec3(1.08, 1., .84), warm) * placeB.w * light * RECIPROCAL_PI;
  vec4 mvPosition = viewMatrix * vec4(treePlace(position), 1.);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const fragmentShader = `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
varying vec3 vColour;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(vColour, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Which levels of each kind throw a shadow. Far trees and undergrowth do not need to. */
const CASTS_SHADOW: Record<string, number> = { broadleaf: 2, round: 2, tall: 2, palm: 2, shrub: 0 };

export class TreeField extends T.Group {
  private readonly buckets: TreeBuckets;
  private readonly draws = new Map<string, { mesh: T.Mesh; geometry: T.InstancedBufferGeometry; buffer: T.InstancedInterleavedBuffer }[]>();
  private readonly lit = {
    sunDirection: { value: new T.Vector3(0, 1, 0) },
    sunLight: { value: new T.Vector3() },
    skyLight: { value: new T.Vector3() },
    groundLight: { value: new T.Vector3() },
  };
  private readonly lastPosition = new T.Vector3(Infinity, 0, 0);
  private readonly lastForward = new T.Vector3();
  private readonly forward = new T.Vector3();
  private readonly frustum = new T.Frustum();
  private readonly viewProjection = new T.Matrix4();
  private lastZoom = 0;
  private lastCamera: T.Camera | null = null;
  private sun: T.DirectionalLight | null = null;
  private sky: T.HemisphereLight | null = null;
  private readonly scene: T.Scene;
  private readonly previousHook: T.Scene["onBeforeRender"];

  constructor(scene: T.Scene, models: ReadonlyMap<string, T.BufferGeometry>, sites: readonly TreeSite[]) {
    super();
    this.name = "Tree field";
    const levels: Record<string, number> = {};
    for (const name of models.keys()) {
      const [kind, level] = name.split("_");
      levels[kind] = Math.max(levels[kind] ?? 0, Number(level) + 1);
    }
    this.buckets = new TreeBuckets(sites, levels);
    const material = (side: T.Side) => {
      const made = new T.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side,
        fog: true,
        uniforms: T.UniformsUtils.merge([T.UniformsLib.fog]),
      });
      Object.assign(made.uniforms, this.lit);
      return made;
    };
    const solid = material(T.FrontSide),
      // Palm fronds are single sheets, seen from both sides.
      sheet = material(T.DoubleSide);
    const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, side: T.DoubleSide });
    depth.onBeforeCompile = (shader) => {
      shader.vertexShader = PLACE + shader.vertexShader.replace("#include <begin_vertex>", "vec3 transformed = treePlace(position);");
    };
    depth.customProgramCacheKey = () => "tree-field-depth";
    for (const kind of this.buckets.kinds) {
      const row: { mesh: T.Mesh; geometry: T.InstancedBufferGeometry; buffer: T.InstancedInterleavedBuffer }[] = [];
      for (let level = 0; level < levels[kind]; level++) {
        const source = models.get(`${kind}_${level}`)!;
        const geometry = new T.InstancedBufferGeometry();
        geometry.setIndex(source.index);
        for (const name of ["position", "normal", "color"]) geometry.setAttribute(name, source.getAttribute(name));
        const buffer = new T.InstancedInterleavedBuffer(this.buckets.buffers.get(kind)![level], TREE_STRIDE);
        buffer.setUsage(T.DynamicDrawUsage);
        geometry.setAttribute("placeA", new T.InterleavedBufferAttribute(buffer, 4, 0));
        geometry.setAttribute("placeB", new T.InterleavedBufferAttribute(buffer, 4, 4));
        geometry.instanceCount = 0;
        const mesh = new T.Mesh(geometry, kind === "palm" ? sheet : solid);
        mesh.name = `${kind} level ${level}`;
        mesh.frustumCulled = false;
        mesh.castShadow = level < (CASTS_SHADOW[kind] ?? 0);
        mesh.customDepthMaterial = depth;
        this.add(mesh);
        row.push({ mesh, geometry, buffer });
      }
      this.draws.set(kind, row);
    }
    // This must run before the renderer gathers its draw list. That is when it uploads buffers
    // and reads visibility, so anything later would draw a frame of stale trees.
    this.scene = scene;
    this.previousHook = scene.onBeforeRender;
    scene.onBeforeRender = (...args) => {
      this.previousHook.apply(scene, args);
      this.prepare(scene, args[2]);
    };
  }

  private prepare(scene: T.Object3D, camera: T.Camera) {
    this.updateLights(scene);
    camera.getWorldDirection(this.forward);
    const zoom = (camera as T.PerspectiveCamera).zoom ?? 1;
    const position = camera.getWorldPosition(TreeField.position);
    if (
      camera === this.lastCamera &&
      zoom === this.lastZoom &&
      position.distanceToSquared(this.lastPosition) < REFRESH_DISTANCE * REFRESH_DISTANCE &&
      this.forward.dot(this.lastForward) > REFRESH_TURN
    )
      return;
    this.lastCamera = camera;
    this.lastZoom = zoom;
    this.lastPosition.copy(position);
    this.lastForward.copy(this.forward);
    this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.buckets.fill(position, this.frustum, zoom);
    for (const [kind, row] of this.draws) {
      const counts = this.buckets.counts.get(kind)!;
      row.forEach(({ mesh, geometry, buffer }, level) => {
        const count = counts[level];
        geometry.instanceCount = count;
        mesh.visible = count > 0;
        if (!count) return;
        buffer.clearUpdateRanges();
        buffer.addUpdateRange(0, count * TREE_STRIDE);
        buffer.needsUpdate = true;
      });
    }
  }

  private updateLights(scene: T.Object3D) {
    if (!this.sun || !this.sky) {
      for (const child of scene.children) {
        if (child instanceof T.DirectionalLight) this.sun = child;
        if (child instanceof T.HemisphereLight) this.sky = child;
      }
    }
    const { sunDirection, sunLight, skyLight, groundLight } = this.lit;
    if (this.sun) {
      sunDirection.value.subVectors(this.sun.position, this.sun.target.position).normalize();
      const c = this.sun.color, i = this.sun.intensity;
      sunLight.value.set(c.r * i, c.g * i, c.b * i);
    }
    if (this.sky) {
      const i = this.sky.intensity;
      skyLight.value.set(this.sky.color.r * i, this.sky.color.g * i, this.sky.color.b * i);
      groundLight.value.set(this.sky.groundColor.r * i, this.sky.groundColor.g * i, this.sky.groundColor.b * i);
    }
  }

  private static position = new T.Vector3();

  /** Trees drawn in the last refresh, per kind and level, for checks and tuning. */
  get drawn() {
    return Object.fromEntries(this.buckets.counts);
  }

  dispose() {
    this.scene.onBeforeRender = this.previousHook;
    const materials = new Set<T.Material>();
    this.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      materials.add(node.material as T.Material);
      if (node.customDepthMaterial) materials.add(node.customDepthMaterial);
      node.geometry.dispose();
    });
    materials.forEach((material) => material.dispose());
    this.removeFromParent();
  }
}
