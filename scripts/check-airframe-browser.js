async (page) => {
  const errors = [], results = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(async () => {
    const T = await import("/node_modules/three/build/three.module.js");
    const { makeAircraft } = await import("/src/aircraft/aircraft.ts");
    const { RoomEnvironment } = await import("/node_modules/three/examples/jsm/environments/RoomEnvironment.js");
    const renderer = new T.WebGLRenderer({ canvas: document.querySelector("canvas"), antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 900);
    renderer.setPixelRatio(1);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const scene = new T.Scene(); scene.background = new T.Color("#e8e9e5");
    const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, .04).texture; room.dispose(); pmrem.dispose();
    scene.add(new T.HemisphereLight(0xffffff, 0x64747b, 1.6));
    const light = new T.DirectionalLight(0xffffff, 2.6); light.position.set(-3, 8, 4); scene.add(light);
    const camera = new T.PerspectiveCamera(34, 1200 / 900, .01, 300);
    window.airframeReview = { T, makeAircraft, renderer, scene, camera };
  });
  for (const id of ["finch", "peregrine", "aurelia", "stormbird"]) {
    const inventory = await page.evaluate(async (id) => {
      const r = window.airframeReview;
      if (r.model) { r.scene.remove(r.model.group); r.model.dispose(); }
      const model = r.model = r.makeAircraft(1, id); await model.ready; r.scene.add(model.group); r.scene.updateMatrixWorld(true);
      const meshes = [], box = new r.T.Box3().setFromObject(model.group);
      model.group.traverse((o) => {
        if (!o.isMesh) return;
        const b = new r.T.Box3().setFromObject(o);
        if (b.min.toArray().concat(b.max.toArray()).some((n) => !Number.isFinite(n))) throw new Error("Non-finite mesh " + o.name);
        meshes.push({ name: o.userData.name ?? o.name, bounds: [b.min.toArray(), b.max.toArray()], materials: (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m.name) });
      });
      return { id, bounds: [box.min.toArray(), box.max.toArray()], meshes };
    }, id);
    for (const view of ["overview", "cockpit", "wing-left", "wing-right", "rear"]) {
      await page.evaluate((view) => {
        const { T, renderer, scene, camera, model } = window.airframeReview;
        const box = new T.Box3().setFromObject(model.group), center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
        let target = center, distance = Math.max(size.x, size.z) * 1.45, direction = new T.Vector3(1, .65, -1);
        if (view.startsWith("wing")) {
          const sign = view.endsWith("left") ? -1 : 1;
          const w = new T.Box3().setFromObject(model.wings[sign < 0 ? 0 : 1]);
          target = w.getCenter(new T.Vector3());
          target.x = sign < 0 ? w.min.x * .78 + w.max.x * .22 : w.max.x * .78 + w.min.x * .22;
          const ray = new T.Raycaster(new T.Vector3(target.x, box.max.y + 2, target.z), new T.Vector3(0,-1,0));
          const hit = ray.intersectObject(model.wings[sign < 0 ? 0 : 1], true)[0];
          if (hit) target.y = hit.point.y;
          distance = (w.max.z - w.min.z) * .9;
          direction = new T.Vector3(sign * .75, .95, 1);
        } else if (view === "cockpit") {
          const cockpit = model.group.getObjectByName("Canopy") ?? model.group.getObjectByName("Cockpit");
          const c = new T.Box3().setFromObject(cockpit);
          target = c.getCenter(new T.Vector3());
          distance = Math.max(c.max.z - c.min.z, c.max.x - c.min.x) * 1.55;
          direction = new T.Vector3(1, .65, -1.1);
        } else if (view === "rear") direction = new T.Vector3(.8,.45,1);
        camera.position.copy(target).add(direction.normalize().multiplyScalar(distance));
        camera.lookAt(target); camera.updateProjectionMatrix(); renderer.render(scene, camera);
      }, view);
      await page.locator("canvas").screenshot({ path: `output/airframe-REVIEW_PHASE-${id}-${view}.png` });
    }
    results.push(inventory);
  }
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { results, errors };
};
