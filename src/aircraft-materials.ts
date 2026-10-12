import * as T from "three";

// Keep authored colors, textures and material sharing; only refine the finish.
export function refineAircraftMaterials(root: T.Object3D) {
  const finishes = new Map<T.Material, T.Material>();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    object.castShadow = object.receiveShadow = !object.userData.cockpitDisplay;
    const finish = (source: T.Material) => {
      if (finishes.has(source)) return finishes.get(source)!;
      if (!(source instanceof T.MeshStandardMaterial)) return source;
      const glass = /glass/i.test(source.name);
      const matte =
        /rubber|tire|textile|seat|leather|carbon|duct/i.test(source.name) ||
        (source.color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.035 &&
          source.roughness > 0.7);
      const material =
        source instanceof T.MeshPhysicalMaterial ||
        matte ||
        source.metalness > 0.7
          ? source
          : new T.MeshPhysicalMaterial();
      if (material !== source) {
        T.MeshStandardMaterial.prototype.copy.call(material, source);
        source.dispose();
      }
      material.envMapIntensity = glass ? 1.05 : 0.75;
      if (material instanceof T.MeshPhysicalMaterial) {
        material.clearcoat = glass ? 1 : matte ? 0 : 0.62;
        material.clearcoatRoughness = glass ? 0.08 : 0.2;
        if (!matte)
          material.roughness = glass
            ? 0.08
            : Math.min(material.roughness, 0.34);
        if (glass) {
          material.transmission = 0;
          material.ior = 1.46;
        }
      }
      if (glass) {
        material.transparent = true;
        material.opacity = T.MathUtils.clamp(source.opacity, 0.24, 0.34);
        material.depthWrite = false;
        material.side = T.DoubleSide;
      }
      finishes.set(source, material);
      return material;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(finish)
      : finish(object.material);
    if (
      (Array.isArray(object.material)
        ? object.material
        : [object.material]
      ).some((m) => /glass/i.test(m.name))
    ) {
      object.castShadow = false;
      object.renderOrder = 3;
    }
  });
}
