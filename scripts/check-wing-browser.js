async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.reload();
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas { visibility: visible !important; }" });
  await page.waitForFunction(() => !!window.pocketFlight);
  await page.evaluate(async () => {
    const g = window.pocketFlight;
    g.setSuspended(true);
    await g.aircraft.ready;
    const T = await import("/node_modules/three/build/three.module.js");
    const { makeAircraft } = await import("/src/aircraft.ts");
    const model = makeAircraft(1, "finch");
    await model.ready;
    const scene = new T.Scene();
    scene.background = new T.Color("#e8e9e5");
    scene.add(model.group, new T.HemisphereLight(0xffffff, 0x7a8488, 2));
    const key = new T.DirectionalLight(0xffffff, 3);
    key.position.set(-3, 8, 4);
    scene.add(key);
    const camera = new T.PerspectiveCamera(32, 1100 / 850, .01, 100);
    scene.updateMatrixWorld(true);
    window.wingReview = { g, T, model, scene, camera };
  });
  const results = [];
  for (const side of ["Left", "Right"]) {
    const result = await page.evaluate((side) => {
      const { g, T, model, scene, camera } = window.wingReview;
      const sign = side === "Left" ? -1 : 1;
      const parts = [];
      scene.traverse((o) => parts.push(o));
      const band = parts.find((o) => o.name.startsWith(`Wing_${side}`) && o.name.includes("Livery"));
      const skin = parts.find((o) => o.name.startsWith(`Wing_${side}`) && o.name.includes("Paint"));
      if (band?.userData.detail_type !== "Surface-fitted painted bands")
        throw new Error(`Raised wing stripes returned on ${side}`);
      const ray = new T.Raycaster(), point = new T.Vector3();
      let maximumGap = 0;
      for (let i = 0; i < band.geometry.attributes.position.count; i++) {
        point.fromBufferAttribute(band.geometry.attributes.position, i).applyMatrix4(band.matrixWorld);
        ray.set(point.clone().add(new T.Vector3(0, 1, 0)), new T.Vector3(0, -1, 0));
        const hit = ray.intersectObject(skin, false)[0];
        if (!hit) throw new Error("Paint extends beyond wing skin");
        maximumGap = Math.max(maximumGap, Math.abs(hit.distance - 1));
      }
      if (maximumGap > .001) throw new Error(`Paint is raised by ${maximumGap} m`);
      model.setPaint(2);
      if (band.material.color.getHexString() !== "e67862") throw new Error("Wing paint customization broke");
      model.setPaint(1);
      camera.position.set(sign * 6.05, 1.22, 1.48);
      camera.lookAt(sign * 4.91, .19, -.04);
      camera.updateProjectionMatrix();
      g.renderer.render(scene, camera);
      return { id: `finch-${side}`, maximumGap, vertices: band.geometry.attributes.position.count, paintCustomization: true };
    }, side);
    await page.locator("canvas").first().screenshot({ path: `output/finch-wing-${side.toLowerCase()}.png` });
    results.push(result);
  }
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { results, errors };
};
