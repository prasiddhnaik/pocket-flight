import * as T from "three";
import {
  boxDistSq,
  distance,
  tree,
  type Tri,
  type Tree,
} from "./triangle-distance";

export const attachmentTolerance = 0.00001; // 10 µm; numerical, not manufacturing tolerance.
export const objectPath = (object: T.Object3D): string =>
  object.parent ? `${objectPath(object.parent)}/${object.name}` : object.name;
const instanceMeshes = new WeakMap<T.InstancedMesh, T.Mesh[]>();
const instanceTransform = new T.Matrix4();
export function aircraftMeshes(root: T.Object3D) {
  const meshes: T.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (object instanceof T.InstancedMesh) {
      const copies = instanceMeshes.get(object) ?? [];
      for (let i = 0; i < object.count; i++) {
        const copy = copies[i] ?? new T.Mesh();
        copy.name = `${object.name}_instance_${i}`;
        copy.geometry = object.geometry;
        copy.material = object.material;
        copy.userData = object.userData;
        // Audit proxies never enter the live scene or alter its children.
        copy.parent = object;
        object.getMatrixAt(i, instanceTransform);
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(instanceTransform);
        copy.matrixWorld.multiplyMatrices(
          object.matrixWorld,
          instanceTransform,
        );
        copies[i] = copy;
        meshes.push(copy);
      }
      instanceMeshes.set(object, copies);
    } else if (object instanceof T.Mesh) meshes.push(object);
  });
  return meshes;
}

type PositionAttribute = T.BufferAttribute | T.InterleavedBufferAttribute;
const attributeVersion = (attribute: PositionAttribute) =>
  attribute instanceof T.InterleavedBufferAttribute
    ? attribute.data.version
    : attribute.version;
type Topology = {
  position: PositionAttribute;
  version: number;
  index: T.BufferAttribute | null;
  indexVersion: number;
  parts: number[][];
};
type Surface = {
  id: string;
  name: string;
  mesh: T.Mesh;
  box: T.Box3;
  triangles: Tri[];
  tree?: Tree;
};

/** Connected triangle surfaces, not whole meshes: merged floating islands count too. */
export class AttachmentChecker {
  private topology = new WeakMap<T.BufferGeometry, Topology>();
  private surfaces = new WeakMap<
    T.Mesh,
    { matrix: number[]; topology: Topology; parts: Surface[] }
  >();
  // A prior pose's trees must not stay alive through the pair cache.
  private pairs = new Map<
    string,
    { a: WeakRef<Tree>; b: WeakRef<Tree>; contact: boolean }
  >();
  private localParts(geometry: T.BufferGeometry) {
    const position = geometry.getAttribute("position"),
      index = geometry.index;
    const version = attributeVersion(position),
      indexVersion = index?.version ?? 0;
    const prior = this.topology.get(geometry);
    if (
      prior?.position === position &&
      prior.version === version &&
      prior.index === index &&
      prior.indexVersion === indexVersion
    )
      return prior;
    const parents: number[] = [],
      faces: number[][] = [],
      shared = new Map<string, number>();
    const find = (i: number): number =>
      parents[i] === i ? i : (parents[i] = find(parents[i]));
    for (
      let offset = 0;
      offset < (index?.count ?? position.count);
      offset += 3
    ) {
      const face = [0, 1, 2].map((j) =>
        index ? index.getX(offset + j) : offset + j,
      );
      const [a, b, c] = face.map((i) =>
        new T.Vector3().fromBufferAttribute(position, i),
      );
      if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-20) continue;
      const id = faces.length;
      faces.push(face);
      parents.push(id);
      for (const i of face) {
        // Weld duplicated normal/UV vertices by actual stored position. Non-
        // shared touching/crossing surfaces are joined later by exact triangles.
        const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
        const neighbour = shared.get(key);
        if (neighbour === undefined) shared.set(key, id);
        else parents[find(id)] = find(neighbour);
      }
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < faces.length; i++) {
      const id = find(i),
        indices = groups.get(id) ?? [];
      indices.push(...faces[i]);
      groups.set(id, indices);
    }
    const value: Topology = {
      position,
      version,
      index,
      indexVersion,
      parts: [...groups.values()],
    };
    this.topology.set(geometry, value);
    return value;
  }
  private worldParts(mesh: T.Mesh) {
    const topology = this.localParts(mesh.geometry),
      prior = this.surfaces.get(mesh),
      matrix = mesh.matrixWorld.elements;
    if (
      prior?.topology === topology &&
      prior.matrix.every((v, i) => v === matrix[i])
    )
      return prior.parts;
    const parts = topology.parts.map((indices, partIndex): Surface => {
      const triangles: Tri[] = [],
        box = new T.Box3();
      for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((j) =>
          new T.Vector3()
            .fromBufferAttribute(topology.position, indices[i + j])
            .applyMatrix4(mesh.matrixWorld),
        );
        const bounds = new T.Box3().setFromPoints([a, b, c]);
        box.union(bounds);
        triangles.push({ a, b, c, box: bounds });
      }
      return {
        id: `${mesh.uuid}:${partIndex}`,
        name:
          objectPath(mesh) +
          (topology.parts.length > 1
            ? `#surface-${partIndex + 1}/${topology.parts.length}`
            : ""),
        mesh,
        box,
        triangles,
      };
    });
    if (!parts.length)
      throw new Error(`No usable triangle surface: ${objectPath(mesh)}`);
    this.surfaces.set(mesh, { matrix: [...matrix], topology, parts });
    return parts;
  }
  private geometry(surface: Surface) {
    return (surface.tree ??= tree(surface.triangles));
  }
  /** Exact nearest body-connected surfaces for a bounded selection of flags. */
  measureDetached(root: T.Object3D, groups: string[][], limit = 8) {
    const surfaces = aircraftMeshes(root).flatMap((mesh) =>
      this.worldParts(mesh),
    );
    const detachedNames = new Set(groups.flat());
    const outside = surfaces.filter((part) => !detachedNames.has(part.name));
    return groups.slice(0, limit).map((names) => {
      const members = new Set(names);
      const inside = surfaces.filter((part) => members.has(part.name));
      const pairs = inside
        .flatMap((a) =>
          outside.map((b) => ({
            a,
            b,
            lowerBound: boxDistSq(a.box, b.box),
          })),
        )
        .sort((a, b) => a.lowerBound - b.lowerBound);
      let metres = Infinity;
      let nearest:
        { from: string; to: string; pa?: number[]; pb?: number[] } | undefined;
      for (const pair of pairs) {
        if (pair.lowerBound > metres * metres) break;
        const result = distance(
          this.geometry(pair.a),
          this.geometry(pair.b),
          metres,
        );
        if (result.metres < metres) {
          metres = result.metres;
          nearest = {
            from: pair.a.name,
            to: pair.b.name,
            pa: result.pa,
            pb: result.pb,
          };
        }
      }
      return { surfaces: names.length, metres, ...nearest };
    });
  }
  check(
    root: T.Object3D,
    excludeCosmeticSupport = false,
    primaryMesh = "Pressure_shell_upper",
  ) {
    const all = aircraftMeshes(root);
    // This stricter pass removes paint/livery-labelled meshes. The entry's blue
    // door and surround panels also carry that suffix; the full pass above
    // includes them, and intended structural seats are checked separately.
    const meshes = excludeCosmeticSupport
      ? all.filter((m) => !/Paint_sweep|livery/i.test(m.name))
      : all;
    const surfaces = meshes.flatMap((mesh) => this.worldParts(mesh));
    const parents = surfaces.map((_, i) => i);
    const find = (i: number): number =>
      parents[i] === i ? i : (parents[i] = find(parents[i]));
    let candidates = 0,
      exactChecks = 0;
    for (let i = 0; i < surfaces.length; i++)
      for (let j = 0; j < i; j++) {
        if (
          find(i) === find(j) ||
          boxDistSq(surfaces[i].box, surfaces[j].box) > attachmentTolerance ** 2
        )
          continue;
        candidates++;
        const a = this.geometry(surfaces[i]),
          b = this.geometry(surfaces[j]);
        const key = `${surfaces[i].id}:${surfaces[j].id}`,
          cached = this.pairs.get(key);
        let contact: boolean;
        if (cached?.a.deref() === a && cached.b.deref() === b)
          contact = cached.contact;
        else {
          const result = distance(a, b, attachmentTolerance * 1.0001);
          contact = result.metres <= attachmentTolerance;
          this.pairs.set(key, {
            a: new WeakRef(a),
            b: new WeakRef(b),
            contact,
          });
          exactChecks++;
        }
        if (contact) parents[find(i)] = find(j);
      }
    const groups = new Map<number, Surface[]>();
    for (let i = 0; i < surfaces.length; i++) {
      const id = find(i),
        group = groups.get(id) ?? [];
      group.push(surfaces[i]);
      groups.set(id, group);
    }
    const components = [...groups.values()].sort((a, b) => b.length - a.length);
    const main = components.find((c) =>
      c.some((m) => m.mesh.name === primaryMesh),
    );
    if (!main) throw new Error(`Missing primary body mesh: ${primaryMesh}`);
    return {
      meshes: meshes.length,
      surfaces: surfaces.length,
      candidates,
      exactChecks,
      components: components.length,
      mainMeshes: new Set(main.map((s) => s.mesh)).size,
      mainSurfaces: main.length,
      detached: components
        .filter((c) => c !== main)
        .map((c) => c.map((s) => s.name)),
    };
  }
}

export function floorDatum(root: T.Object3D) {
  const datum = root.getObjectByName("Interior")?.userData.floorY;
  if (typeof datum !== "number" || !Number.isFinite(datum))
    throw new Error("Missing finished floor datum");
  const floors = ["Cockpit_floor", "Entry_vestibule_floor", "Cabin_floor"].map(
    (name) => {
      const mesh = root.getObjectByName(name);
      if (!(mesh instanceof T.Mesh)) throw new Error(`Missing ${name}`);
      return { name, topY: new T.Box3().setFromObject(mesh).max.y };
    },
  );
  return {
    floors,
    spread:
      Math.max(...floors.map((f) => f.topY)) -
      Math.min(...floors.map((f) => f.topY)),
    maximumError: Math.max(...floors.map((f) => Math.abs(f.topY - datum))),
  };
}
